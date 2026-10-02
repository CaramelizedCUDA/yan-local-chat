"use strict";
// 言 · Codex 订阅：借 Codex CLI 已登录的 ChatGPT 账号（$CODEX_HOME/auth.json，默认 ~/.codex）走它的后端。
// 与 Anthropic 适配一个路数：页面照旧送 OpenAI 格式，这里把请求换成 Responses API 的，事件流再换回 chat.completions 的分块。
// 凭证只在桥接里读，不进页面；快过期了就用 refresh_token 换新并写回 auth.json——刷新令牌换一次就作废旧的，不写回 Codex CLI 自己就登不上了
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CODEX_BASE = "https://chatgpt.com/backend-api/codex";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

function codexLike(profile) {
  return String(profile?.api || "").toLowerCase() === "codex";
}
function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}
function tokenExpiry(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString()).exp * 1000 || 0;
  } catch {
    return 0;
  }
}
// 同一时刻只换一次：几段对话同时开工时不能各拿旧刷新令牌去换（第二个会被拒，还可能把账号登出）
let refreshing = null;
async function credentials() {
  const file = path.join(codexHome(), "auth.json");
  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw Error(`没找到 Codex 的登录（${file}）：先在终端运行 codex login`);
  }
  const tokens = auth.tokens;
  if (!tokens?.access_token) throw Error("Codex 不是用 ChatGPT 账号登录的：运行 codex login 选 Sign in with ChatGPT");
  if (tokenExpiry(tokens.access_token) - Date.now() > 5 * 60 * 1000) return tokens;
  refreshing ||= (async () => {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        scope: "openid profile email"
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error(`Codex 登录已失效（${response.status}）：在终端重新运行 codex login`);
    const fresh = await response.json();
    auth.tokens = {
      ...tokens,
      ...Object.fromEntries(["id_token", "access_token", "refresh_token"].filter(k => fresh[k]).map(k => [k, fresh[k]]))
    };
    auth.last_refresh = new Date().toISOString();
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(auth, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    return auth.tokens;
  })().finally(() => (refreshing = null));
  return refreshing;
}
async function codexHeaders() {
  const tokens = await credentials();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokens.access_token}`,
    ...(tokens.account_id ? { "chatgpt-account-id": tokens.account_id } : {}),
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs"
  };
}
function codexEndpoint(baseUrl) {
  return `${String(baseUrl || CODEX_BASE)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/responses$/i, "")}/responses`;
}
// 模型列表：Codex CLI 自己缓存的那份（models_cache.json），只列它在菜单里露出来的
function codexModels() {
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(codexHome(), "models_cache.json"), "utf8"));
    return (cache.models || []).filter(m => m.visibility !== "hide").map(m => m.slug);
  } catch {
    return [];
  }
}
function inputParts(content) {
  if (typeof content === "string") return content ? [{ type: "input_text", text: content }] : [];
  const parts = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === "text" && part.text) parts.push({ type: "input_text", text: String(part.text) });
    else if (part?.type === "image_url" && part.image_url?.url) parts.push({ type: "input_image", image_url: part.image_url.url });
    else if (part?.type === "file") {
      const name = String(part.file?.filename || "");
      if (/\.pdf$/i.test(name) && part.file?.file_data)
        parts.push({ type: "input_file", filename: name, file_data: `data:application/pdf;base64,${part.file.file_data}` });
      else parts.push({ type: "input_text", text: `[附件 ${name || "文件"}：此接口不接受该格式的原件]` });
    }
  }
  return parts;
}
// OpenAI chat 请求体 → Responses 请求体：system 并进 instructions，工具调用与结果成对换成 function_call / function_call_output。
// 订阅后端不收 temperature、max_output_tokens，一并不传；store 必须是 false
function codexRequest(payload) {
  const system = [],
    input = [];
  for (const message of payload.messages || []) {
    if (message.role === "system")
      system.push(
        typeof message.content === "string"
          ? message.content
          : inputParts(message.content)
              .map(p => p.text || "")
              .join("\n")
      );
    else if (message.role === "user") {
      const content = inputParts(message.content);
      if (content.length) input.push({ type: "message", role: "user", content });
    } else if (message.role === "assistant") {
      const text = typeof message.content === "string" ? message.content : "";
      if (text.trim()) input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      for (const call of message.tool_calls || [])
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function?.name || "",
          arguments: call.function?.arguments || "{}"
        });
    } else if (message.role === "tool")
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: String(message.content ?? "") });
  }
  const effort = String(payload.reasoning_effort || "").toLowerCase();
  const body = {
    model: payload.model,
    instructions: system.join("\n\n") || "You are a helpful assistant.",
    input,
    reasoning: { summary: "auto", ...(effort && effort !== "none" ? { effort } : {}) },
    store: false,
    stream: true
  };
  if (Array.isArray(payload.tools) && payload.tools.length) {
    body.tools = payload.tools.map(tool => ({
      type: "function",
      name: tool.function?.name || "",
      description: tool.function?.description || "",
      parameters: tool.function?.parameters || { type: "object", properties: {} },
      strict: false
    }));
    body.tool_choice = "auto";
    body.parallel_tool_calls = true;
  }
  return body;
}
// Responses 事件流 → OpenAI 风格的 SSE 分块：正文、思考摘要、函数调用（按出现顺序编号）、收尾的用量与结束原因
function codexToOpenAiStream(model = "") {
  const decoder = new TextDecoder(),
    encoder = new TextEncoder(),
    id = `chatcmpl-${Date.now().toString(36)}`;
  let buffer = "",
    stopped = false,
    summaries = 0;
  const calls = new Map();
  const chunk = (delta, extra = {}, finish = null) =>
    encoder.encode(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`
    );
  const fail = (controller, message) => {
    stopped = true;
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ error: { message: `接口在作答途中出错：${message || "未知错误"}` } })}\n\n`)
    );
  };
  const handle = (controller, data) => {
    const type = data.type,
      item = data.item;
    if (type === "response.output_text.delta" && data.delta) controller.enqueue(chunk({ content: data.delta }));
    else if (type === "response.reasoning_summary_part.added" && summaries++) controller.enqueue(chunk({ reasoning_content: "\n\n" }));
    else if (type === "response.reasoning_summary_text.delta" && data.delta) controller.enqueue(chunk({ reasoning_content: data.delta }));
    else if (type === "response.output_item.added" && item?.type === "function_call") {
      const call = { slot: calls.size, streamed: false };
      calls.set(item.id, call);
      controller.enqueue(
        chunk({ tool_calls: [{ index: call.slot, id: item.call_id, type: "function", function: { name: item.name, arguments: "" } }] })
      );
    } else if (type === "response.function_call_arguments.delta" && calls.has(data.item_id) && data.delta) {
      calls.get(data.item_id).streamed = true;
      controller.enqueue(chunk({ tool_calls: [{ index: calls.get(data.item_id).slot, function: { arguments: data.delta } }] }));
    } else if (type === "response.output_item.done" && item?.type === "function_call" && calls.has(item.id) && !calls.get(item.id).streamed)
      controller.enqueue(chunk({ tool_calls: [{ index: calls.get(item.id).slot, function: { arguments: item.arguments || "{}" } }] }));
    else if (type === "response.completed" || type === "response.incomplete") {
      const u = data.response?.usage || {},
        length = data.response?.incomplete_details?.reason === "max_output_tokens";
      const usage = {
        prompt_tokens: Number(u.input_tokens) || 0,
        completion_tokens: Number(u.output_tokens) || 0,
        total_tokens: Number(u.total_tokens) || 0,
        prompt_tokens_details: { cached_tokens: Number(u.input_tokens_details?.cached_tokens) || 0 }
      };
      controller.enqueue(chunk({}, { usage }, length ? "length" : calls.size ? "tool_calls" : "stop"));
      stopped = true;
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    } else if (type === "response.failed") fail(controller, data.response?.error?.message);
    else if (type === "error") fail(controller, data.message || data.error?.message);
  };
  const feed = (controller, text) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        handle(controller, JSON.parse(line.slice(5).trim()));
      } catch {}
    }
  };
  return new TransformStream({
    transform(bytes, controller) {
      if (!stopped) feed(controller, decoder.decode(bytes, { stream: true }));
    },
    // 没等到 response.completed 就断了：不补 [DONE]，页面按「连接中断」处理、可续写
    flush(controller) {
      if (!stopped) feed(controller, `${decoder.decode()}\n`);
    }
  });
}

module.exports = { CODEX_BASE, codexLike, codexHeaders, codexEndpoint, codexModels, codexRequest, codexToOpenAiStream };
