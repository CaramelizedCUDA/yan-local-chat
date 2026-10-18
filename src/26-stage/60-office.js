// 言 · 游目 · Office：docx / xlsx / pptx 在游目里用 Office 引擎原生编辑（引擎与宿主页见 server/office.js、server/office-host.html）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 人看的一律交给能读能写这种格式的引擎；抽取只留给模型读（read_document、附件正文）。没装引擎、游目关着时，预览照旧抽正文兜底。
// 人与执事轮流写同一份文件：这段对话作答前，它开着的文档存盘并锁住（officeLock），答完放开、文件被改过就重新载入（officeUnlock）
const OFFICE_KINDS = new Set(["document", "sheet", "slides"]);
let officeAvailable = false;
const officeTurns = new Map();
/** @param {string} name */
function isOfficeFile(name) {
  return OFFICE_KINDS.has(fileKind(name).name);
}
// 在游目里开一份：向桥接领凭据，游目新开一页去宿主页；没装引擎等打不开的情形抛出，由调用处退回预览
/** @param {string} path 本机绝对路径 */
async function openInOffice(path, conversation = view === "chat" ? currentConversation()?.id || "" : "", scope = {}, signal = undefined) {
  const data = await bridge(
    "/api/office/open",
    {
      ...scope,
      path,
      // 在对话里开的（成品卡）归那段对话；卷宗页开的不归哪段，哪段作答都锁
      conversation,
      locale: LANG === "en" ? "en" : "zh",
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light"
    },
    signal
  );
  signal?.throwIfAborted();
  openStage();
  if (!stage.ws) await stageLaunch();
  signal?.throwIfAborted();
  if (!stage.ws) throw Error(t("游目的浏览器没能打开"));
  await stageSend("Target.createTarget", { url: data.url });
}
// 预览器先问这里：Office 文件、游目开着，就进游目编辑；打不开（没装引擎）退回预览，别的错报一声也退回
/** @param {{ path?: string }} source @param {string} name @returns {Promise<boolean>} 已在游目里开了 */
async function officeInstead(source, name) {
  // 游目可用：连着浏览器，或配了浏览器服务（言自带的游目、人自己接的 Playwright 都算）
  if (!source.path || !isOfficeFile(name) || !(stage.ws || stageConfig()) || !archiveDir()) return false;
  try {
    await openInOffice(`${archiveDir()}/${source.path}`);
    return true;
  } catch (error) {
    const message = String(/** @type {any} */ (error).message || error);
    if (!/还没装/.test(message)) toast(t`游目里没能打开：${message.slice(0, 80)}`);
    return false;
  }
}
// 作答前：这段对话开着的文档存盘、锁住，回开着的那几份（交给模型的一句话里列出）；桥接不在、没开着的，什么也不做
/** @param {Conversation} conversation @param {string} owner @param {AbortSignal} signal @returns {Promise<string[]>} */
async function officeLock(conversation, owner, signal) {
  officeTurns.set(owner, conversation.id);
  const data = await bridge("/api/office/relay", { cmd: "lock", conversation: conversation.id, owner }, signal);
  officeAvailable = data.installed === true;
  return (data.docs || [])
    .filter((/** @type {any} */ doc) => {
      if (!doc.hosts) return false;
      if (doc.answers?.length !== doc.hosts || doc.answers.some(answer => answer.error || answer.dirty || answer.locked !== true))
        throw Error(t("文档未能存盘并锁定，请检查游目中的文档后再试"));
      return true;
    })
    .map((/** @type {any} */ doc) => String(doc.path));
}
/** @param {Conversation} conversation @param {string} owner */
function officeUnlock(conversation, owner) {
  return bridge("/api/office/relay", { cmd: "unlock", conversation: conversation.id, owner }, AbortSignal.timeout(20000))
    .catch(() => {})
    .finally(() => officeTurns.delete(owner));
}
function releaseOfficeTurns() {
  for (const [owner, conversation] of officeTurns) {
    // 离页先停掉相应作答；从前进后退缓存回来时，旧任务不能在已经解锁的文档上接着做。
    requestJobs.get(conversation)?.controller.abort();
    void fetch(`${apiBase}/api/office/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ cmd: "unlock", conversation, owner })
    }).catch(() => {});
  }
}
// 交给模型的那一句：用户此刻在游目里开着哪几份（作答期间锁着，改就改原件，答完重新载入给用户看）
/** @param {string[]} paths */
function officeNote(paths) {
  return [
    officeAvailable ? prompt("work.officeAvailable") : "",
    paths.length ? prompt("work.officeOpen", { files: paths.map(path => `- ${path}`).join("\n") }) : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

// 给模型真实入口；用正在执行的对话落点和权限，不能取页面此刻切到的另一段对话。
defineTool({
  name: "open_office",
  group: "docs",
  label: t("打开文档"),
  mainOnly: true,
  sideEffect: true,
  offer: ctx => ctx.files && officeAvailable && !!(stage.ws || stageConfig()),
  async run(step, args, { conversation, signal }) {
    const path = String(args.path || "").trim();
    step.title = path;
    if (!isOfficeFile(path))
      return {
        ok: false,
        content: t("内嵌编辑支持 docx、xlsx、pptx、odt、ods、odp；HTML 和 Markdown 展示页不会自动变成编辑器"),
        display: "格式不支持"
      };
    await openInOffice(path, conversation.id, workScope(conversation), signal);
    return {
      ok: true,
      content: t("已在游目打开可编辑的 Office 文档。本答期间暂为只读，作答结束后恢复编辑；用户编辑会存回原文件，无需另建编辑服务。"),
      display: "已在游目打开"
    };
  }
});
