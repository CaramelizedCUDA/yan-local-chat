// 言 · 消息动作：复制、编辑、重答、续写……与编辑框的保存
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 生成中（连同开工前的准备）只拦会改动对话的动作（编辑、重答、续写、重试、切版本）；复制与就整条回复开旁注不碍事，下面还在写时上面照样可以注
const ACTIONS_WHILE_RUNNING = new Set(["copy", "note"]);
async function handleMessageAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || ((sendPreparing || conversationRunning() || runningElsewhere()) && !ACTIONS_WHILE_RUNNING.has(button.dataset.action)))
    return;
  const c = currentConversation();
  if (!c) return;
  const id = button.closest("[data-message]")?.dataset.message,
    index = c.messages.findIndex(m => m.id === id);
  if (index < 0) return;
  const message = c.messages[index];
  if (button.dataset.action === "copy") {
    await copyText(message.content);
    return toast("已复制");
  }
  if (button.dataset.action === "note") return openSideIndex(message.id);
  if (button.dataset.action === "branch-prev" || button.dataset.action === "branch-next")
    return switchBranch(c, index, button.dataset.action === "branch-prev" ? -1 : 1);
  if (button.dataset.action === "drop-attachment") {
    // 只摘掉这一枚件条、不重画：重画会把编辑框里改到一半的字冲回原文。也别让点击再冒到件条上打开查看器
    event.stopPropagation();
    editingDropped.add(button.dataset.file);
    const card = button.closest(".attachment-card"),
      list = card?.parentElement;
    card?.remove();
    if (list && !list.children.length) list.remove();
    return;
  }
  if (button.dataset.action === "cancel-edit") {
    editingMessageId = null;
    renderConversation(false);
    return;
  }
  if (button.dataset.action === "edit") {
    if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
    editingMessageId = message.id;
    editingDropped = new Set();
    renderConversation(false);
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-message="${message.id}"] .message-edit-input`);
      growEditor(input);
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
    return;
  }
  if (button.dataset.action === "save-edit")
    return saveEditedMessage(c, index, button.closest("[data-message]").querySelector(".message-edit-input").value);
  if (button.dataset.action === "resume") {
    if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
    const profile = activeProfile();
    if (!profile) return openSettings("models");
    if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
    if (!(await preparing(() => prepareTurn(c)))) return;
    message.status = "streaming";
    message.error = "";
    delete message.interruptedAt;
    saveStore();
    renderConversation(false);
    await streamReply(c, message, profile, { resume: true });
    return;
  }
  if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
  const userIndex = [...c.messages.slice(0, index)].map(m => m.role).lastIndexOf("user");
  if (userIndex < 0) return;
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
  if (!(await preparing(() => prepareTurn(c)))) return;
  forkTail(c, userIndex + 1);
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  c.messages.push(assistant);
  saveStore();
  renderConversation(true);
  await streamReply(c, assistant, profile);
}
/** @param {Conversation} conversation */
async function saveEditedMessage(conversation, index, value) {
  const text = value.trim(),
    old = conversation.messages[index],
    attachments = (old.attachments || []).filter(file => !editingDropped.has(file.id));
  if (!text && !attachments.length) return toast("尚未落笔");
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
  if (text === old.content && attachments.length === (old.attachments || []).length) {
    editingMessageId = null;
    renderConversation(false);
    return;
  }
  if (!(await preparing(() => prepareTurn(conversation)))) return;
  // 旧问题连同它后面的回答整段留作一个版本；新问题沿用原来的引文，附件除去改问时摘掉的
  forkTail(conversation, index);
  const message = { ...old, id: uid(), content: text, ...(old.attachments ? { attachments } : {}), timestamp: now() };
  conversation.messages.push(message);
  conversation.updatedAt = now();
  if (index === 0 && conversation.titleAuto !== false) {
    conversation.title = titleFrom(text, attachments);
    conversation.titled = false;
  }
  editingMessageId = null;
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  conversation.messages.push(assistant);
  saveStore();
  render(true);
  await streamReply(conversation, assistant, profile);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

// 消息上的动作（复制、编辑、重答……）；编辑框里 Ctrl+Enter 保存
function bindMessageActionEvents() {
  $("#messages").addEventListener("click", handleMessageAction);
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !e.target.classList?.contains("message-edit-input")) return;
    e.preventDefault();
    e.target.closest(".message-editor")?.querySelector('[data-action="save-edit"]')?.click();
  });
}
// 改着一条问：Esc 放弃改动
defineLayer({
  name: "editing",
  rank: 50,
  open: () => !!editingMessageId,
  close: () => {
    editingMessageId = null;
    renderConversation(false);
    if (sidePanelOpen()) renderSidePanel();
  }
});
