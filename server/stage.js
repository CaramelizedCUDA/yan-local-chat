// 言 · 看台：模型所用的那个浏览器（playwright 等以 --remote-debugging-port 起的 Edge / Chrome），页面直接连它的调试口看画面、递点按。
// 桥接只替页面问一句它的地址：连浏览器的那条 WebSocket 须带上浏览器的 id，而调试口的 /json 不给跨源读。
// 标签页、画面、输入都在页面里（src/26-stage.js），不过桥接，这里也不记任何东西。
// 另读一份收藏：看台只转网页，浏览器自己的收藏栏看不到；收藏存在浏览器配置目录的 Default/Bookmarks 里
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { sendJson, readJson } = require("./http.js");

module.exports = function createStage() {
  async function locate(req, res) {
    const port = Number((await readJson(req)).port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return sendJson(res, 400, { error: "端口无效" });
    const get = path => fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) }).then(r => r.json());
    try {
      const [version, list] = await Promise.all([get("/json/version"), get("/json/list")]);
      // /json/list 按最近活动排，头一个页面即浏览器前台的那一页——多半就是模型正在用的
      sendJson(res, 200, { ws: version.webSocketDebuggerUrl || "", front: list.find(t => t.type === "page")?.id || "" });
    } catch {
      // 浏览器没开：不算错，页面等下一次
      sendJson(res, 200, { ws: "" });
    }
  }
  // dir 是浏览器的配置目录（MCP 配置里 --user-data-dir 那一项）；只回名字、网址与夹的层次，读不到就是空的
  async function bookmarks(req, res) {
    const dir = String((await readJson(req)).dir || "");
    /** @returns {any} */
    const slim = node =>
      node.type === "folder" ? { name: node.name, children: (node.children || []).map(slim) } : { name: node.name, url: node.url };
    try {
      const roots = JSON.parse(await fs.promises.readFile(path.join(dir, "Default", "Bookmarks"), "utf8")).roots || {};
      sendJson(res, 200, { bar: (roots.bookmark_bar?.children || []).map(slim), other: (roots.other?.children || []).map(slim) });
    } catch {
      sendJson(res, 200, { bar: [], other: [] });
    }
  }
  return { routes: { "POST /api/stage": locate, "POST /api/stage/bookmarks": bookmarks } };
};
