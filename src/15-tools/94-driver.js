// 言 · 工具 · SessionDriver：把「会话」收成统一的四动词 send/halt/status/readTrace，名册上的 Bot 按 driver 字段选实现。
// 现在只有 native（言自己的对话）；ACP 会话的驱动后续挂进同一张表。
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
const SessionDrivers = {
  native: {
    driver: "native",
    // 寄一封指令：走桥接的磁盘信箱（server/mail.js），投递即返回；目标所在页认领、写成用户消息、落盘回执、顺带叫醒
    async send(conversationId, payload, { from = "", taskId = "", correlationId = "", msgId = "" } = {}) {
      return storeBridge("/api/mail/post", { to: String(conversationId), payload: String(payload ?? ""), from, taskId, correlationId, msgId });
    },
    // 停一段会话：与用户点「止」同效——记下叫停，信箱来信只登记、不再自动开工，直到用户再发话
    async halt(conversationId) {
      const c = store.conversations.find(item => item.id === conversationId);
      if (c && !c.userHalted) {
        c.userHalted = true;
        markDirty(c.id);
      }
      haltConversation(conversationId);
      saveStore();
      renderHistory();
      renderSendButtons();
    },
    // 一眼看清：跑着、等人、闲着、被叫停，还是认不得这段
    status(conversationId) {
      const c = store.conversations.find(item => item.id === conversationId);
      if (!c) return { state: "unknown", driver: "native" };
      const job = requestJob(conversationId),
        approvals = [...pendingApprovals.values()].filter(item => item.conversationId === conversationId),
        last = (c.messages || []).at(-1);
      return {
        state: job || crewRunning(conversationId)
          ? "running"
          : approvals.length
            ? "waiting"
            : c.userHalted || last?.status === "stopped"
              ? "stopped"
              : "idle",
        waitingApproval: approvals.length > 0,
        waitingSince: approvals.length ? Math.min(...approvals.map(item => item.since || 0)) || null : null,
        holdingWriteLock: leaseHold.has(conversationId),
        driver: "native"
      };
    },
    // 行迹的尾巴：元数据加最近几条的摘录，给谁寄来的、跑到哪一步都看得见
    async readTrace(conversationId, { tail = 20, chars = 4000 } = {}) {
      const c = store.conversations.find(item => item.id === conversationId);
      if (!c) return { found: false, driver: "native" };
      const messages = (c.messages || []).slice(-Math.max(1, tail));
      return {
        found: true,
        id: c.id,
        title: c.title,
        driver: "native",
        updatedAt: c.updatedAt,
        messageCount: (c.messages || []).length,
        tail: messages.map(message => ({
          role: message.role,
          status: message.status || "",
          at: message.timestamp,
          mailId: message.mailId || undefined,
          text: String(message.content || "").slice(-chars)
        }))
      };
    }
  }
};
// 名册上一只 Bot 该用哪套驱动；没认得的先按原生来
function sessionDriver(bot) {
  return SessionDrivers[String(bot?.driver || "native")] || SessionDrivers.native;
}
