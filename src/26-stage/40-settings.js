// 言 · 游目 · 设置里的一栏：接哪个浏览器、适应页面、搜索用哪家、下载存在哪
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 接法（调试口、放行来源、窗口挪到屏幕外）不必人写：言起 Playwright 的 MCP 时自己补齐，见 server/stage.js 的 prepareBrowser

function stageSettingsHtml() {
  const name = stageServer() || Object.keys(mcpConfigs()).find(key => mcpConfigs()[key] === stageConfig()) || "",
    linked = !!stageConfig(),
    state = !linked ? "尚未接入" : stage.ws ? `已接「${escapeHtml(name)}」，浏览器开着` : `已接「${escapeHtml(name)}」，浏览器未开`,
    browser = !linked
      ? `<button id="stageConnect" class="outline-btn" type="button">一键接入</button>`
      : `${stage.ws ? "" : `<button id="stageLaunchBtn" class="outline-btn" type="button">打开浏览器</button>`}<button id="stageToMcp" class="outline-btn" type="button">在 MCP 里改</button>`,
    output = stage.output || "";
  return (
    `<h2>游目</h2><p class="settings-lead">游目骋怀，足以极视听之娱。语出《兰亭集序》。</p>` +
    `<div class="setting-row"><div class="setting-copy"><strong>浏览器</strong><small>${state}</small></div><div class="setting-actions">${browser}</div></div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>接法</strong><small>调试口 ${stage.port || 9288}、只放行言与开发者工具、窗口挪到屏幕外——言起它时自动补齐，不必手写</small></div></div>` +
    segmentRow(
      "适应页面",
      "执事把视口定死时，等它歇手后铺满游目",
      "stageFit",
      [
        ["true", "开"],
        ["false", "关"]
      ],
      String(stageFitOn())
    ) +
    segmentRow(
      "搜索用",
      "地址栏里输的不像网址时",
      "stageSearch",
      Object.entries(STAGE_SEARCH).map(([key, [label]]) => [key, label]),
      stageSearchEngine()
    ) +
    `<div class="setting-row"><div class="setting-copy"><strong>下载存处</strong><small>${output ? `<code title="${escapeHtml(output)}">${escapeHtml(output)}</code>` : "那个服务工作目录下的 .playwright-mcp"}</small></div><button id="stageRevealOutput" class="outline-btn" type="button">打开文件夹</button></div>`
  );
}
// 一键接入：添一个 Playwright 的 MCP 服务——Edge、配置目录放在存储根的「游目」下（登录状态、收藏都在那里），模型可开本机文件迭代自己做的网页
function stageConnectBrowser() {
  const root = bootstrap.store?.root || "",
    name = mcpConfigs()["浏览器"] ? "游目浏览器" : "浏览器";
  store.settings.mcpServers = {
    ...store.settings.mcpServers,
    [name]: {
      command: "npx",
      args: [
        "-y",
        "@playwright/mcp@latest",
        "--browser",
        "msedge",
        ...(root ? ["--user-data-dir", `${root}\\游目\\浏览器`] : []),
        "--allow-unrestricted-file-access"
      ],
      note: "我说「打开浏览器」即指这个"
    }
  };
  saveStore();
  renderSettings();
  void mcpReady([name]).then(() => settingsTab === "stage" && renderSettings());
}
function bindStageSettings() {
  if (settingsTab !== "stage") return;
  $("#stageConnect")?.addEventListener("click", stageConnectBrowser);
  $("#stageLaunchBtn")?.addEventListener("click", () => void stageLaunch().then(() => settingsTab === "stage" && renderSettings()));
  $("#stageToMcp")?.addEventListener("click", () => openSettings("mcp"));
  $("#stageRevealOutput").addEventListener("click", () => {
    const config = stageConfig();
    void bridge("/api/stage/reveal", { args: config?.args || [], cwd: config?.cwd || "", path: "" }).catch(error =>
      toast(String(error.message || error).slice(0, 80))
    );
  });
  // 适应页面换了：留白处那一行跟着改说法，开着的话看能不能当即放开（存配置由设置页通用的那一路办）
  for (const button of document.querySelectorAll('[data-setting="stageFit"]'))
    button.addEventListener("click", () => {
      stageRenderLetter();
      stageMaybeRelease();
    });
}
