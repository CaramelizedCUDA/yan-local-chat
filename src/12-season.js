// 言 · 时令（设计稿/84 丙）：界面随二十四节气变一点——欢迎页题上注节气名、题字池里掺当令的句子（见 10-welcome.js 的 greeting）、
// 纸色随季偏一丝（theme-boot.js 开页前写 html[data-season]，色在 00-base.css）、右下角当令的一件（春柳、夏荷、秋苇、冬梅）。
// 那一件用 brushStroke 画、作 .main:after 的遮罩，墨色随明暗；亮色里替掉那两道淡圈，暗色里与右上那轮月同在。
// 落选的：只换话（多半时候看不出变了）；四季各一套配色（花哨，且印、朱、墨都得跟着调）
// 各节气交节的日子逐年差一两天，取常见的那天；跨了节气不重画，下回开页即换
/** @type {[number, number, string][]} 交节的月、日与名 */
const SOLAR_TERMS = [
  [1, 5, "小寒"],
  [1, 20, "大寒"],
  [2, 4, "立春"],
  [2, 19, "雨水"],
  [3, 5, "惊蛰"],
  [3, 20, "春分"],
  [4, 4, "清明"],
  [4, 20, "谷雨"],
  [5, 5, "立夏"],
  [5, 21, "小满"],
  [6, 5, "芒种"],
  [6, 21, "夏至"],
  [7, 7, "小暑"],
  [7, 22, "大暑"],
  [8, 7, "立秋"],
  [8, 23, "处暑"],
  [9, 7, "白露"],
  [9, 23, "秋分"],
  [10, 8, "寒露"],
  [10, 23, "霜降"],
  [11, 7, "立冬"],
  [11, 22, "小雪"],
  [12, 7, "大雪"],
  [12, 21, "冬至"]
];
/** @param {Date} [date] @returns {string} 当下所在的节气（一月五日前还在去年的冬至） */
function solarTerm(date = new Date()) {
  const m = date.getMonth() + 1,
    d = date.getDate();
  return SOLAR_TERMS.filter(([tm, td]) => m > tm || (m === tm && d >= td)).at(-1)?.[2] || "冬至";
}
// 当令的一件：300 × 340 的格子里，贴右下角长出来；笔都是 brushStroke（起笔顿、收笔出锋），只用一色——遮罩只认浓淡
const SEASON_MARKS = {
  // 春 · 柳：一枝从右边探进来，垂下四缕；叶是缕上一串细笔，两边交错、朝下斜出
  spring() {
    let s = brushStroke([300, 18, 252, 4, 196, 34], 3, { tail: 0.4, head: 0.5 });
    const strands = [
      [276, 12, 40, 250],
      [246, 12, 22, 300],
      [220, 22, -6, 236],
      [204, 32, 12, 160]
    ];
    strands.forEach(([x, y, sway, len], i) => {
      const end = [x - sway * 0.4, y + len],
        ctrl = [x - sway, y + len * 0.45];
      s += brushStroke([x, y, ...ctrl, ...end], 1.3, { tail: 0, head: 0.6 });
      for (let k = 1; k < 9; k++) {
        const t = k / 9 + (i % 2) * 0.04;
        if (t > 0.96) break;
        const u = 1 - t,
          px = u * u * x + 2 * u * t * ctrl[0] + t * t * end[0],
          py = u * u * y + 2 * u * t * ctrl[1] + t * t * end[1],
          side = k % 2 ? 1 : -1,
          size = 11 + 7 * Math.sin(Math.PI * t) - (k % 3) * 2;
        s += brushStroke([px, py, px + side * size * 0.3, py + size * 0.4, px + side * size * 0.24, py + size], 2.5, {
          tail: 0,
          head: 0.3
        });
      }
    });
    return s;
  },
  // 夏 · 荷：一张侧着的叶——淡染一片，前沿一道浓些的叶边，叶脉从前下方茎接叶处散向叶缘；一茎落到底，旁边一茎擎着未开的苞
  summer() {
    const cx = 188,
      cy = 196,
      rx = 102,
      ry = 38,
      tilt = (-10 * Math.PI) / 180,
      rim = deg => {
        const a = (deg * Math.PI) / 180,
          x = Math.cos(a) * rx,
          y = Math.sin(a) * ry;
        return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)];
      };
    let s = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(-10 ${cx} ${cy})" fill-opacity=".3"/>`;
    // 前沿：叶缘下半圈，中间粗、两头收
    const front = [10, 50, 90, 130, 170].map(rim);
    s += brushStroke([...front[0], ...front[1], ...front[2], ...front[3], ...front[4]], 2.2, { tail: 0, head: 0.2 });
    const [hx, hy] = [cx + 6, cy + 16];
    for (let i = 0; i < 9; i++) {
      const [ex, ey] = rim(-178 + i * 22);
      s += brushStroke([hx, hy, (hx + ex) / 2, (hy + ey) / 2 + 4, ex, ey], 1.1, { tail: 0, head: 0.5 });
    }
    s += brushStroke([hx, hy, 214, 270, 204, 340], 3, { tail: 0.7, head: 0.5 });
    s += brushStroke([104, 340, 98, 280, 74, 236], 2, { tail: 0.8, head: 0.6 });
    s +=
      brushStroke([74, 238, 56, 216, 70, 186], 8, { tail: 0, head: 0.4 }) +
      brushStroke([76, 238, 92, 214, 72, 186], 6.5, { tail: 0, head: 0.4 });
    return s;
  },
  // 秋 · 苇：三茎从底边斜出、梢头各垂一穗（几笔细丝往左下散开，越往下越长）；一片叶从茎腰扫出去
  autumn() {
    const stalks = [
        [262, 340, 250, 214, 172, 56, 3.2, 11, 54],
        [286, 340, 284, 236, 238, 96, 2.6, 9, 44],
        [238, 340, 222, 270, 160, 176, 2.1, 7, 34]
      ],
      at = (p, t) => {
        const u = 1 - t;
        return [u * u * p[0] + 2 * u * t * p[2] + t * t * p[4], u * u * p[1] + 2 * u * t * p[3] + t * t * p[5]];
      };
    let s = "";
    for (const [x0, y0, cx, cy, x1, y1, w, n, len] of stalks) {
      const p = [x0, y0, cx, cy, x1, y1];
      s += brushStroke(p, w, { tail: 0.15, head: 0.6 });
      for (let i = 0; i < n; i++) {
        const t = 1 - (i / n) * 0.3,
          [hx, hy] = at(p, t),
          l = len * (0.45 + (i / n) * 0.55),
          lean = i % 3 === 1 ? 7 : i % 3 === 2 ? -5 : 0;
        s += brushStroke([hx, hy, hx - l * 0.5 + lean, hy + l * 0.12, hx - l * 0.68 + lean * 1.6, hy + l * 0.82], 1.25, {
          tail: 0,
          head: 0.55
        });
      }
    }
    const [lx, ly] = at([262, 340, 250, 214, 172, 56], 0.4);
    s += brushStroke([lx, ly, lx - 46, ly - 30, lx - 92, ly + 14], 5, { tail: 0, head: 0.3 });
    return s;
  },
  // 冬 · 梅：老枝从右下折上来、转一个弯，几根细枝挺出去；花五瓣一朵，有的还是苞
  winter() {
    let s = brushStroke([300, 300, 252, 286, 224, 236, 202, 196, 150, 176], 6.5, { tail: 0.3, head: 0.6 });
    s += brushStroke([226, 240, 232, 174, 216, 104], 2.8, { tail: 0.1, head: 0.7 });
    s += brushStroke([172, 182, 130, 180, 86, 152], 2.2, { tail: 0.1, head: 0.7 });
    s += brushStroke([220, 150, 242, 128, 254, 98], 1.5, { tail: 0.1, head: 0.7 });
    const bloom = (x, y, r) =>
      Array.from({ length: 5 }, (_, i) => {
        const a = ((i * 72 - 90) * Math.PI) / 180;
        return `<circle cx="${(x + Math.cos(a) * r).toFixed(1)}" cy="${(y + Math.sin(a) * r).toFixed(1)}" r="${(r * 0.66).toFixed(1)}" fill-opacity=".5"/>`;
      }).join("") + `<circle cx="${x}" cy="${y}" r="${(r * 0.32).toFixed(1)}"/>`;
    s += bloom(214, 100, 7.5) + bloom(86, 150, 6.5) + bloom(150, 174, 6) + bloom(254, 94, 5);
    s += `<circle cx="118" cy="170" r="2.8"/><circle cx="234" cy="146" r="2.6"/><circle cx="196" cy="212" r="2.4"/>`;
    return s;
  }
};
/** @param {string} season @returns {string} 一件当令的画，整份 SVG */
function seasonMarkSvg(season) {
  const draw = SEASON_MARKS[season];
  return draw ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 340">${draw()}</svg>` : "";
}
// 开页时画一回：季节由 theme-boot.js 定好写在 <html> 上，这里只把那一件交给样式当遮罩
function paintSeason() {
  const svg = seasonMarkSvg(document.documentElement.dataset.season || "");
  if (!svg) return;
  const html = document.documentElement;
  html.style.setProperty("--season-mark", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  html.dataset.seasonMark = "";
}
