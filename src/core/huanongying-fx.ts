import type { Position } from '../types/game';
import type { SkillFxEvent } from './skill-fx';

export interface HnyFxDetails {
    form: 'fan' | 'ring';
    direction?: number;
    shadowPos?: Position;
    replayCount?: number;
}
export const HNY_FAN_HIT_MS = 380;
export const HNY_SWAP_ARRIVE_MS = 500;
export const HNY_SWAP_HIT_MS = 620;
export const HNY_REPLAY_GAP_MS = 800;
export function isHnyFx(kind: string): boolean { return kind.startsWith('huanongying-'); }
export function hnyAngle(direction: number): number { return [-90, 90, 180, 0][direction] ?? 0; }
export function hnyHitMs(event: SkillFxEvent): number {
    if (event.profile.kind === 'huanongying-replay') return event.hny?.form === 'ring' ? 320 : 300;
    return event.profile.kind === 'huanongying-swap' ? HNY_SWAP_HIT_MS : HNY_FAN_HIT_MS;
}
export function hnyTransitPoint(from: Position, to: Position, progress: number, shadow = false) {
    const p = Math.max(0, Math.min(1, progress)), t = p * p * (3 - 2 * p);
    const dx = (to[1] - from[1]) * 100, dy = (to[0] - from[0]) * 100, length = Math.hypot(dx, dy) || 1;
    const bend = Math.sin(Math.PI * t) * (shadow ? -16 : 16);
    return { x: (from[1] + .5) * 100 + dx * t - dy / length * bend,
        y: (from[0] + .5) * 100 + dy * t + dx / length * bend };
}
export function hnyPresentation(events: SkillFxEvent[], now: number) {
    const hiddenActors = new Set<string>(), hiddenShadows = new Set<string>(), boundaries: number[] = [];
    for (const event of events) {
        if (!isHnyFx(event.profile.kind) || !event.sourceHeroId) continue;
        const replay = event.profile.kind === 'huanongying-replay', swap = event.profile.kind === 'huanongying-swap';
        if (replay && now < event.bornAt) { boundaries.push(event.bornAt); continue; }
        const end = event.bornAt + (replay ? 740 : swap ? HNY_SWAP_ARRIVE_MS : HNY_FAN_HIT_MS + 120);
        if (now >= end) continue;
        boundaries.push(end);
        if (swap) hiddenActors.add(event.sourceHeroId);
        const shadow = replay ? event.fromPos : event.hny?.shadowPos;
        if (shadow) hiddenShadows.add(`${event.sourceHeroId}@${shadow.join(',')}`);
    }
    return { hiddenActors, hiddenShadows, nextBoundary: boundaries.length ? Math.min(...boundaries) : undefined };
}
