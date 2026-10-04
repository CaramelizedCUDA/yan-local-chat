// 言 · 设置 · 模型：模型卡片、ChatGPT 账号、思考档位探测、测试连接与模型列表
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function modelsSettingsHtml() {
  return `<h2>模型</h2><div id="profileList">${profiles().map(profileCardHtml).join("")}</div><button id="addProfile" class="outline-btn profile-add">＋ 接入模型</button>`;
}
function quotaParts(value) {
  const match = String(value ?? "")
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*([kme])?$/);
  return match ? { amount: match[1], unit: match[2] || "k" } : { amount: "", unit: "k" };
}
/** @param {Profile} p */
function profileCardHtml(p) {
  const invalidQuota = !!String(p.quota || "").trim() && parseTokenLimit(p.quota) === null,
    quota = quotaParts(p.quota),
    models = Array.isArray(p.modelList) ? p.modelList : [],
    listed = models.includes(p.model),
    chatgpt = profileApi(p) === "chatgpt";
  const modelField = `<div class="field-row">${models.length ? `<select class="field wide select" data-model-select>${models.map(m => `<option value="${escapeHtml(m)}"${m === p.model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}<option value="__custom__"${listed ? "" : " selected"}>手动输入…</option></select>` : ""}<input class="field wide${models.length && listed ? " hidden" : ""}" data-field="model" value="${escapeHtml(p.model)}" placeholder="如 gpt-4o-mini"><button class="outline-btn" data-profile-action="models" title="从接口的 /models 获取可用模型">${models.length ? "刷新" : "获取列表"}</button></div>`;
  const quotaField = `<div class="field-row"><input type="number" min="0" step="any" class="field wide" data-quota-amount value="${escapeHtml(quota.amount)}" placeholder="不限" ${invalidQuota ? `aria-invalid="true"` : ""}><select class="field select" data-quota-unit>${[
    ["k", "千 (k)"],
    ["m", "百万 (m)"],
    ["e", "亿 (e)"]
  ]
    .map(([v, label]) => `<option value="${v}"${quota.unit === v ? " selected" : ""}>${label}</option>`)
    .join("")}</select></div>`;
  // 平时收成一行：名字、模型 ID 与接口、是否默认；点开才是整张表。模型一多，一行一个翻得过来
  return `<details class="profile-card" data-profile-card="${escapeHtml(p.id)}"${profileOpen.has(p.id) ? " open" : ""}><summary class="profile-head"><strong class="profile-name">${escapeHtml(p.name)}</strong><span class="profile-gist">${escapeHtml(profileGist(p))}</span>${p.id === store.settings.activeProfileId ? `<span class="profile-badge">默认</span>` : ""}</summary><div class="profile-body"><div class="profile-grid"><label>显示名称<input class="field wide" data-field="name" value="${escapeHtml(p.name)}"></label><label>用量上限${quotaField}<small>留空不限</small></label><label>接口<div class="segmented"><button data-choice-field="api" data-value="openai" class="${anthropicLike(p) || chatgpt ? "" : "active"}">OpenAI 兼容</button><button data-choice-field="api" data-value="anthropic" class="${anthropicLike(p) ? "active" : ""}">Anthropic</button><button data-choice-field="api" data-value="chatgpt" class="${chatgpt ? "active" : ""}">ChatGPT 订阅</button></div><small>${chatgpt ? "额度记在 ChatGPT 订阅上" : anthropicLike(p) ? "Messages API" : "chat/completions"}</small></label>${chatgpt ? chatgptAccountHtml() : `<label class="profile-full">Base URL<input class="field wide" data-field="baseUrl" value="${escapeHtml(p.baseUrl || "")}" placeholder="${anthropicLike(p) ? "https://api.anthropic.com" : "https://example.com/v1"}"></label><label class="profile-full">API Key<input type="password" class="field wide" data-field="apiKey" value="${escapeHtml(p.apiKey || "")}" placeholder="sk-…" autocomplete="off"></label>`}<label class="profile-full">模型${modelField}</label></div><details class="profile-advanced"${advancedOpen.has(p.id) ? " open" : ""}><summary><span class="advanced-title">高级配置</span><small>${p.tools === false ? "本机工具关" : ""}</small></summary><div class="profile-grid"><label>本机联网与文档工具<div class="segmented"><button data-toggle-field="tools" data-value="true" class="${p.tools !== false ? "active" : ""}">开</button><button data-toggle-field="tools" data-value="false" class="${p.tools === false ? "active" : ""}">关</button></div><small>需接口支持 function calling</small></label>${chatgpt ? "" : `<label><code>temperature</code><input type="number" min="0" max="2" step="0.1" class="field wide" data-field="temperature" value="${Number.isFinite(p.temperature) ? p.temperature : ""}" placeholder="接口默认"><small>0–2，留空由接口定</small></label>`}${anthropicLike(p) ? `<label><code>max_tokens</code><input type="number" min="16" class="field wide" data-field="maxTokens" value="${Number(p.maxTokens) || ""}" placeholder="${DEFAULT_MAX_TOKENS}"><small>留空按 ${DEFAULT_MAX_TOKENS}</small></label>` : ""}<label>上下文窗口<input type="number" min="1000" step="1000" class="field wide" data-field="contextWindow" value="${Number(p.contextWindow) || ""}" placeholder="如 128000"><small>过七成半自动压缩前文</small></label><label>思考档位<input class="field wide" data-field="reasoningLevels" value="${escapeHtml(p.reasoningLevels || "")}" placeholder="low, medium, high"><small>逗号分隔；选定模型时自动探测</small></label></div></details><div class="profile-actions"><button class="outline-btn" data-profile-action="test">测试连接</button>${p.id !== store.settings.activeProfileId ? `<button class="outline-btn" data-profile-action="default">设为默认</button>` : ""}<button class="danger-btn" data-profile-action="delete">删除</button><span class="profile-status">${invalidQuota ? "请填写大于 0 的数值，或留空不限" : ""}</span></div></div></details>`;
}
// ChatGPT 订阅的账号：在浏览器里授权登录（OpenAI 的「Sign in with ChatGPT」），凭证只在桥接里，页面只问登没登、是谁。
// 不用 label 包：label 里的按钮会被点标签文字连带按下
/** @type {{ signedIn: boolean, email: string, pending: boolean, error: string } | null} 还没问过是 null */
let chatgptAccount = null;
function chatgptAccountHtml() {
  const a = chatgptAccount,
    text = !a ? "…" : a.signedIn ? `已登录${a.email ? ` · ${a.email}` : ""}` : a.pending ? "等浏览器里授权…" : "未登录";
  return `<div class="profile-full profile-cell">账号<div class="field-row"><span class="field wide" data-chatgpt-account>${escapeHtml(text)}</span><button class="outline-btn" data-profile-action="${a?.signedIn ? "logout" : "login"}">${a?.signedIn ? "退出登录" : "登录"}</button></div><small>在浏览器里用 ChatGPT 账号授权；用多少可在 ChatGPT 设置里查看、设上限</small></div>`;
}
// 问一回桥接，只改账号那一行，不重画整页（卡片里正填着的字不丢）
async function refreshChatgptAccount() {
  chatgptAccount = await bridge("/api/chatgpt/status", {}).catch(() => chatgptAccount);
  document.querySelectorAll("[data-chatgpt-account]").forEach(el => {
    const row = /** @type {HTMLElement} */ (el.closest(".profile-cell"));
    row.outerHTML = chatgptAccountHtml();
  });
  bindChatgptButtons();
  return chatgptAccount;
}
function bindChatgptButtons() {
  document.querySelectorAll("[data-profile-card] .profile-cell [data-profile-action]").forEach(button => {
    const card = /** @type {HTMLElement} */ (button.closest("[data-profile-card]")),
      p = profiles().find(item => item.id === card.dataset.profileCard);
    if (p)
      /** @type {HTMLElement} */ (button).onclick = () =>
        handleProfileAction(p, /** @type {HTMLElement} */ (button).dataset.profileAction, card);
  });
}
// 登录：桥接开回调口、用系统浏览器打开授权页；这边每隔一会儿问一回，登上了就顺手取模型列表
/** @param {Profile} profile */
async function chatgptLogin(profile, card) {
  const status = card.querySelector(".profile-status");
  try {
    const { url } = await bridge("/api/chatgpt/login", {});
    status.innerHTML = `已在浏览器中打开授权页 · <a href="${escapeHtml(url)}" target="_blank" rel="noopener">没打开就点这里</a>`;
    await refreshChatgptAccount();
    for (let i = 0; i < 400; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const a = await refreshChatgptAccount();
      if (a?.signedIn || !a?.pending) break;
    }
    const now = document.querySelector(`[data-profile-card="${profile.id}"]`);
    if (!now) return;
    if (chatgptAccount?.signedIn) await handleProfileAction(profile, "models", now);
    else now.querySelector(".profile-status").textContent = chatgptAccount?.error || "没有登录";
  } catch (error) {
    status.textContent = friendlyError(error.message);
  }
}
/** @param {Profile} p */
function profileGist(p) {
  return [p.model || "未填模型", { chatgpt: "ChatGPT 订阅", anthropic: "Anthropic", openai: "OpenAI 兼容" }[profileApi(p)]].join(" · ");
}

// 选定模型后探它认哪几档，结果写在卡片的状态行上，高级配置里的「思考档位」也跟着填；探不成不吭声（撞了错再学）。
// 亲手填过档位的不探（测试连接也不），状态行照实写它填的。同一张卡片连着探了两次（模型改了两回），只有最后一次能动状态行——
// 先前那次迟到回来是作废的，不能把后一次已经写上的结果抹掉
const probeSerial = new Map();
/** @param {Profile} profile */
async function reportReasoningProbe(profile, card, force = false) {
  if (!profile.model) return;
  // 重探不能靠清掉「探过」的标记：reasoningProbed 会把「有档位、没标记」当旧版手填的，重探一回反倒成了手填
  const redo = force && !reasoningManual(profile);
  const status = () => document.querySelector(`[data-profile-card="${profile.id}"] .profile-status`);
  // 状态行上此前的话留着（「可用 · 4 ms」），但上一回探到的档位不留——刷新列表探了一次、再从下拉里选一个又探一次，不能越接越长
  const before = (status()?.textContent || "")
    .split(" · ")
    .filter(part => !/^(探测)?思考档位/.test(part))
    .join(" · ");
  if (!redo && reasoningProbed(profile)) {
    if (force && status()) {
      const levels = profileReasoningLevels(profile);
      status().textContent = `${before ? `${before} · ` : ""}思考档位 ${levels.length ? levels.map(reasoningLabel).join(" / ") : "此模型不认"}${reasoningManual(profile) ? "（手填）" : ""}`;
    }
    return;
  }
  const serial = (probeSerial.get(profile.id) || 0) + 1;
  probeSerial.set(profile.id, serial);
  if (status()) status().textContent = `${before ? `${before} · ` : ""}探测思考档位…`;
  const levels = await probeReasoningLevels(profile, redo);
  const el = status();
  if (!el || probeSerial.get(profile.id) !== serial) return;
  if (levels === null) el.textContent = before;
  else {
    el.textContent = `${before ? `${before} · ` : ""}思考档位 ${levels.length ? levels.map(reasoningLabel).join(" / ") : "此模型不认"}`;
    const field = document.querySelector(`[data-profile-card="${profile.id}"] [data-field="reasoningLevels"]`);
    if (field) field.value = profile.reasoningLevels || "";
    renderModelTriggers();
  }
}
/** @param {Profile} profile */
async function handleProfileAction(profile, action, card) {
  if (action === "default") {
    store.settings.activeProfileId = profile.id;
    saveStore();
    renderSettings();
    renderHeader();
    return;
  }
  if (action === "delete") {
    if (
      !(await askConfirm({
        title: "删除这个模型？",
        body: `「${profile.name || profile.model || "未命名"}」的配置连同 API Key 将一并移除，无法撤销。`,
        ok: "删除"
      }))
    )
      return;
    store.profiles = store.profiles.filter(p => p.id !== profile.id);
    if (store.settings.activeProfileId === profile.id) store.settings.activeProfileId = profiles().find(p => p.id !== profile.id)?.id || "";
    saveStore();
    renderSettings();
    renderHeader();
    return;
  }
  if (action === "login") return chatgptLogin(profile, card);
  if (action === "logout") {
    await bridge("/api/chatgpt/logout", {}).catch(() => null);
    await refreshChatgptAccount();
    return;
  }
  if (action === "models") {
    const status = card.querySelector(".profile-status");
    status.textContent = "获取中…";
    try {
      const models = await fetchModelList(profile);
      if (!models.length) throw Error("接口未返回模型列表，请手动输入模型 ID");
      profile.modelList = models;
      if (!models.includes(profile.model)) profile.model = models[0];
      saveStore();
      renderSettings();
      renderHeader();
      card = document.querySelector(`[data-profile-card="${profile.id}"]`);
      if (card) card.querySelector(".profile-status").textContent = `已获取 ${models.length} 个模型`;
      void reportReasoningProbe(profile, card);
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
    return;
  }
  if (action === "test") {
    let status = card.querySelector(".profile-status");
    status.textContent = "连接中…";
    try {
      card = document.querySelector(`[data-profile-card="${profile.id}"]`) || card;
      status = card.querySelector(".profile-status");
      status.textContent = "连接中…";
      const started = performance.now();
      await bridge("/api/test", { profile: profileForRequest(profile) });
      status.textContent = `可用 · ${Math.round(performance.now() - started)} ms`;
      // 测试连接是亲手要的一次核对：档位也重探一遍
      void reportReasoningProbe(profile, card, true);
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
  }
}
/** @param {Profile} profile */
async function fetchModelList(profile) {
  if (!String(profile.baseUrl || "").trim() && profileApi(profile) !== "chatgpt") throw Error("请先填写 Base URL");
  const data = await bridge("/api/models", { profile: profileForRequest(profile) });
  return [...new Set(data.models || [])].sort();
}
