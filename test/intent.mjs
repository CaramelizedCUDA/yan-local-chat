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
    saved.nodes["上线"]?.root?.ask === "INTENTA 立意" &&
      JSON.stringify(saved.nodes["甲"]?.anchors) === '["file:src/a.js","dir:src","cmd:node --version"]',
    JSON.stringify(saved)
  );
  check(
    "marking done seals a fingerprint for each anchor (file, folder, probe); the root stands once its premise does",
    saved.nodes["甲"]?.state === "done" &&
      /^[0-9a-f]{40}$/.test(saved.nodes["甲"]?.seal?.prints?.["file:src/a.js"] || "") &&
      /^[0-9a-f]{40}$/.test(saved.nodes["甲"]?.seal?.prints?.["dir:src"] || "") &&
      !!saved.nodes["甲"]?.seal?.prints?.["cmd:node --version"] &&
      /已立 1 \/ 2/.test(first),
    first
  );
  check("the model cannot reword the root", /是根，说法立后不由你改/.test(first) && saved.nodes["上线"].claim === "可在公网访问", first);
  const steps = await evalJs(
    `(__yanState().conversations.find(c => c.messages[0]?.content === "INTENTA 立意").messages.at(-1).steps || []).filter(s => s.name === "update_intent").map(s => s.title + "|" + s.status)`
  );
  check(
    "the trail keeps one line per change",
    steps.length === 3 && steps[0].startsWith("已立 0 / 2 · 上线、甲|done"),
    JSON.stringify(steps)
  );
  // 收尾前对照：这一答动过意，说完要收尾时拦一回——此刻的意（立住了的根也附原话）、无主改动、请它对照原话自判；只一回
  const gate = first.slice(first.indexOf("GATE|")),
    gates = await evalJs(
      `(__yanState().conversations.find(c => c.messages[0]?.content === "INTENTA 立意").messages.at(-1).steps || []).filter(s => s.name === "intent_gate").length`
    );
  check(
    "before finishing, the answer is stopped once with the intent, the root's own words and the unowned change",
    first.split("GATE|").length === 2 &&
      gates === 1 &&
      /^GATE\|［收尾前对照意］\n［意 \.yan\/意\.json］已立 1 \/ 2/.test(gate) &&
      /原问：INTENTA 立意/.test(gate) &&
      /本答改了、意里没有凭据罩着的：notes\.txt\n/.test(gate) &&
      /对照各根的原问，看这一答能否就此收尾/.test(gate),
    gate
  );

  // 意的卡片：改动条顶端置顶一行「意」，点开在预览浮层里画出卡片；点图上一项，图下展开；根的说法只在卡片里改
  const lastMessage = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`,
    bar = await evalJs(`${lastMessage}?.querySelector('.change-bar .change-intent')?.textContent || ""`);
  check("the change bar pins one line for the intent at its top", /^意已立 1 \/ 2 · 甲/.test(bar), bar);
  await evalJs(`${lastMessage}.querySelector('.change-intent').click(); true`);
  await waitFor(`!!document.querySelector('#fileViewerStage .intent-card .intent-svg')`, 10000);
  const card = await evalJs(
    `(c => ({ name: document.querySelector('#fileViewerName').textContent, root: c.querySelector('.intent-root-claim')?.textContent, updated: c.querySelector('.intent-updated')?.textContent, states: [...c.querySelectorAll('.intent-node')].map(g => g.dataset.intentNode + ':' + g.dataset.state).sort().join(',') }))(document.querySelector('#fileViewerStage .intent-card'))`
  );
  check(
    "the card draws the intent of this folder: when it was last updated, the root, each item in its state",
    card.name === "意 · intent-work" &&
      card.root === "可在公网访问" &&
      /^更新于 \d\d-\d\d \d\d:\d\d$/.test(card.updated || "") &&
      card.states === "上线:open,甲:holds",
    JSON.stringify(card)
  );
  await send("Page.captureScreenshot", { format: "png" }).then(shot =>
    writeFileSync(`${TMP}/intent-card.png`, Buffer.from(shot.data, "base64"))
  );
  await evalJs(
    `document.querySelector('#fileViewerStage g[data-intent-node="甲"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`
  );
  const detail = await evalJs(`document.querySelector('#fileViewerStage .intent-detail')?.textContent || ""`);
  check(
    "clicking an item opens its check and anchors under the graph",
    /a\.js 写好/.test(detail) && /文件src\/a\.js/.test(detail) && /目录src\//.test(detail) && /探针node --version/.test(detail),
    detail
  );
  await evalJs(`document.querySelector('#fileViewerStage [data-intent-edit="上线"]').click(); true`);
  await evalJs(
    `(t => { t.value = '可在公网与内网访问'; document.querySelector('#fileViewerStage [data-intent-save]').click(); return true; })(document.querySelector('#fileViewerStage .intent-root-draft'))`
  );
  await waitFor(`document.querySelector('#fileViewerStage .intent-root-claim')?.textContent === '可在公网与内网访问'`, 10000);
  const revised = JSON.parse(readFileSync(`${dir}/.yan/意.json`, "utf8"));
  check(
    "the user rewords the root on the card: written back through the bridge, its version goes up and the log says so",
    revised.nodes["上线"].claim === "可在公网与内网访问" &&
      revised.nodes["上线"].rev === 2 &&
      /^用户改意 上线：/.test(revised.log.at(-1).text),
    JSON.stringify(revised.nodes["上线"])
  );
  await evalJs(`document.querySelector('#fileViewerClose').click(); true`);
  await evalJs(`${lastMessage}.querySelector('[data-tool="update_intent"] [data-intent-open]').click(); true`);
  await waitFor(`document.querySelector('#fileViewerStage .intent-root-claim')?.textContent === '可在公网与内网访问'`, 10000);
  check("the intent step in the trail opens the same card", true);
  await evalJs(`document.querySelector('#fileViewerClose').click(); true`);

  // 在言之外改了那个文件：下一问开工时重取指纹，附着的意里它转待复核，并写明缘由
  writeFileSync(`${dir}/src/a.js`, "v2");
  await evalJs(
    `document.querySelector("#chatInput").value = "INTENTB 再看"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
  );
  await waitFor(`${reply(1)}.startsWith("INTENTB|")`, 30000);
  const second = await evalJs(reply(1));
  check(
    "next question carries the intent after the question, with the changed file turning the premise back to be rechecked",
    /INTENTB 再看[\s\S]*［意 \.yan\/意\.json］已立 0 \/ 2/.test(second) &&
      /\[待复核\] 甲：a\.js 写好[\s\S]*缘由：凭据已变：src\/a\.js、src\/$/m.test(second) &&
      /原问：INTENTA 立意/.test(second),
    second
  );
  check("an answer that neither touched the intent nor changed its anchors is not stopped", !second.includes("GATE|"), second);

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
  const thirdText = await evalJs(third),
    rounds = thirdText.slice("INTENTC|".length, thirdText.indexOf("GATE|")).trim().split(" ▸ ");
  check(
    "the stop before finishing also says which items turned back during this answer, and how often",
    /本答内转待复核过：登录 3 回、隐私 3 回/.test(thirdText.slice(thirdText.indexOf("GATE|"))),
    thirdText.slice(thirdText.indexOf("GATE|"))
  );
  check(
    "after the first edit both items turn back, told right after that round's tool result",
    rounds[3]?.includes("［意］此轮之后转待复核：登录（凭据已变：api/user.js）、隐私（凭据已变：api/user.js）") && !/相持/.test(rounds[3]),
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

  // 一份齐全的意（设计稿/55 的博客例子）：凭据变了的转待复核、牵连上面的成「前提未立」、借来的是假定、择一的结、弃了的岔路，卡片都画得出
  const seal = (premises, prints = {}) => ({ rev: 1, premises, prints });
  writeFileSync(
    `${dir}/.yan/意.json`,
    JSON.stringify({
      nodes: {
        上线: {
          claim: "blog.example.com 能打开，首页与文章页正常",
          check: "外网打开首页与任一篇文章",
          needs: ["部署", "HTTPS", "首页", "文章页"],
          anchors: [],
          state: "open",
          rev: 1,
          root: { ask: "帮我把这个博客搭起来，部署到我那台服务器上，用 blog.example.com 能打开就行", at: "2026-10-11T14:00:00Z" }
        },
        部署: {
          claim: "服务在服务器上常驻运行",
          check: "systemctl 显示 active",
          needs: ["构建"],
          anchors: ["cmd:ssh blog systemctl is-active blog"],
          state: "done",
          rev: 1,
          seal: seal({ 构建: 1 })
        },
        HTTPS: {
          claim: "证书有效，http 跳到 https",
          check: "curl -I 看 301 与证书期限",
          needs: ["域名"],
          anchors: [],
          state: "open",
          rev: 1
        },
        域名: {
          claim: "域名解析到服务器",
          check: "nslookup 得到服务器 IP",
          needs: [],
          anchors: ["cmd:nslookup blog.example.com"],
          state: "assumed",
          note: "用户说已在 DNS 面板配好",
          rev: 1,
          seal: seal({})
        },
        首页: {
          claim: "首页列出最新十篇",
          check: "放十二篇，只列十篇",
          needs: ["构建"],
          anchors: ["src/pages/index.astro"],
          state: "doing",
          rev: 2
        },
        文章页: {
          claim: "文章页渲染 Markdown 与代码",
          check: "一篇含表格、代码、图的文章",
          needs: ["构建", "高亮"],
          anchors: [],
          state: "done",
          rev: 1,
          seal: seal({ 构建: 1, 高亮: 1 })
        },
        构建: {
          claim: "站点能从源码构建出来",
          check: "npm run build 无错",
          needs: [],
          anchors: ["dir:src", "package.json"],
          state: "done",
          rev: 1,
          seal: seal({}, { "dir:src": "old", "file:package.json": "old" })
        },
        高亮: {
          claim: "代码块有高亮",
          check: "五种语言各一段",
          needs: ["Shiki", "自写"],
          any: true,
          anchors: [],
          state: "done",
          rev: 1,
          seal: seal({ Shiki: 1 })
        },
        Shiki: { claim: "沿用 Shiki 的配色", check: "同上", needs: [], anchors: [], state: "done", rev: 1, seal: seal({}) },
        自写: { claim: "自写一套配色", check: "同上", needs: [], anchors: [], state: "dropped", rev: 1 }
      },
      updated: "2026-10-11T16:41:00Z",
      log: [
        { at: "2026-10-11T14:02:00Z", conversation: "", text: "假定 域名：用户说已在 DNS 面板配好" },
        { at: "2026-10-11T15:20:00Z", conversation: "", text: "弃 自写" },
        { at: "2026-10-11T16:41:00Z", conversation: "", text: "改意 首页：首页列出最新十篇" }
      ]
    })
  );
  await evalJs(`${lastMessage}.querySelector('.change-intent').click(); true`);
  await waitFor(
    `!!document.querySelector('#fileViewerStage .intent-card .intent-svg') && document.querySelectorAll('#fileViewerStage .intent-node').length > 4`,
    10000
  );
  const rich = await evalJs(
    `(c => ({ states: Object.fromEntries([...c.querySelectorAll('.intent-node')].map(g => [g.dataset.intentNode, g.dataset.state])), more: c.querySelector('.intent-node[data-intent-node="高亮"] .intent-more')?.textContent, notes: c.querySelector('.intent-notes')?.textContent || "", meta: c.querySelector('.intent-meta')?.textContent }))(document.querySelector('#fileViewerStage .intent-card'))`
  );
  check(
    "a full intent: changed anchors make it stale and the items above it wait on their premise; the assumption is drawn as borrowed; a settled premise under a settled item folds into it as +1",
    rich.states["构建"] === "stale" &&
      rich.states["部署"] === "premised" &&
      rich.states["文章页"] === "premised" &&
      rich.states["域名"] === "assumed" &&
      rich.states["首页"] === "doing" &&
      rich.more === "+1" &&
      /构建凭据已变：src\/、package\.json/.test(rich.notes) &&
      /域名出处：用户说已在 DNS 面板配好/.test(rich.notes) &&
      rich.meta === "已立 3 / 9假定 1",
    JSON.stringify(rich)
  );
  // 截两张给人看：浅色与深色
  await evalJs(
    `document.querySelector('#fileViewerStage g[data-intent-node="构建"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`
  );
  await send("Page.captureScreenshot", { format: "png" }).then(shot =>
    writeFileSync(`${TMP}/intent-card-light.png`, Buffer.from(shot.data, "base64"))
  );
  await evalJs(`document.documentElement.dataset.theme = "dark"; true`);
  await sleep(200);
  await send("Page.captureScreenshot", { format: "png" }).then(shot =>
    writeFileSync(`${TMP}/intent-card-dark.png`, Buffer.from(shot.data, "base64"))
  );
  await evalJs(`document.documentElement.dataset.theme = "light"; document.querySelector('#fileViewerClose').click(); true`);

  // 把真实响应暂扣：先打开的一张迟到，或保存途中另开了一张，旧结果都不能改眼前的卡片。
  const delayIntent = async write =>
    evalJs(`(() => {
    const original = Response.prototype.json;
    let release, held = false;
    const gate = new Promise(resolve => release = resolve);
    window.__intentDelay = { original, release, ready: false };
    // 桥接可以直接 fetch，也可以把回包从总线交回；在读 JSON 这一步暂扣，两种都盖住。
    Response.prototype.json = async function () {
      const data = await original.call(this);
      if (!held && typeof data?.version === "string" && data.data?.nodes &&
          (!${write} || data.data.nodes["上线"]?.claim === "保存后的旧根")) {
        held = true;
        window.__intentDelay.ready = true;
        await gate;
      }
      return data;
    };
    return true;
  })()`);
  const releaseIntent = () => evalJs(`Response.prototype.json = window.__intentDelay.original; window.__intentDelay.release(); true`);
  const openCard = () => evalJs(`${lastMessage}.querySelector('.change-intent').click(); true`);
  const setClaim = claim => {
    const data = JSON.parse(readFileSync(`${dir}/.yan/意.json`, "utf8"));
    data.nodes["上线"].claim = claim;
    writeFileSync(`${dir}/.yan/意.json`, JSON.stringify(data));
  };
  const rootSays = text =>
    `document.querySelector('#fileViewerStage .intent-root[data-root="上线"] .intent-root-claim')?.textContent === ${JSON.stringify(text)}`;
  await delayIntent(false);
  await openCard();
  await waitFor(`window.__intentDelay.ready`);
  await evalJs(`document.querySelector('#fileViewerClose').click(); true`);
  setClaim("第二张卡片的根");
  await openCard();
  await waitFor(rootSays("第二张卡片的根"));
  await releaseIntent();
  await sleep(250);
  check("an older card's late response does not replace the newly opened card", await evalJs(rootSays("第二张卡片的根")));

  await delayIntent(true);
  await evalJs(`document.querySelector('[data-intent-edit="上线"]').click(); true`);
  await evalJs(
    `document.querySelector('.intent-root-draft').value = "保存后的旧根"; document.querySelector('[data-intent-save="上线"]').click(); true`
  );
  await waitFor(`window.__intentDelay.ready`);
  check(
    "the delayed save has actually reached the original folder",
    JSON.parse(readFileSync(`${dir}/.yan/意.json`, "utf8")).nodes["上线"].claim === "保存后的旧根"
  );
  await evalJs(`document.querySelector('#fileViewerClose').click(); true`);
  setClaim("保存途中新开的卡片");
  await openCard();
  await waitFor(rootSays("保存途中新开的卡片"));
  await releaseIntent();
  await sleep(250);
  check("a save finishing after another card opens leaves that card intact", await evalJs(rootSays("保存途中新开的卡片")));
  await evalJs(`document.querySelector('#fileViewerClose').click(); true`);
  writeFileSync(`${dir}/.yan/意.json`, '{"nodes":null,"log":[null]}');
  await openCard();
  await waitFor(`document.querySelector('#fileViewerStage .file-viewer-empty')?.textContent === "此目录尚未立意"`);
  check("a malformed empty intent still opens as an empty card", true);
} finally {
  await evalJs(
    `if (window.__intentDelay) { Response.prototype.json = window.__intentDelay.original; window.__intentDelay.release(); } true`
  ).catch(() => {});
  await close();
}
