/**
 * 技能作用区域格推导（AOE 贴地底光专用）。
 *
 * 刻意与结算逻辑解耦：这里只按技能自身的几何元数据（rangeType / areaSize /
 * range / targetCount）重画"这一手覆盖了哪些格"，不参与任何数值判定。
 * 引擎里带特判展开的技能（点击格扩成 3x3、能量加宽、两点扩成 2x2 等）
 * 由特效档案的 fxArea 显式声明，避免推导与实际范围长期走偏。
 *
 * 纯函数 + 只读静态数据，因此本地施法与联机回放两端结果必然一致，
 * 无需把格子列表写进网络消息。
 */
import type { Position, Skill } from '../types/game';
import type { SkillFxProfile } from './skill-fx';
import { MovementSystem } from './movement-system';

/** 底光格上限：超过则整层不铺（超大范围宁可只保留命中格反馈，避免全盘发糊） */
const MAX_FX_COVERED_CELLS = 25;

/** 边界统一交给 MovementSystem，避免各处写死棋盘尺寸 */
function inBounds(cell: Position): boolean {
    return MovementSystem.inBounds(cell);
}

/** 以 center 为中心的 N 宫格，含中心格（MovementSystem.getAreaPositions 刻意不含中心） */
function areaCells(center: Position, size: number): Position[] {
    const offset = Math.max(1, Math.floor(size / 2));
    const cells: Position[] = [];
    for (let row = center[0] - offset; row <= center[0] + offset; row++) {
        for (let col = center[1] - offset; col <= center[1] + offset; col++) {
            if (inBounds([row, col])) cells.push([row, col]);
        }
    }
    return cells;
}

/** 档案未声明 fxArea 时，从技能几何元数据推导覆盖形状 */
function deriveAreaShape(skill: Skill): SkillFxProfile['fxArea'] {
    // 只有一击之敌的技能不需要轮廓：单体点选、召唤、位移等
    const multiTarget =
        skill.targetCount === 'all' ||
        (typeof skill.targetCount === 'number' && skill.targetCount >= 2);
    if (!multiTarget) return 'none';
    if (skill.targetType === 'self') return 'self';

    switch (skill.rangeType) {
        case 'area':
            return skill.areaSize ?? 3;
        case 'line':
            return 'line';
        case 'cross':
            return 'cross';
        // 名义单体却打全体：实际范围是施法者周围的整片菱形（金乌耀斑这类）
        case 'single':
            return 'diamond';
        // 全场技覆盖全盘，铺底光等于整块棋盘发亮，只留命中格反馈
        case '全场':
            return 'none';
        default:
            return 'none';
    }
}

/**
 * 本次施法在棋盘上铺开的全部作用格（含空格）。
 * 返回空数组表示这一手不铺区域底光。
 */
export function computeFxCoveredPositions(
    skill: Skill | undefined,
    fromPos: Position,
    targetPos: Position,
    profile?: SkillFxProfile
): Position[] {
    const shape = profile?.fxArea ?? (skill ? deriveAreaShape(skill) : undefined);
    if (!shape || shape === 'none') return [];

    let cells: Position[];
    if (shape === 'self') {
        cells = [fromPos, ...MovementSystem.getCrossPositions(fromPos)];
    } else if (shape === 'self-box') {
        // 周身全体技：真实作用区始终以施法者为中心，与玩家点了哪一格无关
        cells = areaCells(fromPos, skill?.areaSize ?? 3);
    } else if (shape === 'cross') {
        cells = [targetPos, ...MovementSystem.getCrossPositions(targetPos)];
    } else if (shape === 'diamond') {
        cells = [fromPos, ...MovementSystem.getPositionsInRange(fromPos, skill?.range ?? 1)];
    } else if (shape === 'bar') {
        const direction = MovementSystem.getDirection(fromPos, targetPos);
        cells = direction
            ? MovementSystem.getZhenxiaoSkill1Positions(fromPos, direction)
            : areaCells(targetPos, 3);
    } else if (shape === 'line') {
        const direction = MovementSystem.getDirection(fromPos, targetPos);
        // 斜向点选时没有确定的直线，退化成主目标格一圈
        cells = direction
            ? MovementSystem.getLinePositions(fromPos, direction, skill?.range)
            : areaCells(targetPos, 3);
    } else {
        cells = areaCells(targetPos, shape);
    }

    return cells.length > MAX_FX_COVERED_CELLS ? [] : cells;
}
