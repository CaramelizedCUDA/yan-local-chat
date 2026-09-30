// 言 · 看台：模型所用的那个浏览器（playwright 等以 --remote-debugging-port 起的 Edge / Chrome），页面直接连它的调试口看画面、递点按。
// 桥接只替页面问一句它的地址：连浏览器的那条 WebSocket 须带上浏览器的 id，而调试口的 /json 不给跨源读。
// 标签页、画面、输入都在页面里（src/26-stage.js），不过桥接，这里也不记任何东西
"use strict";
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
  return { routes: { "POST /api/stage": locate } };
};
