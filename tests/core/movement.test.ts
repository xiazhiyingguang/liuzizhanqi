import { describe, expect, it } from 'vitest';
import { MovementSystem } from '../../src/core/movement-system';
import { addHero, makeGameState } from '../helpers/game-state';

describe('MovementSystem', () => {
    it('uses Manhattan distance and never treats a diagonal as one step', () => {
        expect(MovementSystem.getManhattanDistance([1, 1], [2, 2])).toBe(2);
        expect(MovementSystem.isInRange([1, 1], [2, 2], 1)).toBe(false);
    });

    it('returns only in-bounds orthogonal cells for a corner cross', () => {
        expect(MovementSystem.getCrossPositions([0, 0])).toEqual([[1, 0], [0, 1]]);
    });

    it('finds every empty cell reachable within movement range', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        const positions = MovementSystem.getMovablePositions(hero, state);

        expect(positions).toHaveLength(12);
        expect(positions).toContainEqual([0, 2]);
        expect(positions).toContainEqual([2, 4]);
        expect(positions).not.toContainEqual([0, 0]);
    });

    it('cannot move through a wall of occupied cells', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player1', [0, 1]);
        addHero(state, 'liuli', 'player1', [1, 0]);

        expect(MovementSystem.getMovablePositions(hero, state)).toEqual([]);
    });

    it('moves a hero by updating both board cells and its position', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 2]);

        expect(MovementSystem.moveHero(hero, [2, 4], state)).toBe(true);
        expect(state.board[2][2]).toBeNull();
        expect(state.board[2][4]).toBe(hero);
        expect(hero.position).toEqual([2, 4]);
    });

    it('rejects an occupied or unreachable destination', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 3]);

        expect(MovementSystem.moveHero(hero, [2, 3], state)).toBe(false);
        expect(MovementSystem.moveHero(hero, [5, 5], state)).toBe(false);
        expect(hero.position).toEqual([2, 2]);
    });

    it('computes Zhenxiao directional three-cell attack strips at board edges', () => {
        expect(MovementSystem.getZhenxiaoSkill1Positions([0, 2], 'up')).toEqual([]);
        expect(MovementSystem.getZhenxiaoSkill1Positions([2, 2], 'right')).toEqual([
            [1, 3],
            [2, 3],
            [3, 3],
        ]);
    });

    it('finds a nearby empty revival position before scanning the full board', () => {
        const state = makeGameState();
        addHero(state, 'moran', 'player1', [2, 2]);

        expect(MovementSystem.findNearestEmptyPosition([2, 2], state)).toEqual([1, 2]);
    });

    it('supports an explicit temporary movement override for skill-driven movement', () => {
        const state = makeGameState();
        const hero = addHero(state, 'wukong', 'player1', [2, 2]);
        hero.moveRange = 0;

        expect(MovementSystem.moveHero(hero, [2, 3], state)).toBe(false);
        expect(MovementSystem.moveHero(hero, [2, 3], state, 1)).toBe(true);
    });
});
