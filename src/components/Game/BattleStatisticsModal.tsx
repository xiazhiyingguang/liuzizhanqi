import { useEffect, useMemo } from 'react';
import { getHeroBattleStatistics } from '../../core/battle-statistics';
import { useGameStore } from '../../store/game-store';
import type { BattleStatistics, Hero, Player } from '../../types/game';
import HeroAvatar from '../ui/HeroAvatar';
import InkButton from '../ui/InkButton';

interface BattleStatisticsModalProps {
    onClose: () => void;
}

interface BattleStatisticsPanelProps extends BattleStatisticsModalProps {
    gameState: ReturnType<typeof useGameStore.getState>;
}

const EMPTY_TOTALS: BattleStatistics = {
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    shieldAbsorbed: 0,
    kills: 0,
};

function isPrimaryHero(hero: Hero): boolean {
    return hero.counters?.['__isClone'] !== 1 && hero.counters?.['__isSummon'] !== 1;
}

function sumStatistics(items: BattleStatistics[]): BattleStatistics {
    return items.reduce((totals, item) => ({
        damageDealt: totals.damageDealt + item.damageDealt,
        damageTaken: totals.damageTaken + item.damageTaken,
        healingDone: totals.healingDone + item.healingDone,
        shieldAbsorbed: totals.shieldAbsorbed + item.shieldAbsorbed,
        kills: totals.kills + item.kills,
    }), { ...EMPTY_TOTALS });
}

function Metric({ label, value, maximum, tone }: {
    label: string;
    value: number;
    maximum: number;
    tone: 'red' | 'blue' | 'green';
}) {
    const width = maximum > 0 ? Math.max(value > 0 ? 5 : 0, value / maximum * 100) : 0;
    const color = tone === 'red'
        ? 'bg-vermillion/70'
        : tone === 'blue'
            ? 'bg-indigo-ink/65'
            : 'bg-[#668267]/75';

    return (
        <div className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[10px] text-ink-faint">{label}</span>
                <span className="font-mono text-sm font-semibold text-ink">{value}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-ink/5">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
            </div>
        </div>
    );
}

function TeamStatistics({
    player,
    label,
    heroes,
    winner,
    gameState,
    globalMaximum,
}: {
    player: Player;
    label: string;
    heroes: Hero[];
    winner?: Player;
    gameState: ReturnType<typeof useGameStore.getState>;
    globalMaximum: Pick<BattleStatistics, 'damageDealt' | 'damageTaken' | 'healingDone'>;
}) {
    const rows = heroes.filter(isPrimaryHero).map(hero => ({
        hero,
        statistics: getHeroBattleStatistics(gameState, hero),
    }));
    const totals = sumStatistics(rows.map(row => row.statistics));
    const isPlayerOne = player === 'player1';

    return (
        <section className="overflow-hidden rounded-2xl border border-ink/10 bg-rice-light/55">
            <header className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
                <div className="flex items-center gap-2.5">
                    <span className={`h-5 w-1 rounded-full ${isPlayerOne ? 'bg-indigo-ink' : 'bg-vermillion'}`} />
                    <h3 className={`font-title text-base ${isPlayerOne ? 'text-indigo-ink' : 'text-vermillion'}`}>
                        {label}
                    </h3>
                    {winner === player && (
                        <span className="rounded-full border border-gold/25 bg-gold/5 px-2 py-0.5 text-[9px] text-gold-dark">
                            胜方
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-ink-faint">
                    <span>总输出 <b className="font-mono text-ink">{totals.damageDealt}</b></span>
                    <span>总恢复 <b className="font-mono text-ink">{totals.healingDone}</b></span>
                </div>
            </header>

            <div className="divide-y divide-ink/10">
                {rows.map(({ hero, statistics }) => (
                    <article key={hero.id} className="grid grid-cols-[minmax(140px,1.1fr)_repeat(3,minmax(66px,1fr))] items-center gap-3 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <div className={`h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl border ${isPlayerOne ? 'border-indigo-ink/20' : 'border-vermillion/20'}`}>
                                <HeroAvatar
                                    heroId={hero.id}
                                    heroName={hero.name}
                                    size={40}
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate font-title text-sm text-ink">{hero.name}</div>
                                <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[9px] text-ink-faint">
                                    <span>{hero.class}</span>
                                    <span>击杀 {statistics.kills}</span>
                                    {statistics.shieldAbsorbed > 0 && <span>格挡 {statistics.shieldAbsorbed}</span>}
                                </div>
                            </div>
                        </div>
                        <Metric label="输出伤害" value={statistics.damageDealt} maximum={globalMaximum.damageDealt} tone="red" />
                        <Metric label="承受伤害" value={statistics.damageTaken} maximum={globalMaximum.damageTaken} tone="blue" />
                        <Metric label="恢复量" value={statistics.healingDone} maximum={globalMaximum.healingDone} tone="green" />
                    </article>
                ))}
            </div>
        </section>
    );
}

export function BattleStatisticsPanel({ gameState, onClose }: BattleStatisticsPanelProps) {
    const {
        player1Heroes,
        player2Heroes,
        winner,
        isOnlineMode,
        isAiMode,
        localPlayerNumber,
    } = gameState;

    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [onClose]);

    const globalMaximum = useMemo(() => {
        const statistics = [...player1Heroes, ...player2Heroes]
            .filter(isPrimaryHero)
            .map(hero => getHeroBattleStatistics(gameState, hero));
        return {
            damageDealt: Math.max(1, ...statistics.map(item => item.damageDealt)),
            damageTaken: Math.max(1, ...statistics.map(item => item.damageTaken)),
            healingDone: Math.max(1, ...statistics.map(item => item.healingDone)),
        };
    }, [gameState, player1Heroes, player2Heroes]);

    const player1Label = isOnlineMode
        ? (localPlayerNumber === 1 ? '我方' : '对手')
        : '玩家一';
    const player2Label = isOnlineMode
        ? (localPlayerNumber === 2 ? '我方' : '对手')
        : (isAiMode ? '宗师电脑' : '玩家二');

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="battle-statistics-title">
            <button
                type="button"
                className="absolute inset-0 bg-ink/65 backdrop-blur-md"
                aria-label="关闭伤害统计"
                onClick={onClose}
            />

            <div className="ink-card relative z-10 flex max-h-[88vh] w-[min(980px,calc(100vw-24px))] flex-col overflow-hidden animate-fade-up">
                <div className="relative border-b border-gold/15 px-6 py-5 text-center">
                    <div className="pointer-events-none absolute inset-x-12 top-1/2 h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent" />
                    <div className="relative inline-flex items-center gap-3 bg-rice-light px-5">
                        <span className="font-title text-sm text-gold-dark">战</span>
                        <div>
                            <h2 id="battle-statistics-title" className="font-title text-2xl tracking-[0.18em] text-ink">
                                战局统计
                            </h2>
                            <p className="mt-1 text-[10px] tracking-[0.25em] text-ink-faint">BATTLE RECORD</p>
                        </div>
                        <span className="font-title text-sm text-gold-dark">录</span>
                    </div>
                </div>

                <div className="light-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
                    <div className="grid gap-4 lg:grid-cols-2">
                        <TeamStatistics
                            player="player1"
                            label={player1Label}
                            heroes={player1Heroes}
                            winner={winner}
                            gameState={gameState}
                            globalMaximum={globalMaximum}
                        />
                        <TeamStatistics
                            player="player2"
                            label={player2Label}
                            heroes={player2Heroes}
                            winner={winner}
                            gameState={gameState}
                            globalMaximum={globalMaximum}
                        />
                    </div>

                    <p className="mt-4 text-center text-[10px] leading-5 text-ink-faint">
                        输出与承伤按实际生效值计算，包含护盾吸收；分身与召唤物贡献计入召唤者。
                    </p>
                </div>

                <div className="flex justify-center border-t border-gold/15 px-5 py-4">
                    <InkButton variant="secondary" size="sm" onClick={onClose}>
                        返回结算
                    </InkButton>
                </div>
            </div>
        </div>
    );
}

export default function BattleStatisticsModal({ onClose }: BattleStatisticsModalProps) {
    const gameState = useGameStore(state => state);
    return <BattleStatisticsPanel gameState={gameState} onClose={onClose} />;
}
