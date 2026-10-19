import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 把思考写进正文开头 <think>…</think> 的接口：思考里提到标签本身（`</think>`）不能当成收尾，不然后半截思考落进正文
const event = content => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`;
const done = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
const f = load([
  "readSse",
  "thinkCloser",
  "parseInlineThink",
  `setup: () => {
    document.documentElement.dataset.inkMotion = 'off';
    document.hidden = true;
    saveStoreSoon = saveStore = paintMessage = syncJumpBottom = scrollBottom = () => {};
  }`
]);
f.setup();
/** 按给的块一块块流进来 */
async function stream(chunks) {
  const assistant = { id: "a", role: "assistant", content: "", reasoning: "" };
  const wire = chunks.map(event).join("") + done;
  await f.readSse(new Response(wire, { headers: { "content-type": "text/event-stream" } }), assistant);
  return assistant;
}
const THOUGHT = '模型生成的 `</think>` 标记、引号里的 "</think>" 与「</think>」都只是提到它';

test("思考里提到的结束标签不算收尾：整段一块到", async () => {
  const a = await stream([`<think>${THOUGHT}\n</think>\n\n正文`]);
  assert.equal(a.reasoning, `${THOUGHT}\n`);
  assert.equal(a.content, "正文");
});

test("逐字流进来也一样（标签被切开、标签恰在块尾等下一个字）", async () => {
  const a = await stream([...`<think>${THOUGHT}\n</think>\n\n正文`]);
  assert.equal(a.reasoning, `${THOUGHT}\n`);
  assert.equal(a.content, "正文");
});

test("真的结束标签紧接正文、或流到头只剩标签", async () => {
  let a = await stream(["<think>想一想</think>答"]);
  assert.deepEqual([a.reasoning, a.content], ["想一想", "答"]);
  a = await stream(["<think>想", "一想</think>"]);
  assert.deepEqual([a.reasoning, a.content], ["想一想", ""]);
});

test("整段拆开（旧消息、撮要）：同样跳过提到的标签", () => {
  assert.deepEqual({ ...f.parseInlineThink(`<think>${THOUGHT}</think>\n正文`) }, { reasoning: THOUGHT, content: "正文" });
  assert.equal(f.parseInlineThink("正文里说到 <think>"), null);
  assert.equal(f.thinkCloser("`</think>`"), -1);
  assert.equal(f.thinkCloser("</think>x", "`"), -1);
  assert.equal(f.thinkCloser("ab</think>", "", false), -1);
  assert.equal(f.thinkCloser("ab</think>", "", true), 2);
});
