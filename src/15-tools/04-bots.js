// 言 · 名册：页面侧的 bots.json 镜像与按会话认 Bot——工具过滤（00-registry.js）与桥接写护栏（workScope 带 bot 编号）都据此查档位。
// 真本在桥接（server/bots.js）：这里只缓存。启动时重读一遍；fleet 工具写完名册、点卯面板开窗时都会再重读。
const botsCache = { bots: [], updatedAt: 0, loaded: false };
/** 重读名册；桥接不在线（纯阅读等）时保留旧值，只标 loaded */
async function syncBots(signal) {
  const data = await storeBridge("/api/bots/load", {}, signal).catch(() => null);
  if (data?.bots) {
    botsCache.bots = data.bots;
    botsCache.updatedAt = Number(data.updatedAt) || 0;
  }
  botsCache.loaded = true;
  return botsCache.bots;
}
function allBots() {
  return botsCache.bots;
}
/** 这段对话是谁的：名册里 activeConversationId 指到它的那只 Bot；普通对谈没有名册位 */
function botOf(conversation) {
  return botsCache.bots.find(bot => bot.activeConversationId === conversation?.id) || null;
}
/** 写名册：整份交回 normalizeBot 校验，带 base 时间戳防别处的写被盖掉；写完把缓存换新 */
async function saveBots(bots, signal) {
  const data = await storeBridge("/api/bots/save", { bots, base: botsCache.updatedAt }, signal);
  await syncBots(signal);
  return data;
}
// 名册写护栏的页面侧一层：toolDefinitions 先按档位不给（模型看不见），这里是它照名字硬调的兜底——
// 帮手与主模型共用 runTool，同一道闸。readonly：写文件的工具与写型指令都拦；chiefOnly 只认主簿。
/** @param {Tool} tool @param {Record<string, any>} args @param {Conversation} conversation */
function botToolBlock(tool, args, conversation) {
  const bot = botOf(conversation);
  if (!bot) return null;
  if (tool.chiefOnly && bot.role !== "chief") return t`名册里的 ${bot.id} 不是主簿（chief），用不了 ${tool.name}`;
  if (bot.browserPolicy === "none" && tool.usesBrowser) return t`名册里的 ${bot.id} 的 browserPolicy 是 none，不许动浏览器`;
  if (
    String(bot.writePolicy) === "readonly" &&
    (tool.writes || (tool.name === "run_command" && !isReadOnlyCommand(args.command)))
  )
    return t`名册里的 ${bot.id} 是只读档位，写文件与写型指令都拦下了`;
  return null;
}
