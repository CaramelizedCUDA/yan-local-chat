// 言 · 设置 · 专司：主答之外各司一事的几位——拟题随对话的模型、只有开关；审查与生图各自另配一份，
// 不借模型栏里的那几份：同一份发，会挤掉主答的提示缓存，本机的模型还得多扛一路并发。
// 一职一张卡，样子同模型栏：收起一行只写职名与模型名（拟题、没配的不写），最右一粒记号——朱点是开或已配，空圈是关或未配；
// 点开先是开关，开了才铺开接口、地址、Key、模型（设计稿/110–112）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
/** @type {Record<"review"|"image", { key: "dutyReview"|"dutyImage", name: () => string, apis: Duty["api"][], off: () => string }>} */
const DUTIES = {
  review: { key: "dutyReview", name: () => t("审查"), apis: ["siliconflow", "openai", "anthropic"], off: () => t("关，照规则") },
  image: { key: "dutyImage", name: () => t("生图"), apis: ["siliconflow", "openai"], off: () => t("未配") }
};
const DUTY_API_LABEL = { siliconflow: () => t("硅基流动"), openai: () => t("OpenAI 兼容"), anthropic: () => "Anthropic" };
// 哪几张卡开着：整栏重画后照样开着
const dutyOpen = new Set();
/** 开着且填够了（模型与地址；本机的服务可不要 Key）才算配好 @param {Duty} d */
function dutyReady(d) {
  return !!(d?.on && d.model.trim() && d.baseUrl.trim());
}
/** @param {"review"|"image"} id */
function dutyOf(id) {
  return store.settings[DUTIES[id].key];
}
function dutyMarkHtml(on, tip) {
  return `<span class="duty-mark${on ? " on" : ""}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"></span>`;
}
/** 收起时那一行：职名、配好了的模型名、记号 @param {"review"|"image"} id */
function dutyHeadHtml(id) {
  const d = dutyOf(id),
    ready = dutyReady(d);
  return `<strong class="profile-name">${DUTIES[id].name()}</strong><span class="profile-gist">${ready ? escapeHtml(d.model) : ""}</span>${dutyMarkHtml(ready, ready ? t("已配") : d.on ? t("未填完") : DUTIES[id].off())}`;
}
function dutyCardHtml(id, head, body) {
  return `<details class="profile-card" data-duty="${id}"${dutyOpen.has(id) ? " open" : ""}><summary class="profile-head">${head}</summary><div class="profile-body">${body}</div></details>`;
}
/** @param {"review"|"image"} id */
function dutyFormHtml(id) {
  const d = dutyOf(id),
    onOff = `<div class="segmented"><button data-duty-on="${id}" data-value="true" class="${d.on ? "active" : ""}">${t(`开`)}</button><button data-duty-on="${id}" data-value="false" class="${d.on ? "" : "active"}">${t(`关`)}</button></div>`;
  if (!d.on) return `<div class="profile-grid"><label class="profile-full">${t(`启用`)}${onOff}</label></div>`;
  const listed = d.modelList.includes(d.model),
    apis = DUTIES[id].apis
      .map(api => `<button data-duty-api="${api}" class="${d.api === api ? "active" : ""}">${DUTY_API_LABEL[api]()}</button>`)
      .join(""),
    model = `<div class="field-row">${d.modelList.length ? `<select class="field wide select" data-duty-select>${d.modelList.map(m => `<option value="${escapeHtml(m)}"${m === d.model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}<option value="__custom__"${listed ? "" : " selected"}>${t(`手动输入…`)}</option></select>` : ""}<input class="field wide${d.modelList.length && listed ? " hidden" : ""}" data-duty-field="model" value="${escapeHtml(d.model)}" placeholder="${id === "image" ? "Kwai-Kolors/Kolors" : t("如 gpt-4o-mini")}"><button class="outline-btn" data-duty-action="models" title="${t(`从接口的 /models 获取可用模型`)}">${d.modelList.length ? t("刷新") : t("获取列表")}</button></div>`;
  return `<div class="profile-grid"><label class="profile-full">${t(`启用`)}${onOff}</label><label class="profile-full">${t(`接口`)}<div class="segmented">${apis}</div><small>${id === "image" ? "images/generations" : d.api === "anthropic" ? "Messages API" : "chat/completions"}</small></label><label class="profile-full">Base URL<input class="field wide" data-duty-field="baseUrl" value="${escapeHtml(d.baseUrl)}" placeholder="${d.api === "anthropic" ? "https://api.anthropic.com" : d.api === "siliconflow" ? SILICONFLOW_BASE : "https://example.com/v1"}"></label><label class="profile-full">API Key<input type="password" class="field wide" data-duty-field="apiKey" value="${escapeHtml(d.apiKey)}" placeholder="sk-…" autocomplete="off"></label><label class="profile-full">${t(`模型`)}${model}</label></div><div class="profile-actions">${id === "review" ? `<button class="outline-btn" data-duty-action="test">${t(`测试连接`)}</button>` : ""}<span class="profile-status"></span></div>`;
}
function dutySettingsHtml() {
  const title = store.settings.autoTitle,
    titleCard = dutyCardHtml(
      "title",
      `<strong class="profile-name">${t(`拟题`)}</strong><span class="profile-gist"></span>${dutyMarkHtml(title, title ? t("开") : t("关"))}`,
      `<div class="profile-grid"><label class="profile-full">${t(`自动拟题`)}<div class="segmented"><button data-setting="autoTitle" data-value="true" class="${title ? "active" : ""}">${t(`开`)}</button><button data-setting="autoTitle" data-value="false" class="${title ? "" : "active"}">${t(`关`)}</button></div></label></div>`
    );
  return `<h2>${t(`专司`)}</h2>${titleCard}${dutyCardHtml("review", dutyHeadHtml("review"), dutyFormHtml("review"))}${dutyCardHtml("image", dutyHeadHtml("image"), dutyFormHtml("image"))}`;
}
function bindDutySettings() {
  document.querySelectorAll("[data-duty]").forEach(card => {
    card.addEventListener("toggle", e => {
      if (e.target !== card) return;
      if (card.open) dutyOpen.add(card.dataset.duty);
      else dutyOpen.delete(card.dataset.duty);
    });
    if (card.dataset.duty === "title") return;
    const id = /** @type {"review"|"image"} */ (card.dataset.duty),
      d = dutyOf(id),
      status = () => card.querySelector(".profile-status");
    // 收起时那一行跟着改：模型名、记号
    const refreshHead = () => (card.querySelector(".profile-head").innerHTML = dutyHeadHtml(id));
    card.querySelectorAll("[data-duty-on]").forEach(
      button =>
        (button.onclick = () => {
          d.on = button.dataset.value === "true";
          // 头一回开：硅基流动的地址替它填上
          if (d.on && d.api === "siliconflow" && !d.baseUrl) d.baseUrl = SILICONFLOW_BASE;
          saveStore();
          renderSettings();
        })
    );
    card.querySelectorAll("[data-duty-api]").forEach(
      button =>
        (button.onclick = () => {
          const api = /** @type {Duty["api"]} */ (button.dataset.dutyApi),
            toSiliconflow = api === "siliconflow";
          // 与模型栏同一个规矩：选硅基流动即填好地址，从它换走时清掉
          if (toSiliconflow !== (d.api === "siliconflow")) d.baseUrl = toSiliconflow ? SILICONFLOW_BASE : "";
          d.api = api;
          saveStore();
          renderSettings();
        })
    );
    card.querySelectorAll("[data-duty-field]").forEach(input =>
      input.addEventListener("input", e => {
        d[e.target.dataset.dutyField] = e.target.value;
        refreshHead();
        saveStoreSoon();
      })
    );
    card.querySelector("[data-duty-select]")?.addEventListener("change", e => {
      const input = card.querySelector('[data-duty-field="model"]');
      if (e.target.value === "__custom__") {
        input.classList.remove("hidden");
        input.focus();
        return;
      }
      input.classList.add("hidden");
      input.value = d.model = e.target.value;
      refreshHead();
      saveStoreSoon();
    });
    card.querySelectorAll("[data-duty-action]").forEach(
      button =>
        (button.onclick = async () => {
          if (button.dataset.dutyAction === "models") {
            status().textContent = t("取列表中…");
            try {
              const models = await fetchModelList(d);
              if (!models.length) throw Error(t("接口未返回模型列表，请手动输入模型 ID"));
              d.modelList = models;
              if (!models.includes(d.model)) d.model = models[0];
              saveStore();
              renderSettings();
              const fresh = document.querySelector(`[data-duty="${id}"] .profile-status`);
              if (fresh) fresh.textContent = t`已取回 ${models.length} 个模型`;
            } catch (error) {
              status().textContent = friendlyError(error.message);
            }
            return;
          }
          status().textContent = t("接通中…");
          try {
            const started = performance.now();
            await bridge("/api/test", { profile: profileForRequest(d) });
            status().textContent = t`可用 · ${Math.round(performance.now() - started)} ms`;
          } catch (error) {
            status().textContent = friendlyError(error.message);
          }
        })
    );
  });
}
