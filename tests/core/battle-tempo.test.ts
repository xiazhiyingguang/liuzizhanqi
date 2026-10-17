import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine, MAX_BATTLE_ROUNDS } from '../../src/core/game-engine';
import {
    FIERCE_FIRST_ROUND,
    FIERCE_MULTIPLIERS,
    FIERCE_SECOND_ROUND,
    fierceAnnouncement,
    fierceMultiplier,
    fierceShortBadge,
    fierceTier,
} from '../../src/core/battle-tempo';
import { addHero, makeGameState } from '../helpers/game-state';

/** 激战只按回合号给倍率，回合号由引擎同步进来，所以每个用例自己把档位摆好 */
function atRound(roundNumber: number) {
    DamageCalculator.setBattleRound(roundNumber);
}

describe('battle tempo（激战阈值）', () => {
    afterEach(() => {
        DamageCalculator.setBattleRound(1);
    });

    it('阈值就是策划给的 20 与 25，且不改动 30 回合封顶', () => {
        expect(FIERCE_FIRST_ROUND).toBe(20);
        expect(FIERCE_SECOND_ROUND).toBe(25);
        expect(MAX_BATTLE_ROUNDS).toBe(30);
    });

    it('档位分界：19 层外、20 一层、24 仍一层、25 起二层且不封顶在 30', () => {
        expect([1, 19].map(fierceTier)).toEqual([0, 0]);
        expect([20, 21, 24].map(fierceTier)).toEqual([1, 1, 1]);
        expect([25, 26, 30, 40].map(fierceTier)).toEqual([2, 2, 2, 2]);
    });

    it('倍率为 1 / 1.2 / 1.4，坏数据退回未激战', () => {
        expect(FIERCE_MULTIPLIERS).toEqual({ 0: 1, 1: 1.2, 2: 1.4 });
        expect(fierceMultiplier(19)).toBe(1);
        expect(fierceMultiplier(20)).toBeCloseTo(1.2, 10);
        expect(fierceMultiplier(30)).toBeCloseTo(1.4, 10);
        expect(fierceTier(Number.NaN)).toBe(0);
        expect(fierceMultiplier(Number.NaN)).toBe(1);
    });

    it('角标只在进入激战后给出，并区分两层', () => {
        expect(fierceShortBadge(19)).toBeNull();
        expect(fierceShortBadge(20)).toBe('×1.2');
        expect(fierceShortBadge(29)).toBe('×1.4');
    });

    it('入场播报只在跨过阈值那一回合给一次', () => {
        expect(fierceAnnouncement(19)).toBeNull();
        expect(fierceAnnouncement(21)).toBeNull();
        expect(fierceAnnouncement(26)).toBeNull();

        const first = fierceAnnouncement(20);
        expect(first).toMatchObject({ id: 'fierce-20', tier: 1, title: '激战' });
        expect(first?.note).toContain('20%');

        const second = fierceAnnouncement(25);
        expect(second).toMatchObject({ id: 'fierce-25', tier: 2, title: '激战·二重' });
        expect(second?.note).toContain('40%');
    });
});

describe('激战伤害结算', () => {
    beforeEach(() => {
        // 固定随机数：排除暴击与各类概率，只看倍率本身
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        DamageCalculator.setBattleRound(1);
    });

    function duel() {
        const state = makeGameState();
        const attacker = addHero(state, 'moran', 'player1', [0, 0]);
        const target = addHero(state, 'baize', 'player2', [0, 1]);
        target.defense = 0;
        return { state, attacker, target };
    }

    it('第 20 回合起常规伤害 ×1.2，第 25 回合起 ×1.4', () => {
        const { attacker, target } = duel();

        atRound(19);
        expect(DamageCalculator.calculate(attacker, target, 10).finalDamage).toBe(10);

        atRound(20);
        expect(DamageCalculator.calculate(attacker, target, 10).finalDamage).toBe(12);

        atRound(25);
        expect(DamageCalculator.calculate(attacker, target, 10).finalDamage).toBe(14);
    });

    it('固定伤害不涨：跳过整条常规结算管线', () => {
        const { attacker, target } = duel();
        atRound(25);

        const result = DamageCalculator.calculate(attacker, target, 10, false, false, { fixedDamage: true });
        expect(result.finalDamage).toBe(10);
    });

    it('真实伤害（无视防御）不涨', () => {
        const { attacker, target } = duel();
        atRound(25);

        expect(DamageCalculator.calculate(attacker, target, 10, false, true).finalDamage).toBe(10);
    });

    it('治疗不受激战影响', () => {
        const { state, attacker, target } = duel();
        target.currentHp = 20;
        atRound(25);

        expect(DamageCalculator.applyHeal(target, 10, state, attacker)).toBe(10);
        expect(target.currentHp).toBe(30);
    });

    it('与英雄的增伤是相乘而不是相加', () => {
        const { attacker, target } = duel();
        atRound(20);

        // 惊鸿半血以上增伤 50%：10 × 1.5 × 1.2 = 18
        const jinghong = addHero(makeGameState(), 'jinghong', 'player1', [2, 2]);
        jinghong.currentHp = jinghong.maxHp;
        expect(DamageCalculator.calculate(jinghong, target, 10).finalDamage).toBe(18);
    });
});

describe('激战回合接线', () => {
    afterEach(() => {
        DamageCalculator.setBattleRound(1);
    });

    /** 双方各留一名可行动的英雄：空盘面会触发引擎的"全员无法行动自动跳回合"，把档位一路推上去 */
    function battleState(roundNumber: number) {
        const state = makeGameState({ roundNumber });
        addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [5, 5]);
        return state;
    }

    it('回合开始把回合号同步给伤害管线', () => {
        const state = battleState(20);
        GameEngine.startNewTurn(state);

        expect(DamageCalculator.getBattleRound()).toBe(20);
        expect(state.roundNumber).toBe(20);
    });

    it('第 20 回合的战报播报一次，第 21 回合不再重复', () => {
        const first = battleState(20);
        GameEngine.startNewTurn(first);
        const fierceLogs = first.battleLog.filter(entry => entry.message.includes('激战'));
        expect(fierceLogs).toHaveLength(1);
        expect(fierceLogs[0]).toMatchObject({ type: 'system' });
        expect(fierceLogs[0].message).toContain('全场伤害提升 20%');
        expect(fierceLogs[0].message).toContain('固定伤害与真实伤害不涨');

        const next = battleState(21);
        GameEngine.startNewTurn(next);
        expect(next.battleLog.filter(entry => entry.message.includes('激战'))).toHaveLength(0);
    });

    it('第 25 回合播报第二层，并把术语表能识别的“激战”写进战报', () => {
        const state = battleState(25);
        GameEngine.startNewTurn(state);

        const message = state.battleLog.filter(entry => entry.message.includes('激战')).map(entry => entry.message).join('');
        expect(message).toContain('激战·二重');
        expect(message).toContain('全场伤害提升 40%');
    });

    it('新开对局从第 1 回合起自然清掉上一局的档位', () => {
        DamageCalculator.setBattleRound(30);
        const state = battleState(1);
        GameEngine.startNewTurn(state);

        expect(DamageCalculator.getBattleRound()).toBe(1);
    });
});
