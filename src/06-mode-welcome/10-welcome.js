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
// 提示词各领一件言已有的本事：言是正文里的图与推演，行是意、帮手、游目。点开即选中头一处（…），留给人填
const SUGGESTIONS = {
  chat: [
    [
      "图解概念",
      "给我讲明白（一个概念）：先一句话说它是什么，再在正文里画一张示意，把各部分怎么连、怎么动画清楚，最后点出最容易误解的地方。"
    ],
    [
      "动手推演",
      "做一个能上手玩的小推演：（一个过程，如复利、排序算法、传染病扩散）\n\n画在正文里，参数可调、能播放暂停，旁边几句话提示我该看哪里、换个参数会怎样。"
    ],
    [
      "数据成图",
      "把下面的数据画成图，挑最能看出规律的画法；图后用两三句说出看到了什么，有异常值就指出来。\n\n（贴上数据或表格，也可附文件）"
    ],
    [
      "对比几样",
      "帮我比一比（要比的几样东西）：先查查新近的情况，列一张对比表，再画一张图看各自长短，最后按不同需要各给一个建议，附上出处。"
    ]
  ],
  work: [
    [
      "立意开工",
      "我想在这个目录里做成：（要做成的事）\n\n先别改文件。通读项目摸清现状，有要我定的用 ask_user 问；然后立一份意：根是这件事做成的样子，往下拆成几项要成立的结论，各写明怎么算成立、凭据是哪些文件或指令。立好后几句话讲讲路线与最没底的一项，等我点头再动手。"
    ],
    ["接着上回", "接着这个目录里上回的活：先看意与账本，几句话说清做到哪了、哪些转了待复核、下一步做什么，然后接着做。"],
    [
      "深查一事",
      "把这件事查透：（要查的问题）\n\n拆成几个互不相干的方向，各差一名帮手并行去查，要登录或靠脚本渲染的页面用游目的浏览器看。收回来交叉比对，说法相左的标出来。成稿存进目录：先结论，再分点列依据，每条附链接。"
    ],
    [
      "上手试一遍",
      "把这个项目跑起来，用游目的浏览器像用户那样用一遍：（要试的页面或流程）\n\n截图看排版，点主要的交互，留意控制台报错。问题先列出来，小的直接修，修完再试一遍对照。"
    ]
  ]
};
