import { useEffect, useRef, useState } from 'react';
import { useMobileLayout } from '../../hooks/useMobileLayout';
import { useMobileBoardSize } from '../../hooks/useMobileBoardSize';
import { useGameStore } from '../../store/game-store';
import { disconnectFromServer } from '../../services/socket-service';
import Board from './Board';
import BattleLog from './BattleLog';
import HeroList from './HeroList';
import SkillPanel from './SkillPanel';
import InkButton from '../ui/InkButton';
import { getBattleOutcomePresentation, getLatestKillAnnouncement } from '../../core/battle-presentation';
import { fierceAnnouncement, fierceShortBadge, fierceTier } from '../../core/battle-tempo';
import TurnActionBanner from './TurnActionBanner';
import BattleStatisticsModal from './BattleStatisticsModal';
import BattleReplayModal from './BattleReplayModal';
import { hasBattleReplay } from '../../services/battle-replay';
import { soundManager } from '../../core/sound-manager';
import ReinforcementPanel from './ReinforcementPanel';
import './battle-result.css';

export default function BattleScene() {
    const mobile = useMobileLayout();
    const boardSpaceRef = useRef<HTMLDivElement>(null);
    useMobileBoardSize(boardSpaceRef);
    const [showMobileRosters, setShowMobileRosters] = useState(false);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [showBattleStatistics, setShowBattleStatistics] = useState(false);
    const [showBattleReplay, setShowBattleReplay] = useState(false);
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
        onlineSelfReconnecting,
        onlineOpponentOfflineUntil,
        localPlayerNumber,
        selectedHero,
        activeHero,
        battleLog,
        autoBattle,
        toggleAutoBattle,
        resetGame
    } = useGameStore();

    const isP1Turn = currentPlayer === 'player1';
    const localPlayerKey = localPlayerNumber === 2 ? 'player2' : 'player1';
    const opponentPlayerKey = localPlayerKey === 'player1' ? 'player2' : 'player1';

    // 进场后缓一拍再预取本场技能音效：让棋盘先画完，别和首帧抢带宽与主线程
    useEffect(() => {
        const timer = window.setTimeout(() => {
            const { player1Heroes, player2Heroes } = useGameStore.getState();
            soundManager.warmupFor([...player1Heroes, ...player2Heroes]
                .flatMap(hero => [hero.skill1Id, hero.skill2Id]));
        }, 700);
        return () => window.clearTimeout(timer);
    }, []);
    const outcome = getBattleOutcomePresentation(winner, Boolean(isOnlineMode), localPlayerNumber, Boolean(isAiMode));
    const actingHero = activeHero ?? (
        selectedHero?.owner === currentPlayer ? selectedHero : null
    );
    const latestKillAnnouncement = getLatestKillAnnouncement(battleLog);
    const battlePhase = fierceAnnouncement(roundNumber);
    const fierceShort = fierceShortBadge(roundNumber);
    const fierceLevel = fierceTier(roundNumber);
    // 联机席位由服务端保留一段时间，倒计时只用来告诉玩家"这一局还没输"
    const [opponentOfflineSeconds, setOpponentOfflineSeconds] = useState<number | null>(null);
    useEffect(() => {
        if (!isOnlineMode || !onlineOpponentOfflineUntil) {
            setOpponentOfflineSeconds(null);
            return;
        }
        const update = () => setOpponentOfflineSeconds(
            Math.max(0, Math.ceil((onlineOpponentOfflineUntil - Date.now()) / 1000))
        );
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [isOnlineMode, onlineOpponentOfflineUntil]);
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
                        {fierceShort && (
                            <span className={`fierce-badge ${fierceLevel === 2 ? 'fierce-badge--2' : ''} px-2 py-1 text-[10px]`}
                                title={`激战：全场常规伤害提升${fierceLevel === 2 ? ' 40%' : ' 20%'}（固定伤害与真实伤害不涨，治疗不受影响）`}
                            >
                                <span className="fierce-badge__pip" aria-hidden="true" />
                                <span className="fierce-badge__label">激战</span>
                                {fierceShort}
                            </span>
                        )}
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

                        {/* 联机连接状态：掉线不再立刻拆局，席位在宽限期内保留 */}
                        {isOnlineMode && (onlineSelfReconnecting || opponentOfflineSeconds !== null) && (
                            <span
                                data-testid="online-connection-status"
                                className="px-3 py-1.5 rounded-lg bg-amber-300/15 ring-1 ring-amber-300/30 text-xs font-body text-gold whitespace-nowrap"
                            >
                                {onlineSelfReconnecting
                                    ? '连接中断，正在自动重连…'
                                    : `对手掉线，席位保留 ${opponentOfflineSeconds} 秒`}
                            </span>
                        )}

                        {/* AI 接管：人机对局里把自己这一侧也交给电脑，随开随停 */}
                        {isAiMode && !isOnlineMode && phase === 'battle' && (
                            <InkButton
                                variant={autoBattle ? 'primary' : 'ghost'}
                                size="sm"
                                sfx="toggle"
                                data-testid="auto-battle-toggle"
                                aria-pressed={Boolean(autoBattle)}
                                title={autoBattle
                                    ? '电脑正在替你出手，点击这里收回操作权'
                                    : '让电脑替你出手，看两个 AI 对局；随时可以收回'}
                                onClick={() => toggleAutoBattle()}
                            >
                                {autoBattle ? '接管中 · 收回操作' : 'AI 接管'}
                            </InkButton>
                        )}

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
                <aside id="battle-rosters" className={`battle-rosters${showMobileRosters ? ' mobile-rosters-open' : ''}`} aria-label="双方阵容">
                    {mobile && <button className="mobile-rosters-close" onClick={() => setShowMobileRosters(false)}>关闭阵容</button>}
                    <section className="battle-roster-panel">
                        <HeroList player={isOnlineMode ? localPlayerKey : 'player1'} label="我方" />
                    </section>
                    <section className="battle-roster-panel">
                        <HeroList player={isOnlineMode ? opponentPlayerKey : 'player2'} label={isAiMode ? '宗师电脑' : '敌方'} />
                    </section>
                </aside>

                {/* 中间 - 主战场 */}
                <main className="battle-board-stage" aria-label="战斗棋盘">
                    {mobile && <button className="mobile-rosters-toggle" aria-controls="battle-rosters" aria-expanded={showMobileRosters}
                        onClick={() => setShowMobileRosters(value => !value)}>双方阵容</button>}
                    <TurnActionBanner
                        currentPlayer={currentPlayer}
                        hero={actingHero}
                        isOnlineMode={Boolean(isOnlineMode)}
                        localPlayerNumber={localPlayerNumber}
                        latestKillAnnouncement={latestKillAnnouncement}
                        isAiMode={Boolean(isAiMode)}
                        aiPlayer={aiPlayer}
                        battlePhase={battlePhase}
                    />
                    {!mobile && <ReinforcementPanel />}
                    <div ref={boardSpaceRef} className="battle-board-space flex min-h-0 w-full flex-1 items-center justify-center">
                        <Board />
                    </div>
                </main>

                {/* 右侧 - 操作与战报 */}
                <aside className="battle-command" aria-label="指挥区域">
                    {mobile && <ReinforcementPanel />}
                    <SkillPanel />
                    {mobile ? <details className="mobile-battle-log"><summary>查看战报</summary><div><BattleLog /></div></details> : <BattleLog />}
                </aside>
            </div>

            {/* 游戏结束弹窗 */}
            {phase === 'ended' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="battle-result">
                    {/* 遮罩 */}
                    <div className="absolute inset-0 bg-ink/55 animate-fade-in backdrop-blur-sm" />

                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={outcome.title}
                        className={`battle-result-card relative z-10 ${
                            outcome.result === 'victory' ? 'is-victory' : 'is-defeat'
                        }`}
                    >
                        <div className="battle-result-head">
                            {/* 落印：胜=金印 败=朱印 */}
                            <span className="battle-result-seal" aria-hidden="true">{outcome.mark}</span>
                            <h2 className="battle-result-title">{outcome.title}</h2>
                        </div>
                        <p className="battle-result-desc">{outcome.description}</p>

                        <div className="battle-result-divider" aria-hidden="true" />

                        <div className="battle-result-actions">
                            <InkButton
                                variant="primary"
                                size="lg"
                                className="battle-result-primary"
                                onClick={leaveBattle}
                            >
                                返回主界面
                            </InkButton>
                            <div className="battle-result-secondary">
                                <InkButton
                                    variant="ghost"
                                    className="battle-result-sub-btn"
                                    sfx="cancel"
                                    onClick={() => setShowBattleStatistics(true)}
                                >
                                    伤害统计
                                </InkButton>
                                {hasBattleReplay() && (
                                    <InkButton
                                        variant="ghost"
                                        className="battle-result-sub-btn"
                                        sfx="cancel"
                                        onClick={() => setShowBattleReplay(true)}
                                    >
                                        查看回放
                                    </InkButton>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {phase === 'ended' && showBattleStatistics && (
                <BattleStatisticsModal onClose={() => setShowBattleStatistics(false)} />
            )}

            {phase === 'ended' && showBattleReplay && (
                <BattleReplayModal onClose={() => setShowBattleReplay(false)} />
            )}

            {showExitConfirm && phase !== 'ended' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="exit-battle-title">
                    <button
                        type="button"
                        data-sfx="cancel"
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
                            <InkButton variant="ghost" sfx="cancel" onClick={() => setShowExitConfirm(false)}>
                                继续对局
                            </InkButton>
                            <InkButton variant="primary" sfx="primary" onClick={leaveBattle}>
                                确认退出
                            </InkButton>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
