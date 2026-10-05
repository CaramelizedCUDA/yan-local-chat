// 言 · 桥接 · 执事的写锁
"use strict";

// ---- 并行帮手共用一个目录时的写锁：同一文件的写入 / 修改按先后排队（edit 的读—改—写在锁内，不会互相覆盖），不同文件照常并行；
// run_command 可能改任意文件，拿的是整个工作目录的独占锁——指令跑着的时候文件写入等它，文件写着的时候指令等它们
class RwLock {
  constructor() {
    this.readers = 0;
    this.writer = false;
    this.queue = [];
  }
  // signal：请求那头停了（页面点停止、断线）——还在排队就出队，排到时已停就随手还锁；两种都以「已停止」落空，不再去动文件
  acquire(exclusive, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(stopped());
      const onAbort = () => {
        const at = this.queue.indexOf(entry);
        if (at < 0) return;
        this.queue.splice(at, 1);
        reject(stopped());
        this.pump();
      };
      const entry = {
        exclusive,
        resolve: release => {
          signal?.removeEventListener("abort", onAbort);
          if (!signal?.aborted) return resolve(release);
          release();
          reject(stopped());
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }
  pump() {
    while (this.queue.length) {
      const head = this.queue[0];
      if (this.writer || (head.exclusive && this.readers)) break;
      this.queue.shift();
      if (head.exclusive) this.writer = true;
      else this.readers += 1;
      let released = false;
      head.resolve(() => {
        if (released) return;
        released = true;
        if (head.exclusive) this.writer = false;
        else this.readers -= 1;
        this.pump();
      });
    }
  }
}
const stopped = () => Object.assign(Error("已停止"), { stopped: true });
module.exports = function createLocks() {
  const dirLocks = new Map(),
    pathLocks = new Map();
  function lockKey(file) {
    return process.platform === "win32" ? file.toLowerCase() : file;
  }
  function lockOf(map, key) {
    let lock = map.get(key);
    if (!lock) {
      lock = new RwLock();
      map.set(key, lock);
    }
    return lock;
  }
  // 写一个文件：目录共享锁 + 该路径独占锁；返回一次性的释放函数
  async function lockFile(workdir, file, signal) {
    const releaseDir = await lockOf(dirLocks, lockKey(workdir)).acquire(false, signal);
    const key = lockKey(file);
    let releasePath;
    try {
      releasePath = await lockOf(pathLocks, key).acquire(true, signal);
    } catch (error) {
      releaseDir();
      const lock = pathLocks.get(key);
      if (lock && !lock.writer && !lock.readers && !lock.queue.length) pathLocks.delete(key);
      throw error;
    }
    return () => {
      releasePath();
      releaseDir();
      const lock = pathLocks.get(key);
      if (lock && !lock.writer && !lock.readers && !lock.queue.length) pathLocks.delete(key);
    };
  }
  function lockWorkdir(workdir, signal) {
    return lockOf(dirLocks, lockKey(workdir)).acquire(true, signal);
  }
  return { lockFile, lockWorkdir };
};
