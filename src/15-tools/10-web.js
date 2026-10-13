// 言 · 联网：检索、翻网页、调接口，都经桥接。地址门禁在桥接那头：本机 127.0.0.1 可，别的内网地址不可
defineTool({
  name: "search_web",
  group: "web",
  label: "检索",
  lookup: true,
  parallel: true,
  cache: args => ({ ...args, query: args.query.trim().replace(/\s+/g, " ").toLowerCase() }),
  digest: step =>
    `检索「${String(step.title || "").slice(0, 60)}」→ ${
      (step.results || [])
        .slice(0, 3)
        .map(r => `${String(r.title || "").slice(0, 40)}（${r.url}）`)
        .join("；") ||
      step.result ||
      step.status
    }`,
  sources: step => (step.results || []).map(r => ({ url: r.url, title: r.title })),
  async run(step, args, { signal }) {
    step.title = args.query;
    const data = await bridge("/api/search", { query: args.query, count: 6 }, signal);
    step.results = data.results.map(({ title, url, snippet }) => ({ title, url, snippet }));
    return {
      ok: true,
      content: step.results.length ? JSON.stringify(step.results) : "未找到结果",
      display: `${step.results.length} 条结果`
    };
  }
});

defineTool({
  name: "fetch_page",
  group: "web",
  label: "翻阅网页",
  lookup: true,
  parallel: true,
  // 同一页的不同锚点是同一页
  cache: args => ({ ...args, url: URL.canParse(args.url) ? Object.assign(new URL(args.url), { hash: "" }).href : args.url.trim() }),
  digest: step =>
    `翻阅 ${String(step.title || step.url || "").slice(0, 60)}${step.url && step.title ? `（${step.url}）` : ""} → ${step.status === "done" ? "已读" : step.result || step.status}`,
  sources: step => [{ url: step.url, title: step.title, read: true }],
  async run(step, args, { signal }) {
    step.url = args.url;
    const data = await bridge("/api/fetch", { url: args.url }, signal);
    step.title = data.title || args.url;
    const notes = [
      data.total > data.text.length && `正文共 ${data.total} 字，此处只取了前 ${data.text.length} 字`,
      data.scripted && "抽出的正文寥寥：这页多半要跑脚本才出内容，所见并非全貌"
    ].filter(Boolean);
    return {
      ok: true,
      content: `标题：${data.title}\n地址：${data.url}\n\n${data.text}${notes.length ? `\n\n（${notes.join("；")}）` : ""}`,
      display: `${data.text.length} 字${data.total > data.text.length ? " · 截" : ""}`
    };
  }
});

// 调接口能发 POST，不算纯查阅，旁注不给。GET 也不复用：多是打本机的开发服务，改了代码再 GET 就该是新的
defineTool({
  name: "http_request",
  group: "web",
  label: "问接口",
  sideEffect: true,
  digest: step => `调接口 ${String(step.title || "").slice(0, 120)} → ${step.result || step.status}`,
  async run(step, args, { signal }) {
    const url = args.url.trim(),
      method = (args.method || "GET").trim().toUpperCase();
    step.url = url;
    step.title = `${method} ${url}`.slice(0, 200);
    const data = await bridge("/api/http", { url, method, headers: args.headers, body: args.body }, signal);
    const headers = Object.entries(data.headers)
      .map(([name, value]) => `${name}: ${String(value).slice(0, 300)}`)
      .join("\n");
    const body = data.textual ? data.text || "(空)" : `（${data.type || "二进制"}，${formatFileSize(data.bytes)}，不作为文本返回）`;
    step.output = trimOutput(`${data.status} ${data.statusText}\n${body}`);
    return {
      ok: data.status < 400,
      content: `HTTP ${data.status} ${data.statusText}${data.url !== url ? `（跳转到 ${data.url}）` : ""}\n--- 响应头 ---\n${headers}\n--- 正文${data.truncated ? "（已截断）" : ""} ---\n${body}`,
      display: `${data.status} · ${data.textual ? `${data.text.length} 字` : formatFileSize(data.bytes)}`
    };
  }
});
