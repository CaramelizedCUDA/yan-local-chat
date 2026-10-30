import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => (resolve = done));
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

test("技能保存期间继续编辑并改名：后续内容接着落盘，使用桥接返回的新目录", async () => {
  const gate = deferred(),
    writes = [];
  const f = load([
    "settleSkillEditor",
    "editing: () => skillEditing",
    `setup: (gate, writes) => {
      skillEditing = { dir:'', name:'demo', description:'说明', body:'第一版', from:'' };
      bridge = async (path, data) => {
        writes.push({ ...data });
        if (writes.length === 1) await gate;
        return { dir:'E:/skills/' + data.name };
      };
      refreshSkills = async () => {}; renderSettings = () => {};
    }`
  ]);
  f.setup(gate.promise, writes);
  const saving = f.settleSkillEditor();
  f.editing().name = "renamed";
  f.editing().body = "第二版";
  // 第二次失焦或点完成也不能丢掉这次保存。
  await f.settleSkillEditor();
  gate.resolve();
  await saving;
  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes.map(item => [item.dir, item.name, item.body]),
    [
      ["", "demo", "第一版"],
      ["E:/skills/demo", "renamed", "第二版"]
    ]
  );
  assert.equal(f.editing(), null);
});

test("技能保存后刷新目录期间继续编辑：新内容也必须保存", async () => {
  const gate = deferred(),
    refreshing = deferred(),
    writes = [];
  const f = load([
    "settleSkillEditor",
    "editing: () => skillEditing",
    `setup: (gate, refreshing, writes) => {
      skillEditing = { dir:'E:/skills/demo', name:'demo', description:'说明', body:'第一版', from:'' };
      bridge = async (path, data) => { writes.push({ ...data }); return { dir:data.dir }; };
      let count = 0;
      refreshSkills = async () => { if (++count === 1) { refreshing(); await gate; } };
      renderSettings = () => {};
    }`
  ]);
  f.setup(gate.promise, refreshing.resolve, writes);
  const saving = f.settleSkillEditor();
  await refreshing.promise;
  assert.ok(f.editing(), "目录刷新完之前仍保留编辑状态");
  f.editing().body = "刷新期间的新内容";
  gate.resolve();
  await saving;
  assert.equal(writes.at(-1).body, "刷新期间的新内容");
  assert.equal(f.editing(), null);
});

for (const away of [false, true])
  test(away ? "两批附件同时置入并换会话：原草稿里总数也不超过十件" : "两批附件同时置入：总数不超过十件", async () => {
    const gate = deferred(),
      removed = [];
    const f = load([
      "addFiles",
      "state: () => store",
      "pending: () => pendingAttachments",
      `setup: (gate, removed) => {
        currentId = 'A'; view = 'chat'; pendingAttachments = []; store.drafts = {};
        persistDraft = renderAttachments = saveStoreSoon = toast = () => {};
        ingestFile = async file => { await gate; return { id:file.name, name:file.name, size:file.size, kind:'file' }; };
        deleteAttachment = async id => removed.push(id);
      }`,
      "switchAway: () => { currentId = 'B'; pendingAttachments = []; }"
    ]);
    f.setup(gate.promise, removed);
    const batch = tag => Array.from({ length: 6 }, (_, i) => ({ name: `${tag}${i}.pdf`, size: 1 }));
    const a = f.addFiles(batch("a")),
      b = f.addFiles(batch("b"));
    if (away) f.switchAway();
    gate.resolve();
    await Promise.all([a, b]);
    await turn();
    const files = away ? f.state().drafts.A.attachments : f.pending();
    assert.equal(files.length, 10);
    assert.ok(removed.length > 0, "放不下的附件原件会清理");
    if (away) assert.deepEqual(f.pending(), []);
  });

test("卷宗附件读取期间案上已满：最终放入时重新校验并清理原件", async () => {
  const removed = [];
  const f = load([
    "placeAttachment",
    "pending: () => pendingAttachments",
    `setup: removed => {
      currentId = 'A'; pendingAttachments = Array.from({length:10}, (_, i) => ({id:'old-' + i, size:1}));
      store.conversations = []; store.drafts = {};
      persistDraft = saveStoreSoon = toast = () => {};
      deleteAttachment = async id => removed.push(id);
    }`
  ]);
  f.setup(removed);
  assert.equal(f.placeAttachment("A", { id: "late", size: 1 }), false);
  await turn();
  assert.equal(f.pending().length, 10);
  assert.deepEqual(removed, ["late"]);
});

test("旁注末轮已收完、仍在逐字显示时停止：收尾后仍为 stopped", async () => {
  const keepAlive = setInterval(() => {}, 1000);
  const wire = `data: ${JSON.stringify({ choices: [{ delta: { content: "一段已经接收完毕、但还在逐字显示的旁注回复。" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
  const f = load([
    "streamSideReply",
    "doc: () => document",
    `setup: wire => {
      const answer = { id:'a', role:'assistant', content:'', status:'streaming' };
      const thread = { id:'t', anchor:{messageId:'main', text:''}, messages:[{id:'u', role:'user', content:'问'}, answer] };
      const c = { id:'c', messages:[{id:'main', role:'assistant', content:'正文'}], threads:[thread] };
      store.conversations = [c]; currentId = 'c'; sideThreadId = 't';
      saveStoreSoon = saveStore = renderSideSend = renderSidePanel = paintMessage = renderQuota = markDirty = accountUsage = () => {};
      keepInWindow = async () => {}; historyForApi = async () => []; systemPrompt = () => '';
      document.hidden = false; document.documentElement.dataset.inkMotion = 'on';
      requestPatiently = async () => new Response(wire, {headers:{'content-type':'text/event-stream'}});
      let stopped = false;
      requestAnimationFrame = callback => setTimeout(() => {
        if (!stopped) { stopped = true; haltJob('side:t', requestJobs.get('side:t')); }
        callback();
      }, 0);
      return { c, thread, answer };
    }`
  ]);
  const hidden = f.doc().hidden,
    motion = f.doc().documentElement.dataset.inkMotion;
  try {
    const { c, thread, answer } = f.setup(wire);
    await f.streamSideReply(c, thread, answer, { id: "p", tools: false });
    assert.equal(answer.status, "stopped");
    assert.ok(answer.content.includes("旁注回复"));
  } finally {
    clearInterval(keepAlive);
    f.doc().hidden = hidden;
    f.doc().documentElement.dataset.inkMotion = motion;
  }
});
