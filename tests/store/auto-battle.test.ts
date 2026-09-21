import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runComputerOpponentStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import type { GameState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * AI 接管（autoBattle）：人机对局里把玩家这一侧也交给同一套电脑决策，
 * 玩家可以脱手看两个 AI 对局，也可以随时开停。
 */

/** 载入一局人机对局（默认战斗阶段、轮到玩家一、接管关闭） */
function loadAiBattle(overrides: Partial<GameState> = {}): GameState {
    const state = makeGameState(overrides);
    useGameStore.setState({
        ...state,
        isOnlineMode: false,
        isAiMode: true,
        aiPlayer: 'player2',
        aiDifficulty: 'master',
        autoBattle: false,
        moveRange: [],
        skillRange: [],
        wukongSkill2State: undefined,
        suppressOnlineBroadcast: false,
    });
    return state;
}

/** 把手工搭好的棋盘/名册同步回 store（addHero 改的是同一批对象引用） */
function syncBoard(state: GameState): void {
    useGameStore.setState({
        board: state.board,
        player1Heroes: state.player1Heroes,
        player2Heroes: state.player2Heroes,
    });
}

describe('AI 接管开关', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().resetGame();
    });

    it('只在人机对局的战斗阶段可以开启', () => {
        loadAiBattle({ phase: 'hero-select' });
        useGameStore.getState().toggleAutoBattle();
        expect(useGameStore.getState().autoBattle).toBe(false);

        loadAiBattle();
        useGameStore.setState({ isOnlineMode: true });
        useGameStore.getState().toggleAutoBattle();
        expect(useGameStore.getState().autoBattle).toBe(false);

        loadAiBattle();
        useGameStore.setState({ isAiMode: false }); // 本地双人：没有"电脑"可接管
        useGameStore.getState().toggleAutoBattle();
        expect(useGameStore.getState().autoBattle).toBe(false);

        loadAiBattle();
        useGameStore.getState().toggleAutoBattle();
        expect(useGameStore.getState().autoBattle).toBe(true);
        useGameStore.getState().toggleAutoBattle();
        expect(useGameStore.getState().autoBattle).toBe(false);
    });

    it('玩家手动操作即收回控制权，未开启时收回是空操作', () => {
        loadAiBattle();
        useGameStore.getState().toggleAutoBattle();
        useGameStore.getState().releaseAutoBattle();
        expect(useGameStore.getState().autoBattle).toBe(false);

        useGameStore.getState().releaseAutoBattle();
        expect(useGameStore.getState().autoBattle).toBe(false);
    });

    it('开新局与退回主菜单都会清掉接管状态', () => {
        loadAiBattle();
        useGameStore.getState().toggleAutoBattle();
        useGameStore.getState().initGame();
        expect(useGameStore.getState().autoBattle).toBe(false);

        loadAiBattle();
        useGameStore.getState().toggleAutoBattle();
        useGameStore.getState().resetGame();
        expect(useGameStore.getState().autoBattle).toBe(false);
    });
});

describe('AI 接管代打', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().resetGame();
    });

    it('未开接管时电脑不会碰玩家一侧', () => {
        const state = loadAiBattle();
        const mine = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [5, 5]);
        syncBoard(state);

        runComputerOpponentStep();

        const after = useGameStore.getState();
        expect(after.selectedHero).toBeNull();
        expect(mine.position).toEqual([0, 0]);
        expect(mine.hasActedThisTurn).toBe(false);
        expect(after.currentPlayer).toBe('player1');
    });

    it('开接管后电脑按同一套决策替玩家出手，且不改变行动权归属', () => {
        const state = loadAiBattle();
        const mine = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [5, 5]);
        syncBoard(state);
        useGameStore.setState({ autoBattle: true });

        runComputerOpponentStep();

        const after = useGameStore.getState();
        const tookOver = after.selectedHero?.id === mine.id
            || (after.moveRange.length > 0 && after.selectedHero?.owner === 'player1')
            || mine.hasActedThisTurn;
        expect(tookOver).toBe(true);
        expect(after.currentPlayer).toBe('player1');
    });

    it('接管期间补员挂起也由电脑替玩家决定', () => {
        const state = loadAiBattle();
        addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [5, 5]);
        syncBoard(state);
        useGameStore.setState({
            autoBattle: true,
            reinforcingPlayer: 'player1',
            player1BenchHeroIds: ['liuli'],
        });

        runComputerOpponentStep();

        const after = useGameStore.getState();
        // 电脑已经点过替补（选中待落位）或直接完成了落位上场
        const engaged = after.reinforcementSelectableHeroId !== null || after.reinforcingPlayer === null;
        expect(engaged).toBe(true);
    });
});
