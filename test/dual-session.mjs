// 双原生会话并发尖刺：两段对话同时开工，一段在后台触发请示（ask_user）与审批（run_command），来回切页、
// 空输入框 Enter、手动叫停、会话内差遣——验pendingApprovals / requestJobs / crews 各归各家，不抢条、不串上下文、不丢消息
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
mkdirSync(WORK + "/src", { recursive: true });
writeFileSync(WORK + "/src/a.js", "function f() {\n  return 1;\n}\n");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "", reasoningLevels: "low, medium, xhigh" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);

// 新起一段：#newChat 会把 pendingWorkdir 清掉（见 05-boot.js），先点再写回，跟 bg-wake 同一个写法
const ask = text =>
  evalJs(
    `(w => { document.querySelector("#newChat").click(); __yanState().settings.pendingWorkdir = w; })(__yanState().settings.pendingWorkdir); setTimeout(() => { document.querySelector("#welcomeInput").value = ${JSON.stringify(text)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
  );
const conv = text => `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})`;
const convId = text => evalJs(`${conv(text)}?.id`);
const lastMsg = text => `${conv(text)}.messages.at(-1)`;
const bar = () =>
  evalJs(
    `({ hidden: document.querySelector("#approvalBar").classList.contains("hidden"), stepId: document.querySelector("#approvalBar").dataset.stepId, cmd: document.querySelector("#approvalBar .approval-cmd")?.textContent || "", questions: document.querySelectorAll("#approvalBar .ask-q").length, title: document.querySelector("#approvalBar .approval-title")?.textContent || "" })`
  );
const historyState = id =>
  evalJs(`document.querySelector('#history [data-conversation="${id}"] .history-state')?.className.replace("history-state ", "") || ""`);
const openChat = async id => {
  await evalJs(`document.querySelector('#history [data-conversation="${id}"] .history-open').click(); true`);
  await sleep(450);
};

// ---- 甲：两段会话同时开工，后台那一段挂起请示，不抢前台请示条
await ask("DUAL-LOOP"); // LOOP：无限调 list_files，自己跑上几十轮——长活
await waitFor(`!!${conv("DUAL-LOOP")}`);
const idA = await convId("DUAL-LOOP");
await waitFor(`(${lastMsg("DUAL-LOOP")}.steps || []).length >= 2`, 15000);
await ask("ASK DUAL-B"); // ASK：第一轮就弹 ask_user 小表单
await waitFor(`!!${conv("ASK DUAL-B")} && ${conv("ASK DUAL-B")}.messages.length >= 2`);
const idB = await convId("ASK DUAL-B");
// 趁 B 的请示还没挂上就切回 A：让请示落在后台，盯住它别浮出来
await openChat(idA);
await waitFor(`(${lastMsg("ASK DUAL-B")}.steps || []).some(s => s.status === "pending")`, 15000);
check("sidebar marks the background chat waiting", (await historyState(idB)) === "waiting", await historyState(idB));
check("sidebar marks the foreground chat running", (await historyState(idA)) === "running", await historyState(idA));
{
  const b = await bar();
  check("background ask_user never steals the approval bar", b.hidden || !b.stepId, JSON.stringify(b));
}
// 盯住两秒：B 挂起期间请示条一次都不该出现
let leaked = "";
for (let i = 0; i < 20 && !leaked; i++) {
  const b = await bar();
  if (!b.hidden && b.stepId) leaked = JSON.stringify(b);
  await sleep(100);
}
check("approval bar stays dark through the whole background wait", !leaked, leaked);
// 空输入框 Enter：放行只认本段挂起的，不能把 B 的请示结清
await evalJs(
  `(i => { i.value = ""; i.focus(); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(document.querySelector("#chatInput")); true`
);
await sleep(400);
check(
  "Enter on A's empty composer does not settle B's pending ask",
  await evalJs(`(${lastMsg("ASK DUAL-B")}.steps || []).some(s => s.status === "pending")`)
);
// 切到 B：请示条这才摆上 B 的表单；两题、属于 B 的那一步
await openChat(idB);
{
  const b = await bar();
  const stepId = await evalJs(`(${lastMsg("ASK DUAL-B")}.steps || []).find(s => s.status === "pending")?.id || ""`);
  check("switching to B puts B's ask form on the bar", !b.hidden && b.stepId === stepId && b.questions === 2, JSON.stringify({ ...b, stepId }));
}
// 作答：第一题单选，下一题多选两项，提交
await evalJs(`document.querySelector('#approvalBar .ask-q[data-q="0"] .ask-opt').click(); document.querySelector('#approvalBar [data-form="next"]').click(); true`);
await sleep(250);
await evalJs(
  `[...document.querySelectorAll('#approvalBar .ask-q[data-q="1"] .ask-opt')].slice(0, 2).forEach(o => o.click()); document.querySelector('#approvalBar [data-form="submit"]').click(); true`
);
await waitFor(`${lastMsg("ASK DUAL-B")}.status === "complete"`, 15000);
{
  const done = await evalJs(`${lastMsg("ASK DUAL-B")}.content`);
  check("B completes with the echoed answers", /ASK\|hint:yes\|tool:yes\|/.test(done) && done.includes("清简"), done.slice(0, 140));
}
check("B's steps stayed inside B", await evalJs(`(${conv("ASK DUAL-B")}.messages.flatMap(m => m.steps || [])).every(s => s.name === "ask_user")`));

// ---- 乙：后台审批（run_command 问而后行）也不抢条，切页条随人走
await evalJs(`__yanState().settings.commandPolicyDefault = "ask"; true`);
await ask("DUAL-C 打个招呼");
await waitFor(`!!${conv("DUAL-C 打个招呼")} && ${conv("DUAL-C 打个招呼")}.messages.length >= 2`);
const idC = await convId("DUAL-C 打个招呼");
// 立刻切回 B，让 C 的审批落在后台
await openChat(idB);
await waitFor(`(${lastMsg("DUAL-C 打个招呼")}.steps || []).some(s => s.status === "pending")`, 15000);
check("sidebar marks C waiting while we look at B", (await historyState(idC)) === "waiting", await historyState(idC));
{
  const b = await bar();
  check("C's pending command does not show while viewing B", b.hidden || !b.stepId, JSON.stringify(b));
}
await openChat(idC);
{
  const b = await bar(),
    stepId = await evalJs(`(${lastMsg("DUAL-C 打个招呼")}.steps || []).find(s => s.status === "pending")?.id || ""`);
  check("back on C the bar carries its command", !b.hidden && b.stepId === stepId && b.cmd.includes("你好，世界"), JSON.stringify({ ...b, stepId }));
}
// 准许 → 第二轮把结果写回正文
await evalJs(`document.querySelector('#approvalBar [data-approve="run"]').click(); true`);
await waitFor(`${lastMsg("DUAL-C 打个招呼")}.status === "complete"`, 15000);
check("C completes after approval", await evalJs(`${lastMsg("DUAL-C 打个招呼")}.content.includes("指令结果：成功")`), await evalJs(`${lastMsg("DUAL-C 打个招呼")}.content.slice(0, 120)`));
check("C's steps stayed inside C", await evalJs(`(${conv("DUAL-C 打个招呼")}.messages.flatMap(m => m.steps || [])).every(s => s.name === "run_command")`));

// ---- 丙：挂起途中按「止」：请示收走、行迹收束，别家不动
await ask("DUAL-E 再打个招呼");
await waitFor(`!!${conv("DUAL-E 再打个招呼")} && ${conv("DUAL-E 再打个招呼")}.messages.length >= 2`);
const idE = await convId("DUAL-E 再打个招呼");
await waitFor(`(${lastMsg("DUAL-E 再打个招呼")}.steps || []).some(s => s.status === "pending")`, 15000);
await evalJs(`document.querySelector("#chatSend").click(); true`); // 案上空着，印上是「止」
await waitFor(`${lastMsg("DUAL-E 再打个招呼")}.status === "stopped"`, 10000);
check("halting a pending chat stops it and clears the bar", (await bar()).hidden, JSON.stringify(await bar()));
check("E's sidebar marker is gone after halt", (await historyState(idE)) !== "waiting", await historyState(idE));
check("C is untouched by E's halt", await evalJs(`${lastMsg("DUAL-C 打个招呼")}.status === "complete" && ${conv("DUAL-C 打个招呼")}.messages.every(m => m.role !== "assistant" || m.status === "complete")`));

// ---- 丁：会话内差遣 + 叫停另一段：帮手各归各家
await evalJs(`__yanState().settings.commandPolicyDefault = "auto"; true`);
await ask("DELEGATE");
await waitFor(`!!${conv("DELEGATE")}`);
const idD = await convId("DELEGATE");
// 两名帮手先后派出去（主答可能已收尾、帮手仍在后台做）
await waitFor(
  `(${conv("DELEGATE")}.messages.flatMap(m => m.steps || []).filter(s => s.name === "delegate" && s.sub?.status === "streaming")).length >= 1 || (${conv("DELEGATE")}.messages.flatMap(m => m.steps || []).filter(s => s.name === "delegate")).length === 2`,
  20000
);
await ask("DUAL-F LOOP"); // 又一段长活，起就停
await waitFor(`!!${conv("DUAL-F LOOP")} && ${conv("DUAL-F LOOP")}.messages.length >= 2`);
const idF = await convId("DUAL-F LOOP");
await waitFor(`document.querySelector("#chatSend").classList.contains("stop-btn")`, 10000);
await evalJs(`document.querySelector("#chatSend").click(); true`);
await waitFor(`${lastMsg("DUAL-F LOOP")}.status === "stopped"`, 10000);
check("F halted while D's helpers run", (await evalJs(`${lastMsg("DUAL-F LOOP")}.status`)) === "stopped");
check(
  "D's helper crew still shows running after F's halt",
  (await historyState(idD)) === "running" || (await evalJs(`(${conv("DELEGATE")}.messages.flatMap(m => m.steps || []).filter(s => s.name === "delegate")).some(s => s.sub?.status === "streaming")`)),
  await historyState(idD)
);
// 帮手回报落回 D：另起一答写 DELEGATE done
await waitFor(`${lastMsg("DELEGATE")}.content.includes("DELEGATE done") && ${lastMsg("DELEGATE")}.status === "complete"`, 60000);
check("D's helpers report back into D only", await evalJs(`${lastMsg("DELEGATE")}.content.includes("DELEGATE done")`), await evalJs(`${lastMsg("DELEGATE")}.content.slice(0, 160)`));
check(
  "nothing of D's helpers leaked into F",
  await evalJs(`(${conv("DUAL-F LOOP")}.messages.flatMap(m => m.steps || [])).every(s => s.name === "list_files") && !${conv("DUAL-F LOOP")}.messages.some(m => String(m.content || "").includes("帮手"))`)
);

// ---- 收尾总账：A 的几十轮工具全在自己册上；各段消息角色完整
{
  const a = await evalJs(
    `(c => ({ status: c.messages.at(-1).status, steps: c.messages.flatMap(m => m.steps || []).length, foreign: c.messages.flatMap(m => m.steps || []).filter(s => s.name !== "list_files").length, text: c.messages.at(-1).content.slice(0, 60) }))(${conv("DUAL-LOOP")})`
  );
  check("A's long loop kept every step on its own trail", a.foreign === 0 && ["complete", "stopped", "streaming"].includes(a.status), JSON.stringify(a));
  const roles = await evalJs(
    `["DUAL-LOOP", "ASK DUAL-B", "DUAL-C 打个招呼", "DUAL-E 再打个招呼", "DELEGATE", "DUAL-F LOOP"].map(t => __yanState().conversations.find(c => c.messages[0]?.content === t)?.messages.map(m => m.role).join(","))`
  );
  check("every conversation kept user,assistant message pairs", roles.every(r => /^user,assistant(,user(:relay)?,assistant)*$/.test(r || "")), JSON.stringify(roles));
}
await close();
