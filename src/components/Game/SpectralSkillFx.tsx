import { useEffect, useRef, type CSSProperties } from 'react';
import { type Position, type SkillFxEvent } from '../../core/skill-fx';
import { drawSpectralFrame, type SpectralVariant } from '../../core/spectral-fx-renderer';
import '../../styles/spectral-skill-fx.css';

function SpectralCanvas({ event, variant, delay }: { event: SkillFxEvent; variant: SpectralVariant; delay: number }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const theme = event.profile.spectral!;
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0;
        let stopped = false;
        let scaleX = 1, scaleY = 1;
        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.max(1, Math.round(rect.width * dpr));
            canvas.height = Math.max(1, Math.round(rect.height * dpr));
            scaleX = canvas.width / 180; scaleY = canvas.height / 220;
        };
        const clear = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
        const started = performance.now();
        const draw = () => {
            if (stopped || media.matches) { clear(); return; }
            // CSS 时钟只负责时间，Canvas 负责材质与流动；暂停/拖动预览也用同一时钟。
            const clock = canvas.getAnimations()[0]?.currentTime;
            const time = typeof clock === 'number' ? clock : performance.now() - started;
            ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
            drawSpectralFrame(ctx, theme, variant, time, delay);
            frame = requestAnimationFrame(draw);
        };
        const onMotion = () => { cancelAnimationFrame(frame); if (media.matches) clear(); else draw(); };
        const observer = new ResizeObserver(resize);
        observer.observe(canvas); resize(); draw();
        media.addEventListener('change', onMotion);
        return () => { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); media.removeEventListener('change', onMotion); clear(); };
    }, [event.id, theme, variant, delay]);
    return <span className={`spectral-viewport spectral-${theme}`}>
        <canvas ref={ref} className="spectral-canvas" data-spectral={theme} data-spectral-variant={variant} data-spectral-delay={delay}
            style={{ '--spectral-duration': `${event.profile.durationMs + 250}ms` } as CSSProperties} aria-hidden="true" />
    </span>;
}

export function SpectralSkillFx({ event, variant, atPos }: {
    event: SkillFxEvent; variant: 'caster' | 'target' | 'impact' | 'area' | 'splash' | 'chain'; atPos?: Position;
}) {
    const theme = event.profile.spectral;
    if (!theme || variant === 'splash' || variant === 'chain') return null;
    if (theme === 'soul-gather') {
        return variant === 'caster' ? <SpectralCanvas event={event} variant={variant} delay={0} /> : null;
    }
    // 每次施法只有一个主效。播撒放在选区主格；引爆优先放在主受害者，
    // 点中的格没有受害者时选择第一个真实受害格，不随命中人数复制幽花。
    const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
    const victims = event.damagePositions ?? [];
    const anchor = theme === 'wither-scatter' && victims.length && !victims.some(pos => same(pos, event.targetPos))
        ? victims[0] : event.targetPos;
    const expectedVariant = same(anchor, event.targetPos) ? 'target' : 'impact';
    const cell = atPos ?? event.targetPos;
    if (variant !== expectedVariant || !same(cell, anchor)) return null;
    return <SpectralCanvas event={event} variant={variant} delay={0} />;
}
