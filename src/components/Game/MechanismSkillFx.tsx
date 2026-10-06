import { useEffect, useRef, type CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import { drawMechanismFrame } from '../../core/mechanism-fx-renderer';
import '../../styles/mechanism-skill-fx.css';

function MechanismCanvas({ event }: { event: SkillFxEvent }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const theme = event.profile.mechanism!;
    useEffect(() => {
        const canvas = ref.current;
        const root = canvas?.parentElement;
        if (!canvas || !root) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0, stopped = false, scale = 1, originX = 0, originY = 0;
        let to: [number, number] = [0, 0];
        const incoming: [number, number] = [event.fromPos[1] - event.targetPos[1], event.fromPos[0] - event.targetPos[0]];
        if (!incoming[0] && !incoming[1]) { incoming[0] = -1; incoming[1] = -.6; }
        const clear = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
        const resize = () => {
            const tile = Math.max(1, root.getBoundingClientRect().width);
            const step = (tile + 6) / tile * 100;
            to = theme === 'counter' ? [(event.targetPos[1] - event.fromPos[1]) * step, (event.targetPos[0] - event.fromPos[0]) * step] : [0, 0];
            const left = Math.min(-105, to[0] - 65), right = Math.max(105, to[0] + 65);
            const top = Math.min(-155, to[1] - 65), bottom = Math.max(95, to[1] + 65);
            const ratio = tile / 100, dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.style.left = `${tile / 2 + left * ratio}px`; canvas.style.top = `${tile / 2 + top * ratio}px`;
            canvas.style.width = `${(right - left) * ratio}px`; canvas.style.height = `${(bottom - top) * ratio}px`;
            canvas.width = Math.ceil((right - left) * ratio * dpr); canvas.height = Math.ceil((bottom - top) * ratio * dpr);
            scale = ratio * dpr; originX = -left * scale; originY = -top * scale;
        };
        const started = performance.now();
        const draw = () => {
            if (stopped) return;
            clear();
            if (media.matches) return;
            const clock = canvas.getAnimations()[0]?.currentTime;
            const ms = typeof clock === 'number' ? clock : performance.now() - started;
            ctx.setTransform(scale, 0, 0, scale, originX, originY);
            drawMechanismFrame(ctx, theme, ms, to, incoming, !!event.softImpactPositions?.length);
            frame = requestAnimationFrame(draw);
        };
        const onMotion = () => { cancelAnimationFrame(frame); if (media.matches) clear(); else draw(); };
        const observer = new ResizeObserver(resize); observer.observe(root); resize(); draw();
        media.addEventListener('change', onMotion);
        return () => { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); media.removeEventListener('change', onMotion); clear(); };
    }, [event.id, theme, event.fromPos, event.targetPos, event.softImpactPositions]);
    return <span className="mechanism-viewport">
        <canvas ref={ref} className="mechanism-canvas" data-mechanism={theme}
            style={{ '--mechanism-duration': `${event.profile.durationMs + 200}ms` } as CSSProperties} aria-hidden="true" />
    </span>;
}

export function MechanismSkillFx({ event, variant }: {
    event: SkillFxEvent; variant: 'caster' | 'target' | 'impact' | 'area' | 'splash' | 'chain';
}) {
    if (!event.profile.mechanism) return null;
    // 反击在来源格绘制完整往返弹道；其他事件只在角色所在格绘制一次。
    const expected = event.profile.mechanism === 'counter' ? 'caster' : 'target';
    return variant === expected ? <MechanismCanvas event={event} /> : null;
}
