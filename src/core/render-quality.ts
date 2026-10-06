/**
 * 渲染画质档位 —— 表现层的单一事实源。
 *
 * 为什么不进 store：画质开关只被 CSS 选择器和特效组件在渲染时读一次，
 * 放进 Zustand 会让每个订阅 store 的组件跟着重渲染，反而更卡。
 * 这里用 `<html data-quality="low|full">` 当事实源：CSS 靠属性选择器降级，
 * JS 靠 currentQuality() 读同一个 dataset，两边永远一致。
 *
 * 命中任一条件即判低画质（详见 autoQuality）：
 *   1) `(pointer: coarse)` —— 手机/平板的主指针是触摸；
 *   2) `navigator.hardwareConcurrency <= 4` —— 四核以下的 CPU；
 *   3) 用户手动开关（localStorage 记忆，优先级最高，覆盖自动判定）。
 */

export type QualityMode = 'low' | 'full';
/** null = 交回自动判定 */
export type QualityPreference = QualityMode | null;

const QUALITY_STORAGE_KEY = 'six-chess-battle:quality-mode';

/** 四核及以下算"弱 CPU"：中低端安卓机普遍是 4～8 核，浏览器还能被系统限流 */
export const WEAK_CPU_CORE_THRESHOLD = 4;
/** 同屏技能特效层上限：桌面沿用 store 原来的 16 层，低画质压一半 */
export const FX_LAYER_LIMIT_FULL = 16;
export const FX_LAYER_LIMIT_LOW = 8;

function readStoredPreference(): QualityPreference {
    try {
        const raw = window.localStorage.getItem(QUALITY_STORAGE_KEY);
        return raw === 'low' || raw === 'full' ? raw : null;
    } catch {
        // 无痕模式 / localStorage 被禁：按自动判定走
        return null;
    }
}

let preference: QualityPreference = typeof window === 'undefined' ? null : readStoredPreference();

/** 触屏判定：桌面把窗口拖小不算，只有粗指针才是真的手指操作 */
export function hasCoarsePointer(): boolean {
    try {
        return window.matchMedia('(pointer: coarse)').matches;
    } catch {
        return false;
    }
}

function hasWeakCpu(): boolean {
    const cores = navigator.hardwareConcurrency;
    return typeof cores === 'number' && cores > 0 && cores <= WEAK_CPU_CORE_THRESHOLD;
}

/** 自动判定结果（不含用户手动开关） */
export function autoQuality(): QualityMode {
    return hasCoarsePointer() || hasWeakCpu() ? 'low' : 'full';
}

/** 生效档位 = 手动开关 > 自动判定 */
export function resolveQuality(): QualityMode {
    return preference ?? autoQuality();
}

/** 当前生效档位：直接读 <html> 的 dataset，保证和 CSS 看到的完全一致 */
export function currentQuality(): QualityMode {
    if (typeof document === 'undefined') return 'full';
    return document.documentElement.dataset.quality === 'low' ? 'low' : 'full';
}

export function isLowQuality(): boolean {
    return currentQuality() === 'low';
}

/** 把判定结果写回 <html data-quality>；返回生效档位 */
export function applyRenderQuality(): QualityMode {
    if (typeof document === 'undefined') return 'full';
    const mode = resolveQuality();
    document.documentElement.dataset.quality = mode;
    return mode;
}

/** 手动开关：传 null 交回自动判定。持久化失败不影响本次生效 */
export function setRenderQualityPreference(mode: QualityPreference): QualityMode {
    preference = mode;
    try {
        if (mode === null) window.localStorage.removeItem(QUALITY_STORAGE_KEY);
        else window.localStorage.setItem(QUALITY_STORAGE_KEY, mode);
    } catch {
        // 忽略存储异常
    }
    return applyRenderQuality();
}

export function getRenderQualityPreference(): QualityPreference {
    return preference;
}

/** 同屏特效层上限：低画质只保留最近 8 层（store 里 pushSkillFx 用） */
export function fxLayerLimit(): number {
    return isLowQuality() ? FX_LAYER_LIMIT_LOW : FX_LAYER_LIMIT_FULL;
}

/** 粒子/光点数量：低画质减半，最少留 2 粒以免"整个特效消失"看不出来 */
export function scaleParticleCount(count: number): number {
    if (!isLowQuality()) return count;
    return Math.max(2, Math.ceil(count / 2));
}

/**
 * 入口安装：渲染前先把档位写好（避免首帧按桌面画质重绘一次），
 * 并跟随指针类型变化——外接触控屏、桌面开移动模拟器都会切换。
 */
export function installRenderQuality(): QualityMode {
    const applied = applyRenderQuality();
    try {
        const coarse = window.matchMedia('(pointer: coarse)');
        coarse.addEventListener?.('change', () => applyRenderQuality());
    } catch {
        // 老浏览器没有 addEventListener：保持首次判定即可
    }
    return applied;
}
