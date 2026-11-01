// 行迹另存：收了尾、够长的一答，思绪与帮手的经过挪进 对话/行迹/<短码>/，对话文件里只留记号；
// 开着看时取回来接上（思绪与帮手面板照常），重开页面后再开这段也接得回；挪走后再存，另存的那份不再重写
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { connect, check, sleep, PAGE, CHATS } from "./lib.mjs";
const ID = "cold-trail",
  code = createHash("sha1").update(ID).digest("hex").slice(0, 10),
  trailDir = `${CHATS}/行迹/${code}`,
  thought = Array.from({ length: 400 }, (_, i) => `第 ${i + 1} 念：把旧的行迹挪出去。`).join("\n"),
  output = Array.from({ length: 400 }, (_, i) => `line ${i}: ok`).join("\n");
const chatFile = () => readdirSync(CHATS).find(name => name.endsWith(`·${code}.json`));
const onDisk = () => {
  try {
    return JSON.parse(readFileSync(`${CHATS}/${chatFile()}`, "utf8")).conversation;
  } catch {
    return null;
  }
};
const pieces = () => (existsSync(trailDir) ? readdirSync(trailDir).filter(name => name.endsWith(".json")) : []);
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: ID,
      title: "行迹另存",
      createdAt: "2026-10-30",
      updatedAt: new Date().toISOString(),
      forks: [],
      threads: [],
      messages: [
        { id: "u1", role: "user", content: "派个帮手把日志过一遍。", timestamp: "2026-10-30" },
        {
          id: "a1",
          role: "assistant",
          content: "帮手看过了，日志都正常。",
          status: "complete",
          timestamp: "2026-10-30",
          reasoning: thought,
          steps: [
            {
              id: "d1",
              name: "delegate",
              arguments: '{"task":"过一遍日志"}',
              status: "done",
              title: "过日志",
              result: "回报",
              sub: {
                id: "sub-d1",
                task: "过一遍日志",
                content: "日志都正常。",
                reasoning: thought,
                status: "complete",
                report: "日志都正常。",
                steps: [
                  {
                    id: "s1",
                    name: "run_command",
                    arguments: '{"command":"cat log"}',
                    status: "done",
                    title: "cat log",
                    output,
                    scope: "sub-d1"
                  }
                ]
              }
            }
          ]
        },
        { id: "u2", role: "user", content: "好。", timestamp: "2026-10-30" },
        { id: "a2", role: "assistant", content: "嗯。", status: "complete", timestamp: "2026-10-30" }
      ]
    }
  })
});
const { send, evalJs, waitFor, close } = await connect();
const mine = `__yanState().conversations.find(c => c.id === "${ID}")`;
const open = async () => {
  await waitFor(`!!document.querySelector('[data-conversation="${ID}"]')`, 10000);
  await evalJs(`document.querySelector('[data-conversation="${ID}"] .history-open').click(); true`);
  await waitFor(`!!document.querySelector('.message[data-message="a1"]')`, 8000);
};
await send("Page.navigate", { url: PAGE });
await open();
await evalJs(`__yanSave(); true`);
let t = Date.now();
while (Date.now() - t < 10000 && !(pieces().length && onDisk()?.messages?.[1]?.cold)) await sleep(150);
const saved = onDisk()?.messages?.[1];
check(
  "a settled long reply moves its thoughts and helper run out of the chat file",
  !!saved?.cold?.key &&
    saved.reasoning === undefined &&
    saved.steps?.[0]?.sub?.steps === undefined &&
    saved.steps?.[0]?.sub?.reasoning === undefined,
  JSON.stringify({ cold: saved?.cold, keys: Object.keys(saved || {}) })
);
check(
  "the helper's report and title stay in the chat file",
  saved?.steps?.[0]?.sub?.content === "日志都正常。" && saved?.steps?.[0]?.title === "过日志"
);
check(
  "the moved part lands once under 行迹/<code>/",
  pieces().length === 1 && JSON.parse(readFileSync(`${trailDir}/${pieces()[0]}`, "utf8")).subs?.["sub-d1"]?.steps?.[0]?.output === output,
  JSON.stringify(pieces())
);
check("the short reply stays whole in the chat file", !onDisk()?.messages?.[3]?.cold && onDisk()?.messages?.[3]?.content === "嗯。");
check("the page keeps the moved part in hand", await evalJs(`${mine}.messages[1].reasoning.length === ${thought.length}`));
// 重开页面：对话从目录读回来时缺着那几样，开这段时取回来接上（先回欢迎页，免得重开后直接停在这段）
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(300);
await send("Page.navigate", { url: PAGE + "?again" });
await waitFor(`!!${mine}`, 10000);
check("after reload the chat comes back without the moved part", await evalJs(`${mine}.messages[1].reasoning === undefined`));
await open();
await waitFor(`${mine}.messages[1].reasoning?.length === ${thought.length}`, 8000).catch(() => {});
check(
  "opening the chat brings the thoughts and helper steps back",
  await evalJs(
    `${mine}.messages[1].reasoning?.length === ${thought.length} && ${mine}.messages[1].steps[0].sub.steps?.[0]?.output?.length === ${output.length}`
  )
);
check(
  "the thoughts render once they are back",
  await evalJs(`!!document.querySelector('.message[data-message="a1"] .reasoning')`),
  await evalJs(`document.querySelector('.message[data-message="a1"]')?.className`)
);
// 再存：另存的那份不重写，对话文件仍只记号
const stamp = statSync(`${trailDir}/${pieces()[0]}`).mtimeMs;
await evalJs(`${mine}.pinned = true; __yanSave(); true`);
t = Date.now();
while (Date.now() - t < 6000 && !onDisk()?.pinned) await sleep(150);
check(
  "saving again keeps the chat file light and leaves the stored part alone",
  onDisk()?.pinned === true &&
    onDisk()?.messages?.[1]?.reasoning === undefined &&
    pieces().length === 1 &&
    statSync(`${trailDir}/${pieces()[0]}`).mtimeMs === stamp
);
// 删掉这段：行迹的夹一并删去
await fetch(PAGE + "api/chats/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: ID })
});
t = Date.now();
while (Date.now() - t < 6000 && existsSync(trailDir)) await sleep(150);
check("deleting the chat removes its stored trail", !existsSync(trailDir));
await close();
