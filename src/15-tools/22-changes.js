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
    const entry = files.get(step.change.path) || {
      path: step.change.path,
      added: 0,
      removed: 0,
      created: false,
      helper: false,
      lines: undefined
    };
    entry.added += step.change.added;
    entry.removed += step.change.removed;
    entry.created ||= !!step.change.created;
    entry.helper ||= !!step.scope;
    // 早先记下的步骤没有 lines；整份写入那一步的增即是写后的行数
    entry.lines = step.change.lines ?? (step.written !== undefined ? step.change.added : undefined);
    files.set(step.change.path, entry);
  }
  // 这一答里新建的件，净改动就是「增了它现在这么多行」：中途重写几遍删去的，是删自己刚写的，不算删
  for (const entry of files.values())
    if (entry.created && entry.lines !== undefined) {
      entry.added = entry.lines;
      entry.removed = 0;
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
// 清单一件一行：目录淡、文件名浓，新建 / 帮手所改的小注，增删行数（为零的不着色）；点一行看这件的改动
function changeFilesHtml(stats, open, extra = "") {
  return `<div class="change-files${extra}${open ? "" : " hidden"}">${stats.files
    .map((f, i) => {
      const tags = [f.created ? "新建" : "", f.helper ? "帮手" : ""].filter(Boolean).join(" · "),
        cut = f.path.lastIndexOf("/") + 1;
      return `<button type="button" data-change-path="${escapeHtml(f.path)}" title="看 ${escapeHtml(f.path)} 的改动" style="--i:${Math.min(i, 12)}"><span class="path">${cut ? `<span class="dir">${escapeHtml(f.path.slice(0, cut))}</span>` : ""}${escapeHtml(f.path.slice(cut))}${tags ? `<em>${tags}</em>` : ""}</span><span class="ins${f.added ? "" : " zero"}">+${f.added}</span><span class="del${f.removed ? "" : " zero"}">−${f.removed}</span></button>`;
    })
    .join("")}</div>`;
}
// 覆盖写的前后两版逐行对齐：删的红、增的绿，成片相同的只留上下两行、中间折成一行「⋯」
function lineDiffHtml(oldText, newText) {
  const a = String(oldText)
      .replace(/\r?\n$/, "")
      .split(/\r?\n/),
    b = String(newText)
      .replace(/\r?\n$/, "")
      .split(/\r?\n/);
  if (a.length * b.length > 250000)
    return `<pre class="tool-output diff-del">${escapeHtml(oldText)}</pre><pre class="tool-output diff-ins">${escapeHtml(newText)}</pre>`;
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push(["s", a[i]]);
      i++;
      j++;
      // 两样都行时先删后增：删去的旧行排在补上的新行之前
    } else if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) rows.push(["d", a[i++]]);
    else rows.push(["i", b[j++]]);
  }
  const near = rows.map((_, k) => rows.slice(Math.max(0, k - 2), k + 3).some(row => row[0] !== "s"));
  let html = "",
    skipped = 0;
  rows.forEach(([kind, text], k) => {
    if (kind === "s" && !near[k]) return void skipped++;
    if (skipped) html += `<span class="gap">⋯ ${skipped} 行未动</span>`;
    skipped = 0;
    html += `<span class="${kind}">${escapeHtml(text) || " "}</span>`;
  });
  if (skipped) html += `<span class="gap">⋯ ${skipped} 行未动</span>`;
  return `<pre class="tool-output diff-lines">${html}</pre>`;
}
// 一件文件在这一答里的改动：不另起接口、不另存一份，用的就是各步本来记着的——改文件那步的前后两段（行迹里同一副红绿），
// 写文件那步写下的内容与它覆盖掉的原文（逐行比出红绿）；按先后排，摊在预览浮层里。帮手改的也在内。
// 这一答里新建的件，从它最后一回整份写入看起：之前几版是草稿，与清单上「只增不删」对得上
/** @param {Message} message @param {string} path */
function changeDiffHtml(message, path) {
  let steps = allSteps(message).filter(step => step.change?.path === path && step.status === "done");
  const created = steps.some(step => step.change.created),
    lastWrite = steps.findLastIndex(step => step.written !== undefined);
  if (created && lastWrite > 0) steps = steps.slice(lastWrite);
  return `<div class="file-viewer-text change-diff">${steps
    .map(step => {
      const note = [toolLabel(step.name), step.scope ? "帮手" : "", step.result || step.note || ""].filter(Boolean).join(" · "),
        head = `<p class="file-viewer-note">${escapeHtml(note)}</p>`;
      if (step.diff)
        return `${head}<div class="tool-diff"><pre class="tool-output diff-del">${escapeHtml(step.diff.old)}</pre><pre class="tool-output diff-ins">${escapeHtml(step.diff.new)}</pre></div>`;
      if (step.written !== undefined && step.previous !== undefined && !created)
        return `${head}<div class="tool-diff">${lineDiffHtml(step.previous, step.written)}</div>`;
      if (step.written !== undefined)
        return `${head}<div class="tool-diff"><pre class="tool-output diff-ins">${escapeHtml(step.written)}</pre></div>`;
      return head;
    })
    .join("")}</div>`;
}
/** @param {Message} message @param {string} path @param {Element} trigger */
function openChangeDiff(message, path, trigger) {
  showInFileViewer(`${path} · 这一答的改动`, changeDiffHtml(message, path), trigger);
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
  return archiveEntries !== null && !archiveEntries.some(entry => entry.path === path);
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
