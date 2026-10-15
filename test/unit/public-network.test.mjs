import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import dns from "node:dns";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { fetchPublicResponse, readLimitedBytes } = require("../../server/web.js");
const createPublicProxy = require("../../server/headless-proxy.js");
const listen = async server => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = server =>
  new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  });

test("HTTP 重定向：同源保留认证，跨源不交出 Authorization 或自定义令牌", async () => {
  let received = 0;
  const other = http.createServer((req, res) => {
    received++;
    res.end("other");
  });
  const otherUrl = await listen(other);
  const first = http.createServer((req, res) => {
    if (req.url === "/same") res.end(req.headers.authorization || "none");
    else {
      res.writeHead(302, { Location: req.url === "/local" ? "/same" : otherUrl });
      res.end();
    }
  });
  const url = await listen(first);
  try {
    const { response } = await fetchPublicResponse(url + "/local", { headers: { Authorization: "Bearer own-test" }, allowLoopback: true });
    assert.equal(await response.text(), "Bearer own-test");
    for (const headers of [{ Authorization: "Bearer own-test" }, { "X-Custom-Token": "own-test" }])
      await assert.rejects(fetchPublicResponse(url + "/away", { headers, allowLoopback: true }), /跨来源跳转/);
    assert.equal(received, 0);
  } finally {
    await close(first);
    await close(other);
  }
});

test("DNS 只解析一次，真实连接保留原 Host，压缩响应与 HEAD 正常", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "text/plain" });
    res.end(gzipSync(Buffer.from(req.headers.host)));
  });
  const base = await listen(server),
    port = new URL(base).port;
  const original = dns.promises.lookup;
  let lookups = 0;
  dns.promises.lookup = async () => {
    lookups++;
    return [{ address: lookups === 1 ? "127.0.0.1" : "127.0.0.2", family: 4 }];
  };
  try {
    const { response } = await fetchPublicResponse(`http://own-test.invalid:${port}`, { allowLoopback: true });
    assert.equal(await response.text(), `own-test.invalid:${port}`);
    assert.equal(lookups, 1);
    const head = await fetchPublicResponse(base, { method: "HEAD", allowLoopback: true });
    assert.equal(await head.response.text(), "");
  } finally {
    dns.promises.lookup = original;
    await close(server);
  }
});

test("超量的响应及时取消，DNS 指向内网时在连接前拒绝", async () => {
  const server = http.createServer((req, res) => res.end("0123456789"));
  const base = await listen(server),
    original = dns.promises.lookup;
  try {
    const { response } = await fetchPublicResponse(base, { allowLoopback: true });
    const result = await readLimitedBytes(response, 4);
    assert.equal(result.buffer.toString(), "0123");
    assert.equal(result.truncated, true);
    dns.promises.lookup = async () => [{ address: "10.0.0.1", family: 4 }];
    await assert.rejects(fetchPublicResponse("http://own-test.invalid"), /内网/);
  } finally {
    dns.promises.lookup = original;
    await close(server);
  }
});

test("抓取浏览器代理：HTTP 与 CONNECT 只用已验的地址；默认拒绝回环", async () => {
  const target = http.createServer((req, res) => res.end(req.headers.host));
  const targetUrl = await listen(target),
    port = new URL(targetUrl).port;
  let resolved = 0;
  const proxy = await createPublicProxy(async () => {
    resolved++;
    return [{ address: "127.0.0.1", family: 4 }];
  });
  const blocked = await createPublicProxy();
  try {
    const get = (via, url) =>
      new Promise((resolve, reject) => {
        const req = http.get(via, { path: url, headers: { Host: `own-test.invalid:${port}` } }, res => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", x => (text += x));
          res.on("end", () => resolve({ status: res.statusCode, text }));
        });
        req.on("error", reject);
      });
    assert.deepEqual(await get(proxy.url, `http://own-test.invalid:${port}/`), { status: 200, text: `own-test.invalid:${port}` });
    assert.equal((await get(blocked.url, targetUrl)).status, 403);
    const tunneled = await new Promise((resolve, reject) => {
      const socket = net.connect(Number(new URL(proxy.url).port), "127.0.0.1");
      let buffer = "",
        connected = false;
      socket.on("connect", () => socket.write(`CONNECT own-test.invalid:${port} HTTP/1.1\r\nHost: own-test.invalid:${port}\r\n\r\n`));
      socket.on("data", chunk => {
        buffer += chunk;
        if (!connected && buffer.includes("\r\n\r\n")) {
          assert.match(buffer, /200 Connection Established/);
          connected = true;
          buffer = "";
          socket.write(`GET / HTTP/1.1\r\nHost: tunnel-test\r\nConnection: close\r\n\r\n`);
        }
      });
      socket.on("error", reject);
      socket.on("close", () => resolve(buffer));
    });
    assert.match(tunneled, /tunnel-test/);
    assert.equal(resolved, 2);
  } finally {
    proxy.close();
    blocked.close();
    await close(target);
  }
});
