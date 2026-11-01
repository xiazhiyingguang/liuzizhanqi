import { nextBattleLogId } from './battle-log-id';
import { requestXiangyuGuardFx } from './xiangyu-guard-fx';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import { zhizhiValue } from './hero-zhizhi';
import { GameState, Hero, HeroState, Position } from '../types/game';

/**
 * 西楚霸王·项羽：燃血为盾、八向冲锋、前方 2×3 刀气，残血靠「霸王镇守」把下一击化成护盾。
 *
 * 口径：
 * - 两个主动技能都按“当前生命的 25%”燃血，至少留 1 点生命；只有技能一把扣掉的血换等量护盾，
 *   技能二只付血价、不添盾，伤害吃开打前已有的护盾，斩完把护盾清空。
 * - 楚歌挂在敌人身上：持续 2 回合，携带者造成的伤害降低 40%（上限 40%，刷新不叠加）。
 * - 四面楚歌：项羽造成主动伤害时按伤害吸取护盾，基础 20%；身周没有友方 +15 个百分点，
 *   每有一名相邻友方 -5 个百分点，最低 0。只认相邻八格，不数全场。
 * - 霸王镇守（天威位）：生命首次低于 30% 时获得 10 点护盾（致知三 15 点），
 *   并进入“下一次主动技能攻击伤害转化为护盾”的状态；效果伤害不消耗这一层。
 */
export const XIANGYU_HP_COST_RATE = 0.25;
export const XIANGYU_CHARGE_DAMAGE = 6;
export const XIANGYU_CHARGE_DAMAGE_TALENT = 8;
export const XIANGYU_CHARGE_STEPS = 2;
export const XIANGYU_SLASH_BASE = 8;
export const XIANGYU_SLASH_SHIELD_DIVISOR = 2;

export const CHUGE_EFFECT = '楚歌';
export const CHUGE_DURATION = 2;
export const CHUGE_DAMAGE_REDUCTION = 0.4;

export const XIANGYU_SIPHON_BASE = 0.2;
export const XIANGYU_SIPHON_SOLO_BONUS = 0.15;
export const XIANGYU_SIPHON_ALLY_PENALTY = 0.05;

/** 技能二「盖世」的冷却计数：2 = 用完这一手后还要隔一个完整回合才能再放 */
export const XIANGYU_SKILL2_CD_KEY = 'xiangyu_skill2_cd';
export const XIANGYU_SKILL2_CD_TURNS = 2;

export const XIANGYU_LAST_STAND_KEY = '__xiangyu_laststand_triggered';
export const XIANGYU_GUARD_EFFECT = '霸王镇守';
export const XIANGYU_LAST_STAND_THRESHOLD = 0.3;
export const XIANGYU_LAST_STAND_SHIELD = 10;
export const XIANGYU_LAST_STAND_SHIELD_TALENT = 15;

export type XiangyuDirection = readonly [number, number];

export interface XiangyuChargeResult {
    from: Position;
    to: Position;
    hit: Hero | null;
    pushed: boolean;
    /** 被撞敌人实际被推开的格数 */
    pushDistance: number;
    /** 项羽自己实际冲锋的格数 */
    dashDistance: number;
    damage: number;
    chugeTargets: Hero[];
    path: Position[];
}

function occupied(state: GameState, cell: Position): Hero | null {
    return state.board[cell[0]]?.[cell[1]] ?? null;
}

/** 身周八格（含斜角）的存活友方，不含自己 */
export function xiangyuAdjacentAllyCount(hero: Hero, state: GameState): number {
    if (!hero.position) return 0;
    const cells = MovementSystem.getAreaPositions(hero.position, 3);
    return cells.reduce((count, cell) => {
        const unit = occupied(state, cell);
        return count + (unit && unit.owner === hero.owner && unit.state === HeroState.ALIVE && unit.id !== hero.id ? 1 : 0);
    }, 0);
}

/** 四面楚歌：攻击吸取护盾的比率 */
export function xiangyuShieldSiphonRate(hero: Hero, state: GameState): number {
    if (hero.passiveId !== 'xiangyu_passive') return 0;
    const allies = xiangyuAdjacentAllyCount(hero, state);
    const rate = XIANGYU_SIPHON_BASE + XIANGYU_SIPHON_SOLO_BONUS - allies * XIANGYU_SIPHON_ALLY_PENALTY;
    // 没有友方时是基础 + 单挑加成；有 5 名相邻友方时被扣到 0，不出现负吸取。
    return Math.max(0, Math.min(0.6, rate));
}

/** 楚歌：携带者造成的伤害降低 40%，多份只取最高且封顶 40% */
export function chugeDamageReduction(hero: Hero): number {
    const values = hero.effects
        .filter(effect => effect.name === CHUGE_EFFECT)
        .map(effect => effect.value ?? CHUGE_DAMAGE_REDUCTION);
    return Math.min(CHUGE_DAMAGE_REDUCTION, Math.max(0, ...values));
}

/** 给敌人挂楚歌；已有同源楚歌时只刷新持续时间，不叠层 */
export function applyChuge(target: Hero, caster: Hero): void {
    const existing = target.effects.find(effect =>
        effect.name === CHUGE_EFFECT && effect.sourceHeroId === caster.id);
    if (existing) {
        existing.duration = CHUGE_DURATION;
        existing.value = CHUGE_DAMAGE_REDUCTION;
        return;
    }
    EffectManager.addEffect(target, {
        type: 'debuff',
        name: CHUGE_EFFECT,
        duration: CHUGE_DURATION,
        value: CHUGE_DAMAGE_REDUCTION,
        sourceHeroId: caster.id,
        description: '楚歌绕耳：造成的伤害降低40%（上限40%）',
    });
}

/** 只付燃血代价：扣当前生命的 25%，至少留 1 点生命；技能二用这一档，不把血换成盾 */
export function payXiangyuHpCost(hero: Hero, state: GameState): number {
    if (hero.state !== HeroState.ALIVE) return 0;
    const cost = Math.max(0, Math.min(Math.floor(hero.currentHp * XIANGYU_HP_COST_RATE), hero.currentHp - 1));
    if (cost <= 0) return 0;
    hero.currentHp -= cost;
    tryTriggerXiangyuLastStand(hero, state);
    return cost;
}

/** 燃血为盾：技能一用这一档，扣当前生命的 25% 并换成等量护盾 */
export function burnHpForShield(hero: Hero, state: GameState): { cost: number; shield: number } {
    const cost = payXiangyuHpCost(hero, state);
    if (cost <= 0) return { cost: 0, shield: 0 };
    hero.shield += cost;
    return { cost, shield: cost };
}

/** 霸王镇守：生命首次跌破 30% 时获得护盾，并挂起“下一次主动技能伤害化盾” */
export function tryTriggerXiangyuLastStand(hero: Hero, state: GameState): boolean {
    if (hero.tianweiId !== 'xiangyu_tianwei' || hero.state !== HeroState.ALIVE) return false;
    if (hero.currentHp <= 0) return false;
    if (hero.counters[XIANGYU_LAST_STAND_KEY] === 1) return false;
    if (hero.maxHp <= 0 || hero.currentHp / hero.maxHp >= XIANGYU_LAST_STAND_THRESHOLD) return false;

    hero.counters[XIANGYU_LAST_STAND_KEY] = 1;
    const shield = zhizhiValue(hero, 3, XIANGYU_LAST_STAND_SHIELD, XIANGYU_LAST_STAND_SHIELD_TALENT);
    hero.shield += shield;
    EffectManager.addEffect(hero, {
        type: 'buff',
        name: XIANGYU_GUARD_EFFECT,
        duration: 2,
        sourceHeroId: hero.id,
        description: '霸王镇守：下一次受到的主动技能攻击伤害转化为护盾',
    });
    state.battleLog.push({
        id: nextBattleLogId(),
        type: 'tianwei',
        player: hero.owner,
        message: `${hero.name}生命跌破三成，霸王镇守发动：获得${shield}点护盾，下一次主动技能攻击将化为护盾`,
        timestamp: Date.now(),
    });
    requestXiangyuGuardFx(hero, state, shield);
    return true;
}

/** 下一次受到的主动技能攻击是否会被霸王镇守化盾 */
export function hasXiangyuGuard(hero: Hero): boolean {
    return hero.tianweiId === 'xiangyu_tianwei' && EffectManager.hasEffect(hero, XIANGYU_GUARD_EFFECT);
}

/** 消耗霸王镇守的化盾层 */
export function consumeXiangyuGuard(hero: Hero): void {
    EffectManager.removeEffectByName(hero, XIANGYU_GUARD_EFFECT);
}

/**
 * 前方 2×3 刀气范围：方向 0上 1下 2左 3右。
 * 与李太白/帝兰同口径：向前的 2 行，横向铺 3 列。
 */
export function getXiangyuFrontRect(caster: Hero, dirCode: number): Position[] {
    if (!caster.position) return [];
    const [cr, cc] = caster.position;
    const positions: Position[] = [];
    for (let depth = 1; depth <= 2; depth++) {
        for (let side = -1; side <= 1; side++) {
            const cell: Position = dirCode === 0
                ? [cr - depth, cc + side]
                : dirCode === 1
                    ? [cr + depth, cc + side]
                    : dirCode === 2
                        ? [cr + side, cc - depth]
                        : [cr + side, cc + depth];
            if (MovementSystem.inBounds(cell)) positions.push(cell);
        }
    }
    return positions;
}

/**
 * 八向冲锋：沿 dir 最多走 2 格。路径上第一个敌人被向前推，最多推开 2 格，
 * 推到让开冲锋路线后项羽继续冲满 2 格；推不开就停在最后一个能站的空格。
 * 无论推没推动，都记一次 6 点伤害。冲锋结束后对落点周围一圈敌人挂楚歌。
 */
export function performXiangyuCharge(
    state: GameState,
    caster: Hero,
    dir: XiangyuDirection,
    damage: number
): XiangyuChargeResult | null {
    if (!caster.position || caster.state !== HeroState.ALIVE) return null;
    const from: Position = [...caster.position] as Position;
    let hit: Hero | null = null;
    let pushDistance = 0;
    const path: Position[] = [];

    // 先找路径上第一个敌人，把它沿着冲锋方向推走，直到给项羽让出落脚点。
    for (let step = 1; step <= XIANGYU_CHARGE_STEPS; step++) {
        const cell: Position = [from[0] + dir[0] * step, from[1] + dir[1] * step];
        if (!MovementSystem.inBounds(cell)) break;
        path.push(cell);
        const occupant = occupied(state, cell);
        if (!occupant) continue;
        if (occupant.owner === caster.owner || occupant.state !== HeroState.ALIVE) break;

        hit = occupant;
        let cursor: Position = cell;
        for (let push = 0; push < XIANGYU_CHARGE_STEPS; push++) {
            const beyond: Position = [cursor[0] + dir[0], cursor[1] + dir[1]];
            if (!MovementSystem.inBounds(beyond) || occupied(state, beyond) !== null) break;
            state.board[cursor[0]][cursor[1]] = null;
            state.board[beyond[0]][beyond[1]] = occupant;
            occupant.position = beyond;
            cursor = beyond;
            pushDistance++;
        }
        break;
    }

    // 推完之后再走：能走满 2 格就走满，被挡住就停在最后一个空格。
    let final: Position = from;
    for (let step = 1; step <= XIANGYU_CHARGE_STEPS; step++) {
        const cell: Position = [from[0] + dir[0] * step, from[1] + dir[1] * step];
        if (!MovementSystem.inBounds(cell) || occupied(state, cell) !== null) break;
        final = cell;
    }
    if (final[0] !== from[0] || final[1] !== from[1]) {
        state.board[from[0]][from[1]] = null;
        state.board[final[0]][final[1]] = caster;
        caster.position = [...final] as Position;
        caster.hasMovedThisTurn = true;
    }
    const dashDistance = Math.abs(final[0] - from[0]) + Math.abs(final[1] - from[1]);

    const chugeTargets: Hero[] = [];
    const ring = [final, ...MovementSystem.getAreaPositions(final, 3)];
    for (const cell of ring) {
        const unit = occupied(state, cell);
        if (unit && unit.owner !== caster.owner && unit.state === HeroState.ALIVE) {
            chugeTargets.push(unit);
        }
    }
    for (const enemy of chugeTargets) applyChuge(enemy, caster);

    return {
        from,
        to: final,
        hit,
        pushed: pushDistance > 0,
        pushDistance,
        dashDistance,
        damage,
        chugeTargets,
        path,
    };
}
