// 言 · 本地存储 · 开页：读出启动镜像，立起整页共用的 store（对话随后从存储根补齐，见 hydrateStore）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 放在存储各段之后：读记录、规整、迁移要用的常量与簿记都已立起
/** @type {Store} */
let store = loadStore();
// 给端到端测试看内存里的记录（对话不再整份镜像在 localStorage 里，测试没别的地方读）
window.__yanState = () => store;
window.__yanSave = () => saveStore();
