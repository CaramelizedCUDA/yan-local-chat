import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("本机页面把主任务与帮手的模型请求分摊到流通道，其他页面仍走原桥接", () => {
  const { chatRelayBase, configure } = load([
    "chatRelayBase",
    "configure: (bases, base) => { bootstrap.chatBases = bases; apiBase = base; }"
  ]);
  const bases = ["http://127.0.0.1:10001", "http://127.0.0.1:10002", "http://127.0.0.1:10003"];
  configure(bases, "");
  const chosen = Array.from({ length: 12 }, () => chatRelayBase());
  assert.deepEqual(chosen.map(base => chosen.filter(value => value === base).length), Array(12).fill(4));
  configure(bases, "http://127.0.0.1:8787");
  assert.equal(chatRelayBase(), "http://127.0.0.1:8787");
  configure([], "");
  assert.equal(chatRelayBase(), "");
});
