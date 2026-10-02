import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("执行时只认这一轮交给模型的工具：旁注只给了查的，模型照名字调写文件也不执行", async () => {
  const { runTool, TOOLS } = load(["runTool", "TOOLS"]);
  assert.ok(TOOLS.get("write_file")?.run);
  const step = { id: "s1", name: "write_file", arguments: JSON.stringify({ path: "a.txt", content: "x" }) };
  const outcome = await runTool(step, { offered: new Set(["web_search", "fetch_url"]) });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.display, "此处未提供");
  // 帮手照名字调只给主模型的：仍说清是无权
  const delegate = [...TOOLS.values()].find(tool => tool.mainOnly && tool.run);
  const sub = await runTool({ id: "s2", name: delegate.name, arguments: "{}", scope: "sub-1" }, { offered: new Set(["web_search"]) });
  assert.equal(sub.display, "帮手无权");
});

test("合并：一页展开了较早的回复，另一页重答了后面的一答，收进分支的旧答不再接回来", () => {
  const { mergeConversation } = load(["mergeConversation"]);
  const base = {
    id: "c",
    title: "题",
    unread: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [
      { id: "u1", role: "user", content: "一问" },
      { id: "a1", role: "assistant", content: "一答" },
      { id: "u2", role: "user", content: "二问" },
      { id: "a2", role: "assistant", content: "旧二答" }
    ],
    forks: [],
    threads: []
  };
  const ours = structuredClone(base);
  ours.messages[1].reasoningOpen = true;
  const theirs = structuredClone(base);
  theirs.forks = [{ id: "f1", messages: [theirs.messages.pop()] }];
  theirs.messages.push({ id: "a3", role: "assistant", content: "新二答" });
  const merged = mergeConversation(ours, theirs, base);
  assert.deepEqual(
    merged.messages.map(m => m.id),
    ["u1", "a1", "u2", "a3"]
  );
  assert.equal(merged.messages[1].reasoningOpen, true);
  assert.equal(merged.forks.length, 1);
});

test("旁注与后台帮手也算这边正在写：同步不把它们手上的对象换掉", () => {
  const { busyHere, requestJobs, crews } = load(["busyHere", "requestJobs", "crews"]);
  assert.equal(busyHere("c"), false);
  requestJobs.set("side:t1", { conversationId: "c" });
  assert.equal(busyHere("c"), true);
  requestJobs.clear();
  crews.set("c", [{}]);
  assert.equal(busyHere("c"), true);
});

test("用量记在此刻表里的那份模型上：作答途中配置同步换过模型列表也不漏", () => {
  const { spendTokens, setProfiles } = load(["spendTokens", "setProfiles: list => { store.profiles = list; }"]);
  const old = { id: "p", usedTokens: 5 },
    fresh = { id: "p", usedTokens: 5 };
  setProfiles([fresh]);
  assert.equal(spendTokens(old, 30), fresh);
  assert.equal(fresh.usedTokens, 35);
  assert.equal(old.usedTokens, 5);
});

test("附件读到一半换了对话：读好的归点选时那一段的草稿，不落进眼前这段", () => {
  const f = load([
    "placeAttachment",
    "pending: () => pendingAttachments",
    "drafts: () => store.drafts",
    "open: (id, list = []) => { currentId = id; pendingAttachments = list; }"
  ]);
  f.open("A");
  f.placeAttachment("A", { id: "x1" });
  assert.deepEqual(
    f.pending().map(file => file.id),
    ["x1"]
  );
  f.open("B");
  f.placeAttachment("A", { id: "x2" });
  assert.deepEqual(f.pending(), []);
  assert.deepEqual(
    f.drafts().A.attachments.map(file => file.id),
    ["x2"]
  );
});

test("等待开工时接着写的、又置入的留在案上，只发点发送那一刻的", () => {
  const f = load([
    "takeComposer",
    "composerSnapshot",
    "setPending: list => { pendingAttachments = list; currentId = 'A'; store.drafts = {}; renderAttachments = renderQuote = () => {}; }"
  ]);
  const first = { id: "f1" },
    later = { id: "f2" },
    input = { value: "第一句", style: {}, scrollHeight: 40 };
  f.setPending([first]);
  const snapshot = f.composerSnapshot(input);
  input.value = "第一句 又补一句";
  f.setPending([first, later]);
  const user = f.takeComposer(input, "A", snapshot);
  assert.equal(user.content, "第一句");
  assert.deepEqual(
    user.attachments.map(file => file.id),
    ["f1"]
  );
  assert.equal(input.value, "又补一句");
});
