import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import type { GameState, Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 吟游诗人被动「终曲回响」：一场战斗最多触发 5 次。
 * 只有真正治疗（全队有激情可消耗）才计入次数。
 */

function setup(): { state: GameState; bard: Hero; attacker: Hero } {
    const state = makeGameState();
    const bard = addHero(state, 'bard', 'player1', [0, 0]);
    addHero(state, 'moran', 'player1', [0, 1]);
    const attacker = addHero(state, 'zhenxiao', 'player2', [2, 2]);
    return { state, bard, attacker };
}

/** 把诗人压到生命 30% 以下挨一次打；全队先攒 2 点激情 */
function strike(state: GameState, bard: Hero, attacker: Hero): void {
    bard.currentHp = 10;
    for (const ally of state.player1Heroes) ally.counters['激情'] = 2;
    const hit = DamageCalculator.calculate(attacker, bard, 1, false);
    DamageCalculator.applyDamage(bard, hit, attacker, state);
}

const echoCount = (state: GameState) =>
    state.battleLog.filter(entry => entry.message.includes('终曲回响')).length;

describe('吟游诗人·终曲回响', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('前5次受伤各治疗一次，第6次起不再触发', () => {
        const { state, bard, attacker } = setup();

        for (let round = 0; round < 5; round++) strike(state, bard, attacker);

        expect(bard.counters['bard_echo_used']).toBe(5);
        expect(echoCount(state)).toBe(5);

        // 第6次：不治疗（10 - 1 = 9），也不继续计数
        strike(state, bard, attacker);
        expect(bard.currentHp, '达到上限后不应再回血').toBe(9);
        expect(bard.counters['bard_echo_used']).toBe(5);
        expect(echoCount(state)).toBe(5);
    });

    it('战斗日志标出第几次触发', () => {
        const { state, bard, attacker } = setup();
        strike(state, bard, attacker);
        expect(state.battleLog.some(entry => entry.message.includes('终曲回响（1/5）'))).toBe(true);
    });

    it('全场没有激情时不触发也不占用次数', () => {
        const { state, bard, attacker } = setup();
        for (const ally of state.player1Heroes) ally.counters['激情'] = 0;

        bard.currentHp = 10;
        const hit = DamageCalculator.calculate(attacker, bard, 1, false);
        DamageCalculator.applyDamage(bard, hit, attacker, state);

        expect(bard.currentHp).toBe(9);
        expect(bard.counters['bard_echo_used'] ?? 0).toBe(0);
    });
});
