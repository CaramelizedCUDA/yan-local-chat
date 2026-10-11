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
  async run(step, args, ctx) {
    const { conversation, assistant, signal } = ctx,
      workdir = workRoot(conversation),
      at = conversation.messages.indexOf(assistant),
      user = (at < 0 ? conversation.messages : conversation.messages.slice(0, at)).findLast(m => m.role === "user"),
      ask = user ? quotedText(user) : "";
    const outcome = await changeIntent(conversation, signal, async intent => {
      const { ops, problems } = normalizeIntentOps(intent, args.nodes, workdir);
      if (problems.length) return { problems, ops };
      // 标成立的各项：先取一回依托文件此刻的指纹，作它的凭据
      const prints = await intentPrints(conversation, intentSealing(intent, ops), signal);
      return {
        problems,
        ops,
        next: applyIntentOps(intent, ops, { at: new Date().toISOString(), conversation: conversation.id, ask, prints })
      };
    });
    if (!outcome.next)
      return {
        ok: false,
        content: `意没有改：\n${outcome.problems.map(p => `- ${p}`).join("\n")}\n改正后这一批重给。`,
        display: "未改"
      };
    const next = outcome.next,
      now = await intentPrints(conversation, intentSealedFiles(next), signal),
      { live, standing } = intentTally(next, now);
    keepIntent(conversation, next, now);
    step.title = `立住 ${standing} / ${live} · ${outcome.ops.map(op => op.id).join("、")}`.slice(0, 80);
    return { ok: true, content: intentText(next, now, { path: INTENT_FILE }), display: `${standing}/${live}` };
  }
});
