/**
 * 「愤怒」：被迫把某名英雄当作攻击目标的强制状态（血契的嘲讽通道）。
 *
 * 规则：单体攻击只能指向绑缚者；以施法者为中心的全体技必须罩得住绑缚者，
 * 否则该技能不可用。绑缚者阵亡或离场后限制自动解除。
 * 当事人在任何情况下都仍可移动并结束行动，所以嘲讽不会制造"无合法动作"的死锁。
 *
 * 过滤收口在 SkillSystem.getValidTargetPositions：界面高亮、AI 选目标与
 * canUseSkill 三者都从这一个函数取候选格，在这里改一次即可全链路一致。
 */
import type { GameState, Hero, Position, Skill } from '../types/game';
import { HeroState } from '../types/game';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';

export const RAGE_EFFECT = '愤怒';

const sameCell = (a: Position, b: Position): boolean => a[0] === b[0] && a[1] === b[1];

const containsCell = (cells: Position[], cell: Position): boolean =>
    cells.some(current => sameCell(current, cell));

/** 施加愤怒；expireAtActionSerial 决定它随绑缚者第几次行动结束而撤除 */
export function applyRage(target: Hero, binder: Hero, expireAtActionSerial: number): void {
    EffectManager.removeEffectByName(target, RAGE_EFFECT);
    EffectManager.addEffect(target, {
        type: 'control',
        name: RAGE_EFFECT,
        duration: 2,
        expireAtActionSerial,
        sourceHeroId: binder.id,
        description: `被${binder.name}锁住：单体攻击只能指向${binder.name}，群体攻击范围内必须有${binder.name}`,
    });
}

/** 绑缚者：仍在场且有落点的施绑英雄；否则视为愤怒已解除 */
export function getRageBinder(caster: Hero, gameState?: GameState): Hero | null {
    if (!gameState) return null;
    const effect = caster.effects.find(item => item.name === RAGE_EFFECT);
    if (!effect?.sourceHeroId || effect.sourceHeroId === caster.id) return null;
    const binder = [...gameState.player1Heroes, ...gameState.player2Heroes]
        .find(hero => hero.id === effect.sourceHeroId && hero.state === HeroState.ALIVE);
    return binder?.position ? binder : null;
}

/** 点击 cell 施放 skill 后，真实作用区是否罩得住 binder 所在格 */
function castCoversBinder(
    caster: Hero,
    skill: Skill,
    cell: Position,
    binderCell: Position
): boolean {
    if (!caster.position) return false;

    // 全体技的作用区固定以施法者为中心（与点击哪格无关）
    if (skill.rangeType === 'area' && skill.targetCount === 'all') {
        return containsCell(
            MovementSystem.getBoxPositions(caster.position, skill.areaSize ?? 3),
            binderCell
        );
    }

    // 直线技：点击格代表方向，射线罩得住才算合法
    if (skill.rangeType === 'line') {
        const direction = MovementSystem.getDirection(caster.position, cell);
        if (!direction) return false;
        return containsCell(
            MovementSystem.getLinePositions(caster.position, direction, skill.range),
            binderCell
        );
    }

    // 其余形态一律按"点击格即目标"处理：只能点绑缚者所在格
    return sameCell(cell, binderCell);
}

/**
 * 愤怒对候选目标格的收窄。只约束指向敌人的技能，
 * 治疗、增益、位移落点（ally/self/any/empty）不受嘲讽支配。
 */
export function filterPositionsByRage(
    caster: Hero,
    skill: Skill,
    positions: Position[],
    gameState?: GameState
): Position[] {
    if (skill.targetType !== 'enemy' || positions.length === 0) return positions;
    const binder = getRageBinder(caster, gameState);
    if (!binder?.position) return positions;
    return positions.filter(cell => castCoversBinder(caster, skill, cell, binder.position!));
}

/** 结算前的兜底校验：绕过界面与 AI 的直接调用也认这条 */
export function rageBlocksCast(
    caster: Hero,
    skill: Skill,
    targetPositions: Position[],
    gameState: GameState
): boolean {
    if (skill.targetType !== 'enemy') return false;
    const binder = getRageBinder(caster, gameState);
    if (!binder?.position) return false;
    return !targetPositions.some(cell => castCoversBinder(caster, skill, cell, binder.position!));
}
