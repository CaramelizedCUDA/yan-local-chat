import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");

// 读后被别人改过：整份覆盖不写，照原文改一处的照改并捎回改前的指纹
function setup() {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "stale-"));
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  const call = async (route, body) => {
    const res = Object.assign(new EventEmitter(), {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      body: "",
      writeHead() {
        this.headersSent = true;
      },
      end(text) {
        this.body = String(text || "");
        this.writableEnded = true;
      }
    });
    const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, path: "a.txt", ...body }))]);
    await work.routes[`POST /api/work/${route}`](req, res);
    return JSON.parse(res.body);
  };
  return { root, call };
}

test("读后被改：write 不覆盖，回现状指纹", async () => {
  const { root, call } = setup();
  const read = await call("read", {});
  assert.match(read.sig, /^[0-9a-f]{16}$/);
  const other = await call("edit", { old: "two", new: "TWO", seen: read.sig });
  assert.equal(other.drift, undefined);
  const stale = await call("write", { content: "mine\n", seen: read.sig });
  assert.equal(stale.stale, true);
  assert.equal(stale.sig, other.sig);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "one\nTWO\n");
  // 带着现状的指纹就写得进
  const ok = await call("write", { content: "mine\n", seen: other.sig });
  assert.equal(ok.stale, undefined);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "mine\n");
});

test("读后被改：edit 原文对得上照改，捎回改前指纹", async () => {
  const { root, call } = setup();
  const read = await call("read", {});
  const other = await call("edit", { old: "two", new: "TWO", seen: read.sig });
  const mine = await call("edit", { old: "one", new: "ONE", seen: read.sig });
  assert.equal(mine.drift, other.sig);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "ONE\nTWO\n");
  // 没带 seen（旧页面）不比
  const legacy = await call("write", { content: "x\n" });
  assert.equal(legacy.stale, undefined);
});
