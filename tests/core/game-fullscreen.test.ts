import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterGameFullscreen, exitGameFullscreen, FULLSCREEN_PREFERENCE_KEY, installGameFullscreenRecovery, prefersGameFullscreen, setGameFullscreenPreference } from '../../src/core/game-fullscreen';

afterEach(() => vi.unstubAllGlobals());

function browser({ mobile = true, standalone = false } = {}) {
    const requestFullscreen = vi.fn(async () => { doc.fullscreenElement = doc.documentElement; });
    const doc = { fullscreenElement: null as unknown, documentElement: { requestFullscreen }, exitFullscreen: vi.fn(async () => { doc.fullscreenElement = null; }) };
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), localStorage: { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value) },
        matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') ? mobile : query.includes('standalone') && standalone }) });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', {});
    return doc;
}

describe('手机游戏全屏', () => {
    it('点击回调同步发起请求，整个文档包含浮层，要求隐藏导航栏', async () => {
        const doc = browser();
        const result = enterGameFullscreen();
        expect(doc.documentElement.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
        expect(await result).toBe(true);
        expect(prefersGameFullscreen()).toBe(true);
        await exitGameFullscreen();
        expect(prefersGameFullscreen()).toBe(false);
        expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    });
    it('电脑端不自动进入全屏', async () => {
        const doc = browser({ mobile: false });
        expect(await enterGameFullscreen()).toBe(false);
        expect(prefersGameFullscreen()).toBe(false);
        expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    });
    it('从主屏幕独立打开无需再次请求', async () => {
        const doc = browser({ standalone: true });
        expect(await enterGameFullscreen()).toBe(true);
        expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    });
    it('浏览器拒绝时返回失败，不抛出异常阻塞游戏', async () => {
        const doc = browser();
        doc.documentElement.requestFullscreen.mockRejectedValue(new Error('User activation required'));
        expect(await enterGameFullscreen()).toBe(false);
    });
    it('无全屏 API 时继续游戏', async () => {
        browser();
        vi.stubGlobal('document', { documentElement: {} });
        expect(await enterGameFullscreen()).toBe(false);
    });
    it('兼容 WebKit 前缀，重复进入不会再次申请', async () => {
        browser();
        const doc = { webkitFullscreenElement: null as unknown, documentElement: { webkitRequestFullscreen: vi.fn(async () => { doc.webkitFullscreenElement = doc.documentElement; }) } };
        vi.stubGlobal('document', doc);
        expect(await enterGameFullscreen()).toBe(true);
        expect(await enterGameFullscreen()).toBe(true);
        expect(doc.documentElement.webkitRequestFullscreen).toHaveBeenCalledOnce();
    });
});

/** 用原生 EventTarget 测试真实监听生命周期，不依赖 jsdom 伪造全屏能力。 */
function recoveryBrowser({ landscape = true, mobile = true, standalone = false, preferred = true } = {}) {
    const storage = new Map([[FULLSCREEN_PREFERENCE_KEY, preferred ? '1' : '0']]);
    const media = new Map<string, EventTarget & { matches: boolean }>();
    const win = Object.assign(new EventTarget(), {
        localStorage: { getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value) },
        screen: { orientation: new EventTarget() },
        matchMedia: (query: string) => {
            if (!media.has(query)) media.set(query, Object.assign(new EventTarget(), { matches:
                query.includes('pointer: coarse') ? mobile : query.includes('landscape') ? landscape : query.includes('standalone') && standalone }));
            return media.get(query)!;
        },
    });
    const doc = Object.assign(new EventTarget(), {
        visibilityState: 'visible', fullscreenElement: null as unknown,
        documentElement: { requestFullscreen: vi.fn(async () => {
            doc.fullscreenElement = doc.documentElement;
            doc.dispatchEvent(new Event('fullscreenchange'));
        }) },
        exitFullscreen: vi.fn(async () => { doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange')); }),
    });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', {});
    const notify = vi.fn();
    const setLandscape = (value: boolean) => {
        const orientation = win.matchMedia('(orientation: landscape)');
        orientation.matches = value;
        orientation.dispatchEvent(new Event('change'));
    };
    return { win, doc, notify, setLandscape, request: doc.documentElement.requestFullscreen };
}

describe('全屏偏好与返回游戏恢复', () => {
    it('记住之前的选择，横屏重新挂载时同步恢复', async () => {
        const { request, notify } = recoveryBrowser();
        const stop = installGameFullscreenRecovery(notify);
        expect(request).toHaveBeenCalledOnce();
        await Promise.resolve();
        expect(notify).toHaveBeenLastCalledWith(false);
        stop();
    });
    it('竖屏返回不强行全屏，转为横屏时才恢复', () => {
        const { request, setLandscape } = recoveryBrowser({ landscape: false });
        const stop = installGameFullscreenRecovery(vi.fn());
        expect(request).not.toHaveBeenCalled();
        setLandscape(true);
        expect(request).toHaveBeenCalledOnce();
        stop();
    });
    it.each(['pageshow', 'focus', 'orientationchange'])('%s 时尝试恢复，不依赖对局阶段', async event => {
        const { win, doc, request, notify } = recoveryBrowser();
        const stop = installGameFullscreenRecovery(notify);
        await Promise.resolve(); await Promise.resolve();
        doc.fullscreenElement = null;
        doc.dispatchEvent(new Event('fullscreenchange'));
        expect(request).toHaveBeenCalledOnce(); // 不在 fullscreenchange 里立即抢回全屏
        win.dispatchEvent(new Event(event));
        expect(request).toHaveBeenCalledTimes(2);
        stop();
    });
    it('后台退出不清除偏好，隐藏时不请求，回前台时恢复', async () => {
        const { doc, request, notify } = recoveryBrowser();
        const stop = installGameFullscreenRecovery(notify);
        await Promise.resolve(); await Promise.resolve();
        doc.visibilityState = 'hidden'; doc.fullscreenElement = null;
        doc.dispatchEvent(new Event('fullscreenchange'));
        doc.dispatchEvent(new Event('visibilitychange'));
        expect(prefersGameFullscreen()).toBe(true);
        expect(notify).toHaveBeenLastCalledWith(false);
        expect(request).toHaveBeenCalledOnce();
        doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
        expect(request).toHaveBeenCalledTimes(2);
        stop();
    });
    it('自动请求被拒绝时保留偏好并显示恢复入口，手动点击可重试', async () => {
        const { doc, request, notify } = recoveryBrowser();
        request.mockRejectedValueOnce(new Error('User activation required'));
        const stop = installGameFullscreenRecovery(notify);
        await Promise.resolve(); await Promise.resolve();
        expect(notify).toHaveBeenLastCalledWith(true);
        expect(prefersGameFullscreen()).toBe(true);
        expect(await enterGameFullscreen()).toBe(true);
        expect(doc.fullscreenElement).toBe(doc.documentElement);
        expect(notify).toHaveBeenLastCalledWith(false);
        stop();
    });
    it('主动退出后不再因前台/横屏变化自动进入', async () => {
        const { win, request, setLandscape, notify } = recoveryBrowser();
        const stop = installGameFullscreenRecovery(notify);
        await Promise.resolve(); await Promise.resolve();
        await exitGameFullscreen();
        win.dispatchEvent(new Event('pageshow')); setLandscape(false); setLandscape(true);
        expect(request).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenLastCalledWith(false);
        expect(prefersGameFullscreen()).toBe(false);
        stop();
    });
    it.each([{ mobile: false }, { standalone: true }, { preferred: false }])('桌面/独立应用/未选择全屏不请求：%o', options => {
        const { win, request, notify } = recoveryBrowser(options);
        const stop = installGameFullscreenRecovery(notify);
        win.dispatchEvent(new Event('pageshow'));
        expect(request).not.toHaveBeenCalled();
        expect(notify).toHaveBeenLastCalledWith(false);
        stop();
    });
    it('合并未完成请求，取消偏好不被异步结果写回，卸载后无监听残留', async () => {
        const { win, request, notify, setLandscape } = recoveryBrowser();
        let finish!: () => void;
        request.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const stop = installGameFullscreenRecovery(notify);
        win.dispatchEvent(new Event('focus')); win.dispatchEvent(new Event('pageshow'));
        expect(request).toHaveBeenCalledOnce();
        setGameFullscreenPreference(false);
        stop(); notify.mockClear(); finish();
        await Promise.resolve(); await Promise.resolve();
        win.dispatchEvent(new Event('pageshow')); setLandscape(false); setLandscape(true);
        expect(prefersGameFullscreen()).toBe(false);
        expect(request).toHaveBeenCalledOnce(); expect(notify).not.toHaveBeenCalled();
    });
    it('存储被禁止时仍能记住本次会话偏好', () => {
        const { win } = recoveryBrowser();
        vi.spyOn(win.localStorage, 'getItem').mockImplementation(() => { throw new Error('disabled'); });
        vi.spyOn(win.localStorage, 'setItem').mockImplementation(() => { throw new Error('disabled'); });
        setGameFullscreenPreference(true); expect(prefersGameFullscreen()).toBe(true);
        setGameFullscreenPreference(false); expect(prefersGameFullscreen()).toBe(false);
    });
});
