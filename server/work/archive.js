// 言 · 桥接 · 卷宗目录的接口：列、收、取、删，清草稿
// 由 server/work/index.js 装配；接口随执事一并登记
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { sendJson, readJson, jsonRoute, errorText, sendFile } = require("../http.js");
const { SCRATCH_DIR, WORK_SKIP, resolveWorkdir, describeFsError, resolveInside, relPath, assertNoEscapingLink } = require("./paths.js");

module.exports = function createArchive({ archiveHome }) {
  const failed = error => errorText(error, 300);
  // ---- 卷宗目录：页面上的卷宗即这一目录的视图。列出全部文件与子目录（页面逐层看、查找时平铺），收入 / 取出 / 挪动 / 移出都限定在目录内 ----
  const ARCHIVE_LIST_LIMIT = 3000,
    ARCHIVE_FILE_LIMIT = 256 * 1024 * 1024;
  // 卷宗根：请求里带 root 就用它（须是完整限定的绝对路径，与工作目录同一套规矩），否则默认位置
  async function archiveRoot(raw) {
    const root = String(raw || "").trim() ? resolveWorkdir(raw) : archiveHome();
    const existing = await fs.promises.stat(root).catch(() => null);
    if (existing && !existing.isDirectory()) throw Error(`卷宗路径已被文件占用：${root}`);
    if (!existing)
      await fs.promises.mkdir(root, { recursive: true }).catch(error => {
        throw Error(describeFsError(error, root));
      });
    return root;
  }
  function archivePath(root, raw) {
    const rel = String(raw || "").trim();
    if (!rel) throw Error("请给出文件路径");
    return resolveInside(root, rel);
  }
  // 子目录也要列：空的夹同样是一层，页面上要能看见、能把文件拖进去
  async function walkArchive(root, dir, out, dirs) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= ARCHIVE_LIST_LIMIT) return;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (WORK_SKIP.has(entry.name)) continue;
        dirs.push({ path: relPath(root, full), name: entry.name });
        await walkArchive(root, full, out, dirs);
        continue;
      }
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat) continue;
      out.push({ path: relPath(root, full), name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  // 草稿占了多少：目录数与字节数，卷宗页上给用户一个数
  async function measureScratch(root) {
    const base = path.join(root, SCRATCH_DIR),
      dirs = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => []);
    let bytes = 0,
      files = 0;
    const walk = async dir => {
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isSymbolicLink() || files > 5000) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          files += 1;
          bytes += await fs.promises
            .stat(full)
            .then(s => s.size)
            .catch(() => 0);
        }
      }
    };
    await walk(base);
    return { count: dirs.filter(d => d.isDirectory()).length, files, bytes };
  }
  const handleArchiveList = jsonRoute(async body => {
    const root = await archiveRoot(body.root);
    const out = [],
      dirs = [];
    await walkArchive(root, root, out, dirs);
    out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return {
      archive: root,
      entries: out,
      dirs,
      truncated: out.length >= ARCHIVE_LIST_LIMIT,
      scratch: await measureScratch(root)
    };
  }, failed);
  // 清草稿：给了 id 只清那段对话的，否则整个 .草稿 目录
  const handleArchiveClean = jsonRoute(async body => {
    const root = await archiveRoot(body.root),
      id = String(body.id || "").replace(/[^A-Za-z0-9_-]/g, "");
    const target = id ? path.join(root, SCRATCH_DIR, id) : path.join(root, SCRATCH_DIR);
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 2 }).catch(error => {
      throw Error(describeFsError(error, SCRATCH_DIR));
    });
    return { cleaned: id || SCRATCH_DIR };
  }, failed);
  // 落在卷宗里的哪一层：dir 为空即根；给了就须在目录之内，不经链接出界
  async function archiveDirOf(root, raw) {
    const rel = String(raw || "").trim();
    if (!rel) return root;
    const dir = resolveInside(root, rel);
    await assertNoEscapingLink(root, dir);
    const stat = await fs.promises.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) throw Error(`卷宗里没有这一层：${rel}`);
    return dir;
  }
  // 同名文件不覆盖，另取「名 (2).扩展名」
  function freeName(dir, name) {
    const extension = path.extname(name),
      stem = name.slice(0, name.length - extension.length);
    let target = path.join(dir, name);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${stem} (${n})${extension}`);
    return target;
  }
  async function describeEntry(root, target) {
    const stat = await fs.promises.stat(target);
    return { path: relPath(root, target), name: path.basename(target), size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }
  // 收入：页面拖进来的文件以 data: URL 送来，落进页面此刻所在的那一层（dir）
  async function handleArchivePut(req, res) {
    try {
      const body = await readJson(req, 400 * 1024 * 1024),
        root = await archiveRoot(body.root),
        name = path.basename(String(body.name || "").trim()) || "未命名文件";
      const data = String(body.data || ""),
        comma = data.indexOf(",");
      if (!data.startsWith("data:") || comma < 0) throw Error("文件内容格式无效");
      const bytes = Buffer.from(data.slice(comma + 1), /;base64/i.test(data.slice(0, comma)) ? "base64" : "utf8");
      if (bytes.length > ARCHIVE_FILE_LIMIT) throw Error(`单个文件不超过 ${ARCHIVE_FILE_LIMIT / 1048576} MB`);
      const target = freeName(await archiveDirOf(root, body.dir), name);
      await fs.promises.writeFile(target, bytes).catch(error => {
        throw Error(describeFsError(error, name));
      });
      sendJson(res, 200, await describeEntry(root, target));
    } catch (error) {
      sendJson(res, 400, { error: failed(error) });
    }
  }
  // 取出：GET /api/archive/file?path=…（&root=… 指定卷宗根），页面用它做缩略图、置于案上与下载；?download=1 时让浏览器另存
  async function handleArchiveFile(req, res) {
    try {
      const query = new URL(req.url, "http://127.0.0.1").searchParams;
      const root = await archiveRoot(query.get("root")),
        file = archivePath(root, query.get("path"));
      await assertNoEscapingLink(root, file);
      await sendFile(req, res, file, { name: path.basename(file), download: !!query.get("download") });
    } catch (error) {
      sendJson(res, 404, { error: failed(error) });
    }
  }
  // 挪动：把一件文件挪进卷宗里的另一层（页面上把卡片拖到夹上、或拖回路径里的上一级）；那一层有同名的就另取名
  const handleArchiveMove = jsonRoute(async body => {
    const root = await archiveRoot(body.root),
      file = archivePath(root, body.path);
    await assertNoEscapingLink(root, file);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat?.isFile()) throw Error("文件不存在");
    const dir = await archiveDirOf(root, body.dir);
    if (path.dirname(file) === dir) return describeEntry(root, file);
    const target = freeName(dir, path.basename(file));
    await fs.promises.rename(file, target).catch(error => {
      throw Error(describeFsError(error, String(body.path)));
    });
    return describeEntry(root, target);
  }, failed);
  const handleArchiveRemove = jsonRoute(async body => {
    const root = await archiveRoot(body.root),
      file = archivePath(root, body.path);
    await assertNoEscapingLink(root, file);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat?.isFile()) throw Error("文件不存在");
    await fs.promises.unlink(file).catch(error => {
      throw Error(describeFsError(error, String(body.path)));
    });
    return { removed: relPath(root, file) };
  }, failed);
  return {
    "POST /api/archive/list": handleArchiveList,
    "POST /api/archive/put": handleArchivePut,
    "POST /api/archive/move": handleArchiveMove,
    "POST /api/archive/remove": handleArchiveRemove,
    "POST /api/archive/clean": handleArchiveClean,
    "GET /api/archive/file": handleArchiveFile
  };
};
