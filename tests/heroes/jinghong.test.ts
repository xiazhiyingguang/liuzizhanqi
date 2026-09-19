import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { createHero } from '../../src/data/heroes';
import { jinghongSkill1, jinghongSkill2 } from '../../src/data/extended-skills';
import { GameState, Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 惊鸿·止水回归。
 *
 * 裁定（与策划确认）：
 * 1. 惊鸿上限3层；技能2第一段一次消耗全部，防御与回血都按"消耗前"的层数结算；
 * 2. 第二段只在蓄力的下一回合开放，且该回合不能移动；错过即消散，惊鸿不返还；
 * 3. 技能1的绕后走正常移动，羽化/风刃/冰晶等位移连带结算照常触发，并占用本回合移动额度；
 *    身后越界或被占据时只攻击、不位移；
 * 4. 被动阈值边界（恰好50%）归给防御形态，避免一半血时既吃增伤又吃免伤；
 * 5. 天威暂未设计，不接入。
 */

function setup(): { state: GameState; hero: Hero; foe: Hero } {
    const state = makeGameState();
    const hero = addHero(state, 'jinghong', 'player1', [2, 2]);
    const foe = addHero(state, 'moran', 'player2', [2, 3]);
    return { state, hero, foe };
}

const cast1 = (hero: Hero, state: GameState, target: [number, number]) =>
    SkillSystem.executeSkill(hero, jinghongSkill1, [target], state);
const cast2 = (hero: Hero, state: GameState) =>
    SkillSystem.executeSkill(hero, jinghongSkill2, [hero.position as [number, number]], state);

describe('惊鸿·止水', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('模板字段与资源初始化，天威不接入', () => {
        const hero = createHero('jinghong', 'player1', [0, 0]);
        expect(hero.name).toBe('惊鸿·止水');
        expect(hero.class).toBe('武曲');
        expect(hero.maxHp).toBe(48);
        expect(hero.moveRange).toBe(2);
        expect(hero.skill1Id).toBe('jinghong_skill1');
        expect(hero.skill2Id).toBe('jinghong_skill2');
        expect(hero.tianweiId).toBeUndefined();
        expect(hero.counters['惊鸿']).toBe(0);
        expect(hero.counters['jinghong_charge_round']).toBe(-1);
    });

    it('技能1：命中3×3单体并落到目标身后一格，同时标记已移动', () => {
        const { state, hero, foe } = setup();
        const before = foe.currentHp;

        const result = cast1(hero, state, [2, 3]);

        expect(result.success).toBe(true);
        expect(result.damageDealt?.[0]).toBeGreaterThan(0);
        expect(foe.currentHp).toBeLessThan(before);
        expect(hero.position).toEqual([2, 4]);
        expect(state.board[2][4]).toBe(hero);
        expect(state.board[2][2]).toBeNull();
        expect(hero.hasMovedThisTurn).toBe(true);
        expect(EffectManager.getCounter(hero, '惊鸿')).toBe(1);
    });

    it('技能1：身后被占据时只攻击、不位移', () => {
        const { state, hero } = setup();
        const blocker = addHero(state, 'baize', 'player2', [2, 4]);

        const result = cast1(hero, state, [2, 3]);

        expect(result.success).toBe(true);
        expect(hero.position).toEqual([2, 2]);
        expect(blocker.position).toEqual([2, 4]);
        expect(hero.hasMovedThisTurn).toBe(false);
    });

    it('技能1：身后越出棋盘时只攻击、不位移', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jinghong', 'player1', [0, 1]);
        const foe = addHero(state, 'moran', 'player2', [0, 0]);   // 身后即盘外 [-1列]

        const result = cast1(hero, state, [0, 0]);

        expect(result.success).toBe(true);
        expect(foe.currentHp).toBeLessThan(foe.maxHp);
        expect(hero.position).toEqual([0, 1]);
    });

    it('惊鸿最多攒到3层，第4次命中不再增长', () => {
        const { state, hero } = setup();
        for (let i = 0; i < 4; i += 1) {
            cast1(hero, state, [2, 3]);
            hero.hasActedThisTurn = false;
            hero.hasMovedThisTurn = false;
        }
        expect(EffectManager.getCounter(hero, '惊鸿')).toBe(3);
    });

    it('技能2第一段：惊鸿为空时不可用', () => {
        const { state, hero } = setup();
        expect(SkillSystem.canUseSkill(hero, jinghongSkill2, state)).toBe(false);
        expect(cast2(hero, state).success).toBe(false);
    });

    it('技能2第一段：一次清空全部惊鸿，防御加成按消耗前的层数结算', () => {
        const { state, hero } = setup();
        EffectManager.setCounter(hero, '惊鸿', 3);

        const result = cast2(hero, state);

        expect(result.success).toBe(true);
        expect(EffectManager.getCounter(hero, '惊鸿')).toBe(0);
        expect(hero.counters['jinghong_charge_round']).toBe(state.roundNumber);
        expect(hero.counters['jinghong_charge_stacks']).toBe(3);
        const buff = hero.effects.find(effect => effect.name === '止水防御提升');
        expect(buff?.value).toBeCloseTo(0.4);
    });

    it('蓄力回血在整回合结束时结算，而不是放完技能就回', () => {
        const { state, hero, foe } = setup();
        EffectManager.setCounter(hero, '惊鸿', 3);
        hero.currentHp = 20;   // 已损 28 → 28 × 50% = 14

        expect(cast2(hero, state).success).toBe(true);
        expect(hero.currentHp).toBe(20);

        // 她自己行动结束，回合还没走完：不该回
        GameEngine.endHeroAction(hero, state);
        expect(hero.currentHp).toBe(20);

        // 最后一个行动结束触发回合末结算
        foe.hasActedThisTurn = true;
        GameEngine.endHeroAction(foe, state);
        expect(hero.currentHp).toBe(34);
    });

    it('蓄力回合里挨的打越多，回合末回得也越多（比例按消耗前层数锁定）', () => {
        const { state, hero, foe } = setup();
        EffectManager.setCounter(hero, '惊鸿', 1);   // 回复比例锁定为 30%
        hero.currentHp = 30;
        cast2(hero, state);
        GameEngine.endHeroAction(hero, state);

        // 她行动完之后又被削掉一截，回合末按"届时"的已损生命回复
        hero.currentHp = 10;
        foe.hasActedThisTurn = true;
        GameEngine.endHeroAction(foe, state);

        // 已损 38 × 30% = 11
        expect(hero.currentHp).toBe(21);
    });

    it('技能2第二段：蓄力当回合不能重复放，下一回合才开放，且只扫5×5外环', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jinghong', 'player1', [2, 2]);
        const adjacent = addHero(state, 'moran', 'player2', [2, 3]);   // 3×3 内：不吃决渊
        const ring = addHero(state, 'baize', 'player2', [0, 2]);       // 5×5 外环：吃决渊
        EffectManager.setCounter(hero, '惊鸿', 1);

        expect(cast2(hero, state).success).toBe(true);
        expect(cast2(hero, state).success).toBe(false);

        state.roundNumber += 1;
        const result = cast2(hero, state);

        expect(result.success).toBe(true);
        expect(result.damageDealt).toHaveLength(1);
        expect(ring.currentHp).toBeLessThan(ring.maxHp);
        expect(adjacent.currentHp).toBe(adjacent.maxHp);
        expect(hero.counters['jinghong_charge_round']).toBe(-1);
    });

    it('释放回合外环空无一人时判技能2不可用（避免落空施放卡住电脑）', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jinghong', 'player1', [2, 2]);
        const adjacent = addHero(state, 'moran', 'player2', [2, 3]);   // 只有贴身敌人，不在外环
        EffectManager.setCounter(hero, '惊鸿', 1);
        expect(cast2(hero, state).success).toBe(true);

        state.roundNumber += 1;
        expect(SkillSystem.canUseSkill(hero, jinghongSkill2, state)).toBe(false);
        expect(adjacent.currentHp).toBe(adjacent.maxHp);
    });

    it('错过释放窗口后蓄力自动消散，惊鸿不返还', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jinghong', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [0, 2]);   // 外环有敌人，窗口内本可以放出决渊
        EffectManager.setCounter(hero, '惊鸿', 2);
        cast2(hero, state);

        state.roundNumber += 1;
        expect(SkillSystem.canUseSkill(hero, jinghongSkill2, state)).toBe(true);

        // 这一回合什么都不做，直接进入下一回合
        state.roundNumber += 1;
        GameEngine.startNewTurn(state);

        expect(hero.counters['jinghong_charge_round']).toBe(-1);
        expect(hero.counters['jinghong_charge_stacks']).toBe(0);
        expect(SkillSystem.canUseSkill(hero, jinghongSkill2, state)).toBe(false);
    });

    it('被动：满血为攻击形态（增伤50%），跌破一半转入防御形态', () => {
        const healthy = setup();
        healthy.hero.currentHp = 48;
        const fullHpDamage = cast1(healthy.hero, healthy.state, [2, 3]).damageDealt?.[0] ?? 0;

        const wounded = setup();
        wounded.hero.currentHp = 20;
        const lowHpDamage = cast1(wounded.hero, wounded.state, [2, 3]).damageDealt?.[0] ?? 0;

        expect(fullHpDamage).toBeGreaterThan(lowHpDamage);
        expect(lowHpDamage).toBeGreaterThan(0);
    });

    it('被动：恰好50%生命归防御形态，不再吃攻击形态的增伤', () => {
        const atHalf = setup();
        atHalf.hero.currentHp = 24;
        const halfDamage = cast1(atHalf.hero, atHalf.state, [2, 3]).damageDealt?.[0] ?? 0;

        const aboveHalf = setup();
        aboveHalf.hero.currentHp = 25;
        const aboveDamage = cast1(aboveHalf.hero, aboveHalf.state, [2, 3]).damageDealt?.[0] ?? 0;

        expect(aboveDamage).toBeGreaterThan(halfDamage);
    });
});
