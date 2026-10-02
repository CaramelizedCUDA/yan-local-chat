// 看台：言的页面直连浏览器调试口（这里借测试用的这个 Edge 充当模型所用的浏览器）——
// 调试口从服务的 --config 文件里读、找到浏览器挂出入口、标签照抄、画面送到、点按与打字（含输入法那一路）递进网页、
// 模型换页跟过去、网页的提示框画在画面上、前后按历史走、旁注开着时让位且停收画面、收起后入口回来、拖宽窄有界
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, DEBUG, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
// 浏览器的配置目录与收藏：配置里一个停用的「浏览器」服务只为带出 --user-data-dir（真的 playwright 这里不起）
const PROFILE = `${TMP}/stage-profile`;
const markPage = "data:text/html;charset=utf-8," + encodeURIComponent("<title>收藏页</title>");
mkdirSync(`${PROFILE}/Default`, { recursive: true });
writeFileSync(
  `${PROFILE}/Default/Bookmarks`,
  JSON.stringify({
    roots: {
      bookmark_bar: { children: [{ type: "folder", name: "学术", children: [{ type: "url", name: "测试收藏", url: markPage }] }] },
      other: { children: [] }
    }
  })
);
// 调试口写在 --config 那份文件里：先写一个没人听的口，开页时找不到浏览器；之后改成测试 Edge 的口再去找
const CONFIG = `${TMP}/stage.json`;
const writeConfig = port =>
  writeFileSync(CONFIG, JSON.stringify({ browser: { launchOptions: { args: [`--remote-debugging-port=${port}`] } } }));
writeConfig(1);
const mcpServers = { 浏览器: { command: "node", args: ["cli.js", "--config", CONFIG, "--user-data-dir", PROFILE], disabled: true } };
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, mcpServers: ${JSON.stringify(mcpServers)} }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0 }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);

// 「模型的页」：另开一个窗口（与言的页各在前台，都会重绘）。左上一块大按钮，右边一个输入框，标题随之变
const html = `<title>看台测试</title><body style="margin:0"><button style="position:fixed;left:0;top:0;width:50vw;height:50vh" onclick="document.title='点中了'">点我</button><input id="i" style="position:fixed;left:60vw;top:10vh;width:30vw;height:10vh" oninput="document.title='输入:'+this.value"></body>`;
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
const { targetId } = await browserSend("Target.createTarget", {
  url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
  newWindow: true
});
await sleep(800);

check("no pin before the browser is found", await evalJs(`document.querySelector("#stagePin").classList.contains("hidden")`));
writeConfig(new URL(DEBUG).port);
await evalJs(`__yanStage.locate().then(() => true)`);
await waitFor(`!document.querySelector("#stagePin").classList.contains("hidden")`, 8000);
check("pin appears once the browser is found", true);
check("tabs mirror the browser", await evalJs(`[...__yanStage.state.tabs.values()].some(t => t.title === "看台测试")`));

await evalJs(`document.querySelector("#stagePin").click(); true`);
await waitFor(`!document.querySelector("#stagePanel").classList.contains("hidden")`);
check("pin hides while the stage is open", await evalJs(`document.querySelector("#stagePin").classList.contains("hidden")`));
// 换到那一页：点它的签
await evalJs(`[...document.querySelectorAll("[data-stage-tab]")].find(t => t.textContent.includes("看台测试")).click(); true`);
await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)} && __yanStage.state.session !== ""`);
await waitFor(`document.querySelector("#stageFrame").naturalWidth > 0`, 8000);
check("frame arrives for the chosen tab", true);
check("chosen tab is marked", await evalJs(`document.querySelector(".stage-tab.on")?.textContent.includes("看台测试")`));
// 浏览器的窗口跟上看台的大小（有下限）：网页按原大显示。等它调完再量，不然点按的位置对不上
const want = await evalJs(
  `(r => ({ w: Math.max(960, Math.round(r.width - 24)), h: Math.max(600, Math.round(r.height - 24)) }))(document.querySelector("#stageView").getBoundingClientRect())`
);
await waitFor(
  `Math.abs(__yanStage.state.meta.width - ${want.w}) < 4 && Math.abs(__yanStage.state.meta.height - ${want.h}) < 4`,
  8000
).catch(() => {});
check(
  "the browser window follows the stage size",
  await evalJs(`Math.abs(__yanStage.state.meta.width - ${want.w}) < 4`),
  JSON.stringify({ want, meta: await evalJs(`__yanStage.state.meta`) })
);
await sleep(300);
const geometry = await evalJs(
  `(r => ({ x: r.left, y: r.top, w: r.width, h: r.height, ratio: r.width / r.height }))(document.querySelector("#stageFrame").getBoundingClientRect())`
);
const meta = await evalJs(`__yanStage.state.meta`);
check(
  "frame keeps the page's aspect ratio",
  Math.abs(geometry.ratio - meta.width / meta.height) < 0.02,
  JSON.stringify({ geometry, meta })
);

// 在看台画面上点：落在网页左上那块按钮上
const mouse = async (type, x, y) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const at = (fx, fy) => [geometry.x + geometry.w * fx, geometry.y + geometry.h * fy];
await mouse("mousePressed", ...at(0.2, 0.2));
await mouse("mouseReleased", ...at(0.2, 0.2));
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "点中了"`, 8000).catch(() => {});
check("a click on the stage reaches the page", await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "点中了"`));

// 点输入框，再打字：按键一路、输入法（不经按键的文字）一路
await mouse("mousePressed", ...at(0.75, 0.15));
await mouse("mouseReleased", ...at(0.75, 0.15));
await sleep(200);
check("typing focuses the hidden key catcher", await evalJs(`document.activeElement === document.querySelector("#stageKeys")`));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
await send("Input.insertText", { text: "你好" });
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "输入:a你好"`, 8000).catch(() => {});
check(
  "keys and IME text reach the page",
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "输入:a你好"`),
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title`)
);
check("keys typed into the stage stay out of 言's own inputs", await evalJs(`!document.querySelector("#welcomeInput").value`));
await shot("stage.png");

// 网页弹的提示框：画在画面上，作答递回网页
await evalJs(`document.querySelector("#stageKeys").blur(); true`);
check("back is greyed out with no history", await evalJs(`document.querySelector("[data-stage-nav=back]").disabled`));
const ask =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<title>问</title><script>setTimeout(() => (document.title = "答:" + prompt("名字", "言")), 50)</script>`);
await evalJs(`__yanStage.go(${JSON.stringify(ask)}); true`);
await waitFor(`!document.querySelector("#stageDialog").classList.contains("hidden")`, 8000).catch(() => {});
check(
  "a page's prompt shows on the stage",
  await evalJs(
    `(d => !d.classList.contains("hidden") && d.textContent.includes("名字") && d.querySelector("input")?.value === "言")(document.querySelector("#stageDialog"))`
  )
);
await shot("stage-dialog.png");
await evalJs(
  `document.querySelector("#stageDialog input").value = "游目"; document.querySelector("[data-stage-answer=yes]").click(); true`
);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "答:游目"`, 8000).catch(() => {});
check(
  "the answer reaches the page",
  await evalJs(
    `__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "答:游目" && document.querySelector("#stageDialog").classList.contains("hidden")`
  ),
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title`)
);
// 前后：有了历史，后退亮起；退回去之后前进亮起
await waitFor(`!document.querySelector("[data-stage-nav=back]").disabled`, 5000).catch(() => {});
check("back lights up once there is history", await evalJs(`!document.querySelector("[data-stage-nav=back]").disabled`));
await evalJs(`document.querySelector("[data-stage-nav=back]").click(); true`);
await waitFor(`!document.querySelector("[data-stage-nav=forward]").disabled`, 5000).catch(() => {});
check(
  "back walks the history and forward lights up",
  await evalJs(
    `!document.querySelector("[data-stage-nav=forward]").disabled && __yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title !== "答:游目"`
  )
);

// 指针跟着网页、网页要选文件、浏览器自己的快捷键
const upload =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<title>传</title><body style="margin:0"><a href="#a" style="position:fixed;left:0;top:0;width:40vw;height:40vh;display:block">链接</a><input type="file" style="position:fixed;left:50vw;top:50vh;width:40vw;height:40vh" onchange="document.title='传:'+this.files[0].name"></body>`
  );
await evalJs(`__yanStage.go(${JSON.stringify(upload)}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传"`, 8000).catch(() => {});
await sleep(400);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at(0.2, 0.2)[0], y: at(0.2, 0.2)[1] });
await waitFor(`document.querySelector("#stageFrame").style.cursor === "pointer"`, 3000).catch(() => {});
check("the pointer turns into a hand over a link", await evalJs(`document.querySelector("#stageFrame").style.cursor === "pointer"`));
await mouse("mousePressed", ...at(0.7, 0.7));
await mouse("mouseReleased", ...at(0.7, 0.7));
await waitFor(`__yanStage.state.dialog?.type === "file"`, 5000).catch(() => {});
check(
  "a file chooser shows as a card on the stage",
  await evalJs(`__yanStage.state.dialog?.type === "file" && document.querySelector("#stageDialog").textContent.includes("选文件")`)
);
await shot("stage-file.png");
await evalJs(
  `(node => { document.querySelector("[data-stage-answer=no]").click(); return __yanStage.sendFiles([new File(["hi"], "测.txt")], node).then(() => true); })(__yanStage.state.dialog.node)`
);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传:测.txt"`, 8000).catch(() => {});
check(
  "files picked in 言 reach the page's file input",
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传:测.txt"`),
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title`)
);
check("typing focus is on the page", await evalJs(`document.activeElement === document.querySelector("#stageKeys")`));
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "l", code: "KeyL", windowsVirtualKeyCode: 76, modifiers: 2 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "l", code: "KeyL", windowsVirtualKeyCode: 76, modifiers: 2 });
check("Ctrl+L goes to the address bar", await evalJs(`document.activeElement === document.querySelector("#stageUrl")`));
await evalJs(`document.querySelector("#stageUrl").blur(); true`);

// 圈点：开「圈」在画面上拖一圈，引文与带朱笔的图随即落进输入框；移除引文，画面上的圈随之清去
await evalJs(`document.querySelector("#stagePen").click(); true`);
check("the pen is on", await evalJs(`document.querySelector("#stagePen").getAttribute("aria-pressed") === "true"`));
// 链接的字在那一块的左上角：圈从左上缘起
const ring = [
  [0.004, 0.2],
  [0.2, 0.004],
  [0.37, 0.2],
  [0.2, 0.37],
  [0.005, 0.22]
];
await mouse("mousePressed", ...at(...ring[0]));
for (const p of ring.slice(1)) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at(...p)[0], y: at(...p)[1], button: "left", buttons: 1 });
  await sleep(30);
}
await mouse("mouseReleased", ...at(...ring.at(-1)));
await waitFor(`!document.querySelector("#welcomeQuote").classList.contains("hidden")`, 5000).catch(() => {});
check(
  "a circle on the stage drops a quote into the input box",
  await evalJs(`document.querySelector("#welcomeQuote .composer-quote-text").textContent.includes("圈「链接」")`),
  await evalJs(`document.querySelector("#welcomeQuote .composer-quote-text").textContent`)
);
await waitFor(`!!document.querySelector("#welcomeQuote .quote-shot img[src^='data:image']")`, 8000).catch(() => {});
check(
  "the picture with the circle rides inside the quote, not in the attachment list",
  await evalJs(
    `!!document.querySelector("#welcomeQuote .quote-shot img[src^='data:image']") && !document.querySelector("#welcomeAttachments .attachment-card")`
  )
);
check(
  "the page did not take the circling as a click",
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传:测.txt"`)
);
check("the circle stays on the stage", await evalJs(`document.querySelectorAll("#stageInk > path").length === 1`));
await shot("stage-ink.png");
await evalJs(`document.querySelector("#welcomeQuote [data-quote-close]").click(); true`);
check("removing the quote clears the circle", await evalJs(`document.querySelectorAll("#stageInk > path").length === 0`));
check(
  "removing the quote takes its picture along (no hidden attachment left behind)",
  await evalJs(`!document.querySelector("#welcomeQuote .quote-shot") && !(__yanState().drafts.__new__?.attachments || []).length`)
);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
check("Esc puts the pen down", await evalJs(`document.querySelector("#stagePen").getAttribute("aria-pressed") === "false"`));
await evalJs(`document.querySelector("#welcomeAttachments [data-remove-attachment]")?.click(); true`);

// 执事落笔：执事在调浏览器时网页里有了真按下，那一处一圈朱、贴「点击」
const { sessionId: modelSession } = await browserSend("Target.attachToTarget", { targetId, flatten: true });
const modelClick = (x, y) =>
  Promise.all(
    ["mousePressed", "mouseReleased"].map((type, i) =>
      browser.send(
        JSON.stringify({
          id: 9000 + i,
          sessionId: modelSession,
          method: "Input.dispatchMouseEvent",
          params: { type, x, y, button: "left", clickCount: 1 }
        })
      )
    )
  );
await evalJs(`__yanStage.state.busy = 1; true`);
await modelClick(40, 40);
await waitFor(`document.querySelector("#stageLabels").textContent.includes("点击")`, 5000).catch(() => {});
check(
  "where the model clicks gets a red ring and a slip",
  await evalJs(
    `document.querySelector("#stageLabels").textContent.includes("点击") && !!document.querySelector("#stageInk .stage-acts path")`
  )
);
await evalJs(`__yanStage.state.busy = 0; true`);
await sleep(300);
await evalJs(`__yanStage.state.userAt = Date.now(); true`);
await modelClick(40, 40);
await sleep(2200);
check("clicks while the model is idle leave no mark", await evalJs(`!document.querySelector("#stageLabels").textContent`));

// 收藏：读浏览器配置目录里的那份，按夹列出；点一条在当前页打开
check(
  "收藏 shows when the browser's profile is known",
  await evalJs(`!document.querySelector("#stageMarks").classList.contains("hidden")`)
);
await evalJs(`document.querySelector("#stageMarks").click(); true`);
await waitFor(`!!document.querySelector(".chip-pop.stage-marks [data-stage-mark]")`, 5000).catch(() => {});
check(
  "bookmarks list folders and entries",
  await evalJs(
    `(p => !!p && p.querySelector(".stage-mark-dir")?.textContent === "学术" && p.querySelector("[data-stage-mark]")?.textContent === "测试收藏")(document.querySelector(".chip-pop.stage-marks"))`
  )
);
await evalJs(`document.querySelector(".chip-pop.stage-marks [data-stage-mark]").click(); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "收藏页"`, 8000).catch(() => {});
check("a bookmark opens in the current tab", await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "收藏页"`));

// ＋：新开一页，看台跟过去，地址栏等着输网址
const before = await evalJs(`__yanStage.state.tabs.size`);
await evalJs(`document.querySelector("#stageNewTab").click(); true`);
await waitFor(`__yanStage.state.tabs.size === ${before + 1}`, 5000).catch(() => {});
const fresh = await evalJs(`__yanStage.state.current`);
check(
  "＋ opens a new tab and the stage follows it",
  (await evalJs(`__yanStage.state.tabs.size === ${before + 1} && __yanStage.state.current !== ${JSON.stringify(targetId)}`)) &&
    (await evalJs(`document.activeElement === document.querySelector("#stageUrl")`))
);
const clickTab = id =>
  evalJs(`[...document.querySelectorAll("[data-stage-tab]")].find(t => t.dataset.stageTab === ${JSON.stringify(id)})?.click(); true`);
// 模型换页：自己点回原来那页后，模型的调用（这里直接去找一回）不把人拽走；模型把那一页请到前台（选签即如此），看台跟过去
await clickTab(targetId);
await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)}`, 5000).catch(() => {});
await sleep(300);
await evalJs(`__yanStage.locate().then(() => true)`);
check("a call after the user picked a tab leaves the view alone", await evalJs(`__yanStage.state.current === ${JSON.stringify(targetId)}`));
await browserSend("Target.activateTarget", { targetId: fresh });
await sleep(300);
await evalJs(`__yanStage.locate().then(() => true)`);
check(
  "the stage follows the page the model brings to front",
  await evalJs(`__yanStage.state.current === ${JSON.stringify(fresh)}`),
  await evalJs(`__yanStage.state.current`)
);
await browserSend("Target.closeTarget", { targetId: fresh });
await clickTab(targetId);
await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)}`, 5000).catch(() => {});

// 阔：铺满；Esc（焦点不在看台里时）退回
await evalJs(`document.activeElement?.blur(); document.querySelector("#stageWide").click(); true`);
check("wide covers the page", await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).position === "fixed"`));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(150);
check("Esc leaves wide", await evalJs(`!document.querySelector("#stagePanel").classList.contains("wide")`));

// 模型定死了视口（browser_resize）：窗口管不着网页，看台变宽窄时别去调窗口——不然一回小一圈
const { sessionId: pinned } = await browserSend("Target.attachToTarget", { targetId, flatten: true });
await browserSend("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 0, mobile: false }, pinned);
const framed = (await browserSend("Browser.getWindowForTarget", { targetId })).bounds;
// 拖左缘：宽度有下限，也给对话留出地方
const grip = await evalJs(
  `(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(document.querySelector("#stageGrip").getBoundingClientRect())`
);
await mouse("mousePressed", grip.x, grip.y);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1370, y: grip.y, button: "left", buttons: 1 });
await mouse("mouseReleased", 1370, grip.y);
check("drag narrows to the floor", (await evalJs(`document.querySelector("#stagePanel").getBoundingClientRect().width`)) === 320);
check("width is remembered", (await evalJs(`localStorage.getItem("yan-stage-width")`)) === "320");
await sleep(800);
const later = (await browserSend("Browser.getWindowForTarget", { targetId })).bounds;
check(
  "a pinned viewport keeps the window as it is",
  later.width === framed.width && later.height === framed.height,
  JSON.stringify({ framed, later })
);
await browserSend("Emulation.clearDeviceMetricsOverride", {}, pinned);
await browserSend("Target.detachFromTarget", { sessionId: pinned });

// 旁注开着时看台让位（旁注是在右侧同一处）：让位时不收画面、入口回来；旁注收起，画面接上
await evalJs(`document.querySelector("#sidePanel").classList.remove("hidden"); true`);
check("side notes take the right side", await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).display === "none"`));
await waitFor(`__yanStage.state.session === ""`, 3000).catch(() => {});
check(
  "screencast pauses while pushed aside, and the entry comes back",
  await evalJs(`__yanStage.state.session === "" && !document.querySelector("#stagePin").classList.contains("hidden")`)
);
await evalJs(`document.querySelector("#sidePanel").classList.add("hidden"); true`);
check(
  "stage comes back after side notes close",
  await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).display !== "none"`)
);
await waitFor(`__yanStage.state.session !== ""`, 5000).catch(() => {});
check(
  "screencast resumes",
  await evalJs(`__yanStage.state.session !== "" && document.querySelector("#stagePin").classList.contains("hidden")`)
);

// 收起：小屏回来；那一页关了，签跟着没了
await evalJs(`document.querySelector("#stageClose").click(); true`);
await waitFor(`!document.querySelector("#stagePin").classList.contains("hidden")`);
check("closing the stage brings the pin back", true);
// 入口平时只是一笔朱竖，指针靠近才浮出「游目」两字
const nameShown = () => evalJs(`Number(getComputedStyle(document.querySelector(".stage-pin-text")).opacity)`);
check("only the stroke shows at rest", (await nameShown()) === 0);
const pin = await evalJs(
  `(r => ({ x: r.right - 6, y: r.top + r.height / 2 }))(document.querySelector("#stagePin").getBoundingClientRect())`
);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pin.x, y: pin.y });
await sleep(400);
check("the name shows when the pointer comes near", (await nameShown()) === 1);
await shot("stage-pin.png");
// 长对话里右缘铺着滚动条的命中层：入口的最右一列仍点得到，而不是被它吃掉
check(
  "the entry's right edge is not swallowed by the scrollbar's hit strip",
  await evalJs(
    `(() => { const g = document.querySelector("#chatScrollGrabber"), was = g.className; g.className = "chat-scroll-grabber active"; g.style.display = "block"; const r = document.querySelector("#stagePin").getBoundingClientRect(), hit = document.elementFromPoint(r.right - 2, r.top + r.height / 2); g.className = was; g.style.display = ""; return !!hit?.closest("#stagePin"); })()`
  )
);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 400 });
check("screencast stops when closed", await evalJs(`__yanStage.state.session === ""`));
await browserSend("Target.closeTarget", { targetId });
await waitFor(`!__yanStage.state.tabs.has(${JSON.stringify(targetId)})`);
check("closed page leaves the tabs", true);

browser.close();
close();
