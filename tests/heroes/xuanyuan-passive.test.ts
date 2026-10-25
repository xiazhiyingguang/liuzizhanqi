import { afterEach, describe, expect, it, vi } from 'vitest';
import { driftFlyingSwords, getFlyingSwords, placeFlyingSword } from '../../src/core/flying-sword';
import { useGameStore } from '../../src/store/game-store';
import type { GameState, Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 轩辕神君被动「剑随气走」：他每完成一次主动位移（普通移动、技能一落地，含每一跳），
 * 属于他的飞剑各向上/下/左/右随机挪一格。
 * 方向表按 上、下、左、右 排列，Math.random 0.99 → 右。
 */

function mount(state: GameState, hero: Hero): void {
    useGameStore.setState({
        ...state,
        moveRange: [],
        skillRange: [],
        wukongSkill2State: undefined,
        suppressOnlineBroadcast: false,
        selectedHero: hero,
        activeHero: hero,
        selectedSkill: null,
    });
}

function swordCells(state: GameState, heroId: string): string[] {
    return getFlyingSwords(state, heroId)
        .map(sword => `${sword.position[0]},${sword.position[1]}`)
        .sort();
}

describe('轩辕神君 · 被动「剑随气走」', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('普通移动后所有飞剑各挪一格', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99); // 一律向右
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [3, 3]);
        placeFlyingSword(state, hero, [3, 4]);
        placeFlyingSword(state, hero, [1, 2]);
        mount(state, hero);

        useGameStore.getState().moveHero([1, 1]);

        expect(hero.position).toEqual([1, 1]);
        expect(swordCells(state, hero.id)).toEqual(['1,3', '3,5']);
    });

    it('出界方向不选：贴右墙的剑改往其余方向挪', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99); // 右出不去，剩下的方向里取最后一个
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [3, 3]);
        placeFlyingSword(state, hero, [3, 5]);

        driftFlyingSwords(state, hero);

        expect(swordCells(state, hero.id)).toEqual(['3,4']);
    });

    it('两把剑撞向同一格时，后处理的那把原地不动', () => {
        const random = vi.spyOn(Math, 'random');
        random.mockReturnValueOnce(0.9); // 第一把向右 → (2,3)
        random.mockReturnValueOnce(0.6); // 第二把向左 → 目标已被占，留在 (2,4)
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [3, 3]);
        placeFlyingSword(state, hero, [2, 2]);
        placeFlyingSword(state, hero, [2, 4]);

        driftFlyingSwords(state, hero);

        expect(swordCells(state, hero.id)).toEqual(['2,3', '2,4']);
    });

    it('场上没有飞剑时什么也不发生', () => {
        const random = vi.spyOn(Math, 'random');
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [3, 3]);

        expect(driftFlyingSwords(state, hero)).toBe(0);
        expect(random).not.toHaveBeenCalled();
    });

    it('撤销移动会把飞剑放回漂移前的位置', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const state = makeGameState();
        const hero = addHero(state, 'xuanyuan', 'player1', [3, 3]);
        placeFlyingSword(state, hero, [3, 4]);
        mount(state, hero);

        useGameStore.getState().moveHero([1, 1]);
        expect(swordCells(state, hero.id)).toEqual(['3,5']);

        useGameStore.getState().undoMove();

        expect(hero.position).toEqual([3, 3]);
        expect(swordCells(state, hero.id)).toEqual(['3,4']);
    });
});
