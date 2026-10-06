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
    // 心跳留足余量：笔记本合盖、Wi-Fi 抖动、浏览器后台标签节流都会让 pong 迟几秒，
    // 原来的 10s/15s 会把这种瞬时卡顿误判成退线，直接把对局删掉。
    pingInterval: 25_000,
    pingTimeout: 60_000
});

// 掉线后保留房间与席位的分（socket 瞬时断开与真正的离开是两件事）
const RECONNECT_GRACE_MS = 120_000;

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

function createRoom(preferredRoomId, gameMode) {
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
        dropDeadlineAt: null,
        heroSelections: { player1: [], player2: [] },
        heroSelectReady: { player1: false, player2: false },
        // 经典模式才有武装步骤：模板 id → 武器 id（一器一主，值等于键即启用）
        // 模式由建房者定，双方进的是同一种局
        gameMode: gameMode === 'classic' ? 'classic' : 'standard',
        weaponSelections: { player1: {}, player2: {} },
        weaponReady: { player1: false, player2: false },
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

/**
 * 席位认领：同一 playerId 的连接回来了，且那个席位不再被活连接占据。
 * 抢座的前提是"原连接已经死了"，否则同一人开两个标签也抢不走对手的位子。
 */
function findReclaimableSeat(room, playerId) {
    if (!playerId) return null;
    for (const seatKey of ['player1', 'player2']) {
        const seat = room[seatKey];
        if (!seat || seat.playerId !== playerId) continue;
        if (liveSocketOfSeat(seat)) continue;
        return seatKey;
    }
    return null;
}

/** 重连回来要能重建局面：战斗阶段有权威快照，选将/布阵阶段则回放名单与格子 */
function buildResumePayload(room) {
    return {
        roomId: room.id,
        phase: room.phase,
        status: room.status,
        selectingPlayer: room.selectingPlayer,
        currentPlayer: room.currentPlayer,
        revision: room.revision,
        heroSelections: {
            player1: [...room.heroSelections.player1],
            player2: [...room.heroSelections.player2]
        },
        heroSelectReady: { ...room.heroSelectReady },
        gameMode: room.gameMode,
        weaponSelections: {
            player1: { ...room.weaponSelections.player1 },
            player2: { ...room.weaponSelections.player2 }
        },
        weaponReady: { ...room.weaponReady },
        deployments: {
            player1: [...room.deployments.player1.entries()],
            player2: [...room.deployments.player2.entries()]
        },
        deployReady: { ...room.deployReady },
        gameState: room.gameState ?? null
    };
}

function resumeSeat(room, seatKey, socket, playerNameValue) {
    const seat = room[seatKey];
    seat.socketId = socket.id;
    seat.name = normalizePlayerName(playerNameValue, seat.name);
    delete seat.disconnectedAt;
    if (!room.player1.disconnectedAt && !room.player2.disconnectedAt) delete room.dropDeadlineAt;
    socket.data.roomId = room.id;
    socket.join(room.id);
    setPresenceStatus(socket, 'room');
    const playerNumber = seatKey === 'player1' ? 1 : 2;
    const opponentSeat = room[otherSeatKey(seatKey)];
    socket.emit('room-resume', {
        ...buildResumePayload(room),
        playerNumber,
        // 两边都掉线过时要让重连的一方知道"对面还不在"，否则界面会显示成一切正常
        opponentOffline: Boolean(opponentSeat?.disconnectedAt)
    });
    liveSocketOfSeat(room[otherSeatKey(seatKey)])?.emit('opponent-resumed', {
        resumedPlayerNumber: playerNumber,
        message: '对手已重连回房间，对局继续'
    });
    console.log(`[席位重连] ${room.id}: 玩家${playerNumber} 重连回原席位`);
    return { success: true, playerNumber, room, resumed: true };
}

function joinRoom(roomIdValue, socket, playerNameValue, playerIdValue) {
    const roomId = normalizeRoomId(roomIdValue);
    const room = rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在或已关闭' };
    if (socket.data.roomId) return { success: false, error: '你已经在一个房间中' };
    if (room.status === 'ended') return { success: false, error: '房间已结束' };

    const claimed = findReclaimableSeat(room, typeof playerIdValue === 'string' ? playerIdValue : socket.data.playerId);
    if (claimed) return resumeSeat(room, claimed, socket, playerNameValue);

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

function seatOfSocket(room, socketId) {
    if (room.player1?.socketId === socketId) return 'player1';
    if (room.player2?.socketId === socketId) return 'player2';
    return null;
}

function otherSeatKey(seatKey) {
    return seatKey === 'player1' ? 'player2' : 'player1';
}

function liveSocketOfSeat(seat) {
    return seat?.socketId ? io.sockets.sockets.get(seat.socketId) ?? null : null;
}

/** 只有已经开局（选将及之后）才有值得抢救的对局；纯等待中的房间照旧直接关闭 */
function isMatchUnderway(room) {
    return room.status === 'playing'
        || ['hero-select', 'weapon-select', 'deploy', 'battle'].includes(room.phase);
}

/**
 * 掉线保留：对局中某个席位连接中断时不删房间，只把席位挂成"等待重连"。
 * 宽限期内同一 playerId 重新 join 同一 roomId 就能坐回原来的位子并拿到快照。
 */
function holdRoomForReconnect(room, seatKey) {
    const seat = room[seatKey];
    seat.socketId = null;
    seat.disconnectedAt = Date.now();
    room.dropDeadlineAt = Date.now() + RECONNECT_GRACE_MS;
    const remaining = liveSocketOfSeat(room[otherSeatKey(seatKey)]);
    remaining?.emit('opponent-dropped', {
        droppedPlayerNumber: seatKey === 'player1' ? 1 : 2,
        graceSeconds: Math.round(RECONNECT_GRACE_MS / 1000),
        message: `对手连接中断，房间为你保留 ${Math.round(RECONNECT_GRACE_MS / 1000)} 秒，等待重连`
    });
    console.log(`[掉线保留] ${room.id}: 玩家${seatKey === 'player1' ? 1 : 2} 连接中断，保留席位等待重连`);
    return true;
}

function leaveRoomForSocket(socket, message = '对手已离开，房间已关闭', options = {}) {
    const roomId = socket.data.roomId;
    if (!roomId) return false;

    const room = rooms.get(roomId);
    socket.data.roomId = undefined;
    if (!room) return false;

    if (options.grace) {
        const seatKey = seatOfSocket(room, socket.id);
        if (seatKey && isMatchUnderway(room) && room.phase !== 'ended') {
            socket.leave(roomId);
            holdRoomForReconnect(room, seatKey);
            return 'held';
        }
    }

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
        revision: room.revision,
        // 客机要按房主选的模式走同一条阶段链，否则本地推演会和服务端错位
        gameMode: room.gameMode
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

    socket.on('create-room', (payloadOrCallback, maybeCallback) => {
        // 兼容两种调用：老前端只传回调，新前端传 { gameMode } + 回调
        const payload = typeof payloadOrCallback === 'function' ? null : payloadOrCallback;
        const callback = typeof payloadOrCallback === 'function' ? payloadOrCallback : maybeCallback;
        if (socket.data.roomId) {
            callback?.({ success: false, error: '请先离开当前房间' });
            return;
        }
        const roomId = createRoom(null, payload?.gameMode);
        callback?.({
            success: true,
            roomId,
            // 回包里必须带房间模式：客户端菜单选的模式只在建房时生效，之后一律以房间为准
            gameMode: rooms.get(roomId)?.gameMode ?? 'standard'
        });
    });

    socket.on('join-room', ({ roomId, playerName, playerId } = {}, callback) => {
        // 重连后的是一条全新连接，没有 register-player 也拿不到 socket.data.playerId，
        // 所以允许在 join 时带上身份，用于认领自己那个"掉线保留中"的席位。
        // 只在原席位已无活连接时才生效，抢不到对手或活人的位子（局域网内的信任模型）。
        if (typeof playerId === 'string' && playerId.startsWith('player-') && playerId.length <= 64) {
            socket.data.playerId = playerId;
        }
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
            gameMode: result.room.gameMode,
            gameState: result.room.gameState,
            revision: result.room.revision,
            resumed: result.resumed === true,
            // 刷新页面后重新输入房间码也是同一条回席路径，把重建所需的东西一并带回
            resume: result.resumed ? buildResumePayload(result.room) : undefined,
            opponent: result.playerNumber === 2 ? publicPlayer(result.room.player1) : undefined
        });

        if (result.playerNumber === 2) {
            emitGameStart(result.room);
        }
    });

    socket.on('enter-code-room', ({ code, player, gameMode } = {}, callback) => {
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
        if (!rooms.has(roomId)) createRoom(roomId, gameMode);
        const result = joinRoom(roomId, socket, player?.label, player?.id);
        if (!result.success) {
            callback?.({ success: false, error: result.error });
            return;
        }

        callback?.({
            success: true,
            roomId,
            playerNumber: result.playerNumber,
            room: serializeRoom(result.room),
            // 房间模式只能有一个事实源：后进来的人若沿用自己菜单里的模式，
            // 一端会停在"武装"、另一端直接进"布阵"，服务端永远等不齐而把房间卡死。
            gameMode: result.room.gameMode,
            gameState: result.room.gameState,
            revision: result.room.revision,
            resumed: result.resumed === true,
            resume: result.resumed ? buildResumePayload(result.room) : undefined,
            opponent: result.playerNumber === 2 ? publicPlayer(result.room.player1) : undefined
        });
        if (result.playerNumber === 2) emitGameStart(result.room);
    });

    socket.on('invite-player', ({ targetPlayerId, gameMode } = {}, callback) => {
        const fromPlayerId = socket.data.playerId;
        const from = fromPlayerId ? onlinePlayers.get(fromPlayerId) : null;
        const target = typeof targetPlayerId === 'string' ? onlinePlayers.get(targetPlayerId) : null;
        if (!from) return callback?.({ success: false, error: '玩家身份未登记' });
        if (!target || target.status !== 'idle') return callback?.({ success: false, error: '对方当前不可邀请' });
        if (target.id === from.id) return callback?.({ success: false, error: '不能邀请自己' });
        if (from.status !== 'idle') return callback?.({ success: false, error: '请先离开当前房间' });

        // 邀请人就是这局的房主：他菜单里选的模式要随邀请一起存着，
        // 否则建房时只会落成默认标准局，双方客户端却各自按菜单进武装阶段。
        pendingInvites.set(`${target.id}:${from.id}`, {
            expiresAt: Date.now() + 30_000,
            gameMode: gameMode === 'classic' ? 'classic' : 'standard'
        });
        io.to(target.socketId).emit('room-invite', {
            fromPlayer: { id: from.id, label: from.label, status: from.status }
        });
        callback?.({ success: true });
    });

    socket.on('respond-invite', ({ fromPlayerId, accepted } = {}) => {
        const targetPlayerId = socket.data.playerId;
        if (!targetPlayerId || typeof fromPlayerId !== 'string') return;
        const inviteKey = `${targetPlayerId}:${fromPlayerId}`;
        const invite = pendingInvites.get(inviteKey);
        pendingInvites.delete(inviteKey);
        const from = onlinePlayers.get(fromPlayerId);
        const target = onlinePlayers.get(targetPlayerId);
        if (!invite || invite.expiresAt < Date.now() || !from || !target) return;

        if (!accepted) {
            io.to(from.socketId).emit('invite-declined', { player: { id: target.id, label: target.label } });
            return;
        }
        if (from.status !== 'idle' || target.status !== 'idle') return;

        const inviterSocket = io.sockets.sockets.get(from.socketId);
        const targetSocket = io.sockets.sockets.get(target.socketId);
        const roomId = generateNumericRoomId();
        if (!inviterSocket || !targetSocket || !roomId) return;
        createRoom(roomId, invite.gameMode);
        const first = joinRoom(roomId, inviterSocket, from.label, from.id);
        const second = joinRoom(roomId, targetSocket, target.label, target.id);
        if (!first.success || !second.success) return;
        const settledMode = rooms.get(roomId)?.gameMode ?? 'standard';

        inviterSocket.emit('invite-accepted', {
            success: true,
            roomId,
            playerNumber: 1,
            gameMode: settledMode,
            opponent: { id: target.id, label: target.label, status: 'room' }
        });
        targetSocket.emit('invite-accepted', {
            success: true,
            roomId,
            playerNumber: 2,
            // 被邀请方自己的菜单不算数，跟着房间走，否则两端阶段链会分叉
            gameMode: settledMode,
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
            // 替补制：与客户端一致，可选 6 位（首发 4 + 替补 2），上限必须同步否则第 5/6 位会被拒且不转发，
            // 对端收不到完整名单会导致双方确认后永远卡在"等待对方"
            else if (selected.length < 6) selected.push(heroId);
            else return reject('最多选择6位英雄');
            return acceptAndBroadcast();
        }

        if (action.type === 'confirm-hero-selection') {
            if (room.phase !== 'hero-select') return reject('当前不在英雄选择阶段');
            if (room.heroSelectReady[playerKey]) return reject('你已经确认了英雄选择');
            if (room.heroSelections[playerKey].length !== 6) return reject('必须选择6位英雄');
            room.heroSelectReady[playerKey] = true;
            if (room.heroSelectReady.player1 && room.heroSelectReady.player2) {
                room.phase = room.gameMode === 'classic' ? 'weapon-select' : 'deploy';
                room.selectingPlayer = 'player1';
                room.weaponReady = { player1: false, player2: false };
                room.weaponSelections = { player1: {}, player2: {} };
                room.deployReady = { player1: false, player2: false };
                room.deployments = { player1: new Map(), player2: new Map() };
            }
            return acceptAndBroadcast();
        }

        if (action.type === 'toggle-weapon') {
            if (room.phase !== 'weapon-select') return reject('当前不在武装阶段');
            if (room.weaponReady[playerKey]) return reject('你已经确认了武装选择');
            const heroId = String((action.data && action.data.heroId) || '').slice(0, 80);
            if (!room.heroSelections[playerKey].includes(heroId)) return reject('只能武装自己选下的英雄');
            const picked = room.weaponSelections[playerKey][heroId] ? null : heroId;
            if (picked === null) delete room.weaponSelections[playerKey][heroId];
            else room.weaponSelections[playerKey][heroId] = picked;
            return acceptAndBroadcast();
        }

        if (action.type === 'confirm-weapon-selection') {
            if (room.phase !== 'weapon-select') return reject('当前不在武装阶段');
            if (room.weaponReady[playerKey]) return reject('你已经确认了武装选择');
            room.weaponReady[playerKey] = true;
            if (room.weaponReady.player1 && room.weaponReady.player2) {
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

        if (action.type === 'reposition-deploy-hero') {
            if (room.phase !== 'deploy') return reject('当前不在部署阶段');
            if (room.deployReady[playerKey]) return reject('你已经确认了部署');
            const heroId = action.data?.heroId;
            const position = action.data?.position;
            const deployments = room.deployments[playerKey];
            // 只能调整本方已部署的英雄
            if (!deployments.has(heroId)) return reject('只能调整已部署的英雄');
            if (!Array.isArray(position) || position.length !== 2) return reject('部署位置无效');
            const [row, col] = position;
            if (![row, col].every(Number.isInteger) || row < 0 || row > 5 || col < 0 || col > 5) {
                return reject('部署位置无效');
            }
            if ((playerKey === 'player1' && col >= 3) || (playerKey === 'player2' && col < 3)) {
                return reject('不能移动到对方区域');
            }
            const targetKey = `${row},${col}`;
            const fromKey = deployments.get(heroId);
            if (fromKey === targetKey) return acceptAndBroadcast();
            // 目标格是否被占用：先查对手（禁止），再查己方（允许交换）
            const opponentKey = playerKey === 'player1' ? 'player2' : 'player1';
            const opponentOnTarget = [...room.deployments[opponentKey].entries()]
                .find(([, cell]) => cell === targetKey);
            if (opponentOnTarget) return reject('该位置已有单位');
            const allyOnTarget = [...deployments.entries()]
                .find(([id, cell]) => cell === targetKey && id !== heroId);
            if (allyOnTarget) {
                // 与己方另一英雄交换：两者格位互换
                deployments.set(allyOnTarget[0], fromKey);
            }
            deployments.set(heroId, targetKey);
            return acceptAndBroadcast();
        }

        if (action.type === 'undeploy-hero') {
            if (room.phase !== 'deploy') return reject('当前不在部署阶段');
            if (room.deployReady[playerKey]) return reject('你已经确认了部署');
            const heroId = action.data?.heroId;
            const deployments = room.deployments[playerKey];
            if (!deployments.has(heroId)) return reject('该英雄尚未部署');
            // 撤下后本格释放，其他英雄可重新占位
            deployments.delete(heroId);
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

        if (['move', 'undo-move', 'skill', 'end-turn'].includes(action.type)) {
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

        if (action.type === 'reinforce-deploy') {
            // 击杀触发的补员挂起期间，补员方虽非当前行动方，但必须允许其提交补员结果，
            // 否则补员操作会被拒绝并把客户端回滚到"等待补员"，形成无限补员死锁。
            if (room.phase !== 'battle') return reject('当前不在战斗阶段');
            const pendingReinforcer = room.gameState?.reinforcingPlayer;
            if (pendingReinforcer !== playerKey) return reject('当前不是你的补员回合');
            if (!isPlainGameState(gameState)) return reject('缺少有效的战斗状态');
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
        // 击杀触发的补员挂起期间，补员方（非当前行动方）也需要同步补员相关状态，
        // 否则其 sync 会被静默丢弃，导致两端补员状态分叉。
        const isActor = room.currentPlayer === playerKey;
        const isPendingReinforcer = gameState?.reinforcingPlayer === playerKey;
        // 姜太公的鱼钩在对手走位时咬住人：抛到哪一格由钩主来点，而钩主此刻不是行动方。
        // 不给这条口子，他点完落点的同步会被静默吞掉，两端棋盘当场分叉。
        const pendingHeroId = gameState?.pendingBoardAction?.heroId;
        const isPendingPicker = !!pendingHeroId && isHeroOwnedByPlayerNumber(pendingHeroId, playerNumber);
        if (room.phase === 'battle' && !isActor && !isPendingReinforcer && !isPendingPicker) return;

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
        const outcome = leaveRoomForSocket(socket, '对手连接已断开，房间已关闭', { grace: true });
        const playerId = socket.data.playerId;
        if (!playerId || onlinePlayers.get(playerId)?.socketId !== socket.id) return;

        if (outcome === 'held') {
            // 席位还在重连宽限期内：留着身份，让他凭 playerId 坐回原来的位子
            const entry = onlinePlayers.get(playerId);
            entry.socketId = null;
            entry.status = 'room';
            broadcastPresence();
            return;
        }

        onlinePlayers.delete(playerId);
        for (const key of pendingInvites.keys()) {
            if (key.startsWith(`${playerId}:`) || key.endsWith(`:${playerId}`)) pendingInvites.delete(key);
        }
        broadcastPresence();
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
        clearInterval(reconnectSweepTimer);
        io.disconnectSockets(true);
        io.close(() => resolve());
    });
}

/**
 * 掉线宽限期到期才真的关房间。抽成函数：定时轮询和回归测试走同一段逻辑，
 * 测试不必为了等 5 秒轮询而挂起。
 */
export function sweepExpiredReconnects(now = Date.now()) {
    for (const [roomId, room] of rooms.entries()) {
        if (!room.dropDeadlineAt || now < room.dropDeadlineAt) continue;
        const offlineSeat = ['player1', 'player2']
            .find(seatKey => room[seatKey]?.disconnectedAt && !liveSocketOfSeat(room[seatKey]));
        delete room.dropDeadlineAt;
        if (offlineSeat) room[offlineSeat].disconnectedAt = undefined;
        const waiting = ['player1', 'player2']
            .filter(seatKey => seatKey !== offlineSeat)
            .map(seatKey => liveSocketOfSeat(room[seatKey]))
            .filter(Boolean);
        for (const socket of waiting) {
            socket.data.roomId = undefined;
            socket.leave(roomId);
            socket.emit('player-disconnected', { message: '对手离线超时，房间已关闭，本局结束' });
        }
        rooms.delete(roomId);
        console.log(`[宽限期结束] ${roomId}: 掉线方未在 ${Math.round(RECONNECT_GRACE_MS / 1000)} 秒内重连，房间关闭`);
    }
}

const reconnectSweepTimer = setInterval(() => sweepExpiredReconnects(), 5_000);
reconnectSweepTimer.unref();

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
