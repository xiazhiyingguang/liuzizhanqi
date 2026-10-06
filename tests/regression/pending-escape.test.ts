import { afterEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';
import { HeroState } from '../../src/types/game';

/**
 * 挂起的"兜底出口"回归：玩家点结束行动时，任何一类 pendingBoardAction 都必须能被放出去。
 *
 * 引擎不认 pendingBoardAction（它只认行动序号），所以挂起一旦漂到"主人不再是当前焦点"
 * 这类无人可答的局面，abandonPendingBoardAction 是唯一能把控制权还回去的路。
 * 血契·血誓不熄与薛定谔·叠加态以前不在这条路的白名单里，玩家会连手动结束都点不动。
 */
describe('挂起兜底出口', () => {
    afterEach(() => useGameStore.getState().resetGame());

    /** 挂起属于 hero，但当前焦点是别人——即"漂到无人可答"的局面 */
    function armDriftedPending(heroId: string, pendingType: 'xueqi-tianwei' | 'schrodinger-tianwei' | 'yunying-tianwei') {
        const state = makeGameState();
        const owner = addHero(state, heroId, 'player1', [3, 3]);
        const focus = addHero(state, 'moran', 'player1', [2, 3]);
        useGameStore.setState({
            ...state,
            phase: 'battle',
            currentPlayer: 'player1',
            selectedHero: focus,
            activeHero: focus,
            pendingBoardAction: { type: pendingType, heroId: owner.id },
            highlightedPositions: [[0, 0]],
            skillRange: [[0, 0]],
        });
        return { owner, focus };
    }

    for (const pendingType of ['xueqi-tianwei', 'schrodinger-tianwei'] as const) {
        it(`${pendingType} 能被"结束行动"放出去，并清掉残留高亮`, () => {
            const heroId = pendingType === 'xueqi-tianwei' ? 'xueqi' : 'schrodinger';
            const { owner, focus } = armDriftedPending(heroId, pendingType);

            expect(useGameStore.getState().abandonPendingBoardAction()).toBe(true);

            const after = useGameStore.getState();
            expect(after.pendingBoardAction).toBeUndefined();
            expect(after.highlightedPositions).toEqual([]);
            expect(after.skillRange).toEqual([]);
            // 挂起不扣着焦点英雄的行动，就不该替别人收尾：焦点与阵亡计数都不许动
            expect(after.selectedHero?.id).toBe(focus.id);
            expect(after.player1Heroes.some(hero => hero.id === owner.id)).toBe(true);
        });
    }

    it('挂起确实扣着主人自己的行动时，作废并放行这次行动', () => {
        const state = makeGameState();
        const xueqi = addHero(state, 'xueqi', 'player1', [3, 3]);
        useGameStore.setState({
            ...state,
            phase: 'battle',
            currentPlayer: 'player1',
            selectedHero: xueqi,
            activeHero: xueqi,
            pendingBoardAction: { type: 'xueqi-tianwei', heroId: xueqi.id },
        });

        expect(useGameStore.getState().abandonPendingBoardAction()).toBe(true);

        const after = useGameStore.getState();
        expect(after.pendingBoardAction).toBeUndefined();
        expect(after.player1Heroes.find(hero => hero.id === xueqi.id)?.state).toBe(HeroState.ALIVE);
        // 收尾后焦点应交还，而不是继续抓着这名英雄
        expect(after.selectedHero?.id).not.toBe(xueqi.id);
    });
});
