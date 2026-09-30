// 言 · 桥接各接口共用的几件：回 JSON、读 JSON、原子写盘，以及把「读请求体 → 办事 → 出错回 400」收成一处的 jsonRoute
// 纯工具，不持状态；server.js 与 server/ 下各模块直接 require
"use strict";
const fs = require("node:fs");

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}
function readJson(req, limit = 128 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        reject(Error("请求内容过大"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Error("请求 JSON 无效"));
      }
    });
    req.on("error", reject);
  });
}
// 出错时回给页面的那句话：取 message，截到 limit 字
function errorText(error, limit = 500) {
  return String(error?.message || error).slice(0, limit);
}
// 接口的常见形状：读请求体，办完回 200 与结果；中途抛错就回 400，那句话由 describe 定（各模块的前缀、截断长度不同）。
// handle(body, req, res) 返回的值即响应；自己写了响应（别的状态码、流）就返回 undefined
function jsonRoute(handle, describe = errorText) {
  return async (req, res) => {
    try {
      const data = await handle(await readJson(req), req, res);
      if (data !== undefined && !res.writableEnded && !res.destroyed) sendJson(res, 200, data);
    } catch (error) {
      if (!res.headersSent) sendJson(res, 400, { error: describe(error) });
      else res.end();
    }
  };
}
// 先写临时文件再改名：写到一半断电、进程被杀，正本也不会只剩半截
function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`;
  try {
    fs.writeFileSync(temp, data, typeof data === "string" ? "utf8" : undefined);
    // Windows 上目标文件被索引器或杀毒程序短暂打开时，替换可能报 EPERM / EBUSY。
    // 等几个很短的间隔再试同一份临时文件；永久错误仍原样交给调用方。
    const wait = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 0; ; attempt++)
      try {
        fs.renameSync(temp, file);
        break;
      } catch (error) {
        if (attempt >= 3 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
        Atomics.wait(wait, 0, 0, 15 * 2 ** attempt);
      }
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {}
    throw error;
  }
}

// 交给页面看的文件（卷宗、附件原件）：类型按扩展名定。网页、脚本一律当纯文本——文件是模型写的或随手拖进来的，
// 若以本站源头当网页打开，脚本便能读到页面的 localStorage；再加 CSP: sandbox 兜底。
// SVG 按图送（卷宗的缩略图、预览要画得出来）：放进 <img> 里脚本本就不跑，直接打开时 CSP: sandbox 也不许它跑
const FILE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  zip: "application/zip",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska"
};
function fileMime(name) {
  const extension = String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (["html", "htm", "xml", "js", "mjs", "cjs"].includes(extension)) return "text/plain; charset=utf-8";
  return FILE_MIME[extension] || "application/octet-stream";
}
// 送出一件文件：带 Range（音视频拖进度条只取那一段），?download 时让浏览器另存
async function sendFile(req, res, file, { name, download = false }) {
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) throw Error("文件不存在");
  const size = stat.size,
    range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  let start = 0,
    end = size - 1;
  if (range && size && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else start = Math.max(0, size - Number(range[2]));
    if (start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return res.end();
    }
  }
  const partial = start > 0 || end < size - 1;
  res.writeHead(partial ? 206 : 200, {
    "Content-Type": fileMime(name),
    "Content-Length": size ? end - start + 1 : 0,
    "Accept-Ranges": "bytes",
    ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    "Cache-Control": "no-cache",
    "Last-Modified": stat.mtime.toUTCString(),
    "Content-Security-Policy": "sandbox",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`
  });
  if (req.method === "HEAD" || !size) return res.end();
  fs.createReadStream(file, { start, end }).pipe(res);
}

module.exports = { sendJson, readJson, jsonRoute, errorText, writeAtomic, fileMime, sendFile };
