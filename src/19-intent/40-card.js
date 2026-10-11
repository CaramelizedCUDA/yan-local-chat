// 言 · 意 · 卡片（见 设计稿/55 甲 · 一张纸、56）：意属于任务，不画在对话里。改动条顶端那一行「意」、行迹里「意」那一步点开，
// 都在预览浮层里铺开这一张：题头（更新于何时、已立几项、借了几条假定），各根（根的说法只在这里改），一张图（前提在左、根在右，
// 摆法见 30-layout.js），图下「待察」——待复核的缘由、前提未立的、假定的出处；最末留痕。点图上一项，图下展开它的验收、凭据与缘由。
// 由程序照 .yan/意.json 画，与文件一字不差，不请模型另画；展开的因果（支撑、缘由、哪条凭据变了）也是程序从图与指纹推出的，不经模型。
// 单拿出来看的东西没跟上就像个错：题头写明更新于何时
/** @typedef {"holds"|"premised"|"stale"|"assumed"|"doing"|"open"|"dropped"} IntentView 画出来的状态：成立的再按前提分已立与前提未立 */
const INTENT_VIEW_TEXT = {
    holds: "已立",
    premised: "存疑 · 前提未立",
    stale: "待复核",
    assumed: "假定",
    doing: "在做",
    open: "未做",
    dropped: "已弃"
  },
  INTENT_CHECK_STROKE = [1.4, 6, 2.9, 7.6, 4.3, 9.3, 6.8, 5, 10.8, 1.4];
// 记号是符号，同一支笔写：已立一勾青绿，假定一勾泥金（算作已立，是借来的），存疑（自称成立而前提未立）一个泥金问号，
// 待复核一圈朱，已弃一个灰叉；在做一粒墨点，未做一粒淡点。朱只给待复核
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
  doing: () => brushDot(6, 5.6, 2.1, "ink"),
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
/** 图：前提在左、根在右 @param {Intent} intent @param {IntentPrints} now @param {string} selected */
function intentGraphSvg(intent, now, selected) {
  const roots = new Set(intentRoots(intent)),
    drawing = drawGraphLayout(
      Object.keys(intent.nodes).map(id => {
        const node = intent.nodes[id],
          state = intentView(intent, id, now);
        return {
          id,
          label: id,
          when: node.when,
          needs: node.needs,
          any: node.any,
          state,
          root: roots.has(id)
        };
      })
    );
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
        inner = "";
      if (node.when) {
        const width = graphMeasure(node.when, 10.5) + 10;
        inner += `<rect class="intent-chip" x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" width="${width.toFixed(1)}" height="16" rx="3"/><text class="intent-chip-t" x="${(cx + 5).toFixed(1)}" y="${(y + 3.6).toFixed(1)}">${escapeHtml(node.when)}</text>`;
        cx += width + 5;
      }
      inner += `<text class="intent-label" x="${cx.toFixed(1)}" y="${(y + 4).toFixed(1)}">${escapeHtml(node.label)}</text>`;
      cx += node.root
        ? graphMeasure(node.label, 13.5, 600, true)
        : graphMeasure(node.label, 12, node.state === "doing" || node.state === "stale" ? 600 : 400);
      if (more) {
        inner += `<text class="intent-more" x="${(cx + 5).toFixed(1)}" y="${(y + 4).toFixed(1)}">+${more}</text>`;
        cx += graphMeasure(`+${more}`, 10) + 5;
      }
      // 状态只凭记号，图上不另注字；悬停时写出来
      const claim = intent.nodes[id]?.claim || "",
        said = `${INTENT_VIEW_TEXT[node.state] || ""} · ${claim}`;
      return `<g class="intent-node${node.root ? " root" : ""}${id === selected ? " on" : ""}" data-intent-node="${escapeHtml(id)}" data-state="${escapeHtml(node.state)}" tabindex="0" role="button" aria-label="${escapeHtml(`${id}：${said}`)}"><title>${escapeHtml(said)}</title><rect class="intent-hit" x="${(x - 4).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="${(w + 8).toFixed(1)}" height="22" rx="3"/>${intentMark(node.state, x, y - 5.5)}${inner}</g>`;
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
/** 图下展开的一项 @param {Intent} intent @param {IntentPrints} now @param {string} id */
function intentDetailHtml(intent, now, id) {
  const node = intent.nodes[id];
  if (!node) return "";
  const view = intentView(intent, id, now),
    chips = ids =>
      ids.length
        ? `<span class="intent-chips">${ids.map(k => `<button type="button" data-intent-node="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join("")}</span>`
        : `<span class="intent-none">无</span>`,
    rows = [
      ["验收", escapeHtml(node.check)],
      ["前提", `${chips(node.needs)}${node.any && node.needs.length > 1 ? `<span class="intent-none">任一即可</span>` : ""}`],
      ["支撑", chips(intentDependents(intent, id))],
      ["凭据", intentAnchorsHtml(node, now)]
    ];
  if (view === "stale") rows.push(["缘由", escapeHtml(intentStaleWhy(intent, id, now)), "zhu"]);
  if (node.note) rows.push([node.state === "assumed" ? "出处" : "备注", escapeHtml(node.note), node.state === "assumed" ? "gold" : ""]);
  return `<div class="intent-detail"><div class="intent-detail-head">${intentMark(view)}<span class="intent-detail-id">${escapeHtml(id)}</span><span class="intent-detail-state" data-state="${view}">${INTENT_VIEW_TEXT[view]}</span></div><p class="intent-detail-claim">${node.when ? `<span class="intent-when">${escapeHtml(node.when)}</span>` : ""}${escapeHtml(node.claim)}</p><div class="intent-kv">${rows
    .map(([k, v, tone]) => `<span class="k${tone ? ` ${tone}` : ""}">${k}</span><span>${v}</span>`)
    .join("")}</div></div>`;
}
/** 要看的：只列有事的几项——待复核（缘由）、成立而前提未立（卡在哪）、假定（出处） @param {Intent} intent @param {IntentPrints} now */
function intentNotesHtml(intent, now) {
  const rows = [];
  for (const id of intentOrder(intent).reverse()) {
    const node = intent.nodes[id],
      view = intentView(intent, id, now);
    if (view === "stale") rows.push([view, id, intentStaleWhy(intent, id, now)]);
    else if (view === "premised") {
      const stuck = node.needs.filter(k => intent.nodes[k] && intent.nodes[k].state !== "dropped" && !intentEstablished(intent, k, now));
      rows.push([view, id, `前提${stuck.map(k => `「${k}」`).join("")}未立`, true]);
    } else if (view === "assumed") rows.push([view, id, `出处：${node.note || ""}`]);
  }
  if (!rows.length) return "";
  return `<div class="intent-sec">待察</div><ul class="intent-notes">${rows
    .map(
      ([view, id, why, quiet]) =>
        `<li>${intentMark(view)}<span><button type="button" class="intent-note-id" data-intent-node="${escapeHtml(id)}">${escapeHtml(id)}</button><span class="intent-note-why${quiet ? " quiet" : ""}">${escapeHtml(why)}</span></span></li>`
    )
    .join("")}</ul>`;
}
/**
 * 整张卡片
 * @param {Intent} intent @param {IntentPrints} now
 * @param {{ selected?: string, editing?: string, error?: string }} [options] editing：正改写说法的那个根
 */
function intentCardHtml(intent, now, { selected = "", editing = "", error = "" } = {}) {
  const live = Object.keys(intent.nodes).filter(id => intent.nodes[id].state !== "dropped");
  if (!live.length) return `<div class="intent-card"><div class="file-viewer-empty">此目录尚未立意</div></div>`;
  const { standing } = intentTally(intent, now),
    roots = intentRoots(intent),
    borrowed = [...new Set(roots.flatMap(id => intentBorrowed(intent, id)))].length;
  const rootHtml = roots
    .map(id => {
      const node = intent.nodes[id],
        edit = id === editing;
      return `<div class="intent-root" data-root="${escapeHtml(id)}"><div class="intent-root-line">${intentMark(intentView(intent, id, now))}${
        edit
          ? `<textarea class="intent-root-draft" rows="2" aria-label="根的说法">${escapeHtml(node.claim)}</textarea>`
          : `<span class="intent-root-claim">${escapeHtml(node.claim)}</span>`
      }${
        edit
          ? `<span class="intent-root-ops"><button type="button" class="intent-btn" data-intent-save="${escapeHtml(id)}">保存</button><button type="button" class="intent-btn quiet" data-intent-cancel>取消</button></span>`
          : `<button type="button" class="intent-edit" data-intent-edit="${escapeHtml(id)}" title="改写此根">${brushIcon("edit")}</button>`
      }</div>${edit && error ? `<p class="intent-error">${escapeHtml(error)}</p>` : ""}</div>`;
    })
    .join("");
  const log = intent.log.slice(-30).reverse();
  // 题头：左写更新于何时，右写计数（目录名已在预览浮层的标题栏里）。原问不上卡片，它是给模型对照用的
  return `<div class="intent-card"><div class="intent-head">${intent.updated ? `<span class="intent-updated">更新于 ${escapeHtml(intentTime(intent.updated))}</span>` : ""}<span class="intent-meta"><span>已立 <b>${standing}</b> / ${live.length}</span>${borrowed ? `<span class="intent-borrow">假定 ${borrowed}</span>` : ""}</span></div>${rootHtml}<div class="intent-graph">${intentGraphSvg(intent, now, selected)}</div>${
    selected ? intentDetailHtml(intent, now, selected) : ""
  }${intentNotesHtml(intent, now)}${
    log.length
      ? `<details class="intent-log"><summary>留痕 · ${intent.log.length}</summary><ul>${log
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
/** @type {{ conversation: Conversation, intent: Intent, now: IntentPrints, selected: string, editing: string, error: string }|null} */
let intentCard = null;
function paintIntentCard() {
  const stage = $("#fileViewerStage");
  if (!intentCard || !stage?.querySelector(".intent-card")) return;
  const { intent, now, selected, editing, error } = intentCard;
  stage.innerHTML = intentCardHtml(intent, now, { selected, editing, error });
  stage.querySelector(".intent-root-draft")?.focus();
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
  try {
    const { intent } = await readIntent(conversation),
      now = {
        ...(intents.get(conversation.id)?.now || {}),
        ...(await intentPrints(conversation, intentSealedAnchors(intent), undefined, "round"))
      };
    intentCard = { conversation, intent, now, selected: "", editing: "", error: "" };
    paintIntentCard();
  } catch (error) {
    const stage = $("#fileViewerStage");
    if (stage?.querySelector(".intent-card"))
      stage.innerHTML = `<div class="intent-card"><div class="file-viewer-empty">${escapeHtml(friendlyError(String(error.message || error)))}</div></div>`;
  }
}
// 根的说法只有用户能改：经桥接写回（带版本写，别处刚写过就照新的那份重来），改完这段对话往后附着的也是新的
async function saveIntentRoot(id, claim) {
  if (!intentCard) return;
  const { conversation } = intentCard,
    text = claim.trim();
  if (!text) {
    intentCard.error = "说法不可为空";
    return paintIntentCard();
  }
  try {
    const { next } = await changeIntent(conversation, undefined, async intent =>
      intent.nodes[id] ? { next: reviseIntentRoot(intent, id, text, { at: new Date().toISOString(), conversation: conversation.id }) } : {}
    );
    if (!next) throw Error(`意中已无「${id}」`);
    intentCard.intent = next;
    intentCard.editing = "";
    intentCard.error = "";
    keepIntent(conversation, next, intentCard.now);
  } catch (error) {
    intentCard.error = friendlyError(String(error.message || error));
  }
  paintIntentCard();
}
function bindIntentEvents() {
  // 改动条顶端那一行、行迹里「意」那一步：点开卡片
  $("#messages").addEventListener("click", event => {
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
    const pick = event.target.closest("[data-intent-node]"),
      edit = event.target.closest("[data-intent-edit]"),
      save = event.target.closest("[data-intent-save]");
    if (pick) {
      intentCard.selected = intentCard.selected === pick.dataset.intentNode && pick.matches("g") ? "" : pick.dataset.intentNode;
      return paintIntentCard();
    }
    if (edit) {
      intentCard.editing = edit.dataset.intentEdit;
      intentCard.error = "";
      return paintIntentCard();
    }
    if (save) return void saveIntentRoot(save.dataset.intentSave, stage.querySelector(".intent-root-draft")?.value || "");
    if (event.target.closest("[data-intent-cancel]")) {
      intentCard.editing = "";
      intentCard.error = "";
      paintIntentCard();
    }
  });
  stage.addEventListener("keydown", event => {
    if (!intentCard) return;
    const node = event.target.closest?.("g[data-intent-node]");
    if (node && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      intentCard.selected = intentCard.selected === node.dataset.intentNode ? "" : node.dataset.intentNode;
      paintIntentCard();
      stage.querySelector(`g[data-intent-node="${CSS.escape(node.dataset.intentNode)}"]`)?.focus();
    }
    if (event.target.matches?.(".intent-root-draft") && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void saveIntentRoot(intentCard.editing, event.target.value);
    }
  });
}
