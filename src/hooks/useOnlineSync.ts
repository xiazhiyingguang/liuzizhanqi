import { useEffect, useRef } from 'react';
import { createOnlineStateSnapshot, useGameStore } from '../store/game-store';
import { disconnectFromServer, getSocket, sendPlayerAction, syncGameState, onEvent, offEvent } from '../services/socket-service';
import { rememberRecentPlayer } from '../services/player-profile';
import { applyServerGameState, applySnapshotAction } from '../services/online-state';
import { audioManager } from '../audio/audio-manager';

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
                            if (action.data.reviveTargetHeroId) {
                                store.selectBaizeReviveTarget(action.data.reviveTargetHeroId);
                            }
                            if (action.data.changliEmpowered) {
                                store.toggleChangliSkill2Empowered();
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

        // 监听玩家断线
        const handlePlayerDisconnected = ({ message }: any) => {
            console.log('[联机同步] 对手断线:', message);
            alert(message);
            disconnectFromServer();
            useGameStore.getState().resetGame();
        };

        const handleConnectionLost = (reason: string) => {
            if (reason === 'io client disconnect') return;
            alert('与联机服务器的连接已中断，本局对战已结束');
            disconnectFromServer();
            useGameStore.getState().resetGame();
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
                applyServerGameState(gameState);
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
        socket.on('disconnect', handleConnectionLost);

        // 清理函数
        return () => {
            console.log('[联机同步] 停止同步监听');
            offEvent('action-broadcast', handleActionBroadcast);
            offEvent('game-start', handleGameStart);
            offEvent('player-disconnected', handlePlayerDisconnected);
            offEvent('action-rejected', handleActionRejected);
            offEvent('game-state-update', handleGameStateUpdate);
            offEvent('request-game-state', handleRequestGameState);
            socket.off('disconnect', handleConnectionLost);
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
