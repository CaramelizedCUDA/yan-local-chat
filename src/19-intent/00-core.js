// 言 · 意：一件工程要成立的结论图——项目实现的骨架。存在目录的 .yan/意.json（桥接是唯一的写者，见 server/work/index.js），
// 不属于哪一段对话：换一段对话、压缩了前文、被回报叫醒另起一答，看到的都是同一份。
// 程序只给形式约束与可见性，成立与否由模型自己判：
//   结构——前提要在、不成环，不合的整批不收；立根时记下用户那一问的原话，日后拿它比；根的说法只照用户的话改，改时记下那一问、留一笔痕；
//   传播——前提没立住，上面的就不算立住；
//   回归——一项标成立时记下凭据（自己与各前提的说法版本、所依托凭据的指纹：文件、目录、探针，见 05-anchors.js），
//     此后说法改了、凭据变了，它就转待复核。只是标记、不驱动什么：由数据算出，算一回就停，不会自己转起来；复核后再标成立，即换一份凭据。
// 方案改了、写错了的整项撤去（state 给 removed），指向它的前提一并抹掉，只留一笔痕；弃（dropped）不同——是主线上走过、不通的路，
// 留在文件里作记号：不算数、不上图，卡片图下列着，模型读的意里也点到名，免得再走一遍。
// 降级有合法的写法：借外部结论、不自己做的标「假定」（note 写出处），算立住，但往上记着借了几条——降在哪、降多少看得见。
// 假定也可挂凭据：所借的变了（接口改版、依赖升级），它同样转待复核。
// 节点不分类型：事件、功能、文件都是一句要成立的结论，粒度由模型拆到有凭据可挂为止，混着也无妨。
// 嵌套：一项做的事拆开还有许多步，就是模块——细项写 in 指向它，至多两层（全局 › 模块 › 子模块）。前提只连同一层，跨模块的写在模块上；
// 模块以里面收口的几项（同层没人以它为前提的）为前提，所以里面立住它才算立住，传播、回归照旧，不另写判定。
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
 * @property {string[]} anchors 凭据，「种类:值」（见 05-anchors.js）：变了即待复核
 * @property {IntentMark} state
 * @property {string} [note] 假定的出处、备注
 * @property {number} rev 说法的版本：claim、check、when 改一回加一
 * @property {IntentSeal} [seal] 标成立（或假定）那一刻记下的：说法版本、前提版本、各凭据的指纹
 * @property {{ ask: string, at: string, later?: string }} [root] 根：立时用户那一问的原话；later：末一回改根时那一问
 * @property {string} [in] 所属模块的 id；不写即在全局
 * @typedef {{ rev: number, premises: Record<string, number>, prints: Record<string, string|null>, anchors?: string[] }} IntentSeal
 * @typedef {{ at: string, conversation: string, text: string }} IntentLog 改意、弃、假定的留痕
 * @typedef {{ nodes: Record<string, IntentNode>, log: IntentLog[], updated?: string }} Intent updated：最近一回写入的时刻——单拿出来看时，看得出旧不旧
 * @typedef {{ id: string, claim?: string, check?: string, when?: string, needs?: string[], any?: boolean, anchors?: string[], state?: IntentMark, note?: string, root?: boolean, in?: string, remove?: boolean, rename?: string }} IntentOp in：空串即挪回全局；remove：整项撤去；rename：已有一项改叫这个名字
 * @typedef {Record<string, string|null>} IntentPrints 各凭据此刻的指纹，按「种类:值」；不在其中的即不知道，不据它判
 */
const INTENT_LIMIT = 60,
  INTENT_DEPTH = 2,
  INTENT_LEVEL_LIMIT = 15,
  INTENT_LOG_LIMIT = 200,
  INTENT_ID = /^[\p{L}\p{N}_.·-]+$/u,
  // 名字的宽：汉字一类全角记 2、字母数字记 1——至多 24 个汉字或 48 个字母
  INTENT_ID_WIDTH = 48,
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
  },
  // 撤：不是一种态，给了即整项删去
  INTENT_REMOVE = new Set(["removed", "remove", "delete", "deleted", "revoked"]),
  // 记凭据的两种：成立的、假定的
  SEALED = new Set(["done", "assumed"]);
// 节点表按 id 取项：内置对象名不能误当成已存在的节点。
const validIntentId = id =>
  INTENT_ID.test(id) &&
  [...id].reduce((w, ch) => w + (/** @type {number} */ (ch.codePointAt(0)) > 0x2e7f ? 2 : 1), 0) <= INTENT_ID_WIDTH &&
  !Object.hasOwn(Object.prototype, id);
/** 这一项改完叫什么（改了名的即新名） @param {IntentOp} op */
const intentOpId = op => op.rename || op.id;
// 模型给的名字理成合式：首尾的空格、冒号、@ 之类去掉，中间连着的一串换成一个 _；它自己写的 _ 不动。
// 同一批里 id、前提、所属、改名都经这里，改写得一致
/** @param {any} raw */
const tidyIntentId = raw =>
  String(raw ?? "")
    .replace(/^[^\p{L}\p{N}_.·-]+|[^\p{L}\p{N}_.·-]+$/gu, "")
    .replace(/[^\p{L}\p{N}_.·-]+/gu, "_");
// 改名：节点换个键（次序不动），前提、所属、各项所记的前提版本跟着换；说法没变，记下的凭据照旧作数
/** @param {Intent} intent @param {string} from @param {string} to */
function renameIntentNode(intent, from, to) {
  intent.nodes = Object.fromEntries(Object.entries(intent.nodes).map(([id, node]) => [id === from ? to : id, node]));
  for (const node of Object.values(intent.nodes)) {
    node.needs = node.needs.map(k => (k === from ? to : k));
    if (node.in === from) node.in = to;
    const premises = node.seal?.premises;
    if (premises && Object.hasOwn(premises, from)) node.seal.premises = Object.fromEntries(Object.entries(premises).map(([k, v]) => [k === from ? to : k, v]));
  }
}
/** 读到的 JSON 理成一份意：缺的补上，认不得的项丢掉 @returns {Intent} */
function asIntent(raw) {
  const nodes = raw?.nodes && typeof raw.nodes === "object" && !Array.isArray(raw.nodes) ? raw.nodes : {},
    /** @type {Intent} */
    intent = {
      nodes: {},
      log: Array.isArray(raw?.log)
        ? raw.log
            .filter(entry => entry && typeof entry === "object")
            .slice(-INTENT_LOG_LIMIT)
            .map(entry => ({ at: String(entry.at || ""), conversation: String(entry.conversation || ""), text: String(entry.text || "") }))
        : [],
      ...(typeof raw?.updated === "string" ? { updated: raw.updated } : {})
    };
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== "object" || !validIntentId(id)) continue;
    intent.nodes[id] = {
      ...node,
      claim: String(node.claim || ""),
      check: String(node.check || ""),
      needs: Array.isArray(node.needs) ? node.needs.map(String).filter(validIntentId) : [],
      // 凭据不带登记过的前缀（手编的、写漏的）即文件
      anchors: Array.isArray(node.anchors)
        ? node.anchors.map(String).map(key => (ANCHOR_KINDS.has(anchorParts(key)[0]) ? key : `file:${key}`))
        : [],
      state: INTENT_MARKS.has(node.state) ? node.state : "open",
      rev: Number(node.rev) || 1
    };
    if (typeof node.in === "string" && node.in !== id && validIntentId(node.in)) intent.nodes[id].in = node.in;
    else delete intent.nodes[id].in;
    if (node.seal !== undefined) {
      const record = value => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
      intent.nodes[id].seal = {
        rev: Number(node.seal?.rev) || 0,
        premises: record(node.seal?.premises),
        prints: record(node.seal?.prints),
        ...(Array.isArray(node.seal?.anchors) ? { anchors: node.seal.anchors.map(String) } : {})
      };
    }
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
// ---------- 嵌套 ----------
/** 所属的模块，由近及远（全局即空；手编出了环也不至于转不出来） @param {Intent} intent @param {string} id @returns {string[]} */
function intentAncestors(intent, id) {
  const out = [];
  for (let at = intent.nodes[id]?.in; at && intent.nodes[at] && at !== id && !out.includes(at); at = intent.nodes[at].in) out.push(at);
  return out;
}
/** 不算数了：自己弃了，或所属的模块弃了 @param {Intent} intent @param {string} id */
const intentGone = (intent, id) => !intent.nodes[id] || [id, ...intentAncestors(intent, id)].some(k => intent.nodes[k].state === "dropped");
/** 模块直属的几项 @param {Intent} intent @param {string} id */
const intentChildren = (intent, id) => Object.keys(intent.nodes).filter(k => intent.nodes[k].in === id && !intentGone(intent, k));
/** 模块收口的几项：直属里同层没人以它为前提的——模块以它们为前提 @param {Intent} intent @param {string} id */
function intentTops(intent, id) {
  const kids = intentChildren(intent, id);
  return kids.filter(k => !kids.some(other => intent.nodes[other].needs.includes(k)));
}
/** 写明的前提里还算数的 @param {Intent} intent @param {string} id */
const writtenNeeds = (intent, id) => intent.nodes[id].needs.filter(k => !intentGone(intent, k));
/** 实际的前提：写明的，加上（模块的）收口的几项 @param {Intent} intent @param {string} id */
const liveNeeds = (intent, id) => [...writtenNeeds(intent, id), ...intentTops(intent, id)];
/** 谁以它为前提：同层写明的，与（收口的）所属模块 @param {Intent} intent @param {string} id */
function intentDependents(intent, id) {
  const parent = intent.nodes[id]?.in;
  return [
    ...Object.keys(intent.nodes).filter(other => !intentGone(intent, other) && intent.nodes[other].needs.includes(id)),
    ...(parent && intent.nodes[parent] && intentTops(intent, parent).includes(id) ? [parent] : [])
  ];
}
/** 根：没弃、也没有谁以它为前提的——一件活最终要立住的结论（模块里的总有模块等着，根只在全局） @param {Intent} intent */
function intentRoots(intent) {
  return Object.keys(intent.nodes).filter(id => !intentGone(intent, id) && !intentDependents(intent, id).length);
}
/**
 * 孤悬的：在全局、没声明为根，既无前提、也没有谁以它为前提，而图里另有根——多半是手上的一步忘了挂进它所服务的模块。
 * 只有它一项、或声明过的根不算
 * @param {Intent} intent
 */
function intentStrays(intent) {
  const roots = intentRoots(intent);
  if (roots.length < 2) return [];
  return roots.filter(id => !intent.nodes[id].root && !intent.nodes[id].in && !liveNeeds(intent, id).length);
}
/**
 * 嵌套的规矩：所属的模块要在、不成环、不过两层；前提只连同一层；根在全局；一层不宜过多
 * @param {Intent} intent @returns {string[]}
 */
function intentNestProblems(intent) {
  const problems = [],
    counts = new Map();
  for (const [id, node] of Object.entries(intent.nodes)) {
    if (node.in !== undefined && !intent.nodes[node.in]) problems.push(`${id} 的 in「${node.in}」不存在（模块与细项同一批写上即可）`);
    const up = intentAncestors(intent, id),
      top = up.at(-1);
    if (top && intent.nodes[top].in !== undefined && intent.nodes[intent.nodes[top].in])
      problems.push(`${id} 的所属成了环：${[id, ...up, intent.nodes[top].in].join(" → ")}`);
    else if (up.length > INTENT_DEPTH) problems.push(`${id} 嵌得太深：至多两层（全局 › 模块 › 子模块）`);
    for (const need of node.needs)
      if (intent.nodes[need] && (intent.nodes[need].in || "") !== (node.in || ""))
        problems.push(`${id} 的前提 ${need} 不在同一层：前提只连同一层，跨模块的写在模块上`);
    if (node.root && node.in) problems.push(`${id} 是根，根在全局，不归模块`);
    if (!intentGone(intent, id)) counts.set(node.in || "", (counts.get(node.in || "") || 0) + 1);
  }
  for (const [level, n] of counts)
    if (n > INTENT_LEVEL_LIMIT)
      problems.push(`「${level || "全局"}」一层多于 ${INTENT_LEVEL_LIMIT} 项：把相关的几项并成一个模块（细项写 in 指向它）`);
  return problems;
}
/** 前提在前的次序（万一有环，环上的按原序排在末尾，不至于丢） @param {Intent} intent */
function intentOrder(intent) {
  const out = [],
    done = new Set(),
    visiting = new Set();
  const visit = id => {
    if (done.has(id) || visiting.has(id) || !intent.nodes[id]) return;
    visiting.add(id);
    for (const need of [...intent.nodes[id].needs, ...intentTops(intent, id)]) visit(need);
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
  if (!node || !SEALED.has(node.state) || !seal) return "";
  if (seal.rev !== node.rev) return "说法已改";
  if (seal.anchors && (seal.anchors.length !== node.anchors.length || seal.anchors.some(key => !node.anchors.includes(key))))
    return "凭据已改";
  // 假定不靠前提，只看它自己的说法与凭据
  if (node.state === "done")
    for (const need of liveNeeds(intent, id)) {
      if (!(need in seal.premises)) return `前提「${need}」为后添`;
      if (seal.premises[need] !== intent.nodes[need].rev) return `前提「${need}」说法已改`;
    }
  const touched = Object.keys(seal.prints).filter(key => key in now && now[key] !== seal.prints[key]);
  return touched.length
    ? `凭据已变：${touched.slice(0, 4).map(anchorLabel).join("、")}${touched.length > 4 ? ` 等 ${touched.length} 条` : ""}`
    : "";
}
/** @param {Intent} intent @param {string} id @param {IntentPrints} [now] @returns {IntentState} */
function intentState(intent, id, now = {}) {
  const node = intent.nodes[id];
  return SEALED.has(node.state) && intentStaleWhy(intent, id, now) ? "stale" : node.state;
}
// 「立住」：自己成立（或是假定）、凭据作数，前提也都立住了（any 的有一项立住即可）。弃了的前提不算在内
/** @param {Intent} intent @param {string} id @param {IntentPrints} [now] */
function intentEstablished(intent, id, now = {}, seen = new Set()) {
  const node = intent.nodes[id];
  if (!node || seen.has(id)) return false;
  const state = intentState(intent, id, now);
  if (state === "assumed") return true;
  if (state !== "done") return false;
  // any 只管写明的前提；模块收口的几项都得立住
  const written = writtenNeeds(intent, id),
    tops = intentTops(intent, id),
    next = new Set(seen).add(id),
    holds = need => intentEstablished(intent, need, now, next);
  return (node.any && written.length ? written.some(holds) : written.every(holds)) && tops.every(holds);
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
    else queue.push(...liveNeeds(intent, at));
  }
  return [...out];
}
/** 已成立、已假定各项记过指纹的凭据：读意时据此取一回此刻的 @param {Intent} intent */
function intentSealedAnchors(intent) {
  return [
    ...new Set(
      Object.values(intent.nodes)
        .filter(node => SEALED.has(node.state) && node.seal)
        .flatMap(node => Object.keys(node.seal.prints))
    )
  ];
}
// ---------- 模型交来的改动：理顺、查错，查出错的整批不收 ----------
/**
 * @param {Intent} intent 此刻的意
 * @param {any} raw 模型给的 nodes
 * @param {string|null} [workdir] 凭据里的路径据此写成相对的
 * @returns {{ ops: IntentOp[], problems: string[], tidied: [string, string][] }} tidied：照规矩改写过的名字（原样 → 改后），回给模型时说一声
 */
function normalizeIntentOps(intent, raw, workdir = "") {
  const problems = [],
    /** @type {IntentOp[]} */
    ops = [],
    /** @type {Map<string, string>} */
    tidied = new Map();
  if (!Array.isArray(raw) || !raw.length) return { ops, problems: ["nodes 须是非空数组"], tidied: [] };
  const clip = (value, n) =>
    String(value ?? "")
      .trim()
      .slice(0, n);
  const list = value => (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]);
  const idOf = value => {
    const said = clip(value, 80),
      id = tidyIntentId(said);
    if (id && id !== said) tidied.set(said, id);
    return id;
  };
  const badId = said => `id「${clip(said, 80)}」不合要求：须有字母、数字或汉字，至多 24 个汉字（字母数字 48 个）`;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      problems.push("nodes 里每一项须是对象");
      continue;
    }
    const id = idOf(item.id);
    if (!validIntentId(id)) {
      problems.push(badId(item.id));
      continue;
    }
    const known = intent.nodes[id] || ops.find(op => (op.id === id && op.claim) || op.rename === id);
    /** @type {IntentOp} */
    const op = { id };
    for (const [key, n] of /** @type {const} */ ([
      ["claim", 300],
      ["check", 600],
      ["note", 1000]
    ]))
      if (item[key] !== undefined) op[key] = clip(item[key], n);
    if (item.in !== undefined && item.in !== null) op.in = clip(item.in, 80) && idOf(item.in);
    if (item.any !== undefined) op.any = item.any === true || item.any === "true";
    if (item.needs !== undefined) op.needs = [...new Set(list(item.needs).map(idOf))].filter(n => n && n !== id);
    if (item.rename !== undefined && item.rename !== null && clip(item.rename, 80)) {
      const to = idOf(item.rename);
      if (!validIntentId(to)) problems.push(badId(item.rename));
      else if (!intent.nodes[id]) problems.push(`${id} 不存在，无可改名（新的一项直接用新名字立）`);
      else if (to !== id && (intent.nodes[to] || ops.some(other => other.id === to || other.rename === to)))
        problems.push(`${id} 改名为 ${to}：这个名字已有`);
      else if (to !== id) op.rename = to;
    }
    // 凭据：带前缀的是那一种，裸的是文件。模型照旧写 files 的也认
    const anchors = item.anchors !== undefined ? item.anchors : item.files;
    if (anchors !== undefined) {
      const parsed = list(anchors).map(raw => parseAnchor(clip(raw, 400), workdir));
      for (const one of parsed) if ("problem" in one) problems.push(`${id} 的${one.problem}`);
      op.anchors = [...new Set(parsed.flatMap(one => ("key" in one ? [one.key] : [])))].slice(0, 20);
    }
    if (item.state !== undefined && INTENT_REMOVE.has(String(item.state).trim().toLowerCase())) {
      if (intent.nodes[id]) ops.push({ id, remove: true });
      else problems.push(`${id} 不存在，无可撤`);
      continue;
    }
    if (item.state !== undefined) {
      const state = String(item.state).trim().toLowerCase(),
        mark = INTENT_MARKS.has(state) ? state : Object.hasOwn(INTENT_MARK_ALIASES, state) ? INTENT_MARK_ALIASES[state] : undefined;
      if (!mark) problems.push(`${id} 的 state「${item.state}」不认得：只有 open / doing / done / assumed / dropped / removed`);
      else op.state = /** @type {IntentMark} */ (mark);
    }
    if (!known) {
      if (!op.claim || !op.check) {
        problems.push(`${id} 是新的一项，claim 与 check 都要写`);
        continue;
      }
      if (item.root === true || item.root === "true") op.root = true;
    } else if (op.claim === "" || op.check === "") problems.push(`${id} 的 claim、check 不能改成空的`);
    ops.push(op);
  }
  // 同一批里别处仍写旧名的（前提、所属、再改那一项）：照新名认
  const renames = new Map(ops.filter(op => op.rename).map(op => [op.id, /** @type {string} */ (op.rename)])),
    renamed = id => renames.get(id) || id;
  if (renames.size)
    for (const op of ops) {
      if (!op.rename && renames.has(op.id)) op.id = renamed(op.id);
      if (op.needs) op.needs = [...new Set(op.needs.map(renamed))];
      if (op.in) op.in = renamed(op.in);
    }
  // 折上去试一遍：前提都在、没有环、假定写了出处、不超上限。比「这一批新添的毛病」时，原来那份也先照新名改过，改名本身不算新毛病
  const trial = applyIntentOps(intent, ops),
    base = renames.size ? applyIntentOps(intent, ops.filter(op => op.rename).map(op => ({ id: op.id, rename: op.rename }))) : intent;
  for (const op of ops)
    for (const need of op.needs || [])
      if (!Object.hasOwn(trial.nodes, need)) problems.push(`${op.id} 的前提 ${need} 不存在（新的前提与它同一批写上即可）`);
  for (const op of ops) {
    if (!op.remove || trial.nodes[op.id]) continue;
    const inside = Object.keys(trial.nodes).filter(k => trial.nodes[k].in === op.id);
    if (inside.length) problems.push(`撤 ${op.id} 前，里面的 ${inside.join("、")} 先撤或挪出（同一批写上即可）`);
  }
  const cycle = intentCycle(trial);
  if (cycle) problems.push(`前提成了环：${cycle.join(" → ")}`);
  // 嵌套的毛病只报这一批新添的：手编出的旧毛病不拦别的改动
  const nested = new Set(intentNestProblems(base));
  problems.push(...intentNestProblems(trial).filter(problem => !nested.has(problem)));
  const strays = new Set(intentStrays(base));
  for (const id of intentStrays(trial))
    if (!strays.has(id))
      problems.push(`${id} 孤悬在全局：既无前提，也没有谁以它为前提。手上的一步归进它所服务的模块（in），或写进它所撑那一项的 needs；本就是整件事要立的另一条结论，新立时标 root`);
  for (const id of ops.map(intentOpId))
    if (trial.nodes[id]?.state === "assumed" && !trial.nodes[id].note) problems.push(`${id} 标了假定，note 里写明借的是什么、出处在哪`);
  const live = Object.keys(trial.nodes).filter(id => !intentGone(trial, id)).length;
  if (live > INTENT_LIMIT && live > Object.keys(intent.nodes).filter(id => !intentGone(intent, id)).length)
    problems.push(`意里的项不宜多于 ${INTENT_LIMIT} 项（此刻 ${live}）：一项是值得单独判的结论，不是每一步动作；细的并进上一级`);
  return { ops, problems, tidied: [...tidied] };
}
/** 这一批里标成立、标假定的各项挂的凭据：写之前取一回指纹记下 @param {Intent} intent @param {IntentOp[]} ops */
function intentSealing(intent, ops) {
  const trial = applyIntentOps(intent, ops);
  return [...new Set(ops.filter(op => SEALED.has(op.state || "")).flatMap(op => trial.nodes[intentOpId(op)]?.anchors || []))];
}
/**
 * 把一批改动折上去，得一份新的（不动原来那份）。先改说法与结构，最后才给标成立的各项记凭据：同一批里前提改了说法，记的是改后的
 * @param {Intent} intent
 * @param {IntentOp[]} ops
 * @param {{ at?: string, conversation?: string, ask?: string, prints?: IntentPrints }} [context] ask：这一问用户的原话（立根、改根时记下）
 * @returns {Intent}
 */
function applyIntentOps(intent, ops, { at = "", conversation = "", ask = "", prints = {} } = {}) {
  /** @type {Intent} */
  const next = structuredClone(intent),
    log = text => next.log.push({ at, conversation, text });
  for (const op of ops) {
    if (op.remove) {
      if (!next.nodes[op.id]) continue;
      log(`撤 ${op.id}：${next.nodes[op.id].claim}`);
      delete next.nodes[op.id];
      for (const other of Object.values(next.nodes)) other.needs = other.needs.filter(k => k !== op.id);
      continue;
    }
    if (op.rename && next.nodes[op.id] && !next.nodes[op.rename]) {
      renameIntentNode(next, op.id, op.rename);
      log(`改名 ${op.id} → ${op.rename}`);
    }
    const id = op.rename && next.nodes[op.rename] ? op.rename : op.id;
    let node = next.nodes[id];
    if (!node) {
      if (!op.claim) continue;
      node = next.nodes[id] = { claim: "", check: "", needs: [], anchors: [], state: "open", rev: 0 };
      if (op.root) node.root = { ask: String(ask).slice(0, 2000), at };
    }
    const before = `${node.claim}\u0001${node.check}\u0001${node.when || ""}`;
    for (const key of /** @type {const} */ (["claim", "check", "when", "note"])) if (op[key] !== undefined) node[key] = op[key];
    if (op.any !== undefined) node.any = op.any;
    if (op.needs) node.needs = op.needs;
    if (op.in !== undefined && op.in !== (node.in || "")) {
      if (node.rev) log(`${id} 归入${op.in ? `「${op.in}」` : "全局"}`);
      if (op.in) node.in = op.in;
      else delete node.in;
    }
    if (op.anchors) {
      // 旧版凭据没有清单：改之前补上原清单，换了凭据也须重新复核。
      if (node.seal && !node.seal.anchors) node.seal.anchors = [...node.anchors];
      node.anchors = op.anchors;
    }
    if (`${node.claim}\u0001${node.check}\u0001${node.when || ""}` !== before) {
      // 根：立时标过、此刻也没有谁以它为前提的（降成别项前提的不再算根，原问留着，哪天又成了根再用）
      const rooted = !!node.root && !intentDependents(next, id).length;
      if (node.rev) log(`${rooted ? "改根" : "改意"} ${id}：${node.claim}`);
      // 根改了说法：记下这一问，与原问一起附着，收尾时照着比
      if (node.rev && rooted && ask) node.root.later = String(ask).slice(0, 2000);
      node.rev += 1;
    }
    if (op.state && op.state !== node.state) {
      if (op.state === "dropped" || op.state === "assumed")
        log(`${op.state === "dropped" ? "弃" : "假定"} ${id}${op.state === "assumed" && node.note ? `：${node.note}` : ""}`);
      if (node.state === "dropped") log(`复立 ${id}`);
    }
    if (op.state) node.state = op.state;
    if (!SEALED.has(node.state)) delete node.seal;
  }
  for (const op of ops) {
    const id = op.rename && next.nodes[op.rename] ? op.rename : op.id,
      node = next.nodes[id];
    if (op.remove || !SEALED.has(op.state || "") || !node) continue;
    // 取不到指纹的凭据（探针这回没跑）不记：日后也不据它判
    node.seal = {
      rev: node.rev,
      anchors: [...node.anchors],
      premises: op.state === "done" ? Object.fromEntries(liveNeeds(next, id).map(need => [need, next.nodes[need].rev])) : {},
      prints: Object.fromEntries(node.anchors.filter(key => key in prints).map(key => [key, prints[key]]))
    };
  }
  next.log = next.log.slice(-INTENT_LOG_LIMIT);
  if (at && ops.length) next.updated = at;
  return next;
}
// ---------- 写成给模型读的字：每一问附着的、改完回给它的，都经这里 ----------
const INTENT_STATE_TEXT = { open: "未做", doing: "进行中", done: "成立", assumed: "假定", dropped: "已弃", stale: "待复核" };
/** @param {Intent} intent @param {IntentPrints} [now] */
function intentTally(intent, now = {}) {
  const live = Object.keys(intent.nodes).filter(id => !intentGone(intent, id));
  return { live: live.length, standing: live.filter(id => intentEstablished(intent, id, now)).length };
}
/**
 * 根在前、前提在后；立住了的只留一行，没立住的写验收与缘由，没立住的根附上用户的原话。
 * 模块的细项缩进写在它底下；里面都立住了的模块只留一行，没立住的才展开——长活里看到的是整副骨架加手头那一块
 * @param {Intent} intent @param {IntentPrints} [now] @param {{ path?: string, asks?: boolean }} [options] asks：立住了的根也附原话（收尾前对照用）
 */
function intentText(intent, now = {}, { path = ".yan/意.json", asks = false } = {}) {
  const order = intentOrder(intent)
      .reverse()
      .filter(id => !intentGone(intent, id)),
    roots = new Set(intentRoots(intent)),
    strays = new Set(intentStrays(intent));
  if (!order.length) return "";
  const { live, standing } = intentTally(intent, now),
    dropped = Object.keys(intent.nodes).filter(id => intent.nodes[id].state === "dropped");
  /** @param {string} id @param {string} pad @returns {string[]} */
  const item = (id, pad) => {
    const node = intent.nodes[id],
      state = intentState(intent, id, now),
      established = intentEstablished(intent, id, now),
      tag = state === "done" && !established ? "成立·前提未立" : INTENT_STATE_TEXT[state],
      premises = writtenNeeds(intent, id),
      kids = intentChildren(intent, id),
      inside = kids.filter(k => intentEstablished(intent, k, now)).length,
      folded = kids.length && inside === kids.length,
      borrowed = roots.has(id) && established ? intentBorrowed(intent, id).filter(b => b !== id) : [],
      head = `${pad}- [${tag}] ${id}${strays.has(id) ? "（孤悬）" : roots.has(id) ? "（根）" : ""}${kids.length ? `（模块，${folded ? `内 ${kids.length} 项都已立` : `内已立 ${inside} / ${kids.length}`}）` : ""}：${node.claim}${node.when ? `（情形：${node.when}）` : ""}${premises.length ? `（前提：${premises.join("、")}${node.any ? "，任一即可" : ""}）` : ""}${borrowed.length ? `（借假定：${borrowed.join("、")}）` : ""}`;
    // 原问只随此刻的根附：立时标了根、后来成了别项前提的，不再附
    const said = roots.has(id) ? node.root : undefined,
      ask = [
        ...(said?.ask ? [`${pad}  原问：${said.ask.slice(0, asks ? 600 : 200)}`] : []),
        ...(said?.later ? [`${pad}  改根时：${said.later.slice(0, asks ? 600 : 200)}`] : [])
      ];
    const inner = folded ? [] : level(id, `${pad}  `);
    if (state === "assumed") return [head, `${pad}  出处：${node.note || ""}`, ...(asks ? ask : []), ...inner];
    if (established) return [head, ...(asks ? ask : []), ...inner];
    const more = [`${pad}  验收：${node.check}`];
    if (state === "stale") more.push(`${pad}  缘由：${intentStaleWhy(intent, id, now)}`);
    return [head, ...more, ...ask, ...inner];
  };
  /** @param {string} parent @param {string} pad */
  const level = (parent, pad) => order.filter(id => (intent.nodes[id].in || "") === parent).flatMap(id => item(id, pad));
  return `［意 ${path}］已立 ${standing} / ${live}${dropped.length ? `，已弃（走过不通的）：${dropped.join("、")}` : ""}\n${level("", "").join("\n")}`;
}
// ---------- 一答之内的回归：每轮工具做完重取指纹，新转待复核的当场告诉它；同一项来回被打回即相持，只提醒 ----------
// 相持：修甲坏乙、修乙坏甲，每一步单看都对，合起来原地打转——程序不拦（兼顾两头的修法可能就在下一步），只把次数与牵连摆出来
const INTENT_STALEMATE = 3;
/** 此刻待复核的各项 @param {Intent} intent @param {IntentPrints} now */
function intentStaleIds(intent, now) {
  return Object.keys(intent.nodes).filter(id => intentState(intent, id, now) === "stale");
}
/**
 * 这一轮之后新转待复核的几项，写成接在工具结果后的一段；没有即空
 * @param {Intent} intent @param {IntentPrints} now @param {string[]} fresh 这一轮新转待复核的 @param {Map<string, number>} bounces 这一答里各项被打回几回（已含这一轮）
 */
function intentRoundText(intent, now, fresh, bounces) {
  if (!fresh.length) return "";
  const lines = [`［意］此轮之后转待复核：${fresh.map(id => `${id}（${intentStaleWhy(intent, id, now)}）`).join("、")}`];
  for (const id of fresh) {
    const times = bounces.get(id) || 0;
    if (times < INTENT_STALEMATE) continue;
    const mine = intent.nodes[id].anchors,
      partners = Object.keys(intent.nodes)
        .filter(other => other !== id && bounces.get(other) && intent.nodes[other].anchors.some(key => mine.includes(key)))
        .map(other => {
          const shared = intent.nodes[other].anchors.filter(key => mine.includes(key));
          return `同依托 ${shared.slice(0, 3).map(anchorLabel).join("、")} 的 ${other} 被打回 ${bounces.get(other)} 回`;
        });
    lines.push(`相持：${id} 本答内第 ${times} 回转待复核${partners.length ? `；${partners.join("；")}` : ""}`);
  }
  return lines.join("\n");
}
