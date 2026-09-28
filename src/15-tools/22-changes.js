// 言 · 改动与成品：执事这一答改过哪些文件（改动条），言这一答在卷宗里新出了哪几件（成品条）
// 改动摘要：这一答里执事改过哪些文件、各增减多少行。生成中附在输入框上的工作条里实时累加（见 renderHelperBar），
// 不跟着正文尾巴跑；写完才落到回复之下，是一道线而不是一只框（见 设计稿/12-改动条与行迹）
function diffCounts(oldText, newText) {
  const a = String(oldText || "").split(/\r?\n/),
    b = String(newText || "").split(/\r?\n/);
  if (!oldText) return { added: b.length, removed: 0 };
  if (!newText) return { added: 0, removed: a.length };
  if (a.length * b.length > 250000) return { added: b.length, removed: a.length };
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const common = dp[0][0];
  return { added: b.length - common, removed: a.length - common };
}
/** @param {{ steps?: Step[] }} message */
function changeStats(message) {
  const files = new Map();
  for (const step of allSteps(message)) {
    if (!step.change || step.status !== "done") continue;
    const entry = files.get(step.change.path) || { path: step.change.path, added: 0, removed: 0, created: false, helper: false };
    entry.added += step.change.added;
    entry.removed += step.change.removed;
    entry.created ||= !!step.change.created;
    entry.helper ||= !!step.scope;
    files.set(step.change.path, entry);
  }
  const list = [...files.values()];
  return { files: list, added: list.reduce((sum, f) => sum + f.added, 0), removed: list.reduce((sum, f) => sum + f.removed, 0) };
}
// 增删的比例画成五枚小方块：绿的是增、朱的是删，余下留白
function changeSpark(added, removed) {
  const total = added + removed,
    green = total ? Math.round((5 * added) / total) : 0,
    red = total ? Math.min(5 - green, Math.round((5 * removed) / total)) : 0;
  return `<span class="change-spark" aria-hidden="true">${'<i class="g"></i>'.repeat(green)}${'<i class="r"></i>'.repeat(red)}${"<i></i>".repeat(5 - green - red)}</span>`;
}
function changeCountHtml(stats) {
  return `<span class="ins">+${stats.added}</span> <span class="del">−${stats.removed}</span>`;
}
// 清单一件一行：路径、新建 / 帮手所改的小注、增删行数
function changeFilesHtml(stats, open, extra = "") {
  return `<div class="change-files${extra}${open ? "" : " hidden"}">${stats.files
    .map(f => {
      const tags = [f.created ? "新建" : "", f.helper ? "帮手" : ""].filter(Boolean).join(" · ");
      return `<div><span class="path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}${tags ? `<em>${tags}</em>` : ""}</span><span class="ins">+${f.added}</span><span class="del">−${f.removed}</span></div>`;
    })
    .join("")}</div>`;
}
/** @param {Message} message */
function changeSummaryInner(message, open) {
  const stats = changeStats(message);
  if (!stats.files.length) return "";
  return `<button type="button" class="change-summary" aria-expanded="${open}"><span class="seal change-seal" aria-hidden="true">改</span><span class="change-title">改动 ${stats.files.length} 个文件</span><span class="change-count">${changeCountHtml(stats)}${changeSpark(stats.added, stats.removed)}</span></button>${changeFilesHtml(stats, open)}`;
}
// 成品：言里这一答在卷宗根目录新出或改过的文件。一件一行：类型、文件名、大小，右侧「看」（悬浮预览）与「下载」
// 卷宗里已经删掉的成品：条目留着（这一答确实出过这件），但标成「已移出卷宗」，不再给看与下载的按钮
function deliverableMissing(path) {
  return archiveOnline() && archiveEntries !== null && !archiveEntries.some(entry => entry.path === path);
}
function deliverableFileHtml(f) {
  const missing = deliverableMissing(f.path);
  return `<div class="deliver-file${missing ? " missing" : ""}" data-deliver="${escapeHtml(f.path)}"><span class="deliver-type">${escapeHtml(fileTypeLabel(f))}</span><span class="deliver-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span><small>${formatFileSize(f.size)}</small>${
    missing
      ? `<span class="deliver-gone">已移出卷宗</span>`
      : `<button type="button" class="deliver-btn" data-deliver-action="view" title="在此预览，不必下载">预览</button><button type="button" class="deliver-btn" data-deliver-action="download" title="另存到本机">下载</button>`
  }</div>`;
}
/** @param {Message} message */
function deliverablesHtml(message) {
  const files = message.deliverables || [];
  if (!files.length) return "";
  return `<div class="deliver-bar"><div class="deliver-head"><span class="seal deliver-seal" aria-hidden="true">成</span><span>成品 ${files.length} 件 · 已入卷宗</span></div>${files.map(deliverableFileHtml).join("")}</div>`;
}
// 卷宗目录刷新后，把页面上成品条里各件的在与不在同步一遍（消息本身没变，不必重画整条）
function syncDeliverables() {
  for (const bar of document.querySelectorAll(".deliver-bar")) {
    const article = bar.closest("[data-message]"),
      c = currentConversation(),
      message = c && allMessages(c).find(m => m.id === article?.dataset.message);
    if (!message?.deliverables?.length) continue;
    const html = message.deliverables.map(deliverableFileHtml).join("");
    const current = [...bar.querySelectorAll(".deliver-file")].map(node => node.outerHTML).join("");
    if (current !== html) bar.querySelectorAll(".deliver-file").forEach(node => node.remove()), bar.insertAdjacentHTML("beforeend", html);
  }
}
/** @param {Message} message */
function changeSummaryHtml(message, open = false) {
  const inner = message.status === "streaming" ? "" : changeSummaryInner(message, open);
  return inner ? `<div class="change-bar">${inner}</div>` : "";
}
// 回复之下的改动条：生成中不画（那时改动在输入框上方的工作条里），写完落下来时轻浮一下；数字就地更新，展开状态保留
/** @param {Message} assistant */
function syncChangeBar(block, assistant) {
  const bar = block.querySelector(":scope > .change-bar"),
    open = bar?.querySelector(".change-summary")?.getAttribute("aria-expanded") === "true",
    inner = assistant.status === "streaming" ? "" : changeSummaryInner(assistant, open);
  if (!inner) return bar?.remove();
  if (!bar) {
    block.insertAdjacentHTML("beforeend", `<div class="change-bar is-new">${inner}</div>`);
  } else if (bar.innerHTML !== inner) bar.innerHTML = inner;
}
