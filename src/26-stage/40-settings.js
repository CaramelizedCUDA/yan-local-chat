// 言 · 游目 · 设置里的一栏：游目自己的浏览器怎么配——开没开、用哪个浏览器、依赖、登录与收藏存在哪、许不许开本机文件。
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 浏览器不再要人去 MCP 里接：这里开着，言自己起一个 Playwright 的 MCP 服务，名叫「游目」（页面只递几项选择，桥接拼成整条、补齐接法，
// 见 server/stage.js 的 builtinConfig / prepareMcp）。家当都在存储根的「游目」目录里：依赖、浏览器（登录与收藏）、下载、内核。
// 适应页面、搜索用哪家开着游目就能调，在纸签里，不在这儿

// 运行时并进 mcpConfigs 的那一个：设置里开着才有
function stageBuiltinConfig() {
  const s = store.settings.stage;
  if (!s?.enabled) return null;
  return {
    stage: { browser: s.browser || "msedge", profile: s.profile || "", fileAccess: s.fileAccess !== false },
    note: "我说「打开浏览器」即指这个",
    timeout: 60
  };
}
/** @type {{ home: string, profile: string, output: string, installed: boolean, version: string, browsers: Record<string, boolean> } | null} */
let stageHomeState = null;
// 正在装的：依赖 deps / 内核 chromium
let stageInstalling = "";
const STAGE_BROWSERS = /** @type {const} */ ([
  ["msedge", "Edge"],
  ["chrome", "Chrome"],
  ["chromium", "自带内核"]
]);
// MCP 里另接着的 Playwright：迁过来，沿用它的登录与收藏，免得两边各起一个浏览器
function stageLegacyServer() {
  return Object.keys(mcpUserConfigs()).find(name => {
    const config = mcpUserConfigs()[name];
    return /@playwright[\\/]mcp|playwright-mcp|mcp-server-playwright/i.test([config.command || "", ...(config.args || [])].join(" "));
  });
}

function stageSettingsHtml() {
  if (!stageHomeState) void stageLoadHome();
  const s = store.settings.stage || {},
    at = stageHomeState,
    on = !!s.enabled,
    browser = s.browser || "msedge",
    legacy = stageLegacyServer(),
    code = (/** @type {string} */ text) => `<code title="${escapeHtml(text)}">${escapeHtml(text)}</code>`,
    seg = (/** @type {string} */ key, /** @type {[string, string, boolean?][]} */ items, /** @type {string} */ active) =>
      `<div class="segmented">${items.map(([value, label, off]) => `<button type="button" data-stage-opt="${key}" data-value="${value}" class="${value === active ? "active" : ""}${off ? " off" : ""}"${off ? ` title="本机未装"` : ""}>${label}</button>`).join("")}</div>`;
  const state = !on
    ? "关着：游目不起浏览器"
    : !at
      ? "……"
      : !at.installed
        ? "依赖未装，先在下面装上"
        : browser === "chromium" && !at.browsers.chromium
          ? "自带内核未装，先在下面装上"
          : stage.ws
            ? "浏览器开着"
            : "就绪，执事用到或你点「打开浏览器」时起";
  const deps = !at
    ? "……"
    : `${at.installed ? `@playwright/mcp ${escapeHtml(at.version)}` : "未装"}${browser === "chromium" ? ` · 自带内核${at.browsers.chromium ? "已装" : "未装"}` : ""}`;
  const installing = (/** @type {string} */ what, /** @type {string} */ label) =>
    `<button type="button" class="outline-btn" data-stage-install="${what}"${stageInstalling ? " disabled" : ""}>${stageInstalling === what ? "正在装…" : label}</button>`;
  return (
    `<h2>游目</h2><p class="settings-lead">游目骋怀，足以极视听之娱。</p>` +
    (legacy
      ? `<div class="setting-row"><div class="setting-copy"><strong>MCP 里的「${escapeHtml(legacy)}」</strong><small>另接着一个 Playwright，与游目各起一个浏览器；迁过来沿用它的登录与收藏，并从 MCP 里撤掉</small></div><button type="button" class="outline-btn" data-stage-migrate="${escapeHtml(legacy)}">迁过来</button></div>`
      : "") +
    `<div class="setting-row"><div class="setting-copy"><strong>游目</strong><small>${state}</small></div><div class="setting-actions">${on && at?.installed && !stage.ws ? `<button type="button" id="stageLaunchBtn" class="outline-btn">打开浏览器</button>` : ""}${seg(
      "enabled",
      [
        ["true", "开"],
        ["false", "关"]
      ],
      String(on)
    )}</div></div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>浏览器</strong><small>${browser === "chromium" ? "Playwright 自带的那个，装在游目里" : "用本机装着的"}</small></div>${seg(
      "browser",
      STAGE_BROWSERS.map(([value, label]) => [value, label, !!at && value !== "chromium" && !at.browsers[value]]),
      browser
    )}</div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>依赖</strong><small>${deps}</small></div><div class="setting-actions">${installing("deps", at?.installed ? "更新" : "安装")}${browser === "chromium" && at && !at.browsers.chromium ? installing("chromium", "装内核") : ""}</div></div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>登录与收藏</strong><small>${code(s.profile || at?.profile || "")}</small></div><div class="setting-actions"><button type="button" class="outline-btn" id="stageProfilePick">选择…</button>${s.profile ? `<button type="button" class="outline-btn" id="stageProfileReset">复原</button>` : ""}</div></div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>本机文件</strong><small>执事做的网页，自己开来看、改了再看</small></div>${seg(
      "fileAccess",
      [
        ["true", "许"],
        ["false", "不许"]
      ],
      String(s.fileAccess !== false)
    )}</div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>所在</strong><small>${at ? code(at.home) : "……"}</small></div><button type="button" class="outline-btn" id="stageRevealHome">打开文件夹</button></div>`
  );
}
async function stageLoadHome() {
  stageHomeState = await bridge("/api/stage/home", {}).catch(() => null);
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
/** @param {"deps" | "chromium"} what */
async function stageInstall(what) {
  stageInstalling = what;
  renderSettings();
  try {
    stageHomeState = await bridge(
      "/api/stage/install",
      { what, mirror: store.settings.env?.mirror || "china" },
      AbortSignal.timeout(15 * 60000)
    );
    toast(what === "deps" ? "依赖已装好" : "内核已装好");
    if (store.settings.stage?.enabled) stageSetOptions({});
  } catch (error) {
    toast(String(/** @type {any} */ (error).message || error).slice(0, 160), 6000);
  } finally {
    stageInstalling = "";
    if (settingsTab === "stage") renderSettings();
  }
}
/** @param {string} name */
function stageMigrate(name) {
  const config = mcpUserConfigs()[name],
    args = (config?.args || []).map(String),
    arg = (/** @type {string} */ key) => {
      const at = args.indexOf(key);
      return at >= 0 ? args[at + 1] || "" : args.find(item => item.startsWith(`${key}=`))?.slice(key.length + 1) || "";
    },
    browser = arg("--browser");
  const { [name]: _gone, ...rest } = mcpUserConfigs();
  store.settings.mcpServers = rest;
  // 预设里点名给了那个服务的，换成游目
  for (const preset of store.settings.presets || [])
    if (preset.mcp?.includes(name)) preset.mcp = [...new Set(preset.mcp.map(server => (server === name ? STAGE_SERVER : server)))];
  delete mcp.servers[name];
  stageSetOptions({
    enabled: true,
    ...(["msedge", "chrome", "chromium"].includes(browser) ? { browser: /** @type {"msedge"|"chrome"|"chromium"} */ (browser) } : {}),
    ...(arg("--user-data-dir") ? { profile: arg("--user-data-dir") } : {}),
    fileAccess: args.includes("--allow-unrestricted-file-access")
  });
  toast(`已迁过来：沿用「${name}」的登录与收藏${stageHomeState?.installed ? "" : "，依赖装上即可用"}`, 4000);
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
    if (target.dataset.stageInstall) return void stageInstall(/** @type {"deps" | "chromium"} */ (target.dataset.stageInstall));
    if (target.dataset.stageMigrate) return stageMigrate(target.dataset.stageMigrate);
    if (target.id === "stageLaunchBtn") return void stageLaunch().then(() => settingsTab === "stage" && renderSettings());
    if (target.id === "stageRevealHome" && stageHomeState)
      return void bridge("/api/stage/reveal", { path: stageHomeState.home }).catch(error =>
        toast(String(error.message || error).slice(0, 80))
      );
    if (target.id === "stageProfileReset") return stageSetOptions({ profile: "" });
    if (target.id === "stageProfilePick")
      return void bridge("/api/work/pick", { current: store.settings.stage?.profile || stageHomeState?.profile || "" })
        .then(({ path }) => path && stageSetOptions({ profile: path }))
        .catch(error => toast(String(error.message || error).slice(0, 80)));
  };
}
