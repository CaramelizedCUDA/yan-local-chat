// 桌面通知：设置 → 通用里开了（头一回请准），页面不在眼前时待你定夺、答毕各弹一条，同段对话同一个 tag；人在页上不弹
import { connect, check, sleep, PAGE } from "./lib.mjs";

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], memory: { enabled: true, items: [] }, drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(900);
// 换上一个记账的假 Notification（还没准许，请准即准），人不在页上
await evalJs(`(() => {
  window.__notes = []; window.__asked = 0; window.__away = true;
  window.Notification = class { static permission = "default"; static requestPermission() { window.__asked++; Notification.permission = "granted"; return Promise.resolve("granted"); } constructor(title, opts) { window.__notes.push({ title, ...opts }); } close() {} };
  document.hasFocus = () => !window.__away;
  return true;
})()`);

await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
const row = await evalJs(
  `(() => { const b = document.querySelector('[data-setting="notify"][data-value="true"]'); return { has: !!b, off: document.querySelector('[data-setting="notify"][data-value="false"]')?.classList.contains("active") }; })()`
);
check("general settings has the desktop notification switch, off by default", row.has && row.off, JSON.stringify(row));
await evalJs(`document.querySelector('[data-setting="notify"][data-value="true"]').click(); true`);
await sleep(300);
check(
  "turning it on asks the browser once and records it",
  await evalJs(
    `window.__asked === 1 && __yanState().settings.notify === true && document.querySelector('[data-setting="notify"][data-value="true"]').classList.contains("active")`
  )
);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(300);

await evalJs(
  `document.querySelector("#welcomeInput").value = "CHAT-AUTO"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(
  `!document.querySelector("#approvalBar").classList.contains("hidden") && !!document.querySelector('#approvalBar [data-approve="auto"]')`
);
const asked = await evalJs(`window.__notes.slice()`);
check(
  "awaiting a decision while away: one notification",
  asked.length === 1 && asked[0].body.startsWith("待你定夺："),
  JSON.stringify(asked)
);
await evalJs(`document.querySelector('#approvalBar [data-approve="auto"]').click(); true`);
await waitFor(`document.querySelector('.message.assistant')?.dataset.status === "complete"`);
await sleep(300);
const done = await evalJs(`({ notes: window.__notes.slice(), id: __yanState().conversations[0].id })`);
check(
  "the answer finishing while away: a second one, tagged with the conversation",
  done.notes.length === 2 && done.notes[1].body.startsWith("答毕：") && done.notes.every(n => n.tag === done.id),
  JSON.stringify(done)
);

// 人在页上：不弹
await evalJs(`window.__away = false; true`);
await evalJs(
  `document.querySelector("#chatInput").value = "CHAT-AUTO again"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `[...document.querySelectorAll('.message.assistant')].length === 2 && [...document.querySelectorAll('.message.assistant')].at(-1).dataset.status === "complete"`
);
await sleep(300);
check("while the page has focus nothing pops up", (await evalJs(`window.__notes.length`)) === 2);
await close();
