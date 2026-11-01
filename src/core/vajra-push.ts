import { EffectManager } from './effect-manager';
import { DamageCalculator } from './damage-calculator';
import { MovementSystem } from './movement-system';
import { zhizhiValue } from './hero-zhizhi';
import { BOARD_SIZE, GameState, Hero, HeroState, Position } from '../types/game';

/**
 * 达摩的两份账：把敌人「推」出去的几何，和挂在身上的「金刚」层数。
 *
 * 口径（2026-10-28 与用户确认）：
 * - **撞山 = 沿推动方向顶到墙**：落点的下一格出界就算触山（含"本来就被压在墙上、一格没动"），
 *   额外 6 点并眩晕；被**其他单位**挡住导致推不满不算撞山，只吃基础 6 点。
 *   沿边缘平行推（下一格还在盘内）也不算——他没撞上任何东西。
 * - **眩晕只封本回合还没行动过的人**（策划原文："下一回合开始就恢复正常，所以本回合已经行动了就不受影响"），
 *   与纸鸢「击飞」同一实现：`duration: 1`，不动过的人当场跳过行动。
 * - **金刚按"实际推动格数"叠层**，上限 4 层：每层 +2% 防御、叠到身上时回 2 点血（致知二 3 点）。
 *   层数不随回合掉（策划没给倒计时），但满 4 层会把 4 层一次性花掉，换**下一次推动 +1 格**——
 *   技能一的推动和技能二的击退都吃这一档。
 * - 技能二那一下击退**永不触发撞山**（策划原文写明），只按格数结算位移连带伤害。
 */

export const VAJRA_COUNTER = '金刚';
export const VAJRA_MAX = 4;
/** 每层金刚的防御加成（与"最多提升8点防御"对齐：4 层 × 2%） */
export const VAJRA_DEFENSE_PER_LAYER = 0.02;
export const VAJRA_HEAL_PER_LAYER = 2;
export const VAJRA_HEAL_PER_LAYER_TALENT = 3;
/** 满层花掉后，下一次推动多走的格数 */
export const VAJRA_BURST_STEPS = 1;

export const CHARGE_DAMAGE = 6;
export const MOUNTAIN_DAMAGE = 6;
export const CHARGE_PUSH_STEPS = 2;
export const FIST_COUNT = 4;
export const FIST_DAMAGE = 3;
export const FIST_PUSH_STEPS = 1;

/** 被动与棋盘角标共用的特效档案 id（不是技能，走 requestSkillFx） */
export const VAJRA_FX_ID = 'damo_vajra';

export type PushDirection = readonly [number, number];

/** 特效层要读的达摩专属几何（挂在 gameState.skillFxExtras.damo 上） */
export type DamoFxDetails = {
    /** 技能一：被推的人从哪一格滑到哪一格、实际推了几格、有没有顶到山壁 */
    slideFrom?: Position;
    slideTo?: Position;
    steps?: number;
    hitMountain?: boolean;
    /** 达摩自己有没有跟进去占住对方原来那一格 */
    casterSettled?: boolean;
    /** 技能二：真正挥出的拳数与每一拳落在哪一格（按出拳顺序） */
    punches?: number;
    cells?: Position[];
};

export interface PushOutcome {
    victim: Hero;
    from: Position;
    to: Position;
    /** 实际推动格数，也是这次叠到的金刚层数 */
    distance: number;
    /** 沿推动方向顶到了棋盘边缘（=撞山） */
    hitMountain: boolean;
}

function occupied(state: GameState, cell: Position): Hero | null {
    return state.board[cell[0]][cell[1]];
}

/** 沿推动方向再走一格就出界：这一格是"贴着山壁"的位置 */
export function isPressedAgainstEdge(cell: Position, dir: PushDirection): boolean {
    const next: Position = [cell[0] + dir[0], cell[1] + dir[1]];
    return !MovementSystem.inBounds(next);
}

/**
 * 把一名单位沿 `dir` 最多推 `maxSteps` 格：逐步走，撞人即停、出界即停。
 * 一格都没推动时返回 distance 0（顶在墙上被撞山的那一种）。
 */
export function pushUnit(
    state: GameState,
    victim: Hero,
    dir: PushDirection,
    maxSteps: number
): PushOutcome | null {
    if (!victim.position || victim.state !== HeroState.ALIVE) return null;
    const from: Position = [...victim.position] as Position;
    let current = from;
    let distance = 0;
    for (let step = 0; step < maxSteps; step++) {
        const next: Position = [current[0] + dir[0], current[1] + dir[1]];
        if (!MovementSystem.inBounds(next)) break;
        if (occupied(state, next) !== null) break;
        state.board[current[0]][current[1]] = null;
        state.board[next[0]][next[1]] = victim;
        victim.position = [...next] as Position;
        current = next;
        distance++;
    }
    return { victim, from, to: current, distance, hitMountain: isPressedAgainstEdge(current, dir) };
}

/** 离施法者最远的那个方向：技能二把打到人朝外甩 */
export function knockbackDirection(from: Position, target: Position): PushDirection {
    return [Math.sign(target[0] - from[0]), Math.sign(target[1] - from[1])] as PushDirection;
}

/** 达摩周围一格（含斜角）的存活敌人：技能二的拳头只在这些人身上一人一下 */
export function adjacentEnemies(state: GameState, caster: Hero): Hero[] {
    if (!caster.position) return [];
    return MovementSystem.getAreaPositions(caster.position, 3)
        .map(cell => occupied(state, cell))
        .filter((unit): unit is Hero =>
            !!unit && unit.owner !== caster.owner && unit.state === HeroState.ALIVE && !!unit.position);
}

export function vajraLayers(hero: Hero): number {
    return Math.min(VAJRA_MAX, hero.counters[VAJRA_COUNTER] ?? 0);
}

export function vajraDefenseRate(hero: Hero): number {
    if (hero.passiveId !== 'damo_passive') return 0;
    return vajraLayers(hero) * VAJRA_DEFENSE_PER_LAYER;
}

/** 满层就把下一次推动抬一格（是否消耗由调用方在推动发生时决定） */
export function vajraBurstReady(hero: Hero): boolean {
    return vajraLayers(hero) >= VAJRA_MAX;
}

/** 这一次实际能推多远：满层 +1 */
export function pushDistanceFor(hero: Hero, baseSteps: number): number {
    return vajraBurstReady(hero) ? baseSteps + VAJRA_BURST_STEPS : baseSteps;
}

/** 花掉 4 层换这一次推动：先花再叠，所以同一次推动拿回来的层数不会立刻又凑满 */
export function spendVajraBurst(hero: Hero): boolean {
    if (!vajraBurstReady(hero)) return false;
    hero.counters[VAJRA_COUNTER] = 0;
    return true;
}

/**
 * 叠金刚：按实际推动格数给层数，封顶 4 层，每叠上一层当场回一次血。
 * 层数记在 counter 上（不是效果栏），所以它不会被回合末的效果递减带走。
 */
export function gainVajra(hero: Hero, steps: number, gameState: GameState): number {
    if (steps <= 0 || hero.state !== HeroState.ALIVE) return vajraLayers(hero);
    const before = vajraLayers(hero);
    const after = Math.min(VAJRA_MAX, before + steps);
    const gained = after - before;
    if (gained > 0) {
        EffectManager.addCounter(hero, VAJRA_COUNTER, gained);
        const healPerLayer = zhizhiValue(hero, 2, VAJRA_HEAL_PER_LAYER, VAJRA_HEAL_PER_LAYER_TALENT);
        DamageCalculator.applyHeal(hero, healPerLayer * gained, gameState, hero);
    }
    return vajraLayers(hero);
}

/**
 * 撞山眩晕：只封"本回合还没行动过"的人。已经动过的人晕了等于没晕，
 * 与其挂一条无效状态，不如当场不给（与纸鸢「击飞」同一口径）。
 */
export function applyMountainStun(victim: Hero, caster: Hero): boolean {
    if (victim.state !== HeroState.ALIVE || victim.hasActedThisTurn) return false;
    if (victim.effects.some(effect => effect.type === 'stun' && effect.duration > 0)) return false;
    EffectManager.addEffect(victim, {
        type: 'stun',
        name: '撞山眩晕',
        duration: 1,
        sourceHeroId: caster.id,
        description: '被达摩撞上山壁，本回合无法行动',
    });
    return true;
}

/** 顶到山壁的那一下：额外伤害 + 眩晕，返回是否真的把人晕住 */
export function resolveMountainImpact(
    state: GameState,
    caster: Hero,
    outcome: PushOutcome,
    log: string[]
): { damage: number; stunned: boolean } {
    if (!outcome.hitMountain) return { damage: 0, stunned: false };
    const damage = DamageCalculator.calculate(
        caster, outcome.victim, MOUNTAIN_DAMAGE, false, false, { canCrit: false });
    DamageCalculator.applyDamage(outcome.victim, damage, caster, state, true);
    const stunned = applyMountainStun(outcome.victim, caster);
    log.push(`${outcome.victim.name}被撞上山壁，再受${damage.finalDamage}点伤害${
        stunned ? '并眩晕' : '（已经行动过，眩晕没吃住）'}`);
    return { damage: damage.finalDamage, stunned };
}

/** 达摩的棋盘边缘位（图鉴与电脑评分都用它判断"能不能把人推到山上"） */
export function isEdgeCell(cell: Position): boolean {
    return cell[0] === 0 || cell[1] === 0 || cell[0] === BOARD_SIZE - 1 || cell[1] === BOARD_SIZE - 1;
}
