// 言 · 游目（代码里叫看台 stage）：模型所用的那个浏览器，画面固定在对话右侧——不再是屏幕上另开、挡人的一个窗口。
// 巧处：浏览器仍归 MCP（如 playwright）起、关与操作；看台只是另一个连上它调试口的看客——Page.startScreencast 收画面，Input.* 递点按。
// 页面直接连调试口（浏览器以 --remote-allow-origins 放行言的页面），画面不过桥接；桥接只替页面问出连接的地址（server/stage.js）。
// 标签照抄浏览器自己的（Target.setDiscoverTargets），不另分「成品」与「网页」：模型做的网页由它自己在浏览器里开，也就上了台。
// 何时去连：开页时、打开看台时，与每次浏览器类的 MCP 调用之后（浏览器多半是这时起的）；断了就等下一次，不轮询。
// 调试口与配置目录不另设，桥接从那个 MCP 服务的参数（及它 --config 的那份文件）里读出来。
// 浏览器没开、或被关掉了：看台里点「打开浏览器」，言替你调一次那个 MCP 的 browser_navigate，浏览器照它的配置起来——言自己不起浏览器。
// 旁注与看台同在右侧：旁注开着时看台让位（纯 CSS，见 styles/56-stage.css），让位时、言的页面在后台时都不收画面。
// 网页的尺寸：playwright 有头时不设视口，网页多大即窗口多大——看台就把屏幕外那扇窗调成自己的大小（有下限，免得网站换成手机版），
// 网页原大显示；窗口调不动的（设了视口的）照旧按宽高里较紧的一边缩放，点按按同一倍数换算回去。
// 浏览器自己画的那几样（网页弹的提示框、载入中、能否后退）在屏幕外的窗上看不到：看台照 Page 域的事件自己画

const stage = {
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
  // 上回问到的浏览器前台那一页：模型换页（选签会把那页请到前台）时它变，看台跟过去；用户自己点签换的也记成前台，不算模型换页
  front: "",
  attached: "",
  session: "",
  framed: false,
  meta: { width: 1280, height: 720 },
  // 正看的那一页：载入中、能否后退前进、网页弹出的提示框
  loading: false,
  back: false,
  forward: false,
  /** @type {{ type: string, message: string, defaultPrompt?: string, multiple?: boolean, node?: number } | null} */
  dialog: null,
  // 浏览器配置目录里有收藏（桥接答的），才挂「收藏」
  marks: false,
  /** @type {string[]} 执事在浏览器里新近的几步，写成人话 */
  trail: [],
  // 指针形状跟着网页：上一回问的时刻、是否还在问
  cursorAt: 0,
  cursorAsking: false,
  // 浏览器的调试口（桥接从配置里读出来的，只用来报错）
  port: 0,
  seen: false,
  busy: 0,
  launching: false,
  width: 0,
  poll: 0,
  fitTimer: 0,
  empty: "",
  click: { at: 0, x: 0, y: 0, count: 0 },
  /** @type {PointerEvent | null} */
  moved: null
};

// ---------- 连上浏览器 ----------
// 已连着时也问一回：模型若把别的页请到了前台（选签、新开），看台跟过去
function stageLocate() {
  if (stage.locating) return stage.locating;
  stage.locating = bridge("/api/stage", { args: stageConfig()?.args || [] })
    .then(({ ws, front, marks, port }) => {
      stage.marks = !!marks;
      stage.port = port;
      if (!stage.ws) return ws ? stageConnect(ws, front) : stageSync();
      if (front && front !== stage.front && stage.tabs.has(front)) stageShow(front);
      stage.front = front || stage.front;
      stageSync();
    })
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
      stage.current = stage.front = stage.attached = stage.session = "";
      stage.framed = false;
      stageResetPage();
      for (const waiter of stage.pending.values()) waiter.reject(Error("游目已断开"));
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
        stage.front = front;
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
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(Error("游目未连上"));
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
  } else if (message.sessionId && message.sessionId === stage.session) stagePageEvent(message.method, params);
}
// 正看的那一页上的事。主框架的 id 与页的 targetId 相同，子框架（iframe）的载入不算
/** @param {string} method @param {any} params */
function stagePageEvent(method, params) {
  if (method === "Page.screencastFrame") {
    stageFrame(params.data, params.metadata.deviceWidth, params.metadata.deviceHeight);
    void stageSend("Page.screencastFrameAck", { sessionId: params.sessionId }, stage.session).catch(() => {});
  } else if (method === "Page.frameStartedLoading" || method === "Page.frameStoppedLoading") {
    if (params.frameId !== stage.attached) return;
    stage.loading = method === "Page.frameStartedLoading";
    stageRenderNav();
    // frameNavigated 由网页那头报来，常赶在浏览器记下这一步历史之前：载完再问一回
    if (!stage.loading) void stageReadHistory();
  } else if ((method === "Page.frameNavigated" && !params.frame.parentId) || method === "Page.navigatedWithinDocument") {
    void stageReadHistory();
  } else if (method === "Page.javascriptDialogOpening") {
    stage.dialog = { type: params.type, message: params.message, defaultPrompt: params.defaultPrompt };
    stageRenderDialog();
  } else if (method === "Page.javascriptDialogClosed") {
    stage.dialog = null;
    stageRenderDialog();
  } else if (method === "Page.fileChooserOpened" && params.backendNodeId) {
    stage.dialog = { type: "file", message: "", multiple: params.mode === "selectMultiple", node: params.backendNodeId };
    stageRenderDialog();
  }
}
function stageResetPage() {
  stage.loading = stage.back = stage.forward = false;
  stage.dialog = null;
  stageRenderNav();
  stageRenderDialog();
}
async function stageReadHistory() {
  const session = stage.session;
  const history = await stageSend("Page.getNavigationHistory", {}, session).catch(() => null);
  if (!history || session !== stage.session) return;
  stage.back = history.currentIndex > 0;
  stage.forward = history.currentIndex < history.entries.length - 1;
  stageRenderNav();
}
/** @param {number} step -1 后退，1 前进 */
async function stageTravel(step) {
  const session = stage.session;
  const history = await stageSend("Page.getNavigationHistory", {}, session).catch(() => null),
    entry = history?.entries[history.currentIndex + step];
  if (entry) void stageSend("Page.navigateToHistoryEntry", { entryId: entry.id }, session).catch(() => {});
}
function stageRenderNav() {
  $("#stageNav").classList.toggle("loading", stage.loading);
  /** @type {HTMLButtonElement} */ ($("[data-stage-nav=back]")).disabled = !stage.back;
  /** @type {HTMLButtonElement} */ ($("[data-stage-nav=forward]")).disabled = !stage.forward;
}
// 网页弹的提示框（alert / confirm / prompt / 离页挽留）与选文件的窗：浏览器画在屏幕外的窗上，网页就此停住——看台在画面上另画一张，答了递回去。
// 模型那头 playwright 也收得到，谁先答都行
function stageRenderDialog() {
  const box = $("#stageDialog"),
    dialog = stage.dialog;
  box.classList.toggle("hidden", !dialog);
  if (!dialog) return void (box.innerHTML = "");
  const leave = dialog.type === "beforeunload",
    file = dialog.type === "file",
    ask = dialog.type !== "alert",
    host = stageHost(stage.tabs.get(stage.current)?.url || "");
  const [head, text, yes, no] = file
    ? ["网页要你选文件", `${host || "此页"}请你上传文件${dialog.multiple ? "，可多选" : ""}`, "选文件", "取消"]
    : leave
      ? ["离开此页？", dialog.message || "此页有尚未存下的改动。", "离开", "留下"]
      : ["网页的提示", dialog.message, "确定", "取消"];
  box.innerHTML = `<div class="stage-dialog-card" role="alertdialog" aria-label="${head}"><div class="stage-dialog-head">${head}</div><div class="stage-dialog-text">${escapeHtml(text)}</div>${dialog.type === "prompt" ? `<input class="stage-dialog-input" spellcheck="false" value="${escapeHtml(dialog.defaultPrompt || "")}">` : ""}<div class="stage-dialog-actions">${ask ? `<button type="button" class="outline-btn" data-stage-answer="no">${no}</button>` : ""}<button type="button" class="outline-btn primary" data-stage-answer="yes">${yes}</button></div></div>`;
  /** @type {HTMLElement} */ (box.querySelector(".stage-dialog-input, [data-stage-answer=yes]")).focus({ preventScroll: true });
}
/** @param {boolean} accept */
function stageAnswer(accept) {
  const dialog = stage.dialog;
  // 答完键盘仍交还网页：人是在网页里做事时被问的
  $("#stageKeys").focus({ preventScroll: true });
  if (dialog?.type === "file") {
    stage.dialog = null;
    stageRenderDialog();
    if (accept) stagePickFiles(dialog);
    return;
  }
  const input = /** @type {HTMLInputElement | null} */ ($("#stageDialog .stage-dialog-input"));
  void stageSend("Page.handleJavaScriptDialog", { accept, ...(input ? { promptText: input.value } : {}) }, stage.session).catch(() => {});
  stage.dialog = null;
  stageRenderDialog();
}
// 选文件用言这边的窗（点「选文件」那一下即是人手的动作，浏览器才许开窗）；选好的落到桥接的临时目录，路径交给网页里那个 <input type=file>
/** @param {{ multiple?: boolean, node?: number }} dialog */
function stagePickFiles(dialog) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = !!dialog.multiple;
  input.addEventListener("change", () => void stageSendFiles([...(input.files || [])], dialog.node));
  input.click();
}
/** @param {File[]} files @param {number} [node] */
async function stageSendFiles(files, node) {
  const session = stage.session;
  if (!files.length || !session) return;
  try {
    const paths = [];
    for (const file of files) paths.push((await bridge("/api/stage/upload", { name: file.name, data: await readFile(file, "data") })).path);
    await stageSend("DOM.setFileInputFiles", { files: paths, backendNodeId: node }, session);
  } catch (error) {
    toast(`文件没能递进网页：${String(error.message || error).slice(0, 80)}`);
  }
}
/** @param {string} url */
function stageHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

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
      stageFrame(shot.data, metrics.cssVisualViewport.clientWidth, metrics.cssVisualViewport.clientHeight);
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
    const width = Math.round(bounds.width - port.clientWidth + want.width),
      height = Math.round(bounds.height - port.clientHeight + want.height);
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
// 开着（用户没收起它）
function stageShown() {
  const panel = $("#stagePanel");
  return !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
// 开着且看得见：没被旁注挤开、言的页面不在后台
function stageVisible() {
  return stageShown() && $("#stageView").clientWidth > 0 && !document.hidden;
}
// 看得见才收画面，看不见即停收、入口那一笔回来；回来再接上
function stageWake() {
  stage.seen = stageVisible();
  if (stage.seen) void stageAttach();
  else if (stage.session) void stageDetach();
  stageSync();
}
function openStage() {
  if (sidePanelOpen()) closeSidePanel();
  let saved = 0;
  try {
    saved = Number(localStorage.getItem("yan-stage-width")) || 0;
  } catch {}
  stageSetWidth(stage.width || saved || innerWidth * 0.46);
  showNow($("#stagePanel"));
  stageWake();
  // 浏览器早开着、看台却没连上的（桥接重启过、浏览器是别处起的）：开时再找一回
  if (!stage.ws) void stageLocate();
  clearInterval(stage.poll);
  stage.poll = window.setInterval(() => document.hidden || stageRefreshTabs(), 1500);
}
function closeStage() {
  stageSetWide(false);
  hideWithFade($("#stagePanel"));
  clearInterval(stage.poll);
  stageWake();
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
// 入口那一笔：接了浏览器类的 MCP（或浏览器已开着）、游目收着（或被旁注挤开）时自页顶垂下；模型正操作浏览器时笔尖下一粒朱一明一暗
function stageSync() {
  const pin = $("#stagePin");
  pin.classList.toggle("hidden", (!stage.ws && !stageServer()) || stageVisible());
  pin.classList.toggle("busy", stage.busy > 0);
  $("#stageBusy").classList.toggle("hidden", !stage.busy);
  $("#stageBusy").textContent = stage.trail.at(-1) || "正在操作";
  $("#stageMarks").classList.toggle("hidden", !stage.marks);
  stageRender();
}
// 接进来的浏览器类 MCP：工具里有 browser_navigate 的那个服务（playwright 即是）
function stageServer() {
  const configs = mcpConfigs();
  return (
    Object.keys(mcp.servers).find(
      name => mcp.servers[name].ok && !configs[name]?.disabled && mcp.servers[name].tools?.some(tool => tool.name === "browser_navigate")
    ) || ""
  );
}
// 那个服务的配置：调试口、配置目录都由桥接从它的参数里读。服务还没连上（刚开页）时，从配置里找像浏览器的那个
function stageConfig() {
  const configs = mcpConfigs();
  return (
    configs[stageServer()] ||
    Object.values(configs).find(config =>
      (config.args || []).some(arg => /playwright|^--(config|user-data-dir|cdp-endpoint)\b/.test(String(arg)))
    )
  );
}
// 浏览器没开（或被关了）：替用户调一次那个服务的 browser_navigate，浏览器照它的配置起来，再去连
async function stageLaunch() {
  const server = stageServer();
  if (!server || stage.launching) return;
  stage.launching = true;
  stageRender();
  try {
    await bridge("/api/mcp/call", {
      server,
      config: mcpConfigs()[server],
      tool: "browser_navigate",
      arguments: { url: "about:blank" },
      timeout: 60
    });
    await stageLocate();
    if (!stage.ws) toast(`浏览器已开，游目却连不上它的调试口${stage.port ? ` ${stage.port}` : ""}（见 docs/stage.md 的接法）`);
  } catch (error) {
    toast(`打不开浏览器：${String(error.message || error).slice(0, 80)}`);
  } finally {
    stage.launching = false;
    stageSync();
  }
}
function stageNewTab() {
  if (!stage.ws) return void stageLaunch();
  // 新开的一页由 targetCreated 报来，看台跟过去；地址栏等着输网址
  void stageSend("Target.createTarget", { url: "about:blank" })
    .then(() => $("#stageUrl").focus())
    .catch(() => {});
}
// 收藏：看台只转网页，浏览器自己的收藏栏看不到——读它配置目录里的那份，按夹分层列出，点一条在当前页打开。每回现读
/** @param {HTMLElement} anchor */
async function stageOpenMarks(anchor) {
  if (document.querySelector(".chip-pop.stage-marks")) return closeChipPop();
  const data = await bridge("/api/stage/bookmarks", { args: stageConfig()?.args || [] }).catch(() => ({ bar: [], other: [] })),
    marks = [...data.bar, ...(data.other.length ? [{ name: "其他收藏", children: data.other }] : [])];
  if (!marks.length) return toast("这个浏览器里还没有收藏");
  /** @param {any[]} nodes @returns {string} */
  const list = (nodes, depth = 0) =>
    nodes
      .map(node =>
        node.children
          ? `<div class="stage-mark-dir" style="--depth:${depth}">${escapeHtml(node.name)}</div>${list(node.children, depth + 1)}`
          : `<button type="button" data-stage-mark="${escapeHtml(node.url)}" style="--depth:${depth}" title="${escapeHtml(node.url)}"><span>${escapeHtml(node.name || node.url)}</span></button>`
      )
      .join("");
  const pop = openFloatingPop(anchor, list(marks), { align: "right" });
  pop.classList.add("stage-marks");
  pop.addEventListener("click", e => {
    const mark = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-stage-mark]"));
    if (!mark) return;
    closeChipPop();
    stageGo(mark.dataset.stageMark || "");
  });
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
  const [text, action] = stage.launching
      ? ["正在打开浏览器…", ""]
      : !stage.ws
        ? ["浏览器未开", stageServer() ? `<button type="button" class="outline-btn" data-stage-launch>打开浏览器</button>` : ""]
        : !tab
          ? ["没有开着的页", `<button type="button" class="outline-btn" data-stage-new>新建标签页</button>`]
          : ["", ""],
    empty = text ? `<span>${text}</span>${action}` : "";
  // 隔一会儿就重画一回：没变不动，免得按钮在指针下被换掉
  if (empty !== stage.empty) $("#stageEmpty").innerHTML = stage.empty = empty;
  $("#stageEmpty").classList.toggle("hidden", !empty);
  $("#stageView").classList.toggle("empty", !!empty);
}
/**
 * 浏览器类的 MCP 调用（playwright 的 browser_*）进行时点一粒朱、记一笔它在做什么；调完去找一回浏览器——它多半是这一下起的
 * @param {string} tool
 * @param {Record<string, any>} [args]
 */
function stageWatch(tool, args = {}) {
  if (!/^browser_/.test(tool)) return () => {};
  stage.busy += 1;
  stage.trail = [...stage.trail, stageActionText(tool, args)].slice(-6);
  stageSync();
  return () => {
    stage.busy -= 1;
    stageSync();
    void stageLocate();
  };
}

// 执事在浏览器里的一步，写成人话：打开 某站、点了「某处」、输入「某字」……参数照 playwright MCP 的写法，认不得的只写工具名
/** @param {string} tool @param {Record<string, any>} args */
function stageActionText(tool, args) {
  const quote = (/** @type {any} */ value) =>
      `「${String(value ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 24)}」`,
    name = tool.replace(/^browser_/, "");
  /** @type {Record<string, () => string>} */
  const say = {
    navigate: () => `打开 ${stageHost(args.url) || args.url || ""}`,
    navigate_back: () => "后退一页",
    navigate_forward: () => "前进一页",
    click: () => `${args.doubleClick ? "双击" : "点了"}${quote(args.element)}`,
    hover: () => `指着${quote(args.element)}`,
    type: () => `输入${quote(args.text)}`,
    fill_form: () => "填表",
    select_option: () => `选了${quote([].concat(args.values || []).join("、"))}`,
    press_key: () => `按 ${args.key || ""}`,
    drag: () => `拖${quote(args.startElement)}`,
    snapshot: () => "读此页",
    take_screenshot: () => "截图",
    wait_for: () => (args.text ? `等${quote(args.text)}` : args.textGone ? `等${quote(args.textGone)}消失` : `等 ${args.time || ""} 秒`),
    tabs: () => ({ new: "开新页", close: "关一页", select: "换页", list: "看各页" })[String(args.action)] || "看各页",
    evaluate: () => "运行脚本",
    file_upload: () => "传文件",
    handle_dialog: () => (args.accept ? "应了提示框" : "拒了提示框"),
    close: () => "关浏览器",
    resize: () => "调窗口",
    console_messages: () => "看控制台",
    network_requests: () => "看网络请求"
  };
  return say[name]?.() || name;
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
// 浏览器自己接的几个键（递进网页没人管）：Ctrl+L / Alt+D / F6 到地址栏，F5 / Ctrl+R 重载（加 Shift 不用缓存），Alt+← / → 前后。
// Ctrl+T、Ctrl+W 外头的浏览器拦不住，不接
/** @param {KeyboardEvent} e */
function stageShortcut(e) {
  const key = e.key.toLowerCase(),
    ctrl = e.ctrlKey || e.metaKey;
  if ((ctrl && key === "l") || (e.altKey && key === "d") || key === "f6") {
    const url = /** @type {HTMLInputElement} */ ($("#stageUrl"));
    url.focus();
    url.select();
  } else if (key === "f5" || (ctrl && key === "r")) {
    if (stage.session) void stageSend("Page.reload", { ignoreCache: e.shiftKey }, stage.session).catch(() => {});
  } else if (e.altKey && (key === "arrowleft" || key === "arrowright")) void stageTravel(key === "arrowleft" ? -1 : 1);
  else return false;
  return true;
}
// 指针形状跟着网页：停在链接上是手、输入框里是竖线。问网页那一处的 cursor，一秒至多问十回、上一问没回来不再问
/** @param {MouseEvent} e */
function stageCursor(e) {
  if (!stage.session || stage.cursorAsking || e.timeStamp - stage.cursorAt < 100) return;
  stage.cursorAt = e.timeStamp;
  stage.cursorAsking = true;
  const { x, y } = stagePoint(e);
  void stageSend(
    "Runtime.evaluate",
    {
      expression: `(() => { const el = document.elementFromPoint(${x}, ${y}); if (!el) return ""; const c = getComputedStyle(el).cursor; if (c !== "auto") return c; return el.closest("input:not([type=button],[type=submit],[type=reset],[type=checkbox],[type=radio],[type=range],[type=color],[type=file]),textarea,[contenteditable]:not([contenteditable=false])") ? "text" : ""; })()`,
      returnByValue: true
    },
    stage.session
  )
    .then(({ result }) => {
      const cursor = String(result?.value || "");
      $("#stageFrame").style.cursor = /^[a-z-]+$/.test(cursor) ? cursor : "";
    })
    .catch(() => {})
    .finally(() => (stage.cursorAsking = false));
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
  const url = stageUrlOf(raw);
  if (!url || !stage.ws) return;
  // 一页都没开着：新开一页去
  const go = stage.session ? stageSend("Page.navigate", { url }, stage.session) : stageSend("Target.createTarget", { url });
  void go.catch(error => toast(`打不开：${String(error.message || error).slice(0, 80)}`));
}
// 地址栏里输的话换成网址：本机路径、本机服务、带协议的照走；像网址的（有点、没空格）补 https；余下当成要搜的话
/** @param {string} raw */
function stageUrlOf(raw) {
  const text = raw.trim();
  if (!text) return "";
  return /^[a-z]:[\\/]/i.test(text)
    ? `file:///${text.replace(/\\/g, "/")}`
    : /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(text)
      ? `http://${text}`
      : /^([a-z][\w+.-]*:\/\/|(about|data|file|javascript|mailto|view-source|edge|chrome):)/i.test(text)
        ? text
        : !/\s/.test(text) && /^[^/?#]+\.[^/?#.]+([/?#:]|$)/.test(text)
          ? `https://${text}`
          : `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

function bindStage() {
  // 入口那一笔朱竖：12 × 64 的画幅，自页顶垂下、收笔出锋
  $("#stagePin svg").innerHTML = brushStroke([6, 0, 5.4, 32, 6.3, 62], 4.2, { tone: "zhu", tail: 0, head: 1 });
  $("#stagePin").addEventListener("click", openStage);
  $("#stageClose").addEventListener("click", closeStage);
  $("#stageWide").addEventListener("click", () => stageSetWide(!$("#stagePanel").classList.contains("wide")));
  $("#stageNewTab").addEventListener("click", stageNewTab);
  $("#stageMarks").addEventListener("click", e => {
    e.stopPropagation();
    void stageOpenMarks(/** @type {HTMLElement} */ (e.currentTarget));
  });
  $("#stageEmpty").addEventListener("click", e => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest("[data-stage-launch]")) void stageLaunch();
    else if (target.closest("[data-stage-new]")) stageNewTab();
  });
  // 看台一变大小（拖宽窄、阔、窗口缩放），停手片刻后把浏览器的窗口跟上；被旁注挤开、又回来的，停收或接上画面
  new ResizeObserver(() => {
    if (stageVisible() !== stage.seen) stageWake();
    clearTimeout(stage.fitTimer);
    stage.fitTimer = window.setTimeout(() => void stageFit(), 250);
  }).observe($("#stageView"));
  document.addEventListener("visibilitychange", () => stageShown() && stageWake());
  // 网页的提示框：Enter 即确定，Esc 即取消（不让 Esc 再去收别的）
  const dialog = $("#stageDialog");
  dialog.addEventListener("click", e => {
    const answer = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-stage-answer]"));
    if (answer) stageAnswer(answer.dataset.stageAnswer === "yes");
  });
  dialog.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape") stageAnswer(false);
    else if (e.key === "Enter" && /** @type {HTMLElement} */ (e.target).matches("input")) stageAnswer(true);
  });
  $("#stageTabs").addEventListener("click", e => {
    const target = /** @type {HTMLElement} */ (e.target),
      close = /** @type {HTMLElement | null} */ (target.closest("[data-stage-close]"));
    if (close) return void stageSend("Target.closeTarget", { targetId: close.dataset.stageClose }).catch(() => {});
    const tab = /** @type {HTMLElement | null} */ (target.closest("[data-stage-tab]"));
    if (!tab || tab.dataset.stageTab === stage.current) return;
    // 换到后台的那一页：先请到前台，不然它不重绘、没有画面
    void stageSend("Target.activateTarget", { targetId: tab.dataset.stageTab }).catch(() => {});
    stage.front = tab.dataset.stageTab || "";
    stageShow(stage.front);
  });
  for (const button of document.querySelectorAll("[data-stage-nav]"))
    button.addEventListener("click", () => {
      const action = /** @type {HTMLElement} */ (button).dataset.stageNav;
      if (!stage.session) return;
      // 前后按浏览器记的历史走，不经网页里的脚本（脚本卡住、出错页上也走得动）
      if (action === "reload") void stageSend("Page.reload", {}, stage.session).catch(() => {});
      else void stageTravel(action === "back" ? -1 : 1);
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
    // 鼠标侧键：后退、前进（浏览器自己接的键，递进网页没人管）
    if (e.button === 3 || e.button === 4) return void stageTravel(e.button === 3 ? -1 : 1);
    frame.setPointerCapture(e.pointerId);
    stageFocusKeys(e);
    // 连点计数自己数：pointerdown 不带 detail
    const click = stage.click,
      again = e.timeStamp - click.at < 450 && Math.hypot(e.clientX - click.x, e.clientY - click.y) < 6;
    Object.assign(click, { at: e.timeStamp, x: e.clientX, y: e.clientY, count: again ? click.count + 1 : 1 });
    stageMouse("mousePressed", e, { button: STAGE_BUTTONS[e.button] || "left", clickCount: click.count });
  });
  frame.addEventListener("pointerup", e => {
    // 侧键在按下时已办了；松开时外头的浏览器会拿它把言这一页后退，拦下
    if (e.button === 3 || e.button === 4) return void e.preventDefault();
    stageMouse("mouseReleased", e, { button: STAGE_BUTTONS[e.button] || "left", clickCount: stage.click.count });
  });
  frame.addEventListener("mouseup", e => (e.button === 3 || e.button === 4) && e.preventDefault());
  // 移动一帧只递一次
  frame.addEventListener("pointermove", e => {
    if (!stage.moved)
      requestAnimationFrame(() => {
        const last = stage.moved;
        stage.moved = null;
        if (last) stageMouse("mouseMoved", last, { button: last.buttons & 1 ? "left" : last.buttons & 2 ? "right" : "none" });
        if (last && !last.buttons) stageCursor(last);
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
    if (stageShortcut(e)) return;
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
// 给端到端测试：读状态、立即去连（见 test/stage.mjs）
window.__yanStage = { state: stage, locate: stageLocate, go: stageGo, sendFiles: stageSendFiles };
