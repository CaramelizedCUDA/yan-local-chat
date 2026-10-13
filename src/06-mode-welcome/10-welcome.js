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
let bindSuggestions = () => {},
  suggestionsMode = "";
function renderSuggestions(work) {
  const mode = work ? "work" : "chat";
  if (mode === suggestionsMode) return;
  suggestionsMode = mode;
  $("#welcome .suggestions").innerHTML = SUGGESTIONS[mode]
    .map(([label, prompt]) => `<button class="suggestion" data-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`)
    .join("");
  bindSuggestions();
}
// 都是自拟：文白相杂，不借前人成句（成句一眼认得出，反倒像题词）；不必对仗，各按时辰。
// 只写景、留白，不劝人做什么：宜／可以／正好／且这类劝字一用就泄了气
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
    "鸟声隔窗，宿墨未干",
    "茶尚温，题未定",
    "清气满案，诸念未起",
    "朝暾初上，纸色微明"
  ],
  day: [
    "落笔，便有回声",
    "案上清宁，纸有余白",
    "晴光满窗，字字分明",
    "半窗日色，一案清言",
    "日在中天，笔影最短",
    "闲翻旧时书",
    "帘外风轻，砚边日暖",
    "白瓷盏中竹影摇"
  ],
  evening: [
    "灯下长谈，不觉夜深",
    "一灯如豆，纸墨相亲",
    "暮色入窗，墨色渐深",
    "炉上水初沸",
    "月上东墙，砚中有影",
    "墨染太极",
    "晚风叩窗，似有人来",
    "竹幽听雨落"
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
// 推荐语是给头一回来的人看言能做什么的：言是画在正文里的图、后台定时、读材料、生成文件；行是通读项目立意、帮手分头调研、
// 借浏览器办事、做个能演示的小作品。按钮名用书面的四字词；话写成人自己会说的，不点工具名。点开即选中头一处全角括号（留给人填），别处的引号用「」
const SUGGESTIONS = {
  chat: [
    ["概念讲解", "用通俗易懂的方式帮我讲讲（一个概念，比如复利、傅里叶变换、TCP 三次握手）。最好用可视化、可交互的方式辅助解释。"],
    [
      "定时监测",
      "帮我盯着（一件会变的事，比如某个商品的价格、某个开源项目的新版本、某个网页上的公告），每隔（一小时）看一眼。有动静戳我。"
    ],
    [
      "材料分析",
      "（附上表格、PDF 或一批文档）帮我看看这些材料：先用几句话说说讲了什么，再把关键数字整理成一张表、画成图，有前后对不上或可疑的地方指给我。"
    ],
    [
      "文件生成",
      "帮我做一份（要做的东西，比如季度汇报 PPT、带图表的 Excel 预算表、一页 PDF 简历）。先问我几个问题把内容和风格定下来，做好了我直接预览、下载。"
    ]
  ],
  work: [
    [
      "项目梳理",
      "我想把这个项目（往哪里推进，比如加上登录、换一套存储、把某个功能做完整）。先通读一遍，用几句话讲讲它现在的样子；再问我几个问题把目标定准，立一份意，把要做成的拆成几项能验证的结论。先别改代码，等我看过再动手。"
    ],
    [
      "深度调研",
      "帮我把（一个问题，比如某个领域的主流做法、几种技术方案该选哪个）研究透：派几个帮手分头去查，各自的结论收回来交叉比对，说法打架的地方标出来。最后在这个目录里写一份报告，先给结论，再列依据和出处。"
    ],
    [
      "网页操作",
      "用浏览器帮我（要在网页上办的事，比如在几家网站比价后整理成表、把这份清单逐条填进某个后台）。碰到要我判断的地方向我确认。"
    ],
    ["原型演示", "在这个目录里从零做一个（一个小作品，比如番茄钟、记账本、贪吃蛇），一个网页就行，做好映射到浏览器里，检查无误后向我汇报。"]
  ]
};
