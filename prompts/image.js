// 言 · 内置提示词 · 生图
// 专司里配了生图的模型才交出 generate_image（见 src/15-tools/12-image.js）；这里是画好后回给模型的工具结果。
// 图本身随结果附回（能看图的模型看得到，看不了的换成一句话，见 assistant.toolImages*）
(window.YAN_PROMPTS ||= {}).image = {
  // {{path}} 是存处（相对目录根），{{name}} 是文件名：正文里引它即画出这幅
  saved: "已画好，存为 {{path}}。正文里写 ![说明]({{name}}) 即就地画出。",
  // DALL·E 3 之类会改写描述，改写后的交回给模型对照
  revised: "接口改写后的描述：{{text}}"
};
