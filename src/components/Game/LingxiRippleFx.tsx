import { useId, type CSSProperties } from 'react';
import type { Position, SkillFxEvent } from '../../core/skill-fx';
import { isLowQuality } from '../../core/render-quality';
import '../../styles/lingxi-ripple-fx.css';

// Smooth, slightly uneven contours, computed once rather than on animation frames.
function waterContour(radius: number, phase: number): string {
    const count = 80;
    const points = Array.from({ length: count }, (_, i) => {
        const angle = i * Math.PI * 2 / count;
        const r = radius + .8 * Math.sin(angle * 3 + phase)
            + .38 * Math.sin(angle * 7 - phase) + .18 * Math.cos(angle * 13 + phase);
        return [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)] as [number, number];
    });
    const point = (index: number) => points[(index + count) % count];
    const fmt = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
    let path = `M${fmt(...point(0))}`;
    for (let i = 0; i < count; i++) {
        const [p0, p1, p2, p3] = [point(i - 1), point(i), point(i + 1), point(i + 2)];
        path += ` C${fmt(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)}`
            + ` ${fmt(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)}`
            + ` ${fmt(p2[0], p2[1])}`;
    }
    return `${path} Z`;
}

const WAVES = [0, 1, 2, 3].map(i => ({
    crest: waterContour(46, i * 1.7),
    wake: waterContour(44.7, i * 1.7),
    thread: waterContour(43.3, i * 1.7 + .25),
}));

function waveReach(event: SkillFxEvent): number {
    // The aimed cell need not be the center (or even inside the self-centered box).
    const cells = event.coveredPositions?.length
        ? event.coveredPositions : [event.targetPos, ...(event.impactPositions ?? [])];
    return Math.max(1.25, ...cells.map(([r, c]) => Math.hypot(r - event.fromPos[0], c - event.fromPos[1]) + .35));
}

/** One shared water surface, anchored to the caster even at a clipped board edge. */
export function LingxiRippleFx({ event }: { event: SkillFxEvent }) {
    const id = useId().replace(/:/g, '');
    const reach = waveReach(event);
    const waves = isLowQuality() ? WAVES.slice(0, 3) : WAVES;
    return (
        <span className="lx-ripple-source" style={{ '--lx-span': String(reach * 2 / .92) } as CSSProperties}>
            <svg className="lx-water-defs" aria-hidden="true">
                <defs>
                    <linearGradient id={`${id}-water`} x1="0" y1="0" x2=".85" y2="1">
                        <stop stopColor="#367d87" stopOpacity=".12" />
                        <stop offset=".32" stopColor="#69a8aa" stopOpacity=".34" />
                        <stop offset=".65" stopColor="#296c79" stopOpacity=".6" />
                        <stop offset="1" stopColor="#70b3b4" stopOpacity=".18" />
                    </linearGradient>
                    <linearGradient id={`${id}-foam`} x1="0" y1="0" x2="1" y2=".7">
                        <stop stopColor="#edf6ed" stopOpacity=".35" />
                        <stop offset=".45" stopColor="#f8fff7" stopOpacity=".9" />
                        <stop offset="1" stopColor="#d1e5dd" stopOpacity=".2" />
                    </linearGradient>
                    <radialGradient id={`${id}-wash`}>
                        <stop offset=".79" stopColor="#77acb0" stopOpacity="0" />
                        <stop offset=".91" stopColor="#70a5a9" stopOpacity=".09" />
                        <stop offset=".975" stopColor="#619da4" stopOpacity=".17" />
                        <stop offset="1" stopColor="#8ab9b9" stopOpacity="0" />
                    </radialGradient>
                </defs>
            </svg>
            {waves.map((wave, i) => (
                <span key={i} className="lx-water-wave" style={{ '--lx-wave-index': i } as CSSProperties}>
                    <svg viewBox="0 0 100 100" aria-hidden="true">
                        <path className="lx-water-wash" d={wave.crest} fill={`url(#${id}-wash)`} />
                        <path className="lx-water-wake" d={wave.wake} stroke={`url(#${id}-water)`} />
                        <path className="lx-water-crest" d={wave.crest} stroke={`url(#${id}-water)`} />
                        <path className="lx-water-thread" d={wave.thread} stroke={`url(#${id}-water)`} />
                        <path className="lx-water-foam" d={wave.crest} stroke={`url(#${id}-foam)`} pathLength="100" />
                        <path className="lx-water-flecks" d={wave.wake} stroke={`url(#${id}-foam)`} pathLength="100" />
                    </svg>
                </span>
            ))}
        </span>
    );
}

/** Only a few wet brush marks at each hit; these never start another expanding ring. */
export function LingxiWaterTouchFx({ event, atPos }: { event: SkillFxEvent; atPos?: Position }) {
    const cell = atPos ?? event.targetPos;
    const distance = Math.hypot(cell[0] - event.fromPos[0], cell[1] - event.fromPos[1]);
    const delay = Math.max(0, Math.round(900 * (distance / waveReach(event) - .1) / .9));
    return <span className="lx-water-touch" style={{ '--lx-touch-delay': `${delay}ms` } as CSSProperties}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
            <path d="M21 65 Q32 70 43 65 M50 68 Q61 73 76 65 M27 76 Q38 80 48 76 M57 79 Q65 80 70 77" />
        </svg>
    </span>;
}
