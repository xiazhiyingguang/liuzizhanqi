import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useBattleReplay } from '../../hooks/useBattleReplay';
import { computeFrameDeltas, type BattleReplay, type ReplayMarkKind } from '../../core/battle-replay';
import { tokenizeBattleLogContent } from '../../core/battle-presentation';
import ReplayBoard from './ReplayBoard';
import HeroAvatar from '../ui/HeroAvatar';
import InkButton from '../ui/InkButton';
import type { BattleLogEntry } from '../../types/game';

interface BattleReplayModalProps {
    onClose: () => void;
}

const MARK_LABELS: Record<ReplayMarkKind, string> = {
    kill: '击杀',
    tianwei: '天威',
    reinforce: '补员',
    critical: '濒危',
    round: '回合',
    end: '终局',
};

/** 图例只讲时间轴上真会出现的刻度类型；回合切换由上轨的分段带承载 */
const LEGEND_KINDS: ReplayMarkKind[] = ['kill', 'tianwei', 'reinforce', 'critical', 'end'];

const PLAY_INTERVAL_MS = 720;

/**
 * 对局回放弹层。
 *
 * 外壳沿用伤害统计 modal 的既有约定（遮罩按钮 + data-sfx + Escape 关闭 + 纯面板分层），
 * 面板 `BattleReplayPanel` 只吃 `replay` 数据，便于单测直接喂构造好的录像。
 */
export default function BattleReplayModal({ onClose }: BattleReplayModalProps) {
    const replay = useBattleReplay();
    return <BattleReplayPanel replay={replay} onClose={onClose} />;
}

export function BattleReplayPanel({ replay, onClose }: BattleReplayModalProps & { replay: BattleReplay }) {
    const [frameIndex, setFrameIndex] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [historyOpen, setHistoryOpen] = useState(false);
    const narrationRef = useRef<HTMLDivElement>(null);

    const frames = replay.frames;
    const lastIndex = Math.max(0, frames.length - 1);
    const current = Math.min(Math.max(0, frameIndex), lastIndex);
    const frame = frames[current];
    const previous = current > 0 ? frames[current - 1] : null;

    const deltas = useMemo(() => {
        const map = new Map<number, number>();
        if (!frame) return map;
        for (const delta of computeFrameDeltas(previous, frame)) map.set(delta.def, delta.hp);
        return map;
    }, [frame, previous]);

    // 上轨的回合分段：把连续同回合的帧并成一段，点段头直接跳到该回合首步
    const rounds = useMemo(() => {
        const segments: Array<{ round: number; from: number; to: number }> = [];
        frames.forEach((entry, index) => {
            const tail = segments[segments.length - 1];
            if (tail && tail.round === entry.round) tail.to = index;
            else segments.push({ round: entry.round, from: index, to: index });
        });
        return segments;
    }, [frames]);

    // 事件跳转用的帧序列：同一帧上的多个节点并成一个落点。
    // 回合切换不在此列——它由时间轴上轨的分段带承载，再做成刻度只会把真正的击杀淹掉。
    const eventMarks = useMemo(() => replay.marks.filter(mark => mark.kind !== 'round'), [replay.marks]);
    const eventFrames = useMemo(
        () => Array.from(new Set(eventMarks.map(mark => mark.frame))).sort((left, right) => left - right),
        [eventMarks]
    );

    // 播放到最后一帧自动停住（在 effect 里停，避免在 setState 更新函数中产生副作用）
    useEffect(() => {
        if (playing && current >= lastIndex) setPlaying(false);
    }, [playing, current, lastIndex]);

    useEffect(() => {
        if (!playing) return;
        const timer = window.setInterval(() => {
            setFrameIndex(index => Math.min(index + 1, lastIndex));
        }, PLAY_INTERVAL_MS / speed);
        return () => window.clearInterval(timer);
    }, [playing, speed, lastIndex]);

    const seek = useCallback((index: number) => {
        setPlaying(false);
        setFrameIndex(Math.min(Math.max(index, 0), lastIndex));
    }, [lastIndex]);

    const stepBy = useCallback((amount: number) => {
        setPlaying(false);
        setFrameIndex(index => Math.min(Math.max(index + amount, 0), lastIndex));
    }, [lastIndex]);

    const stepEvent = useCallback((direction: -1 | 1) => {
        const target = direction < 0
            ? [...eventFrames].reverse().find(index => index < current)
            : eventFrames.find(index => index > current);
        if (target !== undefined) seek(target);
    }, [eventFrames, current, seek]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                stepBy(-1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                stepBy(1);
            } else if (event.key === ' ') {
                event.preventDefault();
                setPlaying(value => !value);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose, stepBy]);

    useEffect(() => {
        // 拖时间轴时这份面板重排：必须停在顶端，否则"本步战报"被顶出可视区，
        // 看到的反而是下面一叠旧战报，读起来像内容在乱跳
        const panel = narrationRef.current;
        if (panel) panel.scrollTop = 0;
    }, [current]);

    if (!frame) {
        return (
            <Shell onClose={onClose}>
                <p className="p-8 text-center text-sm text-ink-faint">本局没有可回放的记录。</p>
            </Shell>
        );
    }

    const heroReferences = replay.statics.map(entry => ({ name: entry.name, owner: entry.owner }));
    const stepLogs = replay.narration.slice(frame.logFrom, Math.max(frame.logTo, frame.logFrom));
    const earlierLogs = replay.narration.slice(Math.max(0, frame.logFrom - 12), frame.logFrom);
    const actor = frame.actor >= 0 ? frame.units[frame.actor] : undefined;
    const actorName = actor ? replay.statics[actor.def]?.name : undefined;
    const sideLabel = frame.player === 'player1' ? '玩家一' : '玩家二';
    const currentMarks = eventMarks.filter(mark => mark.frame === current);

    return (
        <Shell onClose={onClose}>
            <div className="battle-replay-card relative z-10 flex h-[min(96vh,980px)] w-[min(1400px,97vw)] flex-col overflow-hidden ink-card animate-fade-up">
                <header className="replay-header flex min-h-[64px] items-center gap-4 border-b border-gold/15 px-5 py-2.5">
                    <h2 id="battle-replay-title" className="font-title text-lg flex-shrink-0 text-ink">对局回放</h2>

                    {/* 读数条：看到哪一步、哪一回合、谁在行动，全部留在视线所在的上方一条带里 */}
                    <div className="replay-readout min-w-0 flex-1 flex items-baseline gap-x-3 gap-y-1 flex-wrap">
                        <span className="replay-readout-step" title={`第 ${current + 1} / ${frames.length} 步`}>
                            第 <b>{current + 1}</b> / {frames.length} 步
                        </span>
                        <span className="replay-readout-cell">第 <b>{frame.round}</b> 回合</span>
                        <span className={`replay-readout-cell replay-readout-side replay-readout-side-${frame.player}`}>
                            {sideLabel}行动
                        </span>
                        {actorName && <span className="replay-readout-cell replay-readout-actor">行动者 <b>{actorName}</b></span>}
                        {currentMarks.length > 0 && (
                            <span className="replay-readout-cell replay-readout-events">
                                {currentMarks.map(mark => (
                                    <span key={`${mark.kind}-${mark.label}`} className={`replay-mark-tag replay-mark-${mark.kind}`} title={mark.label}>
                                        {MARK_LABELS[mark.kind]}
                                    </span>
                                ))}
                            </span>
                        )}
                        {replay.coarsened && (
                            <span className="replay-readout-cell text-[11px] text-ink-faint">为节省内存已按回合抽样</span>
                        )}
                    </div>

                    <div className="replay-header-tail flex flex-shrink-0 items-center gap-3">
                        <span className="replay-legend text-[10px] text-ink-faint">
                            {LEGEND_KINDS.map(kind => (
                                <span key={kind} className="replay-legend-item">
                                    <i className={`replay-legend-dot replay-mark-${kind}`} />
                                    {MARK_LABELS[kind]}
                                </span>
                            ))}
                        </span>
                        <span className="replay-keyboard-hint text-[11px] text-ink-faint">← → 逐步，空格播放</span>
                        <InkButton variant="ghost" size="sm" sfx="cancel" onClick={onClose}>关闭</InkButton>
                    </div>
                </header>

                <div className="replay-content grid min-h-0 flex-1 justify-center gap-5 overflow-hidden p-4">
                    <ReplaySideRail replay={replay} frameIndex={current} owner="player1" />

                    <div className="replay-stage replay-stable-scroll flex min-h-0 min-w-0 flex-col items-center gap-3 overflow-y-auto light-scrollbar">
                        <ReplayBoard frame={frame} statics={replay.statics} deltas={deltas} />

                        {/* 战报与棋盘同宽：读棋 → 读战报是上下一次扫视，不再横跳 320px */}
                        <section className="replay-narration-box flex min-h-0 flex-col rounded-lg border border-ink/8 bg-rice-light/60">
                            <h3 className="flex items-center justify-between gap-2 border-b border-ink/8 px-3 py-1.5 font-title text-sm text-ink">
                                <span>本步战报</span>
                                <button
                                    type="button"
                                    className="replay-history-toggle text-[11px] font-body text-ink-faint hover:text-ink"
                                    onClick={() => setHistoryOpen(value => !value)}
                                >
                                    {historyOpen ? '收起前文 ▴' : `展开前文 ${earlierLogs.length} 条 ▾`}
                                </button>
                            </h3>
                            <div ref={narrationRef} className="replay-log-scroll replay-stable-scroll min-h-0 overflow-y-auto light-scrollbar px-3 py-2">
                                {stepLogs.length === 0 ? (
                                    <p className="text-[12px] text-ink-faint">（本步没有产生新战报，多为流程推进或站位变化）</p>
                                ) : stepLogs.map(entry => (
                                    <ReplayLogLine key={entry.id} entry={entry} heroReferences={heroReferences} strong />
                                ))}
                                {historyOpen && earlierLogs.length > 0 && (
                                    <div className="mt-2 border-t border-dashed border-ink/10 pt-2 opacity-55">
                                        {earlierLogs.map(entry => (
                                            <ReplayLogLine key={entry.id} entry={entry} heroReferences={heroReferences} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>

                    <ReplaySideRail replay={replay} frameIndex={current} owner="player2" />
                </div>

                <footer className="replay-footer border-t border-gold/15 px-5 pb-3 pt-2">
                    <div className="replay-transport mb-1.5 flex items-center gap-2">
                        <div className="replay-transport-group flex items-center gap-1.5">
                            <button type="button" className="replay-btn" onClick={() => seek(0)} aria-label="回到开局">⏮</button>
                            <button type="button" className="replay-btn" onClick={() => stepBy(-1)} aria-label="上一步">‹</button>
                            <button type="button" className="replay-btn replay-btn-play" onClick={() => setPlaying(value => !value)} aria-label={playing ? '暂停' : '播放'}>
                                {playing ? '❚❚' : '▶'}
                            </button>
                            <button type="button" className="replay-btn" onClick={() => stepBy(1)} aria-label="下一步">›</button>
                            <button type="button" className="replay-btn" onClick={() => seek(lastIndex)} aria-label="跳到末步">⏭</button>
                        </div>
                        <select
                            className="replay-speed"
                            value={speed}
                            onChange={event => setSpeed(Number(event.target.value))}
                            aria-label="播放速度"
                        >
                            <option value={0.5}>0.5×</option>
                            <option value={1}>1×</option>
                            <option value={2}>2×</option>
                        </select>

                        <div className="replay-transport-group ml-2 flex items-center gap-1.5">
                            <button
                                type="button"
                                className="replay-btn replay-btn-event"
                                onClick={() => stepEvent(-1)}
                                disabled={!eventFrames.some(index => index < current)}
                                aria-label="上一个关键节点"
                            >
                                ⟨ 上一事件
                            </button>
                            <button
                                type="button"
                                className="replay-btn replay-btn-event"
                                onClick={() => stepEvent(1)}
                                disabled={!eventFrames.some(index => index > current)}
                                aria-label="下一个关键节点"
                            >
                                下一事件 ⟩
                            </button>
                        </div>

                        <span className="replay-action-count ml-auto text-[11px] text-ink-faint" title="本步已用 / 需要的行动次数">
                            行动 {frame.actions}/{frame.required}
                        </span>
                    </div>

                    <div className="replay-timeline">
                        {/* 上轨：回合分段带。长局里"跳到第 7 回合"比在刻度堆里找要直接得多 */}
                        <div className="replay-rounds">
                            {rounds.map(segment => (
                                <button
                                    key={`round-${segment.round}-${segment.from}`}
                                    type="button"
                                    className={`replay-round-band${segment.round === frame.round ? ' is-current' : ''}`}
                                    style={trackSpanStyle(segment.from, segment.to, lastIndex)}
                                    onClick={() => seek(segment.from)}
                                    title={`第 ${segment.round} 回合 · 第 ${segment.from + 1}–${segment.to + 1} 步`}
                                >
                                    {/* 段太窄时不写回合号：被裁成半个"R"比空着更像错字 */}
                                    {(lastIndex <= 0 || (segment.to - segment.from) / lastIndex > 0.035) ? (
                                        <span className="replay-round-label">R{segment.round}</span>
                                    ) : null}
                                </button>
                            ))}
                        </div>

                        <div className="replay-track">
                            {/* 中轨：关键节点刻度直接落在拖拽轨上，可点可悬停；
                                原来那叠「击杀 #146」chip 的跳转职责交给它 + 上一/下一事件按钮 */}
                            {eventMarks.map(mark => (
                                <button
                                    key={`event-${mark.frame}-${mark.kind}`}
                                    type="button"
                                    className={`replay-event replay-mark-${mark.kind}${mark.frame === current ? ' is-current' : ''}`}
                                    style={trackRatioStyle(lastIndex > 0 ? mark.frame / lastIndex : 0)}
                                    onClick={() => seek(mark.frame)}
                                    title={`${MARK_LABELS[mark.kind]} · 第 ${mark.frame + 1} 步 · ${mark.label}`}
                                />
                            ))}
                            <input
                                type="range"
                                min={0}
                                max={lastIndex}
                                value={current}
                                onChange={event => seek(Number(event.target.value))}
                                className="replay-scrub"
                                aria-label="回放时间轴"
                            />
                        </div>
                    </div>
                </footer>
            </div>
        </Shell>
    );
}

/** 刻度/事件点的横向定位：与 range thumb 的可行程（两端各内缩半个 thumb）对齐 */
function trackRatioStyle(ratio: number): CSSProperties {
    return { '--replay-ratio': Number.isFinite(ratio) ? ratio : 0 } as CSSProperties;
}

/** 回合分段的起止：同一套内缩算法，三段轨道必须严丝合缝对得上 */
function trackSpanStyle(from: number, to: number, lastIndex: number): CSSProperties {
    if (lastIndex <= 0) return { '--replay-ratio': 0, '--replay-span': 1 } as CSSProperties;
    return {
        '--replay-ratio': from / lastIndex,
        '--replay-span': (to - from) / lastIndex,
    } as CSSProperties;
}

function Shell({ children, onClose }: BattleReplayModalProps & { children: React.ReactNode }) {
    return (
        <div className="battle-replay-modal fixed inset-0 z-[75] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="battle-replay-title">
            <button
                type="button"
                data-sfx="cancel"
                className="absolute inset-0 bg-ink/65 backdrop-blur-md"
                aria-label="关闭对局回放"
                onClick={onClose}
            />
            {children}
        </div>
    );
}

/**
 * 单侧阵容舷：棋盘只能看到"此刻在场的人"，待命、暂亡、真实阵亡都必须在这里可见，
 * 否则回放里会"凭空少人"。
 */
function ReplaySideRail({
    replay,
    frameIndex,
    owner,
}: {
    replay: BattleReplay;
    frameIndex: number;
    owner: 'player1' | 'player2';
}) {
    const frame = replay.frames[frameIndex];
    // 名单按登记顺序（= 上场顺序）排，绝不按血量排：
    // 血量每步都在变，按血量排会让名字在逐帧翻动时来回跳位。
    const units = frame.units.filter(unit => replay.statics[unit.def]?.owner === owner);
    const alive = units.filter(unit => unit.state !== 2).length;
    const actorDef = frame.actor >= 0 ? frame.units[frame.actor]?.def : -1;

    return (
        <section
            data-owner={owner}
            className={`replay-roster replay-side-rail replay-rail-${owner} flex min-h-0 flex-col rounded-lg border border-ink/8 bg-rice-light/60 px-2.5 py-2`}
        >
            <h4 className="replay-rail-head mb-1.5 flex-shrink-0 flex items-baseline justify-between gap-2">
                <span className="font-title text-sm text-ink">{owner === 'player1' ? '玩家一' : '玩家二'}</span>
                <span className="replay-rail-count text-[10px] text-ink-faint">存活 {alive}/{units.length}</span>
            </h4>
            <ul className="replay-rail-list replay-stable-scroll min-h-0 flex-1 overflow-y-auto">
                {units.map(unit => {
                    const info = replay.statics[unit.def];
                    const ratio = info?.maxHp ? unit.hp / info.maxHp : 0;
                    const status = [
                        ...unit.effects.map(([name, stacks]) => (stacks > 1 ? `${name}${stacks}` : name)),
                        ...unit.counters.map(([name, value]) => `${name}${value}`),
                    ];
                    const offBoard = unit.r < 0;
                    const badge = unit.state === 2 ? '阵亡' : unit.state === 1 ? '暂亡' : offBoard ? '待命' : '';
                    return (
                        <li
                            key={unit.def}
                            className={`replay-rail-row text-[11px] text-ink-light${unit.def === actorDef ? ' is-actor' : ''}${unit.state === 2 ? ' is-dead' : ''}${offBoard ? ' is-offboard' : ''}`}
                            title={status.length ? status.join(' · ') : undefined}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className="replay-rail-avatar flex-shrink-0">
                                    <HeroAvatar
                                        heroId={info?.templateId ?? ''}
                                        heroName={info?.name ?? ''}
                                        size={22}
                                        className="replay-rail-avatar-img"
                                        fallbackClassName="text-white"
                                        eager
                                    />
                                </span>
                                <span className="replay-rail-name min-w-0 flex-1 truncate" title={info?.name}>{info?.name}</span>
                                {badge && <span className="replay-rail-badge flex-shrink-0">{badge}</span>}
                                <span className="replay-rail-hp flex-shrink-0 tabular-nums">
                                    {offBoard ? '—' : `${unit.hp}/${info?.maxHp}`}
                                </span>
                            </div>
                            <div className="hp-bar hp-bar-lg mt-1">
                                <div
                                    className={`hp-bar-fill ${ratio > 0.6 ? 'hp-high' : ratio > 0.3 ? 'hp-mid' : 'hp-low'}`}
                                    style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
                                />
                            </div>
                            <p className={`replay-rail-status mt-0.5 truncate text-[10px] text-ink-faint ${status.length ? '' : 'invisible'}`}>
                                {status.slice(0, 3).join(' · ') || '—'}
                            </p>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function ReplayLogLine({
    entry,
    heroReferences,
    strong = false,
}: {
    entry: BattleLogEntry;
    heroReferences: Array<{ name: string; owner: 'player1' | 'player2' }>;
    strong?: boolean;
}) {
    const tokens = tokenizeBattleLogContent(entry.message, heroReferences);
    return (
        <p className={`py-1 text-[12px] leading-relaxed font-body ${strong ? 'text-gold-dark' : 'text-ink-faint'}`}>
            {tokens.map((token, index) => (
                token.glossary ? (
                    <span key={`${entry.id}-${index}`} className="text-indigo-ink underline decoration-dotted" title={token.glossary.description}>
                        {token.text}
                    </span>
                ) : token.owner ? (
                    <span key={`${entry.id}-${index}`} className="font-semibold text-ink">{token.text}</span>
                ) : (
                    <span key={`${entry.id}-${index}`}>{token.text}</span>
                )
            ))}
        </p>
    );
}
