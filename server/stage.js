// 言 · 看台：模型所用的那个浏览器（playwright 等以 --remote-debugging-port 起的 Edge / Chrome），页面直接连它的调试口看画面、递点按。
// 桥接只替页面问一句它的地址：连浏览器的那条 WebSocket 须带上浏览器的 id，而调试口的 /json 不给跨源读。
// 调试口与配置目录不另设：从那个 MCP 服务的参数里读——直接写在参数里的（--cdp-endpoint、--user-data-dir），或写在 --config 那份文件里的。
// 标签页、画面、输入都在页面里（src/26-stage.js），不过桥接，这里也不记任何东西。
// 另读一份收藏：看台只转网页，浏览器自己的收藏栏看不到；收藏存在浏览器配置目录的 Default/Bookmarks 里。
// 再收几份要传给网页的文件：网页要人选文件时，浏览器的选文件窗口在屏幕外，人在言这边选好，落到临时目录，交路径给浏览器
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sendJson, readJson } = require("./http.js");

// 参数里哪一项都没写调试口时的默认（见 docs/stage.md：避开常被端口转发占着的 9222 / 9223）
const DEFAULT_PORT = 9288;

/** @param {unknown[]} raw MCP 服务的 args @returns {{ port: number, dir: string }} */
function browserOf(raw) {
  const args = (Array.isArray(raw) ? raw : []).map(String);
  /** @param {string} name */
  const arg = name => {
    const at = args.indexOf(name);
    if (at >= 0) return args[at + 1] || "";
    return args.find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
  };
  let file = /** @type {any} */ ({});
  try {
    file = JSON.parse(fs.readFileSync(arg("--config"), "utf8")).browser || {};
  } catch {}
  const launch = (file.launchOptions?.args || []).map(String),
    endpoint = arg("--cdp-endpoint") || String(file.cdpEndpoint || ""),
    port =
      Number(endpoint.match(/:(\d+)/)?.[1]) ||
      Number(launch.find(item => item.startsWith("--remote-debugging-port="))?.split("=")[1]) ||
      DEFAULT_PORT;
  return { port, dir: arg("--user-data-dir") || String(file.userDataDir || "") };
}
/** @param {string} dir */
const bookmarksFile = dir => path.join(dir, "Default", "Bookmarks");

module.exports = function createStage() {
  async function locate(req, res) {
    const { port, dir } = browserOf((await readJson(req)).args);
    const marks = !!dir && fs.existsSync(bookmarksFile(dir));
    const get = path => fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) }).then(r => r.json());
    try {
      const [version, list] = await Promise.all([get("/json/version"), get("/json/list")]);
      // /json/list 按最近活动排，头一个页面即浏览器前台的那一页——多半就是模型正在用的
      sendJson(res, 200, { ws: version.webSocketDebuggerUrl || "", front: list.find(t => t.type === "page")?.id || "", port, marks });
    } catch {
      // 浏览器没开：不算错，页面等下一次
      sendJson(res, 200, { ws: "", port, marks });
    }
  }
  // 只回名字、网址与夹的层次，读不到就是空的
  async function bookmarks(req, res) {
    const { dir } = browserOf((await readJson(req)).args);
    /** @returns {any} */
    const slim = node =>
      node.type === "folder" ? { name: node.name, children: (node.children || []).map(slim) } : { name: node.name, url: node.url };
    try {
      const roots = JSON.parse(await fs.promises.readFile(bookmarksFile(dir), "utf8")).roots || {};
      sendJson(res, 200, { bar: (roots.bookmark_bar?.children || []).map(slim), other: (roots.other?.children || []).map(slim) });
    } catch {
      sendJson(res, 200, { bar: [], other: [] });
    }
  }
  // 一回一个文件：{ name, data: dataURL } → 落盘的路径。一天前落的顺手清掉
  async function upload(req, res) {
    const { name, data } = await readJson(req),
      text = String(data || ""),
      comma = text.indexOf(","),
      root = path.join(os.tmpdir(), "yan-stage-upload");
    if (!text.startsWith("data:") || comma < 0) return sendJson(res, 400, { error: "文件内容无效" });
    try {
      for (const old of fs.readdirSync(root))
        if (Date.now() - Number(old.split("-")[0]) > 86400000) fs.rmSync(path.join(root, old), { recursive: true, force: true });
    } catch {}
    const dir = path.join(root, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      file = path.join(dir, path.basename(String(name || "文件")).replace(/[<>:"/\\|?*]/g, "_") || "文件");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(text.slice(comma + 1), /;base64/i.test(text.slice(0, comma)) ? "base64" : "utf8"));
    sendJson(res, 200, { path: file });
  }
  return { routes: { "POST /api/stage": locate, "POST /api/stage/bookmarks": bookmarks, "POST /api/stage/upload": upload } };
};
module.exports.browserOf = browserOf;
