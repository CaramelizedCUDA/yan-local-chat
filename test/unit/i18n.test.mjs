// 多语言：中文界面 t 原样返回；英文表的译文与原文的变量对得上；带变量的句子、单复数、桥接回的整句报错照表换
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";
const EN = createRequire(import.meta.url)("../../i18n/en.js");

test("中文界面：t 与 tr 原样返回", () => {
  const { t, tr, LANG } = load(["t", "tr", "LANG"]);
  assert.equal(LANG, "zh");
  assert.equal(t("测试连接"), "测试连接");
  const n = 3;
  assert.equal(t`已取回 ${n} 个模型`, "已取回 3 个模型");
  assert.equal(tr("连不上上游接口：ECONNREFUSED"), "连不上上游接口：ECONNREFUSED");
});

test("文字解码：空文件、单字节、UTF-16 都解得开", () => {
  const { decodeTextBytes } = load(["decodeTextBytes"]);
  assert.equal(decodeTextBytes(new Uint8Array(0)), "");
  assert.equal(decodeTextBytes(new Uint8Array([0x61])), "a");
  assert.equal(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x61, 0x00])), "a");
  assert.equal(decodeTextBytes(new Uint8Array([0x61, 0x62, 0x63]).subarray(2)), "c");
});

test("英文表：译文里的变量都出自原文，原文的变量译文都用上了", () => {
  const indices = text => new Set([...text.matchAll(/\{(\d+)(?:\|[^}]*)?\}/g)].map(m => m[1]));
  for (const [key, value] of Object.entries(EN)) {
    assert.equal(typeof value, "string", key);
    assert.ok(value.length > 0, `空译文：${key}`);
    const from = indices(key),
      to = indices(value);
    for (const i of to) assert.ok(from.has(i), `译文多出 {${i}}：${key}`);
    for (const i of from) assert.ok(to.has(i), `译文漏了 {${i}}：${key}`);
  }
});

test("英文界面：整句、带变量的句子、单复数、桥接的报错", () => {
  globalThis.YAN_EN = EN;
  try {
    const { t, tr, LANG } = load(["t", "tr", "LANG"]);
    assert.equal(LANG, "en");
    assert.equal(t("测试连接"), "Test connection");
    assert.equal(t("表里没有的话"), "表里没有的话");
    const one = 1,
      many = 3;
    assert.equal(t`已取回 ${many} 个模型`, "Fetched 3 models");
    assert.equal(t`${one}问`, "1 question");
    assert.equal(t`${many}问`, "3 questions");
    // 桥接回的整句：变量里的中文也照表换
    assert.equal(tr("连不上上游接口：ECONNREFUSED"), "Can't reach the API: ECONNREFUSED");
    assert.equal(tr("搜索引擎暂时不可用：连接超时"), "Search engine unavailable: Connection timed out");
    // 几乎全是变量的句式不拿来套别的话
    assert.equal(tr("这一问没有结果"), "这一问没有结果");
    // 步骤上存的是中文原文，画出来时照语言换；嵌着的几段也各自换
    const { stepText } = load(["stepText"]);
    assert.equal(stepText("已写入"), "Written");
    assert.equal(stepText("12 行 · 3 KB · 覆盖"), "12 lines · 3 KB · overwrite");
    assert.equal(stepText("后台 b1 · 已结束 · 退出码 0 · 出沙箱"), "Background b1 · finished · exit code 0 · outside sandbox");
    assert.equal(stepText(undefined), "");
  } finally {
    delete globalThis.YAN_EN;
  }
});
