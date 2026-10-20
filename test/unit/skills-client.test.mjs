import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

const win = { YAN_PROMPTS: {} };
for (const name of ["tools", "assistant", "skills"])
  new Function("window", readFileSync(new URL(`../../prompts/${name}.js`, import.meta.url), "utf8"))(win);

test("技能只把名字和说明带进系统提示，参考按需翻；对话附件照常列在工具说明里", async () => {
  const f = load([
    "toolDefinitions",
    "systemPrompt",
    "TOOLS",
    `setup: prompts => {
      Object.assign(PROMPTS, prompts); store.settings.archiveRead = false;
      skillSet = { home: 'E:/skills', skills: [{ name: 'demo', description: '照格式写信', dir: 'E:/skills/demo', files:
        ['SKILL.md', ...Array.from({length:80}, (_, i) => 'references/ref-' + i + '.md')].map(path => ({path}))
      }] };
      bridge = async () => ({ text: '参考正文' });
    }`
  ]);
  f.setup(win.YAN_PROMPTS);
  const conversation = { messages: [{ attachments: [{ id: "a1", name: "需求.txt", kind: "text" }] }] };
  const tools = f.toolDefinitions(conversation),
    description = tools.find(tool => tool.function.name === "read_document").function.description,
    system = f.systemPrompt(conversation, tools);
  assert.match(description, /本段附件：需求\.txt。/);
  assert.ok(!description.includes("demo"), "技能目录不在工具说明里");
  assert.match(system, /demo：照格式写信/);
  assert.ok(!system.includes("references/ref-"), "附属文件清单不随每一问发送");
  assert.ok(!system.includes("demo/SKILL.md"));
  const outcome = await f.TOOLS.get("read_document").run({}, { name: "demo/references/ref-79.md" }, { conversation });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.content, "参考正文");
});

test("问话以「/技能名」开头：说明作附件放上案，问话去掉点名；对不上的照原话", async () => {
  const f = load([
    "takeSkillCommand",
    "pending: () => pendingAttachments",
    `setup: () => {
      pendingAttachments = []; renderAttachments = () => {};
      skillSet = { home: 'E:/skills', skills: [{ name: 'Demo', description: '写信', dir: 'E:/skills/demo', files: [{ path: 'SKILL.md' }] }] };
      bridge = async () => ({ text: '照格式写信' });
      ingestFile = async file => ({ id: 'a', name: file.name, kind: 'text', text: await file.text() });
    }`
  ]);
  f.setup();
  const input = { content: "/demo 给房东写一封", attachments: [], quote: null };
  assert.equal(await f.takeSkillCommand(input), true);
  assert.equal(input.content, "给房东写一封");
  assert.equal(input.attachments.length, 1);
  assert.equal(input.attachments[0].name, "Demo.md");
  assert.match(input.attachments[0].text, /^点名用技能「Demo」，照它做。\n技能目录：E:\/skills\/demo\n\n照格式写信$/);
  assert.deepEqual(f.pending(), [], "发送快照不改眼前的待发附件");
  const other = { content: "/usr/bin 是什么", attachments: [], quote: null };
  assert.equal(await f.takeSkillCommand(other), true);
  assert.equal(other.content, "/usr/bin 是什么");
  assert.deepEqual(other.attachments, []);
});

test("只凭点名的技能不进系统提示；名字带空格取最长的那份；说明里的 $ARGUMENTS 换成点名后的话", async () => {
  const f = load([
    "skillCatalog",
    "takeSkillCommand",
    `setup: () => {
      skillSet = { home: 'E:/skills', skills: [
        { name: 'weekly', description: '写周报', dir: 'E:/skills/weekly', files: [{ path: 'SKILL.md' }], manual: true },
        { name: 'week', description: '记一周', dir: 'E:/skills/week', files: [{ path: 'SKILL.md' }] },
        { name: 'week plan', description: '排一周', dir: 'E:/skills/week plan', files: [{ path: 'SKILL.md' }] }
      ] };
      bridge = async (route, body) => ({ text: '为 $ARGUMENTS 排：' + body.dir });
      ingestFile = async file => ({ id: 'a', name: file.name, kind: 'text', text: await file.text() });
    }`
  ]);
  f.setup();
  const catalog = f.skillCatalog().list;
  assert.ok(!catalog.includes("weekly"), "manual 的不列给模型");
  assert.match(catalog, /- week：记一周/);
  const spaced = { content: "/week plan 下周三", attachments: [], quote: null };
  await f.takeSkillCommand(spaced);
  assert.equal(spaced.content, "下周三");
  assert.equal(spaced.attachments[0].name, "week plan.md");
  assert.match(spaced.attachments[0].text, /为 下周三 排：E:\/skills\/week plan$/);
  const manual = { content: "/weekly", attachments: [], quote: null };
  await f.takeSkillCommand(manual);
  assert.equal(manual.content, "");
  assert.equal(manual.attachments[0].name, "weekly.md", "只凭点名的仍可点名");
  const prefix = { content: "/weeks", attachments: [], quote: null };
  await f.takeSkillCommand(prefix);
  assert.equal(prefix.content, "/weeks", "名字只对上前半截的不算");
});
