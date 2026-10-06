import type { Position, SkillFxEvent } from './skill-fx';

export const LINGXI_TIDE_TIMING = {
    launchMs: 150, travelMs: 700, startCells: .24, endCells: 2.6, secondWaveMs: 130,
} as const;

/** Use the actual rectangle, not the first victim (which may be off to one side). */
export function lingxiTideAngle(event: Pick<SkillFxEvent, 'fromPos' | 'targetPos' | 'coveredPositions' | 'angleDeg'>): number {
    const cells = event.coveredPositions?.length ? event.coveredPositions : [event.targetPos];
    const [dy, dx] = cells.reduce(([r, c], cell) => [r + cell[0] - event.fromPos[0], c + cell[1] - event.fromPos[1]], [0, 0]);
    const angle = dx || dy ? Math.atan2(dy, dx) * 180 / Math.PI : event.angleDeg;
    return (Math.round(angle / 90) * 90 + 360) % 360;
}

/** The same first crest drives both impact visuals and floating damage numbers. */
export function lingxiTideHitMs(event: Pick<SkillFxEvent, 'fromPos' | 'targetPos' | 'coveredPositions' | 'angleDeg'>, cell: Position): number {
    const angle = lingxiTideAngle(event) * Math.PI / 180;
    const depth = (cell[1] - event.fromPos[1]) * Math.cos(angle) + (cell[0] - event.fromPos[0]) * Math.sin(angle);
    const timing = LINGXI_TIDE_TIMING;
    const progress = Math.max(0, Math.min(1, (depth - timing.startCells) / (timing.endCells - timing.startCells)));
    return Math.round(timing.launchMs + timing.travelMs * progress);
}
