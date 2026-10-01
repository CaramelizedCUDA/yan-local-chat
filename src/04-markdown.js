// 言 · Markdown、代码高亮、公式、图表与网页沙箱
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
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
    // 把文件名记在 data-file 上、去掉 href，点击时到卷宗里找同名的那件来下载（见 boot 里的处理）；找不到才说没有
    DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
      if (node.tagName !== "A" || data.attrName !== "href") return;
      const name = localFileName(data.attrValue);
      if (!name) return;
      node.setAttribute("data-file", name);
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
// 占位框里的动效在逐帧重画的尾段里会随节点重建从头再来，看着像定住了：把相位记在节点上（负的 animation-delay），重建也接着原来的拍子走
const vizPhase = () => `-${Math.round(performance.now())}ms`;
// 占位框里是一页草图：将要画的东西的底稿（一页版式）——
// 用淡墨一笔一笔勾出来，勾完停一停、淡去、再勾（pathLength 归一，stroke-dashoffset 从 1 走到 0 就是「画出来」，各笔按 --i 错开）。
// 每来一行，草图上有一笔蘸朱（见 pulseInkStroke，由 paintTail 点）：流着时朱笔此起彼伏，流停了草图只剩自己勾着，看得出还在写还是卡住了
const VIZ_SKETCH = [
  "M8 6h144a3 3 0 0 1 3 3v54a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z",
  "M5 18h150",
  "M12 25h30a2 2 0 0 1 2 2v30a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V27a2 2 0 0 1 2-2z",
  "M52 28h92",
  "M52 36h72",
  "M52 44h84",
  "M52 52h26a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H52a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z"
];
function pendingSketchHtml() {
  const strokes = VIZ_SKETCH;
  return `<svg class="viz-sketch" viewBox="0 0 160 72" aria-hidden="true">${strokes.map((d, i) => `<path d="${d}" pathLength="1" style="--i:${i}"/>`).join("")}</svg>`;
}
// 新来一行：草图上轮到的那一笔蘸一口朱墨，随即褪回淡墨
function pulseInkStroke(pending) {
  const strokes = pending.querySelectorAll(".viz-sketch path");
  if (!strokes.length || inkMotionOff()) return;
  const stroke = strokes[(Number(pending.dataset.lines) || 0) % strokes.length];
  if (typeof stroke.animate !== "function") return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#9b5540";
  stroke.animate([{ stroke: accent, opacity: 0.95, offset: 0.12 }, { stroke: accent, opacity: 0.8, offset: 0.4 }, { offset: 1 }], {
    duration: 900,
    easing: "ease-out"
  });
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
  // 页内可视化只有一条路：自足的 HTML 在隔离沙箱里就地渲染（数据图表、流程图也在里面画，见 preview-runtime.js）。
  // 旧对话里的 ```mermaid / ```echarts 换成等价的一页 HTML 照样成图；模型把流程图写进 ```pre 或不标语言的围栏，内容一看就是 mermaid 的，也照画
  const legacy = language === "mermaid" || language === "echarts" || ((language === "pre" || !language) && looksLikeMermaid(text)),
    htmlApp = ["html", "interactive", "app"].includes(language) || legacy;
  // 流式尾段尚未闭合时先立一个占位框，框里是一页草图（见 pendingSketchHtml）
  if (suppressViz && htmlApp) {
    const lines = String(text || "").split("\n").length;
    return `<div class="viz viz-pending" data-viz-pending="html" data-lines="${lines}" style="--phase:${vizPhase()}" role="status" aria-label="交互内容仍在生成，已写 ${lines} 行"><div class="code-head"><span class="code-lang">${language}</span><span class="viz-pending-signal" aria-hidden="true"></span></div><div class="viz-pending-body" aria-hidden="true">${pendingSketchHtml()}</div></div>\n`;
  }
  if (!suppressViz && htmlApp) {
    const source = legacy ? legacyVizHtml(language, text) : text;
    return `<div class="html-app" data-html-app><div class="code-head"><span class="code-lang">html · 正在载入</span><span>${vizTool("data-app-restart", "重来", "reload")}${vizTool("data-app-download", "下载", "download")}${vizTool("data-work-expand", "全屏", "wide")}${vizTool("data-copy-code", "复制源码", "copy")}</span></div><div class="html-app-stage"><span>正在载入交互内容</span></div><pre class="html-app-source hidden"><code>${escapeHtml(source)}</code></pre></div>\n`;
  }
  let html;
  try {
    html = known ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
  } catch {
    html = escapeHtml(text);
  }
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${escapeHtml(language || "text")}</span><button type="button" class="code-copy" data-copy-code>复制</button></div><pre><code class="hljs${known ? ` language-${escapeHtml(language)}` : ""}">${html}</code></pre></div>\n`;
}
// 一段文字是不是 mermaid 图：头一行（跳过 %% 注释与 --- 前言）整行就是它的图种声明——graph = build() 这类代码不算
const MERMAID_HEAD =
  /^(?:(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie(?:\s+(?:showData|title\s.*))?|quadrantChart|requirementDiagram|gitGraph|C4(?:Context|Container|Component|Dynamic|Deployment)|mindmap|timeline|kanban|(?:sankey|xychart|block|packet|architecture)(?:-beta)?)\s*;?\s*$/;
function looksLikeMermaid(text) {
  const head = String(text || "")
    .replace(/^\s*---[\s\S]*?\n---\s*\n/, "")
    .split("\n")
    .map(line => line.trim())
    .find(line => line && !line.startsWith("%%"));
  return MERMAID_HEAD.test(head || "");
}
// 正文里裸写的 <pre class="mermaid">…</pre>（没包进 ```html）：换成 ```mermaid 围栏，走同一条路成图；代码围栏里的不动
function liftBareMermaid(text) {
  const OPEN = '<pre class="mermaid">';
  if (!text.includes(OPEN)) return text;
  let fenced = false,
    lifting = false;
  return text
    .split("\n")
    .map(line => {
      if (!lifting && /^ {0,3}(?:`{3,}|~{3,})/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      if (!lifting) {
        const at = line.indexOf(OPEN);
        if (at < 0) return line;
        lifting = true;
        line = `${line.slice(0, at)}\n\`\`\`mermaid\n${line.slice(at + OPEN.length)}`;
      }
      const end = line.indexOf("</pre>");
      if (end < 0) return line;
      lifting = false;
      return `${line.slice(0, end)}\n\`\`\`\n${line.slice(end + "</pre>".length)}`;
    })
    .join("\n");
}
/** 旧对话里的 mermaid / echarts 围栏 → 等价的一页 HTML。
 * echarts 的 option 原样当一段 JS 写进去：模型给的「JSON」常带注释、尾逗号、单引号、裸键名，这些 JS 本就认，不必另修；
 * 真写坏了，那一块报「运行有误」、源码照看。它跑在隔离的沙箱页里，与别的交互内容一样 */
function legacyVizHtml(language, text) {
  if (language !== "echarts") return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
  const option = text.replace(/<\/(script)/gi, "<\\/$1");
  return `<div id="chart"></div>\n<script src="yan:echarts"></script>\n<script>const option = (${option}\n), chart = document.getElementById("chart");\nchart.style.height = Math.min(560, Math.max(220, Number(option.height) || 320)) + "px";\ndelete option.height;\necharts.init(chart).setOption(option);</script>`;
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function htmlAppSource(el) {
  return el.querySelector(".html-app-source code")?.textContent || "";
}
// 下载的是能独立打开的作品：把同一份沙箱运行时、所需本地库和主题装进文件，不依赖 yan: 地址或本站。
async function standaloneHtmlApp(source) {
  const parsed = new DOMParser().parseFromString(source, "text/html"),
    names = new Set(
      Array.from(
        parsed.querySelectorAll("script[src]"),
        node => (node.getAttribute("src") || "").match(/^yan:(echarts|mermaid)$/)?.[1]
      ).filter(Boolean)
    );
  if (parsed.querySelector(".mermaid")) names.add("mermaid");
  const read = async path => {
    const response = await fetch(path, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`导出资源未能载入：${path}`);
    return response.text();
  };
  const [runtime, libraries] = await Promise.all([
    read("./preview-runtime.js"),
    Promise.all(
      [...names].map(async name => {
        const [code, license] = await Promise.all([read(`./vendor/${name}.min.js`), read(`./vendor/${name.toUpperCase()}-LICENSE.txt`)]);
        return [name, dataUrlFromText(`/* ${license.replace(/\*\//g, "* / ")} */\n${code}`, "text/javascript")];
      })
    )
  ]);
  const theme = vizTheme(),
    config = JSON.stringify({ html: source, theme, libraries: Object.fromEntries(libraries) }).replace(/</g, "\\u003c"),
    csp =
      "default-src 'none'; script-src data: blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    preview = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script type="application/json" id="yan-preview-export">${config}</script><script src="${dataUrlFromText(runtime, "text/javascript")}"></script></body></html>`;
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(parsed.title || "言 · 交互作品")}</title><style>html,body{margin:0;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style></head><body style="background:${escapeHtml(theme.vars.paper || "#fff")}"><iframe sandbox="allow-scripts" title="交互作品" srcdoc="${escapeHtml(preview)}"></iframe></body></html>`;
}
async function downloadHtmlApp(button) {
  if (button.disabled) return;
  const source = htmlAppSource(button.closest(".html-app"));
  button.disabled = true;
  try {
    downloadText(await standaloneHtmlApp(source), "text/html;charset=utf-8", "言-交互作品.html");
  } catch (error) {
    toast(`下载失败：${String(error.message || error).slice(0, 160)}`);
  } finally {
    button.disabled = false;
  }
}
// 交互内容与正文同一张纸：把言的色板、字体与明暗一并送进去（见 preview-runtime.js 的 applyTheme）
const VIZ_TOKENS = [
  "paper",
  "paper-2",
  "paper-3",
  "ink",
  "ink-2",
  "ink-3",
  "line",
  "accent",
  "accent-soft",
  "code-green",
  "code-blue",
  "gold",
  "keep",
  "reach",
  "body",
  "title"
];
function vizTheme() {
  const style = getComputedStyle(document.documentElement),
    dark = document.documentElement.dataset.theme === "dark";
  return {
    dark,
    scheme: dark ? "dark" : "light",
    vars: Object.fromEntries(VIZ_TOKENS.map(name => [name, style.getPropertyValue(`--${name}`).trim()]))
  };
}
function sendHtmlApp(el) {
  const iframe = el.querySelector("iframe"),
    id = el.dataset.appId;
  if (iframe?.contentWindow && id)
    iframe.contentWindow.postMessage({ type: "yan-preview-render", id, html: htmlAppSource(el), theme: vizTheme() }, "*");
}
// 换了主题、朱色或字体：已在页上的交互内容就地换色，不重跑（里头的状态不丢）
function rethemeHtmlApps(root = document) {
  const theme = vizTheme();
  for (const el of root.querySelectorAll(".html-app[data-app-id]"))
    el.querySelector("iframe")?.contentWindow?.postMessage({ type: "yan-preview-theme", id: el.dataset.appId, theme }, "*");
}
// 内容报来的高度：这一块就长这么高（全屏时由样式接管）；太长的在块里滚，不把整页撑没
function sizeHtmlApp(el, height) {
  const stage = el.querySelector(".html-app-stage");
  if (!stage) return;
  stage.style.height = `${Math.round(Math.min(Math.max(height, 48), Math.max(520, innerHeight * 0.8)))}px`;
}
function mountHtmlApp(el) {
  const id = `app${uid().replace(/[^a-z0-9]/gi, "")}`;
  el.dataset.appId = id;
  el.dataset.rendered = "1";
  el.dataset.appState = "loading";
  el.classList.remove("html-app-error");
  const label = el.querySelector(".code-lang");
  if (label) label.textContent = "html · 正在载入";
  const stage = el.querySelector(".html-app-stage");
  stage.innerHTML = `<iframe sandbox="allow-scripts" title="隔离的 HTML 交互预览" src="./preview.html#${id}"></iframe>`;
  setTimeout(() => {
    if (!el.isConnected || el.dataset.appId !== id || el.dataset.appState !== "loading") return;
    el.dataset.appState = "error";
    el.classList.add("html-app-error");
    if (label) label.textContent = "html · 未能载入";
  }, 6000);
}
function renderHtmlApps(root) {
  for (const el of root.querySelectorAll(".html-app[data-html-app]:not([data-rendered])")) mountHtmlApp(el);
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
function renderEnhancements(root) {
  renderHtmlApps(root);
  void renderPendingMath(root);
}
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
// 交互内容工具条上的一枚：笔意小画，字收进 title 与 aria-label（与回复下的复制、重答同一套画法）。
// 源码不另设一钮：复制、下载拿到的就是它，出错的说明在标签的 title 上
function vizTool(attr, label, icon) {
  return `<button type="button" class="code-copy code-icon" ${attr} title="${label}" aria-label="${label}">${brushIcon(icon)}</button>`;
}
function labelTool(button, label) {
  button.title = label;
  button.setAttribute("aria-label", label);
}
function closeExpandedWork(except = null) {
  for (const item of document.querySelectorAll(".work-expanded"))
    if (item !== except) {
      item.classList.remove("work-expanded");
      const trigger = item.querySelector("[data-work-expand]");
      if (trigger) labelTool(trigger, "全屏");
    }
  if (!except) document.documentElement.classList.remove("work-mode");
}
function toggleWorkExpanded(el, button) {
  const open = !el.classList.contains("work-expanded");
  closeExpandedWork(open ? el : null);
  el.classList.toggle("work-expanded", open);
  labelTool(button, open ? "收起" : "全屏");
  document.documentElement.classList.toggle("work-mode", open);
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
// 流式渲染的分段点：最后一个空行，且它前面没有未闭合的代码围栏、后面不是列表 / 缩进 / 表格的延续
function stableCut(content) {
  const listy = line => /^\s*(?:[-*+]|\d+[.)])\s/.test(line) || /^\s+\S/.test(line);
  let cut = content.lastIndexOf("\n\n");
  while (cut > 0) {
    const before = content.slice(0, cut),
      prevLine = before.slice(before.lastIndexOf("\n") + 1),
      nextLine = content.slice(cut + 2).split("\n")[0];
    const inFence = (before.match(/^ {0,3}(?:`{3,}|~{3,})/gm) || []).length % 2 === 1;
    const continues =
      /^\s+\S/.test(nextLine) || (listy(nextLine) && listy(prevLine)) || (/^\s*\|/.test(nextLine) && prevLine.includes("|"));
    if (!inFence && !continues) break;
    cut = content.lastIndexOf("\n\n", cut - 1);
  }
  return Math.max(0, cut);
}

// 正文里的代码块与交互作品：复制、重来、下载、放大；预览 iframe 报来的状态与高度
function bindContentEvents() {
  document.addEventListener("click", e => {
    const copy = e.target.closest("[data-copy-code]");
    if (copy) {
      void copyText(copy.closest(".code-block, .html-app")?.querySelector("code")?.textContent || "");
      // 小画钮不换字（换了画就没了），说一声；代码块上的字钮照旧换成「已复制」
      if (copy.classList.contains("code-icon")) return toast("已复制");
      copy.textContent = "已复制";
      setTimeout(() => (copy.textContent = "复制"), 1200);
      return;
    }
    const appRestart = e.target.closest("[data-app-restart]");
    if (appRestart) {
      mountHtmlApp(appRestart.closest(".html-app"));
      return;
    }
    const appDownload = e.target.closest("[data-app-download]");
    if (appDownload) {
      void downloadHtmlApp(appDownload);
      return;
    }
    const expand = e.target.closest("[data-work-expand]");
    if (expand) {
      toggleWorkExpanded(expand.closest(".html-app"), expand);
      return;
    }
  });
  window.addEventListener("message", event => {
    const data = event.data;
    if (!data || !["yan-preview-ready", "yan-preview-state", "yan-preview-size", "yan-preview-escape"].includes(data.type)) return;
    const app = [...document.querySelectorAll(".html-app[data-app-id]")].find(
      el => el.dataset.appId === data.id && el.querySelector("iframe")?.contentWindow === event.source
    );
    if (!app) return;
    if (data.type === "yan-preview-ready") return sendHtmlApp(app);
    if (data.type === "yan-preview-size") return sizeHtmlApp(app, Number(data.height) || 0);
    if (data.type === "yan-preview-escape") return void (app.classList.contains("work-expanded") && closeExpandedWork());
    app.dataset.appState = data.state;
    app.classList.toggle("html-app-error", data.state === "error");
    const label = app.querySelector(".code-lang");
    if (label) {
      label.textContent = data.state === "error" ? "html · 运行有误" : "html · 可交互";
      label.title = data.detail || "";
    }
    if (data.state === "ready" && followBottom) requestAnimationFrame(scrollBottom);
  });
}
