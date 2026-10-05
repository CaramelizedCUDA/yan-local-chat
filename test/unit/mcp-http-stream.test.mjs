// 可流式 HTTP 的 MCP：回复走事件流时，close() 要掐得到还在读的流；流半路断了，等回复的那一问当场落空，不干等到超时
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTransport } = require("../../server/mcp/transports.js");

// 一个回事件流的假服务：流先不结束，由测试决定何时出错
function fakeStream() {
  let controller;
  const body = new ReadableStream({ start: c => (controller = c) });
  const response = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  return { response, fail: error => controller.error(error) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("close() 掐断仍在读的事件流", async t => {
  const signals = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    signals.push(init.signal);
    return fakeStream().response;
  });
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} });
  assert.equal(signals[0].aborted, false);
  transport.close();
  assert.equal(signals[0].aborted, true);
});

test("事件流半路断了：等这条回复的那一问收到错误", async t => {
  const stream = fakeStream();
  t.mock.method(globalThis, "fetch", async () => stream.response);
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  const got = [];
  transport.onmessage = message => got.push(message);
  await transport.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: {} });
  stream.fail(Error("连接被重置"));
  await tick();
  await tick();
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 7);
  assert.match(got[0].error.message, /事件流中断/);
});

test("自己 close() 掐的流不当作出错", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const stream = fakeStream();
    init.signal.addEventListener("abort", () => stream.fail(Error("aborted")));
    return stream.response;
  });
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  const got = [];
  transport.onmessage = message => got.push(message);
  await transport.send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: {} });
  transport.close();
  await tick();
  await tick();
  assert.deepEqual(got, []);
});
