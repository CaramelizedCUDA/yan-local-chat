// P1 回归：名册写护栏（服务端执行入口）、主簿接管与进展回报不叫醒、重派防环、按档位过滤工具
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");
const createLocks = require("../../server/work/locks.js");

const root = path.resolve("test/.tmp/fleet"),
  other = path.resolve("test/.tmp/fleet-other");
rmSync(root, { recursive: true, force: true });
rmSync(other, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
mkdirSync(other, { recursive: true });
after(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});
// 名册：readonly 稽核、serialized 写型（各一只不限域的与一只拴在 root 的）
const ROSTER = {
  bots: [
    { id: "auditor", writePolicy: "readonly" },
    { id: "writer", writePolicy: "serialized" },
    { id: "confined", writePolicy: "serialized", workRoot: root }
  ]
};
const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env, roster: () => ROSTER });
async function call(route, body, workdir = root) {
  const req = Readable.from([Buffer.from(JSON.stringify({ workdir, ...body }))]);
  let status = 0,
    text = "";
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    // 名册写护栏的目录锁挂在响应落定上还（onResponseSettled）：mock 得真发 finish，不然下一条写型指令排队死等
    _l: {},
    on(name, fn) {
      (this._l[name] ||= []).push(fn);
      return this;
    },
    once(name, fn) {
      return this.on(name, fn);
    },
    removeListener(name, fn) {
      const a = this._l[name] || [],
        i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
      return this;
    },
    writeHead(code) {
      status = code;
      this.headersSent = true;
    },
    end(chunk) {
      text = String(chunk || "");
      this.writableEnded = true;
      for (const fn of this._l.finish || []) fn();
    }
  };
  await work.routes[`POST /api/work/${route}`](req, res);
  return { status, data: JSON.parse(text || "{}") };
}

test("写护栏：只读档的文件写一律拒，原件不动；写型档照常", async () => {
  const denied = await call("write", { bot: "auditor", path: "a.txt", content: "x" });
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /只读/);
  assert.equal(existsSync(path.join(root, "a.txt")), false);
  const ok = await call("write", { bot: "writer", path: "a.txt", content: "x" });
  assert.equal(ok.status, 200);
  assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "x");
});
test("写护栏：只读档的指令只放标了 readOnly 的；写型档的指令照常", async () => {
  const denied = await call("run", { bot: "auditor", command: "echo hi > blocked.txt", readOnly: false });
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /只读/);
  assert.equal(existsSync(path.join(root, "blocked.txt")), false);
  const list = await call("run", { bot: "auditor", command: process.platform === "win32" ? "dir" : "ls", readOnly: true, timeout: 30 });
  assert.equal(list.status, 200, JSON.stringify(list.data).slice(0, 300));
  const ok = await call("run", { bot: "writer", command: "echo hi > made.txt", timeout: 30 });
  assert.equal(ok.status, 200, JSON.stringify(ok.data).slice(0, 300));
});
test("写护栏：记了 workRoot 的写型档写域外即拒；不带名册位的照旧", async () => {
  const denied = await call("write", { bot: "confined", path: "out.txt", content: "x" }, other);
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /自己的目录/);
  const ok = await call("write", { bot: "confined", path: "in.txt", content: "x" }, root);
  assert.equal(ok.status, 200);
  const plain = await call("write", { path: "b.txt", content: "x" }, other);
  assert.equal(plain.status, 200);
});
test("写护栏：目录锁按真实路径归一认同一把——小写盘符与 `.` 别名都排进同一队", async () => {
  const locks = createLocks(),
    order = [],
    releaseA = await locks.lockDir(root),
    // root 里有 D 大写：换小写盘符进来；尾部 `.` 由 realpath 抹掉——两条都应排在同一队里。
    // catch 挂断言：排队方一旦走错（别名没认成同一把锁之类）即响亮失败，不留悬空 promise 无声吊死
    queued = locks
      .lockDir(root.toLowerCase() === root ? root : root.toLowerCase())
      .then(release => (order.push("lower"), release))
      .catch(error => assert.fail(`小写盘符的锁申请出错：${error}`)),
    aliased = locks
      .lockDir(root + path.sep + ".")
      .then(release => (order.push("alias"), release))
      .catch(error => assert.fail(`别名的锁申请出错：${error}`));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(order, []);
  // FIFO：先排的小写盘符先拿到；握着不还，别名那条就得一直排——串行就是这么证的
  releaseA();
  const r1 = await queued;
  assert.deepEqual(order, ["lower"]);
  r1();
  const r2 = await aliased;
  assert.deepEqual(order, ["lower", "alias"]);
  r2();
});
test("写护栏：两只 serialized 同仓并发——一只跑写型指令一只写文件，排队串行都落得去", async () => {
  const [a, b] = await Promise.all([
    call("run", { bot: "writer", command: "echo one >> share.txt", timeout: 30 }),
    call("write", { bot: "confined", path: "share2.txt", content: "y" })
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.data).slice(0, 200));
  assert.equal(b.status, 200);
  assert.equal(existsSync(path.join(root, "share2.txt")), true);
});

// ---------- 页面侧：接管、进展回报、防环、过滤 ----------
const convOf = (extra = {}) => ({
  id: "c-1",
  title: "会话",
  messages: [],
  forks: [],
  threads: [],
  createdAt: 1,
  updatedAt: 1,
  ...extra
});
function rig(conversation, bots = []) {
  const calls = { posts: [], starts: 0 },
    f = load([
      "deliverLetter",
      "toolDefinitions",
      "botToolBlock",
      "botsCache",
      "fleetRow",
      "pendingApprovals",
      "leaseHold",
      "TOOLS",
      "fleet: () => TOOLS",
      `setup: (conv, calls) => {
        bootstrap = { store: { root: "/tmp/root" } };
        store = { settings: {}, conversations: [conv], drafts: {}, memory: { items: [] } };
        markDirty = saveStore = saveStoreSoon = () => {};
        flushConversations = () => [];
        renderHistory = renderConversation = renderSendButtons = refreshSteps = renderApprovalBar = () => {};
        notifyDesktop = () => {};
        currentId = null;
        view = "chat";
        claimTurn = async () => true;
        startTurn = async (c, user, profile, options) => {
          calls.starts += 1;
          const assistant = { id: "a" + calls.starts, role: "assistant", status: "complete", content: "答" };
          if (options?.pushed) c.messages.push(assistant);
          else c.messages.push(user, assistant);
        };
        storeBridge = async (path, body) => {
          calls.posts.push({ path, body });
          if (path.endsWith("/claim")) return { claimed: true };
          if (path.endsWith("/post")) return { posted: true, id: "m-x" };
          return {};
        };
        pendingApprovals.clear();
        leaseHold.clear();
        activeProfile = () => ({ id: "p1" });
        quotaBlocked = () => false;
        profiles = () => [{ id: "p1", name: "模型甲" }];
        isWork = () => true;
        workRoot = () => "/w";
        availableDocuments = () => [];
        presetOf = () => null;
      }`
    ]);
  f.setup(conversation, calls);
  f.botsCache.bots.splice(0, f.botsCache.bots.length, ...bots);
  return { ...f, calls };
}
const letter = (id, extra = {}) => ({ id, to: "c-1", from: "总调度", payload: "去办一件事", postedAt: Date.now(), ...extra });

test("接管链全程：接管只登记→用户手动 halt 后放还也叫不醒（userHalted 主簿绕不过）", async () => {
  const conv = convOf({ adoptedBy: "chief-1" }),
    { deliverLetter, calls } = rig(conv);
  // 主簿接管中下的令：入册，不开工
  await deliverLetter(letter("m-1"));
  assert.equal(conv.messages.length, 1);
  assert.equal(conv.messages[0].mailId, "m-1");
  assert.equal(calls.starts, 0);
  // 用户亲手按的停 + 主簿放还：用户锁还在，来信仍只登记——主簿绕不过
  conv.userHalted = true;
  delete conv.adoptedBy;
  await deliverLetter(letter("m-2"));
  assert.equal(calls.starts, 0);
  // 用户回来发话（解锁）后，来信才再开工
  delete conv.userHalted;
  await deliverLetter(letter("m-3"));
  assert.equal(calls.starts, 1);
});
test("进展回报（kind:progress）：只登记不开工；普通令照常开", async () => {
  const conv = convOf(),
    { deliverLetter, calls } = rig(conv);
  await deliverLetter(letter("m-3", { kind: "progress" }));
  assert.equal(conv.messages.length, 1);
  assert.equal(calls.starts, 0);
  await deliverLetter(letter("m-4"));
  assert.equal(calls.starts, 1);
});
test("护栏：只读档拿不到写工具与写型指令；非主簿拿不到 fleet；普通对谈不受限", () => {
  const roConv = convOf({ id: "c-ro" }),
    rigRo = rig(roConv, [{ id: "auditor", role: "worker", writePolicy: "readonly", activeConversationId: "c-ro" }]),
    names = rigRo.toolDefinitions(roConv).map(def => def.function.name);
  assert.equal(names.includes("write_file"), false);
  assert.equal(names.includes("edit_file"), false);
  assert.equal(names.includes("run_command"), true);
  assert.equal(names.includes("fleet_send"), false);
  // 兜底闸：照名字硬调也拦——写工具与写型指令都过 botToolBlock；只读指令放行
  assert.match(String(rigRo.botToolBlock(rigRo.TOOLS.get("write_file"), {}, roConv) || ""), /只读/);
  assert.match(String(rigRo.botToolBlock(rigRo.TOOLS.get("run_command"), { command: "echo x > f" }, roConv) || ""), /只读/);
  assert.equal(rigRo.botToolBlock(rigRo.TOOLS.get("run_command"), { command: process.platform === "win32" ? "dir" : "ls" }, roConv), null);
  // 主簿会话：fleet 七件都在；worker 会话：都不在
  const chiefConv = convOf({ id: "c-chief" }),
    rigChief = rig(chiefConv, [{ id: "chief-1", role: "chief", activeConversationId: "c-chief" }]),
    chiefNames = rigChief.toolDefinitions(chiefConv).map(def => def.function.name);
  assert.equal(chiefNames.includes("fleet_send"), true);
  const workerConv = convOf({ id: "c-w" }),
    rigWorker = rig(workerConv, [{ id: "w-1", role: "worker", activeConversationId: "c-w" }]),
    workerNames = rigWorker.toolDefinitions(workerConv).map(def => def.function.name);
  assert.equal(workerNames.includes("fleet_send"), false);
  assert.match(String(rigWorker.botToolBlock(rigWorker.TOOLS.get("fleet_send"), {}, workerConv) || ""), /主簿/);
  // 普通对谈：写工具照给，fleet 不给（它不是主簿名册位）
  const plainConv = convOf({ id: "c-p" }),
    rigPlain = rig(plainConv, []),
    plainNames = rigPlain.toolDefinitions(plainConv).map(def => def.function.name);
  assert.equal(plainNames.includes("write_file"), true);
  assert.equal(plainNames.includes("fleet_send"), false);
});
test("重派防环：同一 taskId 派三回，第四回转人工不再递", async () => {
  const chiefConv = convOf({ id: "c-chief" }),
    f = rig(chiefConv, [
      { id: "chief-1", role: "chief", activeConversationId: "c-chief" },
      { id: "w-1", role: "worker", activeConversationId: "c-w" }
    ]),
    send = f.TOOLS.get("fleet_send"),
    ctx = { conversation: chiefConv, signal: new AbortController().signal },
    args = { bot: "w-1", message: "接着办", taskId: "差-7" },
    step = {};
  for (let i = 0; i < 3; i++) {
    const out = await send.run(step, args, ctx);
    assert.equal(out.ok, true, `第 ${i + 1} 回`);
  }
  assert.equal(chiefConv.taskReassigns["差-7"], 3);
  const fourth = await send.run(step, args, ctx);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.display, "转人工");
  assert.match(fourth.content, /人定夺/);
  // 没递第四封：post 只走了三回
  assert.equal(f.calls.posts.filter(item => item.path.endsWith("/post")).length, 3);
});
test("点卯行：待定夺的亮徽标带挂起时长；持写锁/在跑的给一键中止钮", () => {
  const conv = convOf({ id: "c-b1" }),
    f = rig(conv),
    bot = {
      id: "w-1",
      name: "誊抄",
      role: "worker",
      writePolicy: "serialized",
      driver: "native",
      activeConversationId: "c-b1",
      profileId: "p1"
    };
  // 后台请示挂了一分多钟 + 写锁在手：行上要有「待你定夺 · 时长」徽标、持写锁、中止钮、waiting 态
  f.pendingApprovals.set("ap-1", { conversationId: "c-b1", since: Date.now() - 65000 });
  f.leaseHold.add("c-b1");
  const row = f.fleetRow(bot);
  assert.match(row, /fleet-await/);
  assert.match(row, /待你定夺 · /);
  assert.match(row, /fleet-lock/);
  assert.match(row, /data-fleet-stop="w-1"/);
  assert.match(row, /fleet-state-text">waiting/);
  // 闲着的：徽标、锁、中止钮一概没有
  f.pendingApprovals.clear();
  f.leaseHold.clear();
  const idle = f.fleetRow(bot);
  assert.equal(idle.includes("fleet-await"), false);
  assert.equal(idle.includes("data-fleet-stop"), false);
  assert.match(idle, /fleet-state-text">idle/);
});
