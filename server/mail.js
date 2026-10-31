// 言 · 桥接的信：外头寄给某段对话的信，与到点的候（定时），先落进 存储根/信/ 再交给页面——页面关着、桥接重启都不丢。
// 由 server.js 装配：require("./server/mail.js")({ home, known })
//   待收/<编号>.json  还没被页面取走的信；页面经 /api/mail/wait 等着、/api/mail/take 认领（改名即认领，几页同等也只一页拿到）
//   候.json           等时刻的候：几点叫、叫谁、附什么话、隔多久再叫。启动时读回，错过的当场补叫并记下迟了多久
// 寄信的口子（POST /api/mail）给本机的程序用：不带 Origin 的本机脚本放行、别的网页拒之门外，与执事接口同一道门禁（见 server.js）
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { jsonRoute, readJson, requestSignal, sendJson, writeAtomic, errorText } = require("./http.js");

// setTimeout 至多等这么久（约 24.8 天），再远的到时候再排一回
const MAX_DELAY = 2 ** 31 - 1;
// 页面的长等：这么久没有新信就空手回，页面随即再等——顺带让它重新看一眼先前跳过的信（那时那段对话别处正在答）
const WAIT_MS = 60000;

/** @param {{ home: () => string, known: (id: string) => boolean }} options */
module.exports = function createMail({ home, known }) {
  const inboxDir = () => path.join(home(), "待收"),
    timersFile = () => path.join(home(), "候.json");
  /** @type {Set<() => void>} 正等着新信的页面 */
  const waiters = new Set();

  // ---------- 信 ----------
  function newId(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  /** 落盘一封信，叫醒等着的页面 @param {Record<string, any>} letter */
  function post(letter) {
    const full = { id: newId("m"), at: Date.now(), ...letter };
    fs.mkdirSync(inboxDir(), { recursive: true });
    writeAtomic(path.join(inboxDir(), `${full.id}.json`), JSON.stringify(full));
    for (const wake of [...waiters]) wake();
    return full;
  }
  function pending() {
    let names = [];
    try {
      names = fs.readdirSync(inboxDir()).filter(name => name.endsWith(".json"));
    } catch {}
    const letters = [];
    for (const name of names)
      try {
        letters.push(JSON.parse(fs.readFileSync(path.join(inboxDir(), name), "utf8")));
      } catch {}
    return letters.sort((a, b) => a.at - b.at);
  }
  // 认领：改名成功的才算拿到，再删；几页同时认领同一封，只有一页改名得手
  function take(ids) {
    const taken = [];
    for (const id of ids) {
      if (!/^[\w-]{1,40}$/.test(id)) continue;
      const file = path.join(inboxDir(), `${id}.json`),
        claimed = `${file}.${process.pid}.taken`;
      try {
        fs.renameSync(file, claimed);
        taken.push(JSON.parse(fs.readFileSync(claimed, "utf8")));
      } catch {}
      fs.rmSync(claimed, { force: true });
    }
    return taken;
  }
  // 外头寄信：to 是对话的 id（目录里得有这段对话），from 写来处，text 是信的正文
  const handleSend = jsonRoute(
    body => {
      const to = String(body.to || "").trim(),
        text = String(body.text ?? "").trim(),
        from = String(body.from || "")
          .trim()
          .slice(0, 60);
      if (!to || !known(to)) throw Error(`没有这段对话：${to || "（未填 to）"}`);
      if (!text) throw Error("信是空的：text 写信的正文");
      const letter = post({ kind: "letter", to, from, text: text.slice(0, 20000) });
      return { ok: true, id: letter.id };
    },
    error => errorText(error, 200),
    1024 * 1024
  );
  // 页面等信：有没被跳过的就当场回，没有就挂着，来了新信或等满一分钟再回
  async function handleWait(req, res) {
    const body = await readJson(req).catch(() => ({})),
      skip = new Set(Array.isArray(body.skip) ? body.skip.map(String) : []),
      fresh = () => pending().filter(letter => !skip.has(letter.id)),
      signal = requestSignal(res);
    let letters = fresh();
    if (!letters.length)
      await new Promise(resolve => {
        const done = () => {
          waiters.delete(done);
          clearTimeout(timer);
          resolve(null);
        };
        const timer = setTimeout(done, WAIT_MS);
        waiters.add(done);
        signal.addEventListener("abort", done, { once: true });
      });
    if (signal.aborted || res.writableEnded || res.destroyed) return;
    letters = letters.length ? letters : fresh();
    sendJson(res, 200, { letters });
  }
  const handleTake = jsonRoute(body => ({ letters: take(Array.isArray(body.ids) ? body.ids.map(String) : []) }));

  // ---------- 候：等时刻 ----------
  /** @type {{ seq: number, timers: Array<{ id: string, to: string, step: string, note: string, due: number, every?: number, created: number }> }} */
  let book = { seq: 0, timers: [] };
  try {
    const saved = JSON.parse(fs.readFileSync(timersFile(), "utf8"));
    if (saved && Array.isArray(saved.timers)) book = { seq: Number(saved.seq) || 0, timers: saved.timers };
  } catch {}
  let armed = null;
  function save() {
    fs.mkdirSync(home(), { recursive: true });
    writeAtomic(timersFile(), JSON.stringify({ 言: "候", ...book }, null, 1));
  }
  function arm() {
    clearTimeout(armed);
    if (!book.timers.length) return;
    const next = Math.min(...book.timers.map(timer => timer.due));
    armed = setTimeout(fire, Math.min(MAX_DELAY, Math.max(0, next - Date.now())));
    armed.unref?.();
  }
  // 到点的都寄一封信给那段对话；隔一阵再叫的排到此后头一个时刻（睡过去的几回不补，只记迟了多久）
  function fire() {
    const now = Date.now();
    let changed = false;
    for (const timer of [...book.timers]) {
      if (timer.due > now) continue;
      changed = true;
      // 那段对话已删了（别处删的，这边没来得及取消）：不叫，也不再排
      if (!known(timer.to)) {
        book.timers = book.timers.filter(item => item !== timer);
        continue;
      }
      const due = timer.due;
      if (timer.every) timer.due += timer.every * Math.max(1, Math.ceil((now - timer.due + 1) / timer.every));
      else book.timers = book.timers.filter(item => item !== timer);
      // next：隔一阵再叫的下一回（页面据它改签上的时刻）
      post({
        kind: "timer",
        to: timer.to,
        timer: {
          id: timer.id,
          step: timer.step,
          note: timer.note,
          due,
          late: now - due,
          ...(timer.every ? { every: timer.every, next: timer.due } : {})
        }
      });
    }
    if (changed) save();
    arm();
  }
  const handleTimerSet = jsonRoute(body => {
    const to = String(body.to || ""),
      due = Number(body.due),
      every = Number(body.every) || 0;
    if (!to) throw Error("缺少对话");
    if (!Number.isFinite(due)) throw Error("时刻无效");
    if (every && every < 1000) throw Error("every 至少 1 秒");
    const timer = {
      id: `t${++book.seq}`,
      to,
      step: String(body.step || ""),
      note: String(body.note || "").slice(0, 2000),
      due,
      ...(every ? { every } : {}),
      created: Date.now()
    };
    book.timers.push(timer);
    save();
    arm();
    return timer;
  });
  // 取消：到点前叫停；没有的（已叫过、已取消）回 found: false
  const handleTimerCancel = jsonRoute(body => {
    const id = String(body.id || ""),
      timer = book.timers.find(item => item.id === id && (!body.to || item.to === body.to));
    if (!timer) return { found: false };
    book.timers = book.timers.filter(item => item !== timer);
    save();
    arm();
    return { found: true, timer };
  });
  const handleTimerList = jsonRoute(() => ({ timers: book.timers }));
  arm();

  return {
    post,
    routes: {
      "POST /api/mail": handleSend,
      "POST /api/mail/wait": handleWait,
      "POST /api/mail/take": handleTake,
      "POST /api/timer/set": handleTimerSet,
      "POST /api/timer/cancel": handleTimerCancel,
      "POST /api/timer/list": handleTimerList
    }
  };
};
