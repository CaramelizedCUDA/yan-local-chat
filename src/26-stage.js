// 言 · 看台：模型所用的那个浏览器，画面固定在对话右侧——不再是屏幕上另开、挡人的一个窗口。
// 巧处：浏览器仍归 MCP（如 playwright）起、关与操作；看台只是另一个连上它调试口的看客——Page.startScreencast 收画面，Input.* 递点按。
// 页面直接连调试口（浏览器以 --remote-allow-origins 放行言的页面），画面不过桥接；桥接只替页面问出连接的地址（server/stage.js）。
// 标签照抄浏览器自己的（Target.setDiscoverTargets），不另分「成品」与「网页」：模型做的网页由它自己在浏览器里开，也就上了台。
// 何时去连：开页时，与每次浏览器类的 MCP 调用之后（浏览器多半是这时起的）；断了就等下一次，不轮询。
// 旁注与看台同在右侧：旁注开着时看台让位（纯 CSS，见 styles/56-stage.css），旁注收起它就回来。
// 网页的尺寸由浏览器那头定（playwright 默认 1280×720），看台只按宽高里较紧的一边缩放，拖宽拖窄不改比例，点按按同一倍数换算回去

const stage = {
  // 调试口：模型所用的浏览器以 --remote-debugging-port 起在这里（见 docs/stage.md）
  port: 9288,
  /** @type {WebSocket | null} */
  ws: null,
  /** @type {Promise<void> | null} */
  locating: null,
  seq: 0,
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
  pending: new Map(),
  /** @type {Map<string, { title: string, url: string }>} 浏览器里开着的页，按开的先后 */
  tabs: new Map(),
  // setDiscoverTargets 会把已开着的页逐个报来：那些不算「新开」，别跟过去
  listing: false,
  current: "",
  attached: "",
  session: "",
  framed: false,
  meta: { width: 1280, height: 720 },
  busy: 0,
  width: 0,
  poll: 0,
  click: { at: 0, x: 0, y: 0, count: 0 },
  /** @type {PointerEvent | null} */
  moved: null
};

// ---------- 连上浏览器 ----------
function stageLocate() {
  if (stage.ws || stage.locating) return stage.locating || Promise.resolve();
  stage.locating = bridge("/api/stage", { port: stage.port })
    .then(({ ws, front }) => (ws ? stageConnect(ws, front) : undefined))
    .catch(() => {})
    .finally(() => (stage.locating = null));
  return stage.locating;
}
/** @param {string} url @param {string} front */
function stageConnect(url, front) {
  return new Promise(resolve => {
    const ws = new WebSocket(url);
    stage.ws = ws;
    ws.onmessage = event => stageMessage(JSON.parse(event.data));
    // 浏览器关了（模型收工、playwright 闲置关掉）：看台清空，等下一次浏览器类的调用再来找
    ws.onclose = () => {
      if (stage.ws !== ws) return;
      stage.ws = null;
      stage.tabs.clear();
      stage.current = stage.attached = stage.session = "";
      stage.framed = false;
      for (const waiter of stage.pending.values()) waiter.reject(Error("看台已断开"));
      stage.pending.clear();
      $("#stageFrame").removeAttribute("src");
      stageSync();
      resolve();
    };
    ws.onopen = async () => {
      try {
        stage.listing = true;
        await stageSend("Target.setDiscoverTargets", { discover: true });
        stage.listing = false;
        stageShow(stage.tabs.has(front) ? front : [...stage.tabs.keys()].at(-1) || "");
        stageSync();
      } catch {
        ws.close();
      }
      resolve();
    };
  });
}
/** @param {string} method @param {Record<string, any>} [params] @param {string} [sessionId] */
function stageSend(method, params = {}, sessionId = "") {
  const ws = stage.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(Error("看台未连上"));
  const id = ++stage.seq;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => stage.pending.set(id, { resolve, reject }));
}
function stageMessage(message) {
  if (message.id) {
    const waiter = stage.pending.get(message.id);
    stage.pending.delete(message.id);
    if (waiter) message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result);
    return;
  }
  const params = message.params || {};
  if (message.method === "Target.targetCreated" || message.method === "Target.targetInfoChanged") {
    const info = params.targetInfo;
    if (info.type !== "page") return;
    const fresh = !stage.tabs.has(info.targetId);
    stage.tabs.set(info.targetId, { title: info.title, url: info.url });
    // 模型新开了一页：跟过去
    if (fresh && !stage.listing) stageShow(info.targetId);
    else stageRender();
  } else if (message.method === "Target.targetDestroyed") {
    stage.tabs.delete(params.targetId);
    if (params.targetId === stage.current) stageShow([...stage.tabs.keys()].at(-1) || "");
    else stageRender();
  } else if (message.method === "Target.detachedFromTarget") {
    if (params.sessionId === stage.session) stage.session = stage.attached = "";
  } else if (message.method === "Page.screencastFrame" && message.sessionId === stage.session) {
    stageFrame(params.data, params.metadata.deviceWidth, params.metadata.deviceHeight);
    void stageSend("Page.screencastFrameAck", { sessionId: params.sessionId }, message.sessionId).catch(() => {});
  }
}

// ---------- 看哪一页：连上它、收它的画面 ----------
/** @param {string} targetId */
function stageShow(targetId) {
  stage.current = targetId;
  stageRender();
  if (stageShown()) void stageAttach();
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
      stageFrame(shot.data, metrics.cssVisualViewport.clientWidth, metrics.cssVisualViewport.clientHeight);
  } catch {}
}
async function stageDetach() {
  const session = stage.session;
  stage.session = stage.attached = "";
  stage.framed = false;
  if (!session) return;
  await stageSend("Page.stopScreencast", {}, session).catch(() => {});
  void stageSend("Target.detachFromTarget", { sessionId: session }).catch(() => {});
}
/** @param {string} data @param {number} width @param {number} height */
function stageFrame(data, width, height) {
  if (width !== stage.meta.width || height !== stage.meta.height || !stage.framed) {
    stage.meta = { width, height };
    const view = $("#stageView");
    view.style.setProperty("--ar", String(width / height));
    view.style.setProperty("--fw", String(width));
  }
  stage.framed = true;
  $("#stageFrame").src = `data:image/jpeg;base64,${data}`;
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

// ---------- 开合与画面之外的几样 ----------
function stageShown() {
  const panel = $("#stagePanel");
  return !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
function openStage() {
  if (sidePanelOpen()) closeSidePanel();
  let saved = 0;
  try {
    saved = Number(localStorage.getItem("yan-stage-width")) || 0;
  } catch {}
  stageSetWidth(stage.width || saved || innerWidth * 0.46);
  showNow($("#stagePanel"));
  stageSync();
  void stageAttach();
  clearInterval(stage.poll);
  stage.poll = window.setInterval(stageRefreshTabs, 1500);
}
function closeStage() {
  stageSetWide(false);
  hideWithFade($("#stagePanel"));
  clearInterval(stage.poll);
  void stageDetach();
  stageSync();
}
/** @param {boolean} on */
function stageSetWide(on) {
  $("#stagePanel").classList.toggle("wide", on);
  $("#stageWide").setAttribute("aria-pressed", String(on));
}
/** @param {number} px */
function stageSetWidth(px) {
  stage.width = Math.round(Math.max(320, Math.min(px, innerWidth - 420)));
  $("#stagePanel").style.width = `${stage.width}px`;
}
// 顶栏那枚小屏：浏览器开着、看台收着时挂出来；模型正在操作浏览器时屏边一粒朱
function stageSync() {
  const pin = $("#stagePin");
  pin.classList.toggle("hidden", !stage.ws || stageShown());
  pin.classList.toggle("busy", stage.busy > 0);
  $("#stageBusy").classList.toggle("hidden", !stage.busy);
  stageRender();
}
/** @param {{ title: string, url: string }} tab */
function stageTitle(tab) {
  if (tab.url === "about:blank") return "空白页";
  if (tab.title && tab.title !== tab.url) return tab.title;
  try {
    return new URL(tab.url).host || tab.url;
  } catch {
    return tab.url || "新标签页";
  }
}
// 地址栏给人看：%E5… 解回汉字（解不开的原样）
/** @param {string} url */
function stageReadable(url) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
function stageRender() {
  if (!stageShown()) return;
  $("#stageTabs").innerHTML = [...stage.tabs]
    .map(
      ([id, tab]) =>
        `<div class="stage-tab${id === stage.current ? " on" : ""}" role="tab" aria-selected="${id === stage.current}" data-stage-tab="${escapeHtml(id)}" title="${escapeHtml(tab.title || tab.url)}"><span>${escapeHtml(stageTitle(tab))}</span><button type="button" class="stage-tab-x" data-stage-close="${escapeHtml(id)}" title="关闭此页" aria-label="关闭此页">×</button></div>`
    )
    .join("");
  const tab = stage.tabs.get(stage.current),
    url = /** @type {HTMLInputElement} */ ($("#stageUrl"));
  if (document.activeElement !== url) url.value = stageReadable(tab?.url || "");
  const empty = !stage.ws ? "浏览器未开" : !tab ? "没有开着的页" : "";
  $("#stageEmpty").textContent = empty;
  $("#stageEmpty").classList.toggle("hidden", !empty);
  $("#stageView").classList.toggle("empty", !!empty);
}
/**
 * 浏览器类的 MCP 调用（playwright 的 browser_*）进行时点一粒朱；调完去找一回浏览器——它多半是这一下起的
 * @param {string} tool
 */
function stageWatch(tool) {
  if (!/^browser_/.test(tool)) return () => {};
  stage.busy += 1;
  stageSync();
  return () => {
    stage.busy -= 1;
    stageSync();
    void stageLocate();
  };
}

// ---------- 递点按：看台上的坐标按缩放倍数换回网页里的 ----------
/** @param {MouseEvent} e */
function stagePoint(e) {
  const r = $("#stageFrame").getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * stage.meta.width, y: ((e.clientY - r.top) / r.height) * stage.meta.height };
}
/** @param {KeyboardEvent | MouseEvent} e */
const stageMods = e => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
const STAGE_BUTTONS = ["left", "middle", "right"];
/** @param {string} type @param {MouseEvent} e @param {Record<string, any>} [extra] */
function stageMouse(type, e, extra = {}) {
  if (!stage.session) return;
  void stageSend(
    "Input.dispatchMouseEvent",
    { type, ...stagePoint(e), modifiers: stageMods(e), buttons: e.buttons, ...extra },
    stage.session
  ).catch(() => {});
}
/** @param {string} type @param {KeyboardEvent} e @param {string} [text] */
function stageKey(type, e, text = "") {
  if (!stage.session) return;
  void stageSend(
    "Input.dispatchKeyEvent",
    {
      type,
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      nativeVirtualKeyCode: e.keyCode,
      modifiers: stageMods(e),
      autoRepeat: e.repeat,
      location: e.location,
      ...(text ? { text, unmodifiedText: text } : {})
    },
    stage.session
  ).catch(() => {});
}
// 打字经一个看不见的输入框：挪到点下的地方，输入法的候选框便浮在那一处；中文等输入法打完一整段再一次递进去
/** @param {MouseEvent} e */
function stageFocusKeys(e) {
  const keys = $("#stageKeys"),
    box = $("#stageView").getBoundingClientRect();
  keys.style.left = `${e.clientX - box.left}px`;
  keys.style.top = `${e.clientY - box.top}px`;
  keys.focus({ preventScroll: true });
}
/** @param {string} raw */
function stageGo(raw) {
  const text = raw.trim();
  if (!text || !stage.session) return;
  const url = /^[a-z]:[\\/]/i.test(text)
    ? `file:///${text.replace(/\\/g, "/")}`
    : /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(text)
      ? `http://${text}`
      : /^[a-z][\w+.-]*:/i.test(text)
        ? text
        : `https://${text}`;
  void stageSend("Page.navigate", { url }, stage.session).catch(error => toast(`打不开：${String(error.message || error).slice(0, 80)}`));
}

function bindStage() {
  $("#stagePin").addEventListener("click", openStage);
  $("#stageClose").addEventListener("click", closeStage);
  $("#stageWide").addEventListener("click", () => stageSetWide(!$("#stagePanel").classList.contains("wide")));
  $("#stageTabs").addEventListener("click", e => {
    const target = /** @type {HTMLElement} */ (e.target),
      close = /** @type {HTMLElement | null} */ (target.closest("[data-stage-close]"));
    if (close) return void stageSend("Target.closeTarget", { targetId: close.dataset.stageClose }).catch(() => {});
    const tab = /** @type {HTMLElement | null} */ (target.closest("[data-stage-tab]"));
    if (!tab || tab.dataset.stageTab === stage.current) return;
    // 换到后台的那一页：先请到前台，不然它不重绘、没有画面
    void stageSend("Target.activateTarget", { targetId: tab.dataset.stageTab }).catch(() => {});
    stageShow(tab.dataset.stageTab || "");
  });
  for (const button of document.querySelectorAll("[data-stage-nav]"))
    button.addEventListener("click", () => {
      const action = /** @type {HTMLElement} */ (button).dataset.stageNav;
      if (!stage.session) return;
      if (action === "reload") void stageSend("Page.reload", {}, stage.session).catch(() => {});
      else void stageSend("Runtime.evaluate", { expression: `history.${action}()` }, stage.session).catch(() => {});
    });
  const url = /** @type {HTMLInputElement} */ ($("#stageUrl"));
  url.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      stageGo(url.value);
      url.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      url.blur();
      stageRender();
    }
  });
  url.addEventListener("blur", () => stageRender());

  const frame = $("#stageFrame"),
    keys = /** @type {HTMLTextAreaElement} */ ($("#stageKeys"));
  frame.addEventListener("pointerdown", e => {
    e.preventDefault();
    frame.setPointerCapture(e.pointerId);
    stageFocusKeys(e);
    // 连点计数自己数：pointerdown 不带 detail
    const click = stage.click,
      again = e.timeStamp - click.at < 450 && Math.hypot(e.clientX - click.x, e.clientY - click.y) < 6;
    Object.assign(click, { at: e.timeStamp, x: e.clientX, y: e.clientY, count: again ? click.count + 1 : 1 });
    stageMouse("mousePressed", e, { button: STAGE_BUTTONS[e.button] || "left", clickCount: click.count });
  });
  frame.addEventListener("pointerup", e =>
    stageMouse("mouseReleased", e, { button: STAGE_BUTTONS[e.button] || "left", clickCount: stage.click.count })
  );
  // 移动一帧只递一次
  frame.addEventListener("pointermove", e => {
    if (!stage.moved)
      requestAnimationFrame(() => {
        const last = stage.moved;
        stage.moved = null;
        if (last) stageMouse("mouseMoved", last, { button: last.buttons & 1 ? "left" : last.buttons & 2 ? "right" : "none" });
      });
    stage.moved = e;
  });
  frame.addEventListener(
    "wheel",
    e => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      stageMouse("mouseWheel", e, { deltaX: e.deltaX * unit, deltaY: e.deltaY * unit });
    },
    { passive: false }
  );
  frame.addEventListener("contextmenu", e => e.preventDefault());
  // 键盘：拦下来整个递进网页（包括 Esc、Ctrl+C / V——剪贴板本是同一台机器的），不让言自己的快捷键接走
  keys.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const text = e.key === "Enter" ? "\r" : e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ? e.key : "";
    stageKey(text ? "keyDown" : "rawKeyDown", e, text);
  });
  keys.addEventListener("keyup", e => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    stageKey("keyUp", e);
  });
  keys.addEventListener("compositionend", e => {
    if (e.data && stage.session) void stageSend("Input.insertText", { text: e.data }, stage.session).catch(() => {});
    keys.value = "";
  });
  // 不经按键进来的字（表情面板、剪贴板历史）：照样递进去；输入法那一路在 compositionend 递，这里不重复
  keys.addEventListener("input", e => {
    const input = /** @type {InputEvent} */ (e);
    if (input.isComposing) return;
    if (input.inputType === "insertText" && input.data && stage.session)
      void stageSend("Input.insertText", { text: input.data }, stage.session).catch(() => {});
    keys.value = "";
  });
  keys.addEventListener("focus", () => $("#stageView").classList.add("typing"));
  keys.addEventListener("blur", () => $("#stageView").classList.remove("typing"));

  // 拖左缘调宽窄；记在本机（与侧栏开合一样不随备份走）
  const grip = $("#stageGrip");
  grip.addEventListener("pointerdown", e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add("stage-dragging");
  });
  grip.addEventListener("pointermove", e => {
    if (grip.hasPointerCapture(e.pointerId)) stageSetWidth($(".app").getBoundingClientRect().right - e.clientX);
  });
  grip.addEventListener("lostpointercapture", () => {
    document.body.classList.remove("stage-dragging");
    try {
      localStorage.setItem("yan-stage-width", String(stage.width));
    } catch {}
  });
}
bindStage();
// 给端到端测试：改调试口、立即去连（见 test/stage.mjs）
window.__yanStage = { state: stage, locate: stageLocate };
