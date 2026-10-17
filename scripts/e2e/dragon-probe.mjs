import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

/**
 * 一次性量具：把游龙的某个演示场景跑到指定毫秒，打印龙形零件的实际盒位并定格截图。
 * 用法：node scripts/e2e/dragon-probe.mjs <skillFxDemo 的技能 id | scenario:场景名> [毫秒]
 */
const target = process.argv[2] ?? 'aoyuan_skill2';
const atMs = Number(process.argv[3] ?? 300);
const isScenario = target.startsWith('scenario:');
const out = 'reports/skill-fx-shot';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'dragon-probe' });
const page = session.page;
await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await sleep(800);
await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo(${JSON.stringify(isScenario ? target.slice(9) : 'stage')})`);
await sleep(300);
if (!isScenario) await page.evaluate(`window.__SIX_CHESS_E2E__.skillFxDemo('${target}')`);
await sleep(atMs);
const report = await page.evaluate(`(() => {
    const box = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { sel, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
            opacity: s.opacity, transform: s.transform.slice(0, 40),
            anim: s.animationName, dur: s.animationDuration, delay: s.animationDelay,
            vars: ['--ao-dash-ms', '--ao-spin-ms', '--ao-start', '--ao-sweep', '--fx-hit-ms']
                .map(v => v + '=' + s.getPropertyValue(v).trim()).join(' ') };
    };
    return JSON.stringify([
        '.battle-board-cell:nth-child(1)', '.piece-shell', '.battle-board-piece', '.status-fx',
        '.ao-coil', '.ao-coil-dragon', '.sfx-ring',
    ].map(box), null, 1);
})()`);
console.log(report);
writeFileSync(`${out}/probe-${isScenario ? target.slice(9) : target}-${atMs}ms.png`,
    Buffer.from(await page.screenshot(), 'base64'));
console.log(`页面异常：${page.errors.length ? page.errors.join(' / ') : '无'}`);
await session.close();
await server.close();
