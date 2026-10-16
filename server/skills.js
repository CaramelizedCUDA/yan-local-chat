// 言 · 桥接 · 技能：照 Claude Code 的写法认技能——一个目录里有 SKILL.md 即一份技能，头上 name / description 两项，其余文件随它走。
// 认三处：工作目录/.claude/skills（给了工作目录才认）、存储根/技能、~/.claude/skills；同名的前者为准。
// 列：各技能的名字、说明、目录与目录里的文件，连同三处各在哪；读：只读列得出的技能目录之内的文件，不经链接出界；开：以本机文件管理器打开某一处。页面怎么用见 src/15-tools/42-skills.js
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { jsonRoute, errorText } = require("./http.js");
const { openPath } = require("./platform.js");
const { WORK_SKIP, resolveWorkdir, resolveInside, pathIsInside, relPath, describeFsError } = require("./work/paths.js");

const SKILL_FILE = "SKILL.md";
// 技能放在几层之内：~/.claude/skills 底下还可能隔着一层同步用的目录
const SKILL_DEPTH = 3,
  SKILL_FILE_LIMIT = 200,
  SKILL_READ_LIMIT = 2 * 1024 * 1024,
  DESCRIPTION_LIMIT = 1024;

// SKILL.md 头上那段 YAML 只认用得着的几种写法：key: 值、引号里的值、| 与 > 的块、缩进续行
function parseSkill(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text.replace(/^﻿/, "") };
  const meta = {},
    lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      value = value[0] === "|" ? block.join("\n") : block.join(" ");
    } else if (value[0] === '"') {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value[0] === "'") value = value.slice(1, -1).replace(/''/g, "'");
    else while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) value += ` ${lines[++i].trim()}`;
    meta[kv[1]] = String(value).trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

module.exports = function createSkills({ skillsHome, claudeHome = () => path.join(os.homedir(), ".claude", "skills") }) {
  const failed = error => errorText(error, 300);
  /** @returns {{ source: string, dir: string }[]} 先后即同名时谁为准 */
  function skillRoots(workdir) {
    const roots = [];
    if (String(workdir || "").trim()) roots.push({ source: "项目", dir: path.join(resolveWorkdir(workdir), ".claude", "skills") });
    roots.push({ source: "言", dir: skillsHome() }, { source: "Claude", dir: claudeHome() });
    return roots;
  }
  // 链到别处的技能目录也认（常见把仓库里的技能链进 ~/.claude/skills），只是不再往下钻点开头的与 node_modules 之类
  async function findSkillDirs(dir, depth, out) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some(entry => entry.name === SKILL_FILE && !entry.isDirectory())) return void out.push(dir);
    if (depth >= SKILL_DEPTH) return;
    for (const entry of entries) {
      if (entry.name.startsWith(".") || WORK_SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name),
        stat = entry.isSymbolicLink() ? await fs.promises.stat(full).catch(() => null) : entry;
      if (stat?.isDirectory()) await findSkillDirs(full, depth + 1, out);
    }
  }
  async function listFiles(root, dir, out) {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= SKILL_FILE_LIMIT) return;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WORK_SKIP.has(entry.name)) await listFiles(root, full, out);
        continue;
      }
      const stat = await fs.promises.stat(full).catch(() => null);
      if (stat) out.push({ path: relPath(root, full), size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  async function listSkills(workdir) {
    const skills = [],
      seen = new Set();
    for (const { source, dir } of skillRoots(workdir)) {
      const dirs = [];
      await findSkillDirs(dir, 0, dirs);
      for (const skillDir of dirs.sort()) {
        const text = await fs.promises.readFile(path.join(skillDir, SKILL_FILE), "utf8").catch(() => null);
        if (text === null) continue;
        const { meta, body } = parseSkill(text),
          name = (meta.name || path.basename(skillDir)).trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const files = [];
        await listFiles(skillDir, skillDir, files);
        skills.push({
          name,
          description: (meta.description || body.split(/\r?\n/).find(line => line.trim() && !line.startsWith("#")) || "")
            .trim()
            .slice(0, DESCRIPTION_LIMIT),
          source,
          dir: skillDir,
          files
        });
      }
    }
    return skills;
  }
  const handleList = jsonRoute(async body => {
    const home = skillsHome();
    // 言自己那一处先建好：设置里指给人看的目录，点开就在
    await fs.promises.mkdir(home, { recursive: true }).catch(() => {});
    return { home, roots: skillRoots(body.workdir), skills: await listSkills(body.workdir) };
  }, failed);
  // 打开某一处：言自己那处没有就建，另两处没有就说一声（不替人往 ~/.claude 或项目里建目录）
  const handleOpen = jsonRoute(async body => {
    const root = skillRoots(body.workdir).find(item => item.source === body.source);
    if (!root) throw Error(`没有这一处：${body.source}`);
    if (root.dir === skillsHome()) await fs.promises.mkdir(root.dir, { recursive: true });
    else if (!(await fs.promises.stat(root.dir).catch(() => null))?.isDirectory()) throw Error(`目录还不存在：${root.dir}`);
    openPath(root.dir);
    return { opened: root.dir };
  }, failed);
  // 读一件：dir 须是此刻列得出的某份技能，path 在它之内；SKILL.md 去掉头上那段（名字与说明目录里已给过）
  const handleRead = jsonRoute(async body => {
    const skill = (await listSkills(body.workdir)).find(item => item.dir === String(body.dir || ""));
    if (!skill) throw Error(`没有这份技能：${body.dir}`);
    const file = resolveInside(skill.dir, String(body.path || "").trim() || SKILL_FILE),
      [realDir, realFile] = await Promise.all([fs.promises.realpath(skill.dir), fs.promises.realpath(file)]).catch(error => {
        throw Error(describeFsError(error, String(body.path || "")));
      });
    if (!pathIsInside(realDir, realFile)) throw Error(`路径经过链接越出了技能目录：${body.path}`);
    const stat = await fs.promises.stat(realFile);
    if (!stat.isFile()) throw Error(`不是文件：${body.path}`);
    if (stat.size > SKILL_READ_LIMIT) throw Error(`文件过大（${Math.round(stat.size / 1024)} KB）`);
    const text = await fs.promises.readFile(realFile, "utf8"),
      main = path.relative(skill.dir, file).toLowerCase() === SKILL_FILE.toLowerCase();
    return { text: main ? parseSkill(text).body.trim() : text };
  }, failed);
  // 言自己那一处的某份：dir 须在存储根/技能之内、真有 SKILL.md（另两处是别家的目录，只读不写）
  async function ownSkillDir(dir) {
    const home = skillsHome(),
      target = path.resolve(String(dir || ""));
    const [realHome, realDir] = await Promise.all([fs.promises.realpath(home), fs.promises.realpath(target)]).catch(() => []);
    if (!realDir || realDir === realHome || !pathIsInside(realHome, realDir)) throw Error(`不在言的技能目录里：${dir}`);
    if (!(await fs.promises.stat(path.join(realDir, SKILL_FILE)).catch(() => null))?.isFile()) throw Error(`没有这份技能：${dir}`);
    return realDir;
  }
  // 存一份（新建或改）：只写言自己那一处。名字即目录名；改名时目录跟着改。头上除名字与说明外别的几项（license 之类）原样留着
  const handleSave = jsonRoute(async body => {
    const name = String(body.name || "").trim(),
      description = String(body.description || "")
        .replace(/\s+/g, " ")
        .trim(),
      text = String(body.body || "").replace(/\r\n?/g, "\n");
    if (!name) throw Error("技能要有名字");
    if (name.length > 64 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /^\.|[. ]$/.test(name))
      throw Error('名字里不能有 < > : " / \\ | ? *，不以点开头，不以点或空格结尾，至多 64 字');
    if (description.length > DESCRIPTION_LIMIT) throw Error(`何时用至多 ${DESCRIPTION_LIMIT} 字`);
    await fs.promises.mkdir(skillsHome(), { recursive: true });
    const home = await fs.promises.realpath(skillsHome()),
      from = body.dir ? await ownSkillDir(body.dir) : "",
      clash = (await listSkills("")).find(skill => skill.source === "言" && skill.name.toLowerCase() === name.toLowerCase());
    if (clash && (await fs.promises.realpath(clash.dir)) !== from) throw Error(`已有一份叫「${name}」`);
    let dir = from || path.join(home, name);
    if (!from && (await fs.promises.stat(dir).catch(() => null))) throw Error(`目录已在：${dir}`);
    // 改名：目录名原本就是旧名字的，跟着改；挪不动（别处占着、正被打开）就留在原处，名字照改
    if (from && path.basename(from) !== name && path.dirname(from) === home) {
      const to = path.join(home, name);
      if (!(await fs.promises.stat(to).catch(() => null)))
        dir = await fs.promises.rename(from, to).then(
          () => to,
          () => from
        );
    }
    const old = from ? await fs.promises.readFile(path.join(dir, SKILL_FILE), "utf8").catch(() => "") : "",
      head = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(old)?.[1] || "",
      // 留下的几项：按「顶格的 key:」分段，name / description 连同它们的续行一并换掉
      kept = head.split(/\r?\n(?=[A-Za-z][\w-]*:)/).filter(entry => entry.trim() && !/^(name|description):/.test(entry));
    const file = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n${kept.map(entry => `${entry}\n`).join("")}---\n\n${text.trim()}\n`;
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, SKILL_FILE), file);
    return { dir };
  }, failed);
  // 删一份：整个目录连同附带的脚本与参考（页面先问过人）
  const handleRemove = jsonRoute(async body => {
    const dir = await ownSkillDir(body.dir);
    await fs.promises.rm(dir, { recursive: true, force: true });
    return { removed: dir };
  }, failed);
  // 拷一份到言自己那一处：别处的（项目里的、~/.claude/skills 里别家同步来的）不在原处改，拷过来改副本；同名的言这一处为准，原份照旧
  const handleCopy = jsonRoute(async body => {
    const skill = (await listSkills(body.workdir)).find(item => item.dir === String(body.dir || ""));
    if (!skill) throw Error(`没有这份技能：${body.dir}`);
    if (skill.source === "言") throw Error("这份已在存储根里");
    await fs.promises.mkdir(skillsHome(), { recursive: true });
    const to = path.join(skillsHome(), skill.name);
    if (await fs.promises.stat(to).catch(() => null)) throw Error(`存储根里已有「${skill.name}」`);
    // 链着的照内容拷，点开头的（.git 之类）不带
    await fs.promises.cp(skill.dir, to, { recursive: true, dereference: true, filter: from => !path.basename(from).startsWith(".") });
    return { dir: to };
  }, failed);
  return {
    parseSkill,
    routes: {
      "POST /api/skills/copy": handleCopy,
      "POST /api/skills/list": handleList,
      "POST /api/skills/read": handleRead,
      "POST /api/skills/open": handleOpen,
      "POST /api/skills/save": handleSave,
      "POST /api/skills/remove": handleRemove
    }
  };
};
