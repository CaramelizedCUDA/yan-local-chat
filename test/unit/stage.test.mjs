// 游目：地址栏的话怎么换成网址、执事的一步怎么写成人话；桥接怎么从 MCP 服务的参数里读出调试口与配置目录
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const { stageUrlOf } = load(["stageUrlOf"]);
const { browserOf } = createRequire(import.meta.url)("../../server/stage.js");

test("地址栏：网址补 https，本机的照走，不像网址的交给搜索", () => {
  assert.equal(stageUrlOf("  example.com "), "https://example.com");
  assert.equal(stageUrlOf("example.com:8080/a"), "https://example.com:8080/a");
  assert.equal(stageUrlOf("http://a.b/c"), "http://a.b/c");
  assert.equal(stageUrlOf("about:blank"), "about:blank");
  assert.equal(stageUrlOf("localhost:5173"), "http://localhost:5173");
  assert.equal(stageUrlOf("E:\\项目\\index.html"), "file:///E:/项目/index.html");
  assert.equal(stageUrlOf("言 浏览器"), `https://www.bing.com/search?q=${encodeURIComponent("言 浏览器")}`);
  assert.equal(stageUrlOf("playwright"), "https://www.bing.com/search?q=playwright");
  assert.equal(stageUrlOf("   "), "");
});

test("调试口与配置目录：参数里直写的、--config 文件里的，都没有按 9288", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yan-stage-"));
  const file = path.join(dir, "stage.json");
  writeFileSync(
    file,
    JSON.stringify({ browser: { userDataDir: "D:/profile", launchOptions: { args: ["--remote-debugging-port=9300"] } } })
  );
  assert.deepEqual(browserOf(["cli.js", "--config", file]), { port: 9300, dir: "D:/profile" });
  assert.deepEqual(browserOf(["cli.js", `--config=${file}`, "--user-data-dir", "E:/p"]), { port: 9300, dir: "E:/p" });
  assert.deepEqual(browserOf(["--cdp-endpoint", "http://localhost:9411"]), { port: 9411, dir: "" });
  assert.deepEqual(browserOf(["--config", path.join(dir, "无此文件.json")]), { port: 9288, dir: "" });
  assert.deepEqual(browserOf(undefined), { port: 9288, dir: "" });
});

test("执事的一步写成一句两字动词：照 playwright 的参数，认不得的只写工具名", () => {
  const { stageActionText } = load(["stageActionText"]);
  assert.equal(stageActionText("browser_navigate", { url: "https://github.com/pulls" }), "前往 github.com");
  assert.equal(stageActionText("browser_click", { element: "Pull requests link", ref: "e12" }), "点击「Pull requests link」");
  assert.equal(stageActionText("browser_click", { element: "行", doubleClick: true }), "双击「行」");
  assert.equal(stageActionText("browser_type", { element: "搜索框", text: "is:open\nis:pr" }), "键入「is:open is:pr」");
  assert.equal(stageActionText("browser_tabs", { action: "new" }), "新开一页");
  assert.equal(stageActionText("browser_wait_for", { time: 2 }), "等候 2 秒");
  assert.equal(stageActionText("browser_mouse_move_xy", { x: 1, y: 2 }), "mouse_move_xy");
});
