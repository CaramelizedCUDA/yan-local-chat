// 言 · 内置提示词 · MCP
// hint：已接入的 MCP 服务自带的用法（握手时给的 instructions），有它的工具交给模型时接在系统提示末尾，一服务一行（{{servers}}）。
// 其余是工具结果里回给模型的话，不是系统提示。mcp_describe / mcp_call 两件的说明在 tools.js。
(window.YAN_PROMPTS ||= {}).mcp = {
  // 服务的说明常以自家名字起头（「景语：让模型……」），对谈里又没有身份句，不点明是工具，模型会当成自己的名字
  hint: "已接入的 MCP 服务附有用法（是工具的，不是你的身份），照办：\n{{servers}}",

  unknown: "没有这件工具：{{server}} / {{tool}}。{{known}}",

  badArgs: "调用 {{server}} / {{tool}} 的参数不合要求：{{problems}}。它收的参数：{{hint}}"
};
