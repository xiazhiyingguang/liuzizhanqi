import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import os from 'os';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

export const app = express();
export const httpServer = createServer(app);

app.use(cors());
app.use(express.json({ limit: '64kb' }));

export const io = new Server(httpServer, {
    cors: {
        origin: true,
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1024 * 1024,
    pingInterval: 10_000,
    pingTimeout: 15_000
});

// 房间数据只保存在主机内存中，适合局域网临时对局。
export const rooms = new Map();
const onlinePlayers = new Map();
const pendingInvites = new Map();

function generateRoomId() {
    let roomId;
    do {
        roomId = 'ROOM-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    } while (rooms.has(roomId));
    return roomId;
}

function createRoom(preferredRoomId) {
    const roomId = preferredRoomId || generateRoomId();
    if (rooms.has(roomId)) return null;
    rooms.set(roomId, {
        id: roomId,
        player1: null,
        player2: null,
        status: 'waiting',
        createdAt: Date.now(),
        lastActionAt: Date.now(),
        phase: 'waiting',
        selectingPlayer: 'player1',
        currentPlayer: 'player1',
        revision: 0,
        gameState: null,
        heroSelections: { player1: [], player2: [] },
        heroSelectReady: { player1: false, player2: false },
        deployments: { player1: new Map(), player2: new Map() },
        deployReady: { player1: false, player2: false }
    });
    console.log(`[房间创建] ${roomId}`);
    return roomId;
}

function generateNumericRoomId() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const roomId = `ROOM-${Math.floor(1000 + Math.random() * 9000)}`;
        if (!rooms.has(roomId)) return roomId;
    }
    return null;
}

function normalizeRoomId(value) {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizePlayerName(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const name = value.trim().slice(0, 10);
    return name || fallback;
}

function mapPlayerNumberToKey(playerNumber) {
    return playerNumber === 1 ? 'player1' : 'player2';
}

function getPlayerNumber(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    if (room.player1?.socketId === socketId) return 1;
    if (room.player2?.socketId === socketId) return 2;
    return null;
}

function isHeroOwnedByPlayerNumber(heroId, playerNumber) {
    const key = mapPlayerNumberToKey(playerNumber);
    if (typeof heroId !== 'string') return false;
    if (heroId.includes(`-${key}-`)) return true;

    if (heroId.startsWith('wukong-clone|') || heroId.startsWith('mirror-clone|')) {
        const ownerId = heroId.split('|')[1];
        return typeof ownerId === 'string' && ownerId.includes(`-${key}-`);
    }
    return false;
}

function isPlainGameState(value) {
    return Boolean(value && typeof value === 'object' && Array.isArray(value.board));
}

function updateRoomFromGameState(room, gameState) {
    room.gameState = gameState;
    if (gameState.currentPlayer === 'player1' || gameState.currentPlayer === 'player2') {
        room.currentPlayer = gameState.currentPlayer;
    }
    if (['battle', 'ended'].includes(gameState.phase)) {
        room.phase = gameState.phase;
        if (gameState.phase === 'ended') room.status = 'ended';
    }
}

function publicPlayer(player) {
    return player ? { id: player.playerId, label: player.name, status: 'room' } : null;
}

function listOnlinePlayers() {
    return [...onlinePlayers.values()].map(player => ({
        id: player.id,
        label: player.label,
        status: player.status
    }));
}

function broadcastPresence() {
    io.emit('presence-update', { players: listOnlinePlayers() });
}

function setPresenceStatus(socket, status) {
    const playerId = socket.data.playerId;
    if (!playerId) return;
    const entry = onlinePlayers.get(playerId);
    if (!entry) return;
    entry.status = status;
    entry.socketId = socket.id;
    broadcastPresence();
}

function joinRoom(roomIdValue, socket, playerNameValue, playerIdValue) {
    const roomId = normalizeRoomId(roomIdValue);
    const room = rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在或已关闭' };
    if (socket.data.roomId) return { success: false, error: '你已经在一个房间中' };
    if (room.status === 'ended') return { success: false, error: '房间已结束' };

    if (!room.player1) {
        room.player1 = {
            socketId: socket.id,
            name: normalizePlayerName(playerNameValue, '玩家1'),
            playerId: typeof playerIdValue === 'string' ? playerIdValue : socket.data.playerId || socket.id
        };
        socket.data.roomId = roomId;
        socket.join(roomId);
        setPresenceStatus(socket, 'room');
        console.log(`[玩家加入] ${room.player1.name} 作为玩家1加入房间 ${roomId}`);
        return { success: true, playerNumber: 1, room };
    }

    if (!room.player2) {
        room.player2 = {
            socketId: socket.id,
            name: normalizePlayerName(playerNameValue, '玩家2'),
            playerId: typeof playerIdValue === 'string' ? playerIdValue : socket.data.playerId || socket.id
        };
        socket.data.roomId = roomId;
        socket.join(roomId);
        setPresenceStatus(socket, 'room');
        room.status = 'playing';
        room.phase = 'hero-select';
        room.selectingPlayer = 'player1';
        room.currentPlayer = 'player1';
        room.lastActionAt = Date.now();
        console.log(`[玩家加入] ${room.player2.name} 作为玩家2加入房间 ${roomId}`);
        return { success: true, playerNumber: 2, room };
    }

    return { success: false, error: '房间已满' };
}

function leaveRoomForSocket(socket, message = '对手已离开，房间已关闭') {
    const roomId = socket.data.roomId;
    if (!roomId) return false;

    const room = rooms.get(roomId);
    socket.data.roomId = undefined;
    if (!room) return false;

    socket.to(roomId).emit('player-disconnected', { message });
    socket.leave(roomId);
    rooms.delete(roomId);
    setPresenceStatus(socket, 'idle');
    const opponentSocketId = room.player1?.socketId === socket.id
        ? room.player2?.socketId
        : room.player1?.socketId;
    if (opponentSocketId) {
        const opponentSocket = io.sockets.sockets.get(opponentSocketId);
        if (opponentSocket) {
            opponentSocket.data.roomId = undefined;
            setPresenceStatus(opponentSocket, 'idle');
        }
    }
    console.log(`[房间关闭] ${roomId}: ${message}`);
    return true;
}

function serializeRoom(room) {
    return {
        id: room.id,
        status: room.status,
        phase: room.phase,
        selectingPlayer: room.selectingPlayer,
        currentPlayer: room.currentPlayer,
        revision: room.revision
    };
}

function emitGameStart(room) {
    io.to(room.id).emit('game-start', {
        player1: room.player1.name,
        player2: room.player2.name,
        players: {
            player1: publicPlayer(room.player1),
            player2: publicPlayer(room.player2)
        },
        phase: room.phase
    });
    console.log(`[游戏开始] 房间 ${room.id} 双方玩家已到齐`);
}

io.on('connection', (socket) => {
    console.log(`[连接] 客户端已连接: ${socket.id}`);

    socket.on('register-player', ({ id, label } = {}) => {
        if (typeof id !== 'string' || !id.startsWith('player-') || id.length > 64) return;
        const normalizedLabel = normalizePlayerName(label, `棋友·${id.slice(-4).toUpperCase()}`);
        const previous = onlinePlayers.get(id);
        if (previous && previous.socketId !== socket.id) {
            const previousSocket = io.sockets.sockets.get(previous.socketId);
            previousSocket?.disconnect(true);
        }
        socket.data.playerId = id;
        onlinePlayers.set(id, {
            id,
            label: normalizedLabel,
            socketId: socket.id,
            status: socket.data.roomId ? 'room' : 'idle'
        });
        broadcastPresence();
    });

    socket.on('create-room', (callback) => {
        if (socket.data.roomId) {
            callback?.({ success: false, error: '请先离开当前房间' });
            return;
        }
        callback?.({ success: true, roomId: createRoom() });
    });

    socket.on('join-room', ({ roomId, playerName } = {}, callback) => {
        const result = joinRoom(roomId, socket, playerName, socket.data.playerId);
        if (!result.success) {
            callback?.({ success: false, error: result.error });
            return;
        }

        const normalizedRoomId = result.room.id;
        callback?.({
            success: true,
            roomId: normalizedRoomId,
            playerNumber: result.playerNumber,
            room: serializeRoom(result.room),
            gameState: result.room.gameState,
            revision: result.room.revision,
            opponent: result.playerNumber === 2 ? publicPlayer(result.room.player1) : undefined
        });

        if (result.playerNumber === 2) {
            emitGameStart(result.room);
        }
    });

    socket.on('enter-code-room', ({ code, player } = {}, callback) => {
        const normalizedCode = typeof code === 'string' ? code.replace(/\D/g, '').slice(0, 4) : '';
        if (!/^\d{4}$/.test(normalizedCode)) {
            callback?.({ success: false, error: '请输入四位数字' });
            return;
        }
        if (socket.data.roomId) {
            callback?.({ success: false, error: '你已经在一个房间中' });
            return;
        }

        if (player?.id && player?.label && !socket.data.playerId) {
            socket.data.playerId = player.id;
            onlinePlayers.set(player.id, {
                id: player.id,
                label: normalizePlayerName(player.label, `棋友·${String(player.id).slice(-4)}`),
                socketId: socket.id,
                status: 'idle'
            });
        }

        const roomId = `ROOM-${normalizedCode}`;
        if (!rooms.has(roomId)) createRoom(roomId);
        const result = joinRoom(roomId, socket, player?.label, player?.id);
        if (!result.success) {
            callback?.({ success: false, error: result.error });
            return;
        }

        callback?.({
            success: true,
            roomId,
            playerNumber: result.playerNumber,
            gameState: result.room.gameState,
            revision: result.room.revision,
            opponent: result.playerNumber === 2 ? publicPlayer(result.room.player1) : undefined
        });
        if (result.playerNumber === 2) emitGameStart(result.room);
    });

    socket.on('invite-player', ({ targetPlayerId } = {}, callback) => {
        const fromPlayerId = socket.data.playerId;
        const from = fromPlayerId ? onlinePlayers.get(fromPlayerId) : null;
        const target = typeof targetPlayerId === 'string' ? onlinePlayers.get(targetPlayerId) : null;
        if (!from) return callback?.({ success: false, error: '玩家身份未登记' });
        if (!target || target.status !== 'idle') return callback?.({ success: false, error: '对方当前不可邀请' });
        if (target.id === from.id) return callback?.({ success: false, error: '不能邀请自己' });
        if (from.status !== 'idle') return callback?.({ success: false, error: '请先离开当前房间' });

        pendingInvites.set(`${target.id}:${from.id}`, Date.now() + 30_000);
        io.to(target.socketId).emit('room-invite', {
            fromPlayer: { id: from.id, label: from.label, status: from.status }
        });
        callback?.({ success: true });
    });

    socket.on('respond-invite', ({ fromPlayerId, accepted } = {}) => {
        const targetPlayerId = socket.data.playerId;
        if (!targetPlayerId || typeof fromPlayerId !== 'string') return;
        const inviteKey = `${targetPlayerId}:${fromPlayerId}`;
        const expiresAt = pendingInvites.get(inviteKey);
        pendingInvites.delete(inviteKey);
        const from = onlinePlayers.get(fromPlayerId);
        const target = onlinePlayers.get(targetPlayerId);
        if (!expiresAt || expiresAt < Date.now() || !from || !target) return;

        if (!accepted) {
            io.to(from.socketId).emit('invite-declined', { player: { id: target.id, label: target.label } });
            return;
        }
        if (from.status !== 'idle' || target.status !== 'idle') return;

        const inviterSocket = io.sockets.sockets.get(from.socketId);
        const targetSocket = io.sockets.sockets.get(target.socketId);
        const roomId = generateNumericRoomId();
        if (!inviterSocket || !targetSocket || !roomId) return;
        createRoom(roomId);
        const first = joinRoom(roomId, inviterSocket, from.label, from.id);
        const second = joinRoom(roomId, targetSocket, target.label, target.id);
        if (!first.success || !second.success) return;

        inviterSocket.emit('invite-accepted', {
            success: true,
            roomId,
            playerNumber: 1,
            opponent: { id: target.id, label: target.label, status: 'room' }
        });
        targetSocket.emit('invite-accepted', {
            success: true,
            roomId,
            playerNumber: 2,
            opponent: { id: from.id, label: from.label, status: 'room' }
        });
        emitGameStart(rooms.get(roomId));
    });

    socket.on('leave-room', ({ roomId } = {}, callback) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (normalizedRoomId && socket.data.roomId === normalizedRoomId) {
            leaveRoomForSocket(socket);
        }
        callback?.({ success: true });
    });

    socket.on('player-action', ({ roomId: roomIdValue, action, gameState } = {}) => {
        const roomId = normalizeRoomId(roomIdValue);
        const room = rooms.get(roomId);
        const playerNumber = getPlayerNumber(roomId, socket.id);

        const reject = (message) => {
            socket.emit('action-rejected', {
                message,
                room: room ? serializeRoom(room) : null,
                gameState: room?.gameState ?? null,
                revision: room?.revision ?? 0
            });
        };

        if (!room) return reject('房间不存在或已关闭');
        if (!playerNumber || socket.data.roomId !== roomId) return reject('你不在这个房间中');
        if (!action || typeof action.type !== 'string') return reject('非法操作');

        const playerKey = mapPlayerNumberToKey(playerNumber);
        room.lastActionAt = Date.now();

        const acceptAndBroadcast = (authoritativeState) => {
            if (authoritativeState) updateRoomFromGameState(room, authoritativeState);
            room.revision += 1;
            socket.to(roomId).emit('action-broadcast', {
                playerNumber,
                action,
                gameState: authoritativeState,
                revision: room.revision
            });
            socket.emit('action-accepted', { revision: room.revision });
            console.log(`[玩家操作] ${roomId} 玩家${playerNumber}: ${action.type} #${room.revision}`);
        };

        if (action.type === 'select-hero') {
            if (room.phase !== 'hero-select') return reject('当前不在英雄选择阶段');
            if (room.heroSelectReady[playerKey]) return reject('你已经确认了英雄选择');
            const heroId = action.data?.heroId;
            if (typeof heroId !== 'string' || heroId.length > 80) return reject('英雄数据无效');
            const selected = room.heroSelections[playerKey];
            const index = selected.indexOf(heroId);
            if (index >= 0) selected.splice(index, 1);
            else if (selected.length < 4) selected.push(heroId);
            else return reject('最多选择4位英雄');
            return acceptAndBroadcast();
        }

        if (action.type === 'confirm-hero-selection') {
            if (room.phase !== 'hero-select') return reject('当前不在英雄选择阶段');
            if (room.heroSelectReady[playerKey]) return reject('你已经确认了英雄选择');
            if (room.heroSelections[playerKey].length !== 4) return reject('必须选择4位英雄');
            room.heroSelectReady[playerKey] = true;
            if (room.heroSelectReady.player1 && room.heroSelectReady.player2) {
                room.phase = 'deploy';
                room.selectingPlayer = 'player1';
                room.deployReady = { player1: false, player2: false };
                room.deployments = { player1: new Map(), player2: new Map() };
            }
            return acceptAndBroadcast();
        }

        if (action.type === 'deploy-hero') {
            if (room.phase !== 'deploy') return reject('当前不在部署阶段');
            if (room.deployReady[playerKey]) return reject('你已经确认了部署');
            const heroId = action.data?.heroId;
            const position = action.data?.position;
            if (!room.heroSelections[playerKey].includes(heroId)) return reject('只能部署已选择的英雄');
            if (!Array.isArray(position) || position.length !== 2) return reject('部署位置无效');
            const [row, col] = position;
            if (![row, col].every(Number.isInteger) || row < 0 || row > 5 || col < 0 || col > 5) {
                return reject('部署位置无效');
            }
            if ((playerKey === 'player1' && col >= 3) || (playerKey === 'player2' && col < 3)) {
                return reject('不能部署到对方区域');
            }
            if (room.deployments[playerKey].has(heroId)) return reject('该英雄已经部署');
            const cellKey = `${row},${col}`;
            const occupied = [...room.deployments.player1.values(), ...room.deployments.player2.values()];
            if (occupied.includes(cellKey)) return reject('该位置已有单位');
            room.deployments[playerKey].set(heroId, cellKey);
            return acceptAndBroadcast();
        }

        if (action.type === 'confirm-deployment') {
            if (room.phase !== 'deploy') return reject('当前不在部署阶段');
            if (room.deployReady[playerKey]) return reject('你已经确认了部署');
            if (room.deployments[playerKey].size !== 4) return reject('必须部署4位英雄');
            room.deployReady[playerKey] = true;
            const battleReady = room.deployReady.player1 && room.deployReady.player2;
            if (battleReady) {
                room.phase = 'battle';
                room.currentPlayer = 'player1';
            }
            acceptAndBroadcast(battleReady && isPlainGameState(gameState) ? gameState : undefined);
            if (battleReady && !room.gameState && room.player1) {
                io.to(room.player1.socketId).emit('request-game-state');
            }
            return;
        }

        if (['move', 'skill', 'end-turn'].includes(action.type)) {
            if (room.phase !== 'battle') return reject('当前不在战斗阶段');
            if (room.currentPlayer !== playerKey) return reject('当前不是你的回合');
            if (!isPlainGameState(gameState)) return reject('缺少有效的战斗状态');

            const meta = action.meta || {};
            if (meta.beforePlayer && meta.beforePlayer !== room.currentPlayer) {
                return reject('回合同步异常，请稍候重试');
            }

            const heroId = action.data?.heroId;
            if (heroId && !isHeroOwnedByPlayerNumber(heroId, playerNumber)) {
                return reject('你不能操作对方的单位');
            }
            return acceptAndBroadcast(gameState);
        }

        return reject('未知操作类型');
    });

    socket.on('sync-game-state', ({ roomId: roomIdValue, gameState } = {}) => {
        const roomId = normalizeRoomId(roomIdValue);
        const room = rooms.get(roomId);
        const playerNumber = getPlayerNumber(roomId, socket.id);
        if (!room || !playerNumber || !isPlainGameState(gameState)) return;
        if (!['battle', 'ended'].includes(room.phase)) return;

        const playerKey = mapPlayerNumberToKey(playerNumber);
        if (room.phase === 'battle' && room.currentPlayer !== playerKey) return;

        updateRoomFromGameState(room, gameState);
        room.lastActionAt = Date.now();
        room.revision += 1;
        socket.to(roomId).emit('game-state-update', {
            playerNumber,
            gameState,
            revision: room.revision
        });
        socket.emit('state-accepted', { revision: room.revision });
    });

    socket.on('disconnecting', () => {
        leaveRoomForSocket(socket, '对手连接已断开，房间已关闭');
        const playerId = socket.data.playerId;
        if (playerId && onlinePlayers.get(playerId)?.socketId === socket.id) {
            onlinePlayers.delete(playerId);
            for (const key of pendingInvites.keys()) {
                if (key.startsWith(`${playerId}:`) || key.endsWith(`:${playerId}`)) pendingInvites.delete(key);
            }
            broadcastPresence();
        }
    });

    socket.on('disconnect', () => {
        console.log(`[断线] 客户端已断线: ${socket.id}`);
    });
});

app.get('/api/health', (_req, res) => {
    res.json({
        message: '六子战棋局域网服务器',
        version: '2.0.0',
        activeRooms: rooms.size
    });
});

app.get(['/api/rooms', '/rooms'], (_req, res) => {
    const roomList = Array.from(rooms.values()).map(room => ({
        ...serializeRoom(room),
        players: {
            player1: room.player1?.name || null,
            player2: room.player2?.name || null
        },
        createdAt: room.createdAt
    }));
    res.json({ rooms: roomList });
});

if (existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
    app.get('/', (_req, res) => {
        res.status(503).json({
            message: '前端尚未构建，请在项目根目录运行 npm run lan'
        });
    });
}

function getLanAddresses() {
    const addresses = [];
    for (const [adapter, list] of Object.entries(os.networkInterfaces())) {
        for (const info of list || []) {
            if (info?.family !== 'IPv4' || info.internal || info.address.startsWith('169.254.')) continue;
            addresses.push({
                address: info.address,
                adapter,
                virtual: /virtual|vmware|vbox|vethernet|hyper-v|wsl|docker/i.test(adapter)
            });
        }
    }
    const unique = [...new Map(addresses.map(item => [item.address, item])).values()];
    return unique.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

export function startServer(port = Number(process.env.PORT || 8787), host = process.env.HOST || '0.0.0.0') {
    return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
            httpServer.off('error', reject);
            const actualPort = httpServer.address()?.port ?? port;
            console.log('\n========================================');
            console.log('六子战棋局域网联机已启动');
            console.log(`本机访问: http://127.0.0.1:${actualPort}`);
            for (const item of getLanAddresses()) {
                const suffix = item.virtual ? '，可能是虚拟网卡' : '';
                console.log(`局域网访问 (${item.adapter}${suffix}): http://${item.address}:${actualPort}`);
            }
            console.log('========================================\n');
            resolve({ port: actualPort, host });
        });
    });
}

export function stopServer() {
    return new Promise((resolve) => {
        io.disconnectSockets(true);
        io.close(() => resolve());
    });
}

const cleanupTimer = setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    for (const [roomId, room] of rooms.entries()) {
        if (now - room.lastActionAt > oneHour) {
            io.to(roomId).emit('player-disconnected', { message: '房间长时间无操作，已自动关闭' });
            rooms.delete(roomId);
        }
    }
}, 10 * 60 * 1000);
cleanupTimer.unref();

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
    startServer().catch((error) => {
        console.error('联机服务器启动失败:', error);
        process.exitCode = 1;
    });
}
