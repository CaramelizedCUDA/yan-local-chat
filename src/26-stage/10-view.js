// 言 · 游目 · 画面：看哪一页，连上它、按大小收它的画面
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 看哪一页：连上它、收它的画面 ----------
/** @param {string} targetId */
function stageShow(targetId) {
  stage.current = targetId;
  stageRender();
  if (stageVisible()) void stageAttach();
}
async function stageAttach() {
  const target = stage.current;
  if (!stage.ws || !target || stage.attached === target) return;
  await stageDetach();
  stage.attached = target;
  try {
    const { sessionId } = await stageSend("Target.attachToTarget", { targetId: target, flatten: true });
    if (stage.attached !== target) return void stageSend("Target.detachFromTarget", { sessionId }).catch(() => {});
    stage.session = sessionId;
    // 浏览器的窗口在屏幕外、不在焦点上：不模拟焦点，递进去的按键没人接（playwright 自己也这么做）
    void stageSend("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
    // 收 Page 域的事件：载入、跳转、提示框（开着的提示框，enable 时会补报一回）
    await stageSend("Page.enable", {}, sessionId);
    // 网页要人选文件：不让浏览器在屏幕外开窗，报给看台
    void stageSend("Page.setInterceptFileChooserDialog", { enabled: true }, sessionId).catch(() => {});
    // 执事在网页上哪儿下手：网页里放一个只给看台听的耳目
    void stageInkAttach(sessionId, target);
    void stageReadHistory();
    await stageSend("Page.startScreencast", { format: "jpeg", quality: 80 }, sessionId);
    // 静着的页不重绘就不出帧：先截一张垫底（后台的页截不出来，等不到就算了）
    const [shot, metrics] = await Promise.race([
      Promise.all([
        stageSend("Page.captureScreenshot", { format: "jpeg", quality: 80 }, sessionId),
        stageSend("Page.getLayoutMetrics", {}, sessionId)
      ]),
      new Promise((_, reject) => setTimeout(() => reject(Error("timeout")), 2000))
    ]);
    if (stage.session === sessionId && !stage.framed)
      void stageFrame(shot.data, metrics.cssVisualViewport.clientWidth, metrics.cssVisualViewport.clientHeight);
  } catch {}
  void stageFit();
}
// 屏幕外那扇窗调成看台的大小：窗比网页多出的边（标签栏、地址栏、边框）照现量补上。窗口的尺寸与网页的 CSS 像素同一单位。
// 缩放即调窗：放大一档，窗按倍数收窄，网页照自己的断点重排、字在游目里大一档（浏览器自己的缩放经调试口调不动）
const STAGE_FLOOR = { width: 960, height: 600 };
async function stageFit() {
  const session = stage.session,
    target = stage.attached;
  if (!session || !stageVisible()) return;
  const view = $("#stageView").getBoundingClientRect(),
    want = {
      width: Math.round(Math.max(STAGE_FLOOR.width, view.width - 24) / stage.zoom),
      height: Math.round(Math.max(STAGE_FLOOR.height, view.height - 24) / stage.zoom)
    };
  try {
    const [{ windowId, bounds }, { cssVisualViewport: port }] = await Promise.all([
      stageSend("Browser.getWindowForTarget", { targetId: target }),
      stageSend("Page.getLayoutMetrics", {}, session)
    ]);
    const edgeX = bounds.width - port.clientWidth,
      edgeY = bounds.height - port.clientHeight;
    // 网页的视口被定死了（执事 setViewportSize / browser_resize 过）：窗口管不着它，多出的边不是边，再照着调只会一回小一圈。
    // 记下定死的大小：留白处写一行，开着「适应页面」的等执事歇手后放开
    const pinned = edgeX < 0 || edgeY < 0 || edgeX > 120 || edgeY > 320;
    stagePin(pinned ? { width: Math.round(port.clientWidth), height: Math.round(port.clientHeight) } : null);
    if (pinned) return;
    const width = Math.round(edgeX + want.width),
      height = Math.round(edgeY + want.height);
    if (bounds.windowState !== "normal" || (Math.abs(width - bounds.width) < 2 && Math.abs(height - bounds.height) < 2)) return;
    await stageSend("Browser.setWindowBounds", { windowId, bounds: { width, height } });
  } catch {}
}
/** @param {{ width: number, height: number } | null} size */
function stagePin(size) {
  if (JSON.stringify(size) === JSON.stringify(stage.pinned)) return;
  stage.pinned = size;
  stageRenderLetter();
  stageMaybeRelease();
}
// 留白处的一行：视口被定死、画面因此留白时写明是谁定的、多大；开着「适应页面」的补一句何时铺满
function stageRenderLetter() {
  const letter = $("#stageLetter"),
    size = stage.pinned;
  letter.classList.toggle("hidden", !size);
  if (size)
    letter.innerHTML = `执事把视口定在 <b>${size.width}×${size.height}</b>${stageFitOn() ? "，它歇手后铺满" : `<button type="button" data-stage-release>放开</button>`}`;
}
// 放开定死的视口：执事那头（Playwright）记着那个尺寸，换页也会再钉回去，游目这头清不掉——只有新开一页最干净。
// 经那个 MCP 服务的 browser_tabs 办：同一网址新开一页、关掉旧的，执事那边的标签账也对得上（它下回调用时看得到）。
// 「适应页面」开着：执事歇手（没有在途的浏览器调用、也没有在答的对话）才放；关着：只在人点「放开」时放
/** @param {boolean} [now] 人点了「放开」 */
async function stageRelease(now = false) {
  const server = stageServer(),
    tab = stage.tabs.get(stage.current),
    url = tab?.url || "";
  if (!server || !stage.pinned || !url || /^(about|data|devtools|edge|chrome):/.test(url)) return;
  if (!now && stage.released.url === url && Date.now() - stage.released.at < 60000) return;
  stage.released = { url, at: Date.now() };
  const config = mcpConfigs()[server],
    call = (/** @type {Record<string, any>} */ args) =>
      bridge("/api/mcp/call", { server, config, tool: "browser_tabs", arguments: args, timeout: 30 });
  try {
    // 执事那边的第几页：照它报的「- 2: (current) [题](网址)」认
    const listed = await call({ action: "list" }),
      lines = String((listed.result?.content || []).map((/** @type {any} */ item) => item.text || "").join("\n")).split("\n"),
      rows = lines.map(line => line.match(/^- (\d+): (\(current\) )?\[.*\]\((.*)\)\s*$/)).filter(Boolean),
      old = rows.find(row => row?.[3] === url && row[2]) || rows.find(row => row?.[3] === url);
    if (!old) return;
    await call({ action: "new", url });
    await call({ action: "close", index: Number(old[1]) });
  } catch (error) {
    if (now) toast(`未能放开：${String(/** @type {any} */ (error).message || error).slice(0, 80)}`);
  }
}
// 执事歇手了吗：没有在途的浏览器调用、没有在答的对话与差遣
function stageIdle() {
  return !stage.busy && !requestJobs.size && !crews.size;
}
function stageMaybeRelease() {
  if (stageFitOn() && stage.pinned && stageIdle() && stageVisible()) void stageRelease();
}
// 适应页面（纸签里的开关，默认开，记在配置里）
const stageFitOn = () => store.settings.stageFit !== false;
/** @param {boolean} on */
function stageSetFit(on) {
  store.settings.stageFit = on;
  saveStore();
  stageRenderLetter();
  stageMaybeRelease();
}
/** @param {number} zoom */
function stageSetZoom(zoom) {
  stage.zoom = Math.round(Math.max(0.5, Math.min(2, zoom)) * 100) / 100;
  try {
    localStorage.setItem("yan-stage-zoom", String(stage.zoom));
  } catch {}
  const pct = document.querySelector(".stage-zoom-pct");
  if (pct) pct.textContent = `${Math.round(stage.zoom * 100)}%`;
  stageFrameSize();
  void stageFit();
}
const STAGE_ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** @param {number} step 1 放大一档，-1 缩小一档，0 复原 */
function stageZoomStep(step) {
  if (!step) return stageSetZoom(1);
  const at = STAGE_ZOOMS.findIndex(z => z >= stage.zoom - 0.001);
  stageSetZoom(STAGE_ZOOMS[Math.max(0, Math.min(STAGE_ZOOMS.length - 1, (at < 0 ? STAGE_ZOOMS.length - 1 : at) + step))]);
}
async function stageDetach() {
  const session = stage.session;
  stage.session = stage.attached = "";
  stage.framed = false;
  stageResetPage();
  if (!session) return;
  await stageSend("Page.stopScreencast", {}, session).catch(() => {});
  void stageSend("Target.detachFromTarget", { sessionId: session }).catch(() => {});
}
/** @param {string} data @param {number} width @param {number} height @returns {Promise<void>} */
function stageFrame(data, width, height) {
  if (width !== stage.meta.width || height !== stage.meta.height || !stage.framed) {
    stage.meta = { width, height };
    stageFrameSize();
  }
  stage.framed = true;
  const img = /** @type {HTMLImageElement} */ ($("#stageFrame"));
  img.src = `data:image/jpeg;base64,${data}`;
  // 解码中途换了下一帧会报错，不碍事
  return img.decode().catch(() => {});
}

// 画面的比例与最大宽：不放大过原尺寸，缩放过的按倍数放大
function stageFrameSize() {
  const view = $("#stageView"),
    { width, height } = stage.meta;
  view.style.setProperty("--ar", String(width / height));
  view.style.setProperty("--fw", String(Math.round(width * stage.zoom)));
}

// 网页改了标题，浏览器不发通知（开页、关页、跳转才发）：看台开着时隔一会儿问一次，变了才重画
async function stageRefreshTabs() {
  const result = await stageSend("Target.getTargets").catch(() => null);
  let changed = false;
  for (const info of result?.targetInfos || []) {
    const tab = stage.tabs.get(info.targetId);
    if (!stageTabType(info) || !tab || (tab.title === info.title && tab.url === info.url)) continue;
    if (stageNotTab(info)) {
      stageDropTab(info.targetId);
      continue;
    }
    Object.assign(tab, { title: info.title, url: info.url });
    changed = true;
  }
  if (changed) stageRender();
}
