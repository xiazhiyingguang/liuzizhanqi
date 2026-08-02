import { io, Socket } from 'socket.io-client';

// Socket.IO 客户端实例
let socket: Socket | null = null;
let connectedSocketUrl = '';

const defaultServerUrl = typeof window !== 'undefined'
    ? ['3000', '5173'].includes(window.location.port)
        ? `${window.location.protocol}//${window.location.hostname}:8787`
        : window.location.origin
    : 'http://localhost:8787';

let serverUrl: string = import.meta.env.VITE_SERVER_URL || defaultServerUrl;

export interface RoomJoinResponse {
    success: boolean;
    roomId?: string;
    playerNumber?: number;
    error?: string;
    gameState?: unknown;
    revision?: number;
    opponent?: LobbyPlayer;
}

export interface LobbyPlayer {
    id: string;
    label: string;
    status: 'idle' | 'room';
}

export interface PlayerIdentity {
    id: string;
    label: string;
}

export function setServerUrl(url: string) {
    const next = url.trim().replace(/\/$/, '');
    if (!next) return;
    serverUrl = next;
}

export function getServerUrl(): string {
    return serverUrl;
}

/**
 * 连接到服务器
 */
export function connectToServer(url?: string): Socket {
    if (url) {
        setServerUrl(url);
    }

    if (socket && connectedSocketUrl === serverUrl) {
        if (!socket.connected) socket.connect();
        return socket;
    }

    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
    }

    socket = io(serverUrl, {
        transports: ['websocket', 'polling'], // 优先使用 WebSocket
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
    });
    connectedSocketUrl = serverUrl;

    // 连接成功
    socket.on('connect', () => {
        console.log('[Socket.IO] 已连接到服务器:', socket?.id);
    });

    // 断线
    socket.on('disconnect', (reason) => {
        console.log('[Socket.IO] 已断线:', reason);
    });

    // 重连
    socket.io.on('reconnect', (attemptNumber) => {
        console.log('[Socket.IO] 重连成功，尝试次数:', attemptNumber);
    });

    // 连接错误
    socket.on('connect_error', (error) => {
        console.error('[Socket.IO] 连接错误:', error);
    });

    return socket;
}

/**
 * 获取当前 Socket 实例
 */
export function getSocket(): Socket | null {
    return socket;
}

/**
 * 断开连接
 */
export function disconnectFromServer() {
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
        connectedSocketUrl = '';
        console.log('[Socket.IO] 已主动断开连接');
    }
}

/**
 * 创建房间
 */
export function createRoom(): Promise<RoomJoinResponse> {
    return new Promise((resolve) => {
        const s = getSocket();
        if (!s || !s.connected) {
            resolve({ success: false, error: '未连接到服务器' });
            return;
        }

        s.timeout(6000).emit('create-room', (error: Error | null, response: RoomJoinResponse) => {
            resolve(error ? { success: false, error: '服务器响应超时' } : response);
        });
    });
}

/**
 * 加入房间
 */
export function joinRoom(
    roomId: string,
    playerName: string = '玩家'
): Promise<RoomJoinResponse> {
    return new Promise((resolve) => {
        const s = getSocket();
        if (!s || !s.connected) {
            resolve({ success: false, error: '未连接到服务器' });
            return;
        }

        s.timeout(6000).emit('join-room', { roomId, playerName }, (error: Error | null, response: RoomJoinResponse) => {
            resolve(error ? { success: false, error: '服务器响应超时' } : response);
        });
    });
}

/**
 * 用四位数字进入房间。房间不存在时自动创建，存在时自动作为玩家二加入。
 */
export function enterRoomCode(code: string, player: PlayerIdentity): Promise<RoomJoinResponse> {
    return new Promise((resolve) => {
        const s = getSocket();
        if (!s || !s.connected) {
            resolve({ success: false, error: '未连接到服务器' });
            return;
        }

        s.timeout(6000).emit('enter-code-room', { code, player }, (error: Error | null, response: RoomJoinResponse) => {
            resolve(error ? { success: false, error: '服务器响应超时' } : response);
        });
    });
}

export function registerLobbyPlayer(player: PlayerIdentity) {
    const s = getSocket();
    if (!s || !s.connected) return;
    s.emit('register-player', player);
}

export function inviteLobbyPlayer(targetPlayerId: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        const s = getSocket();
        if (!s || !s.connected) {
            resolve({ success: false, error: '未连接到服务器' });
            return;
        }
        s.timeout(5000).emit('invite-player', { targetPlayerId }, (error: Error | null, response: any) => {
            resolve(error ? { success: false, error: '邀请响应超时' } : response);
        });
    });
}

export function respondToLobbyInvite(fromPlayerId: string, accepted: boolean) {
    const s = getSocket();
    if (!s || !s.connected) return;
    s.emit('respond-invite', { fromPlayerId, accepted });
}

/**
 * 主动离开当前房间。等待中的房间会被关闭，对局中的对手会收到离开通知。
 */
export function leaveRoom(roomId: string): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
        const s = getSocket();
        if (!s || !s.connected) {
            resolve({ success: true });
            return;
        }

        s.timeout(3000).emit('leave-room', { roomId }, (error: Error | null, response?: { success: boolean }) => {
            resolve(error ? { success: false } : (response ?? { success: true }));
        });
    });
}

/**
 * 发送玩家操作
 */
export function sendPlayerAction(roomId: string, action: any, gameState?: any) {
    const s = getSocket();
    if (!s || !s.connected) {
        console.error('[Socket.IO] 无法发送操作: 未连接到服务器');
        return;
    }

    s.emit('player-action', { roomId, action, gameState });
}

/**
 * 同步游戏状态
 */
export function syncGameState(roomId: string, gameState: any) {
    const s = getSocket();
    if (!s || !s.connected) {
        console.error('[Socket.IO] 无法同步状态: 未连接到服务器');
        return;
    }

    s.emit('sync-game-state', { roomId, gameState });
}

/**
 * 监听事件
 */
export function onEvent(event: string, callback: (data: any) => void) {
    const s = getSocket();
    if (s) {
        s.on(event, callback);
    }
}

/**
 * 移除事件监听
 */
export function offEvent(event: string, callback?: (data: any) => void) {
    const s = getSocket();
    if (s) {
        if (callback) {
            s.off(event, callback);
        } else {
            s.off(event);
        }
    }
}
