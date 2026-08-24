import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHeroBattleStatistics } from '../../src/core/battle-statistics';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { createWukongClone } from '../../src/data/heroes';
import { addHero, makeGameState } from '../helpers/game-state';

describe('battle statistics', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('按实际生命与护盾损失累计输出、承伤和格挡，不计过量伤害', () => {
        const state = makeGameState();
        const attacker = addHero(state, 'moran', 'player1', [0, 0]);
        const target = addHero(state, 'baize', 'player2', [0, 1]);
        target.currentHp = 5;
        target.shield = 3;

        const damage = DamageCalculator.calculate(attacker, target, 20, false, true);
        DamageCalculator.applyDamage(target, damage, attacker, state);

        expect(getHeroBattleStatistics(state, attacker)).toMatchObject({
            damageDealt: 8,
            kills: 1,
        });
        expect(getHeroBattleStatistics(state, target)).toMatchObject({
            damageTaken: 8,
            shieldAbsorbed: 3,
            lastDeathRound: 1,
        });
    });

    it('只把实际恢复量计入治疗来源英雄', () => {
        const state = makeGameState();
        const healer = addHero(state, 'baize', 'player1', [0, 0]);
        const target = addHero(state, 'moran', 'player1', [0, 1]);
        target.currentHp = target.maxHp - 4;

        expect(DamageCalculator.applyHeal(target, 10, state, healer)).toBe(4);
        expect(getHeroBattleStatistics(state, healer).healingDone).toBe(4);
        expect(getHeroBattleStatistics(state, target).healingDone).toBe(0);
    });

    it('将分身造成的伤害归并到孙悟空', () => {
        const state = makeGameState();
        const wukong = addHero(state, 'wukong', 'player1', [0, 0]);
        const clone = createWukongClone('player1', wukong.id, [1, 0], 10);
        state.board[1][0] = clone;
        const target = addHero(state, 'baize', 'player2', [1, 1]);

        const damage = DamageCalculator.calculate(clone, target, 6, false, true);
        DamageCalculator.applyDamage(target, damage, clone, state);

        expect(getHeroBattleStatistics(state, wukong).damageDealt).toBe(6);
        expect(getHeroBattleStatistics(state, clone).damageDealt).toBe(6);
    });
});
