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
