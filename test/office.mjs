// 游目里的 Office：言领凭据开一份文件、宿主页取来交给引擎、人改了停手几秒自动存回原文件；这段对话作答时文档存盘并锁住、
// 模型那一问末尾附着「用户开着哪几份」、答完放开（文件被改过就重新载入）；存回时文件已被别处改过就不覆盖、提示重新载入；
// 凭据不对拿不到文件，别的域名借 127.0.0.1 也进不来。引擎换成只会嵌入接口的假引擎（test/fake-office），测的是言这边的管道
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import http from "node:http";
import { connect, check, sleep, PAGE, DEBUG, HOME, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const ENGINE = `${HOME}/游目/依赖/office`;
mkdirSync(ENGINE, { recursive: true });
copyFileSync(new URL("./fake-office/editor.html", import.meta.url), `${ENGINE}/editor.html`);
writeFileSync(`${ENGINE}/yan-office.json`, JSON.stringify({ commit: "fake" }));
mkdirSync(ARCHIVE, { recursive: true });
const FILE = `${ARCHIVE}/测试.docx`;
writeFileSync(FILE, "原文");
const disk = () => readFileSync(FILE, "utf8");

await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const conv = `__yanState().conversations.find(c => c.messages[0]?.content === "OFFICECHAT 一")`;
await evalJs(
  `document.querySelector("#newChat").click(); setTimeout(() => { document.querySelector("#welcomeInput").value = "OFFICECHAT 一"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
);
await waitFor(`${conv}?.messages[1]?.status === "complete"`, 15000);
check(
  "with nothing open the model is told nothing",
  await evalJs(`${conv}.messages[1].content.includes("OFFICE｜none")`),
  await evalJs(`${conv}.messages[1].content`)
);

// 领凭据，在测试浏览器里另开一页去宿主页
const opened = await evalJs(
  `__yanBridgeFetch("/api/office/open", JSON.stringify({ path: ${JSON.stringify(FILE)}, conversation: ${conv}.id, locale: "zh", theme: "light" })).then(r => r.json())`
);
check(
  "opening hands back a host page on a separate local port",
  /^http:\/\/127\.0\.0\.1:\d+\/yan\/host\.html\?t=/.test(opened.url) && !opened.url.includes(":8799/"),
  opened.url
);
const version = await (await fetch(DEBUG + "/json/version")).json();
const browser = new WebSocket(version.webSocketDebuggerUrl);
await new Promise(r => (browser.onopen = r));
let seq = 0;
const browserSend = (method, params = {}, sessionId) =>
  new Promise(resolve => {
    const id = ++seq;
    const listener = e => {
      const m = JSON.parse(e.data);
      if (m.id === id) {
        browser.removeEventListener("message", listener);
        resolve(m.result);
      }
    };
    browser.addEventListener("message", listener);
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });
const { targetId } = await browserSend("Target.createTarget", { url: opened.url, newWindow: true });
const { sessionId } = await browserSend("Target.attachToTarget", { targetId, flatten: true });
const host = async expr => (await browserSend("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId))?.result?.value;
const hostWait = async (expr, ms = 8000) => {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(150)) if (await host(expr)) return true;
  return false;
};
const box = `document.querySelector("iframe")?.contentDocument?.getElementById("body")`;
const note = `(document.querySelector("#note.show #noteText")?.textContent || "")`;
check("the engine gets the file's bytes", await hostWait(`${box}?.value === "原文"`), await host(`${box}?.value`));

// 人改了，停手几秒就存回原文件
await host(`(b => { b.value = "原文，人改"; b.dispatchEvent(new Event("input")); })(${box})`);
let saved = false;
for (let i = 0; i < 40 && !saved; i++, await sleep(250)) saved = disk() === "原文，人改";
check("edits are saved back to the file a few seconds after typing stops", saved, disk());

// 这段对话作答：开工前锁住（只读、顶上一条签），那一问附着开着的文件；作答期间执事改了原件，答完重新载入、放开
await evalJs(`(i => { i.value = "OFFICECHAT 二"; i.dispatchEvent(new Event("input")); })(document.querySelector("#chatInput")); true`);
await evalJs(
  `document.querySelector("#chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); true`
);
check(
  "while the conversation answers, the document is read-only with a note",
  await hostWait(`${box}?.readOnly === true && ${note}.includes("执事正在作答")`),
  await host(note)
);
writeFileSync(FILE, "执事改过");
await waitFor(`${conv}?.messages[3]?.status === "complete"`, 20000);
const answer = await evalJs(`${conv}.messages[3].content`);
check("the model is told which file the user has open", answer.includes("OFFICE｜seen｜测试.docx"), answer);
check(
  "after the answer the document reloads the assistant's edit and unlocks",
  await hostWait(`${box}?.value === "执事改过" && ${box}.readOnly === false && !${note}`),
  JSON.stringify(await host(`[${box}?.value, ${box}?.readOnly, ${note}]`))
);

// 存回前文件被别处改了：不覆盖，提示重新载入
await host(`(b => { b.value = "人又改"; b.dispatchEvent(new Event("input")); })(${box})`);
writeFileSync(FILE, "别处改的");
check(
  "a save over a file changed elsewhere is refused and offers a reload",
  await hostWait(`${note}.includes("在别处被改过")`, 9000),
  await host(note)
);
check("the other change on disk is kept", disk() === "别处改的", disk());

// 凭据不对拿不到；别的域名借 127.0.0.1 进不来
const port = new URL(opened.url).port;
const bad = await fetch(`http://127.0.0.1:${port}/yan/file?t=nope`);
check("a wrong token gets nothing", bad.status === 404);
const rebound = await new Promise(resolve =>
  http.get(
    { host: "127.0.0.1", port, path: `/yan/file?t=${new URL(opened.url).searchParams.get("t")}`, headers: { Host: "evil.example" } },
    res => resolve(res.statusCode)
  )
);
check("another host name pointed at 127.0.0.1 is refused", rebound === 403, String(rebound));
await browserSend("Target.closeTarget", { targetId });
browser.close();
await close();
