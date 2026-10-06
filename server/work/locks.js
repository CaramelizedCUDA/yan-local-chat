// 言 · 桥接 · 执事的写锁
"use strict";

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
  // 写一个文件：该路径的独占锁；返回一次性的释放函数。没人握着、也没人排队的锁随手清掉
  async function lockFile(file, signal) {
    const key = lockKey(file);
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
