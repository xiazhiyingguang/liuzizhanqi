/** The snout stays on the combat trajectory; the body bends behind it. */
export type DragonRigMode = 'orbit' | 'dash' | 'idle' | 'sweep';
export const DRAGON_RIG_WIDTH = 960;
export const DRAGON_RIG_HEIGHT = 800;
export const DRAGON_HEAD_X = DRAGON_RIG_WIDTH * .82;
export const DRAGON_HEAD_Y = DRAGON_RIG_HEIGHT * .28;
export const DRAGON_TEXTURE_ANCHOR_X = .965;
export const DRAGON_TEXTURE_ANCHOR_Y = .58;
export const DRAGON_TEXTURE_WIDTH = DRAGON_HEAD_X / DRAGON_TEXTURE_ANCHOR_X;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function dragonHeadTilt(time: number, mode: DragonRigMode): number {
    return Math.sin(time * (mode === 'idle' ? 1.6 : 3.8)) * (mode === 'dash' ? .022 : .04);
}

/** time is elapsed seconds, not frame count, so low quality never slows the dragon down. */
export function dragonSpinePoint(u: number, time: number, mode: DragonRigMode): { x: number; y: number } {
    const x = clamp(u) * DRAGON_TEXTURE_WIDTH;
    const distance = DRAGON_HEAD_X - x;
    const tail = clamp(distance / DRAGON_HEAD_X);
    const radius = mode === 'idle' ? 680 : mode === 'sweep' ? 740 : 595;
    const turn = mode === 'dash' ? 0 : distance / radius;
    const speed = mode === 'idle' ? 2.8 : mode === 'dash' ? 8.5 : 6.4;
    const amplitude = mode === 'idle' ? 23 : mode === 'dash' ? 30 : 42;
    const wave = smooth(tail * 5) * (Math.sin(time * speed - tail * 10.8) * amplitude * tail
        + Math.sin(time * speed * .72 - tail * 5.4) * amplitude * .23 * tail);
    const px = mode === 'dash' ? x : DRAGON_HEAD_X - Math.sin(turn) * radius;
    const py = DRAGON_HEAD_Y + (mode === 'dash' ? 0 : (1 - Math.cos(turn)) * radius);
    const bx = px + Math.sin(turn) * wave, by = py + Math.cos(turn) * wave;
    const tilt = dragonHeadTilt(time, mode) * smooth((u - .62) / .22);
    const dx = bx - DRAGON_HEAD_X, dy = by - DRAGON_HEAD_Y;
    return { x: DRAGON_HEAD_X + dx * Math.cos(tilt) - dy * Math.sin(tilt),
        y: DRAGON_HEAD_Y + dx * Math.sin(tilt) + dy * Math.cos(tilt) };
}
