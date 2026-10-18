// 言 · 游目 · Office 引擎：docx / xlsx / pptx 在游目里原生编辑。引擎是 OnlyOffice 的网页版（ranuts/document 那一份：sdkjs + web-apps +
// x2t 编成的 WASM，全在浏览器里跑，不要服务器）。
// 不随言分发：设置 → 游目里点「安装」，现场取钉死的那一版源码、装依赖、构建，只留编辑器要的那些，源码与依赖随即删掉——同环境里的工具包一样现装。
// 引擎另起一个本机端口服务，与言的页面不同源：它是外来代码，碰不到桥接的接口。要开哪份文件，言的页面向桥接领一张凭据（token），
// 引擎那头只能凭它读写那一份。宿主页（office-host.html）把编辑器装进 iframe，经它的嵌入接口开、存、切只读；
// 另听一条事件流：执事作答前存盘并锁住、答完放开（文件被改过就重新载入）——人与执事轮流写同一份文件，不合并。
// 存回时带上自己最后见到的指纹（同 server/work/files.js 的写法），文件在这期间被别人改过就不覆盖，宿主页提示重新载入。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { sendJson, readJson } = require("./http.js");
const { pickSource } = require("./mirror.js");
const platform = require("./platform.js");
const { unpack } = require("./env/index.js");

// 钉死的上游版本：每台机器构建出来都一样；要升级上游，改这里并照 docs/stage.md 的步骤实测
const COMMIT = "283ca850ab99cf33ff8e3cf18911488b40576cb7";
const SOURCE = `https://codeload.github.com/ranuts/document/tar.gz/${COMMIT}`;
// 源码包约 205 MB（codeload 不报长度，进度按它估）
const SOURCE_BYTES = 205 * 1048576;
// 引擎认得的几种：扩展名 → 嵌入接口存回时的格式
const OFFICE_EXTS = new Set(["docx", "xlsx", "pptx", "doc", "xls", "ppt", "odt", "ods", "odp", "rtf", "csv"]);

/** @param {string} root 存储根 */
function officeHome(root) {
  const deps = path.join(root, "游目", "依赖");
  // 构建目录取短名：pnpm 打补丁时 chdir 进 node_modules/.pnpm 深处，Windows 上 chdir 受 260 字的限制（开了长路径也一样）
  return { dir: path.join(deps, "office"), build: path.join(deps, ".ob"), stamp: path.join(deps, "office", "yan-office.json") };
}
/** @param {string} root */
function officeState(root) {
  try {
    const stamp = JSON.parse(fs.readFileSync(officeHome(root).stamp, "utf8"));
    return { installed: true, commit: String(stamp.commit || "").slice(0, 7), current: stamp.commit === COMMIT };
  } catch {
    return { installed: false, commit: "", current: false };
  }
}

// ---------- 现装 ----------
// 下载到文件，边下边报字节数；先写 .part，下完才改名
async function fetchTo(url, file, onBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(40 * 60000) });
  if (!response.ok || !response.body) throw Error(`源码下载失败（HTTP ${response.status}）`);
  let got = 0;
  const body = Readable.fromWeb(/** @type {any} */ (response.body));
  body.on("data", chunk => onBytes((got += chunk.length)));
  await pipeline(body, fs.createWriteStream(`${file}.part`));
  fs.renameSync(`${file}.part`, file);
}
// 在 cwd 里跑一步，退出码不为 0 即失败，带上最后几行
function step(file, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...platform.OWN_GROUP });
    let tail = "";
    const keep = (/** @type {Buffer} */ chunk) => (tail = (tail + chunk.toString()).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").slice(-1500));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", code =>
      code === 0
        ? resolve(undefined)
        : reject(Error(`${path.basename(args[0] || file)}：${tail.trim().split("\n").slice(-3).join(" / ") || `退出码 ${code}`}`))
    );
  });
}
// 只留编辑器要的：各语言的落地页与帮助、站点地图、IE 兼容、移动版、Visio、中英以外的界面语言、本地 AI 的模型运行时都不要。
// 许可证（LICENSE、NOTICE、licenses/）留着——AGPL 要随附
const DROP_TOP = new Set([
  "de",
  "es",
  "ja",
  "ko",
  "pt",
  "zh-CN",
  "fa",
  "convert",
  "open",
  "help",
  "social",
  "_headers",
  "_redirects",
  "_routes.json",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "llms-full.txt",
  "landing.css",
  "landing-prefetch.js",
  "home.css",
  "lang-switch.js",
  "history-recent.js"
]);
/** @param {string} rel 相对构建产物、以 / 分隔 */
function dropped(rel) {
  const top = rel.split("/")[0];
  if (DROP_TOP.has(top)) return true;
  if (!rel.includes("/") && rel.endsWith(".html") && rel !== "editor.html") return true;
  if (/(^|\/)(ie|mobile)(\/|$)/.test(rel) || /^(sdkjs\/visio|web-apps\/apps\/visioeditor)(\/|$)/.test(rel)) return true;
  if (/\/locale\/[^/]+\.json$/.test(rel) && !/\/locale\/(en|zh)\.json$/.test(rel)) return true;
  return /^assets\/wllama-[^/]+\.wasm$/.test(rel);
}
function copyTrimmed(from, to, rel = "") {
  for (const entry of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const sub = rel ? `${rel}/${entry.name}` : entry.name;
    if (dropped(sub)) continue;
    if (entry.isDirectory()) copyTrimmed(from, to, sub);
    else {
      fs.mkdirSync(path.join(to, rel), { recursive: true });
      fs.copyFileSync(path.join(from, sub), path.join(to, sub));
    }
  }
}
// 删目录：构建里有成千上万个小文件，偶有被杀毒软件攥着的，删不掉的留给下回
const removeDir = dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
/**
 * 取源码 → 装依赖 → 构建 → 只留要的；onProgress 报百分数。构建照上游 bin/build.sh 里编辑器要的那几步，只用 Node
 * （便携版的机器上未必有 sh）；pnpm 的仓库放在构建目录里，装完连同源码一起删掉，不在系统里留下几百兆
 * @param {string} root @param {(percent: number) => void} onProgress
 */
async function installOffice(root, onProgress) {
  const at = officeHome(root),
    next = `${at.dir}.new`;
  removeDir(at.build);
  fs.mkdirSync(at.build, { recursive: true });
  try {
    const tarball = path.join(at.build, "source.tar.gz");
    await fetchTo(SOURCE, tarball, got => onProgress(Math.min(30, Math.floor((got / SOURCE_BYTES) * 30))));
    await unpack(tarball, at.build);
    // 源码目录改成一个字（pnpm 在 Windows 上本就把 .pnpm 下的目录名压在 60 字内）：最深的那条路（打了补丁的 web-llm）落在 260 字以内
    const src = path.join(at.build, "s");
    fs.renameSync(path.join(at.build, `document-${COMMIT}`), src);
    onProgress(35);
    const pnpm = String(JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).packageManager || "pnpm@11.4.0"),
      registry = (await pickSource()) === "china" ? "https://registry.npmmirror.com" : "https://registry.npmjs.org",
      // npx 取 pnpm 本身认这个变量；pnpm 11 不认 npm_config_*，下载源在它的命令行上另给
      env = { ...process.env, npm_config_registry: registry, CI: "1" },
      npx = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"),
      node = process.execPath;
    // 取包超时放宽到十分钟、多试几回：走代理或网慢时，默认的一分钟常卡在某个大包上。写进 pnpm-workspace.yaml（pnpm 11 的设置在这里）——
    // 命令行上的 --config.fetch-timeout 传进去是字串，pnpm 一个包也不下、就那么挂着（实测）
    fs.appendFileSync(path.join(src, "pnpm-workspace.yaml"), "\nfetchTimeout: 600000\nfetchRetries: 5\n");
    await step(
      node,
      [npx, "-y", pnpm, "install", "--frozen-lockfile", `--registry=${registry}`, `--store-dir=${path.join(at.build, "st")}`],
      src,
      env
    );
    onProgress(75);
    for (const args of [
      ["bin/locale-fill.mjs"],
      ["node_modules/vite/bin/vite.js", "build"],
      ["bin/editor-csp.mjs", "dist"],
      ["bin/offline-assets.mjs", "dist"]
    ])
      await step(node, args, src, env);
    onProgress(90);
    removeDir(next);
    copyTrimmed(path.join(src, "dist"), next);
    // 上游构建脚本拿 sh 填的两个版本戳（离线缓存按它分代）
    const sw = path.join(next, "sw.js");
    if (fs.existsSync(sw))
      fs.writeFileSync(
        sw,
        fs
          .readFileSync(sw, "utf8")
          .replace(/SW_VERSION_PLACEHOLDER/g, String(Date.now()))
          .replace(/VENDOR_VERSION_PLACEHOLDER/g, COMMIT.slice(0, 12))
      );
    fs.writeFileSync(
      path.join(next, "yan-office.json"),
      JSON.stringify({ commit: COMMIT, source: SOURCE, built: new Date().toISOString() }, null, 2)
    );
    removeDir(at.dir);
    fs.renameSync(next, at.dir);
    onProgress(100);
  } finally {
    removeDir(at.build);
  }
}

// ---------- 服务 ----------
// 引擎的端口：桥接口 + 2，占了就随便取一个（取到的口每次起桥接都可能不同，编辑器的本地设置随之换一份，无碍）
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml"
};
// 编辑器的 WASM 要多线程，页面得是隔离的（COOP / COEP）；同源的资源都标上 CORP
const ISOLATED = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-cache"
};
const fingerprint = (/** @type {Buffer} */ buffer) => crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 16);

/** @param {{ root: () => string, bridgePort: number }} options */
function createOffice({ root, bridgePort }) {
  /** 凭据 → 那一份文件；同一份文件只发一张 @type {Map<string, { path: string, conversation: string, hosts: Set<http.ServerResponse>, waiters: Map<string, (state: any) => void> }>} */
  const docs = new Map();
  /** @type {http.Server | null} */
  let server = null;
  /** @type {Promise<number> | null} */
  let listening = null;
  const docOf = (/** @type {string} */ token) => docs.get(String(token || ""));
  const tokenOf = (/** @type {string} */ file) => [...docs].find(([, doc]) => doc.path === file)?.[0];

  function serveStatic(/** @type {string} */ rel, /** @type {http.ServerResponse} */ res) {
    const base = officeHome(root()).dir,
      file = path.resolve(base, `.${rel}`);
    let target = file;
    if (target !== base && !target.startsWith(base + path.sep)) return void res.writeHead(403, ISOLATED).end();
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
    if (!fs.existsSync(target) && fs.existsSync(`${target}.html`)) target += ".html";
    if (!fs.existsSync(target)) return void res.writeHead(404, ISOLATED).end();
    const head = { ...ISOLATED };
    // 解压后的 x2t 有四十多兆，上游只放了 brotli 压过的一份，标上编码让浏览器自己解
    if (target.endsWith(".wasm.br")) Object.assign(head, { "Content-Type": "application/wasm", "Content-Encoding": "br" });
    else head["Content-Type"] = MIME[/** @type {keyof typeof MIME} */ (path.extname(target).toLowerCase())] || "application/octet-stream";
    res.writeHead(200, head);
    fs.createReadStream(target).pipe(res);
  }
  // 引擎那头：静态文件、宿主页，与凭着凭据的几件——取文件、存回、听吩咐、回话
  async function handle(/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) {
    // 只认本机回环的地址（挡 DNS 重绑定：别的网站把自己的域名解析到 127.0.0.1 再来读）
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ""))) return void res.writeHead(403).end();
    const url = new URL(req.url || "/", "http://127.0.0.1"),
      doc = docOf(url.searchParams.get("t") || "");
    try {
      if (url.pathname === "/yan/host.html") {
        res.writeHead(200, { ...ISOLATED, "Content-Type": "text/html; charset=utf-8" });
        return void res.end(fs.readFileSync(path.join(__dirname, "office-host.html")));
      }
      if (!url.pathname.startsWith("/yan/")) return serveStatic(decodeURIComponent(url.pathname), res);
      if (!doc) return sendJson(res, 404, { error: "凭据已失效：桥接重启过，请从言里重新打开这份文件" });
      if (url.pathname === "/yan/file" && req.method === "GET") {
        const buffer = await fs.promises.readFile(doc.path);
        res.writeHead(200, {
          ...ISOLATED,
          "Content-Type": "application/octet-stream",
          "X-Yan-Sig": fingerprint(buffer),
          "X-Yan-Name": encodeURIComponent(path.basename(doc.path))
        });
        return void res.end(buffer);
      }
      if (url.pathname === "/yan/sig") return sendJson(res, 200, { sig: fingerprint(await fs.promises.readFile(doc.path)) });
      if (url.pathname === "/yan/file" && req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const buffer = Buffer.concat(chunks),
          seen = url.searchParams.get("seen") || "",
          now = fingerprint(await fs.promises.readFile(doc.path));
        if (seen && seen !== now) return sendJson(res, 409, { stale: true, sig: now });
        const temp = `${doc.path}.yan-${process.pid}.tmp`;
        await fs.promises.writeFile(temp, buffer);
        await fs.promises.rename(temp, doc.path);
        return sendJson(res, 200, { sig: fingerprint(buffer) });
      }
      // 吩咐走事件流：一份文件可能在几个标签里开着，几处都听
      if (url.pathname === "/yan/events") {
        res.writeHead(200, { ...ISOLATED, "Content-Type": "text/event-stream", Connection: "keep-alive" });
        res.write(": open\n\n");
        doc.hosts.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25000);
        req.on("close", () => {
          clearInterval(ping);
          doc.hosts.delete(res);
        });
        return;
      }
      if (url.pathname === "/yan/ack" && req.method === "POST") {
        const body = await readJson(req);
        doc.waiters.get(String(body.id || ""))?.(body);
        return sendJson(res, 200, { ok: true });
      }
      sendJson(res, 404, { error: "没有这个接口" });
    } catch (error) {
      sendJson(res, 500, { error: String(/** @type {any} */ (error).message || error) });
    }
  }
  function listen() {
    return (listening ||= new Promise((resolve, reject) => {
      const tryPort = (/** @type {number} */ port) => {
        const s = http.createServer(handle);
        s.once("error", (/** @type {any} */ error) => (error.code === "EADDRINUSE" && port ? tryPort(0) : reject(error)));
        s.listen(port, "127.0.0.1", () => {
          server = s;
          resolve(/** @type {any} */ (s.address()).port);
        });
      };
      tryPort(bridgePort + 2);
    }).catch(error => {
      listening = null;
      throw error;
    }));
  }
  // 吩咐开着这份文件的各处（存盘 / 锁住 / 放开），等它们回话；没人开着就当场回，几秒不回也不干等
  async function command(/** @type {string} */ token, /** @type {string} */ cmd) {
    const doc = docOf(token);
    if (!doc || !doc.hosts.size) return { hosts: 0 };
    const id = crypto.randomBytes(6).toString("hex");
    const answers = await Promise.all(
      [...doc.hosts].map(
        (host, i) =>
          new Promise(resolve => {
            const key = `${id}-${i}`,
              timer = setTimeout(() => {
                doc.waiters.delete(key);
                resolve(null);
              }, 15000);
            doc.waiters.set(key, state => {
              clearTimeout(timer);
              doc.waiters.delete(key);
              resolve(state);
            });
            host.write(`data: ${JSON.stringify({ id: key, cmd })}\n\n`);
          })
      )
    );
    return { hosts: doc.hosts.size, answers: answers.filter(Boolean) };
  }

  // ---------- 言的页面那头（受信的接口） ----------
  // 开一份：领凭据，回宿主页的地址（游目去开它）；conversation 记着是从哪段对话开的，作答时只锁那一段开的
  async function open(/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) {
    try {
      const body = await readJson(req),
        file = path.resolve(String(body.path || ""));
      if (!officeState(root()).installed) throw Error("Office 引擎还没装：设置 → 游目里安装");
      if (!OFFICE_EXTS.has(path.extname(file).slice(1).toLowerCase())) throw Error("这种文件不归 Office 引擎");
      if (!fs.existsSync(file)) throw Error("文件不在了");
      const port = await listen();
      let token = tokenOf(file);
      if (!token)
        docs.set((token = crypto.randomBytes(18).toString("base64url")), {
          path: file,
          conversation: "",
          hosts: new Set(),
          waiters: new Map()
        });
      const doc = /** @type {NonNullable<ReturnType<typeof docOf>>} */ (docOf(token));
      doc.conversation = String(body.conversation || "");
      const params = new URLSearchParams({
        t: token,
        locale: body.locale === "en" ? "en" : "zh-CN",
        theme: body.theme === "dark" ? "dark" : "light"
      });
      sendJson(res, 200, { url: `http://127.0.0.1:${port}/yan/host.html?${params}`, token, name: path.basename(file) });
    } catch (error) {
      sendJson(res, 400, { error: String(/** @type {any} */ (error).message || error) });
    }
  }
  // 吩咐某段对话开着的各份（作答前 save+lock、答完 unlock）；不给 conversation 就是全部
  async function relay(/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) {
    const body = await readJson(req),
      cmd = ["save", "lock", "unlock"].includes(body.cmd) ? body.cmd : "",
      conversation = String(body.conversation || "");
    if (!cmd) return sendJson(res, 400, { error: "不认得的吩咐" });
    const out = [];
    for (const [token, doc] of docs)
      if (doc.hosts.size && (!conversation || doc.conversation === conversation))
        out.push({ path: doc.path, ...(await command(token, cmd)) });
    sendJson(res, 200, { docs: out });
  }
  // 此刻开着（有宿主页连着）的几份：作答时告诉模型用户在看哪份
  async function list(/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) {
    const body = await readJson(req),
      conversation = String(body.conversation || "");
    sendJson(res, 200, {
      docs: [...docs.values()]
        .filter(doc => doc.hosts.size && (!conversation || doc.conversation === conversation))
        .map(doc => ({ path: doc.path, name: path.basename(doc.path) }))
    });
  }
  process.on("exit", () => server?.close());
  return {
    routes: { "POST /api/office/open": open, "POST /api/office/relay": relay, "POST /api/office/list": list }
  };
}

module.exports = { COMMIT, OFFICE_EXTS, officeHome, officeState, installOffice, createOffice, dropped };
