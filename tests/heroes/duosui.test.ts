import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { SkillSystem } from '../../src/core/skill-system';
import {
    duosuiSkill1,
    duosuiSkill2,
    JINXUE_EFFECT,
    XUECHANG_EFFECT,
    xuechangPending,
} from '../../src/data/extended-skills';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 夺岁：斩岁砍的是"现在还活着的那部分"，血偿在之后两轮开始各还一笔，
 * 禁血只封被砍中的那一轮，血诏攒着等下一次出手。
 */
describe('夺岁', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    function setup(targetHp = 45) {
        const state = makeGameState();
        const duosui = addHero(state, 'duosui', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        target.defense = 0;
        target.currentHp = targetHp;
        return { state, duosui, target };
    }

    const cast1 = (duosui: any, target: any, state: any) =>
        SkillSystem.executeSkill(duosui, duosuiSkill1, [[2, 3]], state);

    it('以武曲45生命、2移动接入两个技能与天威', () => {
        const state = makeGameState();
        const hero = addHero(state, 'duosui', 'player1', [2, 2]);

        expect(hero).toMatchObject({
            name: '夺岁',
            class: '武曲',
            maxHp: 45,
            moveRange: 2,
            skill1Id: 'duosui_skill1',
            skill2Id: 'duosui_skill2',
            passiveId: 'duosui_passive',
            tianweiId: 'duosui_tianwei',
        });
    });

    it('斩岁按当前生命50%造成真实伤害，防御挡不住', () => {
        const { state, duosui, target } = setup();
        target.defense = 0.5;

        const output = cast1(duosui, target, state);

        expect(output.damageDealt).toEqual([22]);
        expect(target.currentHp).toBe(23);
    });

    it('斩岁挂血偿与禁血：血偿每笔是本次伤害的20%', () => {
        const { state, duosui, target } = setup();

        cast1(duosui, target, state);

        expect(EffectManager.hasEffect(target, XUECHANG_EFFECT)).toBe(true);
        expect(EffectManager.hasEffect(target, JINXUE_EFFECT)).toBe(true);
        expect(target.counters['__xuechang_amount']).toBe(4);
        expect(target.counters['__xuechang_ticks']).toBe(2);
        expect(xuechangPending(target)).toBe(8);
    });

    it('血偿在随后两轮开始各还一笔，还完摘掉标记', () => {
        const { state, duosui, target } = setup();
        cast1(duosui, target, state);

        state.roundNumber = 2;
        GameEngine.startNewTurn(state);
        expect(target.currentHp).toBe(27);
        expect(xuechangPending(target)).toBe(4);

        state.roundNumber = 3;
        GameEngine.startNewTurn(state);
        expect(target.currentHp).toBe(31);
        expect(EffectManager.hasEffect(target, XUECHANG_EFFECT)).toBe(false);
        expect(xuechangPending(target)).toBe(0);

        // 第四轮不该再还第三笔
        state.roundNumber = 4;
        GameEngine.startNewTurn(state);
        expect(target.currentHp).toBe(31);
    });

    it('禁血只封当轮：本回合内一切治疗落空，之后血偿照常还血', () => {
        const { state, duosui, target } = setup();
        const ally = addHero(state, 'xubai', 'player2', [1, 3]);
        cast1(duosui, target, state);

        expect(DamageCalculator.applyHeal(target, 10, state, ally)).toBe(0);
        expect(target.currentHp).toBe(23);

        // 禁血时长 1 拍：过一轮开始就失效，血偿的还血不受影响
        state.roundNumber = 2;
        GameEngine.startNewTurn(state);
        expect(EffectManager.hasEffect(target, JINXUE_EFFECT)).toBe(false);
        expect(target.currentHp).toBe(27);
    });

    it('偿岁按已损生命增伤，并把未还完的血偿整份收成护盾', () => {
        const { state, duosui, target } = setup();
        cast1(duosui, target, state);          // 砍到 23 血，血偿欠 8

        const output = SkillSystem.executeSkill(duosui, duosuiSkill2, [[2, 3]], state);

        const missing = target.maxHp - 23;
        expect(output.damageDealt).toEqual([5 + Math.floor(missing * 0.25)]);
        expect(duosui.shield).toBe(8);
    });

    it('血偿还掉一笔后，偿岁只能收到剩下的那一笔', () => {
        const { state, duosui, target } = setup();
        cast1(duosui, target, state);

        state.roundNumber = 2;
        GameEngine.startNewTurn(state);
        SkillSystem.executeSkill(duosui, duosuiSkill2, [[2, 3]], state);

        expect(duosui.shield).toBe(4);
    });

    it('目标没有血偿时偿岁不给盾，但按已损生命照样打疼', () => {
        const { state, duosui, target } = setup(18);

        const output = SkillSystem.executeSkill(duosui, duosuiSkill2, [[2, 3]], state);

        expect(output.damageDealt).toEqual([5 + Math.floor((target.maxHp - 18) * 0.25)]);
        expect(duosui.shield).toBe(0);
    });

    it('第二发斩岁覆盖血偿，只记最新一笔', () => {
        const { state, duosui, target } = setup();
        cast1(duosui, target, state);
        expect(xuechangPending(target)).toBe(8);

        cast1(duosui, target, state);

        const wounds = target.effects.filter(effect => effect.name === XUECHANG_EFFECT);
        expect(wounds).toHaveLength(1);
        // 第二次砍中时目标 23 血 → 伤害 11，每笔还 floor(11×20%) = 2
        expect(target.counters['__xuechang_amount']).toBe(2);
        expect(xuechangPending(target)).toBe(4);
    });

    it('斩岁打死目标时不再挂血偿与禁血', () => {
        // 1 血时 50% 向下取整为 0，靠"至少 1 点"的地板伤收掉，尸体上不再写字
        const { state, duosui, target } = setup(1);

        cast1(duosui, target, state);

        expect(target.state).toBe(HeroState.DEAD);
        expect(EffectManager.hasEffect(target, XUECHANG_EFFECT)).toBe(false);
        expect(EffectManager.hasEffect(target, JINXUE_EFFECT)).toBe(false);
    });

    it('天威血诏：击杀后攒着，下一次出手按目标最大生命加成并消耗掉', () => {
        const { state, duosui } = setup();
        const victim = addHero(state, 'baize', 'player2', [1, 2]);
        victim.currentHp = 1;
        const witness = addHero(state, 'nightowl', 'player2', [0, 0]);

        SkillSystem.executeSkill(duosui, duosuiSkill1, [[1, 2]], state);

        expect(duosui.counters['__duosui_tianwei']).toBe(1);
        expect(EffectManager.hasEffect(duosui, '血诏')).toBe(true);

        // 血诏不随回合流失：跨两轮仍在
        state.roundNumber = 3;
        GameEngine.startNewTurn(state);
        expect(duosui.counters['__duosui_tianwei']).toBe(1);

        const before = witness.currentHp;
        SkillSystem.executeSkill(duosui, duosuiSkill1, [[0, 0]], state);

        const reap = Math.floor(witness.maxHp * 0.5);
        const edict = Math.floor(witness.maxHp * 0.2);
        expect(before - witness.currentHp).toBe(reap + edict);
        expect(duosui.counters['__duosui_tianwei']).toBe(0);
        expect(EffectManager.hasEffect(duosui, '血诏')).toBe(false);
    });

    it('致知：生命 52、血诏 30%、已损系数 40%', () => {
        const state = makeGameState();
        const duosui = addHero(state, 'duosui', 'player1', [2, 2]);
        grantZhizhi(duosui, 1);
        grantZhizhi(duosui, 2);
        grantZhizhi(duosui, 3);
        expect(duosui.maxHp).toBe(52);

        const target = addHero(state, 'moran', 'player2', [2, 3]);
        target.defense = 0;
        target.currentHp = 23;
        duosui.counters['__duosui_tianwei'] = 1;

        const output = SkillSystem.executeSkill(duosui, duosuiSkill2, [[2, 3]], state);

        const reckon = 5 + Math.floor((target.maxHp - 23) * 0.4);
        const edict = Math.floor(target.maxHp * 0.3);
        expect(output.damageDealt).toEqual([reckon + edict]);
    });

    it('标准模式下致知一律不生效，血诏仍按 20% / 25% 结算', () => {
        const { state, duosui, target } = setup();
        target.currentHp = 23;
        duosui.counters['__duosui_tianwei'] = 1;

        const output = SkillSystem.executeSkill(duosui, duosuiSkill2, [[2, 3]], state);

        const reckon = 5 + Math.floor((target.maxHp - 23) * 0.25);
        const edict = Math.floor(target.maxHp * 0.2);
        expect(output.damageDealt).toEqual([reckon + edict]);
        expect(duosui.maxHp).toBe(45);
    });
});
