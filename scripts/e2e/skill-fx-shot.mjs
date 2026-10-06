import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

/**
 * 单个技能特效的定格取证：把特效跑到指定毫秒后暂停所有动画再截图。
 * 用法：node scripts/e2e/skill-fx-shot.mjs <skillId>[,<skillId>...] [定格毫秒=420]
 * 产物落在 reports/skill-fx-shot/（已在 .gitignore 内，不进 diff）。
 */
const skillIds = (process.argv[2] ?? 'duosui_skill1').split(',').filter(Boolean);
const atMs = Number(process.argv[3] ?? 420);
const out = 'reports/skill-fx-shot';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'skill-fx-shot' });
const page = session.page;
await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await sleep(800);

for (const skillId of skillIds) {
    await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo('stage')`);
    await sleep(300);
    const ok = await page.evaluate(`window.__SIX_CHESS_E2E__.skillFxDemo('${skillId}')`);
    if (!ok) throw new Error(`${skillId} 特效演示未能启动`);
    await sleep(atMs);
    const report = await page.evaluate(`(() => {
        const anims = document.getAnimations();
        for (const anim of anims) { try { anim.pause(); anim.currentTime = ${atMs}; } catch { /* 已结束的不允许 seek */ } }
        const layer = document.querySelector('.skill-fx');
        return JSON.stringify({
            kind: layer ? [...layer.classList].find(c => c.startsWith('skill-fx-kind-')) : null,
            fxNodes: document.querySelectorAll('.skill-fx *').length,
            running: anims.filter(a => a.playState === 'running').length,
        });
    })()`);
    writeFileSync(`${out}/${skillId}-${atMs}ms.png`, Buffer.from(await page.screenshot(), 'base64'));
    console.log(`${skillId}: ${report} → ${out}/${skillId}-${atMs}ms.png`);
    await sleep(900);
}

console.log(`页面异常：${page.errors.length ? page.errors.join(' / ') : '无'}`);
await session.close();
await server.close();
