import { useState } from 'react';
import { useGameStore } from '../../store/game-store';
import { disconnectFromServer } from '../../services/socket-service';
import Board from './Board';
import BattleLog from './BattleLog';
import HeroList from './HeroList';
import SkillPanel from './SkillPanel';
import InkButton from '../ui/InkButton';
import { getBattleOutcomePresentation, getLatestKillAnnouncement } from '../../core/battle-presentation';
import TurnActionBanner from './TurnActionBanner';
import BattleStatisticsModal from './BattleStatisticsModal';

export default function BattleScene() {
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [showBattleStatistics, setShowBattleStatistics] = useState(false);
    const {
        currentPlayer,
        roundNumber,
        actionsThisTurn,
        actionsRequiredThisTurn,
        phase,
        winner,
        isOnlineMode,
        isAiMode,
        aiPlayer,
        onlineRoomId,
        localPlayerNumber,
        selectedHero,
        activeHero,
        battleLog,
        resetGame
    } = useGameStore();

    const isP1Turn = currentPlayer === 'player1';
    const localPlayerKey = localPlayerNumber === 2 ? 'player2' : 'player1';
    const opponentPlayerKey = localPlayerKey === 'player1' ? 'player2' : 'player1';
    const outcome = getBattleOutcomePresentation(winner, Boolean(isOnlineMode), localPlayerNumber, Boolean(isAiMode));
    const actingHero = activeHero ?? (
        selectedHero?.owner === currentPlayer ? selectedHero : null
    );
    const latestKillAnnouncement = getLatestKillAnnouncement(battleLog);
    const leaveBattle = () => {
        if (isOnlineMode) disconnectFromServer();
        resetGame();
    };

    return (
        <div className="battle-scene">
            {/* 顶部信息栏 */}
            <div className="battle-topbar ink-panel-solid px-5 py-2.5 flex-shrink-0">
                <div className="flex items-center justify-between">
                    {/* 玩家1 */}
                    <div className="flex items-center gap-3">
                        <div className={`
                            flex items-center gap-2.5 px-4 py-1.5 rounded-lg transition-all
                            ${isP1Turn ? 'bg-indigo-ink/10 ring-1 ring-indigo-ink/25' : 'opacity-40'}
                        `}>
                            <span className={`w-2.5 h-2.5 rounded-full ${isP1Turn ? 'bg-indigo-ink' : 'bg-indigo-ink/30'}`} />
                            <span className={`font-title text-sm ${isP1Turn ? 'text-indigo-ink' : 'text-ink-faint'}`}>
                                {isAiMode ? '玩家一（你）' : `玩家一${isOnlineMode && localPlayerNumber === 1 ? '（你）' : ''}`}
                            </span>
                        </div>
                    </div>

                    {/* 中央信息 */}
                    <div className="flex items-center gap-5">
                        <span className="font-title text-lg text-ink">
                            第 {roundNumber} 回合
                        </span>
                        <span className="text-xs text-ink-faint font-body">
                            行动 {actionsThisTurn}/{actionsRequiredThisTurn}
                        </span>
                        {isOnlineMode && onlineRoomId && (
                            <span className="hidden xl:inline text-[11px] text-ink-faint font-mono tracking-wider">
                                {onlineRoomId}
                            </span>
                        )}
                    </div>

                    {/* 玩家2 */}
                    <div className="flex items-center gap-3">
                        <div className={`
                            flex items-center gap-2.5 px-4 py-1.5 rounded-lg transition-all
                            ${!isP1Turn ? 'bg-vermillion/10 ring-1 ring-vermillion/25' : 'opacity-40'}
                        `}>
                            <span className={`font-title text-sm ${!isP1Turn ? 'text-vermillion' : 'text-ink-faint'}`}>
                                {isAiMode ? '宗师电脑' : `玩家二${isOnlineMode && localPlayerNumber === 2 ? '（你）' : ''}`}
                            </span>
                            <span className={`w-2.5 h-2.5 rounded-full ${!isP1Turn ? 'bg-vermillion' : 'bg-vermillion/30'}`} />
                        </div>

                        <InkButton variant="ghost" size="sm" onClick={() => setShowExitConfirm(true)}>
                            退出对局
                        </InkButton>
                    </div>
                </div>

                {/* 行动指示条 */}
                <div className="mt-2">
                    <div className={isP1Turn ? 'turn-indicator-p1' : 'turn-indicator-p2'} />
                </div>
            </div>

            {/* 主游戏区域 */}
            <div className="battle-workspace">
                {/* 左侧 - 双方阵容总览 */}
                <aside className="battle-rosters" aria-label="双方阵容">
                    <section className="battle-roster-panel">
                        <HeroList player={isOnlineMode ? localPlayerKey : 'player1'} label="我方" />
                    </section>
                    <section className="battle-roster-panel">
                        <HeroList player={isOnlineMode ? opponentPlayerKey : 'player2'} label={isAiMode ? '宗师电脑' : '敌方'} />
                    </section>
                </aside>

                {/* 中间 - 主战场 */}
                <main className="battle-board-stage" aria-label="战斗棋盘">
                    <TurnActionBanner
                        currentPlayer={currentPlayer}
                        hero={actingHero}
                        isOnlineMode={Boolean(isOnlineMode)}
                        localPlayerNumber={localPlayerNumber}
                        latestKillAnnouncement={latestKillAnnouncement}
                        isAiMode={Boolean(isAiMode)}
                        aiPlayer={aiPlayer}
                    />
                    <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                        <Board />
                    </div>
                </main>

                {/* 右侧 - 操作与战报 */}
                <aside className="battle-command" aria-label="指挥区域">
                    <SkillPanel />
                    <BattleLog />
                </aside>
            </div>

            {/* 游戏结束弹窗 */}
            {phase === 'ended' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="battle-result">
                    {/* 遮罩 */}
                    <div className="absolute inset-0 bg-ink/50 animate-fade-in backdrop-blur-sm" />

                    {/* 内容 */}
                    <div
                        className="relative z-10 animate-fade-up"
                        style={{ animationDelay: '200ms', animationFillMode: 'backwards' }}
                    >
                        <div className="ink-card p-12 text-center min-w-[400px]">
                            {/* 胜利标记 */}
                            <div className="mb-6">
                                <span className="text-8xl font-title" style={{
                                    color: outcome.result === 'victory' ? '#2c3e6b' : '#8f2f2a',
                                }}>
                                    {outcome.mark}
                                </span>
                            </div>

                            <div className="battle-divider mb-6" />

                            <p className="font-title text-2xl text-ink mb-8">
                                {outcome.title}
                            </p>

                            <p className="-mt-5 mb-8 text-sm text-ink-faint font-body">
                                {outcome.description}
                            </p>

                            <div className="flex items-center justify-center gap-3">
                                <InkButton variant="secondary" size="sm" onClick={() => setShowBattleStatistics(true)}>
                                    伤害统计
                                </InkButton>
                                <InkButton variant="primary" size="lg" onClick={leaveBattle}>
                                    返回主界面
                                </InkButton>
                            </div>

                            {/* 印章 */}
                            <div className="mt-6 opacity-30">
                                <span className="ink-seal text-2xl">终</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {phase === 'ended' && showBattleStatistics && (
                <BattleStatisticsModal onClose={() => setShowBattleStatistics(false)} />
            )}

            {showExitConfirm && phase !== 'ended' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="exit-battle-title">
                    <button
                        type="button"
                        className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
                        aria-label="取消退出"
                        onClick={() => setShowExitConfirm(false)}
                    />
                    <div className="ink-card relative z-10 w-[min(420px,calc(100%-32px))] p-8 text-center animate-fade-up">
                        <h2 id="exit-battle-title" className="font-title text-2xl text-ink">
                            确认退出对局？
                        </h2>
                        <p className="mt-3 text-sm leading-6 text-ink-faint">
                            当前对局进度不会保留。
                        </p>
                        <div className="mt-7 flex justify-center gap-3">
                            <InkButton variant="ghost" onClick={() => setShowExitConfirm(false)}>
                                继续对局
                            </InkButton>
                            <InkButton variant="primary" onClick={leaveBattle}>
                                确认退出
                            </InkButton>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
