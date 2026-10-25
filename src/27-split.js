// 言 · 右栏：两段对话并排
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 右栏不另起一套界面：同一页面以 ?pane=side&c=<id> 嵌在主页面右侧（PANE 见 00-state.js），是另一处页面——
// 作答、存盘、租约都与开两个标签页无异，几处页面同开的那一套（见 01-store/40-leases.js）原样管着。
// 这里只管三件事：开合与宽窄；同一段对话不在两边同开（点它即转到开着的那一边）；右栏里要换对话的，交回主页面去开。
// 右栏里不接游目（模型所用的浏览器只有一个调试口，见 stageLocate），也不记「停在哪儿」，免得主页面刷新后回到右栏那段
const split = {
  id: "",
  width: 0
};
// ---------- 右栏这一侧 ----------
// 主页面（同源，直接调得到）；右栏是被单独打开的（父页不是言）时没有
function splitHost() {
  if (!PANE || window.parent === window) return null;
  try {
    return /** @type {any} */ (window.parent).__yanSplit || null;
  } catch {
    return null;
  }
}
// 右栏要开别的对话（候、旧谈、记忆里的出处）：交给主页面开；主页面没了就在自己这里开
function splitHandOff(id) {
  const host = splitHost();
  if (!host) return false;
  host.open(id);
  return true;
}
// 主页面问右栏：手上还有没做完的活吗（作答、后台的帮手、等着的后台指令）——关掉或换掉右栏会断了它们
function paneBusy() {
  return !!(requestJobs.size || crews.size || bgWatches.size);
}
if (PANE) {
  /** @type {any} */ (window).__yanPane = {
    busy: paneBusy,
    id: () => currentId || "",
    // 主页面改了设置（明暗、朱色、字体、模型……）：读一回磁盘上的配置，三方合并后照着重画
    refresh: () => void refreshConfigFromDisk()
  };
}
// ---------- 主页面这一侧 ----------
// 这段对话开在右栏（窄屏时右栏藏着，但仍开着）
function splitHolds(id) {
  return !PANE && !!id && split.id === id;
}
function splitFrame() {
  return /** @type {HTMLIFrameElement} */ ($("#splitFrame"));
}
function splitPane() {
  try {
    return /** @type {any} */ (splitFrame().contentWindow).__yanPane || null;
  } catch {
    return null;
  }
}
// 右栏手上有活时先问一声：换掉、关掉它，那几样会按页面关了处理（已写的都在）
async function splitMayLeave() {
  if (!splitPane()?.busy()) return true;
  return askConfirm({
    title: t("右栏的对话还在作答"),
    body: t("关掉右栏会中断它，已写的部分都在。"),
    ok: t("仍要关掉")
  });
}
async function openSplit(id) {
  if (PANE || !store.conversations.some(c => c.id === id)) return;
  if (id === currentId && view === "chat") return toast(t("这段对话正开在左边"));
  if (split.id === id) return focusSplit();
  if (split.id && !(await splitMayLeave())) return;
  split.id = id;
  try {
    localStorage.setItem("yan-split", id);
  } catch {}
  splitFrame().src = `./?pane=side&c=${encodeURIComponent(id)}`;
  showSplit();
  renderHistory();
}
function showSplit() {
  let saved = 0;
  try {
    saved = Number(localStorage.getItem("yan-split-width")) || 0;
  } catch {}
  splitSetWidth(split.width || saved || innerWidth * 0.42);
  $("#splitPanel").classList.remove("hidden");
  document.documentElement.dataset.split = "open";
}
async function closeSplit(force = false) {
  if (!split.id) return;
  if (!force && !(await splitMayLeave())) return;
  split.id = "";
  try {
    localStorage.removeItem("yan-split");
  } catch {}
  $("#splitPanel").classList.add("hidden");
  delete document.documentElement.dataset.split;
  // 换成空页：右栏那一页照常离页（存草稿、落盘、松开租约）
  splitFrame().src = "about:blank";
  renderHistory();
}
// 点了开在右栏的那段：不在左边再开一份，把光标送过去
function focusSplit() {
  if (isMobile()) return toast(t("这段对话开在右栏，窗口放宽些即可看到"));
  const frame = splitFrame();
  frame.focus();
  try {
    /** @type {HTMLElement|null} */ (frame.contentDocument?.querySelector("#chatInput"))?.focus();
  } catch {}
  const panel = $("#splitPanel");
  panel.classList.remove("flash");
  void panel.offsetWidth;
  panel.classList.add("flash");
}
/** @param {number} px */
function splitSetWidth(px) {
  split.width = Math.round(Math.max(360, Math.min(px, innerWidth - 480)));
  $("#splitPanel").style.width = `${split.width}px`;
}
// 右栏那段被删了（这边删的、别处删的）：右栏跟着收起
function syncSplit() {
  if (split.id && !store.conversations.some(c => c.id === split.id)) void closeSplit(true);
}
function bindSplit() {
  if (PANE) return;
  /** @type {any} */ (window).__yanSplit = {
    open: id => {
      if (splitHolds(id)) return focusSplit();
      openConversation(id);
      window.focus();
    },
    close: () => void closeSplit()
  };
  const grip = $("#splitGrip");
  grip.addEventListener("pointerdown", e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add("split-dragging");
  });
  grip.addEventListener("pointermove", e => {
    if (grip.hasPointerCapture(e.pointerId)) splitSetWidth($(".app").getBoundingClientRect().right - e.clientX);
  });
  grip.addEventListener("lostpointercapture", () => {
    document.body.classList.remove("split-dragging");
    try {
      localStorage.setItem("yan-split-width", String(split.width));
    } catch {}
  });
  $("#splitPanel").addEventListener("animationend", e => /** @type {HTMLElement} */ (e.currentTarget).classList.remove("flash"));
  // 这边改了设置：存盘落地后叫右栏读一回（明暗、朱色、字体当场跟上，模型等下一问前也就对上了）
  let refreshTimer = 0;
  new MutationObserver(() => {
    if (!split.id) return;
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => splitPane()?.refresh(), 800);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-font", "data-ink-motion", "style"] });
}
// 刷新前开着的右栏：接着开（开页时、回到原处之后；左边正停在那段的就不开了）
function restoreSplit() {
  if (PANE) return;
  let saved = "";
  try {
    saved = localStorage.getItem("yan-split") || "";
  } catch {}
  if (saved && store.conversations.some(c => c.id === saved) && saved !== currentId) void openSplit(saved);
  else if (saved)
    try {
      localStorage.removeItem("yan-split");
    } catch {}
}
// 右栏自己的顶栏：一枚「收起右栏」
function bindPane() {
  if (!PANE) return;
  const close = document.createElement("button");
  close.id = "paneClose";
  close.className = "icon-btn pane-close";
  close.type = "button";
  close.title = t("收起右栏");
  close.setAttribute("aria-label", t("收起右栏"));
  close.textContent = "×";
  close.onclick = () => splitHost()?.close();
  $(".top-actions").append(close);
  // 光标进右栏时也读一回配置：主页面改了什么，这边当场跟上
  window.addEventListener("focus", () => void refreshConfigFromDisk());
}
