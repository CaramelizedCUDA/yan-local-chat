// 言 · 多语言：中文原文即键。选了英文时 theme-boot 先载入 i18n/en.js（全局 YAN_EN），这里照表换；表里没有的照原文。
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 两种写法：t("测试连接") 换整句；t`已写入 ${n} 行` 是带变量的句子，键里变量记作 {0}、{1}……译文可以换序。
// 印章、给模型看的话（工具结果、提示词）不进表，照原文
/** @type {Record<string, string> | null} */
const I18N = typeof YAN_EN === "object" && YAN_EN ? YAN_EN : null;
const LANG = I18N ? "en" : "zh";
// 译文里填变量：{0} 照填；{0|question|questions} 按 {0} 是不是 1 挑单复数
/** @param {string} template @param {(i: string) => string} get */
const fillIn = (template, get) =>
  template.replace(/\{(\d+)(?:\|([^|}]*)\|([^}]*))?\}/g, (_, i, one, many) =>
    one === undefined ? get(i) : Number(get(i)) === 1 ? one : many
  );
/**
 * @param {string | TemplateStringsArray} text
 * @param {...any} values
 * @returns {string}
 */
function t(text, ...values) {
  if (typeof text === "string") return (I18N && I18N[text]) || text;
  const cooked = () => text.reduce((out, part, i) => out + String(values[i - 1]) + part);
  if (!I18N) return cooked();
  const hit = I18N[text.reduce((key, part, i) => `${key}{${i - 1}}${part}`)];
  return hit ? fillIn(hit, i => String(values[Number(i)])) : cooked();
}
// 现成的一句话（多是桥接回的报错，在桥接那头已拼好）：整句查表，查不到再按带 {0} 的句式认。
// 报错原文在逻辑里照旧是中文（有的比对靠它），只在显示的出口换：提示条、对话里的报错、设置里的状态行
/** @type {[RegExp, string][] | null} */
let patterns = null;
/** @param {string} text */
function tr(text) {
  text = String(text ?? "");
  if (!I18N || !text) return text;
  if (I18N[text]) return I18N[text];
  // 只认字面够长的句式（至少三个汉字）：「{0}问{1}」这种几乎全是变量的，什么话都对得上
  patterns ||= Object.keys(I18N)
    .filter(key => /\{\d+\}/.test(key) && (key.replace(/\{\d+\}/g, "").match(/[一-鿿]/g) || []).length >= 3)
    .map(key => [
      new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{(\d+)\\\}/g, (_, i) => `(?<g${i}>[\\s\\S]*?)`)}$`),
      I18N[key]
    ]);
  for (const [re, en] of patterns) {
    const m = text.match(re);
    if (m) return fillIn(en, i => tr(m.groups?.[`g${i}`] ?? ""));
  }
  return text;
}
// index.html 里写死的字：开页时照表换一遍（文字与 title、placeholder、aria-label 几样属性）
function translateStatic(root = document.body) {
  if (!I18N) return;
  document.documentElement.lang = "en";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue || "",
      text = raw.trim();
    if (text && I18N[text]) node.nodeValue = raw.replace(text, I18N[text]);
  }
  for (const el of root.querySelectorAll("[title],[placeholder],[aria-label],[data-tip]"))
    for (const name of ["title", "placeholder", "aria-label", "data-tip"]) {
      const value = el.getAttribute(name);
      if (value && I18N[value]) el.setAttribute(name, I18N[value]);
    }
  const title = document.title;
  if (I18N[title]) document.title = I18N[title];
}
