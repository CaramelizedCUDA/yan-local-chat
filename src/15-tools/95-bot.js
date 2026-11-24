// 言 · 点卯 · 主簿的差遣工具：fleet_* 只给名册里 role === "chief" 的位（00-registry.js 的 offer 与 runTool 双闸），
// 普通对谈、其它名册位与帮手都拿不到。名册真本在桥接（server/bots.js），页面按 04-bots.js 的镜像认人；
// 会话统一走 SessionDriver 四动词（94-driver.js）：native 走磁盘信箱与叫停。
// taskId + maxReassigns 防环：同一件差反复重派，记在主簿会话的 taskReassigns 账上，到第三回即转人工，不再递——
// 两个 Bot 不该靠来回写信踢皮球。普通进展回报（kind:"progress"）收信那边只登记不叫醒（见 94-driver.js 的 send）。

// 同一件差至多再派几回：超限转人工，由人定夺
const MAX_REASSIGNS = 3;

/** 名册里的一只 Bot：按 id 或名字认 @param {Record<string, any>} args */
function fleetBot(args) {
  const key = String(args.bot || "").trim();
  return allBots().find(bot => bot.id === key || bot.name === key) || null;
}
const fleetGone = key => ({
  ok: false,
  content: t`名册里没有「${key}」——先 fleet_list 点卯核对名字`,
  display: "名册无此人"
});
/** 这只 Bot 挂着的会话（没有会话或会话不在本页册里都如实说） @param {object} bot */
function fleetConversation(bot) {
  const id = String(bot?.activeConversationId || "");
  return id ? { id, c: store.conversations.find(item => item.id === id) || null } : { id: "", c: null };
}

defineTool({
  name: "fleet_list",
  group: "delegate",
  label: t("点卯"),
  chiefOnly: true,
  mainOnly: true,
  run: () => {
    const rows = allBots().map(bot => {
      const st = sessionDriver(bot).status(bot.activeConversationId),
        flags = [st.waitingApproval ? t("待你定夺") : "", st.holdingWriteLock ? t("持写锁") : "", st.state]
          .filter(Boolean)
          .join(" / ");
      return `${bot.id}｜${bot.name}｜${bot.role}｜写 ${bot.writePolicy}｜${flags}`;
    });
    return {
      ok: true,
      content: rows.length ? rows.join("\n") : "名册是空的——先 spawn_bot 立册",
      display: `${rows.length} 只`
    };
  }
});
defineTool({
  name: "fleet_read",
  group: "delegate",
  label: t("翻阅"),
  chiefOnly: true,
  mainOnly: true,
  run: async (step, args) => {
    const bot = fleetBot(args);
    if (!bot) return fleetGone(args.bot);
    const { id } = fleetConversation(bot);
    if (!id) return { ok: false, content: t`名册里的 ${bot.id} 还没挂会话`, display: "无会话" };
    const trace = await sessionDriver(bot).readTrace(id, {
      tail: Math.max(1, Math.min(50, Number(args.tail) || 20)),
      chars: Math.max(200, Math.min(8000, Number(args.chars) || 4000))
    });
    return { ok: !!trace.found, content: JSON.stringify(trace, null, 1), display: trace.found ? "行迹交回" : "会话认不得" };
  }
});
defineTool({
  name: "fleet_send",
  group: "delegate",
  label: t("传令"),
  chiefOnly: true,
  mainOnly: true,
  sideEffect: true,
  run: async (step, args, ctx) => {
    const bot = fleetBot(args);
    if (!bot) return fleetGone(args.bot);
    const { id } = fleetConversation(bot);
    if (!id) return { ok: false, content: t`名册里的 ${bot.id} 还没挂会话`, display: "无会话" };
    const message = String(args.message || "").trim();
    if (!message) return { ok: false, content: "要传的话是空的", display: "空令" };
    const taskId = String(args.taskId || "").trim();
    let reassignCount = 0;
    if (taskId) {
      // 防环账记在主簿自己的会话上：同一件差再派一回计一次，到限转人工——不递、也不许换名再发
      const book = (ctx.conversation.taskReassigns ||= {});
      reassignCount = Number(book[taskId]) || 0;
      if (reassignCount >= MAX_REASSIGNS) {
        notifyDesktop(ctx.conversation, t`差事「${taskId}」重派 ${reassignCount} 回未成，已转人工`);
        step.result = t("转人工");
        return {
          ok: false,
          content: t`差事「${taskId}」已重派 ${reassignCount} 回仍未成（上限 ${MAX_REASSIGNS}），这封信没有递出。请向用户回报由人定夺——换个 taskId 再派也算踢皮球。`,
          display: "转人工"
        };
      }
      book[taskId] = reassignCount + 1;
      markDirty(ctx.conversation.id);
    }
    const res = await sessionDriver(bot).send(id, message, {
      from: botOf(ctx.conversation)?.id || "",
      taskId,
      correlationId: String(args.correlationId || ""),
      kind: String(args.kind || ""),
      reassignCount
    });
    step.title = `${bot.name || bot.id} · ${message.split("\n").find(Boolean)?.slice(0, 60) || ""}`;
    return {
      ok: !!res?.posted,
      content: res?.posted ? t`已投递（${res.id}）` : res?.dup ? t`同一封信已在途中，不重复投递（${res.id}）` : t`投递失败：${JSON.stringify(res)}`,
      display: res?.posted ? "已递" : res?.dup ? "重复不递" : "递不出去"
    };
  }
});
defineTool({
  name: "fleet_stop",
  group: "delegate",
  label: t("叫停"),
  chiefOnly: true,
  mainOnly: true,
  sideEffect: true,
  run: async (step, args) => {
    const bot = fleetBot(args);
    if (!bot) return fleetGone(args.bot);
    const { id } = fleetConversation(bot);
    if (!id) return { ok: false, content: t`名册里的 ${bot.id} 还没挂会话`, display: "无会话" };
    const byUser = args.byUser === true;
    await sessionDriver(bot).halt(id, { byUser });
    step.title = bot.name || bot.id;
    return {
      ok: true,
      content: byUser ? t`已按用户亲手叫停记下 ${bot.id} 的会话：来信只登记，直到用户再发话` : t`已刹住 ${bot.id} 的会话（主簿之令，不打用户锁）`,
      display: "已叫停"
    };
  }
});
defineTool({
  name: "fleet_adopt",
  group: "delegate",
  label: t("接管"),
  chiefOnly: true,
  mainOnly: true,
  sideEffect: true,
  run: (step, args, ctx) => {
    const bot = fleetBot(args);
    if (!bot) return fleetGone(args.bot);
    const { c } = fleetConversation(bot);
    if (!c) return { ok: false, content: t`名册里的 ${bot.id} 还没挂会话，或会话不在本页册里`, display: "无会话" };
    const caller = botOf(ctx.conversation)?.id || "";
    c.adoptedBy = caller;
    markDirty(c.id);
    saveStore();
    step.title = bot.name || bot.id;
    return {
      ok: true,
      content: t`已接管 ${bot.id} 的会话${caller ? `（记 ${caller} 名下）` : ""}：此后它的来信只登记不开工，fleet_release 放还为止`,
      display: "已接管"
    };
  }
});
defineTool({
  name: "fleet_release",
  group: "delegate",
  label: t("放还"),
  chiefOnly: true,
  mainOnly: true,
  sideEffect: true,
  run: (step, args) => {
    const bot = fleetBot(args);
    if (!bot) return fleetGone(args.bot);
    const { c } = fleetConversation(bot);
    if (!c) return { ok: false, content: t`名册里的 ${bot.id} 还没挂会话，或会话不在本页册里`, display: "无会话" };
    const had = c.adoptedBy;
    delete c.adoptedBy;
    markDirty(c.id);
    saveStore();
    step.title = bot.name || bot.id;
    return {
      ok: true,
      content: had ? t`已放还 ${bot.id} 的会话（原记 ${had} 名下）：恢复自治，来信照常开工` : t`${bot.id} 的会话本就不在接管中`,
      display: "已放还"
    };
  }
});
defineTool({
  name: "spawn_bot",
  group: "delegate",
  label: t("立册"),
  chiefOnly: true,
  mainOnly: true,
  sideEffect: true,
  run: async (step, args, ctx) => {
    const id = String(args.id || "").trim() || `bot-${uid().slice(0, 8)}`;
    if (allBots().some(bot => bot.id === id)) return { ok: false, content: t`名册里已有「${id}」`, display: "重号" };
    // 给它一段会话：名册位与会话同落，spawn 完即可 fleet_send 传令
    const profile = profiles().find(item => item.id === String(args.profileId || "")) || profiles()[0],
      c = {
        id: uid(),
        title: String(args.name || id),
        forks: [],
        threads: [],
        createdAt: now(),
        updatedAt: now(),
        profileId: profile?.id || "",
        messages: [],
        workdir: String(args.workRoot || ""),
        presetId: "",
        groupId: "",
        commandPolicy: normalizeCommandPolicy(store.settings.commandPolicyDefault),
        reasoning: normalizeReasoning(profile?.reasoning)
      };
    store.conversations.unshift(c);
    markDirty(c.id);
    saveStore();
    const entry = {
      id,
      name: String(args.name || id),
      role: "worker",
      driver: "native",
      instructions: String(args.instructions || ""),
      profileId: c.profileId,
      activeConversationId: c.id,
      memoryRef: `bots/${id}/memory.md`,
      scope: { groups: [], botIds: [] },
      identity: { gitName: "", gitEmail: "" },
      writePolicy: String(args.writePolicy || "serialized"),
      browserPolicy: "none",
      workRoot: c.workdir,
      capabilities: [],
      status: "active"
    };
    await saveBots([...allBots(), entry], ctx.signal);
    step.title = entry.name;
    return { ok: true, content: t`已立册 ${id}（会话 ${c.id}）：worker / 写 ${entry.writePolicy} / 浏览器 none`, display: "已立册" };
  }
});
