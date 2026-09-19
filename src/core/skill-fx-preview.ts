/**
 * 技能特效预览的纯解析逻辑（图鉴复用战斗内特效组件时需要一套固定演示格位）。
 *
 * 战斗里的 SkillFxEvent 由 game-store 的 executeSkill 包装层用真实坐标派发；
 * 图鉴没有棋盘，于是这里造一个 3×2 的演示舞台：
 * - 方向型原型（跨格飞行 / 扫掠）把施法格放在左下、目标格放在右上，
 *   得到斜向 -26.57°（NE）与 2.24 格距离——既喂饱 --fx-dist 类几何，
 *   又能与"自身施放"（角度恒为 0）区分开；
 * - 自我型原型让起点与落点同格，与战斗中自身增益两变体叠渲的表现一致
 *   （见 Board 的 skillFxAtCell：fromPos 命中 caster、targetPos 命中 target）。
 *
 * 格位与间距常量集中在此，供预览组件摆格子：跨格距离公式写死了
 * `距离 × (var(--board-cell-size) + 6px)`，所以舞台网格必须用同样的 6px 间距。
 */
import type { Player, Position } from '../types/game';
import {
    computeFxAngleDeg,
    computeFxDirection,
    type SkillFxEvent,
    type SkillFxKind,
    type SkillFxProfile,
} from './skill-fx';

/** 预览舞台网格尺寸 */
export const PREVIEW_GRID_COLS = 3;
export const PREVIEW_GRID_ROWS = 2;

/** 施法格与目标格（自我型原型两格重合） */
export const PREVIEW_CASTER_POS: Position = [1, 0];
export const PREVIEW_TARGET_POS: Position = [0, PREVIEW_GRID_COLS - 1];
export const PREVIEW_SELF_POS: Position = [1, 1];

/** 网格间距（与特效距离公式里写死的 6px 保持一致） */
export const PREVIEW_GRID_GAP_PX = 6;

/**
 * 需要跨格才成立的原型：
 * - 消费 --fx-dist / --fx-travel-*（粒子束、投射物、突进拖尾、毫毛飞行），同格会塌成零长度；
 * - 或纯方向扫掠（弧斩、落棒、剑气），需要可读的旋转角才看得出挥砍方向。
 */
export const DIRECTIONAL_FX_KINDS: ReadonlySet<SkillFxKind> = new Set<SkillFxKind>([
    'wukong-clone',
    'wukong-staff',
    'feixue-blade',
    'arc-slash',
    'triple-slash',
    'pierce',
    'storm-bolt',
    'libai-slash',
    'libai-flurry',
    'feynman-beam',
    'shadow-dash',
    'phase-swap',
    'zuizhen-throw',
    'zuizhen-wheel',
]);

export function isDirectionalFxKind(kind: SkillFxKind): boolean {
    return DIRECTIONAL_FX_KINDS.has(kind);
}

/** 造一次演示施法事件：角度与八向标签由格位推导，与战斗内算法一致 */
export function buildPreviewFxEvent(
    profile: SkillFxProfile,
    id = 0,
    owner: Player = 'player1'
): SkillFxEvent {
    const directional = isDirectionalFxKind(profile.kind);
    const fromPos = directional ? PREVIEW_CASTER_POS : PREVIEW_SELF_POS;
    const targetPos = directional ? PREVIEW_TARGET_POS : PREVIEW_SELF_POS;
    const angleDeg = computeFxAngleDeg(fromPos, targetPos);
    return {
        id,
        profile,
        owner,
        fromPos,
        targetPos,
        angleDeg,
        direction: computeFxDirection(angleDeg),
        bornAt: Date.now(),
    };
}

/** 某个演示格应渲染的特效变体（同格时 caster 与 target 叠渲，与 Board 行为一致） */
export function previewCellVariants(
    event: SkillFxEvent,
    row: number,
    col: number
): Array<'caster' | 'target'> {
    const variants: Array<'caster' | 'target'> = [];
    if (event.fromPos[0] === row && event.fromPos[1] === col) variants.push('caster');
    if (event.targetPos[0] === row && event.targetPos[1] === col) variants.push('target');
    return variants;
}
