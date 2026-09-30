// 言 · 录（记忆）：条目的增删与设置页；模型用的五件工具在 15-tools/40-memory.js
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 一条条由模型在对谈中记下的话，跨对话可翻。每条归在一个分类下（言的开发、偏好……），分类不另存，就是各条上的名字：
// 同名即同类，没有条目的分类自然消失。内容不进系统提示（只报有哪几类），模型要看得自己 recall：先看分类一览，再打开某一类。
// 单条不截断——早先限 200 字、超出悄悄截掉，记下来的话常常没说完；现在过长就退回让模型拆开或精简
const MAX_MEMORY_ITEMS = 200,
  MEMORY_TEXT_CHARS = 2000,
  MEMORY_UNSORTED = "未分类";
/** 设置页「记忆」里打开着的那一类；null 即分类一览 */
let memoryCategoryOpen = null;
function memoryEnabled() {
  return store.memory.enabled !== false;
}
function memoryId() {
  let id;
  do {
    id = "m" + Math.random().toString(36).slice(2, 7);
  } while (store.memory.items.some(item => item.id === id));
  return id;
}
function memoryCategoryOf(item) {
  return item.category || MEMORY_UNSORTED;
}
function cleanMemoryCategory(value) {
  return (
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24) || MEMORY_UNSORTED
  );
}
// 行内空白收拢，换行留着（长一点的条目可以分几行写）
function cleanMemoryText(value) {
  return String(value || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** 各类一览：名字、条目（新的在前）、最近一条的日子；最近动过的类排前 */
function memoryCategories() {
  const map = new Map();
  for (const item of store.memory.items) {
    const name = memoryCategoryOf(item),
      at = String(item.updatedAt || item.createdAt),
      entry = map.get(name) || { name, items: [], updatedAt: "" };
    entry.items.push(item);
    if (at > entry.updatedAt) entry.updatedAt = at;
    map.set(name, entry);
  }
  for (const entry of map.values()) entry.items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function memoryLine(item, withCategory = false) {
  return `[${item.id}] ${String(item.updatedAt || item.createdAt).slice(0, 10)}｜${withCategory ? `${memoryCategoryOf(item)}｜` : ""}${item.text}`;
}
function keywordTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}
function hitsAll(text, terms) {
  const lower = String(text || "").toLowerCase();
  return terms.every(term => lower.includes(term));
}
function addMemory(text, source = null, category = "") {
  const clean = cleanMemoryText(text);
  if (!clean) return null;
  const item = { id: memoryId(), text: clean, category: cleanMemoryCategory(category), createdAt: now(), updatedAt: now(), source };
  store.memory.items.push(item);
  saveStore();
  return item;
}
// 设置页开着「记忆」时，模型记入或删去要立刻反映在列表里
function refreshMemorySettings() {
  if (settingsTab === "memory" && !$("#settingsModal").classList.contains("hidden")) renderSettings();
}
function memoryGist(text) {
  const line = String(text || "").replace(/\s+/g, " ");
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
// 分类一览：一类一行（名 · 最近一条的开头 · 几条 · 日子），点开看这一类的全部条目
function memoryIndexHtml(categories) {
  return categories.length
    ? `<div class="memory-cats">${categories
        .map(
          cat =>
            `<button type="button" class="memory-cat" data-memory-cat="${escapeHtml(cat.name)}"><strong>${escapeHtml(cat.name)}</strong><span class="memory-cat-gist">${escapeHtml(memoryGist(cat.items[0].text))}</span><span class="memory-cat-count">${cat.items.length} 条</span><span class="memory-cat-date">${escapeHtml(formatDay(cat.updatedAt))}</span></button>`
        )
        .join("")}</div>`
    : `<p class="memory-empty">尚无一条。</p>`;
}
// 一类里的条目：正文可改，太长的先收起几行，点进去即全文；条下注日子、来源、所属分类（点开可改归别类）
function memoryCategoryHtml(cat) {
  const row = item => {
    const source =
      item.source?.conversationId && store.conversations.some(c => c.id === item.source.conversationId)
        ? `<button type="button" data-memory-open="${escapeHtml(item.source.conversationId)}" title="打开来源对话">${escapeHtml(item.source.title || "来源对话")}</button>`
        : item.source?.title
          ? `<span>${escapeHtml(item.source.title)}</span>`
          : `<span>手记</span>`;
    return `<div class="memory-item" data-memory="${escapeHtml(item.id)}"><textarea class="memory-text" rows="1" spellcheck="false" aria-label="记忆内容">${escapeHtml(item.text)}</textarea><div class="memory-meta"><span>${escapeHtml(formatDay(item.updatedAt || item.createdAt))}</span>${source}<span class="memory-spacer"></span><button type="button" class="memory-move" title="改归别类" aria-haspopup="menu">${escapeHtml(memoryCategoryOf(item))}</button><button type="button" data-memory-delete title="删去这条">删去</button></div></div>`;
  };
  return (
    `<div class="memory-crumbs"><button type="button" class="memory-back" data-memory-cat="">‹ 记忆</button><input id="memoryCatName" class="memory-cat-name" value="${escapeHtml(cat.name)}" maxlength="24" spellcheck="false" aria-label="分类名"><span class="memory-cat-count">${cat.items.length} 条</span></div>` +
    `<div class="memory-list">${cat.items.map(row).join("")}</div>`
  );
}
function memorySettingsHtml() {
  const categories = memoryCategories(),
    enabled = memoryEnabled(),
    open = memoryCategoryOpen !== null ? categories.find(cat => cat.name === memoryCategoryOpen) : null;
  if (!open) memoryCategoryOpen = null;
  return (
    `<div class="about-head memory-head">${brushIcon("memory", "settings-mark")}<h2>记忆</h2><span class="about-version">${store.memory.items.length} / ${MAX_MEMORY_ITEMS} 条${categories.length ? ` · ${categories.length} 类` : ""}</span></div>` +
    segmentRow(
      "启用记忆",
      "关闭后条目仍保留",
      "memoryEnabled",
      [
        ["true", "开"],
        ["false", "关"]
      ],
      String(enabled)
    ) +
    (open ? memoryCategoryHtml(open) : memoryIndexHtml(categories)) +
    `<div class="memory-foot"><button id="addMemory" class="outline-btn" type="button">手记一条</button>${
      open
        ? `<button id="dropMemoryCat" class="outline-btn" type="button">删去此类</button>`
        : store.memory.items.length
          ? `<button id="clearMemory" class="outline-btn" type="button">清空记忆</button>`
          : ""
    }</div>`
  );
}
function fileMemory(item, category) {
  const to = cleanMemoryCategory(category);
  if (to === memoryCategoryOf(item)) return renderSettings();
  item.category = to;
  item.updatedAt = now();
  saveStore();
  toast(`已归入「${to}」`);
  renderSettings();
}
function openMemoryCategory(name) {
  memoryCategoryOpen = name;
  renderSettings();
  $("#settingsContent").scrollTop = 0;
}
function bindMemoryEvents() {
  const host = $("#settingsContent");
  if (settingsTab !== "memory" || !host) return;
  // 文本框随字长高；长过几行的平时收起（见 .memory-text.long），点进去即全文
  const grow = area => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
    area.classList.toggle("long", area.scrollHeight > 110);
  };
  host
    .querySelectorAll("[data-memory-cat]")
    .forEach(button => button.addEventListener("click", () => openMemoryCategory(button.dataset.memoryCat || null)));
  // 改分类名：改成已有的名字即并入那一类
  $("#memoryCatName")?.addEventListener("change", e => {
    const from = memoryCategoryOpen,
      to = cleanMemoryCategory(e.target.value);
    if (from === null || to === from) return;
    for (const item of store.memory.items) if (memoryCategoryOf(item) === from) item.category = to;
    saveStore();
    openMemoryCategory(to);
  });
  $("#memoryCatName")?.addEventListener("keydown", e => e.key === "Enter" && e.target.blur());
  host.querySelectorAll(".memory-item").forEach(row => {
    const item = store.memory.items.find(entry => entry.id === row.dataset.memory);
    if (!item) return;
    const area = row.querySelector("textarea");
    grow(area);
    area.addEventListener("input", () => {
      grow(area);
      const text = cleanMemoryText(area.value).slice(0, MEMORY_TEXT_CHARS);
      if (text) {
        item.text = text;
        item.updatedAt = now();
        saveStoreSoon();
      }
    });
    // 收起的长条目：点进去即摊开全文
    area.addEventListener("focus", () => grow(area));
    area.addEventListener("blur", () => {
      if (!area.value.trim()) {
        store.memory.items = store.memory.items.filter(entry => entry !== item);
        saveStore();
        renderSettings();
      }
    });
    // 改归别类：弹出各类（与侧栏「移入分组」同一副菜单），另可起一类；归走了这条就从眼前这一类里移走。
    // 落选：原生 <datalist> 的候选框——样子由浏览器画，一点开是一块黑底，与纸面不搭
    const move = row.querySelector(".memory-move");
    move.addEventListener("click", event => {
      // 这一下点击若冒泡到页面，「点别处即收」会把刚弹出的菜单收掉
      event.stopPropagation();
      const others = memoryCategories()
        .map(cat => cat.name)
        .filter(name => name !== memoryCategoryOf(item));
      const pop = openFloatingPop(
        move,
        `${others.map(name => `<button type="button" data-move-to="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}<button type="button" data-move-to="">另起一类…</button>`,
        { align: "right" }
      );
      pop.addEventListener("click", event => {
        const choice = event.target.closest("[data-move-to]");
        if (!choice) return;
        closeChipPop();
        if (choice.dataset.moveTo) return fileMemory(item, choice.dataset.moveTo);
        // 另起一类：就地换成一个输入框，回车落定，Esc 作罢
        const field = document.createElement("input");
        field.className = "memory-move";
        field.placeholder = "新类名";
        field.maxLength = 24;
        move.replaceWith(field);
        field.focus();
        let settled = false;
        const settle = keep => {
          if (settled) return;
          settled = true;
          if (keep && field.value.trim()) fileMemory(item, field.value);
          else renderSettings();
        };
        field.addEventListener("keydown", e => {
          if (e.key === "Enter") settle(true);
          else if (e.key === "Escape") {
            e.stopPropagation();
            settle(false);
          }
        });
        field.addEventListener("blur", () => settle(true));
      });
    });
    row.querySelector("[data-memory-delete]").addEventListener("click", () => {
      store.memory.items = store.memory.items.filter(entry => entry !== item);
      saveStore();
      renderSettings();
    });
    row.querySelector("[data-memory-open]")?.addEventListener("click", e => {
      closeSettings();
      openConversation(e.currentTarget.dataset.memoryOpen);
    });
  });
  // 手记一条：在打开着的那一类里记；在一览上记的归「未分类」，记完打开那一类
  $("#addMemory")?.addEventListener("click", () => {
    if (store.memory.items.length >= MAX_MEMORY_ITEMS) return toast(`记忆已有 ${MAX_MEMORY_ITEMS} 条，请先删去一些`);
    const category = memoryCategoryOpen ?? MEMORY_UNSORTED,
      item = { id: memoryId(), text: "", category, createdAt: now(), updatedAt: now(), source: null };
    store.memory.items.push(item);
    openMemoryCategory(category);
    setTimeout(() => host.querySelector(`[data-memory="${item.id}"] textarea`)?.focus(), 0);
  });
  $("#dropMemoryCat")?.addEventListener("click", async () => {
    const name = memoryCategoryOpen,
      count = store.memory.items.filter(item => memoryCategoryOf(item) === name).length;
    if (
      !(await askConfirm({ title: `删去「${name}」这一类？`, body: `其中 ${count} 条记忆将被移除，无法撤销；对话不受影响。`, ok: "删去" }))
    )
      return;
    store.memory.items = store.memory.items.filter(item => memoryCategoryOf(item) !== name);
    saveStore();
    openMemoryCategory(null);
  });
  $("#clearMemory")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: "清空记忆？",
        body: `${store.memory.items.length} 条记忆将被移除，无法撤销；对话不受影响。`,
        ok: "清空"
      }))
    )
      return;
    store.memory.items = [];
    saveStore();
    renderSettings();
    toast("记忆已清空");
  });
}
