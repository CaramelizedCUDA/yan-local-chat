// 意：存在目录的 .yan/意.json，跨对话沿用。立根时记下用户的原话；标成立时记下依托文件的指纹，此后文件被谁改了（这里在外面直接改），
// 下一问附着的意里它就是待复核；根的说法模型改不了；桥接是唯一的写者，带着旧版本写会被退回
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const dir = `${TMP}/intent-work`,
  workdir = dir.split("/").join("\\");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(workdir)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const reply = n =>
  `((__yanState().conversations.find(c => c.messages[0]?.content === "INTENTA 立意")?.messages || []).filter(m => m.role === "assistant" && m.status === "complete")[${n}]?.content || "")`;
const post = (path, body) =>
  fetch(PAGE + path.slice(1), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r =>
    r.json()
  );
try {
  await evalJs(
    `document.querySelector("#welcomeInput").value = "INTENTA 立意"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
  );
  await waitFor(`${reply(0)}.startsWith("INTENTA|")`, 30000);
  const first = await evalJs(reply(0)),
    saved = JSON.parse(readFileSync(`${dir}/.yan/意.json`, "utf8"));
  check(
    "the intent is written into the workdir: the root keeps the user's own words, the premise's file is made relative",
    saved.nodes["上线"]?.root?.ask === "INTENTA 立意" && JSON.stringify(saved.nodes["甲"]?.files) === '["src/a.js"]',
    JSON.stringify(saved)
  );
  check(
    "marking done seals the file's fingerprint; the root stands once its premise does",
    saved.nodes["甲"]?.state === "done" &&
      /^[0-9a-f]{40}$/.test(saved.nodes["甲"]?.seal?.prints?.["src/a.js"] || "") &&
      /立住 1 \/ 2/.test(first),
    first
  );
  check("the model cannot reword the root", /是根，说法立后不由你改/.test(first) && saved.nodes["上线"].claim === "可在公网访问", first);
  const steps = await evalJs(
    `(__yanState().conversations.find(c => c.messages[0]?.content === "INTENTA 立意").messages.at(-1).steps || []).filter(s => s.name === "update_intent").map(s => s.title + "|" + s.status)`
  );
  check(
    "the trail keeps one line per change",
    steps.length === 3 && steps[0].startsWith("立住 0 / 2 · 上线、甲|done"),
    JSON.stringify(steps)
  );

  // 在言之外改了那个文件：下一问开工时重取指纹，附着的意里它转待复核，并写明缘由
  writeFileSync(`${dir}/src/a.js`, "v2");
  await evalJs(
    `document.querySelector("#chatInput").value = "INTENTB 再看"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
  );
  await waitFor(`${reply(1)}.startsWith("INTENTB|")`, 30000);
  const second = await evalJs(reply(1));
  check(
    "next question carries the intent after the question, with the changed file turning the premise back to be rechecked",
    /INTENTB 再看[\s\S]*［意 \.yan\/意\.json］立住 0 \/ 2/.test(second) &&
      /\[待复核\] 甲：a\.js 写好[\s\S]*缘由：标成立后又改了 src\/a\.js/.test(second) &&
      /原话：INTENTA 立意/.test(second),
    second
  );

  // 唯一的写者：拿旧版本去写被退回，交回此刻的那份
  const read = await post("/api/work/intent", { workdir }),
    stale = await post("/api/work/intent", { workdir, data: { nodes: {}, log: [] }, base: "0".repeat(40) }),
    fresh = await post("/api/work/intent", { workdir, data: read.data, base: read.version });
  check(
    "a write against an old version is turned back with the current copy; one against the current version lands",
    stale.conflict === true && !!stale.data?.nodes?.["上线"] && !fresh.conflict && fresh.version === read.version,
    JSON.stringify({ stale: stale.conflict, fresh })
  );

  // 另起一段对话、同一个目录：两项同依托 api/user.js，改一回两项都转待复核，接在那一轮的工具结果后；来回三回即相持，只提醒、不拦
  await evalJs(
    `document.querySelector("#newChat").click(); setTimeout(() => { document.querySelector("#welcomeInput").value = "INTENTC 相持"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
  );
  const third = `((__yanState().conversations.find(c => c.messages[0]?.content === "INTENTC 相持")?.messages || []).filter(m => m.role === "assistant" && m.status === "complete")[0]?.content || "")`;
  await waitFor(`${third}.startsWith("INTENTC|")`, 30000);
  const rounds = (await evalJs(third)).slice("INTENTC|".length).split(" ▸ ");
  check(
    "after the first edit both items turn back, told right after that round's tool result",
    rounds[3]?.includes("［意］此轮之后转待复核：登录（标成立后又改了 api/user.js）、隐私（标成立后又改了 api/user.js）") &&
      !/相持/.test(rounds[3]),
    rounds[3]
  );
  check(
    "the third time round it is called a stalemate, naming the other item on the same file; the answer still runs to its end",
    /相持：登录 本答内第 3 回转待复核；同依托 api\/user\.js 的 隐私 被打回 3 回/.test(rounds[7] || "") && rounds.length === 8,
    rounds[7]
  );
  check(
    "the other conversation's intent is still there: one intent per folder",
    !!JSON.parse(readFileSync(`${dir}/.yan/意.json`, "utf8")).nodes["上线"],
    ""
  );
} finally {
  await close();
}
