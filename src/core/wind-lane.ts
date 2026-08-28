import { BoardEffect, GameState, Hero, HeroState, Player, Position } from '../types/game';

export type WindLaneDirection = 'up' | 'down' | 'left' | 'right';

/** 风向编码表：下标即 counters['__nanfeng_skill2_dir'] 中存放的 0..3 */
export const WIND_LANE_DIRECTIONS: readonly WindLaneDirection[] = ['up', 'down', 'left', 'right'];

export function windLaneDirectionFromCode(code: number | undefined): WindLaneDirection | null {
    if (code === undefined || code < 0 || code >= WIND_LANE_DIRECTIONS.length) return null;
    return WIND_LANE_DIRECTIONS[code];
}

/** 每道风道为南风提供的闪避率；最多同时享受两道（25% × 2 = 50%） */
export const WIND_LANE_DODGE_PER_LANE = 0.25;
export const WIND_LANE_MAX_DODGE = 0.5;
export const WIND_LANE_BOARD_SIZE = 6;

const ROW_DIRECTIONS: WindLaneDirection[] = ['left', 'right'];

export function windLaneAxis(direction: WindLaneDirection): 'row' | 'col' {
    return ROW_DIRECTIONS.includes(direction) ? 'row' : 'col';
}

/** 一条风道占据的线标识：同线的风道互相冲突（每线最多一道） */
export function windLaneLineKey(direction: WindLaneDirection, position: Position): string {
    return windLaneAxis(direction) === 'row'
        ? `row:${position[0]}`
        : `col:${position[1]}`;
}

/** 风道轴线上的全部 6 格 */
export function windLaneCells(direction: WindLaneDirection, position: Position): Position[] {
    const [row, col] = position;
    const cells: Position[] = [];
    for (let i = 0; i < WIND_LANE_BOARD_SIZE; i++) {
        cells.push(windLaneAxis(direction) === 'row' ? [row, i] : [i, col]);
    }
    return cells;
}

/** 沿风向前进 1 格；出界返回 null */
export function windLaneNextCell(position: Position, direction: WindLaneDirection): Position | null {
    const delta: Record<WindLaneDirection, [number, number]> = {
        up: [-1, 0],
        down: [1, 0],
        left: [0, -1],
        right: [0, 1],
    };
    const [dr, dc] = delta[direction];
    const next: Position = [position[0] + dr, position[1] + dc];
    if (next[0] < 0 || next[0] >= WIND_LANE_BOARD_SIZE || next[1] < 0 || next[1] >= WIND_LANE_BOARD_SIZE) {
        return null;
    }
    return next;
}

export function getWindLanes(gameState: GameState): BoardEffect[] {
    return (gameState.boardEffects ?? []).filter(effect => effect.type === 'wind-lane');
}

/** 覆盖某个格子的全部风道（最多一行一列两道） */
export function lanesAtPosition(gameState: GameState, position: Position | null): BoardEffect[] {
    if (!position) return [];
    const [row, col] = position;
    return getWindLanes(gameState).filter(
        effect => effect.position[0] === row && effect.position[1] === col
    );
}

export function lanesAtHero(gameState: GameState, hero: Hero): BoardEffect[] {
    return lanesAtPosition(gameState, hero.position);
}

/**
 * 在指定线上铺设风道：该线上原有的风道（无论来自哪一方）被新风道替换，
 * 保证同一行/列上始终只有一道风向明确的风道。
 */
export function createWindLane(
    gameState: GameState,
    caster: Hero,
    position: Position,
    direction: WindLaneDirection,
): BoardEffect[] {
    const lineKey = windLaneLineKey(direction, position);
    const laneId = `wind-lane-${caster.id}-${lineKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const cells = windLaneCells(direction, position);

    const lanes: BoardEffect[] = cells.map(([row, col], index) => ({
        id: `${laneId}-${index}`,
        linkId: laneId,
        type: 'wind-lane' as const,
        position: [row, col] as Position,
        owner: caster.owner,
        sourceHeroId: caster.id,
        duration: -1,
        direction,
    }));

    const surviving = (gameState.boardEffects ?? []).filter(effect =>
        !(effect.type === 'wind-lane' &&
            effect.direction &&
            windLaneLineKey(effect.direction, effect.position) === lineKey)
    );
    gameState.boardEffects = [...surviving, ...lanes];
    return lanes;
}

/** 移除某位英雄铺设的全部风道（其阵亡时调用） */
export function removeWindLanesOf(gameState: GameState, casterId: string): number {
    const before = (gameState.boardEffects ?? []).length;
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(
        effect => !(effect.type === 'wind-lane' && effect.sourceHeroId === casterId)
    );
    return before - gameState.boardEffects.length;
}

/**
 * 风道内滑行是否免费：起点与终点属于同一条风道，且行进者是该风道铺设方的友军。
 * 顺风与逆流都免费；进/出风道的那一步仍按普通移动消耗 1 点移动力。
 */
export function isFreeWindLaneStep(
    gameState: GameState,
    from: Position,
    to: Position,
    moverOwner: Player,
): boolean {
    const fromLanes = lanesAtPosition(gameState, from);
    if (fromLanes.length === 0) return false;
    const toKeys = new Set(lanesAtPosition(gameState, to).map(effect => effect.linkId));
    return fromLanes.some(effect =>
        effect.owner === moverOwner && !!effect.linkId && toKeys.has(effect.linkId)
    );
}

/** 南风被动：所处风道数量换算成的闪避率（每道 +25%，上限 50%） */
export function getWindLaneDodgeRate(gameState: GameState, hero: Hero): number {
    if (hero.passiveId !== 'nanfeng_passive') return 0;
    const lanes = lanesAtHero(gameState, hero);
    const distinct = new Set(lanes.map(effect => effect.linkId ?? effect.id));
    return Math.min(WIND_LANE_MAX_DODGE, distinct.size * WIND_LANE_DODGE_PER_LANE);
}

/**
 * 天威自动定向：在该轴上取敌方单位更集中的一侧；无敌方时行风道向右、列风道向下。
 * 只统计仍在场上的敌方英雄，被击杀的目标已经离场不计入。
 */
export function chooseWindLaneDirection(
    gameState: GameState,
    position: Position,
    axis: 'row' | 'col',
    caster: Hero,
): WindLaneDirection {
    const enemies = (caster.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes)
        .filter(hero => hero.state === HeroState.ALIVE && !!hero.position)
        .map(hero => hero.position!);
    const [row, col] = position;

    let near = 0;
    let far = 0;
    for (const enemyPosition of enemies) {
        const value = axis === 'row' ? enemyPosition[1] : enemyPosition[0];
        const anchor = axis === 'row' ? col : row;
        if (value < anchor) near++;
        else if (value > anchor) far++;
    }
    const [negative, positive] = axis === 'row'
        ? (['left', 'right'] as WindLaneDirection[])
        : (['up', 'down'] as WindLaneDirection[]);
    if (near === 0 && far === 0) return positive;
    return near > far ? negative : positive;
}
