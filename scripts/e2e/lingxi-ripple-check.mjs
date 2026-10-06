import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const out = 'reports/lingxi-ripple';
mkdirSync(out, { recursive: true });
const server = await startGameServer(process.cwd());
let session;
try {
    session = await launchBrowser({ baseUrl: server.baseUrl, label: 'lingxi-ripple' });
    const page = session.page;
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await page.evaluate('window.__SIX_CHESS_E2E__.setQualityMode("full")');
    assert.equal(await page.evaluate('window.__SIX_CHESS_E2E__.skillFxDemo("lingxi_skill1")'), true);
    await page.waitForExpression('document.querySelector(".lx-ripple-source")', '泠汐涟漪挂载');
    // Freeze timers while checking multiple animation frames, without extending the live effect.
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    const checks = await page.evaluate(`(() => {
        const source = document.querySelector('.lx-ripple-source');
        const avatar = source.closest('.battle-board-cell').querySelector('.hero-piece-avatar');
        const s = source.getBoundingClientRect(), a = avatar.getBoundingClientRect();
        return {sources:document.querySelectorAll('.lx-ripple-source').length,
            waves:source.querySelectorAll('.lx-water-wave').length,
            x:Math.abs((s.left+s.right-a.left-a.right)/2), y:Math.abs((s.top+s.bottom-a.top-a.bottom)/2),
            old:document.querySelectorAll('.fx-wave,.saf-tide-ring,.fx-ripple-wash').length,
            inputs:getComputedStyle(source).pointerEvents};
    })()`);
    assert.equal(checks.sources, 1);
    assert.equal(checks.waves, 4);
    assert.ok(checks.x < 3 && checks.y < 3, JSON.stringify(checks));
    assert.equal(checks.old, 0);
    assert.equal(checks.inputs, 'none');
    for (const time of [200, 450, 700, 950]) {
        await page.evaluate(`document.querySelectorAll('.skill-fx-kind-lingxi-wave').forEach(el => el.getAnimations({subtree:true}).forEach(a => {a.pause();a.currentTime=${time};}))`);
        const board = await page.evaluate(`(() => {const r=document.querySelector('.battle-board-grid').getBoundingClientRect();return {x:Math.max(0,r.x-16),y:Math.max(0,r.y-16),width:r.width+32,height:r.height+32,scale:1};})()`);
        const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: board, captureBeyondViewport: true });
        writeFileSync(`${out}/desktop-${time}.png`, Buffer.from(shot.data, 'base64'));
    }
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'advance' });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true,
        screenOrientation: {type: 'landscapePrimary', angle: 90} });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.evaluate('window.__SIX_CHESS_E2E__.setQualityMode("low");window.__SIX_CHESS_E2E__.skillFxDemo("lingxi_skill1")');
    await page.waitForExpression('document.querySelectorAll(".lx-water-wave").length === 3', '低画质保留三道主浪');
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    await page.evaluate(`document.querySelectorAll('.skill-fx-kind-lingxi-wave').forEach(el => el.getAnimations({subtree:true}).forEach(a => {a.pause();a.currentTime=450;}))`);
    writeFileSync(`${out}/mobile.png`, Buffer.from(await page.screenshot(), 'base64'));
    const mobile = await page.evaluate(`(() => {
        const el=document.querySelector('.lx-ripple-source');const s=el.getBoundingClientRect();
        const a=el.closest('.battle-board-cell').querySelector('.hero-piece-avatar').getBoundingClientRect();
        return {x:Math.abs((s.left+s.right-a.left-a.right)/2),y:Math.abs((s.top+s.bottom-a.top-a.bottom)/2),waves:el.querySelectorAll('.lx-water-wave').length};
    })()`);
    assert.ok(mobile.x < 3 && mobile.y < 3, JSON.stringify(mobile));
    console.log('PASS: one caster-centered ripple; no old waves; low quality preserves three fronts.', { checks, mobile });
} finally {
    await session?.page.send('Browser.close').catch(() => {});
    await session?.close();
    await server.close();
}
