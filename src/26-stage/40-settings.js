// 言 · 游目 · 设置里的一栏：游目自己的浏览器怎么配——开没开、用哪个浏览器、驱动、存储。本机文件一律许开，不设开关；存储不许另选，缺的目录起服务时自建。
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 浏览器不再要人去 MCP 里接：这里开着，言自己起一个 Playwright 的 MCP 服务，名叫「游目」（页面只递几项选择，桥接拼成整条、补齐接法，
// 见 server/stage.js 的 builtinConfig / prepareMcp）。家当都在存储根的「游目」目录里：依赖（驱动）、浏览器（登录与收藏）、下载、内核。
// 适应页面、搜索用哪家开着游目就能调，在纸签里，不在这儿；打开浏览器也在游目里点，这儿不另设

// 运行时并进 mcpConfigs 的那一个：设置里开着才有
function stageBuiltinConfig() {
  const s = store.settings.stage;
  if (!s?.enabled) return null;
  return {
    stage: { browser: s.browser || "msedge" },
    note: "我说「打开浏览器」即指这个",
    timeout: 60
  };
}
/** @type {{ home: string, output: string, installed: boolean, version: string, browsers: Record<string, boolean>, installing?: string, progress?: number | null } | null} */
let stageHomeState = null;
// 正在装的：驱动 deps / 内核 chromium；内核下到几成（装着时隔两秒问一次桥接）
let stageInstalling = "",
  /** @type {number | null} */ stageProgress = null;
const STAGE_BROWSERS = /** @type {const} */ ([
  ["msedge", "Edge"],
  ["chrome", "Chrome"],
  ["chromium", "自带内核"]
]);
// 本机没装 Edge / Chrome 时，「去下载」交给系统浏览器开官网（装系统浏览器要管理员权限，言不代装）
const STAGE_BROWSER_SITES = {
  msedge: "https://www.microsoft.com/zh-cn/edge/download",
  chrome: "https://www.google.com/intl/zh-CN/chrome/"
};
function stageSettingsHtml() {
  if (!stageHomeState) void stageLoadHome();
  const s = store.settings.stage || {},
    at = stageHomeState,
    on = !!s.enabled,
    browser = s.browser || "msedge",
    browserLabel = STAGE_BROWSERS.find(([value]) => value === browser)?.[1] || "Edge",
    // 选了本机没装的 Edge / Chrome
    missing = !!at && browser !== "chromium" && !at.browsers[browser],
    code = (/** @type {string} */ text) => `<code title="${escapeHtml(text)}">${escapeHtml(text)}</code>`,
    seg = (/** @type {string} */ key, /** @type {[string, string, boolean?][]} */ items, /** @type {string} */ active) =>
      `<div class="segmented">${items.map(([value, label, off]) => `<button type="button" data-stage-opt="${key}" data-value="${value}" class="${value === active ? "active" : ""}${off ? " off" : ""}"${off ? ` title="本机未装"` : ""}>${label}</button>`).join("")}</div>`;
  const state = !on
    ? "已关，执事碰不到浏览器"
    : !at
      ? "……"
      : !at.installed
        ? "还缺驱动，先在下面装上"
        : browser === "chromium" && !at.browsers.chromium
          ? "还缺内核，先在下面装上"
          : missing
            ? `本机没装 ${browserLabel}，先装上或换一个`
            : stage.ws
              ? "正开着，在右侧那一笔朱竖里"
              : "执事要看网页时自会打开";
  const deps = !at ? "……" : at.installed ? `执事借它翻页、点按、填写 · ${escapeHtml(at.version)} 版` : "未装，执事还使不动浏览器";
  const installing = (/** @type {string} */ what, /** @type {string} */ label) =>
    `<button type="button" class="outline-btn" data-stage-install="${what}"${stageInstalling ? " disabled" : ""}>${stageInstalling === what ? stageInstallLabel() : label}</button>`;
  return (
    `<h2>游目</h2><p class="settings-lead">游目骋怀，足以极视听之娱。</p>` +
    `<div class="setting-row"><div class="setting-copy"><strong>游目</strong><small>${state}</small></div>${seg(
      "enabled",
      [
        ["true", "开"],
        ["false", "关"]
      ],
      String(on)
    )}</div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>浏览器</strong><small>${
      browser === "chromium"
        ? `不借本机的，另装一个放在游目里${at && !at.browsers.chromium ? "，还没装" : ""}`
        : missing
          ? `本机没装 ${browserLabel}：装好即用，或选自带内核`
          : `借本机的 ${browserLabel} 另起一份，与平日所用互不相扰`
    }</small></div><div class="setting-actions">${missing ? `<button type="button" class="outline-btn" data-stage-get="${browser}">去下载</button>` : ""}${browser === "chromium" && at && !at.browsers.chromium ? installing("chromium", "装内核") : ""}${seg(
      "browser",
      STAGE_BROWSERS.map(([value, label]) => [value, label, !!at && value !== "chromium" && !at.browsers[value]]),
      browser
    )}</div></div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>驱动</strong><small>${deps}</small></div>${installing("deps", at?.installed ? "更新" : "安装")}</div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>存储</strong><small>登录、收藏、下载都在这里 ${at ? code(at.home) : "……"}</small></div><button type="button" class="outline-btn" id="stageRevealHome">打开文件夹</button></div>`
  );
}
async function stageLoadHome() {
  stageHomeState = await bridge("/api/stage/home", {}).catch(() => null);
  // 页面刷新前点过「安装」、桥接那边还在装：接着等那一趟（桥接不另起一个），装完照常报
  const going = stageHomeState?.installing;
  if ((going === "deps" || going === "chromium") && !stageInstalling) return void stageInstall(going);
  if (stageHomeState && settingsTab === "stage" && !$("#settingsModal").classList.contains("hidden")) renderSettings();
}
/** @param {Partial<NonNullable<typeof store.settings.stage>>} patch */
function stageSetOptions(patch) {
  store.settings.stage = { ...(store.settings.stage || {}), ...patch };
  saveStore();
  delete mcp.servers[STAGE_SERVER];
  void mcpReady([STAGE_SERVER]).then(() => settingsTab === "stage" && renderSettings());
  renderSettings();
}
function stageInstallLabel() {
  return stageProgress === null ? "正在装…" : `正在装 ${stageProgress}%`;
}
/** @param {"deps" | "chromium"} what */
async function stageInstall(what) {
  stageInstalling = what;
  stageProgress = null;
  renderSettings();
  // 只改按钮上的字，不整页重画（免得打断别的点按）
  const ticker = setInterval(async () => {
    const at = await bridge("/api/stage/home", {}).catch(() => null);
    if (typeof at?.progress !== "number") return;
    stageProgress = at.progress;
    const button = document.querySelector(`#settingsContent [data-stage-install="${what}"]`);
    if (button) button.textContent = stageInstallLabel();
  }, 2000);
  try {
    stageHomeState = await bridge("/api/stage/install", { what }, AbortSignal.timeout(15 * 60000));
    toast(what === "deps" ? "驱动已装好" : "内核已装好");
    if (store.settings.stage?.enabled) stageSetOptions({});
  } catch (error) {
    toast(String(/** @type {any} */ (error).message || error).slice(0, 160), 6000);
  } finally {
    clearInterval(ticker);
    stageInstalling = "";
    stageProgress = null;
    if (settingsTab === "stage") renderSettings();
  }
}
function bindStageSettings() {
  const page = $("#settingsContent");
  // 只在这一栏接点按；换到别栏即撤
  page.onclick = null;
  if (settingsTab !== "stage") return;
  page.onclick = event => {
    const target = /** @type {HTMLElement} */ (event.target).closest("button");
    if (!target) return;
    const opt = target.dataset.stageOpt;
    if (opt) {
      const value = target.dataset.value || "";
      return stageSetOptions(opt === "browser" ? { browser: /** @type {any} */ (value) } : { [opt]: value === "true" });
    }
    if (target.dataset.stageGet)
      return void bridge("/api/stage/open", {
        url: STAGE_BROWSER_SITES[/** @type {"msedge" | "chrome"} */ (target.dataset.stageGet)]
      }).catch(error => toast(String(error.message || error).slice(0, 80)));
    if (target.dataset.stageInstall) return void stageInstall(/** @type {"deps" | "chromium"} */ (target.dataset.stageInstall));
    if (target.id === "stageRevealHome" && stageHomeState)
      return void bridge("/api/stage/reveal", { path: stageHomeState.home }).catch(error =>
        toast(String(error.message || error).slice(0, 80))
      );
  };
}
