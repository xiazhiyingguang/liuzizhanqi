import type { GameState, Hero, Position } from '../types/game';
import type { SkillFxEvent } from './skill-fx';
import { isSkillFxSuppressed, requestSkillFx } from '../data/extended-skills';

export const FROST_ARRIVE_MS = 520;
export const HAIR_ARRIVE_MS = 440;
export const CLONE_REVEAL_MS = 780;
export interface TianweiArrivalDetails { targetHeroId: string }

/** 仅在规则层已成功冻结/落下分身后调用，复用原天威日志，不新增日志或随机数。 */
export function requestTianweiArrival(source: Hero, target: Hero, skillId: 'feixue_tianwei' | 'wukong_tianwei', state: GameState, logId: string): void {
    if (isSkillFxSuppressed() || !source.position || !target.position) return;
    requestSkillFx({ skillId, sourceHeroId: source.id, owner: source.owner,
        fromPos: [...source.position], targetPos: [...target.position],
        arrival: { targetHeroId: target.id }, logIds: [logId],
        impactPositions: [], damagePositions: [], coveredPositions: [],
    }, state);
}

export function arrivalPoint(from: Position, to: Position, progress: number, frost = false) {
    const p = Math.max(0, Math.min(1, progress)), t = p * p * (3 - 2 * p);
    const dx = (to[1] - from[1]) * 100, dy = (to[0] - from[0]) * 100;
    const distance = Math.hypot(dx, dy) || 1;
    const bend = 4 * t * (1 - t) * (frost ? 10 : -22);
    return { x: (from[1] + .5) * 100 + dx * t - dy / distance * bend,
        y: (from[0] + .5) * 100 + dy * t + dx / distance * bend,
        angle: Math.atan2(dy, dx) * 180 / Math.PI };
}

export function arrivalPresentation(events: SkillFxEvent[], now: number) {
    const hiddenClones = new Set<string>(), pendingFrozen = new Set<string>(), boundaries: number[] = [];
    for (const event of events) {
        const kind = event.profile.arrival;
        if (!kind || !event.arrival) continue;
        const end = event.bornAt + (kind === 'hair-clone' ? CLONE_REVEAL_MS : FROST_ARRIVE_MS);
        if (now >= end) continue;
        boundaries.push(end);
        if (kind === 'hair-clone') hiddenClones.add(event.arrival.targetHeroId);
        else pendingFrozen.add(event.arrival.targetHeroId);
    }
    return { hiddenClones, pendingFrozen, nextBoundary: boundaries.length ? Math.min(...boundaries) : undefined };
}
