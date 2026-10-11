import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const intent = tag => ({ nodes: {}, log: [], tag });

function viewer(read, change = async () => ({})) {
  const f = load([
    "openIntentCard",
    "saveIntentRoot",
    "closeFileViewer",
    "showInFileViewer",
    "doc: () => document",
    "card: () => intentCard",
    `setup: (read, change, remember) => {
      readIntent = read; changeIntent = change; keepIntent = remember;
      intentPrints = async () => ({}); isWork = () => true; workdirName = c => c.id;
      intentCardHtml = intent => '<div class="intent-card">' + intent.tag + '</div>';
      listenViewerClosed = closeExpandedWork = () => {};
    }`
  ]);
  const query = f.doc().querySelector,
    nodes = new Map(),
    saved = [];
  const node = selector => {
    if (selector === ".work-expanded") return null;
    if (!nodes.has(selector)) {
      const classes = new Set(["hidden"]);
      nodes.set(selector, {
        innerHTML: "",
        textContent: "",
        classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n) },
        focus() {},
        querySelector(selector) {
          return selector === ".intent-card" && this.innerHTML.includes('class="intent-card"') ? {} : null;
        }
      });
    }
    return nodes.get(selector);
  };
  f.doc().querySelector = node;
  f.setup(read, change, (c, next) => saved.push([c.id, next.tag]));
  return {
    f,
    node,
    saved,
    restore: () => {
      f.doc().querySelector = query;
    }
  };
}

for (const fail of [false, true])
  test(`意 A 还在读取时打开 B：A 迟到的${fail ? "错误" : "结果"}不覆盖 B`, async () => {
    const gate = deferred();
    const { f, node, restore } = viewer(c => (c.id === "A" ? gate.promise : Promise.resolve({ intent: intent(c.id) })));
    try {
      const opening = f.openIntentCard({ id: "A" });
      await f.openIntentCard({ id: "B" });
      if (fail) gate.reject(Error("A 未读成"));
      else gate.resolve({ intent: intent("A") });
      await opening;
      assert.equal(f.card().conversation.id, "B");
      assert.equal(node("#fileViewerStage").innerHTML, '<div class="intent-card">B</div>');
    } finally {
      restore();
    }
  });

for (const next of ["B", "close", "change"])
  test(`意 A 保存途中${next === "B" ? "打开意 B" : next === "close" ? "收起预览" : "打开改动预览"}：保存只更新 A 的记录`, async () => {
    const gate = deferred();
    const { f, node, saved, restore } = viewer(
      async c => ({ intent: intent(c.id) }),
      () => gate.promise
    );
    try {
      await f.openIntentCard({ id: "A" });
      const saving = f.saveIntentRoot("root", "改后的说法");
      if (next === "B") await f.openIntentCard({ id: "B" });
      else if (next === "close") f.closeFileViewer();
      else f.showInFileViewer("改动", "文件里的改动");
      const expected = node("#fileViewerStage").innerHTML;
      gate.resolve({ next: intent("A saved") });
      await saving;
      assert.deepEqual(saved, [["A", "A saved"]]);
      assert.equal(node("#fileViewerStage").innerHTML, expected);
      if (next === "B") assert.equal(f.card().intent.tag, "B");
    } finally {
      restore();
    }
  });
