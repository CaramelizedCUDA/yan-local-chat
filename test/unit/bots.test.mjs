import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createBots = createRequire(import.meta.url)("../../server/bots.js");

async function serve(home) {
  const routes = createBots({ home: () => home }).routes,
    server = http.createServer((req, res) => (routes[`${req.method} ${req.url}`] || (() => res.writeHead(404).end()))(req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (path, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", body: JSON.stringify(body) }).then(async r => ({
      status: r.status,
      body: await r.json()
    }));
  return { post, close: () => server.close() };
}

function tmpHome() {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "bots-"));
}

test("名册：空目录读出空册；写回补齐九个字段，再读回来一致", async () => {
  const home = tmpHome(),
    { post, close } = await serve(home);
  try {
    assert.deepEqual((await post("/api/bots/load", {})).body, { bots: [], updatedAt: 0 });
    const saved = await post("/api/bots/save", { bots: [{ id: "bot-a", name: "探子", role: "helper", activeConversationId: "c-1" }] });
    assert.equal(saved.status, 200);
    const { bots, updatedAt } = (await post("/api/bots/load", {})).body;
    assert.equal(updatedAt, saved.body.updatedAt);
    assert.deepEqual(bots, [
      {
        id: "bot-a",
        name: "探子",
        driver: "native",
        role: "helper",
        activeConversationId: "c-1",
        profileHint: "",
        memoryRef: "bots/bot-a/memory.md",
        capabilities: [],
        status: "active"
      }
    ]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "bots.json"), "utf8")).言, "名册");
  } finally {
    close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("名册：不合规的项整份拒落；带旧 base 的写回撞 409 并交回磁盘上那份", async () => {
  const home = tmpHome(),
    { post, close } = await serve(home);
  try {
    for (const bad of [
      { id: "x", role: "boss" },
      { id: "x", driver: "acp" },
      { id: "x", status: "gone" },
      { name: "没号" }
    ]) {
      const denied = await post("/api/bots/save", { bots: [bad] });
      assert.equal(denied.status, 400, JSON.stringify(bad));
      assert.equal(fs.existsSync(path.join(home, "bots.json")), false);
    }
    const dup = await post("/api/bots/save", { bots: [{ id: "a" }, { id: "a" }] });
    assert.equal(dup.status, 400);
    const first = await post("/api/bots/save", { bots: [{ id: "a", name: "一号" }] });
    await post("/api/bots/save", { bots: [{ id: "b", name: "二号" }], base: first.body.updatedAt });
    const stale = await post("/api/bots/save", { bots: [{ id: "c" }], base: first.body.updatedAt });
    assert.equal(stale.status, 409);
    assert.deepEqual(
      stale.body.bots.map(bot => bot.id),
      ["b"]
    );
  } finally {
    close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("记忆：照 memoryRef 读出来；缺文件回空，越出存储根的拒读", async () => {
  const home = tmpHome(),
    { post, close } = await serve(home);
  try {
    await post("/api/bots/save", {
      bots: [
        { id: "mem-a" },
        { id: "mem-b", memoryRef: "bots/mem-b/note.md" },
        { id: "rogue", memoryRef: "../outside.md" }
      ]
    });
    fs.mkdirSync(path.join(home, "bots", "mem-b"), { recursive: true });
    fs.writeFileSync(path.join(home, "bots", "mem-b", "note.md"), "记着的事");
    assert.deepEqual((await post("/api/bots/memory", { id: "mem-a" })).body, {
      id: "mem-a",
      ref: "bots/mem-a/memory.md",
      content: null
    });
    const hit = await post("/api/bots/memory", { id: "mem-b" });
    assert.equal(hit.body.content, "记着的事");
    assert.equal(hit.body.ref, "bots/mem-b/note.md");
    const rogue = await post("/api/bots/memory", { id: "rogue" });
    assert.equal(rogue.status, 400);
    assert.match(rogue.body.error, /越出存储根/);
  } finally {
    close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
