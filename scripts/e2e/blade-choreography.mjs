import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build, preview } from 'vite';
import { getFreePort, launchBrowser } from './browser-harness.mjs';

const out = 'reports/blade-choreography';
const buildDirectory = `${out}/e2e-build`;
process.env.VITE_E2E = 'true';
if (!process.argv.includes('--skip-build')) await build({ define: { 'import.meta.env.VITE_E2E': '"true"' }, build: { outDir: buildDirectory },
    plugins: [{ name: 'offline-test-fonts', transformIndexHtml: html => html.replace(/<link[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '') }] });
const server = await preview({ build: { outDir: buildDirectory }, preview: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false } });
let session;
const checks = [], frames = [];
const check = label => { checks.push(label); console.log(`PASS ${label}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
mkdirSync(out, { recursive: true });
try {
    const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
    session = await launchBrowser({ baseUrl, label: 'blade-choreography' });
    const page = session.page;
    await page.evaluate('window.__REAL_DATE_NOW__=Date.now;window.__SIX_CHESS_E2E__.setBattleSoundMuted(true)');
    const stage = async mode => {
        await page.evaluate(`Date.now=window.__REAL_DATE_NOW__;window.__SIX_CHESS_E2E__.prepareBladeDemo(${JSON.stringify(mode)})`);
        await delay(50);
        await page.evaluate(`window.__SIX_CHESS_E2E__.castBladeDemo(${JSON.stringify(mode)})`);
        const legacy = ['cuts', 'weapon', 'lethal', 'auto'].includes(mode);
        await page.waitForExpression(legacy
            ? 'window.__SIX_CHESS_STORE__.getState().skillFx.some(e=>e.skillId==="huifeng_skill1" && e.profile.kind==="triple-slash" && !e.profile.choreography)'
            : 'window.__SIX_CHESS_STORE__.getState().skillFx.some(e=>e.choreography)', `真实事件 ${mode}`);
    };
    const shot = async (name, at) => {
        const data = await page.evaluate(`(() => { const all=window.__SIX_CHESS_STORE__.getState().skillFx;const custom=all.filter(e=>e.choreography);const fx=custom.length?custom:all;
            const at=Math.max(...fx.map(e=>e.bornAt))+${at};Date.now=()=>at;
            for(const a of document.getAnimations()){a.pause();a.currentTime=${at};}
            return fx.map(e=>({scene:e.choreography?.scene??e.profile.kind,paths:e.choreography?.strokes.length??0,logIds:e.logIds}));})()`);
        await delay(70);
        writeFileSync(`${out}/${name}.png`, Buffer.from(await page.screenshot(), 'base64'));
        frames.push({ name, at, events: data });
    };
    for (const mode of ['leap', 'drift', 'recall', 'attach', 'volley', 'order', 'reward', 'cuts', 'weapon', 'mark', 'lethal', 'auto']) {
        await stage(mode);
        const events = await page.evaluate('window.__SIX_CHESS_STORE__.getState().skillFx.filter(e=>e.choreography).map(e=>({scene:e.choreography.scene,source:e.sourceHeroId,strokes:e.choreography.strokes}))');
        const expected = ['weapon', 'mark', 'lethal', 'auto'].includes(mode) ? 'cuts' : mode;
        const legacy = ['cuts', 'weapon', 'lethal', 'auto'].includes(mode);
        if (legacy) {
            assert.equal(events.length, 0, '技能一不叠加新飞刃');
            const hits = await page.evaluate('window.__SIX_CHESS_STORE__.getState().battleLog.filter(log=>log.type==="damage"&&log.details?.sourceHeroId===window.__SIX_CHESS_STORE__.getState().player1Heroes[0].id).length');
            if (mode === 'cuts') assert.equal(hits, 3);
            if (mode === 'weapon') assert.equal(hits, 4);
            if (mode === 'lethal') assert.equal(hits, 1);
        } else assert.ok(events.some(e => e.scene === expected), mode);
        if (mode === 'reward') assert.ok(events.find(e => e.scene === 'reward').source.startsWith('moran'));
        await shot(mode, ['order', 'reward'].includes(mode) ? mode === 'reward' ? 660 : 470 : mode === 'cuts' || mode === 'weapon' ? 330 : 240);
        assert.equal(await page.evaluate('document.querySelectorAll(".bc-scene").length'), events.length);
        check(`${mode}：${legacy ? '保留技能一旧三连斩，不叠加新飞刃' : '真实事件、单场景与逐段画面'}`);
    }
    await page.evaluate('Date.now=window.__REAL_DATE_NOW__');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await page.evaluate('window.__SIX_CHESS_E2E__.setQualityMode("low")');
    await stage('auto');
    const perf = await page.evaluate(`new Promise(resolve=>{ const times=[],start=performance.now();let last=start;
        const step=now=>{times.push(now-last);last=now;if(now-start<1100)requestAnimationFrame(step);else resolve({frames:times.length,
            p95:times.slice().sort((a,b)=>a-b)[Math.floor(times.length*.95)],max:Math.max(...times),nodes:document.querySelectorAll('.bc-scene *').length});};requestAnimationFrame(step);})`);
    await shot('mobile-auto', 330);
    assert.ok(perf.frames >= 10, '模拟手机连锁不应冻结页面');
    check('手机低画质：自动连锁持续响应，保留剑路');
    await page.evaluate('Date.now=window.__REAL_DATE_NOW__');
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await stage('leap');
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".bc-traveller")).opacity'), '0');
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".bc-actor-hidden") ?? document.querySelector(".board-hero-content")).visibility'), 'visible');
    check('减少动态效果：无位移闪动，真实棋子保持可见');
    assert.deepEqual(page.errors, []);
    writeFileSync(`${out}/result.json`, JSON.stringify({ checks, frames, perf, note: '桌面 Chromium 移动布局模拟，非手机真机性能结论' }, null, 2));
    console.log('PERF', JSON.stringify(perf));
} finally {
    if (session) await session.close();
    server.httpServer.closeAllConnections();
    await new Promise(resolve => server.httpServer.close(resolve));
}
