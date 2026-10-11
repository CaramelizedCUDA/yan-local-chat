// 意：任务的结论图——结构约束、传播、回归标记由数据算出；成立与否由模型自己标
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load([
  "asIntent",
  "intentPath",
  "normalizeIntentOps",
  "applyIntentOps",
  "intentSealing",
  "intentState",
  "intentStaleWhy",
  "intentEstablished",
  "intentBorrowed",
  "intentRoots",
  "intentSealedFiles",
  "intentTally",
  "intentText"
]);

// 照工具里的次序：理顺、取指纹、折上去
function change(intent, nodes, { prints = {}, ask = "", workdir = "" } = {}) {
  const { ops, problems } = f.normalizeIntentOps(intent, nodes, workdir);
  assert.deepEqual(problems, []);
  const files = f.intentSealing(intent, ops);
  const sealed = Object.fromEntries(files.map(path => [path, prints[path] ?? `h:${path}`]));
  return f.applyIntentOps(intent, ops, { at: "t", conversation: "c1", ask, prints: sealed });
}
const problems = (intent, nodes, workdir = "") => f.normalizeIntentOps(intent, nodes, workdir).problems;
const empty = () => f.asIntent(null);

test("结构：新的一项要写全，前提要在、不成环；有错整批不收", () => {
  let intent = empty();
  assert.match(problems(intent, [{ id: "甲", claim: "能登录" }])[0], /claim 与 check 都要写/);
  assert.match(problems(intent, [{ id: "有 空格", claim: "x", check: "y" }])[0], /不含空格/);
  assert.match(problems(intent, [{ id: "甲", claim: "x", check: "y", needs: ["乙"] }])[0], /前提 乙 不存在/);
  intent = change(intent, [
    { id: "甲", claim: "能登录", check: "带对的密码登得进", needs: ["乙"] },
    { id: "乙", claim: "会话可存", check: "重启后会话还在" }
  ]);
  assert.match(problems(intent, [{ id: "乙", needs: ["甲"] }]).join(), /前提成了环：/);
  assert.match(problems(intent, [{ id: "甲", state: "finished" }])[0], /不认得/);
  // 别名照收：模型照计划卡的习惯写 complete
  assert.equal(f.normalizeIntentOps(intent, [{ id: "乙", state: "complete" }]).ops[0].state, "done");
});

test("传播：前提没立住，上面的就不算立住；any 的一项立住即可", () => {
  let intent = change(empty(), [
    { id: "上线", claim: "可在公网访问", check: "外网打得开", needs: ["甲", "乙"], root: true },
    { id: "甲", claim: "A", check: "a" },
    { id: "乙", claim: "B", check: "b" }
  ]);
  intent = change(intent, [
    { id: "上线", state: "done" },
    { id: "甲", state: "done" }
  ]);
  assert.ok(!f.intentEstablished(intent, "上线"));
  assert.match(f.intentText(intent), /\[成立·前提未立\] 上线（根）/);
  intent = change(intent, [{ id: "乙", state: "done" }]);
  assert.ok(f.intentEstablished(intent, "上线"));
  assert.deepEqual(f.intentTally(intent), { live: 3, standing: 3 });
  intent = change(intent, [
    { id: "乙", state: "doing" },
    { id: "上线", any: true }
  ]);
  assert.ok(f.intentEstablished(intent, "上线"), "任一即可：甲立住就够");
});

test("回归：标成立后依托的文件被改，转待复核；没改的、不知道的不算；再标成立即换一份凭据", () => {
  let intent = change(empty(), [{ id: "解析", claim: "配置写错时报错带行号", check: "跑测试", files: ["./src\\a.js"] }], {
    workdir: "E:\\proj"
  });
  assert.deepEqual(intent.nodes["解析"].files, ["src/a.js"]);
  intent = change(intent, [{ id: "解析", state: "done" }], { prints: { "src/a.js": "v1" } });
  assert.deepEqual(f.intentSealedFiles(intent), ["src/a.js"]);
  assert.equal(f.intentState(intent, "解析", { "src/a.js": "v1" }), "done");
  assert.equal(f.intentState(intent, "解析", {}), "done", "没取到此刻的指纹：不据它判");
  assert.equal(f.intentState(intent, "解析", { "src/a.js": "v2" }), "stale");
  assert.equal(f.intentState(intent, "解析", { "src/a.js": null }), "stale", "文件没了也算改了");
  assert.match(f.intentText(intent, { "src/a.js": "v2" }), /\[待复核\] 解析[\s\S]*缘由：标成立后又改了 src\/a\.js/);
  intent = change(intent, [{ id: "解析", state: "done" }], { prints: { "src/a.js": "v2" } });
  assert.equal(f.intentState(intent, "解析", { "src/a.js": "v2" }), "done");
});

test("回归：前提改了说法、后加了前提、自己改了说法，已成立的都转待复核", () => {
  let intent = change(empty(), [
    { id: "根", claim: "R", check: "r", needs: ["甲"], root: true },
    { id: "甲", claim: "A", check: "a" },
    { id: "乙", claim: "B", check: "b" }
  ]);
  intent = change(intent, [
    { id: "甲", state: "done" },
    { id: "根", state: "done" }
  ]);
  assert.ok(f.intentEstablished(intent, "根"));
  const revised = change(intent, [{ id: "甲", claim: "A（改）" }]);
  assert.equal(f.intentStaleWhy(revised, "根"), "前提 甲 的说法改了");
  assert.equal(f.intentStaleWhy(revised, "甲"), "说法改了");
  assert.match(revised.log.at(-1).text, /^改意 甲：A（改）/);
  const added = change(intent, [{ id: "根", needs: ["甲", "乙"] }]);
  assert.equal(f.intentStaleWhy(added, "根"), "前提 乙 是后来加的");
  // 弃了的前提不算在内
  const dropped = change(added, [{ id: "乙", state: "dropped" }]);
  assert.equal(f.intentStaleWhy(dropped, "根"), "");
  assert.match(dropped.log.at(-1).text, /^弃 乙/);
});

test("根：立时记下用户的原话；说法立后不由模型改，可以在底下标假定", () => {
  let intent = change(
    empty(),
    [
      { id: "费马", claim: "证出费马大定理", check: "Lean 编过", root: true, needs: ["模性"] },
      { id: "模性", claim: "M", check: "m" }
    ],
    {
      ask: "帮我证明费马大定理"
    }
  );
  assert.equal(intent.nodes["费马"].root.ask, "帮我证明费马大定理");
  assert.deepEqual(f.intentRoots(intent), ["费马"]);
  assert.match(problems(intent, [{ id: "费马", claim: "证出 n=3 的情形" }])[0], /是根，说法立后不由你改/);
  assert.deepEqual(problems(intent, [{ id: "费马", claim: "证出费马大定理" }]), [], "照原样再报一遍不算改");
  assert.match(problems(intent, [{ id: "模性", state: "assumed" }])[0], /note 里写明/);
  intent = change(intent, [
    { id: "模性", state: "assumed", note: "借 Wiles 1995 的模性定理" },
    { id: "费马", state: "done" }
  ]);
  assert.ok(f.intentEstablished(intent, "费马"));
  assert.deepEqual(f.intentBorrowed(intent, "费马"), ["模性"]);
  const text = f.intentText(intent);
  assert.match(text, /\[成立\] 费马（根）：证出费马大定理（前提：模性）（借假定：模性）/);
  assert.match(text, /\[假定\] 模性：M\n {2}出处：借 Wiles 1995 的模性定理/);
  assert.match(intent.log.at(-1).text, /^假定 模性：借 Wiles/);
});

test("给模型读的字：根在前；立住的一行，没立住的带验收，没立住的根附原话", () => {
  const intent = change(
    empty(),
    [
      { id: "上线", claim: "可在公网访问", check: "外网打得开", needs: ["部署"], root: true },
      { id: "部署", claim: "服务起在云上", check: "进程在跑" }
    ],
    { ask: "把这个项目上线" }
  );
  const text = f.intentText(intent, {}, { path: ".yan/意.json" });
  assert.equal(
    text,
    [
      "［意 .yan/意.json］立住 0 / 2",
      "- [未做] 上线（根）：可在公网访问（前提：部署）",
      "  验收：外网打得开",
      "  原话：把这个项目上线",
      "- [未做] 部署：服务起在云上",
      "  验收：进程在跑"
    ].join("\n")
  );
  assert.equal(f.intentText(empty()), "");
});

test("读到的 JSON 坏了几处：认得的照收，认不得的丢掉", () => {
  const intent = f.asIntent({
    nodes: { 好: { claim: "x", check: "y", state: "done", rev: 2 }, "坏 id": { claim: "z" }, 空: null },
    log: "x"
  });
  assert.deepEqual(Object.keys(intent.nodes), ["好"]);
  assert.deepEqual(intent.log, []);
  assert.equal(intent.nodes["好"].rev, 2);
});
