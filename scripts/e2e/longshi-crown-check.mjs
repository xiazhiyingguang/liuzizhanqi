import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const out = 'reports/longshi-original-dragon';
mkdirSync(out, { recursive: true });
const server = await startGameServer(process.cwd());
let session;
try {
    session = await launchBrowser({ baseUrl: server.baseUrl, label: 'longshi-crown' });
    const page = session.page;
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await page.evaluate('window.__SIX_CHESS_E2E__.fxDemo("fxdragon")');
    await page.waitForExpression('document.querySelector(".sfx-longshi-dragon")?.naturalWidth > 0', '龙冠资源加载');
    await new Promise(resolve => setTimeout(resolve, 1400));
    async function check(label) {
        const bounds = await page.evaluate(`(() => {
            const dragon = document.querySelector('.sfx-longshi-dragon');
            const avatar = dragon.closest('.piece-shell').querySelector('.hero-piece-avatar');
            const d = dragon.getBoundingClientRect(), a = avatar.getBoundingClientRect();
            // Original dragon's brow is at 53% of the refined SVG height; jaw mist is lower.
            return {headContact:(d.top+d.height*.53-a.top)/a.height, crownHeight:d.height, avatarHeight:a.height,
                centerOffset:Math.abs((d.left+d.right)/2-(a.left+a.right)/2), pointerEvents:getComputedStyle(dragon).pointerEvents};
        })()`);
        assert.ok(bounds.headContact > .08 && bounds.headContact < .3, JSON.stringify(bounds));
        assert.ok(bounds.centerOffset < 2, JSON.stringify(bounds));
        assert.equal(bounds.pointerEvents, 'none');
        writeFileSync(`${out}/${label}.png`, Buffer.from(await page.screenshot(), 'base64'));
        console.log(label, bounds);
    }
    await check('desktop');
    // Compare the actual piece at board scale and enlarged, using the production CSS.
    await page.evaluate(`(() => {
        const piece = document.querySelector('.sfx-longshi-dragon').closest('.piece-shell');
        const preview = document.createElement('div'); preview.id='longshi-preview';
        preview.style.cssText='position:fixed;inset:0;z-index:9999;background:#eee9df;display:flex;align-items:center;justify-content:center;gap:80px';
        for(const size of [56,100,220]) {
            const shell=piece.cloneNode(true);shell.style.cssText='width:'+size+'px;height:'+size+'px;flex:none';
            const p=shell.querySelector('.piece');p.style.cssText='width:100%;height:100%;';
            preview.appendChild(shell);
        }
        document.body.appendChild(preview);
    })()`);
    writeFileSync(`${out}/detail.png`, Buffer.from(await page.screenshot(), 'base64'));
    await page.evaluate('document.querySelector("#longshi-preview").remove()');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await new Promise(resolve => setTimeout(resolve, 400));
    await check('mobile');
    console.log('PASS: crown touches the avatar head, stays centered, and does not capture input.');
} finally {
    // Edge's launcher can exit before its browser child; close through CDP as well.
    await session?.page.send('Browser.close').catch(() => {});
    await session?.close();
    await server.close();
}
