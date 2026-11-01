import type { GameState, Hero, Position } from '../types/game';
import type { SkillFxEvent } from './skill-fx';
import { nextBattleLogId } from './battle-log-id';
import { isSkillFxSuppressed, requestSkillFx } from '../data/extended-skills';

export type BladeScene = 'leap' | 'drift' | 'recall' | 'attach' | 'volley' | 'order' | 'reward' | 'cuts';
export interface BladeStroke {
    from: Position;
    to: Position;
    start: number;
    arrive: number;
    hit?: number;
    reveal?: number;
    swordId?: string;
    logIds?: string[];
    reward?: number;
    label?: string;
    count?: number;
}
export interface BladeChoreography {
    scene: BladeScene;
    strokes: BladeStroke[];
}

/** 只存结算瞬间的坐标/日志身份；不查询动画期间的新盘面，不额外掷骰。 */
export function requestBladeScene(hero: Hero, state: GameState, scene: BladeScene, strokes: BladeStroke[], label: string): void {
    if (!strokes.length || isSkillFxSuppressed()) return;
    const logIds = strokes.flatMap(stroke => stroke.logIds ?? []);
    if (!logIds.length) {
        const id = nextBattleLogId(false);
        state.battleLog.push({ id, type: 'effect', player: hero.owner, message: label, timestamp: Date.now() });
        logIds.push(id);
    }
    requestSkillFx({ skillId: `choreography_${scene}`, owner: hero.owner, sourceHeroId: hero.id,
        fromPos: [...strokes[0].from], targetPos: [...strokes[0].to],
        choreography: { scene, strokes: strokes.map(stroke => ({ ...stroke, from: [...stroke.from], to: [...stroke.to], logIds: stroke.logIds ? [...stroke.logIds] : undefined })) },
        logIds, impactPositions: [], coveredPositions: [],
        damagePositions: state.battleLog.filter(log => logIds.includes(log.id) && log.type === 'damage' && Array.isArray(log.details?.position))
            .map(log => [...log.details!.position as Position] as Position),
    }, state);
}

export function bladeSceneEnd(details: BladeChoreography): number {
    return Math.max(0, ...details.strokes.map(stroke => stroke.arrive)) + 420;
}
export function bladePoint(stroke: BladeStroke, time: number, leap = false, sharp = false) {
    const progress = Math.max(0, Math.min(1, (time - stroke.start) / Math.max(1, stroke.arrive - stroke.start)));
    const t = sharp ? progress * progress * progress : progress * progress * (3 - 2 * progress);
    const dx = (stroke.to[1] - stroke.from[1]) * 100, dy = (stroke.to[0] - stroke.from[0]) * 100;
    const length = Math.hypot(dx, dy) || 1;
    const bend = Math.sin(Math.PI * t) * (leap ? 0 : 14);
    return { x: (stroke.from[1] + .5) * 100 + dx * t - dy / length * bend,
        y: (stroke.from[0] + .5) * 100 + dy * t + dx / length * bend - (leap ? Math.sin(Math.PI * t) * 27 : 0),
        angle: Math.atan2(dy, dx) * 180 / Math.PI, progress };
}

/** 在飞剑抵达之前隐藏其最终落格图标；连续动作只让最后一段控制同一把剑。 */
export function bladePresentation(events: SkillFxEvent[], now: number) {
    const hiddenSwords = new Set<string>(), hiddenActors = new Set<string>(), boundaries: number[] = [];
    const latest = new Map<string, { event: SkillFxEvent; stroke: BladeStroke }>();
    for (const event of events) {
        const details = event.choreography;
        if (!details) continue;
        for (const stroke of details.strokes) {
            if (stroke.swordId) latest.set(stroke.swordId, { event, stroke });
            const end = event.bornAt + stroke.arrive;
            if (details.scene === 'leap' && now < end && event.sourceHeroId) {
                hiddenActors.add(event.sourceHeroId); boundaries.push(end);
            }
        }
    }
    for (const [id, { event, stroke }] of latest) {
        const end = event.bornAt + stroke.arrive;
        if (now < end) { hiddenSwords.add(id); boundaries.push(end); }
    }
    return { hiddenSwords, hiddenActors, nextBoundary: boundaries.length ? Math.min(...boundaries) : undefined };
}
