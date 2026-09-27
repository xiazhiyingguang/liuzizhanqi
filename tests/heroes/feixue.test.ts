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

    it('技能一击碎冰冻时上报「破冰爆震」特效形态与 3x3 爆震范围', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 0]);
        const target = addHero(state, 'moran', 'player2', [2, 2]);
        EffectManager.addEffect(target, {
            type: 'stun', name: '冰冻', duration: 1,
            sourceHeroId: caster.id, description: '测试冰冻',
        });

        SkillSystem.executeSkill(caster, feixueSkill1, [[2, 2]], state);

        expect(state.skillFxExtras?.fxVariant).toBe('feixue_shatter');
        const covered = state.skillFxExtras?.coveredPositions ?? [];
        expect(covered).toContainEqual([2, 2]);
        expect(covered).toContainEqual([1, 1]);
        expect(covered).toHaveLength(9);
    });

    it('技能一普通命中不上报特效形态（碎冰形态仅限击碎冰冻）', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 0]);
        addHero(state, 'moran', 'player2', [2, 2]);

        SkillSystem.executeSkill(caster, feixueSkill1, [[2, 2]], state);

        expect(state.skillFxExtras).toBeUndefined();
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
        // 两名候选都取满血40的模板（夜枭/寒江雪），保证当前生命与最大生命比率完全相同
        const laterOnBoard = addHero(state, 'nightowl', 'player2', [4, 4]);
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

    it('技能二「连枝」给友方挂上2回合连枝，且不能系在自己身上', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);

        expect(SkillSystem.executeSkill(caster, feixueSkill2, [[2, 2]], state).success).toBe(false);
        const output = SkillSystem.executeSkill(caster, feixueSkill2, [[2, 1]], state);

        expect(output.success).toBe(true);
        expect(EffectManager.hasEffect(ally, '连枝')).toBe(true);
        expect(ally.effects.find(e => e.name === '连枝')).toMatchObject({ duration: 2, sourceHeroId: caster.id });
    });

    it('连枝友方出手后绯雪追出6点，未连枝的友方不触发', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const other = addHero(state, 'huifeng', 'player1', [1, 1]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        SkillSystem.executeSkill(caster, feixueSkill2, [[2, 1]], state);

        const hpBefore = enemy.currentHp;
        const hit = DamageCalculator.calculate(ally, enemy, 5, false);
        DamageCalculator.asOneAttack(() => DamageCalculator.applyDamage(enemy, hit, ally, state));

        expect(hpBefore - enemy.currentHp).toBe(hit.finalDamage + 6);

        const untouched = addHero(state, 'liuli', 'player2', [3, 4]);
        const otherHit = DamageCalculator.calculate(other, untouched, 5, false);
        const otherBefore = untouched.currentHp;
        DamageCalculator.asOneAttack(() => DamageCalculator.applyDamage(untouched, otherHit, other, state));
        expect(otherBefore - untouched.currentHp).toBe(otherHit.finalDamage);
    });

    it('连枝追击不叠加触发：绯雪自己那一击不会再引出下一次追击', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        enemy.defense = 0;
        caster.defense = 0;
        SkillSystem.executeSkill(caster, feixueSkill2, [[2, 1]], state);

        const hit = DamageCalculator.calculate(ally, enemy, 1, false);
        DamageCalculator.asOneAttack(() => DamageCalculator.applyDamage(enemy, hit, ally, state));

        // 友方1点 + 追击6点；若追击又触发一次6点，这里就会少算
        expect(enemy.maxHp - enemy.currentHp).toBe(7);
    });

    it('连枝群攻时随机追一名被命中者', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const first = addHero(state, 'baize', 'player2', [2, 4]);
        const last = addHero(state, 'huifeng', 'player2', [3, 4]);
        SkillSystem.executeSkill(caster, feixueSkill2, [[2, 1]], state);

        DamageCalculator.asOneAttack(() => {
            for (const target of [first, last]) {
                const hit = DamageCalculator.calculate(ally, target, 5, false);
                DamageCalculator.applyDamage(target, hit, ally, state);
            }
        });

        expect(first.maxHp - first.currentHp).toBe(5);
        expect(last.maxHp - last.currentHp).toBe(11);
    });

    it('连枝友方触发天威时，绯雪同步触发一次绝对零度', () => {
        const state = makeGameState();
        const caster = addHero(state, 'feixue', 'player1', [2, 2]);
        const ally = addHero(state, 'guying', 'player1', [2, 1]);   // 孤影：击杀触发断雪
        const doomed = addHero(state, 'baize', 'player2', [2, 4]);
        const marked = addHero(state, 'moran', 'player2', [0, 0]);
        SkillSystem.executeSkill(caster, feixueSkill2, [[2, 1]], state);
        DamageCalculator.applyHantianStacks(marked, 1, caster.id, state);
        doomed.currentHp = 1;

        const hit = DamageCalculator.calculate(ally, doomed, 9, false, true);
        DamageCalculator.asOneAttack(() => DamageCalculator.applyDamage(doomed, hit, ally, state));

        expect(doomed.state).not.toBe(HeroState.ALIVE);
        expect(EffectManager.hasEffect(ally, '断雪')).toBe(true);
        expect(EffectManager.hasEffect(marked, '冰冻')).toBe(true);
    });
});
