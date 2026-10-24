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

// 守的钩子：写了 on 的守，对得上的那一步动手前先跑它挂的测试；平时不取它的指纹，收尾时也不重查
function hookRuntime({ policy = "auto", exitCode = 1 } = {}) {
  const f = load([
    "asIntent",
    "applyIntentOps",
    "normalizeIntentOps",
    "intentSealing",
    "intentSealedAnchors",
    "intentWatch",
    "intentGate",
    "keepIntent",
    "keepHook",
    `setup: (request, prompts, policy) => {
      bridge = request; Object.assign(PROMPTS, prompts);
      workScope = c => ({ workdir: c.workdir }); commandPolicyOf = () => policy;
      currentConversation = () => null; refreshSteps = saveStoreSoon = () => {};
    }`
  ]);
  const conversation = { id: "c1", workdir: "E:/isolated" },
    { ops, problems } = f.normalizeIntentOps(f.asIntent(null), [
      { id: "上线", claim: "能部署", check: "可访问", root: true, needs: ["部署"] },
      { id: "部署", claim: "推上去", check: "看得到" },
      { id: "算力", claim: "只用获准的机器", check: "守卫脚本过", keep: true, on: "ssh|10\\.1\\.", anchors: ["test:python guard.py"] }
    ]),
    intent = f.applyIntentOps(f.asIntent(null), ops, { prints: {} }),
    runs = [];
  f.setup(
    async (url, body) => {
      if (url === "/api/work/intent") return { data: intent, version: "1" };
      assert.equal(url, "/api/work/run");
      runs.push(body);
      return { exitCode, stdout: "预约已过截止", stderr: "" };
    },
    win.YAN_PROMPTS,
    policy
  );
  f.keepIntent(conversation, intent, {});
  const ctx = { conversation, assistant: { steps: [] } };
  return { ...f, conversation, intent, problems, runs, ctx };
}

test("钩子：对得上的指令动手前跑守的测试，将要做的交给它；不过即不做", async () => {
  const f = hookRuntime();
  assert.deepEqual(f.problems, []);
  const outcome = await f.keepHook({ name: "run_command" }, { command: "ssh 10.1.2.3 train.sh" }, f.ctx);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.display, "守拦下 · 算力");
  assert.match(outcome.content, /守「算力」拦下了这一步，没有执行：测试「python guard\.py」不过（退出码 1）。\n预约已过截止/);
  assert.deepEqual(f.runs[0].hook, { tool: "run_command", target: "ssh 10.1.2.3 train.sh" });
  assert.equal(f.runs[0].command, "python guard.py");
});

test("钩子：对不上的、改意本身、测试过了的都放行", async () => {
  const f = hookRuntime();
  assert.equal(await f.keepHook({ name: "run_command" }, { command: "npm test" }, f.ctx), null);
  assert.equal(await f.keepHook({ name: "read_file" }, { path: "ssh.txt" }, f.ctx), null, "没有副作用的不过钩子");
  assert.equal(await f.keepHook({ name: "update_intent" }, { nodes: [{ id: "ssh", state: "removed" }] }, f.ctx), null);
  assert.equal(f.runs.length, 0);
  const pass = hookRuntime({ exitCode: 0 });
  assert.equal(await pass.keepHook({ name: "write_file" }, { path: "deploy/ssh_config" }, pass.ctx), null);
  assert.equal(pass.runs.length, 1);
});

test("钩子：问而后行里不自动跑非只读的测试——那一步本就要人批", async () => {
  const f = hookRuntime({ policy: "ask" });
  assert.equal(await f.keepHook({ name: "run_command" }, { command: "ssh 10.1.2.3" }, f.ctx), null);
  assert.equal(f.runs.length, 0);
});

test("钩子挂的测试平时不取指纹，动过手的那一答收尾也不重查", async () => {
  const f = hookRuntime(),
    ops = [{ id: "算力", state: "done" }];
  assert.deepEqual(f.intentSealing(f.intent, ops), []);
  assert.deepEqual(f.intentSealedAnchors(f.intent), []);
  assert.deepEqual(f.intent.nodes["算力"].seal.prints, {});
  const assistant = { content: "已完成", steps: [{ id: "r1", name: "run_command", status: "done" }] };
  assert.equal(await f.intentGate(f.conversation, assistant, f.intentWatch(f.conversation)), null);
  assert.equal(f.runs.length, 0);
});

test("撤了钩子的守转收尾重查：撤时补记测试的指纹", () => {
  const f = hookRuntime(),
    ops = [{ id: "算力", on: "" }];
  assert.deepEqual(f.intentSealing(f.intent, ops), ["test:python guard.py"]);
  const next = f.applyIntentOps(f.intent, ops, { prints: { "test:python guard.py": "过" } });
  assert.equal(next.nodes["算力"].on, undefined);
  assert.deepEqual(next.nodes["算力"].seal.prints, { "test:python guard.py": "过" });
  assert.deepEqual(f.intentSealedAnchors(next), ["test:python guard.py"]);
});

test("on 的写法：只给守、要挂 test:、须是合法的正则", () => {
  const f = load(["asIntent", "normalizeIntentOps"]),
    problems = ops => f.normalizeIntentOps(f.asIntent(null), ops).problems.join("\n"),
    goal = { id: "上线", claim: "能部署", check: "可访问", root: true };
  assert.match(problems([goal, { id: "部署", claim: "推上去", check: "看得到", on: "ssh", root: true }]), /部署 不是守：on 只给守/);
  assert.match(problems([goal, { id: "算力", claim: "限机器", check: "看", keep: true, on: "ssh" }]), /算力 写了 on，要挂一条 test:/);
  assert.match(
    problems([goal, { id: "算力", claim: "限机器", check: "看", keep: true, on: "ssh(", anchors: ["test:x"] }]),
    /算力 的 on 不是合法的正则/
  );
});
