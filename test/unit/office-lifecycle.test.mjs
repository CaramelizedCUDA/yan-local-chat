import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { load } from "./harness.mjs";

test("Office 安装能力每答刷新，模型工具沿用原对话目录和权限", async () => {
  const prompts = { work: {}, tools: {} };
  for (const file of ["work", "tools"])
    new Function("window", readFileSync(new URL(`../../prompts/${file}.js`, import.meta.url), "utf8"))({ YAN_PROMPTS: prompts });
  const requests = [],
    navigations = [];
  const f = load([
    "officeLock",
    "officeNote",
    "tool: TOOLS.get('open_office')",
    `setup: (request, navigate, prompts) => {
      bridge = request; Object.assign(PROMPTS, prompts); stage.ws = {}; stageSend = navigate;
      openStage = () => {}; workScope = c => ({ workdir: c.workdir, roam: false, sandbox: true });
      currentConversation = () => ({ id: 'another-chat' });
    }`
  ]);
  let installed = true;
  f.setup(
    async (url, body) => {
      requests.push({ url, body });
      return url.endsWith("/relay") ? { installed, docs: [] } : { url: "http://127.0.0.1:9002/yan/host.html?t=test" };
    },
    async (...args) => navigations.push(args),
    prompts
  );
  const conversation = { id: "original", workdir: "E:/original" },
    signal = new AbortController().signal;
  await f.officeLock(conversation, "owner", signal);
  assert.match(f.officeNote([]), /已安装 Office/);
  assert.equal(f.tool.offer({ files: true }), true);
  const outcome = await f.tool.run({}, { path: "报告.docx" }, { conversation, signal });
  assert.equal(outcome.ok, true);
  assert.equal(navigations[0][0], "Target.createTarget");
  assert.deepEqual(requests.at(-1).body, {
    workdir: "E:/original",
    roam: false,
    sandbox: true,
    path: "报告.docx",
    conversation: "original",
    locale: "zh",
    theme: "light"
  });
  assert.equal((await f.tool.run({}, { path: "index.html" }, { conversation, signal })).ok, false);
  installed = false;
  await f.officeLock(conversation, "owner", signal);
  assert.equal(f.officeNote([]), "");
  assert.equal(f.tool.offer({ files: true }), false);
});

test("Office 客户端不忽略失败、缺失和未只读的确认", async () => {
  const f = load(["officeLock", "setup: request => { bridge = request; }"]);
  for (const answers of [[], [{ error: "failed" }], [{ locked: false }], [{ locked: true, dirty: true }]]) {
    f.setup(async () => ({ docs: [{ path: "test.docx", hosts: 1, answers }] }));
    await assert.rejects(f.officeLock({ id: "A" }, "owner", new AbortController().signal), /文档未能存盘/);
  }
  f.setup(async () => {
    throw Error("bridge failed");
  });
  await assert.rejects(f.officeLock({ id: "A" }, "owner", new AbortController().signal), /bridge failed/);
});

test("离页释放 Office 锁前先停止作答，缓存恢复后不继续操作已经解锁的文档", async () => {
  const controller = new AbortController(),
    requests = [];
  const source = readFileSync(new URL("../../src/26-stage/60-office.js", import.meta.url), "utf8").match(
    /function releaseOfficeTurns\(\) \{[\s\S]*?\n\}/
  )[0];
  vm.runInNewContext(source + "\nreleaseOfficeTurns();", {
    requestJobs: new Map([["A", { controller }]]),
    officeTurns: new Map([["owner", "A"]]),
    apiBase: "",
    fetch: async (url, options) => {
      assert.equal(controller.signal.aborted, true);
      requests.push({ url, options });
    }
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.keepalive, true);
  assert.deepEqual(JSON.parse(requests[0].options.body), { cmd: "unlock", conversation: "A", owner: "owner" });
});

test("作答准备取消也释放迟到文档锁，旧作答不释放新作答的持有者", async () => {
  const noop = () => {},
    jobs = new Map(),
    holders = new Set(),
    preparing = new Map();
  let seq = 0;
  const context = vm.createContext({
    AbortController,
    performance,
    console,
    requestJobs: jobs,
    PAGE_ID: "page",
    uid: () => String(++seq),
    renderSendButtons: noop,
    renderHistory: noop,
    currentId: "elsewhere",
    isWork: () => true,
    setInterval,
    clearInterval,
    clearTimeout,
    newTally: () => ({ usage: {}, opened: false, usageKnown: false }),
    inlineTextBudget: () => 1000,
    loadLedger: async () => null,
    loadIntent: async (c, signal) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(Object.assign(Error("stopped"), { name: "AbortError" })), { once: true })
      ),
    officeLock: async (c, owner) => {
      holders.add(owner);
      await new Promise(resolve => preparing.set(owner, resolve));
      return ["test.docx"];
    },
    officeUnlock: async (c, owner) => {
      holders.delete(owner);
    },
    returnHeldReports: noop,
    settleSteps: noop,
    accountUsage: noop,
    settleSupplements: noop,
    markDirty: noop,
    saveStore: noop,
    view: "chat",
    renderChatMeta: noop,
    renderOutline: noop,
    updateContextGauge: noop,
    finalizeAssistant: noop
  });
  vm.runInContext(readFileSync(new URL("../../src/14-chat-engine/20-stream.js", import.meta.url), "utf8"), context);
  const conversation = { id: "A", messages: [] },
    assistant = id => ({ id, status: "streaming", content: "", steps: [] });
  const old = assistant("old"),
    oldTurn = context.streamReply(conversation, old, {});
  jobs.get("A").controller.abort();
  const current = assistant("current"),
    currentTurn = context.streamReply(conversation, current, {}),
    currentJob = jobs.get("A");
  preparing.get("page:1")();
  await oldTurn;
  assert.equal(old.status, "stopped");
  assert.deepEqual([...holders], ["page:2"]);
  assert.equal(jobs.get("A"), currentJob);
  currentJob.controller.abort();
  preparing.get("page:2")();
  await currentTurn;
  assert.equal(holders.size, 0);
});
