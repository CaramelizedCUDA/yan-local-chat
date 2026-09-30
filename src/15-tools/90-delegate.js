// 言 · 差遣：主模型把一件自成一段的子任务交给帮手，帮手另起一段对话做完后回报。桥接在线、且有别的活能交出去时才给；帮手自己不再差遣。
// 同一轮派出的几名帮手同时开工（parallel），活是主模型分的，不重叠靠它分派时留意（工具说明里有交代）。
// 行迹里只留一枚签，帮手自己的那条时间线开在差遣面板里（见 08-trail.js）
defineTool({
  name: "delegate",
  group: "delegate",
  label: "差遣",
  offer: ctx => ctx.offered.some(name => name !== "ask_user"),
  mainOnly: true,
  sideEffect: true,
  parallel: true,
  run: delegateInBackground,
  html: delegateStepHtml,
  sync: syncDelegateCard,
  digest: step =>
    `差遣「${String(step.title || "").slice(0, 40)}」→ ${step.result || step.status}${subChangedPaths(step).length ? `，改了 ${subChangedPaths(step).slice(0, 8).join("、")}` : ""}`
});
// 给后台正做着的帮手递话或叫停：话进帮手的收件口，它说到落点时读到（同补言，不掐断）；叫停只停它一个，已做的照未完成回报
defineTool({
  name: "helper",
  group: "delegate",
  label: "传话",
  offer: ctx => ctx.offered.includes("delegate"),
  mainOnly: true,
  sideEffect: true,
  run: tellHelper
});
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 */
function tellHelper(step, args, ctx) {
  const name = String(args.helper || "").trim(),
    text = String(args.message || "").trim(),
    stop = args.stop === true,
    boxes = requestJob(ctx.conversation.id)?.subs || [],
    box = boxes.find(item => item.title === name) || (boxes.length === 1 ? boxes[0] : null);
  step.title = `${stop ? "叫停" : "递给"}「${box?.title || name}」${stop || !text ? "" : `：${text.slice(0, 60)}`}`;
  if (!box)
    return {
      ok: false,
      content: prompt("delegate.gone", { title: name, running: boxes.map(item => `「${item.title}」`).join("、") || "无" }),
      display: "不在做"
    };
  if (stop) {
    box.controller.abort();
    return { ok: true, content: prompt("delegate.stopping", { title: box.title }), display: "已叫停" };
  }
  if (!text) return { ok: false, content: "message 不能为空", display: "无话" };
  box.queue.push({ report: prompt("delegate.note", { text }) });
  // 帮手正写着：等它说到落点停这一轮递上；正跑工具：结果交回时递；正等着：当即叫醒
  if (box.reading) watchSteer(box, box.sub);
  box.wake?.();
  return { ok: true, content: prompt("delegate.noted", { title: box.title }), display: "已递" };
}
// 帮手在后台做：差遣当即回一句「已开工」，主模型这一轮随即结束、照常往下走；帮手做完，回报寄进这一答的收件口
//（job.queue，与补言同一个口子），在下一个轮次边界递给主模型。帮手干活时主模型醒着：补言当场能递，它可据此调整。
// 主模型没别的事可做时，这一答不收尾，等收件口——帮手回报或补言，谁先到先处理（见 streamReply）
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 */
function delegateInBackground(step, args, ctx) {
  const job = requestJob(ctx.conversation.id);
  if (!job || !String(args.task || "").trim()) return runDelegate(step, args, ctx);
  job.helpers = (job.helpers || 0) + 1;
  void runDelegate(step, args, ctx)
    .then(
      outcome => {
        step.status = outcome.ok ? "done" : "error";
        step.result = outcome.display;
        (job.queue ||= []).push({ report: outcome.content, step });
      },
      // 停了：streamReply 收尾时自会把还在转圈的步骤收束
      error => {
        if (error.name !== "AbortError") {
          step.status = "error";
          step.result = friendlyError(String(error.message || error));
          (job.queue ||= []).push({
            report: prompt("delegate.failed", {
              title: step.title,
              reason: step.result,
              steps: step.sub?.steps.length || 0,
              changed: "",
              partial: ""
            }),
            step
          });
        }
      }
    )
    .finally(() => {
      job.helpers -= 1;
      refreshSteps(ctx.assistant);
      saveStore();
      job.wake?.();
    });
  return { ok: true, background: true, content: prompt("delegate.started", { title: step.title }), display: "后台进行中" };
}
/** @param {Step} step */
function subChangedPaths(step) {
  return [...new Set((step.sub?.steps || []).filter(s => s.change && s.status === "done").map(s => s.change.path))];
}
// 差遣：主模型把一件自成一段的子任务交给帮手。帮手用同一个模型、同一套工具（不再差遣、不请示用户）另起一段对话跑自己的工具轮次（上限见设置），
// 步骤都画在主对话这条消息的差遣卡片里（指令照样问而后行），做完把最后一轮的回报连同改动摘要作为工具结果交回主模型
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 */
async function runDelegate(step, args, ctx) {
  const { conversation, assistant, signal } = ctx;
  const task = args.task.trim();
  step.title = args.title.trim().slice(0, 40) || task.slice(0, 24);
  if (!task) return { ok: false, content: "task 不能为空：请把背景、目标、边界与要回报的内容写全", display: "任务为空" };
  const job = requestJob(conversation.id),
    profile = job?.profile || activeProfile();
  if (!profile) return { ok: false, content: "没有可用的模型", display: "无模型" };
  const tools = toolDefinitions(conversation, { sub: true });
  if (!tools) return { ok: false, content: "此对话里没有可交给帮手的工具", display: "无工具可用" };
  /** @type {SubAgent} */
  const sub = { id: `sub-${uid()}`, task, content: "", reasoning: "", steps: [], status: "streaming", usage: null };
  step.sub = sub;
  const history = [{ role: "user", content: task }];
  const overrides = {
    systemPrompt: systemPrompt(conversation, tools, { role: "sub" }),
    tools,
    reasoning: conversation.reasoning || "",
    // 跑得久了上下文会满：任务说明之后的往来由 readReply 按需压成工作笔记（见 keepInWindow），帮手接着做
    head: history.length,
    onFold: busy => job && setJobLabel(conversation, job, busy ? "帮手整理上下文" : "")
  };
  // 帮手自己的收件口与中止器，与主答的 job 同形，轮次循环照收：主模型经 helper 递来的话等它说到落点再递（同补言），
  // 叫停只停它一个；整答停了它跟着停
  const controller = new AbortController(),
    stopWithMain = () => controller.abort();
  signal.addEventListener("abort", stopWithMain, { once: true });
  const inbox = {
    controller,
    queue: [],
    round: null,
    reading: false,
    roundStart: 0,
    steerTimer: 0,
    helpers: 0,
    wake: null,
    sub,
    title: step.title
  };
  if (job) (job.subs ||= []).push(inbox);
  const tally = newTally(),
    started = performance.now();
  // 帮手的话是逐字流进来的，卡片每隔一小会儿刷一次，不必每个字都重画
  let painted = "";
  const paint = () => {
    const sig = `${sub.content.length}|${sub.reasoning.length}|${sub.status}|${sub.steps.map(s => s.status).join("")}`;
    if (sig === painted) return;
    painted = sig;
    refreshSteps(assistant);
  };
  const ticker = setInterval(paint, 350);
  let failure = "";
  try {
    // 与主答同一个轮次循环；步骤记在帮手身上、画在主答的差遣卡里
    await runRounds(sub, history, {
      profile,
      conversation,
      host: assistant,
      signal: controller.signal,
      inbox,
      overrides,
      tally,
      roundLimit: subRoundLimit(),
      limitPrompt: "delegate.limit",
      scope: sub.id
    });
    sub.status = "complete";
  } catch (error) {
    if (error.name === "AbortError") {
      sub.status = "stopped";
      if (signal.aborted) throw error;
      // 主模型叫停的：照未完成回报，它已做的一并交回
      failure = "已按吩咐叫停";
    } else {
      sub.status = "error";
      failure = friendlyError(String(error.message || error));
    }
  } finally {
    clearInterval(ticker);
    clearInterval(inbox.steerTimer);
    signal.removeEventListener("abort", stopWithMain);
    if (job?.subs) job.subs = job.subs.filter(box => box !== inbox);
    sub.usage = tally.usageKnown ? tally.usage : null;
    sub.durationMs = Math.round(performance.now() - started);
    // 回报是最后一段话；裁掉开头的空行，偏移跟着前移
    const lead = trimReply(sub);
    sub.report = sub.content.slice(Math.max(0, tally.replyStart - lead)).trim();
    paint();
  }
  const changed = subChangedPaths(step),
    stats = changeStats({ steps: [step] }),
    changedNote = changed.length ? `，改了 ${changed.length} 个文件：${changed.join("、")}（+${stats.added} −${stats.removed}）` : "",
    seconds = Math.round(sub.durationMs / 1000),
    display = `${sub.steps.length} 步${changed.length ? ` · 改 ${changed.length} 个文件` : ""}${overrides.folds ? ` · 压缩 ${overrides.folds} 回` : ""} · ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分`}`;
  if (sub.status !== "complete")
    return {
      ok: false,
      content: prompt("delegate.failed", {
        title: step.title,
        reason: failure || "未收到回报",
        steps: sub.steps.length,
        changed: changedNote,
        partial: sub.report ? `它最后说：${sub.report.slice(0, 4000)}` : ""
      }),
      display: `${display} · 未完成`
    };
  if (!sub.report)
    return {
      ok: false,
      content: prompt("delegate.failed", {
        title: step.title,
        reason: "帮手没有写回报",
        steps: sub.steps.length,
        changed: changedNote,
        partial: ""
      }),
      display: `${display} · 无回报`
    };
  return {
    ok: true,
    content: prompt("delegate.report", {
      title: step.title,
      steps: sub.steps.length,
      changed: changedNote,
      report: sub.report.slice(0, 16000)
    }),
    display
  };
}
// 行迹里只留一枚签：差遣是并行的活，塞进线性的时间线会把后面的东西一直往下顶。
// 这里只记「此刻遣了谁、做到哪一步」——那确实是这一刻发生的事；回报与帮手自己的那条小时间线都在面板里，
// 签上不铺回报：主模型接着会把它消化进正文，几名帮手的回报叠在行迹里，正文就被顶到几屏之下了。
/** @param {Step} step */
function delegateStepHtml(step) {
  const { sub, status, meta } = delegateSubState(step);
  return `<div class="tool-step tool-step-delegate" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head" role="button" tabindex="0" title="展开帮手的行迹"><span class="tool-label"><span class="seal sub-seal" aria-hidden="true">遣</span>差遣</span><span class="tool-title" title="${escapeHtml(sub?.task || step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "未完成") : ""}">${escapeHtml(meta)}</span>${stepStateHtml(status)}</div></div>`;
}
// 行迹里那枚签的就地更新：只动头上的状态与标题。帮手自己的时间线与回报不在这儿，在面板里
/** @param {Step} step */
function syncDelegateCard(el, step, prev) {
  const { sub, status, meta } = delegateSubState(step);
  el.dataset.status = status;
  const head = el.querySelector(":scope > .tool-step-head");
  rollText(head.querySelector(".tool-meta"), meta);
  if (!prev || prev.status !== status) head.querySelector(".tool-state").outerHTML = stepStateHtml(status);
  // 标题在领命时才定下来，签却在那之前就画出来了
  const title = head.querySelector(".tool-title");
  if (title.textContent !== String(step.title || "")) {
    title.textContent = step.title || "";
    title.title = sub?.task || step.title || "";
  }
}
