// 工具交回的画面：假 MCP 的 snap 回一张图，连截两幅。模型看得到最新那幅（紧跟工具结果的一条用户消息），旧的换成一行字；
// 步骤卡里露出缩略图（折着也露），原件挂在步骤上存着，点开进图片查看器
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, check, sleep, PAGE } from "./lib.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-mcp.mjs");
const { send, evalJs, waitFor, close } = await connect();
const seed = {
  version: 4,
  settings: {
    name: "测",
    theme: "light",
    inkMotion: "off",
    activeProfileId: "p1",
    autoTitle: false,
    mcpServers: { cam: { command: process.execPath, args: [FAKE, "--snap"] } }
  },
  profiles: [
    {
      id: "p1",
      source: "custom",
      name: "假模型",
      model: "fake",
      baseUrl: "http://127.0.0.1:8798/v1",
      apiKey: "k",
      temperature: 0.7,
      maxTokens: 8192,
      quota: "",
      usedTokens: 0,
      systemPrompt: ""
    }
  ],
  conversations: [],
  library: [],
  drafts: {}
};
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(seed))}); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1500);
const lastAssistant = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "MCPSHOT 截两幅"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`${lastAssistant}?.dataset.status === "complete"`, 60000);
const reply = await evalJs(`${lastAssistant}.textContent`);
check("only the latest picture rides along, right after the tool results", /images:1\|tail:true/.test(reply), reply.slice(0, 200));
check("the earlier picture is replaced by a line of text", /stale:true/.test(reply), reply.slice(0, 200));
check("the picture goes to the model as a data: url", /png:true/.test(reply), reply.slice(0, 200));
const steps = JSON.parse(
  await evalJs(
    `JSON.stringify(__yanState().conversations[0].messages.at(-1).steps.map(s => ({ name: s.name, files: s.attachments || [] })))`
  )
);
check(
  "each snap step keeps its picture as an attachment (metadata only in the conversation)",
  steps.length === 2 && steps.every(s => s.files.length === 1 && s.files[0].kind === "image" && s.files[0].data === undefined),
  JSON.stringify(steps).slice(0, 300)
);
await waitFor(`${lastAssistant}.querySelectorAll(".tool-shot img[src^='data:image/png']").length === 2`, 10000).catch(() => {});
const shots = await evalJs(
  `[...${lastAssistant}.querySelectorAll(".tool-shot")].map(el => ({ src: (el.querySelector("img").getAttribute("src") || "").slice(0, 22), shown: el.getBoundingClientRect().height > 0 }))`
);
check(
  "trail shows a thumbnail per picture, visible even with the step folded",
  shots.length === 2 && shots.every(s => s.src === "data:image/png;base64," && s.shown),
  JSON.stringify(shots)
);
await evalJs(`${lastAssistant}.querySelector(".tool-shot").click(); true`);
await waitFor(`!document.querySelector("#imageViewer")?.classList.contains("hidden")`, 5000).catch(() => {});
check("clicking a thumbnail opens the image viewer", await evalJs(`!document.querySelector("#imageViewer")?.classList.contains("hidden")`));
await close();
process.exit(0);
