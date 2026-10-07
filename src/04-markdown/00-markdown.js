// 言 · Markdown：marked 解析、DOMPurify 净化、代码高亮、公式；正文嵌件的登记表
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 正文嵌件：正文里的一种写法认作一种嵌件，由它自己画、自己起 ----------
// 正文本是 Markdown；要在里头放一块别的东西（交互网页、公式……），不在渲染里逐个加分支，而是登记一种嵌件：
//   fence(language, text)   认围栏代码块：这一块归它就回 true
//   pending(text, language) 流式尾段里这块还没写完时的占位（外框用 .viz-pending，尾段重画时它留在原处不闪，见 paintTail）；不给就照常显示代码
//   html(text, language)    写完了的样子
//   mount(root)             画进页面之后再起来的一步（沙箱载入、库到了补画……）；正文、旁注、预览每回画完都走一遍
//   bind()                  开页时接一次的事件（工具条的点按、沙箱报来的消息……）
// 只给 mount 的是借别的写法落进正文的（公式由 marked 的扩展画占位、引用的画面是带 data-file 的链接），画完了在这里补。
// 加一种嵌件只需一份登记；交互网页见 10-html-app.js。链接也可照此认作入口（在 marked 的 link 上查一遍登记），眼下没有要的，便没接
/** @typedef {{ name: string, fence?: (language: string, text: string) => boolean, pending?: (text: string, language: string) => string, html?: (text: string, language: string) => string, mount?: (root: Element) => void, bind?: () => void }} Embed */
/** @type {Embed[]} */
const EMBEDS = [];
/** @param {Embed} embed */
function defineEmbed(embed) {
  EMBEDS.push(embed);
}
// ---------- Markdown：marked 解析、DOMPurify 净化、highlight.js 代码高亮、KaTeX 公式 ----------
const PURIFY_OPTIONS = { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "iframe", "object", "embed"] };
function setupMarkdown() {
  if (!window.marked) return;
  const inlineMath = {
    name: "mathInline",
    level: "inline",
    start(src) {
      const m = src.match(/\$(?!\s)|\\\(/);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const m = src.match(/^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/) || src.match(/^\\\(([\s\S]+?)\\\)/);
      return m ? { type: "mathInline", raw: m[0], text: m[1] } : undefined;
    },
    renderer(token) {
      return renderMath(token.text, false);
    }
  };
  const blockMath = {
    name: "mathBlock",
    level: "block",
    start(src) {
      const m = src.match(/\$\$|\\\[/);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$(?:\n+|$)/) || src.match(/^\\\[([\s\S]+?)\\\](?:\n+|$)/);
      return m ? { type: "mathBlock", raw: m[0], text: m[1].trim() } : undefined;
    },
    renderer(token) {
      return `<div class="math-block">${renderMath(token.text, true)}</div>\n`;
    }
  };
  marked.use({
    gfm: true,
    breaks: true,
    renderer: {
      code({ text, lang }) {
        return codeBlockHtml(text, lang);
      }
    },
    extensions: [blockMath, inlineMath]
  });
  if (window.DOMPurify) {
    // 模型写「下载《x.docx》」时常把链接指向 sandbox:/、file:/// 或一个裸文件名——页面上没有这样的路。
    // 把文件名记在 data-file、原路记在 data-path 上，去掉 href；点击时按原路在这段对话的落脚处取那件来下载，取不到再到卷宗里找同名的（见 10-archive.js）。
    // 图片同理：![截图](page-1.png) 的 src 也记成 data-file，是这一答工具交回的画面就画成那幅（见 renderReplyShots）
    DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
      if (!((node.tagName === "A" && data.attrName === "href") || (node.tagName === "IMG" && data.attrName === "src"))) return;
      const name = localFileName(data.attrValue);
      if (!name) return;
      node.setAttribute("data-file", name);
      node.setAttribute("data-path", data.attrValue);
      data.keepAttr = false;
    });
    DOMPurify.addHook("afterSanitizeAttributes", node => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (node.tagName === "INPUT") node.setAttribute("disabled", "");
    });
  }
}
// 不是网址、末段像个文件名的链接：取出文件名。网址、邮件、页内锚点都不算
function localFileName(href) {
  const raw = String(href || "").trim();
  if (!raw || /^(?:https?|mailto|tel|data|blob):/i.test(raw) || raw.startsWith("#")) return "";
  let name = raw
    .replace(/[?#].*$/, "")
    .split(/[\\/]/)
    .pop();
  try {
    name = decodeURIComponent(name);
  } catch {}
  return /^[^<>:"|?*\u0000-\u001f]+\.[a-z0-9]{1,8}$/i.test(name) ? name : "";
}
function renderMath(tex, display) {
  // KaTeX 未加载时先放一个占位，库到位后由 renderPendingMath 就地替换；流式尾段每帧重绘，加载完成后自然变成正式渲染
  if (!window.katex) {
    void ensureLib("katex");
    return `<span class="math-pending" data-tex="${escapeHtml(tex)}" data-display="${display ? "1" : "0"}"><code>${escapeHtml(tex)}</code></span>`;
  }
  try {
    return window.katex
      ? katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" })
      : `<code>${escapeHtml(tex)}</code>`;
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}
// 尾段每帧整段重画，占位框若跟着重建，虚痕的呼吸每帧都从头来一遍：这里把已在页上的那个占位框留在原处不动，
// 只换它周围的内容；行数变了就让虚痕吸一口墨
function paintTail(tail, html) {
  const live = [...tail.querySelectorAll(".viz-pending")].at(-1);
  if (!live || live.parentNode !== tail) {
    tail.innerHTML = html;
    return;
  }
  const fresh = document.createElement("div");
  fresh.innerHTML = html;
  const next = [...fresh.querySelectorAll(".viz-pending")].at(-1);
  if (!next || next.parentNode !== fresh || next.dataset.vizPending !== live.dataset.vizPending) {
    tail.innerHTML = html;
    return;
  }
  const grew = live.dataset.lines !== next.dataset.lines;
  live.dataset.lines = next.dataset.lines;
  if (grew) pulseInkStroke(live);
  live.setAttribute("aria-label", next.getAttribute("aria-label"));
  for (const node of [...tail.childNodes]) if (node !== live) node.remove();
  const before = [],
    after = [];
  let seen = false;
  for (const node of [...fresh.childNodes]) {
    if (node === next) seen = true;
    else (seen ? after : before).push(node);
  }
  live.before(...before);
  live.after(...after);
}
function codeBlockHtml(text, lang) {
  const language = String(lang || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase(),
    known = !!(window.hljs && language && hljs.getLanguage(language));
  // 归哪种嵌件就由它画：流式尾段还没写完时画占位（不给占位的照常显示代码）
  const embed = EMBEDS.find(item => item.fence?.(language, text));
  if (embed && !suppressViz) return embed.html(text, language);
  if (embed?.pending) return embed.pending(text, language);
  let html;
  try {
    html = known ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
  } catch {
    html = escapeHtml(text);
  }
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${escapeHtml(language || "text")}</span><button type="button" class="code-copy" data-copy-code>复制</button></div><pre><code class="hljs${known ? ` language-${escapeHtml(language)}` : ""}">${html}</code></pre></div>\n`;
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
async function renderPendingMath(root) {
  if (!root.querySelector(".math-pending") || !(await ensureLib("katex"))) return;
  for (const el of root.querySelectorAll(".math-pending")) {
    el.insertAdjacentHTML(
      "afterend",
      window.DOMPurify ? DOMPurify.sanitize(renderMath(el.dataset.tex || "", el.dataset.display === "1"), PURIFY_OPTIONS) : ""
    );
    el.remove();
  }
}
// 画进页面之后：各种嵌件起来（见上 EMBEDS 的 mount）
function renderEnhancements(root) {
  for (const embed of EMBEDS) embed.mount?.(root);
}
defineEmbed({ name: "math", mount: root => void renderPendingMath(root) });
// 正文里引了这一答工具交回的画面（模型写「![截图](page-1.png)」或「[查看截图](page-1.png)」）：就地画出那幅，点开进图片查看器。
// 原件本就作附件挂在那一步上（见 mcpResultImages），不另存；引的不是这一答的画面，照旧当卷宗里的文件
/** @param {Element} root */
function renderReplyShots(root) {
  const refs = root.querySelectorAll?.(".markdown [data-file]") || [];
  if (!refs.length) return;
  const c = currentConversation(),
    messages = c ? everyMessage(c) : [];
  for (const ref of refs) {
    const id = ref.closest("[data-message]")?.getAttribute("data-message"),
      message = messages.find(item => item.id === id),
      file = allSteps(message)
        .flatMap(step => step.attachments || [])
        .findLast(item => item.kind === "image" && item.name === ref.getAttribute("data-file"));
    if (!file) continue;
    const shot = document.createElement("span");
    shot.className = "fi fi-thumb reply-shot";
    shot.setAttribute("role", "button");
    shot.tabIndex = 0;
    shot.dataset.openImage = file.id;
    shot.title = `查看 ${file.name}`;
    shot.innerHTML = `<img data-thumb="${escapeHtml(file.id)}" alt="${escapeHtml(ref.getAttribute("alt") || file.name)}">`;
    // 图换成那幅；链接留着字（点了也是看图），画面接在后面
    if (ref.tagName === "IMG") ref.replaceWith(shot);
    else {
      ref.removeAttribute("data-file");
      ref.setAttribute("data-open-image", file.id);
      ref.after(shot);
    }
  }
  void loadThumbnails(root);
}
defineEmbed({ name: "shot", mount: renderReplyShots });
function downloadHref(href, name, revoke = false) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function downloadText(text, type, name) {
  downloadHref(URL.createObjectURL(new Blob([text], { type })), name, true);
}
function renderMarkdown(source = "") {
  const text = String(source).replace(/^\n+|\n+$/g, "");
  if (!text) return "";
  const plain = () => `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  if (!window.marked || !window.DOMPurify) return plain();
  try {
    return DOMPurify.sanitize(marked.parse(liftBareMermaid(text), { async: false }), PURIFY_OPTIONS);
  } catch {
    return plain();
  }
}
// 这段文字末尾是否还在代码围栏里：按 CommonMark 记开围栏的字符与长度，同字符、不短于它、后面没别的字的一行才算合上。
// 只数围栏行的奇偶不行：````markdown 里嵌着 ```bash 时，内层那两行会把里外颠倒
function inOpenFence(text) {
  let open = null;
  for (const line of text.split("\n")) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence) continue;
    if (!open) open = { mark: fence[1][0], length: fence[1].length };
    else if (fence[1][0] === open.mark && fence[1].length >= open.length && !fence[2].trim()) open = null;
  }
  return !!open;
}
// 流式渲染的分段点：最后一个空行，且它前面没有未闭合的代码围栏、后面不是列表 / 缩进 / 表格的延续
function stableCut(content) {
  const listy = line => /^\s*(?:[-*+]|\d+[.)])\s/.test(line) || /^\s+\S/.test(line);
  let cut = content.lastIndexOf("\n\n");
  while (cut > 0) {
    const before = content.slice(0, cut),
      prevLine = before.slice(before.lastIndexOf("\n") + 1),
      nextLine = content.slice(cut + 2).split("\n")[0];
    const inFence = inOpenFence(before);
    const continues =
      /^\s+\S/.test(nextLine) || (listy(nextLine) && listy(prevLine)) || (/^\s*\|/.test(nextLine) && prevLine.includes("|"));
    if (!inFence && !continues) break;
    cut = content.lastIndexOf("\n\n", cut - 1);
  }
  return Math.max(0, cut);
}

// 正文里的代码块：复制；各种嵌件自己的事件由它们各自接上（见 EMBEDS 的 bind）
function bindContentEvents() {
  document.addEventListener("click", e => {
    const copy = e.target.closest("[data-copy-code]");
    if (copy) {
      void copyText(copy.closest(".code-block, .html-app")?.querySelector("code")?.textContent || "");
      // 小画钮不换字（换了画就没了），说一声；代码块上的字钮照旧换成「已复制」
      if (copy.classList.contains("code-icon")) return toast("已复制");
      copy.textContent = "已复制";
      setTimeout(() => (copy.textContent = "复制"), 1200);
    }
  });
  for (const embed of EMBEDS) embed.bind?.();
}
