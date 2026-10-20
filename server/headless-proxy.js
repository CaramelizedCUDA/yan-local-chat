// 无头抓取浏览器的本机代理：在实际建连接时使用已校验的 IP，HTTPS 保持端到端 TLS。
"use strict";
const http = require("node:http");
const net = require("node:net");

module.exports = async function createPublicProxy(resolve = url => require("./web.js").assertPublicUrl(url)) {
  const sockets = new Set(),
    track = socket => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
      return socket;
    };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url);
      if (url.protocol !== "http:" || url.username || url.password) throw Error("无效的代理地址");
      const addresses = await resolve(url);
      if (req.destroyed || res.destroyed) return;
      const headers = { ...req.headers };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      headers[require("./web.js").OUTBOUND_MARK] = "1";
      const upstream = http.request(
        url,
        {
          method: req.method,
          headers,
          agent: false,
          lookup: require("./web.js").pinnedLookup(addresses)
        },
        response => {
          res.writeHead(response.statusCode, response.headers);
          response.on("error", () => res.destroy());
          response.pipe(res);
        }
      );
      upstream.on("socket", track);
      upstream.on("error", () => res.destroy());
      res.once("close", () => upstream.destroy());
      req.pipe(upstream);
    } catch {
      if (!res.destroyed) {
        res.writeHead(403);
        res.end();
      }
    }
  });
  server.on("connection", track);
  server.on("connect", async (req, client, head) => {
    try {
      const url = new URL(`https://${req.url}`);
      if (url.username || url.password || url.pathname !== "/") throw Error("无效的代理地址");
      const addresses = await resolve(url);
      if (client.destroyed) return;
      const remote = track(
        net.connect({
          host: url.hostname.replace(/^\[|\]$/g, ""),
          port: Number(url.port) || 443,
          lookup: require("./web.js").pinnedLookup(addresses)
        })
      );
      remote.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) remote.write(head);
        client.pipe(remote).pipe(client);
      });
      remote.on("error", () => client.destroy());
      client.on("error", () => remote.destroy());
      client.once("close", () => remote.destroy());
      remote.once("close", () => client.destroy());
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok());
  });
  let closed = false;
  return {
    url: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`,
    close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  };
};
