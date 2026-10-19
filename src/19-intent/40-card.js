// 言 · 意 · 卡片（见 设计稿/55 甲 · 一张纸、58 甲、63 甲 · 钻入、65 二 · 照言已有的语汇、66 · 簿录与墨痕）：意属于任务，不画在对话里。
// 题下一行与书眉里那一枚（50-glance.js）、行迹里「意」那一步点开，都在预览浮层里铺开这一张，顶栏的印换成石青「意」。
// 起首是页头（与卷宗、分组、设置各栏同一个样子）：目录名、一行事实（进度、借了几条假定、更新于何时），右端一个「墨痕」作动作，下压墨线。
// 其下一张图（前提在左、根在右，摆法见 30-layout.js），图下是这一层的簿录：根在先、余者随图自右而左、自上而下，一项一行——记号、名、进度、说法；
// 有事的那几项说法换成事由（待复核的缘由、前提未立的卡在哪、假定的出处），不另立「待察」。点一行或图上点名，那一行就地摊开成一张笺（验收、前提支撑、凭据……），再点收起。
// 墨痕（原「留痕」：改意、弃、撤、归入的记录）只为查考，平时只是页头一个字；点开图下换成墨痕。弃了的不上图，就记在墨痕里（带灰叉、写弃时的缘由），不再单立一节。
// 卡片只给看、不给改：要改的往往不是一两个字，直接告诉模型。
// 嵌套：图只画一层。模块在图上与簿录里带「里面已立几项 ›」，点它即进模块：整张图换成模块里的，以模块自己收尾（最右那一项，淡些），
// 页头下一行写所在（可点回上层）；模块的前提与撑起什么点开它那一项即见，不在这行另列。
// 由程序照 .yan/意.json 画，与文件一字不差，不请模型另画；展开的因果（支撑、缘由、哪条凭据变了）也是程序从图与指纹推出的，不经模型。
/** @typedef {"holds"|"premised"|"stale"|"assumed"|"doing"|"waiting"|"open"|"dropped"|"kept"} IntentView 画出来的状态：成立的再按前提分已立与前提未立；kept：守，没出事 */
const INTENT_VIEW_TEXT = {
    holds: t("已立"),
    premised: t("存疑 · 前提未立"),
    stale: t("待复核"),
    assumed: t("假定"),
    doing: t("进行中"),
    waiting: t("待定"),
    open: t("未做"),
    dropped: t("已弃"),
    kept: ""
  },
  INTENT_CHECK_STROKE = [1.4, 6, 2.9, 7.6, 4.3, 9.3, 6.8, 5, 10.8, 1.4];
// 记号是符号，同一支笔写：已立一勾石绿，假定一勾泥金（算作已立，是借来的），存疑（自称成立而前提未立）一个泥金问号，
// 待复核一圈朱，已弃一个灰叉；进行中一圈泥金虚点围着一粒脉动的芯（与存疑同色：都是还没落定的；虚圈与待复核的实圈形就不同），未做一粒淡点；
// 待定两笔正墨竖（停着，等人拍板）：一家里只它是正墨，不靠颜色也认得（设计稿/72 甲；落选：泥金与进行中糊作一片，空方原大像缺字，沙漏笔画重，差一笔的淡影看不见）。
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
  waiting: () =>
    brushStroke([4.1, 2.3, 4.25, 5.6, 4.1, 8.9], 1.35, { tone: "ink", tail: 0.3 }) +
    brushStroke([7.9, 2.3, 8.05, 5.6, 7.9, 8.9], 1.35, { tone: "ink", tail: 0.3 }),
  open: () => brushDot(6, 5.6, 1.4, "ink2"),
  // 守是常驻的约束，有就行、无所谓成没成：不画记号，只在测试不过、凭据变了时画朱圈
  kept: () => ""
};
/** @param {string} state @param {number} [x] @param {number} [y] 给了坐标即嵌进图里 */
const intentMark = (state, x, y) =>
  `<svg class="brush intent-mk" data-mark="${escapeHtml(state)}"${x === undefined ? "" : ` x="${x.toFixed(1)}" y="${y.toFixed(1)}"`} width="12" height="11" viewBox="0 0 12 11" aria-hidden="true">${(INTENT_PENS[state] || INTENT_PENS.open)()}</svg>`;
/** @param {Intent} intent @param {string} id @param {IntentPrints} now @returns {IntentView} */
function intentView(intent, id, now) {
  const state = intentState(intent, id, now);
  if (intent.nodes[id].keep) return state === "stale" ? "stale" : "kept";
  return state === "done" ? (intentEstablished(intent, id, now) ? "holds" : "premised") : state;
}
/** 模块里已立几项 @param {Intent} intent @param {IntentPrints} now @param {string} id @returns {string} 不是模块即空 */
function intentInside(intent, now, id) {
  const kids = intentChildren(intent, id);
  return kids.length ? `${kids.filter(k => intentEstablished(intent, k, now)).length}/${kids.length}` : "";
}
/** 所在：「全局」或一层层的模块名 @param {Intent} intent @param {string} id */
const intentWhere = (intent, id) => intentAncestors(intent, id).reverse().join(" › ") || t("全局");
/**
 * 一层图上的线：前提可跨模块，画一层时把这一层以下各项的前提都提到这一层——两头各取它在这一层的那一项（自己，或它所在的模块）。
 * 两头落在同一项的是那一项里面的事，这一层不画；提上来的（不是这两项直连的）画淡些；前提在这一层之外的，画成左侧一个淡影
 * @param {Intent} intent @param {string} level
 * @returns {{ needs: Record<string, string[]>, soft: Record<string, string[]>, ghosts: string[] }}
 */
function intentLevelEdges(intent, level) {
  const at = id => [id, ...intentAncestors(intent, id)].find(k => (intent.nodes[k].in || "") === level && !intent.nodes[k].keep),
    /** @type {Record<string, Set<string>>} */ direct = {},
    /** @type {Record<string, Set<string>>} */ lifted = {},
    ghosts = new Set();
  for (const id of Object.keys(intent.nodes)) {
    const to = intentGone(intent, id) ? undefined : at(id);
    if (!to) continue;
    for (const need of writtenNeeds(intent, id)) {
      if (need === level) continue;
      const from = at(need) || need;
      if (from === to) continue;
      if (from === need && !at(need)) ghosts.add(need);
      ((id === to && need === from ? direct : lifted)[to] ||= new Set()).add(from);
    }
  }
  const ids = Object.keys(intent.nodes).filter(id => at(id) === id);
  return {
    needs: Object.fromEntries(ids.map(id => [id, [...new Set([...(direct[id] || []), ...(lifted[id] || [])])]])),
    soft: Object.fromEntries(ids.map(id => [id, [...(lifted[id] || [])].filter(k => !direct[id]?.has(k))])),
    ghosts: [...ghosts]
  };
}
/**
 * 图：前提在左、根在右。只画一层：全局，或某个模块里的（模块自己作收尾那一项）
 * @param {Intent} intent @param {IntentPrints} now @param {string} selected @param {string} [level] 模块的 id；空即全局
 * @returns {{ svg: string, order: string[] }} order：簿录的次序——根在先，余者随图自右而左、自上而下
 */
function intentGraphSvg(intent, now, selected, level = "") {
  // 弃了的不上图（列在图下「已弃」）；孤悬的不当根画
  const strays = new Set(intentStrays(intent)),
    roots = new Set(intentRoots(intent).filter(id => !strays.has(id))),
    ids = Object.keys(intent.nodes).filter(
      id => !intent.nodes[id].keep && (intent.nodes[id].in || "") === level && !intentGone(intent, id)
    ),
    { needs, soft, ghosts } = intentLevelEdges(intent, level),
    drawing = drawGraphLayout([
      ...ids.map(id => {
        const node = intent.nodes[id],
          inside = intentInside(intent, now, id);
        return {
          id,
          label: id,
          needs: needs[id],
          soft: soft[id],
          any: node.any,
          state: intentView(intent, id, now),
          root: roots.has(id),
          ...(inside ? { tag: `${inside} ›` } : {})
        };
      }),
      ...(level && intent.nodes[level]
        ? [{ id: level, label: level, needs: intentTops(intent, level), state: intentView(intent, level, now), root: true }]
        : []),
      // 这一层之外的前提：淡影，名后小字写它在哪；点它跳到它那一层
      ...ghosts.map(id => ({ id, label: id, needs: [], state: intentView(intent, id, now), ghost: intentWhere(intent, id) }))
    ]);
  if (!drawing.nodes.length) return { svg: "", order: [] };
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
  const edges = drawing.edges.map(e => `<path class="intent-edge${kind(e.state)}${e.soft ? " soft" : ""}" d="${e.d}"/>`).join(""),
    knots = drawing.knots
      .map(k =>
        k.any
          ? `<circle class="intent-knot" cx="${k.x.toFixed(1)}" cy="${k.y.toFixed(1)}" r="6"/><text class="intent-or" x="${k.x.toFixed(1)}" y="${(k.y + 3.3).toFixed(1)}" text-anchor="middle">${t(`或`)}</text>`
          : `<circle class="intent-knot-dot" cx="${k.x.toFixed(1)}" cy="${k.y.toFixed(1)}" r="1.8"/>`
      )
      .join("");
  const nodes = drawing.nodes
    .map(({ id, x, y, w, node }) => {
      let cx = x + GRAPH_DRAW.mark,
        inner = `<text class="intent-label" x="${cx.toFixed(1)}" y="${(y + 4).toFixed(1)}">${escapeHtml(node.label)}</text>`;
      cx += node.root
        ? graphMeasure(node.label, 13.5, 600, true)
        : graphMeasure(node.label, 12, node.state === "doing" || node.state === "stale" ? 600 : 400, true);
      // 模块的进度可点：点了进模块（点名仍是选中）
      if (node.tag)
        inner += `<text class="intent-more intent-go" data-intent-level="${escapeHtml(id)}" x="${(cx + 6).toFixed(1)}" y="${(y + 4).toFixed(1)}"><title>${t(`打开模块`)}</title>${escapeHtml(node.tag)}</text>`;
      if (node.ghost)
        inner += `<text class="intent-more" x="${(cx + 6).toFixed(1)}" y="${(y + 4).toFixed(1)}">${escapeHtml(node.ghost)}</text>`;
      // 状态只凭记号、情形不画小格，图上不另注字；悬停时写出来
      const { claim = "", when = "" } = intent.nodes[id] || {},
        said = `${INTENT_VIEW_TEXT[node.state] || ""} · ${when ? `${when}：` : ""}${claim}`;
      return `<g class="intent-node${node.root ? " root" : ""}${id === level ? " sink" : ""}${node.ghost ? " ghost" : ""}${id === selected ? " on" : ""}" data-intent-node="${escapeHtml(id)}" data-state="${escapeHtml(node.state)}" tabindex="0" role="button" aria-label="${escapeHtml(`${id}：${said}`)}"><title>${escapeHtml(said)}</title><rect class="intent-hit" x="${(x - 4).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="${(w + 8).toFixed(1)}" height="22" rx="3"/>${intentMark(node.state, x, y - 5.5)}${inner}</g>`;
    })
    .join("");
  // 淡影是别层的，不进这一层的簿录
  const order = [...drawing.nodes.filter(n => !n.node.ghost)]
    .sort((a, b) => +!!b.node.root - +!!a.node.root || b.x - a.x || a.y - b.y)
    .map(n => n.id);
  return {
    svg: `<svg class="intent-svg" width="${drawing.width}" height="${drawing.height}" viewBox="0 0 ${drawing.width} ${drawing.height}" role="img" aria-label="${t(`意的结构图`)}">${edges}${knots}${nodes}</svg>`,
    order
  };
}
/** 一条凭据：种类、值；标成立（或假定）后变了的标朱 @param {IntentNode} node @param {IntentPrints} now */
function intentAnchorsHtml(node, now) {
  if (!node.anchors.length) return `<span class="intent-none">${t(`无`)}</span>`;
  return `<span class="intent-anchors">${node.anchors
    .map(key => {
      const [kind] = anchorParts(key),
        changed = !!node.seal && key in node.seal.prints && key in now && now[key] !== node.seal.prints[key];
      return `<span class="intent-anchor${changed ? " changed" : ""}" title="${escapeHtml(key)}"><em>${{ file: t("文件"), dir: t("目录"), cmd: t("探针"), test: t("测试") }[kind] || kind}</em>${escapeHtml(anchorLabel(key).replace(/^(?:探针|测试)「([\s\S]*)」$/, "$1"))}</span>`;
    })
    .join("")}</span>`;
}
/** 图下展开的一项 @param {Intent} intent @param {IntentPrints} now @param {string} id */
function intentDetailHtml(intent, now, id) {
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
        : `<span class="intent-none">${t(`无`)}</span>`,
    // 键名在上、值在下，两栏：验收与备注占满一行，前提与支撑、凭据与缘由各并一行
    rows = [
      [t("验收"), escapeHtml(node.check), "", true],
      // 守不挂前提也不作前提，这两栏不列
      ...(node.keep
        ? []
        : [
            [
              t("前提"),
              `${chips(node.needs)}${node.any && node.needs.length > 1 ? `<span class="intent-none">${t(`任一即可`)}</span>` : ""}`
            ],
            [t("支撑"), chips(intentDependents(intent, id))]
          ]),
      [t("凭据"), intentAnchorsHtml(node, now), "", !!node.keep]
    ];
  if (node.when) rows.push([t("情形"), escapeHtml(node.when), "", true]);
  if (view === "stale") rows.push([t("缘由"), escapeHtml(intentStaleWhy(intent, id, now)), "zhu"]);
  if (node.note)
    rows.push([
      { assumed: t("出处"), waiting: t("待定") }[node.state] || t("备注"),
      escapeHtml(node.note),
      node.state === "assumed" ? "gold" : "",
      true
    ]);
  const kids = intentChildren(intent, id);
  if (kids.length) rows.push([t("内含"), chips(kids), "", true]);
  return `<div class="intent-detail" data-state="${view}"><div class="intent-detail-head" data-intent-node="${escapeHtml(id)}" role="button" tabindex="0" title="${t(`收起`)}">${intentMark(view)}<span class="intent-detail-id">${escapeHtml(id)}</span><span class="intent-detail-state" data-state="${view}">${INTENT_VIEW_TEXT[view]}</span></div><p class="intent-detail-claim"><span class="intent-when">${node.keep ? t("守") : escapeHtml(intentWhere(intent, id))}</span>${escapeHtml(node.claim)}</p><div class="intent-fields">${rows
    .map(
      ([k, v, tone, wide]) =>
        `<div class="intent-field${wide ? " w" : ""}"><span class="k${tone ? ` ${tone}` : ""}">${k}</span><div class="v">${v}</div></div>`
    )
    .join("")}</div></div>`;
}
/** 簿录里一行的说法：有事的换成事由——待复核写缘由、成立而前提未立写卡在哪、假定写出处、待定写等谁定什么；余者是那句说法 @param {Intent} intent @param {IntentPrints} now @param {string} id @param {IntentView} view @returns {[string, string]} [字, 语气] */
function intentRowSay(intent, now, id, view) {
  const node = intent.nodes[id];
  if (view === "stale") return [intentStaleWhy(intent, id, now), "zhu"];
  if (view === "premised") {
    const stuck = liveNeeds(intent, id).filter(k => !intentEstablished(intent, k, now));
    return [t`前提${stuck.map(k => `「${k}」`).join("")}未立`, "quiet"];
  }
  if (view === "assumed") return [t`出处：${node.note || ""}`, ""];
  if (view === "waiting") return [node.note || "", ""];
  return [node.claim, ""];
}
/** 簿录：这一层一项一行，点中的那一行就地摊开 @param {Intent} intent @param {IntentPrints} now @param {string[]} order @param {string} selected @param {string} level */
function intentRollHtml(intent, now, order, selected, level) {
  const roots = new Set(intentRoots(intent));
  if (!order.length) return "";
  return `<div class="intent-roll">${order
    .map(id => {
      if (id === selected) return `<div class="intent-roll-open">${intentDetailHtml(intent, now, id)}</div>`;
      const view = intentView(intent, id, now),
        inside = id === level ? "" : intentInside(intent, now, id),
        [say, tone] = intentRowSay(intent, now, id, view);
      return `<div class="intent-row${roots.has(id) || id === level ? " root" : ""}" data-intent-node="${escapeHtml(id)}" data-state="${view}" role="button" tabindex="0">${intentMark(view)}<span class="intent-row-name">${escapeHtml(id)}</span><span class="intent-row-in">${
        inside ? `<button type="button" data-intent-level="${escapeHtml(id)}" title="${t(`打开模块`)}">${inside} ›</button>` : ""
      }</span><span class="intent-row-say${tone ? ` ${tone}` : ""}">${escapeHtml(say)}</span></div>`;
    })
    .join("")}</div>`;
}
// 守：簿录之后另起一节（设计稿/80 卡片乙），行同目标那几行，出了事的说法换成事由；只在全局那一层。
// 题旁一行事实：几条，几条挂着测试、探针收尾前重查——余下的只凭模型自己守，看得出哪些有程序把关
/** @param {Intent} intent @param {IntentPrints} now @param {string} selected */
function intentKeepHtml(intent, now, selected) {
  const keeps = intentKeeps(intent);
  if (!keeps.length) return "";
  const checked = keeps.filter(id =>
    intent.nodes[id].anchors.some(key => ANCHOR_KINDS.get(anchorParts(key)[0])?.cadence === "answer")
  ).length;
  return `<div class="intent-keep-head">${t(`守`)}<small>${checked === keeps.length ? t`${keeps.length} 条，收尾前都重查` : checked ? t`${keeps.length} 条，${checked} 条收尾前重查` : t`${keeps.length} 条，未挂测试`}</small></div>${intentRollHtml(intent, now, keeps, selected, "")}`;
}
/** 墨痕：新的在上，同一时刻的几笔并作一组；每笔写是哪一种（弃、撤、改意、归入……）。弃的带灰叉、写弃时的缘由，假定的带泥金勾；还在图上的名可点 @param {Intent} intent */
function intentInkHtml(intent) {
  /** @type {{ time: string, items: string[] }[]} */
  const groups = [];
  for (const entry of [...intent.log].reverse()) {
    const time = intentTime(entry.at);
    if (groups.at(-1)?.time !== time) groups.push({ time, items: [] });
    const said = entry.text.match(/^(弃|撤|改意|改根|立根|假定|待定|复立|改名) ([^：]+?)(?:：([\s\S]*))?$/),
      moved = !said && entry.text.match(/^(.+?) 归入(.+)$/);
    let [kind, name, rest] = said
      ? [said[1], said[2], said[3] || ""]
      : moved
        ? ["归入", moved[1], moved[2] === "全局" ? t("全局") : moved[2]]
        : ["", "", entry.text];
    const node = intent.nodes[name];
    if (kind === "弃" && node?.state === "dropped") rest = node.note || node.claim;
    const mark =
        kind === "弃"
          ? intentMark("dropped")
          : kind === "假定"
            ? intentMark("assumed")
            : kind === "待定"
              ? intentMark("waiting")
              : "<i></i>",
      who = !name
        ? ""
        : node && !intentGone(intent, name)
          ? `<button type="button" class="intent-ink-name" data-intent-node="${escapeHtml(name)}">${escapeHtml(name)}</button>`
          : `<b class="intent-ink-name">${escapeHtml(name)}</b>`;
    groups
      .at(-1)
      .items.push(
        `<div class="intent-ink-item" data-kind="${escapeHtml(kind)}">${mark}<span class="intent-ink-kind">${escapeHtml(kind && t(kind))}</span><span class="intent-ink-text">${who}${escapeHtml(rest)}</span></div>`
      );
  }
  return `<div class="intent-ink">${groups
    .map(g => `<div class="intent-ink-group"><time>${escapeHtml(g.time)}</time><div>${g.items.join("")}</div></div>`)
    .join("")}</div>`;
}
/** 模块里那一层的顶上一行：所在（上层可点回）。前提与撑起什么不另列——点开模块那一项，笺上就有 @param {Intent} intent @param {string} level */
function intentCrumbHtml(intent, level) {
  if (!level || !intent.nodes[level]) return "";
  const path = ["", ...intentAncestors(intent, level).reverse()];
  return `<div class="intent-crumb"><span class="intent-crumb-path">${path
    .map(k => `<button type="button" data-intent-level="${escapeHtml(k)}">${escapeHtml(k || t("全局"))}</button><i>›</i>`)
    .join("")}<b>${escapeHtml(level)}</b></span></div>`;
}
/**
 * 整张卡片
 * @param {Intent} intent @param {IntentPrints} now
 * @param {{ selected?: string, level?: string, name?: string, ink?: boolean }} [options] level：眼前是哪个模块里的一层；name：目录名；ink：图下换成墨痕
 */
function intentCardHtml(intent, now, { selected = "", level = "", name = "", ink = false } = {}) {
  if (!Object.keys(intent.nodes).some(id => !intentGone(intent, id)))
    return `<div class="intent-card"><div class="file-viewer-empty">${t(`此目录尚未立意`)}</div></div>`;
  const { standing, live } = intentTally(intent, now),
    borrowed = [...new Set(intentRoots(intent).flatMap(id => intentBorrowed(intent, id)))].length,
    { svg, order } = intentGraphSvg(intent, now, selected, level),
    inked = ink && intent.log.length > 0;
  // 页头：目录名、一行事实，右端墨痕。原问不上卡片，它是给模型对照用的
  const facts = [
    live ? `<span class="intent-meta">${t(`进度`)} <b>${standing}</b> / ${live}</span>` : "",
    borrowed ? `<span class="intent-borrow">${t`假定 ${borrowed}`}</span>` : "",
    intent.updated ? `<span class="intent-updated">${t`更新于 ${escapeHtml(intentTime(intent.updated))}`}</span>` : ""
  ].join("");
  return `<div class="intent-card"><div class="page-head intent-page-head">${name ? `<h1>${escapeHtml(name)}</h1>` : ""}<span class="page-facts">${facts}</span>${
    intent.log.length
      ? `<div class="page-acts"><button type="button" data-intent-ink aria-pressed="${inked}"${inked ? ` class="on"` : ""}>${t`墨痕 ${intent.log.length}`}</button></div>`
      : ""
  }</div>${intentCrumbHtml(intent, level)}<div class="intent-graph">${svg}</div>${
    inked
      ? intentInkHtml(intent)
      : `${intentRollHtml(intent, now, order, selected, level)}${level ? "" : intentKeepHtml(intent, now, selected)}`
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
/** @type {{ conversation: Conversation, intent: Intent, now: IntentPrints, selected: string, level: string, ink: boolean, painted?: string, revision: number }|null} */
let intentCard = null;
function paintIntentCard() {
  const stage = $("#fileViewerStage");
  if (!intentCard || intentCard.revision !== viewerRevision || !stage?.querySelector(".intent-card")) return;
  const { conversation, intent, now, selected, level, ink } = intentCard,
    // 图比卡片宽时横滚：同一层重画（点了一项）留在原处；头一回画、换了一层，滚到正做着的、待复核的那一项，没有就靠右见根
    before = intentCard.painted === level ? stage.querySelector(".intent-graph:not(:empty)")?.scrollLeft : undefined;
  intentCard.painted = level;
  stage.innerHTML = intentCardHtml(intent, now, { selected, level, ink, name: workdirName(conversation) });
  const graph = stage.querySelector(".intent-graph");
  if (!graph || graph.scrollWidth <= graph.clientWidth) return;
  if (before !== undefined) return void (graph.scrollLeft = before);
  const busy = graph.querySelector('g[data-state="doing"], g[data-state="stale"], g[data-state="waiting"]');
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
    t`意 · ${workdirName(conversation)}`,
    `<div class="intent-card"><div class="file-viewer-empty">${t(`正在取出…`)}</div></div>`,
    trigger,
    t("意")
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
    intentCard = { conversation, intent, now, selected: "", level: "", ink: false, revision };
    paintIntentCard();
  } catch (error) {
    if (revision !== viewerRevision) return;
    const stage = $("#fileViewerStage");
    if (stage?.querySelector(".intent-card"))
      stage.innerHTML = `<div class="intent-card"><div class="file-viewer-empty">${escapeHtml(friendlyError(String(error.message || error)))}</div></div>`;
  }
}
/** 点中一项：图上、簿录里再点一下（或点笺的题）收起；别层的（前提、支撑、内含、墨痕里点的）跳到它那一层，墨痕收起 @param {string} id @param {boolean} toggle */
function pickIntentNode(id, toggle) {
  if (!intentCard?.intent.nodes[id]) return;
  const { level, ink } = intentCard;
  intentCard.ink = false;
  if (toggle && intentCard.selected === id) intentCard.selected = "";
  else {
    if (id !== intentCard.level) intentCard.level = intentCard.intent.nodes[id].in || "";
    intentCard.selected = id;
  }
  // 同一层里摊开、收起一张笺：簿录从旧高动到新高，与别处的展开同一种；换了层、从墨痕回来是整张换过，不动
  const stage = $("#fileViewerStage");
  if (ink || level !== intentCard.level) return paintIntentCard();
  morphHeight(stage.querySelector(".intent-roll"), paintIntentCard, 320, () => stage.querySelector(".intent-roll"));
}
/** 点了就开合（再点收起）的：图上一项、簿录一行、摊开的笺的题；别处的名（前提、支撑、墨痕）是跳过去 */
const INTENT_TOGGLES = "g[data-intent-node], .intent-row, .intent-detail-head";
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
    if (event.target.closest("[data-intent-ink]")) {
      intentCard.ink = !intentCard.ink;
      intentCard.selected = "";
      return paintIntentCard();
    }
    if (into) {
      intentCard.level = into.dataset.intentLevel;
      intentCard.selected = "";
      intentCard.ink = false;
      return paintIntentCard();
    }
    if (pick) pickIntentNode(pick.dataset.intentNode, pick.matches(INTENT_TOGGLES));
  });
  stage.addEventListener("keydown", event => {
    if (!intentCard) return;
    const node = event.target.closest?.(INTENT_TOGGLES);
    if (node && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const id = CSS.escape(node.dataset.intentNode);
      pickIntentNode(node.dataset.intentNode, true);
      // 图上的仍落回图上；簿录里的落到摊开的笺的题，收起了落回那一行
      stage
        .querySelector(
          node.matches("g")
            ? `g[data-intent-node="${id}"]`
            : `.intent-detail-head[data-intent-node="${id}"], .intent-row[data-intent-node="${id}"]`
        )
        ?.focus();
    }
  });
}
