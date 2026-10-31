// 候 · 等时刻与来信：set_timer 挂上就收尾，书眉的漏列着它、写几时到；到点另起一答（细线「候「…」到点」）。
// 工具说明里填着这段对话的信址；本机程序往 /api/mail 寄信，那段对话另起一答，细线「来信「来处」」后摘正文的头一句
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
mkdirSync(WORK, { recursive: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const ask = text =>
  evalJs(
    `document.querySelector("#newChat").click(); setTimeout(() => { document.querySelector("#welcomeInput").value = ${JSON.stringify(text)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
  );
const conv = text => `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})`;

// ---- 等时刻
await ask("TIMERWAKE");
await waitFor(`${conv("TIMERWAKE")}?.messages[1]?.status === "complete"`, 15000);
const first = await evalJs(
  `(m => ({ step: m.steps[0]?.name, timer: m.steps[0]?.timer, text: m.content, rows: [...document.querySelectorAll("#clepsydra .clepsydra-row")].length, hidden: document.querySelector("#clepsydra").classList.contains("hidden") }))(${conv("TIMERWAKE")}.messages[1])`
);
check(
  "set_timer hangs a wait and the answer closes; the tool description carries this chat's mail address",
  first.step === "set_timer" && /^t\d+$/.test(first.timer?.id || "") && first.timer.state === "waiting" && first.text.includes("addr-ok"),
  JSON.stringify(first)
);
await evalJs(`document.querySelector("#clepsydra .clepsydra-btn").click(); true`);
await sleep(200);
const row = await evalJs(`(r => r && ({ text: r.textContent, title: r.title }))(document.querySelector("#clepsydra .clepsydra-row"))`);
check(
  "the clepsydra lists it by its note and when it's due",
  !first.hidden && /^看一眼构建\d{1,2}:\d{2}›$/.test(row?.text || "") && /t\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(row?.title || ""),
  JSON.stringify(row)
);
await evalJs(`document.querySelector("#clepsydra .clepsydra-btn").click(); true`);
await waitFor(
  `${conv("TIMERWAKE")}.messages.at(-1)?.content.includes("TIMERWAKE woke") && ${conv("TIMERWAKE")}.messages.at(-1).status === "complete"`,
  20000
).catch(() => {});
const woke = await evalJs(
  `(c => ({ shape: c.messages.map(m => m.role + (m.relay ? ":relay" : "")).join(","), last: c.messages.at(-1).content, line: document.querySelector("#messages .message.relay")?.textContent || "", state: c.messages[1].steps[0].timer.state, clepsydra: document.querySelector("#clepsydra").classList.contains("hidden") }))(${conv("TIMERWAKE")})`
);
check(
  "when it's due a new answer wakes behind a thin line, the note delivered; the wait is settled and leaves the clepsydra",
  woke.shape === "user,assistant,user:relay,assistant" &&
    woke.line === "候候「看一眼构建」到点" &&
    woke.last.includes("到点") &&
    woke.last.includes("看一眼构建") &&
    woke.state === "done" &&
    woke.clepsydra,
  JSON.stringify(woke)
);

// ---- 来信
await ask("LETTERWAIT");
await waitFor(`${conv("LETTERWAIT")}?.messages[1]?.status === "complete"`, 15000);
// 落盘之后桥接才认得这段对话
await sleep(1500);
const id = await evalJs(`${conv("LETTERWAIT")}.id`);
const sent = await fetch(`${PAGE}api/mail`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ to: id, from: "CI · notes", text: "构建失败：test_08 两条未过\n详见日志" })
}).then(r => r.json());
const unknown = await fetch(`${PAGE}api/mail`, { method: "POST", body: JSON.stringify({ to: "nope", text: "x" }) });
check(
  "a local program can mail a chat by its id; an unknown id is refused",
  sent.ok === true && unknown.status === 400,
  JSON.stringify(sent)
);
await waitFor(
  `${conv("LETTERWAIT")}.messages.at(-1)?.content.includes("LETTERWAIT woke") && ${conv("LETTERWAIT")}.messages.at(-1).status === "complete"`,
  20000
).catch(() => {});
const letter = await evalJs(
  `(c => ({ last: c.messages.at(-1).content, name: document.querySelector("#messages .message.relay .relay-name")?.textContent, gist: document.querySelector("#messages .message.relay .relay-gist")?.textContent, seal: document.querySelector("#messages .message.relay .seal")?.textContent }))(${conv("LETTERWAIT")})`
);
check(
  "the letter wakes it: thin line with the sender and the first line of the text, the whole letter delivered",
  letter.name === "来信「CI · notes」" &&
    letter.gist === "构建失败：test_08 两条未过 详见日志" &&
    letter.seal === "信" &&
    letter.last.includes("来信 · CI · notes") &&
    letter.last.includes("详见日志"),
  JSON.stringify(letter)
);
await shot("timer-letter.png");
await close();
