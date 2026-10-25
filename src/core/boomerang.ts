import { BOARD_SIZE, BoardEffect, GameState, Hero, Position } from '../types/game';

export const SHUANGFEIYAN_SKILL1_ID = 'shuangfeiyan_skill1';
export const SHUANGFEIYAN_SKILL2_ID = 'shuangfeiyan_skill2';
export const SHUANGFEIYAN_PASSIVE_ID = 'shuangfeiyan_passive';

export const SHUANGFEIYAN_BOOMERANGS = 2;
export const SHUANGFEIYAN_THROW_RANGE = 3;
export const SHUANGFEIYAN_BOOMERANG_DAMAGE = 4;
export const SHUANGFEIYAN_TRIANGLE_DAMAGE = 7;
export const SHUANGFEIYAN_TELEPORT_DAMAGE = 7;

/** 八个方向；掷镖与返航都按这组方向走 */
const DIRECTIONS: Position[] = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
];

function inBounds([row, col]: Position): boolean {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function samePosition(a: Position, b: Position): boolean {
    return a[0] === b[0] && a[1] === b[1];
}

export function isShuangfeiyan(hero: Hero): boolean {
    return hero.passiveId === SHUANGFEIYAN_PASSIVE_ID;
}

export function getShuangfeiyanBoomerangs(state: GameState, hero: Hero): BoardEffect[] {
    return (state.boardEffects ?? []).filter(
        effect => effect.type === 'boomerang' && effect.sourceHeroId === hero.id
    );
}

export function getShuangfeiyanBoomerangsInHand(state: GameState, hero: Hero): number {
    return Math.max(0, SHUANGFEIYAN_BOOMERANGS - getShuangfeiyanBoomerangs(state, hero).length);
}

/** 技能二的可落点：镖所在格必须是空的，人不能被叠进去 */
export function getShuangfeiyanPickupCells(state: GameState, hero: Hero): Position[] {
    return getShuangfeiyanBoomerangs(state, hero)
        .filter(effect => state.board[effect.position[0]][effect.position[1]] === null)
        .map(effect => [...effect.position] as Position);
}

/** 技能一的掷镖落点：八方向 1~3 格 */
export function getShuangfeiyanThrowCells(from: Position): Position[] {
    const cells: Position[] = [];
    for (const [dr, dc] of DIRECTIONS) {
        for (let step = 1; step <= SHUANGFEIYAN_THROW_RANGE; step++) {
            const cell: Position = [from[0] + dr * step, from[1] + dc * step];
            if (!inBounds(cell)) break;
            cells.push(cell);
        }
    }
    return cells;
}

export function isShuangfeiyanThrowTarget(from: Position, to: Position): boolean {
    if (!inBounds(from) || !inBounds(to)) return false;
    const dr = to[0] - from[0];
    const dc = to[1] - from[1];
    const distance = Math.max(Math.abs(dr), Math.abs(dc));
    if (distance < 1 || distance > SHUANGFEIYAN_THROW_RANGE) return false;
    return dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
}

/** 去程：从她身前一格到落点（含落点），不含她自己脚下 */
export function getShuangfeiyanThrowPath(from: Position, to: Position): Position[] {
    if (!isShuangfeiyanThrowTarget(from, to)) return [];
    const dr = Math.sign(to[0] - from[0]);
    const dc = Math.sign(to[1] - from[1]);
    const distance = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    const path: Position[] = [];
    for (let step = 1; step <= distance; step++) {
        path.push([from[0] + dr * step, from[1] + dc * step]);
    }
    return path;
}

/**
 * 返航的伤害格：按八方向走最短路径（切比雪夫距离），
 * 含镖起飞的那一格，不含她脚下（她站的那格不可能有敌人）。
 */
export function getShuangfeiyanReturnPath(from: Position, to: Position): Position[] {
    if (samePosition(from, to)) return [];
    const cells: Position[] = [[...from] as Position];
    let row = from[0];
    let col = from[1];
    while (row !== to[0] || col !== to[1]) {
        row += Math.sign(to[0] - row);
        col += Math.sign(to[1] - col);
        if (row === to[0] && col === to[1]) break;
        cells.push([row, col]);
    }
    return cells;
}

function cross(a: Position, b: Position, c: Position): number {
    return (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
}

function pointInTriangle(point: Position, a: Position, b: Position, c: Position): boolean {
    const epsilon = 1e-9;
    const d1 = cross(point, a, b);
    const d2 = cross(point, b, c);
    const d3 = cross(point, c, a);
    const hasNegative = d1 < -epsilon || d2 < -epsilon || d3 < -epsilon;
    const hasPositive = d1 > epsilon || d2 > epsilon || d3 > epsilon;
    return !(hasNegative && hasPositive);
}

function bresenhamLine(from: Position, to: Position): Position[] {
    const cells: Position[] = [];
    let [row, col] = from;
    const [targetRow, targetCol] = to;
    const rowDelta = Math.abs(targetRow - row);
    const colDelta = Math.abs(targetCol - col);
    const rowStep = row < targetRow ? 1 : -1;
    const colStep = col < targetCol ? 1 : -1;
    let error = rowDelta - colDelta;

    // 6×6 棋盘上两点间最多 6 步；上限只是防死循环的保险
    for (let guard = 0; guard <= BOARD_SIZE * BOARD_SIZE; guard++) {
        cells.push([row, col]);
        if (row === targetRow && col === targetCol) break;
        const doubled = error * 2;
        if (doubled > -colDelta) {
            error -= colDelta;
            row += rowStep;
        }
        if (doubled < rowDelta) {
            error += rowDelta;
            col += colStep;
        }
    }
    return cells;
}

function getCollinearTriangleCells(points: Position[]): Position[] {
    let farthest: [Position, Position] = [points[0], points[1]];
    let farthestDistance = -1;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const distance = Math.max(
                Math.abs(points[i][0] - points[j][0]),
                Math.abs(points[i][1] - points[j][1])
            );
            if (distance > farthestDistance) {
                farthestDistance = distance;
                farthest = [points[i], points[j]];
            }
        }
    }
    if (farthestDistance <= 0) return [[...points[0]] as Position];
    return bresenhamLine(farthest[0], farthest[1]);
}

/**
 * 三角区域：格心落在三角形内或边上即算命中。
 * 三点共线（含两把镖落同一格）时退化为这条线，避免整手打空。
 */
export function getShuangfeiyanTriangleCells(a: Position, b: Position, c: Position): Position[] {
    const area = cross(a, b, c);
    if (Math.abs(area) < 1e-9) {
        return getCollinearTriangleCells([a, b, c]);
    }

    const cells: Position[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const point: Position = [row, col];
            if (pointInTriangle(point, a, b, c)) cells.push(point);
        }
    }
    return cells;
}

/** 三角形面积的两倍（整数格点用）：0 表示三点共线，双飞燕的 AI 用它区分“撑开”与“压成一条线” */
export function getShuangfeiyanTriangleArea2(a: Position, b: Position, c: Position): number {
    return Math.abs(cross(a, b, c));
}

export function chebyshevDistance(a: Position, b: Position): number {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** 落一把镖：槽位取第一把还没在场上飞的；她的出手序号决定返航时机 */
export function placeShuangfeiyanBoomerang(
    state: GameState,
    hero: Hero,
    to: Position
): BoardEffect | null {
    const usedSlots = new Set(
        getShuangfeiyanBoomerangs(state, hero).map(effect => effect.boomerangSlot ?? -1)
    );
    const slot = [0, 1].find(candidate => !usedSlots.has(candidate));
    if (slot === undefined) return null;

    const effect: BoardEffect = {
        id: `${hero.id}-boomerang-${slot}`,
        type: 'boomerang',
        position: [...to] as Position,
        owner: hero.owner,
        sourceHeroId: hero.id,
        duration: 99,
        boomerangSlot: slot,
        // 现在还没把这次出手记进 sfy_skillSerial：本次是第 n+1 手，
        // “下下次出手”结束后是第 n+3 手，故存当前序号 + 3。
        returnAtSkillSerial: (hero.counters['sfy_skillSerial'] ?? 0) + 3,
    };
    state.boardEffects = [...(state.boardEffects ?? []), effect];
    return effect;
}

export function removeShuangfeiyanBoomerangAt(
    state: GameState,
    hero: Hero,
    position: Position
): BoardEffect | null {
    const effect = getShuangfeiyanBoomerangs(state, hero)
        .find(candidate => samePosition(candidate.position, position));
    if (!effect) return null;
    removeShuangfeiyanBoomerang(state, effect.id);
    return effect;
}

export function removeShuangfeiyanBoomerang(state: GameState, effectId: string): void {
    state.boardEffects = (state.boardEffects ?? []).filter(effect => effect.id !== effectId);
}

/** 阵亡/暂时离场时把两把镖一并抹掉，并清掉双出手记账 */
export function clearShuangfeiyanBoomerangState(hero: Hero, state: GameState): void {
    state.boardEffects = (state.boardEffects ?? []).filter(
        effect => !(effect.type === 'boomerang' && effect.sourceHeroId === hero.id)
    );
    hero.counters['sfy_skillSerial'] = 0;
    delete hero.counters['sfy_second_queued'];
    delete hero.counters['__sfy_self_extra'];
    delete hero.counters['sfy_extra_skill_only'];
}
