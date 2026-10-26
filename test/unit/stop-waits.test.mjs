// 「停止」要盖住等待的那一段：排队等写锁时停了不再动文件；等连接、重拉工具时停了不再发 tools/call
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createLocks = require("../../server/work/locks.js");
const { McpClient } = require("../../server/mcp/client.js");

test("排队等文件锁时停下：出队落空，锁放开后也不会再拿到", async () => {
  const { lockFile } = createLocks();
  const first = await lockFile("D:/w/a.txt");
  const stop = new AbortController();
  let granted = false;
  const queued = lockFile("D:/w/a.txt", stop.signal).then(release => ((granted = true), release));
  stop.abort();
  await assert.rejects(queued, /已停止/);
  first();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(granted, false);
  // 锁没有被落空的那一位占住：后来的照常拿到
  const next = await lockFile("D:/w/a.txt");
  next();
});

test("已经停了的请求拿不到锁，锁也不被占着", async () => {
  const { lockFile } = createLocks();
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(lockFile("D:/w/a.txt", stop.signal), /已停止/);
  const release = await lockFile("D:/w/a.txt");
  release();
});

test("同一文件按先后排队，不同文件各走各的", async () => {
  const { lockFile } = createLocks();
  const root = mkdtempSync(path.join(os.tmpdir(), "yan-lock-waits-"));
  try {
    const lower = path.join(root, "a.txt"), upper = path.join(root, "A.txt"), otherPath = path.join(root, "b.txt");
    writeFileSync(lower, "a");
    writeFileSync(otherPath, "b");
    const aliasesSameFile = existsSync(upper);
    const a = await lockFile(lower);
    let second = false;
    const queued = lockFile(upper).then(release => ((second = true), release));
    const other = await lockFile(otherPath);
    other();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(second, !aliasesSameFile, "按当前文件系统的大小写别名行为判断");
    a();
    (await queued)();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fakeClient() {
  const sent = [];
  const client = new McpClient({ name: "t", config: {}, version: "0", toolEnv: env => env });
  let answerList;
  client.transport = {
    send: async message => {
      sent.push(message.method);
      if (message.method === "tools/list") answerList = () => client.receive({ id: message.id, result: { tools: [] } });
    }
  };
  return { client, sent, answerList: () => answerList() };
}

test("MCP：重拉工具清单时停下，不再发出 tools/call", async () => {
  const { client, sent, answerList } = fakeClient();
  client.toolsChanged = true;
  const stop = new AbortController();
  const call = client.call("draw", {}, { signal: stop.signal });
  await new Promise(resolve => setImmediate(resolve));
  stop.abort();
  answerList();
  await assert.rejects(call, /已停止/);
  assert.deepEqual(sent, ["tools/list"]);
});

test("MCP：等连接时已经停了的调用，不发出 tools/call", async () => {
  const { client, sent } = fakeClient();
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(client.call("draw", {}, { signal: stop.signal }), /已停止/);
  assert.deepEqual(sent, []);
});
