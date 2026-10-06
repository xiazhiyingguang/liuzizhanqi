import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const label = process.argv[2] || 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid report label');
const output = 'reports/mirror-blade-performance';
mkdirSync(output, { recursive: true });
const server = await startGameServer(process.cwd());
let session;
try {
    session = await launchBrowser({ baseUrl: server.baseUrl, label: `mirror-performance-${label}` });
    const page = session.page;
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.send('Performance.enable');
    await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo('stage')`);
    await page.waitForExpression(`document.querySelector('.battle-board-cell')`, '棋盘挂载');
    const results = [];
    for (const count of [4, 20, 20]) {
        const before = await page.send('Performance.getMetrics');
        const frames = await page.evaluate(`new Promise(resolve => {
            const gaps = []; let last = performance.now(); const begin = last;
            window.__SIX_CHESS_E2E__.mirrorBladeDemo(${count});
            function frame(now) {
                gaps.push(now - last); last = now;
                if (now - begin < 3400) requestAnimationFrame(frame);
                else resolve({ gaps, nodes: document.querySelectorAll('.skill-fx-kind-mirror-blades *').length,
                    animations: document.getAnimations().length });
            }
            requestAnimationFrame(frame);
        })`);
        const after = await page.send('Performance.getMetrics');
        const metric = (name, result) => result.metrics.find(item => item.name === name)?.value || 0;
        const gaps = frames.gaps.filter(n => n >= 0).sort((a, b) => a - b);
        const result = {
            initialStacks: count, sampleMs: Math.round(gaps.reduce((a, b) => a + b, 0)), frames: gaps.length,
            p95FrameMs: Number(gaps[Math.floor(gaps.length * .95)].toFixed(2)),
            maxFrameMs: Number(gaps.at(-1).toFixed(2)), framesOver34ms: gaps.filter(n => n > 34).length,
            taskMs: Number(((metric('TaskDuration', after) - metric('TaskDuration', before)) * 1000).toFixed(2)),
            layoutMs: Number(((metric('LayoutDuration', after) - metric('LayoutDuration', before)) * 1000).toFixed(2)),
            styleMs: Number(((metric('RecalcStyleDuration', after) - metric('RecalcStyleDuration', before)) * 1000).toFixed(2)),
            ...Object.fromEntries(Object.entries(frames).filter(([key]) => key !== 'gaps')),
        };
        results.push(result);
        console.log(JSON.stringify(result));
        await page.waitForExpression(`!document.querySelector('.fx-mirror-projectile')`, '特效回收');
    }
    writeFileSync(`${output}/${label}.json`, JSON.stringify({ cpuThrottle: 4, headlessSoftwareRendering: true,
        note: 'First sample also includes cold loading of hero assets. Compare the repeated 20-stack samples for steady-state animation cost.',
        results, errors: page.errors }, null, 2));
    if (page.errors.length) throw new Error(page.errors.join('\n'));
} finally {
    await session?.close();
    await server.close();
}
