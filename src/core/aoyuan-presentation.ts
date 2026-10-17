import type { SkillFxEvent } from './skill-fx';
import { DRAGON_CALL_LEAD_MS, DRAGON_CALL_STEP_MS, DRAGON_SWEEP_LEAD_MS, DRAGON_SWEEP_STEP_MS, ORBIT_RING_CELLS, dragonDashTiming } from './dragon-sweep-fx';

export function dragonBodyEndMs(event: SkillFxEvent): number {
    if (event.dragonContactsOnly) return 0;
    switch (event.profile.kind) {
        case 'aoyuan-dragon-call': return DRAGON_CALL_LEAD_MS + DRAGON_CALL_STEP_MS * ORBIT_RING_CELLS + 300;
        case 'aoyuan-dragon-sweep': return DRAGON_SWEEP_LEAD_MS + DRAGON_SWEEP_STEP_MS * 4 + 300;
        case 'aoyuan-dragon-dash': return dragonDashTiming(event.coveredPositions?.length ?? 1).landingMs;
        default: return 0;
    }
}

/** Idle dragon and arrived avatar yield to the one active, scheduled performance. */
export function aoyuanPresentation(events: SkillFxEvent[], now: number) {
    const hideIdle = new Set<string>(), hideArrived = new Set<string>();
    const boundaries: number[] = [];
    for (const event of events) {
        if (!event.sourceHeroId) continue;
        const duration = dragonBodyEndMs(event);
        if (!duration) continue;
        const end = event.bornAt + duration;
        if (now < end) {
            hideIdle.add(event.sourceHeroId);
            boundaries.push(end);
            if (event.profile.kind === 'aoyuan-dragon-dash') hideArrived.add(event.sourceHeroId);
        }
    }
    return { hideIdle, hideArrived, nextBoundary: boundaries.length ? Math.min(...boundaries) : undefined };
}
