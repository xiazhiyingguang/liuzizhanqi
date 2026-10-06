import { launchBrowser, startGameServer } from './browser-harness.mjs';

/**
 * 手机卡顿归因测量：4× CPU 降频 + 390×844 / DPR3 的移动端视口，
 * 分别统计「战斗空闲」与「连续施法」两段的帧间隔分布 + 主线程耗时构成。
 *
 * 用法：node scripts/e2e/mobile-perf.mjs [cpuThrottle=4] [标签] [--quality=low|full] [--trace]
 *
 * 两个必须踩住的坑，否则测出来的是假的：
 *   1) headless 默认 prefers-reduced-motion: reduce，技能特效整层不渲染 —— 强制 no-preference；
 *   2) 帧间隔 p50 恒为 16.7ms（vsync 对齐），真正的问题全在长尾，所以看 p95/最差帧/超帧数。
 */
const argDefs = process.argv.slice(2);
const cpuRate = Number(argDefs[0] ?? 4);
const label = argDefs[1] && !argDefs[1].startsWith('--') ? argDefs[1] : 'baseline';
const qualityOverride = argDefs.find(a => a.startsWith('--quality='))?.split('=')[1];
const wantTrace = argDefs.includes('--trace');
const countOnly = argDefs.includes('--count');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STATS = `JSON.stringify((() => {
    const frames = window.__f.slice(); window.__f = [];
    const sorted = frames.slice().sort((a, b) => a - b);
    const pick = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    return {
        n: frames.length,
        p50: +pick(0.5).toFixed(1),
        p95: +pick(0.95).toFixed(1),
        max: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
        over33: frames.filter(f => f > 33).length,
        over80: frames.filter(f => f > 80).length,
        total: +frames.reduce((s, f) => s + f, 0).toFixed(0),
    };
})(), null)`;

/**
 * 动画属性构成（只在 --count 模式取）。
 * 注意两件事：
 *   1) 取这个数会调用 document.getAnimations()，Blink 因此把所有动画降级成"脚本可观察"，
 *      主线程每帧都要过一遍动画——帧耗时会被采样本身污染。所以计数与计时必须分两次跑。
 *   2) Chrome 返回的计算关键帧里带一个 composite 键（animation-composition 的结果），
 *      它不是被动画化的属性，统计时要剔除，否则"只动 transform/opacity"永远算成 0。
 */
const ANIM_DUMP = `(() => {
    const rows = {};
    for (const anim of document.getAnimations()) {
        const target = anim.effect && anim.effect.target;
        if (!target) continue;
        const cls = (target.getAttribute('class') || target.tagName || '?').trim().split(/\\s+/).slice(0, 2).join('.');
        const props = new Set();
        const frames = anim.effect.getKeyframes ? anim.effect.getKeyframes() : [];
        for (const frame of frames) {
            for (const key of Object.keys(frame)) {
                if (key === 'computedOffset' || key === 'easing' || key === 'offset' || key === 'composite') continue;
                props.add(key);
            }
        }
        const name = [...props].sort().join('+') || (anim.animationName || '?');
        const key = name + ' @ ' + cls;
        rows[key] = (rows[key] || 0) + 1;
    }
    const entries = Object.entries(rows);
    const onlyComposited = entries.filter(([k]) => /^(opacity|transform)/.test(k.split(' @ ')[0]));
    return JSON.stringify({
        total: document.getAnimations().length,
        onlyComposited: onlyComposited.reduce((a, [, n]) => a + n, 0),
        nodes: document.querySelectorAll('*').length,
        top: entries.sort((a, b) => b[1] - a[1]).slice(0, 16),
    });
})()`;

const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'mobile-perf' });
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
if (qualityOverride) {
    await page.evaluate(`localStorage.setItem('six-chess-battle:quality-mode', '${qualityOverride}')`);
    await page.evaluate('location.reload()');
    await page.waitForExpression(
        `document.readyState === 'complete' && Boolean(window.__SIX_CHESS_E2E__)`,
        '画质档位重载后重新挂载',
        20_000
    );
}
await page.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
await sleep(1200);

const applied = JSON.parse(await page.evaluate(`JSON.stringify({
    quality: document.documentElement.dataset.quality ?? null,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    coarse: matchMedia('(pointer: coarse)').matches,
})`));
console.log(`生效档位：${JSON.stringify(applied)}`);

// 主线程构成：脚本 / 样式重算 / 布局 各自的累计耗时，做差才知道锅在谁身上
const perfMetrics = async () => {
    const { metrics } = await page.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map(m => [m.name, m.value]));
};
await page.send('Performance.enable');

const startFrameSampler = () => page.evaluate(`(() => {
    window.__f = [];
    let last = performance.now();
    const tick = now => { window.__f.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
})()`);

const windowReport = async (name, before, stats) => {
    const after = await perfMetrics();
    const ms = key => +(((after[key] ?? 0) - (before[key] ?? 0)) * 1000).toFixed(0);
    return { name, ...stats, script: ms('ScriptDuration'), style: ms('RecalcStyleDuration'), layout: ms('LayoutDuration'), task: ms('TaskDuration') };
};

const line = r => `${r.name.padEnd(10)} 帧=${String(r.n).padStart(4)} p50=${String(r.p50).padStart(5)} p95=${String(r.p95).padStart(6)} 最差=${String(r.max).padStart(6)} `
    + `>33=${String(r.over33).padStart(3)} >80=${String(r.over80).padStart(3)}  `
    + `｜脚本=${String(r.script).padStart(5)} 样式=${String(r.style).padStart(5)} 布局=${String(r.layout).padStart(4)} 主线程=${String(r.task).padStart(5)}ms`;

await startFrameSampler();

/** 跑一个测量窗：清零采样 → 触发场景 → 等固定时长 → 汇总帧分布与主线程构成 */
const measure = async (name, trigger, ms = 1500) => {
    await startFrameSampler();
    const mark = await perfMetrics();
    if (trigger) await page.evaluate(trigger);
    await sleep(Math.min(320, ms / 3));
    // 取动画构成会污染帧计时，只在 --count 模式里做
    const anims = countOnly ? JSON.parse(await page.evaluate(ANIM_DUMP)) : null;
    await sleep(ms - Math.min(320, ms / 3));
    const report = await windowReport(name, mark, JSON.parse(await page.evaluate(STATS)));
    return { ...report, anims };
};

await page.evaluate(`window.__SIX_CHESS_E2E__.prepareTimingDemo()`);
await sleep(2200);
const idle = await measure('稳定空闲', null, 1600);
const cast1 = await measure('单次施法', `window.__SIX_CHESS_E2E__.castTimingDemo()`, 1400);
const aoe = await measure('范围特效', `window.__SIX_CHESS_E2E__.fxDemo('aoe')`, 1600);
const status = await measure('持续状态', `window.__SIX_CHESS_E2E__.fxDemo('status')`, 1600);
const fullBoard = await measure('满场特效', `window.__SIX_CHESS_E2E__.fxDemo('aoe'); window.__SIX_CHESS_E2E__.fxDemo('chain'); window.__SIX_CHESS_E2E__.fxDemo('areagrid')`, 1600);

/**
 * 归因追踪：帧耗时只说"卡"，trace 才说"卡在哪"。
 * 单独跑一轮 AOE，因为这档最贵，也最容易被合成器差异掩盖。
 */
if (wantTrace) {
    const chunks = [];
    const completed = new Promise(resolve => {
        const offData = page.on('Tracing.dataCollected', params => chunks.push(...(params.value ?? [])));
        page.on('Tracing.tracingComplete', () => { offData(); resolve(); });
    });
    await page.send('Tracing.start', {
        categories: 'devtools.timeline,blink,blink.lifecycle,cc,disabled-by-default-devtools.timeline',
        transferMode: 'ReportEvents',
        bufferUsageReportingInterval: 500,
    });
    await measure('追踪内施法', `window.__SIX_CHESS_E2E__.fxDemo('aoe')`, 1600);
    await page.send('Tracing.end');
    await Promise.race([completed, sleep(25_000)]);

    const totals = new Map();
    const counts = new Map();
    let elementCount = 0;
    let layoutNodes = 0;
    for (const e of chunks) {
        if (e.ph !== 'X' || !e.dur || e.name === 'RunTask') continue;
        totals.set(e.name, (totals.get(e.name) ?? 0) + e.dur / 1000);
        counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
        const data = e.args?.data ?? e.args ?? {};
        elementCount += data.elementCount ?? 0;
        layoutNodes += data.nodes ?? data.nodeCount ?? 0;
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    console.log(`\n主线程归因（trace 事件 ${chunks.length} 条，按总耗时排序，不含 RunTask）`);
    for (const [name, ms] of ranked) {
        console.log(`  ${name.padEnd(34)} ${ms.toFixed(0).padStart(6)}ms  ×${counts.get(name)}`);
    }
    const group = pattern => [...totals.entries()]
        .filter(([name]) => pattern.test(name))
        .reduce((sum, [, ms]) => sum + ms, 0);
    console.log(`  ——样式=${group(/Style|Selector/g).toFixed(0)}ms 布局=${group(/Layout(?!Tree)|LayoutObjects/g).toFixed(0)}ms `
        + `绘制=${group(/Paint|Raster|Shadow|Blur|Decoding/g).toFixed(0)}ms 脚本=${group(/EvaluateScript|FunctionCall|ScriptURLResolver/g).toFixed(0)}ms`);
    console.log(`  样式重算元素总数=${elementCount}，布局节点总数=${layoutNodes}`);
}

console.log(`\n移动端帧耗时（${cpuRate}× CPU 降频，390×844@3x，标签：${label}${qualityOverride ? `，强制画质=${qualityOverride}` : ''}，光栅=${process.env.E2E_GPU ? 'GPU' : '软件'}）`);
console.log(line(idle));
console.log(line(cast1));
console.log(line(aoe));
console.log(line(status));
console.log(line(fullBoard));

for (const r of countOnly ? [aoe, fullBoard] : []) {
    console.log(`\n${r.name}：在跑动画 ${r.anims.total} 个 / 节点 ${r.anims.nodes}，其中只动 transform/opacity=${r.anims.onlyComposited}`);
    for (const [key, count] of r.anims.top) console.log(`  ×${String(count).padStart(3)}  ${key}`);
}

// 顺带存一张竖屏与一张横屏的实拍，检查横屏布局是否溢出
const { writeFileSync } = await import('node:fs');
writeFileSync(`reports/balance/fx-shots/mobile-portrait-${label}.png`,
    Buffer.from(await page.screenshot(), 'base64'));
await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true });
await sleep(900);
writeFileSync(`reports/balance/fx-shots/mobile-landscape-${label}.png`,
    Buffer.from(await page.screenshot(), 'base64'));
const overflow = await page.evaluate(`JSON.stringify({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
})`);
console.log(`横屏溢出检查：${overflow}`);
if (process.env.E2E_KEEP_OPEN !== '1') {
    await session.close();
    await server.close();
} else {
    console.log('E2E_KEEP_OPEN=1：浏览器与静态服务保持开启，Ctrl+C 结束');
}
