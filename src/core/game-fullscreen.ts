import { MOBILE_LAYOUT_QUERY } from '../hooks/useMobileLayout';

type WebkitDocument = Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => void | Promise<void>;
};
type WebkitElement = HTMLElement & {
    webkitRequestFullscreen?: () => void | Promise<void>;
};

export function isStandaloneGame(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches ||
        (!isGameFullscreen() && window.matchMedia('(display-mode: fullscreen)').matches) ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isGameFullscreen(): boolean {
    return typeof document !== 'undefined' && Boolean(document.fullscreenElement ||
        (document as WebkitDocument).webkitFullscreenElement);
}

/** 必须直接在点击回调中调用，等待网络或切换页面后会失去浏览器的用户激活。 */
export async function enterGameFullscreen(): Promise<boolean> {
    if (typeof window === 'undefined' || !window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return false;
    if (isGameFullscreen() || isStandaloneGame()) return true;
    const element = document.documentElement as WebkitElement;
    try {
        // 整个文档进入全屏，避免 body 上的详情/特效 portal 被留在全屏元素之外。
        if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: 'hide' });
        else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
        else return false;
        return isGameFullscreen();
    } catch {
        // 浏览器或嵌入页面可能拒绝；继续原来的游戏流程。
        return false;
    }
}

export async function exitGameFullscreen(): Promise<void> {
    if (!isGameFullscreen()) return;
    try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await (document as WebkitDocument).webkitExitFullscreen?.();
    } catch { /* 浏览器退出失败时保留当前可游玩状态。 */ }
}
