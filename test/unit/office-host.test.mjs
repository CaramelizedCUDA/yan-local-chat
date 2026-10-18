import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../../server/office-host.html", import.meta.url), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];

function host(t) {
  const listeners = {},
    elements = {},
    timers = new Set();
  const editor = { text: "", dirty: false, readonly: false, exports: 0, failReadonly: false };
  const disk = { text: "base", sig: "base", fail: false, post: null };
  const copies = [];
  const emit = (type, payload, id, source = frame.contentWindow) =>
    listeners.message({ origin: "http://127.0.0.1:9002", source, data: { type, payload, id } });
  const dirty = value => {
    if (editor.dirty !== value) {
      editor.dirty = value;
      emit("document:dirty-changed", { dirty: value });
    }
  };
  const frame = {
    contentWindow: {
      postMessage({ type, id, payload }) {
        queueMicrotask(() => {
          if (type === "document:open-buffer") {
            editor.text = new TextDecoder().decode(payload.buffer);
            editor.dirty = false;
            editor.readonly = !!payload.readonly;
            emit("document:opened", {}, id);
          } else if (type === "document:save") {
            editor.exports++;
            const file = new File([editor.text], "test.docx");
            dirty(false);
            emit("document:saved", { file, dirty: false }, id);
          } else if (type === "document:set-readonly") {
            if (editor.failReadonly && payload.readonly) return emit("document:error", { message: "readonly failed" }, id);
            editor.readonly = !!payload.readonly;
            emit("document:readonly-changed", {}, id);
          }
        });
      }
    }
  };
  const context = vm.createContext({
    URLSearchParams,
    URL: {
      createObjectURL: blob => {
        copies.push(blob);
        return "blob:copy";
      },
      revokeObjectURL() {}
    },
    Blob,
    console,
    location: { search: "?t=token", origin: "http://127.0.0.1:9002" },
    localStorage: { setItem() {} },
    document: {
      body: { classList: { add() {} }, append() {} },
      createElement: name => (name === "iframe" ? frame : { click() {} }),
      getElementById: id => (elements[id] ||= { classList: { toggle() {} }, textContent: "" }),
      addEventListener() {}
    },
    window: {
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      }
    },
    addEventListener() {},
    EventSource: class {},
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, ms).unref();
      timers.add(timer);
      return timer;
    },
    clearTimeout,
    officePrepare: async bytes => bytes,
    fetch: async (route, options) => {
      if (route.startsWith("/yan/sig")) return new Response(JSON.stringify({ sig: disk.sig }));
      if (!options?.method)
        return new Response(disk.text, { headers: { "X-Yan-Name": "test.docx", "X-Yan-Sig": disk.sig, "X-Yan-Locked": "0" } });
      if (disk.post) await disk.post;
      if (disk.fail) return new Response(JSON.stringify({ error: "file is in use" }), { status: 500 });
      if (new URL(route, "http://127.0.0.1:9002").searchParams.get("seen") !== disk.sig)
        return new Response(JSON.stringify({ stale: true, sig: disk.sig }), { status: 409 });
      disk.text = new TextDecoder().decode(options.body);
      disk.sig = disk.text;
      return new Response(JSON.stringify({ sig: disk.sig }));
    }
  });
  vm.runInContext(source, context);
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
  });
  return {
    editor,
    disk,
    emit,
    copies,
    load: () => context.load(),
    save: () => context.save(),
    saveCopy: () => context.saveCopy(),
    obey: cmd => context.obey(cmd),
    edit: text => {
      editor.text = text;
      dirty(true);
    },
    state: () =>
      vm.runInContext("({ dirty: state.dirty, locked: state.locked, pending: !!state.pending, conflict: state.conflict })", context),
    note: () => elements.noteText?.textContent
  };
}

test("Office 冲突后保留编辑和导出内容，解锁不会自动载入原件", async t => {
  const h = host(t);
  await h.load();
  h.edit("user edits");
  h.disk.text = "external";
  h.disk.sig = "external";
  await assert.rejects(h.save(), /在别处被改过/);
  assert.equal(h.state().dirty, true);
  assert.equal(h.state().pending, true);
  await assert.rejects(h.obey("lock"), /在别处被改过/);
  await h.obey("unlock");
  assert.equal(h.editor.text, "user edits");
  assert.equal(h.disk.text, "external");
  assert.equal(h.state().dirty, true);
  assert.match(h.note(), /在别处被改过/);
});

test("Office 冲突后继续编辑，另存副本取最新内容", async t => {
  const h = host(t);
  await h.load();
  h.edit("first");
  h.disk.sig = "changed";
  await assert.rejects(h.save());
  h.edit("latest edit");
  await h.saveCopy();
  assert.equal(await h.copies[0].text(), "latest edit");
  assert.equal(h.state().dirty, true);
});

test("Office Windows 占用等保存失败后，使用已导出的内容重试", async t => {
  const h = host(t);
  await h.load();
  h.edit("user edits");
  h.disk.fail = true;
  await assert.rejects(h.save(), /file is in use/);
  assert.equal(h.state().dirty, true);
  assert.equal(h.state().pending, true);
  h.disk.fail = false;
  await h.save();
  assert.equal(h.editor.exports, 1);
  assert.equal(h.disk.text, "user edits");
  assert.equal(h.state().dirty, false);
  assert.equal(h.state().pending, false);
});

test("Office 存盘期间的新编辑不会被旧存盘结果标成已保存", async t => {
  const h = host(t);
  await h.load();
  h.edit("first");
  let release;
  h.disk.post = new Promise(resolve => (release = resolve));
  const saving = h.save();
  await new Promise(resolve => setImmediate(resolve));
  h.edit("second");
  release();
  await saving;
  assert.equal(h.disk.text, "first");
  assert.equal(h.state().dirty, true);
  h.disk.post = null;
  await h.save();
  assert.equal(h.disk.text, "second");
  assert.equal(h.state().dirty, false);
});

test("Office 只读设置失败会回报错误，不能当成锁定成功", async t => {
  const h = host(t);
  await h.load();
  h.editor.failReadonly = true;
  await assert.rejects(h.obey("lock"), /readonly failed/);
  await h.obey("unlock");
  assert.equal(h.editor.readonly, false);
});

test("Office 同源的其他窗口也不能伪造编辑器状态", async t => {
  const h = host(t);
  await h.load();
  h.emit("document:dirty-changed", { dirty: true }, null, {});
  assert.equal(h.state().dirty, false);
});
