import { describe, expect, it } from 'vitest';
import { MovementSystem } from '../../src/core/movement-system';
import { createWindLane } from '../../src/core/wind-lane';
import { addHero, makeGameState } from '../helpers/game-state';
import type { GameState, Position } from '../../src/types/game';

/**
 * 风道移动力消耗口径回归（策划裁定）：
 * 1. 只有铺设方的友军能在风道内免费滑行，敌方风道对自己人没有任何通行加成；
 * 2. 已在道内：沿道滑行不消耗移动力，且用完剩余移动力还能继续走出风道；
 * 3. 从道外进入：进道那一步消耗 1 点，道内滑行 0 点，出道那一步再消耗 1 点。
 */

/** 在 player1 手里铺一条第 0 行的风道 */
function laneOnRow0(state: GameState, casterId = 'nanfeng'): void {
    const caster = state.player1Heroes.find(hero => hero.id.startsWith(`${casterId}-player1-`))
        ?? addHero(state, casterId, 'player1', [5, 5]);
    createWindLane(state, caster, [0, 0], 'right');
}

const cells = (state: GameState, hero: ReturnType<typeof addHero>) =>
    new Set(MovementSystem.getMovablePositions(hero, state).map(([r, c]) => `${r},${c}`));

describe('风道移动力消耗', () => {
    it('已在道内的友方：整条道免费滑行，出道后再用剩余移动力继续走', () => {
        const state = makeGameState();
        laneOnRow0(state);
        const rider = addHero(state, 'moran', 'player1', [0, 0]);   // 移动力 2

        const reachable = cells(state, rider);
        // 沿第 0 行横穿到最远端，只花 0 点
        expect(reachable.has('0,5'), '道内滑行不应消耗移动力').toBe(true);
        // 出道那一步花 1 点，剩 1 点还能再走一格
        expect(reachable.has('1,5'), '出道消耗1点后仍可继续移动').toBe(true);
        expect(reachable.has('2,5'), '出道后剩余的1点还能再走一格').toBe(true);
    });

    it('从道外进入：进道1点 + 道内免费 + 出道1点，正好用完2点移动力', () => {
        const state = makeGameState();
        laneOnRow0(state);
        const outsider = addHero(state, 'moran', 'player1', [1, 3]);  // 移动力 2，与风道相邻

        const reachable = cells(state, outsider);
        expect(reachable.has('0,3'), '进道那一步消耗1点').toBe(true);
        expect(reachable.has('0,0'), '进道后沿道免费横穿').toBe(true);
        expect(reachable.has('0,5'), '进道后沿道免费横穿').toBe(true);
        expect(reachable.has('1,0'), '剩余1点可用于出道').toBe(true);
        expect(reachable.has('2,0'), '出道后没有多余移动力再走').toBe(false);
    });

    it('敌方风道不给己方任何通行加成', () => {
        const state = makeGameState();
        const enemy = addHero(state, 'nanfeng', 'player2', [5, 5]);
        createWindLane(state, enemy, [0, 0], 'right');
        const rider = addHero(state, 'moran', 'player1', [0, 0]);     // 站在敌方风道内，移动力 2

        const reachable = cells(state, rider);
        expect(reachable.has('0,2'), '按普通移动力最多走到2格外').toBe(true);
        expect(reachable.has('0,3'), '敌方风道不该让滑行免费').toBe(false);
        expect(reachable.has('0,5'), '敌方风道不该让滑行免费').toBe(false);
    });

    it('移动力被削到0时，道内仍可免费滑行', () => {
        const state = makeGameState();
        laneOnRow0(state);
        const rider = addHero(state, 'moran', 'player1', [0, 0]);
        rider.moveRange = 0;

        const reachable = cells(state, rider);
        expect(reachable.has('0,5'), '滑行不消耗移动力，0点也能动').toBe(true);
        expect(reachable.has('1,5'), '出道需要消耗移动力，0点走不出去').toBe(false);
    });
});
