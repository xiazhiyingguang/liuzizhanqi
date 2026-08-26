import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
// The LAN server intentionally stays as plain ESM JavaScript so it can run without a build step.
// @ts-expect-error JavaScript server module has no declaration file.
import { rooms, startServer, stopServer } from '../../server/server.js';
import { connectToServer, disconnectFromServer, onEvent, offEvent } from '../../src/services/socket-service';
import { applyServerGameState } from '../../src/services/online-state';
import { useGameStore } from '../../src/store/game-store';

let serverUrl = '';
const rawClients: Socket[] = [];

function connectRawClient(): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket = createClient(serverUrl, {
            transports: ['websocket'],
            reconnection: false,
            forceNew: true
        });
        rawClients.push(socket);
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

function once<T = any>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待事件超时: ${event}`)), 3000);
        socket.once(event, (data: T) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

function emitAck<T = any>(socket: Socket, event: string, payload?: any): Promise<T> {
    return new Promise((resolve) => {
        if (payload === undefined) socket.emit(event, resolve);
        else socket.emit(event, payload, resolve);
    });
}

function makeHero(id: string, owner: 'player1' | 'player2', position: [number, number] | null, state = 'alive') {
    return {
        id,
        name: id.split('-')[0],
        owner,
        state,
        position,
        maxHp: 20,
        currentHp: state === 'alive' ? 20 : 0,
        attackPower: 5,
        counters: {},
        effects: [],
        hasActedThisTurn: false,
        hasMovedThisTurn: false,
        skill1Id: null,
        skill2Id: null,
        passiveId: null
    };
}

function makeBoard(entries: Array<[number, number, any]>): any[][] {
    const board = Array.from({ length: 6 }, () => Array(6).fill(null));
    for (const [r, c, hero] of entries) board[r][c] = hero;
    return board;
}

/**
 * 端到端复现联机补员流程：
 * 玩家1（凶手，裸 socket）击杀玩家2英雄并结束行动 → 广播补员挂起快照；
 * 玩家2（补员方，走真实 socket-service + game-store）选择替补并落位；
 * 服务器必须放行 reinforce-deploy 并把结果广播回玩家1。
 */
describe('联机模式替补补员端到端', () => {
    let playerA: Socket;
    let roomId: string;

    beforeAll(async () => {
        const info = await startServer(0, '127.0.0.1') as { port: number };
        serverUrl = `http://127.0.0.1:${info.port}`;

        playerA = await connectRawClient();
        const created = await emitAck<{ success: boolean; roomId: string }>(playerA, 'create-room');
        roomId = created.roomId;
        await emitAck(playerA, 'join-room', { roomId, playerName: '甲' });

        // 玩家2 走真实 socket-service（store 的 sendOnlineActionIfNeeded 依赖该单例）
        const storeSocket = connectToServer(serverUrl);
        await new Promise<void>(resolve => {
            if (storeSocket.connected) return resolve();
            storeSocket.once('connect', () => resolve());
        });
        const joinResult = await new Promise<any>(resolve => {
            storeSocket.timeout(5000).emit('join-room', { roomId, playerName: '乙' }, (err: any, res: any) => resolve(err ? { success: false, error: String(err) } : res));
        });
        expect(joinResult.success).toBe(true);
        expect(joinResult.playerNumber).toBe(2);

        const room = rooms.get(roomId)!;
        room.phase = 'battle';
        room.currentPlayer = 'player1';
    });

    afterAll(async () => {
        disconnectFromServer();
        for (const socket of rawClients) socket.disconnect();
        rooms.clear();
        await stopServer();
    });

    it('补员方可选择替补并落位，服务器放行且广播回凶手端', async () => {
        useGameStore.setState({
            isOnlineMode: true,
            onlineRoomId: roomId,
            localPlayerNumber: 2,
            suppressOnlineBroadcast: false
        });

        const p1Heroes = [
            makeHero('feixue-player1-1', 'player1', [2, 1]),
            makeHero('moran-player1-2', 'player1', [1, 0]),
            makeHero('zhenxiao-player1-3', 'player1', [3, 0]),
            makeHero('huifeng-player1-4', 'player1', [4, 1])
        ];
        // 玩家2 有一个英雄真实阵亡（moran-player2-2 已从场上移除，进入 dead 列表）
        const p2Heroes = [
            makeHero('libai-player2-1', 'player2', [2, 4]),
            makeHero('moran-player2-2', 'player2', null, 'dead'),
            makeHero('zhenxiao-player2-3', 'player2', [3, 5]),
            makeHero('huifeng-player2-4', 'player2', [4, 4])
        ];
        const snapshot = {
            phase: 'battle',
            currentPlayer: 'player1',
            roundNumber: 2,
            actionsThisTurn: 4,
            actionsRequiredThisTurn: 8,
            board: makeBoard([
                [2, 1, p1Heroes[0]], [1, 0, p1Heroes[1]], [3, 0, p1Heroes[2]], [4, 1, p1Heroes[3]],
                [2, 4, p2Heroes[0]], [3, 5, p2Heroes[2]], [4, 4, p2Heroes[3]]
            ]),
            player1Heroes: p1Heroes,
            player2Heroes: p2Heroes,
            player1BenchHeroIds: [],
            player2BenchHeroIds: ['baize', 'liuli'],
            reinforcingPlayer: 'player2',
            reinforceResumeContext: { heroId: 'feixue-player1-1' },
            battleLog: [],
            boardEffects: [],
            deathCounters: { player1Dead: 0, player2Dead: 1, totalDead: 1, player1Resurrections: 0, player2Resurrections: 0 }
        };

        // 玩家2 端以与 useOnlineSync 相同的方式应用凶手端权威快照
        const broadcastToStore = ({ gameState }: any) => {
            if (gameState) applyServerGameState(gameState);
        };
        onEvent('action-broadcast', broadcastToStore);

        let rejected: string | null = null;
        onEvent('action-rejected', ({ message }: any) => { rejected = message; });

        try {
            playerA.emit('player-action', {
                roomId,
                action: { type: 'end-turn', data: { heroId: 'feixue-player1-1' } },
                gameState: snapshot
            });

            // 补员方收到挂起快照
            await new Promise(resolve => setTimeout(resolve, 100));
            let s = useGameStore.getState();
            expect(s.reinforcingPlayer).toBe('player2');
            expect(s.player2BenchHeroIds).toEqual(['baize', 'liuli']);

            // 选择替补：修复前若该步返回 false 即"选择替补失效"
            expect(useGameStore.getState().selectReinforcementHero('baize')).toBe(true);
            expect(useGameStore.getState().reinforcementSelectableHeroId).toBe('baize');

            // 点击本方半场空格落位
            expect(useGameStore.getState().deployReinforcement([0, 4])).toBe(true);

            const deployed = useGameStore.getState();
            expect(deployed.reinforcingPlayer).toBeNull();
            const deployedHero = [...deployed.player2Heroes].find(h => h.id.startsWith('baize-player2-'));
            expect(deployedHero).toBeDefined();
            expect(deployedHero!.position).toEqual([0, 4]);
            expect(deployed.board[0][4]?.id).toBe(deployedHero!.id);

            // 服务器必须接受 reinforce-deploy 并广播回玩家1（未被拒绝）
            const broadcast = await once<any>(playerA, 'action-broadcast');
            expect(broadcast.action.type).toBe('reinforce-deploy');
            expect(broadcast.gameState.reinforcingPlayer).toBeNull();
            expect(broadcast.gameState.board[0][4]?.id.split('-')[0]).toBe('baize');
            expect(rejected, `补员被服务器拒绝: ${rejected}`).toBeNull();
        } finally {
            offEvent('action-broadcast', broadcastToStore);
        }
    });

    it('对手快照中的暂时阵亡英雄不得在对端诈尸占位', async () => {
        // 玩家2 的缚魂刀英雄已暂时阵亡：state=temp_dead、0 血、位置仍指向 [2,4]，
        // 但棋盘上该格为空（真实死亡/暂时阵亡都会离场）。
        const p2Heroes = [
            makeHero('soul_lamp-player2-1', 'player2', [2, 4], 'temp_dead'),
            makeHero('libai-player2-2', 'player2', [3, 5])
        ];
        const snapshot = {
            phase: 'battle',
            currentPlayer: 'player1',
            roundNumber: 3,
            actionsThisTurn: 1,
            actionsRequiredThisTurn: 8,
            board: makeBoard([[3, 5, p2Heroes[1]]]),
            player1Heroes: [makeHero('feixue-player1-1', 'player1', [2, 1])],
            player2Heroes: p2Heroes,
            player1BenchHeroIds: [],
            player2BenchHeroIds: ['baize'],
            reinforcingPlayer: null,
            battleLog: [],
            boardEffects: []
        };

        // 修复前：normalizeGameState 会把 temp_dead 英雄按旧 position 回填到棋盘，
        // 表现为对手出手后本方英雄"诈尸"——0 血却占据格子，还会挡住补员落位。
        applyServerGameState(snapshot);

        const s = useGameStore.getState();
        expect(s.board[2][4], '暂时阵亡英雄不得回填棋盘').toBeNull();
        const tempDead = [...s.player2Heroes].find(h => h.id === 'soul_lamp-player2-1')!;
        expect(tempDead.state).toBe('temp_dead');
        expect(tempDead.currentHp).toBe(0);
        // 位置保留用于复活定位，但棋盘格必须为空
        expect(tempDead.position).toEqual([2, 4]);
    });
});
