// 言 · 听音：放音只有一处——页里常驻的 #listenAudio；预览里的整页与顶栏上的玉佩，都只是它的两面。
// 所以「离开整页仍在放」不是另做的功能：音频本就不归预览器管，关预览不碰它就接着响。要定的只剩一条：
// 预览上的 × 是「停」，别的关法（点空白、Esc）是「收」——收时正放着就挂成玉佩，停着便一并收掉。
// 玉佩在不在不另记：有曲在放、而预览里没摊着这一曲，就挂着（见 listenSync）。
// 放音、声纹、上下首、随声而摆都在这一件里；往后别处要放一段音（卷宗之外的来源），交一条 track 给 listenLoad 即可。
// 落选的：缩小后另起一个播放器接着放（两份音频要交接进度）；右下角浮一张纸签、顶栏一行、侧栏底一条（见 设计稿/18–23）

/** @typedef {{ key: string, name: string, url: string, where: string, source: {path?: string, attachmentId?: string}, bytes: () => Promise<ArrayBuffer>, list: any[] }} ListenTrack */
/** @type {ListenTrack | null} 喇叭里的这一曲 */
let listenTrack = null,
  /** @type {ListenTrack | null} 预览整页上摆着的那一曲（可能还没放，与 listenTrack 不同） */
  listenShown = null,
  listenOwnUrl = "",
  listenFrameId = 0,
  listenGraph = null,
  listenSwing = { amp: 0, t: 0 };
const listenPeakCache = new Map(),
  LISTEN_BARS = 150;
const listenEl = () => /** @type {HTMLAudioElement} */ ($("#listenAudio"));
const listenClock = seconds => {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const listenReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- 一曲：卷宗里的一件、或对话里的一件附件 ----------
function listenArchiveTrack(entry) {
  const dir = entry.path.split("/").slice(0, -1);
  return {
    key: `p:${entry.path}`,
    name: entry.name,
    url: archiveFileUrl(entry.path),
    where: ["卷宗", ...dir].join(" › ") + ` · ${fileExtension(entry.name).toUpperCase()} · ${formatFileSize(entry.size || 0)}`,
    source: { path: entry.path },
    bytes: async () => (await fetch(archiveFileUrl(entry.path))).arrayBuffer(),
    list: []
  };
}
// 预览器交来的：卷宗那一路连同夹里的其余音频一起列出，附件只有它自己
function listenTrackFrom(source, name, reader) {
  if (source?.path) {
    const entry = (archiveEntries || []).find(file => file.path === source.path) || { path: source.path, name, size: 0 },
      dir = source.path.split("/").slice(0, -1).join("/"),
      siblings = (archiveEntries || []).filter(
        file => file.path.split("/").slice(0, -1).join("/") === dir && previewKind(file.name) === "audio"
      ),
      list = (siblings.length ? siblings : [entry]).map(listenArchiveTrack);
    const track = listenArchiveTrack(entry);
    for (const item of list) item.list = list;
    track.list = list;
    return list.find(item => item.key === track.key) || track;
  }
  const track = {
    key: `a:${source?.attachmentId}`,
    name,
    url: reader.url(),
    where: `附件 · ${fileExtension(name).toUpperCase()}`,
    source,
    bytes: async () => (await reader.blob()).arrayBuffer(),
    list: []
  };
  track.list = [track];
  return track;
}

// ---------- 声纹：本机解开音频，量出每一段的峰 ----------
async function listenPeaks(track) {
  if (listenPeakCache.has(track.key)) return listenPeakCache.get(track.key);
  let peaks;
  try {
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await track.bytes()),
      data = decoded.getChannelData(0),
      step = Math.max(1, Math.floor(data.length / LISTEN_BARS));
    peaks = Array.from({ length: LISTEN_BARS }, (_, i) => {
      let peak = 0;
      for (let j = i * step, end = Math.min(data.length, j + step); j < end; j += 8) peak = Math.max(peak, Math.abs(data[j]));
      return peak;
    });
    const top = Math.max(...peaks) || 1;
    peaks = peaks.map(v => v / top);
  } catch {
    peaks = null;
  }
  listenPeakCache.set(track.key, peaks);
  return peaks;
}
const listenBarsHtml = peaks =>
  Array.from({ length: LISTEN_BARS }, (_, i) => `<i style="height:${Math.max(6, Math.round((peaks ? peaks[i] : 0.18) * 100))}%"></i>`).join(
    ""
  );

// ---------- 放音 ----------
function listenInit() {
  const el = listenEl();
  if (el.dataset.bound) return;
  el.dataset.bound = "1";
  for (const type of ["play", "pause", "emptied", "loadedmetadata"]) el.addEventListener(type, listenSync);
  // 放完接下一首，末一首放完回到头一首；只有一首就停在末尾
  el.addEventListener("ended", () => {
    if ((listenTrack?.list.length || 0) > 1) listenStep(1);
  });
  // 浏览器解不了这种编码：整页换成下载提示，喇叭收掉
  el.addEventListener("error", () => {
    if (!listenTrack) return;
    const page = $("#fileViewerStage .listen-page");
    if (page && listenShown?.key === listenTrack.key)
      page.outerHTML = `<div class="file-viewer-empty">浏览器放不了这种编码，请下载后以本机程序打开<br><button type="button" class="outline-btn" data-viewer-download>下载</button></div>`;
    else toast("这一曲放不了");
    listenRelease();
  });
}
async function listenLoad(track, play = false) {
  listenInit();
  const el = listenEl();
  if (listenOwnUrl) URL.revokeObjectURL(listenOwnUrl);
  listenOwnUrl = "";
  // 整页正摆着喇叭里这一曲时，换曲（上下首、放完接下一首）整页跟着换
  const follow = listenPageLive();
  listenTrack = track;
  if (follow && listenShown?.key !== track.key) listenShowPage(track);
  // 预览器关页时会收回自己造的 blob 地址，喇叭另要一份自己管
  let url = track.url;
  if (url.startsWith("blob:")) url = listenOwnUrl = URL.createObjectURL(new Blob([await track.bytes()]));
  el.src = url;
  if (play) await listenPlay();
  listenSync();
  listenRenderPage();
}
async function listenPlay() {
  const el = listenEl();
  // 随声而摆要量响度：头一回放时把喇叭接进一张小图（只能接一次，好在喇叭始终是这一个）
  if (!listenGraph && window.AudioContext) {
    try {
      const context = new AudioContext(),
        analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaElementSource(el).connect(analyser).connect(context.destination);
      listenGraph = { context, analyser, buffer: new Uint8Array(analyser.fftSize) };
    } catch {
      listenGraph = { context: null, analyser: null, buffer: null };
    }
  }
  if (listenGraph?.context?.state === "suspended") await listenGraph.context.resume();
  await el.play().catch(() => {});
}
function listenRelease() {
  const el = listenEl();
  el.pause();
  el.removeAttribute("src");
  el.load();
  if (listenOwnUrl) URL.revokeObjectURL(listenOwnUrl);
  listenOwnUrl = "";
  listenTrack = null;
  listenSync();
}
// 放 / 停：整页上摆着的若不是喇叭里那一曲，按下即换过来放
async function listenToggle(track = listenTrack) {
  if (!track) return;
  if (listenTrack?.key !== track.key) return listenLoad(track, true);
  if (listenEl().paused) await listenPlay();
  else listenEl().pause();
}
function listenStep(dir, track = listenTrack) {
  if (!track) return;
  const list = track.list || [],
    at = list.findIndex(item => item.key === track.key),
    el = listenEl();
  // 上一首：放过三秒先回到这一曲开头
  if (dir < 0 && listenTrack?.key === track.key && el.currentTime > 3) return void (el.currentTime = 0);
  // 列表首尾相接：末一首再往下回到头一首，头一首再往上到末一首
  if (list.length > 1) return void listenLoad(list[(at + dir + list.length) % list.length], true);
  if (dir < 0 && listenTrack?.key === track.key) el.currentTime = 0;
}
async function listenSeek(ratio, track = listenTrack) {
  if (!track) return;
  if (listenTrack?.key !== track.key) await listenLoad(track, false);
  const el = listenEl(),
    go = () => {
      el.currentTime = Math.min(0.999, Math.max(0, ratio)) * el.duration;
      void listenPlay();
    };
  if (Number.isFinite(el.duration)) go();
  else el.addEventListener("loadedmetadata", go, { once: true });
}

// ---------- 一面：预览里的整页 ----------
const LISTEN_ICONS = {
  play: `<path d="M6 3.5L16.5 10L6 16.5Z"/>`,
  pause: `<rect x="5" y="3.5" width="3.4" height="13" rx="1"/><rect x="11.6" y="3.5" width="3.4" height="13" rx="1"/>`,
  prev: `<path d="M15 4.5L7 10L15 15.5Z"/><rect x="4" y="4.5" width="2" height="11"/>`,
  next: `<path d="M5 4.5L13 10L5 15.5Z"/><rect x="14" y="4.5" width="2" height="11"/>`
};
const listenIcon = name => `<svg viewBox="0 0 20 20" aria-hidden="true">${LISTEN_ICONS[name]}</svg>`;
function listenPageHtml(track) {
  listenShown = track;
  const stage = $("#fileViewerStage");
  if (!stage.dataset.listenBound) {
    stage.dataset.listenBound = "1";
    bindListenPage(stage);
  }
  // 喇叭闲着就先把这一曲装上（不放），时长即知；正放着别的就不去动它
  if (!listenTrack || listenEl().paused)
    setTimeout(() => void (listenShown === track && listenTrack?.key !== track.key && listenLoad(track)), 0);
  setTimeout(async () => {
    const peaks = await listenPeaks(track),
      wave = $("#fileViewerStage .listen-wave");
    if (wave && listenShown === track) {
      wave.querySelectorAll("i").forEach((bar, i) => (bar.style.height = `${Math.max(6, Math.round((peaks ? peaks[i] : 0.18) * 100))}%`));
      listenRenderPage();
    }
  }, 0);
  setTimeout(listenSync, 0);
  const list =
    track.list.length > 1
      ? `<div class="listen-list">${track.list.map(item => `<button type="button" data-listen-pick="${escapeHtml(item.key)}"${item.key === track.key ? ' class="on"' : ""}>${escapeHtml(item.name.replace(/\.[^.]+$/, ""))}</button>`).join("")}</div>`
      : "";
  return `<div class="listen-page"><div class="listen-card">
    <p class="listen-title">${escapeHtml(track.name.replace(/\.[^.]+$/, ""))}</p><p class="listen-where">${escapeHtml(track.where)}</p>
    <div class="listen-wave" data-listen-wave>${listenBarsHtml(listenPeakCache.get(track.key))}<span class="listen-head"></span></div>
    <div class="listen-times"><span data-listen-now>0:00</span><span data-listen-total>—</span></div>
    <div class="listen-row"><span></span><div class="listen-controls">
      <button type="button" class="listen-step" data-listen-do="prev" title="上一首">${listenIcon("prev")}</button>
      <button type="button" class="listen-play" data-listen-do="toggle" title="播放">${listenIcon("play")}</button>
      <button type="button" class="listen-step" data-listen-do="next" title="下一首">${listenIcon("next")}</button>
    </div><label class="listen-volume">音量<input type="range" min="0" max="1" step="0.01" value="${listenEl().volume}" data-listen-volume></label></div>
    ${list}</div></div>`;
}
// 在预览里换摆另一曲：题名、下载都跟着这一曲
function listenShowPage(track) {
  viewerSource = track.source;
  viewerPath = track.source.path || "";
  $("#fileViewerName").textContent = track.name;
  $("#fileViewerStage").innerHTML = listenPageHtml(track);
}
// 整页上的点按：放停、上下首、点声纹跳、点列表换曲、拖音量
function bindListenPage(stage) {
  stage.addEventListener("click", e => {
    if (!listenShown || !e.target.closest(".listen-page")) return;
    const act = e.target.closest("[data-listen-do]")?.dataset.listenDo;
    if (act === "toggle") return void listenToggle(listenShown);
    if (act) return listenStep(act === "next" ? 1 : -1, listenShown);
    const pick = e.target.closest("[data-listen-pick]");
    if (pick) {
      const next = listenShown.list.find(item => item.key === pick.dataset.listenPick);
      if (next) {
        listenShowPage(next);
        void listenLoad(next, true);
      }
      return;
    }
    const wave = e.target.closest("[data-listen-wave]");
    if (wave) {
      const box = wave.getBoundingClientRect();
      void listenSeek((e.clientX - box.left) / box.width, listenShown);
    }
  });
  stage.addEventListener("input", e => {
    if (e.target.matches?.("[data-listen-volume]")) listenEl().volume = Number(e.target.value);
  });
}
function listenRenderPage() {
  const page = $("#fileViewerStage .listen-page");
  if (!page || !listenShown) return;
  const el = listenEl(),
    live = listenTrack?.key === listenShown.key,
    ratio = live && el.duration ? el.currentTime / el.duration : 0,
    lit = Math.round(ratio * LISTEN_BARS);
  page.querySelectorAll(".listen-wave i").forEach((bar, i) => bar.classList.toggle("on", i < lit));
  page.querySelector(".listen-head").style.left = `${ratio * 100}%`;
  page.querySelector("[data-listen-now]").textContent = listenClock(live ? el.currentTime : 0);
  page.querySelector("[data-listen-total]").textContent = live ? listenClock(el.duration) : "—";
  const playing = live && !el.paused,
    button = page.querySelector(".listen-play");
  button.innerHTML = listenIcon(playing ? "pause" : "play");
  button.title = playing ? "暂停" : "播放";
}

// ---------- 另一面：顶栏上的玉佩（画法见 设计稿/22、23：玉用染不用勾，笔只留给绳） ----------
const LISTEN_P = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
const listenN = n => +n.toFixed(2);
// 发丝弧：自 a0 度顺时针到 a1 度
function listenArcD(cx, cy, r, a0, a1) {
  const [x0, y0] = LISTEN_P(cx, cy, r, a0),
    [x1, y1] = LISTEN_P(cx, cy, r, a1);
  return `M${listenN(x0)} ${listenN(y0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${listenN(x1)} ${listenN(y1)}`;
}
const listenArc = (cx, cy, r, a0, a1, cls) => `<path class="${cls}" d="${listenArcD(cx, cy, r, a0, a1)}"/>`;
const listenRope = (x0, y0, x1, y1, w = 0.95) =>
  brushStroke([x0, y0, (x0 + x1) / 2 + 0.3, (y0 + y1) / 2, x1, y1], w, { tone: "zhu", tail: 0.75, head: 0.9 });
// 冲牙：上沿外鼓、下沿内收，厚端系绳，尖端弯向外——左一枚是上一首，右一枚是下一首，形即是意，不刻箭头
function listenFang(cx, cy, dir) {
  const z = 1.2,
    pt = (x, y) => `${listenN(cx + x * dir * z)} ${listenN(cy + (y + 0.7) * z)}`,
    d = `M${pt(-4.5, -1.8)}Q${pt(4.5, -4.2)} ${pt(14.5, 3.2)}Q${pt(6, 0.6)} ${pt(-4, 3.6)}Q${pt(-6.8, 1)} ${pt(-4.5, -1.8)}Z`;
  return (
    `<path fill="url(#listenJadeL)" d="${d}" filter="url(#listenDrop)"/><path class="rim" d="${d}"/>` +
    `<path class="hi" d="M${pt(-3.4, -1.3)}Q${pt(3.4, -3.1)} ${pt(9.6, -0.2)}"/><path class="xian" d="M${pt(-2.6, -2.2)}Q${pt(-2, 0.6)} ${pt(-2.4, 3.3)}"/>` +
    `<circle class="hole" cx="${cx}" cy="${cy}" r=".7"/>` +
    `<rect class="hit" x="${listenN(dir > 0 ? cx - 8 : cx - 19)}" y="${cy - 5}" width="27" height="13"/>`
  );
}
function listenBi(cx, cy, R = 16, r = 5.4) {
  const ring = `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  return (
    `<path fill="url(#listenJadeR)" fill-rule="evenodd" d="${ring}" filter="url(#listenDrop)"/>` +
    `<circle class="rim" cx="${cx}" cy="${cy}" r="${R - 0.2}"/><circle class="rim" cx="${cx}" cy="${cy}" r="${r + 0.2}"/>` +
    listenArc(cx, cy, R - 1.3, 196, 262, "hi") +
    listenArc(cx, cy, r + 0.9, 200, 320, "rim") +
    listenArc(cx, cy, r + 0.7, 35, 95, "hi") +
    `<circle class="xian" cx="${cx}" cy="${cy}" r="11"/><path class="played" d=""/><circle class="now zhu" r="1.25" cx="${cx}" cy="${cy - 11}"/>` +
    `<g class="glyph-pause"><rect class="glyph" x="${cx - 1.55}" y="${cy - 1.8}" width=".95" height="3.6" rx=".3"/><rect class="glyph" x="${cx + 0.6}" y="${cy - 1.8}" width=".95" height="3.6" rx=".3"/></g>` +
    `<path class="glyph glyph-play" d="M${cx - 1.1} ${cy - 2}L${cx + 1.9} ${cy}L${cx - 1.1} ${cy + 2}Z"/>` +
    `<circle class="hit" cx="${cx}" cy="${cy}" r="${R}"/>`
  );
}
function listenHeng(cx, y) {
  const w = 27,
    d = `M${cx - w} ${y + 7}Q${cx} ${y - 5} ${cx + w} ${y + 7}Q${cx + w + 1.6} ${y + 10.4} ${cx + w - 2.4} ${y + 11}Q${cx} ${y + 1.8} ${cx - w + 2.4} ${y + 11}Q${cx - w - 1.6} ${y + 10.4} ${cx - w} ${y + 7}Z`;
  return (
    `<path fill="url(#listenJadeL)" d="${d}" filter="url(#listenDrop)"/><path class="rim" d="${d}"/>` +
    `<path class="hi" d="M${cx - w + 3} ${y + 6.6}Q${cx - 6} ${y - 1.4} ${cx + 6} ${y + 0.1}"/>` +
    [
      [cx, y + 1.9],
      [cx - w + 2.4, y + 8.5],
      [cx + w - 2.4, y + 8.5]
    ]
      .map(([x, yy]) => `<circle class="hole" cx="${x}" cy="${yy}" r=".75"/>`)
      .join("")
  );
}
function listenTassel(x, y) {
  const lens = [15, 17.5, 16, 19, 17, 20, 17.5, 19, 16.5, 18, 15.5],
    silk = lens
      .map((len, i) => {
        const k = i - 5;
        return brushStroke([x + k * 0.22, y + 3.2, x + k * 0.42 + (k % 2) * 0.15, y + 3.2 + len * 0.5, x + k * 0.62, y + 3.2 + len], 0.42, {
          tone: "zhu",
          head: 1
        });
      })
      .join("");
  return (
    brushDot(x, y - 1.3, 1.15, "zhu") +
    `<g mask="url(#listenFade)">${silk}</g>` +
    `<rect class="zhu" x="${x - 1.6}" y="${y}" width="3.2" height="3.6" rx="1.1"/><rect class="zhu-deep" x="${x - 1.6}" y="${y + 2.4}" width="3.2" height=".45"/>`
  );
}
const LISTEN_BI = [45, 64];
function listenPendantHtml() {
  const wrap = `<rect class="zhu-deep" x="43.9" y="28.9" width="2.2" height=".45" rx=".2"/><rect class="zhu-deep" x="43.9" y="29.7" width="2.2" height=".45" rx=".2"/>`;
  return `<svg class="listen-svg" viewBox="0 0 90 108" aria-hidden="true"><defs>
    <radialGradient id="listenJadeR" cx=".36" cy=".3" r=".78"><stop offset="0" class="s0"/><stop offset=".55" class="s1"/><stop offset="1" class="s2"/></radialGradient>
    <linearGradient id="listenJadeL" x1="0" y1="0" x2=".25" y2="1"><stop offset="0" class="s0"/><stop offset=".5" class="s1"/><stop offset="1" class="s2"/></linearGradient>
    <linearGradient id="listenFadeG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".25"/></linearGradient>
    <mask id="listenFade" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#listenFadeG)"/></mask>
    <filter id="listenDrop" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow class="fshadow" dx="0" dy=".7" stdDeviation=".6"/></filter></defs>
    ${listenRope(45, 0, 45, 31)}
    <g class="listen-knot">${brushDot(45, 32.2, 1.9, "zhu")}${brushStroke([44.7, 33.5, 44.2, 36, 43.7, 38.5], 0.7, { tone: "zhu" })}${brushStroke([45.3, 33.5, 45.8, 36, 46.2, 38.5], 0.7, { tone: "zhu" })}</g>
    <g class="listen-pei">
      ${listenRope(20.2, 38.6, 20.2, 46, 0.7)}${listenRope(69.8, 38.6, 69.8, 46, 0.7)}${listenRope(45, 36, 45, 48.6, 0.8)}
      ${listenHeng(45, 30)}${wrap}
      <g class="listen-part listen-side" data-listen="prev" style="transform-origin:20.2px 46px"><title>上一首</title>${listenFang(20.2, 46, -1)}</g>
      <g class="listen-part listen-side" data-listen="next" style="transform-origin:69.8px 46px"><title>下一首</title>${listenFang(69.8, 46, 1)}</g>
      <g class="listen-part" data-listen="bi">${listenBi(...LISTEN_BI)}</g>
      ${listenTassel(45, 81.4)}
    </g>
    <rect class="hit listen-part" data-listen="rope" x="38" y="0" width="14" height="${40}"/>
  </svg>
  <div class="listen-label"><button type="button" class="listen-name" data-listen="page" title="回整页"></button><button type="button" class="listen-stop" data-listen="stop" title="停止" aria-label="停止">×</button><small class="listen-time"></small></div>`;
}
function listenPendant() {
  const box = $("#listenPendant");
  if (box.childElementCount) return box;
  box.innerHTML = listenPendantHtml();
  box.addEventListener("click", e => {
    const part = e.target.closest("[data-listen]")?.dataset.listen;
    if (!part) return;
    const open = box.classList.contains("open");
    if (part === "rope") return box.classList.toggle("open", !open);
    if (part === "page") return void openFileViewer(listenTrack.source, listenTrack.name);
    if (part === "stop") return listenRelease();
    if (part === "prev" || part === "next") return listenStep(part === "next" ? 1 : -1);
    if (part === "bi") {
      // 璧心放停，璧环点哪跳哪（自正上方顺时针）
      const svg = box.querySelector("svg"),
        point = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse()),
        dx = point.x - LISTEN_BI[0],
        dy = point.y - LISTEN_BI[1];
      if (Math.hypot(dx, dy) < 7.5) return void listenToggle();
      void listenSeek((((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360) / 360);
    }
  });
  // 点佩外、按 Esc：佩收回檐上，只留那根绳
  document.addEventListener("pointerdown", e => {
    if (box.classList.contains("open") && !box.contains(e.target)) box.classList.remove("open");
  });
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && box.classList.contains("open")) box.classList.remove("open");
  });
  return box;
}
function listenRenderPendant() {
  const box = $("#listenPendant");
  if (!box?.childElementCount || !listenTrack) return;
  const el = listenEl(),
    ratio = el.duration ? el.currentTime / el.duration : 0,
    [cx, cy] = LISTEN_BI,
    end = -90 + 360 * Math.min(0.9995, ratio),
    [hx, hy] = LISTEN_P(cx, cy, 11, end);
  box.querySelector(".played").setAttribute("d", ratio > 0.002 ? listenArcD(cx, cy, 11, -90, end) : "");
  box.querySelector(".now").setAttribute("cx", listenN(hx));
  box.querySelector(".now").setAttribute("cy", listenN(hy));
  box.querySelector(".listen-time").textContent = `${listenClock(el.currentTime)} / ${listenClock(el.duration)}`;
}

// ---------- 两面何时各现：都由喇叭此刻的样子推出来 ----------
function listenPageLive() {
  return !$("#fileViewer").classList.contains("hidden") && !!$("#fileViewerStage .listen-page") && listenShown?.key === listenTrack?.key;
}
function listenSync() {
  const box = $("#listenPendant"),
    el = listenEl(),
    hang = !!listenTrack && !listenPageLive();
  if (hang) {
    listenPendant();
    box.querySelector(".listen-name").textContent = listenTrack.name.replace(/\.[^.]+$/, "");
    box.querySelector('[data-listen="rope"]').innerHTML = `<title>${escapeHtml(listenTrack.name)}</title>`;
    listenRenderPendant();
  } else box?.classList.remove("open");
  box?.classList.toggle("hidden", !hang);
  box?.classList.toggle("playing", !!listenTrack && !el.paused);
  listenRenderPage();
  if (listenTrack && !el.paused && !listenFrameId) listenFrameId = requestAnimationFrame(listenFrame);
}
// 放着时每帧走一次：整页的声纹、玉佩的璧环，与随声而摆——摆幅跟着此刻的响度，停了就慢慢静下来
function listenFrame() {
  listenFrameId = 0;
  const el = listenEl();
  if ($("#fileViewerStage .listen-page")) listenRenderPage();
  const box = $("#listenPendant"),
    shown = !!box && !box.classList.contains("hidden");
  let loud = 0;
  const { analyser, buffer } = listenGraph || {};
  if (shown && analyser && !el.paused) {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const v of buffer) sum += ((v - 128) / 128) ** 2;
    loud = Math.sqrt(sum / buffer.length);
  }
  listenSwing.amp += (Math.min(1, loud * 3.2) - listenSwing.amp) * (loud > listenSwing.amp ? 0.12 : 0.03);
  listenSwing.t += 1 / 60;
  if (shown) {
    listenRenderPendant();
    const angle = listenReduced() ? 0 : listenSwing.amp * (box.classList.contains("open") ? 3.2 : 7) * Math.sin(listenSwing.t * 2.4);
    box.style.setProperty("--listen-sway", `${angle.toFixed(2)}deg`);
  }
  if (!el.paused || listenSwing.amp > 0.01) listenFrameId = requestAnimationFrame(listenFrame);
}
// 预览关了：× 是停；别的关法是收——正放着就挂上顶栏，停着（没放过或已停）就一并收掉。
// 整页摆的不是喇叭里那一曲（边放边翻开了另一件），关它不碰正放着的
function listenViewerClosed(stop) {
  const mine = !!listenTrack && listenShown?.key === listenTrack.key && !!$("#fileViewerStage .listen-page");
  listenShown = null;
  if (mine && (stop || listenEl().paused)) listenRelease();
  else setTimeout(listenSync, 0);
}
