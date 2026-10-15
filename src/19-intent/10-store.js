// 言 · 意 · 读写与附着。每一答开工时读一回，连同已成立、已假定各项凭据此刻的指纹（取法见 05-anchors.js），附在这一问之后——与账本同一个位置、同一个道理
// （见 15-tools/21-files.js 的 ledgerNote）：附在问上而不进系统提示，意改了也不冲掉前面的缓存；这一答里再改，改完的那份由工具结果交回。
// 写只经桥接（/api/work/intent），带上读到的版本：别处刚写过就照新的那份重算再写
const INTENT_FILE = ".yan/意.json";
/** @type {Map<string, { intent: Intent, now: IntentPrints }>} 按对话：这一答开工时读到的意与指纹 */
const intents = new Map();
/** @param {Conversation} conversation @param {AbortSignal} [signal] */
async function readIntent(conversation, signal) {
  const data = await bridge("/api/work/intent", workScope(conversation), signal);
  return { intent: asIntent(data.data), version: String(data.version || "") };
}
/** 这几条凭据此刻的指纹；取不到就当这回不知道，不据它判 @param {Conversation} conversation @param {string[]} keys @param {AbortSignal} [signal] @param {"round"|"answer"} [cadence] */
async function intentPrints(conversation, keys, signal, cadence = "answer") {
  if (!keys.length) return {};
  try {
    return await anchorPrints(conversation, keys, signal, cadence);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return {};
  }
}
/** 这一答开工时读一回；读不到（没绑目录、桥接不在、文件坏了）就不附 @param {Conversation} conversation @param {AbortSignal} [signal] */
async function loadIntent(conversation, signal) {
  if (!isWork(conversation)) return void intents.delete(conversation.id);
  try {
    const { intent } = await readIntent(conversation, signal),
      now = await intentPrints(conversation, intentSealedAnchors(intent), signal);
    intents.set(conversation.id, { intent, now });
    noteIntentGlance(conversation, intent, now);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    intents.delete(conversation.id);
  }
}
/** 一答之内的回归簿记：上一回看到的待复核几项、各项被打回几回 @param {Conversation} conversation */
function intentWatch(conversation) {
  const held = intents.get(conversation.id);
  return { stale: new Set(held ? intentStaleIds(held.intent, held.now) : []), bounces: new Map(), gated: false };
}
/**
 * 一轮工具做完：重取便宜的那几种凭据（文件、目录；探针只在每答开工与标成立时跑）的指纹，新转待复核的写成一段接在这一轮的工具结果后
 * （见 runRounds 的 afterRound）。谁改的都算——这一轮的指令、后台的帮手、用户在别处手改；取不到指纹就这回不说
 * @param {Conversation} conversation @param {ReturnType<typeof intentWatch>} watch @param {AbortSignal} [signal]
 */
async function intentRound(conversation, watch, signal) {
  const held = intents.get(conversation.id),
    keys = held ? intentSealedAnchors(held.intent) : [];
  if (!held || !keys.length) return "";
  held.now = { ...held.now, ...(await intentPrints(conversation, keys, signal, "round")) };
  const stale = new Set(intentStaleIds(held.intent, held.now)),
    fresh = [...stale].filter(id => !watch.stale.has(id));
  watch.stale = stale;
  for (const id of fresh) watch.bounces.set(id, (watch.bounces.get(id) || 0) + 1);
  return intentRoundText(held.intent, held.now, fresh, watch.bounces);
}
// 收尾前对照：这一答动过意（改过它，或它所挂的凭据在这一答里变过），模型说完要收尾时拦一次——只一次，拦完即放。
// 摆出此刻的意（重读一回，探针也跑）、这一答里转待复核过的、改了而无凭据罩着的文件，请它对照各根的原话自己判：能收就收，未尽的接着做。
// 不替它验、不复验、不再拦：要不要派帮手核对由它定。递的话记作行迹里的一步，往后重装这一答照原处插回（replay）
const INTENT_UNOWNED_SHOWN = 8;
/** @param {Message} assistant 这一答改过的文件（帮手改的也算） */
function changedPaths(assistant) {
  return (assistant.steps || [])
    .flatMap(step => [step, ...(step.sub?.steps || [])])
    .filter(step => step.change && step.status === "done")
    .map(step => step.change.path);
}
/**
 * @param {Conversation} conversation @param {Message} assistant @param {ReturnType<typeof intentWatch>} watch @param {AbortSignal} [signal]
 * @returns {Promise<Record<string, any>|null>} 递给模型的那一条；null 即放它收尾
 */
async function intentGate(conversation, assistant, watch, signal) {
  if (watch.gated) return null;
  const touched = (assistant.steps || []).some(step => step.name === "update_intent" && step.status === "done") || watch.bounces.size > 0;
  if (!touched || !intents.has(conversation.id)) return null;
  watch.gated = true;
  // 别的对话这一答期间也可能改过：重读一回，以文件为准
  let intent = intents.get(conversation.id).intent;
  try {
    intent = (await readIntent(conversation, signal)).intent;
  } catch (error) {
    if (error.name === "AbortError") throw error;
  }
  if (!Object.keys(intent.nodes).length) return null;
  const now = await intentPrints(conversation, intentSealedAnchors(intent), signal);
  keepIntent(conversation, intent, now);
  const unowned = intentUnowned(intent, changedPaths(assistant)),
    report = [
      prompt("work.intentGate", { intent: intentText(intent, now, { path: INTENT_FILE, asks: true }) }),
      watch.bounces.size && prompt("work.intentGateBounced", { list: [...watch.bounces].map(([id, n]) => t`${id} ${n} 回`).join("、") }),
      unowned.length &&
        prompt("work.intentGateUnowned", {
          list: `${unowned.slice(0, INTENT_UNOWNED_SHOWN).join("、")}${unowned.length > INTENT_UNOWNED_SHOWN ? t` 等 ${unowned.length} 个` : ""}`
        }),
      prompt("work.intentGateAsk")
    ]
      .filter(Boolean)
      .join("\n\n"),
    { live, standing } = intentTally(intent, now);
  /** @type {Step} */
  const step = {
    id: `gate_${uid().slice(0, 8)}`,
    name: "intent_gate",
    arguments: "{}",
    status: "done",
    // 存中文原文，画出来时照语言换
    title: "收尾前对照意",
    result: `已立 ${standing} / ${live}`,
    at: String(assistant.content || "").length,
    rat: String(assistant.reasoning || "").length,
    report
  };
  (assistant.steps ||= []).push(step);
  refreshSteps(assistant);
  saveStoreSoon();
  return { role: "user", content: report };
}
/** 这一答里改过意：记下改完的那份，往后几轮据它比（作答途中压了前文要重装时，附的也是它）；题下与书眉跟着换 @param {Conversation} conversation @param {Intent} intent @param {IntentPrints} now */
function keepIntent(conversation, intent, now) {
  intents.set(conversation.id, { intent, now });
  noteIntentGlance(conversation, intent, now);
}
/** 附在这一问之后的一段；意里一项都没有就不附 @param {Conversation} conversation */
function intentNote(conversation) {
  const held = intents.get(conversation.id),
    text = held ? intentText(held.intent, held.now, { path: INTENT_FILE }) : "";
  return text ? `${text}\n\n` : "";
}
/**
 * 改意：读、算、写。版本对不上（别的对话、别的页面刚写过）就照新的那份重算再写
 * @template T
 * @param {Conversation} conversation
 * @param {AbortSignal} signal
 * @param {(intent: Intent) => Promise<{ next?: Intent } & T>} change 给出 next 即写；不给即不写，原样交回
 * @returns {Promise<{ next?: Intent } & T>}
 */
async function changeIntent(conversation, signal, change) {
  for (let tries = 0; tries < 5; tries++) {
    const { intent, version } = await readIntent(conversation, signal),
      result = await change(intent);
    if (!result.next) return result;
    const data = await bridge("/api/work/intent", { ...workScope(conversation), data: result.next, base: version }, signal);
    if (!data.conflict) return result;
  }
  throw Error(t("意被别处接连改动，没写成，稍后再试"));
}
