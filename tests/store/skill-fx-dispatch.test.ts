import { describe, expect, it } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import type { Hero } from '../../src/types/game';

/** 搭建一局人机对局并进入战斗阶段，返回场上英雄查找器 */
function setupBattle(): () => Hero | undefined {
    const store = useGameStore.getState();
    store.resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: false, aiPlayer: undefined });
    useGameStore.getState().initGame();

    for (const heroId of ['wukong', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    }
    for (const heroId of ['moran', 'zhenxiao', 'huifeng', 'baize', 'liuli', 'changli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player2', heroId)).toBe(true);
    }
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player2')).toBe(true);
    expect(useGameStore.getState().phase).toBe('deploy');

    // 悟空在 [2,1]，右侧 [2,2] 留空供召唤分身
    for (const [heroId, pos] of [
        ['wukong', [2, 1]],
        ['moran', [1, 0]],
        ['zhenxiao', [3, 0]],
        ['huifeng', [1, 1]],
    ] as Array<[string, [number, number]]>) {
        expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, pos)).toBe(true);
    }
    for (const [heroId, pos] of [
        ['moran', [1, 5]],
        ['zhenxiao', [2, 5]],
        ['huifeng', [3, 4]],
        ['baize', [4, 4]],
    ] as Array<[string, [number, number]]>) {
        expect(useGameStore.getState().deployHeroForPlayer('player2', heroId, pos)).toBe(true);
    }
    expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);

    expect(useGameStore.getState().phase).toBe('battle');
    return (id: string) =>
        [...useGameStore.getState().player1Heroes].find(h => h.id.startsWith(`${id}-player1-`));
}

/** 在 [2,2]（悟空右侧）部署一个敌方莫问，供技能二攻击 */
function setupBattleWithAdjacentEnemy(): () => Hero | undefined {
    const store = useGameStore.getState();
    store.resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: false, aiPlayer: undefined });
    useGameStore.getState().initGame();

    for (const heroId of ['wukong', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    }
    for (const heroId of ['moran', 'zhenxiao', 'huifeng', 'baize', 'liuli', 'changli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player2', heroId)).toBe(true);
    }
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player2')).toBe(true);

    for (const [heroId, pos] of [
        ['wukong', [2, 2]],
        ['moran', [1, 0]],
        ['zhenxiao', [3, 0]],
        ['huifeng', [1, 1]],
    ] as Array<[string, [number, number]]>) {
        expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, pos)).toBe(true);
    }
    for (const [heroId, pos] of [
        ['moran', [2, 3]],
        ['zhenxiao', [2, 5]],
        ['huifeng', [3, 4]],
        ['baize', [4, 4]],
    ] as Array<[string, [number, number]]>) {
        expect(useGameStore.getState().deployHeroForPlayer('player2', heroId, pos)).toBe(true);
    }
    expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);

    expect(useGameStore.getState().phase).toBe('battle');
    return (id: string) =>
        [...useGameStore.getState().player1Heroes].find(h => h.id.startsWith(`${id}-player1-`));
}

describe('executeSkill 技能特效派发', () => {
    it('孙悟空技能一施放成功后派发 wukong-clone 特效事件', () => {
        const findHero = setupBattle();
        const wukong = findHero('wukong')!;

        useGameStore.getState().selectHeroForAction(wukong);
        expect(useGameStore.getState().selectedHero?.id).toContain('wukong');

        useGameStore.getState().selectSkill('wukong_skill1');
        expect(useGameStore.getState().selectedSkill?.id).toBe('wukong_skill1');

        useGameStore.getState().executeSkill([2, 2]);

        const fx = useGameStore.getState().skillFx;
        expect(fx.length).toBeGreaterThanOrEqual(1);
        const event = fx[fx.length - 1];
        expect(event.profile.kind).toBe('wukong-clone');
        expect(event.owner).toBe('player1');
        expect(event.fromPos).toEqual([2, 1]);
        expect(event.targetPos).toEqual([2, 2]);
    });

    it('施放失败（目标格被占）不派发特效事件', () => {
        const findHero = setupBattle();
        const wukong = findHero('wukong')!;
        expect(wukong).toBeDefined();

        useGameStore.getState().selectHeroForAction(wukong);
        expect(useGameStore.getState().selectedHero?.id).toContain('wukong');
        useGameStore.getState().selectSkill('wukong_skill1');
        expect(useGameStore.getState().selectedSkill?.id).toBe('wukong_skill1');

        const fxBefore = useGameStore.getState().skillFx.length;
        // [1,1] 已被回锋占用：召唤应失败
        useGameStore.getState().executeSkill([1, 1]);

        expect(useGameStore.getState().skillFx.length).toBe(fxBefore);
    });

    it('孙悟空技能二（无分身直接攻击）派发 wukong-staff 特效事件且角度正确', () => {
        const findHero = setupBattleWithAdjacentEnemy();
        const wukong = findHero('wukong')!;
        expect(wukong).toBeDefined();

        useGameStore.getState().selectHeroForAction(wukong);
        expect(useGameStore.getState().selectedHero?.id).toContain('wukong');

        useGameStore.getState().selectSkill('wukong_skill2');
        expect(useGameStore.getState().selectedSkill?.id).toBe('wukong_skill2');

        // 悟空 [2,2] 攻击右侧 [2,3] 的敌人：正东方向，angleDeg 应为 0
        useGameStore.getState().executeSkill([2, 3]);

        const state = useGameStore.getState();
        const fx = state.skillFx;
        expect(fx.length).toBeGreaterThanOrEqual(1);
        const event = fx[fx.length - 1];
        expect(event.profile.kind).toBe('wukong-staff');
        expect(event.owner).toBe('player1');
        expect(event.fromPos).toEqual([2, 2]);
        expect(event.targetPos).toEqual([2, 3]);
        expect(event.angleDeg).toBe(0);
        expect(event.direction).toBe('E');
    });
});
