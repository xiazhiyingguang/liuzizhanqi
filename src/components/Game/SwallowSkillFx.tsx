import { useEffect, useId, useRef, type CSSProperties } from 'react';
import type { Position } from '../../types/game';
import type { SkillFxEvent } from '../../core/skill-fx';
import { swallowFlightTiming, swallowHitMs, swallowPose, swallowSteps, swallowTravelPoints } from '../../core/swallow-fx';
import { isLowQuality } from '../../core/render-quality';
import HeroAvatar from '../ui/HeroAvatar';
import '../../styles/swallow-skill-fx.css';

/** Tempered silver faces, dark jade metal and a narrow warm cutting edge. */
export function SwallowBladeGlyph({ className = '', slot = 0 }: { className?: string; slot?: number }) {
    const id = useId().replace(/:/g, '');
    return <svg className={`sfy-blade-glyph ${className}`} viewBox="-32 -32 64 64" aria-hidden="true">
        <defs><linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#f7f8ed" /><stop offset=".26" stopColor="#9cbdb5" />
            <stop offset=".48" stopColor="#314f50" /><stop offset=".65" stopColor="#779b92" /><stop offset="1" stopColor="#dbe9dc" />
        </linearGradient></defs>
        {[0, 180].map(angle => <g key={angle} transform={`rotate(${angle})`}>
            <path d="M -3 -4 C -15 -18 -27 -10 -30 -23 C -30 -8 -21 -2 -12 0 L -2 10 L 5 3 Z" fill={`url(#${id}-metal)`} stroke="#2b4547" strokeWidth=".85" />
            <path d="M -29 -22 Q -25 -10 -14 -9 Q -6 -8 4 3" fill="none" stroke="#eff5e9" strokeWidth="1.25" />
            <path d="M -29 -20 Q -25 -6 -12 -1 L -2 8" fill="none" stroke="#c4ac75" strokeWidth=".7" />
        </g>)}
        <path d="M 0 -7 L 6 0 L 0 7 L -6 0 Z" fill="#3c6260" stroke="#d7bc7e" strokeWidth="1.1" />
        <path d={slot ? 'M -2 1 L 0 -2 L 2 1 M -2 3 L 2 3' : 'M -2 1 L 2 -1'} fill="none" stroke="#eaf0dd" strokeWidth=".9" />
    </svg>;
}

function travelPath(points: Position[], leap = false) {
    return Array.from({ length: 33 }, (_, i) => {
        const point = swallowPose(points, i / 32, leap);
        return `${i ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }).join(' ');
}

function SwallowFlight({ points, bornAt, lead, duration, slot = 0, heroId }: {
    points: Position[]; bornAt: number; lead: number; duration: number; slot?: number; heroId?: string;
}) {
    const ref = useRef<SVGGElement>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0, last = -Infinity;
        const draw = (now: number) => {
            if (!reduced.matches && now - last < (isLowQuality() ? 34 : 16)) { frame = requestAnimationFrame(draw); return; }
            last = now;
            const elapsed = Date.now() - bornAt - lead;
            const progress = reduced.matches ? 1 : Math.max(0, Math.min(1, elapsed / duration));
            const point = swallowPose(points, progress, !!heroId);
            const opacity = reduced.matches ? 1 : elapsed < 0 ? 0 : Math.max(0, Math.min(1, (duration + 120 - elapsed) / 120));
            const rotation = heroId || reduced.matches ? 0 : progress * (slot ? -720 : 720);
            element.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${rotation})`);
            element.dataset.swallowProgress = progress.toFixed(3);
            element.style.opacity = String(heroId && progress >= 1 ? 0 : opacity);
            if (!reduced.matches && elapsed < duration + 120) frame = requestAnimationFrame(draw);
        };
        const update = () => { cancelAnimationFrame(frame); draw(performance.now()); };
        reduced.addEventListener('change', update); update();
        return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', update); };
    }, [points, bornAt, lead, duration, slot, heroId]);
    return <g ref={ref} className="sfy-flight" data-swallow-actor={heroId ? 'hero' : 'blade'} style={{ opacity: 0 }}>
        {heroId ? <><path className="sfy-leap-wings" d="M -27 -8 Q -54 -17 -49 -34 Q -36 -22 -24 -22 M 27 8 Q 54 -4 49 -27 Q 36 -14 24 -16" /><foreignObject x="-27" y="-27" width="54" height="54">
            <div className="sfy-flying-avatar"><HeroAvatar heroId={heroId} size={54} eager className="hero-piece-avatar" /></div>
        </foreignObject></> : <svg x="-25" y="-25" width="50" height="50" viewBox="0 0 64 64"><SwallowBladeGlyph slot={slot} /></svg>}
    </g>;
}

function SwallowContacts({ event }: { event: SkillFxEvent }) {
    return <>{(event.damagePositions ?? event.impactPositions ?? []).map(cell => <g key={cell.join(',')}
        className="sfy-contact" data-swallow-hit={cell.join(',')}
        style={{ '--sfy-hit': `${swallowHitMs(event, cell)}ms`, transformOrigin: `${(cell[1] + .5) * 100}px ${(cell[0] + .5) * 100}px` } as CSSProperties}>
        <path d={`M ${(cell[1] + .5) * 100 - 17} ${(cell[0] + .5) * 100 + 10} q 15 -24 36 -25`} className="sfy-hit-ink" />
        <path d={`M ${(cell[1] + .5) * 100 - 14} ${(cell[0] + .5) * 100 + 9} q 12 -20 30 -21`} className="sfy-hit-silver" />
        <path d={`M ${(cell[1] + .5) * 100 - 9} ${(cell[0] + .5) * 100 - 13} l -6 -7 M ${(cell[1] + .5) * 100 + 20} ${(cell[0] + .5) * 100 + 4} l 8 3`} className="sfy-hit-chips" />
    </g>)}</>;
}

export function SwallowSkillFx({ event }: { event: SkillFxEvent }) {
    const points = swallowTravelPoints(event), leap = event.profile.kind === 'swallow-leap';
    const timing = swallowFlightTiming(swallowSteps(event), leap);
    const vertices = event.swallow?.vertices ?? [event.fromPos, event.targetPos, event.fromPos];
    const triangle = event.profile.kind === 'swallow-triangle';
    const pointString = vertices.map(([r, c]) => `${(c + .5) * 100},${(r + .5) * 100}`).join(' ');
    const line = travelPath(points, leap);
    const x = (event.targetPos[1] + .5) * 100, y = (event.targetPos[0] + .5) * 100;
    return <span className="sfy-performance" style={{ '--sfy-origin-r': event.fromPos[0], '--sfy-origin-c': event.fromPos[1],
        '--sfy-launch': `${timing.launchMs}ms`, '--sfy-travel': `${timing.travelMs}ms`,
        '--sfy-landing': `${timing.landingMs}ms` } as CSSProperties} data-swallow-kind={event.profile.kind}>
        <svg className="sfy-scene" viewBox="0 0 600 600" aria-hidden="true">
            {triangle ? <>
                <polygon className="sfy-triangle-wash" points={pointString} />
                <polygon className="sfy-triangle-line" points={pointString} pathLength={100} />
                <polygon className="sfy-triangle-edge" points={pointString} pathLength={100} />
                {[1, 2].map(i => {
                    const other = vertices[i === 1 ? 2 : 1];
                    const opposite: Position = [(vertices[0][0] + other[0]) / 2, (vertices[0][1] + other[1]) / 2];
                    const path = [vertices[i], opposite, vertices[i]];
                    const cut = travelPath([vertices[i], opposite]);
                    return <g key={i}>
                        <svg className="sfy-triangle-ready" x={(vertices[i][1] + .5) * 100 - 25} y={(vertices[i][0] + .5) * 100 - 25} width="50" height="50" viewBox="0 0 64 64"><SwallowBladeGlyph slot={i - 1} /></svg>
                        <path d={cut} className="sfy-scissor-shadow" style={{ '--sfy-cut-delay': `${i === 1 ? 390 : 425}ms` } as CSSProperties} />
                        <path d={cut} className="sfy-scissor-cut" style={{ '--sfy-cut-delay': `${i === 1 ? 390 : 425}ms` } as CSSProperties} />
                        <SwallowFlight points={path} bornAt={event.bornAt} lead={340} duration={540} slot={i - 1} />
                    </g>;
                })}
            </> : <>
                <path d={line} className="sfy-flight-track" pathLength={100} />
                <path d={line} className="sfy-flight-wake" pathLength={100} />
                <SwallowFlight points={points} bornAt={event.bornAt} lead={timing.launchMs} duration={timing.travelMs}
                    slot={event.swallow?.slot} heroId={leap ? event.sourceHeroId ?? 'shuangfeiyan' : undefined} />
                {leap && <g className="sfy-leap-landing" style={{ transformOrigin: `${x}px ${y}px` }}>
                    <ellipse cx={x} cy={y + 3} rx="88" ry="56" />
                    <path d={`M ${x - 92} ${y + 10} Q ${x - 26} ${y - 94} ${x + 86} ${y - 15} M ${x + 92} ${y + 12} Q ${x + 20} ${y + 82} ${x - 88} ${y - 8}`} />
                </g>}
            </>}
            <SwallowContacts event={event} />
        </svg>
    </span>;
}
