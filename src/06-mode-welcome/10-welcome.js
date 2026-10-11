// 言 · 欢迎页：首次引导、提示词与问候
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function renderWelcome() {
  const work = workMode();
  $("#welcome .seal").textContent = work ? "行" : "言";
  $("#welcomeSub").textContent = work ? "以目录为案，言起而事行" : "长问慢答，尽付纸墨";
  renderChips(work);
  renderSuggestions(work);
  renderWelcomeNotice();
}
// 首次使用：还没有任何模型配置时，在输入框下给一行引导，而不是等到发送时才弹提示
function renderWelcomeNotice() {
  const el = $("#welcomeNotice");
  if (!el) return;
  const none = !profiles().length;
  el.classList.toggle("hidden", !none);
  if (!none) return;
  el.innerHTML = `<span class="seal" aria-hidden="true">始</span><span>尚未接入模型。OpenAI 兼容与 Anthropic 接口皆可，配置只存于本机、不经云端。</span><button type="button" data-open-models>前往设置 →</button>`;
  el.querySelector("[data-open-models]").onclick = () => openSettings("models");
}
let chatSuggestionsHtml = "",
  bindSuggestions = () => {},
  suggestionsMode = "chat";
function renderSuggestions(work) {
  const mode = work ? "work" : "chat";
  if (mode === suggestionsMode || !chatSuggestionsHtml) return;
  suggestionsMode = mode;
  $("#welcome .suggestions").innerHTML = work
    ? WORK_SUGGESTIONS.map(
        ([label, prompt]) => `<button class="suggestion" data-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`
      ).join("")
    : chatSuggestionsHtml;
  bindSuggestions();
}
// 都是自拟：文白相杂，不借前人成句（成句一眼认得出，反倒像题词）；不必对仗，各按时辰
const GREETINGS = {
  night: [
    "夜深墨浓",
    "长夜无声，一纸独明",
    "更漏迟迟，落字从容",
    "万家灯熄，此处尚明",
    "夜气清，一灯独醒",
    "星沉案角，砚水未寒",
    "夜阑不寐，与纸相对"
  ],
  morning: [
    "晨光入砚",
    "新墨初研",
    "晨露未晞，素纸已展",
    "窗明案净，正宜开篇",
    "茶尚温，题未定",
    "清气满案，诸念未起",
    "朝暾初上，纸色微明"
  ],
  day: [
    "落笔，便有回声",
    "案上清宁，纸有余白",
    "日影过窗，正好一叙",
    "半窗日色，一案清言",
    "竹影移阶，清昼方长",
    "午后人闲，宜读宜写",
    "帘外风轻，砚边日暖"
  ],
  evening: [
    "灯下长谈，不觉夜深",
    "一灯如豆，纸墨相亲",
    "暮色入窗，墨色渐深",
    "日暮灯明，余墨尚多",
    "一日将尽，尚有余话",
    "掌灯时分，可以慢谈",
    "晚风过案，且留一页"
  ]
};
const WORK_GREETINGS = [
  "言毕，即行",
  "墨未干，事已行",
  "纸上落言，案前成事",
  "意既明，手便随",
  "一言既定，诸事随之",
  "一事一毕，不留残笔",
  "议定即行，不尚空谈"
];
const greetingPick = Math.random();
function greeting() {
  if (workMode()) return WORK_GREETINGS[Math.floor(greetingPick * WORK_GREETINGS.length)];
  const h = new Date().getHours(),
    pool = GREETINGS[h < 6 ? "night" : h < 11 ? "morning" : h < 18 ? "day" : "evening"];
  return pool[Math.floor(greetingPick * pool.length)];
}
const WORK_SUGGESTIONS = [
  [
    "读懂这个项目",
    "先通读工作目录中的项目：用 list_files 与 read_file 了解结构与入口，然后用几段话说明它的用途、运行方式与值得留意之处。不要改动任何文件。"
  ],
  [
    "修一个问题",
    "在工作目录中定位并修复下面的问题：先用 search_files 找到相关代码，read_file 读懂上下文，再用 edit_file 做最小改动，最后运行相关测试或复现步骤验证：\n\n（问题描述）"
  ],
  [
    "加一个功能",
    "在工作目录中实现下面的功能：先看清现有结构与约定，用两三行说明方案，然后落实到文件并运行验证，不要改动无关代码：\n\n（功能描述）"
  ],
  ["写一段脚本并运行", "编写一个脚本完成下述事项，置于工作目录中；写好后运行一遍并给出输出，若有报错则修正至可运行：\n\n（要做的事）"]
];
