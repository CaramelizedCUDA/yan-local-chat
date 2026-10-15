// 言 · 桥接 · 执事的写锁
"use strict";
const fs = require("node:fs");
const path = require("node:path");

// ---- 并行帮手共用一个目录时的写锁：同一文件的写入 / 修改按先后排队（edit 的读—改—写在锁内，不会互相覆盖），不同文件照常并行。
// run_command 不拿锁：对谈的工作目录都是卷宗，一把整目录的锁会让所有对话、所有帮手的指令与写入排成一队，
// 一条长指令（或子进程拖着没关输出、等到超时的）就把别处全卡住。指令与 edit 恰好同时改同一个文件的少见情形，
// 由 edit 的原文比对兜着——对不上就报错重读，不会悄悄盖掉
class Mutex {
  constructor() {
    this.held = false;
    this.queue = [];
  }
  // signal：请求那头停了（页面点停止、断线）——还在排队就出队，排到时已停就随手还锁；两种都以「已停止」落空，不再去动文件
  acquire(signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(stopped());
      const onAbort = () => {
        const at = this.queue.indexOf(entry);
        if (at < 0) return;
        this.queue.splice(at, 1);
        reject(stopped());
      };
      const entry = release => {
        signal?.removeEventListener("abort", onAbort);
        if (!signal?.aborted) return resolve(release);
        release();
        reject(stopped());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }
  pump() {
    if (this.held || !this.queue.length) return;
    this.held = true;
    let released = false;
    this.queue.shift()(() => {
      if (released) return;
      released = true;
      this.held = false;
      this.pump();
    });
  }
}
const stopped = () => Object.assign(Error("已停止"), { stopped: true });
module.exports = function createLocks() {
  const pathLocks = new Map();
  const lockKey = file => (process.platform === "win32" ? file.toLowerCase() : file);
  // 同一个文件有几种写法（目录链接、junction、符号链接）：按真实路径认锁，不然两条路各拿一把、同时改同一份。
  // 还不存在的文件取最深一层在的上级的真实路径，再把余下几段接回去
  async function canonical(file) {
    const rest = [];
    for (let dir = file; ; ) {
      try {
        return path.join(await fs.promises.realpath(dir), ...rest);
      } catch {
        const up = path.dirname(dir);
        if (up === dir) return file;
        rest.unshift(path.basename(dir));
        dir = up;
      }
    }
  }
  // 写一个文件：该路径的独占锁；返回一次性的释放函数。没人握着、也没人排队的锁随手清掉
  async function lockFile(file, signal) {
    const key = lockKey(await canonical(file));
    let lock = pathLocks.get(key);
    if (!lock) pathLocks.set(key, (lock = new Mutex()));
    const forget = () => {
      if (pathLocks.get(key) === lock && !lock.held && !lock.queue.length) pathLocks.delete(key);
    };
    try {
      const release = await lock.acquire(signal);
      return () => {
        release();
        forget();
      };
    } catch (error) {
      forget();
      throw error;
    }
  }
  return { lockFile };
};
