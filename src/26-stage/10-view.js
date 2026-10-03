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
// 屏幕外那扇窗调成看台的大小：窗比网页多出的边（标签栏、地址栏、边框）照现量补上。窗口的尺寸与网页的 CSS 像素同一单位
const STAGE_FLOOR = { width: 960, height: 600 };
async function stageFit() {
  const session = stage.session,
    target = stage.attached;
  if (!session || !stageVisible()) return;
  const view = $("#stageView").getBoundingClientRect(),
    want = {
      width: Math.max(STAGE_FLOOR.width, Math.round(view.width - 24)),
      height: Math.max(STAGE_FLOOR.height, Math.round(view.height - 24))
    };
  try {
    const [{ windowId, bounds }, { cssVisualViewport: port }] = await Promise.all([
      stageSend("Browser.getWindowForTarget", { targetId: target }),
      stageSend("Page.getLayoutMetrics", {}, session)
    ]);
    const edgeX = bounds.width - port.clientWidth,
      edgeY = bounds.height - port.clientHeight;
    // 网页的视口被定死了（模型调过 browser_resize）：窗口管不着它，多出的边不是边，再照着调只会一回小一圈
    if (edgeX < 0 || edgeY < 0 || edgeX > 120 || edgeY > 320) return;
    const width = Math.round(edgeX + want.width),
      height = Math.round(edgeY + want.height);
    if (bounds.windowState !== "normal" || (Math.abs(width - bounds.width) < 2 && Math.abs(height - bounds.height) < 2)) return;
    await stageSend("Browser.setWindowBounds", { windowId, bounds: { width, height } });
  } catch {}
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
    const view = $("#stageView");
    view.style.setProperty("--ar", String(width / height));
    view.style.setProperty("--fw", String(width));
  }
  stage.framed = true;
  const img = /** @type {HTMLImageElement} */ ($("#stageFrame"));
  img.src = `data:image/jpeg;base64,${data}`;
  // 解码中途换了下一帧会报错，不碍事
  return img.decode().catch(() => {});
}

// 网页改了标题，浏览器不发通知（开页、关页、跳转才发）：看台开着时隔一会儿问一次，变了才重画
async function stageRefreshTabs() {
  const result = await stageSend("Target.getTargets").catch(() => null);
  let changed = false;
  for (const info of result?.targetInfos || []) {
    const tab = stage.tabs.get(info.targetId);
    if (info.type !== "page" || !tab || (tab.title === info.title && tab.url === info.url)) continue;
    Object.assign(tab, { title: info.title, url: info.url });
    changed = true;
  }
  if (changed) stageRender();
}
