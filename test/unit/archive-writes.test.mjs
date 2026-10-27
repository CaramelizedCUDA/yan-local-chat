import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 答末认成品时剔掉的「别人写的」：人在页面上放进来的、别的对话的工具同时写出的；这段对话自己（连同它的帮手）写的照算
test("卷宗里谁写的：人与别的对话都算别人，自己写的不算", () => {
  const f = load(["noteArchiveWrite", "noteToolWrite", "archiveWrittenByOther"]);
  const since = Date.now() - 1;
  f.noteToolWrite({ id: "A" }, "小猫2.png");
  f.noteToolWrite({ id: "B" }, "报表.csv");
  f.noteArchiveWrite("收入/");
  f.noteArchiveWrite("课程");
  f.noteToolWrite({ id: "C", workdir: "D:/work" }, "行里的.txt");
  assert.equal(f.archiveWrittenByOther("小猫2.png", since, "B"), true);
  assert.equal(f.archiveWrittenByOther("报表.csv", since, "B"), false);
  assert.equal(f.archiveWrittenByOther("课程/笔记.md", since, "B"), true);
  assert.equal(f.archiveWrittenByOther("行里的.txt", since, "B"), false);
  assert.equal(f.archiveWrittenByOther("小猫2.png", Date.now() + 1000, "B"), false);
});
