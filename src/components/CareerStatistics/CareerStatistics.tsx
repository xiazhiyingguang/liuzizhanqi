import { useMemo, useState } from 'react';
import {
    CareerStatisticsData,
    clearCareerStatistics,
    createEmptyCareerStatistics,
    getHeroCareerMetrics,
    HeroCareerMetrics,
    readCareerStatistics,
} from '../../services/career-statistics';
import { useGameStore } from '../../store/game-store';
import HeroAvatar from '../ui/HeroAvatar';
import InkButton from '../ui/InkButton';

type SortKey = 'pickRate' | 'winRate' | 'averageDamageDealt' | 'averageDamageTaken' | 'averageSurvivalRounds';

interface CareerStatisticsPanelProps {
    data: CareerStatisticsData;
    onBack: () => void;
    onClear: () => void;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'pickRate', label: '登场率' },
    { key: 'winRate', label: '胜率' },
    { key: 'averageDamageDealt', label: '平均输出' },
    { key: 'averageDamageTaken', label: '平均承伤' },
    { key: 'averageSurvivalRounds', label: '存活轮数' },
];

function formatNumber(value: number, digits = 0): string {
    return value.toLocaleString('zh-CN', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
    });
}

function SummaryCard({ mark, label, value, detail }: {
    mark: string;
    label: string;
    value: string;
    detail: string;
}) {
    return (
        <article className="relative overflow-hidden rounded-2xl border border-ink/10 bg-rice-light/70 px-5 py-4 shadow-sm">
            <span className="absolute -right-2 -top-5 font-title text-7xl text-ink/[0.035]" aria-hidden="true">{mark}</span>
            <div className="text-[10px] tracking-[0.2em] text-ink-faint">{label}</div>
            <div className="mt-1 font-title text-3xl text-ink">{value}</div>
            <div className="mt-1 text-[10px] text-ink-faint">{detail}</div>
        </article>
    );
}

function RateMetric({ label, value, detail, tone }: {
    label: string;
    value: number;
    detail: string;
    tone: 'gold' | 'red';
}) {
    const color = tone === 'red' ? 'bg-vermillion/70' : 'bg-gold/70';
    return (
        <div className="min-w-[105px]">
            <div className="flex items-end justify-between gap-2">
                <span className="text-[10px] tracking-wider text-ink-faint">{label}</span>
                <strong className="font-mono text-base text-ink">{formatNumber(value, 1)}%</strong>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.06]">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
            </div>
            <div className="mt-1 text-right text-[9px] text-ink-faint">{detail}</div>
        </div>
    );
}

function ValueMetric({ label, value, maximum, suffix = '' }: {
    label: string;
    value: number;
    maximum: number;
    suffix?: string;
}) {
    const width = maximum > 0 ? value / maximum * 100 : 0;
    return (
        <div className="min-w-[105px]">
            <div className="flex items-end justify-between gap-2">
                <span className="text-[10px] tracking-wider text-ink-faint">{label}</span>
                <strong className="font-mono text-base text-ink">{formatNumber(value, 1)}{suffix}</strong>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.06]">
                <div className="h-full rounded-full bg-indigo-ink/60" style={{ width: `${Math.min(100, Math.max(value > 0 ? 4 : 0, width))}%` }} />
            </div>
        </div>
    );
}

function HeroRecordRow({ record, rank, maximumDamage, maximumDamageTaken, maximumSurvival }: {
    record: HeroCareerMetrics;
    rank: number;
    maximumDamage: number;
    maximumDamageTaken: number;
    maximumSurvival: number;
}) {
    return (
        <article className="rounded-2xl border border-ink/[0.08] bg-white/45 px-4 py-3 transition-colors hover:bg-white/70">
            <div className="grid min-w-[880px] grid-cols-[minmax(205px,1.35fr)_repeat(5,minmax(105px,1fr))] items-center gap-5">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="w-6 flex-none text-center font-title text-sm text-gold-dark">{rank}</span>
                    <div className="h-12 w-12 flex-none overflow-hidden rounded-xl border border-ink/10 bg-rice-dark/50">
                        <HeroAvatar
                            heroId={record.heroId}
                            heroName={record.name}
                            size={48}
                            className="h-full w-full object-cover"
                            fallbackClassName="h-full w-full"
                        />
                    </div>
                    <div className="min-w-0">
                        <h3 className="truncate font-title text-lg text-ink">{record.name}</h3>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-ink-faint">
                            <span>{record.heroClass}</span>
                            <span>场均击杀 {formatNumber(record.averageKills, 1)}</span>
                        </div>
                    </div>
                </div>

                <RateMetric
                    label="登场率"
                    value={record.pickRate}
                    detail={`${record.appearances} 次登场`}
                    tone="gold"
                />
                <RateMetric
                    label="胜率"
                    value={record.winRate}
                    detail={`${record.wins} 胜 / ${record.appearances} 场`}
                    tone="red"
                />
                <ValueMetric label="场均输出" value={record.averageDamageDealt} maximum={maximumDamage} />
                <ValueMetric label="平均承伤" value={record.averageDamageTaken} maximum={maximumDamageTaken} />
                <ValueMetric label="平均存活" value={record.averageSurvivalRounds} maximum={maximumSurvival} suffix="轮" />
            </div>

            <div className="ml-9 mt-2 flex min-w-[720px] flex-wrap gap-x-5 gap-y-1 border-t border-ink/[0.05] pt-2 text-[9px] text-ink-faint">
                <span>场均恢复 <b className="font-mono font-normal text-ink-light">{formatNumber(record.averageHealingDone, 1)}</b></span>
                <span>场均格挡 <b className="font-mono font-normal text-ink-light">{formatNumber(record.averageShieldAbsorbed, 1)}</b></span>
                <span>累计输出 <b className="font-mono font-normal text-ink-light">{formatNumber(record.totalDamageDealt)}</b></span>
            </div>
        </article>
    );
}

export function CareerStatisticsPanel({ data, onBack, onClear }: CareerStatisticsPanelProps) {
    const [sortKey, setSortKey] = useState<SortKey>('pickRate');
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    const records = useMemo(() => Object.values(data.heroes)
        .map(record => getHeroCareerMetrics(record, data.totalMatches))
        .sort((left, right) => right[sortKey] - left[sortKey] || right.appearances - left.appearances || left.name.localeCompare(right.name, 'zh-CN')),
    [data, sortKey]);

    const maximumDamage = Math.max(1, ...records.map(record => record.averageDamageDealt));
    const maximumDamageTaken = Math.max(1, ...records.map(record => record.averageDamageTaken));
    const maximumSurvival = Math.max(1, ...records.map(record => record.averageSurvivalRounds));
    const averageRounds = data.totalMatches > 0 ? data.totalRounds / data.totalMatches : 0;
    const updatedLabel = data.updatedAt
        ? new Date(data.updatedAt).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
        : '尚无记录';

    return (
        <main className="ink-paper relative flex h-full min-h-screen flex-col overflow-hidden text-ink">
            <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden="true">
                <div className="absolute -left-28 top-24 h-72 w-72 rounded-full bg-indigo-ink/[0.06] blur-3xl" />
                <div className="absolute -right-24 bottom-10 h-80 w-80 rounded-full bg-gold/[0.08] blur-3xl" />
            </div>

            <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 bg-rice-light/75 px-5 py-4 backdrop-blur-md sm:px-8">
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        data-sfx="cancel"
                        onClick={onBack}
                        className="rounded-lg border border-ink/10 bg-white/45 px-3 py-2 text-sm text-ink-light transition hover:border-ink/25 hover:bg-white/75"
                    >
                        ← 返回主界面
                    </button>
                    <div className="h-9 w-px bg-gold/20" />
                    <div>
                        <div className="flex items-baseline gap-3">
                            <h1 className="font-title text-3xl tracking-[0.16em] text-ink">弈谱</h1>
                            <span className="text-[10px] tracking-[0.25em] text-gold-dark">CAREER RECORD</span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-faint">本机长期战绩 · 观往局而知阵势</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-ink-faint">
                    <span>更新于 {updatedLabel}</span>
                    <InkButton
                        variant="ghost"
                        size="sm"
                        disabled={data.totalMatches === 0}
                        onClick={() => setShowClearConfirm(true)}
                    >
                        清空记录
                    </InkButton>
                </div>
            </header>

            <div className="light-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
                <div className="mx-auto max-w-6xl">
                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="长期战绩总览">
                        <SummaryCard mark="局" label="累计对局" value={`${data.totalMatches}`} detail={`平均 ${formatNumber(averageRounds, 1)} 回合`} />
                        <SummaryCard mark="机" label="人机对战" value={`${data.modeMatches.ai}`} detail="宗师电脑对局" />
                        <SummaryCard mark="双" label="本地双人" value={`${data.modeMatches.local}`} detail="同屏对弈记录" />
                        <SummaryCard mark="联" label="联机对战" value={`${data.modeMatches.online}`} detail="局域网对局记录" />
                    </section>

                    <section className="mt-6 overflow-hidden rounded-3xl border border-ink/10 bg-rice-light/60 shadow-[0_18px_60px_rgba(45,38,28,0.08)]">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gold/15 px-5 py-4">
                            <div>
                                <h2 className="font-title text-2xl text-ink">群英战录</h2>
                                <p className="mt-1 text-[10px] tracking-wider text-ink-faint">登场率按全部对局的双方阵容次数计算</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5" aria-label="统计排序方式">
                                {SORT_OPTIONS.map(option => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        data-sfx="tab"
                                        onClick={() => setSortKey(option.key)}
                                        className={`rounded-full border px-3 py-1.5 text-[10px] transition ${
                                            sortKey === option.key
                                                ? 'border-vermillion/35 bg-vermillion/[0.07] text-vermillion'
                                                : 'border-ink/10 bg-white/35 text-ink-faint hover:border-ink/20 hover:text-ink'
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {records.length > 0 ? (
                            <div className="light-scrollbar overflow-x-auto p-4">
                                <div className="space-y-2">
                                    {records.map((record, index) => (
                                        <HeroRecordRow
                                            key={record.heroId}
                                            record={record}
                                            rank={index + 1}
                                            maximumDamage={maximumDamage}
                                            maximumDamageTaken={maximumDamageTaken}
                                            maximumSurvival={maximumSurvival}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                                <span className="ink-seal text-4xl opacity-40">谱</span>
                                <h3 className="mt-5 font-title text-2xl text-ink">弈谱尚待落笔</h3>
                                <p className="mt-2 max-w-md text-sm leading-6 text-ink-faint">
                                    完成一局人机、本地双人或联机对战后，系统会自动记录双方英雄的长期表现。
                                </p>
                            </div>
                        )}
                    </section>

                    <p className="py-5 text-center text-[10px] leading-5 text-ink-faint">
                        数据仅保存在当前浏览器中；清理浏览器站点数据后记录会消失。同一局结算无论打开多少次都只统计一次。
                    </p>
                </div>
            </div>

            {showClearConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="clear-career-title">
                    <button
                        type="button"
                        data-sfx="cancel"
                        className="absolute inset-0 bg-ink/55 backdrop-blur-sm"
                        aria-label="取消清空记录"
                        onClick={() => setShowClearConfirm(false)}
                    />
                    <div className="ink-card relative z-10 w-[min(420px,calc(100vw-32px))] p-8 text-center">
                        <h2 id="clear-career-title" className="font-title text-2xl text-ink">清空全部弈谱？</h2>
                        <p className="mt-3 text-sm leading-6 text-ink-faint">所有长期对局与英雄统计将被永久删除，此操作无法撤销。</p>
                        <div className="mt-7 flex justify-center gap-3">
                            <InkButton variant="ghost" sfx="cancel" onClick={() => setShowClearConfirm(false)}>保留记录</InkButton>
                            <InkButton
                                variant="primary"
                                sfx="primary"
                                onClick={() => {
                                    onClear();
                                    setShowClearConfirm(false);
                                }}
                            >
                                确认清空
                            </InkButton>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

export default function CareerStatistics() {
    const [data, setData] = useState(() => readCareerStatistics());
    return (
        <CareerStatisticsPanel
            data={data}
            onBack={() => useGameStore.setState({ phase: 'menu' })}
            onClear={() => {
                clearCareerStatistics();
                setData(createEmptyCareerStatistics());
            }}
        />
    );
}
