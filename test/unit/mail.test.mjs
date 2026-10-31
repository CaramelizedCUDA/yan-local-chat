// 桥接的信与候（server/mail.js）：寄信认收信的对话、几页同等只一页认领到、时刻到寄信、周期排下一回、重启后补叫并记迟了多久
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createMail = createRequire(import.meta.url)("../../server/mail.js");

async function serve(home, known = id => id === "c1") {
  const mail = createMail({ home: () => home, known });
  const server = http.createServer((req, res) => mail.routes[`POST ${req.url}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(async r => ({
      status: r.status,
      ...(await r.json())
    }));
  return { post, close: () => new Promise(resolve => server.close(resolve)) };
}

test("寄信：认得的对话才收，信落盘等页面来取；两页同时认领只一页拿到", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-mail-"));
  const { post, close } = await serve(home);
  try {
    assert.equal((await post("/api/mail", { to: "nope", text: "x" })).status, 400);
    assert.equal((await post("/api/mail", { to: "c1", text: "" })).status, 400);
    const sent = await post("/api/mail", { to: "c1", from: "CI", text: "构建失败" });
    assert.equal(sent.ok, true);
    const { letters } = await post("/api/mail/wait", {});
    assert.equal(letters.length, 1);
    assert.deepEqual([letters[0].to, letters[0].from, letters[0].text, letters[0].kind], ["c1", "CI", "构建失败", "letter"]);
    const [a, b] = await Promise.all([post("/api/mail/take", { ids: [sent.id] }), post("/api/mail/take", { ids: [sent.id] })]);
    assert.equal(a.letters.length + b.letters.length, 1);
    assert.equal(fs.readdirSync(path.join(home, "待收")).length, 0);
  } finally {
    await close();
  }
});

test("等信：跳过的那几封不回，新信一到就回", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-mail-"));
  const { post, close } = await serve(home);
  try {
    const first = await post("/api/mail", { to: "c1", text: "一" });
    const waiting = post("/api/mail/wait", { skip: [first.id] });
    await new Promise(resolve => setTimeout(resolve, 200));
    await post("/api/mail", { to: "c1", text: "二" });
    const { letters } = await waiting;
    assert.deepEqual(
      letters.map(letter => letter.text),
      ["二"]
    );
  } finally {
    await close();
  }
});

test("候：到点寄一封 timer 信；every 的排到下一回；取消了的不再叫；对话已删的连同周期一并撤去", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-mail-"));
  const { post, close } = await serve(home);
  try {
    const once = await post("/api/timer/set", { to: "c1", step: "s1", note: "看一眼", due: Date.now() + 150 });
    const every = await post("/api/timer/set", { to: "c1", step: "s2", note: "周期", due: Date.now() + 150, every: 60000 });
    const gone = await post("/api/timer/set", { to: "c1", step: "s3", note: "取消的", due: Date.now() + 150 });
    await post("/api/timer/set", { to: "deleted", step: "s4", note: "对话已删", due: Date.now() + 150, every: 60000 });
    assert.deepEqual([once.id, every.id, gone.id], ["t1", "t2", "t3"]);
    assert.equal((await post("/api/timer/cancel", { id: "t3" })).found, true);
    await new Promise(resolve => setTimeout(resolve, 400));
    const { letters } = await post("/api/mail/wait", {});
    const timers = letters.map(letter => letter.timer).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(
      timers.map(timer => [timer.id, timer.step, timer.note]),
      [
        ["t1", "s1", "看一眼"],
        ["t2", "s2", "周期"]
      ]
    );
    assert.ok(timers[1].next > Date.now() + 50000, "every 的下一回排在一分钟后");
    const { timers: left } = await post("/api/timer/list", {});
    assert.deepEqual(
      left.map(timer => timer.id),
      ["t2"]
    );
  } finally {
    await close();
  }
});

test("候：桥接重启后读回，错过的当场补叫并记下迟了多久；编号接着往下数", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-mail-"));
  fs.writeFileSync(
    path.join(home, "候.json"),
    JSON.stringify({ seq: 4, timers: [{ id: "t4", to: "c1", step: "s4", note: "早该叫了", due: Date.now() - 3600000, created: 0 }] })
  );
  const { post, close } = await serve(home);
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const { letters } = await post("/api/mail/wait", {});
    assert.equal(letters.length, 1);
    assert.ok(letters[0].timer.late >= 3600000);
    assert.equal((await post("/api/timer/set", { to: "c1", note: "下一个", due: Date.now() + 60000 })).id, "t5");
  } finally {
    await close();
  }
});
