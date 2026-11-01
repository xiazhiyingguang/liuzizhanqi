import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build, preview } from 'vite';
import { getFreePort, launchBrowser } from './browser-harness.mjs';

// 独立随机端口，不重启 3000，也不覆盖正在提供服务的 dist。
process.env.VITE_E2E = 'true';
const port = await getFreePort();
const buildDirectory = 'reports/mobile-fullscreen/e2e-build';
if (!process.argv.includes('--skip-build')) await build({ define: { 'import.meta.env.VITE_E2E': '"true"' }, build: { outDir: buildDirectory },
    plugins: [{ name: 'fullscreen-test-offline-fonts',
        transformIndexHtml: html => html.replace(/<link[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '') }] });
const server = await preview({ build: { outDir: buildDirectory },
    preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
let session;
const out = 'reports/mobile-fullscreen';
const passed = [];
const check = label => { passed.push(label); console.log(`PASS ${label}`); };

// 桌面 Chromium 无法制造手机系统回收全屏/权限限制；仅替换全屏 API 与 visibilityState，
// 保留真实 React、matchMedia、横竖屏变化、DOM、按钮、对局和 localStorage。
const mock = `(() => {
    const state = window.__FULLSCREEN_TEST__ = { active: false, hidden: false, allowed: true, requests: 0 };
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => state.active ? document.documentElement : null });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.hidden ? 'hidden' : 'visible' });
    // 新文档注入时 documentElement 尚未创建，覆盖原型才能在重载前生效。
    Element.prototype.requestFullscreen = async () => {
        state.requests++;
        if (!state.allowed) throw new DOMException('User activation required', 'NotAllowedError');
        state.active = true; document.dispatchEvent(new Event('fullscreenchange'));
    };
    document.exitFullscreen = async () => { state.active = false; document.dispatchEvent(new Event('fullscreenchange')); };
})()`;

try {
    const address = server.httpServer.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const html = await (await fetch(baseUrl)).text();
    const bundle = html.match(/src="([^"]+\.js)"/)[1];
    assert.ok((await (await fetch(new URL(bundle, baseUrl))).text()).includes('__SIX_CHESS_E2E__'), '测试服务必须提供 E2E 构建');
    console.log('TEST SERVER', baseUrl, bundle);
    session = await launchBrowser({ baseUrl, label: 'mobile-fullscreen' });
    const page = session.page;
    const rotate = async landscape => {
        await page.send('Emulation.setDeviceMetricsOverride', {
            width: landscape ? 844 : 390, height: landscape ? 390 : 844, deviceScaleFactor: 1, mobile: true,
            screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 },
        });
        await page.waitForExpression(`matchMedia('(orientation: landscape)').matches === ${landscape}`, '旋转完成');
    };
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.evaluate(mock);
    await rotate(true);
    await page.waitForTestId('fullscreen-control');
    await page.click('fullscreen-control');
    await page.waitForExpression('document.fullscreenElement && localStorage.getItem("six-chess-fullscreen-preferred") === "1"', '重载前已保存偏好');
    await page.waitForExpression('document.fullscreenElement && localStorage.getItem("six-chess-fullscreen-preferred") === "1"', '记住全屏偏好');
    check('首次全屏保存偏好');

    await page.evaluate('window.__SIX_CHESS_E2E__.fxDemo("stage")');
    await page.waitForExpression('document.querySelector(".app-shell").dataset.phase === "battle"', '真实战斗界面');
    const battleBefore = JSON.stringify(await page.snapshot());
    await page.evaluate(`(() => { const s=window.__FULLSCREEN_TEST__; s.hidden=true; s.active=false;
        document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('fullscreenchange')); })()`);
    await rotate(false);
    await page.evaluate(`(() => { window.__FULLSCREEN_TEST__.hidden=false; document.dispatchEvent(new Event('visibilitychange')); })()`);
    assert.equal(await page.evaluate('window.__FULLSCREEN_TEST__.requests'), 1);
    check('后台退出保留偏好，竖屏返回不强制恢复');

    await page.evaluate('window.__FULLSCREEN_TEST__.allowed=false');
    await rotate(true);
    await page.waitForTestId('fullscreen-restore');
    assert.equal(await page.evaluate(`(() => { const el=document.querySelector('[data-testid="fullscreen-restore"]');
        const r=el.getBoundingClientRect(); return r.width>0 && r.height>=44 && r.right<=innerWidth && r.bottom<=innerHeight &&
        el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })()`), true);
    assert.equal(await page.evaluate('Boolean(document.querySelector(".mobile-settings-open"))'), false);
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/restore-in-battle.png`, Buffer.from(await page.screenshot(), 'base64'));
    check('自动恢复被拒绝时显示可直接触达的小入口，不依赖设置菜单');

    await page.evaluate('window.__FULLSCREEN_TEST__.allowed=true');
    await page.click('fullscreen-restore');
    await page.waitForExpression('document.fullscreenElement && !document.querySelector("[data-testid=fullscreen-restore]")', '一键恢复');
    assert.equal(JSON.stringify(await page.snapshot()), battleBefore);
    check('一键恢复不改变对局英雄/回合/生命值');

    await page.evaluate(`(() => { const s=window.__FULLSCREEN_TEST__; s.hidden=true;s.active=false;
        document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('fullscreenchange'));
        s.hidden=false;document.dispatchEvent(new Event('visibilitychange')); })()`);
    await page.waitForExpression('document.fullscreenElement', '前台横屏自动恢复');
    check('已横屏时切回浏览器自动恢复');

    await page.evaluate(`(() => { window.__FULLSCREEN_TEST__.active=false; document.dispatchEvent(new Event('fullscreenchange'));
        window.dispatchEvent(new Event('pageshow')); })()`);
    await page.waitForExpression('document.fullscreenElement', 'pageshow自动恢复');
    check('页面恢复/pageshow 自动恢复');

    await page.clickByText('设置');
    await page.click('fullscreen-control');
    const count = await page.evaluate('window.__FULLSCREEN_TEST__.requests');
    await rotate(false); await rotate(true);
    await page.evaluate('window.dispatchEvent(new Event("pageshow"))');
    assert.equal(await page.evaluate('window.__FULLSCREEN_TEST__.requests'), count);
    assert.equal(await page.evaluate('localStorage.getItem("six-chess-fullscreen-preferred")'), '0');
    check('主动退出后不再自动全屏');

    await page.click('fullscreen-control');
    await page.waitForExpression('document.fullscreenElement && localStorage.getItem("six-chess-fullscreen-preferred") === "1"', '重新选择全屏');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: mock });
    await page.send('Page.reload', {});
    await page.waitForExpression('window.__FULLSCREEN_TEST__?.requests >= 1 && document.fullscreenElement', '重载读取偏好');
    check('重新加载保留全屏偏好（不意味着恢复未保存的对局）');
    assert.deepEqual(page.errors, []);
    writeFileSync(`${out}/result.json`, JSON.stringify({ passed, note: '移动布局 Chromium；模拟系统全屏 API/visibility，非真机验收' }, null, 2));
} catch (error) {
    if (session) console.error(await session.page.evaluate(`JSON.stringify({state:window.__FULLSCREEN_TEST__,
        preferred:localStorage.getItem('six-chess-fullscreen-preferred'),mobile:matchMedia('(pointer: coarse) and (max-width: 1023px)').matches,
        landscape:matchMedia('(orientation: landscape)').matches,standalone:matchMedia('(display-mode: standalone)').matches,
        fullscreenMode:matchMedia('(display-mode: fullscreen)').matches,webkitFullscreen:!!document.webkitFullscreenElement,
        nativeStandalone:navigator.standalone, visibility:document.visibilityState,readyState:document.readyState,
        exceptions:[]})`).catch(() => '页面诊断不可用'));
    throw error;
} finally {
    await session?.close();
    server.httpServer.closeAllConnections();
    await new Promise(resolve => server.httpServer.close(resolve));
}
