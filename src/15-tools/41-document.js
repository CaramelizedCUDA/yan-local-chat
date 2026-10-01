// 言 · 翻阅文档：对话附件，以及（设置允许时）磁盘卷宗里的文本与 Office / PDF——后者用到时才取回并抽正文。
// 长文档按页码或关键词只取片段。说明里（{{docs}}）只列这段对话的附件：卷宗会越攒越多，整份目录写进说明，每一问都得背着；
// 卷宗里的按文件名或路径找，不知道有什么就 name 留空，列给它看。对话里有附件、或卷宗里有可读的文档时才给
defineTool({
  name: "read_document",
  group: "docs",
  label: "翻阅文档",
  offer: ctx => ctx.docs.length > 0,
  vars: ctx => {
    const attached = ctx.docs.filter(d => !d.archive).map(d => d.name);
    return { docs: attached.length ? `本段附件：${attached.join("、")}。` : "" };
  },
  lookup: true,
  parallel: true,
  cache: args => ({
    ...args,
    name: String(args.name || "")
      .trim()
      .toLowerCase(),
    query: args.query?.trim().toLowerCase()
  }),
  async run(step, args, { conversation }) {
    const docs = availableDocuments(conversation),
      wanted = String(args.name || "")
        .trim()
        .replace(/\\/g, "/")
        .toLowerCase();
    if (!wanted) return documentList(step, docs);
    const keys = d => [d.name.toLowerCase(), String(d.archive || "").toLowerCase()].filter(Boolean);
    const doc =
      docs.find(d => keys(d).includes(wanted)) ||
      docs.find(d => keys(d).some(key => key.includes(wanted))) ||
      (docs.length === 1 ? docs[0] : null);
    if (!doc) {
      const listed = documentList(step, docs);
      return { ok: false, content: `未找到文档「${args.name}」。${listed.content}`, display: "未找到" };
    }
    step.title = doc.name;
    let text = "";
    if (doc.archive) {
      try {
        text = await archiveDocumentText(doc);
      } catch (error) {
        return { ok: false, content: `卷宗文档读取失败：${String(error.message || error).slice(0, 120)}`, display: "读取失败" };
      }
    } else {
      const record = await getAttachment(doc.id);
      text = record ? (record.kind === "text" ? record.data : record.extractedText) || "" : "";
    }
    if (!text) return { ok: false, content: "该文档无可读取的文本", display: "无文本" };
    const pages = text.split(/^(?=第 \d+ 页$)/m),
      pageCount = pages.filter(p => /^第 \d+ 页$/m.test(p)).length;
    if (args.page) {
      const page = pages.find(p => p.startsWith(`第 ${args.page} 页`));
      if (!page) return { ok: false, content: `没有第 ${args.page} 页，共 ${pageCount || 1} 页`, display: "页码超出" };
      step.note = `第 ${args.page} 页`;
      return { ok: true, content: page.slice(0, 20000), display: `第 ${args.page} 页 · ${page.length} 字` };
    }
    if (args.query) {
      const needle = args.query.toLowerCase(),
        lower = text.toLowerCase(),
        hits = [];
      let index = lower.indexOf(needle);
      while (index >= 0 && hits.length < 8) {
        hits.push(text.slice(Math.max(0, index - 300), index + needle.length + 300).trim());
        index = lower.indexOf(needle, index + needle.length + 300);
      }
      step.note = `关键词「${args.query}」`;
      return hits.length
        ? { ok: true, content: hits.map((hit, i) => `片段 ${i + 1}：…${hit}…`).join("\n\n"), display: `${hits.length} 处匹配` }
        : { ok: true, content: `全文未出现「${args.query}」`, display: "无匹配" };
    }
    const limit = 12000;
    step.note = `${text.length} 字${pageCount ? ` · ${pageCount} 页` : ""}`;
    return {
      ok: true,
      content:
        text.length > limit
          ? `${text.slice(0, limit)}\n\n[文档共 ${text.length} 字${pageCount ? `、${pageCount} 页` : ""}，此处只给出开头；可用 page 或 query 参数读取其余部分]`
          : text,
      display: `${Math.min(text.length, limit)} 字`
    };
  }
});
// name 留空（或没找到）时列给模型：附件在前，卷宗里的按新近排，带路径与大小；太多只列最近的
const DOCUMENT_LIST_LIMIT = 60;
/** @param {Step} step */
function documentList(step, docs) {
  const attached = docs.filter(d => !d.archive),
    archived = docs.filter(d => d.archive).sort((a, b) => new Date(b.modifiedAt || 0).getTime() - new Date(a.modifiedAt || 0).getTime());
  step.title ||= "可读文档";
  const lines = [
    ...attached.map(d => `附件 ${d.name}`),
    ...archived.slice(0, DOCUMENT_LIST_LIMIT).map(d => `卷宗 ${d.archive}（${formatFileSize(d.size || 0)}）`)
  ];
  const more =
    archived.length > DOCUMENT_LIST_LIMIT ? `\n…卷宗里另有 ${archived.length - DOCUMENT_LIST_LIMIT} 件较早的，按文件名找即可` : "";
  return {
    ok: true,
    content: lines.length ? `可读文档（name 给文件名或卷宗路径）：\n${lines.join("\n")}${more}` : "没有可读的文档",
    display: `${docs.length} 件`
  };
}
const ARCHIVE_DOC_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp"]);
/** @param {Conversation} conversation */
function availableDocuments(conversation) {
  const seen = new Map();
  for (const file of (conversation?.messages || []).flatMap(m => m.attachments || []))
    if (file.id && !seen.has(file.name) && (file.kind === "text" || (file.kind === "file" && file.extracted))) seen.set(file.name, file);
  if (store.settings.archiveRead !== false)
    for (const entry of archiveEntries || []) {
      const extension = String(entry.name).split(".").pop().toLowerCase();
      if (seen.has(entry.name) || !(ARCHIVE_DOC_EXTENSIONS.has(extension) || isTextFile({ name: entry.name, type: "" }))) continue;
      seen.set(entry.name, { name: entry.name, archive: entry.path, size: entry.size, modifiedAt: entry.modifiedAt, kind: "archive" });
    }
  return [...seen.values()];
}
// 磁盘卷宗里的文档：取回原件，文本直接用，PDF / Office 在本机抽正文；按路径与修改时间缓存几份
const archiveDocCache = new Map();
async function archiveDocumentText(doc) {
  const key = `${doc.archive}|${doc.modifiedAt}`;
  if (archiveDocCache.has(key)) return archiveDocCache.get(key);
  const response = await fetch(archiveFileUrl(doc.archive), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("取回失败");
  const blob = await response.blob();
  const text = isTextFile({ name: doc.name, type: "" })
    ? await blob.text()
    : await extractDocumentText(doc.name, await readFile(blob, "data"));
  archiveDocCache.set(key, text);
  if (archiveDocCache.size > 12) archiveDocCache.delete(archiveDocCache.keys().next().value);
  return text;
}
