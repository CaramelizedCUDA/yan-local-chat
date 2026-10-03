// 言 · 设置页：开合、各栏的画法与事件、存储位置
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
let settingsReturnFocus = null;
function openSettings(tab = settingsTab) {
  if ($("#settingsModal").classList.contains("hidden")) settingsReturnFocus = document.activeElement;
  persistDraft();
  rememberScrollPosition();
  settingsTab = tab;
  showNow($("#settingsModal"));
  renderSettings();
  $("#closeSettings").focus();
}
function closeSettings() {
  hideWithFade($("#settingsModal"));
  if (settingsReturnFocus?.isConnected) settingsReturnFocus.focus();
  settingsReturnFocus = null;
  // 「手记一条」后没写字就关了窗：那条空的不留（文本框随窗撤掉时未必触发 blur）
  const kept = store.memory.items.filter(item => String(item.text || "").trim());
  if (kept.length !== store.memory.items.length) {
    store.memory.items = kept;
    saveStore();
  }
  render();
}
function renderSettings() {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === settingsTab));
  const host = $("#settingsContent");
  const tabChanged = host.dataset.tab !== settingsTab;
  host.dataset.tab = settingsTab;
  if (settingsTab === "general") host.innerHTML = generalSettingsHtml();
  if (settingsTab === "appearance") host.innerHTML = appearanceSettingsHtml();
  if (settingsTab === "models") host.innerHTML = modelsSettingsHtml();
  if (settingsTab === "presets") host.innerHTML = presetsSettingsHtml();
  if (settingsTab === "tools") host.innerHTML = toolsSettingsHtml();
  if (settingsTab === "env") host.innerHTML = envSettingsHtml();
  if (settingsTab === "mcp") host.innerHTML = mcpSettingsHtml();
  if (settingsTab === "memory") host.innerHTML = memorySettingsHtml();
  if (settingsTab === "guide") host.innerHTML = guideSettingsHtml();
  if (settingsTab === "about") host.innerHTML = aboutSettingsHtml();
  // 每栏题头：这一栏的笔意图标、标题（导语跟在题下），压一道墨线（记忆页自带）；文档里翻开的一篇有自己的书口，关于页的题目是「言」本身，都不加
  const title = host.querySelector("h2");
  if (BRUSH_ICONS[settingsTab] && title && !title.previousElementSibling && !title.parentElement.classList.contains("about-head")) {
    const head = document.createElement("div"),
      lead = title.nextElementSibling?.classList.contains("settings-lead") ? title.nextElementSibling : null;
    head.className = "about-head memory-head settings-head";
    head.innerHTML = brushIcon(settingsTab, "settings-mark");
    title.before(head);
    head.append(title);
    if (lead) head.append(lead);
  }
  bindSettingsEvents();
  bindMemoryEvents();
  bindMcpEvents();
  bindEnvEvents();
  bindPresetEvents();
  bindGuideEvents();
  if (tabChanged) {
    host.classList.remove("tab-fade");
    void host.offsetWidth;
    host.classList.add("tab-fade");
  }
}
// 存储位置：对话、卷宗、配置（含模型配置）都在这一个 .yan 目录里，几个浏览器共用；换位置时整份拷过去，旧处留着
function storageSettingsHtml() {
  const info = bootstrap.store || {},
    parent = info.parent || "";
  return `<div class="setting-row"><div class="setting-copy"><strong>存储位置</strong><small><code title="${escapeHtml(info.root || "")}">${escapeHtml(info.root || "")}</code></small></div><div class="setting-actions setting-directory"><input id="settingStore" class="field" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(parent)}" value="${escapeHtml(parent)}"><button id="settingStorePick" class="outline-btn" type="button">选择…</button></div></div>`;
}
function generalSettingsHtml() {
  return `<h2>通用</h2><div class="setting-row"><div class="setting-copy"><strong>显示名称</strong><small>侧栏中显示的称呼</small></div><input id="settingName" class="field" value="${escapeHtml(store.settings.name)}"></div><div class="setting-row"><div class="setting-copy"><strong>自动拟题</strong><small>由模型拟题，略耗额度</small></div><div class="segmented"><button data-setting="autoTitle" data-value="true" class="${store.settings.autoTitle ? "active" : ""}">开</button><button data-setting="autoTitle" data-value="false" class="${store.settings.autoTitle ? "" : "active"}">关</button></div></div>${storageSettingsHtml()}<div class="setting-row"><div class="setting-copy"><strong>本机数据</strong><small>${store.conversations.length} 段对话 · ${libraryTotal()} 件卷宗 · 配置 ${storageSize()} · 附件原件 ${formatFileSize(usedAttachmentBytes())}</small></div><div class="setting-actions"><label class="check"><input id="exportFiles" type="checkbox">含附件原件</label><button id="exportData" class="outline-btn">导出备份</button><button id="importData" class="outline-btn">导入备份</button></div></div><div class="setting-row"><div class="setting-copy"><strong>清空所有对话</strong><small>模型配置、个性化与卷宗将保留</small></div><button id="clearAll" class="danger-btn">清空对话</button></div>`;
}
// 工具：沙箱、三档指令权限、可及范围、卷宗可读、轮次上限——模型能动手的边界都在这一栏
function toolsSettingsHtml() {
  const policy = normalizeCommandPolicy(store.settings.commandPolicyDefault);
  return `<h2>工具</h2><div class="setting-row"><div class="setting-copy"><strong>沙箱</strong><small>改动不出目录，不碰机密，不动系统</small></div><div class="segmented"><button data-setting="sandbox" data-value="true" class="${store.settings.sandbox !== false ? "active" : ""}">开</button><button data-setting="sandbox" data-value="false" class="${store.settings.sandbox === false ? "active" : ""}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>指令权限</strong><small>新对话的默认档位</small></div><div class="segmented"><button data-setting="commandPolicyDefault" data-value="ask" class="${policy === "ask" ? "active" : ""}">问而后行</button><button data-setting="commandPolicyDefault" data-value="review" class="${policy === "review" ? "active" : ""}">审而后行</button><button data-setting="commandPolicyDefault" data-value="auto" class="${policy === "auto" ? "active" : ""}">径行</button></div></div><div class="setting-row"><div class="setting-copy"><strong>文件工具可及范围</strong><small>问而后行开着沙箱时一律目录内</small></div><div class="segmented"><button data-setting="toolReach" data-value="anywhere" class="${store.settings.toolReach !== "inside" ? "active" : ""}">全盘</button><button data-setting="toolReach" data-value="inside" class="${store.settings.toolReach === "inside" ? "active" : ""}">目录内</button></div></div><div class="setting-row"><div class="setting-copy"><strong>卷宗对模型可读</strong><small>模型可翻阅卷宗里的文档</small></div><div class="segmented"><button data-setting="archiveRead" data-value="true" class="${store.settings.archiveRead !== false ? "active" : ""}">开</button><button data-setting="archiveRead" data-value="false" class="${store.settings.archiveRead === false ? "active" : ""}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>工具轮次上限</strong><small>留空不限</small></div><div class="setting-actions"><label class="setting-inline">一答<input id="settingToolRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不限" value="${roundLimitText(toolRoundLimit())}"></label><label class="setting-inline">帮手<input id="settingSubRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不限" value="${roundLimitText(subRoundLimit())}"></label></div></div><div class="setting-row"><div class="setting-copy"><strong>联网检索</strong><small id="searchStatus">经本机桥接</small></div><button id="testSearch" class="outline-btn" type="button">测试联网</button></div>`;
}
function appearanceSettingsHtml() {
  const s = store.settings;
  return `<h2>个性化</h2><p class="settings-lead">清简为骨，纸墨为意。</p>${segmentRow(
    "主题",
    "随系统或固定明暗",
    "theme",
    [
      ["light", "亮"],
      ["dark", "暗"],
      ["system", "系统"]
    ],
    s.theme
  )}${segmentRow(
    "界面动效",
    "落墨与天光、印章呼吸与开合过渡",
    "inkMotion",
    [
      ["on", "开"],
      ["system", "随系统"],
      ["off", "关"]
    ],
    s.inkMotion || "on"
  )}${fontRow(s.font)}${segmentRow(
    "阅读宽度",
    "长文的行宽",
    "width",
    [
      [680, "窄"],
      [760, "适中"],
      [860, "宽"]
    ],
    s.width
  )}<div class="setting-row"><div class="setting-copy"><strong>印色</strong><small>界面中的点睛之色</small></div><div class="segmented">${["#9b5540", "#536d62", "#5c6386", "#75644f"].map(v => `<button data-setting="accent" data-value="${v}" class="${s.accent === v ? "active" : ""}" style="color:${v}">●</button>`).join("")}</div></div>`;
}
// 关于：身份、边界、键与手势、开源致谢。随项目本地分发的库与许可见 vendor/
const CREDITS = [
  ["marked", "18.0.13", "MIT"],
  ["DOMPurify", "3.4.15", "Apache-2.0"],
  ["highlight.js", "11.12.0", "BSD-3-Clause"],
  ["KaTeX", "0.18.7", "MIT"],
  ["Mermaid", "11.17.2", "MIT"],
  ["Apache ECharts", "5.6.1", "Apache-2.0"],
  ["PDF.js", "3.11.174", "Apache-2.0"]
];
const kbd = keys =>
  keys
    .split("+")
    .map(key => `<span class="kbd">${escapeHtml(key)}</span>`)
    .join(" + ");
function aboutSettingsHtml() {
  const version = bootstrap.version || APP_VERSION;
  const rows = list => `<dl class="about-list">${list.map(([term, detail]) => `<dt>${term}</dt><dd>${detail}</dd>`).join("")}</dl>`;
  return (
    `<div class="about-head"><h2>言</h2><span class="about-version">v${escapeHtml(version)}</span></div><p class="about-ethos">清简为骨，纸墨为意。<br>长问慢答，尽付纸墨；言毕，即行。</p>` +
    `<div class="about-section"><h3>数据与边界</h3>${rows([
      [
        "存放",
        "一切落在本机的存储位置（默认 ~/.yan，可在通用设置更换）：对话/ 一段一个文件，卷宗/ 是成品与收进来的文件，附件/ 是附件原件，配置.json 是设置、模型配置（含 API Key）、记忆与草稿；复制整个目录即备份。不经任何云端"
      ],
      ["桥接", "本机进程，仅监听 127.0.0.1：转发模型请求，代行指令与文件，守着后台指令；联网检索与读取网页时拒绝访问本机与内网地址"],
      [
        "执事",
        "指令在你的机器上、以你的权限执行，只读指令直接执行，其余默认逐条确认；文件工具能否越出工作目录由设置 → 工具的「可及范围」定（默认全盘，问而后行开着沙箱时只在目录内）"
      ],
      [
        "沙箱",
        "指令与文件工具默认套着：路径不出目录、机密文件不碰、动系统与直接外联的指令拒绝、机密环境变量不给指令，在桥接那头守。是静态筛查，不是进程隔离——脚本里的代码仍以你的权限运行；设置 → 工具可关"
      ],
      ["记忆", "模型在对谈中记下的一句句话，只存于本机；何时记、何时看由它判断，不随每次请求发送，可在「记忆」页查改或关闭"],
      ["备份", "导出的备份不含 API Key；可选择是否带上附件原件"]
    ])}</div>` +
    `<div class="about-section"><h3>键与操作</h3>${rows([
      [kbd("Enter"), "发送；" + kbd("Shift+Enter") + " 换行"],
      [kbd("Esc"), "关闭弹层、取消编辑、去掉引文、退出全屏"],
      ["划选正文", "浮出「引用 · 旁注」：引用随下一问送出；旁注于右侧另开一线，读得到正文，却不入正文"],
      ["拖入 · 粘贴", "文件拖入页面或粘贴图片，即置于案上；在卷宗页拖入则收入卷宗"],
      ["双击侧栏标题", "重命名对话；亦可直接修改页面上方的标题"],
      ["消息旁 ‹ ›", "在同一位置的不同版本之间切换"]
    ])}</div>` +
    `<div class="about-section"><h3>开源致谢</h3><ul class="about-credits">${CREDITS.map(([name, ver, license]) => `<li><span>${escapeHtml(name)}</span><small>${escapeHtml(ver)} · ${escapeHtml(license)}</small></li>`).join("")}</ul><p class="about-note">以上库全部随项目本地分发，不加载任何在线资源；许可全文见 vendor 目录。运行环境仅需 Node.js 18 或更高版本，无需安装依赖。</p></div>`
  );
}
// 字体一行：每个钮用自己那种字写自己的名字，一眼看出气质
function fontRow(active = "mixed") {
  const items = [
    ["mixed", "混排"],
    ["sans", "黑体"],
    ["serif", "宋体"],
    ["kai", "楷体"],
    ["fangsong", "仿宋"]
  ];
  return `<div class="setting-row"><div class="setting-copy"><strong>字体</strong><small>回复与标题用的字</small></div><div class="segmented font-segmented">${items.map(([v, label]) => `<button data-setting="font" data-value="${v}" class="${(active || "mixed") === v ? "active" : ""}" style="font-family:${escapeHtml(FONT_STACKS[v].title)}">${label}</button>`).join("")}</div></div>`;
}
function segmentRow(title, desc, key, items, active) {
  return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><small>${desc}</small></div><div class="segmented">${items.map(([v, label]) => `<button data-setting="${key}" data-value="${v}" class="${String(active) === String(v) ? "active" : ""}">${label}</button>`).join("")}</div></div>`;
}

function storageSize() {
  const bytes = new Blob([JSON.stringify(store)]).size;
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
// 存储位置的更换排着队来（见 bindSettingsEvents 里的 commitStore）
let storeMoves = Promise.resolve();
function bindSettingsEvents() {
  $("#settingName")?.addEventListener("input", e => {
    store.settings.name = e.target.value || "访客";
    saveStoreSoon();
  });
  for (const [id, key, fallback] of [
    ["#settingToolRounds", "toolRounds", DEFAULT_TOOL_ROUNDS],
    ["#settingSubRounds", "subRounds", DEFAULT_SUB_ROUNDS]
  ])
    $(id)?.addEventListener("input", e => {
      // 留空记作 0：不限
      const text = e.target.value.trim(),
        value = Math.floor(Number(text));
      store.settings[key] = !text ? 0 : value >= 1 ? value : fallback;
      saveStoreSoon();
    });
  // 存储位置：桥接把整份拷到新处（那里已有言的数据就直接用），页面换上新路径后把对话与配置对一遍、卷宗重翻；旧处不删
  const storeInput = $("#settingStore");
  let storeTimer = null;
  const commitStore = value => {
    clearTimeout(storeTimer);
    // 一次换完（对话对齐、卷宗重翻、设置页重画）再换下一次：连着换两回时，前一回迟到的收尾不能把页面又画回它那个位置
    storeTimer = setTimeout(() => (storeMoves = storeMoves.then(moveStore, moveStore)), 600);
    const moveStore = async () => {
      const next = String(value || "").trim();
      if (!next || next === (bootstrap.store?.parent || "")) return;
      let data;
      try {
        data = await bridge("/api/store/move", { parent: next }, AbortSignal.timeout(600000));
      } catch (error) {
        return toast(String(error.message || error).slice(0, 80));
      }
      if (!data.moved) return;
      bootstrap.store = { root: data.root, parent: data.parent, fresh: false };
      bootstrap.work = { ...bootstrap.work, chats: data.chats, archive: data.archive, files: data.files };
      envStatus = null;
      clearTimeout(envPoll);
      void refreshEnv();
      chatsBroken = false;
      chatHashes.clear();
      chatStamps.clear();
      chatDiskStamps.clear();
      chatBases.clear();
      chatDiskWrites.clear();
      // 搬到一个已有言数据的地方：那边的配置为准；拷过去的：这边的就是那边的
      if (data.adopted) {
        configBase = "";
        configSyncedAt = 0;
        const disk = await bridge("/api/store/config/load", {}, AbortSignal.timeout(20000)).catch(() => null);
        if (disk?.config) adoptConfig(disk.config, Number(disk.savedAt) || 0);
      } else saveConfigNow({ force: true });
      await syncChatsWithDisk();
      const ids = store.conversations.map(conversation => conversation.id);
      flushConversations(ids, { force: true });
      archiveEntries = null;
      await refreshArchive();
      try {
        localStorage.setItem(STORE_ROOT_KEY, data.root);
      } catch {}
      renderSettings();
      toast(`存储已换到 ${pathTail(data.root)}；${data.adopted ? "用的是那里原有的数据" : "旧处原样留着"}`);
    };
  };
  storeInput?.addEventListener("change", e => commitStore(e.target.value));
  $("#settingStorePick")?.addEventListener("click", async () => {
    const button = $("#settingStorePick");
    button.disabled = true;
    try {
      const data = await bridge(
        "/api/work/pick",
        { current: storeInput.value.trim() || bootstrap.store?.parent || "" },
        AbortSignal.timeout(300000)
      );
      if (data.path) {
        storeInput.value = data.path;
        commitStore(data.path);
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      button.disabled = false;
    }
  });
  // 测试联网：检索走的是桥接，与哪个模型无关，放在工具一栏
  $("#testSearch")?.addEventListener("click", async () => {
    const status = $("#searchStatus");
    status.textContent = "检索中…";
    try {
      const data = await bridge("/api/search", { query: "OpenAI", count: 1 }, AbortSignal.timeout(20000));
      status.textContent = data.results?.length ? `可用 · ${data.results.length} 条结果` : "已连上，但这回没有结果";
    } catch (error) {
      status.textContent = friendlyError(error.message).slice(0, 60);
    }
  });
  $("#exportData")?.addEventListener("click", () => exportData($("#exportFiles")?.checked));
  $("#importData")?.addEventListener("click", () => $("#importInput").click());
  $("#importInput").onchange = async e => {
    const [file] = e.target.files;
    e.target.value = "";
    if (file) await importData(file);
  };
  $("#clearAll")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: "清空全部对话？",
        body: `${store.conversations.length} 段对话将被移除，无法撤销；模型配置、个性化与卷宗将保留。`,
        ok: "清空"
      }))
    )
      return;
    stopAllGenerations();
    const conversationIds = new Set(store.conversations.map(c => c.id)),
      draftFiles = Object.entries(store.drafts || {})
        .filter(([key]) => conversationIds.has(key))
        .flatMap(([, draft]) => (Array.isArray(draft?.attachments) ? draft.attachments.map(file => file.id) : []));
    const currentDraftFiles = currentId ? pendingAttachments.map(file => file.id) : [];
    void deleteAttachments([...attachmentIds(store.conversations.flatMap(allMessages)), ...draftFiles, ...currentDraftFiles]);
    for (const c of store.conversations) void deleteConversationStorage(c.id);
    store.conversations = [];
    store.drafts = store.drafts?.[NEW_DRAFT_ID] ? { [NEW_DRAFT_ID]: store.drafts[NEW_DRAFT_ID] } : {};
    scrollPositions.clear();
    currentId = null;
    pendingAttachments = [];
    saveStore();
    render();
    renderSettings();
    toast("所有对话已清空");
  });
  document.querySelectorAll("[data-setting]").forEach(
    button =>
      (button.onclick = () => {
        const key = button.dataset.setting,
          value = button.dataset.value;
        if (key === "theme") {
          switchTheme(value, button);
          renderSettings();
          return;
        }
        if (key === "memoryEnabled") {
          store.memory.enabled = value === "true";
          saveStore();
          renderSettings();
          return;
        }
        store.settings[key] =
          key === "width" ? Number(value) : ["autoTitle", "archiveRead", "sandbox"].includes(key) ? value === "true" : value;
        saveStore();
        applyAppearance();
        renderSettings();
      })
  );
  $("#addProfile")?.addEventListener("click", () => {
    /** @type {Profile} */
    const p = {
      id: uid(),
      name: "新模型",
      model: "",
      baseUrl: "",
      apiKey: "",
      quota: "",
      usedTokens: 0
    };
    store.profiles.push(p);
    store.settings.activeProfileId ||= p.id;
    profileOpen.add(p.id);
    saveStore();
    renderSettings();
    setTimeout(() => document.querySelector(`[data-profile-card="${p.id}"] [data-field="name"]`)?.focus(), 0);
  });
  document.querySelectorAll("[data-profile-card]").forEach(card => {
    const p = profiles().find(item => item.id === card.dataset.profileCard);
    if (!p) return;
    card.querySelectorAll("[data-field]").forEach(input =>
      input.addEventListener("input", e => {
        const field = e.target.dataset.field;
        // 温度清空即不传（Number("") 是 0，不能照转）
        if (field === "temperature" && !e.target.value.trim()) delete p.temperature;
        else
          p[field] = ["temperature", "maxTokens", "usedTokens", "contextWindow"].includes(field) ? Number(e.target.value) : e.target.value;
        if (field === "contextWindow") updateContextGauge();
        // 亲手填的档位就是定论，不再探；清空了下次选模型再探
        if (field === "reasoningLevels") p.reasoningProbed = e.target.value.trim() ? `manual|${reasoningProbeKey(p)}` : "";
        // 收起时那一行跟着改
        if (field === "name") card.querySelector(".profile-name").textContent = p.name;
        if (field === "model") card.querySelector(".profile-gist").textContent = profileGist(p);
        saveStoreSoon();
      })
    );
    // 手动输入的模型 ID：改定了（失焦或回车）探一下它认哪几档
    card.querySelector('[data-field="model"]')?.addEventListener("change", () => void reportReasoningProbe(p, card));
    const amount = card.querySelector("[data-quota-amount]"),
      unit = card.querySelector("[data-quota-unit]");
    const applyQuota = () => {
      const value = amount.value.trim() ? `${amount.value.trim()}${unit.value}` : "",
        valid = !value || parseTokenLimit(value) !== null;
      if (valid) amount.removeAttribute("aria-invalid");
      else amount.setAttribute("aria-invalid", "true");
      card.querySelector(".profile-status").textContent = valid ? "" : "请填写大于 0 的数值，或留空不限";
      if (!valid) return;
      if (p.quota !== value) {
        p.quota = value;
        p.usedTokens = 0;
        saveStoreSoon();
        if (p.id === activeProfile()?.id) renderQuota();
      }
    };
    amount.addEventListener("input", applyQuota);
    unit.addEventListener("change", applyQuota);
    card.querySelector("[data-model-select]")?.addEventListener("change", e => {
      const input = card.querySelector('[data-field="model"]');
      if (e.target.value === "__custom__") {
        input.classList.remove("hidden");
        input.focus();
        return;
      }
      input.classList.add("hidden");
      input.value = e.target.value;
      p.model = e.target.value;
      card.querySelector(".profile-gist").textContent = profileGist(p);
      saveStoreSoon();
      renderHeader();
      void reportReasoningProbe(p, card);
    });
    card.querySelectorAll("[data-toggle-field]").forEach(
      button =>
        (button.onclick = () => {
          p[button.dataset.toggleField] = button.dataset.value === "true";
          saveStore();
          renderSettings();
        })
    );
    card.querySelectorAll("[data-choice-field]").forEach(
      button =>
        (button.onclick = () => {
          if (button.disabled) return;
          p[button.dataset.choiceField] = button.dataset.value;
          saveStore();
          renderSettings();
        })
    );
    // toggle 不冒泡：卡片自己的开合与里头「高级配置」的开合各听各的
    card.addEventListener("toggle", e => {
      if (e.target !== card) return;
      if (card.open) profileOpen.add(p.id);
      else profileOpen.delete(p.id);
    });
    card.querySelector(".profile-advanced")?.addEventListener("toggle", e => {
      if (e.target.open) advancedOpen.add(p.id);
      else advancedOpen.delete(p.id);
    });
    card
      .querySelectorAll("[data-profile-action]")
      .forEach(button => (button.onclick = () => handleProfileAction(p, button.dataset.profileAction, card)));
  });
  if (document.querySelector("[data-chatgpt-account]")) void refreshChatgptAccount();
}
