import { useEffect, useRef, useState } from 'react';
import type { Hero, Player } from '../../types/game';
import { getTurnOperatorLabel, KILL_ANNOUNCEMENT_TIERS, type KillAnnouncement } from '../../core/battle-presentation';
import type { BattlePhaseAnnouncement } from '../../core/battle-tempo';
import { audioManager } from '../../audio/audio-manager';
import { soundManager } from '../../core/sound-manager';
import HeroAvatar from '../ui/HeroAvatar';
import '../../styles/battle-tempo.css';

interface TurnActionBannerProps {
    currentPlayer: Player;
    hero: Hero | null;
    isOnlineMode: boolean;
    localPlayerNumber?: number;
    latestKillAnnouncement: KillAnnouncement | null;
    isAiMode?: boolean;
    aiPlayer?: Player;
    /** 激战入场横幅（第 20 / 25 回合各一次）；不传或为 null 时这一档不弹 */
    battlePhase?: BattlePhaseAnnouncement | null;
}

export default function TurnActionBanner({
    currentPlayer,
    hero,
    isOnlineMode,
    localPlayerNumber,
    latestKillAnnouncement,
    isAiMode = false,
    aiPlayer = 'player2',
    battlePhase = null,
}: TurnActionBannerProps) {
    const [visibleKill, setVisibleKill] = useState<KillAnnouncement | null>(null);
    // 激战横幅是"事件"而不是"状态"：挂载时就把当前这一档记成已看过，
    // 否则刷新页面或切屏回来会在第 20 回合重播一次入场。
    const [visiblePhase, setVisiblePhase] = useState<BattlePhaseAnnouncement | null>(null);
    const seenPhaseId = useRef<string | null>(battlePhase?.id ?? null);
    const battlePhaseRef = useRef(battlePhase);
    battlePhaseRef.current = battlePhase;
    const battlePhaseId = battlePhase?.id ?? null;
    const latestKillRef = useRef(latestKillAnnouncement);
    latestKillRef.current = latestKillAnnouncement;
    const latestKillId = latestKillAnnouncement?.id;
    const isPlayerOne = currentPlayer === 'player1';
    const operatorLabel = getTurnOperatorLabel(currentPlayer, isOnlineMode, localPlayerNumber, isAiMode, aiPlayer);

    useEffect(() => {
        const phase = battlePhaseRef.current;
        if (!phase || seenPhaseId.current === phase.id) return;
        seenPhaseId.current = phase.id;
        setVisiblePhase(phase);
    }, [battlePhaseId]);

    // 计时挂在 visiblePhase 上而不是入参上：下一回合 battlePhase 变回 null 时不能顺手清掉这次的下播定时器
    useEffect(() => {
        if (!visiblePhase) return;
        const timer = window.setTimeout(() => {
            setVisiblePhase(current => current?.id === visiblePhase.id ? null : current);
        }, 3600);
        return () => window.clearTimeout(timer);
    }, [visiblePhase]);

    useEffect(() => {
        if (!visiblePhase || soundManager.isMuted()) return;
        audioManager.playKillFanfare(visiblePhase.tier === 2 ? 4 : 2);
    }, [visiblePhase]);

    useEffect(() => {
        const announcement = latestKillRef.current;
        if (!announcement) return;

        setVisibleKill(announcement);
        // 五杀/六杀才有号角（planKillFanfare 对低档位返回 null，这里不用判断档位）。
        // 战斗音效单独静音时不响；右下角「静」由 audioManager 的总线自己压掉。
        if (!soundManager.isMuted()) audioManager.playKillFanfare(announcement.tier);
        const timer = window.setTimeout(() => {
            setVisibleKill(current => current?.id === announcement.id ? null : current);
        }, 3000);

        return () => window.clearTimeout(timer);
    }, [latestKillId]);

    const bannerPlayer = visibleKill?.player ?? currentPlayer;
    const bannerIsPlayerOne = bannerPlayer === 'player1';
    const ariaLabel = visibleKill
        ? `${visibleKill.killerName}${visibleKill.title}，击杀${visibleKill.victimName}`
        : visiblePhase
            ? `${visiblePhase.title}：${visiblePhase.note}`
            : `${operatorLabel}当前行动${hero ? `，正在操作${hero.name}` : '，等待选择英雄'}`;

    return (
        <section
            aria-live="polite"
            aria-label={ariaLabel}
            className={`battle-turn-banner relative flex h-[60px] w-[min(520px,calc(100%-24px))] flex-shrink-0 items-center gap-3 overflow-hidden
                rounded-xl border px-4 py-2 shadow-[0_7px_24px_rgba(26,26,26,0.08)] backdrop-blur-sm transition-colors
                ${bannerIsPlayerOne
                    ? 'border-indigo-ink/25 bg-[#eef0f5]/90'
                    : 'border-vermillion/25 bg-[#f7eeea]/90'}`}
        >
            {visibleKill ? (
                <div
                    key={visibleKill.id}
                    className={`kill-announcement kill-announcement--${visibleKill.tier}`}
                >
                    <span className="kill-announcement__flare" aria-hidden="true" />
                    <span className="kill-announcement__slash kill-announcement__slash--one" aria-hidden="true" />
                    {visibleKill.tier >= 2 && (
                        <span className="kill-announcement__slash kill-announcement__slash--two" aria-hidden="true" />
                    )}
                    {visibleKill.tier >= 5 && (
                        <span className="kill-announcement__slash kill-announcement__slash--three" aria-hidden="true" />
                    )}

                    <div className="kill-announcement__content">
                        <div className="kill-announcement__portrait">
                            <HeroAvatar
                                heroId={visibleKill.killerHeroId}
                                heroName={visibleKill.killerName}
                                size={42}
                                className="h-full w-full object-cover"
                                fallbackClassName={bannerIsPlayerOne ? 'text-indigo-ink' : 'text-vermillion'}
                                eager
                            />
                            <span className="kill-announcement__portrait-ring" aria-hidden="true" />
                        </div>

                        <div className="min-w-0 flex-1 text-center">
                            <p className="kill-announcement__eyebrow">{visibleKill.eyebrow}</p>
                            <p className="kill-announcement__title">{visibleKill.title}</p>
                            <p className="kill-announcement__duel">
                                <strong>{visibleKill.killerName}</strong>
                                <span> 击破 </span>
                                <strong>{visibleKill.victimName}</strong>
                            </p>
                        </div>

                        <div className="kill-announcement__marks" aria-hidden="true">
                            {KILL_ANNOUNCEMENT_TIERS.map(mark => (
                                <span key={mark} className={mark <= visibleKill.tier ? 'is-lit' : ''} />
                            ))}
                        </div>
                    </div>
                </div>
            ) : visiblePhase ? (
                <div
                    key={visiblePhase.id}
                    className={`phase-announcement phase-announcement--${visiblePhase.tier}`}
                >
                    <span className="phase-announcement__flare" aria-hidden="true" />
                    <span className="phase-announcement__slash" aria-hidden="true" />
                    {visiblePhase.tier >= 2 && (
                        <span className="phase-announcement__slash phase-announcement__slash--two" aria-hidden="true" />
                    )}

                    <div className="phase-announcement__content">
                        <div className="phase-announcement__seal">
                            {/* 一层刻「激」、二层刻「战」：两档拼成完整的"激战"，一眼看出是升档不是重来 */}
                            <span className="phase-announcement__seal-glyph">{visiblePhase.tier >= 2 ? '战' : '激'}</span>
                            <span className="phase-announcement__seal-ring" aria-hidden="true" />
                        </div>

                        <div className="phase-announcement__text">
                            <p className="phase-announcement__eyebrow">{visiblePhase.eyebrow}</p>
                            <p className="phase-announcement__title">{visiblePhase.title}</p>
                            <p className="phase-announcement__note">{visiblePhase.note}</p>
                        </div>

                        <div className="phase-announcement__marks" aria-hidden="true">
                            {[1, 2].map(mark => (
                                <span key={mark} className={mark <= visiblePhase.tier ? 'is-lit' : ''} />
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <span className={`absolute inset-y-0 left-0 w-1 ${isPlayerOne ? 'bg-indigo-ink' : 'bg-vermillion'}`} />

                    <div className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2
                        ${isPlayerOne ? 'border-indigo-ink/35 bg-indigo-ink/10' : 'border-vermillion/35 bg-vermillion/10'}`}
                    >
                        {hero ? (
                            <HeroAvatar
                                heroId={hero.id}
                                heroName={hero.name}
                                size={36}
                                className="h-full w-full object-cover"
                                fallbackClassName={isPlayerOne ? 'text-indigo-ink' : 'text-vermillion'}
                                eager
                            />
                        ) : (
                            <span className={`font-title text-sm ${isPlayerOne ? 'text-indigo-ink' : 'text-vermillion'}`}>
                                {isPlayerOne ? '一' : '二'}
                            </span>
                        )}
                        <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#f5f0e8]
                            ${isPlayerOne ? 'bg-indigo-ink' : 'bg-vermillion'} animate-pulse`}
                        />
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className={`font-title text-sm ${isPlayerOne ? 'text-indigo-ink' : 'text-vermillion'}`}>
                                {operatorLabel}
                            </span>
                            <span className="rounded-full border border-gold/20 bg-gold/5 px-2 py-0.5 text-[9px] text-gold-dark font-body">
                                {isAiMode && currentPlayer === aiPlayer ? '正在思考' : '当前行动'}
                            </span>
                        </div>
                        <p className="mt-0.5 h-5 truncate font-body text-xs leading-5 text-ink-light">
                            {hero ? (
                                <>正在操作 <strong className="font-title text-sm font-normal leading-5 text-ink">{hero.name}</strong></>
                            ) : (isAiMode && currentPlayer === aiPlayer ? '正在评估棋局与最佳行动' : '等待选择本次行动英雄')}
                        </p>
                    </div>

                    <div className="hidden flex-shrink-0 items-center gap-1.5 sm:flex" aria-hidden="true">
                        {[0, 1, 2].map(index => (
                            <span
                                key={index}
                                className={`h-1.5 w-1.5 rounded-full ${isPlayerOne ? 'bg-indigo-ink/45' : 'bg-vermillion/45'} animate-pulse`}
                                style={{ animationDelay: `${index * 180}ms` }}
                            />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}
