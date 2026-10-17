import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

/**
 * 一次性量具：把对局推到第 20 / 25 回合，量激战入场横幅与常驻角标的实际渲染，并定格截图。
 * 用法：node scripts/e2e/battle-tempo-check.mjs
 */
const out = 'reports/battle-tempo';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const probeFn = `(() => {
    const box = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
            w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
            opacity: s.opacity, anim: s.animationName, color: s.color, fontSize: s.fontSize,
            clipped: el.scrollHeight > Math.ceil(r.height) + 1 || el.scrollWidth > Math.ceil(r.width) + 1,
        };
    };
    const text = sel => {
        const el = document.querySelector(sel);
        return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
    };
    return JSON.stringify({
        round: window.__SIX_CHESS_STORE__.getState().roundNumber,
        badge: box('.fierce-badge'),
        badgeText: text('.fierce-badge'),
        banner: box('.battle-turn-banner'),
        phase: box('.phase-announcement'),
        phaseTitle: box('.phase-announcement__title'),
        phaseText: text('.phase-announcement'),
        litMarks: document.querySelectorAll('.phase-announcement__marks .is-lit').length,
        sealGlyph: text('.phase-announcement__seal-glyph'),
        killOnTop: !!document.querySelector('.kill-announcement'),
        topbarText: text('.battle-topbar'),
    }, null, 1);
})()`;

const server = await startGameServer(process.cwd());
const session = await launchBrowser({ baseUrl: server.baseUrl, label: 'battle-tempo' });
const page = session.page;
await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await sleep(800);
await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo('stage')`);
await sleep(400);

async function setRound(round) {
    await page.evaluate(`window.__SIX_CHESS_STORE__.setState({ roundNumber: ${round} })`);
}

const rows = [];
rows.push({ at: '进入对局（第 2 回合）', data: JSON.parse(await page.evaluate(probeFn)) });

await setRound(20);
await sleep(700);
rows.push({ at: '第 20 回合入场 700ms', data: JSON.parse(await page.evaluate(probeFn)) });
writeFileSync(`${out}/fierce-20-700ms.png`, Buffer.from(await page.screenshot(), 'base64'));

await sleep(3400);
rows.push({ at: '第 20 回合入场 4.1s（应已下播，角标留下）', data: JSON.parse(await page.evaluate(probeFn)) });
writeFileSync(`${out}/fierce-20-badge-only.png`, Buffer.from(await page.screenshot(), 'base64'));

await setRound(25);
await sleep(700);
rows.push({ at: '第 25 回合入场 700ms', data: JSON.parse(await page.evaluate(probeFn)) });
writeFileSync(`${out}/fierce-25-700ms.png`, Buffer.from(await page.screenshot(), 'base64'));

await setRound(21);
await sleep(700);
rows.push({ at: '退回第 21 回合（重播检查）', data: JSON.parse(await page.evaluate(probeFn)) });

// 竖屏：顶栏是 flex-wrap 的，角标只能换行不能把棋盘挤小。
// 入场横幅是"事件"，同一份模块状态里不会重播第二次，所以换屏前先重载页面。
await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
await page.send('Page.reload');
await sleep(2000);
await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo('stage')`);
await sleep(500);

const mobileProbe = `(() => {
    const box = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y), bottom: Math.round(r.bottom) };
    };
    return JSON.stringify({
        coarse: matchMedia('(pointer: coarse)').matches,
        topbar: box('.battle-topbar'),
        badge: box('.fierce-badge'),
        badgeText: (document.querySelector('.fierce-badge')?.textContent || '').replace(/\\s+/g, ' ').trim(),
        banner: box('.battle-turn-banner'),
        phase: box('.phase-announcement'),
        phaseTitle: box('.phase-announcement__title'),
        phaseText: (document.querySelector('.phase-announcement')?.textContent || '').replace(/\\s+/g, ' ').trim() || null,
        phaseFits: (() => {
            const content = document.querySelector('.phase-announcement__content');
            const banner = document.querySelector('.battle-turn-banner');
            if (!content || !banner) return null;
            const c = content.getBoundingClientRect();
            const b = banner.getBoundingClientRect();
            return c.top >= b.top - 1 && c.bottom <= b.bottom + 1;
        })(),
        cell: box('.battle-board-cell'),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }, null, 1);
})()`;

// 先量没有角标的第 5 回合，再量带角标的第 21 回合：顶栏只许换行，不许把棋盘挤下去
await setRound(5);
await sleep(500);
rows.push({ at: '竖屏 390×844（第 5 回合·无角标基线）', data: JSON.parse(await page.evaluate(mobileProbe)) });

await setRound(20);
await sleep(700);
rows.push({ at: '竖屏 390×844（第 20 回合入场）', data: JSON.parse(await page.evaluate(mobileProbe)) });
writeFileSync(`${out}/mobile-390-fierce-20.png`, Buffer.from(await page.screenshot(), 'base64'));

await sleep(3400);
rows.push({ at: '竖屏 390×844（横幅下播后·角标常驻）', data: JSON.parse(await page.evaluate(mobileProbe)) });
writeFileSync(`${out}/mobile-390-badge-only.png`, Buffer.from(await page.screenshot(), 'base64'));

// 横屏更狠：展示条被压到 30px，紧凑版横幅必须完全塞进去（上下都不许被裁）
await page.send('Emulation.setDeviceMetricsOverride', {
    width: 844, height: 390, deviceScaleFactor: 2, mobile: true,
});
await page.send('Page.reload');
await sleep(2000);
await page.evaluate(`window.__SIX_CHESS_E2E__.fxDemo('stage')`);
await sleep(500);
await setRound(20);
await sleep(700);
rows.push({ at: '横屏 844×390（第 20 回合入场）', data: JSON.parse(await page.evaluate(mobileProbe)) });
writeFileSync(`${out}/mobile-landscape-fierce-20.png`, Buffer.from(await page.screenshot(), 'base64'));

console.log(rows.map(row => `${row.at}\n${JSON.stringify(row.data, null, 1)}`).join('\n\n'));
console.log(`页面异常：${page.errors.length ? page.errors.join(' / ') : '无'}`);
await session.close();
await server.close();
