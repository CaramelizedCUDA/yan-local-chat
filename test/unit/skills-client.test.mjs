import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

const win = { YAN_PROMPTS: {} };
new Function("window", readFileSync(new URL("../../prompts/tools.js", import.meta.url), "utf8"))(win);

test("技能只把名字和说明带进工具定义，参考按需翻；对话附件照常列出", async () => {
  const f = load([
    "toolDefinitions",
    "TOOLS",
    `setup: prompts => {
      Object.assign(PROMPTS, prompts); store.settings.skills = {}; store.settings.archiveRead = false;
      skillSets.set('', { roots: [], skills: [{ name: 'demo', description: '照格式写信', source: '言', dir: 'E:/skills/demo', files:
        ['SKILL.md', ...Array.from({length:80}, (_, i) => 'references/ref-' + i + '.md')].map(path => ({path}))
      }] });
      bridge = async () => ({ text: '参考正文' });
    }`
  ]);
  f.setup(win.YAN_PROMPTS);
  const conversation = { messages: [{ attachments: [{ id: "a1", name: "需求.txt", kind: "text" }] }] };
  const description = f.toolDefinitions(conversation).find(tool => tool.function.name === "read_document").function.description;
  assert.match(description, /本段附件：需求\.txt。/);
  assert.match(description, /demo：照格式写信/);
  assert.ok(!description.includes("references/ref-"), "附属文件清单不随每一问发送");
  assert.ok(!description.includes("demo/SKILL.md"));
  const outcome = await f.TOOLS.get("read_document").run({}, { name: "demo/references/ref-79.md" }, { conversation });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.content, "参考正文");
});

test("技能页从工作目录切到无目录对话：显示存储根时，打开的也是存储根", async () => {
  const f = load([
      "skillsSettingsHtml",
      "bindSkillSettings",
      "doc: () => document",
      `setup: request => {
      skillSourceOpen = '项目'; currentConversation = () => null;
      skillSets.set('', { roots: [{ source: '言', dir: 'E:/store/技能' }], skills: [] });
      bridge = request; refreshSkills = async () => {};
    }`
    ]),
    requests = [];
  f.setup(async (url, body) => {
    requests.push({ url, body });
    return {};
  });
  const html = f.skillsSettingsHtml();
  assert.match(html, /memory-cat active[^>]*data-skill-source="言"/);
  assert.ok(html.includes("E:/store/技能"));
  const query = f.doc().querySelector;
  let click;
  f.doc().querySelector = selector => ({
    addEventListener: (_, fn) => {
      if (selector === "[data-skill-open]") click = fn;
    }
  });
  try {
    f.bindSkillSettings();
    await click();
    assert.deepEqual(requests, [{ url: "/api/skills/open", body: { workdir: "", source: "言" } }]);
  } finally {
    f.doc().querySelector = query;
  }
});
