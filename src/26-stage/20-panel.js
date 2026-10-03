// 言 · 游目 · 开合与画面之外的几样：宽窄、浏览器起停、地址与标签、模型动作的提示
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
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
  // 地址行的「执事」：执事在动、或歇手不到八秒时挂着，指着浮出近几步
  const acting = stage.busy > 0 || Date.now() - stage.lastAct < 8000;
  $("#stageBusy").classList.toggle("hidden", !acting);
  $("#stageBusy").classList.toggle("busy", stage.busy > 0);
  clearTimeout(stage.actTimer);
  if (acting && !stage.busy) stage.actTimer = window.setTimeout(stageSync, 8000 - (Date.now() - stage.lastAct) + 50);
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
    .then(stageEditUrl)
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
// 地址行给人看的一句：域名 › 页题；本机的页不收短（localhost 写端口与路径、本机文件写文件名）。整串网址在 title 里，点它才露出可改
/** @param {{ title: string, url: string } | undefined} tab */
function stageAddrHtml(tab) {
  if (!tab?.url) return "";
  const text = stageReadable(tab.url);
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return `<b>${escapeHtml(text)}</b>`;
  }
  const sep = `<i aria-hidden="true">›</i>`;
  if (url.protocol === "about:") return `<b>${escapeHtml(stageTitle(tab))}</b>`;
  if (url.protocol === "file:") {
    const path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:)/i, "$1");
    return `<b>${escapeHtml(path.split("/").pop() || path)}</b>${sep}${escapeHtml(path.split("/").slice(0, -1).join("/"))}`;
  }
  // data: 之类整串没法看：写协议与页题
  if (!/^https?:$/.test(url.protocol))
    return `<b>${escapeHtml(url.protocol.slice(0, -1))}</b>${tab.title && tab.title !== tab.url ? `${sep}${escapeHtml(tab.title)}` : ""}`;
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname),
    rest = local ? stageReadable(url.pathname + url.search + url.hash) : tab.title && tab.title !== tab.url ? tab.title : "";
  return `<b>${escapeHtml(local ? url.host : url.host.replace(/^www\./, ""))}</b>${rest && rest !== "/" ? `${sep}${escapeHtml(rest)}` : ""}`;
}
// 改网址：地址行换成输入框、整串选中（点地址行、Ctrl+L）
function stageEditUrl() {
  const url = /** @type {HTMLInputElement} */ ($("#stageUrl"));
  $("#stageAddr").classList.add("hidden");
  url.classList.remove("hidden");
  url.value = stageReadable(stage.tabs.get(stage.current)?.url || "");
  url.focus();
  url.select();
}
// 空台：一页空册（淡墨四笔、角上一方小印），底下一词，有事可做时是一个带朱线的词
let stageLeaf = "";
function stageEmptyHtml(text, action = "") {
  stageLeaf ||=
    `<rect class="wash" x="18" y="10" width="114" height="70"/>` +
    brushStroke([14, 9, 75, 7.6, 136, 9.4], 2.2, { tone: "ink2", tail: 0.4 }) +
    brushStroke([17, 10, 16.4, 45, 17.4, 81], 1.8, { tone: "ink2", tail: 0.3 }) +
    brushStroke([133, 10, 133.8, 45, 132.6, 81], 1.8, { tone: "ink2", tail: 0.3 }) +
    brushStroke([14, 81.4, 75, 82.6, 136, 80.8], 2.2, { tone: "ink2", tail: 0.2 }) +
    `<rect class="zhu" x="118" y="66" width="7" height="7" rx=".6"/>`;
  return `<svg class="brush stage-leaf" viewBox="0 0 150 92" aria-hidden="true">${stageLeaf}</svg><span>${text}</span>${action}`;
}
function stageRender() {
  if (!stageShown()) return;
  // 标签是一行字、丝栏相隔；当前那张底下一笔朱，执事所在的那张题后一粒朱
  const under = brushStroke([1, 2.6, 9, 1.8, 17, 2.4], 2.2, { tone: "zhu", tail: 0 }),
    acting = stage.busy > 0 || Date.now() - stage.lastAct < 8000;
  $("#stageTabs").innerHTML = [...stage.tabs]
    .map(
      ([id, tab]) =>
        `<div class="stage-tab${id === stage.current ? " on" : ""}" role="tab" aria-selected="${id === stage.current}" data-stage-tab="${escapeHtml(id)}" title="${escapeHtml(tab.title || tab.url)}"><span class="stage-tab-name">${escapeHtml(stageTitle(tab))}</span>${acting && id === stage.front ? `<span class="stage-tab-live" title="执事在这一页"></span>` : ""}<button type="button" class="stage-tab-x" data-stage-close="${escapeHtml(id)}" title="关闭此页" aria-label="关闭此页">×</button>${id === stage.current ? `<svg class="stage-tab-under" viewBox="0 0 18 5" aria-hidden="true">${under}</svg>` : ""}</div>`
    )
    .join("");
  const tab = stage.tabs.get(stage.current),
    addr = $("#stageAddr");
  if (document.activeElement !== $("#stageUrl")) {
    addr.innerHTML = stageAddrHtml(tab);
    addr.title = tab?.url ? stageReadable(tab.url) : "";
  }
  const empty = stage.launching
    ? stageEmptyHtml("正在打开浏览器…")
    : !stage.ws
      ? stageEmptyHtml("浏览器未开", stageServer() ? `<button type="button" class="stage-go" data-stage-launch>打开浏览器</button>` : "")
      : !tab
        ? stageEmptyHtml("没有开着的页", `<button type="button" class="stage-go" data-stage-new>新建标签页</button>`)
        : "";
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
  stage.trail = [...stage.trail, { text: stageActionText(tool, args), at: Date.now() }].slice(-6);
  stage.lastAct = Date.now();
  stageSync();
  return () => {
    stage.busy -= 1;
    stage.lastAct = Date.now();
    stageSync();
    void stageLocate();
  };
}

// 执事在浏览器里的一步，写成一句：前往 某站、点击「某处」、键入「某字」……两字动词；参数照 playwright MCP 的写法，认不得的只写工具名
/** @param {string} tool @param {Record<string, any>} args */
function stageActionText(tool, args) {
  const quote = (/** @type {any} */ value) =>
      `「${String(value ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 24)}」`,
    name = tool.replace(/^browser_/, "");
  /** @type {Record<string, () => string>} */
  const say = {
    navigate: () => `前往 ${stageHost(args.url) || args.url || ""}`,
    navigate_back: () => "返回上页",
    navigate_forward: () => "前进一页",
    click: () => `${args.doubleClick ? "双击" : "点击"}${quote(args.element)}`,
    hover: () => `悬停${quote(args.element)}`,
    type: () => `键入${quote(args.text)}`,
    fill_form: () => "填写表单",
    select_option: () => `选取${quote([].concat(args.values || []).join("、"))}`,
    press_key: () => `按键 ${args.key || ""}`,
    drag: () => `拖动${quote(args.startElement)}`,
    snapshot: () => "阅读此页",
    take_screenshot: () => "截取画面",
    wait_for: () =>
      args.text ? `等候${quote(args.text)}` : args.textGone ? `等候${quote(args.textGone)}消失` : `等候 ${args.time || ""} 秒`,
    tabs: () => ({ new: "新开一页", close: "关闭一页", select: "切换标签", list: "查看各页" })[String(args.action)] || "查看各页",
    evaluate: () => "运行脚本",
    file_upload: () => "上传文件",
    handle_dialog: () => (args.accept ? "应允提示" : "回绝提示"),
    close: () => "关闭浏览器",
    resize: () => "调整窗口",
    console_messages: () => "查看控制台",
    network_requests: () => "查看网络请求"
  };
  return say[name]?.() || name;
}
