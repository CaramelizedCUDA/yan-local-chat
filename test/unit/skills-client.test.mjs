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
  const input = { value: "/demo 给房东写一封" };
  assert.equal(await f.takeSkillCommand(input), true);
  assert.equal(input.value, "给房东写一封");
  assert.equal(f.pending().length, 1);
  assert.equal(f.pending()[0].name, "Demo.md");
  assert.match(f.pending()[0].text, /^技能目录：E:\/skills\/demo\n\n照格式写信$/);
  const other = { value: "/usr/bin 是什么" };
  assert.equal(await f.takeSkillCommand(other), true);
  assert.equal(other.value, "/usr/bin 是什么");
  assert.equal(f.pending().length, 1);
});
