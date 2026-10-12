// 言 · 意 · 卡片（见 设计稿/55 甲 · 一张纸、56、58 甲 · 疏排、60 二·甲 · 簿录）：意属于任务，不画在对话里。题下一行与书眉里那一枚（50-glance.js）、行迹里「意」那一步点开，
// 都在预览浮层里铺开这一张：题头（更新于何时、已立几项、借了几条假定），一张图（前提在左、根在右，摆法见 30-layout.js），
// 图下「待察」——待复核的缘由、前提未立的、假定的出处；再是「已弃」，走过不通的路不上图、收在这里；最末留痕。点图上一项（根也一样），图下展开它的说法、验收、凭据与缘由。
// 卡片只给看、不给改：要改的往往不是一两个字，直接告诉模型。
// 嵌套（设计稿/63 甲 · 钻入）：图只画一层。模块在图上带「里面已立几项 ›」；点它，展开处多一栏「内含」与「打开模块」；
// 打开后整张图换成模块里的，以模块自己收尾（最右那一项，淡些），顶上一行写所在（可点回上层）、右边写模块的前提与撑起什么。
// 由程序照 .yan/意.json 画，与文件一字不差，不请模型另画；展开的因果（支撑、缘由、哪条凭据变了）也是程序从图与指纹推出的，不经模型。
// 单拿出来看的东西没跟上就像个错：题头写明更新于何时
/** @typedef {"holds"|"premised"|"stale"|"assumed"|"doing"|"open"|"dropped"} IntentView 画出来的状态：成立的再按前提分已立与前提未立 */
const INTENT_VIEW_TEXT = {
    holds: "已立",
    premised: "存疑 · 前提未立",
    stale: "待复核",
    assumed: "假定",
    doing: "进行中",
    open: "未做",
    dropped: "已弃"
  },
  INTENT_CHECK_STROKE = [1.4, 6, 2.9, 7.6, 4.3, 9.3, 6.8, 5, 10.8, 1.4];
// 记号是符号，同一支笔写：已立一勾石绿，假定一勾泥金（算作已立，是借来的），存疑（自称成立而前提未立）一个泥金问号，
// 待复核一圈朱，已弃一个灰叉；进行中一圈泥金虚点围着一粒脉动的芯（与存疑同色：都是还没落定的；虚圈与待复核的实圈形就不同），未做一粒淡点。
// 朱只给待复核。图上的名字、展开处的题与记号同色，底下的小字不着色（见 82-intent.css 的 --st）
const INTENT_PENS = {
  holds: () => brushStroke(INTENT_CHECK_STROKE, 1.6, { tail: 0, head: 0.85, tone: "green" }),
  assumed: () => brushStroke(INTENT_CHECK_STROKE, 1.6, { tail: 0, head: 0.85, tone: "gold" }),
  premised: () =>
    brushArc(6, 3.9, 2.3, -170, 55, 1.15, { tone: "gold", tail: 0.2 }) +
    brushStroke([7.3, 5.8, 6.4, 6.6, 6.1, 7.6], 1.1, { tone: "gold", tail: 0.3 }) +
    brushDot(6.1, 9.5, 0.85, "gold"),
  stale: () => brushArc(6, 5.6, 3.4, -90, 266, 1.2, { tone: "zhu", tail: 0.15 }),
  dropped: () =>
    brushStroke([3, 2.6, 6, 5.6, 9, 8.6], 1.25, { tone: "ink2", tail: 0.2 }) +
    brushStroke([9, 2.6, 6, 5.6, 3, 8.6], 1.25, { tone: "ink2", tail: 0.2 }),
  doing: () =>
    Array.from({ length: 8 }, (_, i) =>
      brushDot(+(6 + 4.3 * Math.cos((i * Math.PI) / 4)).toFixed(2), +(5.6 + 4.3 * Math.sin((i * Math.PI) / 4)).toFixed(2), 0.62, "gold")
    ).join("") + `<circle class="gold intent-pulse" cx="6" cy="5.6" r="1.7"/>`,
  open: () => brushDot(6, 5.6, 1.4, "ink2")
};
/** @param {string} state @param {number} [x] @param {number} [y] 给了坐标即嵌进图里 */
const intentMark = (state, x, y) =>
  `<svg class="brush intent-mk" data-mark="${escapeHtml(state)}"${x === undefined ? "" : ` x="${x.toFixed(1)}" y="${y.toFixed(1)}"`} width="12" height="11" viewBox="0 0 12 11" aria-hidden="true">${(INTENT_PENS[state] || INTENT_PENS.open)()}</svg>`;
/** @param {Intent} intent @param {string} id @param {IntentPrints} now @returns {IntentView} */
function intentView(intent, id, now) {
  const state = intentState(intent, id, now);
  return state === "done" ? (intentEstablished(intent, id, now) ? "holds" : "premised") : state;
}
/** 模块里已立几项 @param {Intent} intent @param {IntentPrints} now @param {string} id @returns {string} 不是模块即空 */
function intentInside(intent, now, id) {
  const kids = intentChildren(intent, id);
  return kids.length ? `${kids.filter(k => intentEstablished(intent, k, now)).length}/${kids.length}` : "";
}
/** 所在：「全局」或一层层的模块名 @param {Intent} intent @param {string} id */
const intentWhere = (intent, id) => intentAncestors(intent, id).reverse().join(" › ") || "全局";
/**
 * 图：前提在左、根在右。只画一层：全局，或某个模块里的（模块自己作收尾那一项）
 * @param {Intent} intent @param {IntentPrints} now @param {string} selected @param {string} [level] 模块的 id；空即全局
 */
function intentGraphSvg(intent, now, selected, level = "") {
  // 弃了的不上图（列在图下「已弃」）；孤悬的不当根画
  const strays = new Set(intentStrays(intent)),
    roots = new Set(intentRoots(intent).filter(id => !strays.has(id))),
    ids = Object.keys(intent.nodes).filter(id => (intent.nodes[id].in || "") === level && !intentGone(intent, id)),
    drawing = drawGraphLayout([
      ...ids.map(id => {
        const node = intent.nodes[id],
          inside = intentInside(intent, now, id);
        return {
          id,
          label: id,
          needs: node.needs,
          any: node.any,
          state: intentView(intent, id, now),
          root: roots.has(id),
          ...(inside ? { tag: `${inside} ›` } : {})
        };
      }),
      ...(level && intent.nodes[level]
        ? [{ id: level, label: level, needs: intentTops(intent, level), state: intentView(intent, level, now), root: true }]
        : [])
    ]);
  if (!drawing.nodes.length) return "";
  const kind = state =>
    state === "holds" || state === "knot"
      ? " solid"
      : state === "assumed"
        ? " borrow"
        : state === "stale"
          ? " broken"
          : state === "dropped"
            ? " gone"
            : "";
  const edges = drawing.edges.map(e => `<path class="intent-edge${kind(e.state)}" d="${e.d}"/>`).join(""),
    knots = drawing.knots
      .map(k =>
        k.any
          ? `<circle class="intent-knot" cx="${k.x.toFixed(1)}" cy="${k.y.toFixed(1)}" r="6"/><text class="intent-or" x="${k.x.toFixed(1)}" y="${(k.y + 3.3).toFixed(1)}" text-anchor="middle">或</text>`
          : `<circle class="intent-knot-dot" cx="${k.x.toFixed(1)}" cy="${k.y.toFixed(1)}" r="1.8"/>`
      )
      .join("");
  const nodes = drawing.nodes
    .map(({ id, x, y, w, node, more }) => {
      let cx = x + GRAPH_DRAW.mark,
        inner = `<text class="intent-label" x="${cx.toFixed(1)}" y="${(y + 4).toFixed(1)}">${escapeHtml(node.label)}</text>`;
      cx += node.root
        ? graphMeasure(node.label, 13.5, 600, true)
        : graphMeasure(node.label, 12, node.state === "doing" || node.state === "stale" ? 600 : 400);
      if (more) {
        inner += `<text class="intent-more" x="${(cx + 5).toFixed(1)}" y="${(y + 4).toFixed(1)}">+${more}</text>`;
        cx += graphMeasure(`+${more}`, 10) + 5;
      }
      if (node.tag)
        inner += `<text class="intent-more" x="${(cx + 6).toFixed(1)}" y="${(y + 4).toFixed(1)}">${escapeHtml(node.tag)}</text>`;
      // 状态只凭记号、情形不画小格，图上不另注字；悬停时写出来
      const { claim = "", when = "" } = intent.nodes[id] || {},
        said = `${INTENT_VIEW_TEXT[node.state] || ""} · ${when ? `${when}：` : ""}${claim}`;
      return `<g class="intent-node${node.root ? " root" : ""}${id === level ? " sink" : ""}${id === selected ? " on" : ""}" data-intent-node="${escapeHtml(id)}" data-state="${escapeHtml(node.state)}" tabindex="0" role="button" aria-label="${escapeHtml(`${id}：${said}`)}"><title>${escapeHtml(said)}</title><rect class="intent-hit" x="${(x - 4).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="${(w + 8).toFixed(1)}" height="22" rx="3"/>${intentMark(node.state, x, y - 5.5)}${inner}</g>`;
    })
    .join("");
  return `<svg class="intent-svg" width="${drawing.width}" height="${drawing.height}" viewBox="0 0 ${drawing.width} ${drawing.height}" role="img" aria-label="意的结构图">${edges}${knots}${nodes}</svg>`;
}
/** 一条凭据：种类、值；标成立（或假定）后变了的标朱 @param {IntentNode} node @param {IntentPrints} now */
function intentAnchorsHtml(node, now) {
  if (!node.anchors.length) return `<span class="intent-none">无</span>`;
  return `<span class="intent-anchors">${node.anchors
    .map(key => {
      const [kind] = anchorParts(key),
        changed = !!node.seal && key in node.seal.prints && key in now && now[key] !== node.seal.prints[key];
      return `<span class="intent-anchor${changed ? " changed" : ""}" title="${escapeHtml(key)}"><em>${{ file: "文件", dir: "目录", cmd: "探针" }[kind] || kind}</em>${escapeHtml(anchorLabel(key).replace(/^探针「([\s\S]*)」$/, "$1"))}</span>`;
    })
    .join("")}</span>`;
}
/** 图下展开的一项 @param {Intent} intent @param {IntentPrints} now @param {string} id @param {string} [level] 眼前这一层 */
function intentDetailHtml(intent, now, id, level = "") {
  const node = intent.nodes[id];
  if (!node) return "";
  const view = intentView(intent, id, now),
    // 前提、支撑写成带记号的名字，一眼看出连着的各项立没立住
    chips = ids =>
      ids.length
        ? `<span class="intent-links">${ids
            .map(
              k =>
                `<button type="button" class="intent-link" data-intent-node="${escapeHtml(k)}" data-state="${intent.nodes[k] ? intentView(intent, k, now) : "open"}">${intent.nodes[k] ? intentMark(intentView(intent, k, now)) : ""}${escapeHtml(k)}</button>`
            )
            .join("")}</span>`
        : `<span class="intent-none">无</span>`,
    // 键名在上、值在下，两栏：验收与备注占满一行，前提与支撑、凭据与缘由各并一行
    rows = [
      ["验收", escapeHtml(node.check), "", true],
      ["前提", `${chips(node.needs)}${node.any && node.needs.length > 1 ? `<span class="intent-none">任一即可</span>` : ""}`],
      ["支撑", chips(intentDependents(intent, id))],
      ["凭据", intentAnchorsHtml(node, now)]
    ];
  if (view === "stale") rows.push(["缘由", escapeHtml(intentStaleWhy(intent, id, now)), "zhu"]);
  if (node.note)
    rows.push([node.state === "assumed" ? "出处" : "备注", escapeHtml(node.note), node.state === "assumed" ? "gold" : "", true]);
  const kids = intentChildren(intent, id);
  if (kids.length)
    rows.push([
      "内含",
      `${chips(kids)}${id === level ? "" : `<button type="button" class="intent-enter" data-intent-level="${escapeHtml(id)}">打开模块 →</button>`}`,
      "",
      true
    ]);
  return `<div class="intent-detail" data-state="${view}"><div class="intent-detail-head">${intentMark(view)}<span class="intent-detail-id">${escapeHtml(id)}</span><span class="intent-detail-state" data-state="${view}">${INTENT_VIEW_TEXT[view]}</span></div><p class="intent-detail-claim"><span class="intent-when">${escapeHtml(intentWhere(intent, id))}</span>${escapeHtml(node.claim)}</p><div class="intent-fields">${rows
    .map(
      ([k, v, tone, wide]) =>
        `<div class="intent-field${wide ? " w" : ""}"><span class="k${tone ? ` ${tone}` : ""}">${k}</span><div class="v">${v}</div></div>`
    )
    .join("")}</div></div>`;
}
/** 要看的：只列有事的几项——待复核（缘由）、成立而前提未立（卡在哪）、假定（出处） @param {Intent} intent @param {IntentPrints} now */
function intentNotesHtml(intent, now) {
  const rows = [];
  for (const id of intentOrder(intent).reverse()) {
    if (intentGone(intent, id)) continue;
    const node = intent.nodes[id],
      view = intentView(intent, id, now);
    if (view === "stale") rows.push([view, id, intentStaleWhy(intent, id, now)]);
    else if (view === "premised") {
      const stuck = liveNeeds(intent, id).filter(k => !intentEstablished(intent, k, now));
      rows.push([view, id, `前提${stuck.map(k => `「${k}」`).join("")}未立`, true]);
    } else if (view === "assumed") rows.push([view, id, `出处：${node.note || ""}`]);
  }
  if (!rows.length) return "";
  return `<div class="intent-sec">待察 <span class="n">${rows.length}</span></div><ul class="intent-notes">${rows
    .map(
      ([view, id, why, quiet]) =>
        `<li data-state="${view}">${intentMark(view)}<span><button type="button" class="intent-note-id" data-intent-node="${escapeHtml(id)}">${escapeHtml(id)}</button><span class="intent-note-why${quiet ? " quiet" : ""}">${escapeHtml(why)}</span></span></li>`
    )
    .join("")}</ul>`;
}
/** 已弃：主线上走过、不通的路，收着作记号——名与弃时写的缘由（没写即那句说法），点名即展开 @param {Intent} intent */
function intentDroppedHtml(intent) {
  const ids = intentOrder(intent)
    .reverse()
    .filter(id => intent.nodes[id].state === "dropped");
  if (!ids.length) return "";
  return `<details class="intent-log intent-drop"><summary>已弃 <span class="n">${ids.length}</span></summary><ul class="intent-notes">${ids
    .map(id => {
      const { note = "", claim } = intent.nodes[id];
      return `<li data-state="dropped">${intentMark("dropped")}<span><button type="button" class="intent-note-id" data-intent-node="${escapeHtml(id)}">${escapeHtml(id)}</button><span class="intent-note-why quiet">${escapeHtml(note || claim)}</span></span></li>`;
    })
    .join("")}</ul></details>`;
}
/** 模块里那一层的顶上一行：所在（上层可点回），模块的前提与撑起什么 @param {Intent} intent @param {IntentPrints} now @param {string} level */
function intentCrumbHtml(intent, now, level) {
  if (!level || !intent.nodes[level]) return "";
  const path = ["", ...intentAncestors(intent, level).reverse()],
    link = k =>
      `<button type="button" class="intent-link" data-intent-node="${escapeHtml(k)}" data-state="${intentView(intent, k, now)}">${intentMark(intentView(intent, k, now))}${escapeHtml(k)}</button>`,
    needs = writtenNeeds(intent, level),
    up = intentDependents(intent, level);
  return `<div class="intent-crumb"><span class="intent-crumb-path">${path
    .map(k => `<button type="button" data-intent-level="${escapeHtml(k)}">${escapeHtml(k || "全局")}</button><i>›</i>`)
    .join(
      ""
    )}<b>${escapeHtml(level)}</b></span><span class="intent-crumb-ctx">${needs.length ? `<span>前提</span>${needs.map(link).join("")}` : ""}${
    up.length ? `<span>撑起</span>${up.map(link).join("")}` : ""
  }</span></div>`;
}
/** 整张卡片 @param {Intent} intent @param {IntentPrints} now @param {{ selected?: string, level?: string }} [options] level：眼前是哪个模块里的一层 */
function intentCardHtml(intent, now, { selected = "", level = "" } = {}) {
  const live = Object.keys(intent.nodes).filter(id => !intentGone(intent, id));
  if (!live.length) return `<div class="intent-card"><div class="file-viewer-empty">此目录尚未立意</div></div>`;
  const { standing } = intentTally(intent, now),
    borrowed = [...new Set(intentRoots(intent).flatMap(id => intentBorrowed(intent, id)))].length;
  const log = intent.log.slice(-30).reverse();
  // 题头：左写更新于何时，右写计数（目录名已在预览浮层的标题栏里）。原问不上卡片，它是给模型对照用的
  return `<div class="intent-card"><div class="intent-head">${intent.updated ? `<span class="intent-updated">更新于 ${escapeHtml(intentTime(intent.updated))}</span>` : ""}<span class="intent-meta"><span>已立 <b>${standing}</b> / ${live.length}</span>${borrowed ? `<span class="intent-borrow">假定 ${borrowed}</span>` : ""}</span></div>${intentCrumbHtml(intent, now, level)}<div class="intent-graph">${intentGraphSvg(intent, now, selected, level)}</div>${
    selected ? intentDetailHtml(intent, now, selected, level) : ""
  }${intentNotesHtml(intent, now)}${intentDroppedHtml(intent)}${
    log.length
      ? `<details class="intent-log"><summary>留痕 <span class="n">${intent.log.length}</span></summary><ul>${log
          .map(entry => `<li><time>${escapeHtml(intentTime(entry.at))}</time><span>${escapeHtml(entry.text)}</span></li>`)
          .join("")}</ul></details>`
      : ""
  }</div>`;
}
/** 本地时刻「10-11 16:41」；不是今年的带上年份 @param {string|undefined} at ISO */
function intentTime(at) {
  const date = new Date(String(at || ""));
  if (Number.isNaN(date.getTime())) return "";
  const pad = n => String(n).padStart(2, "0"),
    day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.getFullYear() === new Date().getFullYear() ? day : `${date.getFullYear()}-${day}`;
}
// ---------- 打开与交互：读文件、取指纹（文件与目录现取；探针用这一答开工时取的，不为看一眼去跑指令）----------
/** @type {{ conversation: Conversation, intent: Intent, now: IntentPrints, selected: string, level: string, painted?: string, revision: number }|null} */
let intentCard = null;
function paintIntentCard() {
  const stage = $("#fileViewerStage");
  if (!intentCard || intentCard.revision !== viewerRevision || !stage?.querySelector(".intent-card")) return;
  const { intent, now, selected, level } = intentCard,
    // 图比卡片宽时横滚：同一层重画（点了一项）留在原处；头一回画、换了一层，滚到正做着的、待复核的那一项，没有就靠右见根
    before = intentCard.painted === level ? stage.querySelector(".intent-graph:not(:empty)")?.scrollLeft : undefined;
  intentCard.painted = level;
  stage.innerHTML = intentCardHtml(intent, now, { selected, level });
  const graph = stage.querySelector(".intent-graph");
  if (!graph || graph.scrollWidth <= graph.clientWidth) return;
  if (before !== undefined) return void (graph.scrollLeft = before);
  const busy = graph.querySelector('g[data-state="doing"], g[data-state="stale"]');
  if (!busy) return void (graph.scrollLeft = graph.scrollWidth);
  // 图宽过卡片时从左起画、一单位一像素，图里的坐标即滚动的位置（浮层还在展开动画里也不受影响）
  const box = /** @type {SVGGraphicsElement} */ (busy).getBBox();
  graph.scrollLeft = box.x + box.width / 2 - graph.clientWidth / 2;
}
/** @param {Conversation} conversation */
function workdirName(conversation) {
  const root = String(workRoot(conversation) || "").replace(/[\\/]+$/, "");
  return root.split(/[\\/]/).pop() || root;
}
/** @param {Conversation|null} conversation @param {Element|null} [trigger] */
async function openIntentCard(conversation, trigger = null) {
  if (!conversation || !isWork(conversation)) return;
  showInFileViewer(
    `意 · ${workdirName(conversation)}`,
    `<div class="intent-card"><div class="file-viewer-empty">正在取出…</div></div>`,
    trigger
  );
  const revision = viewerRevision;
  intentCard = null;
  try {
    const { intent } = await readIntent(conversation),
      now = {
        ...(intents.get(conversation.id)?.now || {}),
        ...(await intentPrints(conversation, intentSealedAnchors(intent), undefined, "round"))
      };
    if (revision !== viewerRevision) return;
    noteIntentGlance(conversation, intent, now);
    intentCard = { conversation, intent, now, selected: "", level: "", revision };
    paintIntentCard();
  } catch (error) {
    if (revision !== viewerRevision) return;
    const stage = $("#fileViewerStage");
    if (stage?.querySelector(".intent-card"))
      stage.innerHTML = `<div class="intent-card"><div class="file-viewer-empty">${escapeHtml(friendlyError(String(error.message || error)))}</div></div>`;
  }
}
/** 点中一项：图上再点一下收起；别层的（前提、支撑、内含、待察里点的）跳到它那一层 @param {string} id @param {boolean} onGraph */
function pickIntentNode(id, onGraph) {
  if (!intentCard?.intent.nodes[id]) return;
  if (onGraph && intentCard.selected === id) intentCard.selected = "";
  else {
    if (id !== intentCard.level) intentCard.level = intentCard.intent.nodes[id].in || "";
    intentCard.selected = id;
  }
  paintIntentCard();
}
function bindIntentEvents() {
  // 题下一行与书眉里那一枚、行迹里「意」那一步：点开卡片
  for (const area of [$("#messages"), $("#chatMeta"), $("#runningHead")])
    area.addEventListener("click", event => {
      const open = event.target.closest("[data-intent-open]");
      if (open) void openIntentCard(currentConversation(), open);
    });
  $("#messages").addEventListener("keydown", event => {
    const open = event.target.closest?.("div[data-intent-open]");
    if (!open || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    void openIntentCard(currentConversation(), open);
  });
  const stage = $("#fileViewerStage");
  stage.addEventListener("click", event => {
    if (!intentCard || !stage.querySelector(".intent-card")) return;
    const into = event.target.closest("[data-intent-level]"),
      pick = event.target.closest("[data-intent-node]");
    if (into) {
      intentCard.level = into.dataset.intentLevel;
      intentCard.selected = "";
      return paintIntentCard();
    }
    if (pick) pickIntentNode(pick.dataset.intentNode, pick.matches("g"));
  });
  stage.addEventListener("keydown", event => {
    if (!intentCard) return;
    const node = event.target.closest?.("g[data-intent-node]");
    if (node && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      pickIntentNode(node.dataset.intentNode, true);
      stage.querySelector(`g[data-intent-node="${CSS.escape(node.dataset.intentNode)}"]`)?.focus();
    }
  });
}
