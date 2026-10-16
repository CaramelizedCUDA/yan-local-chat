// 设置 → 技能：存储根那一处就地写一份、改名（目录跟着走）、删去；别处的只给开合
import { existsSync, readFileSync } from "node:fs";
import { connect, check, sleep, PAGE, HOME } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
const SKILLS = `${HOME}/技能`;
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector("#openSettings")`);
await sleep(400);
await evalJs(`document.querySelector("#openSettings").click(); document.querySelector('.tab-btn[data-tab="skills"]').click(); true`);
await waitFor(`!!document.querySelector('#settingsContent [data-skill-source="言"].active') && !!document.querySelector("#addSkill")`);
check("the storage-root pane offers 新建一份", true);

// 新建：名字、何时用、正文，焦点离开即存成 技能/<名字>/SKILL.md
await evalJs(`document.querySelector("#addSkill").click(); true`);
await waitFor(`!!document.querySelector("[data-skill-editor]")`);
check("the new skill opens with the name field focused", await evalJs(`document.activeElement?.dataset.skillField === "name"`));
const fill = (field, value) =>
  evalJs(
    `(f => { f.focus(); f.value = ${JSON.stringify(value)}; f.dispatchEvent(new Event("input")); return true; })(document.querySelector('[data-skill-field="${field}"]'))`
  );
await fill("name", "回信");
await fill("description", "替人回信时：先谢来信，再答所问");
await fill("body", "一、谢来信。\n二、逐条答。\n三、落款。");
await sleep(800);
await shot("skills-editor.png");
await evalJs(`document.activeElement.blur(); true`);
await waitFor(`!document.querySelector("[data-skill-editor]") && !!document.querySelector('[data-skill="回信"]')`, 8000);
const made = existsSync(`${SKILLS}/回信/SKILL.md`) ? readFileSync(`${SKILLS}/回信/SKILL.md`, "utf8") : "";
check(
  "leaving the editor writes 技能/回信/SKILL.md with name, description and body",
  /name: "回信"/.test(made) && /description: "替人回信时：先谢来信，再答所问"/.test(made) && /二、逐条答。/.test(made),
  made
);
check("the new skill is listed and on", await evalJs(`document.querySelector('[data-skill="回信"]').classList.contains("on")`));

// 改：正文现取摊开；改名后目录跟着改
await evalJs(`document.querySelector('[data-skill="回信"]').parentElement.querySelector("[data-skill-edit]").click(); true`);
await waitFor(
  `!!document.querySelector('[data-skill-field="body"]') && document.querySelector('[data-skill-field="body"]').value.includes("逐条答")`,
  8000
);
check(
  "editing loads the body without its front matter",
  await evalJs(`!document.querySelector('[data-skill-field="body"]').value.includes("name:")`)
);
await fill("name", "复信");
await evalJs(`document.querySelector("[data-skill-done]").click(); true`);
await waitFor(`!document.querySelector("[data-skill-editor]") && !!document.querySelector('[data-skill="复信"]')`, 8000);
check("renaming moves the folder", existsSync(`${SKILLS}/复信/SKILL.md`) && !existsSync(`${SKILLS}/回信`));

// 删去：行上那枚「删」，先问，连同目录一并删
await evalJs(`document.querySelector('[data-skill="复信"]').parentElement.querySelector("[data-skill-remove]").click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
check("deleting asks first and names the folder", /复信/.test(await evalJs(`document.querySelector("#confirmModal").textContent`)));
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!document.querySelector('[data-skill="复信"]')`, 8000);
check("the skill folder is gone from disk", !existsSync(`${SKILLS}/复信`));

// 别处（~/.claude/skills）的只看只开合：没有新建，也没有改
await evalJs(`document.querySelector('[data-skill-source="Claude"]').click(); true`);
await waitFor(`!!document.querySelector('#settingsContent [data-skill-source="Claude"].active')`);
check(
  "other sources have no 新建, 改 or 删, only 拷到存储根",
  await evalJs(
    `!document.querySelector("#addSkill") && !document.querySelector("[data-skill-edit]") && !document.querySelector("[data-skill-remove]") && document.querySelectorAll("[data-skill-copy]").length === document.querySelectorAll("[data-skill]").length`
  )
);
// 拷到存储根：别处那一份整个拷过来、换到存储根那一栏（这一处读的是本机真的 ~/.claude/skills，没有就不测）
const first = await evalJs(
  `document.querySelector("[data-skill-copy]")?.closest(".skill-item").querySelector("[data-skill]").dataset.skill || ""`
);
if (first) {
  await evalJs(`document.querySelector("[data-skill-copy]").click(); true`);
  await waitFor(
    `!!document.querySelector('#settingsContent [data-skill-source="言"].active') && !!document.querySelector('[data-skill="${first}"]')`,
    8000
  );
  check("copying lands the skill in the storage root and switches there", existsSync(`${SKILLS}/${first}/SKILL.md`));
  await evalJs(`document.querySelector('[data-skill="${first}"]').parentElement.querySelector("[data-skill-remove]").click(); true`);
  await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
  await evalJs(`document.querySelector("#confirmOk").click(); true`);
  await waitFor(`!document.querySelector('[data-skill="${first}"]')`, 8000);
  check("deleting the copy removes only the copy", !existsSync(`${SKILLS}/${first}`));
}
await evalJs(`document.querySelector("#closeSettings")?.click(); true`);
close();
