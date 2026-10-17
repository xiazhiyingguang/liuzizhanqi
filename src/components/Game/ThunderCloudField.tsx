import { memo, useId, type CSSProperties } from 'react';
import type { BoardEffect, Player, Position } from '../../types/game';
import { CLOUD_SILHOUETTE, cloudClipVars } from '../../core/yunxiu-cloud-fx';
import '../../styles/thunder-cloud-fx.css';
import '../../styles/yunxiu-storm-field.css';

/** Broad, overlapping cloud fronts share one outline; no cell-sized puffs or tile borders. */
export function ThunderCloudArt() {
    const id = useId().replace(/:/g, '');
    return <svg className="yx-cloud-art" viewBox="0 0 300 300" aria-hidden="true">
        <defs>
            <radialGradient id={`${id}-cloud`} cx="42%" cy="30%" r="72%">
                <stop offset="0" stopColor="#d8e0e5" stopOpacity=".32" />
                <stop offset=".46" stopColor="#647082" stopOpacity=".28" />
                <stop offset=".8" stopColor="#39475b" stopOpacity=".34" />
                <stop offset="1" stopColor="#9ca8b1" stopOpacity=".08" />
            </radialGradient>
            <linearGradient id={`${id}-silver`} x1="0" y1="0" x2=".3" y2="1">
                <stop stopColor="#eef0e7" stopOpacity=".65" />
                <stop offset=".52" stopColor="#b4bbc3" stopOpacity=".15" />
                <stop offset="1" stopColor="#29374a" stopOpacity=".32" />
            </linearGradient>
            <filter id={`${id}-soft`} x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="3" /></filter>
            <filter id={`${id}-vapor`} x="-16%" y="-16%" width="132%" height="132%">
                <feTurbulence type="fractalNoise" baseFrequency=".035 .025" numOctaves="3" seed="11" result="vapor" />
                <feDisplacementMap in="SourceGraphic" in2="vapor" scale="22" xChannelSelector="R" yChannelSelector="G" />
                <feGaussianBlur stdDeviation="4" />
            </filter>
            <filter id={`${id}-grain`}>
                <feTurbulence type="fractalNoise" baseFrequency=".026 .032" numOctaves="3" seed="7" />
                <feColorMatrix type="matrix" values="0 0 0 0 .30  0 0 0 0 .36  0 0 0 0 .44  1.7 0 0 0 -.4" />
                <feGaussianBlur stdDeviation=".7" />
            </filter>
            <mask id={`${id}-outline`} maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="300">
                <path d={CLOUD_SILHOUETTE} fill="white" filter={`url(#${id}-vapor)`} />
            </mask>
        </defs>
        <g mask={`url(#${id}-outline)`}>
            <path d={CLOUD_SILHOUETTE} fill={`url(#${id}-cloud)`} />
            <rect className="yx-cloud-texture" x="0" y="0" width="300" height="300" filter={`url(#${id}-grain)`} opacity=".38" />
            <g className="yx-cloud-fronts" filter={`url(#${id}-soft)`}>
                <path d="M -15 78 C 8 44 44 72 67 43 C 95 18 120 65 153 42 C 186 23 210 68 241 48 C 279 35 313 64 321 95 C 275 119 232 85 192 105 C 148 128 112 83 70 110 C 28 132 -2 111 -15 78 Z" fill={`url(#${id}-silver)`} />
                <path d="M -18 169 C 13 132 48 167 78 144 C 119 113 139 164 172 143 C 214 119 249 158 287 138 L 325 180 C 288 214 248 180 219 201 C 177 228 148 187 113 212 C 69 238 38 187 1 207 Z" fill={`url(#${id}-silver)`} opacity=".76" />
                <path d="M 9 244 C 43 206 81 251 111 231 C 148 205 174 252 214 229 C 256 208 281 248 304 233 L 300 305 L 0 305 Z" fill={`url(#${id}-silver)`} opacity=".58" />
            </g>
            <path className="yx-cloud-seam" d="M 27 89 Q 49 77 70 86 T 117 82 M 165 172 Q 190 153 212 166 T 259 164 M 61 246 Q 87 234 107 242" />
        </g>
    </svg>;
}

export const ThunderCloudField = memo(function ThunderCloudField({ position, owner, duration }: {
    position: Position; owner: Player; duration?: number;
}) {
    return <div className={`yx-cloud-field yx-cloud-field-${owner === 'player1' ? 'p1' : 'p2'}`}
        style={{ '--yx-cloud-row': position[0] - 1, '--yx-cloud-col': position[1] - 1,
            ...cloudClipVars(position) } as CSSProperties}
        data-cloud-center={position.join(',')}
        title={`雷云 · 3×3${duration === undefined ? '' : ` · 还能落雷 ${duration} 次`}`}>
        <ThunderCloudArt />
        <span className="yx-cloud-range" />
        {duration !== undefined && <span className="yx-cloud-count"><i />雷云 {duration}</span>}
    </div>;
});

export function ThunderCloudLayer({ effects }: { effects: BoardEffect[] | undefined }) {
    const clouds = effects?.filter(effect => effect.type === 'thunder-cloud') ?? [];
    if (!clouds.length) return null;
    return <div className="yx-cloud-layer" aria-hidden="true">
        {clouds.map(cloud => <ThunderCloudField key={cloud.id} position={cloud.position} owner={cloud.owner} duration={cloud.duration} />)}
    </div>;
}
