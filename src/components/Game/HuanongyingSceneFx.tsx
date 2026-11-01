import { useEffect, useId, useRef, type CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import { hnyAngle, hnyHitMs, hnyTransitPoint } from '../../core/huanongying-fx';
import { isLowQuality } from '../../core/render-quality';
import HeroAvatar from '../ui/HeroAvatar';
import '../../styles/huanongying-scene-fx.css';

function SilkFan() {
    const id = useId().replace(/:/g, '');
    return <svg className="hny2-fan-glyph" viewBox="-52 -56 104 92" aria-hidden="true">
        <defs><linearGradient id={`${id}-silk`} x1="0" y1="1" x2=".3" y2="0">
            <stop stopColor="#9d657b" /><stop offset=".46" stopColor="#ead6d6" /><stop offset="1" stopColor="#fff4e1" />
        </linearGradient></defs>
        <path d="M 0 30 L -47 -12 Q 0 -62 47 -12 Z" fill={`url(#${id}-silk)`} stroke="#795264" strokeWidth="1.2" />
        {[-47, -32, -16, 0, 16, 32, 47].map(x => <path key={x} d={`M 0 30 L ${x} ${-36 + Math.abs(x) * .51}`} className="hny2-fan-rib" />)}
        <path d="M -46 -12 Q 0 -61 46 -12" fill="none" stroke="#e4cda4" strokeWidth="2" />
        <path d="M -22 -12 Q -8 -23 14 -12 M -7 -18 Q -3 -32 8 -32" fill="none" stroke="#7f5a69" strokeWidth="1" />
        {[[8, -31], [-13, -18], [13, -12]].map(([x, y]) => <g key={`${x},${y}`} transform={`translate(${x} ${y})`}>
            {[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx="0" cy="-3" rx="2" ry="3.7" fill="#b06a84" transform={`rotate(${a})`} />)}
            <circle r="1.2" fill="#edd7a6" />
        </g>)}
        <circle cx="0" cy="30" r="3" fill="#544151" stroke="#cfb48b" strokeWidth="1" />
    </svg>;
}

/** A washed ink figure with a real curved skirt and a folded fan, rather than a geometric ghost. */
export function HuanongyingShadowGlyph() {
    const id = useId().replace(/:/g, '');
    return <svg className="hny2-shadow-glyph" viewBox="0 0 100 110" aria-hidden="true">
        <defs><linearGradient id={`${id}-ink`} x1="0" y1="0" x2=".2" y2="1">
            <stop stopColor="#58415f" stopOpacity=".72" /><stop offset=".5" stopColor="#89738b" stopOpacity=".46" />
            <stop offset="1" stopColor="#b5a2b7" stopOpacity=".08" />
        </linearGradient></defs>
        <ellipse cx="50" cy="94" rx="31" ry="7" fill="#544258" opacity=".12" />
        <path d="M 49 12 C 33 9 33 31 27 43 Q 38 38 43 26 Q 42 15 51 16 Q 65 19 59 35 Q 71 27 61 15 Z" fill="#4f3b57" opacity=".5" />
        <path d="M 48 15 C 40 16 42 27 47 29 L 47 35 L 56 34 L 54 29 Q 64 18 55 15 Z" fill="#77617c" opacity=".58" />
        <path d="M 47 34 Q 37 34 33 43 L 22 32 L 18 38 Q 26 60 39 52 Q 42 64 34 77 Q 26 88 17 97 Q 42 95 50 86 Q 68 103 86 94 Q 64 80 59 59 Q 57 49 63 45 Q 73 60 77 74 Q 83 55 65 37 Q 59 31 54 35 Z" fill={`url(#${id}-ink)`} />
        <path d="M 48 47 Q 44 75 29 93 M 55 56 Q 60 81 76 93 M 59 31 Q 70 48 84 46" fill="none" stroke="#cbbbc9" strokeWidth="1.2" opacity=".55" />
        <path d="M 23 38 L 12 23 Q 29 18 36 31 Z" fill="#bba8b9" opacity=".6" stroke="#67516e" strokeWidth="1" />
        <path d="M 23 38 17 23 M 23 38 25 23 M 23 38 32 28" stroke="#806487" strokeWidth=".8" fill="none" />
        <path d="M 37 10 Q 45 4 50 12 Q 46 18 37 10" fill="#b7a0b5" opacity=".6" />
        <path d="M 23 94 Q 50 104 77 93" fill="none" stroke="#ad8eaa" strokeWidth="1" opacity=".5" />
    </svg>;
}

function PetalDrift({ count = 7 }: { count?: number }) {
    return <>{Array.from({ length: count }, (_, i) => {
        const angle = -.7 + i / Math.max(1, count - 1) * 1.4;
        return <path key={i} className="hny2-petal" d="M -5 0 Q -3 -6 5 -2 Q 4 5 -5 0 Z"
            style={{ '--hny-px': `${Math.cos(angle) * (125 + i % 2 * 13)}px`, '--hny-py': `${Math.sin(angle) * 150}px`,
                '--hny-petal-delay': `${i * 18}ms`, '--hny-petal-angle': `${i * 37}deg` } as CSSProperties} />;
    })}</>;
}

function FanCut({ event, echo }: { event: SkillFxEvent; echo: boolean }) {
    const id = useId().replace(/:/g, '');
    const angle = event.hny?.direction !== undefined ? hnyAngle(event.hny.direction) : event.angleDeg;
    return <g className={`hny2-fan-cut${echo ? ' hny2-echo-cut' : ''}`}
        transform={`translate(${(event.fromPos[1] + .5) * 100} ${(event.fromPos[0] + .5) * 100}) rotate(${angle})`}>
        <defs><radialGradient id={`${id}-veil`} cx="0" cy=".5" r="1">
            <stop offset=".3" stopColor="#dfb6c5" stopOpacity="0" /><stop offset=".78" stopColor="#ca9fb4" stopOpacity=".09" />
            <stop offset="1" stopColor="#91546d" stopOpacity=".18" />
        </radialGradient></defs>
        {echo && <svg x="-32" y="-65" width="64" height="95" viewBox="0 0 100 110" className="hny2-replay-figure"><HuanongyingShadowGlyph /></svg>}
        <g transform="translate(20 5) rotate(65)"><svg className="hny2-hand" x="-28" y="-42" width="56" height="49" viewBox="0 0 104 92"><SilkFan /></svg></g>
        <path className="hny2-fan-veil" d="M 0 0 L 100 -100 A 141.42 141.42 0 0 1 100 100 Z" fill={`url(#${id}-veil)`} />
        <path className="hny2-sweep hny2-sweep-haze" d="M 100 -100 A 141.42 141.42 0 0 1 100 100" pathLength="100" />
        <path className="hny2-sweep hny2-sweep-ink" d="M 100 -100 A 141.42 141.42 0 0 1 100 100" pathLength="100" />
        <path className="hny2-sweep hny2-sweep-pearl" d="M 100 -100 A 141.42 141.42 0 0 1 100 100" pathLength="100" />
        <PetalDrift count={echo ? 5 : 7} />
    </g>;
}

function RingCut({ event, echo }: { event: SkillFxEvent; echo: boolean }) {
    const center = echo ? event.fromPos : event.targetPos;
    return <g className={`hny2-ring-cut${echo ? ' hny2-echo-cut' : ''}`}
        transform={`translate(${(center[1] + .5) * 100} ${(center[0] + .5) * 100})`}>
        {echo && <svg className="hny2-replay-figure" x="-32" y="-65" width="64" height="95" viewBox="0 0 100 110"><HuanongyingShadowGlyph /></svg>}
        <circle className="hny2-ring-wash" r="92" />
        <circle className="hny2-ring-edge hny2-ring-ink" r="100" pathLength="100" />
        <circle className="hny2-ring-edge hny2-ring-pearl" r="100" pathLength="100" />
        <circle className="hny2-ring-trail" r="100" pathLength="100" />
        <g className="hny2-ring-runner"><g transform="translate(100 0) rotate(38)">
            <svg x="-17" y="-18" width="34" height="30" viewBox="0 0 104 92"><SilkFan /></svg>
        </g></g>
        {[0, 90, 180, 270].map(angle => <g key={angle} transform={`rotate(${angle}) translate(100 0)`}>
            <path className="hny2-ring-petal" d="M -9 0 Q -1 -11 10 -3 Q 4 7 -9 0 Z" />
        </g>)}
    </g>;
}

function ShadowTransit({ event }: { event: SkillFxEvent }) {
    const body = useRef<SVGGElement>(null), shadow = useRef<SVGGElement>(null);
    const petals = useRef<Array<SVGGElement | null>>([]);
    useEffect(() => {
        if (!body.current || !shadow.current) return;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0, last = -Infinity;
        const draw = (now: number) => {
            if (!reduced.matches && now - last < (isLowQuality() ? 34 : 16)) { frame = requestAnimationFrame(draw); return; }
            last = now;
            const elapsed = Date.now() - event.bornAt;
            const progress = reduced.matches ? 1 : Math.max(0, Math.min(1, (elapsed - 120) / 380));
            const p = hnyTransitPoint(event.fromPos, event.targetPos, progress);
            const q = hnyTransitPoint(event.fromPos, event.targetPos, 1 - progress, true);
            body.current?.setAttribute('transform', `translate(${p.x} ${p.y})`);
            shadow.current?.setAttribute('transform', `translate(${q.x} ${q.y})`);
            if (body.current) { body.current.style.opacity = progress >= 1 ? '0' : String(.94 - Math.sin(progress * Math.PI) * .26); body.current.dataset.hnyProgress = progress.toFixed(3); }
            if (shadow.current) shadow.current.style.opacity = progress >= 1 ? '0' : '.65';
            for (let i = 0; i < petals.current.length; i++) {
                const petal = petals.current[i]; if (!petal) continue;
                const p0 = Math.max(0, progress - (i % 3 + 1) * .065);
                const point = hnyTransitPoint(event.fromPos, event.targetPos, i < 3 ? p0 : 1 - p0, i >= 3);
                petal.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${progress * 210 + i * 42})`);
                petal.style.opacity = elapsed < 120 || progress >= 1 ? '0' : String(.65 - i % 3 * .14);
            }
            if (!reduced.matches && elapsed < 500) frame = requestAnimationFrame(draw);
        };
        const update = () => { cancelAnimationFrame(frame); draw(performance.now()); };
        reduced.addEventListener('change', update); update();
        return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', update); };
    }, [event]);
    const startX = (event.fromPos[1] + .5) * 100, startY = (event.fromPos[0] + .5) * 100;
    const endX = (event.targetPos[1] + .5) * 100, endY = (event.targetPos[0] + .5) * 100;
    const dx = endX - startX, dy = endY - startY, distance = Math.hypot(dx, dy) || 1;
    const mx = (startX + endX) / 2, my = (startY + endY) / 2;
    return <g className="hny2-swap-transit">
        {[1, -1].map(sign => <path key={sign} className={`hny2-travel-thread hny2-travel-thread-${sign === 1 ? 'body' : 'shadow'}`}
            d={`M ${startX} ${startY} Q ${mx - dy / distance * 32 * sign} ${my + dx / distance * 32 * sign} ${endX} ${endY}`} pathLength="100" />)}
        {Array.from({ length: 6 }, (_, i) => <g key={i} ref={node => { petals.current[i] = node; }} style={{ opacity: 0 }}>
            <path className={`hny2-transit-petal${i >= 3 ? ' hny2-transit-petal-shadow' : ''}`} d="M -5 0 Q -3 -6 5 -2 Q 4 5 -5 0 Z" />
        </g>)}
        <g ref={body} className="hny2-body-traveller" style={{ opacity: 0 }}>
            <foreignObject x="-27" y="-27" width="54" height="54"><div className="hny2-travel-avatar"><HeroAvatar heroId={event.sourceHeroId ?? 'huanongying'} size={54} eager className="hero-piece-avatar" /></div></foreignObject>
        </g>
        <g ref={shadow} className="hny2-shadow-traveller" style={{ opacity: 0 }}><svg x="-31" y="-59" width="62" height="94" viewBox="0 0 100 110"><HuanongyingShadowGlyph /></svg></g>
        <g className="hny2-arrival" transform={`translate(${endX} ${endY})`}>
            <ellipse cy="24" rx="45" ry="13" />
            {[0, 72, 144, 216, 288].map(angle => <path key={angle} transform={`rotate(${angle})`} d="M 0 -26 Q -14 -39 -5 -52 Q 8 -48 0 -26 Z" />)}
        </g>
    </g>;
}

function Contacts({ event }: { event: SkillFxEvent }) {
    return <>{(event.damagePositions ?? event.impactPositions ?? []).map(cell => {
        const x = (cell[1] + .5) * 100, y = (cell[0] + .5) * 100;
        return <g key={cell.join(',')} className="hny2-contact" data-hny-hit={cell.join(',')} transform={`translate(${x} ${y})`}>
            <path d="M -24 15 Q -4 -15 27 -16" className="hny2-contact-ink" />
            <path d="M -21 13 Q -4 -11 24 -14" className="hny2-contact-pearl" />
            <path d="M -18 -5 Q -25 -13 -19 -18 Q -9 -14 -18 -5 M 13 10 Q 22 4 25 12 Q 18 20 13 10" className="hny2-contact-petals" />
        </g>;
    })}</>;
}

export function HuanongyingSceneFx({ event }: { event: SkillFxEvent }) {
    const replay = event.profile.kind === 'huanongying-replay';
    const swap = event.profile.kind === 'huanongying-swap';
    const fan = !swap && (!replay || event.hny?.form !== 'ring');
    return <span className={`hny2-performance${replay ? ' hny2-replay' : ''}`}
        data-hny-form={fan ? 'fan' : 'ring'} data-hny-kind={event.profile.kind}
        style={{ '--hny-origin-r': event.fromPos[0], '--hny-origin-c': event.fromPos[1], '--hny-hit': `${hnyHitMs(event)}ms` } as CSSProperties}>
        <svg className="hny2-scene" viewBox="0 0 600 600" aria-hidden="true">
            {swap && <ShadowTransit event={event} />}
            {fan ? <FanCut event={event} echo={replay} /> : <RingCut event={event} echo={replay} />}
            <Contacts event={event} />
        </svg>
    </span>;
}
