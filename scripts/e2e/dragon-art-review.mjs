import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser-harness.mjs';

const out = 'reports/longshi-original-dragon';
mkdirSync(out, { recursive: true });
const root = process.cwd();
const html = `<!doctype html><meta charset="utf-8"><script>window.__SIX_CHESS_E2E__={}</script>
<link rel="stylesheet" href="/src/styles/ink-wash.css">
<style>body{margin:0;background:#eee9df;color:#3a3934;font:16px sans-serif}main{padding:50px;display:grid;grid-template-columns:1fr 1fr;gap:30px}section{padding:20px;background:#f7f2e7;min-height:370px}h2{font-size:18px}img.art{width:100%;height:320px;object-fit:contain}.samples{display:flex;align-items:center;justify-content:center;gap:65px;height:250px}.piece{width:100%;height:100%;border:2px solid #627797;border-radius:8px;box-sizing:border-box}.piece-shell{flex:none}.hero-piece-avatar{width:100%;height:100%;object-fit:cover;border-radius:6px}.bottom{grid-column:span 2;min-height:0}</style>
<main><section><h2>原图中的龙（含原有头发和纸底）</h2><img class="art" src="/public/fx/_dragon-crop.png"></section><section><h2>原图描摹的矢量墨龙</h2><img class="art" src="/public/fx/zhenxiao-dragon-crown.svg"></section><section class="bottom"><h2>棋子尺寸 / 放大检查</h2><div class="samples">${[56,100,220].map(size=>`<div class="piece-shell" style="width:${size}px;height:${size}px"><div class="piece"><img class="hero-piece-avatar" src="/public/hero-images/avatars/震霄.png"></div><span class="status-fx sfx-longshi"><img class="sfx-longshi-dragon" src="/public/fx/zhenxiao-dragon-crown.svg"></span></div>`).join('')}</div></section></main>`;
const server = createServer((request,response)=>{
    if(request.url==='/'){response.setHeader('content-type','text/html; charset=utf-8');response.end(html);return;}
    const file = path.resolve(root, '.'+decodeURIComponent(request.url.split('?')[0]));
    if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
    try{response.setHeader('content-type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.css')?'text/css':'image/png');response.end(readFileSync(file));}catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let session;
try{
    session = await launchBrowser({baseUrl:`http://127.0.0.1:${server.address().port}`,label:'dragon-art-review'});
    await session.page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await session.page.waitForExpression('Array.from(document.images).every(img=>img.complete && img.naturalWidth>0)','原图与矢量加载');
    await new Promise(resolve=>setTimeout(resolve,300));
    writeFileSync(`${out}/comparison.png`,Buffer.from(await session.page.screenshot(),'base64'));
    console.log('Saved reference comparison.');
}finally{
    await session?.page.send('Browser.close').catch(()=>{});
    await session?.close();
    await new Promise(resolve=>server.close(resolve));
}
