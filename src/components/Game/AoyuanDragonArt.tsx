import { memo, useEffect, useRef } from 'react';
import { isLowQuality } from '../../core/render-quality';
import {
    DRAGON_HEAD_X, DRAGON_HEAD_Y, DRAGON_RIG_HEIGHT, DRAGON_RIG_WIDTH,
    DRAGON_TEXTURE_ANCHOR_Y, DRAGON_TEXTURE_WIDTH, dragonHeadTilt, dragonSpinePoint,
    type DragonRigMode,
} from '../../core/dragon-skin-rig';
import { DRAGON_SWEEP_LEAD_MS, DRAGON_SWEEP_STEP_MS } from '../../core/dragon-sweep-fx';

const skinUrl = new URL('../../assets/fx/aoyuan-bluewhite-dragon-v2.png', import.meta.url).href;

let skinPromise: Promise<HTMLImageElement> | undefined;
function loadSkin(): Promise<HTMLImageElement> {
    return skinPromise ??= new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => { skinPromise = undefined; reject(new Error('游龙素材加载失败')); };
        image.src = skinUrl;
    });
}

// One frame loop for every active/idle dragon; no React state updates during swimming.
const swimmers = new Set<(time: number) => void>();
let animationFrame = 0;
function swim(time: number) {
    if (!document.hidden) for (const draw of swimmers) draw(time);
    animationFrame = swimmers.size ? requestAnimationFrame(swim) : 0;
}
function subscribe(draw: (time: number) => void) {
    swimmers.add(draw);
    if (!animationFrame) animationFrame = requestAnimationFrame(swim);
    return () => {
        swimmers.delete(draw);
        if (!swimmers.size && animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = 0; }
    };
}

function drawTendrils(ctx: CanvasRenderingContext2D, time: number, mode: DragonRigMode) {
    const sway = Math.sin(time * (mode === 'idle' ? 2.3 : 7)) * 12;
    ctx.save();
    ctx.translate(DRAGON_HEAD_X, DRAGON_HEAD_Y);
    ctx.rotate(dragonHeadTilt(time, mode));
    ctx.lineCap = 'round';
    const whiskers = new Path2D();
    whiskers.moveTo(-8, 5); whiskers.bezierCurveTo(-25, 26, -96, 19 + sway, -110, -7 + sway);
    whiskers.moveTo(-13, 10); whiskers.bezierCurveTo(-50, 42, -121, 29 - sway, -146, 47 - sway);
    ctx.strokeStyle = '#587690a6'; ctx.lineWidth = 4; ctx.stroke(whiskers);
    ctx.strokeStyle = '#f4f5eb'; ctx.lineWidth = 2.3; ctx.stroke(whiskers);
    const mane = new Path2D();
    mane.moveTo(-110, -34); mane.bezierCurveTo(-150, -88, -188, -45 + sway, -231, -66 + sway);
    mane.moveTo(-97, -43); mane.bezierCurveTo(-143, -99, -178, -74 - sway, -213, -100 - sway);
    ctx.strokeStyle = '#cedde5cc'; ctx.lineWidth = 3; ctx.stroke(mane);
    ctx.restore();
}

/** Bend the painted skin along a spine; overlapping narrow sections keep scales continuous. */
function paintDragon(ctx: CanvasRenderingContext2D, image: HTMLImageElement, time: number,
    mode: DragonRigMode, low: boolean, width: number, height: number, still: boolean) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.scale(width / DRAGON_RIG_WIDTH, height / DRAGON_RIG_HEIGHT);
    const spriteHeight = DRAGON_TEXTURE_WIDTH * image.naturalHeight / image.naturalWidth * (mode === 'idle' ? 1.25 : 1.6);
    const columns = low ? 24 : 40;
    const section = image.naturalWidth / columns;
    for (let i = 0; i < columns; i++) {
        const a = dragonSpinePoint(i / columns, time, mode), b = dragonSpinePoint((i + 1) / columns, time, mode);
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        const axis = DRAGON_TEXTURE_WIDTH / columns;
        ctx.save();
        if (mode === 'sweep') {
            const travelled = still ? Math.PI : Math.max(0, time * 1000 - DRAGON_SWEEP_LEAD_MS) / (DRAGON_SWEEP_STEP_MS * 4) * Math.PI;
            const trailingAngle = Math.max(0, DRAGON_HEAD_X - i / columns * DRAGON_TEXTURE_WIDTH) / 740;
            ctx.globalAlpha = Math.max(0, Math.min(1, (travelled - trailingAngle + .16) / .16));
        }
        ctx.transform(dx / axis, dy / axis, -dy / length, dx / length, a.x, a.y);
        const sourceWidth = Math.min(section + 3, image.naturalWidth - i * section);
        ctx.drawImage(image, i * section, 0, sourceWidth, image.naturalHeight,
            0, -spriteHeight * DRAGON_TEXTURE_ANCHOR_Y,
            DRAGON_TEXTURE_WIDTH * sourceWidth / image.naturalWidth, spriteHeight);
        ctx.restore();
    }
    drawTendrils(ctx, time, mode);
}

export const DragonArt = memo(function DragonArt({ mode = 'orbit', bornAt }: { mode?: DragonRigMode; bornAt?: number }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const media = matchMedia('(prefers-reduced-motion: reduce)');
        let disposed = false, image: HTMLImageElement | undefined;
        let width = 0, height = 0, lastPaint = -Infinity;
        const started = performance.now() - (bornAt === undefined ? 0 : Math.max(0, Date.now() - bornAt));
        let unsubscribe: (() => void) | undefined;
        const draw = (now: number, force = false) => {
            if (!image || disposed || !width || !height) return;
            const low = isLowQuality();
            const interval = mode === 'idle' ? (low ? 100 : 50) : (low ? 40 : 25);
            if (!force && now - lastPaint < interval) return;
            lastPaint = now;
            const elapsed = media.matches ? 0 : (now - started) / 1000;
            paintDragon(ctx, image, elapsed, mode, low, width, height, media.matches);
            canvas.dataset.dragonPose = elapsed.toFixed(3);
            canvas.dataset.dragonReady = 'true';
        };
        const resize = () => {
            const ratio = Math.min(devicePixelRatio || 1, isLowQuality() ? 1.5 : 2);
            const nextWidth = Math.max(1, Math.round(canvas.clientWidth * ratio));
            const nextHeight = Math.max(1, Math.round(canvas.clientHeight * ratio));
            if (nextWidth !== width || nextHeight !== height) {
                width = canvas.width = nextWidth; height = canvas.height = nextHeight;
                draw(performance.now(), true);
            }
        };
        const updateMotion = () => {
            unsubscribe?.(); unsubscribe = undefined;
            draw(performance.now(), true);
            if (!media.matches) unsubscribe = subscribe(draw);
        };
        const observer = new ResizeObserver(resize);
        observer.observe(canvas); resize();
        media.addEventListener('change', updateMotion);
        void loadSkin().then(loaded => {
            if (disposed) return;
            image = loaded; updateMotion();
        }).catch(() => { if (!disposed) canvas.dataset.dragonReady = 'error'; });
        return () => { disposed = true; unsubscribe?.(); observer.disconnect(); media.removeEventListener('change', updateMotion); };
    }, [mode, bornAt]);
    return <canvas ref={ref} className="ao-dragon-art" width={DRAGON_RIG_WIDTH} height={DRAGON_RIG_HEIGHT}
        data-dragon-rig={mode} aria-hidden="true" />;
});

// Warm the same cached image before a short-lived cast can begin. SSR never touches Image.
if (typeof window !== 'undefined' && typeof Image !== 'undefined') void loadSkin().catch(() => undefined);
