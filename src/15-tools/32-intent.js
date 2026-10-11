// 言 · 意：长活的结论图，存在目录里、跨对话沿用（见 src/19-intent/）。只给主模型：意由主答立、主答维护，帮手不改。
// 回给模型的是改完的整份意（与每一问附着的同一个写法）；行迹里只留一行，图本身属于任务，不在对话里画
defineTool({
  name: "update_intent",
  group: "work",
  label: "意",
  offer: ctx => ctx.work,
  mainOnly: true,
  sideEffect: true,
  digest: step => `意 → ${step.title || ""}`,
  // 凭据的写法出自登记表（见 19-intent/05-anchors.js）：加一种凭据，这里的说明随之多一样
  params: parameters => {
    const out = structuredClone(parameters),
      anchors = out.properties.nodes.items.properties.anchors;
    anchors.description = `${anchors.description}：${[...ANCHOR_KINDS.values()].map(kind => kind.hint).join("；")}`;
    return out;
  },
  async run(step, args, ctx) {
    const { conversation, assistant, signal } = ctx,
      workdir = workRoot(conversation),
      at = conversation.messages.indexOf(assistant),
      user = (at < 0 ? conversation.messages : conversation.messages.slice(0, at)).findLast(m => m.role === "user"),
      ask = user ? quotedText(user) : "";
    const outcome = await changeIntent(conversation, signal, async intent => {
      const { ops, problems } = normalizeIntentOps(intent, args.nodes, workdir);
      if (problems.length) return { problems, ops };
      // 标成立、标假定的各项：先取一回所挂凭据此刻的指纹记下
      const sealing = intentSealing(intent, ops),
        prints = await intentPrints(conversation, sealing, signal);
      return {
        problems,
        ops,
        prints,
        unread: sealing.filter(key => !(key in prints)),
        next: applyIntentOps(intent, ops, { at: new Date().toISOString(), conversation: conversation.id, ask, prints })
      };
    });
    if (!outcome.next)
      return {
        ok: false,
        content: `意没有改：\n${outcome.problems.map(p => `- ${p}`).join("\n")}\n改正后这一批重给。`,
        display: "未改"
      };
    // 此刻的指纹：便宜的几种现取；探针不再跑一遍——刚标的用刚取的，其余用这一答开工时取的
    const next = outcome.next,
      now = {
        ...(intents.get(conversation.id)?.now || {}),
        ...(await intentPrints(conversation, intentSealedAnchors(next), signal, "round")),
        ...outcome.prints
      },
      { live, standing } = intentTally(next, now),
      unread = outcome.unread.length
        ? `\n\n这几条凭据此刻取不到指纹，未记下，日后也不据它判：${outcome.unread.map(anchorLabel).join("、")}（问而后行里探针只自动跑明确只读的指令）`
        : "";
    keepIntent(conversation, next, now);
    step.title = `立住 ${standing} / ${live} · ${outcome.ops.map(op => op.id).join("、")}`.slice(0, 80);
    return { ok: true, content: `${intentText(next, now, { path: INTENT_FILE })}${unread}`, display: `${standing}/${live}` };
  }
});
