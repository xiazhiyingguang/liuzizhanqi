import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { feixueSkill1, feixueSkill2 } from '../../src/data/extended-skills';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('绯雪', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('以武曲45生命、2移动完整接入两项技能与天威', () => {
        const state = makeGameState();
        const hero = addHero(state, 'feixue', 'player1', [2, 2]);

        expect(hero).toMatchObject({
            name: '绯雪',
            class: '武曲',
            maxHp: 45,
            currentHp: 45,
            moveRange: 2,
            skill1Id: 'feixue_skill1',
            skill2Id: 'feixue_skill2',
            passiveId: 'feixue_passive',
            tianweiId: 'feixue_tianwei',
        });
    });

    it('共享不同冰系英雄施加的寒天，累计3层时统一转为冰冻', () => {
        const state = makeGameState();
        const guying = addHero(state, 'guying', 'player1', [0, 0]);
        const hanjiangxue = addHero(state, 'hanjiangxue', 'player1', [0, 1]);
        const feixue = addHero(state, 'feixue', 'player1', [0, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 2]);

        DamageCalculator.applyHantianStacks(target, 1, guying.id, state);
        DamageCalculator.applyHantianStacks(target, 1, hanjiangxue.id, state);

        expect(target.effects.filter(effect => effect.name === '寒天')).toHaveLength(1);
        expect(DamageCalculator.getHantianStackCount(target)).toBe(2);

        DamageCalculator.applyHantianStacks(target, 1, feixue.id, state);

        expect(DamageCalculator.getHantianStackCount(target)).toBe(0);
        expect(EffectManager.hasEffect(target, '冰冻')).toBe(true);
    });

    it('技能一普通命中受防御影响，且不会产生破冰爆炸', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 0]);
        const target = addHero(state, 'moran', 'player2', [2, 2]);
        const nearby = addHero(state, 'baize', 'player2', [2, 3]);
        target.defense = 0.25;

        const output = SkillSystem.executeSkill(caster, feixueSkill1, [[2, 2]], state);

        expect(output.success).toBe(true);
        expect(target.currentHp).toBe(target.maxHp - 6);
        expect(nearby.currentHp).toBe(nearby.maxHp);
        expect(DamageCalculator.getHantianStackCount(nearby)).toBe(0);
    });

    it('技能一击碎冰冻：主目标与八邻格爆炸均无视防御，主目标不重复受击', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 0]);
        const target = addHero(state, 'moran', 'player2', [2, 2]);
        const splashTarget = addHero(state, 'moran', 'player2', [1, 1]);
        const ally = addHero(state, 'baize', 'player1', [1, 2]);
        const outside = addHero(state, 'baize', 'player2', [0, 0]);
        target.defense = 0.9;
        splashTarget.defense = 0.5;
        EffectManager.addEffect(target, {
            type: 'stun', name: '冰冻', duration: 1,
            sourceHeroId: caster.id, description: '测试冰冻',
        });
        DamageCalculator.applyHantianStacks(splashTarget, 1, caster.id, state);

        const output = SkillSystem.executeSkill(caster, feixueSkill1, [[2, 2]], state);

        expect(output.success).toBe(true);
        expect(EffectManager.hasEffect(target, '冰冻')).toBe(false);
        expect(target.currentHp).toBe(target.maxHp - 8);
        // 爆炸6点真实伤害 + 既有1层寒天触发的2点霜噬真实伤害。
        expect(splashTarget.currentHp).toBe(splashTarget.maxHp - 8);
        expect(DamageCalculator.getHantianStackCount(splashTarget)).toBe(2);
        expect(ally.currentHp).toBe(ally.maxHp);
        expect(outside.currentHp).toBe(outside.maxHp);
    });

    it('技能一即使先击杀冰冻主目标，也会完整结算破冰爆炸', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 0]);
        const target = addHero(state, 'moran', 'player2', [2, 2]);
        const splashTarget = addHero(state, 'baize', 'player2', [1, 2]);
        target.currentHp = 1;
        EffectManager.addEffect(target, {
            type: 'stun', name: '冰冻', duration: 1,
            sourceHeroId: caster.id, description: '测试冰冻',
        });

        SkillSystem.executeSkill(caster, feixueSkill1, [[2, 2]], state);

        expect(target.state).toBe(HeroState.DEAD);
        expect(splashTarget.currentHp).toBe(splashTarget.maxHp - 6);
        expect(DamageCalculator.getHantianStackCount(splashTarget)).toBe(1);
    });

    it('致知二只把破冰爆炸由6提升为8', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 0]);
        const target = addHero(state, 'moran', 'player2', [2, 2]);
        const splashTarget = addHero(state, 'baize', 'player2', [1, 2]);
        caster.counters['talent_2'] = 1;
        EffectManager.addEffect(target, {
            type: 'stun', name: '冰冻', duration: 1,
            sourceHeroId: caster.id, description: '测试冰冻',
        });

        SkillSystem.executeSkill(caster, feixueSkill1, [[2, 2]], state);

        expect(target.currentHp).toBe(target.maxHp - 8);
        expect(splashTarget.currentHp).toBe(splashTarget.maxHp - 8);
    });

    it('技能二按寒天层数增伤、附加被动真实伤害、消费寒天并治疗', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        const otherSource = addHero(state, 'hanjiangxue', 'player1', [0, 0]);
        caster.currentHp = 30;
        target.defense = 0.25;
        DamageCalculator.applyHantianStacks(target, 1, otherSource.id, state);
        DamageCalculator.applyHantianStacks(target, 1, caster.id, state);

        const output = SkillSystem.executeSkill(caster, feixueSkill2, [[2, 3]], state);

        // 普通段：(8 + 2x2) x 75% = 9；霜噬：40 x 5% x 2 = 4。
        expect(output.damageDealt).toEqual([13]);
        expect(target.currentHp).toBe(27);
        expect(DamageCalculator.getHantianStackCount(target)).toBe(0);
        expect(caster.currentHp).toBe(34);
        expect(output.healingDone).toEqual([4]);
        expect(state.battleStatistics?.[caster.id]).toMatchObject({
            damageDealt: 13,
            healingDone: 4,
        });
    });

    it('技能二攻击冰冻目标必暴，按寒天回血并保留冰冻与寒天', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        caster.currentHp = 30;
        target.defense = 0.25;
        EffectManager.addEffect(target, {
            type: 'stun', name: '冰冻', duration: 1,
            sourceHeroId: caster.id, description: '测试冰冻',
        });
        DamageCalculator.applyHantianStacks(target, 2, caster.id, state);

        const output = SkillSystem.executeSkill(caster, feixueSkill2, [[2, 3]], state);

        // 必暴普通段：floor(12 x 1.5 x 75%) = 13；霜噬真实伤害4。
        expect(output.damageDealt).toEqual([17]);
        expect(target.currentHp).toBe(23);
        expect(EffectManager.hasEffect(target, '冰冻')).toBe(true);
        expect(DamageCalculator.getHantianStackCount(target)).toBe(2);
        expect(caster.currentHp).toBe(34);
        expect(output.healingDone).toEqual([4]);
        expect(state.battleStatistics?.[caster.id]?.healingDone).toBe(4);
    });

    it('致知三把霜噬从每层5%提升为每层10%', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        caster.counters['talent_3'] = 1;
        DamageCalculator.applyHantianStacks(target, 2, caster.id, state);

        const output = SkillSystem.executeSkill(caster, feixueSkill2, [[2, 3]], state);

        // 普通段12 + 40 x 10% x 2 = 8点霜噬。
        expect(output.damageDealt).toEqual([20]);
        expect(target.currentHp).toBe(20);
    });

    it('致知一在开局生效一次，使生命45提升到53', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [4, 4]);
        caster.counters['talent_1'] = 1;

        GameEngine.startNewTurn(state);
        GameEngine.startNewTurn(state);

        expect(caster.maxHp).toBe(53);
        expect(caster.currentHp).toBe(53);
    });

    it('绝对零度冻结生命百分比最低的合法目标并保留其寒天', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        const higherRatio = addHero(state, 'moran', 'player2', [1, 1]);
        const lowerRatio = addHero(state, 'baize', 'player2', [4, 4]);
        const alreadyFrozen = addHero(state, 'moran', 'player2', [5, 5]);
        victim.currentHp = 1;
        higherRatio.currentHp = 20;
        lowerRatio.currentHp = 5;
        alreadyFrozen.currentHp = 1;
        for (const target of [higherRatio, lowerRatio, alreadyFrozen]) {
            DamageCalculator.applyHantianStacks(target, 1, caster.id, state);
        }
        EffectManager.addEffect(alreadyFrozen, {
            type: 'stun', name: '冰冻', duration: 1,
            sourceHeroId: caster.id, description: '已被冻结',
        });

        const lethal = DamageCalculator.calculate(caster, victim, 8);
        DamageCalculator.applyDamage(victim, lethal, caster, state);

        expect(victim.state).toBe(HeroState.DEAD);
        expect(EffectManager.hasEffect(lowerRatio, '冰冻')).toBe(true);
        expect(DamageCalculator.getHantianStackCount(lowerRatio)).toBe(1);
        expect(EffectManager.hasEffect(higherRatio, '冰冻')).toBe(false);
        expect(state.battleLog.some(entry =>
            entry.type === 'tianwei' && entry.details?.targetHeroId === lowerRatio.id
        )).toBe(true);
    });

    it('绝对零度同百分比时按当前生命、棋盘位置和ID稳定选人', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const victim = addHero(state, 'baize', 'player2', [2, 3]);
        const laterOnBoard = addHero(state, 'moran', 'player2', [4, 4]);
        const earlierOnBoard = addHero(state, 'hanjiangxue', 'player2', [1, 3]);
        victim.currentHp = 1;
        laterOnBoard.currentHp = 20;
        earlierOnBoard.currentHp = 20;
        DamageCalculator.applyHantianStacks(laterOnBoard, 1, caster.id, state);
        DamageCalculator.applyHantianStacks(earlierOnBoard, 1, caster.id, state);

        DamageCalculator.applyDamage(
            victim,
            DamageCalculator.calculate(caster, victim, 8),
            caster,
            state
        );

        expect(EffectManager.hasEffect(earlierOnBoard, '冰冻')).toBe(true);
        expect(EffectManager.hasEffect(laterOnBoard, '冰冻')).toBe(false);
    });
});
