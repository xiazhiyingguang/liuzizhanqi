import { HERO_ABILITY_KEYS, HeroAbilityRatings, HeroAbilityKey } from '../../data/hero-ratings';

type HeroRadarChartProps = {
    heroName: string;
    ratings: HeroAbilityRatings;
    accent: string;
    /** 当前高亮的维度（受控，由父组件传入） */
    hoveredKey?: HeroAbilityKey | null;
    /** 触碰某个维度时回调（移出时传 null） */
    onHover?: (key: HeroAbilityKey | null) => void;
};

const CENTER_X = 180;
const CENTER_Y = 162;
const CHART_RADIUS = 104;
const LABEL_RADIUS = 137;

function pointFor(index: number, radius: number) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / HERO_ABILITY_KEYS.length;
    return {
        x: CENTER_X + Math.cos(angle) * radius,
        y: CENTER_Y + Math.sin(angle) * radius,
        angle,
    };
}

function pointForAngle(angle: number, radius: number) {
    return {
        x: CENTER_X + Math.cos(angle) * radius,
        y: CENTER_Y + Math.sin(angle) * radius,
    };
}

function polygonPoints(radius: number) {
    return HERO_ABILITY_KEYS
        .map((_, index) => {
            const point = pointFor(index, radius);
            return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
        })
        .join(' ');
}

function valuePolygonPoints(ratings: HeroAbilityRatings) {
    return HERO_ABILITY_KEYS
        .map((key, index) => {
            const point = pointFor(index, CHART_RADIUS * (ratings[key] / 10));
            return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
        })
        .join(' ');
}

function labelAnchor(angle: number): 'start' | 'middle' | 'end' {
    const cosine = Math.cos(angle);
    if (cosine > 0.35) return 'start';
    if (cosine < -0.35) return 'end';
    return 'middle';
}

export default function HeroRadarChart({
    heroName,
    ratings,
    accent,
    hoveredKey = null,
    onHover,
}: HeroRadarChartProps) {
    const gradientId = `radar-fill-${heroName.replace(/[^\w\u4e00-\u9fa5]/g, '')}`;
    const glowId = `radar-glow-${heroName.replace(/[^\w\u4e00-\u9fa5]/g, '')}`;

    return (
        <svg
            className="hero-radar-chart"
            viewBox="0 0 360 324"
            role="img"
            aria-label={`${heroName}能力雷达图：${HERO_ABILITY_KEYS.map(key => `${key}${ratings[key]}分`).join('，')}`}
            onTouchEnd={() => onHover?.(null)}
        >
            <defs>
                <radialGradient id={gradientId} cx="50%" cy="42%" r="64%">
                    <stop offset="0%" stopColor={accent} stopOpacity="0.34" />
                    <stop offset="72%" stopColor={accent} stopOpacity="0.17" />
                    <stop offset="100%" stopColor={accent} stopOpacity="0.08" />
                </radialGradient>
                <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="2.4" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            <circle cx={CENTER_X} cy={CENTER_Y} r="122" fill="rgba(255,255,255,.18)" />

            {[2, 4, 6, 8, 10].map(level => (
                <polygon
                    key={level}
                    points={polygonPoints(CHART_RADIUS * (level / 10))}
                    fill={level === 10 ? 'rgba(255,255,255,.16)' : 'none'}
                    stroke={level === 10 ? 'rgba(26,26,26,.16)' : 'rgba(26,26,26,.085)'}
                    strokeWidth={level === 10 ? 1.1 : 0.8}
                />
            ))}

            {HERO_ABILITY_KEYS.map((key, index) => {
                const edge = pointFor(index, CHART_RADIUS);
                const isActive = hoveredKey === key;
                return (
                    <line
                        key={key}
                        x1={CENTER_X}
                        y1={CENTER_Y}
                        x2={edge.x}
                        y2={edge.y}
                        stroke={isActive ? accent : 'rgba(26,26,26,.11)'}
                        strokeWidth={isActive ? 1.6 : 0.8}
                        style={{ transition: 'stroke .18s ease, stroke-width .18s ease' }}
                    />
                );
            })}

            <polygon
                className="hero-radar-area"
                points={valuePolygonPoints(ratings)}
                fill={`url(#${gradientId})`}
                stroke={accent}
                strokeWidth="2"
                strokeLinejoin="round"
                filter={`url(#${glowId})`}
            />

            {HERO_ABILITY_KEYS.map((key, index) => {
                const point = pointFor(index, CHART_RADIUS * (ratings[key] / 10));
                const isActive = hoveredKey === key;
                return (
                    <g key={key}>
                        {isActive && (
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r="9.5"
                                fill="none"
                                stroke={accent}
                                strokeWidth="1.6"
                                strokeOpacity="0.45"
                            />
                        )}
                        <circle
                            cx={point.x}
                            cy={point.y}
                            r={isActive ? 6.4 : 4.2}
                            fill="#faf7f2"
                            stroke={accent}
                            strokeWidth="2"
                            style={{ transition: 'r .18s ease' }}
                        />
                        <circle cx={point.x} cy={point.y} r="1.5" fill={accent}>
                            <title>{`${key}：${ratings[key]}`}</title>
                        </circle>
                    </g>
                );
            })}

            {HERO_ABILITY_KEYS.map((key, index) => {
                const point = pointFor(index, LABEL_RADIUS);
                const anchor = labelAnchor(point.angle);
                const yAdjust = Math.sin(point.angle) < -0.75 ? -2 : Math.sin(point.angle) > 0.75 ? 7 : 3;
                const isActive = hoveredKey === key;
                return (
                    <text
                        key={key}
                        x={point.x}
                        y={point.y + yAdjust}
                        textAnchor={anchor}
                        className={`hero-radar-label${isActive ? ' is-active' : ''}`}
                        onMouseEnter={() => onHover?.(key)}
                        onMouseLeave={() => onHover?.(null)}
                    >
                        <tspan>{key}</tspan>
                        <tspan dx="4" fill={accent} className="hero-radar-value">{ratings[key]}</tspan>
                    </text>
                );
            })}

            {/* 维度热区：覆盖每个维度从中心到外圈的扇形，触碰时高亮对应维度 */}
            {HERO_ABILITY_KEYS.map((key, index) => {
                const angle = -Math.PI / 2 + (Math.PI * 2 * index) / HERO_ABILITY_KEYS.length;
                const halfSector = Math.PI / HERO_ABILITY_KEYS.length;
                const left = pointForAngle(angle - halfSector, CHART_RADIUS);
                const right = pointForAngle(angle + halfSector, CHART_RADIUS);
                return (
                    <polygon
                        key={`hit-${key}`}
                        points={`${CENTER_X},${CENTER_Y} ${left.x.toFixed(2)},${left.y.toFixed(2)} ${right.x.toFixed(2)},${right.y.toFixed(2)}`}
                        fill="transparent"
                        pointerEvents="all"
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => onHover?.(key)}
                        onMouseLeave={() => onHover?.(null)}
                        onTouchStart={() => onHover?.(key)}
                    />
                );
            })}

            <circle cx={CENTER_X} cy={CENTER_Y} r="3.2" fill={accent} opacity="0.45" />
        </svg>
    );
}
