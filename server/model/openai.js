"use strict";
// 言 · OpenAI 兼容接口：页面说的本就是它的话，请求原样转发，只理三处——别家才要的思考块去掉、经中转用 Claude 时标上缓存、
// DashScope 兼容模式的思考档位换成它认的预算（登记的样子见 index.js 开头）
const { claudeModel, markOpenAiCache, stripCacheMarks } = require("./anthropic.js");

// DashScope（通义）兼容模式不认 reasoning_effort，认 enable_thinking + thinking_budget；档位没有可探的枚举，按通用四档列
const DASHSCOPE = /dashscope|aliyuncs/i;
const DASHSCOPE_BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 32768, xhigh: 65536, max: 81920 };

function endpoint(baseUrl) {
  const url = new URL(String(baseUrl || "").trim());
  if (!/^https?:$/.test(url.protocol)) throw Error("Base URL 只支持 http 或 https");
  return /\/chat\/completions\/?$/.test(url.pathname) ? url.href : `${url.href.replace(/\/$/, "")}/chat/completions`;
}
function modelsUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "")}/models`;
  return url;
}

// 没抽出文字的附件原件：PDF 照 OpenAI 的写法补上 data: 前缀；别的格式（压缩包、音视频、扫描件之外的二进制）兼容接口一概不收，
// 原样送去整问被拒，换成一句说明（与 anthropic.js、chatgpt.js 同一个办法）
function filePart(part) {
  if (part?.type !== "file") return part;
  const name = String(part.file?.filename || "");
  if (/\.pdf$/i.test(name) && part.file?.file_data)
    return { type: "file", file: { filename: name, file_data: `data:application/pdf;base64,${part.file.file_data}` } };
  return { type: "text", text: `[附件 ${name || "文件"}：此接口不接受该格式的原件]` };
}
module.exports = {
  url: config => endpoint(config.baseUrl),
  modelsUrl: config => modelsUrl(config.baseUrl),
  headers: config => ({
    "Content-Type": "application/json; charset=utf-8",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
  }),
  levels: config => (DASHSCOPE.test(config.baseUrl) ? ["low", "medium", "high", "max"] : null),
  request(payload, config) {
    const body = {
      ...payload,
      messages: payload.messages.map(m => {
        const next = m.thinking_blocks ? { ...m, thinking_blocks: undefined } : m;
        return Array.isArray(next.content) && next.content.some(part => part?.type === "file")
          ? { ...next, content: next.content.map(filePart) }
          : next;
      })
    };
    body.messages = claudeModel(config.model) ? markOpenAiCache(body.messages) : stripCacheMarks(body.messages);
    if (body.reasoning_effort && DASHSCOPE.test(config.baseUrl)) {
      body.enable_thinking = true;
      body.thinking_budget = DASHSCOPE_BUDGETS[body.reasoning_effort] || 8192;
      delete body.reasoning_effort;
    }
    return body;
  }
};
