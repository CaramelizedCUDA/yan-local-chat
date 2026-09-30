// 看台：言的页面直连浏览器调试口（这里借测试用的这个 Edge 充当模型所用的浏览器）——
// 找到浏览器挂出顶栏小屏、标签照抄、画面送到、点按与打字（含输入法那一路）递进网页、旁注开着时让位、收起后小屏回来、拖宽窄有界
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
const mcpServers = { 浏览器: { command: "node", args: ["cli.js", "--user-data-dir", PROFILE], disabled: true } };
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
const browserSend = (method, params = {}) =>
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
    browser.send(JSON.stringify({ id, method, params }));
  });
const { targetId } = await browserSend("Target.createTarget", {
  url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
  newWindow: true
});
await sleep(800);

check("no pin before the browser is found", await evalJs(`document.querySelector("#stagePin").classList.contains("hidden")`));
await evalJs(`__yanStage.state.port = ${new URL(DEBUG).port}; __yanStage.locate().then(() => true)`);
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

// 收藏：读浏览器配置目录里的那份，按夹列出；点一条在当前页打开
await evalJs(`document.querySelector("#stageKeys").blur(); true`);
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
await browserSend("Target.closeTarget", { targetId: fresh });
await evalJs(
  `[...document.querySelectorAll("[data-stage-tab]")].find(t => t.dataset.stageTab === ${JSON.stringify(targetId)})?.click(); true`
);
await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)}`, 5000).catch(() => {});

// 阔：铺满；Esc（焦点不在看台里时）退回
await evalJs(`document.activeElement?.blur(); document.querySelector("#stageWide").click(); true`);
check("wide covers the page", await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).position === "fixed"`));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(150);
check("Esc leaves wide", await evalJs(`!document.querySelector("#stagePanel").classList.contains("wide")`));

// 拖左缘：宽度有下限，也给对话留出地方
const grip = await evalJs(
  `(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(document.querySelector("#stageGrip").getBoundingClientRect())`
);
await mouse("mousePressed", grip.x, grip.y);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1370, y: grip.y, button: "left", buttons: 1 });
await mouse("mouseReleased", 1370, grip.y);
check("drag narrows to the floor", (await evalJs(`document.querySelector("#stagePanel").getBoundingClientRect().width`)) === 320);
check("width is remembered", (await evalJs(`localStorage.getItem("yan-stage-width")`)) === "320");

// 旁注开着时看台让位（旁注是在右侧同一处）
await evalJs(`document.querySelector("#sidePanel").classList.remove("hidden"); true`);
check("side notes take the right side", await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).display === "none"`));
await evalJs(`document.querySelector("#sidePanel").classList.add("hidden"); true`);
check(
  "stage comes back after side notes close",
  await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).display !== "none"`)
);

// 收起：小屏回来；那一页关了，签跟着没了
await evalJs(`document.querySelector("#stageClose").click(); true`);
await waitFor(`!document.querySelector("#stagePin").classList.contains("hidden")`);
check("closing the stage brings the pin back", true);
check("screencast stops when closed", await evalJs(`__yanStage.state.session === ""`));
await browserSend("Target.closeTarget", { targetId });
await waitFor(`!__yanStage.state.tabs.has(${JSON.stringify(targetId)})`);
check("closed page leaves the tabs", true);

browser.close();
close();
