import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const createChats = createRequire(import.meta.url)("../../server/chats.js");

test("两页同时认领同一段对话：先到的得手，后到的看见它已有主、自己的报到不记", async () => {
  const lease = createChats({ chatsHome: () => "" }).routes["POST /api/chats/lease"];
  const server = http.createServer((req, res) => lease(req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = body =>
    fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  try {
    const first = await post({ owner: "A", ids: ["c"], claim: "c" });
    const second = await post({ owner: "B", ids: ["c"], claim: "c" });
    assert.deepEqual(first.busy, []);
    assert.deepEqual(second.busy, ["c"]);
    // B 让开了：A 的报到里看不到 B 握着 c
    assert.deepEqual((await post({ owner: "A", ids: ["c"] })).busy, []);
  } finally {
    server.close();
  }
});
