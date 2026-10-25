// 言 · 审查：审而后行里，规则标疑的那一步交「专司」里另配的审查模型照用户的原话再判（学 Claude Code 的 auto 模式）。
// 没开审查、或档位不是审而后行，一切照旧（规则拦的回绝，没拦的照做）；审查出错也退回这样，最坏不比没开差。
// 标疑的几类：指令被宽的沙箱或审查规则拦下的；往外发、网址里带着一长串用户没给过的参数，或带着内容 POST 出去的；
// 写长期记忆、往技能目录里写的（会进往后每段对话的上下文）；调 MCP 服务的写操作（见 60-mcp.js）。
// 审查只看用户的原话、意里的目标与守、将要做的那一步；准了照做（指令带 reviewed 交桥接，规则那一道不再拦），
// 驳了原因作工具结果回给主模型、叫它换条路，不向用户请示。一答里连驳三回、或共驳二十回，叫它停手向用户说明
const REVIEW_STREAK = 3,
  REVIEW_TOTAL = 20;
// 一答（帮手各算各的）驳了几回：键是那一答的 id 加帮手的 scope
const reviewTally = new Map();

/** @param {Step} step @param {Record<string, any>} args @param {ToolContext} ctx @returns {Promise<ToolOutcome|null>} 驳了即交回这一步的结果 */
async function reviewHook(step, args, ctx) {
  if (!reviewOn(ctx.conversation)) return null;
  const why = await reviewFlag(step, args, ctx);
  return why ? reviewGate(step, args, ctx, why) : null;
}
/** @param {Conversation} conversation */
function reviewOn(conversation) {
  return commandPolicyOf(conversation) === "review" && dutyReady(store.settings.dutyReview);
}
/** 这一步该不该交审查：该的给一句缘由 @param {Step} step @param {Record<string, any>} args @param {ToolContext} ctx */
async function reviewFlag(step, args, ctx) {
  const { conversation, signal } = ctx;
  if (step.name === "run_command") {
    const { workdir, sandbox } = workScope(conversation);
    const screened = await bridge("/api/work/screen", { workdir, sandbox, permission: "review", command: String(args.command || "") }, signal).catch(
      () => null
    );
    return screened?.why ? String(screened.why).replace(/^(审查|沙箱)拒绝：/, "") : "";
  }
  if (["fetch_page", "http_request", "download_file"].includes(step.name)) return egressWhy(step.name, args, conversation);
  if (step.name === "remember") return "写进长期记忆，往后每段对话都会带上";
  if (["write_file", "edit_file"].includes(step.name) && insideSkills(String(args.path || ""), conversation))
    return "往技能目录里写，往后的对话都会照着做";
  return "";
}
/** 往外发的：带着内容 POST 出去，或网址里有一长串用户没给过、也不是检索与网页交回的参数 */
function egressWhy(name, args, conversation) {
  const method = String(args.method || "GET").toUpperCase();
  if (name === "http_request" && !["GET", "HEAD"].includes(method) && args.body) return `带着内容向外发送（${method}）`;
  let url;
  try {
    url = new URL(String(args.url || ""));
  } catch {
    return "";
  }
  const said = conversation.messages
    .filter(m => m.role === "user")
    .map(m => String(m.content || ""))
    .join("\n");
  if (said.includes(url.href)) return "";
  const seen = conversation.messages.some(m => allSteps(m).some(s => s.results?.some(r => r.url === url.href) || (s.url === url.href && s.status === "done")));
  if (seen) return "";
  const long = [...url.searchParams.values(), url.hash.slice(1)].map(decodeURIComponentSafe).find(v => /[A-Za-z0-9_\-+/=.%]{32,}/.test(v) && !said.includes(v));
  return long ? "网址里带着一长串用户没给过的参数" : "";
}
function decodeURIComponentSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
/** 写的路径落在存储根的技能目录里没有（相对的按这段对话的目录接上） @param {string} raw @param {Conversation} conversation */
function insideSkills(raw, conversation) {
  const skills = String(bootstrap.store?.skills || "");
  if (!skills || !raw) return false;
  const norm = p => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(),
    full = /^([a-z]:)?[\\/]/i.test(raw) ? raw : `${workRoot(conversation) || ""}/${raw}`;
  return `${norm(full)}/`.startsWith(`${norm(skills)}/`);
}

/** 交审查模型判：准即返回 null 照做（step.reviewed 记下），驳即交回结果。出错退回没开审查时的样子 @param {Step} step @param {Record<string, any>} args @param {ToolContext} ctx @param {string} why */
async function reviewGate(step, args, ctx, why) {
  const key = `${ctx.assistant.id}|${step.scope || ""}`,
    tally = reviewTally.get(key) || { streak: 0, total: 0 };
  // 已叫它停手还在动手：不再请审查，照样驳
  if (tally.streak >= REVIEW_STREAK || tally.total >= REVIEW_TOTAL)
    return { ok: false, content: prompt("review.halt", { count: tally.total }), display: "审查未准" };
  let verdict;
  try {
    verdict = await askReviewer(step, args, ctx, why);
  } catch (error) {
    if (error.name === "AbortError" && ctx.signal.aborted) throw error;
    return null;
  }
  if (verdict.ok) {
    tally.streak = 0;
    reviewTally.set(key, tally);
    step.reviewed = { ok: true, why: verdict.why };
    return null;
  }
  tally.streak += 1;
  tally.total += 1;
  reviewTally.set(key, tally);
  if (reviewTally.size > 200) reviewTally.delete(reviewTally.keys().next().value);
  step.reviewed = { ok: false, why: verdict.why };
  const halt = tally.streak >= REVIEW_STREAK || tally.total >= REVIEW_TOTAL;
  return {
    ok: false,
    content: `${prompt("review.denied", { why: verdict.why || "没说理由" })}${halt ? `\n${prompt("review.halt", { count: tally.total })}` : ""}`,
    display: "审查未准"
  };
}
/** 两步判：先只要一个字；疑了再同一段话换个末句要理由（前头一字不差，走缓存） @returns {Promise<{ ok: boolean, why: string }>} */
async function askReviewer(step, args, ctx, why) {
  // 另配的那份拼成一份临时的模型配置：不记用量、不认思考档位
  /** @type {Profile} */
  const duty = { id: "duty-review", name: "", quota: "", usedTokens: 0, ...store.settings.dutyReview },
    base = reviewCase(step, args, ctx.conversation, why),
    ask = async (tail, maxTokens) => {
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(60000)]),
        response = await requestChat(duty, [{ role: "user", content: `${base}\n\n${tail}` }], signal, {
          systemPrompt: prompt("review.system"),
          maxTokens
        });
      if (!response.ok) throw Error(await describeResponseError(response));
      /** @type {Message} */
      const reply = { id: `review-${uid()}`, role: "assistant", content: "", timestamp: now() };
      if ((response.headers.get("content-type") || "").includes("text/event-stream")) await readSse(response, reply);
      else takeWholeReply(await response.json(), reply);
      return String(reply.content || "").trim();
    };
  if ((await ask(prompt("review.quick"), 1500)).startsWith("准")) return { ok: true, why: "" };
  const said = await ask(prompt("review.reason"), 3000),
    reason = said.replace(/^[准驳][\s：:，,。.]*/, "").slice(0, 120);
  return { ok: said.startsWith("准"), why: reason };
}
/** 交给审查的那段话：用户历次的原话（新的在后、过长截去旧的）、意里的目标与守、将要做的、规则的缘由 @param {Conversation} conversation */
function reviewCase(step, args, conversation, why) {
  const said = conversation.messages
      .filter(m => m.role === "user")
      .map(m => [String(m.content || "").trim(), ...(m.attachments || []).map(a => `［附件 ${a.name}］`)].filter(Boolean).join(" "))
      .filter(Boolean),
    lines = [];
  let room = 6000;
  for (let i = said.length - 1; i >= 0 && room > 0; i--) {
    const text = said[i].slice(0, room);
    lines.unshift(`${i + 1}. ${text}`);
    room -= text.length;
  }
  const held = intents.get(conversation.id)?.intent,
    goals = held ? intentRoots(held).map(id => held.nodes[id].claim) : [],
    keeps = held ? intentKeeps(held).map(id => held.nodes[id].claim) : [],
    intentText = [goals.length ? `目标：${goals.join("；")}` : "", keeps.length ? `守：${keeps.join("；")}` : ""].filter(Boolean).join("\n");
  return prompt("review.case", {
    user: lines.join("\n") || "（无）",
    intent: intentText ? prompt("review.intent", { text: intentText }) : "",
    action: `${step.name}\n${clipForModel(JSON.stringify(args, null, 1), 3000)}`,
    why
  });
}
