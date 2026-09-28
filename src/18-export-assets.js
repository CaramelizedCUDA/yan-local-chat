// Markdown 保留可编辑源码，交互作品另附离线 HTML；没有卷宗目录时把 Markdown 与作品打成一个包。
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
// ZIP 的 store 模式：UTF-8 文件名、CRC32 与标准目录记录，不引入压缩库，离线双击即可解包。
function exportZip(files) {
  const encoder = new TextEncoder(),
    parts = [],
    directory = [],
    table = Array.from({ length: 256 }, (_, value) => {
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
      return value >>> 0;
    });
  let offset = 0,
    directorySize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name),
      data = encoder.encode(file.text),
      local = new Uint8Array(30),
      central = new Uint8Array(46),
      l = new DataView(local.buffer),
      c = new DataView(central.buffer);
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
    crc = (crc ^ 0xffffffff) >>> 0;
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x800, true);
    l.setUint16(12, 33, true); // 1980-01-01
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    central.set(local.subarray(4, 28), 6);
    c.setUint32(42, offset, true);
    parts.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
    directorySize += central.length + name.length;
  }
  const end = new Uint8Array(22),
    view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}
