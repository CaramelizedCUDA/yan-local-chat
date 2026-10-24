// 同一个文件经目录链接（junction）换了条路径去写：两条路认的是同一把写锁
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const createLocks = createRequire(import.meta.url)("../../server/work/locks.js");

test("经 junction 的路径与真实路径同用一把锁", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "junction-")),
    real = path.join(root, "real"),
    link = path.join(root, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, "junction");
  const { lockFile } = createLocks();
  const first = await lockFile(path.join(real, "a.txt"));
  let second = null;
  const waiting = lockFile(path.join(link, "a.txt")).then(release => (second = release));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(second, null, "经 junction 的那一路该在排队");
  first();
  await waiting;
  assert.equal(typeof second, "function");
  second();
});
