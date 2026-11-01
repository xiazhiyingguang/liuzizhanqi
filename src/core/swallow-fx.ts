import type { Position } from '../types/game';
import type { SkillFxEvent } from './skill-fx';

export const SWALLOW_TRIANGLE_HIT_MS = 520;
export function isSwallowFx(kind: string): boolean { return kind.startsWith('swallow-'); }
export function swallowFlightTiming(steps: number, leap = false) {
    const travelMs = leap ? Math.min(620, Math.max(360, steps * 110)) : Math.max(260, steps * 160);
    const launchMs = leap ? 80 : 100;
    return { launchMs, travelMs, landingMs: launchMs + travelMs };
}

export function swallowTravelPoints(event: Pick<SkillFxEvent, 'fromPos' | 'targetPos' | 'profile' | 'coveredPositions'>): Position[] {
    if (event.profile.kind !== 'swallow-return') return [event.fromPos, event.targetPos];
    const points: Position[] = [event.fromPos];
    for (const cell of [...(event.coveredPositions ?? []), event.targetPos]) {
        const previous = points[points.length - 1];
        if (cell[0] !== previous[0] || cell[1] !== previous[1]) points.push(cell);
    }
    return points;
}

export function swallowSteps(event: Pick<SkillFxEvent, 'fromPos' | 'targetPos' | 'profile' | 'coveredPositions'>): number {
    return event.profile.kind === 'swallow-return' ? Math.max(1, swallowTravelPoints(event).length - 1)
        : Math.max(1, Math.abs(event.targetPos[0] - event.fromPos[0]), Math.abs(event.targetPos[1] - event.fromPos[1]));
}

/** Linear grid progress plus a small sideways drift; it never changes the attacked cells. */
export function swallowPose(points: Position[], progress: number, leap = false) {
    const p = Math.max(0, Math.min(1, progress)), count = Math.max(1, points.length - 1);
    const segment = Math.min(count - 1, Math.floor(p * count)), t = p * count - segment;
    const a = points[segment] ?? points[0], b = points[segment + 1] ?? a;
    const dx = (b[1] - a[1]) * 100, dy = (b[0] - a[0]) * 100, length = Math.hypot(dx, dy) || 1;
    const sway = leap ? 0 : Math.sin(Math.PI * p) * 7;
    return { x: (a[1] + .5) * 100 + dx * t - dy / length * sway,
        y: (a[0] + .5) * 100 + dy * t + dx / length * sway - (leap ? Math.sin(Math.PI * p) * 70 : 0) };
}

export function swallowHitMs(event: SkillFxEvent, cell: Position): number {
    if (event.profile.kind === 'swallow-triangle') return SWALLOW_TRIANGLE_HIT_MS;
    const steps = swallowSteps(event), timing = swallowFlightTiming(steps, event.profile.kind === 'swallow-leap');
    if (event.profile.kind === 'swallow-leap') return timing.landingMs;
    const points = swallowTravelPoints(event);
    const index = points.findIndex(p => p[0] === cell[0] && p[1] === cell[1]);
    const fraction = event.profile.kind === 'swallow-return' && index >= 0 ? index / steps
        : Math.max(Math.abs(cell[0] - event.fromPos[0]), Math.abs(cell[1] - event.fromPos[1])) / steps;
    return timing.launchMs + Math.min(1, fraction) * timing.travelMs;
}

export function swallowPrimaryEnd(kind: string, from: Position, to: Position): number {
    if (kind === 'swallow-triangle') return 960;
    const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    return swallowFlightTiming(steps, kind === 'swallow-leap').landingMs + (kind === 'swallow-leap' ? 220 : 120);
}

export function swallowPresentation(events: SkillFxEvent[], now: number) {
    const hiddenArrivals = new Set<string>(), hiddenPins = new Set<string>();
    const boundaries: number[] = [];
    for (const event of events) {
        if (!isSwallowFx(event.profile.kind) || !event.sourceHeroId) continue;
        const leap = event.profile.kind === 'swallow-leap', triangle = event.profile.kind === 'swallow-triangle';
        if (!leap && !triangle && event.profile.kind !== 'swallow-throw') continue;
        const end = event.bornAt + (triangle ? 880 : swallowFlightTiming(swallowSteps(event), leap).landingMs);
        if (now >= end) continue;
        boundaries.push(end);
        if (leap) hiddenArrivals.add(event.sourceHeroId);
        for (const cell of triangle ? event.swallow?.vertices?.slice(1) ?? [] : leap ? [] : [event.targetPos]) {
            hiddenPins.add(`${event.sourceHeroId}@${cell.join(',')}`);
        }
    }
    return { hiddenArrivals, hiddenPins, nextBoundary: boundaries.length ? Math.min(...boundaries) : undefined };
}
