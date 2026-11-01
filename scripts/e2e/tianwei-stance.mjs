import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build, preview } from 'vite';
import { getFreePort, launchBrowser } from './browser-harness.mjs';

const out = 'reports/tianwei-stance', directory = `${out}/e2e-build`;
process.env.VITE_E2E = 'true';
if (!process.argv.includes('--skip-build')) await build({ define: { 'import.meta.env.VITE_E2E': '"true"' }, build: { outDir: directory },
    plugins: [{ name: 'offline-test-fonts', transformIndexHtml: html => html.replace(/<link[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '') }] });
const server = await preview({ build: { outDir: directory }, preview: { port: await getFreePort(), host: '127.0.0.1', strictPort: true, open: false } });
let session, remote;
const checks = [], check = label => { checks.push(label); console.log('PASS', label); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
mkdirSync(out, { recursive: true });
try {
    const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
    session = await launchBrowser({ baseUrl, label: 'tianwei-stance' }); const page = session.page;
    await page.evaluate('window.__REAL_NOW__=Date.now;window.__SIX_CHESS_E2E__.setBattleSoundMuted(true)');
    const prepare = async mode => {
        await page.evaluate(`Date.now=window.__REAL_NOW__;window.__SIX_CHESS_E2E__.prepareTianweiArrivalDemo(${JSON.stringify(mode)})`);
        await delay(40); await page.evaluate(`window.__SIX_CHESS_E2E__.castTianweiArrivalDemo();
            {const s=window.__SIX_CHESS_STORE__;s.setState({skillFx:s.getState().skillFx.map(e=>e.profile.stance?{...e,profile:{...e.profile,durationMs:60000}}:e)});}`);
    };
    const frame = async (name, ms) => {
        await page.evaluate(`(() => {const s=window.__SIX_CHESS_STORE__,all=s.getState().skillFx,event=all.find(e=>e.profile.stance);
            Date.now=()=>event.bornAt+${ms};s.setState({skillFx:[...all]});for(const a of document.getAnimations()){a.pause();a.currentTime=${ms};}})()`);
        await delay(40); writeFileSync(`${out}/${name}.png`, Buffer.from(await page.screenshot(), 'base64'));
    };
    const events = client => client.evaluate(`window.__SIX_CHESS_STORE__.getState().skillFx.filter(e=>e.profile.stance).map(e=>({skillId:e.skillId,source:e.sourceHeroId,kind:e.profile.stance,from:e.fromPos}))`);
    for (const mode of ['guying', 'nightowl', 'guying-edge', 'nightowl-edge']) {
        await prepare(mode); await page.waitForExpression('document.querySelectorAll(".ts-stance").length===1', mode);
        const data = await events(page); assert.equal(data.length, 1); assert.ok(data[0].source.startsWith(mode.split('-')[0]));
        await frame(`${mode}-enter`, 250); await frame(`${mode}-strike`, 430); await frame(`${mode}-settle`, 950);
        assert.equal(await page.evaluate(`(() => {const root=document.querySelector('.ts-stance'),cell=root.closest('.battle-board-cell');
            const glyph=root.querySelector('.ts-emblem').getBoundingClientRect();return !!root.closest('.piece-shell') && glyph.width < cell.getBoundingClientRect().width*1.2;})()`), true);
        await page.evaluate('window.__SIX_CHESS_STORE__.setState({skillFx:[]})');
        assert.equal(await page.evaluate(`document.querySelectorAll('.status-fx .ts-emblem').length`), 1);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.status-fx .ts-emblem').parentElement).visibility`), 'visible');
        writeFileSync(`${out}/${mode}-idle.png`, Buffer.from(await page.screenshot(), 'base64'));
        check(`${mode}：真实击杀，一次入势，标记衔接与棋子尺寸正确`);
    }
    for (const mode of ['guying-paralyzed', 'nightowl-paralyzed']) {
        await prepare(mode); assert.equal((await events(page)).length, 0);
        assert.equal(await page.evaluate('document.querySelectorAll(".ts-stance").length'), 0); check(`${mode}：封印天威不播放`);
    }
    await prepare('guying');
    await page.evaluate(`(() => {const s=window.__SIX_CHESS_STORE__,state=s.getState(),h=state.player1Heroes[0],b=state.board.map(r=>[...r]);
        b[h.position[0]][h.position[1]]=null;h.position=[1,0];b[1][0]=h;s.setState({board:b});})()`);
    assert.equal(await page.evaluate(`document.querySelector('.ts-stance').closest('[data-testid]').getAttribute('data-testid')`), 'battle-cell-1-0');
    check('孤影：入势随突进后的真实落点移动');
    await page.evaluate(`(() => {const s=window.__SIX_CHESS_STORE__,all=s.getState().skillFx,e=all.find(e=>e.profile.stance);s.setState({skillFx:[...all,{...e,id:e.id+10000}]});})()`);
    assert.equal(await page.evaluate('document.querySelectorAll(".ts-stance").length'), 1);
    check('连续击杀不叠出多套剑痕/羽片');
    remote = await launchBrowser({ baseUrl, label: 'tianwei-stance-remote' });
    await remote.page.evaluate('window.__SIX_CHESS_E2E__.setBattleSoundMuted(true)');
    for (const mode of ['guying', 'nightowl']) {
        await prepare(mode); const snapshot = await page.evaluate('window.__SIX_CHESS_E2E__.tianweiArrivalSnapshot()');
        await remote.page.evaluate(`window.__SIX_CHESS_E2E__.prepareTianweiArrivalDemo(${JSON.stringify(mode)});window.__SIX_CHESS_E2E__.replayTianweiArrivalSnapshot(${JSON.stringify(snapshot)})`);
        await remote.page.waitForExpression('document.querySelectorAll(".ts-stance").length===1', mode);
        assert.deepEqual(await events(remote.page), await events(page)); check(`${mode}：双浏览器 JSON 快照同一入势`);
    }
    await page.evaluate('Date.now=window.__REAL_NOW__');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await page.evaluate('window.__SIX_CHESS_E2E__.setQualityMode("low")');
    for (const mode of ['guying', 'nightowl']) { await prepare(mode); await frame(`mobile-${mode}`, 430); }
    check('手机横屏低画质：保留覆霜剑与墨羽主体');
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    for (const mode of ['guying', 'nightowl']) {
        await prepare(mode); await delay(50);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.hero-piece-avatar')).opacity`), '1');
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.status-fx .ts-emblem').parentElement).visibility`), 'visible');
    }
    check('减少动态效果：不淡化头像，仍显示静态身份标记');
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    await page.evaluate(`Date.now=window.__REAL_NOW__;{const s=window.__SIX_CHESS_STORE__;s.setState({skillFx:s.getState().skillFx.map(e=>({...e,bornAt:Date.now(),profile:{...e.profile,durationMs:1100}}))});}`);
    await page.waitForExpression('document.querySelectorAll(".ts-stance").length===0', '自然结束', 5000);
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.hero-piece-avatar')).opacity`), '1');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.status-fx .ts-emblem').parentElement).visibility`), 'visible');
    check('真实时钟自然结束：头像还原，常驻标记正常显示');
    assert.deepEqual(page.errors, []); assert.deepEqual(remote.page.errors, []);
    writeFileSync(`${out}/result.json`, JSON.stringify({ checks, note: '独立端口；手机为 Chromium 模拟；双端为直接 JSON 快照复现，非房间传输测试' }, null, 2));
} finally {
    await remote?.close(); await session?.close();
    server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve));
}
