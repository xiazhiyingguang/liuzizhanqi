/**
 * 闻人翊悬（火行）的飞跃几何与「昭神」形态。
 *
 * 技能一不是普通走位：玩家先点一名友军当「中途点」，再从这名友军身后同方向的
 * 空格里选落点。普通态沿直线走到棋盘边界为止；昭神形态下整张棋盘按上下、左右
 * 相接的闭环计算，一条线从最上边飞出去会从最下边接回来。两种形态最远都只飞
 * 5 格（闭环第 6 格回到自己脚下，不能当落点）。
 *
 * 破妄是这位英雄自己的资源：技能一按飞越距离积攒，技能二与昭神消耗。
 * 昭神满 10 点自动进入、持续 2 回合；进入的那一下会给他一次额外行动。
 * 昭神会改写两个技能：技能一闭环且额外附带飞跃距离的伤害；技能二每层暴击率
 * 从 5% 提升到 10%、持续时间从 2 回合延长到 3 回合（伤害仍是破妄层数）。
 */
import { nextBattleLogId } from './battle-log-id';
import { EffectManager } from './effect-manager';
import { BOARD_SIZE, HeroState, type GameState, type Hero, type Position } from '../types/game';

export const WENREN_SKILL1_ID = 'wenren_skill1';
export const WENREN_SKILL2_ID = 'wenren_skill2';
export const WENREN_PASSIVE_ID = 'wenren_passive';

/** 玩家向资源：飞越距离积攒，技能二消耗一半，昭神一次吞 10 点 */
export const WENREN_RESOURCE = '破妄';
/** 形态名：与轩辕神君共用同一套文案/角标，但解锁方式与持续规则各自独立 */
export const WENREN_ZHAOSHEN = '昭神';
/** 技能二消耗破妄换来的暴击率增益；名字含「暴击率」才会被伤害管线读取 */
export const WENREN_CRIT_EFFECT = '破妄暴击率';
/** 两段式选点的中途点编码（row * 6 + col）；只在本次行动内有效 */
export const WENREN_WAYPOINT_COUNTER = '__wenren_waypoint';

export const WENREN_ZHAOSHEN_COST = 10;
export const WENREN_ZHAOSHEN_DURATION = 2;
/** 一条线最多飞 5 格：闭环第 6 格回到起点，普通态棋盘也没有第 6 格 */
export const WENREN_TORUS_MAX_STEPS = BOARD_SIZE - 1;
/** 技能二每消耗 1 层破妄的暴击率：普通态 5%，昭神 10%（致知三再各 +5%） */
export const WENREN_CRIT_PER_LAYER = 0.05;
export const WENREN_CRIT_PER_LAYER_ZHAOSHEN = 0.1;
/** 技能二暴击率持续回合：普通态 2，昭神 3 */
export const WENREN_CRIT_DURATION = 2;
export const WENREN_CRIT_DURATION_ZHAOSHEN = 3;

/** 八个方向；昭神态下对角线也按环图闭合成一条 6 格的循环 */
const DIRECTIONS: readonly Position[] = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
];

export function isWenren(hero: Hero): boolean {
    return hero.skill1Id === WENREN_SKILL1_ID;
}

export function getWenrenPos(hero: Hero): number {
    return Math.max(0, Math.floor(hero.counters[WENREN_RESOURCE] ?? 0));
}

export function setWenrenPos(hero: Hero, value: number): void {
    hero.counters[WENREN_RESOURCE] = Math.max(0, Math.floor(value));
}

export function addWenrenPos(hero: Hero, amount: number): number {
    const next = getWenrenPos(hero) + Math.max(0, Math.floor(amount));
    setWenrenPos(hero, next);
    return next;
}

export function isWenrenZhaoShen(hero: Hero): boolean {
    return hero.effects.some(effect => effect.name === WENREN_ZHAOSHEN);
}

export function getWenrenZhaoShenRemaining(hero: Hero): number {
    return hero.effects.find(effect => effect.name === WENREN_ZHAOSHEN)?.duration ?? 0;
}

function encodeWaypoint(position: Position): number {
    return position[0] * BOARD_SIZE + position[1];
}

function decodeWaypoint(value: number | undefined): Position | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const row = Math.floor(value / BOARD_SIZE);
    const col = value % BOARD_SIZE;
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
    return [row, col];
}

export function getWenrenWaypoint(hero: Hero): Position | null {
    return decodeWaypoint(hero.counters[WENREN_WAYPOINT_COUNTER]);
}

export function setWenrenWaypoint(hero: Hero, position: Position): void {
    hero.counters[WENREN_WAYPOINT_COUNTER] = encodeWaypoint(position);
}

export function clearWenrenWaypoint(hero: Hero): void {
    delete hero.counters[WENREN_WAYPOINT_COUNTER];
}

export function sameWenrenPosition(left: Position, right: Position): boolean {
    return left[0] === right[0] && left[1] === right[1];
}

/** 沿某个方向在环图上走 steps 格；上下、左右都闭合成环 */
export function wenrenTorusStep(from: Position, direction: Position, steps = 1): Position {
    const row = ((from[0] + direction[0] * steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
    const col = ((from[1] + direction[1] * steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
    return [row, col];
}

/** 普通态沿直线走；走出棋盘即视为这条线到头，返回 null */
function wenrenBoardStep(from: Position, direction: Position, steps: number): Position | null {
    const row = from[0] + direction[0] * steps;
    const col = from[1] + direction[1] * steps;
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
    return [row, col];
}

function wenrenStepAt(from: Position, direction: Position, steps: number, wrap: boolean): Position | null {
    return wrap ? wenrenTorusStep(from, direction, steps) : wenrenBoardStep(from, direction, steps);
}

/** 落点周围一圈（八格，不含落点本身）；棋盘边界外直接剔除，不环绕 */
export function wenrenRingCells(center: Position): Position[] {
    const cells: Position[] = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const row = center[0] + dr;
            const col = center[1] + dc;
            if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
            cells.push([row, col]);
        }
    }
    return cells;
}

export interface WenrenLeapPlan {
    ally: Hero;
    allyPosition: Position;
    /** 落点 */
    to: Position;
    /** 从自己出发沿这条线走过的总格数；普通态只换成破妄，昭神态还会加进伤害 */
    distance: number;
    direction: Position;
    /** 从自己出发到落点经过的全部格子（含中途点与落点，不含起点） */
    path: Position[];
}

function livingAllies(hero: Hero, gameState: GameState): Hero[] {
    const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    return allies.filter(ally =>
        ally.id !== hero.id &&
        ally.state === HeroState.ALIVE &&
        ally.position !== null
    );
}

function planKey(allyPosition: Position, landing: Position): string {
    return `${allyPosition[0]},${allyPosition[1]}>${landing[0]},${landing[1]}`;
}

/**
 * 枚举所有合法飞跃方案。
 * 友军必须与自己处在八方向之一的那条线上；落点在这名友军身后、继续同向的任意空格。
 * 普通态直线走到棋盘边缘为止；昭神态把棋盘当作上下左右相接的闭环。
 */
export function getAllWenrenLeapPlans(hero: Hero, gameState: GameState): WenrenLeapPlan[] {
    if (!hero.position || hero.state !== HeroState.ALIVE) return [];
    const start = hero.position;
    const wrap = isWenrenZhaoShen(hero);
    const plans = new Map<string, WenrenLeapPlan>();

    for (const ally of livingAllies(hero, gameState)) {
        const allyPosition = ally.position!;
        for (const direction of DIRECTIONS) {
            let allyStep = -1;
            for (let step = 1; step <= WENREN_TORUS_MAX_STEPS; step++) {
                const cell = wenrenStepAt(start, direction, step, wrap);
                if (!cell) break;
                if (sameWenrenPosition(cell, allyPosition)) {
                    allyStep = step;
                    break;
                }
            }
            if (allyStep < 0) continue;

            for (let step = allyStep + 1; step <= WENREN_TORUS_MAX_STEPS; step++) {
                const to = wenrenStepAt(start, direction, step, wrap);
                if (!to) break;
                if (gameState.board[to[0]]?.[to[1]] !== null) continue;
                const key = planKey(allyPosition, to);
                const existing = plans.get(key);
                if (existing && existing.distance <= step) continue;
                const path: Position[] = [];
                for (let depth = 1; depth <= step; depth++) {
                    const cell = wenrenStepAt(start, direction, depth, wrap);
                    if (cell) path.push(cell);
                }
                plans.set(key, {
                    ally,
                    allyPosition: [...allyPosition],
                    to: [...to],
                    distance: step,
                    direction: [...direction],
                    path,
                });
            }
        }
    }

    return [...plans.values()];
}

/** 技能一第一步：可作为中途点的友军位置（只列真正还有落点可选的友军） */
export function getWenrenWaypointCells(hero: Hero, gameState: GameState): Position[] {
    const seen = new Set<string>();
    const cells: Position[] = [];
    for (const plan of getAllWenrenLeapPlans(hero, gameState)) {
        const key = `${plan.allyPosition[0]},${plan.allyPosition[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push([...plan.allyPosition]);
    }
    return cells;
}

/** 技能一第二步：选定中途点之后，这名友军身后所有可落的空格 */
export function getWenrenLandingPlans(
    hero: Hero,
    gameState: GameState,
    allyPosition: Position
): WenrenLeapPlan[] {
    const plans = getAllWenrenLeapPlans(hero, gameState)
        .filter(plan => sameWenrenPosition(plan.allyPosition, allyPosition));
    const byLanding = new Map<string, WenrenLeapPlan>();
    for (const plan of plans) {
        const key = `${plan.to[0]},${plan.to[1]}`;
        const existing = byLanding.get(key);
        if (!existing || plan.distance < existing.distance) byLanding.set(key, plan);
    }
    return [...byLanding.values()];
}

/** 找到指定「中途点 → 落点」的最短方案；两段式点击的最终结算走这里 */
export function findWenrenLeapPlan(
    hero: Hero,
    gameState: GameState,
    allyPosition: Position,
    landing: Position
): WenrenLeapPlan | null {
    return getWenrenLeapPlansForLanding(hero, gameState, landing)
        .filter(plan => sameWenrenPosition(plan.allyPosition, allyPosition))
        .sort((left, right) => left.distance - right.distance)[0] ?? null;
}

/** 没有记录中途点时（AI 直接点落点/测试直调）的兜底：取能到达该落点的最短方案 */
export function getWenrenLeapPlansForLanding(
    hero: Hero,
    gameState: GameState,
    landing: Position
): WenrenLeapPlan[] {
    return getAllWenrenLeapPlans(hero, gameState)
        .filter(plan => sameWenrenPosition(plan.to, landing));
}

/**
 * 破妄满 10 时自动消耗并踏入昭神；已处于昭神时不重复进入（破妄继续攒着）。
 * 进入的那一下由被动送一次额外行动；返回 true 表示这一次真的变身。
 */
export function tryEnterWenrenZhaoShen(hero: Hero, gameState: GameState): boolean {
    if (!isWenren(hero) || hero.state !== HeroState.ALIVE || !hero.position) return false;
    if (isWenrenZhaoShen(hero)) return false;
    if (getWenrenPos(hero) < WENREN_ZHAOSHEN_COST) return false;

    setWenrenPos(hero, getWenrenPos(hero) - WENREN_ZHAOSHEN_COST);

    EffectManager.addEffect(hero, {
        type: 'buff',
        name: WENREN_ZHAOSHEN,
        duration: WENREN_ZHAOSHEN_DURATION,
        sourceHeroId: hero.id,
        description: '火行昭神：技能一将棋盘视为上下左右闭环，伤害额外附带飞跃距离；技能二每层破妄的暴击率提升为10%、持续3回合；持续2回合。进入时额外行动一次。',
    });

    gameState.pendingExtraActionHeroIds ??= {};
    gameState.pendingExtraActionHeroIds[hero.owner] = hero.id;

    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'passive',
        player: hero.owner,
        message: `${hero.name}破妄盈满，消耗10点踏入【昭神】，还可再行动一次`,
        timestamp: Date.now(),
    });
    return true;
}
