// 技能：SKILL.md 头上的几种写法、只认存储根/技能、隔一层的也认、读时只认技能目录之内；写、改名、删
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const createSkills = createRequire(import.meta.url)("../../server/skills.js");

async function call(route, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  let status, data;
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead(code) {
      status = code;
      this.headersSent = true;
    },
    end(text) {
      data = JSON.parse(text);
      this.writableEnded = true;
    }
  };
  await route(req, res);
  return { status, data };
}
function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test("SKILL.md 头上的写法：引号、块、续行，正文去掉头", () => {
  const { parseSkill } = createSkills({ skillsHome: () => "" });
  const quoted = parseSkill('---\nname: pdf\ndescription: "Use it \\"when\\" PDFs"\nlicense: x\n---\n\n# PDF\nbody');
  assert.deepEqual(quoted.meta, { name: "pdf", description: 'Use it "when" PDFs', license: "x" });
  assert.equal(quoted.body.trim(), "# PDF\nbody");
  assert.equal(parseSkill("---\r\nname: a\r\ndescription: >\r\n  one\r\n  two\r\n---\r\nx").meta.description, "one two");
  assert.equal(parseSkill("---\nname: a\ndescription: |\n  one\n  two\n---\nx").meta.description, "one\ntwo");
  assert.equal(parseSkill("---\nname: a\ndescription: one\n  two\n---\nx").meta.description, "one two");
  assert.equal(parseSkill("---\nname: 'it''s'\n---\nx").meta.name, "it's");
  assert.deepEqual(parseSkill("# 无头\n正文").meta, {});
});

test("只认存储根/技能：隔一层的也找得到，同名先到的为准；读 SKILL.md 去头，越界的不读", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, "skills-")),
    home = path.join(base, "技能");
  put(path.join(home, "pdf/SKILL.md"), "---\nname: pdf\ndescription: 言里的\n---\n言正文");
  put(path.join(home, "组/pdf2/SKILL.md"), "---\nname: pdf\ndescription: 隔层的同名\n---\n");
  put(path.join(home, "写信/SKILL.md"), "# 写信\n\n照格式写信。");
  put(path.join(home, "写信/格式/信.md"), "敬启者");
  put(path.join(home, "synced/abc/docx/SKILL.md"), "---\nname: docx\ndescription: Word\n---\nWord 正文");
  put(path.join(home, ".hidden/x/SKILL.md"), "---\nname: x\n---\n");
  put(path.join(base, "secret.txt"), "机密");
  const { routes } = createSkills({ skillsHome: () => home });

  const listed = await call(routes["POST /api/skills/list"], {});
  assert.equal(listed.status, 200);
  assert.equal(listed.data.home, home);
  const byName = Object.fromEntries(listed.data.skills.map(skill => [skill.name, skill]));
  assert.deepEqual(Object.keys(byName).sort(), ["docx", "pdf", "写信"]);
  assert.equal(byName.pdf.description, "言里的");
  assert.equal(byName["写信"].description, "照格式写信。");
  assert.deepEqual(byName["写信"].files.map(file => file.path).sort(), ["SKILL.md", "格式/信.md"]);

  const read = routes["POST /api/skills/read"];
  assert.equal((await call(read, { dir: byName.pdf.dir, path: "SKILL.md" })).data.text, "言正文");
  assert.equal((await call(read, { dir: byName["写信"].dir, path: "格式/信.md" })).data.text, "敬启者");
  assert.equal((await call(read, { dir: byName["写信"].dir, path: "../../secret.txt" })).status, 400);
  assert.equal((await call(read, { dir: base, path: "secret.txt" })).status, 400);
});

test("头上认 disable-model-invocation、user-invocable；附属多到截断时 SKILL.md 仍在", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const home = path.join(fs.mkdtempSync(path.join(parent, "skills-")), "技能");
  put(path.join(home, "周报/SKILL.md"), '---\nname: 周报\ndisable-model-invocation: true\nargument-hint: "[哪一周]"\n---\n照写');
  put(path.join(home, "暗记/SKILL.md"), "---\nname: 暗记\nuser-invocable: false\n---\n");
  for (let i = 0; i < 1010; i++) put(path.join(home, `字体/assets/f${i}.ttf`), "");
  put(path.join(home, "字体/SKILL.md"), "---\nname: 字体\n---\n");
  const { routes } = createSkills({ skillsHome: () => home });
  const byName = Object.fromEntries((await call(routes["POST /api/skills/list"], {})).data.skills.map(skill => [skill.name, skill]));
  assert.deepEqual([byName["周报"].manual, byName["周报"].hidden], [true, false]);
  assert.deepEqual([byName["暗记"].manual, byName["暗记"].hidden], [false, true]);
  assert.equal(byName["字体"].files.length, 1000);
  assert.equal(byName["字体"].files[0].path, "SKILL.md");
});

test("写技能：新建、改名带着目录走、头上别的几项留着；同名、技能目录之外的都不写不删", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, "skills-save-")),
    home = path.join(base, "技能"),
    outside = path.join(base, "别处");
  put(path.join(outside, "docx/SKILL.md"), "---\nname: docx\n---\nWord");
  const { routes, parseSkill } = createSkills({ skillsHome: () => home }),
    save = routes["POST /api/skills/save"],
    remove = routes["POST /api/skills/remove"];

  const made = await call(save, { name: "写信", description: "给人写信时：照格式\n写", body: "抬头、正文、落款。" });
  assert.equal(made.status, 200);
  const file = path.join(home, "写信", "SKILL.md");
  const first = parseSkill(fs.readFileSync(file, "utf8"));
  assert.deepEqual(first.meta, { name: "写信", description: "给人写信时：照格式 写" });
  assert.equal(first.body.trim(), "抬头、正文、落款。");
  assert.equal((await call(save, { name: "写信", body: "又一份" })).status, 400, "同名不另建");
  assert.equal((await call(save, { name: "a/b", body: "x" })).status, 400);
  assert.equal((await call(save, { name: "", body: "x" })).status, 400);

  // 别人拷进来的那份带着 license 与多行的 metadata：改了名字与正文，这几项原样留着
  fs.writeFileSync(file, "---\nname: 写信\ndescription: >\n  旧的\n  说明\nlicense: MIT\nmetadata:\n  author: x\n---\n旧正文");
  const renamed = await call(save, { dir: made.data.dir, name: "书信", description: "新说明", body: "新正文" });
  assert.equal(renamed.status, 200);
  assert.equal(path.basename(renamed.data.dir), "书信");
  assert.equal(fs.existsSync(path.join(home, "写信")), false);
  const text = fs.readFileSync(path.join(home, "书信", "SKILL.md"), "utf8"),
    second = parseSkill(text);
  assert.equal(second.meta.name, "书信");
  assert.equal(second.meta.description, "新说明");
  assert.equal(second.meta.license, "MIT");
  assert.match(text, /metadata:\n  author: x\n/);
  assert.equal(second.body.trim(), "新正文");

  assert.equal((await call(save, { dir: path.join(outside, "docx"), name: "docx", body: "改" })).status, 400, "目录之外的不写");
  assert.equal((await call(remove, { dir: path.join(outside, "docx") })).status, 400);
  assert.equal((await call(remove, { dir: home })).status, 400);
  assert.equal(fs.existsSync(path.join(outside, "docx/SKILL.md")), true);
  assert.equal((await call(remove, { dir: renamed.data.dir })).status, 200);
  assert.equal(fs.existsSync(path.join(home, "书信")), false);
});

test("随言带来的技能：头一回列技能时拷进去，人删了不拷回、同名的已在不动，下一版新添的照拷", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, "skills-bundled-")),
    bundled = path.join(base, "skills"),
    home = path.join(base, "存储根", "技能");
  put(path.join(bundled, "甲/SKILL.md"), "---\nname: 甲\ndescription: 自带的甲\n---\n甲正文");
  put(path.join(bundled, "甲/参考/表.md"), "表");
  put(path.join(bundled, "乙/SKILL.md"), "---\nname: 乙\ndescription: 自带的乙\n---\n");
  put(path.join(home, "乙/SKILL.md"), "---\nname: 乙\ndescription: 人改过的乙\n---\n");
  const list = async () =>
    Object.fromEntries(
      (await call(createSkills({ skillsHome: () => home, bundled }).routes["POST /api/skills/list"], {})).data.skills.map(skill => [
        skill.name,
        skill
      ])
    );

  let byName = await list();
  assert.deepEqual(Object.keys(byName).sort(), ["乙", "甲"]);
  assert.equal(fs.readFileSync(path.join(home, "甲/参考/表.md"), "utf8"), "表");
  assert.equal(byName["乙"].description, "人改过的乙", "同名的已在不覆盖");

  fs.rmSync(path.join(home, "甲"), { recursive: true });
  put(path.join(bundled, "丙/SKILL.md"), "---\nname: 丙\n---\n");
  byName = await list();
  assert.deepEqual(Object.keys(byName).sort(), ["丙", "乙"], "删了的不拷回，新添的照拷");
});

test("仓库里随言带来的技能：名字同目录名，何时用不过长，caelison 只凭点名", async () => {
  const bundled = path.resolve("skills"),
    { parseSkill } = createSkills({ skillsHome: () => "" });
  const names = fs.readdirSync(bundled).sort();
  assert.deepEqual(names, ["caelison", "code-review", "deep-research", "design", "learn", "skill-creator"]);
  for (const name of names) {
    const text = fs.readFileSync(path.join(bundled, name, "SKILL.md"), "utf8"),
      { meta, body } = parseSkill(text);
    assert.equal(meta.name, name);
    assert.ok(meta.description && meta.description.length <= 80, `${name} 的何时用 ${meta.description?.length} 字`);
    assert.ok(body.trim());
    assert.doesNotMatch(text, /[A-Z]:\|聊天记录/, `${name} 里不带本机路径`);
  }
  assert.equal(parseSkill(fs.readFileSync(path.join(bundled, "caelison/SKILL.md"), "utf8")).meta["disable-model-invocation"], "true");
});
