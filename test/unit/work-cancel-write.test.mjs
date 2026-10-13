import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");

for (const route of ["write", "edit", "intent"])
  test(`${route}：临时文件写好时停止，不再替换原件，临时文件清掉`, async () => {
    const parent = path.resolve("test/.tmp");
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, "cancel-write-"));
    assert.equal(path.dirname(root), parent);
    const file = path.join(root, route === "intent" ? ".yan/意.json" : "a.txt");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = route === "intent" ? '{"nodes":{},"log":[]}' : "BEFORE";
    fs.writeFileSync(file, original);
    const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
    const response = () =>
      Object.assign(new EventEmitter(), {
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
    const call = async (body, res) => {
      const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, ...body }))]);
      await work.routes[`POST /api/work/${route}`](req, res);
    };
    let base = "",
      stopped = false;
    if (route === "intent") {
      const read = response();
      await call({}, read);
      base = JSON.parse(read.body).version;
    }
    const res = response(),
      open = fs.promises.open;
    fs.promises.open = async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).startsWith(path.join(path.dirname(file), `.${path.basename(file)}.`))) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          await sync();
          stopped = true;
          res.destroyed = true;
          res.emit("close");
        };
      }
      return handle;
    };
    try {
      await call(
        route === "intent"
          ? { base, data: { nodes: { after: {} } } }
          : route === "edit"
            ? { path: "a.txt", old: "BEFORE", new: "AFTER_STOP" }
            : { path: "a.txt", content: "AFTER_STOP" },
        res
      );
      assert.equal(stopped, true);
      assert.equal(fs.readFileSync(file, "utf8"), original);
      assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)]);
    } finally {
      fs.promises.open = open;
      if (path.dirname(root) !== parent) throw Error("测试清理目录越界");
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
