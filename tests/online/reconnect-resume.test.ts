import { beforeEach, describe, expect, it } from 'vitest';
import { applyResumePayload } from '../../src/services/online-state';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';

const TEAM_A = ['moran', 'zhenxiao', 'baize', 'wukong', 'liuli', 'mirror'];
const TEAM_B = ['soul_lamp', 'lilith', 'changli', 'jetzmi', 'pipa', 'bounty'];

/**
 * 掉线重连后的局面重建（客户端侧）。
 * 服务端把席位保留并回传 room-resume，但如果这里不把它落回 store，
 * 玩家看到的仍然是断线前的旧棋盘——所以两端都要有回归。
 */
describe('联机重连后的局面重建', () => {
    beforeEach(() => {
        useGameStore.setState({
            isOnlineMode: false,
            onlineRoomId: undefined,
            localPlayerNumber: undefined,
            onlineSelfReconnecting: false,
            onlineOpponentOfflineUntil: undefined
        });
    });

    it('战斗阶段用服务端权威快照覆盖本地状态，并保住房间身份', () => {
        useGameStore.setState({ isOnlineMode: true, onlineRoomId: 'ROOM-4432', localPlayerNumber: 2 });
        useGameStore.getState().initGame();
        const snapshot = {
            ...createOnlineStateSnapshot(useGameStore.getState()),
            phase: 'battle',
            roundNumber: 7,
            currentPlayer: 'player1'
        };
        // 断线期间本地棋盘已经漂了：回合数被自己推进过
        useGameStore.setState({ roundNumber: 1, onlineSelfReconnecting: true });

        applyResumePayload({
            roomId: 'ROOM-4432', playerNumber: 2, phase: 'battle', revision: 12, gameState: snapshot
        });

        const state = useGameStore.getState();
        expect(state.isOnlineMode).toBe(true);
        expect(state.onlineRoomId).toBe('ROOM-4432');
        expect(state.localPlayerNumber).toBe(2);
        expect(state.phase).toBe('battle');
        expect(state.roundNumber).toBe(7);
        expect(state.onlineSelfReconnecting).toBe(false);
    });

    it('选将阶段掉线：按服务端记录重放双方名单，不从空面板重新开始', () => {
        useGameStore.setState({ isOnlineMode: true, onlineRoomId: 'ROOM-9911', localPlayerNumber: 1 });

        applyResumePayload({
            roomId: 'ROOM-9911',
            playerNumber: 1,
            phase: 'hero-select',
            revision: 3,
            heroSelections: { player1: TEAM_A, player2: TEAM_B },
            heroSelectReady: { player1: false, player2: false },
            deployments: { player1: [], player2: [] },
            deployReady: { player1: false, player2: false },
            gameState: null,
            opponentOffline: true
        });

        const state = useGameStore.getState();
        expect(state.player1SelectedHeroIds).toEqual(TEAM_A);
        expect(state.player2SelectedHeroIds).toEqual(TEAM_B);
        expect(state.phase).toBe('hero-select');
        // 对面也还没回来时，倒计时要重新挂上
        expect(state.onlineOpponentOfflineUntil).toBeGreaterThan(Date.now());
    });

    it('布阵阶段掉线：重放已部署的格子与确认状态', () => {
        useGameStore.setState({ isOnlineMode: true, onlineRoomId: 'ROOM-2277', localPlayerNumber: 1 });

        applyResumePayload({
            roomId: 'ROOM-2277',
            playerNumber: 1,
            phase: 'deploy',
            revision: 9,
            heroSelections: { player1: TEAM_A, player2: TEAM_B },
            heroSelectReady: { player1: true, player2: true },
            deployments: {
                player1: [[TEAM_A[0], '0,0'], [TEAM_A[1], '1,1']],
                player2: []
            },
            deployReady: { player1: false, player2: false },
            gameState: null
        });

        const state = useGameStore.getState();
        expect(state.phase).toBe('deploy');
        expect(state.player1Heroes.map(hero => hero.position)).toEqual([[0, 0], [1, 1]]);
        expect(state.player1ReadyDeploy).toBe(false);
    });
});
