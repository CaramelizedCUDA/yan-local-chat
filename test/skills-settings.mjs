// 设置 → 技能：只一处（存储根/技能），就地写一份；点行摊开看（不成框），「改」才成输入框、改名（目录跟着走）、删去
import { existsSync, readFileSync } from "node:fs";
import { connect, check, sleep, PAGE, HOME } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
const SKILLS = `${HOME}/技能`;
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector("#openSettings")`);
await sleep(400);
await evalJs(`document.querySelector("#openSettings").click(); document.querySelector('.tab-btn[data-tab="skills"]').click(); true`);
await waitFor(`!!document.querySelector("#settingsContent #addSkill")`);
check(
  "one list, no sources or toggles; the head shows the skills folder",
  await evalJs(
    `!document.querySelector("[data-skill-source]") && !document.querySelector(".plan-svg") && document.querySelector(".skill-head .skill-dir").textContent.endsWith("技能")`
  )
);

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
const row = name => `[...document.querySelectorAll(".skill-row")].find(r => r.querySelector(".skill-name").textContent === "${name}")`;
const view = name => `(document.querySelector("[data-skill-view] .skill-view-name")?.textContent === "${name}")`;
await waitFor(`!document.querySelector("[data-skill-editor]") && ${view("回信")}`, 8000);
check(
  "after saving it stays open to read, with no field to put a caret in",
  await evalJs(`!document.querySelector("[data-skill-view] input, [data-skill-view] textarea") && document.querySelector("[data-skill-view]").textContent.includes("逐条答")`)
);
await evalJs(`document.querySelector("[data-skill-collapse]").click(); true`);
await waitFor(`!document.querySelector("[data-skill-view]") && !!${row("回信")}`);
check("clicking the text folds it back to one line", true);
const made = existsSync(`${SKILLS}/回信/SKILL.md`) ? readFileSync(`${SKILLS}/回信/SKILL.md`, "utf8") : "";
check(
  "leaving the editor writes 技能/回信/SKILL.md with name, description and body",
  /name: "回信"/.test(made) && /description: "替人回信时：先谢来信，再答所问"/.test(made) && /二、逐条答。/.test(made),
  made
);

// 看：点那一行，正文现取摊开，只读；「改」才换成输入框。改名后目录跟着改
await evalJs(`${row("回信")}.click(); true`);
await waitFor(`${view("回信")} && document.querySelector("[data-skill-view]").textContent.includes("逐条答")`, 8000);
check("clicking a row opens it to read, not to edit", await evalJs(`!document.querySelector("[data-skill-editor]")`));
await evalJs(`document.querySelector("[data-skill-modify]").click(); true`);
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
await waitFor(`!document.querySelector("[data-skill-editor]") && ${view("复信")}`, 8000);
check("renaming moves the folder", existsSync(`${SKILLS}/复信/SKILL.md`) && !existsSync(`${SKILLS}/回信`));

// 保存请求还在路上时回到正文接着写，失焦也不能丢掉后改的这一版。
await evalJs(`document.querySelector("[data-skill-modify]").click(); true`);
await waitFor(`!!document.querySelector('[data-skill-field="body"]')`);
await fill("body", "保存的第一版");
await evalJs(`(() => {
  const original = window.fetch.bind(window);
  let release;
  const gate = new Promise(resolve => release = resolve);
  window.__skillSave = { calls:0, release, original };
  window.fetch = (...args) => {
    const save = String(args[0]).includes("/api/skills/save") || String(args[1]?.body || "").includes('"path":"/api/skills/save"');
    if (save && ++window.__skillSave.calls === 1) return gate.then(() => original(...args));
    return original(...args);
  };
  document.querySelector("[data-skill-done]").click();
})(); true`);
await waitFor(`window.__skillSave.calls === 1`);
await fill("body", "保存期间补充的第二版");
await evalJs(`document.activeElement.blur(); window.__skillSave.release(); true`);
await waitFor(`!document.querySelector("[data-skill-editor]") && window.__skillSave.calls === 2`, 8000);
check(
  "edits made while the save waits are saved next before the editor closes",
  readFileSync(`${SKILLS}/复信/SKILL.md`, "utf8").includes("保存期间补充的第二版")
);
await evalJs(`window.fetch = window.__skillSave.original; true`);

// 删去：看着的那份底下那枚「删」，先问，连同目录一并删
await waitFor(`${view("复信")}`);
await evalJs(`document.querySelector("[data-skill-view] [data-skill-remove]").click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
check("deleting asks first and names the folder", /复信/.test(await evalJs(`document.querySelector("#confirmModal").textContent`)));
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!${row("复信")} && !${view("复信")}`, 8000);
check("the skill folder is gone from disk", !existsSync(`${SKILLS}/复信`));

await evalJs(`document.querySelector("#closeSettings")?.click(); true`);
close();
