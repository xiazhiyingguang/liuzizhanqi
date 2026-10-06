import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { hitMotionFrames, type HitFeedback } from '../../core/hit-feedback';
import { isLowQuality } from '../../core/render-quality';
import '../../styles/hit-feedback.css';

export function HitResponsivePiece({ hits, children }: {
    hits: HitFeedback[];
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const seen = useRef(new Set<string>());
    const timers = useRef(new Map<string, number>());
    const animation = useRef<Animation>();
    const last = useRef<{
        at: number;
        amplitude: number;
    }>();
    useEffect(() => {
        const ids = new Set(hits.map(hit => hit.id));
        for (const [id, timer] of timers.current) {
            if (!ids.has(id)) {
                window.clearTimeout(timer);
                timers.current.delete(id);
            }
        }
        for (const hit of hits) {
            if (seen.current.has(hit.id))
                continue;
            seen.current.add(hit.id);
            const start = () => {
                timers.current.delete(hit.id);
                const el = ref.current, elapsed = Date.now() - hit.at;
                if (!el || elapsed >= hit.motionMs || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
                    return;
                // A small follow-up cannot erase the strongest contact in the same instant.
                if (last.current && hit.at - last.current.at < 65 && hit.amplitude < last.current.amplitude)
                    return;
                last.current = { at: hit.at, amplitude: hit.amplitude };
                animation.current?.cancel();
                const size = el.getBoundingClientRect().width;
                const amplitude = hit.amplitude * Math.min(1, Math.max(.55, size / 56));
                animation.current = el.animate(hitMotionFrames(hit, amplitude), { duration: hit.motionMs, easing: 'linear' });
                animation.current.currentTime = Math.max(0, elapsed);
            };
            if (hit.at > Date.now())
                timers.current.set(hit.id, window.setTimeout(start, hit.at - Date.now()));
            else
                start();
        }
        seen.current = new Set(hits.map(hit => hit.id));
    }, [hits]);
    useEffect(() => {
        const pending = timers.current;
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const reduce = () => {
            if (media.matches) animation.current?.cancel();
        };
        media.addEventListener('change', reduce);
        return () => {
            for (const timer of pending.values()) window.clearTimeout(timer);
            pending.clear();
            seen.current.clear();
            last.current = undefined;
            animation.current?.cancel();
            media.removeEventListener('change', reduce);
        };
    }, []);
    return <div ref={ref} className="piece-hit-motion" data-hit-motion="local">{children}</div>;
}

export function HitContactFx({ hit }: {
    hit: HitFeedback;
}) {
    const [delay] = useState(() => Math.max(0, hit.at - Date.now()));
    const shield = hit.kind === 'shield-hit' || hit.kind === 'shield-break';
    const strong = hit.kind === 'heavy' || hit.kind === 'critical';
    const count = isLowQuality() ? 4 : hit.kind === 'shield-break' ? 9 : strong ? 8 : 4;
    const style = { '--contact-delay': `${delay}ms`, '--contact-angle': `${hit.angle}deg` } as CSSProperties;
    return <span className={`hit-contact hit-contact-${hit.kind}${hit.critical ? ' hit-contact-crit' : ''}`} style={style} data-hit-kind={hit.kind} data-hit-log={hit.id} data-hit-at={hit.at} aria-hidden="true">
        <svg className="hit-contact-core" viewBox="0 0 100 100">
            {shield ? <>
                <path className="contact-shield-face" d="M28 21 50 13 72 21 69 56 61 70 50 80 38 69 30 54Z"/>
                <path className="contact-shield-seam" d="m47 15 7 18-10 9 13 10-9 14 3 13M44 42l-13-5M57 52l12-9M48 66l-10 3"/>
                {hit.kind === 'shield-break' && <path className="contact-shield-cut" d="m20 66 25-21 14-8 24-17"/>}
            </> : <>
                <g className="contact-oriented">
                    <path className="contact-cut-dark" d={strong ? 'M4 50 43 45 52 34 56 45 96 50 55 54 48 66 44 55Z' : 'M21 49 45 46 80 50 47 53Z'}/>
                    <path className="contact-cut-light" d={strong ? 'M8 50 46 48 52 38 53 48 91 50 52 52 48 62 47 52Z' : 'M27 50 48 49 73 50 48 51Z'}/>
                </g>
                {strong && <path className="contact-cross" d="m35 24 13 23 26 23-24-16-15-30M22 62l22-11"/>}
            </>}
        </svg>
        <span className="hit-contact-chips">
            {Array.from({ length: count }, (_, i) => {
                const angle = hit.angle + i * 137.5 + (i % 2 ? 17 : 0);
                const radius = (shield ? 30 : strong ? 38 : 23) + (i % 3) * 5;
                return <i key={i} className={shield ? 'contact-chip-glass' : 'contact-chip-dust'} style={{
                    '--chip-x': Math.cos(angle * Math.PI / 180) * radius / 100,
                    '--chip-y': Math.sin(angle * Math.PI / 180) * radius / 100,
                    '--chip-angle': `${angle}deg`,
                    '--chip-i': i,
                } as CSSProperties} />;
            })}
        </span>
        {hit.kind === 'shield-break' && <span className="hit-break-label">{hit.critical ? '暴击·破盾' : '破盾'}</span>}
    </span>;
}
