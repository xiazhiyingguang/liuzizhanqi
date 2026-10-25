import { useEffect, useRef } from 'react';
import { createOnlineStateSnapshot, useGameStore } from '../store/game-store';
import {
    disconnectFromServer,
    getSocket,
    registerLobbyPlayer,
    resumeRoom,
    sendPlayerAction,
    syncGameState,
    onEvent,
    offEvent
} from '../services/socket-service';
import { getOrCreatePlayerIdentity, rememberRecentPlayer } from '../services/player-profile';
import { applyResumePayload, applyServerGameState, commitOnlineTriggeredFx, applySnapshotAction } from '../services/online-state';
import { audioManager } from '../audio/audio-manager';
import { setWenrenWaypoint } from '../core/wenren-form';

/**
 * 联机模式游戏同步Hook
 * 处理游戏状态的实时同步
 */
export function useOnlineSync() {
    const isOnlineMode = useGameStore(state => state.isOnlineMode);
    const roomId = useGameStore(state => state.onlineRoomId);
    const localPlayerNumber = useGameStore(state => state.localPlayerNumber);
    const lastRevisionRef = useRef(0);

    useEffect(() => {
        if (!isOnlineMode || !roomId) return;

        const socket = getSocket();
        if (!socket) return;

        lastRevisionRef.current = 0;
        console.log('[联机同步] 启动同步监听');

        // 监听对手的操作
        const handleActionBroadcast = ({ playerNumber, action, gameState, revision }: {
            playerNumber: number;
            action: any;
            gameState?: any;
            revision?: number;
        }) => {
            if (revision && revision <= lastRevisionRef.current) return;

            // 忽略自己的操作（已经在本地处理了）
            if (playerNumber === localPlayerNumber) {
                if (revision) lastRevisionRef.current = revision;
                return;
            }

            console.log('[联机同步] 收到对手操作:', action);

            // 联机 BGM 同步：玩家一为音乐主机，玩家二据其动作搭车的循环位置对齐本地战斗音乐
            if (localPlayerNumber === 2) {
                const bgmPos = action?.meta?.bgmPos;
                if (typeof bgmPos === 'number' && Number.isFinite(bgmPos)) {
                    audioManager.alignBattleMusicTo(bgmPos);
                }
            }

            const store = useGameStore.getState();

            useGameStore.setState({ suppressOnlineBroadcast: true });

            const playerKey = playerNumber === 1 ? 'player1' : 'player2';

            try {
                // 战斗阶段由行动方提交执行后的权威快照，避免随机技能在两端重复计算。
                if (gameState) {
                    // 本端不重跑 executeSkill，音效与特效需在快照落地前后重建，
                    // 否则未出手的一方整局都看不到战斗表现。
                    applySnapshotAction(action, gameState);
                    return;
                }

                switch (action.type) {
                case 'select-hero': {
                    if (action.data?.heroId) store.selectHeroForPlayer(playerKey, action.data.heroId);
                    break;
                }

                case 'confirm-hero-selection': {
                    store.confirmHeroSelectionForPlayer(playerKey);
                    break;
                }

                case 'toggle-weapon': {
                    if (action.data?.heroId) store.toggleWeaponForPlayer(playerKey, action.data.heroId);
                    break;
                }

                case 'confirm-weapon-selection': {
                    store.confirmWeaponSelectionForPlayer(playerKey);
                    break;
                }

                case 'deploy-hero': {
                    if (action.data?.heroId && action.data?.position) {
                        store.deployHeroForPlayer(playerKey, action.data.heroId, action.data.position);
                    }
                    break;
                }

                case 'reposition-deploy-hero': {
                    if (action.data?.heroId && action.data?.position) {
                        store.repositionDeployHeroForPlayer(playerKey, action.data.heroId, action.data.position);
                    }
                    break;
                }

                case 'undeploy-hero': {
                    if (action.data?.heroId) {
                        store.undeployHeroForPlayer(playerKey, action.data.heroId);
                    }
                    break;
                }

                case 'confirm-deployment': {
                    store.confirmDeploymentForPlayer(playerKey);
                    break;
                }

                case 'move': {
                    if (action.data?.heroId && action.data?.to) {
                        const hero = [...store.player1Heroes, ...store.player2Heroes].find(h => h.id === action.data.heroId);
                        if (hero) {
                            store.selectHeroForAction(hero);
                            store.moveHero(action.data.to);
                        }
                    }
                    break;
                }

                case 'undo-move': {
                    if (action.data?.heroId) {
                        const hero = [...store.player1Heroes, ...store.player2Heroes].find(h => h.id === action.data.heroId);
                        if (hero) {
                            store.selectHeroForAction(hero);
                            store.undoMove();
                        }
                    }
                    break;
                }

                case 'skill': {
                    if (action.data?.heroId && action.data?.skillId && action.data?.targetPos) {
                        const hero = [...store.player1Heroes, ...store.player2Heroes].find(h => h.id === action.data.heroId);
                        if (hero) {
                            store.selectHeroForAction(hero);
                            store.selectSkill(action.data.skillId);
                            // 闻人翊悬跃阵是两段选点：selectSkill 会把中途点清空，
                            // 对端必须补回主机当时选的那名友军，才能复现同一路线与距离
                            if (Array.isArray(action.data.wenrenWaypoint)) {
                                setWenrenWaypoint(hero, action.data.wenrenWaypoint as [number, number]);
                            }
                            if (action.data.reviveTargetHeroId) {
                                store.selectBaizeReviveTarget(action.data.reviveTargetHeroId);
                            }
                            if (action.data.jetzmiEnhanced && !store.jetzmiSkill1Enhanced) {
                                store.toggleJetzmiSkill1Enhanced();
                            }
                            store.executeSkill(action.data.targetPos);
                        }
                    }
                    break;
                }

                case 'end-turn': {
                    const heroId = action.data?.heroId;
                    if (heroId) {
                        const hero = [...store.player1Heroes, ...store.player2Heroes].find(h => h.id === heroId);
                        if (hero) {
                            store.selectHeroForAction(hero);
                        }
                    }
                    store.endHeroAction();
                    break;
                }
                }
            } catch (error) {
                console.error('[联机同步] 处理对手操作失败:', error);
                useGameStore.getState().addLog({
                    type: 'system',
                    player: playerKey,
                    message: '收到的联机操作无效，已安全忽略'
                });
            } finally {
                useGameStore.setState({ suppressOnlineBroadcast: false });
                if (revision) lastRevisionRef.current = revision;
            }
        };

        // 监听游戏开始
        const handleGameStart = (data: any) => {
            console.log('[联机同步] 游戏开始:', data);
            const store = useGameStore.getState();
            if (store.phase === 'online-menu') {
                store.initGame();
            }
            const opponent = localPlayerNumber === 1 ? data.players?.player2 : data.players?.player1;
            rememberRecentPlayer(opponent);
            useGameStore.getState().addLog({
                type: 'system',
                player: 'player1',
                message: `${data.player1 || '玩家一'} 与 ${data.player2 || '玩家二'} 已就位，游戏开始！`
            });
        };

        // 监听玩家断线：显式离开或宽限期超时才会走到这里，瞬时掉线由 reconnect + room-resume 兜住
        const handlePlayerDisconnected = ({ message }: any) => {
            console.log('[联机同步] 对手断线:', message);
            alert(message);
            disconnectFromServer();
            useGameStore.getState().resetGame();
        };

        // 自己这条连接断了：不要拆局。服务端的席位会保留到宽限期结束，
        // 自动重连成功后由 room-resume 把局面接回来（原来这里直接 resetGame，
        // 于是一次 Wi-Fi 抖动就能把好好一局对局就地销毁）。
        const handleConnectionLost = (reason: string) => {
            if (reason === 'io client disconnect') return;
            console.log('[联机同步] 连接中断，等待自动重连:', reason);
            useGameStore.setState({ onlineSelfReconnecting: true });
        };

        const handleReconnectFailed = () => {
            useGameStore.setState({ onlineSelfReconnecting: false });
            alert('与联机服务器的连接已中断，重连失败，本局对战已结束');
            disconnectFromServer();
            useGameStore.getState().resetGame();
        };

        // 重连成功：先补登记身份，再凭 playerId 认领自己原来的席位
        const handleReconnect = async () => {
            const identity = getOrCreatePlayerIdentity();
            registerLobbyPlayer(identity);
            const response = await resumeRoom(roomId, identity, localPlayerNumber ?? 1);
            if (!response.success) {
                useGameStore.setState({ onlineSelfReconnecting: false });
                alert('这间房间已经关闭，本局无法继续');
                useGameStore.getState().resetGame();
                return;
            }
            console.log('[联机同步] 重连后已认领席位:', response.playerNumber);
        };

        // 对手掉线/回来：只提示，不结束对局
        const handleOpponentDropped = ({ graceSeconds, message }: any) => {
            console.log('[联机同步] 对手掉线:', message);
            useGameStore.setState({ onlineOpponentOfflineUntil: Date.now() + (graceSeconds ?? 120) * 1000 });
            useGameStore.getState().addLog({
                type: 'system',
                player: 'player1',
                message: `对手连接中断，房间保留 ${graceSeconds ?? 120} 秒等待重连`
            });
        };

        const handleOpponentResumed = ({ message }: any) => {
            console.log('[联机同步] 对手重连:', message);
            useGameStore.setState({ onlineOpponentOfflineUntil: undefined });
            useGameStore.getState().addLog({
                type: 'system',
                player: 'player1',
                message: '对手已重连回房间，对局继续'
            });
        };

        // 重连回席后的局面重建：战斗阶段用权威快照，选将/布阵阶段按服务端记录重放
        const handleRoomResume = (payload: any) => {
            applyResumePayload(payload);
            if (payload.revision) lastRevisionRef.current = payload.revision;
        };

        const handleActionRejected = ({ message, gameState, revision }: any) => {
            if (typeof message === 'string' && message) {
                useGameStore.getState().addLog({
                    type: 'system',
                    player: 'player1',
                    message
                });
            }
            if (gameState && (!revision || revision >= lastRevisionRef.current)) {
                useGameStore.setState({ suppressOnlineBroadcast: true });
                try {
                    applyServerGameState(gameState);
                    if (revision) lastRevisionRef.current = revision;
                } finally {
                    useGameStore.setState({ suppressOnlineBroadcast: false });
                }
            }
        };

        // 快照归一化与本地应用逻辑见 src/services/online-state.ts（联机回归测试复用同一实现）

        // 监听游戏状态同步
        const handleGameStateUpdate = ({ gameState, revision }: any) => {
            console.log('[联机同步] 收到游戏状态更新:', gameState.phase);

            if (!gameState) return;
            if (revision && revision <= lastRevisionRef.current) return;

            useGameStore.setState({ suppressOnlineBroadcast: true });
            try {
                // 状态同步也是"对手做了一件事"：挂起选格确认、行动结束的延迟段都走这条路，
                // 不重建锚定特效就只有出手方看得见画面
                const logIdsBefore = new Set(useGameStore.getState().battleLog.map(log => log.id));
                applyServerGameState(gameState);
                commitOnlineTriggeredFx(logIdsBefore);
                if (revision) lastRevisionRef.current = revision;
            } catch (error) {
                console.error('[联机同步] 应用游戏状态失败:', error);
            } finally {
                useGameStore.setState({ suppressOnlineBroadcast: false });
            }
        };

        const handleRequestGameState = () => {
            const state = useGameStore.getState();
            if (state.phase !== 'battle' && state.phase !== 'ended') return;
            syncGameState(roomId, createOnlineStateSnapshot(state));
        };

        // 注册事件监听
        onEvent('action-broadcast', handleActionBroadcast);
        onEvent('game-start', handleGameStart);
        onEvent('player-disconnected', handlePlayerDisconnected);
        onEvent('action-rejected', handleActionRejected);
        onEvent('game-state-update', handleGameStateUpdate);
        onEvent('request-game-state', handleRequestGameState);
        onEvent('opponent-dropped', handleOpponentDropped);
        onEvent('opponent-resumed', handleOpponentResumed);
        onEvent('room-resume', handleRoomResume);
        socket.on('disconnect', handleConnectionLost);
        socket.io.on('reconnect', handleReconnect);
        socket.io.on('reconnect_failed', handleReconnectFailed);

        // 清理函数
        return () => {
            console.log('[联机同步] 停止同步监听');
            offEvent('action-broadcast', handleActionBroadcast);
            offEvent('game-start', handleGameStart);
            offEvent('player-disconnected', handlePlayerDisconnected);
            offEvent('action-rejected', handleActionRejected);
            offEvent('game-state-update', handleGameStateUpdate);
            offEvent('request-game-state', handleRequestGameState);
            offEvent('opponent-dropped', handleOpponentDropped);
            offEvent('opponent-resumed', handleOpponentResumed);
            offEvent('room-resume', handleRoomResume);
            socket.off('disconnect', handleConnectionLost);
            socket.io.off('reconnect', handleReconnect);
            socket.io.off('reconnect_failed', handleReconnectFailed);
        };
    }, [isOnlineMode, roomId, localPlayerNumber]);
}

/**
 * 发送玩家操作到服务器
 */
export function broadcastAction(actionType: string, data: any) {
    const store = useGameStore.getState();

    if (!store.isOnlineMode || !store.onlineRoomId) {
        return; // 非联机模式，不发送
    }

    const action = {
        type: actionType,
        data
    };

    console.log('[联机同步] 发送操作:', action);
    sendPlayerAction(store.onlineRoomId, action);
}
