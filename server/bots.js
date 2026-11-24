// 言 · 桥接的名册：存储根里的 bots.json 记着每只 Bot 的定稿字段（规范 §4.1）——
//   id、name、role（chief/lead/worker/helper）、driver（目前只有 native）、instructions、
//   profileId（旧档的 profileHint 并进来）、activeConversationId、memoryRef、scope、identity、
//   writePolicy（readonly/serialized/worktree）、browserPolicy（none/foreground_exclusive）、
//   workRoot、capabilities、status（active/paused/retired）。
//   一只 Bot 的独立记忆在 memoryRef 指的文件里（默认 bots/<id>/memory.md），不能越出存储根。
// 由 server.js 装配：require("./server/bots.js")({ home: () => STORE.paths().root, route: STORE.scopedRoute })
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { sendJson, jsonRoute, errorText, writeAtomic, readJsonFile } = require("./http.js");
const { expandHome, pathIsInside } = require("./work/paths.js");

const FILE = "bots.json",
  ROLES = ["worker", "helper", "chief", "lead"],
  DRIVERS = ["native"],
  STATUSES = ["active", "paused", "retired"],
  WRITE_POLICIES = ["serialized", "readonly", "worktree"],
  BROWSER_POLICIES = ["none", "foreground_exclusive"];

/** @param {any} raw @returns {object} 定稿字段的一只 Bot；不合规的抛错，整份名册不落 */
function normalizeBot(raw) {
  if (!raw || typeof raw !== "object") throw Error("名册里有一项不是对象");
  const id = String(raw.id || "");
  if (!/^[\w-]{1,64}$/.test(id)) throw Error(`名册项缺少有效 id：${JSON.stringify(raw.id)}`);
  const role = String(raw.role || "worker"),
    driver = String(raw.driver || "native"),
    status = String(raw.status || "active"),
    writePolicy = String(raw.writePolicy || "serialized"),
    browserPolicy = String(raw.browserPolicy || "none");
  if (!ROLES.includes(role)) throw Error(`名册项 ${id} 的 role 不识别：${role}`);
  if (!DRIVERS.includes(driver)) throw Error(`名册项 ${id} 的 driver 不识别：${driver}`);
  if (!STATUSES.includes(status)) throw Error(`名册项 ${id} 的 status 不识别：${status}`);
  if (!WRITE_POLICIES.includes(writePolicy)) throw Error(`名册项 ${id} 的 writePolicy 不识别：${writePolicy}`);
  if (!BROWSER_POLICIES.includes(browserPolicy)) throw Error(`名册项 ${id} 的 browserPolicy 不识别：${browserPolicy}`);
  const scope = raw.scope && typeof raw.scope === "object" ? raw.scope : {},
    identity = raw.identity && typeof raw.identity === "object" ? raw.identity : {};
  return {
    id,
    name: String(raw.name || "").trim() || id,
    driver,
    role,
    instructions: String(raw.instructions || ""),
    profileId: String(raw.profileId || raw.profileHint || ""),
    activeConversationId: String(raw.activeConversationId || ""),
    memoryRef: String(raw.memoryRef || `bots/${id}/memory.md`),
    scope: {
      groups: (Array.isArray(scope.groups) ? scope.groups : []).map(String).filter(Boolean),
      botIds: (Array.isArray(scope.botIds) ? scope.botIds : []).map(String).filter(Boolean)
    },
    identity: {
      gitName: String(identity.gitName || ""),
      gitEmail: String(identity.gitEmail || "")
    },
    writePolicy,
    browserPolicy,
    workRoot: String(raw.workRoot || ""),
    capabilities: (Array.isArray(raw.capabilities) ? raw.capabilities : []).map(String).filter(Boolean),
    status
  };
}

/** @param {{ home: () => string, route?: typeof jsonRoute }} options */
module.exports = function createBots({ home, route = jsonRoute }) {
  const file = () => path.join(home(), FILE);
  // 读出时只做轻滤（缺页的手改文件先让用户看得到），写回时才逐只校验
  function load() {
    const saved = readJsonFile(file());
    return { bots: (Array.isArray(saved?.bots) ? saved.bots : []).filter(item => item && typeof item === "object"), updatedAt: Number(saved?.updatedAt) || 0 };
  }
  const handleLoad = route(() => load(), error => `名册读不出来：${errorText(error, 200)}`);
  const handleSave = route(async (body, req, res) => {
    if (!Array.isArray(body.bots)) throw Error("缺少名册内容");
    const current = load();
    // 页面带着它上次对齐时的时间戳（base）来写：磁盘上已有别处写过的更新的一份，就不写，把那份交回去
    if (body.base !== undefined && current.updatedAt > (Number(body.base) || 0))
      return sendJson(res, 409, { error: "名册已在别处更新", ...current });
    const bots = body.bots.map(normalizeBot);
    if (new Set(bots.map(bot => bot.id)).size !== bots.length) throw Error("名册里有重复的 id");
    const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
    fs.mkdirSync(home(), { recursive: true });
    writeAtomic(file(), JSON.stringify({ 言: "名册", version: 1, bots, updatedAt }, null, 1));
    return { updatedAt };
  }, error => `名册未能落盘：${errorText(error, 200)}`);
  // 一只 Bot 的独立记忆：照名册上记的 memoryRef 找，越出存储根的不给读
  const handleMemory = route(body => {
    const id = String(body.id || "");
    if (!/^[\w-]{1,64}$/.test(id)) throw Error("编号无效");
    const bot = load().bots.find(item => item.id === id),
      ref = String(bot?.memoryRef || `bots/${id}/memory.md`),
      root = path.resolve(home()),
      target = path.resolve(root, expandHome(ref));
    if (!pathIsInside(root, target)) throw Error("记忆路径越出存储根");
    if (!fs.existsSync(target)) return { id, ref, content: null };
    return { id, ref, content: fs.readFileSync(target, "utf8"), updatedAt: Number(fs.statSync(target).mtimeMs) || 0 };
  }, error => `记忆读不出来：${errorText(error, 200)}`);
  return {
    load,
    routes: {
      "POST /api/bots/load": handleLoad,
      "POST /api/bots/save": handleSave,
      "POST /api/bots/memory": handleMemory
    }
  };
};
