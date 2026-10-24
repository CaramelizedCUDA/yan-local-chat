// HTML 的延迟加载不可借后来的 PDF iframe 脱离沙箱；CSV 的换行字段在真实预览里仍是一格。
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(ARCHIVE, { recursive: true });
const source = `<html><body>test<script>try{parent.__auditEscape=parent.localStorage.getItem('audit-owned-value');parent.postMessage({type:'audit-proof',blocked:false},'*')}catch(e){parent.postMessage({type:'audit-proof',blocked:e.name==='SecurityError'},'*')}</script></body></html>`;
writeFileSync(`${ARCHIVE}/control.html`, source);
writeFileSync(`${ARCHIVE}/slow.html`, source);
writeFileSync(`${ARCHIVE}/current.pdf`, "%PDF-1.4\n%%EOF\n");
writeFileSync(`${ARCHIVE}/multiline.csv`, 'name,note\r\nAlice,"first\nsecond"\r\nBob,ok\r\n');
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(400);
await evalJs(`localStorage.clear(); localStorage.setItem('audit-owned-value','own-test');true`);
await send("Page.navigate", { url: PAGE });
await waitFor(`typeof document.querySelector('#openLibrary')?.onclick==='function'`);
await evalJs(
  `window.__auditProofs=[];window.addEventListener('message',e=>{if(e.data?.type==='audit-proof')window.__auditProofs.push(e.data)});document.querySelector('#openLibrary').click();true`
);
await waitFor(`!!document.querySelector('[data-library-disk="control.html"]')`);
const open = name => evalJs(`document.querySelector('[data-library-disk="${name}"]').click();true`);
try {
  await open("control.html");
  await waitFor(`window.__auditProofs.length===1`);
  check("normal HTML stays interactive inside the sandbox", await evalJs(`__auditProofs[0].blocked && !window.__auditEscape`));
  await evalJs(
    `document.querySelector('#fileViewerClose').click();(()=>{const native=window.fetch;window.fetch=(input,init)=>{if(String(input).includes('/api/archive/file?')&&String(input).includes('slow.html')){window.fetch=native;return new Promise((resolve,reject)=>window.__auditRelease=()=>native(input,init).then(resolve,reject));}return native(input,init);};})();true`
  );
  await open("slow.html");
  await waitFor(`typeof window.__auditRelease==='function'`);
  await evalJs(`document.querySelector('#fileViewerClose').click();true`);
  await open("current.pdf");
  await waitFor(`!!document.querySelector('#fileViewerStage iframe[src*="current.pdf"]')`);
  const before = await evalJs(`document.querySelector('#fileViewerStage iframe').src`);
  await evalJs(`window.__auditRelease();true`);
  await sleep(500);
  check(
    "late HTML cannot replace the PDF or read the parent storage",
    await evalJs(
      `document.querySelector('#fileViewerStage iframe').src===${JSON.stringify(before)}&&!window.__auditEscape&&__auditProofs.length===1`
    )
  );
  await evalJs(`document.querySelector('#fileViewerClose').click();true`);
  await open("multiline.csv");
  await waitFor(`!!document.querySelector('#fileViewerStage tbody')`);
  check(
    "multiline CSV keeps two records and the complete quoted cell",
    await evalJs(
      `document.querySelectorAll('#fileViewerStage tbody tr').length===2&&document.querySelector('#fileViewerStage tbody tr td:nth-child(2)').textContent===${JSON.stringify("first\nsecond")}`
    )
  );
  await evalJs(`document.querySelector('#fileViewerClose').click();true`);
} finally {
  close();
}
