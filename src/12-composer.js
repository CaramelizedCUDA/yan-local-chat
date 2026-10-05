// 言 · 输入区：发送印、两处输入框的键与粘贴、输入区高度、引文
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function composerHasContent() {
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
  return !!(input?.value.trim() || pendingAttachments.length || pendingQuote);
}
// 发送键是一方印：印文「寄」即发送，生成中换成「止」；只在变化时重写，免得每次刷新都打断动效
function sealGlyph(button, running) {
  const glyph = running ? "止" : "寄";
  if (button.dataset.glyph === glyph) return;
  button.dataset.glyph = glyph;
  button.innerHTML = `<span class="seal-glyph" aria-hidden="true">${glyph}</span>`;
}
// 作答途中：案上空着，印是「止」；写了话，印又成「寄」——寄出去的是补言，递给正在作答的模型，它读了就改道
// 这一答写完了、帮手还在后台做（crew）：案上空着印也是「止」，停的是帮手；写了话照常是新的一问
function renderSendButtons() {
  const elsewhere = runningElsewhere(),
    running = conversationRunning() || elsewhere,
    crew = !running && crewRunning(),
    ended = conversationDry(currentConversation()),
    has = composerHasContent(),
    stop = (running || crew) && !has;
  document.querySelectorAll(".send-trigger").forEach(b => {
    sealGlyph(b, stop);
    b.title = sendPreparing
      ? "正在准备发送"
      : elsewhere
        ? "另一个页面正在这段对话里作答，这里跟着看"
        : stop
          ? crew
            ? "叫停后台的帮手"
            : "停止生成"
          : running
            ? "插言引路：模型说到落点便读这句，可就此改道"
            : "发送";
    b.classList.toggle("stop-btn", stop);
    b.classList.toggle("empty", !running && !has);
    b.disabled = sendPreparing || (!running && !crew && ended);
    b.setAttribute("aria-busy", String(sendPreparing));
  });
  const input = $("#chatInput");
  if (input && !input.disabled) input.placeholder = "续言于此"; // 生成中也不换提示语，能插言这件事由印上的「寄」示意
}

// 输入：欢迎页的提示词、两处输入框（回车发送、粘贴图片）、输入区高度、引文
function bindComposerEvents() {
  const welcomeInput = $("#welcomeInput"),
    restPlaceholder = welcomeInput.placeholder;
  chatSuggestionsHtml = $("#welcome .suggestions").innerHTML;
  bindSuggestions = () =>
    document.querySelectorAll(".suggestion").forEach(button => {
      const prompt = button.dataset.prompt || button.textContent;
      button.onclick = () => {
        welcomeInput.value = prompt;
        welcomeInput.placeholder = restPlaceholder;
        welcomeInput.classList.remove("previewing");
        grow(welcomeInput);
        persistDraft();
        welcomeInput.focus();
        const start = prompt.indexOf("（"),
          end = start < 0 ? prompt.length : prompt.indexOf("）", start) + 1;
        welcomeInput.setSelectionRange(start < 0 ? prompt.length : start, end);
      };
      // 预览只占一行：取提示词首句并加省略号，不撑高输入框、不推挤按钮
      const preview = `${prompt.split(/\r?\n/)[0].slice(0, 60)}…`;
      button.addEventListener("pointerenter", () => {
        if (welcomeInput.value) return;
        welcomeInput.placeholder = preview;
        welcomeInput.classList.add("previewing");
      });
      button.addEventListener("pointerleave", () => {
        if (welcomeInput.placeholder === preview) {
          welcomeInput.placeholder = restPlaceholder;
          welcomeInput.classList.remove("previewing");
        }
      });
    });
  bindSuggestions();
  [$("#welcomeInput"), $("#chatInput")].forEach(input => {
    input.addEventListener("input", () => {
      grow(input);
      persistDraft();
      renderSendButtons();
    });
    input.addEventListener("keydown", e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const waiting = input.id === "chatInput" && !input.value.trim() ? pendingApprovalHere() : null;
        if (waiting) return approveByEnter(waiting);
        sendOrStop();
      }
    });
    input.addEventListener("paste", e => {
      const images = Array.from(e.clipboardData?.files || []).filter(file => file.type.startsWith("image/"));
      if (!images.length) return;
      e.preventDefault();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(4);
      void addFiles(
        images.map(
          (file, index) =>
            new File(
              [file],
              `粘贴图片-${stamp}${images.length > 1 ? `-${index + 1}` : ""}.${file.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`,
              { type: file.type }
            )
        )
      );
    });
  });
  // 输入框上方多了请示条、帮手条与改动摘要，正文底部留白随之增减，末句不被盖住
  if ("ResizeObserver" in window)
    new ResizeObserver(() => {
      const area = $("#composerArea");
      if (area && !area.classList.contains("hidden")) {
        $("#chatScroll").style.paddingBottom = `${area.offsetHeight + 16}px`;
        document.documentElement.style.setProperty("--composer-h", `${area.offsetHeight}px`);
        syncChatScrollGrabber();
      }
    }).observe($("#composerArea"));
  // 对话里与欢迎页各一个引文框，✕ 同一个办法
  /** @type {HTMLElement} */ for (const close of document.querySelectorAll("[data-quote-close]"))
    close.onclick = () => {
      pendingQuote = null;
      renderQuote();
      persistDraft();
      (currentConversation() ? $("#chatInput") : $("#welcomeInput")).focus();
    };
  $("#messages").addEventListener("click", event => {
    const block = event.target.closest(".user-quote");
    // 点的是引文里的画面：看图（图片查看器自己接），不回出处
    if (!block || event.target.closest("[data-open-image]")) return;
    // 游目里圈点来的：回到游目那一页
    if (block.dataset.quoteUrl) return stageRevisit(block.dataset.quoteUrl);
    const source =
      block.dataset.quoteSource && document.querySelector(`#messages [data-message="${CSS.escape(block.dataset.quoteSource)}"]`);
    if (!source) return toast("出处已不在当前页面");
    followBottom = false;
    scrollChatTo(source, "center");
    source.classList.remove("flash");
    void source.offsetWidth;
    source.classList.add("flash");
  });
}
