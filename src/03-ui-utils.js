// 言 · 小工具：转义、时间、提示、确认框、按需加载、动效开合
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function safeWebUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "未填写地址";
  }
}
function formatTime(value) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
// 汉字数字：一、十二、二十三；2 单独出现时用「两」（如「两问」）
const DIGITS = "〇一二三四五六七八九";
function chineseNumber(n, twoAsLiang = false) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n === 2 && twoAsLiang) return "两";
  if (n < 10) return DIGITS[n];
  if (n < 100) {
    const tens = Math.floor(n / 10),
      ones = n % 10;
    return `${tens > 1 ? DIGITS[tens] : ""}十${ones ? DIGITS[ones] : ""}`;
  }
  return String(n);
}
function formatDay(value) {
  const date = new Date(value),
    year = date.getFullYear();
  return `${year !== new Date().getFullYear() ? `${[...String(year)].map(d => DIGITS[Number(d)]).join("")}年` : ""}${chineseNumber(date.getMonth() + 1)}月${chineseNumber(date.getDate())}日`;
}
function dayBucket(value) {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(value).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? "今天" : days < 7 ? "过去七天" : "更早";
}
let toastTimer = null;
function toast(message, ms = 2200) {
  const el = $("#toast");
  el.textContent = message;
  showNow(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideWithFade(el), ms);
}
// 把正文里的某条消息滚到视口：只滚 #chatScroll 自己，不用 scrollIntoView——它会连带滚动外层容器（页面整体跟着偏一截，尤其在 VS Code 预览与移动端）
function scrollChatTo(article, block = "start", margin = 12) {
  const host = $("#chatScroll");
  if (!host || !article) return;
  const offset = article.getBoundingClientRect().top - host.getBoundingClientRect().top,
    target =
      block === "center"
        ? host.scrollTop + offset - Math.max(0, (host.clientHeight - article.offsetHeight) / 2)
        : host.scrollTop + offset - margin;
  host.scrollTo({ top: Math.max(0, target), behavior: reducedMotion.matches ? "instant" : "smooth" });
}
function grow(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(190, Math.max(44, el.scrollHeight))}px`;
}
// 编辑消息的文本框：随内容长高（浏览器不认 field-sizing 时的兜底），到七成屏高才内滚
function growEditor(el) {
  if (!el) return;
  const fit = () => {
    el.style.height = "auto";
    el.style.height = `${Math.min(innerHeight * 0.7, el.scrollHeight + 2)}px`;
  };
  fit();
  if (!el.dataset.grow) {
    el.dataset.grow = "1";
    el.addEventListener("input", fit);
  }
}
function isMobile() {
  return innerWidth <= 760;
}
// ---------- 浮层：盖在正文上的一层层（查看器、全屏的作品、差遣窗、小菜单、设置、确认框、旁注……） ----------
// Esc 收最上面开着的那一层。各层在自己那一段登记：叫什么、多高（rank，越大越在上）、开着没有、怎么收；Esc 一层也不认得。
// 层次是定好的高低，不是开的先后：图片查看器总盖在卷宗预览上，收小菜单不连带底下的旁注。加一种浮层只需登记一层
/** @typedef {{ name: string, rank: number, open: () => boolean, close: () => void }} Layer */
/** @type {Layer[]} */
const LAYERS = [];
/** @param {Layer} layer */
function defineLayer(layer) {
  LAYERS.push(layer);
  LAYERS.sort((a, b) => b.rank - a.rank);
}
// 收最上面那一层；一层都没开着回 false
function closeTopLayer() {
  const top = LAYERS.find(layer => layer.open());
  top?.close();
  return !!top;
}
// 带 hidden 类开合的那几层：在页上、且没藏着
function isShown(selector) {
  const el = $(selector);
  return !!el && !el.classList.contains("hidden");
}
// 同风格的确认弹层，替代浏览器自带的 confirm()
let confirmResolve = null;
let confirmReturnFocus = null;
function askConfirm({ title, body = "", ok = "确定", danger = true }) {
  return new Promise(resolve => {
    settleConfirm(false);
    confirmReturnFocus = document.activeElement;
    confirmResolve = resolve;
    $("#confirmTitle").textContent = title;
    $("#confirmBody").textContent = body;
    const button = $("#confirmOk");
    button.textContent = ok;
    button.className = danger ? "danger-btn solid" : "outline-btn";
    showNow($("#confirmModal"));
    setTimeout(() => {
      if (confirmResolve === resolve) button.focus();
    }, 0);
  });
}
function settleConfirm(value) {
  if (!confirmResolve) return;
  hideWithFade($("#confirmModal"));
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve(value);
  if (confirmReturnFocus?.isConnected) confirmReturnFocus.focus();
  confirmReturnFocus = null;
}
defineLayer({ name: "confirm", rank: 70, open: () => !!confirmResolve, close: () => settleConfirm(false) });
function trapModalFocus(event, modal) {
  const focusable = [
    ...modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ].filter(el => el.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0],
    last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

// ---------- 大体积库按需加载：KaTeX / pdf.js 只在真正用到时才拉，首屏只带 marked + purify + hljs（图表与流程图的库在交互预览里按需载） ----------
const VENDOR = {
  pdf: { src: "./vendor/pdf.min.js", ready: () => window.pdfjsLib },
  katex: { src: "./vendor/katex/katex.min.js", ready: () => window.katex }
};
const vendorLoads = new Map();
function ensureLib(name) {
  const lib = VENDOR[name];
  if (!lib) return Promise.resolve(false);
  if (lib.ready()) return Promise.resolve(true);
  if (!vendorLoads.has(name))
    vendorLoads.set(
      name,
      new Promise(resolve => {
        const script = document.createElement("script");
        script.src = lib.src;
        script.onload = () => resolve(!!lib.ready());
        script.onerror = () => {
          vendorLoads.delete(name);
          script.remove();
          resolve(false);
        };
        document.head.append(script);
      })
    );
  return vendorLoads.get(name);
}
// 弹层与提示的收场：先淡出再 hidden，别硬切
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const inkMotionOff = () => document.documentElement.dataset.inkMotion === "off";
function showNow(el) {
  clearTimeout(el._leaveTimer);
  el.classList.remove("hidden", "leaving");
}
function hideWithFade(el, duration = 170) {
  if (!el || el.classList.contains("hidden")) return;
  clearTimeout(el._leaveTimer);
  if (reducedMotion.matches) {
    el.classList.add("hidden");
    return;
  }
  el.classList.add("leaving");
  el._leaveTimer = setTimeout(() => {
    el.classList.remove("leaving");
    el.classList.add("hidden");
  }, duration);
}
// 自动开合的规矩：程序只在两处动手——开始时打开、做完时收起，中间不来回翻。收起前先停一拍，让勾打上、让人看清结果；
// 且只在读者没停在这一块上看时才收：正在往上翻着读的人，内容不能从眼皮底下抽走，留给他自己收。用户亲手开合过的一律不动
const SETTLE_DELAY = 700;
function detailsInView(details) {
  const host = $("#chatScroll") || document.documentElement,
    rect = details.getBoundingClientRect(),
    frame = host.getBoundingClientRect();
  return rect.bottom > frame.top && rect.top < frame.bottom;
}
// 滚轮落在里层自己能滚的框里（思绪、代码、指令输出）且那框还能往上滚：滚的是它，对话没动，不算离开底部。
// 不然边看边往上翻思绪，页面就当读者停下来读了：不再跟着底部，思绪也不收
function wheelScrollsInner(event) {
  for (let el = event.target; el && el !== event.currentTarget; el = el.parentElement)
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true;
  return false;
}
// force：做完就收，不看读者是否正停在这块、用户是否亲手开过——运行中摊开、运行完收起，是行迹与帮手时间线的定例
function settleDetails(details, open, onClose = null, force = false) {
  if (!details) return;
  if (open) {
    clearTimeout(details._settleTimer);
    details._settleTimer = null;
    return setProcessDetails(details, true);
  }
  if (details._settleTimer || !details.open) return;
  details._settleTimer = setTimeout(() => {
    details._settleTimer = null;
    if (!details.isConnected) return;
    if (!force && (details.dataset.touched || (!followBottom && detailsInView(details)))) return;
    delete details.dataset.touched;
    setProcessDetails(details, false);
    onClose?.();
  }, SETTLE_DELAY);
}
function setProcessDetails(details, open, animate = true) {
  if (!details) return;
  if (details._motionAnimation && details._motionTarget === open) return;
  details._motionAnimation?.cancel();
  details._motionAnimation = null;
  details._motionTarget = open;
  // 只认自己直接的那层正文：帮手卡片的「帮手 · n 步」里还套着各轮的思绪，不能抓到里头那个去动
  const body = details.querySelector(":scope > .reasoning-body, :scope > .tool-stack-body, :scope > .sub-timeline, :scope > .source-grid");
  details.classList.remove("is-closing");
  if (body) {
    body.style.removeProperty("overflow");
    body.style.removeProperty("will-change");
  }
  if (!body || !animate || inkMotionOff() || typeof body.animate !== "function") {
    details.open = open;
    details._motionTarget = undefined;
    return;
  }
  if (open && details.open) {
    details._motionTarget = undefined;
    return;
  }
  if (!open && !details.open) {
    details._motionTarget = undefined;
    return;
  }
  if (open) details.open = true;
  else details.classList.add("is-closing");
  const height = Math.max(1, body.getBoundingClientRect().height);
  body.style.overflow = "hidden";
  body.style.willChange = "height, opacity, transform";
  const frames = open
    ? [
        { height: "0px", opacity: 0, transform: "translateY(-5px)" },
        { height: `${height}px`, opacity: 1, transform: "translateY(0)" }
      ]
    : [
        { height: `${height}px`, opacity: 1, transform: "translateY(0)" },
        { height: "0px", opacity: 0, transform: "translateY(-5px)" }
      ];
  const animation = body.animate(frames, { duration: open ? 420 : 380, easing: "cubic-bezier(.22,.72,.2,1)", fill: "both" });
  details._motionAnimation = animation;
  animation.onfinish = () => {
    if (details._motionAnimation !== animation) return;
    if (!open) details.open = false;
    details.classList.remove("is-closing");
    body.style.removeProperty("overflow");
    body.style.removeProperty("will-change");
    animation.cancel();
    details._motionAnimation = null;
    details._motionTarget = undefined;
  };
}
// 就地改内容时高度平滑过渡（先量旧高，改完量新高，再从旧高动到新高）：步骤输出的折起摊开、「展开全部」都走这里，
// 别让一块内容凭空出现又凭空消失。动效关掉时直接改
function morphHeight(el, mutate, duration = 360) {
  if (!el || inkMotionOff() || typeof el.animate !== "function") return mutate();
  const from = el.getBoundingClientRect().height;
  mutate();
  const to = el.getBoundingClientRect().height;
  if (Math.abs(to - from) < 2) return;
  el._morph?.cancel();
  el.style.overflow = "hidden";
  const animation = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: "cubic-bezier(.22,.72,.2,1)" });
  el._morph = animation;
  animation.onfinish = animation.oncancel = () => {
    if (el._morph !== animation) return;
    el._morph = null;
    el.style.removeProperty("overflow");
  };
}
