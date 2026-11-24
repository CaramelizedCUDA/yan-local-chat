// 言 · 对话引擎 · 信：帮手的回报、后台指令结束和定时到点的消息，寄给该醒的那一个——正作答就进它的收件口、在回合边界递上，
// 没在作答就另起一答，帮手睡着就叫醒它，主答断着就先记在对话上、续上时递。帮手与候共用 mailReport 寄送
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 帮手的回报（后台指令结束与定时到点也走这里）：这段对话正在作答（模型布置完还在干别的），就进那一答的收件口，
// 在回合边界递上，行迹里它到达的那一刻落一小步「回报」（与补言同样大小，递到打勾）；
// 没在作答（主答只剩等待时已收尾），同一刻到的几份攒成一问另起一答——回报作这一问，两答之间是一道细线（见 relayHtml），不是用户的话。
// relay 是那一项的画法（谁回来了），不给就按帮手画
/** @type {Map<string, Array<{ report: string, step: Step, profile: Profile|null, relay?: any }>>} */
const mailbags = new Map();
// 挂这一项的步骤还在眼前这一条路上吗（按 id 认：别处写过这段，store 里已换了对象，旧闭包仍指向同一步）
/** @param {Conversation} conversation @param {Step} [step] */
function stepInPath(conversation, step) {
  return !step || conversation.messages.some(message => allSteps(message).some(item => item.id === step.id));
}
/** @param {Conversation} conversation */
function mailReport(conversation, item) {
  // 对象会换：别处写过这段，catchUpConversation 把 store 里的换成了新对象，而帮手、后台指令的闭包还攥着旧的那一个。
  // 按 id 取当前的那一份；真删了（找不到）就照手里这份往下走，写下的没人再读，也就到头了
  const live = store.conversations.find(c => c.id === conversation.id);
  conversation = live || conversation;
  // 帮手开的后台指令，结束时叫醒的是帮手自己（见 mailHelper），不是主对话
  if (item.step?.scope) return void mailHelper(conversation, item.step.scope, item);
  // 挂它的那一步已不在眼前这一条路上（切了版本、重答把那一答换下）：结果是另一版的，不往这一版里送。
  // 这一段已不在 store 里（删了、目录正重读）时不比——没有「眼前这一条路」可比，照旧寄给手里这份
  if (live && !stepInPath(live, item.step)) return;
  const job = requestJob(conversation.id);
  if (job) return void deliverInline(conversation, job, item);
  const bag = mailbags.get(conversation.id);
  if (bag) return void bag.push(item);
  mailbags.set(conversation.id, [item]);
  setTimeout(() => {
    const items = mailbags.get(conversation.id) || [];
    mailbags.delete(conversation.id);
    wakeWithReports(conversation, items);
  }, 0);
}
/** @returns {Relay} */
function relayOf({ step, relay }) {
  return relay || { step: step.id, title: String(step.title || ""), ok: step.status === "done" };
}
// 回来的是谁：细线、行迹里的那一小步、导出都照它写。seal 是那一方印；gist 是名后淡墨的一句（候迟了多久）
/** @param {Relay} relay @returns {{ seal: string, name: string, gist: string }} */
function relayLabel(relay) {
  if (relay.kind === "timer")
    return { seal: t("候"), name: t`候「${relay.title}」到点`, gist: relay.late ? t`迟 ${spanText(relay.late)}` : "" };
  if (relay.kind === "bg")
    return { seal: t("候"), name: bgEndedText(relay) + (relay.ok || relay.lost ? "" : t` · 退出码 ${relay.exitCode ?? "?"}`), gist: "" };
  if (relay.kind === "mail") return { seal: t("信"), name: relay.title ? t`信「${relay.title}」` : t("来信"), gist: "" };
  return { seal: t("遣"), name: t`帮手「${relay.title}」${relay.ok ? t("回报") : t("未完成")}`, gist: "" };
}
// 收信的那一个（主答的消息，或帮手的 sub）在自己的时间线末落一小步「回报」，递上后打勾；回这一步
/** @param {{ content: string, reasoning?: string, steps?: Step[] }} owner @returns {Step} */
function postRelayNote(owner, item) {
  const relay = relayOf(item);
  /** @type {Step} */
  const note = {
    id: `relay_${uid().slice(0, 8)}`,
    name: "relay_note",
    arguments: "{}",
    status: "running",
    title: relay.title,
    relay,
    at: owner.content.length,
    rat: String(owner.reasoning || "").length
  };
  (owner.steps ||= []).push(note);
  return note;
}
// 作答途中到的：行迹里落一步「回报」，递上后打勾（deliverSupplements 按 note 打勾）；这一答没来得及递就收尾了，
// settleSupplements 撤下这一步再寄；按「止」时未递的帮手回报不再唤醒主答，后台与定时照常寄。
/** @param {Conversation} conversation */
function deliverInline(conversation, job, item) {
  const host = conversation.messages.find(message => message.id === job.assistantId);
  if (host) {
    item = { ...item, note: postRelayNote(host, item) };
    refreshSteps(host);
  }
  job.queue.push(item);
}
// 寄给帮手的（它自己开的后台指令结束了）：与寄给主答同一个样子——它自己的时间线里落一小步「回报」，信进它的收件口，
// 正做着就在回合边界递上，睡着就叫醒它。它已收工（做完、叫停、页面刷新过），信就不送了，那一步的签照旧改成已结束
/** @param {Conversation} conversation @param {string} scope 帮手的 sub.id */
function mailHelper(conversation, scope, item) {
  const box = (crews.get(conversation.id) || []).find(entry => entry.sub.id === scope);
  if (!box) return;
  box.queue.push({ ...item, note: postRelayNote(box.sub, item) });
  box.wake?.();
  refreshSteps(box.host);
}
// 睡到有信来（或等的后台都了结了）：不发请求、没有谁醒着；叫停、停止照样打断
function sleepUntilMail(box) {
  const signal = box.controller.signal;
  return new Promise((resolve, reject) => {
    const stop = () => {
      box.wake = null;
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    box.wake = () => {
      box.wake = null;
      signal.removeEventListener("abort", stop);
      resolve(null);
    };
  });
}
/** @param {Conversation} conversation */
async function wakeWithReports(conversation, items) {
  if (!items.length || !store.conversations.some(c => c.id === conversation.id)) return;
  // 几处页面同开：照发送的规矩先认领，别处正在这段里作答就等它松手（报到每几秒一回，见 syncLeases）再来。
  // 等过之后按 id 重找：别处写过的，这边读回来已换了一个对象。这段或相交的目录正退回的也等它退完（认领之后再看，等的工夫里可能点了退回）
  if (!requestJob(conversation.id) && (remoteBusy.has(conversation.id) || !(await claimTurn(conversation, { quiet: true }))))
    return void setTimeout(() => {
      const fresh = store.conversations.find(c => c.id === conversation.id);
      if (fresh) void wakeWithReports(fresh, items);
    }, 5000);
  // 认领的工夫里对象也可能被换过：往下都写当前这一份
  const live = store.conversations.find(c => c.id === conversation.id);
  if (!live) return;
  conversation = live;
  // 等认领时也能切版本：逐份重验来源，共用前文里挂的候仍照常递。
  items = items.filter(item => stepInPath(conversation, item.step));
  if (!items.length) return;
  // 攒着的这一会儿里有人开了一答（用户发了话、上一答收尾时补言另起了一问）：交给它
  const job = requestJob(conversation.id);
  if (job) return void items.forEach(item => deliverInline(conversation, job, item));
  const profile = profiles().find(p => p.id === items[0].profile?.id) || activeProfile(conversation),
    ready = profile && !quotaBlocked(profile);
  // 上一答断着（断网中断、报错）：另起一答会在断处底下留一截，续上那一答时它就成了残留，主线也从此分成两头。
  // 回报先记在这段对话上（见 takeHeldReports）；中断且模型可用时直接续写，报错或不可用时留给下次开工。
  const last = conversation.messages.at(-1);
  if (last?.role === "assistant" && (last.status === "interrupted" || last.status === "error")) {
    (conversation.heldReports ||= []).push(...items.map(item => ({ report: item.report, relay: relayOf(item) })));
    markDirty(conversation.id);
    saveStore();
    if (last.status === "interrupted" && ready) void resumeAnswer(conversation, last, profile);
    return;
  }
  /** @type {Message} */
  const user = {
    id: uid(),
    role: "user",
    content: items
      .map(item => item.report)
      .filter(Boolean)
      .join("\n\n"),
    timestamp: now(),
    relay: items.map(relayOf)
  };
  if (ready) return void startTurn(conversation, user, profile, { follow: false });
  // 没有可用的模型或余墨已尽：回报先记下，等用户换了模型再问
  conversation.messages.push(user);
  conversation.updatedAt = now();
  markDirty(conversation.id);
  saveStore();
  if (currentId === conversation.id && view === "chat") renderConversation();
  else renderHistory();
  toast(profile ? t("余墨已尽，帮手的回报先记下了") : t("没有可用的模型，帮手的回报先记下了"));
}
// 断着时记下的回报交给开工的这一答：行迹里落一步「回报」，随后当即递上。派它的那一步已不在眼前这条路上的（重答把那一答收成了版本）不递，
// 免得张冠李戴。返回交出去的几项，这一答一个字没等到就又断了，原样还回去
/** @param {Conversation} conversation @returns {Array<{ report: string, relay: any, note?: Step }>} */
function takeHeldReports(conversation, job) {
  const held = conversation.heldReports || [];
  delete conversation.heldReports;
  const onPath = new Set(conversation.messages.flatMap(message => (message.steps || []).map(step => step.id)));
  return held
    .filter(item => onPath.has(item.relay.step))
    .map(item => {
      deliverInline(conversation, job, item);
      return job.queue.at(-1);
    });
}
/** @param {Conversation} conversation @param {Message} host */
function returnHeldReports(conversation, host, taken, job) {
  if (!taken.length) return;
  // 若递送途中被止，这几份还在收件口；已还到暂存处的不能在收尾时再寄一遍。
  const restored = new Set(taken);
  job.queue = job.queue.filter(item => !restored.has(item));
  const notes = new Set(taken.map(item => item.note?.id));
  host.steps = (host.steps || []).filter(step => !notes.has(step.id));
  if (!host.steps.length) delete host.steps;
  conversation.heldReports = [...taken.map(({ report, relay }) => ({ report, relay })), ...(conversation.heldReports || [])];
}
// 续写一答时，它底下只有回报另起、又没写出东西就断了或停了的几答（断网时帮手回报的常见残留）：收回来，回报交给续上的这一答
/** @param {Conversation} conversation @param {Message} message */
function foldRelayTail(conversation, message) {
  const at = conversation.messages.indexOf(message),
    tail = conversation.messages.slice(at + 1),
    ids = new Set([message.id, ...tail.map(m => m.id)]);
  const empty = m =>
    m.role === "user"
      ? // 信不是「为叫醒而起的回报」：它是收下的指令，得留在册。当空回报折掉，凭据正文会一起丢
        !!m.relay?.length && !m.relay.some(relay => relay?.kind === "mail")
      : m.role === "assistant" && m.status !== "streaming" && !m.content.trim() && !m.steps?.length;
  if (at < 0 || !tail.length || !tail.every(empty) || (conversation.forks || []).some(fork => ids.has(fork.parentId))) return;
  conversation.messages = conversation.messages.slice(0, at + 1);
  const folded = tail
    .filter(m => m.role === "user")
    .flatMap(m => (m.relay || []).map((relay, i) => ({ report: i ? "" : m.content, relay })));
  conversation.heldReports = [...folded, ...(conversation.heldReports || [])];
}
// ---------- 磁盘信箱 ----------
// 桥接那头落在 存储根/mail-queue/ 的信（跨 Bot 指令，见 server/mail.js 与 94-driver.js 的 send）：
// 长等、认领、把指令写成那段对话的一条用户消息，落盘落稳才回执。同一封不重复入册——对话上的 mailSeen
// 记已收的号，认领后写消息前就记上、与消息同一份落盘。没落盘的（桥接断了、只进浏览器暂存）不回执，
// 租期一过再领重来。正在作答的照补言的路子递进这一答；没在作答的起一新答；用户叫停过的只记下不自动开工。
// 等回执的登记簿：哪段对话里哪封信还差一份含凭据的盘照（凭据：消息上的 mailId/mailIds、步骤上的 mailId）
const mailPendingAcks = new Map();
function pendingMailAck(conversationId, mailId) {
  let set = mailPendingAcks.get(conversationId);
  if (!set) mailPendingAcks.set(conversationId, (set = new Set()));
  set.add(mailId);
}
// 同一封信的凭据在不在册：消息上的编号，或行迹里带编号的那一步。落盘的快照、内存里活的都用它查
/** @param {Conversation|object} c @param {Set<string>} [exceptSteps] 这些步骤不算凭据——它们正要并进并问（见 settleSupplements） */
function hasMailRecord(c, mailId, exceptSteps) {
  return everyMessage(c).some(
    m =>
      m.mailId === mailId ||
      (m.mailIds || []).includes(mailId) ||
      (m.steps || []).some(step => step.mailId === mailId && !exceptSteps?.has(step.id))
  );
}
// writeConversation 每真落一份盘照都来这过一遍（见 30-chats.js）：照里找得到编号才回执——
// 回执绑的是实际写盘的那份快照，不是随便哪个在途写任务的着落
/** @param {string} json 落盘的那份快照原文 */
async function mailOnDiskWrite(conversationId, json) {
  const pending = mailPendingAcks.get(conversationId);
  if (!pending?.size) return;
  try {
    const snap = JSON.parse(json);
    for (const mailId of [...pending]) {
      if (!hasMailRecord(snap, mailId)) continue;
      const sent = await storeBridge("/api/mail/ack", { id: mailId, owner: PAGE_ID }).then(() => true, () => false);
      // 桥接够不着就先留着、下一份落盘的再试；服务那头照实回了的（成没成）都销号，租期的说法交给信箱
      if (sent) pending.delete(mailId);
    }
  } catch {}
}
// 开张先扫一回：上一页递到一半没了的（宿主答已止、补言一步还挂在 running）落成正式消息——
// 只记下不自动开工；回过执的副作用指令也不自动重跑，发信方查行迹看得到
function recoverMailOrphans() {
  let touched = false;
  for (const c of store.conversations || [])
    for (const host of c.messages || []) {
      const strays =
        host.status === "streaming"
          ? []
          : // 开张时 settleSteps 先把 running 收成 error（recoverInterruptedMessages 跑在 listenMail 前），
            // 只找 running 会漏掉刚被收的那批——没递到的都算，递到了的才打 done
            (host.steps || []).filter(step => step.name === "user_note" && step.mailId && step.status !== "done");
      if (!strays.length) continue;
      host.steps = host.steps.filter(step => !strays.includes(step));
      if (!host.steps.length) delete host.steps;
      for (const step of strays) {
        // 收尾已把它并成消息、或别的凭据在册的：只撤步骤，不再记一遍
        if (hasMailRecord(c, step.mailId)) continue;
        c.messages.push({
          // id 由编号定：两页各自恢复同一信步，并出来是同 id 两份合一，不是两条
          id: "mailmsg_" + step.mailId,
          role: "user",
          content: String(step.note || ""),
          timestamp: now(),
          mailId: step.mailId,
          relay: [{ kind: "mail", title: String(step.mailFrom || ""), ok: true }]
        });
      }
      c.updatedAt = now();
      markDirty(c.id);
      touched = true;
    }
  if (touched) saveStore();
}
async function listenMail() {
  let skip = [];
  for (;;) {
    const scope = bootstrap.store;
    try {
      recoverMailOrphans();
      const { letters } = await storeBridge("/api/mail/wait", { skip });
      if (bootstrap.store !== scope) continue;
      const list = Array.isArray(letters) ? letters : [],
        // 这段对话这页认不得（别处开的、还没读回）或别处正在答的：先跳过，空手一回后再看
        mine = list.filter(letter => store.conversations.some(c => c.id === letter.to) && !remoteBusy.has(letter.to));
      skip = list.length ? list.filter(item => !mine.includes(item)).map(item => item.id) : [];
      for (const letter of mine) await deliverLetter(letter);
    } catch {
      // 桥接断了一下（重启、睡眠醒来）：稍候再等
      await new Promise(resolve => setTimeout(resolve, 5000));
    } finally {
      if (bootstrap.store !== scope) skip = [];
    }
  }
}
/** @param {{ id: string, to: string, from?: string, payload: string, postedAt?: number }} letter */
async function deliverLetter(letter) {
  const conversation = store.conversations.find(c => c.id === letter.to);
  if (!conversation || runningElsewhere(conversation.id)) return;
  // 打算叫醒的先认领这一问（与发送同一道闸）：认领不上就不领这封信，留给它醒着的那页
  if (!requestJob(conversation.id) && !conversation.userHalted) {
    const profile = activeProfile(conversation);
    if (profile && !quotaBlocked(profile) && !(await claimTurn(conversation, { quiet: true }))) return;
  }
  const claim = await storeBridge("/api/mail/claim", { id: letter.id, owner: PAGE_ID }).catch(() => null);
  if (!claim?.claimed) return;
  try {
    // 认领的工夫里对话可能整段没了或被别处写过换掉：按 id 取当前这一份
    const live = store.conversations.find(c => c.id === letter.to);
    if (!live) return;
    const seen = (live.mailSeen ||= []),
      known = seen.includes(letter.id),
      // 凭据先于 mailSeen：回过执的残信从簿里淘汰后冒头、老号被挤出 mailSeen 的，册里早有这封信，
      // 只登记不递送——不然同一指令会再开一答、消息入册两回
      recorded = hasMailRecord(live, letter.id);
    if (!known && !recorded) {
      /** @type {Message} */
      const user = {
        // 信的入册 id 由编号定：两页从同一快照各自收信/恢复，并出来是同一个 id 的两份，按 id 合一而非两条
        id: "mailmsg_" + letter.id,
        role: "user",
        content: String(letter.payload || ""),
        timestamp: now(),
        mailId: letter.id,
        relay: [{ kind: "mail", title: String(letter.from || ""), ok: true }]
      };
      const running = requestJob(live.id),
        host = running && live.messages.find(message => message.id === running.assistantId);
      if (host?.status === "streaming") {
        // 正在作答：照补言的路子递进这一答——行迹里落一步「补言」，回合边界递上。
        // 编号记在步骤上：这份照落盘就是凭据，没递到前断的（刷新、叫停）靠它找回（见 recoverMailOrphans）
        /** @type {Step} */
        const step = {
          id: `note_${uid().slice(0, 8)}`,
          name: "user_note",
          arguments: "{}",
          status: "running",
          title: user.content.split("\n").find(Boolean)?.slice(0, 80) || "",
          note: user.content,
          mailId: letter.id,
          mailFrom: String(letter.from || ""),
          at: host.content.length,
          rat: String(host.reasoning || "").length
        };
        (running.queue ||= []).push({ user, step });
        (host.steps ||= []).push(step);
        refreshSteps(host);
        if (running.reading) watchSteer(running, host);
      } else {
        // 没在作答：模型可用就由这封信开一问（startTurn 会把它写进册）；叫停过的、没有可用的模型或余墨已尽的只记下不自动开工
        const profile = live.userHalted ? null : activeProfile(live);
        if (profile && !quotaBlocked(profile)) void startTurn(live, user, profile, { follow: false });
        else {
          live.messages.push(user);
          live.updatedAt = now();
        }
        if (currentId === live.id && view === "chat") renderConversation();
        else renderHistory();
      }
    } else if (!recorded) {
      // 收过的信凭据没了（步骤随收尾被撤、号被挤出 mailSeen 之类）：补一条正式消息留下凭据，不重复递送
      live.messages.push({
        id: "mailmsg_" + letter.id,
        role: "user",
        content: String(letter.payload || ""),
        timestamp: now(),
        mailId: letter.id,
        relay: [{ kind: "mail", title: String(letter.from || ""), ok: true }]
      });
      live.updatedAt = now();
      if (currentId === live.id && view === "chat") renderConversation();
      else renderHistory();
    }
    // 头一回见的、凭据在册只登记的，都记进 mailSeen：下次再冒头连查册都省了
    if (!known) {
      seen.push(letter.id);
      if (seen.length > 100) live.mailSeen = seen.slice(-100);
    }
    pendingMailAck(live.id, letter.id);
    markDirty(live.id);
    saveStore();
    // 重领的信正文未变：同指纹的普通写被跳过、照里没有这封信，回执就永远等不来。强制写一回才有着落。
    // 回执只认盘照：writeConversation 真落盘时会调 mailOnDiskWrite 对快照找凭据——在浏览器暂存、
    // 被别页顶掉、照里没有这封信的都不算收到，租期过了别页（或刷新后的自己）再领
    flushConversations([live.id], { force: true });
  } catch {}
}
