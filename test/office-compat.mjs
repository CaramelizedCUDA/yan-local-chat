import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { officeZip } from "./lib/office-zip.mjs";
import { connect, check, sleep, HOME, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const engine = `${HOME}/游目/依赖/office`;
mkdirSync(engine, { recursive: true });
mkdirSync(ARCHIVE, { recursive: true });
copyFileSync(new URL("./fake-office/editor.html", import.meta.url), `${engine}/editor.html`);
writeFileSync(`${engine}/yan-office.json`, JSON.stringify({ commit: "fake" }));
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  X = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
  M = "http://schemas.microsoft.com/office/excel/2006/main",
  C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const files = {
  "xl/workbook.xml": `<workbook xmlns="${S}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="中文" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  "xl/styles.xml": `<styleSheet xmlns="${S}"><dxfs count="0"/></styleSheet>`,
  "xl/worksheets/sheet1.xml": `<worksheet xmlns="${S}" xmlns:x14="${X}" xmlns:xm="${M}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>甲</t></is></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>乙</t></is></c><c r="B2"><v>3</v></c></row></sheetData><extLst><ext uri="cf"><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="cellIs" priority="1" operator="greaterThan" id="id1"><xm:f>2</xm:f><x14:dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></x14:dxf></x14:cfRule><x14:cfRule type="dataBar" priority="2" id="advanced"><x14:dataBar><x14:cfvo type="autoMin"/></x14:dataBar></x14:cfRule><xm:sqref>B1:B2</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext><ext uri="dv"><x14:dataValidations count="1"><x14:dataValidation type="list"><x14:formula1><xm:f>"甲,乙"</xm:f></x14:formula1><xm:sqref>A3:A5</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst></worksheet>`,
  "xl/charts/chart1.xml": `<c:chartSpace xmlns:c="${C}"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:cat><c:numRef><c:f>'中文'!$A$1:$A$2</c:f></c:numRef></c:cat><c:val><c:numRef><c:f>'中文'!$B$1:$B$2</c:f></c:numRef></c:val></c:ser><c:axId val="10"/><c:axId val="100"/></c:barChart><c:catAx><c:axId val="10"/><c:axPos val="l"/></c:catAx><c:valAx><c:axId val="100"/><c:axPos val="l"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`,
  "xl/media/image.png": Buffer.from([0, 1, 255, 128, 2])
};
const file = `${ARCHIVE}/中文 测试.xlsx`;
writeFileSync(file, officeZip(files, true));
const opened = await fetch("http://127.0.0.1:8799/api/office/open", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: file })
}).then(r => r.json());
await send("Page.navigate", { url: opened.url });
await sleep(400);
await waitFor("typeof state !== 'undefined' && state.ready", 10000);
const result = await evalJs(`(async () => {
  const original = await (await fetch('/yan/file?t=' + token)).arrayBuffer();
  const prepared = await officePrepare(original, 'test.xlsx', 'open'), opened = new OfficeZip(prepared);
  const chart = officeXml(await opened.text('xl/charts/chart1.xml'));
  const categories = [...chart.getElementsByTagNameNS('${C}', 'strCache')].flatMap(n => officeElements(n, 'v').map(v => v.textContent));
  const values = [...chart.getElementsByTagNameNS('${C}', 'numCache')].flatMap(n => officeElements(n, 'v').map(v => v.textContent));
  const saved = await officePrepare(prepared, 'test.xlsx', 'save'), zip = new OfficeZip(saved);
  const sheet = officeXml(await zip.text('xl/worksheets/sheet1.xml')), styles = officeXml(await zip.text('xl/styles.xml'));
  const rule = sheet.getElementsByTagNameNS('${S}', 'cfRule')[0], validation = sheet.getElementsByTagNameNS('${S}', 'dataValidation')[0];
  const twice = await officePrepare(saved, 'test.xlsx', 'save');
  return { categories, values, rule: { type: rule?.getAttribute('type'), dxf: rule?.getAttribute('dxfId'), formula: rule?.textContent },
    styles: styles.getElementsByTagNameNS('${S}', 'dxf').length,
    validation: { range: validation?.getAttribute('sqref'), formula: validation?.textContent },
    advanced: sheet.getElementsByTagNameNS('${X}', 'dataBar').length,
    picture: [...zip.entries.get('xl/media/image.png').compressed],
    originalPicture: [...new OfficeZip(original).entries.get('xl/media/image.png').compressed],
    categoryAxis: chart.getElementsByTagNameNS('${C}', 'catAx')[0].getElementsByTagNameNS('${C}', 'axPos')[0].getAttribute('val'),
    stable: saved === twice };
})()`);
check(
  "chart references without caches get string categories and numeric values",
  JSON.stringify(result.categories) === '["甲","乙"]' && JSON.stringify(result.values) === '["2","3"]',
  JSON.stringify(result)
);
check(
  "basic conditional formatting is readable in standard OOXML with its differential style",
  result.rule.type === "cellIs" && result.rule.dxf === "0" && result.rule.formula === "2" && result.styles === 1
);
check(
  "list validation is restored with its original range and formula",
  result.validation.range === "A3:A5" && result.validation.formula === '"甲,乙"'
);
check(
  "unsupported advanced formatting and compressed pictures are preserved",
  result.advanced === 1 && JSON.stringify(result.picture) === JSON.stringify(result.originalPicture)
);
check("a second save does not duplicate rules or rewrite untouched content", result.stable);
check("column charts with conflicting vertical axes get a horizontal category axis", result.categoryAxis === "b");
await send("Page.navigate", { url: "about:blank" });
let disconnected = false;
for (let i = 0; i < 40 && !disconnected; i++) {
  const { docs } = await fetch("http://127.0.0.1:8799/api/office/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }).then(r => r.json());
  disconnected = docs.length === 0;
  if (!disconnected) await sleep(100);
}
check("leaving the host page removes its active document association", disconnected);
await close();
