// 言 · 技能：照 Claude Code 的写法，一个目录里有 SKILL.md 即一份技能。不另设工具——技能是翻阅文档的又一路来源（见 41-document.js 的 availableDocuments）：
// 名字与何时用列在系统提示里（skills.hint），模型做到相关的事先翻 SKILL.md，同目录的附属文件以「技能名/路径」翻；执事里脚本照技能目录跑。
// 人也可点名：问话以「/技能名」开头，那份说明作附件随问附上（takeSkillCommand）。
// 认三处（桥接那头扫，见 server/skills.js）：工作目录/.claude/skills、存储根/技能、~/.claude/skills；设置 → 技能里逐份开关，存储根那一处还能就地写、改、删。
// ~/.claude/skills 里的默认不给：那里多是给别家写的（Claude 桌面端的工具言没有），说明又长，每一问都背着；要用的勾上。另两处是特意放进来的，默认给
/** @typedef {{ name: string, description: string, source: string, dir: string, files: { path: string, size: number, modifiedAt: string }[] }} Skill */
const SKILL_FILE = "SKILL.md";
// 三处的名字，设置页左列照这个次序
const SKILL_SOURCES = { 项目: t("工作目录"), 言: t("存储根"), Claude: "Claude" };
/** @type {Map<string, { roots: { source: string, dir: string }[], skills: Skill[] }>} 按工作目录存一份（言里记作空串） */
const skillSets = new Map();
// 每答开工前取一回：增删了技能下一问就认，扫几处目录不过几毫秒；取不到沿用上回的
/** @param {{ workdir?: string }|null} conversation */
async function refreshSkills(conversation) {
  const workdir = conversation?.workdir || "";
  try {
    const data = await bridge("/api/skills/list", { workdir }, AbortSignal.timeout(5000));
    skillSets.set(workdir, { roots: data.roots || [], skills: data.skills || [] });
  } catch {}
}
/** @param {Skill} skill 设置里亲手开关过的照它，否则看从哪一处认来的 */
function skillEnabled(skill) {
  return store.settings.skills?.[skill.name] ?? skill.source !== "Claude";
}
/** @param {Conversation|null} conversation @returns {Skill[]} 这段对话认得的、开着的 */
function skillsOf(conversation) {
  return (skillSets.get(conversation?.workdir || "")?.skills || []).filter(skillEnabled);
}
// 当作文档的几件：只收文本（脚本、参考、模板）；SKILL.md 另可凭技能名找到
/** @param {Conversation|null} conversation */
function skillDocuments(conversation) {
  return skillsOf(conversation).flatMap(skill =>
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
// 模型定下怎么做时读的是系统提示，藏在一件工具的说明末尾，只有它已想翻文档时才看得见。一份都没有就不带这段
/** @param {Conversation} conversation */
function skillCatalog(conversation) {
  const skills = skillsOf(conversation).filter(skill => skill.files.some(file => file.path.toLowerCase() === SKILL_FILE.toLowerCase()));
  return skills.length ? { list: skills.map(skill => `- ${skill.name}：${skill.description}`).join("\n") } : null;
}
// 人点名用：问话以「/技能名」开头，发出前把那份说明作一件附件随这一问附上，模型不必再去翻；关着的也认（是人亲手点的）。
// 名字对不上的照原话发（/usr/bin 之类的路径也是斜杠起头）
/** @param {HTMLTextAreaElement} input @param {string} workdir @returns {Promise<boolean>} false：没取到说明，这一问先不发 */
async function takeSkillCommand(input, workdir) {
  const typed = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(input.value.trim());
  if (!typed) return true;
  if (!skillSets.has(workdir)) await refreshSkills({ workdir });
  const skill = (skillSets.get(workdir)?.skills || []).find(item => item.name.toLowerCase() === typed[1].toLowerCase());
  if (!skill) return true;
  try {
    const text = await skillDocumentText({ skillDir: skill.dir, path: SKILL_FILE, main: true }, { workdir });
    pendingAttachments.push(await ingestFile(new File([text], `${skill.name}.md`, { type: "text/markdown" })));
  } catch (error) {
    toast(t`技能「${skill.name}」的说明没取到：${tr(String(error.message || error)).slice(0, 80)}`);
    return false;
  }
  input.value = typed[2] || "";
  renderAttachments();
  return true;
}
// 翻一件：SKILL.md 开头注明技能目录——里头说的相对路径、要跑的脚本都照它
/** @param {{ skillDir: string, path: string, main?: boolean }} doc @param {{ workdir?: string }|null} conversation */
async function skillDocumentText(doc, conversation) {
  const data = await bridge(
    "/api/skills/read",
    { workdir: conversation?.workdir || "", dir: doc.skillDir, path: doc.path },
    AbortSignal.timeout(15000)
  );
  return doc.main ? t`技能目录：${doc.skillDir}\n\n${data.text}` : data.text;
}

// 设置 → 技能：分栏同记忆页（设计稿/78 丙）——左列三处来处，标「开 / 共」；右列选着那一处，一份一行：开着的一笔勾、名加粗，
// 关着的一粒淡墨点、整行退淡（记号与计划卡同一支笔），名后是说明的头一句，全文悬停可见；点一行即开合。
// 工作目录那一处看眼前这段对话绑的目录，没绑就不列。落选：卡片（同 MCP，十几张一长串、三处混在一起）、按来处分段的单栏簿录。
// 存储根那一处是言自己的：题头「新建一份」，各行右端一枚「改」，就地摊开写名字、何时用、正文（同记忆页摊开的一条），
// 焦点离开即存成那份 SKILL.md。另两处是别家的目录，只看只开合
let skillSourceOpen = "言";
/** @type {{ dir: string, name: string, description: string, body: string, from: string }|null} 正摊开改着的一份（新建的 dir 为空） */
let skillEditing = null;
function skillsSettingsHtml() {
  const workdir = currentConversation()?.workdir || "",
    { roots = [], skills = [] } = skillSets.get(workdir) || {},
    sources = Object.keys(SKILL_SOURCES).filter(source => source !== "项目" || workdir),
    open = sources.includes(skillSourceOpen) ? skillSourceOpen : "言",
    dir = roots.find(root => root.source === open)?.dir || "",
    list = skills.filter(skill => skill.source === open),
    own = open === "言",
    tally = items => `${items.filter(skillEnabled).length}/${items.length}`;
  skillSourceOpen = open;
  if (!own) skillEditing = null;
  const rows = list.map(skill => (skillEditing?.dir === skill.dir ? skillEditorHtml(skillEditing) : skillRowHtml(skill, own))).join("");
  return (
    `<div class="settings-head">${brushIcon("skills", "settings-mark")}<h2>${t(`技能`)}</h2><span class="settings-meta">${t`${skills.length} 份 · 开 ${skills.filter(skillEnabled).length} 份`}</span></div>` +
    `<div class="memory-split"><div class="memory-cats">${sources
      .map(
        source =>
          `<button type="button" class="memory-cat${source === open ? " active" : ""}" data-skill-source="${source}"><span>${SKILL_SOURCES[source]}</span><em>${tally(skills.filter(skill => skill.source === source))}</em></button>`
      )
      .join("")}</div>` +
    `<div class="memory-pane"><div class="memory-pane-head"><span class="skill-pane-name">${SKILL_SOURCES[open]}</span><span class="memory-cat-count skill-dir" title="${escapeHtml(dir)}">${escapeHtml(dir)}</span><span class="memory-spacer"></span>${
      own ? `<span class="memory-ops"><button type="button" id="addSkill" title="${t(`新建一份`)}">${brushIcon("add")}</button></span>` : ""
    }<button type="button" class="skill-open" data-skill-open>${t(`打开`)}</button></div>` +
    `<div class="skill-list">${skillEditing && !skillEditing.dir ? skillEditorHtml(skillEditing) : ""}${
      rows ||
      (skillEditing && !skillEditing.dir
        ? ""
        : `<p class="skill-empty">${own ? t(`尚无一份。点右上的「＋」写一份，或把现成的技能文件夹放进来`) : t(`尚无一份。一个技能一个文件夹，内有 SKILL.md`)}</p>`)
    }</div></div></div>`
  );
}
/** @param {Skill} skill @param {boolean} own 言自己那一处的，右端「改」「删」；别处的右端一枚「拷到存储根」 */
function skillRowHtml(skill, own = false) {
  const on = skillEnabled(skill),
    gist = String(skill.description).match(/^.+?(?:[。！？]|[.!?](?=\s|$))/)?.[0] || skill.description,
    count = re => skill.files.filter(file => re.test(file.path)).length,
    scripts = count(/\.(py|js|mjs|cjs|ts|sh|ps1|bat|cmd)$/i),
    refs = count(/\.md$/i) - 1,
    extra = [scripts && t`脚本 ${scripts}`, refs > 0 && t`参考 ${refs}`].filter(Boolean).join(" · ");
  const row = `<button type="button" class="skill-row${on ? " on" : ""}" data-skill="${escapeHtml(skill.name)}" aria-pressed="${on}" title="${escapeHtml(skill.description)}">${planMarkHtml(on ? "done" : "pending")}<span class="skill-name">${escapeHtml(skill.name)}</span><span class="skill-gist">${escapeHtml(gist)}</span>${extra ? `<span class="skill-extra">${extra}</span>` : ""}</button>`;
  const dir = escapeHtml(skill.dir),
    ops = own
      ? `<button type="button" data-skill-edit="${dir}" title="${t(`修改`)}">${brushIcon("edit")}</button><button type="button" class="memory-del" data-skill-remove="${dir}" title="${t(`删去`)}">${brushIcon("strike")}</button>`
      : `<button type="button" data-skill-copy="${dir}" title="${t(`拷到存储根，在那里改`)}">${brushIcon("copy")}</button>`;
  return `<div class="skill-item${on ? " on" : ""}">${row}<span class="memory-ops">${ops}</span></div>`;
}
// 摊开的一份：名字一行，何时用（进系统提示的就是这一句）一段，正文一段；底下注目录，右边「完成」「删去」
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
// 存下摊开的那一份：没改就只收起；新建的什么都没写就作罢。改了名，开合记的那一笔跟着换名
let skillSaving = false;
async function settleSkillEditor(workdir) {
  const draft = skillEditing;
  if (!draft || skillSaving) return;
  const before = draft.dir ? skillSets.get(workdir)?.skills.find(skill => skill.dir === draft.dir) : null,
    name = draft.name.trim(),
    body = draft.body.trim();
  if (!draft.dir && !name && !body && !draft.description.trim()) {
    skillEditing = null;
    return renderSettings();
  }
  if (draft.dir && draft.from === JSON.stringify([name, draft.description.trim(), body])) {
    skillEditing = null;
    return renderSettings();
  }
  if (!name) {
    toast(t("技能要有名字"));
    return /** @type {HTMLElement|null} */ ($("[data-skill-field=name]"))?.focus();
  }
  skillSaving = true;
  try {
    await bridge("/api/skills/save", { dir: draft.dir, name, description: draft.description, body }, AbortSignal.timeout(15000));
    if (before && before.name !== name && store.settings.skills && before.name in store.settings.skills) {
      const { [before.name]: state, ...rest } = store.settings.skills;
      store.settings.skills = { ...rest, [name]: state };
      saveStoreSoon();
    }
    skillEditing = null;
    await refreshSkills({ workdir });
  } catch (error) {
    toast(tr(String(error.message || error)));
    return;
  } finally {
    skillSaving = false;
  }
  renderSettings();
}
function bindSkillSettings() {
  const conversation = currentConversation(),
    workdir = conversation?.workdir || "";
  for (const button of document.querySelectorAll("[data-skill-source]"))
    button.addEventListener("click", () => {
      skillSourceOpen = /** @type {HTMLElement} */ (button).dataset.skillSource;
      skillEditing = null;
      renderSettings();
    });
  for (const row of document.querySelectorAll("[data-skill]"))
    row.addEventListener("click", () => {
      const name = /** @type {HTMLElement} */ (row).dataset.skill,
        skill = skillSets.get(workdir)?.skills.find(item => item.name === name);
      if (!skill) return;
      store.settings.skills = { ...store.settings.skills, [name]: !skillEnabled(skill) };
      saveStoreSoon();
      renderSettings();
    });
  $("[data-skill-open]")?.addEventListener("click", () =>
    bridge("/api/skills/open", { workdir, source: skillSourceOpen }).catch(error => toast(tr(error.message)))
  );
  const focusEditor = () => {
    const field = /** @type {HTMLInputElement|null} */ ($(skillEditing?.dir ? "[data-skill-field=body]" : "[data-skill-field=name]"));
    field?.focus();
    if (field) field.setSelectionRange(field.value.length, field.value.length);
  };
  $("#addSkill")?.addEventListener("click", async () => {
    await settleSkillEditor(workdir);
    if (skillEditing) return;
    skillEditing = { dir: "", name: "", description: "", body: "", from: "" };
    renderSettings();
    focusEditor();
  });
  // 改一份：正文现取（SKILL.md 去了头的那段），取到才摊开
  for (const button of document.querySelectorAll("[data-skill-edit]"))
    button.addEventListener("click", async () => {
      await settleSkillEditor(workdir);
      if (skillEditing) return;
      const skill = skillSets.get(workdir)?.skills.find(item => item.dir === /** @type {HTMLElement} */ (button).dataset.skillEdit);
      if (!skill) return;
      try {
        const { text } = await bridge("/api/skills/read", { workdir, dir: skill.dir, path: SKILL_FILE }, AbortSignal.timeout(15000));
        skillEditing = { dir: skill.dir, name: skill.name, description: skill.description, body: text, from: "" };
        skillEditing.from = JSON.stringify([skill.name, skill.description, String(text).trim()]);
      } catch (error) {
        return toast(tr(String(error.message || error)));
      }
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
      if (!editor.contains(/** @type {Node|null} */ (/** @type {FocusEvent} */ (e).relatedTarget))) void settleSkillEditor(workdir);
    });
    $("[data-skill-done]")?.addEventListener("click", () => void settleSkillEditor(workdir));
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
    await refreshSkills({ workdir });
    renderSettings();
  };
  for (const button of document.querySelectorAll("[data-skill-remove]"))
    button.addEventListener("click", () => {
      const skill = skillSets.get(workdir)?.skills.find(item => item.dir === /** @type {HTMLElement} */ (button).dataset.skillRemove);
      if (skill) void removeSkill(skill.dir, skill.name);
    });
  // 拷到存储根：拷过去即换到存储根那一栏，摊开那一份就地改
  for (const button of document.querySelectorAll("[data-skill-copy]"))
    button.addEventListener("click", async () => {
      const skill = skillSets.get(workdir)?.skills.find(item => item.dir === /** @type {HTMLElement} */ (button).dataset.skillCopy);
      if (!skill) return;
      try {
        await bridge("/api/skills/copy", { workdir, dir: skill.dir }, AbortSignal.timeout(30000));
      } catch (error) {
        return toast(tr(String(error.message || error)));
      }
      await refreshSkills({ workdir });
      skillSourceOpen = "言";
      renderSettings();
      toast(t`已拷到存储根：${skill.name}`);
    });
  // 认到的随开随取：刚放进目录的，翻到这一页就看得见；与先前一样就不重画（摊开改着的时候不重画，免得吞了正写的字）
  const before = JSON.stringify(skillSets.get(workdir));
  void refreshSkills(conversation).then(() => {
    if (
      !skillEditing &&
      JSON.stringify(skillSets.get(workdir)) !== before &&
      settingsTab === "skills" &&
      !$("#settingsModal").classList.contains("hidden")
    )
      renderSettings();
  });
}
