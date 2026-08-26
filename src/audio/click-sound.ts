import { audioManager, UiClickSound } from './audio-manager';

const UI_CLICK_KINDS: readonly string[] = ['tap', 'primary', 'cancel', 'toggle', 'tab', 'skill'];

/**
 * 点击目标需要提供的最小探测接口。
 * HTMLElement 天然满足该结构；抽成结构类型是为了在无 DOM 环境下也能对解析逻辑做单元测试。
 */
interface ClickProbe {
    /** 向上查找最近匹配祖先（含自身），语义同 Element.closest */
    closest(selectors: string): ClickProbe | null;
    hasAttribute(name: string): boolean;
    getAttribute(name: string): string | null;
}

/** 从交互元素上读取显式 data-sfx 类别；未标注或非法时返回 null */
function readExplicitKind(from: ClickProbe): UiClickSound | null {
    const carrier = from.closest('[data-sfx]');
    const explicit = carrier?.getAttribute('data-sfx') ?? '';
    return UI_CLICK_KINDS.includes(explicit) ? (explicit as UiClickSound) : null;
}

/**
 * 纯逻辑解析：给定命中的交互元素（button / [role="button"]），决定点击音效类别。
 * - 禁用按钮不发声
 * - 优先读取自身或祖先上的 data-sfx 标签（允许整块面板统一标注）
 * - 未标注时回落为默认的 tap
 */
export function resolveUiClickKindFrom(interactive: ClickProbe | null): UiClickSound | null {
    if (!interactive || interactive.hasAttribute('disabled')) return null;
    return readExplicitKind(interactive) ?? 'tap';
}

/**
 * 由原始事件目标解析点击音效类别：
 * 向上找最近的 button / [role="button"]，非交互目标不发声。
 */
export function resolveUiClickKind(target: EventTarget | null): UiClickSound | null {
    if (typeof Element === 'undefined' || !(target instanceof Element)) return null;
    const interactive = target.closest<HTMLElement>('button, [role="button"]');
    if (!interactive) return null;
    return resolveUiClickKindFrom(interactive);
}

/** 在 window 上以捕获阶段监听 pointerdown，让所有按钮自动获得分类点击音效；返回卸载函数 */
export function installClickSounds(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const handler = (event: Event): void => {
        const kind = resolveUiClickKind(event.target);
        if (kind) audioManager.playUiClick(kind);
    };
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
}
