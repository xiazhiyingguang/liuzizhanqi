import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseComputerSkillPlan } from '../../src/core/computer-ai';
import {
    getShuangfeiyanTriangleArea2,
    getShuangfeiyanTriangleCells,
    placeShuangfeiyanBoomerang,
} from '../../src/core/boomerang';
import { Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

function chebyshev(a: Position, b: Position): number {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

function foeCountInTriangle(
    state: ReturnType<typeof makeGameState>,
    origin: Position,
    first: Position,
    second: Position
): number {
    const cells = new Set(getShuangfeiyanTriangleCells(origin, first, second).map(([r, c]) => `${r},${c}`));
    return (state.player2Heroes ?? []).filter(hero =>
        hero.state === 'alive' && hero.position && cells.has(`${hero.position[0]},${hero.position[1]}`)
    ).length;
}

describe('双飞燕 AI 选镖位', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('第二把镖不叠在已有的镖位上，并且会把三角撑到敌人身上', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);
        const pinned = placeShuangfeiyanBoomerang(state, hero, [2, 5])!;
        pinned.returnAtSkillSerial = 99;

        // 叠放那一路看着最香：2,3 / 2,4 / 2,5 全在同一条线上，去程一次挠三只
        addHero(state, 'baize', 'player2', [2, 3]);
        addHero(state, 'moran', 'player2', [2, 4]);
        addHero(state, 'liuli', 'player2', [2, 5]);

        const plan = chooseComputerSkillPlan(state, hero, 'shuangfeiyan_skill1');

        expect(plan, 'AI 应该还能找到可用的掷镖方案').not.toBeNull();
        const landing = plan!.targetPositions[0];
        expect(landing, '不能把第二把镖叠回 2,5：那只站在镖位上的敌人吃得到去程，但双镖同点撑不出三角').not.toEqual([2, 5]);
        expect(chebyshev(landing, [2, 5])).toBeGreaterThanOrEqual(2);
        expect(getShuangfeiyanTriangleArea2([2, 2], [2, 5], landing), 'AI 要撑出真三角，不能把双镖压在同一条线上').toBeGreaterThan(0);
        expect(foeCountInTriangle(state, [2, 2], [2, 5], landing)).toBeGreaterThanOrEqual(2);
    });

    it('两把镖都撑开且三角罩到人时，AI 会用技能一的三角收口', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);
        const first = placeShuangfeiyanBoomerang(state, hero, [2, 5])!;
        const second = placeShuangfeiyanBoomerang(state, hero, [5, 2])!;
        first.returnAtSkillSerial = 99;
        second.returnAtSkillSerial = 99;

        // 三角内：2,4 / 3,3 / 3,2 / 4,2；三角外：5,5
        addHero(state, 'baize', 'player2', [2, 4]);
        addHero(state, 'moran', 'player2', [3, 3]);
        addHero(state, 'liuli', 'player2', [3, 2]);
        addHero(state, 'zhenxiao', 'player2', [4, 2]);
        addHero(state, 'changli', 'player2', [5, 5]);

        const plan = chooseComputerSkillPlan(state, hero);

        expect(plan).not.toBeNull();
        expect(plan!.skillId).toBe('shuangfeiyan_skill1');
        expect(plan!.targetPositions[0]).toEqual([2, 2]);
        expect(foeCountInTriangle(state, [2, 2], [2, 5], [5, 2])).toBe(4);
    });
});
