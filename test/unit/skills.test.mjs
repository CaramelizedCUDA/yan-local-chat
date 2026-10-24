// 技能：SKILL.md 头上的几种写法、三处同名谁为准、隔一层的也认、读时只认技能目录之内
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

test("三处都认：工作目录的为准，隔一层的也找得到；读 SKILL.md 去头，越界的不读", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, "skills-")),
    home = path.join(base, "技能"),
    claude = path.join(base, "claude"),
    work = path.join(base, "work");
  put(path.join(work, ".claude/skills/pdf/SKILL.md"), "---\nname: pdf\ndescription: 项目里的\n---\n项目正文");
  put(path.join(home, "pdf/SKILL.md"), "---\nname: pdf\ndescription: 言里的\n---\n言正文");
  put(path.join(home, "写信/SKILL.md"), "# 写信\n\n照格式写信。");
  put(path.join(home, "写信/格式/信.md"), "敬启者");
  put(path.join(claude, "synced/abc/docx/SKILL.md"), "---\nname: docx\ndescription: Word\n---\nWord 正文");
  put(path.join(claude, ".hidden/x/SKILL.md"), "---\nname: x\n---\n");
  put(path.join(base, "secret.txt"), "机密");
  const { routes } = createSkills({ skillsHome: () => home, claudeHome: () => claude });

  const listed = await call(routes["POST /api/skills/list"], { workdir: work });
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.data.roots.map(root => root.source),
    ["项目", "言", "Claude"]
  );
  const byName = Object.fromEntries(listed.data.skills.map(skill => [skill.name, skill]));
  assert.deepEqual(Object.keys(byName).sort(), ["docx", "pdf", "写信"]);
  assert.equal(byName.pdf.description, "项目里的");
  assert.equal(byName.pdf.source, "项目");
  assert.equal(byName["写信"].description, "照格式写信。");
  assert.deepEqual(byName["写信"].files.map(file => file.path).sort(), ["SKILL.md", "格式/信.md"]);
  assert.equal(byName.docx.source, "Claude");

  const noWork = await call(routes["POST /api/skills/list"], {});
  assert.equal(noWork.data.skills.find(skill => skill.name === "pdf").description, "言里的");

  const read = routes["POST /api/skills/read"];
  assert.equal((await call(read, { workdir: work, dir: byName.pdf.dir, path: "SKILL.md" })).data.text, "项目正文");
  assert.equal((await call(read, { dir: byName["写信"].dir, path: "格式/信.md" })).data.text, "敬启者");
  assert.equal((await call(read, { dir: byName["写信"].dir, path: "../../secret.txt" })).status, 400);
  assert.equal((await call(read, { dir: base, path: "secret.txt" })).status, 400);
});

test("在言里写技能：新建、改名带着目录走、头上别的几项留着；同名、别处的、越界的都不写不删", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, "skills-save-")),
    home = path.join(base, "技能"),
    claude = path.join(base, "claude");
  put(path.join(claude, "docx/SKILL.md"), "---\nname: docx\n---\nWord");
  const { routes, parseSkill } = createSkills({ skillsHome: () => home, claudeHome: () => claude }),
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

  assert.equal((await call(save, { dir: path.join(claude, "docx"), name: "docx", body: "改" })).status, 400, "别处的只读");
  assert.equal((await call(remove, { dir: path.join(claude, "docx") })).status, 400);
  assert.equal((await call(remove, { dir: home })).status, 400);
  assert.equal(fs.existsSync(path.join(claude, "docx/SKILL.md")), true);
  assert.equal((await call(remove, { dir: renamed.data.dir })).status, 200);
  assert.equal(fs.existsSync(path.join(home, "书信")), false);

  // 别处的拷到存储根改副本：整个目录（点开头的不带）拷过来，原份不动；再拷一回、拷言自己的都不行
  put(path.join(claude, "docx/scripts/a.py"), "print(1)");
  put(path.join(claude, "docx/.git/x"), "x");
  const copy = routes["POST /api/skills/copy"],
    copied = await call(copy, { dir: path.join(claude, "docx") });
  assert.equal(copied.status, 200);
  assert.equal(fs.readFileSync(path.join(home, "docx/scripts/a.py"), "utf8"), "print(1)");
  assert.equal(fs.existsSync(path.join(home, "docx/.git")), false);
  assert.equal(fs.existsSync(path.join(claude, "docx/SKILL.md")), true);
  const after = (await call(routes["POST /api/skills/list"], {})).data.skills.filter(skill => skill.name === "docx");
  assert.deepEqual(
    after.map(skill => skill.source),
    ["言"],
    "同名的言这一处为准"
  );
  assert.equal((await call(copy, { dir: copied.data.dir })).status, 400);
});
