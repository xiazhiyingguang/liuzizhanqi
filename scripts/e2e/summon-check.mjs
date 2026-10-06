import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const out = 'reports/summon-check';
mkdirSync(out, { recursive: true });
const server = await startGameServer(process.cwd());
let session;
try {
    session = await launchBrowser({ baseUrl: server.baseUrl, label: 'summon-check' });
    const page = session.page;
    await page.waitForExpression('document.querySelector("[data-testid=menu-hero-summon]")');
    await page.evaluate(`(() => {
        const NativeAudio = window.Audio;
        window.__summonTracks = [];
        window.Audio = function(...args) {
            const track = new NativeAudio(...args);
            if (String(args[0]).includes('/sounds/summon/')) window.__summonTracks.push(track);
            return track;
        };
    })()`);
    await page.evaluate('document.querySelector("[data-testid=menu-hero-summon]").click()');
    await page.waitForExpression('document.querySelector(".summon-idle")');
    await page.waitForExpression('window.__summonTracks.length === 2 && window.__summonTracks.every(track => track.readyState >= 2)', '抽卡音效预加载', 60000);
    writeFileSync(`${out}/idle.png`, Buffer.from(await page.screenshot(), 'base64'));
    // Even an unresolved image decode must not delay the opening animation.
    await page.evaluate(`(() => {
        window.__originalDecode = HTMLImageElement.prototype.decode;
        window.__releaseDecodes = [];
        HTMLImageElement.prototype.decode = function() {
            return new Promise(resolve => window.__releaseDecodes.push(resolve));
        };
        document.querySelector('.summon-actions button').click();
    })()`);
    await page.waitForExpression('document.querySelector(".summon-gather")', '图片解码未完成时立即开始蓄势', 1000);
    assert.equal(await page.evaluate('window.__releaseDecodes.length > 0'), true);
    await page.evaluate(`(() => {
        HTMLImageElement.prototype.decode = window.__originalDecode;
        window.__releaseDecodes.forEach(resolve => resolve());
    })()`);
    await new Promise(resolve => setTimeout(resolve, 650));
    writeFileSync(`${out}/gather.png`, Buffer.from(await page.screenshot(), 'base64'));
    await page.waitForExpression('document.querySelector(".summon-reveal")');
    assert.equal(await page.evaluate('!window.__summonTracks[0].paused && window.__summonTracks[0].currentTime >= 2.5'), true);
    await new Promise(resolve => setTimeout(resolve, 1400));
    assert.equal(await page.evaluate('document.querySelectorAll(".summon-scroll img").length'), 1);
    assert.equal(await page.evaluate('document.querySelector(".summon-scroll img").naturalWidth > 0'), true);
    writeFileSync(`${out}/reveal.png`, Buffer.from(await page.screenshot(), 'base64'));
    await page.evaluate('document.querySelectorAll(".summon-actions button")[1].click()');
    await page.waitForExpression('document.querySelector(".summon-gather")');
    assert.equal(await page.evaluate('performance.getEntriesByType("resource").filter(e => /hero-images|others.*full-body/.test(e.name)).every(e => e.name.endsWith(".webp"))'), true);
    await page.evaluate('document.querySelectorAll(".summon-header button")[1].click()');
    await page.waitForExpression('document.querySelectorAll(".summon-result-card").length === 6');
    assert.equal(await page.evaluate('window.__summonTracks[0].paused && !window.__summonTracks[1].paused && window.__summonTracks[1].currentTime >= 2.7'), true);
    await page.waitForExpression('Array.from(document.querySelectorAll(".summon-result-card img")).every(img => img.naturalWidth > 0)', '六张立绘加载', 60000);
    await new Promise(resolve => setTimeout(resolve, 1400));
    writeFileSync(`${out}/desktop-six.png`, Buffer.from(await page.screenshot(), 'base64'));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await new Promise(resolve => setTimeout(resolve, 1400));
    writeFileSync(`${out}/mobile-six.png`, Buffer.from(await page.screenshot(), 'base64'));
    assert.equal(await page.evaluate('Array.from(document.querySelectorAll(".summon-result-card")).every(card => { const r = card.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })'), true);
    console.log('portrait transfers', await page.evaluate('JSON.stringify(performance.getEntriesByType("resource").filter(e => e.name.endsWith(".webp")).map(e => ({bytes:e.encodedBodySize,ms:Math.round(e.duration)})))'));
    console.log('mobile dimensions', await page.evaluate('JSON.stringify({width:innerWidth,stage:document.querySelector(".summon-stage").scrollWidth})'));
    assert.equal(await page.evaluate('document.querySelector(".summon-stage").scrollWidth <= innerWidth'), true);
    await page.evaluate('document.querySelector(".summon-header button").click()');
    await page.waitForExpression('document.querySelector("[data-testid=menu-hero-summon]")');
    assert.equal(await page.evaluate('window.__summonTracks.every(track => track.paused && !track.getAttribute("src"))'), true);
    console.log('PASS: audio playback, skip cue, replacement and cleanup; single draw, loaded portrait, six draws, skip, all six visible, mobile width, return');
} finally {
    await session?.close();
    await server.close();
}


