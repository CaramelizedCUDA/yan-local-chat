// 言 · 行迹 · 点卯：名册上每只 Bot 此刻的样子——职司、状态、待你定夺的徽标与挂起时长、写锁与一键中止释放、各自耗的工食银。
// 与差遣面板同扇全屏的窗（web/index.html 的 #fleetModal）：名册真本在桥接（server/bots.js），开窗即重读镜像（04-bots.js）。
// 点一只进它的会话；侧栏「卯」钮上的徽标只数待你定夺的几只——那是要人看的，其余安安静静。
function fleetPanelOpen() {
  return isShown("#fleetModal");
}
const FLEET_ROLE_SEAL = { chief: "主", lead: "房", worker: "工", helper: "帮" };
/** 一只 Bot 此刻的一行：名册字段 + 驱动报上来的状态 + 工食银合计 */
function fleetRow(bot) {
  const st = sessionDriver(bot).status(bot.activeConversationId),
    c = store.conversations.find(item => item.id === bot.activeConversationId) || null,
    ink = (c?.messages || []).reduce((sum, message) => sum + (Number(message.tokenCount) || 0), 0),
    waiting = st.waitingApproval ? Date.now() - (Number(st.waitingSince) || Date.now()) : 0,
    profile = profiles().find(item => item.id === bot.profileId);
  return `<button type="button" class="fleet-row" data-fleet-bot="${escapeHtml(bot.id)}" data-status="${escapeHtml(st.state)}">
    <span class="seal fleet-seal" aria-hidden="true">${t(FLEET_ROLE_SEAL[bot.role] || "工")}</span>
    <span class="fleet-main"><span class="fleet-name">${escapeHtml(bot.name || bot.id)}</span><span class="fleet-meta">${escapeHtml(bot.id)} · ${escapeHtml(bot.role)} · ${t`写 ${escapeHtml(bot.writePolicy)}`}${profile ? ` · ${escapeHtml(profile.name)}` : ""}${c?.adoptedBy ? t` · 记 ${escapeHtml(c.adoptedBy)} 名下` : ""}</span></span>
    <span class="fleet-state">${st.waitingApproval ? `<span class="fleet-await">${t(`待你定夺${waiting > 1000 ? ` · ${spanText(waiting)}` : ""}`)}</span>` : ""}${st.holdingWriteLock ? `<span class="fleet-lock">${t("持写锁")}</span>` : ""}<span class="fleet-state-text">${escapeHtml(st.state)}</span></span>
    <span class="fleet-ink" title="${t(`工食银（各答耗墨合计）`)}">${quotaAmount(ink)}</span>
    ${st.holdingWriteLock || st.state === "running" ? `<span class="fleet-stop" data-fleet-stop="${escapeHtml(bot.id)}" role="button" tabindex="-1" title="${t(`中止：刹住它的会话，写锁随停释放`)}">${t("止")}</span>` : ""}
  </button>`;
}
function renderFleetPanel() {
  const body = $("#fleetBody");
  if (!body || !fleetPanelOpen()) return;
  const bots = allBots();
  body.innerHTML = bots.length
    ? bots.map(fleetRow).join("")
    : `<div class="fleet-empty">${t("名册是空的——主簿 spawn_bot 立册，或去存储根改 bots.json")}</div>`;
  const waiting = bots.filter(bot => sessionDriver(bot).status(bot.activeConversationId).waitingApproval).length;
  $("#fleetPanelSub").textContent = waiting ? t`${bots.length} 只 · ${waiting} 只待你定夺` : t`${bots.length} 只`;
  renderFleetBadge();
}
// 侧栏钮上的数：有待定夺的只数它（要人看的才亮），否则记名册总数
function renderFleetBadge() {
  const el = $("#fleetCount");
  if (!el) return;
  const bots = allBots(),
    waiting = bots.filter(bot => sessionDriver(bot).status(bot.activeConversationId).waitingApproval).length;
  el.textContent = waiting ? String(waiting) : bots.length ? String(bots.length) : "";
  el.classList.toggle("awaiting", waiting > 0);
}
function openFleetPanel() {
  const modal = $("#fleetModal");
  if (!modal) return;
  showNow(modal);
  if (!modal.contains(document.activeElement)) modal.focus({ preventScroll: true });
  void syncBots().then(renderFleetPanel);
}
function closeFleetPanel() {
  const modal = $("#fleetModal");
  if (modal && !modal.classList.contains("hidden")) hideWithFade(modal);
}
function bindFleetEvents() {
  $("#openFleet").onclick = () => (fleetPanelOpen() ? closeFleetPanel() : openFleetPanel());
  $("#fleetClose").onclick = closeFleetPanel;
  // 点遮罩、按 Esc 都关得掉，与差遣窗一个脾气（按下与松开都落在空白才算）
  const backdrop = target => target === $("#fleetModal") || target === $("#fleetScroll");
  let pressedBackdrop = false;
  $("#fleetModal").addEventListener("pointerdown", event => (pressedBackdrop = backdrop(event.target)));
  $("#fleetModal").addEventListener("click", event => {
    if (pressedBackdrop && backdrop(event.target)) closeFleetPanel();
    pressedBackdrop = false;
  });
  $("#fleetModal").addEventListener("keydown", event => {
    if (event.key === "Tab") trapModalFocus(event, $("#fleetModal"));
  });
  $("#fleetBody").addEventListener("click", event => {
    // 中止释放写锁：刹住会话即交还租约（40-leases 的巡视也会把没在跑的清掉，这里当场抹掉给面板看）
    const stop = event.target.closest("[data-fleet-stop]");
    if (stop) {
      const bot = allBots().find(item => item.id === stop.dataset.fleetStop);
      if (bot) {
        leaseHold.delete(bot.activeConversationId);
        void sessionDriver(bot).halt(bot.activeConversationId, { byUser: false }).then(renderFleetPanel);
      }
      event.stopPropagation();
      return;
    }
    const row = event.target.closest("[data-fleet-bot]");
    if (!row) return;
    const bot = allBots().find(item => item.id === row.dataset.fleetBot);
    if (bot?.activeConversationId && store.conversations.some(c => c.id === bot.activeConversationId)) {
      closeFleetPanel();
      openConversation(bot.activeConversationId);
    }
  });
  // 徽标常刷（待定夺的要人看）；开窗期间一并重画名册——状态与挂起时长在变
  setInterval(() => {
    renderFleetBadge();
    if (fleetPanelOpen()) renderFleetPanel();
  }, 2000);
}
// 点卯的窗与差遣的窗同层：Esc 收最上面那一层
defineLayer({ name: "fleet", rank: 100, open: fleetPanelOpen, close: closeFleetPanel });
