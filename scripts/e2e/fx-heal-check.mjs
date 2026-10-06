import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const OUT = 'reports/fx-heal-check';
const SCENARIOS = ['fxheal', 'fxhealwave', 'fxregen', 'fxrevive', 'fxward'];

mkdirSync(OUT, { recursive: true });
const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'fx-heal-check' });
const page = session.page;
await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await new Promise(r => setTimeout(r, 700));

for (const scenario of SCENARIOS) {
    const ok = await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo("${scenario}")`);
    await new Promise(r => setTimeout(r, 320));
    const parts = await page.evaluate(
        `document.querySelectorAll('.skill-fx i').length`
    );
    writeFileSync(join(OUT, `${scenario}.png`), Buffer.from(await page.screenshot(), 'base64'));
    console.log(`${scenario.padEnd(12)} 启动=${ok} 零件=${parts}`);
}

await session.close();
await server.close();
