// 言 · 整体渲染：顶栏、模型菜单、历史、对话与消息
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function render(shouldScroll = false) {
  rememberPlace();
  const c = currentConversation(),
    library = view === "library",
    groups = view === "groups",
    page = library || groups;
  // 人在卷宗页时这段对话的一答写完了，记了「有新回复」；回到它眼前就算看过了，不必再点一次侧栏
  if (c && !page && c.unread) {
    c.unread = false;
    saveStoreSoon();
  }
  renderHeader();
  renderHistory();
  syncDocumentTitle();
  requestAnimationFrame(() => syncJumpBottom());
  $("#library").classList.toggle("hidden", !library);
  $("#groups").classList.toggle("hidden", !groups);
  $("#welcome").classList.toggle("hidden", page || !!c);
  $("#chat").classList.toggle("hidden", page || !c);
  $("#chatScrollGrabber").classList.toggle("hidden", page || !c);
  $("#composerArea").classList.toggle("hidden", page || !c);
  $("#openLibrary").classList.toggle("active", library);
  $("#openGroups").classList.toggle("active", groups);
  renderGroupsCount();
  renderGroupTags();
  if (library) renderLibrary();
  else if (groups) renderGroupsPage();
  else if (c) renderConversation(shouldScroll);
  else renderOutline();
  restoreDraft();
  renderAttachments();
  renderSendButtons();
  renderApprovalBar();
  renderHelperBar();
  requestAnimationFrame(syncChatScrollGrabber);
}
function renderHeader() {
  renderModelTriggers();
  $("#welcomeMode").textContent = workMode() ? "执事" : "对谈";
  $("#displayNameSidebar").textContent = store.settings.name;
  $("#avatar").textContent = store.settings.name.trim().slice(0, 1) || "客";
  const dark = document.documentElement.dataset.theme === "dark",
    toggle = $("#themeToggle");
  toggle.dataset.theme = dark ? "dark" : "light";
  toggle.title = dark ? "天光 · 亮色" : "落墨 · 暗色";
  $("#greeting").textContent = greeting();
  renderModeSwitch();
  renderWelcome();
  renderQuota();
  renderModelMenu();
  renderLibraryCount();
}
// 余墨：顶栏上只一笔墨色短横，随用量从笔尾往回收（笔尾三缕飞白），底下一道淡痕是全长；数目靠近才浮出（见 设计稿/30 甲）。
// 设了上限时报还剩多少，没设（不限）时墨常满、改报已耗多少。落选的：「余墨」二字 + 一笔朱色渐变 + 等宽数目常显（功能最少，占位最多）
function quotaInk(ratio) {
  const length = 22 * ratio,
    ghost = brushStroke([2, 8, 12, 6.6, 22, 7.8], 3.4, { tone: "ghost", tail: 0.3 });
  if (length < 1.5) return ghost;
  const body = brushStroke([2, 8, length * 0.5, 6.8, length * 0.78, 7.6], 3.6, { tail: 0.7 }),
    hairs = [-1.1, 0, 1.15]
      .map((d, i) =>
        brushStroke([length * 0.7, 7.6 + d, length * 0.86, 7.4 + d * 1.2, length + [2, 0, 3][i], 7.5 + d * 1.5], 0.8, { tail: 0, head: 1 })
      )
      .join("");
  return ghost + body + hairs;
}
// 浮签是一句话，数目用亿、万；别处（上下文、每答耗墨）仍是 k / m / e，与设置里填上限的写法一致
function quotaAmount(n) {
  const compact = (amount, unit) => `${Number(amount.toFixed(amount >= 10 ? 0 : 1))} ${unit}`;
  return n >= 100000000 ? compact(n / 100000000, "亿") : n >= 10000 ? compact(n / 10000, "万") : String(Math.round(n));
}
function renderQuota() {
  const p = activeProfile(),
    cap = p ? parseTokenLimit(p.quota) : null,
    used = Math.max(0, Number(p?.usedTokens || 0));
  const remaining = cap ? Math.max(0, cap - used) : 0,
    ratio = !p ? 0 : cap ? remaining / cap : 1,
    status = $("#quotaStatus");
  $("#quotaInk").innerHTML = quotaInk(ratio);
  status.querySelector(".quota-label").textContent = p && cap === null ? "耗墨" : "余墨";
  $("#quotaText").textContent = !p ? "" : quotaAmount(cap === null ? used : remaining);
  $("#quotaNote").textContent = !p ? "尚未接入模型" : cap === null ? "不设上限" : `上限 ${quotaAmount(cap)}`;
  status.classList.toggle("dry", !!cap && remaining === 0);
  status.classList.toggle("empty", !p);
  status.setAttribute(
    "aria-label",
    !p ? "尚未接入模型" : cap === null ? `不限用量，已耗 ${formatTokens(used)}` : `余墨 ${formatTokens(remaining)} / ${formatTokens(cap)}`
  );
}
function renderModelTriggers() {
  const p = activeProfile(),
    c = currentConversation(),
    level = (c ? c.reasoning : p?.reasoning) || "",
    preset = presetOf(c);
  // 标签写实际会送出的那一档：模型不认所选的就落到最接近的；模型不认思考档位（探过是 none）就不写
  const used = level ? nearestReasoning(p, level) : "";
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.querySelector(".model-name").textContent = p?.name || "尚未接入模型";
    button.querySelector(".model-extra").textContent = [preset?.name, used ? `思考 ${reasoningLabel(used)}` : ""]
      .filter(Boolean)
      .map(text => `· ${text}`)
      .join(" ");
  });
}
function closeModelMenu() {
  const menu = $("#modelMenu");
  hideWithFade(menu);
  document.querySelectorAll(".model-trigger").forEach(button => button.setAttribute("aria-expanded", "false"));
}
function positionModelMenu(button) {
  const menu = $("#modelMenu");
  if (!button || menu.classList.contains("hidden")) return;
  menu.classList.remove("drop-up");
  menu.style.removeProperty("max-height");
  const rect = button.getBoundingClientRect(),
    gap = 9,
    edge = 12;
  const below = Math.max(0, innerHeight - rect.bottom - gap - edge),
    above = Math.max(0, rect.top - gap - edge);
  const dropUp = below < Math.min(menu.scrollHeight, 220) && above > below;
  menu.classList.toggle("drop-up", dropUp);
  menu.style.maxHeight = `${Math.max(96, Math.min(dropUp ? above : below, 420))}px`;
}
function renderModelMenu() {
  const all = profiles();
  $("#modelMenu").innerHTML = all.length
    ? all
        .map(p => {
          const active = p.id === activeProfile()?.id;
          // 只列显示名：模型原名与接口地址长短不一，行高参差；要看去模型设置
          return `<button class="model-option${active ? " active" : ""}" data-profile="${escapeHtml(p.id)}"${active ? ' aria-current="true"' : ""} title="${escapeHtml(p.model)}"><strong><span class="model-dot"></span><span class="model-option-name">${escapeHtml(p.name)}</span></strong></button>`;
        })
        .join("")
    : `<button class="model-option" id="configureFirst"><strong>接入模型</strong></button>`;
  const c = currentConversation(),
    profile = activeProfile(),
    level = (c ? c.reasoning : profile?.reasoning) || "",
    choices = reasoningChoices(profile),
    // 选过的档位这个模型不认（换了模型、或刚学到它的档位）：菜单上点亮它实际会落到的那一档
    shown = choices.includes(level) ? level : nearestReasoning(profile, level) || "";
  if (all.length)
    $("#modelMenu").insertAdjacentHTML(
      "beforeend",
      `${presetMenuHtml()}<div class="menu-section"><div class="menu-section-title"><span>思考深度</span><span title="每个模型分别记住所选档位；默认不带字段，由接口决定。各模型所认的档位可在高级配置中填写">当前模型</span></div>${choices.length > 1 ? `<div class="segmented">${choices.map(value => `<button type="button" data-reasoning="${value}" class="${value === shown ? "active" : ""}">${reasoningLabel(value)}</button>`).join("")}</div>` : `<div class="menu-section-note">此模型不认思考档位</div>`}</div><button class="model-option model-manage" data-manage>模型设置</button>`
    );
  $("#configureFirst")?.addEventListener("click", () => openSettings("models"));
  $("#modelMenu [data-manage]")?.addEventListener("click", e => {
    e.stopPropagation();
    closeModelMenu();
    openSettings("models");
  });
}
function renderHistory() {
  const query = historyQuery.trim().toLowerCase();
  const matches = c =>
    !query ||
    String(c.title).toLowerCase().includes(query) ||
    (c.messages || []).some(m => typeof m.content === "string" && m.content.toLowerCase().includes(query));
  const sorted = [...store.conversations].filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // 一条时间线：绑了目录的对话归在各自的「工」组里，组按组内最近动过的那条排（一条有动静，整组靠前），组内按时间；
  // 自立的分组（「集」）同样按组内最近动过的那条排，空组按立组的时间，与「工」组同一排法；没绑目录的对话按自己的时间散在其间；置顶另列。
  // 落选的：分组在置顶之下自成一段（组一多，刚写的对话被压到下面，且与置顶之间没有界线，看着像置顶的一部分）。
  // 组可收起，收起即整组收起（连同正开着的那条）；正开着的那条在组里时，组首标出「在此」，收起了也知道自己在哪。
  // 落选：收起时单留当前那条——看着像只收了别的几条，怪。查找时不收，也不列没有命中的组
  const collapsed = new Set(store.settings.collapsedRepos || []),
    pinned = sorted.filter(c => c.pinned && !groupOf(c)),
    repos = new Map(),
    sets = new Map(groupsList().map(group => [group.id, { kind: "set", group, at: group.createdAt, items: [] }])),
    nodes = [];
  for (const c of sorted) {
    const set = c.groupId && sets.get(c.groupId);
    if (set) {
      if (!set.items.length || c.updatedAt > set.at) set.at = c.updatedAt;
      set.items.push(c);
      continue;
    }
    if (c.pinned) continue;
    if (!isWork(c)) {
      nodes.push({ kind: "chat", at: c.updatedAt, c });
      continue;
    }
    let node = repos.get(c.workdir);
    if (!node) {
      node = { kind: "repo", dir: c.workdir, at: c.updatedAt, items: [] };
      repos.set(c.workdir, node);
      nodes.push(node);
    }
    node.items.push(c);
  }
  for (const set of sets.values()) if (!query || set.items.length) nodes.push(set);
  nodes.sort((a, b) => b.at.localeCompare(a.at));
  /** @type {Map<string, any[]>} */
  const buckets = new Map();
  buckets.set(
    "置顶",
    pinned.map(c => ({ kind: "chat", c }))
  );
  for (const label of ["今天", "过去七天", "更早"]) buckets.set(label, []);
  for (const node of nodes) buckets.get(dayBucket(node.at)).push(node);
  // 正改着名时侧栏也可能重画（别的对话拟好了题、后台一答收尾）：改到一半的字与光标得留住，不能被原标题冲掉
  const editing = $("#history .history-rename"),
    typed =
      editing && renamingId && editing.closest("[data-conversation]")?.dataset.conversation === renamingId
        ? { value: editing.value, start: editing.selectionStart, end: editing.selectionEnd }
        : null;
  const item = c => {
    if (renamingId === c.id)
      return `<div class="history-item active" data-conversation="${escapeHtml(c.id)}"><input class="history-rename" value="${escapeHtml(typed && renamingDirty ? typed.value : c.title)}" maxlength="60" aria-label="重命名对话"></div>`;
    // 这一答写完了、帮手还在后台做，也算在忙；帮手的请示没有哪一答替它挂「等待确认」，按请示本身认
    const job = requestJob(c.id),
      running = !!job || crewRunning(c.id),
      waiting = job?.label === "等待确认" || [...pendingApprovals.values()].some(entry => entry.conversationId === c.id),
      runningTip = job ? "后台生成中" : "帮手在后台做";
    const state = waiting
      ? `<span class="history-state waiting" title="有指令等待确认" aria-label="有指令等待确认">问</span>`
      : running
        ? `<span class="history-state running" title="${runningTip}" aria-label="${runningTip}"></span>`
        : c.unread
          ? `<span class="history-state unread" title="有新回复" aria-label="有新回复"></span>`
          : c.pinned && groupOf(c)
            ? `<span class="history-state pinned" title="组内置顶" aria-label="组内置顶"></span>`
            : "";
    return `<div class="history-item ${c.id === currentId ? "active" : ""} ${running ? "is-running" : ""} ${c.unread ? "has-unread" : ""} ${isWork(c) ? "is-work" : ""}" data-conversation="${escapeHtml(c.id)}" draggable="true"><button class="history-open" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>${state}<span class="history-tools"><button class="history-tool history-more" data-history-action="menu" title="更多" aria-label="更多" aria-haspopup="menu">⋯</button></span></div>`;
  };
  const repoHtml = node => {
    const name = node.dir.split(/[\\/]/).filter(Boolean).pop() || node.dir || "未定目录",
      fold = collapsed.has(node.dir) && !query,
      shown = fold ? [] : node.items,
      here = fold && node.items.some(c => c.id === currentId),
      running = node.items.filter(c => requestJob(c.id)).length;
    return `<div class="history-repo-group${fold ? " collapsed" : ""}${here ? " holds-current" : ""}" data-repo="${escapeHtml(node.dir)}"><div class="history-repo-head"><button type="button" class="history-repo" data-repo-toggle="${escapeHtml(node.dir)}" title="${escapeHtml(node.dir)}\n${fold ? "展开" : "收起"}" aria-expanded="${fold ? "false" : "true"}"><span class="repo-seal" aria-hidden="true">工</span><span class="history-repo-name">${escapeHtml(name)}</span><small>${node.items.length}${fold && running ? ` · ${running} 生成中` : ""}</small><span class="repo-caret" aria-hidden="true">›</span></button><button type="button" class="history-tool repo-new" data-history-workdir="${escapeHtml(node.dir)}" title="在此目录新建">＋</button></div>${shown.length ? `<div class="history-repo-items">${shown.map(item).join("")}</div>` : ""}</div>`;
  };
  // 分组：画法同「工」组，印文是「集」；组首右侧「＋」在此组另起一段、「⋯」改名、打开组的设置或解散；改名时组名换成输入框。
  // 对话可拖到组上移入、拖到组外移出（见 24-groups.js）
  const setHtml = node => {
    const { group } = node,
      key = `group:${group.id}`,
      fold = collapsed.has(key) && !query,
      items = [...node.items].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)),
      shown = fold ? [] : items,
      here = fold && items.some(c => c.id === currentId),
      renaming = renamingGroupId === group.id;
    const name = renaming
      ? `<input class="history-rename group-rename" value="${escapeHtml(group.name)}" maxlength="40" aria-label="分组改名">`
      : `<span class="history-repo-name">${escapeHtml(group.name)}</span>`;
    return `<div class="history-repo-group is-set${fold ? " collapsed" : ""}${here ? " holds-current" : ""}" data-group="${escapeHtml(group.id)}"><div class="history-repo-head"><div role="button" tabindex="0" class="history-repo" data-group-toggle="${escapeHtml(group.id)}" aria-expanded="${fold ? "false" : "true"}"><span class="repo-seal" aria-hidden="true">集</span>${name}<small>${node.items.length}</small><span class="repo-caret" aria-hidden="true">›</span></div><button type="button" class="history-tool repo-new" data-group-new="${escapeHtml(group.id)}" title="在此组新建">＋</button><button type="button" class="history-tool repo-new repo-more" data-group-menu="${escapeHtml(group.id)}" title="更多" aria-label="更多" aria-haspopup="menu">⋯</button></div>${shown.length ? `<div class="history-repo-items">${shown.map(item).join("")}</div>` : ""}</div>`;
  };
  renderingHistory = true;
  try {
    $("#history").innerHTML =
      [...buckets]
        .filter(([, items]) => items.length)
        .map(
          ([label, items]) =>
            `<div class="history-group"><div class="history-label">${label}</div>${items.map(node => (node.kind === "repo" ? repoHtml(node) : node.kind === "set" ? setHtml(node) : item(node.c))).join("")}</div>`
        )
        .join("") || `<div class="history-empty">${query ? "没有匹配的对话" : "尚无旧墨"}</div>`;
    const input = $("#history .history-rename");
    if (input) {
      input.focus();
      if (typed) input.setSelectionRange(typed.start, typed.end);
      else input.select();
    }
  } finally {
    renderingHistory = false;
  }
}
function scrollSnapshot() {
  const host = $("#chatScroll");
  if (!host || !currentId || view !== "chat") return null;
  const hostTop = host.getBoundingClientRect().top,
    anchor = [...host.querySelectorAll("#messages [data-message]")].find(node => node.getBoundingClientRect().bottom > hostTop + 1);
  return {
    top: host.scrollTop,
    gap: Math.max(0, host.scrollHeight - host.scrollTop - host.clientHeight),
    follow: followBottom,
    anchorId: anchor?.dataset.message || "",
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - hostTop : 0
  };
}
function rememberScrollPosition() {
  const snapshot = scrollSnapshot();
  if (snapshot && currentId) scrollPositions.set(currentId, snapshot);
}
function restoreScrollPosition(snapshot) {
  const host = $("#chatScroll");
  if (!host || !snapshot) return;
  followBottom = !!snapshot.follow;
  const anchor = snapshot.anchorId ? host.querySelector(`[data-message="${CSS.escape(snapshot.anchorId)}"]`) : null;
  if (anchor) host.scrollTop += anchor.getBoundingClientRect().top - host.getBoundingClientRect().top - snapshot.anchorOffset;
  else host.scrollTop = Math.min(snapshot.top, Math.max(0, host.scrollHeight - host.clientHeight));
}
// 标题下的元信息行：日期、几问、旁注、目录签、存入卷宗；一答收尾后也刷一次（存入卷宗要等有完整的答才出现）
/** @param {Conversation} c */
function renderChatMeta(c) {
  $("#chatMeta").innerHTML =
    `${escapeHtml(formatDay(c.createdAt))} · ${escapeHtml(chineseNumber(c.messages.filter(m => m.role === "user" && !m.relay).length, true))}问${visibleThreads(c).length ? ` · <button class="chat-meta-notes" type="button" data-open-notes title="打开旁注">旁注 ${visibleThreads(c).length}</button>` : ""}${isWork(c) ? ` · <button type="button" class="chat-meta-path" data-workdir-bind title="工作目录">${escapeHtml(c.workdir || "")}</button>` : c.ended ? "" : ` · <button type="button" class="chat-meta-bind" data-workdir-bind title="绑定工作目录，此后指令与改动落于其中">绑定目录</button>`}${c.messages.some(m => m.role === "assistant" && m.status === "complete") ? ` · <button type="button" class="chat-meta-bind" data-export-md title="以 Markdown 存入卷宗">存入卷宗</button>` : ""}`;
  renderRunningHead();
  requestAnimationFrame(syncRunningHead);
}
// 书眉：标题滚出视口后才显出题名与问数。字随 renderChatMeta 与改标题刷新（renderRunningHead），滚动时只切显隐（syncRunningHead）
function renderRunningHead() {
  const c = currentConversation(),
    head = $("#runningHead");
  if (c) {
    const notes = visibleThreads(c).length;
    head.querySelector(".running-head-title").textContent = c.title;
    head.querySelector(".running-head-meta").textContent =
      `${chineseNumber(c.messages.filter(m => m.role === "user" && !m.relay).length, true)}问${notes ? ` · 旁注 ${notes}` : ""}`;
  }
  syncRunningHead();
}
// 翻到一段摊开的行迹中间——它的题头已滚上去、身子还占着眼前——顶栏右侧、对话那一列的右缘处浮出一枚「收起行迹」：一点即收，停回题头处。
// 行迹一长，最上面那行题头就滚出屏外，要收得先翻回去找。左边的书眉照旧是题名，不跟着换（见 设计稿/12-改动条与行迹 三·甲）
function trailUnderHead() {
  const top = $("#chatScroll").getBoundingClientRect().top;
  for (const stack of document.querySelectorAll("#messages .assistant-block > details.tool-stack[open]")) {
    const summary = stack.querySelector(":scope > summary");
    if (summary && summary.getBoundingClientRect().bottom < top + 4 && stack.getBoundingClientRect().bottom > top + 90) return stack;
  }
  return null;
}
function syncRunningHead() {
  $("#runningHead").classList.toggle(
    "shown",
    !!currentConversation() && $("#chatTitle").getBoundingClientRect().bottom < $("#chatScroll").getBoundingClientRect().top + 4
  );
  const fold = $("#trailFold"),
    trail = currentConversation() ? trailUnderHead() : null;
  fold._trail = trail;
  fold.classList.toggle("shown", !!trail);
}
function renderConversation(shouldScroll = false) {
  const c = currentConversation();
  if (!c) return;
  const snapshot = c.id === lastRenderedConvId ? scrollSnapshot() : scrollPositions.get(c.id);
  // 同一段对话原地重画（换主题、压缩收尾）时，正改着的标题不动
  if (c.id !== lastRenderedConvId || document.activeElement !== $("#chatTitle")) $("#chatTitle").textContent = c.title;
  renderChatMeta(c);
  renderWorkAuto();
  renderModelTriggers();
  const scrollHost = $("#chatScroll");
  scrollHost.classList.toggle(
    "generating",
    c.messages.some(message => message.status === "streaming")
  );
  // 切换对话时整列淡入（带轻微交错）；流式结束、主题切换等原地重绘则保持安静
  const converged = c.id !== lastRenderedConvId;
  lastRenderedConvId = c.id;
  scrollHost.classList.remove("converge");
  refreshNoteCounts(c);
  const { added } = syncMessages(c, converged);
  if (converged) {
    const articles = scrollHost.querySelectorAll("#messages .message");
    scrollHost.classList.add("converge");
    articles.forEach((el, i) => el.style.setProperty("--converge-delay", `${Math.min(i * 35, 240)}ms`));
    clearTimeout(convergeTimer);
    convergeTimer = setTimeout(() => scrollHost.classList.remove("converge"), 1000);
  }
  const dry = conversationDry(c);
  $("#chatInput").disabled = dry;
  $("#chatInput").placeholder = dry ? "余墨已尽，换个模型再续" : "续言于此";
  renderSendButtons();
  if (shouldScroll || !snapshot) {
    followBottom = true;
    requestAnimationFrame(scrollBottom);
  } else {
    restoreScrollPosition(snapshot);
    requestAnimationFrame(() => restoreScrollPosition(snapshot));
  }
  // 主题、朱色或字体变了：留在原地的交互内容就地换色，不必重画整段
  const themeKey = vizThemeKey();
  if (themeKey !== lastVizThemeKey) {
    lastVizThemeKey = themeKey;
    rethemeHtmlApps($("#messages"));
  }
  for (const node of added) {
    void loadThumbnails(node);
    renderEnhancements(node);
    decorateNoteAnchors(node);
  }
  syncActiveAnchor();
  foldCompacted(c);
  renderOutline();
  updateContextGauge();
}
// 停在哪一页记在设置里：刷新后回到原处——正看着的那段对话、或卷宗；开机时由 boot 读回
function rememberPlace() {
  const s = store.settings,
    /** @type {{ view: "chat"|"library"|"groups", id: string }} */
    next = { view: view === "library" || view === "groups" ? view : "chat", id: view === "chat" ? currentId || "" : "" };
  if (s.lastView === next.view && (s.lastConversationId || "") === next.id) return;
  s.lastView = next.view;
  s.lastConversationId = next.id;
  saveStoreSoon();
}
function restorePlace() {
  const { lastView, lastConversationId } = store.settings;
  if (lastView === "library" || lastView === "groups") view = lastView;
  else if (lastConversationId && store.conversations.some(c => c.id === lastConversationId)) {
    currentId = lastConversationId;
    const c = currentConversation();
    c.unread = false;
  }
}
// 压缩过的前文在页面上折起（记录都在，只是不占地方）；最近一次压缩的分隔上有「展开前文 / 收起前文」
/** @param {Conversation} c */
function foldCompacted(c) {
  const host = $("#messages"),
    index = c.messages.map(m => (m.role === "context" && m.summary ? 1 : 0)).lastIndexOf(1);
  const before = new Set(index > 0 ? c.messages.slice(0, index).map(m => m.id) : []);
  for (const node of host.children) {
    const id = node.dataset.message;
    if (!id) continue;
    node.classList.toggle("compacted", before.has(id) && !c.showCompacted);
  }
  for (const button of host.querySelectorAll("[data-toggle-compacted]")) {
    const own = button.closest("[data-message]")?.dataset.message === c.messages[index]?.id;
    button.classList.toggle("hidden", !own || !before.size);
    button.textContent = c.showCompacted ? "收起前文" : "展开前文";
  }
}
// 消息列表按 id 增量同步：没变的节点原样留下（图表、沙箱、展开状态都不动），只插入、替换或移除有变化的那几条。
// 回复就地重画（见 07-paint.js，画法是幂等的，正在写的那条也一样画）；用户消息、分隔与提示签名一变整条换。
// 只有会改变呈现的字段才算变化；展开/收起这类界面状态用户已经在页面上操作过了，不必因此重画
const UI_STATE_FIELDS = new Set(["toolsOpen", "toolsTouched", "reasoningOpen", "reasoningTouched", "showCompacted"]);
/** @param {Message} message */
function messageSig(message, branch) {
  return `${branch ? `${branch.at}/${branch.total}|` : ""}${editingMessageId === message.id ? "e|" : ""}${noteCounts.get(message.id) || 0}|${JSON.stringify(message, (key, value) => (UI_STATE_FIELDS.has(key) ? undefined : value))}`;
}
/** @param {Conversation} c */
function syncMessages(c, converged) {
  /** @type {Array<{ key: string, message?: Message, branch?: any, html?: string, side?: boolean }>} */
  const items = c.messages.map((message, index) => ({ key: message.id, message, branch: branchAt(c, index) }));
  if (compactingIds.has(c.id))
    items.push({
      key: "__compacting",
      html: `<div class="context-divider compacting" data-message="__compacting"><span>正在把前文压成摘要…</span></div>`
    });
  if (conversationDry(c))
    items.push({
      key: "__dry",
      html: `<div class="server-notice ended-notice" data-message="__dry"><span>此模型余墨已尽。更换模型或调高上限，即可在此续写。</span><button type="button" class="outline-btn" data-pick-model>更换模型</button></div>`
    });
  const result = syncNodes($("#messages"), items, converged);
  if (document.documentElement.classList.contains("work-mode") && !$("#messages").querySelector(".work-expanded")) closeExpandedWork();
  return result;
}
function syncNodes(host, items, converged) {
  const existing = new Map(),
    added = [],
    template = document.createElement("template");
  for (const node of host.children) if (node.dataset.message) existing.set(node.dataset.message, node);
  let cursor = host.firstElementChild;
  for (const item of items) {
    const node = existing.get(item.key);
    existing.delete(item.key);
    const sig = item.html ?? messageSig(item.message, item.branch),
      reply = item.message?.role === "assistant";
    let next = node;
    if (!node || (!reply && nodeSig.get(node) !== sig)) {
      template.innerHTML = item.html ?? (reply ? assistantShellHtml(item.message) : renderMessage(item.message, item.branch, item.side));
      next = template.content.firstElementChild;
      added.push(next);
      if (!node && !converged) next.classList.add("is-new");
    } else node.classList.remove("is-new");
    if (node && next !== node) {
      if (node === cursor) cursor = cursor.nextElementSibling;
      node.remove();
    }
    if (next === cursor) cursor = cursor.nextElementSibling;
    else host.insertBefore(next, cursor);
    // 先挂上再画：交互内容、开合动效都要在页上才量得准
    if (reply && (next !== node || item.message.status === "streaming" || nodeSig.get(next) !== sig))
      paintAssistant(next, item.message, { side: !!item.side, branch: item.branch });
    nodeSig.set(next, sig);
  }
  // 游标之后全是没被点到名的旧节点（删掉的消息、重生成时截掉的尾巴、旧的收尾提示）
  while (cursor) {
    const stale = cursor;
    cursor = cursor.nextElementSibling;
    stale.remove();
  }
  return { added };
}
function vizThemeKey() {
  return `${document.documentElement.dataset.theme}|${cssVar("--accent")}|${cssVar("--body")}`;
}
/** @param {Message} message */
function noteMarkHtml(message) {
  const count = noteCounts.get(message.id) || 0;
  return count
    ? `<button class="note-mark" type="button" data-note-mark title="查看这条消息的旁注">注${count > 1 ? ` ${count}` : ""}</button>`
    : "";
}
// 用户消息与上下文分隔的整条 HTML；回复另有画法（见 07-paint.js）
/** @param {Message} message */
// 帮手的回报（或后台指令结束）另起的一问：不是用户的话，画成一道细线——谁回来了，点名字开它的那一趟（后台指令则回到挂它的那一步）
/** @param {Message} message */
function relayHtml(message, branch = null) {
  const items = message.relay || [],
    names = items
      .map(item =>
        item.kind === "bg"
          ? `<button type="button" class="relay-name" data-relay-reveal="${escapeHtml(item.step)}" title="回到挂它的那一步">后台 ${escapeHtml(item.title)} 已结束${item.ok ? "" : ` · 退出码 ${escapeHtml(String(item.exitCode ?? "?"))}`}</button>`
          : `<button type="button" class="relay-name" data-relay-step="${escapeHtml(item.step)}" title="看这一趟的经过">帮手「${escapeHtml(item.title)}」${item.ok ? "回报" : "未完成"}</button>`
      )
      .join(`<span class="relay-sep" aria-hidden="true">·</span>`),
    seal = items.every(item => item.kind === "bg") ? "候" : "遣";
  return `<article class="message relay" data-message="${escapeHtml(message.id)}"><div class="relay-line"><span class="seal sub-seal" aria-hidden="true">${seal}</span>${names}</div>${branch ? `<div class="message-actions has-branch">${branchNavHtml(branch)}</div>` : ""}</article>`;
}
function renderMessage(message, branch = null, side = false) {
  if (message.role === "context")
    return message.summary
      ? `<div class="context-divider has-summary" data-message="${escapeHtml(message.id)}"><details class="context-summary"><summary>前文已压成摘要 · ${escapeHtml(chineseNumber(message.compacted || 0, true))}条</summary><div class="context-summary-body">${renderMarkdown(message.summary)}</div></details><button type="button" class="context-toggle" data-toggle-compacted>展开前文</button></div>`
      : `<div class="context-divider" data-message="${escapeHtml(message.id)}"><span>上下文由此重新开始</span></div>`;
  if (message.role === "user" && message.relay) return relayHtml(message, branch);
  if (message.role === "user") {
    if (editingMessageId === message.id)
      return `<article class="message user" data-message="${escapeHtml(message.id)}"><div class="message-editor"><textarea class="message-edit-input">${escapeHtml(message.content)}</textarea><div class="edit-actions"><button class="message-action" data-action="cancel-edit">取消</button><button class="message-action edit-save" data-action="save-edit">保存并重答</button></div></div></article>`;
    const files = message.attachments?.length
      ? `<div class="sent-attachments">${message.attachments.map(file => attachmentCard(file, null, true)).join("")}</div>`
      : "";
    const quote = message.quote?.text
      ? `<div class="user-quote" data-quote-source="${escapeHtml(message.quote.messageId || "")}" title="回到出处">${escapeHtml(message.quote.text)}</div>`
      : "";
    return `<article class="message user" data-message="${escapeHtml(message.id)}">${side ? "" : noteMarkHtml(message)}${files}${quote}${message.content ? `<div class="user-bubble">${escapeHtml(message.content)}</div>` : ""}<div class="message-actions${branch ? " has-branch" : ""}">${branchNavHtml(branch)}${actionIcon("copy", "复制消息", icons.copy)}${actionIcon("edit", "编辑消息", icons.edit)}</div></article>`;
  }
  return assistantShellHtml(message);
}
// 正文开头带 <think>…</think> 的旧消息（导入或此前的版本）：渲染时按思考 + 正文拆开看，不改动存下的原文
const INLINE_THINK = /^\s*<think>([\s\S]*?)<\/think>\s*/;
function inlineThinkView(message) {
  const match =
    message.status !== "streaming" && !message.reasoning && typeof message.content === "string"
      ? message.content.match(INLINE_THINK)
      : null;
  return match ? { ...message, reasoning: match[1].trim(), content: message.content.slice(match[0].length) } : message;
}
/** @param {Message} message */
function splitInlineThink(message) {
  const view = inlineThinkView(message);
  if (view !== message) {
    message.reasoning = view.reasoning;
    message.content = view.content;
  }
}
/** @param {Message} message */
function assistantNoteHtml(message) {
  return message.status === "error"
    ? `<div class="message-error">${escapeHtml(message.error || "请求失败")}</div>`
    : message.status === "interrupted"
      ? `<div class="resume-note">连接中断，已生成的内容均已保留，可由此续写。</div>`
      : "";
}
/** @param {Message} message */
function assistantActionsHtml(message) {
  return message.status === "streaming"
    ? ""
    : message.status === "error"
      ? actionIcon("retry", "重试", icons.retry)
      : message.status === "interrupted"
        ? `${message.content ? actionIcon("copy", "复制已生成内容", icons.copy) : ""}${actionIcon("resume", "继续生成", icons.resume)}${actionIcon("retry", "从头重试", icons.retry)}`
        : `${actionIcon("copy", "复制回复", icons.copy)}${actionIcon("regenerate", "重新生成", icons.regenerate)}${actionIcon("note", "旁注", icons.note)}${messageCostHtml(message)}`;
}
// 这一答耗了多少墨：各轮请求的用量之和（含帮手），接口报了用量就用实数，没报则按字数估；当前上下文有多大另看右下角
/** @param {Message} message */
function messageCostHtml(message) {
  const n = Number(message.tokenCount) || 0;
  if (!n) return "";
  const heavy = n >= CONTEXT_HEAVY;
  return `<span class="message-cost${heavy ? " heavy" : ""}" title="这一答共耗约 ${formatTokens(n)} token${message.tokenEstimated ? "（估算）" : ""}${heavy ? "；上下文已重，可压缩前文" : ""}">耗墨 ${message.tokenEstimated ? "≈ " : ""}${formatTokens(n)}</span>`;
}
// 一答收尾：就地画成定稿的样子（图表、沙箱、展开状态和滚动位置都原样保留，收笔时不再闪一下）；这条不在页上就整段重画
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
function finalizeAssistant(conversation, assistant) {
  const article = conversation.ended ? null : document.querySelector(`#messages [data-message="${CSS.escape(assistant.id)}"]`);
  if (!article) return renderConversation(followBottom);
  paintAssistant(/** @type {HTMLElement} */ (article), assistant);
  nodeSig.set(article, messageSig(assistant, branchFor(assistant)));
  $("#chatScroll").classList.remove("generating");
  renderHelperBar();
  if (followBottom) requestAnimationFrame(scrollBottom);
}

// 模型菜单：各处的模型签点开同一张菜单，挂到被点的那枚旁边；菜单里选模型、选思考档位、选预设
function bindModelMenuEvents() {
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "modelMenu");
    button.setAttribute("aria-expanded", "false");
    button.onclick = e => {
      e.stopPropagation();
      const menu = $("#modelMenu"),
        opening = menu.classList.contains("hidden") || menu.classList.contains("leaving");
      if (menu.parentElement !== button.parentElement) {
        menu.classList.add("hidden");
        menu.classList.remove("leaving", "drop-up");
        button.parentElement.append(menu);
      }
      if (!opening) {
        closeModelMenu();
        return;
      }
      renderModelMenu();
      showNow(menu);
      button.setAttribute("aria-expanded", "true");
      positionModelMenu(button);
    };
  });
  document.addEventListener("click", closeModelMenu);
  window.addEventListener("resize", () => {
    const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
    if (trigger) positionModelMenu(trigger);
  });
  $("#modelMenu").addEventListener("click", e => {
    const level = e.target.closest("[data-reasoning]");
    if (level) {
      e.stopPropagation();
      const c = currentConversation();
      const profile = activeProfile();
      if (!profile) return;
      profile.reasoning = normalizeReasoning(level.dataset.reasoning);
      if (c) c.reasoning = profile.reasoning;
      saveStore();
      renderModelMenu();
      renderModelTriggers();
      const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
      if (trigger) positionModelMenu(trigger);
      return;
    }
    const preset = e.target.closest("[data-preset]");
    if (preset) return selectPreset(preset.dataset.preset);
    const item = e.target.closest("[data-profile]");
    if (!item) return;
    selectProfile(item.dataset.profile);
    // 这个模型还没探过认哪几档：探一下，发送键旁的标签与菜单跟着换（探不成就按通用四档，撞了错再学）
    const picked = activeProfile();
    if (picked && !reasoningProbed(picked))
      void probeReasoningLevels(picked).then(levels => {
        if (levels === null || activeProfile() !== picked) return;
        renderModelTriggers();
        if ($("#modelMenu")?.classList.contains("hidden") === false) renderModelMenu();
      });
  });
}

// 正文的滚动：跟随到底、回到最新、右侧加宽的滚动条命中层
function bindScrollEvents() {
  // 跟随的规矩：往下滚到离底不远就算到底、开始跟随（生成中内容一直在长，硬要滚到最后一像素常常追不上）；
  // 往上滚离底超过阈值才算离开。内容自己长高、缩短引起的滚动不算用户的意思
  let lastScrollTop = 0;
  $("#chatScroll").addEventListener("scroll", () => {
    const el = $("#chatScroll"),
      gap = el.scrollHeight - el.scrollTop - el.clientHeight,
      down = el.scrollTop > lastScrollTop;
    lastScrollTop = el.scrollTop;
    if (gap < 8 || (down && gap < FOLLOW_THRESHOLD)) {
      followBottom = true;
      autoScrolling = false;
    } else if (!down && !autoScrolling && gap > FOLLOW_THRESHOLD) followBottom = false;
    syncJumpBottom(gap);
    syncOutline();
    syncRunningHead();
  });
  $("#runningHead").addEventListener("click", () => $("#chatScroll").scrollTo({ top: 0, behavior: "smooth" }));
  $("#trailFold").addEventListener("click", () => {
    const trail = $("#trailFold")._trail;
    if (!trail?.isConnected) return;
    // 与亲手点行迹题头同一条路：记在消息上，流式期间不再被自动摊开
    trail.querySelector(":scope > summary").click();
    scrollChatTo(trail);
  });
  // 跟着的时候，内容不论因何长高（工具输出、图表成图、图片载入、块的开合）都贴着底：不只靠流式的每一帧。
  // 「回到最新」也跟着尺寸重算：下方的行迹、思绪一收短，人没动、没有滚动事件，已到底了按钮却还挂着；
  // 输入框长高变矮改的是视口，一并看着
  if (typeof ResizeObserver === "function") {
    const sizes = new ResizeObserver(() => {
      if (followBottom && view === "chat" && currentId) scrollBottom();
      syncJumpBottom();
      syncChatScrollGrabber();
    });
    sizes.observe($("#messages"));
    sizes.observe($("#chatScroll"));
  }
  $("#chatScroll").addEventListener(
    "wheel",
    e => {
      if (e.deltaY < 0 && !wheelScrollsInner(e)) followBottom = false;
    },
    { passive: true }
  );
  $("#chatScroll").addEventListener(
    "pointerdown",
    () => {
      autoScrolling = false;
    },
    { passive: true }
  );
  // 右侧透明命中层把细滚动条的可抓宽度放大，也越过输入框覆盖区一直延伸到底部。
  // 按下轨道会把滑块移到指针处；按住近似滑块则保留抓取点，拖动手感与原生滚动条一致。
  const scrollGrabber = $("#chatScrollGrabber"),
    chatScroll = $("#chatScroll");
  let scrollDrag = null;
  const scrollGeometry = () => {
    const max = Math.max(0, chatScroll.scrollHeight - chatScroll.clientHeight),
      track = chatScroll.clientHeight,
      thumb = Math.min(track, Math.max(28, (track * track) / Math.max(chatScroll.scrollHeight, 1)));
    return { rect: chatScroll.getBoundingClientRect(), max, track, thumb, travel: Math.max(1, track - thumb) };
  };
  const moveScrollGrabber = event => {
    if (!scrollDrag || event.pointerId !== scrollDrag.pointerId) return;
    const geometry = scrollGeometry(),
      pointer = Math.max(0, Math.min(geometry.track, event.clientY - geometry.rect.top));
    chatScroll.scrollTop = Math.max(0, Math.min(geometry.max, ((pointer - scrollDrag.offset) / geometry.travel) * geometry.max));
  };
  const stopScrollGrabber = event => {
    if (!scrollDrag || event.pointerId !== scrollDrag.pointerId) return;
    try {
      scrollGrabber.releasePointerCapture(event.pointerId);
    } catch {}
    scrollDrag = null;
  };
  scrollGrabber.addEventListener("pointerdown", event => {
    const geometry = scrollGeometry();
    if (event.button !== 0 || !geometry.max || getComputedStyle(chatScroll).overflowY === "hidden") return;
    event.preventDefault();
    autoScrolling = false;
    followBottom = false;
    const pointer = Math.max(0, Math.min(geometry.track, event.clientY - geometry.rect.top)),
      thumbTop = (chatScroll.scrollTop / geometry.max) * geometry.travel,
      withinThumb = pointer >= thumbTop && pointer <= thumbTop + geometry.thumb;
    scrollDrag = {
      pointerId: event.pointerId,
      offset: withinThumb ? pointer - thumbTop : geometry.thumb / 2
    };
    try {
      scrollGrabber.setPointerCapture(event.pointerId);
    } catch {}
    moveScrollGrabber(event);
  });
  scrollGrabber.addEventListener("pointermove", moveScrollGrabber);
  scrollGrabber.addEventListener("pointerup", stopScrollGrabber);
  scrollGrabber.addEventListener("pointercancel", stopScrollGrabber);
  scrollGrabber.addEventListener(
    "wheel",
    event => {
      if (!scrollGrabber.classList.contains("active")) return;
      const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? chatScroll.clientHeight : 1;
      if (event.deltaY < 0) followBottom = false;
      chatScroll.scrollTop += event.deltaY * scale;
      event.preventDefault();
    },
    { passive: false }
  );
  // 生成时向上翻阅后，给一枚「回到最新」；贴近底部自动隐去
  $("#jumpBottom").onclick = () => {
    const el = $("#chatScroll");
    followBottom = true;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion.matches ? "instant" : "smooth" });
  };
}
