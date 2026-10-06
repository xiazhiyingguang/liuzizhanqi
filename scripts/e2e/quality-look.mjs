import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

/**
 * 画质档位的外观对照：同一场景在「高清 / 流畅」各定一张格，肉眼确认降级砍掉的是散件而不是主体。
 *
 * 定格办法（本机验证过）：动画跑到指定时刻后把 document.getAnimations() 全部 pause
 * 并把 currentTime 钉住，再截图。这里 pause 之后就再没有第二帧，所以它不影响帧耗时测量。
 * 用法：node scripts/e2e/quality-look.mjs [场景=aoe] [定格毫秒=520]
 */
const scenario = process.argv[2] ?? 'aoe';
const atMs = Number(process.argv[3] ?? 520);
const out = 'reports/fx-quality-look';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'quality-look' });
const page = session.page;

await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await sleep(900);

for (const mode of ['full', 'low']) {
    await page.evaluate(`window.__SIX_CHESS_E2E__.setQualityMode('${mode}')`);
    await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo('stage')`);
    await sleep(400);
    await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo('${scenario}')`);
    await sleep(atMs);
    const counted = await page.evaluate(`(() => {
        // 只数还在跑的动画：先取数再暂停，避免"取数把动画降级到主线程"污染别的测量
        const anims = document.getAnimations();
        const running = anims.filter(a => a.playState === 'running').length;
        for (const anim of anims) { try { anim.pause(); anim.currentTime = ${atMs}; } catch { /* 已结束的动画不许 seek，忽略 */ } }
        return { total: anims.length, running, nodes: document.querySelectorAll('*').length };
    })()`);
    writeFileSync(`${out}/${scenario}-${mode}.png`, Buffer.from(await page.screenshot(), 'base64'));
    console.log(`${mode}: 动画 ${counted.total}（定格时仍在跑 ${counted.running}），节点 ${counted.nodes} → ${out}/${scenario}-${mode}.png`);
    await sleep(900);
}

console.log(`页面异常：${page.errors.length ? page.errors.join(' / ') : '无'}`);
await session.close();
await server.close();
