import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const out = 'reports/lingxi-tide';
mkdirSync(out, { recursive: true });
const server = await startGameServer(process.cwd());
let session;
try {
    session = await launchBrowser({ baseUrl: server.baseUrl, label: 'lingxi-tide' });
    const page = session.page;
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await page.evaluate('window.__SIX_CHESS_E2E__.setQualityMode("full");window.__SIX_CHESS_E2E__.skillFxDemo("lingxi_skill2")');
    await page.waitForExpression('document.querySelector(".lx-tide-source")', '挥扇推潮挂载');
    await page.waitForExpression('Array.from(document.querySelectorAll("img.hero-piece-avatar")).every(img=>img.complete && img.naturalWidth>0)', '演示角色资源就绪');
    await page.evaluate('window.__SIX_CHESS_E2E__.skillFxDemo("lingxi_skill2");new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    const check = await page.evaluate(`(() => {
        const el=document.querySelector('.lx-tide-source'),s=el.getBoundingClientRect();
        const a=el.closest('.piece-shell').querySelector('.hero-piece-avatar').getBoundingClientRect();
        return {sources:document.querySelectorAll('.lx-tide-source').length,fronts:el.querySelectorAll('.lx-tide-front').length,
            impacts:document.querySelectorAll('.lx-tide-impact').length,angle:el.style.getPropertyValue('--lt-angle'),
            x:Math.abs((s.left+s.right-a.left-a.right)/2),y:Math.abs((s.top+s.bottom-a.top-a.bottom)/2),
            old:document.querySelectorAll('.fx-fan,.fx-wavering,.fx-wavefoam,.skill-area-fx-shockwave').length,
            pointer:getComputedStyle(el).pointerEvents};
    })()`);
    assert.equal(check.sources, 1);
    assert.equal(check.fronts, 2);
    assert.equal(check.impacts, 6);
    assert.equal(check.angle, '0deg');
    assert.equal(check.old, 0);
    assert.ok(check.x < 1 && check.y < 1, JSON.stringify(check));
    assert.equal(check.pointer, 'none');
    const projections = [];
    for (const time of [200, 350, 500, 700, 900]) {
        await page.evaluate(`document.querySelectorAll('.skill-fx-kind-lingxi-fan').forEach(el=>el.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=${time};}))`);
        projections.push(await page.evaluate(`(() => {
            const front=document.querySelector('.lx-tide-front .lx-tide-crest').getBoundingClientRect();
            const source=document.querySelector('.lx-tide-source').getBoundingClientRect();
            return (front.left+front.right-source.left-source.right)/2;
        })()`));
        const clip = await page.evaluate(`(() => {const r=document.querySelector('.battle-board-grid').getBoundingClientRect();return {x:Math.max(0,r.x-16),y:Math.max(0,r.y-16),width:r.width+32,height:r.height+32,scale:1};})()`);
        const shot = await page.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
        writeFileSync(`${out}/desktop-${time}.png`, Buffer.from(shot.data, 'base64'));
    }
    assert.ok(projections[0] > 0 && projections[0] < projections[1] && projections[1] < projections[2] && projections[2] < projections[3], JSON.stringify(projections));
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'advance' });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: {type:'landscapePrimary',angle:90} });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.evaluate('window.__SIX_CHESS_E2E__.setQualityMode("low");window.__SIX_CHESS_E2E__.skillFxDemo("lingxi_skill2")');
    await page.waitForExpression('document.querySelector(".lx-tide-source")', '手机潮浪挂载');
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    await page.evaluate(`document.querySelectorAll('.skill-fx-kind-lingxi-fan').forEach(el=>el.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=500;}))`);
    writeFileSync(`${out}/mobile.png`, Buffer.from(await page.screenshot(), 'base64'));
    const mobile = await page.evaluate(`(() => {
        const el=document.querySelector('.lx-tide-source'),s=el.getBoundingClientRect();
        const a=el.closest('.piece-shell').querySelector('.hero-piece-avatar').getBoundingClientRect();
        return {x:Math.abs((s.left+s.right-a.left-a.right)/2),y:Math.abs((s.top+s.bottom-a.top-a.bottom)/2),
            fronts:el.querySelectorAll('.lx-tide-front').length,lace:getComputedStyle(el.querySelector('.lx-tide-lace')).display};
    })()`);
    assert.ok(mobile.x < 1 && mobile.y < 1, JSON.stringify(mobile));
    assert.equal(mobile.fronts, 2);
    assert.equal(mobile.lace, 'none');
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await page.evaluate(`(() => {
        const waves=document.querySelectorAll('.lx-tide-front');
        return {fan:getComputedStyle(document.querySelector('.lx-tide-fan svg')).animationName,
            source:getComputedStyle(document.querySelector('.lx-tide-source')).display,first:getComputedStyle(waves[0]).animationName};
    })()`);
    assert.equal(reduced.fan, 'none');
    assert.equal(reduced.source, 'none');
    assert.equal(reduced.first, 'none');
    console.log('PASS: one caster-centered fan, two advancing fronts, six synchronized foam hits, mobile fallback.', {check,projections,mobile});
} finally {
    await session?.page.send('Browser.close').catch(() => {});
    await session?.close();
    await server.close();
}
