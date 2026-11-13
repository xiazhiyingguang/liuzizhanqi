import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { qiyuanCross } from '../../core/qiyuan';
import type { SkillFxEvent } from '../../core/skill-fx';
import { BOARD_SIZE, type Position } from '../../types/game';
import '../../styles/qiyuan-scene-fx.css';

const SIZE = 100;
const xy = ([row, col]: Position) => [(col + .5) * SIZE, (row + .5) * SIZE] as const;
const at = (cell: Position) => `translate(${xy(cell).join(' ')})`;

function SpringLantern() {
    const id = useId();
    return <>
        <defs><radialGradient id={`${id}-paper`} cx=".52" cy=".45" r=".65">
            <stop stopColor="#ef774b" /><stop offset=".58" stopColor="#c44033" /><stop offset="1" stopColor="#8d2329" />
        </radialGradient></defs>
        <path d="M0-28V-22M-10-22H10L12-18H-12Z" fill="#a9632f" stroke="#85442b" strokeWidth="1.4" />
        <path d="M-11-18C-30-15-31 11-11 17H11C31 11 30-15 11-18Z" fill={`url(#${id}-paper)`} stroke="#89272a" strokeWidth="1.5" />
        <path d="M-13-16C-24-8-24 6-13 15M13-16C24-8 24 6 13 15M-7-17C-15-9-15 8-7 16M7-17C15-9 15 8 7 16" stroke="#ffb377" strokeOpacity=".64" strokeWidth="1" />
        <path d="M0-13 12-1 0 11-12-1Z" fill="#9e2a2b" stroke="#ffcf81" strokeWidth="1" />
        <text x="0" y="0" dy=".32em" textAnchor="middle" fill="#ffe6a2" fontFamily="serif" fontSize="14" fontWeight="700">福</text>
        <path d="M-12 17H12L9 21H-9Z" fill="#d6994c" stroke="#934e2b" strokeWidth="1.3" />
        <g className="qy-tassel"><path d="M0 21V26M-3 27Q-4 32-7 37M0 27V38M3 27Q4 33 7 37" stroke="#b43b31" strokeWidth="2" /><circle cy="26" r="2.8" fill="#e9b862" /></g>
    </>;
}

function PlumCut({ size = 1 }: { size?: number }) {
    return <g transform={`scale(${size})`}>
        <path fillRule="evenodd" d="M0-27C8-32 15-23 13-15C24-22 33-13 28-4C39 0 32 12 21 13C24 24 14 31 5 23C-1 34-13 30-16 19C-28 23-35 13-28 5C-38-2-30-14-19-13C-21-25-8-31 0-27ZM0-18Q9-9 0-5Q-9-9 0-18ZM17-9Q12 2 4 1Q5-8 17-9ZM17 11Q7 16 3 6Q12 4 17 11ZM-4 17Q-11 9-3 5Q4 12-4 17ZM-17-3Q-7-8-4 0Q-12 5-17-3Z" />
        <circle r="2.8" fill="#f3c477" />
    </g>;
}

function SpringEnvelope() {
    return <g className="qy-envelope">
        <path className="qy-envelope-letter" d="M-22-31H22V17H-22Z" fill="#fbe6ad" stroke="#bd8243" strokeWidth="1.2" />
        <g className="qy-envelope-bloom"><PlumCut size={.72} /></g>
        <path d="M-25 0H25V26Q25 29 22 29H-22Q-25 29-25 26Z" fill="#b83a31" stroke="#84272a" strokeWidth="1.5" />
        <path d="M-24 1 0 17 24 1M-24 27-10 11M24 27 10 11" stroke="#e8ab58" strokeWidth="1.3" />
        <circle cy="17" r="4" fill="#f2c67a" />
    </g>;
}

function WishDelivery({ event }: { event: SkillFxEvent }) {
    const [sx, sy] = xy(event.fromPos), [tx, ty] = xy(event.targetPos);
    const dx = tx - sx, dy = ty - sy;
    const rise = Math.min(34, Math.max(8, Math.min(sy, ty) - 36));
    const style = { '--qy-x': `${dx}px`, '--qy-y': `${dy}px`, '--qy-mid-x': `${dx / 2}px`,
        '--qy-mid-y': `${dy / 2 - rise / 2}px` } as CSSProperties;
    return <g transform={`translate(${sx} ${sy - 18})`}>
        {(dx !== 0 || dy !== 0) && <path className="qy-gold-thread" pathLength="100" d={`M0 0Q${dx / 2} ${dy / 2 - rise} ${dx} ${dy}`} />}
        <g className="qy-lamp-travel" style={style}><g className="qy-lamp-sway"><SpringLantern /></g></g>
    </g>;
}

function GuardWeave({ event, arrives }: { event: SkillFxEvent; arrives: boolean }) {
    const center = event.fromPos;
    const covered = qiyuanCross(center);
    const arms = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([dr, dc]) => {
        const steps = covered.filter(([row, col]) => dr !== 0
            ? col === center[1] && (row - center[0]) * dr > 0
            : row === center[0] && (col - center[1]) * dc > 0).length;
        return { angle: Math.atan2(dr, dc) * 180 / Math.PI, distance: steps * SIZE };
    });
    return <>
        <g transform={at(center)}>
            {arms.filter(arm => arm.distance > 0).map(({ angle, distance }) => <g key={angle} transform={`rotate(${angle})`} data-qiyuan-arm={distance / SIZE}>
                <g className="qy-paper-arm">
                    <path fillRule="evenodd" d={`M0-9H${distance - 21}L${distance}-28 ${distance + 29} 0 ${distance} 28 ${distance - 21} 9H0ZM${distance - 15} 0l15-15 15 15-15 15Z ${Array.from({ length: distance / 25 - 1 }, (_, i) => `M${i * 25 + 12} 0l7-4 7 4-7 4Z`).join(' ')}`} />
                    <path className="qy-paper-edge" d={`M13-10H${distance - 22}L${distance}-29 ${distance + 30} 0 ${distance} 29 ${distance - 22} 10H13`} />
                    <path className="qy-paper-spark" pathLength="100" d={`M4 0H${distance + 26}`} />
                </g>
            </g>)}
            <g className="qy-guard-knot"><PlumCut size={1.1} /></g>
        </g>
        {arrives && (event.softImpactPositions ?? []).map(cell => <g key={cell.join(',')} transform={at(cell)} data-qiyuan-recipient={cell.join(',')}>
            <g className="qy-paper-receive"><path d="M-24 16Q0 37 24 16M-19 23Q0 33 19 23" /><g transform="translate(24 -25)"><PlumCut size={.35} /></g></g>
        </g>)}
    </>;
}

export function QiyuanSceneFx({ event }: { event: SkillFxEvent }) {
    const scene = event.profile.inkScene;
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
        for (const animation of root.current.getAnimations({ subtree: true })) animation.startTime = start;
    }, [ready, event.bornAt]);
    if (!ready || !scene) return null;

    const guard = scene === 'guard-cast' || scene === 'guard-arrive';
    const rescue = scene === 'wish-rescue';
    return <svg ref={root} viewBox={`0 0 ${BOARD_SIZE * SIZE} ${BOARD_SIZE * SIZE}`} className={`qy-scene${guard ? ' qy-guard' : ''}`}
        data-ink-scene={scene} aria-hidden="true" style={{ '--qy-hit': `${event.profile.impactMs ?? 350}ms` } as CSSProperties}>
        {guard ? <GuardWeave event={event} arrives={scene === 'guard-arrive'} /> : scene === 'wish-cast' ? <WishDelivery event={event} /> :
            <g transform={at(event.targetPos)} data-qiyuan-recipient={event.targetPos.join(',')}>
                <path className="qy-landing" d="M-36 20Q0 40 36 20Q0 26-36 20Z" />
                {rescue ? <>
                    <path className="qy-rescue-stroke" pathLength="100" d="M-30 19Q-19 36 8 24Q41 9 28-16Q14-36 0-27Q-15-18-7-6Q4 9 16 0" />
                    <g className="qy-relight"><SpringLantern /></g>
                </> : <>
                    <g className="qy-lamp-descend"><SpringLantern /></g>
                    <SpringEnvelope />
                </>}
            </g>}
    </svg>;
}
