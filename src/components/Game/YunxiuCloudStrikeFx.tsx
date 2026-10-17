import type { CSSProperties } from 'react';
import { CLOUD_SILHOUETTE, cloudClipVars, cloudStrikePaths } from '../../core/yunxiu-cloud-fx';
import type { SkillFxEvent } from '../../core/skill-fx';
import '../../styles/yunxiu-storm-field.css';

/** One discharge canvas across the full cloud; only actual attacked cells receive a bolt. */
export function YunxiuCloudStrikeFx({ event }: { event: SkillFxEvent }) {
    const hits = cloudStrikePaths(event.targetPos, event.damagePositions ?? event.impactPositions ?? []);
    return <span className="yx-cloud-discharge" data-cloud-attack={event.id}
        style={{ ...cloudClipVars(event.targetPos), '--yx-hit-ms': `${event.profile.impactMs ?? 320}ms` } as CSSProperties}>
        <svg className="yx-cloud-charge" viewBox="0 0 300 300" aria-hidden="true">
            <path d={CLOUD_SILHOUETTE} />
            <path className="yx-cloud-charge-thread" d="M 36 95 L 83 82 L 76 99 L 128 88 M 171 195 L 213 170 L 203 191 L 257 179" />
        </svg>
        <svg className="yx-cloud-lightning" viewBox="0 0 300 300" aria-hidden="true">
            {hits.map(hit => <g key={hit.key} data-cloud-hit={hit.key}>
                <g className="yx-gold-bolt">
                    <path className="yx-gold-halo" d={hit.d} pathLength={100} />
                    <path className="yx-gold-branch" d={hit.fork} pathLength={100} />
                    <path className="yx-gold-edge" d={hit.d} pathLength={100} />
                    <path className="yx-gold-core" d={hit.d} pathLength={100} />
                </g>
                <g className="yx-gold-contact" style={{ transformOrigin: `${hit.x}px ${hit.y}px` }}>
                    <ellipse cx={hit.x} cy={hit.y} rx="16" ry="7" className="yx-gold-ground" />
                    <ellipse cx={hit.x} cy={hit.y} rx="7" ry="3" className="yx-gold-hotspot" />
                    <path d={`M ${hit.x - 22} ${hit.y - 8} l -5 -4 M ${hit.x + 17} ${hit.y - 12} l 4 -8 M ${hit.x + 20} ${hit.y + 3} l 9 1 M ${hit.x - 10} ${hit.y + 12} l -3 6`} />
                </g>
            </g>)}
        </svg>
    </span>;
}
