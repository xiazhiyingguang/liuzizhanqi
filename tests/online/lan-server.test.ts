import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
// The LAN server intentionally stays as plain ESM JavaScript so it can run without a build step.
// @ts-expect-error JavaScript server module has no declaration file.
import { rooms, startServer, stopServer } from '../../server/server.js';

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
