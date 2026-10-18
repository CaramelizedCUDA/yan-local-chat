import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createOffice, officeHome } = require("../../server/office.js");
const createLocks = require("../../server/work/locks.js");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await sleep(10);
  }
  assert.fail("condition did not settle");
}
async function fixture(t, commandTimeout = 500, bridgePort) {
  const parent = fs.realpathSync(os.tmpdir()),
    root = fs.mkdtempSync(path.join(parent, "yan-office-"));
  const file = path.join(root, "测试.docx");
  fs.writeFileSync(file, "base");
  fs.mkdirSync(officeHome(root).dir, { recursive: true });
  fs.writeFileSync(officeHome(root).stamp, JSON.stringify({ commit: "fake" }));
  const { lockFile } = createLocks();
  let office;
  const server = http.createServer((req, res) => office.routes[`${req.method} ${req.url}`](req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  office = createOffice({ root: () => root, bridgePort: bridgePort ?? server.address().port, lockFile, commandTimeout });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body, signal) => {
    const response = await fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    return { status: response.status, ...(await response.json()) };
  };
  const open = (conversation = "", name = file) => post("/api/office/open", { path: name, conversation });
  const relay = (cmd, owner, conversation, signal) => post("/api/office/relay", { cmd, owner, conversation }, signal);
  const clients = [];
  const host = async (opened, reply = cmd => ({ locked: cmd === "lock", dirty: false })) => {
    const controller = new AbortController(),
      commands = [];
    const response = await fetch(new URL(`/yan/events?t=${opened.token}`, opened.url), { signal: controller.signal });
    const reader = response.body.getReader();
    const pumping = (async () => {
      let text = "";
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += new TextDecoder().decode(chunk.value);
          let at;
          while ((at = text.indexOf("\n\n")) >= 0) {
            const event = text.slice(0, at);
            text = text.slice(at + 2);
            if (!event.startsWith("data: ")) continue;
            const message = JSON.parse(event.slice(6));
            commands.push(message);
            if (message.id)
              void Promise.resolve(reply(message.cmd))
                .then(answer =>
                  fetch(new URL(`/yan/ack?t=${opened.token}`, opened.url), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: message.id, ...answer })
                  })
                )
                .catch(() => {});
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }
    })();
    clients.push({ controller, pumping });
    await until(() => commands.some(cmd => cmd.cmd === "sync"));
    return { commands };
  };
  t.after(async () => {
    for (const client of clients) client.controller.abort();
    await Promise.all(clients.map(client => client.pumping));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await office.close();
    if (path.dirname(fs.realpathSync(root)) !== parent || !path.basename(root).startsWith("yan-office-")) throw Error("测试清理越界");
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const fileUrl = opened => new URL(`/yan/file?t=${opened.token}`, opened.url);
  return { file, root, open, relay, post, host, fileUrl, lockFile };
}

test("桥接口接近 65535 时 Office 另取有效端口", async t => {
  const f = await fixture(t, 500, 65535),
    opened = await f.open();
  assert.equal(opened.status, 200, JSON.stringify(opened));
  const response = await fetch(f.fileUrl(opened));
  assert.equal(response.status, 200);
  await response.arrayBuffer();
});

test("Office 同指纹并发保存只接受一份，原件不混写", async t => {
  const f = await fixture(t),
    opened = await f.open(),
    url = f.fileUrl(opened);
  const read = await fetch(url),
    sig = read.headers.get("X-Yan-Sig");
  await read.arrayBuffer();
  const contents = ["A".repeat(65536), "B".repeat(65536)];
  const responses = await Promise.all(contents.map(body => fetch(url + `&seen=${sig}`, { method: "POST", body })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  await Promise.all(responses.map(r => r.json()));
  assert.ok(contents.includes(fs.readFileSync(f.file, "utf8")));
  const missing = await fetch(url, { method: "POST", body: "unsafe" });
  assert.equal(missing.status, 400);
  await missing.json();
});

test("Office 保存与执事共用传入的文件锁", async t => {
  const f = await fixture(t),
    opened = await f.open(),
    url = f.fileUrl(opened),
    response = await fetch(url);
  const sig = response.headers.get("X-Yan-Sig");
  await response.arrayBuffer();
  const release = await f.lockFile(f.file);
  let settled = false;
  const saving = fetch(url + `&seen=${sig}`, { method: "POST", body: "saved" }).then(r => {
    settled = true;
    return r.json();
  });
  await sleep(30);
  assert.equal(settled, false);
  assert.equal(fs.readFileSync(f.file, "utf8"), "base");
  release();
  await saving;
  assert.equal(fs.readFileSync(f.file, "utf8"), "saved");
});

test("共享文档最后一份作答结束才解锁，迟到页面继承只读", async t => {
  const f = await fixture(t),
    opened = await f.open(),
    host = await f.host(opened);
  assert.equal((await f.relay("lock", "turn-A", "A")).status, 200);
  assert.equal((await f.relay("lock", "turn-B", "B")).status, 200);
  await f.relay("unlock", "turn-A", "A");
  assert.equal(host.commands.filter(x => x.cmd === "unlock").length, 0);
  const late = await f.open("C");
  const response = await fetch(f.fileUrl(late));
  assert.equal(response.headers.get("X-Yan-Locked"), "1");
  await response.arrayBuffer();
  const lateHost = await f.host(late);
  assert.equal(lateHost.commands[0].locked, true);
  await f.relay("unlock", "turn-B", "B");
  await until(() => lateHost.commands.some(x => x.cmd === "unlock"));
  assert.equal(host.commands.filter(x => x.cmd === "unlock").length, 1);
});

test("同文件从别的对话重开，不改写原关联；Windows 大小写别名共用持有者", async t => {
  const f = await fixture(t),
    a = await f.open("A"),
    hostA = await f.host(a);
  const b = await f.open("B", process.platform === "win32" ? f.file.toUpperCase() : f.file),
    hostB = await f.host(b);
  assert.notEqual(a.token, b.token);
  assert.equal((await f.post("/api/office/list", { conversation: "A" })).docs.length, 1);
  await f.relay("lock", "A1", "A");
  assert.equal(hostA.commands.filter(x => x.cmd === "lock").length, 1);
  assert.equal(hostB.commands.filter(x => x.cmd === "lock").length, 1);
  await f.relay("unlock", "A1", "A");
});

test("模型在作答中首次打开文档，也会继承当前作答锁", async t => {
  const f = await fixture(t);
  assert.equal((await f.relay("lock", "active-answer", "A")).docs.length, 0);
  const opened = await f.open("A"),
    response = await fetch(f.fileUrl(opened));
  assert.equal(response.headers.get("X-Yan-Locked"), "1");
  await response.arrayBuffer();
  const host = await f.host(opened);
  assert.equal(host.commands[0].locked, true);
  await f.relay("unlock", "active-answer", "A");
  await until(() => host.commands.some(command => command.cmd === "unlock"));
});

for (const failure of ["error", "dirty", "readonly", "timeout"])
  test(`Office ${failure} 没有锁定成功：拒绝开工作答并回收部分锁`, async t => {
    const f = await fixture(t, 60),
      opened = await f.open(),
      host = await f.host(opened, cmd => {
        if (cmd === "unlock") return { locked: false, dirty: failure === "dirty" };
        if (failure === "timeout") return new Promise(() => {});
        return { locked: failure !== "readonly", dirty: failure === "dirty", ...(failure === "error" ? { error: "save failed" } : {}) };
      });
    const response = await f.relay("lock", "bad-turn", "A");
    assert.equal(response.status, 409);
    await until(() => host.commands.some(x => x.cmd === "unlock"));
    const read = await fetch(f.fileUrl(opened));
    assert.equal(read.headers.get("X-Yan-Locked"), "0");
    await read.arrayBuffer();
  });

test("准备锁文档时停止：迟到的确认也会回收锁", async t => {
  const f = await fixture(t),
    opened = await f.open();
  let reply;
  const waiting = new Promise(resolve => (reply = resolve));
  const host = await f.host(opened, cmd => (cmd === "lock" ? waiting : { locked: false, dirty: false }));
  const controller = new AbortController();
  const request = f.relay("lock", "cancelled", "A", controller.signal).catch(error => error);
  await until(() => host.commands.some(x => x.cmd === "lock"));
  controller.abort();
  reply({ locked: true, dirty: false });
  assert.equal((await request).name, "AbortError");
  await until(() => host.commands.some(x => x.cmd === "unlock"));
});

test("旧格式和宏格式不会被新格式字节覆盖", async t => {
  const f = await fixture(t);
  for (const extension of ["doc", "xls", "ppt", "docm", "xlsm", "pptm"]) {
    const file = path.join(f.root, `old.${extension}`);
    fs.writeFileSync(file, "original");
    assert.equal((await f.open("A", file)).status, 400);
    assert.equal(fs.readFileSync(file, "utf8"), "original");
  }
});
