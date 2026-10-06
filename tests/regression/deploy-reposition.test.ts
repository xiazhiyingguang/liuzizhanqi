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
 * 2. 已放置的英雄无法调整位置，选错格只能认栽；
 * 3. 一旦上场就只能换格子、换不了人——想换成候选席里的另一位没有出口。
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

describe('布阵阶段：撤下已上阵英雄（可换人重选）', () => {
    beforeEach(() => {
        enterDeployPhase();
        deployFour();
    });

    it('撤下后格子释放、名单移除，可让第5名英雄顶上空位', () => {
        const fallen = useGameStore.getState().player1Heroes[1]; // [1,1]
        const ok = useGameStore.getState().undeployHeroForPlayer('player1', fallen.id);
        expect(ok).toBe(true);

        let state = useGameStore.getState();
        expect(state.board[1][1]).toBeNull();
        expect(state.player1Heroes).toHaveLength(3);
        expect(state.player1Heroes.some(h => h.id === fallen.id)).toBe(false);

        // 空位腾出后，原本被"首发已满"拦住的第5名英雄可以上阵
        const fifthId = AVAILABLE_HERO_IDS[4];
        expect(
            useGameStore.getState().deployHeroForPlayer('player1', fifthId, [1, 1])
        ).toBe(true);

        state = useGameStore.getState();
        expect(state.player1Heroes).toHaveLength(4);
        expect(state.board[1][1]?.id.startsWith(`${fifthId}-player1-`)).toBe(true);
    });

    it('按模板 ID 撤下（联机对端消息口径）同样生效', () => {
        const target = useGameStore.getState().player1Heroes[0];
        const templateId = target.id.replace(/-(player1|player2)-\d+$/, '');

        expect(useGameStore.getState().undeployHeroForPlayer('player1', templateId)).toBe(true);
        expect(useGameStore.getState().board[0][0]).toBeNull();
        expect(useGameStore.getState().player1Heroes).toHaveLength(3);
    });

    it('不足4人时确认部署被拦，撤下后再补满即可确认', () => {
        const first = useGameStore.getState().player1Heroes[0];
        const firstTemplateId = first.id.replace(/-(player1|player2)-\d+$/, '');
        expect(useGameStore.getState().undeployHeroForPlayer('player1', first.id)).toBe(true);

        useGameStore.setState({ player2ReadyDeploy: true });
        expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(false);
        expect(useGameStore.getState().phase).toBe('deploy');

        // 顶上第5名英雄，再撤下换回原来那位：替补名单按最终上场情况计算
        const fifthId = AVAILABLE_HERO_IDS[4];
        expect(useGameStore.getState().deployHeroForPlayer('player1', fifthId, [0, 0])).toBe(true);
        expect(useGameStore.getState().undeployHeroForPlayer('player1', fifthId)).toBe(true);
        expect(useGameStore.getState().deployHeroForPlayer('player1', firstTemplateId, [0, 0])).toBe(true);

        expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
        const state = useGameStore.getState();
        expect(state.phase).toBe('battle');
        expect(state.player1BenchHeroIds).toEqual([AVAILABLE_HERO_IDS[4], AVAILABLE_HERO_IDS[5]]);
    });

    it('撤下未上阵的英雄、非部署阶段与已确认后一律拒绝', () => {
        expect(
            useGameStore.getState().undeployHeroForPlayer('player1', AVAILABLE_HERO_IDS[5])
        ).toBe(false);

        useGameStore.setState({ player1ReadyDeploy: true });
        const deployedId = useGameStore.getState().player1Heroes[0].id;
        expect(useGameStore.getState().undeployHeroForPlayer('player1', deployedId)).toBe(false);

        useGameStore.setState({ player1ReadyDeploy: false, phase: 'battle' });
        expect(useGameStore.getState().undeployHeroForPlayer('player1', deployedId)).toBe(false);
        expect(useGameStore.getState().player1Heroes).toHaveLength(4);
    });

    it('只能撤下本方英雄，不会动到对手棋盘', () => {
        useGameStore.getState().deployHeroForPlayer('player2', AVAILABLE_HERO_IDS[0], [0, 5]);
        const enemy = useGameStore.getState().player2Heroes[0];

        expect(useGameStore.getState().undeployHeroForPlayer('player1', enemy.id)).toBe(false);
        expect(useGameStore.getState().board[0][5]?.id).toBe(enemy.id);
        expect(useGameStore.getState().player2Heroes).toHaveLength(1);
    });

    it('UI 用的 undeployHero 包装按实例 ID 撤下当前布阵方', () => {
        const hero = useGameStore.getState().player1Heroes[2]; // [2,2]
        useGameStore.getState().undeployHero(hero.id);

        const state = useGameStore.getState();
        expect(state.board[2][2]).toBeNull();
        expect(state.player1Heroes.some(h => h.id === hero.id)).toBe(false);
    });
});
