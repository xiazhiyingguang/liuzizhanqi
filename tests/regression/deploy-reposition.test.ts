import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import { HeroState } from '../../src/types/game';

/**
 * 回归：布阵阶段的上阵上限与位置调整。
 *
 * 历史问题：
 * 1. 上阵满4人后，候选条剩余两名替补仍可点击上阵（引擎也无人数校验），
 *    容易误操作导致超员；
 * 2. 已放置的英雄无法调整位置，选错格只能认栽。
 */

function enterDeployPhase() {
    useGameStore.getState().resetGame();
    // 选满6人（4首发+2替补）后进入布阵阶段
    useGameStore.setState({
        phase: 'deploy',
        selectingPlayer: 'player1',
        player1ReadyDeploy: false,
        player2ReadyDeploy: false,
        player1SelectedHeroIds: AVAILABLE_HERO_IDS.slice(0, 6),
        player2SelectedHeroIds: AVAILABLE_HERO_IDS.slice(0, 6),
        isOnlineMode: false,
        isAiMode: false
    });
}

function deployFour(): string[] {
    const ids = AVAILABLE_HERO_IDS.slice(0, 4);
    const positions: Array<[number, number]> = [[0, 0], [1, 1], [2, 2], [3, 0]];
    ids.forEach((heroId, i) => {
        const ok = useGameStore.getState().deployHeroForPlayer('player1', heroId, positions[i]);
        expect(ok).toBe(true);
    });
    return ids;
}

describe('布阵阶段：首发4人硬上限', () => {
    beforeEach(enterDeployPhase);

    it('上阵满4人后，第5名英雄被引擎拦截', () => {
        deployFour();

        const fifthId = AVAILABLE_HERO_IDS[4];
        const ok = useGameStore.getState().deployHeroForPlayer('player1', fifthId, [5, 2]);

        expect(ok).toBe(false);
        expect(useGameStore.getState().player1Heroes).toHaveLength(4);
        expect(useGameStore.getState().board[5][2]).toBeNull();
    });

    it('满员后确认部署仍可用，替补名单为未上阵的2人', () => {
        const ids = deployFour();
        useGameStore.setState({ player2ReadyDeploy: true });

        const ok = useGameStore.getState().confirmDeploymentForPlayer('player1');
        expect(ok).toBe(true);

        const benchIds = useGameStore.getState().player1BenchHeroIds;
        expect(benchIds).toHaveLength(2);
        expect(benchIds).toContain(AVAILABLE_HERO_IDS[4]);
        expect(ids.every(id => !benchIds.includes(id))).toBe(true);
    });
});

describe('布阵阶段：位置调整（移动与交换）', () => {
    let firstDeployedId = '';

    beforeEach(() => {
        enterDeployPhase();
        deployFour();
        firstDeployedId = useGameStore.getState().player1Heroes[0].id;
    });

    it('移动到空格：board 与英雄列表同步更新', () => {
        const ok = useGameStore.getState().repositionDeployHeroForPlayer('player1', firstDeployedId, [4, 2]);

        expect(ok).toBe(true);
        const state = useGameStore.getState();
        expect(state.board[0][0]).toBeNull();

        const moved = state.player1Heroes.find(h => h.id === firstDeployedId)!;
        expect(moved.position).toEqual([4, 2]);
        expect(state.board[4][2]?.id).toBe(firstDeployedId);
        // board 与列表引用保持一致
        expect(state.board[4][2]).toBe(moved);
    });

    it('目标为己方英雄时交换两人位置', () => {
        const heroes = useGameStore.getState().player1Heroes;
        const idA = heroes[0].id; // [0,0]
        const idB = heroes[1].id; // [1,1]

        const ok = useGameStore.getState().repositionDeployHeroForPlayer('player1', idA, [1, 1]);
        expect(ok).toBe(true);

        const state = useGameStore.getState();
        const a = state.player1Heroes.find(h => h.id === idA)!;
        const b = state.player1Heroes.find(h => h.id === idB)!;

        expect(a.position).toEqual([1, 1]);
        expect(b.position).toEqual([0, 0]);
        expect(state.board[1][1]?.id).toBe(idA);
        expect(state.board[0][0]?.id).toBe(idB);
        expect(state.player1Heroes).toHaveLength(4);
    });

    it('移动到对方半场或非法坐标被拒绝', () => {
        // player1 只能放左侧三列（col < 3）
        expect(useGameStore.getState().repositionDeployHeroForPlayer('player1', firstDeployedId, [0, 3])).toBe(false);
        expect(useGameStore.getState().repositionDeployHeroForPlayer('player1', firstDeployedId, [9, 9] as [number, number])).toBe(false);
    });

    it('原地不动视为无效操作', () => {
        const pos = [...useGameStore.getState().player1Heroes[0].position!] as [number, number];
        expect(useGameStore.getState().repositionDeployHeroForPlayer('player1', firstDeployedId, pos)).toBe(false);
    });

    it('本方确认部署后不可再调整', () => {
        useGameStore.setState({ player1ReadyDeploy: true });

        expect(
            useGameStore.getState().repositionDeployHeroForPlayer('player1', firstDeployedId, [4, 2])
        ).toBe(false);
    });

    it('非部署阶段不可调整', () => {
        useGameStore.setState({ phase: 'battle' });

        expect(
            useGameStore.getState().repositionDeployHeroForPlayer('player1', firstDeployedId, [4, 2])
        ).toBe(false);
    });

    it('调整不影响确认部署与替补名单计算', () => {
        // 把第4人从 [3,0] 挪到 [5,2]，再换前两人的位置
        const heroes = useGameStore.getState().player1Heroes;
        useGameStore.getState().repositionDeployHeroForPlayer('player1', heroes[3].id, [5, 2]);
        useGameStore.getState().repositionDeployHeroForPlayer('player1', heroes[0].id, [1, 1]);

        useGameStore.setState({ player2ReadyDeploy: true });
        expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);

        const state = useGameStore.getState();
        expect(state.phase).toBe('battle');
        expect(state.player1BenchHeroIds).toHaveLength(2);
        // 战场上的首发仍是4人，位置与调整后一致
        const onBoard = state.player1Heroes.filter(h => h.state === HeroState.ALIVE && h.position).length;
        expect(onBoard).toBe(4);
    });
});
