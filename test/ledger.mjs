// 账本：目录下 .yan/账本.md 每一答开工时读一回，接在这一问之后（之前的问不带）；附着全文即算读过，主模型可径直改；下一问看到的是改后的那份
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK + "/.yan", { recursive: true });
writeFileSync(WORK + "/.yan/账本.md", "# 目标\n- 分类准确率达标线 0.9\n# 约束\n- 只用 CPU\n");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const reply = n =>
  `(__yanState().conversations[0]?.messages || []).filter(m => m.role === "assistant" && m.status === "complete")[${n}]?.content || ""`;
try {
  await evalJs(
    `document.querySelector("#welcomeInput").value = "LEDGER 开工"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
  );
  await waitFor(`${reply(0)}.startsWith("LEDGER|")`, 30000);
  const first = await evalJs(reply(0));
  check(
    "the ledger follows this question as its own part and the system prompt names it",
    /tail:yes\|once:yes\|sys:yes/.test(first),
    first
  );
  check("the main model edits the ledger without reading it first", first.includes("edit:yes"), first);
  check("the edit landed in the file", readFileSync(WORK + "/.yan/账本.md", "utf8").includes("达标线 0.95"));
  await evalJs(
    `document.querySelector("#chatInput").value = "接着"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
  );
  await waitFor(`${reply(1)}.startsWith("LEDGER|")`, 30000);
  const second = await evalJs(reply(1));
  check("next question carries the edited ledger, and only once", /tail:yes\|once:yes/.test(second) && second.includes("now:0.95"), second);
} finally {
  // 工作目录各用例共用：别让账本冠到后面用例的问上
  rmSync(WORK + "/.yan", { recursive: true, force: true });
}
close();
