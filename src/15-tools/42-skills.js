// 言 · 技能：照 Claude Code 的写法，一个目录里有 SKILL.md 即一份技能。不另设工具——技能是翻阅文档的又一路来源（见 41-document.js 的 availableDocuments）：
// 名字与说明列在 read_document 的说明里，模型做到相关的事先翻 SKILL.md，同目录的附属文件以「技能名/路径」翻；执事里脚本照技能目录跑。
// 认三处（桥接那头扫，见 server/skills.js）：工作目录/.claude/skills、存储根/技能、~/.claude/skills；设置 → 工具里逐份开关。
// ~/.claude/skills 里的默认不给：那里多是给别家写的（Claude 桌面端的工具言没有），说明又长，每一问都背着；要用的勾上。另两处是特意放进来的，默认给
/** @typedef {{ name: string, description: string, source: string, dir: string, files: { path: string, size: number, modifiedAt: string }[] }} Skill */
const SKILL_FILE = "SKILL.md";
// 设置里每份后面注一个小字：从哪一处认来的
const SKILL_SOURCES = { 项目: t("工作目录"), 言: t("存储根"), Claude: "Claude" };
/** @type {Map<string, Skill[]>} 按工作目录存一份（言里记作空串） */
const skillSets = new Map();
let skillsHome = "";
// 每答开工前取一回：增删了技能下一问就认，扫几处目录不过几毫秒；取不到沿用上回的
/** @param {Conversation|null} conversation */
async function refreshSkills(conversation) {
  const workdir = conversation?.workdir || "";
  try {
    const data = await bridge("/api/skills/list", { workdir }, AbortSignal.timeout(5000));
    skillsHome = data.home || skillsHome;
    skillSets.set(workdir, data.skills || []);
  } catch {}
}
/** @param {Skill} skill 设置里亲手开关过的照它，否则看从哪一处认来的 */
function skillEnabled(skill) {
  return store.settings.skills?.[skill.name] ?? skill.source !== "Claude";
}
/** @param {Conversation|null} conversation @returns {Skill[]} 这段对话认得的、开着的 */
function skillsOf(conversation) {
  return (skillSets.get(conversation?.workdir || "") || []).filter(skillEnabled);
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

// 设置 → 工具里的一段：认到的技能逐份列出，不勾的不给模型；言自己那一处的目录写在说明里
function skillsSettingsHtml() {
  const skills = skillSets.get("") || [];
  const list = skills.length
    ? `<div class="preset-checks skill-checks">${skills
        .map(
          skill =>
            `<label class="check" title="${escapeHtml(`${skill.description}\n${skill.dir}`)}"><input type="checkbox" data-skill="${escapeHtml(skill.name)}"${skillEnabled(skill) ? " checked" : ""}>${escapeHtml(skill.name)}<span class="skill-source">${escapeHtml(SKILL_SOURCES[skill.source] || skill.source)}</span></label>`
        )
        .join("")}</div>`
    : "";
  return `<div class="setting-row${skills.length ? " setting-row-lead" : ""}"><div class="setting-copy"><strong>${t(`技能`)}</strong><small title="${escapeHtml(skillsHome)}">${t`放进 ${escapeHtml(skillsHome || t("存储根/技能"))}、~/.claude/skills 或工作目录的 .claude/skills；勾上的给模型，~/.claude/skills 里的默认不勾`}</small></div></div>${list}`;
}
function bindSkillSettings() {
  for (const box of document.querySelectorAll("[data-skill]"))
    box.addEventListener("change", e => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      store.settings.skills = { ...store.settings.skills, [input.dataset.skill]: input.checked };
      saveStoreSoon();
    });
}
