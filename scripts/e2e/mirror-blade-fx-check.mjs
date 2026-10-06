import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const output = 'reports/mirror-blade-fx-check';
mkdirSync(output, { recursive: true });
const server = await startGameServer(process.cwd());
let session;
try {
    session = await launchBrowser({ baseUrl: server.baseUrl, label: 'mirror-blades' });
    const page = session.page;
    await page.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const results = [];
    for (const [width, height, count] of [[1440, 960, 1], [1440, 960, 4], [1040, 800, 20]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await page.evaluate(`window.__SIX_CHESS_E2E__.mirrorBladeDemo(${count})`);
        // 演示首刃必定击杀，天威新增三刃：真实总数为初始层数 + 3。
        await page.waitForExpression(`document.querySelectorAll('.fx-mirror-projectile').length === ${count + 3} && [...document.querySelectorAll('.fx-mirror-projectile')].every(blade => blade.getAnimations().length === 1)`, '真实镜刃数量和动画初始化');
        const result = await page.evaluate(`(() => {
            const blades = [...document.querySelectorAll('.fx-mirror-projectile')];
            const endpoints = blades.map(blade => {
                const animation = blade.getAnimations()[0];
                const timing = animation.effect.getTiming();
                animation.pause(); animation.currentTime = timing.delay + timing.duration;
                const rect = blade.getBoundingClientRect();
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            });
            const impacts = [...document.querySelectorAll('[data-blade-impact]')].map(node => {
                const rect = node.getBoundingClientRect();
                return { index: Number(node.dataset.bladeImpact), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
                    delay: getComputedStyle(node.querySelector('i')).animationDelay };
            });
            const errors = endpoints.map((p, index) => {
                const impact = impacts.find(hit => hit.index === index);
                return Math.hypot(p.x - impact.x, p.y - impact.y);
            });
            for (const animation of document.getAnimations()) {
                if (animation.effect?.target?.closest?.('.battle-board-cell')) {
                    animation.pause(); animation.currentTime = 460;
                }
            }
            return { count: blades.length, impactCount: impacts.length, errors, delays: impacts.map(hit => hit.delay),
                smilCount: document.querySelectorAll('animateMotion').length,
                filteredFlightParts: [...document.querySelectorAll('.fx-mirror-launch *')].filter(node => getComputedStyle(node).filter !== 'none').length,
                hasLegacyBlades: Boolean(document.querySelector('.fx-mirrorblade-a')) };
        })()`);
        assert.equal(result.count, count + 3);
        assert.equal(result.impactCount, count + 3);
        assert.equal(result.hasLegacyBlades, false);
        assert.equal(result.smilCount, 0, '不能恢复逐帧 SVG 运动动画');
        assert.equal(result.filteredFlightParts, 0, '飞行零件不能使用昂贵的滤镜');
        assert.ok(result.errors.every(error => error < 2), `飞刃终点未对齐格中心: ${JSON.stringify(result.errors)}`);
        assert.ok(result.delays.every(delay => parseFloat(delay) > 0.4), '命中动画必须等待飞刃抵达');
        writeFileSync(`${output}/${width}-${count}-flight.png`, Buffer.from(await page.screenshot(), 'base64'));
        results.push({ width, height, initialStacks: count, ...result });
        console.log(`PASS ${width}×${height}: ${count} 初始层数 + 3 天威 = ${result.count} 枚飞刃；终点误差 ${Math.max(...result.errors).toFixed(2)}px`);
        if (count === 4) {
            // 在同一批动画存活时缩放，验证观察器重算路径但不增加飞刃/重启攻击。
            // 使用一批新动画，截图耗时不应挤占这个用例的生命周期预算。
            await page.evaluate(`window.__SIX_CHESS_E2E__.mirrorBladeDemo(20)`);
            await page.waitForExpression(`document.querySelectorAll('.fx-mirror-projectile').length === 23 && [...document.querySelectorAll('.fx-mirror-projectile')].every(blade => blade.getAnimations().length === 1)`, '缩放用例动画初始化');
            await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
            await page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
            const resizeErrors = await page.evaluate(`(() => {
                const impacts = [...document.querySelectorAll('[data-blade-impact]')];
                return [...document.querySelectorAll('.fx-mirror-projectile')].map((blade, index) => {
                    const animation = blade.getAnimations()[0];
                    const timing = animation.effect.getTiming();
                    animation.pause(); animation.currentTime = timing.delay + timing.duration;
                    const rect = blade.getBoundingClientRect();
                    const hit = impacts.find(node => Number(node.dataset.bladeImpact) === index).getBoundingClientRect();
                    return Math.hypot(rect.x + rect.width / 2 - hit.x - hit.width / 2, rect.y + rect.height / 2 - hit.y - hit.height / 2);
                });
            })()`);
            assert.equal(resizeErrors.length, 23);
            assert.ok(resizeErrors.every(error => error < 2), '动画途中棋盘缩放后飞刃仍须命中目标中心');
            console.log(`PASS 动画中缩放: 最大终点误差 ${Math.max(...resizeErrors).toFixed(2)}px`);
        }
        // 生命周期不因验收时暂停动画而改变；等待清场后再测下一次，避免旧飘字混入截图。
        await page.waitForExpression(`document.querySelectorAll('.fx-mirror-projectile').length === 0`, '镜刃生命周期回收');
    }
    assert.deepEqual(page.errors, []);
    writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally {
    await session?.close();
    await server.close();
}
