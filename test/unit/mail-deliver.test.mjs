// 磁盘信箱的页面侧收信：认领、写成用户消息、落盘后回执——同一封不重复入册，叫停过的只记不叫醒
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function rig(conversation, { landed = "disk" } = {}) {
  const calls = { posts: [], starts: 0 },
    f = load([
      "deliverLetter",
      `setup: (conv, calls, landed) => {
        bootstrap = { store: { root: "/tmp/root" } };
        store = { settings: {}, conversations: [conv], drafts: {}, memory: { items: [] } };
        markDirty = saveStore = saveStoreSoon = () => {};
        renderHistory = renderConversation = renderSendButtons = refreshSteps = renderApprovalBar = () => {};
        currentId = null;
        view = "chat";
        claimTurn = async () => true;
        startTurn = async () => { calls.starts += 1; };
        chatWritePromises.set(conv.id, Promise.resolve(landed));
        storeBridge = async path => {
          calls.posts.push(path);
          if (path.endsWith("/claim")) return { claimed: true };
          return {};
        };
        activeProfile = () => ({ id: "p1" });
        quotaBlocked = () => false;
      }`
    ]);
  f.setup(conversation, calls, landed);
  return { deliverLetter: f.deliverLetter, calls };
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

test("收信：认领→写成带 mailId 的用户消息→落盘→回执；叫醒起一新答", async () => {
  const conv = convOf(),
    { deliverLetter, calls } = rig(conv);
  await deliverLetter(letter("m-1"));
  assert.equal(conv.messages.length, 1);
  assert.equal(conv.messages[0].mailId, "m-1");
  assert.equal(conv.messages[0].content, "去办一件事");
  assert.deepEqual(conv.mailSeen, ["m-1"]);
  assert.equal(calls.starts, 1);
  assert.deepEqual(calls.posts, ["/api/mail/claim", "/api/mail/ack"]);
});

test("收信：同一封再领（ACK 前刷新重来）不重复写消息，照样回执", async () => {
  const conv = convOf(),
    { deliverLetter, calls } = rig(conv);
  await deliverLetter(letter("m-2"));
  await deliverLetter(letter("m-2"));
  assert.equal(conv.messages.length, 1);
  assert.equal(calls.starts, 1);
  assert.deepEqual(
    calls.posts.filter(path => path.endsWith("/ack")),
    ["/api/mail/ack", "/api/mail/ack"]
  );
});

test("收信：用户叫停过的对话只记下、不自动开工；没落盘的不回执", async () => {
  const conv = convOf({ userHalted: true }),
    { deliverLetter, calls } = rig(conv);
  await deliverLetter(letter("m-3"));
  assert.equal(conv.messages.length, 1);
  assert.equal(calls.starts, 0);
  // 桥接不在、只进浏览器暂存的：不回执，租期过了再领重来
  const stuck = convOf({ id: "c-9" }),
    offline = rig(stuck, { landed: "page" });
  await offline.deliverLetter({ id: "m-4", to: "c-9", payload: "一" });
  assert.equal(stuck.messages.length, 1);
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
