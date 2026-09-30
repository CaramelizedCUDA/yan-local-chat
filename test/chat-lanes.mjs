// 十二条主任务 / 帮手模型流同时挂着，发送前目录检查和配置读取仍须立即响应。
import { connect, check, PAGE, WORK } from "./lib.mjs";

const { send, evalJs, waitFor, close } = await connect();
try {
  await send("Page.navigate", { url: PAGE });
  await waitFor("document.readyState === 'complete'");
  const { chatBases: bases, toolBase } = await evalJs("fetch('/api/bootstrap').then(r => r.json())");
  check("bridge advertises three local chat lanes", Array.isArray(bases) && bases.length === 3);
  check("tool requests use another local browser connection pool", new URL(toolBase).hostname !== "127.0.0.1");
  await evalJs(`(() => {
    const bases = ${JSON.stringify(bases)};
    const controller = new AbortController();
    window.__chatStress = { controller, responses: [], errors: [], toolResponses: [], toolErrors: [] };
    for (let i = 0; i < 12; i++)
      fetch(bases[i % bases.length] + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { baseUrl: 'http://127.0.0.1:8798/v1', model: 'fake', apiKey: 'k' }, messages: [{ role: 'user', content: 'HOLDSTREAM ' + i }] }),
        signal: controller.signal
      }).then(response => { window.__chatStress.responses[i] = response; }, error => { window.__chatStress.errors[i] = String(error); });
    return true;
  })()`);
  await waitFor("window.__chatStress.responses.filter(Boolean).length + window.__chatStress.errors.filter(Boolean).length === 12", 5000);
  check("twelve model streams start without waiting for another stream to finish", await evalJs("window.__chatStress.responses.filter(Boolean).length === 12"), await evalJs("window.__chatStress.errors.join(' | ')"));
  const controlScript = `(async () => {
    const started = performance.now();
    const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(2500) });
    const results = await Promise.all([
      post('/api/work/prepare', { workdir: ${JSON.stringify(WORK)} }),
      post('/api/store/config/load', {}),
      post('/api/chats/lease', { owner: 'stress-test', ids: [] })
    ]);
    return { statuses: results.map(r => r.status), elapsed: Math.round(performance.now() - started) };
  })()`;
  const control = await evalJs(controlScript);
  check("work, config and lease requests stay responsive during twelve streams", control.statuses.every(status => status === 200) && control.elapsed < 2500, JSON.stringify(control));
  await evalJs(`(() => {
    for (let i = 0; i < 6; i++)
      fetch(${JSON.stringify(toolBase)} + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { baseUrl: 'http://127.0.0.1:8798/v1', model: 'fake', apiKey: 'k' }, messages: [{ role: 'user', content: 'HOLDSTREAM tool-' + i }] }),
        signal: window.__chatStress.controller.signal
      }).then(response => { window.__chatStress.toolResponses[i] = response; }, error => { window.__chatStress.toolErrors[i] = String(error); });
    return true;
  })()`);
  await waitFor("window.__chatStress.toolResponses.filter(Boolean).length + window.__chatStress.toolErrors.filter(Boolean).length === 6", 5000);
  check("six requests on the tool origin can run beside model streams", await evalJs("window.__chatStress.toolResponses.filter(Boolean).length === 6"), await evalJs("window.__chatStress.toolErrors.join(' | ')"));
  const controlWithTools = await evalJs(controlScript);
  check("control requests stay responsive when model and tool origins are both busy", controlWithTools.statuses.every(status => status === 200) && controlWithTools.elapsed < 2500, JSON.stringify(controlWithTools));
} finally {
  await evalJs("window.__chatStress?.controller.abort(); true").catch(() => {});
  close();
}
