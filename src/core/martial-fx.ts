export const isMartialSkill = (id?: string) => /^(damo|xiangyu)_skill[12]$/.test(id ?? '');
import type { SkillFxEvent } from './skill-fx';

/** 主目标可能偏在刀气侧翼或致死离场，不能拿“指向主目标”的八向角度当刀气方向。 */
export function martialSlashRotation(event: SkillFxEvent): number {
    const cells = event.coveredPositions ?? [];
    if (!cells.length) return Math.round(event.angleDeg / 90) * 90;
    const dx = cells.reduce((sum, p) => sum + p[1] - event.fromPos[1], 0);
    const dy = cells.reduce((sum, p) => sum + p[0] - event.fromPos[0], 0);
    return Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? 180 : 0 : dy < 0 ? -90 : 90;
}
