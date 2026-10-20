// 言 · 技能：照 Claude Code 的写法，一个目录里有 SKILL.md 即一份技能。不另设工具——技能是翻阅文档的又一路来源（见 41-document.js 的 availableDocuments）：
// 名字与何时用列在系统提示里（skills.hint），模型做到相关的事先翻 SKILL.md，同目录的附属文件以「技能名/路径」翻；执事里脚本照技能目录跑。
// 人也可点名：问话以「/技能名」开头，那份说明作附件随问附上（takeSkillCommand）。
// 只认存储根/技能一处（桥接那头扫，见 server/skills.js），放进来的都给模型、不设开合；别处的要用就拷进来——
// 有执事时系统提示里写着这个目录（skills.home），叫模型去找、拷过来即可。设置 → 技能里就地写、改、删
/** @typedef {{ name: string, description: string, dir: string, files: { path: string, size: number, modifiedAt: string }[], manual?: boolean, hidden?: boolean, hint?: string }} Skill */
const SKILL_FILE = "SKILL.md";
/** @type {{ home: string, skills: Skill[] }|null} */
let skillSet = null;
// 每答开工前取一回：增删了技能下一问就认，扫一处目录不过几毫秒；取不到沿用上回的
async function refreshSkills() {
  try {
    const data = await bridge("/api/skills/list", {}, AbortSignal.timeout(5000));
    skillSet = { home: data.home || "", skills: data.skills || [] };
  } catch {}
}
/** @returns {Skill[]} */
function skillList() {
  return skillSet?.skills || [];
}
// 当作文档的几件：只收文本（脚本、参考、模板）；SKILL.md 另可凭技能名找到
function skillDocuments() {
  return skillList().flatMap(skill =>
    skill.files
      .filter(file => isTextFile({ name: file.path, type: "" }))
      .map(file => ({
        name: `${skill.name}/${file.path}`,
        skill: skill.name,
        skillDir: skill.dir,
        path: file.path,
        main: file.path.toLowerCase() === SKILL_FILE.toLowerCase(),
        size: file.size,
        modifiedAt: file.modifiedAt,
        kind: "skill"
      }))
  );
}
// 系统提示里的目录（skills.hint）：一份一行，名字与它自己写的何时用。放在系统提示而不在 read_document 的说明里——
// 模型定下怎么做时读的是系统提示，藏在一件工具的说明末尾，只有它已想翻文档时才看得见。只凭点名的（manual）不列；一份都没有就不带这段
function skillCatalog() {
  const skills = skillList().filter(skill => !skill.manual);
  return skills.length ? { list: skills.map(skill => `- ${skill.name}：${skill.description}`).join("\n") } : null;
}
// 「/」点的是哪一份：名字可带空格，取问话开头对得上的最长一个（后头须是空白或到头）
/** @param {string} text @returns {Skill|undefined} */
function typedSkill(text) {
  const head = text.toLowerCase();
  return skillList()
    .filter(skill => head.startsWith(`/${skill.name.toLowerCase()}`) && !/\S/.test(head[skill.name.length + 1] || ""))
    .sort((a, b) => b.name.length - a.name.length)[0];
}
// 人点名用：问话以「/技能名」开头，发出前把那份说明作一件附件随这一问附上，模型不必再去翻。
// 名字对不上的照原话发（/usr/bin 之类的路径也是斜杠起头）。说明里写了 $ARGUMENTS 的（同 Claude Code），换成名字后头那段话
/** @param {ReturnType<typeof composerSnapshot>} snapshot @returns {Promise<boolean>} false：没取到说明或案上放不下，这一问先不发 */
async function takeSkillCommand(snapshot) {
  const content = snapshot.content.trim();
  if (!skillSet) await refreshSkills();
  const skill = typedSkill(content);
  if (!skill) return true;
  const rest = content.slice(skill.name.length + 1).trim();
  try {
    const text = (await skillDocumentText({ skillDir: skill.dir, path: SKILL_FILE, main: true })).replaceAll("$ARGUMENTS", rest),
      // 只点了名、后头没话时，消息里只剩一件附件：开头写明是点名用它，免得被当成递来一份文档要看
      file = new File([t`点名用技能「${skill.name}」，照它做。\n${text}`], `${skill.name}.md`, { type: "text/markdown" });
    if (!canPlaceAttachment(file.size, snapshot.attachments)) return false;
    snapshot.attachments.push(await ingestFile(file));
  } catch (error) {
    toast(t`技能「${skill.name}」的说明没取到：${tr(String(error.message || error)).slice(0, 80)}`);
    return false;
  }
  snapshot.content = rest;
  return true;
}
// 「/」联想：问话只写了「/」与名字的头几个字（还没敲空格）时，在输入框旁列出对得上的技能——名字开头对得上的在前，
// 名字或何时用里含着的其次；↑↓ 挑，Enter / Tab 填成「/名字 」接着写，Esc 或接着敲别的即收。不列 user-invocable: false 的
let skillPickAt = 0;
/** @param {HTMLTextAreaElement} input */
function paintSkillPicker(input) {
  const typed = /^\/([^\s/]*)$/.exec(input.value),
    open = document.querySelector(".chip-pop.skill-menu");
  if (!typed || input.selectionEnd !== input.value.length) return void (open && closeChipPop());
  const query = typed[1].toLowerCase(),
    rank = skill =>
      skill.name.toLowerCase().startsWith(query) ? 0 : `${skill.name} ${skill.description}`.toLowerCase().includes(query) ? 1 : 2;
  const shown = skillList()
    .filter(skill => !skill.hidden && rank(skill) < 2)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 8);
  if (!shown.length) return void (open && closeChipPop());
  skillPickAt = 0;
  // 已开着时逐字重画：不再从头起落一回
  const steady = open ? " steady" : "";
  // 贴着整个输入框的外沿，不盖住底下那排附件、模型与「寄」
  const pop = openMenu(
    input.closest(".composer") || input,
    shown.map(skill => ({
      id: skill.dir,
      label: skill.hint ? `/${skill.name} ${skill.hint}` : `/${skill.name}`,
      note: String(skill.description).match(/^.+?(?:[。！？]|[.!?](?=\s|$))/)?.[0] || skill.description,
      run: () => pickSkill(input, skill)
    })),
    { align: "left", className: `skill-menu${steady}` }
  );
  pop?.querySelector("button")?.classList.add("picked");
}
/** @param {HTMLTextAreaElement} input @param {Skill} skill */
function pickSkill(input, skill) {
  closeChipPop();
  input.value = `/${skill.name} `;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event("input"));
}
// 联想开着时接走 ↑↓、Enter、Tab：认了这一下回 true，输入框就不再当发送
/** @param {KeyboardEvent} e */
function skillPickerKey(e) {
  const pop = document.querySelector(".chip-pop.skill-menu");
  if (!pop || e.isComposing || !["ArrowUp", "ArrowDown", "Enter", "Tab"].includes(e.key) || e.shiftKey) return false;
  const buttons = [...pop.querySelectorAll("button")];
  e.preventDefault();
  if (e.key === "Enter" || e.key === "Tab") {
    /** @type {HTMLElement} */ (buttons[skillPickAt])?.click();
    return true;
  }
  buttons[skillPickAt]?.classList.remove("picked");
  skillPickAt = (skillPickAt + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[skillPickAt].classList.add("picked");
  buttons[skillPickAt].scrollIntoView({ block: "nearest" });
  return true;
}
// 翻一件：SKILL.md 开头注明技能目录——里头说的相对路径、要跑的脚本都照它
/** @param {{ skillDir: string, path: string, main?: boolean }} doc */
async function skillDocumentText(doc) {
  const data = await bridge("/api/skills/read", { dir: doc.skillDir, path: doc.path }, AbortSignal.timeout(15000));
  return doc.main ? t`技能目录：${doc.skillDir}\n\n${data.text}` : data.text;
}

// 设置 → 技能：一栏簿录（设计稿/78 乙，只一处、不分段）——段头写技能目录，右端「＋」新建、「打开」；
// 一份一行：名、说明的头一句（全文悬停可见）、带几件脚本与参考。看与改分开，同记忆页：点一行就地摊开看全文（再点收起），
// 底下「改」才换成输入框改名字、何时用、正文，焦点离开即存成那份 SKILL.md、回到看；新建的直接是改。行末悬停一枚「删」
/** @type {{ dir: string, name: string, description: string, body: string, from: string }|null} 正摊开改着的一份（新建的 dir 为空） */
let skillEditing = null;
/** @type {{ dir: string, body: string }|null} 摊开着看的一份，正文是 SKILL.md 去了头的那段 */
let skillViewing = null;
function skillsSettingsHtml() {
  const { home = "", skills = [] } = skillSet || {};
  const rows = skills
    .map(skill =>
      skillEditing?.dir === skill.dir
        ? skillEditorHtml(skillEditing)
        : skillViewing?.dir === skill.dir
          ? skillViewHtml(skill, skillViewing.body)
          : skillRowHtml(skill)
    )
    .join("");
  const adding = skillEditing && !skillEditing.dir;
  return (
    `<div class="settings-head">${brushIcon("skills", "settings-mark")}<h2>${t(`技能`)}</h2><span class="settings-meta">${t`${skills.length} 份`}</span></div>` +
    `<div class="skill-head"><span class="skill-dir" title="${escapeHtml(home)}">${escapeHtml(home)}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" id="addSkill" title="${t(`新建一份`)}">${brushIcon("add")}</button></span><button type="button" class="skill-open" data-skill-open>${t(`打开`)}</button></div>` +
    `<div class="skill-list">${adding ? skillEditorHtml(skillEditing) : ""}${
      rows || (adding ? "" : `<p class="skill-empty">${t(`尚无一份`)}</p>`)
    }</div>`
  );
}
/** @param {Skill} skill */
function skillRowHtml(skill) {
  const gist = String(skill.description).match(/^.+?(?:[。！？]|[.!?](?=\s|$))/)?.[0] || skill.description,
    count = re => skill.files.filter(file => re.test(file.path)).length,
    scripts = count(/\.(py|js|mjs|cjs|ts|sh|ps1|bat|cmd)$/i),
    refs = count(/\.md$/i) - 1,
    extra = [skill.manual && t("只凭点名"), scripts && t`脚本 ${scripts}`, refs > 0 && t`参考 ${refs}`].filter(Boolean).join(" · "),
    dir = escapeHtml(skill.dir);
  const row = `<button type="button" class="skill-row" data-skill-edit="${dir}" title="${escapeHtml(skill.description)}"><span class="skill-name">${escapeHtml(skill.name)}</span><span class="skill-gist">${escapeHtml(gist)}</span>${extra ? `<span class="skill-extra">${extra}</span>` : ""}</button>`;
  return `<div class="skill-item">${row}<span class="memory-ops"><button type="button" class="memory-del" data-skill-remove="${dir}" title="${t(`删去`)}">${brushIcon("strike")}</button></span></div>`;
}
// 摊开着看的一份：与改时同样三段（名字、何时用、正文），只是字不是框，点不出光标；点字收起，底下「改」「删去」
/** @param {Skill} skill @param {string} body */
function skillViewHtml(skill, body) {
  const dir = escapeHtml(skill.dir);
  return (
    `<div class="memory-item open skill-editor" data-skill-view="${dir}"><div class="skill-view" data-skill-collapse title="${t(`收起`)}">` +
    `<div class="skill-view-name">${escapeHtml(skill.name)}</div>` +
    `<div class="memory-body skill-edit-desc">${escapeHtml(skill.description)}</div>` +
    `<div class="memory-body">${escapeHtml(String(body).trim())}</div></div>` +
    `<div class="memory-meta"><span class="skill-dir" title="${dir}">${dir}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" data-skill-modify title="${t(`修改`)}">${brushIcon("edit")}</button><button type="button" class="memory-del" data-skill-remove="${dir}" title="${t(`删去`)}">${brushIcon("strike")}</button></span></div></div>`
  );
}
// 摊开改着的一份：名字一行，何时用（进系统提示的就是这一句）一段，正文一段；底下注目录，右边「完成」「删去」
/** @param {NonNullable<typeof skillEditing>} draft */
function skillEditorHtml(draft) {
  return (
    `<div class="memory-item open skill-editor" data-skill-editor>` +
    `<input class="memory-cat-name skill-edit-name" data-skill-field="name" value="${escapeHtml(draft.name)}" maxlength="64" spellcheck="false" placeholder="${t(`名字`)}" aria-label="${t(`名字`)}">` +
    `<textarea class="memory-text skill-edit-desc" data-skill-field="description" rows="1" spellcheck="false" placeholder="${t(`何时用：做什么、遇到什么样的事该翻它（模型只先看到这一句）`)}" aria-label="${t(`何时用`)}">${escapeHtml(draft.description)}</textarea>` +
    `<textarea class="memory-text skill-edit-body" data-skill-field="body" rows="3" spellcheck="false" placeholder="${t(`正文：怎么做`)}" aria-label="${t(`正文`)}">${escapeHtml(draft.body)}</textarea>` +
    `<div class="memory-meta"><span class="skill-dir" title="${escapeHtml(draft.dir)}">${escapeHtml(draft.dir || t("新的一份"))}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" data-skill-done title="${t(`完成`)}">${brushIcon("edit")}</button>${
      draft.dir ? `<button type="button" class="memory-del" data-skill-delete title="${t(`删去`)}">${brushIcon("strike")}</button>` : ""
    }</span></div></div>`
  );
}
// 存下摊开的那一份，回到看着它：没改就只回到看；新建的什么都没写就作罢
let skillSaving = false;
async function settleSkillEditor() {
  const draft = skillEditing;
  if (!draft || skillSaving) return;
  const name = draft.name.trim(),
    description = draft.description.trim(),
    body = draft.body.trim(),
    sent = JSON.stringify([name, description, body]);
  if (!draft.dir && !name && !body && !draft.description.trim()) {
    skillEditing = null;
    return renderSettings();
  }
  if (draft.dir && draft.from === sent) {
    skillEditing = null;
    skillViewing = { dir: draft.dir, body };
    return renderSettings();
  }
  if (!name) {
    toast(t("技能要有名字"));
    return /** @type {HTMLElement|null} */ ($("[data-skill-field=name]"))?.focus();
  }
  skillSaving = true;
  try {
    const saved = await bridge("/api/skills/save", { dir: draft.dir, name, description, body }, AbortSignal.timeout(15000));
    // 新建与改名后的目录由桥接定：等待期间继续改的仍属这一份，下一次写须用新目录。
    draft.dir = saved.dir || draft.dir;
    draft.from = sent;
    await refreshSkills();
  } catch (error) {
    toast(tr(String(error.message || error)));
    return;
  } finally {
    skillSaving = false;
  }
  if (skillEditing === draft) {
    // 保存与重翻目录期间编辑框还在：有新字就接着存，不能拿先前那份的回音收掉它。
    if (sent !== JSON.stringify([draft.name.trim(), draft.description.trim(), draft.body.trim()])) return settleSkillEditor();
    skillEditing = null;
    skillViewing = { dir: draft.dir, body };
  }
  renderSettings();
}
function bindSkillSettings() {
  $("[data-skill-open]")?.addEventListener("click", () => bridge("/api/skills/open", {}).catch(error => toast(tr(error.message))));
  const focusEditor = () => {
    const field = /** @type {HTMLInputElement|null} */ ($(skillEditing?.dir ? "[data-skill-field=body]" : "[data-skill-field=name]"));
    field?.focus();
    if (field) field.setSelectionRange(field.value.length, field.value.length);
  };
  $("#addSkill")?.addEventListener("click", async () => {
    await settleSkillEditor();
    if (skillEditing) return;
    skillViewing = null;
    skillEditing = { dir: "", name: "", description: "", body: "", from: "" };
    renderSettings();
    focusEditor();
  });
  // 看一份：正文现取（SKILL.md 去了头的那段），取到才摊开
  for (const button of document.querySelectorAll("[data-skill-edit]"))
    button.addEventListener("click", async () => {
      await settleSkillEditor();
      if (skillEditing) return;
      const skill = skillList().find(item => item.dir === /** @type {HTMLElement} */ (button).dataset.skillEdit);
      if (!skill) return;
      try {
        const { text } = await bridge("/api/skills/read", { dir: skill.dir, path: SKILL_FILE }, AbortSignal.timeout(15000));
        skillViewing = { dir: skill.dir, body: String(text) };
      } catch (error) {
        return toast(tr(String(error.message || error)));
      }
      renderSettings();
    });
  // 看着的那份：点字收起（划选字时不收），「改」换成输入框
  $("[data-skill-collapse]")?.addEventListener("click", () => {
    if (String(window.getSelection()).trim()) return;
    skillViewing = null;
    renderSettings();
  });
  $("[data-skill-modify]")?.addEventListener("click", () => {
    const skill = skillList().find(item => item.dir === skillViewing?.dir);
    if (!skill || !skillViewing) return;
    const body = skillViewing.body;
    skillEditing = {
      dir: skill.dir,
      name: skill.name,
      description: skill.description,
      body,
      from: JSON.stringify([skill.name, skill.description, body.trim()])
    };
    skillViewing = null;
    renderSettings();
    focusEditor();
  });
  const editor = $("[data-skill-editor]");
  if (editor) {
    const grow = area => {
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight}px`;
    };
    for (const field of editor.querySelectorAll("[data-skill-field]")) {
      if (field.tagName === "TEXTAREA") grow(field);
      field.addEventListener("input", () => {
        if (!skillEditing) return;
        skillEditing[/** @type {HTMLElement} */ (field).dataset.skillField] = /** @type {HTMLInputElement} */ (field).value;
        if (field.tagName === "TEXTAREA") grow(field);
      });
      field.addEventListener("keydown", e => {
        if (/** @type {KeyboardEvent} */ (e).key !== "Escape") return;
        e.stopPropagation();
        /** @type {HTMLElement} */ (field).blur();
      });
    }
    // 焦点离开这一份即存（挪到它自己的几枚小画上不算）
    editor.addEventListener("focusout", e => {
      if (!editor.contains(/** @type {Node|null} */ (/** @type {FocusEvent} */ (e).relatedTarget))) void settleSkillEditor();
    });
    $("[data-skill-done]")?.addEventListener("click", () => void settleSkillEditor());
    $("[data-skill-delete]")?.addEventListener("click", () => {
      if (skillEditing?.dir) void removeSkill(skillEditing.dir, skillEditing.name);
    });
  }
  // 删一份：先问，连同目录里的脚本与参考一并删
  const removeSkill = async (dir, name) => {
    const ok = await askConfirm({ title: t`删去技能「${name}」？`, body: t`连同目录里的脚本与参考一并删去：${dir}`, ok: t("删去") });
    if (!ok) return;
    try {
      await bridge("/api/skills/remove", { dir }, AbortSignal.timeout(15000));
    } catch (error) {
      return toast(tr(String(error.message || error)));
    }
    if (skillEditing?.dir === dir) skillEditing = null;
    if (skillViewing?.dir === dir) skillViewing = null;
    await refreshSkills();
    renderSettings();
  };
  for (const button of document.querySelectorAll("[data-skill-remove]"))
    button.addEventListener("click", () => {
      const skill = skillList().find(item => item.dir === /** @type {HTMLElement} */ (button).dataset.skillRemove);
      if (skill) void removeSkill(skill.dir, skill.name);
    });
  // 认到的随开随取：刚放进目录的，翻到这一页就看得见；与先前一样就不重画（摊开改着的时候不重画，免得吞了正写的字）
  const before = JSON.stringify(skillSet);
  void refreshSkills().then(() => {
    if (
      !skillEditing &&
      JSON.stringify(skillSet) !== before &&
      settingsTab === "skills" &&
      !$("#settingsModal").classList.contains("hidden")
    )
      renderSettings();
  });
}
