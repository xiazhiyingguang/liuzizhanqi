import { describe, expect, it } from 'vitest';
import { resolveUiClickKind, resolveUiClickKindFrom } from '../../src/audio/click-sound';

/** 构造带祖先链的最小探测节点：attrs 含 data-sfx / disabled / role 等属性 */
function makeProbe(
    attrs: Record<string, string> = {},
    parent: ReturnType<typeof makeProbe> | null = null,
): ReturnType<typeof makeProbe> {
    type Probe = {
        attrs: Record<string, string>;
        parent: Probe | null;
        closest: (selectors: string) => Probe | null;
        hasAttribute: (name: string) => boolean;
        getAttribute: (name: string) => string | null;
    };
    const node: Probe = {
        attrs,
        parent,
        closest(selectors: string) {
            let current: Probe | null = node;
            while (current) {
                if (selectors === 'button' && current.attrs['data-tag'] === 'button') return current;
                if (selectors === '[data-sfx]' && 'data-sfx' in current.attrs) return current;
                current = current.parent;
            }
            return null;
        },
        hasAttribute(name) {
            return name in this.attrs;
        },
        getAttribute(name) {
            return this.attrs[name] ?? null;
        },
    };
    return node;
}

describe('UI 点击音效分类解析', () => {
    it('未标注的普通按钮回落为 tap', () => {
        const probe = makeProbe({ 'data-tag': 'button' });
        expect(resolveUiClickKindFrom(probe)).toBe('tap');
    });

    it('data-sfx 显式标注生效', () => {
        for (const kind of ['primary', 'cancel', 'toggle', 'tab', 'skill', 'tap']) {
            const probe = makeProbe({ 'data-tag': 'button', 'data-sfx': kind });
            expect(resolveUiClickKindFrom(probe)).toBe(kind);
        }
    });

    it('点击按钮内子元素时向上继承最近的 data-sfx', () => {
        // 子元素命中点向上经过按钮再到面板：最近携带者决定类别
        const panel = makeProbe({ 'data-sfx': 'skill' });
        const button = makeProbe({ 'data-tag': 'button' }, panel);
        expect(resolveUiClickKindFrom(button)).toBe('skill');
    });

    it('按钮自身的标签优先于容器标注', () => {
        const panel = makeProbe({ 'data-sfx': 'skill' });
        const button = makeProbe({ 'data-tag': 'button', 'data-sfx': 'cancel' }, panel);
        expect(resolveUiClickKindFrom(button)).toBe('cancel');
    });

    it('非法 data-sfx 值回落为 tap', () => {
        const probe = makeProbe({ 'data-tag': 'button', 'data-sfx': 'boom' });
        expect(resolveUiClickKindFrom(probe)).toBe('tap');
    });

    it('禁用按钮不发声', () => {
        const probe = makeProbe({ 'data-tag': 'button', 'disabled': '' });
        expect(resolveUiClickKindFrom(probe)).toBeNull();
        expect(resolveUiClickKindFrom(null)).toBeNull();
    });

    it('事件目标薄壳：非 DOM 目标在 Node 环境下返回 null', () => {
        // Node 测试环境没有 Element 构造器，任何非 Element 目标都应安全返回 null
        expect(resolveUiClickKind(null)).toBeNull();
        expect(resolveUiClickKind({} as EventTarget)).toBeNull();
    });
});
