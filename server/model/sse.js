"use strict";
// 言 · 别家的事件流换回 chat.completions 分块（data: {...}\n\n，末尾 [DONE]）的共用骨架：切行、拼分块、报错、收尾都在这里，
// 各家只写「一个事件换成什么」——handle(out, data, event)，event 是 event: 行报的名字（没有即 data.type）：
//   out.chunk(delta, extra?, finish?)  发一块；out.model 可改（上游在开头报了实际型号）
//   out.done()                         收尾，补 [DONE]
//   out.fail(message)                  作答途中出错：按 OpenAI 流里的报错格式交出去，页面据此按「连接中断」处理、稍候接着写，
//                                      而不是把一句报错写进正文、当这一答写完了
// done、fail 之后再来的一概不理。没等到收尾就断了：不补 [DONE]，页面按「连接中断」处理、可续写（已收到结束原因的，页面照常收尾）
function translateSse(model, handle) {
  const decoder = new TextDecoder(),
    encoder = new TextEncoder(),
    id = `chatcmpl-${Date.now().toString(36)}`;
  let buffer = "",
    event = "",
    stopped = false,
    /** @type {TransformStreamDefaultController} */ controller;
  const send = text => controller.enqueue(encoder.encode(text));
  const out = {
    model,
    chunk(delta, extra = {}, finish = null) {
      send(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: out.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`
      );
    },
    done() {
      stopped = true;
      send("data: [DONE]\n\n");
    },
    fail(message) {
      stopped = true;
      send(`data: ${JSON.stringify({ error: { message: `接口在作答途中出错：${message || "未知错误"}` } })}\n\n`);
    }
  };
  const feed = text => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (stopped) return;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:"))
        try {
          const data = JSON.parse(line.slice(5).trim());
          handle(out, data, event || data.type);
        } catch {}
      else if (!line) event = "";
    }
  };
  return new TransformStream({
    transform(bytes, c) {
      controller = c;
      if (!stopped) feed(decoder.decode(bytes, { stream: true }));
    },
    flush(c) {
      controller = c;
      if (!stopped) feed(`${decoder.decode()}\n`);
    }
  });
}
module.exports = { translateSse };
