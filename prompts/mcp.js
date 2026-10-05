// 言 · 内置提示词 · MCP
// hint：已接入的 MCP 服务自带的用法（握手时给的 instructions），有它的工具交给模型时接在系统提示末尾，一服务一行（{{servers}}）。
// 其余是工具结果里回给模型的话，不是系统提示。mcp_describe / mcp_call 两件的说明在 tools.js。
(window.YAN_PROMPTS ||= {}).mcp = {
  // 服务的说明常以自家名字起头（「景语：让模型……」），对谈里又没有身份句，不点明是工具，模型会当成自己的名字
  hint: "已接入的 MCP 服务附有用法（是工具的，不是你的身份），照办：\n{{servers}}",

  unknown: "没有这件工具：{{server}} / {{tool}}。{{known}}",

  badArgs: "调用 {{server}} / {{tool}} 的参数不合要求：{{problems}}。它收的参数：{{hint}}",

  // 浏览器的视口一经设定就钉死，不再随用户看的那一栏变：测完要回原样只能换一页
  stagePinned:
    "（视口已定死，此后不随用户那边的浏览器栏变。测完要回到原样，用 browser_tabs 新开一页接着做，别再设一个桌面尺寸来「还原」。）"
};
