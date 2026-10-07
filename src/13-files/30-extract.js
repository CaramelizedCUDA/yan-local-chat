// 言 · 文件 · 文档抽取：PDF 与 Office / ODF 文档抽成文字与 Markdown
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function readFile(file, mode) {
  if (mode !== "data") return file.arrayBuffer().then(decodeTextBytes);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// 文字按 UTF-8 读，读不通再按 GB18030（中文 Excel 另存的 CSV、旧记事本存的 txt 多是 GBK，按 UTF-8 读满屏乱码）
/** @param {ArrayBuffer|Uint8Array} bytes */
function decodeTextBytes(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}
// 扩展名不在表里、浏览器也没报类型的（.vue、.kt、Dockerfile、.env……）：看开头 64KB，没有 NUL、按 UTF-8 或 GBK 解得通的当文字
async function sniffText(file) {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  if (head.includes(0)) return false;
  for (const label of ["utf-8", "gb18030"])
    try {
      new TextDecoder(label, { fatal: true }).decode(head, { stream: true });
      return true;
    } catch {}
  return false;
}
function bytesFromDataUrl(value) {
  const encoded = String(value).slice(String(value).indexOf(",") + 1),
    binary = atob(encoded),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function trimExtractedText(value) {
  const text = String(value || "")
    .replace(/\0/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  return text.length > MAX_EXTRACTED_CHARS
    ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[文档内容过长，已在本机截取前 ${MAX_EXTRACTED_CHARS} 个字符]`
    : text;
}
async function extractDocumentText(name, data) {
  const extract = fileKind(name).extract;
  if (extract === "pdf") return trimExtractedText(await extractPdfText(data));
  if (extract === "zip") return trimExtractedText(await extractZipDocumentText(fileExtension(name), bytesFromDataUrl(data)));
  return "";
}
async function extractPdfText(data) {
  if (!(await ensureLib("pdf"))) return "";
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  const loading = window.pdfjsLib.getDocument({
      data: bytesFromDataUrl(data),
      cMapUrl: "./vendor/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "./vendor/standard_fonts/"
    }),
    document = await loading.promise,
    pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber),
        content = await page.getTextContent();
      let line = "",
        output = [];
      for (const item of content.items || []) {
        if (item.str) line += `${line ? " " : ""}${item.str}`;
        if (item.hasEOL && line) {
          output.push(line);
          line = "";
        }
      }
      if (line) output.push(line);
      pages.push(`第 ${pageNumber} 页\n${output.join("\n")}`);
      if (pages.join("\n\n").length >= MAX_EXTRACTED_CHARS) break;
    }
  } finally {
    await document.destroy();
  }
  return pages.join("\n\n");
}
async function unzipSelected(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder(),
    minimum = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset--)
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  if (eocd < 0) throw Error("文档压缩结构无效");
  const count = view.getUint16(eocd + 10, true),
    centralOffset = view.getUint32(eocd + 16, true),
    entries = new Map();
  let cursor = centralOffset,
    extractedBytes = 0;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true),
      compressedSize = view.getUint32(cursor + 20, true),
      uncompressedSize = view.getUint32(cursor + 24, true),
      nameLength = view.getUint16(cursor + 28, true),
      extraLength = view.getUint16(cursor + 30, true),
      commentLength = view.getUint16(cursor + 32, true),
      localOffset = view.getUint32(cursor + 42, true),
      name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (wanted(name) && uncompressedSize <= 8 * 1024 * 1024 && extractedBytes + uncompressedSize <= 16 * 1024 * 1024) {
      const localNameLength = view.getUint16(localOffset + 26, true),
        localExtraLength = view.getUint16(localOffset + 28, true),
        start = localOffset + 30 + localNameLength + localExtraLength,
        compressed = bytes.slice(start, start + compressedSize);
      let output;
      if (method === 0) output = compressed;
      else if (method === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        output = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      if (output) {
        entries.set(name, decoder.decode(output));
        extractedBytes += output.length;
      }
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function parseXml(value) {
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.querySelector("parsererror")) throw Error("文档 XML 无效");
  return document;
}
// ---------- 文档抽成 Markdown：标题、加粗、列表、表格照原样，预览交给现成的 Markdown 渲染，送给模型的也是这一份 ----------
// 早先只抽一串字（段落换行、表格用 Tab 连），结构全丢，预览挤成一片、模型也读不出行列。
// 只还原结构，不还原版式（字体、配色、图片、合并单元格）；要看原样，预览里「以本机程序打开」
const MD_TABLE_ROWS = 500,
  MD_TABLE_COLS = 40;
const xmlKids = (node, name) => [...node.children].filter(child => child.localName === name);
const xmlDeep = (node, name) => [...node.getElementsByTagNameNS("*", name)];
const mdCell = text =>
  String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
// 段首会被当成 Markdown 记号的字垫一个反斜杠：# > - * + 垫在前面，「1.」垫在点前
const mdLine = text =>
  String(text || "")
    .replace(/^(\s*)([#>*+-])/, "$1\\$2")
    .replace(/^(\s*\d+)\./, "$1\\.");
// 一张表：首行作表头；参差的行补齐，尾上全空的列与行去掉，过大的截住并注一句
function mdTable(rows) {
  let body = rows.map(row => row.map(mdCell));
  while (body.length && body.at(-1).every(cell => !cell)) body.pop();
  let width = Math.min(MD_TABLE_COLS, Math.max(0, ...body.map(row => row.length)));
  while (width && body.every(row => !row[width - 1])) width -= 1;
  if (!body.length || !width) return "";
  const more = body.length - MD_TABLE_ROWS;
  body = body.slice(0, MD_TABLE_ROWS);
  const line = row => `| ${Array.from({ length: width }, (_, i) => row[i] || " ").join(" | ")} |`;
  return (
    [line(body[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...body.slice(1).map(line)].join("\n") +
    (more > 0 ? `\n\n（其后 ${more} 行未列出）` : "")
  );
}
// 一段里的字：相邻同样式的并成一截再包 ** / *，免得出现「****」
function mdRuns(segments) {
  const merged = [];
  for (const seg of segments) {
    const last = merged.at(-1);
    if (last && last.bold === seg.bold && last.italic === seg.italic) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged
    .map(({ text, bold, italic }) => {
      const mark = bold && italic ? "***" : bold ? "**" : italic ? "*" : "";
      if (!mark) return text;
      const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return core ? `${lead}${mark}${core}${mark}${trail}` : text;
    })
    .join("");
}

// docx：正文按块走（段落、表格，内容控件等容器往里钻）；标题认样式名（styles.xml 里的 heading n / Title，中文版 Word 的样式 id 是数字）
function docxMarkdown(documentXml, stylesXml) {
  const styleNames = new Map();
  if (stylesXml)
    for (const style of xmlDeep(parseXml(stylesXml), "style"))
      styleNames.set(style.getAttribute("w:styleId"), String(xmlKids(style, "name")[0]?.getAttribute("w:val") || "").toLowerCase());
  const flag = node => !!node && !["0", "false"].includes(String(node.getAttribute("w:val")));
  const paragraph = p => {
    const props = xmlKids(p, "pPr")[0],
      styleId = props && xmlKids(props, "pStyle")[0]?.getAttribute("w:val"),
      name = styleNames.get(styleId) || String(styleId || "").toLowerCase(),
      level = name === "title" ? 1 : Number(name.match(/heading ?(\d)/)?.[1]) || 0,
      numbering = props && xmlKids(props, "numPr")[0],
      depth = Number(numbering && xmlKids(numbering, "ilvl")[0]?.getAttribute("w:val")) || 0;
    const segments = xmlDeep(p, "r").map(run => {
      const rp = xmlKids(run, "rPr")[0];
      let text = "";
      for (const part of run.children)
        if (part.localName === "t") text += part.textContent;
        else if (part.localName === "tab") text += " ";
        else if (part.localName === "br" || part.localName === "cr") text += "\n";
      return { text, bold: !level && flag(rp && xmlKids(rp, "b")[0]), italic: flag(rp && xmlKids(rp, "i")[0]) };
    });
    // 段首的记号转义施在原字上（施在拼好的「**…**」上会把加粗本身转掉）
    const first = segments.find(seg => seg.text.trim());
    if (first && !level && !numbering) first.text = mdLine(first.text.trimStart());
    const text = mdRuns(segments).trim();
    if (!text) return "";
    if (level) return `${"#".repeat(Math.min(level, 6))} ${text.replace(/\n/g, " ")}`;
    if (numbering) return `${"  ".repeat(depth)}- ${text.replace(/\n/g, " ")}`;
    // 段内换行用反斜杠硬换行（行尾两个空格的写法会被 trimExtractedText 收掉）
    return text.replace(/\n/g, "\\\n");
  };
  const cellText = cell =>
    xmlDeep(cell, "p")
      .map(p =>
        xmlDeep(p, "t")
          .map(t => t.textContent)
          .join("")
      )
      .join(" ");
  const out = [];
  const walk = node => {
    for (const child of node.children) {
      if (child.localName === "p") out.push(paragraph(child));
      else if (child.localName === "tbl") out.push(mdTable(xmlKids(child, "tr").map(tr => xmlKids(tr, "tc").map(cellText))));
      else if (child.localName !== "sectPr") walk(child);
    }
  };
  const body = xmlDeep(parseXml(documentXml), "body")[0];
  if (body) walk(body);
  // 列表项之间不空行，别的块之间空一行
  return out
    .filter(Boolean)
    .reduce((text, block, i, all) => text + (i ? (/^\s*- /.test(block) && /^\s*- /.test(all[i - 1]) ? "\n" : "\n\n") : "") + block, "");
}
// pptx：一页一节「## 第 n 页 · 标题」，其余文字按层级列成要点，页上的表格照表格
function pptxMarkdown(slides) {
  return slides
    .map((xml, index) => {
      const doc = parseXml(xml);
      let title = "";
      const points = [],
        tables = [];
      for (const shape of xmlDeep(doc, "sp")) {
        const kind = xmlDeep(shape, "ph")[0]?.getAttribute("type") || "",
          paragraphs = xmlDeep(shape, "p");
        const lines = paragraphs
          .map(p => ({
            text: xmlDeep(p, "t")
              .map(t => t.textContent)
              .join("")
              .trim(),
            depth: Number(xmlKids(p, "pPr")[0]?.getAttribute("lvl")) || 0
          }))
          .filter(line => line.text);
        if (/title/i.test(kind) && !title) title = lines.map(line => line.text).join(" ");
        else for (const line of lines) points.push(`${"  ".repeat(line.depth)}- ${line.text}`);
      }
      for (const table of xmlDeep(doc, "tbl"))
        tables.push(
          mdTable(
            xmlKids(table, "tr").map(tr =>
              xmlKids(tr, "tc").map(tc =>
                xmlDeep(tc, "t")
                  .map(t => t.textContent)
                  .join("")
              )
            )
          )
        );
      return [`## 第 ${index + 1} 页${title ? ` · ${title}` : ""}`, points.join("\n"), ...tables].filter(Boolean).join("\n\n");
    })
    .join("\n\n");
}
// xlsx：一张表一节「## 表名」；单元格按引用（C5）落到它自己的列上，空格子不挤掉后面的列
function xlsxColumn(ref) {
  let n = 0;
  for (const ch of String(ref || "").replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
function xlsxMarkdown(entries) {
  const sharedXml = entries.get("xl/sharedStrings.xml"),
    shared = sharedXml
      ? xmlDeep(parseXml(sharedXml), "si").map(si =>
          xmlDeep(si, "t")
            .filter(t => t.parentElement?.localName !== "rPh")
            .map(t => t.textContent)
            .join("")
        )
      : [];
  // 表名与表文件的对应：workbook.xml 里的 sheet（名字、r:id）经 rels 找到 worksheets/sheetN.xml；对不上就按文件名顺序、以「工作表 n」为名
  const targets = new Map();
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (rels)
    for (const rel of xmlDeep(parseXml(rels), "Relationship"))
      targets.set(rel.getAttribute("Id"), `xl/${String(rel.getAttribute("Target")).replace(/^\/?xl\//, "")}`);
  const workbook = entries.get("xl/workbook.xml");
  let sheets = workbook
    ? xmlDeep(parseXml(workbook), "sheet")
        .map(sheet => ({ name: sheet.getAttribute("name"), file: targets.get(sheet.getAttribute("r:id")) }))
        .filter(sheet => entries.has(sheet.file))
    : [];
  if (!sheets.length)
    sheets = [...entries.keys()]
      .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((file, i) => ({ name: `工作表 ${i + 1}`, file }));
  return sheets
    .map(({ name, file }) => {
      const rows = xmlDeep(parseXml(entries.get(file)), "row").map(row => {
        const cells = [];
        let next = 0;
        for (const cell of xmlKids(row, "c")) {
          const at = cell.getAttribute("r") ? xlsxColumn(cell.getAttribute("r")) : next,
            type = cell.getAttribute("t"),
            value = xmlKids(cell, "v")[0]?.textContent ?? "";
          next = at + 1;
          if (at >= MD_TABLE_COLS) continue;
          cells[at] =
            type === "s"
              ? (shared[Number(value)] ?? "")
              : type === "inlineStr"
                ? xmlDeep(cell, "t")
                    .map(t => t.textContent)
                    .join("")
                : type === "b"
                  ? value === "1"
                    ? "TRUE"
                    : "FALSE"
                  : value;
        }
        return Array.from(cells, cell => cell ?? "");
      });
      return `## ${name}\n\n${mdTable(rows) || "（空表）"}`;
    })
    .join("\n\n");
}
// ODF（odt / ods / odp）：content.xml 里标题、段落、列表、表格、演示页各归其位
function odfMarkdown(contentXml) {
  const out = [];
  let pages = 0;
  const text = node => node.textContent.replace(/\s+/g, " ").trim();
  const repeat = (node, name) => Math.min(50, Number(node.getAttribute(name)) || 1);
  const walk = (node, depth = 0) => {
    for (const child of node.children) {
      const name = child.localName;
      if (name === "h") out.push(`${"#".repeat(Math.min(6, Number(child.getAttribute("text:outline-level")) || 1))} ${text(child)}`);
      else if (name === "p") text(child) && out.push(mdLine(text(child)));
      else if (name === "list")
        for (const item of xmlKids(child, "list-item")) {
          const line = xmlKids(item, "p").map(text).join(" ");
          if (line) out.push(`${"  ".repeat(depth)}- ${line}`);
          for (const nested of xmlKids(item, "list")) walk({ children: [nested] }, depth + 1);
        }
      else if (name === "table") {
        const rows = [];
        for (const row of xmlDeep(child, "table-row")) {
          const cells = xmlKids(row, "table-cell").flatMap(cell =>
            Array(repeat(cell, "table:number-columns-repeated")).fill(xmlKids(cell, "p").map(text).join(" "))
          );
          if (cells.some(Boolean)) for (let i = 0; i < repeat(row, "table:number-rows-repeated"); i++) rows.push(cells);
        }
        const table = mdTable(rows);
        if (table)
          out.push(
            child.getAttribute("table:name") && !node.localName?.match(/^(text|table-cell)$/)
              ? `## ${child.getAttribute("table:name")}\n\n${table}`
              : table
          );
      } else if (name === "page") {
        pages += 1;
        out.push(
          `## 第 ${pages} 页${child.getAttribute("draw:name") && !/^page\d+$/i.test(child.getAttribute("draw:name")) ? ` · ${child.getAttribute("draw:name")}` : ""}`
        );
        walk(child, depth);
      } else walk(child, depth);
    }
  };
  const body = xmlDeep(parseXml(contentXml), "body")[0];
  if (body) walk(body);
  return out.filter(Boolean).join("\n\n");
}
async function extractZipDocumentText(extension, bytes) {
  if (extension === "docx") {
    const entries = await unzipSelected(bytes, name => /^word\/(document|styles|footnotes|endnotes)\.xml$/.test(name)),
      notes = ["word/footnotes.xml", "word/endnotes.xml"]
        .filter(name => entries.has(name))
        .map(name =>
          xmlDeep(parseXml(entries.get(name)), "p").map(p =>
            xmlDeep(p, "t")
              .map(t => t.textContent)
              .join("")
              .trim()
          )
        )
        .flat()
        .filter(Boolean);
    return `${entries.has("word/document.xml") ? docxMarkdown(entries.get("word/document.xml"), entries.get("word/styles.xml")) : ""}${notes.length ? `\n\n---\n\n${notes.join("\n\n")}` : ""}`;
  }
  if (extension === "pptx") {
    const entries = await unzipSelected(bytes, name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    return pptxMarkdown(
      [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([, xml]) => xml)
    );
  }
  if (extension === "xlsx")
    return xlsxMarkdown(
      await unzipSelected(bytes, name =>
        /^xl\/(sharedStrings|workbook)\.xml$|^xl\/_rels\/workbook\.xml\.rels$|^xl\/worksheets\/sheet\d+\.xml$/.test(name)
      )
    );
  const entries = await unzipSelected(bytes, name => name === "content.xml");
  return entries.get("content.xml") ? odfMarkdown(entries.get("content.xml")) : "";
}
