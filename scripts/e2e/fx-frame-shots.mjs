import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

// 逐帧抓某个技能的特效，用来肉眼检查分段动作是否连贯
const skillId = process.argv[2] ?? 'jinghong_skill2';
const stamps = (process.argv[3] ?? '120,320,560,780,1020,1260').split(',').map(Number);
const OUT = 'reports/balance/fx-shots';

mkdirSync(OUT, { recursive: true });
const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'fx-frames' });
await session.page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await new Promise(r => setTimeout(r, 700));

for (const stamp of stamps) {
    await session.page.evaluate(`window.__SIX_CHESS_E2E__.skillFxDemo("${skillId}")`);
    await new Promise(r => setTimeout(r, stamp));
    const parts = await session.page.evaluate(`document.querySelectorAll('.skill-fx i').length`);
    writeFileSync(join(OUT, `${skillId}-${String(stamp).padStart(4, '0')}ms.png`),
        Buffer.from(await session.page.screenshot(), 'base64'));
    console.log(`${stamp}ms 零件=${parts}`);
}

await session.close();
await server.close();
