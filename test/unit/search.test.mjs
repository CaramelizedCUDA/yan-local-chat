// 检索：答非所问的判定（必应被拦时只认第一个词）与必应结果页的解析
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { offTopic, parseBing } = require("../../server/search.js");
const r = (title, snippet = "") => ({ title, snippet, url: "https://example.com/" });

test("被拦时只剩第一个词的结果判作答非所问", () => {
  // 2026-10 实测见过的几批
  assert.equal(offTopic("王羲之 兰亭集序 全文", [r("Welcome to Steam", "Steam is the ultimate destination for playing games")]), true);
  assert.equal(offTopic("李白 将进酒 赏析", [r("李（汉语汉字）_百度百科", "李，汉语一级字，读作lǐ")]), true);
  assert.equal(offTopic("今天 上海 天气", [r("前程无忧和boss直聘哪个好用呀？ - 知乎"), r("前程无忧怎么关闭求职状态 - 百度经验")]), true);
  assert.equal(
    offTopic("node 24 fetch proxy NODE_USE_ENV_PROXY", [
      r("Node.js — Run JavaScript Everywhere", "Node.js® is a free, open-source, cross-platform JavaScript runtime environment")
    ]),
    true
  );
});

test("对得上的结果照常放行", () => {
  assert.equal(offTopic("王羲之 兰亭集序 全文", [r("王羲之《兰亭集序》原文翻译及拼音版 - 古诗文库")]), false);
  assert.equal(offTopic("今天 上海 天气", [r("【上海今天天气预报】上海天气预报24小时详情_上海天气网")]), false);
  assert.equal(offTopic("Python 3.14 free-threading 性能", [r("解锁 Python 多线程新纪元：深入体验 3.14 的 Free-Threading 功能")]), false);
  // 只要有一条对得上就算，摘要里对上也算；汉字词对上两字即可（「发布时间」对「发布」）
  assert.equal(offTopic("DeepSeek V4 发布时间", [r("DeepSeek | Into the Unknown"), r("DeepSeek V4 正式版发布")]), false);
  assert.equal(offTopic("将进酒 赏析", [r("李白诗选", "将进酒一诗的赏析与注释")]), false);
});

test("一个词的、空的、带操作符的不判", () => {
  assert.equal(offTopic("OpenAI", [r("Steam")]), false);
  assert.equal(offTopic("兰亭集序 全文", []), false);
  // site: 与排除词不算词：剩一个词即不判
  assert.equal(offTopic("兰亭集序 site:baike.baidu.com -百家号", [r("Steam")]), false);
});

test("必应结果页：带多个类名的条目照取，跳转链接还原成真实地址", () => {
  const u = Buffer.from("https://www.gushiwen.cn/lanting").toString("base64url");
  const html = `<ol id="b_results">
    <li class="b_algo" data-id=""><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1${u}&amp;ntb=1">兰亭集序<strong>原文</strong></a></h2>
      <div class="b_caption"><p class="b_lineclamp2">永和九年，岁在癸丑&nbsp;…</p></div></li>
    <li class="b_algo b_vtl_deeplinks"><h2> <a href="https://example.org/b">第二条</a> </h2><p>摘要二</p></li>
    <li class="b_ad"><h2><a href="https://ad.example/">广告</a></h2></li>
  </ol>`;
  assert.deepEqual(parseBing(html, 6), [
    { title: "兰亭集序原文", url: "https://www.gushiwen.cn/lanting", snippet: "永和九年，岁在癸丑 …" },
    { title: "第二条", url: "https://example.org/b", snippet: "摘要二" }
  ]);
  assert.equal(parseBing(html, 1).length, 1);
});
