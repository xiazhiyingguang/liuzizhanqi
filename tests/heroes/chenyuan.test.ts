import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { chenyuanSkill1, chenyuanSkill2 } from '../../src/data/extended-skills';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('沉渊·镇岳', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('以霸魁60生命、1移动完整接入两项技能、被动与天威', () => {
        const state = makeGameState();
        const hero = addHero(state, 'chenyuan', 'player1', [2, 2]);

        expect(hero).toMatchObject({
            name: '沉渊·镇岳',
            class: '霸魁',
            maxHp: 60,
            currentHp: 60,
            moveRange: 1,
            baseAttack: 0,
            skill1Id: 'chenyuan_skill1',
            skill2Id: 'chenyuan_skill2',
            passiveId: 'chenyuan_passive',
            tianweiId: 'chenyuan_tianwei',
        });
    });

    it('渊引把直线3格外的敌人拉到身旁，造成6点伤害并施加1层寒天', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 0]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        target.defense = 0;

        const output = SkillSystem.executeSkill(caster, chenyuanSkill1, [[2, 3]], state);

        expect(output.success).toBe(true);
        expect(target.position).toEqual([2, 1]);
        expect(state.board[2][1]).toBe(target);
        expect(state.board[2][3]).toBeNull();
        expect(target.currentHp).toBe(target.maxHp - 6);
        expect(DamageCalculator.getHantianStackCount(target)).toBe(1);
    });

    it('渊引对距离2的目标只拉近1格', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 0]);
        const target = addHero(state, 'moran', 'player2', [2, 2]);

        const output = SkillSystem.executeSkill(caster, chenyuanSkill1, [[2, 2]], state);

        expect(output.success).toBe(true);
        expect(target.position).toEqual([2, 1]);
    });

    it('渊引拖拽路径受阻时目标原地不动，但仍受到伤害与寒天', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 0]);
        const blocker = addHero(state, 'baize', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        target.defense = 0;

        const output = SkillSystem.executeSkill(caster, chenyuanSkill1, [[2, 3]], state);

        expect(output.success).toBe(true);
        expect(blocker.position).toEqual([2, 2]);
        expect(target.position).toEqual([2, 3]);
        expect(target.currentHp).toBe(target.maxHp - 6);
        expect(DamageCalculator.getHantianStackCount(target)).toBe(1);
    });

    it('渊引拒绝不在同一直线上的目标', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [3, 3]);

        const output = SkillSystem.executeSkill(caster, chenyuanSkill1, [[3, 3]], state);

        expect(output.success).toBe(false);
        expect(target.position).toEqual([3, 3]);
        expect(target.currentHp).toBe(target.maxHp);
        expect(DamageCalculator.getHantianStackCount(target)).toBe(0);
    });

    it('渊引拒绝距离超过3格的目标', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 0]);
        const target = addHero(state, 'moran', 'player2', [2, 4]);

        const output = SkillSystem.executeSkill(caster, chenyuanSkill1, [[2, 4]], state);

        expect(output.success).toBe(false);
        expect(target.position).toEqual([2, 4]);
        expect(target.currentHp).toBe(target.maxHp);
    });

    it('寒渊庇护援护周围2格内所有友方，范围外友方不受影响', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 2]);
        const near1 = addHero(state, 'baize', 'player1', [1, 2]);
        const near2 = addHero(state, 'hanjiangxue', 'player1', [2, 4]);
        const near3 = addHero(state, 'guying', 'player1', [0, 2]);
        const corner = addHero(state, 'feixue', 'player1', [0, 0]);
        const outside = addHero(state, 'liuli', 'player1', [5, 5]);

        const output = SkillSystem.executeSkill(caster, chenyuanSkill2, [[2, 2]], state);

        expect(output.success).toBe(true);
        for (const ally of [near1, near2, near3, corner]) {
            const guard = ally.effects.find(effect => effect.name === '援护');
            expect(guard).toMatchObject({
                duration: 2,
                value: 0.3,
                sourceHeroId: caster.id,
            });
        }
        expect(outside.effects.find(effect => effect.name === '援护')).toBeUndefined();
    });

    it('沉渊援护按30%比例分担伤害：10点伤害由沉渊承担3点、友方承担7点', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [0, 0]);
        caster.defense = 0;
        const ally = addHero(state, 'moran', 'player1', [0, 1]);
        ally.defense = 0;
        const attacker = addHero(state, 'baize', 'player2', [5, 5]);

        SkillSystem.executeSkill(caster, chenyuanSkill2, [[0, 0]], state);
        const damage = DamageCalculator.calculate(attacker, ally, 10);
        DamageCalculator.applyDamage(ally, damage, attacker, state);

        // 10点伤害：沉渊承担 floor(10 x 30%) = 3 点，友方承受剩余 7 点。
        expect(caster.currentHp).toBe(caster.maxHp - 3);
        expect(ally.currentHp).toBe(ally.maxHp - 7);
    });

    it('不带比例的援护（琉璃）仍然全额转移伤害，行为保持兼容', () => {
        const state = makeGameState();
        const liuli = addHero(state, 'liuli', 'player1', [0, 0]);
        const ally = addHero(state, 'moran', 'player1', [0, 1]);
        const attacker = addHero(state, 'baize', 'player2', [5, 5]);
        EffectManager.addEffect(ally, {
            type: 'buff',
            name: '援护',
            duration: -1,
            sourceHeroId: liuli.id,
            description: '测试：琉璃全额援护',
        });

        const damage = DamageCalculator.calculate(attacker, ally, 10);
        DamageCalculator.applyDamage(ally, damage, attacker, state);

        expect(ally.currentHp).toBe(ally.maxHp);
        expect(liuli.currentHp).toBe(liuli.maxHp - 10);
    });

    it('极寒领域在回合结束时使相邻敌人获得1层寒天，领域外不受影响', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 2]);
        const inside = addHero(state, 'moran', 'player2', [2, 3]);
        const edge = addHero(state, 'baize', 'player2', [3, 3]);
        const farAway = addHero(state, 'hanjiangxue', 'player2', [0, 0]);

        for (const hero of [caster, inside, edge, farAway]) {
            hero.hasActedThisTurn = true;
        }

        GameEngine.endHeroAction(caster, state);

        expect(DamageCalculator.getHantianStackCount(inside)).toBe(1);
        expect(DamageCalculator.getHantianStackCount(edge)).toBe(0);
        expect(DamageCalculator.getHantianStackCount(farAway)).toBe(0);
    });

    it('极寒领域叠加至3层时统一转为冰冻', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 2]);
        const inside = addHero(state, 'moran', 'player2', [1, 2]);
        DamageCalculator.applyHantianStacks(inside, 2, caster.id, state);
        inside.hasActedThisTurn = true;
        caster.hasActedThisTurn = true;

        GameEngine.endHeroAction(caster, state);

        expect(DamageCalculator.getHantianStackCount(inside)).toBe(0);
        expect(EffectManager.hasEffect(inside, '冰冻')).toBe(true);
    });

    it('天威·归渊在击杀后按场上寒天层数回血', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 0]);
        caster.currentHp = 30;
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 1;
        victim.defense = 0;
        const carrier = addHero(state, 'hanjiangxue', 'player2', [4, 4]);
        DamageCalculator.applyHantianStacks(carrier, 2, caster.id, state);

        SkillSystem.executeSkill(caster, chenyuanSkill1, [[2, 3]], state);

        expect(victim.state).toBe(HeroState.DEAD);
        // 场上唯一存活的寒天持有者为2层：恢复 2 x 4 = 8 点生命。
        expect(caster.currentHp).toBe(38);
        expect(caster.maxHp).toBe(60);
    });

    it('天威·归渊的回复可以超过生命上限，但最高不超过70且最大生命值不变', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 0]);
        caster.currentHp = 50;
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 1;
        victim.defense = 0;
        // 三个存活敌人各带2层寒天，共6层：理论恢复24点，超过上限10点的余量。
        const carriers = [
            addHero(state, 'hanjiangxue', 'player2', [4, 4]),
            addHero(state, 'baize', 'player2', [4, 5]),
            addHero(state, 'nightowl', 'player2', [5, 4]),
        ];
        for (const carrier of carriers) {
            DamageCalculator.applyHantianStacks(carrier, 2, caster.id, state);
        }

        SkillSystem.executeSkill(caster, chenyuanSkill1, [[2, 3]], state);

        expect(victim.state).toBe(HeroState.DEAD);
        expect(caster.currentHp).toBe(70);
        expect(caster.maxHp).toBe(60);
    });

    it('场上没有寒天时天威·归渊不回复生命', () => {
        const state = makeGameState();
        const caster = addHero(state, 'chenyuan', 'player1', [2, 0]);
        caster.currentHp = 30;
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 1;
        victim.defense = 0;
        addHero(state, 'baize', 'player2', [4, 4]);

        SkillSystem.executeSkill(caster, chenyuanSkill1, [[2, 3]], state);

        expect(victim.state).toBe(HeroState.DEAD);
        expect(caster.currentHp).toBe(30);
        expect(state.battleLog.some(entry =>
            entry.type === 'tianwei' && entry.message.includes('没有寒天')
        )).toBe(true);
    });
});
