// 作品感检查：首次使用引导、文档页（版本与致谢）、各栏题头、类替代内联样式
import { readFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`localStorage.clear(); true`);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Page.navigate", { url: PAGE });
await sleep(1200);
check(
  "fresh installs default to the light theme even when the system is dark",
  await evalJs(`document.documentElement.dataset.theme === "light" && window.__yanState().settings.theme === "light"`)
);
check(
  "first-run notice visible without profiles",
  await evalJs(
    `!document.querySelector("#welcomeNotice").classList.contains("hidden") && document.querySelector("#welcomeNotice").textContent.includes("尚未接入模型")`
  )
);
await evalJs(`document.querySelector("#welcomeNotice [data-open-models]").click(); true`);
check(
  "notice button opens model settings",
  await evalJs(
    `!document.querySelector("#settingsModal").classList.contains("hidden") && document.querySelector(".tab-btn.active").dataset.tab === "models"`
  )
);
// 「关于」已并进文档：目录题后是版本，末一篇是致谢
check("no about tab", await evalJs(`!document.querySelector('.tab-btn[data-tab="about"]')`));
const heads = await evalJs(
  `[...document.querySelectorAll(".tab-btn")].map(b => (b.click(), (h => [b.dataset.tab, !!h?.querySelector(".settings-mark"), h?.querySelector("h2")?.textContent || "", h?.querySelector(".settings-lead")?.textContent || ""])(document.querySelector("#settingsContent .settings-head"))))`
);
check(
  "every tab has a head with icon, title and lead",
  heads.length === 10 && heads.every(([, mark, title, lead]) => mark && title && lead),
  JSON.stringify(heads)
);
await evalJs(`document.querySelector('.tab-btn[data-tab="guide"]').click(); true`);
const guide = await evalJs(
  `(h => ({ version: h.querySelector(".settings-meta")?.textContent, last: [...h.querySelectorAll(".guide-row .guide-title")].pop()?.textContent }))(document.querySelector("#settingsContent"))`
);
check("guide head shows version, credits close the toc", guide.version === `v${VERSION}` && guide.last === "致谢", JSON.stringify(guide));
await evalJs(`document.querySelector('.guide-row[data-guide="credits"]').click(); true`);
check(
  "credits topic lists the vendored libraries",
  await evalJs(
    `["marked", "DOMPurify", "highlight.js", "KaTeX", "Mermaid", "Apache ECharts", "PDF.js"].every(n => document.querySelector("#guidePage").textContent.includes(n))`
  )
);
check(
  "nav foot has no version, no inline style",
  await evalJs(`!document.querySelector("#appVersion") && !document.querySelector(".settings-nav [style]")`)
);
await evalJs(
  `document.querySelector("#addProfile") || document.querySelector('.tab-btn[data-tab="models"]').click(); document.querySelector("#addProfile").click(); true`
);
await sleep(200);
check(
  "empty quota means unlimited, not invalid",
  await evalJs(
    `document.querySelector('[data-quota-amount]').getAttribute("aria-invalid") !== "true" && document.querySelector('[data-quota-amount]').placeholder === "不限"`
  )
);
check(
  "no inline styles in rendered settings except swatches",
  await evalJs(`[...document.querySelectorAll("#settingsContent [style]")].every(el => el.dataset.setting === "accent")`)
);
check(
  "history empty state uses class",
  await evalJs(
    `!!document.querySelector("#history .history-empty") && getComputedStyle(document.querySelector("#history .history-empty")).padding === "10px"`
  )
);
check(
  "profile add button full width",
  await evalJs(
    `Math.abs(document.querySelector("#addProfile").getBoundingClientRect().width - document.querySelector("#profileList").getBoundingClientRect().width) < 2`
  )
);
close();
