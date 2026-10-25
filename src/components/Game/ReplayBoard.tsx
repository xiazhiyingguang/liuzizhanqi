import type { CSSProperties } from 'react';
import HeroAvatar from '../ui/HeroAvatar';
import { HeroStatusFx } from './HeroStatusFx';
import { WindBladeGlyph } from './WindBladeGlyph';
import { ThunderCloudField } from './ThunderCloudField';
import type { ReplayArea, ReplayDelta, ReplayFrame, ReplayStatic, ReplayUnit } from '../../core/battle-replay';
import { BOARD_SIZE, HeroState, type BoardEffect, type Hero } from '../../types/game';

interface ReplayBoardProps {
    frame: ReplayFrame;
    statics: ReplayStatic[];
    /** 本步生命/护盾变化；离场单位的数字仍落在它原来的格子上 */
    deltas?: ReplayDelta[];
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
        frame.areas.filter(area => area.type !== 'thunder-cloud' && areaCoversCell(area, row, col));
    const ghostAt = (row: number, col: number) =>
        (frame.ghosts ?? []).filter(ghost => ghost.r === row && ghost.c === col);
    const deltaByDef = new Map<number, ReplayDelta>();
    for (const delta of deltas ?? []) deltaByDef.set(delta.def, delta);
    // 棋子已经离场（死亡/被移出名单）时，本步数字仍要落回它原来的格子
    const orphanDeltas = (deltas ?? []).filter(delta =>
        !frame.units.some(unit => unit.def === delta.def && unit.r === delta.r && unit.c === delta.c));
    const orphanDeltasAt = (row: number, col: number) =>
        orphanDeltas.filter(delta => delta.r === row && delta.c === col);
    const lampShadowNames = buildLampShadowNames(frame, statics);

    return (
        <div
            className="battle-board-shell replay-board"
            style={cellSize ? ({ '--board-cell-size': `${cellSize}px` } as CSSProperties) : undefined}
        >
            <div className="battle-field battle-board-frame">
                <div className="battle-board-grid">
                    {Array.from({ length: BOARD_SIZE }, (_, row) =>
                        Array.from({ length: BOARD_SIZE }, (_, col) => {
                            const unit = unitsAt(row, col);
                            const areas = areasAt(row, col);
                            const isActor = !!unit && frame.actor >= 0 && frame.units[frame.actor]?.def === unit.def;
                            const delta = unit ? deltaByDef.get(unit.def) : undefined;
                            const ghosts = unit ? [] : ghostAt(row, col);
                            const shadowNames = lampShadowNames.get(`${row},${col}`) ?? [];
                            const extraDeltas = orphanDeltasAt(row, col);
                            return (
                                <div
                                    key={`${row}-${col}`}
                                    data-testid={`replay-cell-${row}-${col}`}
                                    className={`battle-cell battle-board-cell replay-cell flex flex-col items-center justify-center${isActor ? ' replay-cell-actor' : ''}`}
                                >
                                    {areas.map((area, index) => (
                                        <ReplayAreaOverlay key={`${area.type}-${index}`} area={area} />
                                    ))}

                                    {shadowNames.length > 0 && (
                                        <div
                                            className="bf-lamp-shadow absolute inset-1 pointer-events-none"
                                            title={`灯影：这一格连着${shadowNames.join('、')}本人，打中影子就照到本体`}
                                        >
                                            <i className="bf-lamp-shadow-stretch" aria-hidden="true" />
                                            <i className="bf-lamp-shadow-tip" aria-hidden="true" />
                                        </div>
                                    )}

                                    {ghosts.map(ghost => {
                                        const info = statics[ghost.def];
                                        return info ? <ReplayGhostMark key={`ghost-${ghost.def}`} info={info} /> : null;
                                    })}

                                    {unit && (
                                        <ReplayPiece
                                            unit={unit}
                                            staticDef={statics[unit.def]}
                                            isActor={isActor}
                                            delta={delta}
                                        />
                                    )}

                                    {extraDeltas.map(deltaEntry => (
                                        <ReplayDeltaBadges key={`orphan-${deltaEntry.def}`} delta={deltaEntry} />
                                    ))}
                                </div>
                            );
                        })
                    )}
                    {(frame.links ?? []).map((link, index) => (
                        <div
                            key={`link-${index}-${link.kind}`}
                            className={`hero-link hero-link-${link.kind}`}
                            style={{
                                '--l-r': link.from[0],
                                '--l-c': link.from[1],
                                '--l-len': link.length,
                                '--l-rot': `${link.angleDeg}deg`,
                            } as CSSProperties}
                            aria-hidden="true"
                        >
                            <i className="hero-link-core" />
                            <i className="hero-link-flow" />
                            <i className="hero-link-pulse" />
                        </div>
                    ))}
                    {frame.areas.some(area => area.type === 'thunder-cloud') && <div className="yx-cloud-layer" aria-hidden="true">
                        {frame.areas.filter(area => area.type === 'thunder-cloud').map((area, index) =>
                            <ThunderCloudField key={`cloud-${index}`} position={[area.r, area.c]} owner={area.owner} duration={area.duration} />)}
                    </div>}
                </div>
            </div>
        </div>
    );
}

/** 水泽/暗夜法阵/沙丘是单个场地效果覆盖多格，回放必须按真实范围铺开 */
function areaCoversCell(area: ReplayArea, row: number, col: number): boolean {
    if (area.type === 'dark-circle' || area.type === 'sand-dune') {
        return Math.abs(area.r - row) <= 1 && Math.abs(area.c - col) <= 1;
    }
    if (area.type === 'water-marsh') {
        const size = Math.min(((area.radius ?? 1) * 2) + 1, BOARD_SIZE);
        const half = Math.floor(size / 2);
        const row0 = Math.max(0, Math.min(BOARD_SIZE - size, area.r - half));
        const col0 = Math.max(0, Math.min(BOARD_SIZE - size, area.c - half));
        return row >= row0 && row < row0 + size && col >= col0 && col < col0 + size;
    }
    return area.r === row && area.c === col;
}

/** 灯影由"灯 + 此刻站位"当场推导：从灯指向敌人，再往前一格 */
function buildLampShadowNames(frame: ReplayFrame, statics: ReplayStatic[]): Map<string, string[]> {
    const byCell = new Map<string, string[]>();
    const lamps = frame.areas.filter(area => area.type === 'lit-lamp');
    if (lamps.length === 0) return byCell;
    for (const lamp of lamps) {
        for (const unit of frame.units) {
            if (unit.r < 0 || unit.state !== 0) continue;
            const info = statics[unit.def];
            if (!info || info.owner === lamp.owner) continue;
            const dr = unit.r - lamp.r;
            const dc = unit.c - lamp.c;
            if (Math.abs(dr) > 1 || Math.abs(dc) > 1 || (dr === 0 && dc === 0)) continue;
            const row = unit.r + dr;
            const col = unit.c + dc;
            if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) continue;
            const key = `${row},${col}`;
            const names = byCell.get(key) ?? [];
            if (!names.includes(info.name)) names.push(info.name);
            byCell.set(key, names);
        }
    }
    return byCell;
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
    delta?: ReplayDelta;
}) {
    if (!staticDef) return null;
    const hpRatio = staticDef.maxHp > 0 ? unit.hp / staticDef.maxHp : 0;
    const name = staticDef.name;
    // HeroStatusFx / HeroMechanismState 需要的最小形状：状态、被动、效果与原始计数器。
    // 帧里刻意不持有 Hero 引用，避免历史帧被原地改写。
    const statusHero = {
        state: unit.state === 0 ? HeroState.ALIVE : unit.state === 1 ? HeroState.TEMP_DEAD : HeroState.DEAD,
        passiveId: staticDef.passiveId,
        effects: unit.effects.map(([effectName, stackCount]) => ({ name: effectName, stackCount })),
        counters: unit.rawCounters ?? Object.fromEntries(unit.counters),
    } as unknown as Hero;

    return (
        <div className="board-hero-content flex flex-col items-center gap-0.5 outline-none">
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
            {delta && <ReplayDeltaBadges delta={delta} />}
        </div>
    );
}

/** 本步数值：生命增减、挡下/护盾变化、阵亡；左上角一列，避开右上角的盾数角标 */
function ReplayDeltaBadges({ delta }: { delta: ReplayDelta }) {
    return (
        <div className="replay-deltas">
            {delta.hp !== 0 && (
                <span className={`replay-delta ${delta.hp < 0 ? 'replay-delta-hurt' : 'replay-delta-heal'}`}>
                    {delta.hp < 0 ? delta.hp : `+${delta.hp}`}
                </span>
            )}
            {delta.shield < 0 && delta.hp === 0 && (
                <span className="replay-delta replay-delta-block">挡下 {Math.abs(delta.shield)}</span>
            )}
            {delta.shield < 0 && delta.hp !== 0 && (
                <span className="replay-delta replay-delta-shield">盾 -{Math.abs(delta.shield)}</span>
            )}
            {delta.shield > 0 && (
                <span className="replay-delta replay-delta-shield">盾 +{delta.shield}</span>
            )}
            {delta.died && <span className="replay-delta replay-delta-death">阵亡</span>}
        </div>
    );
}

/** 时空停滞残影：阵亡但时间被凝固的单位 */
function ReplayGhostMark({ info }: { info: ReplayStatic }) {
    return (
        <div
            className="dai-stasis-ghost pointer-events-none"
            title={`时空停滞：${info.name}（时间已被凝固，戴尔·时空回溯可将其唤回）`}
        >
            <span className="dai-stasis-clock" aria-hidden="true">
                <i /><i />
            </span>
            <span className="dai-stasis-ring" aria-hidden="true" />
            <span className="dai-stasis-ring dai-stasis-ring-2" aria-hidden="true" />
            <HeroAvatar
                heroId={info.templateId}
                heroName={info.name}
                size={44}
                className="dai-stasis-avatar"
                eager
            />
            <span className="dai-stasis-name">{info.name}</span>
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
    'water-moon': '水月之影',
    'moon-seat': '月座',
    'shadow-mark': '残影',
    'light-prism': '光棱',
    'water-marsh': '水泽',
    'fish-hook': '鱼钩',
    'thunder-cloud': '雷云',
    'lightning-rod': '引雷针',
    'flying-sword': '飞剑',
    'boomerang': '回旋镖',
    'lit-lamp': '明灯',
    'wake-lamp': '留灯',
    brush: '毛笔',
};

const sideOf = (owner: ReplayArea['owner']) => owner === 'player1' ? 'p1' : 'p2';

/** 场地效果层：几何与配色交给既有 ink-wash.css 类，这里只补类名与可读 title */
function ReplayAreaOverlay({ area }: { area: ReplayArea }) {
    const side = sideOf(area.owner);
    const rootProps = { 'data-replay-area': area.type } as Record<string, string>;
    switch (area.type) {
        case 'wind-lane':
            return (
                <div
                    {...rootProps}
                    title={`${AREA_TITLES['wind-lane']}：顺风方向 ${area.direction ?? '-'}`}
                    className={`wind-lane-band wind-lane-band-${area.direction ?? 'right'} wind-lane-owner-${side} pointer-events-none`}
                />
            );
        case 'wind-blade':
            return (
                <div {...rootProps} title={AREA_TITLES['wind-blade']} className={`bf-wind-blade bf-wind-blade-${side} bf-wind-blade-${area.direction ?? 'up'} pointer-events-none`}>
                    <WindBladeGlyph />
                </div>
            );
        case 'flying-sword':
            return (
                <div {...rootProps} title={AREA_TITLES['flying-sword']} className={`bf-flying-sword bf-flying-sword-${side} pointer-events-none`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
                        <path d="m13 19 6-6" />
                        <path d="m16 16 4 4" />
                        <path d="m19 14 2 2" />
                    </svg>
                </div>
            );
        case 'boomerang':
            return (
                <div {...rootProps} title={AREA_TITLES['boomerang']} className={`bf-boomerang bf-boomerang-${side} pointer-events-none`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 8 Q10 3 18 8 Q12 11 8 19 Q7 13 3 8 Z" />
                        <path d="M21 16 Q14 21 6 16 Q12 13 16 5 Q17 11 21 16 Z" />
                    </svg>
                </div>
            );
        case 'ice-crystal':
            return (
                <div {...rootProps} title={AREA_TITLES['ice-crystal']} className="bf-ice-crystal absolute inset-1 flex items-center justify-center pointer-events-none">
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
                    {...rootProps}
                    title={AREA_TITLES['sand-dune']}
                    className="bf-sand-dune absolute inset-1 rounded-md border border-amber-600/35 bg-amber-300/15 pointer-events-none"
                >
                    <div className="absolute inset-x-2 bottom-1 h-1.5 rounded-[50%] border-t border-amber-700/35" />
                    <div className="absolute inset-x-3 bottom-2 h-1 rounded-[50%] border-t border-amber-500/25" />
                </div>
            );
        case 'dark-circle':
            return <div {...rootProps} title={AREA_TITLES['dark-circle']} className="bf-dark-circle absolute inset-1 rounded-md bg-indigo-950/15 border border-indigo-500/30 pointer-events-none" />;
        case 'binding-zone':
            return (
                <div
                    {...rootProps}
                    title={AREA_TITLES['binding-zone']}
                    className="bf-binding-zone absolute inset-1 border border-dashed border-gold/60 rounded-sm pointer-events-none"
                >
                    <div className="absolute inset-1 border border-indigo-300/40 rounded-sm" />
                </div>
            );
        case 'blade-mark':
            return <div {...rootProps} title={AREA_TITLES['blade-mark']} className="bf-blade-mark absolute inset-2 border border-vermillion/40 rotate-45 pointer-events-none" />;
        case 'water-moon':
            return (
                <div {...rootProps} title={AREA_TITLES['water-moon']} className={`bf-water-moon bf-water-moon-${side} absolute inset-1 pointer-events-none`}>
                    <i className="bf-water-moon-ring" aria-hidden="true" />
                    <i className="bf-water-moon-core" aria-hidden="true" />
                </div>
            );
        case 'moon-seat':
            return (
                <div {...rootProps} title={`${AREA_TITLES['moon-seat']}（剩${area.duration}回合）`} className="bf-moon-seat absolute inset-1 pointer-events-none">
                    <i className="bf-moon-seat-ring" aria-hidden="true" />
                    <i className="bf-moon-seat-ring bf-moon-seat-ring-b" aria-hidden="true" />
                    <i className="bf-moon-seat-dot" aria-hidden="true" />
                </div>
            );
        case 'shadow-mark':
            return (
                <div {...rootProps} title={AREA_TITLES['shadow-mark']} className={`bf-shadow-mark bf-shadow-mark-${side} absolute inset-1 pointer-events-none`}>
                    <i className="bf-shadow-pool" aria-hidden="true" />
                    <svg className="bf-shadow-figure" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 3.4c1.7 0 2.9 1.2 2.9 2.8 0 1.1-.6 1.9-1.3 2.5.9.5 1.6 1.4 1.9 2.6l.7 3.9c.1.6-.3 1-.8 1h-6.8c-.5 0-.9-.4-.8-1l.7-3.9c.3-1.2 1-2.1 1.9-2.6-.7-.6-1.3-1.4-1.3-2.5 0-1.6 1.2-2.8 2.9-2.8z" />
                    </svg>
                    <i className="bf-shadow-petal bf-shadow-petal-a" aria-hidden="true" />
                    <i className="bf-shadow-petal bf-shadow-petal-b" aria-hidden="true" />
                </div>
            );
        case 'light-prism':
            return (
                <div {...rootProps} title={AREA_TITLES['light-prism']} className={`bf-prism absolute inset-1 pointer-events-none bf-prism-${side}`}>
                    <i className="bf-prism-halo" aria-hidden="true" />
                    <svg className="bf-prism-glyph" viewBox="0 0 24 24" aria-hidden="true">
                        <path className="bf-prism-face" d="M12 3.2 L20.2 18 L3.8 18 Z" />
                        <path className="bf-prism-edge" d="M12 3.2 L20.2 18 M12 3.2 L3.8 18 M3.8 18 L20.2 18 M12 3.2 L12 18" />
                        <path className="bf-prism-ray" d="M0.6 12.4 L8.4 12.4 M15.6 12.4 L23.4 9.2" />
                    </svg>
                </div>
            );
        case 'water-marsh':
            return (
                <div {...rootProps} title={AREA_TITLES['water-marsh']} className={`bf-water-marsh bf-water-marsh-${side} pointer-events-none`}>
                    <span className="bf-water-marsh-ripple" />
                    <span className="bf-water-marsh-ripple bf-water-marsh-ripple-2" />
                </div>
            );
        case 'fish-hook':
            return (
                <div {...rootProps} title={`${AREA_TITLES['fish-hook']}（剩${area.duration}回合）`} className={`bf-fish-hook bf-fish-hook-${side} pointer-events-none`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 2v7" />
                        <path d="M12 9c0 4-2.5 6-4.5 6S4 13 5.5 11.5" />
                        <circle cx="12" cy="2.6" r="1.1" />
                    </svg>
                </div>
            );
        case 'lightning-rod':
            return (
                <div {...rootProps} title={AREA_TITLES['lightning-rod']} className={`bf-rod bf-rod-${side} pointer-events-none`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3v13" />
                        <path d="M8.4 16.2h7.2L12 21z" />
                        <path d="M12 6.5l3.2-2.2M12 9.5l-3-2" />
                    </svg>
                </div>
            );
        case 'lit-lamp':
        case 'wake-lamp':
            return (
                <div
                    {...rootProps}
                    title={area.type === 'wake-lamp' ? AREA_TITLES['wake-lamp'] : AREA_TITLES['lit-lamp']}
                    className={`bf-lamp bf-lamp-${side}${area.type === 'wake-lamp' ? ' bf-lamp-wake' : ''} absolute inset-1 pointer-events-none`}
                >
                    <i className="bf-lamp-halo" aria-hidden="true" />
                    <svg className="bf-lamp-glyph" viewBox="0 0 24 24" aria-hidden="true">
                        <path className="bf-lamp-flame" d="M12 4.2c1.9 2.1 2.8 3.7 2.8 5.1a2.8 2.8 0 0 1-5.6 0c0-1.4.9-3 2.8-5.1z" />
                        <path className="bf-lamp-body" d="M7.6 12.4h8.8l-1.3 6.2q-.1.6-.7.6H9.6q-.6 0-.7-.6z" />
                        <path className="bf-lamp-base" d="M6.4 20.2h11.2" />
                    </svg>
                </div>
            );
        case 'brush':
            return (
                <div {...rootProps} title={`${AREA_TITLES.brush}（剩余移动${Math.max(0, area.duration)}次）`} className={`bf-brush absolute inset-1 pointer-events-none flex flex-col items-center justify-center brush-owner-${side}`}>
                    <i className="bf-brush-glow" aria-hidden="true" />
                    <svg className="brush-mark-svg" viewBox="0 0 24 24" aria-hidden="true">
                        <g transform="rotate(38 12 12)">
                            <rect x="10.85" y="4.2" width="2.3" height="9" rx="1.05" fill="#8a5f33" />
                            <rect x="10.35" y="2.1" width="3.3" height="2.1" rx="0.7" fill="#3e2c17" />
                            <rect x="10.25" y="12.9" width="3.5" height="1.7" rx="0.55" fill="#caa96c" />
                            <path d="M9.35 14.5 C9.2 16.9 10.4 19.3 12 20.9 C13.6 19.3 14.8 16.9 14.65 14.5 C13.8 15.1 10.2 15.1 9.35 14.5 Z" fill="#f4eedd" />
                            <path d="M10.95 17.4 C11.1 19.2 11.5 20.3 12 21.3 C12.5 20.3 12.9 19.2 13.05 17.4 C12.7 17.9 11.3 17.9 10.95 17.4 Z" fill="#14141a" />
                        </g>
                    </svg>
                </div>
            );
        default:
            return <div {...rootProps} title={AREA_TITLES[area.type] ?? '场地效果'} className="absolute inset-2 border border-dashed border-ink/25 rounded-sm pointer-events-none" />;
    }
}
