import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
// The LAN server intentionally stays as plain ESM JavaScript so it can run without a build step.
// @ts-expect-error JavaScript server module has no declaration file.
import { rooms, startServer, stopServer, sweepExpiredReconnects } from '../../server/server.js';

let serverUrl = '';
const clients: Socket[] = [];

function connectClient(): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket = createClient(serverUrl, {
            transports: ['websocket'],
            reconnection: false,
            forceNew: true
        });
        clients.push(socket);
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

function once<T = any>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待事件超时: ${event}`)), 2500);
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

function action(socket: Socket, roomId: string, type: string, data: any = {}, gameState?: any) {
    socket.emit('player-action', { roomId, action: { type, data }, gameState });
}

beforeAll(async () => {
    const info = await startServer(0, '127.0.0.1') as { port: number };
    serverUrl = `http://127.0.0.1:${info.port}`;
});

afterAll(async () => {
    for (const socket of clients) socket.disconnect();
    rooms.clear();
    await stopServer();
});

describe('局域网房间服务器', () => {
    it('完成建房、双人选将、布阵、战斗同步与离房清理', async () => {
        const player1 = await connectClient();
        const player2 = await connectClient();
        const spectator = await connectClient();

        const created = await emitAck<{ success: boolean; roomId: string }>(player1, 'create-room');
        expect(created.success).toBe(true);
        expect(created.roomId).toMatch(/^ROOM-[A-Z0-9]{6}$/);

        const joined1 = await emitAck<any>(player1, 'join-room', {
            roomId: created.roomId,
            playerName: '甲'
        });
        expect(joined1.playerNumber).toBe(1);

        const startForPlayer1 = once(player1, 'game-start');
        const startForPlayer2 = once(player2, 'game-start');
        const joined2 = await emitAck<any>(player2, 'join-room', {
            roomId: created.roomId.toLowerCase(),
            playerName: '乙'
        });
        expect(joined2.playerNumber).toBe(2);
        await Promise.all([startForPlayer1, startForPlayer2]);

        const fullRoom = await emitAck<any>(spectator, 'join-room', {
            roomId: created.roomId,
            playerName: '第三人'
        });
        expect(fullRoom).toMatchObject({ success: false, error: '房间已满' });

        // 替补制：与客户端一致，双方各选 6 位（首发 4 + 替补 2）
        const heroes1 = ['moran', 'zhenxiao', 'mirror', 'baize', 'wukong', 'liuli'];
        const heroes2 = ['wukong', 'liuli', 'soul_lamp', 'lilith', 'moran', 'zhenxiao'];
        for (const heroId of heroes1) action(player1, created.roomId, 'select-hero', { heroId });
        for (const heroId of heroes2) action(player2, created.roomId, 'select-hero', { heroId });
        await new Promise(resolve => setTimeout(resolve, 50));

        // 超出 6 位上限应被明确拒绝
        const overLimit = once<any>(player1, 'action-rejected');
        action(player1, created.roomId, 'select-hero', { heroId: 'soul_lamp' });
        expect((await overLimit).message).toBe('最多选择6位英雄');

        action(player1, created.roomId, 'confirm-hero-selection');
        action(player2, created.roomId, 'confirm-hero-selection');

        await new Promise(resolve => setTimeout(resolve, 80));
        expect(rooms.get(created.roomId)?.phase).toBe('deploy');

        for (let index = 0; index < 4; index += 1) {
            action(player1, created.roomId, 'deploy-hero', {
                heroId: heroes1[index],
                position: [index, 0]
            });
            action(player2, created.roomId, 'deploy-hero', {
                heroId: heroes2[index],
                position: [index, 5]
            });
        }
        await new Promise(resolve => setTimeout(resolve, 50));
        action(player1, created.roomId, 'confirm-deployment');
        action(player2, created.roomId, 'confirm-deployment');

        await new Promise(resolve => setTimeout(resolve, 80));
        expect(rooms.get(created.roomId)?.phase).toBe('battle');
        expect(rooms.get(created.roomId)?.currentPlayer).toBe('player1');

        const rejected = once<any>(player2, 'action-rejected');
        action(player2, created.roomId, 'move', { heroId: 'wukong-player2-1', to: [0, 4] }, {
            board: Array.from({ length: 6 }, () => Array(6).fill(null)),
            phase: 'battle',
            currentPlayer: 'player1'
        });
        expect((await rejected).message).toBe('当前不是你的回合');

        const authoritativeState = {
            board: Array.from({ length: 6 }, () => Array(6).fill(null)),
            phase: 'battle',
            currentPlayer: 'player2',
            roundNumber: 1
        };
        const broadcast = once<any>(player2, 'action-broadcast');
        action(player1, created.roomId, 'move', {
            heroId: 'moran-player1-1',
            to: [0, 1]
        }, authoritativeState);
        const committed = await broadcast;
        expect(committed.gameState).toEqual(authoritativeState);
        expect(committed.revision).toBeGreaterThan(0);
        expect(rooms.get(created.roomId)?.currentPlayer).toBe('player2');

        const disconnected = once<any>(player2, 'player-disconnected');
        await emitAck(player1, 'leave-room', { roomId: created.roomId });
        expect((await disconnected).message).toContain('房间已关闭');
        expect(rooms.has(created.roomId)).toBe(false);
    });

    it('布阵换位（移动/交换）更新服务器部署表，复用腾出格子后双方仍能进入战斗', async () => {
        const player1 = await connectClient();
        const player2 = await connectClient();
        const created = await emitAck<{ success: boolean; roomId: string }>(player1, 'create-room');
        await emitAck<any>(player1, 'join-room', { roomId: created.roomId, playerName: '甲' });
        await emitAck<any>(player2, 'join-room', { roomId: created.roomId, playerName: '乙' });

        const room = rooms.get(created.roomId)!;
        room.phase = 'deploy';
        room.heroSelections.player1 = ['moran', 'zhenxiao', 'baize', 'xuanxiao'];
        room.heroSelections.player2 = ['liuli', 'wukong', 'nightowl', 'changli'];

        const rejections: any[] = [];
        player1.on('action-rejected', event => rejections.push(event));
        player2.on('action-rejected', event => rejections.push(event));

        // 玩家一：部署 moran 到 (0,2) → 换位到 (0,0) → 让 zhenxiao 复用腾出的 (0,2)。
        // 服务器若不识别 reposition，(0,2) 仍被视为占用，deploy-hero 被误拒，
        // 部署数停在 3，confirm-deployment 永远“必须部署4位英雄”，对手卡死在布阵。
        action(player1, created.roomId, 'deploy-hero', { heroId: 'moran', position: [0, 2] });
        action(player1, created.roomId, 'reposition-deploy-hero', { heroId: 'moran', position: [0, 0] });
        action(player1, created.roomId, 'deploy-hero', { heroId: 'zhenxiao', position: [0, 2] });
        action(player1, created.roomId, 'deploy-hero', { heroId: 'baize', position: [2, 1] });
        action(player1, created.roomId, 'deploy-hero', { heroId: 'xuanxiao', position: [3, 1] });

        // 玩家二：部署后与己方英雄交换位置
        action(player2, created.roomId, 'deploy-hero', { heroId: 'liuli', position: [0, 3] });
        action(player2, created.roomId, 'deploy-hero', { heroId: 'wukong', position: [1, 4] });
        action(player2, created.roomId, 'deploy-hero', { heroId: 'nightowl', position: [2, 4] });
        action(player2, created.roomId, 'deploy-hero', { heroId: 'changli', position: [3, 4] });
        action(player2, created.roomId, 'reposition-deploy-hero', { heroId: 'liuli', position: [1, 4] });

        await new Promise(resolve => setTimeout(resolve, 80));
        expect(rejections).toEqual([]);
        expect(Object.fromEntries(room.deployments.player1)).toEqual({
            moran: '0,0', zhenxiao: '0,2', baize: '2,1', xuanxiao: '3,1'
        });
        expect(Object.fromEntries(room.deployments.player2)).toEqual({
            liuli: '1,4', wukong: '0,3', nightowl: '2,4', changli: '3,4'
        });

        // 换位消息必须转发给对端，否则对手布阵界面看到的是旧阵型
        const repositionSeen = once<any>(player1, 'action-broadcast');
        action(player2, created.roomId, 'reposition-deploy-hero', { heroId: 'nightowl', position: [2, 3] });
        const seen = await repositionSeen;
        expect(seen.action.type).toBe('reposition-deploy-hero');
        expect(seen.action.data.heroId).toBe('nightowl');

        // 确认部署：双方都应顺利进入战斗
        const p2Battle = once<any>(player2, 'action-broadcast');
        action(player1, created.roomId, 'confirm-deployment');
        action(player2, created.roomId, 'confirm-deployment');
        await p2Battle.catch(() => null);
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(rejections).toEqual([]);
        expect(room.phase).toBe('battle');

        await emitAck(player1, 'leave-room', { roomId: created.roomId });
        player1.disconnect();
        player2.disconnect();
    });

    it('撤下已部署英雄会释放格子并转发给对端，换人后仍能确认部署', async () => {
        const player1 = await connectClient();
        const player2 = await connectClient();
        const created = await emitAck<{ success: boolean; roomId: string }>(player1, 'create-room');
        await emitAck<any>(player1, 'join-room', { roomId: created.roomId, playerName: '甲' });
        await emitAck<any>(player2, 'join-room', { roomId: created.roomId, playerName: '乙' });

        const room = rooms.get(created.roomId)!;
        room.phase = 'deploy';
        room.heroSelections.player1 = ['moran', 'zhenxiao', 'baize', 'xuanxiao', 'liuli'];
        room.heroSelections.player2 = ['wukong', 'nightowl', 'changli', 'feixue'];

        const rejections: any[] = [];
        player1.on('action-rejected', event => rejections.push(event));

        action(player1, created.roomId, 'deploy-hero', { heroId: 'moran', position: [0, 0] });
        action(player1, created.roomId, 'deploy-hero', { heroId: 'zhenxiao', position: [1, 1] });
        action(player1, created.roomId, 'deploy-hero', { heroId: 'baize', position: [2, 2] });
        action(player1, created.roomId, 'deploy-hero', { heroId: 'xuanxiao', position: [3, 0] });

        // 撤下 moran 换第5名英雄顶上：服务器若不识别 undeploy，(0,0) 仍视为被 moran 占用，
        // 新英雄被误拒，玩家一改不了首发名单。
        await new Promise(resolve => setTimeout(resolve, 50));
        const undeploySeen = once<any>(player2, 'action-broadcast');
        action(player1, created.roomId, 'undeploy-hero', { heroId: 'moran' });
        const seen = await undeploySeen;
        expect(seen.action.type).toBe('undeploy-hero');
        expect(seen.action.data.heroId).toBe('moran');

        action(player1, created.roomId, 'deploy-hero', { heroId: 'liuli', position: [0, 0] });
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(rejections).toEqual([]);
        expect(Object.fromEntries(room.deployments.player1)).toEqual({
            liuli: '0,0', zhenxiao: '1,1', baize: '2,2', xuanxiao: '3,0'
        });

        // 撤下未部署过的英雄应被拒，避免把对端棋盘带偏
        const rejected = once<any>(player1, 'action-rejected');
        action(player1, created.roomId, 'undeploy-hero', { heroId: 'moran' });
        expect((await rejected).message).toContain('尚未部署');

        action(player2, created.roomId, 'deploy-hero', { heroId: 'wukong', position: [0, 3] });
        action(player2, created.roomId, 'deploy-hero', { heroId: 'nightowl', position: [1, 3] });
        action(player2, created.roomId, 'deploy-hero', { heroId: 'changli', position: [2, 3] });
        action(player2, created.roomId, 'deploy-hero', { heroId: 'feixue', position: [3, 3] });
        action(player1, created.roomId, 'confirm-deployment');
        action(player2, created.roomId, 'confirm-deployment');
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(room.phase).toBe('battle');

        await emitAck(player1, 'leave-room', { roomId: created.roomId });
        player1.disconnect();
        player2.disconnect();
    });

    it('战斗阶段把技能 action 与权威快照一并转发，供对端重建施法表现', async () => {
        const player1 = await connectClient();
        const player2 = await connectClient();
        const created = await emitAck<{ success: boolean; roomId: string }>(player1, 'create-room');
        await emitAck<any>(player1, 'join-room', { roomId: created.roomId, playerName: '甲' });
        await emitAck<any>(player2, 'join-room', { roomId: created.roomId, playerName: '乙' });

        const room = rooms.get(created.roomId)!;
        room.phase = 'battle';
        room.currentPlayer = 'player1';
        const emptyBoard = Array.from({ length: 6 }, () => Array(6).fill(null));

        // 对端收到快照只会直接落地、不重跑技能结算，
        // 因此音效与特效所需信息必须完整保留在转发的 action 里。
        const broadcast = once<any>(player2, 'action-broadcast');
        action(player1, created.roomId, 'skill', {
            heroId: 'moran-player1-1',
            skillId: 'moran_skill1',
            targetPos: [0, 1]
        }, { board: emptyBoard, phase: 'battle', currentPlayer: 'player2' });

        const received = await broadcast;
        expect(received.action.type).toBe('skill');
        expect(received.action.data.skillId).toBe('moran_skill1');
        expect(received.action.data.targetPos).toEqual([0, 1]);
        expect(received.gameState?.phase).toBe('battle');

        await emitAck(player1, 'leave-room', { roomId: created.roomId });
        player1.disconnect();
        player2.disconnect();
    });

    it('补员挂起期间接受补员方的 reinforce-deploy 与状态同步', async () => {
        const player1 = await connectClient();
        const player2 = await connectClient();

        const created = await emitAck<{ success: boolean; roomId: string }>(player1, 'create-room');
        await emitAck<any>(player1, 'join-room', { roomId: created.roomId, playerName: '甲' });
        const startForPlayer2 = once(player2, 'game-start');
        await emitAck<any>(player2, 'join-room', { roomId: created.roomId, playerName: '乙' });
        await startForPlayer2;

        const emptyBoard = Array.from({ length: 6 }, () => Array(6).fill(null));
        // 直接把房间推进到战斗阶段（player1 行动方）
        const room = rooms.get(created.roomId)!;
        room.phase = 'battle';
        room.currentPlayer = 'player1';
        room.gameState = { board: emptyBoard, phase: 'battle', currentPlayer: 'player1', reinforcingPlayer: null };

        // 玩家1（行动方）提交"击杀触发对方补员"的权威快照
        const pendingState = {
            board: emptyBoard,
            phase: 'battle',
            currentPlayer: 'player1',
            reinforcingPlayer: 'player2'
        };
        const reinforceBroadcast = once<any>(player2, 'action-broadcast');
        action(player1, created.roomId, 'end-turn', { heroId: 'moran-player1-1' }, pendingState);
        const pending = await reinforceBroadcast;
        expect(pending.gameState.reinforcingPlayer).toBe('player2');
        expect(room.gameState?.reinforcingPlayer).toBe('player2');

        // 修复前：reinforce-deploy 不在服务器白名单，会被 reject('未知操作类型') 并把补员方
        // 回滚到"等待补员"，形成无限补员死锁；修复后应接受补员方提交。
        const deployedState = {
            board: emptyBoard,
            phase: 'battle',
            currentPlayer: 'player2',
            reinforcingPlayer: null
        };
        const deployBroadcast = once<any>(player1, 'action-broadcast');
        action(player2, created.roomId, 'reinforce-deploy', { heroId: 'baize-player2-1', position: [0, 4] }, deployedState);
        const deployed = await deployBroadcast;
        expect(deployed.gameState).toEqual(deployedState);
        expect(room.currentPlayer).toBe('player2');
        expect(room.gameState?.reinforcingPlayer).toBeNull();

        // 非补员挂起时提交 reinforce-deploy 仍应被拒绝
        const rejected = once<any>(player2, 'action-rejected');
        action(player2, created.roomId, 'reinforce-deploy', { heroId: 'baize-player2-1', position: [1, 4] }, {
            board: emptyBoard,
            phase: 'battle',
            currentPlayer: 'player2',
            reinforcingPlayer: null
        });
        expect((await rejected).message).toBe('当前不是你的补员回合');

        // 补员挂起期间，补员方（非当前行动方）的 sync-game-state 也应被放行并广播
        room.gameState = { board: emptyBoard, phase: 'battle', currentPlayer: 'player1', reinforcingPlayer: 'player2' };
        room.currentPlayer = 'player1';
        const syncedState = {
            board: emptyBoard,
            phase: 'battle',
            currentPlayer: 'player1',
            reinforcingPlayer: 'player2',
            reinforcementSelectableHeroId: 'baize'
        };
        const syncBroadcast = once<any>(player1, 'game-state-update');
        player2.emit('sync-game-state', { roomId: created.roomId, gameState: syncedState });
        const synced = await syncBroadcast;
        expect(synced.gameState.reinforcementSelectableHeroId).toBe('baize');
        expect(synced.revision).toBeGreaterThan(0);

        await emitAck(player1, 'leave-room', { roomId: created.roomId });
        player1.disconnect();
        player2.disconnect();
    });

    it('让双方用相同四位数字自动创建并加入房间', async () => {
        const player1 = await connectClient();
        const player2 = await connectClient();
        player1.emit('register-player', { id: 'player-code-a', label: '棋友·CODE' });
        player2.emit('register-player', { id: 'player-code-b', label: '棋友·JOIN' });

        const entered1 = await emitAck<any>(player1, 'enter-code-room', {
            code: '2468',
            player: { id: 'player-code-a', label: '棋友·CODE' }
        });
        expect(entered1).toMatchObject({ success: true, roomId: 'ROOM-2468', playerNumber: 1 });

        const gameStart1 = once(player1, 'game-start');
        const gameStart2 = once(player2, 'game-start');
        const entered2 = await emitAck<any>(player2, 'enter-code-room', {
            code: '2468',
            player: { id: 'player-code-b', label: '棋友·JOIN' }
        });
        expect(entered2).toMatchObject({
            success: true,
            roomId: 'ROOM-2468',
            playerNumber: 2,
            opponent: { id: 'player-code-a', label: '棋友·CODE' }
        });
        const [started1, started2] = await Promise.all([gameStart1, gameStart2]);
        expect(started1.players.player2.id).toBe('player-code-b');
        expect(started2.players.player1.id).toBe('player-code-a');

        await emitAck(player1, 'leave-room', { roomId: 'ROOM-2468' });
        player1.disconnect();
        player2.disconnect();
    });

    it('支持在线玩家直接邀请并自动进入房间', async () => {
        const inviter = await connectClient();
        const recipient = await connectClient();
        inviter.emit('register-player', { id: 'player-invite-a', label: '棋友·甲方' });
        recipient.emit('register-player', { id: 'player-invite-b', label: '棋友·乙方' });
        await new Promise(resolve => setTimeout(resolve, 30));

        const incoming = once<any>(recipient, 'room-invite');
        const invitationResult = await emitAck<any>(inviter, 'invite-player', {
            targetPlayerId: 'player-invite-b'
        });
        expect(invitationResult.success).toBe(true);
        expect((await incoming).fromPlayer.id).toBe('player-invite-a');

        const acceptedByInviter = once<any>(inviter, 'invite-accepted');
        const acceptedByRecipient = once<any>(recipient, 'invite-accepted');
        recipient.emit('respond-invite', { fromPlayerId: 'player-invite-a', accepted: true });
        const [first, second] = await Promise.all([acceptedByInviter, acceptedByRecipient]);
        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(first.playerNumber).toBe(1);
        expect(second.playerNumber).toBe(2);
        expect(first.roomId).toMatch(/^ROOM-\d{4}$/);
        expect(second.roomId).toBe(first.roomId);

        await emitAck(inviter, 'leave-room', { roomId: first.roomId });
        inviter.disconnect();
        recipient.disconnect();
    });
});

/**
 * 掉线保留与重连回席。
 * 背景：一次 Wi-Fi 抖动或笔记本合盖就会让 socket.io 心跳超时，
 * 旧实现当场删房间，双方几十回合的对局直接没了。
 */
describe('联机掉线保留与重连回席', () => {
    const battleSnapshot = () => ({
        board: Array.from({ length: 6 }, () => Array(6).fill(null)),
        phase: 'battle',
        currentPlayer: 'player1',
        roundNumber: 3
    });

    async function openBattleRoom() {
        const player1 = await connectClient();
        const player2 = await connectClient();
        const created = await emitAck<{ success: boolean; roomId: string }>(player1, 'create-room');
        await emitAck<any>(player1, 'join-room', {
            roomId: created.roomId, playerName: '甲', playerId: 'player-drop-a'
        });
        await emitAck<any>(player2, 'join-room', {
            roomId: created.roomId, playerName: '乙', playerId: 'player-drop-b'
        });
        const room = rooms.get(created.roomId)!;
        // 直接推进到战斗阶段：这里验的是掉线保席，选将与布阵流程另有用例覆盖
        room.phase = 'battle';
        room.status = 'playing';
        room.gameState = battleSnapshot();
        return { roomId: created.roomId, player1, player2, room };
    }

    it('对局中掉线只挂席位，不删房间', async () => {
        const { roomId, player1, player2, room } = await openBattleRoom();

        const dropped = once<any>(player2, 'opponent-dropped');
        player1.disconnect();
        const payload = await dropped;

        expect(payload.droppedPlayerNumber).toBe(1);
        expect(payload.graceSeconds).toBeGreaterThan(0);
        expect(rooms.has(roomId)).toBe(true);
        expect(room.player1.socketId).toBeNull();
        expect(room.dropDeadlineAt).toBeGreaterThan(Date.now());

        player2.disconnect();
    });

    it('同一身份重连坐回原席位并拿回权威快照', async () => {
        const { roomId, player1, player2, room } = await openBattleRoom();
        player1.disconnect();
        await once(player2, 'opponent-dropped');
        await new Promise(resolve => setTimeout(resolve, 30));

        const returnee = await connectClient();
        const resume = once<any>(returnee, 'room-resume');
        const resumedNotice = once<any>(player2, 'opponent-resumed');
        const ack = await emitAck<any>(returnee, 'join-room', {
            roomId, playerName: '甲', playerId: 'player-drop-a'
        });

        const payload = await resume;
        expect(ack.success).toBe(true);
        expect(payload.playerNumber).toBe(1);
        expect(payload.gameState.roundNumber).toBe(3);
        expect(payload.opponentOffline).toBe(false);
        expect((await resumedNotice).resumedPlayerNumber).toBe(1);
        expect(room.player1.socketId).toBe(returnee.id);
        expect(room.dropDeadlineAt).toBeFalsy();

        returnee.disconnect();
        player2.disconnect();
    });

    it('别人的身份抢不到保留中的席位', async () => {
        const { player1, player2, roomId } = await openBattleRoom();
        player1.disconnect();
        await once(player2, 'opponent-dropped');
        await new Promise(resolve => setTimeout(resolve, 30));

        const stranger = await connectClient();
        const taken = await emitAck<any>(stranger, 'join-room', {
            roomId, playerName: '丙', playerId: 'player-stranger'
        });
        expect(taken.success).toBe(false);
        expect(taken.error).toBe('房间已满');

        stranger.disconnect();
        player2.disconnect();
    });

    it('超过宽限期仍未重连才关闭房间并通知在线方', async () => {
        const { roomId, player1, player2, room } = await openBattleRoom();
        player1.disconnect();
        await once(player2, 'opponent-dropped');
        await new Promise(resolve => setTimeout(resolve, 30));

        const closed = once<any>(player2, 'player-disconnected');
        room.dropDeadlineAt = Date.now() - 1;
        sweepExpiredReconnects();

        expect((await closed).message).toContain('离线超时');
        expect(rooms.has(roomId)).toBe(false);
        player2.disconnect();
    });
});
