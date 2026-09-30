import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/01-store/00-records.js", import.meta.url), "utf8");
const bridgeSource = source.slice(0, source.indexOf("// 结构迁移"));

test("并发工具请求给发送准备和存储留出连接，停止的等待请求不再发送", async () => {
  const pending = [];
  const controlUrls = [];
  const fetch = (url, options) => {
    const path = new URL(url, "http://127.0.0.1:8787").pathname;
    if (path === "/api/work/prepare" || path === "/api/chats/save") {
      controlUrls.push(url);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    return new Promise(resolve => pending.push({ path, url, resolve, options }));
  };
  const { bridge, state } = new Function(
    "fetch",
    `let apiBase = "", bootstrap = { chatBases: ["http://127.0.0.1:8800"], toolBase: "http://localhost:8787" }; const servedByBridge = () => true; ${bridgeSource}; return { bridge, state: () => ({ active: bridgeToolsActive, queued: bridgeToolQueue.length }) };`
  )(fetch);
  const taskA = new AbortController(), taskB = new AbortController();
  const one = bridge("/api/work/read", {}, taskA.signal);
  const two = bridge("/api/work/list", {}, taskA.signal);
  const three = bridge("/api/work/search", {}, taskA.signal);
  const four = bridge("/api/mcp/call", {}, taskA.signal);
  const five = bridge("/api/search", {}, taskA.signal);
  const six = bridge("/api/fetch", {}, taskB.signal);
  const stopped = new AbortController();
  const seven = bridge("/api/files/get", {}, stopped.signal);
  await Promise.resolve();
  assert.deepEqual(pending.map(item => item.path), ["/api/work/read", "/api/work/list", "/api/work/search", "/api/mcp/call"]);
  assert.ok(pending.every(item => item.url.startsWith("http://localhost:8787/")));
  assert.deepEqual(state(), { active: 4, queued: 3 });
  await Promise.all([bridge("/api/work/prepare", {}, null), bridge("/api/chats/save", {}, null)]);
  assert.equal(pending.length, 4);
  assert.deepEqual(controlUrls, ["/api/work/prepare", "/api/chats/save"]);

  stopped.abort();
  await assert.rejects(seven, { name: "AbortError" });
  assert.equal(state().queued, 2);
  pending[0].resolve(new Response("{}", { status: 200 }));
  await one;
  await Promise.resolve();
  assert.equal(pending[4].path, "/api/fetch", "另一任务先获得空位");
  pending[1].resolve(new Response("{}", { status: 200 }));
  await two;
  await Promise.resolve();
  assert.equal(pending[5].path, "/api/search");
  for (const item of pending.slice(2)) item.resolve(new Response("{}", { status: 200 }));
  await Promise.all([three, four, five, six]);
  assert.deepEqual(state(), { active: 0, queued: 0 });
});
