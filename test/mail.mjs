// 磁盘信箱端到端（P0-B 验收）：
//   一、投信 → 页面认领 → 写成带「信」细线的用户消息 → 唤醒执行 → 落盘回执（信的正本销掉、回执簿记上）；
//   二、回执前后刷新页面，同一封重领也不重复写第二遍（mailSeen 挡着）；
//   三、用户叫停过的对话来信只记下不开工，用户再发话即放行。
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK, HOME } from "./lib.mjs";

const { send, evalJs, waitFor, shot, close } = await connect();
mkdirSync(WORK, { recursive: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);

const conv = `__yanState().conversations[0]`;
const post = (msgId, payload) =>
  evalJs(
    `fetch("/api/mail/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: ${conv}.id, msgId: ${JSON.stringify(msgId)}, from: "总调度", payload: ${JSON.stringify(payload)} }) }).then(r => r.json())`
  );
const queueFile = id => `${HOME}/mail-queue/${id}.json`;
const fileGone = async (id, timeout = 15000) => {
  for (let i = 0; i * 300 < timeout && existsSync(queueFile(id)); i += 1) await sleep(300);
  return !existsSync(queueFile(id));
};

// 先立一段对话当「后台 Bot」
await evalJs(
  `setTimeout(() => { document.querySelector("#welcomeInput").value = "MAILHOME"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
);
await waitFor(`${conv}?.messages[1]?.status === "complete"`, 20000);

// ---- 验收一：投信 → 认领 → 写消息 → 唤醒执行 → 回执
check("post a letter via the bridge", (await post("m-acc-1", "MAILPING 办第一件事"))?.posted === true);
await waitFor(`${conv}.messages.some(m => m.mailId === "m-acc-1")`, 15000);
await waitFor(`${conv}.messages.at(-1)?.status === "complete"`, 25000);
const woke = await evalJs(
  `(c => ({ roles: c.messages.map(m => m.role).join(","), last: c.messages.at(-1).content, seen: c.mailSeen || [], seal: document.querySelector("#messages .message.relay .seal")?.textContent || "" }))(${conv})`
);
check(
  "letter wrote a user message and woke an answer",
  woke.roles.endsWith("user,assistant") && woke.last.includes("指令结果") && woke.seen.includes("m-acc-1"),
  JSON.stringify(woke)
);
check("the letter message wears the 信 seal", woke.seal === "信", woke.seal);
check("the letter file is gone after ACK", await fileGone("m-acc-1"));
check("acked-ids.json records it", JSON.parse(readFileSync(`${HOME}/mail-queue/acked-ids.json`, "utf8")).ids.includes("m-acc-1"));
check("reposting the same msgId is a dup", (await post("m-acc-1", "再来一遍"))?.dup === true);

// ---- 验收二：回执前后刷新，同一封重领不重复写
await post("m-acc-2", "MAILPING 办第二件事");
await waitFor(`${conv}.messages.some(m => m.mailId === "m-acc-2")`, 15000);
await send("Page.reload");
await sleep(1800);
await waitFor(`${conv}?.messages?.length > 0`, 15000);
const dup = await evalJs(`${conv}.messages.filter(m => m.mailId === "m-acc-2").length`);
check("re-claim after reload writes no second message", dup === 1, String(dup));
// 刷新前若已被旧页押着，新页要等租期（30 秒）过期才能再领、再回执
check("second letter also acked", await fileGone("m-acc-2", 45000));

// ---- 验收三：叫停的只记下不开工；用户再发话即放行
await evalJs(
  `setTimeout(() => { document.querySelector("#chatInput").value = "LOOP"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); }, 300); true`
);
await waitFor(`${conv}.messages.at(-1)?.status === "streaming"`, 15000);
await sleep(600);
await evalJs(`document.querySelector("#chatSend").click(); true`); // 空输入框按「止」
await waitFor(`${conv}.userHalted === true`, 8000);
check("manual halt marks userHalted", (await evalJs(`${conv}.userHalted`)) === true);
await post("m-acc-3", "MAILPING 别叫醒我");
await waitFor(`${conv}.messages.some(m => m.mailId === "m-acc-3")`, 15000);
await sleep(5000);
const held = await evalJs(
  `(c => ({ lastRole: c.messages.at(-1).role, lastStatus: c.messages.at(-1).status || "", mails: c.messages.filter(m => m.mailId === "m-acc-3").length }))(${conv})`
);
check("letter to a halted conv is recorded, no answer started", held.lastRole === "user" && held.mails === 1, JSON.stringify(held));
check("halted letter still acked", await fileGone("m-acc-3"));
// 用户再发话即放行：下一封照常叫醒
await evalJs(
  `setTimeout(() => { document.querySelector("#chatInput").value = "MAILBACK"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); }, 300); true`
);
await waitFor(`${conv}.messages.at(-1)?.status === "complete" && !${conv}.userHalted`, 25000);
await post("m-acc-4", "MAILPING 办第四件事");
await waitFor(`${conv}.messages.at(-1)?.status === "complete" && ${conv}.messages.at(-1).role === "assistant"`, 25000);
check("after the user speaks again, letters wake as usual", await fileGone("m-acc-4"));
await shot("mail.png");
await close();
