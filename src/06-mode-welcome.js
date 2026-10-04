// 言 · 言 / 行两态、欢迎页与目录签、开合对话
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 言与行不是两个入口，而是一段对话有没有绑工作目录：绑了就是行（执事，改动落在那个目录，提示词也是执事的做法）；
// 没绑就是言（对谈，文件工具落在卷宗）。目录可以在对话中途绑上或解开，上下文不断
/** @param {Conversation} c */
function isWork(c) {
  return !!c?.workdir;
}
// 沙箱：言与行都套着——桥接那头筛指令、锁目录、去机密环境变量。只有设置 → 工具里一个总开关，默认开
function sandboxed() {
  return store.settings.sandbox !== false;
}
function workMode() {
  const c = currentConversation();
  return c ? isWork(c) : !!(store.settings.pendingWorkdir || "").trim();
}
// 卷宗目录：存储根里的 卷宗/（桥接报来的位置）；没绑目录的对话，工具都落在这里
function archiveDir() {
  return bootstrap.work?.archive || "";
}
// 言里的草稿：卷宗下的隐藏目录 .草稿/<对话id>/，脚本与中间文件放那里，成品放根目录；卷宗页不列它
/** @param {Conversation} c */
function scratchRel(c) {
  return `${bootstrap.work?.scratch || ".草稿"}/${String(c.id)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 12)}`;
}
// 这段对话的工具落脚在哪：绑了目录是它，没绑是卷宗
/** @param {Conversation} c */
function workRoot(c) {
  return c?.workdir || archiveDir();
}
// 侧栏的一枚印：只显示当前的态（言 / 行），改态的入口是目录签
function renderModeSwitch() {
  const work = workMode(),
    seal = $("#modeSeal");
  if (!seal) return;
  seal.dataset.mode = work ? "work" : "chat";
  seal.querySelector(".rail-icon").textContent = work ? "行" : "言";
  seal.querySelector(".wide").textContent = work ? "执事" : "对谈";
  seal.title = work ? "行 · 执事：指令与改动落在工作目录" : "言 · 对谈：产出收入卷宗";
}
const COMMAND_POLICY_META = {
  ask: ["问而后行", "明确只读的指令径直运行，其余先经确认"],
  review: ["审而后行", "桥接代为审过：常规改动与整机查看放行，明确的高风险动作当场回绝，不来打扰"],
  auto: ["径行", "不再审查；沙箱开着时仍守着它那道界"]
};
function commandPolicyOf(c) {
  return normalizeCommandPolicy(c?.commandPolicy, normalizeCommandPolicy(store.settings.commandPolicyDefault));
}
function nextCommandPolicy(value) {
  return { ask: "review", review: "auto", auto: "ask" }[normalizeCommandPolicy(value)];
}
// 三档权限：言与行都可逐段对话设置；按钮循环切换，设置页决定新对话默认值
function renderWorkAuto() {
  const c = currentConversation(),
    button = $("#workAuto");
  if (!button) return;
  const show = !!c && !!workRoot(c) && activeProfile()?.tools !== false;
  button.classList.toggle("hidden", !show);
  if (!show) return;
  const policy = commandPolicyOf(c),
    meta = COMMAND_POLICY_META[policy];
  button.textContent = meta[0];
  button.title = `${meta[0]}：${meta[1]}`;
  button.classList.toggle("on", policy !== "ask");
}
function renderWelcome() {
  const work = workMode();
  $("#welcome .seal").textContent = work ? "行" : "言";
  $("#welcomeSub").textContent = work ? "以目录为案，言起而事行" : "长问慢答，尽付纸墨";
  renderChips(work);
  renderSuggestions(work);
  renderWelcomeNotice();
}
// 首次使用：还没有任何模型配置时，在输入框下给一行引导，而不是等到发送时才弹提示
function renderWelcomeNotice() {
  const el = $("#welcomeNotice");
  if (!el) return;
  const none = !profiles().length;
  el.classList.toggle("hidden", !none);
  if (!none) return;
  el.innerHTML = `<span class="seal" aria-hidden="true">始</span><span>尚未接入模型。OpenAI 兼容与 Anthropic 接口皆可，配置只存于本机、不经云端。</span><button type="button" data-open-models>前往设置 →</button>`;
  el.querySelector("[data-open-models]").onclick = () => openSettings("models");
}
// 欢迎页输入框上方的一行小签：目录签（空着是言、落在卷宗；填了是行）、新对话的三档指令权限
function pathTail(dir) {
  const parts = String(dir || "")
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts.at(-1) || dir;
}
function renderChips(work) {
  const dirChip = $("#workdirChip"),
    pending = (store.settings.pendingWorkdir || "").trim() || pendingGroup()?.workdir || "";
  dirChip.classList.remove("hidden");
  dirChip.querySelector(".chip-text").textContent = pending ? pathTail(pending) : "卷宗";
  dirChip.title = pending ? `${pending}\n行：指令与改动落在此目录` : `言：产出收入卷宗（${archiveDir()}）`;
  dirChip.classList.toggle("on", !!pending);
  const approve = $("#approveChip");
  const policy = normalizeCommandPolicy(store.settings.commandPolicyDefault),
    meta = COMMAND_POLICY_META[policy];
  approve.classList.remove("hidden");
  approve.querySelector(".chip-text").textContent = meta[0];
  approve.classList.toggle("on", policy !== "ask");
  approve.title = `${meta[0]}：${meta[1]}（新对话默认）`;
  renderGroupTags();
}
// 附件签「＋」：展开后二选一——外件（本机文件）或卷宗（已收入的文件，点选即置于案上，在这张菜单里接着选）
function openAttachMenu(anchor) {
  const total = libraryTotal();
  openMenu(
    anchor,
    [
      { id: "file", label: "外件", note: "本机文件", run: () => $("#fileInput").click() },
      {
        id: "archive",
        label: "卷宗",
        note: total ? `${total} 件` : "尚空",
        keep: true,
        run: (button, pop) => (total ? renderArchivePicker(pop, anchor) : toast("卷宗尚空"))
      }
    ],
    { align: "left", kind: "attach" }
  );
}
// 卷宗选件：一栏可查找的清单，点一件即置于案上；子目录里的件注上它所在的夹，查找也认夹名
function renderArchivePicker(pop, anchor) {
  const items = (archiveEntries || []).map(file => ({ key: file.path, name: file.name, dir: parentDir(file.path), size: file.size }));
  pop.classList.add("attach-picker");
  pop.innerHTML = `<input class="field" placeholder="按文件名查找" aria-label="查找卷宗"><div class="chip-pop-list"></div>`;
  const input = pop.querySelector("input"),
    list = pop.querySelector(".chip-pop-list");
  const paint = () => {
    const query = input.value.trim().toLowerCase(),
      shown = items.filter(item => !query || `${item.dir || ""}/${item.name}`.toLowerCase().includes(query));
    list.innerHTML = shown.length
      ? shown
          .map(
            item =>
              `<button type="button" data-pick="${escapeHtml(item.key)}" title="${escapeHtml(item.dir ? `${item.dir}/${item.name}` : item.name)}"><span>${escapeHtml(item.name)}</span><small>${item.dir ? `${escapeHtml(item.dir)} · ` : ""}${formatFileSize(item.size)}</small></button>`
          )
          .join("")
      : `<div class="chip-pop-label">没有匹配的卷宗</div>`;
  };
  paint();
  input.addEventListener("input", paint);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector("[data-pick]")?.click();
    }
  });
  list.addEventListener("click", event => {
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    closeChipPop();
    void placeFromArchive(button.dataset.pick);
  });
  // 清单比菜单高，重新贴一次锚点
  const rect = anchor.getBoundingClientRect(),
    height = pop.offsetHeight;
  if (pop.classList.contains("drop-up") || innerHeight - rect.bottom - 6 < height + 10) {
    pop.classList.add("drop-up");
    pop.style.top = `${Math.max(10, rect.top - 6 - height)}px`;
  }
  setTimeout(() => input.focus(), 0);
}
// 历史条目的「⋯」：置顶、改名、绑定（更换目录）、分组、导出、删除
function openHistoryMenu(id, anchor) {
  const c = store.conversations.find(item => item.id === id);
  if (!c) return;
  const row = anchor.closest(".history-item") || anchor;
  openMenu(
    anchor,
    [
      { id: "pin", label: c.pinned ? "取消置顶" : "置顶", run: () => togglePin(id) },
      { id: "rename", label: "改名", run: () => startRename(id) },
      {
        id: "bind",
        label: isWork(c) ? "更换目录" : "绑定目录",
        run: () =>
          openWorkdirPop({
            anchor: row,
            host: null,
            value: c.workdir || "",
            live: false,
            bound: isWork(c),
            floating: true,
            onCommit: dir => void bindWorkdir(c, dir)
          })
      },
      { id: "group", label: groupOf(c) ? "移至他组" : "移入分组", run: () => openMoveMenu(c, row) },
      { id: "export", label: "导出", note: "存入卷宗", run: () => void exportConversationMarkdown(c) },
      { id: "delete", label: "删除", danger: true, run: () => deleteConversation(id) }
    ],
    { kind: "history", key: id }
  );
}
// 目录签的弹层，欢迎页与对话页共用：输入 / 选择；不列「最近」——删掉的目录会留在那儿、点了又能把它绑回来，每次自己选。
// live 时每敲一字都落值（欢迎页记到待绑目录），否则回车、点选才落值（对话页要经桥接绑定）
// floating：不挂在 host 里而是浮在锚点旁（侧栏历史条目的「绑定目录」用），其余一样
function openWorkdirPop({ anchor, host, value, live, bound, onCommit, floating = false }) {
  if ((floating ? document : host).querySelector(".chip-pop[data-kind=workdir]")) return closeChipPop();
  const html = `<div class="chip-pop-row"><input id="workdirInput" class="field" spellcheck="false" autocomplete="off" placeholder="${live ? "留空则为言" : "输入或选择目录"}" value="${escapeHtml(value || "")}"><button id="workdirPick" class="outline-btn" type="button">选择…</button>${live ? "" : `<button id="workdirCommit" class="outline-btn" type="button">${bound ? "更换" : "绑定"}</button>`}</div>${bound ? `<button type="button" class="chip-pop-unbind" data-unbind>解开目录，回到言</button>` : live ? `<button type="button" class="chip-pop-unbind${value ? "" : " hidden"}" data-unbind>不绑目录，回到言</button>` : ""}`;
  const pop = floating ? openFloatingPop(anchor, html, { align: "right", menu: false }) : openChipPop(anchor, host, html);
  pop.dataset.kind = "workdir";
  const input = pop.querySelector("#workdirInput"),
    commit = (dir, close = false) => {
      onCommit(dir.trim());
      if (close) closeChipPop();
      else if (live) pop.querySelector("[data-unbind]")?.classList.toggle("hidden", !dir.trim());
    };
  if (live) input.addEventListener("input", () => commit(input.value));
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (live) {
      closeChipPop();
      $("#welcomeInput").focus();
    } else commit(input.value, true);
  });
  pop.querySelector("#workdirCommit")?.addEventListener("click", () => commit(input.value, true));
  pop.querySelector("[data-unbind]")?.addEventListener("click", () => commit("", true));
  // 「选择…」：由桥接弹出本机的文件夹对话框，选好回填
  pop.querySelector("#workdirPick").onclick = async () => {
    const button = pop.querySelector("#workdirPick");
    button.disabled = true;
    button.textContent = "选择中…";
    try {
      const data = await bridge("/api/work/pick", { current: input.value.trim() }, AbortSignal.timeout(300000));
      if (data.path) {
        input.value = data.path;
        commit(data.path, !live);
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      button.disabled = false;
      button.textContent = "选择…";
    }
  };
  setTimeout(() => input.focus(), 0);
}
// 对话中途绑上 / 解开目录：只是给对话记一个目录，下一问起工具与提示词随之而变，历史一字不丢
/** @param {Conversation} c */
async function bindWorkdir(c, dir) {
  dir = String(dir || "").trim();
  if (!dir) {
    if (!isWork(c)) return;
    c.workdir = "";
    saveStore();
    render();
    toast("已解开目录，回到言");
    return;
  }
  if (activeProfile()?.tools === false) return toast("当前模型已关闭本机工具，请在模型高级配置中开启");
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: dir }, AbortSignal.timeout(8000));
    if (prepared.workdir === c.workdir) return;
    c.workdir = prepared.workdir;
    c.commandPolicy = commandPolicyOf(c);
    saveStore();
    render();
    toast(`已绑定 ${pathTail(prepared.workdir)}${prepared.created ? "（新建）" : ""}，此后为行`);
  } catch (error) {
    toast(`工作目录不可用：${String(error.message || error)}`);
  }
}
function setupChips() {
  const chips = $("#welcomeChips");
  chips.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", closeChipPop);
  $("#workdirChip").onclick = () =>
    openWorkdirPop({
      anchor: $("#workdirChip"),
      host: chips,
      value: store.settings.pendingWorkdir || "",
      live: true,
      bound: false,
      onCommit: dir => {
        if (dir) store.settings.pendingWorkdir = dir;
        else delete store.settings.pendingWorkdir;
        saveStoreSoon();
        renderHeader();
        renderHistory();
      }
    });
  $("#welcomeGroup").onclick = () => {
    delete store.settings.pendingGroupId;
    saveStore();
    renderChips(workMode());
    renderHeader();
  };
  $("#chatGroup").onclick = () => openGroupsPage(groupOf(currentConversation())?.id || null);
  $("#approveChip").onclick = () => {
    store.settings.commandPolicyDefault = nextCommandPolicy(store.settings.commandPolicyDefault);
    saveStore();
    renderChips(workMode());
  };
  // 对话页标题下的目录签：绑上、更换或解开
  const meta = $("#chatMeta");
  meta.addEventListener("click", event => {
    if (event.target.closest(".chip-pop")) return event.stopPropagation();
    if (event.target.closest("[data-export-md]")) return void exportConversationMarkdown(currentConversation());
    const button = event.target.closest("[data-workdir-bind]");
    if (!button) return;
    event.stopPropagation();
    const c = currentConversation();
    if (!c) return;
    openWorkdirPop({
      anchor: button,
      host: meta,
      value: c.workdir || "",
      live: false,
      bound: isWork(c),
      onCommit: dir => void bindWorkdir(c, dir)
    });
  });
}
function newChat() {
  closeSidePanel();
  persistDraft();
  rememberScrollPosition();
  pendingAttachments = [];
  pendingProfileId = "";
  currentId = null;
  editingMessageId = null;
  view = "chat";
  render();
  setTimeout(() => $("#welcomeInput").focus(), 0);
  if (isMobile()) toggleSidebar(true);
}
function openConversation(id) {
  if (id !== currentId) {
    closeSidePanel();
    persistDraft();
    rememberScrollPosition();
    pendingAttachments = [];
  }
  currentId = id;
  editingMessageId = null;
  view = "chat";
  const c = currentConversation();
  if (c) {
    c.unread = false;
    // 新对话照最近看的这段用的预设（预设带了模型的，新对话也就用那个模型）
    store.settings.presetId = presetOf(c)?.id || "";
    // 别处可能在这段里写过而这边没察觉（报到有间隔）：读一下目录里那份，新就跟上
    void catchUpFromDisk([c.id]);
  }
  render();
  if (isMobile()) toggleSidebar(true);
}
async function deleteConversation(id) {
  const removed = store.conversations.find(c => c.id === id);
  if (!removed) return;
  // 那一处还在写，删了它也会写回来
  if (runningElsewhere(id)) return toast("这段对话正在另一个页面作答，那边停下后再删");
  if (!(await askConfirm({ title: "删除这段对话？", body: `「${removed.title}」将连同其附件一起移除，无法撤销。`, ok: "删除" }))) return;
  if (conversationRunning(id)) stopGeneration(id);
  for (const [key, job] of requestJobs)
    if (job.conversationId === id) {
      job.controller.abort();
      requestJobs.delete(key);
    }
  if (currentId === id) closeSidePanel();
  const draftFiles = draftRecord(id).attachments.map(file => file.id);
  clearDraft(id);
  void cleanScratch(removed);
  void deleteAttachments([...attachmentIds(allMessages(removed)), ...draftFiles]);
  store.conversations = store.conversations.filter(c => c.id !== id);
  void deleteConversationStorage(id);
  if (currentId === id) {
    currentId = null;
    pendingAttachments = [];
  }
  saveStore();
  render();
  toast("对话已删除");
}
function togglePin(id) {
  const c = store.conversations.find(item => item.id === id);
  if (!c) return;
  c.pinned = !c.pinned;
  markDirty(id);
  saveStore();
  renderHistory();
}
function startRename(id) {
  renamingId = id;
  renamingDirty = false;
  renderHistory();
}
function commitRename(value) {
  const id = renamingId;
  renamingId = null;
  const changed = renamingDirty;
  renamingDirty = false;
  if (id && changed) renameConversation(id, value);
  else renderHistory();
}
function renameConversation(id, value) {
  const c = store.conversations.find(item => item.id === id),
    title = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  if (c && title && title !== c.title) {
    c.title = title;
    c.titleAuto = false;
    markDirty(id);
    saveStore();
  }
  renderHistory();
  if (c && currentId === id) {
    $("#chatTitle").textContent = c.title;
    syncDocumentTitle();
  }
}
function selectProfile(id, shouldRender = true) {
  const profile = profiles().find(p => p.id === id);
  if (!profile) return;
  const c = currentConversation(),
    wasDry = conversationDry(c);
  // 换模型只换眼前这段（还没发出的新对话记在 pendingProfileId），默认模型不动；档位取新模型记住的那档
  const reasoning = normalizeReasoning(profile.reasoning);
  if (c) {
    if (c.profileId !== id || c.reasoning !== reasoning) {
      c.profileId = id;
      c.reasoning = reasoning;
      markDirty(c.id);
      saveStore();
    }
  } else pendingProfileId = id;
  closeModelMenu();
  if (shouldRender) {
    renderHeader();
    if (c && view === "chat" && wasDry !== conversationDry(c)) renderConversation();
    renderSendButtons();
  }
}

function syncJumpBottom(gap) {
  const el = $("#chatScroll");
  if (gap === undefined) gap = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
  $("#jumpBottom").classList.toggle("hidden", view !== "chat" || !currentId || gap < 260);
}
function syncChatScrollGrabber() {
  const host = $("#chatScroll"),
    grabber = $("#chatScrollGrabber");
  if (!host || !grabber) return;
  grabber.classList.toggle("active", view === "chat" && !!currentId && host.scrollHeight > host.clientHeight + 1);
}
function syncDocumentTitle() {
  const c = currentConversation();
  document.title = view === "library" ? "卷宗 · 言" : view === "groups" ? "分组 · 言" : c ? `${c.title} · 言` : "言";
  renderRunningHead(); // 标题改了（手改、拟题），书眉跟着换
}

// 侧栏的对话历史（检索、点开、改名）与正文顶上的题名
function bindHistoryEvents() {
  $("#historySearch").addEventListener("input", e => {
    historyQuery = e.target.value;
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(renderHistory, 120);
  });
  $("#historySearch").addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.stopPropagation();
      toggleHistorySearch(false);
    }
  });
  $("#historySearchToggle").onclick = () => toggleHistorySearch();
  $("#historySearchClose").onclick = () => toggleHistorySearch(false);
  $("#history").addEventListener("dblclick", e => {
    const item = e.target.closest("[data-conversation]");
    if (item && !e.target.closest(".history-rename, [data-history-action]")) startRename(item.dataset.conversation);
  });
  $("#history").addEventListener("click", e => {
    const toggle = e.target.closest("[data-repo-toggle]");
    if (toggle) {
      const dir = toggle.dataset.repoToggle,
        set = new Set(store.settings.collapsedRepos || []);
      set.has(dir) ? set.delete(dir) : set.add(dir);
      store.settings.collapsedRepos = [...set];
      saveStoreSoon();
      renderHistory();
      return;
    }
    const repo = e.target.closest("[data-history-workdir]");
    if (repo) {
      store.settings.pendingWorkdir = repo.dataset.historyWorkdir;
      saveStore();
      newChat();
      return;
    }
    const item = e.target.closest("[data-conversation]");
    if (!item) return;
    const id = item.dataset.conversation,
      action = e.target.closest("[data-history-action]")?.dataset.historyAction;
    if (action === "menu") {
      e.stopPropagation();
      openHistoryMenu(id, e.target.closest("[data-history-action]"));
    } else if (!e.target.closest(".history-rename")) openConversation(id);
  });
  $("#history").addEventListener("keydown", e => {
    const input = e.target.closest(".history-rename");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter 本身就是明确提交；也照顾脚本/输入法最后一拍尚未来得及冒 input 事件的情形。
      renamingDirty = true;
      commitRename(input.value);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      renamingId = null;
      renamingDirty = false;
      renderHistory();
    }
  });
  $("#history").addEventListener("input", e => {
    if (e.target.closest(".history-rename") && renamingId) renamingDirty = true;
  });
  $("#history").addEventListener("focusout", e => {
    const input = e.target.closest(".history-rename");
    if (input && renamingId && !renderingHistory) commitRename(input.value);
  });
  const title = $("#chatTitle");
  let titleDirty = false,
    titleCanceled = false;
  title.addEventListener("focus", () => {
    titleDirty = false;
    titleCanceled = false;
  });
  title.addEventListener("input", () => (titleDirty = true));
  title.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      titleCanceled = true;
      title.textContent = currentConversation()?.title || "";
      title.blur();
    }
  });
  title.addEventListener("blur", () => {
    const c = currentConversation();
    if (!c) return;
    const value = title.textContent.replace(/\s+/g, " ").trim();
    if (!titleCanceled && titleDirty && value && value !== c.title) renameConversation(c.id, value);
    else title.textContent = c.title;
    titleDirty = false;
    titleCanceled = false;
  });
}
let chatSuggestionsHtml = "",
  bindSuggestions = () => {},
  suggestionsMode = "chat";
function renderSuggestions(work) {
  const mode = work ? "work" : "chat";
  if (mode === suggestionsMode || !chatSuggestionsHtml) return;
  suggestionsMode = mode;
  $("#welcome .suggestions").innerHTML = work
    ? WORK_SUGGESTIONS.map(
        ([label, prompt]) => `<button class="suggestion" data-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`
      ).join("")
    : chatSuggestionsHtml;
  bindSuggestions();
}
let historySearchTimer = null;
// 都是自拟：文白相杂，不借前人成句（成句一眼认得出，反倒像题词）；不必对仗，各按时辰
const GREETINGS = {
  night: [
    "夜深墨浓",
    "长夜无声，一纸独明",
    "更漏迟迟，落字从容",
    "万家灯熄，此处尚明",
    "夜气清，一灯独醒",
    "星沉案角，砚水未寒",
    "夜阑不寐，与纸相对"
  ],
  morning: [
    "晨光入砚",
    "新墨初研",
    "晨露未晞，素纸已展",
    "窗明案净，正宜开篇",
    "茶尚温，题未定",
    "清气满案，诸念未起",
    "朝暾初上，纸色微明"
  ],
  day: [
    "落笔，便有回声",
    "案上清宁，纸有余白",
    "日影过窗，正好一叙",
    "半窗日色，一案清言",
    "竹影移阶，清昼方长",
    "午后人闲，宜读宜写",
    "帘外风轻，砚边日暖"
  ],
  evening: [
    "灯下长谈，不觉夜深",
    "一灯如豆，纸墨相亲",
    "暮色入窗，墨色渐深",
    "日暮灯明，余墨尚多",
    "一日将尽，尚有余话",
    "掌灯时分，可以慢谈",
    "晚风过案，且留一页"
  ]
};
const WORK_GREETINGS = [
  "言毕，即行",
  "墨未干，事已行",
  "纸上落言，案前成事",
  "意既明，手便随",
  "一言既定，诸事随之",
  "一事一毕，不留残笔",
  "议定即行，不尚空谈"
];
const greetingPick = Math.random();
function greeting() {
  if (workMode()) return WORK_GREETINGS[Math.floor(greetingPick * WORK_GREETINGS.length)];
  const h = new Date().getHours(),
    pool = GREETINGS[h < 6 ? "night" : h < 11 ? "morning" : h < 18 ? "day" : "evening"];
  return pool[Math.floor(greetingPick * pool.length)];
}
const WORK_SUGGESTIONS = [
  [
    "读懂这个项目",
    "先通读工作目录中的项目：用 list_files 与 read_file 了解结构与入口，然后用几段话说明它的用途、运行方式与值得留意之处。不要改动任何文件。"
  ],
  [
    "修一个问题",
    "在工作目录中定位并修复下面的问题：先用 search_files 找到相关代码，read_file 读懂上下文，再用 edit_file 做最小改动，最后运行相关测试或复现步骤验证：\n\n（问题描述）"
  ],
  [
    "加一个功能",
    "在工作目录中实现下面的功能：先看清现有结构与约定，用两三行说明方案，然后落实到文件并运行验证，不要改动无关代码：\n\n（功能描述）"
  ],
  ["写一段脚本并运行", "编写一个脚本完成下述事项，置于工作目录中；写好后运行一遍并给出输出，若有报错则修正至可运行：\n\n（要做的事）"]
];
