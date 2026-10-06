import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterGameFullscreen, exitGameFullscreen } from '../../src/core/game-fullscreen';

afterEach(() => vi.unstubAllGlobals());

function browser({ mobile = true, standalone = false } = {}) {
    const requestFullscreen = vi.fn(async () => { doc.fullscreenElement = doc.documentElement; });
    const doc = { fullscreenElement: null as unknown, documentElement: { requestFullscreen }, exitFullscreen: vi.fn(async () => { doc.fullscreenElement = null; }) };
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') ? mobile : query.includes('standalone') && standalone }) });
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
        await exitGameFullscreen();
        expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    });
    it('电脑端不自动进入全屏', async () => {
        const doc = browser({ mobile: false });
        expect(await enterGameFullscreen()).toBe(false);
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
