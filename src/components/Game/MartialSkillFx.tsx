import type { CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import type { Position } from '../../types/game';
import { martialSlashRotation } from '../../core/martial-fx';
import '../../styles/martial-skill-fx.css';
import { ChargeFlowFx } from './ChargeFlowFx';

const center = (p: Position) => [(p[1] + .5) * 100, (p[0] + .5) * 100];

/** 一张场景表示一次出手；落拳只来自规则层的真实拳序，不补满四拳。 */
export function MartialSkillFx({ event }: { event: SkillFxEvent }) {
    if (event.skillId === 'damo_skill1' || event.skillId === 'xiangyu_skill1') return <ChargeFlowFx event={event} />;
    const damo = event.skillId?.startsWith('damo'), flurry = event.skillId === 'damo_skill2';
    const slash = event.skillId === 'xiangyu_skill2';
    const [sx, sy] = center(event.fromPos), [tx, ty] = center(event.targetPos);
    const fists = flurry ? (event.damo?.cells ?? []).slice(0, event.damo?.punches ?? 0) : [];
    const hits = flurry ? fists : event.damagePositions ?? event.impactPositions ?? [];
    const cells = slash ? event.coveredPositions ?? [] : [];
    const rotation = martialSlashRotation(event);
    return <span className={`martial-scene ${damo ? 'martial-vajra' : 'martial-overlord'}`} data-martial-skill={event.skillId}
        style={{ '--martial-r': event.fromPos[0], '--martial-c': event.fromPos[1] } as CSSProperties}>
        <svg viewBox="0 0 600 600" className="martial-board" aria-hidden="true">
            {!flurry && !slash && <>
                <path className="martial-rut" d={`M${sx} ${sy + 22}L${tx} ${ty + 22}`} pathLength="100" />
                <g transform={`translate(${sx} ${sy}) rotate(${event.angleDeg})`}>
                    <g className="martial-ram" style={{ '--martial-distance': `${Math.hypot(tx - sx, ty - sy)}px` } as CSSProperties}>
                        {damo ? <><path className="martial-solid" d="M-32 15Q-24-20-6-20L9-9 27-8 32 5 17 13-2 10-12 27Z" />
                            <path className="martial-edge" d="M-27 12-16-11-3-13 5-5 25-4M10-6 10 10M18-5 18 9" /></>
                            : <><path className="martial-solid" d="M-38 24-20-19 1-27 17-13 28 19-3 11Z" />
                                <path className="martial-edge" d="M-32 15-13-18 1-21 12-8M-48-4 42-4 54-1 42 3-48 3M-27 8-42 18" /></>}
                    </g>
                </g>
                {event.damo?.slideFrom && event.damo.slideTo && <path className="martial-push" d={`M${center(event.damo.slideFrom).join(' ')}L${center(event.damo.slideTo).join(' ')}`} pathLength="100" />}
            </>}
            {slash && <g>
                {cells.map((p, i) => <rect key={i} className="martial-sweep-bed" x={p[1] * 100 + 4} y={p[0] * 100 + 4} width="92" height="92" rx="5" />)}
                <g transform={`translate(${sx} ${sy}) rotate(${rotation})`}>
                    <path className="martial-blade-body" d="M28-127Q198-130 245 0 198 130 28 127Q148 78 169 0 148-78 28-127Z" />
                    <path className="martial-blade-edge" d="M28-127Q198-130 245 0 198 130 28 127" pathLength="100" />
                    <path className="martial-blade-grain" d="M65-91Q171-65 203 0 171 65 65 91M101-82Q202-38 213-4" />
                </g>
            </g>}
            {hits.map((p, index) => <g key={index} transform={`translate(${center(p).join(' ')})`}>
                <g className={`martial-contact${flurry ? ' martial-punch' : ''}`} style={{ '--martial-delay': `${flurry ? 220 + index * 120 : event.profile.impactMs ?? 240}ms` } as CSSProperties}>
                    {damo && <><path className="martial-solid" d="M-24-12-15-23 16-23 27-10 24 16 12 24-14 21-25 7-32 3-30-8Z" />
                        <path className="martial-edge" d="M-16-21-16-9M-5-23-5-10M6-23 6-10M17-20 17-8M-27-7-13 2-15 13" /></>}
                    <path className="martial-impact-strokes" d="M-38-8-25-3M30 8l15 5M-13-33-8-25M14 28l8 12M-24 24l-10 9" />
                </g>
            </g>)}
            {event.damo?.hitMountain && <g transform={`translate(${tx} ${ty}) rotate(${event.angleDeg})`}>
                <g className="martial-wall-crack"><path d="M24-37 17-14 30 0 17 17 25 38M30 0 44-9M17 17 5 25M17-14 6-25" />
                    <path className="martial-stones" d="m29-24 9-4-1 9-7 1Zm8 40 8 2-5 8-7-4ZM0-35l6-4 2 7-5 3Z" /></g>
            </g>}
        </svg>
    </span>;
}
