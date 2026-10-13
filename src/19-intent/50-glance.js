// 言 · 意 · 常显（见 设计稿/59 乙、60 一·甲）：意是整个目录的骨架，不随行迹跑掉——题下一行（目录之后）与书眉（滚过标题后，顶栏左侧）
// 各带一枚：石青「意」印、已立几项、一排记号（按态排：已立、假定在前，存疑、待复核、待定、在做，未做在后）；点开即卡片（见 40-card.js）。
// 按目录记最近见到的那份：每答开工读的、改完交回的都记进来；同一目录的几段对话看的是同一份。
// 刚打开、本页还没见过的目录现读一回（文件与目录现取指纹，探针不为看一眼去跑）
const INTENT_GLANCE_ORDER = ["holds", "assumed", "premised", "stale", "waiting", "doing", "open"],
  INTENT_GLANCE_MARKS = 24;
/** @type {Map<string, { intent: Intent, now: IntentPrints }>} 目录 → 最近见到的意 */
const intentGlances = new Map();
/** @type {Set<string>} 正在现读的目录 */
const intentGlancing = new Set();
/** @param {Conversation|null|undefined} conversation */
const glanceKey = conversation =>
  isWork(conversation)
    ? String(conversation.workdir)
        .replace(/[\\/]+$/, "")
        .toLowerCase()
    : "";
/** 记下一份并重画眼前这段的题下与书眉 @param {Conversation} conversation @param {Intent} intent @param {IntentPrints} now */
function noteIntentGlance(conversation, intent, now) {
  const key = glanceKey(conversation);
  if (!key) return;
  intentGlances.set(key, { intent, now });
  const current = currentConversation();
  if (current && glanceKey(current) === key) renderChatMeta(current);
}
/** @param {Conversation} conversation */
async function glanceIntent(conversation) {
  const key = glanceKey(conversation);
  if (!key || intentGlancing.has(key)) return;
  intentGlancing.add(key);
  try {
    const { intent } = await readIntent(conversation),
      now = await intentPrints(conversation, intentSealedAnchors(intent), undefined, "round");
    if (!intentGlances.has(key)) noteIntentGlance(conversation, intent, now);
  } catch {
    // 桥接不在、目录读不了：这回不显，下次画题下时再试
  } finally {
    intentGlancing.delete(key);
  }
}
/** 那一枚；还没见过这目录的意就去读，读回来再画 @param {Conversation|null|undefined} conversation @param {boolean} [short] 书眉里只写「2/10」 */
function intentGlanceHtml(conversation, short = false) {
  const key = glanceKey(conversation);
  if (!key) return "";
  const held = intentGlances.get(key);
  if (!held) return void glanceIntent(conversation), "";
  const { intent, now } = held,
    views = Object.keys(intent.nodes)
      .filter(id => !intentGone(intent, id))
      .map(id => intentView(intent, id, now))
      .sort((a, b) => INTENT_GLANCE_ORDER.indexOf(a) - INTENT_GLANCE_ORDER.indexOf(b));
  if (!views.length) return "";
  const { standing } = intentTally(intent, now),
    rest = views.length - INTENT_GLANCE_MARKS;
  return `<button type="button" class="intent-glance" data-intent-open title="意：进度 ${standing} / ${views.length}，点开看图"><span class="seal intent-seal" aria-hidden="true">意</span><span>${short ? `<b>${standing}</b>/${views.length}` : `进度 <b>${standing}</b> / ${views.length}`}</span><span class="intent-glance-run" aria-hidden="true">${views
    .slice(0, INTENT_GLANCE_MARKS)
    .map(view => intentMark(view))
    .join("")}${rest > 0 ? `<i>+${rest}</i>` : ""}</span></button>`;
}
