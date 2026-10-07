// 直接调用真实执事接口，不开 HTTP 服务；暂停 edit 的最终替换，让真实 shell 在同一文件上修改另一行。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire, Module } from "node:module";

const require = createRequire(import.meta.url);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// 只观察两个真实调用的入口，不替代锁或 shell 的实现；每次编译一份接口闭包，不污染 require 缓存。
function loadWork(lockRequested, shellStarted) {
  const filename = require.resolve("../../server/work/index.js"),
    workRequire = createRequire(filename),
    workModule = new Module(filename);
  workModule.filename = filename;
  workModule.require = id => {
    const actual = workRequire(id);
    if (id === "./locks.js")
      return (...args) => {
        const locks = actual(...args);
        return {
          ...locks,
          lockWorkdir: (...request) => {
            lockRequested.resolve("lock");
            return locks.lockWorkdir(...request);
          }
        };
      };
    if (id === "./shell.js")
      return (...args) => {
        const shell = actual(...args);
        return {
          ...shell,
          runShell: (...request) => {
            shellStarted.resolve("shell");
            return shell.runShell(...request);
          }
        };
      };
    return actual;
  };
  workModule._compile(fs.readFileSync(filename, "utf8"), filename);
  return workModule.exports;
}

test("edit 读后写回期间，前台指令等待；同文件的两处修改都保留", { timeout: 20000 }, async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "command-lock-")),
    file = path.join(root, "shared.txt"),
    atRename = deferred(),
    continueRename = deferred(),
    lockRequested = deferred(),
    shellStarted = deferred(),
    originalRename = fs.promises.rename;
  fs.writeFileSync(file, "first=old\nsecond=old\n");
  // 只暂停这个测试文件的原子替换，真实 edit 的读取、编码和写盘仍由产品代码完成。
  fs.promises.rename = async (from, to) => {
    if (to === file) {
      atRename.resolve();
      await continueRename.promise;
    }
    return originalRename(from, to);
  };
  const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|temp|tmp|systemdrive|comspec|pathext)$/i.test(key)));
  const work = loadWork(lockRequested, shellStarted)({ archiveHome: () => root, workHome: () => root, toolEnv: () => safeEnv });
  async function call(route, body) {
    const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, ...body }))]);
    const res = {
      headersSent: false, writableEnded: false, destroyed: false,
      on() {},
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(text) { this.data = JSON.parse(text); this.writableEnded = true; }
    };
    await work.routes[`POST /api/work/${route}`](req, res);
    return res;
  }
  let editing, running;
  try {
    editing = call("edit", { path: "shared.txt", old: "first=old", new: "first=edit" });
    await Promise.race([
      atRename.promise,
      editing.then(result => { throw Error(`edit 未到写回检查点：${JSON.stringify(result.data)}`); })
    ]);
    const command = process.platform === "win32"
      ? "[IO.File]::WriteAllText('shared.txt', ([IO.File]::ReadAllText('shared.txt').Replace('second=old', 'second=shell')))"
      : "sed 's/second=old/second=shell/' shared.txt > command.tmp && mv command.tmp shared.txt";
    running = call("run", { command, timeout: 10 });
    const checkpoint = await Promise.race([
      lockRequested.promise,
      shellStarted.promise,
      running.then(result => { throw Error(`run 未到入口检查点：${JSON.stringify(result.data)}`); })
    ]);
    // 有目录锁时，确认指令已申请锁就放行 edit；没有锁时，等真实 shell 改完再放行 edit，确定复现丢更新。
    // 由实际调用检查点决定交错，不用固定等待时间猜测 PowerShell 是否已启动。
    if (checkpoint === "shell") {
      const ran = await running;
      assert.equal(ran.status, 200);
      assert.equal(ran.data.exitCode, 0);
      assert.equal(fs.readFileSync(file, "utf8"), "first=old\nsecond=shell\n");
    } else assert.equal(fs.readFileSync(file, "utf8"), "first=old\nsecond=old\n");
    continueRename.resolve();
    const [edited, ran] = await Promise.all([editing, running]);
    assert.equal(edited.status, 200);
    assert.equal(ran.status, 200);
    assert.equal(ran.data.exitCode, 0);
    assert.equal(fs.readFileSync(file, "utf8"), "first=edit\nsecond=shell\n");
  } finally {
    continueRename.resolve();
    await Promise.allSettled([editing, running]);
    fs.promises.rename = originalRename;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
