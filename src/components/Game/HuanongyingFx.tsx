import type { CSSProperties } from 'react';
import type { SkillAreaBounds, SkillFxEvent } from '../../core/skill-fx';

const PETALS = [
    ['-34%', '-12%', '-28deg', '0ms'],
    ['-20%', '-38%', '18deg', '65ms'],
    ['16%', '-42%', '54deg', '115ms'],
    ['36%', '-10%', '92deg', '35ms'],
    ['25%', '28%', '132deg', '155ms'],
    ['-28%', '30%', '184deg', '90ms'],
] as const;

function Petals({ className = '' }: { className?: string }) {
    return (
        <>
            {PETALS.map(([x, y, rotate, delay], index) => (
                <i
                    key={index}
                    className={`hny-petal hny-petal-${index + 1} ${className}`.trim()}
                    style={{
                        '--hny-x': x,
                        '--hny-y': y,
                        '--hny-rotate': rotate,
                        '--hny-delay': delay,
                    } as CSSProperties}
                />
            ))}
        </>
    );
}

function FoldingFanGlyph() {
    return (
        <svg className="hny-fan-glyph" viewBox="0 0 100 72" aria-hidden="true">
            <path className="hny-fan-silk" d="M50 64 L7 24 Q50 -7 93 24 Z" />
            <path className="hny-fan-rib" d="M50 64 7 24M50 64 24 12M50 64 50 6M50 64 76 12M50 64 93 24" />
            <path className="hny-fan-bloom" d="M29 23c7-10 18-8 21 1 5-10 17-9 22 0-8 0-14 5-17 13-4-8-13-13-26-14Z" />
            <circle className="hny-fan-pin" cx="50" cy="64" r="4" />
        </svg>
    );
}

/** 花间辞起手：折扇在角色身前展开，花瓣先于大扇刃飞出。 */
export function HuanongyingFanCasterFx() {
    return (
        <span className="fx-anchor hny-fan-caster">
            <i className="hny-fan-aura" />
            <i className="hny-fan-hand"><FoldingFanGlyph /></i>
            <Petals className="hny-petal-caster" />
        </span>
    );
}

/** 花间辞主目标：只做花刃抵达时的凝光，不重复画一整面三连斩。 */
export function HuanongyingFanImpactFx() {
    return (
        <span className="fx-anchor hny-fan-impact">
            <i className="hny-impact-bloom" />
            <i className="hny-impact-edge" />
            <i className="hny-impact-ring" />
            <Petals className="hny-petal-impact" />
        </span>
    );
}

/** 弄影旧位：花影收拢为人形剪影，花瓣沿交换轴掠向新位。 */
export function HuanongyingSwapCasterFx() {
    return (
        <span className="fx-anchor hny-swap-source">
            <i className="hny-swap-moon" />
            <i className="hny-swap-silhouette" />
            <i className="hny-swap-fold hny-swap-fold-a" />
            <i className="hny-swap-fold hny-swap-fold-b" />
            <i className="hny-swap-thread" />
            <Petals className="hny-petal-travel" />
        </span>
    );
}

/** 弄影新位：花朵展开、本体凝形，随后一周月白环刃扫过。 */
export function HuanongyingSwapTargetFx() {
    return (
        <span className="fx-anchor hny-swap-target">
            <i className="hny-arrival-shadow" />
            <i className="hny-arrival-bloom hny-arrival-bloom-a" />
            <i className="hny-arrival-bloom hny-arrival-bloom-b" />
            <i className="hny-arrival-core" />
            <i className="hny-ring-blade" />
            <i className="hny-ring-blade hny-ring-blade-echo" />
            <i className="hny-cardinal-cut hny-cardinal-cut-n" />
            <i className="hny-cardinal-cut hny-cardinal-cut-e" />
            <i className="hny-cardinal-cut hny-cardinal-cut-s" />
            <i className="hny-cardinal-cut hny-cardinal-cut-w" />
            <Petals className="hny-petal-arrival" />
        </span>
    );
}

/** 影子重演：用半透明月影与一记轻花刃区别于本体施法。 */
export function HuanongyingReplaySourceFx() {
    return (
        <span className="fx-anchor hny-replay-source">
            <i className="hny-replay-moon" />
            <i className="hny-replay-figure" />
            <i className="hny-replay-fan"><FoldingFanGlyph /></i>
            <Petals className="hny-petal-replay" />
        </span>
    );
}

export function HuanongyingReplayImpactFx() {
    return (
        <span className="fx-anchor hny-replay-impact">
            <i className="hny-replay-cut" />
            <i className="hny-replay-ring" />
            <i className="hny-replay-seal">影</i>
        </span>
    );
}

/**
 * 花间辞区域主效：一条连续花刃跨过完整三格，避免逐格各画一刀形成“三连击”误读。
 * 横向命中面画上拱弧，纵向命中面画侧拱弧；方向只控制扫光的出发端。
 */
export function HuanongyingFanAreaFx({
    event,
    bounds,
}: {
    event: SkillFxEvent;
    bounds: SkillAreaBounds;
}) {
    const width = bounds.cols * 100;
    const height = bounds.rows * 100;
    const horizontal = bounds.cols >= bounds.rows;
    const reverse = event.direction === 'W' || event.direction === 'N';
    const path = horizontal
        ? `M 8 ${height * 0.82} Q ${width / 2} ${-height * 0.28} ${width - 8} ${height * 0.82}`
        : `M ${width * 0.18} 8 Q ${width * 1.28} ${height / 2} ${width * 0.18} ${height - 8}`;
    const petalPoints = horizontal
        ? [[16, 62], [32, 28], [49, 14], [67, 30], [84, 64]]
        : [[36, 14], [67, 31], [82, 50], [64, 69], [34, 86]];

    return (
        <span className={`hny-fan-area hny-fan-area-${horizontal ? 'horizontal' : 'vertical'}${reverse ? ' hny-fan-area-reverse' : ''}`}>
            <i className="hny-fan-area-wash" />
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
                <path className="hny-fan-sweep hny-fan-sweep-glow" d={path} pathLength="1" />
                <path className="hny-fan-sweep hny-fan-sweep-body" d={path} pathLength="1" />
                <path className="hny-fan-sweep hny-fan-sweep-core" d={path} pathLength="1" />
            </svg>
            {petalPoints.map(([x, y], index) => (
                <i
                    key={index}
                    className={`hny-area-petal hny-area-petal-${index + 1}`}
                    style={{ '--hny-area-x': `${x}%`, '--hny-area-y': `${y}%` } as CSSProperties}
                />
            ))}
        </span>
    );
}
