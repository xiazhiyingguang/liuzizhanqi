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
import { getSkill } from '../data/skills';
import { computeFxCoveredPositions } from './skill-fx-coverage';
import { MovementSystem } from './movement-system';
import {
    computeFxAngleDeg,
    computeFxDirection,
    computeSkillAreaBounds,
    resolveSkillFx,
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
    'huanongying-fan',
    'huanongying-swap',
    'huanongying-replay',
    'jinghua-moonblade',
    'zuizhen-throw',
    'zuizhen-wheel',
    // 天威旋斩本体在落点格，但起手格的冲刺拖尾要吃 --fx-dist
    'liehuo-wheel',
    // 棱光千折：图鉴演示要沿"施法格→目标格"这条轴画一段折线光路
    'prism-beam',
    'ink-brush', 'ink-dash', 'ink-cut', 'feixue-bond', 'yang-link', 'yin-link',
    'starfire-lance', 'nightowl-strike', 'bone-slash', 'wind-line', 'wind-pressure',
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
    const directional = isDirectionalFxKind(profile.kind) || (profile.moon !== undefined && profile.moon !== 'full');
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
): Array<'caster' | 'target' | 'impact' | 'area'> {
    const variants: Array<'caster' | 'target' | 'impact' | 'area'> = [];
    if (event.fromPos[0] === row && event.fromPos[1] === col) variants.push('caster');
    if (event.targetPos[0] === row && event.targetPos[1] === col) variants.push('target');
    const here = ([r, c]: Position) => r === row && c === col;
    if (!variants.includes('target') && event.impactPositions?.some(here)) variants.push('impact');
    else if (!variants.includes('target') && event.coveredPositions?.some(here)) variants.push('area');
    return variants;
}

/** 技能级验收场景：复杂技能使用完整棋盘，旧的简单格位仍兼容。 */
export function buildSkillPreviewScene(skillId: string) {
    const profile = resolveSkillFx(skillId);
    const skill = getSkill(skillId);
    if (skillId === 'nanfeng_skill2') {
        const coveredPositions: Position[] = Array.from({ length: 6 }, (_, col) => [3, col]);
        const event: SkillFxEvent = { id: 0, skillId, profile, owner: 'player1', fromPos: [1, 1], targetPos: [3, 2],
            angleDeg: 0, direction: 'E', coveredPositions, damagePositions: [], impactPositions: [],
            areaBounds: computeSkillAreaBounds(skill!, coveredPositions) ?? undefined, bornAt: Date.now() };
        return { event, cols: 6, rows: 6 };
    }
    // 鲸落落在水泽随机格，不一定在太公脚下：预览按战斗几何摆——太公在西、落点在东两格，
    // 落点 3×3 影响面里的命中标记抽样铺开（战斗里按存活单位标记，预览无单位故取中心+隔格），
    // areaBounds 留空与战斗事件一致（requestSkillFx 直发的鲸落不铺区域底效）
    if (skillId === 'jiangtaigong_whalefall') {
        const fromPos: Position = [2, 1];
        const targetPos: Position = [2, 3];
        const angleDeg = computeFxAngleDeg(fromPos, targetPos);
        const coveredPositions = MovementSystem.getBoxPositions(targetPos, 3);
        const impactPositions = coveredPositions.filter(([r, c], i) =>
            (r === targetPos[0] && c === targetPos[1]) || i % 3 === 1).slice(0, 4);
        const event: SkillFxEvent = { id: 0, skillId, profile, owner: 'player1', fromPos, targetPos,
            angleDeg, direction: computeFxDirection(angleDeg), coveredPositions,
            impactPositions, damagePositions: impactPositions, bornAt: Date.now() };
        return { event, cols: 6, rows: 6 };
    }
    if (profile.mechanism) {
        const event = buildPreviewFxEvent(profile);
        event.skillId = skillId;
        if (profile.mechanism === 'counter') {
            event.fromPos = PREVIEW_CASTER_POS;
            event.targetPos = PREVIEW_TARGET_POS;
            event.angleDeg = computeFxAngleDeg(event.fromPos, event.targetPos);
            event.direction = computeFxDirection(event.angleDeg);
        }
        event.impactPositions = [event.targetPos];
        event.damagePositions = profile.mechanism === 'counter' ? [event.targetPos] : [];
        if (profile.mechanism === 'counter') event.softImpactPositions = [event.fromPos];
        event.coveredPositions = [];
        return { event, cols: PREVIEW_GRID_COLS, rows: PREVIEW_GRID_ROWS };
    }
    const complex = profile.kind === 'prism-beam' || profile.kind === 'ink-dash' ||
        profile.kind === 'jinghong-slash-ring' ||
        skillId === 'xubai_entrance' ||
        (profile.fxArea !== undefined && profile.fxArea !== 'none') ||
        skill?.targetCount === 'all' || (typeof skill?.targetCount === 'number' && skill.targetCount > 1);
    if (!complex) {
        const event = buildPreviewFxEvent(profile);
        event.skillId = skillId;
        if (skillId === 'jetzmi_skill2') {
            event.fromPos = PREVIEW_CASTER_POS;
            event.targetPos = PREVIEW_CASTER_POS;
            event.angleDeg = 0; event.direction = 'E'; event.damagePositions = [];
            return { event, cols: PREVIEW_GRID_COLS, rows: PREVIEW_GRID_ROWS };
        }
        // 标记、治疗和召唤也有真实目标，不能因不依赖弹道几何就画在自己身上。
        if ((skill && skill.targetType !== 'self') || (!skill && profile.recovery && skillId !== 'mowen_restore')) {
            event.fromPos = PREVIEW_CASTER_POS;
            event.targetPos = [0, Math.max(0, Math.min(2, (skill?.range ?? 3) - 1))];
            event.angleDeg = computeFxAngleDeg(event.fromPos, event.targetPos);
            event.direction = computeFxDirection(event.angleDeg);
        }
        return { event, cols: PREVIEW_GRID_COLS, rows: PREVIEW_GRID_ROWS };
    }
    // 决渊需要完整展示 5×5 外环，预览时放在棋盘腹地，避免左侧半圈被合法的边界裁切遮住。
    const fromPos: Position = skillId === 'jinghong_skill2' ? [2, 2] : [2, 1];
    const targetPos: Position = skillId === 'huanongying_skill1' || skillId === 'yunying_skill1' || skillId === 'yunying_skill2'
        ? [2, 2]
        : skill?.targetType === 'self' || ['lingxi-wave', 'heal-wave', 'chord-aura', 'chord-notes'].includes(profile.kind)
            ? fromPos : profile.kind === 'prism-beam' ? [2, 2] : [2, 3];
    const angleDeg = computeFxAngleDeg(fromPos, targetPos);
    let coveredPositions = computeFxCoveredPositions(skill, fromPos, targetPos, profile);
    if (skillId === 'lingxi_skill2') coveredPositions = MovementSystem.getLingxiFrontRect(fromPos, 3);
    if (profile.kind === 'prism-beam') coveredPositions = [[2, 2], [2, 3], [3, 3], [4, 3], [4, 4], [4, 5]];
    if (profile.kind === 'ink-dash') coveredPositions = [[2, 2], [2, 3], [2, 4]];
    if (skillId === 'yunying_skill1') coveredPositions = [[1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2]];
    if (skillId === 'yunying_skill2') coveredPositions = [[1, 2], [2, 2], [3, 2]];
    if (skillId === 'huanongying_skill1') coveredPositions = [[1, 2], [2, 2], [3, 2]];
    if (skillId === 'wither_lord_skill1') coveredPositions = [[2, 3], [2, 4], [3, 3], [3, 4]];
    if (skillId === 'wither_lord_skill2') coveredPositions = [[1, 2], [2, 3], [3, 4]];
    if (profile.kind === 'coin-blessing') coveredPositions = [[1, 2], [2, 3]];
    if (profile.kind === 'chord-aura') coveredPositions = [[1, 1], [2, 2], [3, 1]];
    if (skillId === 'bard_skill1' || skillId === 'bard_skill2' || skillId === 'xubai_entrance') coveredPositions = [[1, 1], [2, 2], [3, 1]];
    const impactPositions = skillId === 'lingxi_skill2' || skillId === 'wither_lord_skill2' || ['coin-blessing', 'chord-aura', 'chord-notes'].includes(profile.kind) || profile.recovery ? coveredPositions
        : coveredPositions.filter(([r, c], i) => (r === targetPos[0] && c === targetPos[1]) || i % 3 === 1).slice(0, 4);
    const soft = skill?.type === 'heal' || skill?.type === 'buff' || !!profile.recovery;
    const event: SkillFxEvent = { id: 0, profile, owner: 'player1', skillId, fromPos, targetPos,
        angleDeg, direction: computeFxDirection(angleDeg), coveredPositions, impactPositions,
        damagePositions: soft ? [] : impactPositions, softImpactPositions: soft ? impactPositions : [],
        areaBounds: profile.fxArea === 'none' ? undefined : computeSkillAreaBounds(skill ?? { type: 'special', rangeType: 'single' }, coveredPositions) ?? undefined,
        bornAt: Date.now() };
    return { event, cols: 6, rows: 6 };
}
