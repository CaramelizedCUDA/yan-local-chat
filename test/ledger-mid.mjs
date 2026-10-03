// 账本中途才立：主模型先立账本、再差遣（最常见的顺序），帮手领命时附的须是刚立的那份，不是开工时读到的（空的）
import { mkdirSync, rmSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK, { recursive: true });
rmSync(WORK + "/.yan", { recursive: true, force: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const replies = `(__yanState().conversations[0]?.messages || []).filter(m => m.role === "assistant" && m.status === "complete").map(m => m.content || "")`;
try {
  await evalJs(
    `document.querySelector("#welcomeInput").value = "BOOKMID 开工"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
  );
  await waitFor(`${replies}.some(c => c.startsWith("BOOKMID|"))`, 30000);
  const last = (await evalJs(replies)).find(c => c.startsWith("BOOKMID|"));
  check("a helper sent after the ledger was set up mid-answer gets the new ledger", last.includes("ledger:yes"), last);
} finally {
  rmSync(WORK + "/.yan", { recursive: true, force: true });
}
close();
