import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { officeZip } from "../lib/office-zip.mjs";
const { OfficeZip, officeCrc32 } = new Function(
  readFileSync(new URL("../../server/office-compat.js", import.meta.url), "utf8") + "\nreturn {OfficeZip, officeCrc32};"
)();

for (const compressed of [false, true])
  test(`XLSX ZIP ${compressed ? "deflate" : "stored"} 改写 XML 后能重开，图片压缩字节与 CRC 保持`, async () => {
    const input = officeZip({ "xl/中文.xml": "<root>原文</root>", "xl/media/image.png": Buffer.from([0, 1, 255, 128, 2]) }, compressed);
    const zip = new OfficeZip(input);
    assert.equal(await zip.text("xl/中文.xml"), "<root>原文</root>");
    const picture = zip.entries.get("xl/media/image.png").compressed;
    zip.write("xl/中文.xml", "<root>改后 &amp; 中文</root>");
    const reopened = new OfficeZip(zip.bytes());
    assert.equal(await reopened.text("xl/中文.xml"), "<root>改后 &amp; 中文</root>");
    assert.deepEqual(reopened.entries.get("xl/media/image.png").compressed, picture);
    assert.equal(
      new DataView(reopened.entries.get("xl/中文.xml").header.buffer).getUint32(16, true),
      crc32(Buffer.from("<root>改后 &amp; 中文</root>"))
    );
    assert.equal(officeCrc32(new Uint8Array([0, 1, 255, 128, 2])), crc32(Buffer.from([0, 1, 255, 128, 2])));
  });

test("损坏和加密的 ZIP 明确失败，不交出悄悄缺项的文档", () => {
  assert.throws(() => new OfficeZip(new Uint8Array([1, 2, 3])), /invalid/);
  const input = officeZip({ "xl/test.xml": "test" });
  const at = input.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  input.writeUInt16LE(0x801, at + 8);
  assert.throws(() => new OfficeZip(input), /encrypted/);
});
