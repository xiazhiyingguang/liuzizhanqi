import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { MovementSystem } from '../../src/core/movement-system';
import { SkillSystem } from '../../src/core/skill-system';
import { addDilanFeather } from '../../src/data/extended-heroes';
import { damoSkill1 } from '../../src/data/extended-skills';
import { resolveHookThrow } from '../../src/core/water-marsh';
import { addHero, makeGameState } from '../helpers/game-state';

beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(.99));
afterEach(() => vi.restoreAllMocks());

describe('羽化按位移施术方判定', () => {
    it.each(['player1', 'player2'] as const)('%s 达摩推敌人触发同队羽化，自己突进不触发敌方羽化', owner => {
        const run = (marked: boolean) => {
            const state = makeGameState(), other = owner === 'player1' ? 'player2' : 'player1';
            const damo = addHero(state, 'damo', owner, [2, 2]);
            const ally = addHero(state, 'dilan', owner, [0, 0]);
            const hostile = addHero(state, 'dilan', other, [5, 0]);
            const victim = addHero(state, 'moran', other, [2, 3]);
            victim.defense = 0;
            if (marked) { addDilanFeather(victim, ally); addDilanFeather(damo, hostile); }
            expect(SkillSystem.executeSkill(damo, damoSkill1, [[2, 3]], state).success).toBe(true);
            return { damo, victim };
        };
        const base = run(false), marked = run(true);
        expect(marked.damo.position).toEqual([2, 3]);
        expect(marked.damo.currentHp).toBe(base.damo.currentHp);
        expect(marked.victim.position).toEqual([2, 5]);
        expect(marked.victim.currentHp).toBe(base.victim.currentHp - 2);
    });
    it('moveHero 的技能瞬移不触发羽化，普通走格仍触发', () => {
        const state = makeGameState();
        const source = addHero(state, 'dilan', 'player1', [5, 5]);
        const target = addHero(state, 'moran', 'player2', [0, 0]);
        addDilanFeather(target, source);
        expect(MovementSystem.moveHero(target, [0, 2], state, 3, { skillMovement: true })).toBe(true);
        expect(target.currentHp).toBe(target.maxHp);
        expect(MovementSystem.moveHero(target, [0, 3], state)).toBe(true);
        expect(target.currentHp).toBe(target.maxHp - 1);
    });
    it('直接改棋盘的位移默认自身技能，显式敌方施术时才触发羽化', () => {
        const state = makeGameState();
        const source = addHero(state, 'dilan', 'player1', [5, 5]);
        const target = addHero(state, 'moran', 'player2', [0, 0]);
        addDilanFeather(target, source);
        expect(DamageCalculator.applyFeatherForDisplacement(target, [0, 0], [0, 2], state)).toBe(0);
        expect(DamageCalculator.applyFeatherForDisplacement(target, [0, 0], [0, 2], state, source.owner)).toBe(2);
    });
    it('姜太公抛投是我方强制位移，会额外结算羽化', () => {
        const run = (marked: boolean) => {
            const state = makeGameState();
            const source = addHero(state, 'dilan', 'player1', [5, 5]);
            const caster = addHero(state, 'jiangtaigong', 'player1', [0, 0]);
            const target = addHero(state, 'moran', 'player2', [2, 2]);
            target.defense = 0;
            if (marked) addDilanFeather(target, source);
            resolveHookThrow(state, caster, target, [2, 4]);
            return target.currentHp;
        };
        expect(run(true)).toBe(run(false) - 2);
    });
});
