// 经 OpenAI 兼容中转用 Claude 时的缓存标记：系统提示一处、最后一条一处，原消息不动；别家模型不标
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
createRequire(import.meta.url)("../../src/19-anthropic.js");
const { claudeModel, markOpenAiCache } = globalThis.YAN_ANTHROPIC;

test("only Claude models get cache marks", () => {
  assert.ok(claudeModel("claude-opus-5.5"));
  assert.ok(claudeModel("anthropic/Claude-Sonnet-5.5"));
  assert.ok(!claudeModel("gpt-6-luna"));
  assert.ok(!claudeModel("qwen3.8-27b"));
});

test("marks the system prompt and the last message, leaves the rest", () => {
  const messages = [
    { role: "system", content: "系统" },
    { role: "user", content: "读 a" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "a 的内容" }
  ];
  const marked = markOpenAiCache(messages);
  assert.deepEqual(marked[0].content, [{ type: "text", text: "系统", cache_control: { type: "ephemeral" } }]);
  assert.equal(marked[1], messages[1]);
  assert.equal(marked[2], messages[2]);
  assert.deepEqual(marked[3].content, [{ type: "text", text: "a 的内容", cache_control: { type: "ephemeral" } }]);
  assert.equal(messages[3].content, "a 的内容", "原消息不被改动");
});

test("a multi-part tail gets the mark on its last part only", () => {
  const tail = { role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "data:," } }] };
  const [marked] = markOpenAiCache([tail]);
  assert.equal(marked.content[0].cache_control, undefined);
  assert.deepEqual(marked.content[1].cache_control, { type: "ephemeral" });
  assert.equal(tail.content[1].cache_control, undefined);
});
