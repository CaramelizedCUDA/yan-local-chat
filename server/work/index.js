// 言 · 桥接的执事接口：工作目录、各接口共用的落点与沙箱筛查、指令与后台指令、目录选择对话框；
// 文件读写见 files.js，列与搜见 find.js，意与指纹见 intent.js，卷宗目录见 archive.js
// 由 server.js 装配：require("./server/work/index.js")({ archiveHome, workHome, toolEnv })
"use strict";
const { sendJson, readJson, jsonRoute, requestSignal, errorText } = require("../http.js");
const fs = require("node:fs");
const path = require("node:path");
const sandbox = require("../sandbox.js");
const paths = require("./paths.js");
const { SCRATCH_DIR, WORK_SKIP, describeFsError, clampNumber, pathIsInside, resolveTarget, assertReachable, relPath } = paths;
const { pickFolder } = require("./folder-picker.js");
const createShell = require("./shell.js");
const createLocks = require("./locks.js");
const createArchive = require("./archive.js");
const createFiles = require("./files.js");
const createFind = require("./find.js");
const createIntent = require("./intent.js");

module.exports = function createWork({ archiveHome, workHome, toolEnv, playable }) {
  // ---- 执事模式：给模型一个工作目录，能跑指令、读写文件 ----
  // 只做四件事：跑一条指令、写文件、读文件、列目录。路径默认限定在工作目录之内（页面放开后绝对路径可指向目录之外）；指令在工作目录里用本机 shell 执行。
  // 不做进程隔离——这是用户自己的机器，页面上每条指令都看得见，并按问而后行 / 审而后行 / 径行三档处理。
  // 请求带 sandbox: true 时再加一道沙箱（server/sandbox.js）：路径不出目录、机密文件不碰、指令先筛、环境变量去掉机密——在桥接这头守，页面与模型都绕不过
  // 执事没给目录时的退路：存储根里的 工作/（workHome()，见 server/store.js），与卷宗、对话同在一处
  // 卷宗：对话没绑工作目录时，模型的工具就落在这里——写出的表格、文档都收在卷宗里；页面上的卷宗即这个目录的视图。
  // 位置在存储根里（archiveHome()，见 server/store.js），随每个请求的 root 传来的也认。
  // 各接口出错时回给页面的那句话：截到 300 字
  // 报错原样交给模型（卡片上只露头一句）：放得下一段线索——路径不对时同名的在哪、old 对不上时文件里最像的那一段
  const failed = error => errorText(error, 4000);
  const resolveWorkdir = raw => paths.resolveWorkdir(raw, workHome);
  const { WORK_SHELL, runShell, startBackground, backgroundReport, checkBackground, watchBackground } = createShell({ toolEnv }),
    { lockFile, lockWorkdir } = createLocks();
  // 沙箱分两档：问而后行（或没说档位的请求）用严的；审而后行、径行用宽的——文件工具在宽档里不设防，指令只守系统本身（见 server/sandbox.js）
  const looseTier = body => body.permission === "review" || body.permission === "auto";
  const strictBox = body => body.sandbox === true && !looseTier(body);
  // 各文件接口的落点：严的沙箱里不认「全盘」，目录内的机密文件、.git 内部（写）也拦下；宽档与没开沙箱时，可及范围只由「全盘 / 目录内」定
  async function targetOf(workdir, body, { write = false } = {}) {
    const boxed = strictBox(body),
      target = resolveTarget(workdir, body.path, body.roam === true && !boxed);
    await assertReachable(workdir, target);
    if (boxed) {
      const why = sandbox.screenPath(relPath(workdir, target), { write });
      if (why) throw Error(why);
    }
    return target;
  }
  // 路径不对时给一句线索，模型下一回就能找对，不必先列目录：同名的在目录里别处（多半记错了上一层），
  // 不然列出还在的最近一层目录里有什么。沙箱里不借它报出机密文件的名字
  const HINT_SCAN = 4000,
    HINT_LIST = 15;
  async function missingHint(workdir, target, boxed) {
    const name = path.basename(target).toLowerCase(),
      visible = full => !(boxed && sandbox.screenPath(relPath(workdir, full))),
      same = [];
    let seen = 0;
    const walk = async dir => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (++seen > HINT_SCAN || same.length >= 3) return;
        const full = path.join(dir, entry.name);
        if (entry.name.toLowerCase() === name && visible(full)) same.push(shownPath(workdir, full));
        if (entry.isDirectory() && !entry.isSymbolicLink() && !WORK_SKIP.has(entry.name)) await walk(full);
      }
    };
    if (pathIsInside(workdir, target)) await walk(workdir);
    if (same.length) return `；同名的在：${same.join("、")}`;
    let parent = path.dirname(target);
    while (!(await fs.promises.stat(parent).catch(() => null))?.isDirectory() && path.dirname(parent) !== parent)
      parent = path.dirname(parent);
    const entries = (await fs.promises.readdir(parent, { withFileTypes: true }).catch(() => []))
      .filter(entry => !WORK_SKIP.has(entry.name) && visible(path.join(parent, entry.name)))
      .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    if (!entries.length) return "";
    return `；${shownPath(workdir, parent) || "."}/ 下有：${entries.slice(0, HINT_LIST).join("、")}${entries.length > HINT_LIST ? ` 等 ${entries.length} 项` : ""}`;
  }
  // 给页面与模型看的路径：目录之内给相对路径，目录之外给完整路径
  function shownPath(workdir, file) {
    return pathIsInside(workdir, file) ? relPath(workdir, file) : file;
  }
  const handleWorkPick = jsonRoute(async body => {
    const result = await pickFolder(String(body.current || "").trim());
    if (result.error) throw Error(result.error);
    return { path: result.path };
  }, failed);
  const handleWorkPrepare = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir);
    const existing = await fs.promises.stat(workdir).catch(() => null);
    if (existing && !existing.isDirectory()) throw Error(`路径已被文件占用，不是目录：${workdir}`);
    if (!existing)
      await fs.promises.mkdir(workdir, { recursive: true }).catch(error => {
        throw Error(describeFsError(error, workdir));
      });
    const entries = await fs.promises.readdir(workdir).catch(() => []);
    return {
      workdir,
      platform: process.platform,
      shell: WORK_SHELL,
      home: workHome(),
      entries: entries.length,
      created: !existing
    };
  }, failed);
  async function handleWorkRun(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        command = String(body.command || "").trim();
      if (!command) throw Error("指令不能为空");
      if (!fs.existsSync(workdir)) throw Error("工作目录已不存在，请重新发送以重建，或另起对话");
      const boxed = body.sandbox === true;
      if (boxed) {
        const why = looseTier(body) ? sandbox.screenLoose(command) : sandbox.screenCommand(command, workdir);
        if (why) throw Error(why);
      }
      if (body.permission === "review") {
        const why = sandbox.screenAutoReview(command);
        if (why) throw Error(why);
      }
      if (body.background === true) {
        console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} $ （后台）${command.slice(0, 120)}`);
        return sendJson(res, 200, await backgroundReport(startBackground(command, workdir, boxed), 5000));
      }
      // 超时只有默认值没有上限：长测试、大装包、跑数据都可能超过十分钟，页面上本就有「停止」。
      // 封顶在 2³¹−1 毫秒（约 24 天）只因 setTimeout 超过它会溢出、当作 1 毫秒——模型给个大数，指令就被当场杀掉
      const timeoutMs = clampNumber(Number(body.timeout) * 1000, 120000, 1000, 2147483647);
      console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} $ ${command.slice(0, 120)}`);
      // 页面那头停止生成会中止这个请求：响应还没写就断开，即是中止，把指令连同它起的子进程一并杀掉。排队等目录锁时停了，也不再启动指令
      const signal = requestSignal(res);
      const started = Date.now(),
        release = await lockWorkdir(workdir, signal);
      let result;
      try {
        result = await runShell(command, workdir, timeoutMs, signal, { boxed });
      } finally {
        release();
      }
      if (result.aborted) console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })}   已中止：${command.slice(0, 80)}`);
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, { ...result, durationMs: Date.now() - started });
    } catch (error) {
      sendJson(res, 400, { error: failed(error) });
    }
  }
  const handleWorkCheck = jsonRoute(
    async body =>
      await checkBackground(body.id, body.stop === true, clampNumber(Number(body.wait) * 1000, 0, 0, 120000), String(body.key || "")),
    failed
  );
  // 等一条后台指令结束：请求一直挂着（走总线不占连接），结束了才回；页面停了、关了，请求随之作罢
  async function handleWorkWatch(req, res) {
    try {
      const body = await readJson(req),
        result = await watchBackground(body.id, body.key, requestSignal(res));
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: failed(error) });
    }
  }
  // 问而后行：发指令前先问一声严的沙箱会不会拦——会拦的照样请示，请示条上写明原因，用户批了这一条就出沙箱跑
  const handleWorkScreen = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir);
    return { why: sandbox.screenCommand(String(body.command || ""), workdir) };
  }, failed);
  // 文件、列与搜、意各一段，共用上面的落点、沙箱筛查与报错写法
  const work = { failed, resolveWorkdir, targetOf, missingHint, shownPath, strictBox, lockFile };

  return {
    workHome,
    SCRATCH_DIR,
    WORK_SHELL,
    // 都碰本机磁盘或本机进程：只受理本站页面与 VS Code Webview（见 server.js 的接口表）
    routes: {
      "POST /api/work/prepare": handleWorkPrepare,
      "POST /api/work/pick": handleWorkPick,
      "POST /api/work/run": handleWorkRun,
      "POST /api/work/screen": handleWorkScreen,
      "POST /api/work/check": handleWorkCheck,
      "POST /api/work/watch": handleWorkWatch,
      ...createFiles(work),
      ...createFind(work),
      ...createIntent(work),
      ...createArchive({ archiveHome, playable, lockFile })
    }
  };
};
