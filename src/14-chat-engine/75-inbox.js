// 言 · 对话引擎 · 收信：外头寄来的信与到点的候，都先落在桥接的 存储根/信/待收/（见 server/mail.js），这里等着、认领，
// 照回报的路子寄给那段对话（mailReport）：正作答就递进这一答，没在作答就另起一答。页面关着时信在桥接那头攒着，开页即递；
// 几页同开，谁认领到谁递。那段对话别处正在答的先跳过、留给别处，桥接一分钟后空手回，那时再看一眼
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
async function listenLetters() {
  /** @type {string[]} */
  let skip = [];
  for (;;) {
    try {
      const { letters } = await bridge("/api/mail/wait", { skip });
      const mine = letters.filter(letter => !remoteBusy.has(letter.to));
      skip = letters.length ? letters.filter(letter => remoteBusy.has(letter.to)).map(letter => letter.id) : [];
      if (!mine.length) continue;
      const { letters: taken } = await bridge("/api/mail/take", { ids: mine.map(letter => letter.id) });
      for (const letter of taken) deliverLetter(letter);
    } catch {
      // 桥接断了一下（重启、睡眠醒来）：稍候再等
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
/** @param {{ kind: "letter"|"timer", to: string, at: number, from?: string, text?: string, timer?: any }} letter */
function deliverLetter(letter) {
  const conversation = store.conversations.find(c => c.id === letter.to);
  // 收信的对话已删了：信就此作罢
  if (!conversation) return;
  const profile = requestJob(conversation.id)?.profile || profiles().find(p => p.id === conversation.profileId) || activeProfile();
  if (letter.kind === "timer") {
    const timer = letter.timer,
      step = timerStepOf(conversation, timer.id);
    // 挂它的那一答已换下、或用户取消了：不叫
    if (!step || step.timer?.state === "stopped") return;
    if (timer.next) {
      step.timer.due = timer.next;
      markDirty(conversation.id);
      renderClepsydra();
    } else settleTimer(step, "done");
    // 迟了一分钟以上才说（桥接那时没开、电脑睡着）：差几秒是计时的常态
    const late = timer.late >= 60000 ? timer.late : 0;
    return mailReport(conversation, {
      report: prompt("work.timerDue", {
        id: timer.id,
        note: timer.note,
        due: clockText(timer.due),
        late: late ? prompt("work.timerLate", { late: spanText(late) }) : "",
        next: timer.next ? prompt("work.timerNext", { next: clockText(timer.next) }) : ""
      }),
      step,
      profile,
      relay: { step: step.id, title: timer.note, ok: true, kind: "timer", ...(late ? { late } : {}) }
    });
  }
  const text = String(letter.text || ""),
    from = String(letter.from || "");
  mailReport(conversation, {
    report: prompt("work.letter", { from: from || t("（未署来处）"), at: clockText(letter.at), text }),
    step: null,
    profile,
    relay: { step: "", title: from, ok: true, kind: "letter", gist: text.replace(/\s+/g, " ").trim().slice(0, 80) }
  });
}
