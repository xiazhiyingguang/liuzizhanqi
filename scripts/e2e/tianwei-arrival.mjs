import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build, preview } from 'vite';
import { getFreePort, launchBrowser } from './browser-harness.mjs';

const out = 'reports/tianwei-arrival', directory = `${out}/e2e-build`;
process.env.VITE_E2E = 'true';
if (!process.argv.includes('--skip-build')) await build({ define: { 'import.meta.env.VITE_E2E': '"true"' }, build: { outDir: directory },
    plugins: [{ name: 'offline-test-fonts', transformIndexHtml: html => html.replace(/<link[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '') }] });
const server = await preview({ build: { outDir: directory }, preview: { port: await getFreePort(), host: '127.0.0.1', strictPort: true, open: false } });
let session, remote;
const checks = [], records = [];
const check = label => { checks.push(label); console.log('PASS', label); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
mkdirSync(out, { recursive: true });
try {
    const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
    session = await launchBrowser({ baseUrl, label: 'tianwei-arrival' });
    const page = session.page;
    await page.evaluate('window.__REAL_NOW__=Date.now;window.__SIX_CHESS_E2E__.setBattleSoundMuted(true)');
    const prepare = async mode => {
        await page.evaluate(`Date.now=window.__REAL_NOW__;window.__SIX_CHESS_E2E__.prepareTianweiArrivalDemo(${JSON.stringify(mode)})`);
        await delay(40);
        await page.evaluate('window.__SIX_CHESS_E2E__.castTianweiArrivalDemo()');
    };
    const screenshot = async (name, ms) => {
        await page.evaluate(`(() => {const s=window.__SIX_CHESS_STORE__,all=s.getState().skillFx;const event=all.find(e=>e.profile.arrival);
            Date.now=()=>event.bornAt+${ms};s.setState({skillFx:[...all]});for(const a of document.getAnimations()){a.pause();a.currentTime=${ms};}})()`);
        await delay(60);
        writeFileSync(`${out}/${name}.png`, Buffer.from(await page.screenshot(), 'base64'));
    };
    const eventData = client => client.evaluate(`window.__SIX_CHESS_STORE__.getState().skillFx.filter(e=>e.profile.arrival).map(e=>({id:e.skillId,
        kind:e.profile.arrival,source:e.sourceHeroId,from:e.fromPos,to:e.targetPos,target:e.arrival.targetHeroId}))`);
    for (const mode of ['frost', 'monkey', 'monkey-clone-kill', 'frost-edge', 'monkey-edge']) {
        await prepare(mode);
        await page.waitForExpression('document.querySelectorAll(".tw-scene").length===1', mode);
        const events = await eventData(page); assert.equal(events.length, 1);
        assert.ok(events[0].source.startsWith(mode.startsWith('frost') ? 'feixue' : 'wukong'));
        await screenshot(`${mode}-travel`, 230);
        if (!mode.startsWith('frost')) assert.equal(await page.evaluate('document.querySelectorAll(".tw-arrival-clone-hidden").length'), 1);
        await screenshot(`${mode}-arrival`, mode.startsWith('frost') ? 650 : 600);
        if (!mode.startsWith('frost')) {
            assert.equal(await page.evaluate(`(() => {const glyph=document.querySelector('.tw-monkey-figure svg');
                const cell=document.querySelector('.battle-board-cell');return glyph.getBoundingClientRect().width < cell.getBoundingClientRect().width * 1.2;})()`), true, '凝形剪影不能扩成全棋盘大图');
        }
        await screenshot(`${mode}-settled`, 850);
        assert.equal(await page.evaluate('document.querySelectorAll(".tw-arrival-clone-hidden").length'), 0);
        if (mode.startsWith('frost')) {
            assert.equal(await page.evaluate('window.__SIX_CHESS_STORE__.getState().player2Heroes[1].currentHp'), 18);
            assert.equal(await page.evaluate('document.querySelectorAll(".sfx-frozen").length'), 1);
        }
        records.push({ mode, events }); check(`${mode}：真实击杀、正确目标、飞行与凝形衔接`);
    }
    for (const mode of ['frost-empty', 'frost-paralyzed', 'monkey-full', 'monkey-blocked']) {
        await prepare(mode); await delay(70);
        assert.equal((await eventData(page)).length, 0);
        assert.equal(await page.evaluate('document.querySelectorAll(".tw-scene").length'), 0);
        check(`${mode}：无生效不播放`);
    }
    remote = await launchBrowser({ baseUrl, label: 'tianwei-arrival-remote' });
    await remote.page.evaluate('window.__SIX_CHESS_E2E__.setBattleSoundMuted(true)');
    for (const mode of ['frost', 'monkey']) {
        await prepare(mode);
        const snapshot = await page.evaluate('window.__SIX_CHESS_E2E__.tianweiArrivalSnapshot()');
        const local = await eventData(page);
        await remote.page.evaluate(`window.__SIX_CHESS_E2E__.prepareTianweiArrivalDemo(${JSON.stringify(mode)});
            window.__SIX_CHESS_E2E__.replayTianweiArrivalSnapshot(${JSON.stringify(snapshot)})`);
        await remote.page.waitForExpression('document.querySelectorAll(".tw-scene").length===1', '对端场景');
        assert.deepEqual(await eventData(remote.page), local);
        check(`${mode}：双浏览器 JSON 快照复现同一目标与场景`);
    }
    await page.evaluate('Date.now=window.__REAL_NOW__');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await page.evaluate('window.__SIX_CHESS_E2E__.setQualityMode("low")');
    for (const mode of ['frost', 'monkey']) { await prepare(mode); await screenshot(`mobile-${mode}`, 600); }
    check('手机横屏低画质：两种主体特效保留');
    await page.evaluate('Date.now=window.__REAL_NOW__');
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await prepare('monkey'); await delay(50);
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".tw-arrival-clone-hidden")??document.querySelector(".board-hero-content")).visibility'), 'visible');
    check('减少动态效果：真实分身不被隐藏');
    assert.deepEqual(page.errors, []); assert.deepEqual(remote.page.errors, []);
    writeFileSync(`${out}/result.json`, JSON.stringify({ checks, records, note: '独立端口、真实结算；手机是桌面 Chromium 布局模拟，双浏览器直接复现权威 JSON 快照而非房间传输测试' }, null, 2));
} finally {
    await remote?.close(); await session?.close();
    server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve));
}
