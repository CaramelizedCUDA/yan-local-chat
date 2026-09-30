# 看台

[← 文档目录](README.md)

模型借浏览器类的 MCP（如 playwright）上网、测它做的网页时，那个浏览器的画面收在言的右侧一栏，不再是屏幕上另开、挡人的一扇窗。看台上可点、可滚、可打字（输入法照常），标签与浏览器同步：模型新开一页，看台跟过去；点别的签，看那一页。

## 接法

浏览器仍由 MCP 起、关与操作，只多三个启动参数：开调试口 `9288`、放行言的页面、窗口挪到屏幕外。以 playwright 为例，写一份配置文件（如 `stage.json`）：

```json
{
  "browser": {
    "launchOptions": {
      "args": ["--remote-debugging-port=9288", "--remote-allow-origins=http://127.0.0.1:8787", "--window-position=-32000,-32000"]
    }
  }
}
```

在 设置 → MCP 里那个服务的 `args` 末尾添上 `--config` 与这份文件的路径；另添 `--allow-unrestricted-file-access`，模型才开得了本机的 `file://` 页，做出来的网页自己打开来看、改了再看，不必经人手：

```json
"浏览器": {
  "command": "node",
  "args": ["…/@playwright/mcp/cli.js", "--browser", "msedge", "--user-data-dir", "…/.edge-profile",
           "--config", "…/stage.json", "--allow-unrestricted-file-access"]
}
```

- 调试口取 `9288` 而不取常见的 9222 / 9223：那两个常被远程调试的端口转发占着（`netsh interface portproxy`），占了 IPv4 的，浏览器只能退到 IPv6 上听，看台便找不到它。要换端口，改这里与 `src/26-stage.js` 里的 `port`。
- 任务栏上会多一枚 Edge：那就是这个浏览器，窗口在屏幕外，点它看不到东西，看它请到看台。
- 在服务的「给模型的话」里写一句「我说打开浏览器即指这个」，模型便不会去开系统默认的浏览器。
- 窗口挪到屏幕外而不用无头模式：无头的 Edge 在 UA 里带 `HeadlessChrome`，有的站点认得出来；屏幕外的窗口与平常无异，画面照出。
- `--remote-allow-origins` 只放行言的页面；别的网站连不上这个调试口。换了桥接端口（`YAN_PORT`）的，这里跟着改。
- 多个项目的网页（要构建的）照常起开发服务器，模型在浏览器里开 `localhost`。

## 用法

- 模型一开浏览器，顶栏右侧挂出一架小屏；点它开看台。收起看台，小屏回来。
- 模型正在操作浏览器（调 `browser_*` 工具）时，小屏与地址栏旁各有一粒朱。
- 拖看台左缘调宽窄，宽度记在本机；「阔」铺满整页，Esc 退回。旁注也在右侧，旁注开着时看台暂让。
- 点画面即把键盘交给那一页：按键（含 Ctrl+C / V）、输入法打的字都递进去；点言的别处即收回。
- 地址栏可直接输网址、`localhost:端口`、本机路径（`E:\…\index.html`）。

## 怎么做的

- 看台是那个浏览器的另一位看客：页面直连调试口，`Page.startScreencast` 收画面，`Input.*` 递点按，标签照 `Target.setDiscoverTargets` 抄。画面不过桥接；桥接只替页面问出连接的地址（`server/stage.js`，调试口的 `/json` 不给跨源读）。
- 网页的尺寸由浏览器那头定（playwright 默认 1280×720），看台只按宽高里较紧的一边缩放，不放大过原尺寸；点按按同一倍数换算回去。
- 何时去连：开页时，与每次 `browser_*` 调用之后（浏览器多半是这时起的）。浏览器关了看台清空，不轮询。
- 网页改标题浏览器不发通知：看台开着时每一秒半问一次标签列表。
- 代码：`src/26-stage.js`、`styles/56-stage.css`；测试 `test/stage.mjs` 借测试用的 Edge 充当模型的浏览器。
