// 听音快速换曲：浏览器里暂存的音（blob）要先读出字节，读着的时候换到了下一首，先前那首读完不能盖掉喇叭的地址
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { load } from "./harness.mjs";

// 只看换曲这一段：喇叭的样子、整页（listenSync / listenRenderPage / listenPageLive）这里不画
const f = load([
  "listenLoad",
  "doc: () => document",
  "track: () => listenTrack",
  "quiet: () => { listenSync = () => {}; listenRenderPage = () => {}; listenPageLive = () => false; }"
]);
f.quiet();

test("A 还没读完就换到 B：A 迟到的结果不覆盖喇叭", async () => {
  const audio = { dataset: {}, addEventListener() {}, removeAttribute() {}, pause() {}, src: "" };
  const query = f.doc().querySelector;
  f.doc().querySelector = selector => (selector === "#listenAudio" ? audio : query(selector));
  try {
    let finishA;
    const a = {
      key: "a",
      url: "blob:a",
      list: [],
      bytes: () => new Promise(resolve => (finishA = () => resolve(new TextEncoder().encode("A"))))
    };
    const b = { key: "b", url: "blob:b", list: [], bytes: async () => new TextEncoder().encode("B") };
    const loadingA = f.listenLoad(a);
    await f.listenLoad(b);
    finishA();
    await loadingA;
    assert.equal(f.track(), b);
    assert.equal(await resolveObjectURL(audio.src).text(), "B");
  } finally {
    f.doc().querySelector = query;
  }
});
