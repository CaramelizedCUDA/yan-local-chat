import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { writeAtomic } = require("../../server/http.js");
const clean = dir => {
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
  fs.rmdirSync(dir);
};

test("配置文件被短暂占用后仍能原子替换", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-atomic-"));
  const file = path.join(dir, "配置.json");
  const rename = fs.renameSync;
  try {
    fs.writeFileSync(file, "old");
    let attempts = 0;
    fs.renameSync = (...args) => {
      if (attempts++ === 0) throw Object.assign(Error("temporarily busy"), { code: "EBUSY" });
      return rename(...args);
    };
    writeAtomic(file, "new");
    assert.equal(fs.readFileSync(file, "utf8"), "new");
    assert.equal(attempts, 2);
    assert.deepEqual(fs.readdirSync(dir), ["配置.json"]);
  } finally {
    fs.renameSync = rename;
    clean(dir);
  }
});

test("持续占用时正本保留，临时文件清掉，错误仍交回", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-atomic-"));
  const file = path.join(dir, "配置.json");
  const rename = fs.renameSync;
  try {
    fs.writeFileSync(file, "old");
    fs.renameSync = () => {
      throw Object.assign(Error("still busy"), { code: "EBUSY" });
    };
    assert.throws(() => writeAtomic(file, "new"), { code: "EBUSY" });
    assert.equal(fs.readFileSync(file, "utf8"), "old");
    assert.deepEqual(fs.readdirSync(dir), ["配置.json"]);
  } finally {
    fs.renameSync = rename;
    clean(dir);
  }
});
