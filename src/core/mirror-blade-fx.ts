import type { BattleLogEntry, Position } from '../types/game';
import { computeFxAngleDeg, computeFxDirection, resolveSkillFx, type MirrorBladeStrike, type SkillFxEvent } from './skill-fx';

/** SVG 一单位等于一个格距，缩放棋盘后仍精确命中格子中心。 */
function mirrorBladeGeometry(blade: MirrorBladeStrike, origin: Position, index: number) {
    const dx = blade.targetPos[1] - blade.fromPos[1];
    const dy = blade.targetPos[0] - blade.fromPos[0];
    const length = Math.hypot(dx, dy) || 1;
    const px = -dy / length;
    const py = dx / length;
    const side = index % 2 === 0 ? 1 : -1;
    const fan = side * (0.32 + (index % 3) * 0.12);
    const x = blade.fromPos[1] - origin[1];
    const y = blade.fromPos[0] - origin[0];
    const endX = blade.targetPos[1] - origin[1];
    const endY = blade.targetPos[0] - origin[0];
    const bend = side * Math.min(1.25, 0.55 + length * 0.15);
    const clamp = (n: number, offset: number) => Math.max(-0.3 - offset, Math.min(5.3 - offset, n));
    const controlX = clamp((x + endX) / 2 + px * bend, origin[1]);
    const controlY = clamp((y + endY) / 2 + py * bend, origin[0]);
    return { start: { x: x + px * fan, y: y + py * fan }, control: { x: controlX, y: controlY }, end: { x: endX, y: endY } };
}

export function mirrorBladePath(blade: MirrorBladeStrike, origin: Position, index: number): string {
    const { start, control, end } = mirrorBladeGeometry(blade, origin, index);
    const n = (value: number) => Number(value.toFixed(3));
    return `M ${n(start.x)} ${n(start.y)} Q ${n(control.x)} ${n(control.y)} ${end.x} ${end.y}`;
}

/** 预采样弧线：只算一次，浏览器用 transform 合成，不再逐帧重绘 SVG 路径和滤镜。 */
export function mirrorBladeMotion(blade: MirrorBladeStrike, origin: Position, index: number) {
    const { start, control, end } = mirrorBladeGeometry(blade, origin, index);
    let previousAngle = 0;
    return Array.from({ length: 9 }, (_, step) => {
        const t = step / 8;
        const u = 1 - t;
        const x = u * u * start.x + 2 * u * t * control.x + t * t * end.x;
        const y = u * u * start.y + 2 * u * t * control.y + t * t * end.y;
        const vx = u * (control.x - start.x) + t * (end.x - control.x);
        const vy = u * (control.y - start.y) + t * (end.y - control.y);
        let angle = Math.atan2(vy, vx) * 180 / Math.PI;
        if (step > 0) {
            while (angle - previousAngle > 180) angle -= 360;
            while (angle - previousAngle < -180) angle += 360;
        }
        previousAngle = angle;
        return { x, y, angle };
    });
}

function cell(value: unknown): Position | null {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(n => Number.isInteger(n) && n >= 0 && n < 6)) return null;
    return [value[0], value[1]];
}

/** 把一轮自动攻击合成一个视觉事件：不受全局特效队列 16 个事件上限截断。
 *  仅依赖可同步的战报，联机两端也使用同样的刃数和目标快照。 */
export function collectMirrorBladeFx(logs: BattleLogEntry[]): Array<Omit<SkillFxEvent, 'id' | 'bornAt'>> {
    const batches = new Map<string, Omit<SkillFxEvent, 'id' | 'bornAt'>>();
    // 天威递归结算的战报可能比触发它的击杀先落盘，按攻击前记录的编号还原发射顺序。
    const ordered = logs.filter(entry => entry.details?.fxSkillId === 'mirror_blade').sort((a, b) =>
        Number(a.details?.fxBladeOrder ?? 0) - Number(b.details?.fxBladeOrder ?? 0));
    for (const entry of ordered) {
        const details = entry.details;
        if (details?.fxSkillId !== 'mirror_blade') continue;
        const targetPos = cell(details.fxTarget);
        if (!targetPos) continue;
        const fromPos = cell(details.fxFrom) ?? targetPos;
        // 同一次界面更新里，击杀新获得的镜刃也并入本体的追击群。
        const key = typeof details.fxSourceHeroId === 'string' ? details.fxSourceHeroId
            : typeof details.fxBladeBatchId === 'string' ? details.fxBladeBatchId : entry.id;
        let event = batches.get(key);
        if (!event) {
            const angleDeg = computeFxAngleDeg(fromPos, targetPos);
            event = {
                profile: resolveSkillFx('mirror_blade'), skillId: 'mirror_blade',
                owner: entry.player, fromPos, targetPos, angleDeg, direction: computeFxDirection(angleDeg),
                sourceHeroId: typeof details.fxSourceHeroId === 'string' ? details.fxSourceHeroId : undefined,
                mirrorBlades: [], logIds: [], impactPositions: [], damagePositions: [],
            };
            batches.set(key, event);
        }
        const logIds = [entry.id, ...(Array.isArray(details.fxLogIds) ? details.fxLogIds.filter((id): id is string => typeof id === 'string') : [])];
        event.mirrorBlades!.push({ fromPos, targetPos, logIds });
        event.logIds!.push(...logIds);
        if (!event.impactPositions!.some(([r, c]) => r === targetPos[0] && c === targetPos[1])) {
            event.impactPositions!.push(targetPos);
            event.damagePositions!.push(targetPos);
        }
    }
    return [...batches.values()];
}
