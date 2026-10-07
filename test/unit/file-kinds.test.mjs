// 文件种类表：各处（卷宗的大类与件图、预览、当不当文字读、抽正文）照同一张表认
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { fileKind, isTextFile, FILE_KINDS } = load(["fileKind", "isTextFile", "FILE_KINDS"]);
const { decodeTextBytes } = load(["decodeTextBytes"]);

test("文字附件：UTF-16 按 BOM 字节序读取，UTF-8 与 GBK 继续可读", () => {
  const text = "中文\nA";
  const littleEndian = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const bigEndian = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]);
  // ArrayBuffer 与有偏移的 Uint8Array 都是实际附件读取会交来的字节形式。
  assert.equal(decodeTextBytes(littleEndian.buffer.slice(littleEndian.byteOffset, littleEndian.byteOffset + littleEndian.byteLength)), text);
  assert.equal(decodeTextBytes(bigEndian), text);
  assert.equal(decodeTextBytes(Buffer.from(text, "utf8")), text);
  assert.equal(decodeTextBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")])), text);
  assert.equal(decodeTextBytes(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x41])), text);
});

test("一个扩展名只归一种", () => {
  const seen = new Map();
  for (const kind of FILE_KINDS)
    for (const ext of kind.exts) {
      assert.ok(!seen.has(ext), `${ext} 同归 ${seen.get(ext)} 与 ${kind.name}`);
      seen.set(ext, kind.name);
    }
});
test("大类、件图、预览、抽正文出自同一份", () => {
  assert.deepEqual([fileKind("a.AVIF").group, fileKind("a.avif").view], ["image", "image"]);
  assert.deepEqual([fileKind("x.svg").group, fileKind("x.svg").view], ["image", "image"]);
  assert.deepEqual([fileKind("r.docx").figure, fileKind("r.docx").view, fileKind("r.docx").extract], ["doc", "doc", "zip"]);
  assert.deepEqual([fileKind("s.xlsx").name, fileKind("s.xlsx").figure], ["sheet", "table"]);
  assert.equal(fileKind("p.pdf").extract, "pdf");
  assert.deepEqual([fileKind("d.csv").group, fileKind("d.csv").view, fileKind("d.csv").figure], ["text", "table", "table"]);
  assert.deepEqual([fileKind("m.json").figure, fileKind("m.json").view], ["code", "text"]);
  assert.deepEqual([fileKind("old.xls").view, fileKind("old.xls").figure], [undefined, "table"]);
  assert.deepEqual([fileKind("pack.7z").group, fileKind("pack.7z").view], ["file", undefined]);
  assert.deepEqual([fileKind("noext").name, fileKind("x.weird").figure], ["other", "other"]);
});
test("当不当文字读：浏览器报的类型或表里的文字一类", () => {
  assert.ok(isTextFile({ name: "notes.rst", type: "" }));
  assert.ok(isTextFile({ name: "blob", type: "application/ld+json" }));
  assert.ok(isTextFile({ name: "x", type: "text/plain" }));
  assert.ok(!isTextFile({ name: "a.pdf", type: "application/pdf" }));
  assert.ok(!isTextFile({ name: "a.png", type: "" }));
});
