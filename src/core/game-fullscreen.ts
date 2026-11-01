import { MOBILE_LAYOUT_QUERY } from '../hooks/useMobileLayout';

type WebkitDocument = Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => void | Promise<void>;
};
type WebkitElement = HTMLElement & {
    webkitRequestFullscreen?: () => void | Promise<void>;
};

export const FULLSCREEN_PREFERENCE_KEY = 'six-chess-fullscreen-preferred';
const PREFERENCE_EVENT = 'game-fullscreen-preference-change';
let sessionPreference = false;

export function prefersGameFullscreen(): boolean {
    try { return window.localStorage.getItem(FULLSCREEN_PREFERENCE_KEY) === '1'; }
    catch { return sessionPreference; }
}

export function setGameFullscreenPreference(preferred: boolean): void {
    sessionPreference = preferred;
    try { window.localStorage.setItem(FULLSCREEN_PREFERENCE_KEY, preferred ? '1' : '0'); }
    catch { /* 无痕/存储受限时仍记住本次页面会话的选择。 */ }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

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

/** 在点击或用户横屏事件中同步调用，等待网络或切换页面后可能失去浏览器的用户激活。 */
export async function enterGameFullscreen({ remember = true } = {}): Promise<boolean> {
    if (typeof window === 'undefined' || !window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return false;
    if (isGameFullscreen() || isStandaloneGame()) {
        if (remember) setGameFullscreenPreference(true);
        return true;
    }
    const element = document.documentElement as WebkitElement;
    try {
        // 整个文档进入全屏，避免 body 上的详情/特效 portal 被留在全屏元素之外。
        if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: 'hide' });
        else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
        else return false;
        const success = isGameFullscreen();
        if (success && remember) setGameFullscreenPreference(true);
        return success;
    } catch {
        // 浏览器或嵌入页面可能拒绝；继续原来的游戏流程。
        return false;
    }
}

export async function exitGameFullscreen(): Promise<void> {
    // 只把游戏内主动退出当作取消偏好；切后台造成的系统退出不应清除偏好。
    setGameFullscreenPreference(false);
    if (!isGameFullscreen()) return;
    try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await (document as WebkitDocument).webkitExitFullscreen?.();
    } catch { /* 浏览器退出失败时保留当前可游玩状态。 */ }
}

/**
 * 全局安装一次，与游戏阶段无关。横屏事件中同步发起请求，保留浏览器给予的激活；
 * pageshow/focus 恢复可能被拒绝，此时只显示恢复入口，不拦截棋盘触摸、不循环申请。
 */
export function installGameFullscreenRecovery(onRestoreNeeded: (needed: boolean) => void): () => void {
    const landscape = window.matchMedia('(orientation: landscape)');
    const mobile = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const modes = ['standalone', 'fullscreen'].map(mode => window.matchMedia(`(display-mode: ${mode})`));
    let disposed = false;
    let pending = false;
    const needsRestore = () => document.visibilityState !== 'hidden' && mobile.matches && landscape.matches &&
        prefersGameFullscreen() && !isGameFullscreen() && !isStandaloneGame();
    const sync = () => { if (!disposed) onRestoreNeeded(needsRestore()); };
    const restore = () => {
        sync();
        if (disposed || pending || !needsRestore()) return;
        pending = true;
        // 不写回偏好：等待期间玩家可能主动取消了自动全屏。
        void enterGameFullscreen({ remember: false }).finally(() => { pending = false; sync(); });
    };
    const visibility = () => { if (document.visibilityState === 'hidden') sync(); else restore(); };
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    window.addEventListener('pageshow', restore);
    window.addEventListener('focus', restore);
    window.addEventListener('orientationchange', restore);
    window.addEventListener(PREFERENCE_EVENT, sync);
    window.addEventListener('storage', sync);
    landscape.addEventListener('change', restore);
    mobile.addEventListener('change', restore);
    modes.forEach(mode => mode.addEventListener('change', sync));
    window.screen?.orientation?.addEventListener('change', restore);
    restore();
    return () => {
        disposed = true;
        document.removeEventListener('visibilitychange', visibility);
        document.removeEventListener('fullscreenchange', sync);
        document.removeEventListener('webkitfullscreenchange', sync);
        window.removeEventListener('pageshow', restore);
        window.removeEventListener('focus', restore);
        window.removeEventListener('orientationchange', restore);
        window.removeEventListener(PREFERENCE_EVENT, sync);
        window.removeEventListener('storage', sync);
        landscape.removeEventListener('change', restore);
        mobile.removeEventListener('change', restore);
        modes.forEach(mode => mode.removeEventListener('change', sync));
        window.screen?.orientation?.removeEventListener('change', restore);
    };
}
