// 跟随到底与程序滚动：生成中点书眉回得到顶；触控板式的小步上翻不被落墨的下一帧拽回底部
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const filler = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段：这是一段较长的回答，用来把对话撑高，好让标题滚出视口。`).join("\n\n");
const messages = [];
for (let i = 0; i < 4; i++) {
  messages.push({ id: `u${i}`, role: "user", content: `问题 ${i}`, timestamp: "2026-10-07" });
  messages.push({ id: `a${i}`, role: "assistant", content: filler, status: "complete", timestamp: "2026-10-07" });
}
const conv = {
  id: "follow",
  title: "跟随",
  createdAt: "2026-10-07",
  updatedAt: new Date().toISOString(),
  forks: [],
  threads: [],
  messages
};
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "on", mode: "chat", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [${JSON.stringify(conv)}], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="follow"]')`, 10000);
await evalJs(`document.querySelector('[data-conversation="follow"] .history-open').click(); true`);
await sleep(800);
const last = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
const ask = async text => {
  await evalJs(
    `(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); })(document.querySelector("#chatInput")); true`
  );
  await evalJs(
    `document.querySelector("#chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); true`
  );
  await waitFor(`${last}?.dataset.status === "streaming"`, 10000);
  await sleep(1200);
};
const gap = `(h => h.scrollHeight - h.scrollTop - h.clientHeight)(document.querySelector("#chatScroll"))`;

// 书眉：平滑滚动的头一步只挪几像素，不能当作「又到底了」重新跟随
await ask("SLOWLONG 说长些");
check(
  "streaming keeps the view at the bottom, the running head shown",
  await evalJs(`${gap} < 8 && document.querySelector("#runningHead").classList.contains("shown")`)
);
await evalJs(`document.querySelector("#runningHead").click(); true`);
await sleep(2000);
const top = await evalJs(`document.querySelector("#chatScroll").scrollTop`);
check("clicking the running head while streaming scrolls back to the top", top < 5, `scrollTop=${top}`);

// 触控板：每次上翻 3px
await waitFor(`${last}?.dataset.status === "complete"`, 30000);
await ask("SLOWLONG 再说长些");
const pad = await evalJs(`(async () => {
  const h = document.querySelector("#chatScroll");
  for (let i = 0; i < 10; i++) {
    h.dispatchEvent(new WheelEvent("wheel", { deltaY: -3, bubbles: true }));
    h.scrollTop -= 3;
    await new Promise(r => setTimeout(r, 40));
  }
  await new Promise(r => setTimeout(r, 600));
  return Math.round(h.scrollHeight - h.scrollTop - h.clientHeight);
})()`);
check("touchpad-sized upward steps while streaming are not pulled back to the bottom", pad >= 30, `gap=${pad}`);
close();
