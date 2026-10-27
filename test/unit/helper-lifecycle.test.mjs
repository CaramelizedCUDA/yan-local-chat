import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => (resolve = done));
  return { promise, resolve };
};

function helperFixture({ ledger = Promise.resolve(), lease = Promise.resolve(), history = Promise.resolve([]), rounds } = {}) {
  const started = [],
    reports = [];
  const f = load([
    "tellHelper",
    "resumeHelpers",
    "launchHelper",
    "stopGeneration",
    "crews",
    "switchAway: () => { currentId = 'B'; }",
    "remove: c => { store.conversations = store.conversations.filter(item => item !== c); }",
    `setup: (ledger, lease, history, rounds, started, reports) => {
      const old = { id:'old', name:'delegate', title:'helper', arguments:'{}', status:'interrupted', result:'offline', sub:{ id:'sub-old', helper:'sub-old', task:'old-task', content:'partial', reasoning:'', steps:[], status:'interrupted', usage:null } };
      const host = { id:'host', role:'assistant', content:'', status:'complete', steps:[old] };
      const c = { id:'A', profileId:'pA', messages:[host], forks:[], threads:[] };
      store.conversations = [c, {id:'B', profileId:'pB', messages:[], forks:[], threads:[]}];
      store.profiles = [{id:'pA',name:'Model A'}, {id:'pB',name:'Model B'}]; currentId = 'A';
      renderHistory = renderSendButtons = refreshSteps = saveStoreSoon = saveStore = markDirty = syncLeases = renderQuota = toast = () => {};
      prompt = key => '[' + key + ']'; quotaBlocked = () => false;
      toolDefinitions = () => [{type:'function',function:{name:'read_file'}}];
      claimConversation = async () => { await lease; return true; };
      loadLedger = async () => { await ledger; return null; };
      answerForApi = async () => history;
      ledgerNote = systemPrompt = () => '';
      mailReport = (c, item) => reports.push(item);
      if (rounds) runRounds = async (sub, history, run) => {
        started.push({helper:sub.helper, task:sub.task, profile:run.profile.id, signal:run.signal});
        await rounds(sub, history, run);
      };
      return {c, host, old};
    }`
  ]);
  return { ...f, ...f.setup(ledger, lease, history, rounds, started, reports), started, reports };
}

// 执行边界保留真中止信号，停止后既退出循环，也让清理与记账走完。
const untilStopped = (_sub, _history, { signal }) =>
  new Promise((_, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

test("帮手续写等待认领时换到另一段对话：仍用点续写时的模型", async () => {
  const lease = deferred(),
    f = helperFixture({ lease: lease.promise, rounds: untilStopped });
  const resuming = f.resumeHelpers(f.c, [f.old]);
  f.switchAway();
  lease.resolve();
  await resuming;
  await tick();
  try {
    assert.equal(f.started.length, 1);
    assert.equal(f.started[0].profile, "pA");
  } finally {
    f.stopGeneration(f.c.id);
    await tick();
  }
});

test("帮手续派建立身份后才退役旧趟：旧续写入口不能再开第二个同名帮手", async () => {
  const f = helperFixture({ rounds: untilStopped }),
    next = { id: "next", name: "helper", arguments: "{}", status: "running" };
  f.host.steps.push(next);
  f.tellHelper(next, { helper: "helper", message: "new-task" }, { conversation: f.c, assistant: f.host });
  await tick();
  try {
    assert.equal(f.old.status, "error");
    assert.equal(f.old.sub.status, "stopped");
    await f.resumeHelpers(f.c, [f.old]);
    await tick();
    assert.equal(f.crews.get(f.c.id).length, 1);
    assert.deepEqual(
      f.started.map(item => item.task),
      ["new-task"]
    );
  } finally {
    f.stopGeneration(f.c.id);
    await tick();
  }
});

test("旧记录里同一名帮手几趟都断着：一并续写也只启动最后一趟", async () => {
  const f = helperFixture({ rounds: untilStopped }),
    next = {
      id: "next",
      name: "helper",
      title: "helper",
      arguments: "{}",
      status: "interrupted",
      sub: { ...f.old.sub, id: "sub-next", task: "new-task", steps: [] }
    };
  f.host.steps.push(next);
  await f.resumeHelpers(f.c);
  await tick();
  try {
    assert.equal(f.old.status, "error");
    assert.equal(f.crews.get(f.c.id).length, 1);
    assert.deepEqual(
      f.started.map(item => item.task),
      ["new-task"]
    );
  } finally {
    f.stopGeneration(f.c.id);
    await tick();
  }
});

test("点了旧签的续：旧签收掉，续上的是这名帮手最后一趟", async () => {
  const f = helperFixture({ rounds: untilStopped }),
    next = {
      id: "next",
      name: "helper",
      title: "helper",
      arguments: "{}",
      status: "interrupted",
      sub: { ...f.old.sub, id: "sub-next", task: "new-task", steps: [] }
    };
  f.host.steps.push(next);
  await f.resumeHelpers(f.c, [f.old]);
  await tick();
  try {
    assert.equal(f.old.status, "error");
    assert.equal(next.status, "running");
    assert.deepEqual(
      f.started.map(item => item.task),
      ["new-task"]
    );
  } finally {
    f.stopGeneration(f.c.id);
    await tick();
  }
});

test("续写准备期间被主模型叫停：回报不把断前的旧话当作它最后说的", async () => {
  const gate = deferred(),
    f = helperFixture({ ledger: gate.promise, rounds: untilStopped });
  await f.resumeHelpers(f.c, [f.old]);
  await tick();
  f.tellHelper(
    { id: "stop", name: "helper", arguments: "{}", status: "running" },
    { helper: "helper", stop: true },
    { conversation: f.c, assistant: f.host }
  );
  gate.resolve();
  await tick();
  assert.equal(f.old.sub.status, "stopped");
  assert.equal(f.old.sub.report, "");
  assert.equal(f.reports.length, 1);
});

for (const phase of ["ledger", "history"])
  test(`帮手续写准备期间停止（${phase}）：不发模型请求，也不寄回报`, async () => {
    const gate = deferred(),
      f = helperFixture({ [phase]: gate.promise, rounds: untilStopped });
    await f.resumeHelpers(f.c, [f.old]);
    await tick();
    const registered = f.crews.has(f.c.id);
    f.stopGeneration(f.c.id);
    gate.resolve(phase === "history" ? [] : undefined);
    await tick();
    try {
      assert.equal(registered, true, "准备期间也在帮手名册里，可以停止");
      assert.equal(f.started.length, 0);
      assert.equal(f.crews.has(f.c.id), false);
      assert.equal(f.old.sub.status, "stopped");
      assert.deepEqual(f.reports, []);
    } finally {
      f.stopGeneration(f.c.id);
      await tick();
    }
  });

test("主答在帮手准备期间中止：帮手同样退出，不寄回报", async () => {
  const ledger = deferred(),
    controller = new AbortController(),
    f = helperFixture({ ledger: ledger.promise, rounds: untilStopped }),
    next = { id: "next", name: "delegate", title: "new", arguments: "{}", status: "running" };
  f.host.steps.push(next);
  f.launchHelper(next, { task: "new-task" }, { conversation: f.c, assistant: f.host, signal: controller.signal });
  controller.abort();
  ledger.resolve();
  await tick();
  assert.equal(f.started.length, 0);
  assert.equal(f.crews.has(f.c.id), false);
  assert.equal(next.sub.status, "stopped");
  assert.deepEqual(f.reports, []);
});

test("准备结束后帮手独立执行：主答的中止器不再控制它，照常做完回报", async () => {
  const gate = deferred(),
    controller = new AbortController(),
    f = helperFixture({
      rounds: async sub => {
        await gate.promise;
        sub.content = "回报：已做完";
      }
    }),
    next = { id: "next", name: "delegate", title: "new", arguments: "{}", status: "running" };
  f.host.steps.push(next);
  f.launchHelper(next, { task: "new-task" }, { conversation: f.c, assistant: f.host, signal: controller.signal });
  await tick();
  controller.abort();
  gate.resolve();
  await tick();
  assert.equal(f.started.length, 1);
  assert.equal(f.started[0].signal.aborted, false);
  assert.equal(next.status, "done");
  assert.equal(f.crews.has(f.c.id), false);
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].profile.id, "pA");
});

test("主模型只叫停一名帮手：仍按未完成回报，不当作用户停止而丢信", async () => {
  const f = helperFixture({ rounds: untilStopped });
  await f.resumeHelpers(f.c, [f.old]);
  await tick();
  f.tellHelper(
    { id: "stop", name: "helper", arguments: "{}", status: "running" },
    { helper: "helper", stop: true },
    { conversation: f.c, assistant: f.host }
  );
  await tick();
  assert.equal(f.old.sub.status, "stopped");
  assert.equal(f.crews.has(f.c.id), false);
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].report, "[delegate.failed]");
});

test("等待认领时对话已删除：不复活该对话里的帮手", async () => {
  const lease = deferred(),
    f = helperFixture({ lease: lease.promise, rounds: untilStopped });
  const resuming = f.resumeHelpers(f.c, [f.old]);
  f.remove(f.c);
  lease.resolve();
  await resuming;
  await tick();
  try {
    assert.equal(f.started.length, 0);
    assert.equal(f.crews.has(f.c.id), false);
  } finally {
    f.stopGeneration(f.c.id);
    await tick();
  }
});

test("帮手末轮已接收完、仍在逐字显示时停止：不记完成，也不寄回报", async () => {
  const keepAlive = setInterval(() => {}, 1000),
    wire = `data: ${JSON.stringify({ choices: [{ delta: { content: "已经接收完毕、仍在逐字显示的帮手回复。" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
  // 测真实读流、轮次与收尾；只替换网络响应和下一帧调度。
  const setup = load([
    "launchHelper",
    "doc: () => document",
    `setup: (wire, reports) => {
      const step = {id:'s',name:'delegate',title:'helper',arguments:'{}',status:'running'};
      const host = {id:'host',role:'assistant',content:'',status:'complete',steps:[step]};
      const c = {id:'A',profileId:'p',messages:[host],forks:[],threads:[]};
      store.conversations=[c]; store.profiles=[{id:'p',name:'Model A'}]; currentId='A';
      saveStoreSoon=saveStore=renderHistory=renderSendButtons=refreshSteps=renderQuota=markDirty=syncLeases=()=>{};
      keepInWindow=async()=>{}; systemPrompt=ledgerNote=()=>''; loadLedger=async()=>null;
      toolDefinitions=()=>[{type:'function',function:{name:'read_file'}}]; prompt=key=>'['+key+']';
      document.hidden=false; document.documentElement.dataset.inkMotion='on';
      requestPatiently=async()=>new Response(wire,{headers:{'content-type':'text/event-stream'}});
      let stopped=false;
      requestAnimationFrame=callback=>setTimeout(()=>{
        if(!stopped){stopped=true;stopGeneration('A');}
        callback(performance.now());
      },0);
      mailReport=(c,item)=>reports.push(item);
      return {step,host,c};
    }`
  ]);
  const reports = [],
    doc = setup.doc(),
    hidden = doc.hidden,
    motion = doc.documentElement.dataset.inkMotion;
  try {
    const { step, host, c } = setup.setup(wire, reports);
    setup.launchHelper(step, { task: "task" }, { conversation: c, assistant: host, signal: new AbortController().signal });
    for (let i = 0; i < 100 && step.status === "running"; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(step.status, "error");
    assert.equal(step.sub.status, "stopped");
    assert.ok(step.sub.content.includes("帮手回复"));
    assert.deepEqual(reports, []);
  } finally {
    clearInterval(keepAlive);
    doc.hidden = hidden;
    doc.documentElement.dataset.inkMotion = motion;
  }
});
