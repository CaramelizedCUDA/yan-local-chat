import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

const TEST_KEY = "test:node check.js";
const win = { YAN_PROMPTS: {} };
new Function("window", readFileSync(new URL("../../prompts/work.js", import.meta.url), "utf8"))(win);

function runtime() {
  const f = load([
    "asIntent",
    "applyIntentOps",
    "intentState",
    "intentWatch",
    "intentRound",
    "intentGate",
    "intentSettleKeeps",
    "keepIntent",
    "glance: c => intentGlances.get(glanceKey(c))",
    `setup: (request, prompts) => {
      bridge = request; Object.assign(PROMPTS, prompts);
      workScope = c => ({ workdir: c.workdir }); commandPolicyOf = () => 'auto';
      currentConversation = () => null; refreshSteps = saveStoreSoon = () => {};
    }`
  ]);
  const conversation = { id: "c1", workdir: "E:/isolated" },
    intent = f.applyIntentOps(
      f.asIntent(null),
      [
        { id: "上线", claim: "能部署", check: "可访问", root: true, anchors: ["file:a.txt"], state: "done" },
        { id: "测过", claim: "测试要过", check: "退出码 0", keep: true, anchors: [TEST_KEY], state: "done" }
      ],
      { prints: { "file:a.txt": "original", [TEST_KEY]: "过" }, ask: "收尾前测试要过" }
    ),
    commands = [];
  let filePrint = "original",
    exitCode = 0,
    pending = null;
  f.setup(async (url, body) => {
    if (url === "/api/work/intent") return { data: intent, version: "1" };
    if (url === "/api/work/prints") return { prints: { "a.txt": filePrint } };
    assert.equal(url, "/api/work/run");
    commands.push(body.command);
    return pending ? await pending : { exitCode };
  }, win.YAN_PROMPTS);
  f.keepIntent(conversation, intent, { "file:a.txt": filePrint, [TEST_KEY]: "过" });
  return {
    ...f,
    conversation,
    intent,
    commands,
    change: (print, code) => {
      filePrint = print;
      exitCode = code;
    },
    defer: () => {
      let resolve;
      pending = new Promise(done => {
        resolve = done;
      });
      return resolve;
    }
  };
}

for (const reason of ["文件凭据变化", "改过意"])
  test(`收尾前${reason}且守的测试失败：记清事由，修好后刷新，测试每阶段只跑一次`, async () => {
    const f = runtime(),
      c = f.conversation,
      watch = f.intentWatch(c),
      assistant = { content: "已完成", steps: [{ id: "w1", name: "write_file", status: "done", change: { path: "a.txt" } }] };
    f.change(reason === "文件凭据变化" ? "changed" : "original", 1);
    if (reason === "文件凭据变化") await f.intentRound(c, watch);
    else assistant.steps.push({ id: "i1", name: "update_intent", status: "done" });
    const gate = await f.intentGate(c, assistant, watch),
      step = assistant.steps.at(-1);
    assert.equal(step.result, "测过 · 测试不过");
    assert.equal(step.keep, true);
    assert.equal(watch.kept, true);
    assert.equal(watch.bounces.get("测过"), 1);
    assert.match(gate.content, /测过 1 回/);
    assert.deepEqual(f.commands, ["node check.js"]);
    await f.intentRound(c, watch);
    assert.equal(watch.bounces.get("测过"), 1, "后续工具轮不把同一次测试失败重复算作回归");
    f.change("original", 0);
    if (watch.kept) await f.intentSettleKeeps(c);
    const shown = f.glance(c);
    assert.equal(f.intentState(shown.intent, "测过", shown.now), "done");
    assert.deepEqual(f.commands, ["node check.js", "node check.js"]);
    assert.equal(await f.intentGate(c, assistant, watch), null, "只拦一次");
  });

test("守的测试仍过、意也没变：只查一次，照常收尾", async () => {
  const f = runtime(),
    c = f.conversation,
    watch = f.intentWatch(c);
  assert.equal(await f.intentGate(c, { steps: [{ name: "write_file", status: "done" }] }, watch), null);
  assert.equal(watch.kept, false);
  assert.deepEqual(f.commands, ["node check.js"]);
});

for (const change of ["同一对话换新意", "同目录另一对话换新意", "对话改绑目录"])
  test(`收尾复查尚未返回时${change}：迟到结果不改回旧显示`, async () => {
    const f = runtime(),
      c = f.conversation,
      before = f.glance(c),
      resolve = await f.defer();
    const settling = f.intentSettleKeeps(c);
    if (change === "对话改绑目录") c.workdir = "E:/another";
    else {
      const next = structuredClone(f.intent);
      next.nodes["上线"].claim = "新的交付目标";
      f.keepIntent(change === "同一对话换新意" ? c : { ...c, id: "c2" }, next, { [TEST_KEY]: "不过" });
    }
    const shown = f.glance(c);
    resolve({ exitCode: 0 });
    await settling;
    assert.equal(f.glance(c), shown);
    if (change === "对话改绑目录") assert.equal(f.glance({ ...c, workdir: "E:/isolated" }), before);
    else assert.equal(f.glance(c).intent.nodes["上线"].claim, "新的交付目标");
  });
