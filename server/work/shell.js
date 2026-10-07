// 言 · 桥接 · 执事的 shell：起指令（输出转 UTF-8、机密环境变量按沙箱去掉）、整棵收掉进程树、后台指令；桥接退出时一并收掉
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const sandbox = require("../sandbox.js");
const { tail, decodeClixml, encodePowerShell } = require("./text.js");

// Windows 上有 PowerShell 7（pwsh）就用它：被 Select-Object -First 截断的原生程序不再报退出码 -1、&& 与 || 可用、
// 原生程序的 stderr 经 2>&1 不再裹成一串 NativeCommandError；没装的退回系统自带的 Windows PowerShell 5.1
const PWSH = process.platform === "win32" && spawnSync("where.exe", ["pwsh"], { windowsHide: true }).status === 0;
const WORK_SHELL = process.platform !== "win32" ? "sh" : PWSH ? "PowerShell 7" : "Windows PowerShell 5.1";
// 包在指令外的一层：先把输入输出切到 UTF-8，再把指令（经环境变量 YAN_COMMAND 递进来）当作一段脚本解析、在当前作用域执行。
// 指令若直接拼进来，写错了（bash 的 heredoc 之类）整段解析不过、切编码那行也没跑，报错按系统代码页吐出来就成了乱码；
// 分开解析，报错是读得懂的字，模型一看就知道改。末尾追记的 $? 是指令最后一句成没成（包成脚本块后外头的 $? 不再是它）。
// 原生程序的退出码在 $LASTEXITCODE；cmdlet 出错不设它，靠那个 $? 兜底，让模型能从退出码看出失败
const POWERSHELL_WRAPPER = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'
if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }
try { $__yan = [ScriptBlock]::Create($env:YAN_COMMAND + [Environment]::NewLine + '$__yanOk = $?') }
catch { [Console]::Error.WriteLine("PowerShell 解析不了这条指令：" + $(if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message })); exit 1 }
Remove-Item Env:YAN_COMMAND
$__yanOk = $true
. $__yan
if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $__yanOk) { exit 1 }`;
const WORK_OUTPUT_LIMIT = 20000;
// 交给模型的输出：stderr 里 PowerShell 的 CLIXML 还原成字，终端的颜色控制符（pytest、PowerShell 7 的报错都会带）去掉，过长的留尾
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const shownOutput = (text, stderr = false) =>
  tail((stderr && process.platform === "win32" ? decodeClixml(text) : text).replace(ANSI, ""), WORK_OUTPUT_LIMIT);
// 杀整棵进程树：PowerShell 起的子进程（node、python、构建脚本）不能只杀 shell 本身，否则用户点了停止，脚本还在后台改文件
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform !== "win32") return child.kill("SIGKILL");
  // taskkill 能把孙进程一起收掉，但受限环境里可能被系统拒绝；那时至少要终止直属 shell，不能让指令继续写文件。
  const killShell = () => {
    if (child.exitCode !== null || child.signalCode) return;
    try {
      child.kill("SIGKILL");
    } catch {}
  };
  const killer = spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" }),
    fallback = setTimeout(killShell, 750);
  killer.once("error", killShell);
  killer.once("close", code => {
    clearTimeout(fallback);
    if (code) killShell();
  });
}
module.exports = function createShell({ toolEnv }) {
  // 起一个 shell 跑指令（Windows 上外面包一层，见 POWERSHELL_WRAPPER）；指令经环境变量递进去，比塞进命令行能长两倍多
  function spawnShell(command, cwd, { boxed = false } = {}) {
    const win = process.platform === "win32";
    const args = win
      ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(POWERSHELL_WRAPPER)]
      : ["-c", command];
    const child = spawn(win ? (PWSH ? "pwsh.exe" : "powershell.exe") : "/bin/sh", args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...toolEnv(boxed ? sandbox.sandboxEnv(process.env) : process.env),
        TERM: "dumb",
        NO_COLOR: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        CI: "1",
        ...(win ? { YAN_COMMAND: command } : {})
      }
    });
    // 按字交出输出：一块一块各自解码，汉字恰好跨在两块之间就被劈成两个 �
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    runningShells.add(child);
    // 外壳退了、它起的孙进程（start /b 起的服务、会常驻的工具）还攥着输出管道：close 要等它们都退才来，指令一直挂着，
    // 超时与停止也收不到（外壳已不在，killTree 无从下手）。外壳退后稍等片刻，管道还没合上就松手，按外壳的退出收尾
    child.once("exit", () => {
      const timer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, 1500);
      child.once("close", () => clearTimeout(timer));
    });
    child.on("close", () => runningShells.delete(child));
    child.on("error", () => runningShells.delete(child));
    return child;
  }
  // 正在跑的 shell（前台与后台）：桥接退出时整棵收掉，不留在后台改文件、占端口
  const runningShells = new Set();
  function runShell(command, cwd, timeoutMs, signal = null, { boxed = false } = {}) {
    return new Promise(resolve => {
      const win = process.platform === "win32";
      const child = spawnShell(command, cwd, { boxed });
      let stdout = "",
        stderr = "",
        timedOut = false;
      const cap = (prev, chunk) => (prev + chunk.toString("utf8")).slice(-WORK_OUTPUT_LIMIT * 2);
      child.stdout.on("data", chunk => {
        stdout = cap(stdout, chunk);
      });
      child.stderr.on("data", chunk => {
        stderr = cap(stderr, chunk);
      });
      let aborted = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      // 页面停止生成（请求被中止）：连整棵进程树一起收掉
      const onAbort = () => {
        aborted = true;
        killTree(child);
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", error => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({ exitCode: -1, stdout, stderr: `${stderr}\n无法启动 shell：${error.message}`.trim(), timedOut, aborted });
      });
      child.on("close", (code, signalName) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({
          exitCode: code ?? (timedOut ? 124 : signalName || aborted ? 1 : 0),
          stdout: shownOutput(stdout),
          stderr: shownOutput(stderr, true),
          timedOut,
          aborted
        });
      });
    });
  }
  // ---- 后台指令：开发服务器、监听构建这类不会自己结束的，放到后台跑，先回头几秒的输出与一个编号，之后用 check_command 取新输出或结束它。
  // 桥接退出时一并收掉。只记最近的若干个，跑完的旧账先清
  const BACKGROUND_KEEP = 24,
    backgroundJobs = new Map();
  let backgroundSeq = 0;
  // 编号在桥接重启后从 bg1 重数：另记一个带这次启动标记的 key，页面刷新后重新等上时按它认，不会等到别的指令上
  const BOOT = Date.now().toString(36);
  function startBackground(command, workdir, boxed) {
    const child = spawnShell(command, workdir, { boxed }),
      job = {
        id: `bg${++backgroundSeq}`,
        key: `${BOOT}-${backgroundSeq}`,
        command,
        child,
        exitCode: null,
        started: Date.now(),
        grew: Date.now(),
        // 两路输出各留最近一截；base 是已裁掉的字数、read 是已交出去的位置（都按从头算的绝对位置记，裁了也对得上）
        text: { out: "", err: "" },
        base: { out: 0, err: 0 },
        read: { out: 0, err: 0 }
      };
    const take = (key, chunk) => {
      job.text[key] += chunk.toString("utf8");
      job.grew = Date.now();
      const cut = job.text[key].length - WORK_OUTPUT_LIMIT * 4;
      if (cut > 0) {
        job.text[key] = job.text[key].slice(cut);
        job.base[key] += cut;
      }
    };
    child.stdout.on("data", chunk => take("out", chunk));
    child.stderr.on("data", chunk => take("err", chunk));
    child.on("error", error => {
      take("err", `无法启动 shell：${error.message}`);
      job.exitCode = -1;
    });
    child.on("close", code => {
      job.exitCode = code ?? 1;
    });
    // 结束了（或压根没起来）：等着它的页面据此叫醒模型（见 watchBackground）
    job.ended = new Promise(resolve => {
      child.once("close", resolve);
      child.once("error", resolve);
    });
    for (const [id, old] of backgroundJobs) if (backgroundJobs.size >= BACKGROUND_KEEP && old.exitCode !== null) backgroundJobs.delete(id);
    backgroundJobs.set(job.id, job);
    return job;
  }
  // 等到指令结束、输出停了一会儿（服务器起好了往往就不再出声）或时间到；交出去的是上次取过之后的新输出
  async function backgroundReport(job, waitMs) {
    const start = Date.now(),
      until = start + waitMs;
    while (Date.now() < until && job.exitCode === null && Date.now() - Math.max(job.grew, start) < 1500)
      await new Promise(resolve => setTimeout(resolve, 200));
    const fresh = key => {
      const text = job.text[key].slice(Math.max(0, job.read[key] - job.base[key]));
      job.read[key] = job.base[key] + job.text[key].length;
      return text;
    };
    const out = fresh("out"),
      err = fresh("err");
    return {
      id: job.id,
      key: job.key,
      running: job.exitCode === null,
      exitCode: job.exitCode,
      stdout: shownOutput(out),
      stderr: shownOutput(err, true),
      durationMs: Date.now() - job.started
    };
  }
  // 桥接退出时把还在跑的指令（前台的与后台的）一并收掉（退出时起不了异步的 taskkill，用同步的）
  process.on("exit", () => {
    for (const child of runningShells)
      if (child.pid && child.exitCode === null && !child.signalCode)
        try {
          if (process.platform === "win32")
            spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" });
          else child.kill("SIGKILL");
        } catch {}
  });
  // check_command：取后台指令的新输出；stop 时先收掉它（最多等三秒）
  async function checkBackground(id, stop, waitMs) {
    const job = backgroundJobs.get(String(id || ""));
    if (!job) throw Error(`没有编号为 ${id} 的后台指令（桥接重启过的话，之前的后台指令已随之结束）`);
    if (stop && job.exitCode === null) {
      killTree(job.child);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 3000);
        job.child.once("close", () => {
          clearTimeout(timer);
          resolve(null);
        });
      });
    }
    const report = await backgroundReport(job, waitMs);
    // 模型自己看到它结束了：不必再叫醒一回
    if (!report.running) job.reported = true;
    return report;
  }
  // 等后台指令结束再回话：页面据此叫醒模型，模型挂上就能收尾去睡，不必轮询。结束只报一回——
  // 几处页面都在等、或刷新后重新等上的，后来的接手，先前的作罢（superseded）；报过的不再报（reported）；
  // 桥接重启过，旧编号已不在（lost）
  // 模型自己用 check_command 看到它结束了的，也算报过（reported，带上退出码，页面只把签改成已结束）
  async function watchBackground(id, key, signal) {
    const job = backgroundJobs.get(String(id || ""));
    if (!job || (key && job.key !== key)) return { id, lost: true };
    if (job.reported) return { id, reported: true, exitCode: job.exitCode };
    const ticket = (job.watchTicket = (job.watchTicket || 0) + 1);
    await Promise.race([job.ended, new Promise(resolve => signal?.addEventListener("abort", resolve, { once: true }))]);
    if (ticket !== job.watchTicket || signal?.aborted) return { id, superseded: true };
    if (job.reported) return { id, reported: true, exitCode: job.exitCode };
    job.reported = true;
    return { ...(await backgroundReport(job, 0)), command: job.command };
  }
  return { WORK_SHELL, killTree, runShell, startBackground, backgroundReport, checkBackground, watchBackground };
};
