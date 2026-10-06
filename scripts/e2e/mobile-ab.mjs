import { launchBrowser, startGameServer } from './browser-harness.mjs';

/**
 * 画质档位 A/B：在同一个页面里来回切「高清 / 流畅」，交替重复多轮。
 *
 * 为什么要交替：单跑一遍 each 档位的差值里，一半是冷启动（首次施法要解码 SVG/字体、
 * 首轮动画表还没建好）。同一进程内 A/B/A/B 之后，剩下的差才像是档位本身的差。
 *
 * 用法：node scripts/e2e/mobile-ab.mjs [cpuThrottle=5] [轮数=4] [场景=aoe]
 */
const cpuRate = Number(process.argv[2] ?? 5);
const rounds = Number(process.argv[3] ?? 4);
const scenario = process.argv[4] ?? 'aoe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'mobile-ab' });
const page = session.page;

await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
await page.send('Emulation.setEmulatedMedia', {
    features: [
        { name: 'prefers-reduced-motion', value: 'no-preference' },
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
    ],
});
await page.send('Performance.enable');
await page.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
await sleep(1200);

// 切档走渲染层同一个开关；不连点 UI 按钮：同一脚本里的多次 click 会被 React 批处理，
// 闭包里的旧值会让轮转永远停在同一档（第一次写这脚本时就是这么失败的）
const setQuality = mode => page.evaluate(
    `window.__SIX_CHESS_E2E__.setQualityMode(${mode === 'auto' ? 'null' : `'${mode}'`})`
);

/**
 * 一次采样窗：清零 → 触发场景 → 收集帧间隔。
 * 绝不在窗内调用 document.getAnimations()：那会把动画降级到主线程，测出来的就是采样器自己。
 */
const sample = async (trigger, ms = 1300) => {
    await page.evaluate(`(() => {
        window.__f = [];
        let last = performance.now();
        const tick = now => { window.__f.push(now - last); last = now; if (window.__f.length < 200) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    })()`);
    const mark = (await page.send('Performance.getMetrics')).metrics;
    const metricOf = (name, list) => list.find(item => item.name === name)?.value ?? 0;
    await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo('${trigger}')`);
    await sleep(ms);
    const after = (await page.send('Performance.getMetrics')).metrics;
    const frames = JSON.parse(await page.evaluate('JSON.stringify(window.__f)'));
    const sorted = frames.slice().sort((a, b) => a - b);
    const pick = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    // 卡顿率用"占比"而不是"超帧数"：两档跑出来的总帧数本来就不同，绝对数会反过来惩罚快的那档
    const slowRatio = frames.length ? frames.filter(f => f > 33).length / frames.length : 0;
    return {
        n: frames.length,
        p50: +pick(0.5).toFixed(1),
        p95: +pick(0.95).toFixed(1),
        max: +(sorted.at(-1) ?? 0).toFixed(1),
        slow: +(slowRatio * 100).toFixed(0),
        mean: +(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)).toFixed(1),
        style: Math.round((metricOf('RecalcStyleDuration', after) - metricOf('RecalcStyleDuration', mark)) * 1000),
        layout: Math.round((metricOf('LayoutDuration', after) - metricOf('LayoutDuration', mark)) * 1000),
        script: Math.round((metricOf('ScriptDuration', after) - metricOf('ScriptDuration', mark)) * 1000),
        task: Math.round((metricOf('TaskDuration', after) - metricOf('TaskDuration', mark)) * 1000),
    };
};

const runs = { full: [], low: [] };
for (let round = 1; round <= rounds; round++) {
    // 交替顺序固定 low→full，两轮之间再反过来，避免"总是后跑的占冷启动的便宜"
    const order = round % 2 === 1 ? ['low', 'full'] : ['full', 'low'];
    for (const mode of order) {
        const applied = await setQuality(mode);
        if (applied !== mode) throw new Error(`切档失败：要求 ${mode}，实际 ${applied}`);
        await sleep(300);
        runs[mode].push(await sample(scenario));
        await sleep(400);
    }
    console.log(`第 ${round} 轮：` + order.map(mode => {
        const r = runs[mode].at(-1);
        return `${mode} 帧=${r.n} p50=${r.p50} 最差=${r.max} 卡帧率=${r.slow}%`;
    }).join('  '));
}

const summarize = (name, list) => {
    const key = k => list.map(r => r[k]).sort((a, b) => a - b);
    const mid = arr => arr[Math.floor(arr.length / 2)];
    const s = {
        n: mid(key('n')),
        p50: mid(key('p50')),
        p95: mid(key('p95')),
        max: mid(key('max')),
        slow: mid(key('slow')),
        mean: mid(key('mean')),
        style: mid(key('style')),
        layout: mid(key('layout')),
        script: mid(key('script')),
        task: mid(key('task')),
    };
    console.log(`${name.padEnd(4)} 帧=${String(s.n).padStart(4)} 均帧=${String(s.mean).padStart(6)} p50=${String(s.p50).padStart(5)} p95=${String(s.p95).padStart(6)} 最差=${String(s.max).padStart(6)} 卡帧率=${String(s.slow).padStart(3)}%  ｜脚本=${String(s.script).padStart(4)} 样式=${String(s.style).padStart(4)} 布局=${String(s.layout).padStart(4)} 主线程=${String(s.task).padStart(5)}ms`);
    return s;
};

console.log(`\n场景 ${scenario}，${cpuRate}× 降频，390×844@3x，${rounds} 轮交替（取中位轮）`);
const low = summarize('流畅', runs.low);
const full = summarize('高清', runs.full);
const drop = (a, b) => `${(((b - a) / Math.max(1, b)) * 100).toFixed(0)}%`;
console.log(`流畅档相对高清：均帧 ${drop(low.mean, full.mean)}，最差帧 ${drop(low.max, full.max)}，`
    + `p95 ${drop(low.p95, full.p95)}，卡帧率 ${low.slow}%→${full.slow}%，样式 ${drop(low.style, full.style)}，主线程 ${drop(low.task, full.task)}`);
console.log(`页面异常：${page.errors.length ? page.errors.join(' / ') : '无'}`);

await session.close();
await server.close();
