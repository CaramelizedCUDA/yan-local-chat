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
      "requestJobs",
      `setup: (conv, calls) => {
        bootstrap = { store: { root: "/tmp/root" } };
        store = { settings: {}, conversations: [conv], drafts: {}, memory: { items: [] } };
        markDirty = saveStore = saveStoreSoon = () => {};
        flushConversations = () => [];
        renderHistory = renderConversation = renderSendButtons = refreshSteps = renderApprovalBar = () => {};
        currentId = null;
        view = "chat";
        claimTurn = async () => true;
        startTurn = async (c, user) => {
          calls.starts += 1;
          c.messages.push(user, { id: "a" + calls.starts, role: "assistant", status: "complete", content: "答" });
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
