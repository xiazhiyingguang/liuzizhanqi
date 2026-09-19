import type { CSSProperties } from 'react';
import HeroAvatar from '../ui/HeroAvatar';
import { HeroStatusFx } from './HeroStatusFx';
import { WindBladeGlyph } from './WindBladeGlyph';
import type { ReplayArea, ReplayFrame, ReplayStatic, ReplayUnit } from '../../core/battle-replay';
import type { BoardEffect, Hero } from '../../types/game';

interface ReplayBoardProps {
    frame: ReplayFrame;
    statics: ReplayStatic[];
    /** def → 本步生命变化（负数为受伤，正数为治疗）；v1 用它代替特效重放 */
    deltas?: Map<number, number>;
    /** 单格边长（像素）。缺省时由 .replay-board 的 CSS 按弹层可用宽度推导 */
    cellSize?: number;
}

/**
 * 只读回放棋盘。
 *
 * 不复用 Board.tsx：那个组件从全局 store 读约 20 个字段并绑定了点击/移动/施法回调，
 * 而回放要画的是"过去的某一帧"，注入 store 会连带触发音效订阅、AI 定时器与联机广播。
 * 这里只吃 props，格子样式与棋子结构沿用 ink-wash.css 里已有的类名，保证观感一致。
 */
export default function ReplayBoard({ frame, statics, deltas, cellSize }: ReplayBoardProps) {
    const unitsAt = (row: number, col: number): ReplayUnit | undefined =>
        frame.units.find(unit => unit.r === row && unit.c === col);
    const areasAt = (row: number, col: number): ReplayArea[] =>
        frame.areas.filter(area => area.r === row && area.c === col);

    return (
        <div
            className="battle-board-shell replay-board"
            style={cellSize ? ({ '--board-cell-size': `${cellSize}px` } as CSSProperties) : undefined}
        >
            <div className="battle-field battle-board-frame">
                <div className="battle-board-grid">
                    {Array.from({ length: 6 }, (_, row) =>
                        Array.from({ length: 6 }, (_, col) => {
                            const unit = unitsAt(row, col);
                            const areas = areasAt(row, col);
                            const isActor = !!unit && frame.actor >= 0 && frame.units[frame.actor]?.def === unit.def;
                            const delta = unit ? deltas?.get(unit.def) : undefined;
                            return (
                                <div
                                    key={`${row}-${col}`}
                                    data-testid={`replay-cell-${row}-${col}`}
                                    className={`battle-cell battle-board-cell replay-cell flex flex-col items-center justify-center${isActor ? ' replay-cell-actor' : ''}`}
                                >
                                    {areas.map((area, index) => (
                                        <ReplayAreaOverlay key={`${area.type}-${index}`} area={area} />
                                    ))}

                                    {unit && (
                                        <ReplayPiece
                                            unit={unit}
                                            staticDef={statics[unit.def]}
                                            isActor={isActor}
                                            delta={delta}
                                        />
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

const cellAvatarSize = 44;

function ReplayPiece({
    unit,
    staticDef,
    isActor,
    delta,
}: {
    unit: ReplayUnit;
    staticDef?: ReplayStatic;
    isActor: boolean;
    delta?: number;
}) {
    if (!staticDef) return null;
    const hpRatio = staticDef.maxHp > 0 ? unit.hp / staticDef.maxHp : 0;
    const name = staticDef.name;
    // HeroStatusFx 只读 effects[].name 与 counters[name]，这里按帧数据还原最小形状，
    // 不去伪造完整 Hero 对象（帧里刻意不持有 Hero 引用，避免历史帧被就地改写）
    const statusHero = {
        effects: unit.effects.map(([effectName, stackCount]) => ({ name: effectName, stackCount })),
        counters: Object.fromEntries(unit.counters),
    } as unknown as Hero;

    return (
        <div className="flex flex-col items-center gap-0.5 outline-none">
            <div className="piece-shell">
                <div className={`piece battle-board-piece ${staticDef.owner === 'player1' ? 'piece-p1' : 'piece-p2'}${isActor ? ' piece-selected' : ''}`}>
                    <HeroAvatar
                        heroId={staticDef.templateId}
                        heroName={name}
                        size={cellAvatarSize}
                        className="hero-piece-avatar"
                        fallbackClassName="text-white drop-shadow-sm"
                        eager
                    />
                </div>
                <HeroStatusFx hero={statusHero} />
            </div>
            <span className="battle-board-piece-name text-ink-faint font-body leading-none">
                {name.length > 3 ? name.slice(0, 3) : name}
            </span>
            <div className="hp-bar battle-board-hp">
                <div
                    className={`hp-bar-fill ${hpRatio > 0.6 ? 'hp-high' : hpRatio > 0.3 ? 'hp-mid' : 'hp-low'}`}
                    style={{ width: `${Math.max(0, Math.min(1, hpRatio)) * 100}%` }}
                />
            </div>
            {unit.shield > 0 && (
                <div className="absolute -top-0.5 -right-0.5 text-[8px] text-white font-bold bg-indigo-ink rounded-full w-4 h-4 flex items-center justify-center shadow-sm">
                    {unit.shield}
                </div>
            )}
            {typeof delta === 'number' && delta !== 0 && (
                <span className={`replay-delta ${delta < 0 ? 'replay-delta-hurt' : 'replay-delta-heal'}`}>
                    {delta < 0 ? delta : `+${delta}`}
                </span>
            )}
        </div>
    );
}

const AREA_TITLES: Record<BoardEffect['type'], string> = {
    'wind-blade': '风刃',
    'wind-lane': '风道',
    'ice-crystal': '冰晶',
    'sand-dune': '沙丘',
    'dark-circle': '暗夜法阵',
    'binding-zone': '束缚区',
    'blade-mark': '刃痕',
    brush: '毛笔',
};

/** 场地效果层：几何与配色交给既有 ink-wash.css 类，这里只补类名与可读 title */
function ReplayAreaOverlay({ area }: { area: ReplayArea }) {
    const side = area.owner === 'player1' ? 'p1' : 'p2';
    switch (area.type) {
        case 'wind-lane':
            return (
                <div
                    title={`${AREA_TITLES['wind-lane']}：顺风方向 ${area.direction ?? '-'}`}
                    className={`wind-lane-band wind-lane-band-${area.direction ?? 'right'} wind-lane-owner-${side} pointer-events-none`}
                />
            );
        case 'wind-blade':
            return (
                <div title={AREA_TITLES['wind-blade']} className={`bf-wind-blade bf-wind-blade-${side} bf-wind-blade-${area.direction ?? 'up'} pointer-events-none`}>
                    <WindBladeGlyph />
                </div>
            );
        case 'ice-crystal':
            return (
                <div title={AREA_TITLES['ice-crystal']} className="bf-ice-crystal absolute inset-1 flex items-center justify-center pointer-events-none">
                    <svg className="ice-crystal-snow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m17 21-3-6h-4" />
                        <path d="m17 3-3 6 1.5 3" />
                        <path d="M2 12h6.5L10 9" />
                        <path d="M22 12h-6.5L14 15" />
                        <path d="m7 21 3-6-1.5-3" />
                        <path d="m7 3 3 6h4" />
                    </svg>
                </div>
            );
        case 'sand-dune':
            return (
                <div
                    title={AREA_TITLES['sand-dune']}
                    className="bf-sand-dune absolute inset-1 rounded-md border border-amber-600/35 bg-amber-300/15 pointer-events-none"
                >
                    <div className="absolute inset-x-2 bottom-1 h-1.5 rounded-[50%] border-t border-amber-700/35" />
                </div>
            );
        case 'dark-circle':
            return <div title={AREA_TITLES['dark-circle']} className="bf-dark-circle absolute inset-1 rounded-md bg-indigo-950/15 border border-indigo-500/30 pointer-events-none" />;
        case 'binding-zone':
            return (
                <div
                    title={AREA_TITLES['binding-zone']}
                    className="bf-binding-zone absolute inset-1 border border-dashed border-gold/60 rounded-sm pointer-events-none"
                >
                    <div className="absolute inset-1 border border-indigo-300/40 rounded-sm" />
                </div>
            );
        case 'blade-mark':
            return <div title={AREA_TITLES['blade-mark']} className="bf-blade-mark absolute inset-2 border border-vermillion/40 rotate-45 pointer-events-none" />;
        default:
            return <div title={AREA_TITLES[area.type] ?? '场地效果'} className="absolute inset-2 border border-dashed border-ink/25 rounded-sm pointer-events-none" />;
    }
}
