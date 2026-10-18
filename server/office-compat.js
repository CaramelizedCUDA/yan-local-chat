// Office 宿主页专用：XLSX 打开时补图表缓存，存回时把可等价表达的基础规则还原成通用 OOXML。
// 不执行工作簿公式，不访问外部链接；不能等价还原的扩展原样保留。ZIP 中未修改的条目保留原压缩字节。
"use strict";
class OfficeZip {
  constructor(buffer) {
    this.data = new Uint8Array(buffer);
    const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    let end = -1;
    for (let at = this.data.length - 22; at >= Math.max(0, this.data.length - 65557); at--)
      if (view.getUint32(at, true) === 0x06054b50) {
        end = at;
        break;
      }
    if (end < 0) throw Error("XLSX ZIP structure is invalid");
    const count = view.getUint16(end + 10, true);
    if (count === 65535 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
      throw Error("ZIP64 / multipart XLSX is not supported");
    this.entries = new Map();
    let at = view.getUint32(end + 16, true);
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014b50) throw Error("XLSX directory is invalid");
      const nameSize = view.getUint16(at + 28, true),
        extra = view.getUint16(at + 30, true),
        comment = view.getUint16(at + 32, true),
        offset = view.getUint32(at + 42, true),
        size = view.getUint32(at + 20, true),
        start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true),
        name = new TextDecoder().decode(this.data.subarray(at + 46, at + 46 + nameSize));
      if (view.getUint32(offset, true) !== 0x04034b50 || start + size > this.data.length || view.getUint16(at + 8, true) & 1)
        throw Error("XLSX entry is invalid or encrypted");
      this.entries.set(name, {
        header: this.data.slice(at, at + 46),
        name: this.data.slice(at + 46, at + 46 + nameSize),
        extra: this.data.slice(at + 46 + nameSize, at + 46 + nameSize + extra),
        comment: this.data.slice(at + 46 + nameSize + extra, at + 46 + nameSize + extra + comment),
        compressed: this.data.slice(start, start + size),
        method: view.getUint16(at + 10, true),
        size: view.getUint32(at + 24, true)
      });
      at += 46 + nameSize + extra + comment;
    }
    this.changed = false;
  }
  async text(name) {
    const entry = this.entries.get(name);
    if (!entry) return "";
    if (entry.size > 32 * 1048576) throw Error("XLSX XML exceeds 32 MB");
    let bytes = entry.compressed;
    if (entry.method === 8)
      bytes = new Uint8Array(
        await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()
      );
    else if (entry.method !== 0) throw Error("Unsupported XLSX compression");
    if (bytes.length !== entry.size) throw Error("XLSX entry length is invalid");
    return new TextDecoder().decode(bytes);
  }
  write(name, text) {
    const entry = this.entries.get(name);
    if (!entry) throw Error("Missing XLSX entry: " + name);
    entry.compressed = new TextEncoder().encode(text);
    entry.method = 0;
    entry.size = entry.compressed.length;
    const view = new DataView(entry.header.buffer);
    view.setUint32(16, officeCrc32(entry.compressed), true);
    this.changed = true;
  }
  bytes() {
    const locals = [],
      directory = [];
    let offset = 0;
    for (const entry of this.entries.values()) {
      const header = entry.header.slice(),
        central = new DataView(header.buffer),
        local = new Uint8Array(30),
        view = new DataView(local.buffer),
        flags = central.getUint16(8, true) & ~8;
      central.setUint16(8, flags, true);
      central.setUint16(10, entry.method, true);
      central.setUint32(20, entry.compressed.length, true);
      central.setUint32(24, entry.size, true);
      central.setUint32(42, offset, true);
      view.setUint32(0, 0x04034b50, true);
      local.set(header.subarray(6, 16), 4);
      local.set(header.subarray(16, 28), 14);
      view.setUint16(26, entry.name.length, true);
      view.setUint16(28, entry.extra.length, true);
      locals.push(local, entry.name, entry.extra, entry.compressed);
      directory.push(header, entry.name, entry.extra, entry.comment);
      offset += 30 + entry.name.length + entry.extra.length + entry.compressed.length;
    }
    const end = new Uint8Array(22),
      view = new DataView(end.buffer),
      directorySize = directory.reduce((sum, chunk) => sum + chunk.length, 0);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.entries.size, true);
    view.setUint16(10, this.entries.size, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, offset, true);
    const output = new Uint8Array(offset + directorySize + 22);
    let at = 0;
    for (const part of [...locals, ...directory, end]) {
      output.set(part, at);
      at += part.length;
    }
    return output.buffer;
  }
}
const OFFICE_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function officeCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ OFFICE_CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
const OFFICE_SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const OFFICE_CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const OFFICE_X14_NS = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const officeElements = (node, name) => [...node.getElementsByTagNameNS("*", name)];
const officeChild = (node, name) => [...node.children].find(child => child.localName === name);
function officeXml(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw Error("XLSX XML is invalid");
  return xml;
}
function officeInsert(parent, child, order) {
  const rank = order.indexOf(child.localName);
  parent.insertBefore(child, [...parent.children].find(node => order.indexOf(node.localName) > rank) || null);
}
const OFFICE_SHEET_ORDER = [
  "sheetPr",
  "dimension",
  "sheetViews",
  "sheetFormatPr",
  "cols",
  "sheetData",
  "sheetCalcPr",
  "sheetProtection",
  "protectedRanges",
  "scenarios",
  "autoFilter",
  "sortState",
  "dataConsolidate",
  "customSheetViews",
  "mergeCells",
  "phoneticPr",
  "conditionalFormatting",
  "dataValidations",
  "hyperlinks",
  "printOptions",
  "pageMargins",
  "pageSetup",
  "headerFooter",
  "rowBreaks",
  "colBreaks",
  "customProperties",
  "cellWatches",
  "ignoredErrors",
  "smartTags",
  "drawing",
  "legacyDrawing",
  "legacyDrawingHF",
  "picture",
  "oleObjects",
  "controls",
  "webPublishItems",
  "tableParts",
  "extLst"
];

async function officePrepare(buffer, name, mode) {
  if (!/\.xlsx$/i.test(name)) return buffer;
  const zip = new OfficeZip(buffer);
  if (mode === "open") await officeChartCaches(zip);
  else await officeStandardRules(zip);
  return zip.changed ? zip.bytes() : buffer;
}

// x14 的基础条件格式、数据校验可无损还原；高级图标、渐变数据条等扩展仍完整保留。
async function officeStandardRules(zip) {
  let styles = null,
    stylesChanged = false;
  const supported = new Set([
    "cellIs",
    "expression",
    "duplicateValues",
    "uniqueValues",
    "top10",
    "aboveAverage",
    "timePeriod",
    "containsText",
    "notContainsText",
    "beginsWith",
    "endsWith",
    "containsBlanks",
    "notContainsBlanks",
    "containsErrors",
    "notContainsErrors"
  ]);
  for (const name of zip.entries.keys()) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue;
    const text = await zip.text(name);
    if (!text.includes(OFFICE_X14_NS)) continue;
    const xml = officeXml(text),
      root = xml.documentElement;
    let changed = false;
    for (const formatting of [...xml.getElementsByTagNameNS(OFFICE_X14_NS, "conditionalFormatting")]) {
      const sqref = officeChild(formatting, "sqref")?.textContent;
      if (!sqref) continue;
      const normal = xml.createElementNS(OFFICE_SHEET_NS, "conditionalFormatting");
      normal.setAttribute("sqref", sqref);
      for (const rule of [...formatting.children].filter(node => node.localName === "cfRule")) {
        if (!supported.has(rule.getAttribute("type")) || [...rule.children].some(node => !["f", "formula", "dxf"].includes(node.localName)))
          continue;
        const converted = xml.createElementNS(OFFICE_SHEET_NS, "cfRule");
        for (const attr of rule.attributes)
          if (!attr.namespaceURI && attr.localName !== "id") converted.setAttribute(attr.name, attr.value);
        for (const child of rule.children) {
          if (child.localName === "dxf") {
            styles ||= officeXml(await zip.text("xl/styles.xml"));
            let dxfs = officeChild(styles.documentElement, "dxfs");
            if (!dxfs) {
              dxfs = styles.createElementNS(OFFICE_SHEET_NS, "dxfs");
              officeInsert(styles.documentElement, dxfs, [
                "numFmts",
                "fonts",
                "fills",
                "borders",
                "cellStyleXfs",
                "cellXfs",
                "cellStyles",
                "dxfs",
                "tableStyles",
                "colors",
                "extLst"
              ]);
            }
            converted.setAttribute("dxfId", String(dxfs.children.length));
            const dxf = styles.createElementNS(OFFICE_SHEET_NS, "dxf");
            for (const part of child.children) dxf.append(styles.importNode(part, true));
            dxfs.append(dxf);
            dxfs.setAttribute("count", String(dxfs.children.length));
            stylesChanged = true;
          } else {
            const formula = xml.createElementNS(OFFICE_SHEET_NS, "formula");
            formula.textContent = child.textContent;
            converted.append(formula);
          }
        }
        normal.append(converted);
        rule.remove();
        changed = true;
      }
      if (normal.children.length) officeInsert(root, normal, OFFICE_SHEET_ORDER);
      if (![...formatting.children].some(node => node.localName === "cfRule")) formatting.remove();
    }
    for (const validation of [...xml.getElementsByTagNameNS(OFFICE_X14_NS, "dataValidation")]) {
      const sqref = officeChild(validation, "sqref")?.textContent;
      if (!sqref || [...validation.children].some(node => !["sqref", "formula1", "formula2"].includes(node.localName))) continue;
      const converted = xml.createElementNS(OFFICE_SHEET_NS, "dataValidation");
      for (const attr of validation.attributes) if (!attr.namespaceURI) converted.setAttribute(attr.name, attr.value);
      converted.setAttribute("sqref", sqref);
      for (const kind of ["formula1", "formula2"]) {
        const old = officeChild(validation, kind);
        if (!old) continue;
        const formula = xml.createElementNS(OFFICE_SHEET_NS, kind);
        formula.textContent = old.textContent;
        converted.append(formula);
      }
      let validations = [...root.children].find(node => node.namespaceURI === OFFICE_SHEET_NS && node.localName === "dataValidations");
      if (!validations) {
        validations = xml.createElementNS(OFFICE_SHEET_NS, "dataValidations");
        officeInsert(root, validations, OFFICE_SHEET_ORDER);
      }
      validations.append(converted);
      validations.setAttribute("count", String(validations.children.length));
      validation.remove();
      changed = true;
    }
    if (changed) {
      for (const container of [
        ...officeElements(xml, "conditionalFormattings"),
        ...xml.getElementsByTagNameNS(OFFICE_X14_NS, "dataValidations"),
        ...officeElements(xml, "ext"),
        ...officeElements(xml, "extLst")
      ])
        if (!container.children.length) container.remove();
      zip.write(name, new XMLSerializer().serializeToString(xml));
    }
  }
  if (stylesChanged) zip.write("xl/styles.xml", new XMLSerializer().serializeToString(styles));
}

// openpyxl 等生成器常不写图表缓存；只从工作簿内的实际单元格补齐，不重算公式，也不读外部文件。
async function officeChartCaches(zip) {
  const chartNames = [...zip.entries.keys()].filter(name => /^xl\/charts\/chart[^/]*\.xml$/.test(name));
  if (!chartNames.length) return;
  const workbook = officeXml(await zip.text("xl/workbook.xml")),
    rels = officeXml(await zip.text("xl/_rels/workbook.xml.rels")),
    sheets = new Map(),
    loaded = new Map();
  const targets = new Map(
    officeElements(rels, "Relationship")
      .filter(rel => rel.getAttribute("TargetMode") !== "External")
      .map(rel => [rel.getAttribute("Id"), rel.getAttribute("Target")])
  );
  for (const sheet of officeElements(workbook, "sheet")) {
    const id = [...sheet.attributes].find(attr => attr.localName === "id")?.value,
      target = targets.get(id);
    if (!target) continue;
    const parts = target.startsWith("/") ? [] : ["xl"];
    for (const part of target.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    sheets.set(sheet.getAttribute("name"), parts.join("/"));
  }
  const stringsText = await zip.text("xl/sharedStrings.xml");
  const strings = stringsText
    ? officeElements(officeXml(stringsText), "si").map(si =>
        officeElements(si, "t")
          .filter(t => t.parentElement.localName !== "rPh")
          .map(t => t.textContent)
          .join("")
      )
    : [];
  const cell = text => /^\$?([A-Z]+)\$?(\d+)$/i.exec(text);
  const column = letters => [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  const resolve = async formula => {
    const match = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(formula.replace(/^=/, ""));
    if (!match) return null;
    const sheetPath = sheets.get((match[1] || match[2]).replace(/''/g, "'")),
      range = match[3].split(":"),
      from = cell(range[0]),
      to = cell(range[1] || range[0]);
    if (!sheetPath || !from || !to) return null;
    const left = column(from[1]),
      right = column(to[1]),
      top = +from[2],
      bottom = +to[2];
    if (right < left || bottom < top || (right - left + 1) * (bottom - top + 1) > 10000) return null;
    if (!loaded.has(sheetPath)) {
      const cells = new Map();
      for (const item of officeElements(officeXml(await zip.text(sheetPath)), "c")) {
        const type = item.getAttribute("t"),
          raw = officeChild(item, "v")?.textContent ?? "";
        cells.set(item.getAttribute("r"), {
          text:
            type === "s"
              ? (strings[+raw] ?? "")
              : type === "inlineStr"
                ? officeElements(item, "t")
                    .map(t => t.textContent)
                    .join("")
                : raw,
          numeric: !type || type === "n"
        });
      }
      loaded.set(sheetPath, cells);
    }
    const values = [];
    for (let row = top; row <= bottom; row++)
      for (let col = left; col <= right; col++) {
        let letters = "";
        for (let n = col; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
        values.push(loaded.get(sheetPath).get(letters + row) || { text: "", numeric: true });
      }
    return values;
  };
  for (const name of chartNames) {
    const xml = officeXml(await zip.text(name));
    let changed = false;
    for (const reference of [
      ...xml.getElementsByTagNameNS(OFFICE_CHART_NS, "numRef"),
      ...xml.getElementsByTagNameNS(OFFICE_CHART_NS, "strRef")
    ]) {
      const oldCache = officeChild(reference, "numCache") || officeChild(reference, "strCache");
      if (oldCache && officeElements(oldCache, "pt").length) continue;
      const formula = officeChild(reference, "f"),
        values = formula && (await resolve(formula.textContent));
      if (!values) continue;
      const string =
        reference.localName === "strRef" ||
        (reference.parentElement.localName === "cat" && values.some(value => value.text && !value.numeric));
      const target = xml.createElementNS(OFFICE_CHART_NS, string ? "c:strRef" : "c:numRef");
      target.append(formula.cloneNode(true));
      const cache = xml.createElementNS(OFFICE_CHART_NS, string ? "c:strCache" : "c:numCache"),
        count = xml.createElementNS(OFFICE_CHART_NS, "c:ptCount");
      count.setAttribute("val", String(values.length));
      cache.append(count);
      values.forEach((value, index) => {
        if (!value.text || (!string && (!value.numeric || !Number.isFinite(Number(value.text))))) return;
        const point = xml.createElementNS(OFFICE_CHART_NS, "c:pt"),
          v = xml.createElementNS(OFFICE_CHART_NS, "c:v");
        point.setAttribute("idx", String(index));
        v.textContent = value.text;
        point.append(v);
        cache.append(point);
      });
      target.append(cache);
      reference.replaceWith(target);
      changed = true;
    }
    // 有些生成器把普通柱状图的 catAx、valAx 都省成左轴，引擎据此画出两条竖轴、没有柱体。
    // 只修与 barDir 冲突的轴对，保留有效的上下、左右选择及其他图表类型。
    for (const chart of xml.getElementsByTagNameNS(OFFICE_CHART_NS, "barChart")) {
      const direction = officeChild(chart, "barDir")?.getAttribute("val");
      const ids = [...chart.children].filter(node => node.localName === "axId").map(node => node.getAttribute("val"));
      const axes = [...chart.parentElement.children].filter(node => ids.includes(officeChild(node, "axId")?.getAttribute("val")));
      const category = axes.find(node => node.localName === "catAx"),
        value = axes.find(node => node.localName === "valAx");
      const categoryPosition = category && officeChild(category, "axPos"),
        valuePosition = value && officeChild(value, "axPos");
      if (
        direction === "col" &&
        ["l", "r"].includes(categoryPosition?.getAttribute("val")) &&
        ["l", "r"].includes(valuePosition?.getAttribute("val"))
      ) {
        categoryPosition.setAttribute("val", "b");
        changed = true;
      } else if (
        direction === "bar" &&
        ["l", "r"].includes(categoryPosition?.getAttribute("val")) &&
        ["l", "r"].includes(valuePosition?.getAttribute("val"))
      ) {
        valuePosition.setAttribute("val", "b");
        changed = true;
      }
    }
    if (changed) zip.write(name, new XMLSerializer().serializeToString(xml));
  }
}
