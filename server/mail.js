// 言 · 桥接的磁盘信箱：跨 Bot 指令的持久队列，一封信一个 JSON 落在 存储根/mail-queue/。
//   投递 post（同 msgId 判重）→ 页面 wait 长等 → claim 认领（带租期，过了别页可再领）→
//   消息写进那段对话落盘 → ack 回执。回执簿 acked-ids.json 记已收的号：刷新页面、重启桥接都不重复投递；
//   认领超上限的记成 dead 留档不再送。桥接重启不需恢复流程——正本就在盘上，过期的认领领到时自动放出。
// 由 server.js 装配：require("./server/mail.js")({ home: () => path.join(STORE.paths().root, "mail-queue"), route: STORE.scopedRoute })
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { jsonRoute, requestSignal, writeAtomic, readJsonFile, errorText } = require("./http.js");

const WAIT_MS = 30000, // 页面长等的上限：空手回就再等，顺带重看一眼先前跳过的（那时那段对话别处正在答）
  CLAIM_MS = 30000, // 认领租期：领到信的页面要在这工夫里落盘回执，过了别页可再领
  CLAIM_MAX_MS = 120000, // 租期上限
  MAX_CLAIMS = 8, // 一封至多被领几回：总在落盘前断的就是死信
  ACK_KEEP = 500; // 回执簿留最近这么多号判重

/** @param {{ home: () => string, route?: typeof jsonRoute, waitMs?: number, claimMinMs?: number }} options */
module.exports = function createMail({ home, route = jsonRoute, waitMs = WAIT_MS, claimMinMs = 1000 }) {
  /** @type {Set<() => void>} 正等着的页面 */
  const waiters = new Set();
  const validId = id => /^[\w-]{1,64}$/.test(id),
    letterFile = id => path.join(home(), `${id}.json`),
    ackedFile = () => path.join(home(), "acked-ids.json");
  const readLetter = id => (validId(id) ? readJsonFile(letterFile(id)) : null);
  /** @returns {object[]} 按投递先后排 */
  function letters() {
    let names = [];
    try {
      names = fs.readdirSync(home());
    } catch {
      return [];
    }
    const acked = ackedIds();
    return names
      .filter(name => name !== "acked-ids.json" && /^[\w-]{1,64}\.json$/.test(name))
      .map(name => readJsonFile(path.join(home(), name)))
      // 回过执又留下了的残信（先记簿后销正本半途崩的）：一样不送
      .filter(letter => letter && validId(letter.id) && letter.to && !acked.has(letter.id))
      .sort((a, b) => (a.postedAt || 0) - (b.postedAt || 0));
  }
  // 可领的：不是死信，且没人在租期内押着（过期自动放出，不必等谁松手）
  const claimable = (letter, now) => letter.status !== "dead" && (!letter.claim || letter.claim.until <= now);
  // 回执簿读不动宁可当场败（EBUSY、半截 JSON）：readJsonFile 那类把异常当不存在的读法，
  // 会让记簿拿空集起步、把已收过的信号全抹掉。读败一律沿路由错回——投、等、领、回执都停一停，比放行重复指令安全
  function ackedIds() {
    try {
      return new Set(JSON.parse(fs.readFileSync(ackedFile(), "utf8"))?.ids || []);
    } catch (error) {
      if (error?.code === "ENOENT") return new Set();
      throw error;
    }
  }
  function noteAcked(id) {
    const ids = [...ackedIds()].filter(item => item !== id);
    ids.push(id);
    writeAtomic(ackedFile(), JSON.stringify({ 言: "信箱 · 回执簿", ids: ids.slice(-ACK_KEEP) }, null, 1));
  }
  const wakeAll = () => {
    for (const wake of [...waiters]) wake();
  };

  const handlePost = route(body => {
    const to = String(body.to || "");
    if (!to) throw Error("缺少去向");
    const payload = String(body.payload ?? "");
    if (!payload.trim()) throw Error("缺少内容");
    const id = validId(body.msgId) ? String(body.msgId) : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // 同号再来：已回执的或在途的都不再排第二份（重启后重放副作用指令也撞在这里）
    if (ackedIds().has(id) || fs.existsSync(letterFile(id))) return { posted: false, dup: true, id };
    fs.mkdirSync(home(), { recursive: true });
    writeAtomic(
      letterFile(id),
      JSON.stringify(
        {
          id,
          to,
          from: String(body.from || ""),
          taskId: String(body.taskId || ""),
          correlationId: String(body.correlationId || ""),
          reassignCount: Number(body.reassignCount) || 0,
          kind: String(body.kind || ""),
          payload,
          status: "queued",
          claims: 0,
          postedAt: Date.now()
        },
        null,
        1
      )
    );
    wakeAll();
    return { posted: true, id };
  }, error => `信投不出去：${errorText(error, 200)}`);

  // 页面等着：有可领的就当场回，没有就挂着，有新的投递或等满时限再回
  const handleWait = route(async (body, req, res) => {
    const at = home(),
      skip = new Set(Array.isArray(body.skip) ? body.skip.map(String) : []),
      fresh = () => letters().filter(letter => !skip.has(letter.id) && claimable(letter, Date.now())),
      signal = requestSignal(res);
    if (signal.aborted) return;
    let list = fresh();
    if (!list.length)
      await new Promise(resolve => {
        const done = () => {
          waiters.delete(done);
          clearTimeout(timer);
          resolve(null);
        };
        const timer = setTimeout(done, waitMs);
        waiters.add(done);
        signal.addEventListener("abort", done, { once: true });
      });
    if (signal.aborted || res.writableEnded || res.destroyed) return;
    // 等待归发起时的根；换根唤回旧等待时交空手，不把新根的信递给尚未换过来的旧页面
    return { letters: home() === at ? (list.length ? list : fresh()) : [] };
  }, error => `等信出错：${errorText(error, 200)}`);

  // 认领：在途、死信、租期内被别人押着的都领不走；同一人续领会换租期。认领数+1，超限记死
  const handleClaim = route(body => {
    const id = String(body.id || "");
    if (!validId(id)) throw Error("编号无效");
    const owner = String(body.owner || "");
    if (!owner) throw Error("缺少认领人");
    const letter = readLetter(id);
    if (!letter) return { claimed: false, gone: ackedIds().has(id) ? "acked" : "missing" };
    if (letter.status === "dead") return { claimed: false, dead: true };
    // 回过执又留下了的残信（先记簿后销正本半途崩的）：不送、领不走
    if (ackedIds().has(id)) return { claimed: false, gone: "acked" };
    const now = Date.now();
    if (letter.claim && letter.claim.until > now && letter.claim.owner !== owner) return { claimed: false, owner: letter.claim.owner };
    // 同一人续租只是延租期，不算又领一回；换手或过期再领才计数（总在落盘前断的才该记死）
    const renewing = letter.claim && letter.claim.until > now && letter.claim.owner === owner,
      claims = (letter.claims || 0) + (renewing ? 0 : 1);
    if (claims > MAX_CLAIMS) {
      writeAtomic(letterFile(id), JSON.stringify({ ...letter, claims, status: "dead" }, null, 1));
      return { claimed: false, dead: true };
    }
    const next = { ...letter, claims, status: "claimed", claim: { owner, at: now, until: now + Math.min(Math.max(Number(body.ttl) || CLAIM_MS, claimMinMs), CLAIM_MAX_MS) } };
    writeAtomic(letterFile(id), JSON.stringify(next, null, 1));
    return { claimed: true, letter: next };
  }, error => `认领出错：${errorText(error, 200)}`);

  // 回执：只认租约持有者本人；销正本、记回执簿。信已不在（回过执了、或根本没投过）照实说
  const handleAck = route(body => {
    const id = String(body.id || "");
    if (!validId(id)) throw Error("编号无效");
    const owner = String(body.owner || "");
    const letter = readLetter(id);
    if (!letter) {
      if (ackedIds().has(id)) return { ok: true, already: true };
      throw Error("这封信不存在");
    }
    if (letter.status !== "claimed" || letter.claim?.owner !== owner) return { ok: false };
    // 先记回执簿再销正本：反过来中间一崩，信没了簿里也没留号
    noteAcked(id);
    fs.rmSync(letterFile(id), { force: true });
    return { ok: true };
  }, error => `回执出错：${errorText(error, 200)}`);

  return {
    routes: {
      "POST /api/mail/post": handlePost,
      "POST /api/mail/wait": handleWait,
      "POST /api/mail/claim": handleClaim,
      "POST /api/mail/ack": handleAck
    }
  };
};
