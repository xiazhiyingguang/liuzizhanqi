import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBattleReplay } from '../../hooks/useBattleReplay';
import { computeFrameDeltas, type BattleReplay, type ReplayMarkKind } from '../../core/battle-replay';
import { tokenizeBattleLogContent } from '../../core/battle-presentation';
import ReplayBoard from './ReplayBoard';
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

    const stepBy = useCallback((amount: number) => {
        setPlaying(false);
        setFrameIndex(index => Math.min(Math.max(index + amount, 0), lastIndex));
    }, [lastIndex]);

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
        const panel = narrationRef.current;
        if (panel) panel.scrollTop = panel.scrollHeight;
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

    return (
        <Shell onClose={onClose}>
            <div className="relative z-10 flex h-[min(92vh,860px)] w-[min(1120px,96vw)] flex-col overflow-hidden ink-card animate-fade-up">
                <header className="flex min-h-[74px] items-center justify-between gap-4 border-b border-gold/15 px-5 py-3">
                    <div className="min-w-0">
                        <h2 id="battle-replay-title" className="font-title text-lg text-ink">对局回放</h2>
                        <p
                            className="mt-0.5 truncate text-[11px] text-ink-faint"
                            title={`第 ${current + 1} / ${frames.length} 步 · 第 ${frame.round} 回合 · ${frame.player === 'player1' ? '玩家一' : '玩家二'}行动${actorName ? ` · 行动者：${actorName}` : ''}`}
                        >
                            第 {current + 1} / {frames.length} 步 · 第 {frame.round} 回合 · {frame.player === 'player1' ? '玩家一' : '玩家二'}行动
                            {actorName ? ` · 行动者：${actorName}` : ''}
                            {replay.coarsened ? ' · 为节省内存已按回合抽样' : ''}
                        </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                        <span className="text-[11px] text-ink-faint">← → 逐步，空格播放</span>
                        <InkButton variant="ghost" size="sm" sfx="cancel" onClick={onClose}>关闭</InkButton>
                    </div>
                </header>

                <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
                    <div className="replay-stable-scroll flex min-w-0 flex-col gap-3 overflow-y-auto light-scrollbar pr-1">
                        <ReplayBoard frame={frame} statics={replay.statics} deltas={deltas} />
                        <ReplayRoster replay={replay} frameIndex={current} />
                    </div>

                    <aside className="flex w-[320px] flex-shrink-0 flex-col gap-3 min-h-0">
                        <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-ink/8 bg-rice-light/60">
                            <h3 className="border-b border-ink/8 px-3 py-2 font-title text-sm text-ink">本步战报</h3>
                            <div ref={narrationRef} className="replay-stable-scroll min-h-0 flex-1 overflow-y-auto light-scrollbar px-3 py-2">
                                {stepLogs.length === 0 ? (
                                    <p className="text-[12px] text-ink-faint">（本步没有产生新战报，多为流程推进或站位变化）</p>
                                ) : stepLogs.map(entry => (
                                    <ReplayLogLine key={entry.id} entry={entry} heroReferences={heroReferences} strong />
                                ))}
                                {earlierLogs.length > 0 && (
                                    <div className="mt-3 border-t border-dashed border-ink/10 pt-2 opacity-55">
                                        {earlierLogs.map(entry => (
                                            <ReplayLogLine key={entry.id} entry={entry} heroReferences={heroReferences} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="rounded-lg border border-ink/8 bg-rice-light/60 px-3 py-2">
                            <h3 className="font-title text-sm text-ink">关键节点</h3>
                            <div className="replay-stable-scroll mt-2 flex max-h-[168px] flex-wrap gap-1.5 overflow-y-auto light-scrollbar">
                                {replay.marks.length === 0 ? (
                                    <p className="text-[12px] text-ink-faint">本局没有识别到击杀/天威等关键节点。</p>
                                ) : replay.marks.map(mark => (
                                    <button
                                        key={`${mark.frame}-${mark.kind}-${mark.label}`}
                                        type="button"
                                        title={mark.label}
                                        onClick={() => { setPlaying(false); setFrameIndex(mark.frame); }}
                                        className={`replay-mark-chip replay-mark-${mark.kind}${mark.frame === current ? ' is-current' : ''}`}
                                    >
                                        <span className="replay-mark-kind">{MARK_LABELS[mark.kind]}</span>
                                        <span className="replay-mark-step">#{mark.frame + 1}</span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    </aside>
                </div>

                <footer className="border-t border-gold/15 px-5 py-3">
                    <div className="mb-2 flex items-center gap-2">
                        <button type="button" className="replay-btn" onClick={() => { setPlaying(false); setFrameIndex(0); }} aria-label="回到开局">⏮</button>
                        <button type="button" className="replay-btn" onClick={() => stepBy(-1)} aria-label="上一步">‹</button>
                        <button type="button" className="replay-btn replay-btn-play" onClick={() => setPlaying(value => !value)} aria-label={playing ? '暂停' : '播放'}>
                            {playing ? '❚❚' : '▶'}
                        </button>
                        <button type="button" className="replay-btn" onClick={() => stepBy(1)} aria-label="下一步">›</button>
                        <button type="button" className="replay-btn" onClick={() => { setPlaying(false); setFrameIndex(lastIndex); }} aria-label="跳到当前">⏭</button>
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
                        <span className="ml-auto text-[11px] text-ink-faint">{frame.actions}/{frame.required} 行动次数</span>
                    </div>

                    <div className="replay-track">
                        {replay.marks.map(mark => (
                            <span
                                key={`tick-${mark.frame}-${mark.kind}`}
                                className={`replay-tick replay-mark-${mark.kind}`}
                                style={{ left: `${(mark.frame / lastIndex) * 100}%` }}
                                title={MARK_LABELS[mark.kind]}
                            />
                        ))}
                        <input
                            type="range"
                            min={0}
                            max={lastIndex}
                            value={current}
                            onChange={event => { setPlaying(false); setFrameIndex(Number(event.target.value)); }}
                            className="replay-scrub"
                            aria-label="回放时间轴"
                        />
                    </div>
                </footer>
            </div>
        </Shell>
    );
}

function Shell({ children, onClose }: BattleReplayModalProps & { children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="battle-replay-title">
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

/** 含未上场单位的花名册：替补席、暂时阵亡与真实阵亡都要能看到，否则回放里会"凭空少人" */
function ReplayRoster({ replay, frameIndex }: { replay: BattleReplay; frameIndex: number }) {
    const frame = replay.frames[frameIndex];
    // 名单按登记顺序（= 上场顺序）排，绝不按血量排：
    // 血量每步都在变，按血量排会让名字在逐帧翻动时来回跳位。
    const byOwner = ([1, 2] as const).map(slot => {
        const owner = slot === 1 ? 'player1' : 'player2';
        const units = frame.units.filter(unit => replay.statics[unit.def]?.owner === owner);
        return { owner, units };
    });

    return (
        // 花名册整块高度固定、行高固定：增益/减益随帧增减会把行撑高，
        // 逐帧翻动时下半栏就会上下抽动，连带左栏滚动位置一起晃
        <div className="grid h-[178px] flex-shrink-0 grid-cols-2 gap-2">
            {byOwner.map(({ owner, units }) => (
                <section key={owner} className="flex min-h-0 flex-col rounded-lg border border-ink/8 bg-rice-light/60 px-2.5 py-2">
                    <h4 className="mb-1.5 flex-shrink-0 font-title text-xs text-ink-faint">{owner === 'player1' ? '玩家一' : '玩家二'}</h4>
                    <ul className="replay-stable-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
                        {units.map(unit => {
                            const info = replay.statics[unit.def];
                            const ratio = info?.maxHp ? unit.hp / info.maxHp : 0;
                            const status = [
                                ...unit.effects.map(([name, stacks]) => (stacks > 1 ? `${name}${stacks}` : name)),
                                ...unit.counters.map(([name, value]) => `${name}${value}`),
                            ].join(' · ');
                            return (
                                <li key={unit.def} className="text-[11px] text-ink-light">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={unit.state === 2 ? 'line-through opacity-55' : ''}>{info?.name}</span>
                                        <span className="tabular-nums opacity-70">
                                            {unit.r < 0 ? (unit.state === 2 ? '阵亡' : unit.state === 1 ? '暂亡' : '待命') : `${unit.hp}/${info?.maxHp}`}
                                        </span>
                                    </div>
                                    <div className="hp-bar mt-0.5">
                                        <div
                                            className={`hp-bar-fill ${ratio > 0.6 ? 'hp-high' : ratio > 0.3 ? 'hp-mid' : 'hp-low'}`}
                                            style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
                                        />
                                    </div>
                                    <p className={`mt-0.5 truncate text-[10px] text-ink-faint ${status ? '' : 'invisible'}`}>
                                        {status || '—'}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </div>
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
