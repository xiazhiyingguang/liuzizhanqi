import { memo, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { computeFxAngleDeg, computeFxImpactDelayMs, type SkillFxEvent } from '../../core/skill-fx';
import { BOARD_SIZE, type Position } from '../../types/game';
import '../../styles/tide-flower-fx.css';

const UNIT = 100;
const xy = ([r, c]: Position) => [(c + .5) * UNIT, (r + .5) * UNIT] as const;
const at = (p: Position) => `translate(${xy(p).join(' ')})`;
const petal = 'M0 0C-6-5-8-12-2-16C5-15 9-10 5-5Z';

function MistContours({ tint }: { tint: string }) {
    const id = useId();
    return <>
        <defs>
            <radialGradient id={`${id}-mist`} cx=".49" cy=".54" r=".68">
                <stop stopColor={tint} stopOpacity=".58" />
                <stop offset=".67" stopColor={tint} stopOpacity=".40" />
                <stop offset="1" stopColor={tint} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-thread`}>
                <stop stopColor="#fff7ed" stopOpacity="0" />
                <stop offset=".44" stopColor="#fff7ed" stopOpacity=".78" />
                <stop offset="1" stopColor="#fff7ed" stopOpacity="0" />
            </linearGradient>
        </defs>
        <rect width="300" height="300" rx="54" fill={`url(#${id}-mist)`} />
        <path d="M-12 111C54 73 67 119 131 96S227 50 313 80L313 133C224 92 200 128 129 143S41 119-12 154Z"
            fill={`url(#${id}-mist)`} opacity=".62" />
        <path d="M-6 193C44 149 86 205 145 173S239 144 310 171L311 227C242 197 198 205 155 224S52 202-7 237Z"
            fill={`url(#${id}-mist)`} opacity=".68" />
        <path d="M5 109C67 83 93 120 153 93S234 59 294 83M-1 193C47 166 88 203 148 177S230 151 299 172M28 243C79 220 108 248 161 228S235 215 278 225"
            fill="none" stroke={`url(#${id}-thread)`} strokeWidth="2.4" />
    </>;
}

/** The only persistent layer: one static wash per fog, clipped to the board. */
export const FlowerFogLayer = memo(function FlowerFogLayer({ fields }: {
    fields: Array<{ key: string; center: Position; friendly?: boolean }>;
}) {
    if (!fields.length) return null;
    return <div className="tf-fog-field" aria-hidden="true">
        {fields.map(({ key, center: [r, c], friendly }) =>
            <svg key={key} className={`tf-fog-sheet${friendly ? ' is-friendly' : ''}`} viewBox="0 0 300 300"
                data-fog-center={`${r},${c}`} style={{ '--tf-r': r - 1, '--tf-c': c - 1 } as CSSProperties}>
                <MistContours tint="#7e687f" />
            </svg>
        )}
    </div>;
});

function SwordGlint() {
    return <g className="tf-blade">
        <path d="M-48 0L-38-4H-16L0 0L-16 4H-38Z" fill="#f7f2da" stroke="var(--tf-dark)" strokeWidth="1.25" />
        <path d="M-38-7V7M-48 0H-3" fill="none" stroke="var(--tf-dark)" strokeWidth="1.15" />
    </g>;
}

function BrushCut({ event, flower }: { event: SkillFxEvent; flower: boolean }) {
    const cells = event.coveredPositions;
    const end = flower || !cells?.length ? event.targetPos : cells[cells.length - 1];
    const [sx, sy] = xy(event.fromPos), [ex, ey] = xy(end);
    const span = Math.hypot(ex - sx, ey - sy);
    if (span < 1) return null;
    const phantom = event.profile.inkScene === 'tide-cut-phantom';
    const thickness = flower ? 13 : phantom ? 27 : 19;
    const angle = computeFxAngleDeg(event.fromPos, end);
    const hit = computeFxImpactDelayMs(event, end);
    return <g transform={`translate(${sx} ${sy}) rotate(${angle})`}>
        <g className="tf-cut-ink" style={{ '--tf-hit': `${hit}ms` } as CSSProperties}>
            <path d={`M3 10 Q${span * .24} ${-thickness} ${span * .55} -14 Q${span * .8} -9 ${span + 14} 0 Q${span * .85} -2 ${span * .58} 5 Q${span * .24} 19 3 10Z`} fill="var(--tf-dark)" />
            <path d={`M7 11Q${span * .29} 6 ${span * .56} -6T${span + 10} 0`} fill="none" stroke="var(--tf-edge)" strokeWidth="2.7" />
            {phantom && <path d={`M4 16Q${span * .35} 28 ${span * .61} 12Q${span * .85} 0 ${span + 7} 1`} fill="none" stroke="#37787a" strokeWidth="5" opacity=".72" />}
            {flower && <path d={`M16 19Q${span * .35} 21 ${span + 6} -3`} fill="none" stroke="#ac7288" strokeWidth="1.8" opacity=".82" />}
        </g>
        <g className={`tf-moving-blade${phantom && cells && cells.length > 1 ? ' is-through' : ''}`}
            style={{ '--tf-span': `${span}px`, '--tf-hit': `${hit}ms` } as CSSProperties}>
            <SwordGlint />
        </g>
    </g>;
}

const TIDE_SWELL = 'M-104 34C-148-43-91-117-19-106C35-99 67-76 107-54C62-78 29-66 60-44C127-12 133 42 80 83C43 116-23 121-71 89C-21 110 39 91 55 61C71 28 18 26 7-10C-8-45 20-66 49-66C-42-103-108-53-104 34Z';
const TIDE_FOAM = 'M-110 29C-136-34-79-99-19-94C31-91 69-72 100-53M-56 93C9 111 65 80 77 43C85 20 57 7 39-4';

function TideSweep({ event, clip }: { event: SkillFxEvent; clip: string }) {
    const phantom = event.profile.inkScene === 'tide-sweep-phantom';
    return <g clipPath={clip} data-tide-sweep={phantom ? 'double' : 'single'}>
        <g transform={at(event.fromPos)}>
            <g className="tf-sweep">
                <path d={TIDE_SWELL} fill="var(--tf-dark)" />
                <path d={TIDE_FOAM} fill="none" stroke="var(--tf-edge)" strokeWidth="3.2" />
                <path d="M-98-9C-78-58-42-74-7-64M91 36C88 63 64 84 41 92" fill="none" stroke="#88aaa1" strokeWidth="2.1" />
            </g>
            {phantom && <g className="tf-sweep tf-sweep-outer">
                <path d={TIDE_SWELL} fill="#377473" />
                <path d={TIDE_FOAM} fill="none" stroke="#edf6de" strokeWidth="2.1" />
            </g>}
        </g>
    </g>;
}

function FlowerDecoy({ event }: { event: SkillFxEvent }) {
    const [sx, sy] = xy(event.fromPos), [ex, ey] = xy(event.targetPos);
    return <>
        <path className="tf-flower-thread" d={`M${sx} ${sy + 16} Q${(sx + ex) / 2} ${Math.min(sy, ey) - 52} ${ex} ${ey + 11}`}
            pathLength="100" fill="none" stroke="#925d77" strokeWidth="2.1" />
        <g transform={at(event.targetPos)}>
            <path className="tf-decoy-wash" d="M-45 14C-30-4-8 17 9 1C28-18 46-4 46 15C25 24-18 26-45 14Z" fill="#946e87" />
            <g className="tf-decoy-bloom">
                {[0, 72, 144, 216, 288].map(angle => <path key={angle} d={petal} transform={`rotate(${angle}) scale(1.65)`} fill="#e1b4c1" stroke="#8d5470" strokeWidth=".85" />)}
                <circle r="3.5" fill="#a46b54" />
            </g>
        </g>
    </>;
}

function ImpactCuts({ event }: { event: SkillFxEvent }) {
    return <>{(event.damagePositions ?? []).map(cell =>
        <g key={cell.join(',')} transform={at(cell)} data-ink-contact={cell.join(',')}>
            <g className="tf-contact" style={{ '--tf-hit': `${computeFxImpactDelayMs(event, cell)}ms` } as CSSProperties}>
                <path d="M-28 16Q-4-7 29-17Q9-5-7 7Z" fill="var(--tf-edge)" />
                <path d="M-24 14L24-13M-15 21L0 12" stroke="var(--tf-dark)" strokeWidth="1.8" />
            </g>
        </g>
    )}</>;
}

/** Shared battle/codex art. Scene geometry reads resolved coverage, not the clicked cell's UI highlight. */
export const TideFlowerSceneFx = memo(function TideFlowerSceneFx({ event }: { event: SkillFxEvent }) {
    const scene = event.profile.inkScene;
    const id = useId();
    const root = useRef<SVGSVGElement>(null);
    const [ready, setReady] = useState(() => Date.now() >= event.bornAt);
    useEffect(() => {
        const wait = event.bornAt - Date.now();
        if (wait <= 0) { setReady(true); return; }
        const timer = setTimeout(() => setReady(true), wait);
        return () => clearTimeout(timer);
    }, [event.bornAt]);
    useEffect(() => {
        if (!ready || !root.current) return;
        const start = performance.now() - Math.max(0, Date.now() - event.bornAt);
        for (const anim of root.current.getAnimations?.({ subtree: true }) ?? []) anim.startTime = start;
    }, [ready, event.bornAt]);
    if (!scene || !ready) return null;

    const sweep = scene.startsWith('tide-sweep');
    const mist = scene === 'flower-mist';
    const range = [mist ? event.targetPos : event.fromPos, ...(event.coveredPositions ?? [])];
    const rows = range.map(cell => cell[0]), cols = range.map(cell => cell[1]);
    const r0 = Math.min(...rows), c0 = Math.min(...cols);
    const [tx, ty] = xy(event.targetPos);
    return <svg ref={root} className="tf-ink-scene" viewBox={`0 0 ${BOARD_SIZE * UNIT} ${BOARD_SIZE * UNIT}`}
        data-ink-scene={scene} aria-hidden="true" style={{ '--tf-dark': event.profile.c1, '--tf-edge': event.profile.c2 } as CSSProperties}>
        {(sweep || mist) && <defs><clipPath id={`${id}-range`}>
            <rect x={c0 * UNIT} y={r0 * UNIT} width={(Math.max(...cols) - c0 + 1) * UNIT} height={(Math.max(...rows) - r0 + 1) * UNIT} />
        </clipPath></defs>}
        {sweep ? <TideSweep event={event} clip={`url(#${id}-range)`} />
            : mist ? <g clipPath={`url(#${id}-range)`}>
                <svg x={tx - 150} y={ty - 150} width="300" height="300" viewBox="0 0 300 300">
                    <g className="tf-mist-arrival"><MistContours tint="#8f607e" /></g>
                </svg>
            </g>
            : scene === 'flower-decoy' ? <FlowerDecoy event={event} /> : <BrushCut event={event} flower={scene === 'flower-stab'} />}
        <ImpactCuts event={event} />
    </svg>;
});
