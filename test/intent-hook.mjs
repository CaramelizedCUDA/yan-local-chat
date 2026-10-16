// 意里挂测试作常驻条件：立一项「测过」、凭据 test:node check.js、标成立（记下「过」）。此后哪一答动过手、测试转为不过，
// 收尾前对照就拦一次，把它列为本答内转待复核，模型接着改；动了手而测试照旧过的，照常收尾，不多费一轮
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const dir = `${TMP}/intent-hook`,
  workdir = dir.split("/").join("\\");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/a.txt`, "ok");
writeFileSync(`${dir}/check.js`, `process.exit(require("fs").readFileSync("a.txt", "utf8").trim() === "ok" ? 0 : 1);\n`);
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(workdir)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const answers = `(__yanState().conversations[0]?.messages || []).filter(m => m.role === "assistant" && m.status === "complete")`;
const ask = async (text, n) => {
  const input = n ? "#chatInput" : "#welcomeInput",
    button = n ? "#chatSend" : "#welcome .send-trigger";
  await evalJs(
    `document.querySelector("${input}").value = ${JSON.stringify(text)}; document.querySelector("${input}").dispatchEvent(new Event("input")); document.querySelector("${button}").click(); true`
  );
  await waitFor(`${answers}.length === ${n + 1}`, 60000);
  return evalJs(`JSON.stringify((m => ({ content: m.content, steps: (m.steps || []).map(s => s.name) }))(${answers}[${n}]))`).then(
    JSON.parse
  );
};
try {
  const one = await ask("HOOK1 立一条：改完测试要过", 0),
    saved = JSON.parse(readFileSync(`${dir}/.yan/意.json`, "utf8"));
  check(
    "a test: anchor seals as 过",
    saved.nodes["测过"]?.seal?.prints?.["test:node check.js"] === "过",
    JSON.stringify(saved.nodes["测过"]) + " " + one.content
  );

  const two = await ask("HOOK2 改一下 a.txt", 1);
  check(
    "breaking the test stops the answer before it ends, and the gate names 测过 as bounced",
    /HOOK2 fixed\|bounced/.test(two.content),
    two.content
  );
  check(
    "the gate is one step in the trail, and the model went on to fix it",
    two.steps.filter(s => s === "intent_gate").length === 1 && two.steps.filter(s => s === "write_file").length === 2,
    two.steps.join(",")
  );
  check("the file is fixed", readFileSync(`${dir}/a.txt`, "utf8") === "ok");

  const three = await ask("HOOK3 加个 b.txt", 2);
  check(
    "acting without breaking the test ends normally, no extra round",
    /HOOK3 done\|gated:no/.test(three.content) && !three.steps.includes("intent_gate"),
    JSON.stringify(three)
  );
} finally {
  close();
}
