// 卷宗看图：点开一幅，此刻列着的图同在一组——底下一条小样，当前那幅描墨，点小样换幅、← → 翻、到头不绕回；
// 只一幅（查找筛到一幅）时不出小样；文本不进这一组
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";

// 纯色 PNG：宽高不一，看得出换了幅
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, tail]);
};
const png = (w, h, [r, g, b]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array(h).fill(row)))),
    chunk("IEND", Buffer.alloc(0))
  ]);
};
mkdirSync(ARCHIVE, { recursive: true });
writeFileSync(`${ARCHIVE}/甲.png`, png(300, 400, [214, 196, 170]));
writeFileSync(`${ARCHIVE}/乙.png`, png(400, 400, [170, 160, 150]));
writeFileSync(`${ARCHIVE}/丙.png`, png(480, 270, [120, 110, 100]));
writeFileSync(`${ARCHIVE}/笔记.txt`, "不是图");

const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", quota: "", usedTokens: 0 }], conversations: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`typeof document.querySelector("#openLibrary")?.onclick === "function"`);
await evalJs(`document.querySelector("#library").classList.contains("hidden") && document.querySelector("#openLibrary").click(); true`);
await waitFor(`document.querySelectorAll('#libraryGrid [data-library-disk]').length === 4`);

const view = () =>
  evalJs(
    `JSON.stringify({ open: !document.querySelector("#imageViewer").classList.contains("hidden"), name: document.querySelector("#imageViewerName").textContent, marks: document.querySelectorAll("#imageViewerStrip [data-strip-index]").length, on: [...document.querySelectorAll("#imageViewerStrip [data-strip-index]")].findIndex(b => b.classList.contains("on")), strip: !document.querySelector("#imageViewerStrip").classList.contains("hidden") })`
  ).then(JSON.parse);
const order = await evalJs(
  `JSON.stringify([...document.querySelectorAll('#libraryGrid [data-library-disk$=".png"]')].map(r => r.dataset.libraryDisk))`
).then(JSON.parse);
const second = order[1];
await evalJs(`document.querySelector('#libraryGrid [data-library-disk="${second}"]').click(); true`);
await waitFor(`!document.querySelector("#imageViewer").classList.contains("hidden")`);
await sleep(400);
await shot("archive-viewer.png");
let v = await view();
check("点开卷宗里的一幅：此刻列着的三幅同在一组，文本不进", v.open && v.strip && v.marks === 3, JSON.stringify(v));
check("当前那幅在小样里描着，题头是它的名字", v.on === 1 && v.name.startsWith(second), JSON.stringify(v));

await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); true`);
await sleep(100);
v = await view();
check("→ 翻到下一幅", v.on === 2 && v.name.startsWith(order[2]), JSON.stringify(v));
await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); true`);
await sleep(100);
v = await view();
check("到头不绕回", v.on === 2, JSON.stringify(v));
await evalJs(`document.querySelector('#imageViewerStrip [data-strip-index="0"]').click(); true`);
await sleep(100);
v = await view();
check("点小样换到那幅", v.on === 0 && v.name.startsWith(order[0]), JSON.stringify(v));
await evalJs(`document.querySelector("#imageViewerClose").click(); true`);
await waitFor(`document.querySelector("#imageViewer").classList.contains("hidden")`);

// 查找筛到只剩一幅：只看这一幅，不出小样，← → 不动
await evalJs(
  `(s => { s.value = "${order[0].replace(".png", "")}"; s.dispatchEvent(new Event("input")); })(document.querySelector("#librarySearch")); true`
);
await waitFor(`document.querySelectorAll('#libraryGrid [data-library-disk]').length === 1`);
await evalJs(`document.querySelector('#libraryGrid [data-library-disk="${order[0]}"]').click(); true`);
await waitFor(`!document.querySelector("#imageViewer").classList.contains("hidden")`);
v = await view();
check("只一幅时不出小样", v.open && !v.strip && v.marks === 0 && v.name.startsWith(order[0]), JSON.stringify(v));
await evalJs(`document.querySelector("#imageViewerClose").click(); true`);
await close();
