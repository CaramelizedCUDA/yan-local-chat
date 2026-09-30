// 准备工作目录还在等待时，连续按发送只应建立一问；失败后应允许重新发送。
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", lastView: "chat", lastConversationId: "preflight-chat", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", maxTokens: 8192, quota: "100k", usedTokens: 0 }], conversations: [{ id: "preflight-chat", title: "发送准备", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", profileId: "p1", workdir: ${JSON.stringify(WORK)}, messages: [], forks: [], threads: [] }], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`document.querySelector("#chatInput") && !document.querySelector("#chat").classList.contains("hidden")`);

await evalJs(`(() => {
  const original = window.fetch.bind(window);
  let release;
  const gate = new Promise(resolve => release = resolve);
  window.__preflight = { calls: 0, release, original };
  window.fetch = (...args) => {
    // 走总线时路径在请求体里
    const prepare = String(args[0]).includes("/api/work/prepare") || String(args[1]?.body || "").includes('"path":"/api/work/prepare"');
    if (prepare && ++window.__preflight.calls === 1)
      return gate.then(() => new Response('{"error":"临时故障"}', { status: 503, headers: { "Content-Type": "application/json" } }));
    return original(...args);
  };
  const input = document.querySelector("#chatInput");
  input.value = "只发送一次";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return true;
})()`);
await waitFor(`window.__preflight.calls === 1`);
check(
  "preflight blocks repeated Enter and keeps the draft visible",
  await evalJs(`window.__preflight.calls === 1 && document.querySelector("#chatInput").value === "只发送一次" && document.querySelector("#chatSend").disabled && __yanState().conversations[0].messages.length === 0`)
);
await evalJs(`window.__preflight.release(); true`);
await waitFor(`!document.querySelector("#chatSend").disabled`);
check("failed preflight leaves the message unsent", await evalJs(`__yanState().conversations[0].messages.length === 0`));

await evalJs(`document.querySelector("#chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); true`);
await waitFor(`__yanState().conversations[0].messages.length >= 2`);
check(
  "retry creates exactly one user message and one reply",
  await evalJs(`(() => { const messages = __yanState().conversations[0].messages; return messages.length === 2 && messages[0].role === "user" && messages[0].content === "只发送一次" && messages[1].role === "assistant"; })()`)
);
await evalJs(`window.fetch = window.__preflight.original; true`);
close();
