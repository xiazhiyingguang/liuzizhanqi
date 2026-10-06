import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const OUT = 'reports/mobile';
mkdirSync(OUT, { recursive: true });

const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'mobile-landscape' });
const page = session.page;
await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});

async function shoot(label, w, h) {
    await page.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 2, mobile: true,
        screenOrientation: { type: label === 'portrait' ? 'portraitPrimary' : 'landscapePrimary', angle: label === 'portrait' ? 0 : 90 },
    });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await new Promise(r => setTimeout(r, 700));
    const state = await page.evaluate(`(() => ({
        phase: window.__SIX_CHESS_E2E__?.snapshot?.().phase ?? 'no-bridge',
        guide: Boolean(document.querySelector('.orientation-guide')),
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
    }))()`);
    writeFileSync(join(OUT, `${label}.png`), Buffer.from(await page.screenshot(), 'base64'));
    console.log(label.padEnd(9), JSON.stringify(state), '→', join(OUT, `${label}.png`));
}

await shoot('portrait', 390, 844);
await shoot('landscape', 844, 390);

await session.close();
await server.close();
