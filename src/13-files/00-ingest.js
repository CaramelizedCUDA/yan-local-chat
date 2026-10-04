// 言 · 文件 · 接入：选取、拖入、粘贴的文件读成附件；附件原件的下载
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 附件的几道上限：单件、单次合计、卷宗与附件原件合计、收入卷宗的单件；界面上的提示都从这里取数（见 limitLabel），改一处即可
const MB = 1024 * 1024;
const MAX_FILE_BYTES = 32 * MB;
const MAX_PENDING_BYTES = 64 * MB;
const MAX_ARCHIVE_FILE_BYTES = 256 * MB;
const limitLabel = bytes => (bytes >= 1024 * MB ? `${bytes / (1024 * MB)} GB` : `${Math.round(bytes / MB)} MB`);
const MAX_EXTRACTED_CHARS = 300000;
async function handleFiles(event) {
  await addFiles(event.target.files);
  event.target.value = "";
}
function isTextFile(file) {
  const extension = String(file.name || "")
      .split(".")
      .pop()
      .toLowerCase(),
    mime = String(file.type || "").toLowerCase();
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/x-javascript",
      "application/typescript",
      "application/yaml",
      "application/x-yaml",
      "application/csv"
    ].includes(mime) ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml") ||
    [
      "txt",
      "md",
      "markdown",
      "json",
      "jsonl",
      "csv",
      "tsv",
      "xml",
      "yaml",
      "yml",
      "js",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "jsx",
      "html",
      "htm",
      "css",
      "scss",
      "less",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "h",
      "cpp",
      "hpp",
      "cs",
      "php",
      "sh",
      "ps1",
      "sql",
      "toml",
      "ini",
      "log"
    ].includes(extension)
  );
}
async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (view === "library") return addLibraryFiles(files);
  // 一件件读的工夫里人可能已换到别的对话：读好的仍归点选时那一段（见 placeAttachment）
  const key = draftKey();
  let total = pendingAttachments.reduce((sum, file) => sum + Number(file.size || 0), 0),
    count = pendingAttachments.length,
    added = 0;
  for (const file of files) {
    if (count >= 10) {
      toast("一次最多置入 10 件附件");
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} 超过 ${limitLabel(MAX_FILE_BYTES)}，未置入`);
      continue;
    }
    if (total + file.size > MAX_PENDING_BYTES) {
      toast(`本次附件合计不超过 ${limitLabel(MAX_PENDING_BYTES)}`);
      break;
    }
    try {
      placeAttachment(key, await ingestFile(file));
      total += file.size;
      count += 1;
      added += 1;
    } catch {
      toast(`${file.name} 读取失败`);
    }
  }
  persistDraft();
  renderAttachments();
  if (added) toast(`已置入 ${added} 件附件`);
}
// 读好的一件放上案：案上（pendingAttachments）此刻若已换成别段的草稿，就记进原来那段的草稿里，回去时还在
function placeAttachment(key, file) {
  if (draftKey() === key) return void pendingAttachments.push(file);
  const draft = draftRecord(key);
  store.drafts ||= {};
  store.drafts[key] = { ...draft, attachments: [...draft.attachments, file], updatedAt: now() };
  saveStoreSoon();
}
async function ingestFile(file) {
  /** @type {Attachment["kind"]} */
  const kind = file.type.startsWith("image/") ? "image" : isTextFile(file) ? "text" : "file",
    id = uid();
  const data = await readFile(file, kind === "text" ? "text" : "data");
  const metadata = {
    id,
    kind,
    name: file.name || "未命名文件",
    mime: file.type || "application/octet-stream",
    size: file.size,
    modifiedAt: file.lastModified || Date.now()
  };
  let extractedText = "",
    extractionError = "";
  if (kind === "file")
    try {
      extractedText = await extractDocumentText(metadata.name, data);
    } catch (error) {
      extractionError = String(error.message || error).slice(0, 200);
    }
  await putAttachment({ ...metadata, data, extractedText, extractionError });
  // 顺手记下文字量的估算：上下文计数与「是否整份塞进提示」都按它算，不再拿文件字节数粗估（压缩过的 docx 字节数与字数没什么关系）
  const text = kind === "text" ? String(data || "") : extractedText;
  return { ...metadata, extracted: !!extractedText, ...(text ? { tokens: estimateText(text) } : {}) };
}

async function downloadAttachment(id) {
  try {
    const file = await getAttachment(id);
    if (!file) return toast("附件原件已找不到");
    const anchor = document.createElement("a");
    let objectUrl = "";
    if (file.kind === "text") {
      objectUrl = URL.createObjectURL(new Blob([file.data], { type: file.mime || "text/plain" }));
      anchor.href = objectUrl;
    } else anchor.href = file.data;
    anchor.download = file.name || "附件";
    anchor.click();
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    toast("附件读取失败");
  }
}
