import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createMail = createRequire(import.meta.url)("../../server/mail.js");

async function serve(home, options = {}) {
  const routes = createMail({ home: () => home, ...options }).routes,
    server = http.createServer((req, res) => (routes[`${req.method} ${req.url}`] || (() => res.writeHead(404).end()))(req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(async r => ({
      status: r.status,
      body: await r.json()
    }));
  return { post, close: () => server.close() };
}

function tmpHome() {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "mail-"));
}

test("信箱：投递→等信→认领→回执；同号再投判重", async () => {
  const home = tmpHome(),
    { post, close } = await serve(home, { waitMs: 200 });
  try {
    const posted = await post("/api/mail/post", { to: "conv-1", msgId: "m-1", from: "chief", payload: "去查一下" });
    assert.deepEqual(posted.body, { posted: true, id: "m-1" });
    const { letters } = (await post("/api/mail/wait", {})).body;
    assert.equal(letters.length, 1);
    assert.equal(letters[0].payload, "去查一下");
    // 别的主人先领着：同一刻再领领不走
    const claimed = await post("/api/mail/claim", { id: "m-1", owner: "page-a" });
    assert.equal(claimed.body.claimed, true);
    const second = await post("/api/mail/claim", { id: "m-1", owner: "page-b" });
    assert.equal(second.body.claimed, false);
    assert.equal(second.body.owner, "page-a");
    // 回执只认押着它的人
    assert.equal((await post("/api/mail/ack", { id: "m-1", owner: "page-b" })).body.ok, false);
    assert.equal((await post("/api/mail/ack", { id: "m-1", owner: "page-a" })).body.ok, true);
    assert.equal(fs.existsSync(path.join(home, "m-1.json")), false);
    // 回执簿记着：同号再投、再回执都照实说不重复
    assert.deepEqual(await post("/api/mail/post", { to: "conv-1", msgId: "m-1", payload: "再来" }), {
      status: 200,
      body: { posted: false, dup: true, id: "m-1" }
    });
    assert.equal((await post("/api/mail/ack", { id: "m-1", owner: "page-a" })).body.already, true);
  } finally {
    close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("信箱：租期过了能再领；认领超上限记死不再送", async () => {
  const home = tmpHome(),
    { post, close } = await serve(home, { waitMs: 200, claimMinMs: 10 });
  try {
    await post("/api/mail/post", { to: "conv-1", msgId: "m-2", payload: "一" });
    // 短租期领走不办事：过期后别人领得走（页面刷新、断连的恢复路）
    const short = await post("/api/mail/claim", { id: "m-2", owner: "page-a", ttl: 30 });
    assert.equal(short.body.claimed, true);
    await new Promise(resolve => setTimeout(resolve, 60));
    const again = await post("/api/mail/claim", { id: "m-2", owner: "page-b", ttl: 30 });
    assert.equal(again.body.claimed, true);
    assert.equal(again.body.letter.claim.owner, "page-b");
    // 同一人租期内续领只延租期、不数次数
    const renew = await post("/api/mail/claim", { id: "m-2", owner: "page-b", ttl: 30 });
    assert.equal(renew.body.letter.claims, 2);
    // 过期再领才数：反复领了不办事，第九回记死，等信与再领都不再送它
    for (let round = 0; round < 7; round += 1) {
      await new Promise(resolve => setTimeout(resolve, 60));
      await post("/api/mail/claim", { id: "m-2", owner: "page-b", ttl: 30 });
    }
    const dead = await post("/api/mail/claim", { id: "m-2", owner: "page-b", ttl: 30 });
    assert.equal(dead.body.dead, true);
    assert.equal((await post("/api/mail/wait", {})).body.letters.length, 0);
  } finally {
    close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("信箱：回执先记簿后销正本；带着回执的残信不再送、领不走", async () => {
  const home = tmpHome(),
    { post, close } = await serve(home, { waitMs: 200 });
  try {
    await post("/api/mail/post", { to: "conv-1", msgId: "m-9", payload: "一" });
    await post("/api/mail/claim", { id: "m-9", owner: "page-a" });
    assert.equal((await post("/api/mail/ack", { id: "m-9", owner: "page-a" })).body.ok, true);
    // 模拟先记簿后销正本半途崩的：回执簿里有号、正本又回来了
    fs.writeFileSync(
      path.join(home, "m-9.json"),
      JSON.stringify({ id: "m-9", to: "conv-1", payload: "残", status: "claimed", claims: 1, claim: { owner: "page-a", at: 1, until: Date.now() + 60000 } })
    );
    assert.equal((await post("/api/mail/wait", {})).body.letters.length, 0);
    const claim = await post("/api/mail/claim", { id: "m-9", owner: "page-b" });
    assert.equal(claim.body.claimed, false);
    assert.equal(claim.body.gone, "acked");
    // 同号再投照样判重
    assert.equal((await post("/api/mail/post", { to: "conv-1", msgId: "m-9", payload: "再来" })).body.dup, true);
  } finally {
    close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("信箱：回执簿读不动宁可错回，绝不拿空簿抹掉旧回执", async () => {
  const home = tmpHome(),
    { post, close } = await serve(home, { waitMs: 200 });
  try {
    await post("/api/mail/post", { to: "conv-1", msgId: "m-a", payload: "一" });
    await post("/api/mail/post", { to: "conv-1", msgId: "m-b", payload: "二" });
    await post("/api/mail/claim", { id: "m-a", owner: "page-a" });
    await post("/api/mail/ack", { id: "m-a", owner: "page-a" });
    await post("/api/mail/claim", { id: "m-b", owner: "page-a" });
    // 把簿写坏（半截 JSON——EBUSY 一类读败同一路数）：回执、等信、再投都得当场错回，不能当空簿办事
    fs.writeFileSync(path.join(home, "acked-ids.json"), "{不是json");
    const ack = await post("/api/mail/ack", { id: "m-b", owner: "page-a" });
    assert.ok(ack.body.error);
    assert.equal(ack.body.ok, undefined);
    // 簿原样留着（没拿空集把 m-a 抹掉）、正本还在等再回执
    assert.equal(fs.readFileSync(path.join(home, "acked-ids.json"), "utf8"), "{不是json");
    assert.equal(fs.existsSync(path.join(home, "m-b.json")), true);
    assert.ok((await post("/api/mail/wait", {})).body.error);
    assert.ok((await post("/api/mail/post", { to: "conv-1", msgId: "m-a", payload: "重放" })).body.error);
    // 修好后照常：两个号都在簿里
    fs.writeFileSync(path.join(home, "acked-ids.json"), JSON.stringify({ 言: "信箱 · 回执簿", ids: ["m-a"] }));
    assert.equal((await post("/api/mail/ack", { id: "m-b", owner: "page-a" })).body.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "acked-ids.json"), "utf8")).ids, ["m-a", "m-b"]);
    assert.equal(fs.existsSync(path.join(home, "m-b.json")), false);
  } finally {
    close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("信箱：重启桥接（同目录另起一份）未回执的信原样可领，已回执的判重", async () => {
  const home = tmpHome(),
    first = await serve(home, { waitMs: 200 });
  try {
    await first.post("/api/mail/post", { to: "conv-1", msgId: "m-old", payload: "留着" });
    await first.post("/api/mail/post", { to: "conv-1", msgId: "m-done", payload: "办过" });
    await first.post("/api/mail/claim", { id: "m-done", owner: "page-a" });
    await first.post("/api/mail/ack", { id: "m-done", owner: "page-a" });
  } finally {
    first.close();
  }
  const second = await serve(home, { waitMs: 200 });
  try {
    const { letters } = (await second.post("/api/mail/wait", {})).body;
    assert.deepEqual(
      letters.map(letter => letter.id),
      ["m-old"]
    );
    assert.equal((await second.post("/api/mail/post", { to: "conv-1", msgId: "m-done", payload: "重放" })).body.dup, true);
    assert.equal((await second.post("/api/mail/claim", { id: "m-old", owner: "page-b" })).body.claimed, true);
  } finally {
    second.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
