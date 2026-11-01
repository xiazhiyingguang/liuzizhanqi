import { useEffect, useId, useRef, type CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import { arrivalPoint, FROST_ARRIVE_MS, HAIR_ARRIVE_MS } from '../../core/tianwei-arrival-fx';
import { isLowQuality } from '../../core/render-quality';
import HeroAvatar from '../ui/HeroAvatar';
import { WukongFigureGlyph } from './WukongFxDetails';
import '../../styles/tianwei-arrival-fx.css';

/** 地面冷流/单根毫毛共用一条快照轨迹，每次触发只有一个 SVG 与一个限帧循环。 */
export function TianweiArrivalFx({ event }: { event: SkillFxEvent }) {
    const traveller = useRef<SVGGElement>(null);
    const id = useId().replace(/:/g, '');
    const frost = event.profile.arrival === 'frost-lock';
    const arrive = frost ? FROST_ARRIVE_MS : HAIR_ARRIVE_MS;
    useEffect(() => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0, last = -Infinity;
        const draw = (now: number) => {
            const elapsed = Date.now() - event.bornAt;
            if (now - last < (isLowQuality() ? 33 : 16)) { frame = requestAnimationFrame(draw); return; }
            last = now;
            const progress = (elapsed - 70) / (arrive - 70);
            const point = arrivalPoint(event.fromPos, event.targetPos, progress, frost);
            const node = traveller.current;
            if (node) {
                node.setAttribute('transform', `translate(${point.x} ${point.y + (frost ? 24 : 0)}) rotate(${point.angle})`);
                node.style.opacity = !reduced.matches && elapsed >= 70 && elapsed < arrive ? '1' : '0';
                node.dataset.arrivalProgress = String(Math.max(0, Math.min(1, progress)));
            }
            if (!reduced.matches && elapsed < arrive) frame = requestAnimationFrame(draw);
        };
        const change = () => { cancelAnimationFrame(frame); last = -Infinity; draw(performance.now()); };
        draw(performance.now()); reduced.addEventListener('change', change);
        return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', change); };
    }, [event.bornAt, event.fromPos, event.targetPos, arrive, frost]);
    const sx = (event.fromPos[1] + .5) * 100, sy = (event.fromPos[0] + .5) * 100;
    const x = (event.targetPos[1] + .5) * 100, y = (event.targetPos[0] + .5) * 100;
    const dx = x - sx, dy = y - sy, length = Math.hypot(dx, dy) || 1;
    const bend = frost ? 10 : -22;
    const floor = frost ? 24 : 0;
    const path = `M${sx} ${sy + floor} Q${(sx + x) / 2 - dy / length * bend * 2} ${(sy + y) / 2 + floor + dx / length * bend * 2} ${x} ${y + floor}`;
    return <span className={`tw-arrival tw-${frost ? 'frost' : 'clone'}`} data-tianwei-arrival={event.profile.arrival}
        data-arrival-target={event.arrival?.targetHeroId} style={{ '--tw-r': event.fromPos[0], '--tw-c': event.fromPos[1], '--tw-arrive': `${arrive}ms` } as CSSProperties}>
        <svg className="tw-scene" viewBox="0 0 600 600" aria-hidden="true">
            <defs><linearGradient id={`${id}-ice`} x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#f1f8f1" stopOpacity=".65" /><stop offset=".5" stopColor="#8eb5c3" stopOpacity=".23" /><stop offset="1" stopColor="#365970" stopOpacity=".48" />
            </linearGradient></defs>
            <path className="tw-ground-wash" d={path} pathLength="100" />
            <path className="tw-thread" d={path} pathLength="100" />
            <g transform={`translate(${sx} ${sy})`} className="tw-source">
                {frost ? <path d="M-27 22Q0 12 28 22M-17 27Q1 20 18 26" /> : <path d="M-9-25Q3-37 14-30M-5-23Q6-29 13-27" />}
            </g>
            <g ref={traveller} className="tw-traveller" style={{ opacity: 0 }}>
                {frost ? <><path d="M-30-5Q-12-13 5-4L20 0 2 4Q-17 13-32 8Q-9 2-30-5Z" fill="#8caebb" opacity=".55" />
                    <path d="M-24 2Q-1-5 18 0M-17 9 2 4" stroke="#eff7f2" strokeWidth="1.5" /></> : <>
                    <path d="M-25 5Q-4-3 25 0" stroke="#76542d" strokeWidth="1.7" />
                    <path d="M-22 3Q0-6 23 0" stroke="#e6cb82" strokeWidth=".9" />
                    <path d="M-20 2-13-2M-13 1-6-3M-5 0 2-3M5-1 12-2" stroke="#b39864" strokeWidth=".6" />
                </>}
            </g>
            <g transform={`translate(${x} ${y})`}>
                {frost ? <>
                    <g className="tw-frost-foot"><ellipse cy="25" rx="37" ry="11" /><path d="M-33 25-20 20-12 24 1 17 15 22 29 19 37 24" /></g>
                    <g className="tw-ice-shell" data-frost-shell="arrival">
                        <path d="M-33 23-35-16-22-36-13-31-22-6-19 24Z" fill={`url(#${id}-ice)`} />
                        <path d="M22 24 18-10 26-38 36-23 34 20Z" fill={`url(#${id}-ice)`} />
                        <path d="M-23-31-8-41 13-40 26-34 18-28-8-29Z" fill={`url(#${id}-ice)`} />
                        <path d="M-34-15-22-35-20-13-28 1-19 22M26-36 23-14 32-4 29 21M-8-40-2-31 13-39" />
                    </g>
                    <g className="tw-ice-splinters">{[-34, -19, 18, 34].map((a, i) => <path key={a} d={`M${a} 22l${i % 2 ? -5 : 6} -11 3 16Z`} />)}</g>
                </> : <>
                    <g className="tw-smoke tw-smoke-back"><path d="M-40 25Q-55 8-37-4Q-28-13-15-2Q-18-25 2-24Q23-26 20-4Q39-20 47-2Q61 14 37 26Z" />
                        <path d="M-36 20Q-47 7-35 2M-8-12Q-3-21 9-15M29 0Q42-5 44 7" /></g>
                    <g className="tw-monkey-figure" transform="translate(-30 -46)"><WukongFigureGlyph width={60} height={83} /></g>
                    <foreignObject x="-27" y="-27" width="54" height="54" className="tw-clone-reveal"><div className="tw-clone-avatar"><HeroAvatar heroId={event.sourceHeroId ?? 'wukong'} size={54} eager /></div></foreignObject>
                    <g className="tw-smoke tw-smoke-front"><path d="M-43 23Q-21 10-6 23Q5 31 23 19Q41 8 48 26Q25 43 1 33Q-20 39-43 23Z" />
                        <path d="M-34 26Q-22 18-10 27M12 29Q25 15 39 24" /></g>
                </>}
            </g>
        </svg>
    </span>;
}
