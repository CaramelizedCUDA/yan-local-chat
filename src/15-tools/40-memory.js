// 言 · 录（记忆）与旧谈：五件都在浏览器里完成，不经桥接，也不需确认——每一步都在行迹里显示，条目在设置页可改可删。
// 记忆启用时才有；记与忘只给主模型，帮手与旁注只能翻
const CONVERSATION_MESSAGE_CHARS = 1500; // read_conversation 每条消息最多给这么多字
defineTool({
  name: "remember",
  group: "memory",
  label: "记入",
  offer: () => memoryEnabled(),
  mainOnly: true,
  sideEffect: true,
  run(step, args, { conversation }) {
    const items = store.memory.items,
      text = cleanMemoryText(args.text),
      category = cleanMemoryCategory(args.category);
    step.title = `${category}｜${text.length > 120 ? `${text.slice(0, 120)}…` : text}`;
    if (!text) return { ok: false, content: "text 不能为空", display: "内容为空" };
    // 过长不截：退回去让模型拆成几条或精简，免得记下半句
    if (text.length > MEMORY_TEXT_CHARS)
      return { ok: false, content: `这条有 ${text.length} 字，超过 ${MEMORY_TEXT_CHARS} 字；请拆成几条或精简后再记`, display: "过长" };
    const source = { conversationId: conversation.id, title: conversation.title };
    const existing = (args.replaces && items.find(item => item.id === args.replaces)) || items.find(item => item.text === text);
    if (existing) {
      Object.assign(existing, { text, category, updatedAt: now(), source });
      saveStore();
      refreshMemorySettings();
      return { ok: true, content: `已更新 ${memoryLine(existing, true)}`, display: "已更新" };
    }
    if (items.length >= MAX_MEMORY_ITEMS)
      return {
        ok: false,
        content: `记忆已有 ${MAX_MEMORY_ITEMS} 条，已满。请先用 recall 查看，用 forget 删去过时的，或用 replaces 把相近的合并成一条`,
        display: "记忆已满"
      };
    const item = addMemory(text, source, category);
    refreshMemorySettings();
    return { ok: true, content: `已记入 ${memoryLine(item, true)}`, display: "已记入" };
  }
});

defineTool({
  name: "forget",
  group: "memory",
  label: "忘却",
  offer: () => memoryEnabled(),
  mainOnly: true,
  sideEffect: true,
  run(step, args) {
    const items = store.memory.items,
      index = items.findIndex(item => item.id === args.id);
    step.title = index >= 0 ? items[index].text : args.id;
    if (index < 0) return { ok: false, content: "没有这条记忆，id 以 recall 的结果为准", display: "未找到" };
    items.splice(index, 1);
    saveStore();
    refreshMemorySettings();
    return { ok: true, content: "已删除", display: "已删除" };
  }
});

// 翻记忆分两步，如翻目录再翻页：不给参数只列各类（名、几条、最近一条的开头），给 category 才全文列出那一类；给 query 跨类按关键词找
defineTool({
  name: "recall",
  group: "memory",
  label: "翻记忆",
  offer: () => memoryEnabled(),
  lookup: true,
  parallel: true,
  sources: step => (step.results || []).map(hit => ({ memory: hit.memoryId, title: hit.title })),
  run(step, args) {
    const terms = keywordTerms(args.query),
      category = String(args.category || "").trim();
    if (!terms.length && !category) {
      const categories = memoryCategories();
      step.title = "分类一览";
      return {
        ok: true,
        content: categories.length
          ? categories
              .map(cat => `${cat.name}（${cat.items.length} 条，最近 ${cat.updatedAt.slice(0, 10)}）：${memoryGist(cat.items[0].text)}`)
              .join("\n")
          : "记忆里还没有条目",
        display: `${categories.length} 类`
      };
    }
    let hits = category ? store.memory.items.filter(item => memoryCategoryOf(item) === cleanMemoryCategory(category)) : store.memory.items;
    if (terms.length) hits = hits.filter(item => hitsAll(`${memoryCategoryOf(item)} ${item.text}`, terms));
    step.title = [category, args.query?.trim()].filter(Boolean).join("｜");
    step.results = hits.slice(0, 8).map(item => ({ title: item.text, memoryId: item.id }));
    return {
      ok: true,
      content: hits.length
        ? hits.map(item => memoryLine(item, !category)).join("\n")
        : category && !terms.length
          ? `没有「${category}」这一类`
          : "记忆里没有相关条目",
      display: `${hits.length} 条`
    };
  }
});

// 查旧谈：同一工作目录的执事对话排在前面，其余按新近
defineTool({
  name: "search_conversations",
  group: "memory",
  label: "查旧谈",
  offer: () => memoryEnabled(),
  lookup: true,
  parallel: true,
  sources: step => (step.results || []).map(hit => ({ talk: hit.conversationId, title: hit.title, date: hit.date })),
  run(step, args, { conversation }) {
    const terms = keywordTerms(args.query);
    step.title = args.query.trim();
    if (!terms.length) return { ok: false, content: "query 不能为空", display: "缺少关键词" };
    const limit = clampNumber(Number(args.limit), 8, 1, 20),
      sameRepo = c => isWork(conversation) && isWork(c) && c.workdir === conversation.workdir,
      hits = [];
    for (const c of [...store.conversations].sort(
      (a, b) => Number(sameRepo(b)) - Number(sameRepo(a)) || String(b.updatedAt).localeCompare(String(a.updatedAt))
    )) {
      if (c.id === conversation.id) continue;
      const lines = c.messages.filter(m => (m.role === "user" || m.role === "assistant") && m.content);
      if (!hitsAll(`${c.title}\n${lines.map(m => m.content).join("\n")}`, terms)) continue;
      const hit = lines.find(m => m.content.toLowerCase().includes(terms[0])),
        text = String(hit?.content || "").replace(/\s+/g, " ");
      const at = Math.max(0, text.toLowerCase().indexOf(terms[0]) - 40),
        snippet = text ? `${at ? "…" : ""}${text.slice(at, at + 120)}${at + 120 < text.length ? "…" : ""}` : "";
      hits.push({
        id: c.id,
        title: c.title,
        date: String(c.updatedAt || c.createdAt).slice(0, 10),
        count: lines.length,
        snippet,
        repo: isWork(c) ? (sameRepo(c) ? "同一目录" : `执事：${c.workdir}`) : ""
      });
      if (hits.length >= limit) break;
    }
    step.results = hits.map(hit => ({ title: hit.title, snippet: hit.snippet, conversationId: hit.id, date: hit.date }));
    return {
      ok: true,
      content: hits.length
        ? hits
            .map(
              hit =>
                `[${hit.id}] ${hit.date}「${hit.title}」共 ${hit.count} 条${hit.repo ? `（${hit.repo}）` : ""}${hit.snippet ? `\n  ${hit.snippet}` : ""}`
            )
            .join("\n")
        : "此前的对话里没有命中",
      display: `${hits.length} 段`
    };
  }
});

defineTool({
  name: "read_conversation",
  group: "memory",
  label: "翻旧谈",
  offer: () => memoryEnabled(),
  lookup: true,
  parallel: true,
  sources: step => (step.conversationId ? [{ talk: step.conversationId, title: step.title, date: step.date, read: true }] : []),
  run(step, args, { conversation }) {
    const c = store.conversations.find(item => item.id === args.id);
    step.title = c ? c.title : args.id;
    if (!c) return { ok: false, content: "没有这段对话，id 以 search_conversations 的结果为准", display: "未找到" };
    step.conversationId = c.id;
    step.date = c.updatedAt || c.createdAt;
    if (c.id === conversation.id) return { ok: false, content: "这是当前对话，无需读取", display: "当前对话" };
    const lines = c.messages.filter(m => (m.role === "user" || m.role === "assistant") && (m.content || m.attachments?.length));
    const offset = Math.max(1, Number(args.offset) || 1),
      limit = clampNumber(Number(args.limit), 40, 1, 100),
      slice = lines.slice(offset - 1, offset - 1 + limit);
    const body = slice
      .map((m, i) => {
        const text = String(m.content || "（附件）").trim();
        return `${offset + i}. 【${m.role === "user" ? "用户" : "助手"}】${text.length > CONVERSATION_MESSAGE_CHARS ? `${text.slice(0, CONVERSATION_MESSAGE_CHARS)}…` : text}`;
      })
      .join("\n\n");
    const end = offset - 1 + slice.length;
    return {
      ok: true,
      content: `「${c.title}」${String(c.createdAt).slice(0, 10)}${isWork(c) ? ` · 执事：${c.workdir}` : ""}，共 ${lines.length} 条，此为第 ${offset}–${end} 条${end < lines.length ? `；后面还有 ${lines.length - end} 条` : ""}\n\n${body || "（这段对话没有正文）"}`,
      display: `${slice.length} 条`
    };
  }
});
