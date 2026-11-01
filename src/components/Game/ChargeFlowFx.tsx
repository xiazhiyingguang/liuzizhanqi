import { useId, type CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import '../../styles/charge-flow-fx.css';

/** Motion is carried by a changing pressure front and trailing ribbons, never a sliding emblem. */
export function ChargeFlowFx({ event }: { event: SkillFxEvent }) {
    const id = useId().replace(/:/g, ''), damo = event.skillId === 'damo_skill1';
    const sx = (event.fromPos[1] + .5) * 100, sy = (event.fromPos[0] + .5) * 100;
    const dx = (event.targetPos[1] - event.fromPos[1]) * 100, dy = (event.targetPos[0] - event.fromPos[0]) * 100;
    const distance = Math.hypot(dx, dy), angle = distance ? Math.atan2(dy, dx) * 180 / Math.PI : event.angleDeg;
    const shoulder = damo && event.damo?.slideFrom ? Math.hypot((event.damo.slideFrom[1] - event.fromPos[1]) * 100, (event.damo.slideFrom[0] - event.fromPos[0]) * 100) : distance;
    const hit = event.profile.impactMs ?? 260;
    const hits = event.damagePositions ?? event.impactPositions ?? [];
    return <span className={`martial-scene charge-flow ${damo ? 'charge-vajra' : 'charge-overlord'}`}
        data-martial-skill={event.skillId} data-charge-distance={distance}
        style={{ '--charge-r': event.fromPos[0], '--charge-c': event.fromPos[1], '--charge-run': `${Math.max(1, distance)}px`,
            '--charge-shoulder': `${shoulder}px`, '--charge-hit': `${hit}ms`, '--charge-travel': `${hit - 60}ms` } as CSSProperties}>
        <svg className="charge-board" viewBox="0 0 600 600" aria-hidden="true">
            <defs>
                <linearGradient id={`${id}-wake`}><stop stopColor={damo ? '#78613c' : '#6d2429'} stopOpacity="0" /><stop offset=".62" stopColor={damo ? '#b99a60' : '#a74837'} stopOpacity=".26" /><stop offset="1" stopColor={damo ? '#fff0bd' : '#efd4a1'} stopOpacity=".8" /></linearGradient>
                <linearGradient id={`${id}-steel`} x1="0" y1="0" x2=".15" y2="1"><stop stopColor="#fff8dd" /><stop offset=".38" stopColor="#b7a48d" /><stop offset=".62" stopColor="#533e3d" /><stop offset="1" stopColor="#d5b483" /></linearGradient>
            </defs>
            <g transform={`translate(${sx} ${sy}) rotate(${angle})`}>
                <g className="charge-ground">
                    {[-1, 1].map(sign => <path key={sign} d={`M-24 ${sign * 24} Q${distance * .4} ${sign * 35} ${distance + 25} ${sign * 22}`} pathLength="100" />)}
                </g>
                {[0, 1, 2].map(i => <path key={i} className={`charge-wake charge-wake-${i}`} fill={`url(#${id}-wake)`}
                    d={`M-32 ${-13 + i * 13} Q${distance * .46} ${-38 + i * 30} ${distance + 26} ${-9 + i * 9} Q${distance * .5} ${-18 + i * 20} -32 ${-13 + i * 13}Z`} />)}
                {!damo && <g className="charge-blood-silk">
                    <path d={`M-30-12 Q${distance * .25}-48 ${distance * .64}-19 T${distance + 8}-9 Q${distance * .48}-5 -30-12Z`} />
                    <path d={`M-42 17 Q${distance * .24} 39 ${distance * .58} 12 T${distance + 6} 9 Q${distance * .5} 28 -42 17Z`} />
                </g>}
                <g className="charge-front-travel">
                    <g className="charge-pressure">
                        <path className="charge-pressure-bed" d="M-20-39 Q38-20 30 0 Q38 20-20 39 Q5 14 5 0 Q5-14-20-39Z" fill={`url(#${id}-wake)`} />
                        <path className="charge-pressure-edge" d="M-15-37 Q34 0-15 37" pathLength="100" />
                        <path className="charge-pressure-inner" d="M-10-26 Q22 0-10 26" pathLength="100" />
                    </g>
                </g>
                {damo ? <g className="charge-shoulder-travel"><path className="charge-shoulder" d="M-26-22 Q17-35 22-3 Q20 24-22 22" pathLength="100" /></g>
                    : <g className="charge-spear-travel"><g className="charge-spear-turn">
                        <path className="charge-spear-shaft" d="M-62 7 18-5" />
                        <path className="charge-steel" fill={`url(#${id}-steel)`} d="M12-7 25-12 48-9 28-2 16-3Z" />
                        <path className="charge-steel-edge" d="M25-12 48-9 28-2" />
                    </g></g>}
                {Array.from({ length: 8 }, (_, i) => <g key={i} transform={`translate(${distance * (i + 1) / 9} ${i % 2 ? 26 : -26})`}>
                    <path className="charge-dust" d="M-5 0 Q-2-5 5-2 L3 2Z" style={{ '--dust-x': `${-18 - i * 2}px`, '--dust-y': `${(i % 2 ? 1 : -1) * (12 + i * 3)}px`, '--dust-delay': `${60 + i * 15}ms` } as CSSProperties} />
                </g>)}
            </g>
            {hits.map(([r, c]) => <g key={`${r},${c}`} transform={`translate(${(c + .5) * 100} ${(r + .5) * 100}) rotate(${angle})`} data-charge-contact={`${r},${c}`}>
                <g className="charge-contact">
                    <path className="charge-impact-core" d="M-29-20 Q17 0-29 20 M-19-31 Q27 0-19 31" />
                    {[-1, 1].map(sign => <g key={sign}><path className="charge-splinter" d={`M8 ${sign * 8} 36 ${sign * 25} M-8 ${sign * 18} 3 ${sign * 38}`} />
                        <path className="charge-impact-sliver" d={`M4 ${sign * 4} 39 ${sign * 18} 14 ${sign * 9}Z`} /></g>)}
                </g>
            </g>)}
            {damo && event.damo?.hitMountain && <g transform={`translate(${sx + dx} ${sy + dy}) rotate(${angle})`}>
                <g className="martial-wall-crack charge-wall-crack">
                    <path className="charge-fracture" d="M20 0 13-13 25-29 20-48 M13-13 0-19 M20 0 12 17 24 30 20 51 M12 17-1 27 M20 0 38-5 47 6" pathLength="100" />
                    {[0, 1, 2, 3].map(i => <path key={i} className="charge-chip" d="M-4-3 5-2 3 5-3 3Z" style={{ '--chip-x': `${-15 - i * 8}px`, '--chip-y': `${(i % 2 ? 1 : -1) * (23 + i * 10)}px` } as CSSProperties} />)}
                </g>
            </g>}
        </svg>
    </span>;
}
