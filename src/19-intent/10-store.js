// 言 · 意 · 读写与附着。每一答开工时读一回，连同已成立各项依托文件此刻的指纹，附在这一问之后——与账本同一个位置、同一个道理
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
/** 这几个文件此刻的指纹 @param {Conversation} conversation @param {string[]} paths @param {AbortSignal} [signal] @returns {Promise<IntentPrints>} */
async function intentPrints(conversation, paths, signal) {
  if (!paths.length) return {};
  const data = await bridge("/api/work/prints", { ...workScope(conversation), paths }, signal);
  return data.prints || {};
}
/** 这一答开工时读一回；读不到（没绑目录、桥接不在、文件坏了）就不附 @param {Conversation} conversation @param {AbortSignal} [signal] */
async function loadIntent(conversation, signal) {
  if (!isWork(conversation)) return void intents.delete(conversation.id);
  try {
    const { intent } = await readIntent(conversation, signal);
    intents.set(conversation.id, { intent, now: await intentPrints(conversation, intentSealedFiles(intent), signal) });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    intents.delete(conversation.id);
  }
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
  throw Error("意被别处接连改动，没写成，稍后再试");
}
