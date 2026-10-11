// 言 · 意：一件工程要成立的结论图——项目实现的骨架。存在目录的 .yan/意.json（桥接是唯一的写者，见 server/work/index.js），
// 不属于哪一段对话：换一段对话、压缩了前文、被回报叫醒另起一答，看到的都是同一份。
// 程序只给形式约束与可见性，成立与否由模型自己判：
//   结构——前提要在、不成环，不合的整批不收；根的说法立后不由模型改（立根时记下用户那一问的原话，日后拿它比）；
//   传播——前提没立住，上面的就不算立住；
//   回归——一项标成立时记下凭据（自己与各前提的说法版本、依托文件的内容指纹），此后说法改了、文件被谁改了，它就转待复核。
//     只是标记、不驱动什么：由数据算出，算一回就停，不会自己转起来；复核后再标成立，即换一份凭据。
// 降级有合法的写法：借外部结论、不自己做的标「假定」（note 写出处），算立住，但往上记着借了几条——降在哪、降多少看得见。
// 本文件只放纯函数：理顺模型交来的改动、判状态、写成给模型读的字。读写与附着见 10-store.js，工具登记见 15-tools/32-intent.js
/**
 * @typedef {"open"|"doing"|"done"|"assumed"|"dropped"} IntentMark 模型标的
 * @typedef {IntentMark|"stale"} IntentState 算出来的：成立的凭据不再作数即待复核
 * @typedef {Object} IntentNode
 * @property {string} claim 要成立的那句话
 * @property {string} check 怎么算成立
 * @property {string[]} needs 前提
 * @property {boolean} [any] 前提里一项立住即可（几条路线择一）
 * @property {string} [when] 只在这一情形下须成立
 * @property {string[]} files 依托的文件（目录内相对、正斜杠，见 intentPath）
 * @property {IntentMark} state
 * @property {string} [note] 假定的出处、备注
 * @property {number} rev 说法的版本：claim、check、when 改一回加一
 * @property {IntentSeal} [seal] 标成立那一刻的凭据
 * @property {{ ask: string, at: string }} [root] 根：立时用户那一问的原话
 * @typedef {{ rev: number, premises: Record<string, number>, prints: Record<string, string|null> }} IntentSeal
 * @typedef {{ at: string, conversation: string, text: string }} IntentLog 改意、弃、假定的留痕
 * @typedef {{ nodes: Record<string, IntentNode>, log: IntentLog[] }} Intent
 * @typedef {{ id: string, claim?: string, check?: string, when?: string, needs?: string[], any?: boolean, files?: string[], state?: IntentMark, note?: string, root?: boolean }} IntentOp
 * @typedef {Record<string, string|null>} IntentPrints 文件此刻的内容指纹；不在其中的即不知道，不据它判
 */
const INTENT_LIMIT = 60,
  INTENT_LOG_LIMIT = 200,
  INTENT_ID = /^[\p{L}\p{N}_.·-]{1,24}$/u,
  INTENT_MARKS = new Set(["open", "doing", "done", "assumed", "dropped"]),
  INTENT_MARK_ALIASES = {
    pending: "open",
    todo: "open",
    in_progress: "doing",
    complete: "done",
    completed: "done",
    holds: "done",
    claimed: "done",
    assume: "assumed",
    skipped: "dropped",
    drop: "dropped"
  };
/** 读到的 JSON 理成一份意：缺的补上，认不得的项丢掉 @returns {Intent} */
function asIntent(raw) {
  const nodes = raw && typeof raw.nodes === "object" && !Array.isArray(raw.nodes) ? raw.nodes : {},
    /** @type {Intent} */
    intent = { nodes: {}, log: Array.isArray(raw?.log) ? raw.log.slice(-INTENT_LOG_LIMIT) : [] };
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== "object" || !INTENT_ID.test(id)) continue;
    intent.nodes[id] = {
      ...node,
      claim: String(node.claim || ""),
      check: String(node.check || ""),
      needs: Array.isArray(node.needs) ? node.needs.map(String) : [],
      files: Array.isArray(node.files) ? node.files.map(String) : [],
      state: INTENT_MARKS.has(node.state) ? node.state : "open",
      rev: Number(node.rev) || 1
    };
  }
  return intent;
}
// 文件写成与行迹里的改动记录同一个样子（目录内相对、正斜杠，见 server/work/paths.js 的 relPath）：
// 模型写的 ./src/a.js、src\a.js、目录下的绝对路径都认作 src/a.js。只做 Windows，比目录时不计大小写
/** @param {string} path @param {string|null} [workdir] */
function intentPath(path, workdir = "") {
  const p = String(path ?? "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/"),
    root = String(workdir || "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
  return (root && p.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? p.slice(root.length + 1) : p).replace(/^(\.\/)+/, "");
}
const liveNeeds = (intent, node) => node.needs.filter(id => intent.nodes[id] && intent.nodes[id].state !== "dropped");
/** 谁以它为前提 @param {Intent} intent @param {string} id */
function intentDependents(intent, id) {
  return Object.keys(intent.nodes).filter(other => intent.nodes[other].state !== "dropped" && intent.nodes[other].needs.includes(id));
}
/** 根：没弃、也没有谁以它为前提的——一件活最终要立住的结论 @param {Intent} intent */
function intentRoots(intent) {
  return Object.keys(intent.nodes).filter(id => intent.nodes[id].state !== "dropped" && !intentDependents(intent, id).length);
}
/** 前提在前的次序（万一有环，环上的按原序排在末尾，不至于丢） @param {Intent} intent */
function intentOrder(intent) {
  const out = [],
    done = new Set(),
    visiting = new Set();
  const visit = id => {
    if (done.has(id) || visiting.has(id) || !intent.nodes[id]) return;
    visiting.add(id);
    for (const need of intent.nodes[id].needs) visit(need);
    visiting.delete(id);
    done.add(id);
    out.push(id);
  };
  for (const id of Object.keys(intent.nodes)) visit(id);
  return out;
}
/** @param {Intent} intent @returns {string[]|null} 成环的一圈 */
function intentCycle(intent) {
  const state = new Map(),
    path = [];
  const visit = id => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const need of intent.nodes[id]?.needs || []) {
      if (!intent.nodes[need]) continue;
      const found = visit(need);
      if (found) return found;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of Object.keys(intent.nodes)) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}
// ---------- 判状态：都由数据算出，不存 ----------
/** 成立的凭据还作不作数 @param {Intent} intent @param {string} id @param {IntentPrints} now @returns {string} 不作数的缘由；作数即空 */
function intentStaleWhy(intent, id, now = {}) {
  const node = intent.nodes[id],
    seal = node?.seal;
  if (!node || node.state !== "done" || !seal) return "";
  if (seal.rev !== node.rev) return "说法改了";
  for (const need of liveNeeds(intent, node)) {
    if (!(need in seal.premises)) return `前提 ${need} 是后来加的`;
    if (seal.premises[need] !== intent.nodes[need].rev) return `前提 ${need} 的说法改了`;
  }
  const touched = Object.keys(seal.prints).filter(path => path in now && now[path] !== seal.prints[path]);
  return touched.length
    ? `标成立后又改了 ${touched.slice(0, 4).join("、")}${touched.length > 4 ? ` 等 ${touched.length} 个文件` : ""}`
    : "";
}
/** @param {Intent} intent @param {string} id @param {IntentPrints} [now] @returns {IntentState} */
function intentState(intent, id, now = {}) {
  const node = intent.nodes[id];
  return node.state === "done" && intentStaleWhy(intent, id, now) ? "stale" : node.state;
}
// 「立住」：自己成立（或是假定）、凭据作数，前提也都立住了（any 的有一项立住即可）。弃了的前提不算在内
/** @param {Intent} intent @param {string} id @param {IntentPrints} [now] */
function intentEstablished(intent, id, now = {}, seen = new Set()) {
  const node = intent.nodes[id];
  if (!node || seen.has(id)) return false;
  const state = intentState(intent, id, now);
  if (state === "assumed") return true;
  if (state !== "done") return false;
  const premises = liveNeeds(intent, node);
  if (!premises.length) return true;
  const next = new Set(seen).add(id);
  return node.any
    ? premises.some(need => intentEstablished(intent, need, now, next))
    : premises.every(need => intentEstablished(intent, need, now, next));
}
/** 这一项底下借了哪几条假定 @param {Intent} intent @param {string} id */
function intentBorrowed(intent, id) {
  const out = new Set(),
    seen = new Set(),
    queue = [id];
  while (queue.length) {
    const at = queue.shift();
    if (seen.has(at) || !intent.nodes[at]) continue;
    seen.add(at);
    if (intent.nodes[at].state === "assumed") out.add(at);
    else queue.push(...liveNeeds(intent, intent.nodes[at]));
  }
  return [...out];
}
/** 已成立各项依托的文件：读意时据此取一回此刻的指纹 @param {Intent} intent */
function intentSealedFiles(intent) {
  return [
    ...new Set(
      Object.values(intent.nodes)
        .filter(node => node.state === "done" && node.seal)
        .flatMap(node => Object.keys(node.seal.prints))
    )
  ];
}
// ---------- 模型交来的改动：理顺、查错，查出错的整批不收 ----------
/**
 * @param {Intent} intent 此刻的意
 * @param {any} raw 模型给的 nodes
 * @param {string|null} [workdir] files 里的路径据此写成相对的
 * @returns {{ ops: IntentOp[], problems: string[] }}
 */
function normalizeIntentOps(intent, raw, workdir = "") {
  const problems = [],
    /** @type {IntentOp[]} */
    ops = [];
  if (!Array.isArray(raw) || !raw.length) return { ops, problems: ["nodes 须是非空数组"] };
  const clip = (value, n) =>
    String(value ?? "")
      .trim()
      .slice(0, n);
  const list = value => (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]);
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      problems.push("nodes 里每一项须是对象");
      continue;
    }
    const id = clip(item.id, 40);
    if (!INTENT_ID.test(id)) {
      problems.push(`id「${id}」不合要求：1–24 个字母、数字、汉字或 _ . · -，不含空格`);
      continue;
    }
    const known = intent.nodes[id] || ops.find(op => op.id === id && op.claim);
    /** @type {IntentOp} */
    const op = { id };
    for (const [key, n] of /** @type {const} */ ([
      ["claim", 300],
      ["check", 600],
      ["when", 200],
      ["note", 1000]
    ]))
      if (item[key] !== undefined) op[key] = clip(item[key], n);
    if (item.any !== undefined) op.any = item.any === true || item.any === "true";
    if (item.needs !== undefined) op.needs = [...new Set(list(item.needs).map(n => clip(n, 40)))].filter(n => n && n !== id);
    if (item.files !== undefined)
      op.files = [...new Set(list(item.files).map(f => intentPath(clip(f, 300), workdir)))].filter(Boolean).slice(0, 20);
    if (item.state !== undefined) {
      const state = String(item.state).trim().toLowerCase(),
        mark = INTENT_MARKS.has(state) ? state : INTENT_MARK_ALIASES[state];
      if (!mark) problems.push(`${id} 的 state「${item.state}」不认得：只有 open / doing / done / assumed / dropped`);
      else op.state = /** @type {IntentMark} */ (mark);
    }
    if (!known) {
      if (!op.claim || !op.check) {
        problems.push(`${id} 是新的一项，claim 与 check 都要写`);
        continue;
      }
      if (item.root === true || item.root === "true") op.root = true;
    } else {
      if (op.claim === "" || op.check === "") problems.push(`${id} 的 claim、check 不能改成空的`);
      const node = intent.nodes[id];
      if (node?.root && ["claim", "check", "when"].some(key => op[key] !== undefined && op[key] !== (node[key] || "")))
        problems.push(`${id} 是根，说法立后不由你改（要改请用户在意里改）；做不到的部分可在它底下标假定`);
    }
    ops.push(op);
  }
  // 折上去试一遍：前提都在、没有环、假定写了出处、不超上限
  const trial = applyIntentOps(intent, ops);
  for (const op of ops)
    for (const need of op.needs || [])
      if (!trial.nodes[need]) problems.push(`${op.id} 的前提 ${need} 不存在（新的前提与它同一批写上即可）`);
  const cycle = intentCycle(trial);
  if (cycle) problems.push(`前提成了环：${cycle.join(" → ")}`);
  for (const op of ops)
    if (trial.nodes[op.id]?.state === "assumed" && !trial.nodes[op.id].note)
      problems.push(`${op.id} 标了假定，note 里写明借的是什么、出处在哪`);
  const live = Object.values(trial.nodes).filter(node => node.state !== "dropped").length;
  if (live > INTENT_LIMIT && live > Object.values(intent.nodes).filter(node => node.state !== "dropped").length)
    problems.push(`意里的项不宜多于 ${INTENT_LIMIT} 项（此刻 ${live}）：一项是值得单独判的结论，不是每一步动作；细的并进上一级`);
  return { ops, problems };
}
/** 这一批里标成立的各项依托的文件：写之前取一回指纹作凭据 @param {Intent} intent @param {IntentOp[]} ops */
function intentSealing(intent, ops) {
  const trial = applyIntentOps(intent, ops);
  return [...new Set(ops.filter(op => op.state === "done").flatMap(op => trial.nodes[op.id]?.files || []))];
}
/**
 * 把一批改动折上去，得一份新的（不动原来那份）。先改说法与结构，最后才给标成立的各项记凭据：同一批里前提改了说法，记的是改后的
 * @param {Intent} intent
 * @param {IntentOp[]} ops
 * @param {{ at?: string, conversation?: string, ask?: string, prints?: IntentPrints }} [context] ask：立根时用户那一问的原话
 * @returns {Intent}
 */
function applyIntentOps(intent, ops, { at = "", conversation = "", ask = "", prints = {} } = {}) {
  /** @type {Intent} */
  const next = structuredClone(intent),
    log = text => next.log.push({ at, conversation, text });
  for (const op of ops) {
    let node = next.nodes[op.id];
    if (!node) {
      if (!op.claim) continue;
      node = next.nodes[op.id] = { claim: "", check: "", needs: [], files: [], state: "open", rev: 0 };
      if (op.root) node.root = { ask: String(ask).slice(0, 2000), at };
    }
    const before = `${node.claim}\u0001${node.check}\u0001${node.when || ""}`;
    for (const key of /** @type {const} */ (["claim", "check", "when", "note"])) if (op[key] !== undefined) node[key] = op[key];
    if (op.any !== undefined) node.any = op.any;
    if (op.needs) node.needs = op.needs;
    if (op.files) node.files = op.files;
    if (`${node.claim}\u0001${node.check}\u0001${node.when || ""}` !== before) {
      if (node.rev) log(`改意 ${op.id}：${node.claim}`);
      node.rev += 1;
    }
    if (op.state && op.state !== node.state) {
      if (op.state === "dropped" || op.state === "assumed")
        log(`${op.state === "dropped" ? "弃" : "假定"} ${op.id}${op.state === "assumed" && node.note ? `：${node.note}` : ""}`);
      if (node.state === "dropped") log(`复立 ${op.id}`);
    }
    if (op.state) node.state = op.state;
    if (node.state !== "done") delete node.seal;
  }
  for (const op of ops) {
    const node = next.nodes[op.id];
    if (op.state !== "done" || !node) continue;
    node.seal = {
      rev: node.rev,
      premises: Object.fromEntries(liveNeeds(next, node).map(need => [need, next.nodes[need].rev])),
      prints: Object.fromEntries(node.files.filter(path => path in prints).map(path => [path, prints[path]]))
    };
  }
  next.log = next.log.slice(-INTENT_LOG_LIMIT);
  return next;
}
// ---------- 写成给模型读的字：每一问附着的、改完回给它的，都经这里 ----------
const INTENT_STATE_TEXT = { open: "未做", doing: "在做", done: "成立", assumed: "假定", dropped: "已弃", stale: "待复核" };
/** @param {Intent} intent @param {IntentPrints} [now] */
function intentTally(intent, now = {}) {
  const live = Object.keys(intent.nodes).filter(id => intent.nodes[id].state !== "dropped");
  return { live: live.length, standing: live.filter(id => intentEstablished(intent, id, now)).length };
}
/**
 * 根在前、前提在后；立住了的只留一行，没立住的写验收与缘由，没立住的根附上用户的原话
 * @param {Intent} intent @param {IntentPrints} [now] @param {{ path?: string }} [options]
 */
function intentText(intent, now = {}, { path = ".yan/意.json" } = {}) {
  const order = intentOrder(intent)
      .reverse()
      .filter(id => intent.nodes[id].state !== "dropped"),
    roots = new Set(intentRoots(intent));
  if (!order.length) return "";
  const { live, standing } = intentTally(intent, now),
    dropped = Object.keys(intent.nodes).length - live;
  const lines = order.map(id => {
    const node = intent.nodes[id],
      state = intentState(intent, id, now),
      established = intentEstablished(intent, id, now),
      tag = state === "done" && !established ? "成立·前提未立" : INTENT_STATE_TEXT[state],
      premises = liveNeeds(intent, node),
      borrowed = roots.has(id) && established ? intentBorrowed(intent, id).filter(b => b !== id) : [],
      head = `- [${tag}] ${id}${roots.has(id) ? "（根）" : ""}：${node.claim}${node.when ? `（情形：${node.when}）` : ""}${premises.length ? `（前提：${premises.join("、")}${node.any ? "，任一即可" : ""}）` : ""}${borrowed.length ? `（借假定：${borrowed.join("、")}）` : ""}`;
    if (state === "assumed") return `${head}\n  出处：${node.note || ""}`;
    if (established) return head;
    const more = [`  验收：${node.check}`];
    if (state === "stale") more.push(`  缘由：${intentStaleWhy(intent, id, now)}`);
    if (node.root?.ask) more.push(`  原话：${node.root.ask.slice(0, 200)}`);
    return [head, ...more].join("\n");
  });
  return `［意 ${path}］立住 ${standing} / ${live}${dropped ? `，另有 ${dropped} 项已弃` : ""}\n${lines.join("\n")}`;
}
