// 言 · 技能：照 Claude Code 的写法，一个目录里有 SKILL.md 即一份技能。不另设工具——技能是翻阅文档的又一路来源（见 41-document.js 的 availableDocuments）：
// 名字与说明列在 read_document 的说明里，模型做到相关的事先翻 SKILL.md，同目录的附属文件以「技能名/路径」翻；执事里脚本照技能目录跑。
// 认三处（桥接那头扫，见 server/skills.js）：工作目录/.claude/skills、存储根/技能、~/.claude/skills；设置 → 技能里逐份开关。
// ~/.claude/skills 里的默认不给：那里多是给别家写的（Claude 桌面端的工具言没有），说明又长，每一问都背着；要用的勾上。另两处是特意放进来的，默认给
/** @typedef {{ name: string, description: string, source: string, dir: string, files: { path: string, size: number, modifiedAt: string }[] }} Skill */
const SKILL_FILE = "SKILL.md";
// 三处的名字，设置页左列照这个次序
const SKILL_SOURCES = { 项目: t("工作目录"), 言: t("存储根"), Claude: "Claude" };
/** @type {Map<string, { roots: { source: string, dir: string }[], skills: Skill[] }>} 按工作目录存一份（言里记作空串） */
const skillSets = new Map();
// 每答开工前取一回：增删了技能下一问就认，扫几处目录不过几毫秒；取不到沿用上回的
/** @param {Conversation|null} conversation */
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
// read_document 说明里的目录：一份一行；一份都没有就不带这段，说明与先前一字不差
/** @param {Conversation} conversation */
function skillCatalog(conversation) {
  const skills = skillsOf(conversation).filter(skill => skill.files.some(file => file.path.toLowerCase() === SKILL_FILE.toLowerCase()));
  return skills.length
    ? `\n${fillTemplate(PROMPTS.tools.read_document.skills, { list: skills.map(skill => `- ${skill.name}：${skill.description}`).join("\n") })}`
    : "";
}
// 翻一件：SKILL.md 开头注明技能目录——里头说的相对路径、要跑的脚本都照它
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
// 工作目录那一处看眼前这段对话绑的目录，没绑就不列。落选：卡片（同 MCP，十几张一长串、三处混在一起）、按来处分段的单栏簿录
let skillSourceOpen = "言";
function skillsSettingsHtml() {
  const workdir = currentConversation()?.workdir || "",
    { roots = [], skills = [] } = skillSets.get(workdir) || {},
    sources = Object.keys(SKILL_SOURCES).filter(source => source !== "项目" || workdir),
    open = sources.includes(skillSourceOpen) ? skillSourceOpen : "言",
    dir = roots.find(root => root.source === open)?.dir || "",
    list = skills.filter(skill => skill.source === open),
    tally = items => `${items.filter(skillEnabled).length}/${items.length}`;
  skillSourceOpen = open;
  return (
    `<div class="settings-head">${brushIcon("skills", "settings-mark")}<h2>${t(`技能`)}</h2><span class="settings-meta">${t`${skills.length} 份 · 开 ${skills.filter(skillEnabled).length} 份`}</span></div>` +
    `<div class="memory-split"><div class="memory-cats">${sources
      .map(
        source =>
          `<button type="button" class="memory-cat${source === open ? " active" : ""}" data-skill-source="${source}"><span>${SKILL_SOURCES[source]}</span><em>${tally(skills.filter(skill => skill.source === source))}</em></button>`
      )
      .join("")}</div>` +
    `<div class="memory-pane"><div class="memory-pane-head"><span class="skill-pane-name">${SKILL_SOURCES[open]}</span><span class="memory-cat-count skill-dir" title="${escapeHtml(dir)}">${escapeHtml(dir)}</span><span class="memory-spacer"></span><button type="button" class="skill-open" data-skill-open>${t(`打开`)}</button></div>` +
    `<div class="skill-list">${list.map(skillRowHtml).join("") || `<p class="skill-empty">${t(`尚无一份。一个技能一个文件夹，内有 SKILL.md`)}</p>`}</div></div></div>`
  );
}
/** @param {Skill} skill */
function skillRowHtml(skill) {
  const on = skillEnabled(skill),
    gist = String(skill.description).match(/^.+?(?:[。！？]|[.!?](?=\s|$))/)?.[0] || skill.description,
    count = re => skill.files.filter(file => re.test(file.path)).length,
    scripts = count(/\.(py|js|mjs|cjs|ts|sh|ps1|bat|cmd)$/i),
    refs = count(/\.md$/i) - 1,
    extra = [scripts && t`脚本 ${scripts}`, refs > 0 && t`参考 ${refs}`].filter(Boolean).join(" · ");
  return `<button type="button" class="skill-row${on ? " on" : ""}" data-skill="${escapeHtml(skill.name)}" aria-pressed="${on}" title="${escapeHtml(skill.description)}">${planMarkHtml(on ? "done" : "pending")}<span class="skill-name">${escapeHtml(skill.name)}</span><span class="skill-gist">${escapeHtml(gist)}</span>${extra ? `<span class="skill-extra">${extra}</span>` : ""}</button>`;
}
function bindSkillSettings() {
  const conversation = currentConversation(),
    workdir = conversation?.workdir || "";
  for (const button of document.querySelectorAll("[data-skill-source]"))
    button.addEventListener("click", () => {
      skillSourceOpen = /** @type {HTMLElement} */ (button).dataset.skillSource;
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
  // 认到的随开随取：刚放进目录的，翻到这一页就看得见；与先前一样就不重画
  const before = JSON.stringify(skillSets.get(workdir));
  void refreshSkills(conversation).then(() => {
    if (JSON.stringify(skillSets.get(workdir)) !== before && settingsTab === "skills" && !$("#settingsModal").classList.contains("hidden"))
      renderSettings();
  });
}
