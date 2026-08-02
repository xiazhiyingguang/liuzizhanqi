import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    connectToServer,
    disconnectFromServer,
    enterRoomCode,
    inviteLobbyPlayer,
    leaveRoom,
    registerLobbyPlayer,
    respondToLobbyInvite,
    type LobbyPlayer,
    type RoomJoinResponse
} from '../../services/socket-service';
import {
    getOrCreatePlayerIdentity,
    getRecentPlayers,
    rememberRecentPlayer,
    type RecentPlayer
} from '../../services/player-profile';
import { useGameStore } from '../../store/game-store';
import InkButton from '../ui/InkButton';
import InkCard from '../ui/InkCard';
import InkDivider from '../ui/InkDivider';

type IncomingInvite = {
    fromPlayer: LobbyPlayer;
};

export default function OnlineMenu() {
    const identity = useMemo(() => getOrCreatePlayerIdentity(), []);
    const [roomCode, setRoomCode] = useState('');
    const [waitingCode, setWaitingCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [onlinePlayers, setOnlinePlayers] = useState<LobbyPlayer[]>([]);
    const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>(() => getRecentPlayers());
    const [incomingInvite, setIncomingInvite] = useState<IncomingInvite | null>(null);

    const enterOnlineGame = useCallback((result: RoomJoinResponse, startImmediately = false) => {
        if (!result.roomId || !result.playerNumber) return;
        useGameStore.setState({
            isOnlineMode: true,
            onlineRoomId: result.roomId,
            localPlayerNumber: result.playerNumber,
            localPlayerName: identity.label
        });
        if (result.opponent) setRecentPlayers(rememberRecentPlayer(result.opponent));
        if (result.gameState) useGameStore.setState(result.gameState as any);
        if (startImmediately || result.playerNumber === 2) useGameStore.getState().initGame();
    }, [identity.label]);

    useEffect(() => {
        const socket = connectToServer();

        const handleConnect = () => {
            setConnected(true);
            setError('');
            registerLobbyPlayer(identity);
        };
        const handleDisconnect = () => setConnected(false);
        const handleConnectError = () => {
            setConnected(false);
            setError('联机服务暂时不可用，请确认主机已启动');
        };
        const handlePresence = ({ players }: { players?: LobbyPlayer[] }) => {
            setOnlinePlayers((players || []).filter(player => player.id !== identity.id));
        };
        const handleInvite = (invite: IncomingInvite) => {
            if (invite?.fromPlayer?.id) setIncomingInvite(invite);
        };
        const handleInviteAccepted = (result: RoomJoinResponse) => {
            if (!result.success || !result.roomId || !result.playerNumber) return;
            enterOnlineGame(result, true);
        };
        const handleInviteDeclined = ({ player }: { player?: LobbyPlayer }) => {
            setNotice(`${player?.label || '对方'}暂时没有接受邀请`);
        };

        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        socket.on('connect_error', handleConnectError);
        socket.on('presence-update', handlePresence);
        socket.on('room-invite', handleInvite);
        socket.on('invite-accepted', handleInviteAccepted);
        socket.on('invite-declined', handleInviteDeclined);
        if (socket.connected) handleConnect();

        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
            socket.off('connect_error', handleConnectError);
            socket.off('presence-update', handlePresence);
            socket.off('room-invite', handleInvite);
            socket.off('invite-accepted', handleInviteAccepted);
            socket.off('invite-declined', handleInviteDeclined);
        };
    }, [enterOnlineGame, identity]);

    const handleEnterRoom = async () => {
        const code = roomCode.replace(/\D/g, '').slice(0, 4);
        if (code.length !== 4) {
            setError('请输入四位数字');
            return;
        }
        setLoading(true);
        setError('');
        setNotice('');
        const result = await enterRoomCode(code, identity);
        setLoading(false);
        if (!result.success || !result.roomId || !result.playerNumber) {
            setError(result.error || '进入房间失败');
            return;
        }
        enterOnlineGame(result);
        if (result.playerNumber === 1) setWaitingCode(code);
    };

    const handleCancelWaiting = async () => {
        const activeRoomId = useGameStore.getState().onlineRoomId;
        if (activeRoomId) await leaveRoom(activeRoomId);
        useGameStore.setState({
            isOnlineMode: false,
            onlineRoomId: undefined,
            localPlayerNumber: undefined,
            localPlayerName: undefined
        });
        setWaitingCode('');
        setRoomCode('');
    };

    const handleBack = async () => {
        const activeRoomId = useGameStore.getState().onlineRoomId;
        if (activeRoomId) await leaveRoom(activeRoomId);
        disconnectFromServer();
        useGameStore.getState().resetGame();
    };

    const handleInvitePlayer = async (player: LobbyPlayer | RecentPlayer) => {
        setNotice('');
        setError('');
        const result = await inviteLobbyPlayer(player.id);
        if (result.success) setNotice(`已邀请 ${player.label}，等待回应…`);
        else setError(result.error || '邀请发送失败');
    };

    const handleInviteResponse = (accepted: boolean) => {
        if (!incomingInvite) return;
        respondToLobbyInvite(incomingInvite.fromPlayer.id, accepted);
        if (!accepted) setNotice('已婉拒邀请');
        setIncomingInvite(null);
    };

    const onlineById = new Map(onlinePlayers.map(player => [player.id, player]));
    const availablePlayers = onlinePlayers.filter(player => player.status === 'idle');

    return (
        <div className="w-full h-full flex items-center justify-center relative overflow-y-auto py-8">
            <span className="absolute font-title text-[14rem] text-ink/[0.02] select-none pointer-events-none left-[-1rem] bottom-[5%]">
                联
            </span>

            <div className="w-full max-w-lg px-4 animate-ink-spread relative z-10">
                <div className="text-center mb-6">
                    <h1 className="font-title text-5xl text-ink tracking-wider mb-2">联机对战</h1>
                    <InkDivider variant="brush" className="max-w-[200px] mx-auto" />
                    <div className="mt-3 flex items-center justify-center gap-3 text-xs font-body">
                        <span className={connected ? 'text-jade' : 'text-vermillion'}>
                            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${connected ? 'bg-jade animate-pulse' : 'bg-vermillion'}`} />
                            {connected ? '联机服务已连接' : '联机服务未连接'}
                        </span>
                        <span className="text-ink-faint">我的身份：{identity.label}</span>
                    </div>
                </div>

                {incomingInvite && (
                    <InkCard variant="selected" className="mb-4 p-5 text-center animate-fade-up">
                        <p className="font-title text-lg text-ink">{incomingInvite.fromPlayer.label} 邀请你对战</p>
                        <p className="mt-1 text-xs text-ink-faint font-body">接受后双方会自动进入同一房间</p>
                        <div className="mt-4 flex justify-center gap-3">
                            <InkButton variant="primary" size="sm" onClick={() => handleInviteResponse(true)}>接受</InkButton>
                            <InkButton variant="ghost" size="sm" onClick={() => handleInviteResponse(false)}>婉拒</InkButton>
                        </div>
                    </InkCard>
                )}

                <InkCard variant="elevated" className="p-6">
                    {waitingCode ? (
                        <div className="space-y-5 text-center">
                            <div>
                                <p className="text-sm text-ink-faint font-body">等待另一位玩家输入</p>
                                <p className="mt-2 text-5xl font-mono font-bold tracking-[0.28em] text-ink">{waitingCode}</p>
                                <p className="mt-3 text-sm text-ink-light font-body">把这四位数字告诉对方即可</p>
                            </div>
                            <div className="flex justify-center gap-2 py-2">
                                {[0, 1, 2].map(index => (
                                    <span key={index} className="h-2.5 w-2.5 rounded-full bg-ink animate-ink-spread"
                                        style={{ animationDelay: `${index * 0.25}s`, animationIterationCount: 'infinite', animationDuration: '1.2s' }} />
                                ))}
                            </div>
                            <InkButton variant="ghost" onClick={handleCancelWaiting} className="w-full">取消等待</InkButton>
                        </div>
                    ) : (
                        <div>
                            <div className="text-center">
                                <h2 className="font-title text-xl text-ink">输入相同的四位数字</h2>
                                <p className="mt-1 text-xs leading-5 text-ink-faint font-body">
                                    先进入的人创建房间，后进入的人自动加入
                                </p>
                            </div>
                            <input
                                value={roomCode}
                                onChange={event => setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                                onKeyDown={event => event.key === 'Enter' && roomCode.length === 4 && handleEnterRoom()}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={4}
                                aria-label="四位房间数字"
                                placeholder="0000"
                                className="mx-auto my-5 block w-64 border-b-2 border-ink/15 bg-transparent py-3 text-center font-mono text-4xl font-bold tracking-[0.35em] text-ink outline-none transition focus:border-indigo-ink/50"
                            />
                            <InkButton
                                variant="primary"
                                size="lg"
                                className="w-full"
                                onClick={handleEnterRoom}
                                disabled={!connected || loading || roomCode.length !== 4}
                            >
                                {loading ? '正在进入…' : '进入房间'}
                            </InkButton>
                        </div>
                    )}

                    {(error || notice) && (
                        <p className={`mt-4 rounded-lg border px-3 py-2 text-center text-sm font-body ${
                            error
                                ? 'border-vermillion/20 bg-vermillion/5 text-vermillion'
                                : 'border-jade/20 bg-jade/5 text-jade'
                        }`}>
                            {error || notice}
                        </p>
                    )}
                </InkCard>

                {!waitingCode && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <InkCard className="p-4">
                            <h3 className="font-title text-base text-ink">最近对战</h3>
                            <div className="mt-3 space-y-2">
                                {recentPlayers.length === 0 ? (
                                    <p className="py-3 text-center text-xs text-ink-faint font-body">对战后会自动记录在这里</p>
                                ) : recentPlayers.slice(0, 5).map(player => {
                                    const online = onlineById.get(player.id);
                                    return (
                                        <PlayerRow
                                            key={player.id}
                                            player={online || player}
                                            online={Boolean(online)}
                                            canInvite={online?.status === 'idle'}
                                            onInvite={() => handleInvitePlayer(online || player)}
                                        />
                                    );
                                })}
                            </div>
                        </InkCard>

                        <InkCard className="p-4">
                            <h3 className="font-title text-base text-ink">在线棋友</h3>
                            <div className="mt-3 space-y-2">
                                {availablePlayers.length === 0 ? (
                                    <p className="py-3 text-center text-xs text-ink-faint font-body">暂时没有可邀请的玩家</p>
                                ) : availablePlayers.slice(0, 5).map(player => (
                                    <PlayerRow
                                        key={player.id}
                                        player={player}
                                        online
                                        canInvite
                                        onInvite={() => handleInvitePlayer(player)}
                                    />
                                ))}
                            </div>
                        </InkCard>
                    </div>
                )}

                <button type="button" onClick={handleBack} className="mx-auto mt-5 block text-sm text-ink-faint hover:text-ink font-body">
                    ← 返回主菜单
                </button>
            </div>
        </div>
    );
}

function PlayerRow({
    player,
    online,
    canInvite,
    onInvite
}: {
    player: LobbyPlayer | RecentPlayer;
    online: boolean;
    canInvite: boolean;
    onInvite: () => void;
}) {
    return (
        <div className="flex items-center gap-2 rounded-lg bg-white/30 px-2.5 py-2">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${online ? 'bg-jade' : 'bg-ink/15'}`} />
            <span className="min-w-0 flex-1 truncate text-xs text-ink-light font-body">{player.label}</span>
            {canInvite && (
                <button type="button" onClick={onInvite} className="text-xs text-indigo-ink hover:text-ink font-body">邀请</button>
            )}
        </div>
    );
}
