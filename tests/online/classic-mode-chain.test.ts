import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
// @ts-expect-error JavaScript server module has no declaration file.
import { rooms, startServer, stopServer } from '../../server/server.js';
import { useGameStore } from '../../src/store/game-store';

let url = '';
const clients: Socket[] = [];

function connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket = createClient(url, { transports: ['websocket'], reconnection: false, forceNew: true });
        clients.push(socket);
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

function ack<T = any>(socket: Socket, event: string, payload?: any): Promise<T> {
    return new Promise((resolve) => {
        if (payload === undefined) socket.emit(event, resolve);
        else socket.emit(event, payload, resolve);
    });
}

function action(socket: Socket, roomId: string, type: string, data: any = {}, gameState?: any) {
    socket.emit('player-action', { roomId, action: { type, data }, gameState });
}

/** 等服务器把这条房间的 phase 推到目标值，顺带收集所有拒绝原因 */
async function waitForPhase(roomId: string, phase: string, rejects: string[]) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        // @ts-expect-error JS server without types
        if (rooms.get(roomId)?.phase === phase) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    // @ts-expect-error JS server without types
    throw new Error(`房间 ${roomId} 停在 ${rooms.get(roomId)?.phase}，期望 ${phase}；拒绝记录：${rejects.join(' | ') || '无'}`);
}

function collectRejections(socket: Socket, sink: string[]) {
    socket.on('action-rejected', ({ message }: { message: string }) => sink.push(message));
}

const TEAM_HOST = ['moran', 'zhenxiao', 'huifeng', 'baize', 'liuli', 'changli'];
const TEAM_GUEST = ['dilan', 'nanfeng', 'yunying', 'zhiguang', 'shangguan', 'lingxi'];

beforeAll(async () => {
    const info = await startServer(0, '127.0.0.1') as { port: number };
    url = `http://127.0.0.1:${info.port}`;
});

afterAll(async () => {
    for (const socket of clients) socket.disconnect();
    rooms.clear();
    await stopServer();
});

describe('经典模式联机阶段链', () => {
    it('客机菜单模式与房主不同时以房间为准，武装到战斗一路不卡', async () => {
        const host = await connect();
        const guest = await connect();
        const rejects: string[] = [];
        collectRejections(host, rejects);
        collectRejections(guest, rejects);

        // 真实进房路径：双方都输入同一个四位数字，先进入的人建房
        const created = await ack<any>(host, 'enter-code-room', {
            code: '4821',
            player: { id: 'player-classic-host', label: '经典房主' },
            gameMode: 'classic',
        });
        expect(created.success).toBe(true);
        const roomId = created.roomId as string;

        const joined = await ack<any>(guest, 'enter-code-room', {
            code: '4821',
            player: { id: 'player-classic-guest', label: '标准客机' },
            gameMode: 'standard',
        });
        expect(joined.success).toBe(true);
        // 这条回包缺 gameMode 时，客机沿用自己菜单里的 standard：一端进武装、一端进布阵，
        // 服务端等不齐两次武装确认，房间就永久停在 weapon-select
        expect(joined.gameMode).toBe('classic');
        expect(joined.room?.gameMode).toBe('classic');

        for (const heroId of TEAM_HOST) action(host, roomId, 'select-hero', { heroId });
        for (const heroId of TEAM_GUEST) action(guest, roomId, 'select-hero', { heroId });
        action(host, roomId, 'confirm-hero-selection');
        action(guest, roomId, 'confirm-hero-selection');
        await waitForPhase(roomId, 'weapon-select', rejects);

        action(host, roomId, 'toggle-weapon', { heroId: TEAM_HOST[0] });
        action(guest, roomId, 'toggle-weapon', { heroId: TEAM_GUEST[0] });
        action(guest, roomId, 'confirm-weapon-selection');
        action(host, roomId, 'confirm-weapon-selection');
        await waitForPhase(roomId, 'deploy', rejects);

        for (let index = 0; index < 4; index += 1) {
            action(host, roomId, 'deploy-hero', { heroId: TEAM_HOST[index], position: [index, 0] });
            action(guest, roomId, 'deploy-hero', { heroId: TEAM_GUEST[index], position: [index, 5] });
        }
        const battleState = { phase: 'battle', currentPlayer: 'player1', board: Array.from({ length: 6 }, () => Array(6).fill(null)) };
        action(host, roomId, 'confirm-deployment', {}, battleState);
        action(guest, roomId, 'confirm-deployment', {}, battleState);
        await waitForPhase(roomId, 'battle', rejects);

        expect(rejects, '经典模式联机不应有任何被拒操作').toEqual([]);
    });

    it('邀请建房沿用邀请人的模式，双方回包都带房间模式', async () => {
        const inviter = await connect();
        const recipient = await connect();
        // register-player 是单向事件，服务端不回 ack
        inviter.emit('register-player', { id: 'player-invite-classic', label: '邀请人' });
        recipient.emit('register-player', { id: 'player-invited-standard', label: '受邀人' });
        await new Promise(resolve => setTimeout(resolve, 60));

        const incoming = new Promise<any>(resolve => recipient.once('room-invite', resolve));
        await ack<any>(inviter, 'invite-player', {
            targetPlayerId: 'player-invited-standard',
            gameMode: 'classic',
        });
        expect((await incoming).fromPlayer.id).toBe('player-invite-classic');

        const acceptedByInviter = new Promise<any>(resolve => inviter.once('invite-accepted', resolve));
        const acceptedByRecipient = new Promise<any>(resolve => recipient.once('invite-accepted', resolve));
        recipient.emit('respond-invite', { fromPlayerId: 'player-invite-classic', accepted: true });

        const first = await acceptedByInviter;
        const second = await acceptedByRecipient;
        // 受邀人自己菜单里选的标准局不能作数，否则两端阶段链分叉
        expect(first.gameMode).toBe('classic');
        expect(second.gameMode).toBe('classic');
        // @ts-expect-error JS server without types
        expect(rooms.get(first.roomId)?.gameMode).toBe('classic');

        await ack(inviter, 'leave-room', { roomId: first.roomId });
        inviter.disconnect();
        recipient.disconnect();
    });
});

describe('经典模式联机两端 store 流转', () => {
    it('客机以房间模式确认后本地进入武装，双方都确认才进布阵', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            isOnlineMode: true,
            onlineRoomId: 'ROOM-4821',
            localPlayerNumber: 2,
            // 客机菜单原本是标准局，进房时被房间模式覆盖成经典
            gameMode: 'classic',
            phase: 'hero-select',
            player1SelectedHeroIds: TEAM_HOST,
            player2SelectedHeroIds: TEAM_GUEST,
            player1ReadyHeroSelect: false,
            player2ReadyHeroSelect: false
        });

        // 对端先确认：本端仍停在选将，等自己也确认
        useGameStore.getState().confirmHeroSelectionForPlayer('player1');
        expect(useGameStore.getState().phase).toBe('hero-select');

        useGameStore.getState().confirmHeroSelection();
        expect(useGameStore.getState().phase).toBe('weapon-select');

        // 本端确认只置自己的就绪位，必须等对端的 confirm-weapon-selection 广播
        useGameStore.getState().toggleWeapon('dilan');
        useGameStore.getState().confirmWeaponSelection();
        expect(useGameStore.getState().phase).toBe('weapon-select');
        expect(useGameStore.getState().player2ReadyWeaponSelect).toBe(true);

        useGameStore.getState().confirmWeaponSelectionForPlayer('player1');
        expect(useGameStore.getState().phase).toBe('deploy');

        useGameStore.setState({ isOnlineMode: false, onlineRoomId: undefined, localPlayerNumber: undefined });
        useGameStore.getState().resetGame();
    });
});
