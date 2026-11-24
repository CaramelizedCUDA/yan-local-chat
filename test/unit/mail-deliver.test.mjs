// 磁盘信箱的页面侧收信：认领、写成用户消息、含凭据的盘照落稳才回执——同一封不重复入册，叫停过的只记不叫醒
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function rig(conversation) {
  const calls = { posts: [], starts: 0 },
    f = load([
      "deliverLetter",
      "mailOnDiskWrite",
      "hasMailRecord",
      "recoverMailOrphans",
      "foldRelayTail",
      "settleSupplements",
      "requestJobs",
      `swapConv: conv => {
        const i = store.conversations.findIndex(c => c.id === conv.id);
        if (i >= 0) store.conversations[i] = conv;
      }`,
      `setup: (conv, calls) => {
        bootstrap = { store: { root: "/tmp/root" } };
        store = { settings: {}, conversations: [conv], drafts: {}, memory: { items: [] } };
        markDirty = saveStore = saveStoreSoon = () => {};
        flushConversations = () => [];
        renderHistory = renderConversation = renderSendButtons = refreshSteps = renderApprovalBar = () => {};
        currentId = null;
        view = "chat";
        claimTurn = async () => true;
        startTurn = async (c, user, profile, options) => {
          calls.starts += 1;
          const assistant = { id: "a" + calls.starts, role: "assistant", status: "complete", content: "答" };
          if (options?.pushed) c.messages.push(assistant);
          else c.messages.push(user, assistant);
        };
        storeBridge = async path => {
          calls.posts.push(path);
          if (path.endsWith("/claim")) return { claimed: true };
          return {};
        };
        activeProfile = () => ({ id: "p1" });
        quotaBlocked = () => false;
      }`
    ]);
  f.setup(conversation, calls);
  return { ...f, calls };
}

const convOf = (extra = {}) => ({
  id: "c-1",
  title: "后台",
  messages: [],
  forks: [],
  threads: [],
  createdAt: 1,
  updatedAt: 1,
  ...extra
});
const letter = id => ({ id, to: "c-1", from: "总调度", payload: "去办一件事", postedAt: Date.now() });
// 模拟一份落盘的快照：writeConversation 真落盘时会拿这份原文过 mailOnDiskWrite
const snap = c => JSON.stringify(c);

test("收信：认领→由这封信开一问→照里有凭据才回执；同信号只入册一回", async () => {
  const conv = convOf(),
    { deliverLetter, mailOnDiskWrite, calls } = rig(conv);
  await deliverLetter(letter("m-1"));
  assert.equal(conv.messages.length, 2);
  assert.equal(conv.messages[0].mailId, "m-1");
  assert.equal(conv.messages[0].content, "去办一件事");
  assert.deepEqual(conv.mailSeen, ["m-1"]);
  assert.equal(calls.starts, 1);
  // 光认领不落盘不回执；照里带着凭据的那份一落盘就回执
  assert.deepEqual(calls.posts, ["/api/mail/claim"]);
  await mailOnDiskWrite(conv.id, snap(conv));
  assert.deepEqual(calls.posts, ["/api/mail/claim", "/api/mail/ack"]);
});

test("收信：照里没有这封信不回执——旧快照的「已落盘」不能给新信作证", async () => {
  const conv = convOf(),
    { deliverLetter, mailOnDiskWrite, calls } = rig(conv);
  await deliverLetter(letter("m-1"));
  // 一份在途写任务带着旧快照落了盘：里面没有这封信
  await mailOnDiskWrite(conv.id, JSON.stringify({ id: "c-1", messages: [], mailSeen: [] }));
  assert.deepEqual(calls.posts.filter(path => path.endsWith("/ack")), []);
  await mailOnDiskWrite(conv.id, snap(conv));
  assert.deepEqual(calls.posts.filter(path => path.endsWith("/ack")), ["/api/mail/ack"]);
});

test("收信：同一封再领（ACK 前刷新重来）不重复写消息，照样回执", async () => {
  const conv = convOf(),
    { deliverLetter, mailOnDiskWrite, calls } = rig(conv);
  await deliverLetter(letter("m-2"));
  await deliverLetter(letter("m-2"));
  assert.equal(conv.messages.filter(m => m.mailId === "m-2").length, 1);
  assert.equal(calls.starts, 1);
  await mailOnDiskWrite(conv.id, snap(conv));
  assert.deepEqual(
    calls.posts.filter(path => path.endsWith("/ack")),
    ["/api/mail/ack"]
  );
});

test("收信：收过却没了凭据的（步骤被撤、号挤出 mailSeen）补记一条，不重复递送", async () => {
  const conv = convOf({ mailSeen: ["m-7"] }),
    { deliverLetter, mailOnDiskWrite, calls } = rig(conv);
  await deliverLetter(letter("m-7"));
  assert.equal(conv.messages.filter(m => m.mailId === "m-7").length, 1);
  assert.equal(calls.starts, 0);
  await mailOnDiskWrite(conv.id, snap(conv));
  assert.deepEqual(calls.posts.filter(path => path.endsWith("/ack")), ["/api/mail/ack"]);
});

test("收信：正在作答的递成补言一步——编号跟步骤走，照里有它才回执", async () => {
  const assistant = { id: "a1", role: "assistant", status: "streaming", content: "半句", steps: [] },
    conv = convOf({ messages: [assistant] }),
    { deliverLetter, mailOnDiskWrite, requestJobs, calls } = rig(conv);
  requestJobs.set(conv.id, { assistantId: "a1", queue: [] });
  await deliverLetter(letter("m-8"));
  // 信没落成消息：进的是队列和宿主的一步补言，编号记在步骤上
  assert.equal(conv.messages.length, 1);
  const step = assistant.steps.at(-1);
  assert.equal(step.name, "user_note");
  assert.equal(step.mailId, "m-8");
  assert.equal(step.note, "去办一件事");
  assert.equal(requestJobs.get(conv.id).queue.length, 1);
  await mailOnDiskWrite(conv.id, snap(conv));
  assert.deepEqual(calls.posts.filter(path => path.endsWith("/ack")), ["/api/mail/ack"]);
});

test("收信：宿主答已止、补言一步还挂着的，开张扫成正式消息（只记不叫醒）", async () => {
  const conv = convOf({
      messages: [
        {
          id: "a1",
          role: "assistant",
          status: "stopped",
          content: "半句",
          steps: [{ id: "s1", name: "user_note", status: "running", title: "去办一件事", note: "去办一件事", mailId: "m-9", mailFrom: "总调度" }]
        }
      ]
    }),
    { recoverMailOrphans } = rig(conv);
  recoverMailOrphans();
  const host = conv.messages.find(m => m.id === "a1");
  assert.equal(host.steps, undefined);
  const message = conv.messages.at(-1);
  assert.equal(message.role, "user");
  assert.equal(message.mailId, "m-9");
  assert.equal(message.content, "去办一件事");
  assert.equal(message.relay[0].title, "总调度");
});

test("收信：用户叫停过的对话只记下、不自动开工；没落盘的不回执", async () => {
  const conv = convOf({ userHalted: true }),
    { deliverLetter, mailOnDiskWrite, calls } = rig(conv);
  await deliverLetter(letter("m-3"));
  assert.equal(conv.messages.length, 1);
  assert.equal(calls.starts, 0);
  // 桥接不在、只进浏览器暂存的：没有含凭据的盘照就不回执，租期过了再领重来
  const stuck = convOf({ id: "c-9" }),
    offline = rig(stuck);
  await offline.deliverLetter({ id: "m-4", to: "c-9", payload: "一" });
  assert.equal(stuck.messages.filter(m => m.mailId === "m-4").length, 1);
  assert.deepEqual(offline.calls.posts.filter(path => path.endsWith("/ack")), []);
});

test("收信：凭据在册的再冒头（残信淘汰、老号挤出 mailSeen）只登记不递送", async () => {
  // 回过执的残信从簿里淘汰后冒头，或老号被挤出 mailSeen：册里早有这封信——
  // 不再记一条、不再开一答，只把它登记回 mailSeen 再回执
  const conv = convOf({
      mailSeen: [],
      messages: [{ id: "u1", role: "user", content: "去办一件事", timestamp: 1, mailId: "m-r", relay: [{ kind: "mail" }] }]
    }),
    { deliverLetter, mailOnDiskWrite, calls } = rig(conv);
  await deliverLetter(letter("m-r"));
  assert.equal(conv.messages.filter(m => m.mailId === "m-r").length, 1);
  assert.equal(calls.starts, 0);
  assert.deepEqual(conv.mailSeen, ["m-r"]);
  await mailOnDiskWrite(conv.id, snap(conv));
  assert.deepEqual(calls.posts.filter(path => path.endsWith("/ack")), ["/api/mail/ack"]);
});

test("收尾与开张扫描撞车：先被转成消息的信不再并进并问——同一封只入册一回", async () => {
  const step = { id: "s1", name: "user_note", status: "running", note: "信", mailId: "m-d", mailFrom: "总" },
    assistant = { id: "a1", role: "assistant", status: "complete", content: "答", steps: [step] },
    conv = convOf({ messages: [{ id: "u0", role: "user", content: "问" }, assistant] }),
    job = { queue: [{ user: { id: "um", role: "user", content: "信", mailId: "m-d" }, step }], controller: { signal: { aborted: false } } },
    { settleSupplements, recoverMailOrphans, calls } = rig(conv);
  // 扫描抢在收尾前：信步先被转成消息（id 由编号定）
  recoverMailOrphans();
  assert.equal(conv.messages.at(-1).id, "mailmsg_m-d");
  // 收尾再到：同一封不再并进并问、不放回、不另起一答——册里始终只有一份
  settleSupplements(conv, assistant, job, { id: "p1" });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(conv.messages.filter(m => m.mailId === "m-d" || (m.mailIds || []).includes("m-d")).length, 1);
  assert.equal(calls.starts, 0);
});

test("收尾回调：跟读换过对象的按当前对象查停机——旧对象的标志是死的", async () => {
  const step = { id: "s1", name: "user_note", status: "running", note: "信", mailId: "m-s", mailFrom: "总" },
    assistant = { id: "a1", role: "assistant", status: "complete", content: "答", steps: [step] },
    conv = convOf({ messages: [{ id: "u0", role: "user", content: "问" }, assistant] }),
    job = { queue: [{ user: { id: "um", role: "user", content: "信", mailId: "m-s" }, step }], controller: { signal: { aborted: false } } },
    { settleSupplements, swapConv, calls } = rig(conv);
  assert.equal(settleSupplements(conv, assistant, job, { id: "p1" }), true);
  // 并问当场就入了册（同步落，不等回调）
  const merged = conv.messages.at(-1);
  assert.deepEqual(merged.mailIds, ["m-s"]);
  // 排队的工夫跟读换进新对象、被用户叫停：回调得查新对象上的标志
  swapConv(JSON.parse(JSON.stringify({ ...conv, userHalted: true })));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.starts, 0);
  // 对照：换入的新对象没叫停，回调照常补待写的一答——并问按 id 认入册，不重复写
  const conv2 = convOf({ messages: [{ id: "u0", role: "user", content: "问" }] }),
    f2 = rig(conv2),
    step2 = { id: "s2", name: "user_note", status: "running", note: "信", mailId: "m-s2" },
    assistant2 = { id: "a1", role: "assistant", status: "complete", content: "答", steps: [step2] };
  conv2.messages.push(assistant2);
  f2.settleSupplements(conv2, assistant2, { queue: [{ user: { id: "um2", role: "user", content: "信", mailId: "m-s2" }, step: step2 }], controller: { signal: { aborted: false } } }, { id: "p1" });
  const mergedId = conv2.messages.at(-1).id,
    swapped = JSON.parse(JSON.stringify(conv2)); // 序列化换对象：元素引用全变，按引用认不出
  f2.swapConv(swapped);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f2.calls.starts, 1);
  assert.equal(swapped.messages.filter(m => m.id === mergedId).length, 1);
  assert.equal(swapped.messages.at(-1).role, "assistant");
});

test("收信：被 settleSteps 抢跑收成 error 的挂起信步，开张扫描照样找回", async () => {
  // recoverInterruptedMessages 跑在 listenMail 前、先把 running 收成 error——只扫 running 会漏掉这批
  const conv = convOf({
      messages: [
        {
          id: "a1",
          role: "assistant",
          status: "stopped",
          content: "半句",
          steps: [{ id: "s1", name: "user_note", status: "error", title: "去办一件事", note: "去办一件事", mailId: "m-e", mailFrom: "总调度" }]
        }
      ]
    }),
    { recoverMailOrphans } = rig(conv);
  recoverMailOrphans();
  const host = conv.messages.find(m => m.id === "a1");
  assert.equal(host.steps, undefined);
  const message = conv.messages.at(-1);
  assert.equal(message.mailId, "m-e");
  assert.equal(message.content, "去办一件事");
});

test("续写折尾：信不是可折的空回报——留在册，回报细线的尾巴照折", async () => {
  const conv = convOf({
      messages: [
        { id: "a1", role: "assistant", status: "complete", content: "答" },
        { id: "u2", role: "user", content: "信", mailId: "m-x", relay: [{ kind: "mail", title: "总", ok: true }] },
        { id: "a2", role: "assistant", status: "stopped", content: "" }
      ]
    }),
    { foldRelayTail } = rig(conv);
  foldRelayTail(conv, conv.messages[0]);
  // 带 mail 细线的不算空回报：尾巴一封不折，凭据正文都留在册
  assert.equal(conv.messages.length, 3);
  assert.equal(conv.heldReports, undefined);
  // 对照：纯回报（bg/帮手）起的空尾巴照折
  const conv2 = convOf({
      messages: [
        { id: "a1", role: "assistant", status: "complete", content: "答" },
        { id: "u2", role: "user", content: "报", relay: [{ kind: "bg", step: "s9" }] },
        { id: "a2", role: "assistant", status: "stopped", content: "" }
      ]
    }),
    f2 = rig(conv2);
  f2.foldRelayTail(conv2, conv2.messages[0]);
  assert.equal(conv2.messages.length, 1);
  assert.equal(conv2.heldReports.length, 1);
});

test("收尾：信步先留着等并入落地；排队的工夫叫过停就只记下不开工", async () => {
  const step = { id: "s1", name: "user_note", status: "running", note: "去办一件事", mailId: "m-q", mailFrom: "总" },
    assistant = { id: "a1", role: "assistant", status: "complete", content: "答", steps: [step] },
    conv = convOf({ messages: [{ id: "u0", role: "user", content: "问" }, assistant], userHalted: true }),
    job = { queue: [{ user: { id: "um", role: "user", content: "去办一件事", mailId: "m-q" }, step }], controller: { signal: { aborted: false } } },
    { settleSupplements, recoverMailOrphans, calls } = rig(conv);
  assert.equal(settleSupplements(conv, assistant, job, { id: "p1" }), true);
  // 信步没被当场撤：并入的新一问还没落地，留着它凭据不断档
  assert.equal(assistant.steps.length, 1);
  await new Promise(resolve => setTimeout(resolve, 30));
  // 叫过停的：并问落成正式消息（带 mailIds），不开工
  assert.equal(calls.starts, 0);
  const merged = conv.messages.at(-1);
  assert.equal(merged.role, "user");
  assert.deepEqual(merged.mailIds, ["m-q"]);
  // 并入落地后，留着的信步由开张扫描收走：凭据在册只撤步，不补记第二份
  recoverMailOrphans();
  assert.equal(assistant.steps, undefined);
  assert.equal(conv.messages.filter(m => (m.mailIds || []).includes("m-q")).length, 1);
  // 对照：没叫停的照常另起一问
  const step2 = { id: "s2", name: "user_note", status: "running", note: "去办一件事", mailId: "m-q2" },
    assistant2 = { id: "a1", role: "assistant", status: "complete", content: "答", steps: [step2] },
    conv2 = convOf({ messages: [{ id: "u0", role: "user", content: "问" }, assistant2] }),
    job2 = { queue: [{ user: { id: "um2", role: "user", content: "去办一件事", mailId: "m-q2" }, step: step2 }], controller: { signal: { aborted: false } } },
    f2 = rig(conv2);
  f2.settleSupplements(conv2, assistant2, job2, { id: "p1" });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f2.calls.starts, 1);
});

test("收信：这页认不得的对话不领；认领失败的也不碰", async () => {
  const conv = convOf(),
    { deliverLetter, calls } = rig(conv);
  await deliverLetter({ id: "m-5", to: "别处", payload: "一" });
  assert.deepEqual(calls.posts, []);
  const f = load([
    "deliverLetter",
    `setup: conv => {
      bootstrap = { store: {} };
      store = { settings: {}, conversations: [conv], drafts: {}, memory: { items: [] } };
      remoteBusy.add(conv.id);
      storeBridge = async () => ({ claimed: true });
    }`
  ]);
  f.setup(convOf({ id: "busy-1" }));
  await f.deliverLetter({ id: "m-6", to: "busy-1", payload: "一" });
});
