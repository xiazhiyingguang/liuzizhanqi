import { describe, it, expect } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import {
    effectTypeLabel,
    formatPercent,
    mergeDuplicateEffects,
    visibleCounterEntries
} from '../../src/core/hero-status-presentation';
import type { Effect, Hero } from '../../src/types/game';
import { HeroState } from '../../src/types/game';

/**
 * 回归：英雄信息浮窗的展示层口径。
 *
 * 历史问题：
 * 1. EffectManager.addEffect 仅在带 stackCount 时合并同名同源效果，
 *    其余场景 push 新记录（新 id）→ 浮窗同一效果显示两次；
 * 2. counters 中的玩家向计数器（猎砂/天禄/破锋等）完全不展示；
 * 3. 暴击率/暴伤没有对外展示口径。
 * 展示层合并只影响信息卡呈现，不改战斗结算。
 */

function makeHero(overrides: Partial<Hero> = {}): Hero {
    return {
        id: 'test-hero',
        name: '测试英雄',
        class: '武曲',
        maxHp: 100,
        currentHp: 80,
        moveRange: 2,
        baseAttack: 30,
        position: [1, 1],
        state: HeroState.ALIVE,
        owner: 'player1',
        skill1Id: '',
        skill2Id: '',
        passiveId: '',
        effects: [],
        shield: 0,
        defense: 0,
        killCount: 0,
        hasActedThisTurn: false,
        hasMovedThisTurn: false,
        counters: {},
        ...overrides
    };
}

function makeEffect(overrides: Partial<Effect> = {}): Effect {
    return {
        id: `eff-${Math.random().toString(36).slice(2)}`,
        type: 'buff',
        name: '增益效果',
        duration: 2,
        sourceHeroId: 'source-a',
        ...overrides
    };
}

describe('mergeDuplicateEffects（效果展示去重）', () => {
    it('同名同源同类的多条记录合并为一条，层数求和', () => {
        const effects = [
            makeEffect({ id: 'e1', name: '来财', stackCount: 2 }),
            makeEffect({ id: 'e2', name: '来财', stackCount: 3 })
        ];

        const merged = mergeDuplicateEffects(effects);

        expect(merged).toHaveLength(1);
        expect(merged[0].stackCount).toBe(5);
    });

    it('不同来源的同名效果不合并', () => {
        const effects = [
            makeEffect({ id: 'e1', name: '鼓舞', sourceHeroId: 'hero-a' }),
            makeEffect({ id: 'e2', name: '鼓舞', sourceHeroId: 'hero-b' })
        ];

        expect(mergeDuplicateEffects(effects)).toHaveLength(2);
    });

    it('不同类型的同名效果不合并', () => {
        const effects = [
            makeEffect({ id: 'e1', name: '标记', type: 'mark' }),
            makeEffect({ id: 'e2', name: '标记', type: 'debuff' })
        ];

        expect(mergeDuplicateEffects(effects)).toHaveLength(2);
    });

    it('合并时时长取最长且永久(-1)优先', () => {
        const merged = mergeDuplicateEffects([
            makeEffect({ id: 'e1', duration: 2 }),
            makeEffect({ id: 'e2', duration: 4 }),
            makeEffect({ id: 'e3', duration: -1 })
        ]);

        expect(merged).toHaveLength(1);
        expect(merged[0].duration).toBe(-1);

        const mergedNoPermanent = mergeDuplicateEffects([
            makeEffect({ id: 'e1', duration: 2 }),
            makeEffect({ id: 'e2', duration: 4 })
        ]);
        expect(mergedNoPermanent[0].duration).toBe(4);
    });

    it('描述取首个非空值', () => {
        const merged = mergeDuplicateEffects([
            makeEffect({ id: 'e1', description: undefined }),
            makeEffect({ id: 'e2', description: '每层提升攻击' })
        ]);

        expect(merged).toHaveLength(1);
        expect(merged[0].description).toBe('每层提升攻击');
    });

    it('不修改原数组中的对象', () => {
        const original = makeEffect({ id: 'e1', stackCount: 1 });
        const effects = [original];

        mergeDuplicateEffects([...effects, makeEffect({ id: 'e2', name: '增益效果', sourceHeroId: 'source-a' })]);

        expect(original.stackCount).toBe(1);
    });
});

describe('visibleCounterEntries（玩家向计数器过滤）', () => {
    it('只保留含中文且值大于 0 的键', () => {
        const hero = makeHero({
            counters: {
                '猎砂': 2,
                '破锋': 0,
                talent_1: 3,
                __internal_mask: 7
            }
        });

        const entries = visibleCounterEntries(hero);

        expect(entries).toEqual([{ label: '猎砂', value: 2 }]);
    });

    it('counters 为空时返回空数组', () => {
        expect(visibleCounterEntries(makeHero())).toEqual([]);
    });
});

describe('formatPercent / effectTypeLabel', () => {
    it('formatPercent 四舍五入为整数百分比', () => {
        expect(formatPercent(0)).toBe('0%');
        expect(formatPercent(0.25)).toBe('25%');
        expect(formatPercent(1 / 3)).toBe('33%');
    });

    it('effectTypeLabel 覆盖全部类型', () => {
        expect(effectTypeLabel({ ...makeEffect(), type: 'buff' })).toBe('增益');
        expect(effectTypeLabel({ ...makeEffect(), type: 'debuff' })).toBe('减益');
        expect(effectTypeLabel({ ...makeEffect(), type: 'stun' })).toBe('眩晕');
        expect(effectTypeLabel({ ...makeEffect(), type: 'control' })).toBe('控制');
        expect(effectTypeLabel({ ...makeEffect(), type: 'shield' })).toBe('护盾');
        expect(effectTypeLabel({ ...makeEffect(), type: 'mark' })).toBe('标记');
    });
});

describe('DamageCalculator 展示口径', () => {
    it('默认暴击率为 0、暴伤为基础 1.5 倍（额外+50%）', () => {
        const hero = makeHero();

        expect(DamageCalculator.getDisplayedCritRate(hero)).toBe(0);
        expect(DamageCalculator.getDisplayedCritDamage(hero)).toBe(1.5);
    });

    it('风铃被动猎砂 2 层 → 暴击率 +40%', () => {
        const fengling = makeHero({
            passiveId: 'fengling_passive',
            counters: { '猎砂': 2 }
        });

        expect(DamageCalculator.getDisplayedCritRate(fengling)).toBeCloseTo(0.4);
        // 暴伤不受猎砂影响
        expect(DamageCalculator.getDisplayedCritDamage(fengling)).toBeCloseTo(1.5);
    });

    it('暴击率上限为 100%', () => {
        const fengling = makeHero({
            passiveId: 'fengling_passive',
            counters: { '猎砂': 4 },
            effects: [makeEffect({ name: '灵犀暴击率', value: 0.9 })]
        });

        expect(DamageCalculator.getDisplayedCritRate(fengling)).toBeLessThanOrEqual(1);
    });
});
