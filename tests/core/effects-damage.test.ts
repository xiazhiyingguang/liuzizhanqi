import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('EffectManager', () => {
    it('stacks effects with the same name and source and refreshes duration', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [0, 0]);
        const effect = {
            type: 'debuff' as const,
            name: '寒天',
            duration: 2,
            stackCount: 1,
            sourceHeroId: hero.id,
        };

        EffectManager.addEffect(hero, effect);
        EffectManager.addEffect(hero, { ...effect, duration: 3 });

        expect(hero.effects).toHaveLength(1);
        const cold = EffectManager.getEffect(hero, '寒天');
        expect(cold?.stackCount).toBe(2);
        expect(cold?.duration).toBe(3);
    });

    it('decrements round durations and keeps permanent effects', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: '短效',
            duration: 1,
            sourceHeroId: hero.id,
        });
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: '永久',
            duration: -1,
            sourceHeroId: hero.id,
        });

        EffectManager.updateEffectDurations(state);

        expect(EffectManager.hasEffect(hero, '短效')).toBe(false);
        expect(EffectManager.hasEffect(hero, '永久')).toBe(true);
    });

    it('does not consume a counter when the balance is insufficient', () => {
        const state = makeGameState();
        const hero = addHero(state, 'baize', 'player1', [0, 0]);
        EffectManager.setCounter(hero, '天禄', 2);

        expect(EffectManager.consumeCounter(hero, '天禄', 3)).toBe(false);
        expect(EffectManager.getCounter(hero, '天禄')).toBe(2);
    });
});

describe('DamageCalculator', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('applies defense after base damage and floors the result', () => {
        const state = makeGameState();
        const attacker = addHero(state, 'moran', 'player1', [0, 0]);
        const target = addHero(state, 'baize', 'player2', [0, 1]);
        target.defense = 0.25;

        expect(DamageCalculator.calculate(attacker, target, 10).finalDamage).toBe(7);
        expect(DamageCalculator.calculate(attacker, target, 10, false, true).finalDamage).toBe(10);
    });

    it('absorbs damage with shield before reducing HP', () => {
        const state = makeGameState();
        const attacker = addHero(state, 'moran', 'player1', [0, 0]);
        const target = addHero(state, 'baize', 'player2', [0, 1]);
        target.shield = 6;
        const result = DamageCalculator.calculate(attacker, target, 10);

        DamageCalculator.applyDamage(target, result, attacker, state);

        expect(result.shieldDamage).toBe(6);
        expect(result.hpDamage).toBe(4);
        expect(target.shield).toBe(0);
        expect(target.currentHp).toBe(42);
    });

    it('transfers guarded damage to Liuli and grants meditation', () => {
        const state = makeGameState();
        const attacker = addHero(state, 'moran', 'player1', [0, 0]);
        const ally = addHero(state, 'baize', 'player2', [0, 1]);
        const liuli = addHero(state, 'liuli', 'player2', [1, 1]);
        EffectManager.addEffect(ally, {
            type: 'buff',
            name: '援护',
            duration: -1,
            sourceHeroId: liuli.id,
        });

        const result = DamageCalculator.calculate(attacker, ally, 8);
        DamageCalculator.applyDamage(ally, result, attacker, state);

        expect(ally.currentHp).toBe(ally.maxHp);
        expect(liuli.currentHp).toBe(liuli.maxHp - 8);
        expect(EffectManager.getCounter(liuli, '禅定')).toBe(1);
    });

    it('removes a killed hero from the board and increments the killer count', () => {
        const state = makeGameState();
        const attacker = addHero(state, 'moran', 'player1', [0, 0]);
        const target = addHero(state, 'baize', 'player2', [0, 1]);
        target.currentHp = 5;
        const result = DamageCalculator.calculate(attacker, target, 8);

        DamageCalculator.applyDamage(target, result, attacker, state);

        expect(result.killed).toBe(true);
        expect(target.state).toBe(HeroState.DEAD);
        expect(state.board[0][1]).toBeNull();
        expect(attacker.killCount).toBe(1);
        expect(state.battleLog.find(entry => entry.type === 'kill')?.details).toMatchObject({
            kind: 'hero-kill',
            killerHeroId: attacker.id,
            killerName: attacker.name,
            victimHeroId: target.id,
            victimName: target.name,
            killCount: 1
        });
    });

    it('caps stealthed Nightowl area damage at 10 per round', () => {
        const state = makeGameState();
        const attacker = addHero(state, 'moran', 'player1', [0, 0]);
        const target = addHero(state, 'nightowl', 'player2', [0, 1]);
        EffectManager.addEffect(target, {
            type: 'buff',
            name: '潜行',
            duration: -1,
            sourceHeroId: target.id,
        });

        const first = DamageCalculator.calculate(attacker, target, 20);
        DamageCalculator.applyDamage(target, first, attacker, state, true);
        const second = DamageCalculator.calculate(attacker, target, 20);
        DamageCalculator.applyDamage(target, second, attacker, state, true);

        expect(first.hpDamage).toBe(10);
        expect(second.hpDamage).toBe(0);
        expect(target.currentHp).toBe(target.maxHp - 10);
    });
});
