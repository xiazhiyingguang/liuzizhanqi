/**
 * 画质档位与它实际削减的两处开销：同屏特效层上限、粒子数量。
 *
 * vitest 跑在 node 环境（组件测试用 renderToStaticMarkup），没有真的 DOM，
 * 所以这里垫一个最小 document/window：render-quality 的事实源就是
 * `<html data-quality>` 这一个属性，不需要完整 DOM。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    FX_LAYER_LIMIT_FULL,
    FX_LAYER_LIMIT_LOW,
    applyRenderQuality,
    fxLayerLimit,
    scaleParticleCount,
    setRenderQualityPreference,
} from '../../src/core/render-quality';
import { useGameStore } from '../../src/store/game-store';
import { resolveSkillFx } from '../../src/core/skill-fx';

const root: { dataset: Record<string, string> } = { dataset: {} };
Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: root, addEventListener: () => undefined },
});

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
        localStorage: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key),
        },
        matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
        navigator: { hardwareConcurrency: 8 },
    },
});

function pushFx(count: number) {
    const profile = resolveSkillFx('moran_skill1');
    for (let index = 0; index < count; index++) {
        useGameStore.getState().pushSkillFx({
            profile,
            skillId: 'moran_skill1',
            sourceHeroId: 'hero-1',
            fromPos: [2, 2] as [number, number],
            targetPos: [2, 3] as [number, number],
            angleDeg: 0,
        });
    }
    return useGameStore.getState().skillFx.length;
}

afterEach(() => {
    setRenderQualityPreference(null);
    useGameStore.setState({ skillFx: [] });
    store.clear();
    root.dataset = {};
});

describe('渲染画质档位', () => {
    it('默认按指针与 CPU 自动判定：细指针加八核算高清', () => {
        expect(applyRenderQuality()).toBe('full');
        expect(root.dataset.quality).toBe('full');
    });

    it('手动开关写进 dataset 并持久化，优先级高于自动判定', () => {
        expect(setRenderQualityPreference('low')).toBe('low');
        expect(root.dataset.quality).toBe('low');
        expect(setRenderQualityPreference(null)).toBe('full');
    });

    it('流畅档把同屏特效层上限减半，粒子减半但最少留两粒', () => {
        setRenderQualityPreference('full');
        expect(fxLayerLimit()).toBe(FX_LAYER_LIMIT_FULL);
        expect(scaleParticleCount(8)).toBe(8);

        setRenderQualityPreference('low');
        expect(fxLayerLimit()).toBe(FX_LAYER_LIMIT_LOW);
        expect(scaleParticleCount(8)).toBe(4);
        // 只剩两三粒的散件不能砍成 0，否则整个零件直接消失，看不出"这是同一个特效"
        expect(scaleParticleCount(3)).toBe(2);
        expect(scaleParticleCount(1)).toBe(2);
    });

    it('特效队列按档位裁剪：流畅档只留最近 8 层', () => {
        setRenderQualityPreference('full');
        expect(pushFx(12)).toBe(12);

        useGameStore.setState({ skillFx: [] });
        setRenderQualityPreference('low');
        expect(pushFx(12)).toBe(FX_LAYER_LIMIT_LOW);
        // 留下的是最近的几层，不是最先发的
        expect(useGameStore.getState().skillFx.at(-1)?.skillId).toBe('moran_skill1');
    });
});
