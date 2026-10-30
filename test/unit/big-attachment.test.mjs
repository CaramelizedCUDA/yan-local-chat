// 大附件：单件放到 256 MB；发问时只取用得着的——抽出正文的只取正文，没抽出的往后各问不取原件，这一问过大的给本机路径
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";
const createFiles = createRequire(import.meta.url)("../../server/files.js");

const MB = 1024 * 1024;
function engine(records) {
  const calls = [],
    f = load(["messageForApi", "setup:(fn,whole)=>{bridge=fn;getAttachment=whole;}"]);
  f.setup(
    async (route, body) => {
      calls.push([route, body.id, !!body.meta]);
      if (route === "/api/files/path") return { path: `D:\\言\\附件\\${body.id}` };
      const { data, ...meta } = records[body.id];
      return { record: body.meta && meta.kind !== "text" ? meta : records[body.id] };
    },
    async id => {
      calls.push(["whole", id]);
      return records[id];
    }
  );
  return { ...f, calls };
}
const text = entry => entry.content.map(part => part.text || "").join("\n");

test("抽出正文的文档：这一问与往后各问都只取正文，不取原件", async () => {
  const doc = { id: "pdf1", name: "书.pdf", kind: "file", mime: "application/pdf", size: 200 * MB, extracted: true };
  const f = engine({ pdf1: { ...doc, data: "data:application/pdf;base64,AAAA", extractedText: "第 1 页\n正文" } });
  for (const latest of [true, false])
    assert.match(text(await f.messageForApi({ role: "user", content: "读", attachments: [doc] }, latest)), /正文/);
  assert.ok(
    f.calls.every(([route, , meta]) => route === "/api/files/get" && meta),
    JSON.stringify(f.calls)
  );
});

test("没抽出正文的文件：往后各问不取原件；这一问过大的给本机路径，小的照旧整份送", async () => {
  const big = { id: "bin1", name: "录像.bin", kind: "file", mime: "application/octet-stream", size: 100 * MB, extracted: false },
    small = { id: "bin2", name: "小.bin", kind: "file", mime: "application/octet-stream", size: 1024, extracted: false };
  const f = engine({ bin2: { ...small, data: "data:application/octet-stream;base64,AAAA" } });
  const old = await f.messageForApi({ role: "user", content: "看", attachments: [big, small] }, false);
  assert.match(text(old), /先前发过/);
  assert.deepEqual(f.calls, []);
  const latest = await f.messageForApi({ role: "user", content: "看", attachments: [big, small] }, true);
  assert.match(text(latest), /D:\\言\\附件\\bin1/);
  assert.ok(latest.content.some(part => part.type === "file" && part.file.filename === "小.bin"));
  assert.ok(!f.calls.some(([route, id]) => route === "whole" && id === "bin1"), JSON.stringify(f.calls));
});

test("桥接：meta 只回元数据与抽出的正文，文本附件照给正文", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-meta-"));
  const { routes } = createFiles({ filesHome: () => root });
  const server = http.createServer((req, res) => routes[`POST ${req.url}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  try {
    await post("/api/files/put", {
      record: {
        id: "d1",
        kind: "file",
        name: "a.pdf",
        mime: "application/pdf",
        data: "data:application/pdf;base64,AAAA",
        extractedText: "正文"
      }
    });
    await post("/api/files/put", { record: { id: "t1", kind: "text", name: "a.txt", data: "全文" } });
    const doc = (await post("/api/files/get", { id: "d1", meta: true })).record;
    assert.equal(doc.data, undefined);
    assert.equal(doc.extractedText, "正文");
    assert.equal((await post("/api/files/get", { id: "t1", meta: true })).record.data, "全文");
    assert.match((await post("/api/files/get", { id: "d1" })).record.data, /^data:application\/pdf;base64,/);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
