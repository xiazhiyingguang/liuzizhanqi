import { BOARD_SIZE, type BattleLogEntry, type Position } from '../types/game';
export type HitContactKind = 'normal' | 'heavy' | 'critical' | 'shield-hit' | 'shield-break';
export interface HitFeedback {
    id: string;
    row: number;
    col: number;
    targetHeroId?: string;
    kind: HitContactKind;
    critical: boolean;
    /** Absolute visual contact time. Renders and repeat hits cannot restart the delay. */
    at: number;
    angle: number;
    pushX: number;
    pushY: number;
    amplitude: number;
    motionMs: number;
}
function cell(value: unknown): Position | undefined {
    if (!Array.isArray(value) || value.length !== 2)
        return;
    const [r, c] = value;
    if (Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < BOARD_SIZE && c < BOARD_SIZE)
        return [r, c];
}
/** Only successful damage logs drive contacts; skills/targets alone cannot prove a hit. */
export function resolveHitFeedback(entry: BattleLogEntry, at: number, fallbackFrom?: Position): HitFeedback | null {
    const d = entry.details;
    if (entry.type !== 'damage' || !d || typeof d.amount !== 'number' || !Number.isFinite(d.amount) || d.amount <= 0)
        return null;
    if (d.fxTag === 'burn' || d.fxTag === 'bleed')
        return null;
    const pos = cell(d.position);
    if (!pos)
        return null;
    const shieldDamage = typeof d.shieldDamage === 'number' ? Math.max(0, d.shieldDamage) : 0;
    const hpDamage = typeof d.hpDamage === 'number' ? Math.max(0, d.hpDamage) : d.amount;
    const shieldOnly = shieldDamage > 0 && hpDamage === 0;
    const critical = d.isCrit === true;
    const maxHp = typeof d.targetMaxHp === 'number' && d.targetMaxHp > 0 ? d.targetMaxHp : 60;
    const heavy = hpDamage >= Math.max(10, Math.ceil(maxHp * .24));
    const kind: HitContactKind = d.shieldBroken === true && shieldDamage > 0 ? 'shield-break'
        : shieldOnly ? 'shield-hit' : critical ? 'critical' : heavy ? 'heavy' : 'normal';
    const from = cell(d.hitFrom) ?? fallbackFrom;
    const dx = from ? pos[1] - from[1] : 0, dy = from ? pos[0] - from[0] : 1;
    const length = Math.hypot(dx, dy);
    const ux = length ? dx / length : 0, uy = length ? dy / length : 1;
    const amplitude = kind === 'critical' ? 4.2 : kind === 'heavy' ? 3.5 : kind === 'shield-break' ? (critical ? 4 : 3) : kind === 'shield-hit' ? 1.1 : .75;
    return { id: entry.id, row: pos[0], col: pos[1], targetHeroId: typeof d.targetHeroId === 'string' ? d.targetHeroId : undefined,
        kind, critical, at, angle: Math.atan2(uy, ux) * 180 / Math.PI, pushX: ux, pushY: uy, amplitude,
        motionMs: kind === 'normal' || kind === 'shield-hit' ? 150 : 270 };
}
/** A held recoil is the local hit-stop: neither the game clock nor input is paused. */
export function hitMotionFrames(hit: HitFeedback, amplitude: number): Keyframe[] {
    const x = hit.pushX * amplitude, y = hit.pushY * amplitude;
    const strong = hit.kind === 'critical' || hit.kind === 'heavy' || hit.kind === 'shield-break';
    const tilt = (hit.pushX || .35) * (strong ? 2 : .4);
    const pose = (factor: number, scale: number) => `translate(${(x * factor).toFixed(2)}px, ${(y * factor).toFixed(2)}px) rotate(${(tilt * factor).toFixed(2)}deg) scale(${scale})`;
    return [
        { offset: 0, transform: 'none' },
        { offset: .12, transform: pose(1, strong ? .97 : .99) },
        { offset: strong ? .30 : .18, transform: pose(1, strong ? .97 : .99) },
        { offset: .53, transform: pose(-.45, 1.015) },
        { offset: .73, transform: pose(.18, 1) },
        { offset: 1, transform: 'none' },
    ];
}
