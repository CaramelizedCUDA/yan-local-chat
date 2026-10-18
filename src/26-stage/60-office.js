// 言 · 游目 · Office：docx / xlsx / pptx 在游目里用 Office 引擎原生编辑（引擎与宿主页见 server/office.js、server/office-host.html）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 人看的一律交给能读能写这种格式的引擎；抽取只留给模型读（read_document、附件正文）。没装引擎、游目关着时，预览照旧抽正文兜底。
// 人与执事轮流写同一份文件：这段对话作答前，它开着的文档存盘并锁住（officeLock），答完放开、文件被改过就重新载入（officeUnlock）
const OFFICE_KINDS = new Set(["document", "sheet", "slides"]);
/** @param {string} name */
function isOfficeFile(name) {
  return OFFICE_KINDS.has(fileKind(name).name);
}
// 在游目里开一份：向桥接领凭据，游目新开一页去宿主页；没装引擎等打不开的情形抛出，由调用处退回预览
/** @param {string} path 本机绝对路径 */
async function openInOffice(path) {
  const data = await bridge("/api/office/open", {
    path,
    // 在对话里开的（成品卡）归那段对话；卷宗页开的不归哪段，哪段作答都锁
    conversation: view === "chat" ? currentConversation()?.id || "" : "",
    locale: LANG === "en" ? "en" : "zh",
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  });
  openStage();
  if (!stage.ws) await stageLaunch();
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
/** @param {Conversation} conversation @returns {Promise<string[]>} */
async function officeLock(conversation) {
  const data = await bridge("/api/office/relay", { cmd: "lock", conversation: conversation.id }).catch(() => null);
  return (data?.docs || []).filter((/** @type {any} */ doc) => doc.hosts).map((/** @type {any} */ doc) => String(doc.path));
}
/** @param {Conversation} conversation */
function officeUnlock(conversation) {
  void bridge("/api/office/relay", { cmd: "unlock", conversation: conversation.id }).catch(() => {});
}
// 交给模型的那一句：用户此刻在游目里开着哪几份（作答期间锁着，改就改原件，答完重新载入给用户看）
/** @param {string[]} paths */
function officeNote(paths) {
  return paths.length ? prompt("work.officeOpen", { files: paths.map(path => `- ${path}`).join("\n") }) : "";
}
