// 内置提示词都在 prompts/ 目录里，这里只做取值与填空；{{名字}} 由 vars 填入，缺文件时报错并给空串，不让请求整个失败
const PROMPTS = window.YAN_PROMPTS || {};
function prompt(path, vars = {}) {
  const text = path.split(".").reduce((node, key) => node?.[key], PROMPTS);
  if (text == null) {
    console.error(`缺少内置提示词：${path}（prompts/ 目录未加载？）`);
    return "";
  }
  return fillTemplate(text, vars);
}
// 提示词的写法：字符串或按行拼的数组，{{名字}} 在运行时填入
function fillTemplate(text, vars = {}) {
  return (Array.isArray(text) ? text.join("\n") : String(text)).replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? "")).trim();
}
const APP_VERSION = "0.4.0"; // 与 package.json 同步；以桥接返回的为准
const FOLLOW_THRESHOLD = 80;
// 一次回答里最多几轮工具调用（帮手另计），超过后收回工具、请模型直接收尾；按轮计，同一轮并发的几次调用只算一轮。
// 默认值在这里，实际值在「设置 → 工具」里可改，留空（记作 0）即不限
const DEFAULT_TOOL_ROUNDS = 80,
  DEFAULT_SUB_ROUNDS = 40;
function roundLimit(key, fallback) {
  const raw = store?.settings?.[key];
  if (raw === 0) return Infinity;
  const value = Math.floor(Number(raw));
  return value >= 1 ? value : fallback;
}
const roundLimitText = limit => (Number.isFinite(limit) ? String(limit) : "");
const toolRoundLimit = () => roundLimit("toolRounds", DEFAULT_TOOL_ROUNDS),
  subRoundLimit = () => roundLimit("subRounds", DEFAULT_SUB_ROUNDS);
const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();
/** @type {string|null} 正在看的对话 */
let currentId = null;
let view = "chat";
let editingMessageId = null;
// 改问时去掉的附件（id）：保存后新问不带它们，旧版本里原样留着
let editingDropped = new Set();
let renamingId = null,
  renamingDirty = false,
  renderingHistory = false;
let historyQuery = "";
/** @type {Attachment[]} 案上待发的附件 */
let pendingAttachments = [];
// 欢迎页上为这段还没发出的新对话挑的模型；空即照预设带的、再照默认。发出后记在对话上，另起新对话时清空
let pendingProfileId = "";
/** @type {Quote|null} */
let pendingQuote = null;
// 这个页面的名号：总线认它回话（01-bridge.js），几个页面同开时租约认它是谁在作答（01-store/40-leases.js）
const PAGE_ID = uid();
let suppressViz = false;
let followBottom = true,
  autoScrolling = false;
const scrollPositions = new Map();
