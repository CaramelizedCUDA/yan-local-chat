// 言 · 游目 · 下拉框：网页里的 <select> 一点开，浏览器把选项画成另一扇小窗，screencast 收不到——人点下去什么也看不见。
// 巧处：与朱笔同一个耳目世界（50-ink.js 一并装进去），人按下、或按 F4 / Alt+↓ / 空格要开它时，耳目拦下浏览器那扇小窗，
// 把选项报来；游目在那一框底下浮一张纸签，选好了再经耳目写回去、补发 input 与 change（网页的脚本照常收到）。
// 网页自己拦下的（defaultPrevented）、跨源框里的（量不出它在哪）不接，照浏览器原样。执事选下拉用 select_option，不点它；
// 它若点了，小窗同样不开，游目也不浮（不是人刚按的）。耳目随游目连上才装、断开即撤，不碰没在看的页

// 耳目里的一段：报选项、等游目递回选了第几项。token 认是不是同一回开的
const STAGE_PICK_EAR = `(() => {
  if (window.__yanStagePick) return;
  const popup = el => el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled;
  // 这一框在顶层视口里的偏移；跨源的框里 frameElement 是 null，量不出
  const offset = () => {
    let x = 0, y = 0, w = window;
    while (w !== w.top) {
      const f = w.frameElement;
      if (!f) return null;
      const r = f.getBoundingClientRect();
      x += r.left + f.clientLeft;
      y += r.top + f.clientTop;
      w = w.parent;
    }
    return { x, y };
  };
  let held = null, pressed = null;
  const tell = el => {
    const at = offset(), r = el.getBoundingClientRect(), token = Math.random().toString(36).slice(2);
    held = { el, token };
    const items = [...el.options].map((o, i) => {
      const g = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement : null;
      return { i, t: (o.label || o.text).replace(/\\s+/g, " ").trim(), g: g ? g.label : "", d: o.disabled || !!g?.disabled, h: o.hidden };
    }).filter(o => !o.h);
    try { ${STAGE_BINDING}(JSON.stringify({ kind: "pick", token, x: at.x + r.left, y: at.y + r.top, w: r.width, h: r.height, at: el.selectedIndex, items })); } catch {}
  };
  // 冒泡到顶才拦：网页自己拦了的不管
  addEventListener("mousedown", e => {
    pressed = null;
    if (!e.isTrusted || e.button !== 0 || e.defaultPrevented || !popup(e.target) || !offset()) return;
    e.preventDefault();
    e.target.focus();
    pressed = e.target;
  });
  addEventListener("click", e => {
    if (pressed && e.target === pressed) tell(pressed);
    pressed = null;
  });
  addEventListener("keydown", e => {
    if (!e.isTrusted || e.defaultPrevented || !popup(e.target) || !offset()) return;
    if (!(e.key === "F4" || (e.altKey && /^Arrow(Up|Down)$/.test(e.key)) || (e.key === " " && !e.ctrlKey && !e.altKey))) return;
    e.preventDefault();
    tell(e.target);
  });
  window.__yanStagePick = (token, i) => {
    if (!held || held.token !== token) return false;
    const { el } = held;
    held = null;
    if (!el.isConnected) return false;
    el.focus();
    if (i >= 0 && el.selectedIndex !== i) {
      el.selectedIndex = i;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  };
})()`;

// 正看的那一页里各个耳目世界（主框架与同源的子框架各一个）：递回选项时不知是哪一框报的，各问一声，token 对得上的那个接
/** @type {Set<number>} */
const stagePickWorlds = new Set();
/** @param {string} method @param {any} params */
function stagePickWorld(method, params) {
  if (method === "Runtime.executionContextCreated") {
    if (params.context.name === STAGE_WORLD) stagePickWorlds.add(params.context.id);
  } else if (method === "Runtime.executionContextDestroyed") stagePickWorlds.delete(params.executionContextId);
  else if (method === "Runtime.executionContextsCleared") stagePickWorlds.clear();
}

/**
 * 浮那张纸签：贴着网页里那一框，宽不窄于它；当前选着的着朱。项多（十二项以上）的顶上一栏筛选
 * @param {{ token: string, x: number, y: number, w: number, h: number, at: number, items: { i: number, t: string, g: string, d: boolean }[] }} box
 */
function stagePickOpen(box) {
  // 人刚按的才浮：执事点的不算
  if (Date.now() - Math.max(stage.userAt, stage.keyAt) > 1500 || !stageVisible() || !box.items?.length) return;
  const frame = $("#stageFrame").getBoundingClientRect(),
    view = $("#stageView").getBoundingClientRect(),
    k = frame.width / (stage.meta.width || frame.width),
    anchor = $("#stagePickAt");
  Object.assign(anchor.style, {
    left: `${frame.left - view.left + box.x * k}px`,
    top: `${frame.top - view.top + box.y * k}px`,
    width: `${box.w * k}px`,
    height: `${box.h * k}px`
  });
  const rows = [];
  let group = "";
  for (const item of box.items) {
    if (item.g !== group && (group = item.g)) rows.push(`<div class="stage-pop-head">${escapeHtml(group)}</div>`);
    rows.push(
      `<button type="button" role="option" data-pick="${item.i}" aria-selected="${item.i === box.at}" class="${item.i === box.at ? "active" : ""}${item.g ? " in" : ""}"${item.d ? " disabled" : ""}><span>${escapeHtml(item.t) || "&nbsp;"}</span></button>`
    );
  }
  const filter = box.items.length > 12 ? `<input class="stage-pick-filter" spellcheck="false" placeholder="${t(`筛选`)}">` : "";
  const pop = openFloatingPop(
    anchor,
    `${filter}<div class="stage-pick-list" role="listbox" style="min-width:${Math.min(300, Math.round(box.w * k))}px">${rows.join("")}</div>`,
    { align: "left" }
  );
  pop.classList.add("stage-pop", "stage-pick");
  const list = /** @type {HTMLElement} */ (pop.querySelector(".stage-pick-list")),
    shown = () => /** @type {HTMLButtonElement[]} */ ([...list.querySelectorAll("button:not([disabled]):not(.hidden)")]),
    current = /** @type {HTMLElement | null} */ (list.querySelector("button.active"));
  current?.scrollIntoView({ block: "center" });
  /** @type {HTMLElement | null} */ (pop.querySelector(".stage-pick-filter") || current || shown()[0])?.focus({ preventScroll: true });
  // 点选只认指针的：开它的那一下若是空格，松开时落在刚聚焦的项上会被当成一次点按；键盘的在 keydown 里办
  pop.addEventListener("click", e => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-pick]"));
    if (button && e.detail) stagePickChoose(box.token, Number(button.dataset.pick));
  });
  pop.addEventListener("keydown", e => {
    const items = shown(),
      at = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement)),
      move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (e.key === "Escape") stagePickChoose(box.token, -1);
    else if (move) items[at < 0 ? (move > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, at + move))]?.focus();
    else if (e.key === "Enter" || (e.key === " " && at >= 0)) {
      const pick = at >= 0 ? items[at] : items[0];
      if (pick) stagePickChoose(box.token, Number(pick.dataset.pick));
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  pop.querySelector(".stage-pick-filter")?.addEventListener("input", e => {
    const q = /** @type {HTMLInputElement} */ (e.target).value.trim().toLowerCase();
    let head = /** @type {HTMLElement | null} */ (null),
      any = false;
    for (const row of /** @type {HTMLElement[]} */ ([...list.children])) {
      if (row.matches(".stage-pop-head")) {
        head?.classList.toggle("hidden", !any);
        [head, any] = [row, false];
        continue;
      }
      const hit = !q || row.textContent.toLowerCase().includes(q);
      row.classList.toggle("hidden", !hit);
      any ||= hit;
    }
    head?.classList.toggle("hidden", !any);
  });
}
// 选了第几项（-1 是作罢）：经耳目写回网页；键盘交还网页
/** @param {string} token @param {number} index */
function stagePickChoose(token, index) {
  stagePickClose();
  $("#stageKeys").focus({ preventScroll: true });
  const session = stage.session;
  for (const id of stagePickWorlds)
    void stageSend(
      "Runtime.evaluate",
      { expression: `window.__yanStagePick?.(${JSON.stringify(token)}, ${index})`, contextId: id },
      session
    ).catch(() => {});
}
// 换页、断开、滚动网页：纸签收起（浏览器自己的那扇小窗也是这样）
function stagePickClose() {
  document.querySelector(".chip-pop.stage-pick")?.remove();
}
