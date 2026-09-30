// Markdown 保留可编辑源码，交互作品另附离线 HTML，一并存进卷宗。
function markdownVisuals(text) {
  if (!window.marked) return [];
  const sources = [];
  window.marked.walkTokens(window.marked.lexer(liftBareMermaid(text)), token => {
    if (token.type !== "code") return;
    const lang = String(token.lang || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    let source = null;
    if (["html", "interactive", "app"].includes(lang)) source = token.text;
    else if (["mermaid", "echarts"].includes(lang) || ((!lang || lang === "pre") && looksLikeMermaid(token.text)))
      source = legacyVizHtml(lang, token.text);
    if (source !== null) sources.push(source);
  });
  return sources;
}
function markdownAssetLinks(files) {
  if (!files.length) return "";
  return `\n## 交互可视化\n\n源码保留在正文中；下列 HTML 文件可离线打开并交互，请与本文一起保留。\n\n${files
    .map((file, index) => `- [可视化 ${index + 1}](<${encodeURIComponent(file.name)}>)`)
    .join("\n")}\n`;
}
