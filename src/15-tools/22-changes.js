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
// ---- 并排红绿：旧在左、新在右，逐行对齐（见 设计稿/38、39） ----
// 行迹里改一处的旧段与新段、预览浮层里覆盖写的前后两版，都走这一套
/** 两列序列的最长公共子序列，摊成一串 s（同）/ d（删）/ i（增）；两样都行时先删后增 @param {string[]} a @param {string[]} b */
function lcsOps(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  /** @type {Array<[string, string]>} */
  const ops = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push(["s", a[i++]]);
      j++;
    } else if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) ops.push(["d", a[i++]]);
    else ops.push(["i", b[j++]]);
  }
  return ops;
}
// 行内按词比：英文数字连成一词，汉字与标点逐个
const diffTokens = (/** @type {string} */ line) => line.match(/[A-Za-z0-9_$]+|\s+|[^\sA-Za-z0-9_$]/gu) || [];
// 两行像不像：去掉空白后同词占四成以上才算「改了这一行」，否则是删一行、另增一行
function linesAlike(a, b) {
  const x = diffTokens(a).filter(t => t.trim()),
    y = diffTokens(b).filter(t => t.trim());
  if (!x.length || !y.length || x.length * y.length > 40000) return false;
  return (2 * lcsOps(x, y).filter(op => op[0] === "s").length) / (x.length + y.length) >= 0.4;
}
// 配上对的两行：改了的那几个字包进 <mark>
function wordMarks(oldLine, newLine) {
  const a = diffTokens(oldLine),
    b = diffTokens(newLine);
  if (a.length * b.length > 40000) return [escapeHtml(oldLine), escapeHtml(newLine)];
  let left = "",
    right = "";
  for (const [kind, text] of lcsOps(a, b)) {
    if (kind !== "i") left += kind === "d" ? `<mark>${escapeHtml(text)}</mark>` : escapeHtml(text);
    if (kind !== "d") right += kind === "i" ? `<mark>${escapeHtml(text)}</mark>` : escapeHtml(text);
  }
  return [left, right].map(html => html.replaceAll("</mark><mark>", ""));
}
// 一段连着的删与增怎么排：按先后，删的那行往后找第一行像它的配成一对，跳过的新行单独成行
/** @param {string[]} dels @param {string[]} ins */
function pairLines(dels, ins) {
  /** @type {Array<{ d?: string, i?: string }>} */
  const out = [];
  let j = 0;
  for (const d of dels) {
    let hit = -1;
    for (let k = j; k < ins.length; k++)
      if (linesAlike(d, ins[k])) {
        hit = k;
        break;
      }
    if (hit < 0) {
      out.push({ d });
      continue;
    }
    while (j < hit) out.push({ i: ins[j++] });
    out.push({ d, i: ins[j++] });
  }
  while (j < ins.length) out.push({ i: ins[j++] });
  return out;
}
/**
 * 前后两版比出并排的各行：成片未动的只留改动上下各两行、中间折成「⋯ n 行未动」；两边共有的缩进一起去掉。
 * limit 只画前几行（行迹里先看前 20 行，「展开全部」再看全），比对总按全文来——先截后比会把截掉的行当成删了。
 * wrap 为假时一行放不下只放写得下的，末尾省略、悬停看整行（行迹里一步不该被一行长注释撑成半屏）；预览浮层与展开全部时照常折行
 * @param {string} oldText @param {string} newText @param {{ limit?: number, wrap?: boolean }} [options]
 * @returns {{ html: string, rows: number, clipped: boolean, added: number, removed: number }}
 */
function splitDiffHtml(oldText, newText, { limit = Infinity, wrap = true } = {}) {
  const lines = text =>
    text
      ? String(text)
          .replace(/\r?\n$/, "")
          .split(/\r?\n/)
      : [];
  let a = lines(oldText),
    b = lines(newText);
  // 太长的不逐行比，仍是旧的一块、新的一块
  if (a.length * b.length > 250000)
    return {
      html: `<pre class="tool-output diff-del">${escapeHtml(a.join("\n"))}</pre><pre class="tool-output diff-ins">${escapeHtml(b.join("\n"))}</pre>`,
      rows: 0,
      clipped: false,
      added: b.length,
      removed: a.length
    };
  const lead = Math.min(...[...a, ...b].filter(line => line.trim()).map(line => line.match(/^ */)[0].length));
  if (lead > 0 && Number.isFinite(lead)) [a, b] = [a, b].map(lines => lines.map(line => line.slice(Math.min(lead, line.length))));
  const ops = lcsOps(a, b),
    near = ops.map((_, k) => ops.slice(Math.max(0, k - 2), k + 3).some(op => op[0] !== "s"));
  /** @type {string[]} */
  const rows = [];
  let skipped = 0,
    added = 0,
    removed = 0;
  const gap = () => {
    if (skipped) rows.push(`<span class="gap">⋯ ${skipped} 行未动</span>`);
    skipped = 0;
  };
  const cell = (kind, html, raw = "") =>
    html === null
      ? `<span class="e"></span>`
      : `<span class="${kind}"${!wrap && raw.length > 30 ? ` title="${escapeHtml(raw)}"` : ""}>${html || " "}</span>`;
  for (let k = 0; k < ops.length; ) {
    if (ops[k][0] === "s") {
      if (!near[k]) skipped++;
      else {
        gap();
        rows.push(cell("s", escapeHtml(ops[k][1]), ops[k][1]).repeat(2));
      }
      k++;
      continue;
    }
    gap();
    const dels = [],
      ins = [];
    while (k < ops.length && ops[k][0] !== "s") (ops[k][0] === "d" ? dels : ins).push(ops[k++][1]);
    removed += dels.length;
    added += ins.length;
    for (const { d, i } of pairLines(dels, ins)) {
      const [left, right] =
        d !== undefined && i !== undefined
          ? wordMarks(d, i)
          : [d === undefined ? null : escapeHtml(d), i === undefined ? null : escapeHtml(i)];
      rows.push(cell("d", left, d) + cell("i", right, i));
    }
  }
  gap();
  const shown = rows.slice(0, limit);
  return {
    html: `<div class="tool-output split-diff${wrap ? "" : " clip"}">${shown.join("")}</div>`,
    rows: rows.length,
    clipped: shown.length < rows.length,
    added,
    removed
  };
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
      if (step.diff) return `${head}<div class="tool-diff">${splitDiffHtml(step.diff.old, step.diff.new).html}</div>`;
      // 新建的件（或没记下原文的）也并排画：左边留空，与改动同一种画法，不一会儿整宽一会儿两栏
      if (step.written !== undefined)
        return `${head}<div class="tool-diff">${splitDiffHtml(created ? "" : (step.previous ?? ""), step.written).html}</div>`;
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
// 成品：言里这一答在卷宗根目录新出或改过的文件。一件一行：件图、文件名、大小，右侧「看」（悬浮预览）与「下载」
// 卷宗里已经删掉的成品：条目留着（这一答确实出过这件），但标成「已移出卷宗」，不再给看与下载的按钮
function deliverableMissing(path) {
  return archiveEntries !== null && !archiveEntries.some(entry => entry.path === path);
}
function deliverableFileHtml(f) {
  const missing = deliverableMissing(f.path);
  return `<div class="deliver-file${missing ? " missing" : ""}" data-deliver="${escapeHtml(f.path)}">${fileFigure(f.name, f.path)}<span class="deliver-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span><small>${formatFileSize(f.size)}</small>${
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
