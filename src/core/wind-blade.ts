import { BoardEffect, GameState, Hero, HeroState, Position } from '../types/game';
import { DamageCalculator } from './damage-calculator';
import { getWindLanes, windLaneAxis } from './wind-lane';

/**
 * 游隼「风刃」体系：
 * - 技能2把风刃留在周围一格的上、下、左、右四个位置上（友军所在格照样留刃），
 *   持续 3 回合，只有棋盘外的方向放不下（并非抛出飞行）；
 * - 敌人一旦接触（踏入风刃格，或释放时就站在相邻格）受到固定伤害，风刃随即消失；
 * - 游隼自己经过/抵达风刃格时将其收回，收回会刷新技能1「疾掠」（每回合最多一次）。
 */

export const WIND_BLADE_DAMAGE = 4;
export const WIND_BLADE_DURATION = 3;
const NORMAL_DASH_DISTANCE = 3;
const LANE_DASH_DISTANCE = 5;

export function findWindBladeAt(gameState: GameState, position: Position): BoardEffect | undefined {
    const [row, col] = position;
    return (gameState.boardEffects ?? []).find(
        effect =>
            effect.type === 'wind-blade' &&
            effect.position[0] === row &&
            effect.position[1] === col
    );
}

/** 风刃 id 自增序号：同一毫秒内放出多道风刃时保证 id 唯一 */
let windBladeSeq = 0;

/** 风刃朝向：由游隼所在格指向刃所在格（四邻必有一轴相差 1），常驻图标据此让刃尖朝外 */
function bladeFacing(from: Position | null, cell: Position): 'up' | 'down' | 'left' | 'right' {
    if (!from) return 'up';
    if (cell[0] < from[0]) return 'up';
    if (cell[0] > from[0]) return 'down';
    return cell[1] > from[1] ? 'right' : 'left';
}

/** 在指定格铺设一道游隼的风刃（允许与友军同格；同格已有的自己风刃会被替换） */
export function placeWindBlade(gameState: GameState, caster: Hero, position: Position): void {
    gameState.boardEffects ??= [];
    gameState.boardEffects = gameState.boardEffects.filter(
        effect =>
            !(effect.type === 'wind-blade' &&
                effect.sourceHeroId === caster.id &&
                effect.position[0] === position[0] &&
                effect.position[1] === position[1])
    );
    gameState.boardEffects.push({
        id: `wind-blade-${caster.id}-${Date.now()}-${windBladeSeq++}`,
        type: 'wind-blade',
        position: [position[0], position[1]],
        owner: caster.owner,
        sourceHeroId: caster.id,
        duration: WIND_BLADE_DURATION,
        direction: bladeFacing(caster.position, position),
    });
}

/**
 * 游隼经过这些格子时收回自己的风刃。
 * 每回合第一次收回会刷新疾掠（youjun_skill1_refreshed），
 * 次数由 youjun_blade_refresh_used 限制，回合开始时重置。
 */
export function retractWindBladesOnCells(youjun: Hero, cells: Position[], gameState: GameState): number {
    if (youjun.state !== HeroState.ALIVE || cells.length === 0) return 0;
    const cellKeys = new Set(cells.map(([row, col]) => `${row},${col}`));
    const blades = (gameState.boardEffects ?? []).filter(
        effect =>
            effect.type === 'wind-blade' &&
            effect.sourceHeroId === youjun.id &&
            cellKeys.has(`${effect.position[0]},${effect.position[1]}`)
    );
    if (blades.length === 0) return 0;

    // blades 是 boardEffects 数组内的对象引用，直接按引用移除最稳妥
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(
        effect => !blades.includes(effect)
    );

    const canRefresh = youjun.counters['youjun_blade_refresh_used'] !== 1;
    if (canRefresh) {
        youjun.counters['youjun_blade_refresh_used'] = 1;
        youjun.counters['youjun_skill1_refreshed'] = 1;
    }
    gameState.battleLog?.push({
        id: `log-${Date.now()}-${Math.random()}`,
        type: 'passive' as const,
        player: youjun.owner,
        message: canRefresh
            ? `${youjun.name}收回${blades.length}道风刃，疾掠已刷新，可再次发起冲锋！`
            : `${youjun.name}收回${blades.length}道风刃`,
        timestamp: Date.now(),
    });
    return blades.length;
}

/**
 * 单位进入风刃格的结算：
 * - 风刃主人的游隼自己进入 → 收回风刃（刷新疾掠）；
 * - 敌方单位进入 → 受到 4 点不可规避、无视护盾的固定伤害，风刃随即消失（一次性触发）；
 * - 友方单位进入无任何效果。
 */
export function processWindBladeEntry(mover: Hero, cell: Position, gameState: GameState): void {
    if (mover.state !== HeroState.ALIVE) return;
    const blade = findWindBladeAt(gameState, cell);
    if (!blade) return;

    if (blade.sourceHeroId === mover.id && mover.passiveId === 'youjun_passive') {
        retractWindBladesOnCells(mover, [cell], gameState);
        return;
    }
    if (mover.owner === blade.owner) return;

    const source = [...gameState.player1Heroes, ...gameState.player2Heroes].find(
        hero => hero.id === blade.sourceHeroId
    );
    if (!source || source.state !== HeroState.ALIVE) return;

    // 接触即消耗：先移除风刃，再结算伤害，命中后不会在同一格留下可反复触发的刃
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => effect.id !== blade.id);

    const result = DamageCalculator.calculate(
        source,
        mover,
        WIND_BLADE_DAMAGE,
        false,
        true,
        { fixedDamage: true, canCrit: false }
    );
    DamageCalculator.applyDamage(mover, result, source, gameState);
    if (gameState.battleLog) {
        gameState.battleLog.push({
            id: `log-${Date.now()}-${Math.random()}`,
            type: 'damage' as const,
            player: source.owner,
            message: `${mover.name}踏入风刃，受到${result.finalDamage}点伤害`,
            timestamp: Date.now(),
        });
    }
}

/** 疾掠在该方向的最大冲刺距离：常规 3 格；起点处于同轴友方风道上时可冲刺整行/整列 */
export function youjunDashMaxDistance(
    gameState: GameState,
    caster: Hero,
    direction: 'up' | 'down' | 'left' | 'right'
): number {
    if (!caster.position) return NORMAL_DASH_DISTANCE;
    const [row, col] = caster.position;
    const dashAxis: 'row' | 'col' = direction === 'up' || direction === 'down' ? 'col' : 'row';
    const boost = getWindLanes(gameState).some(lane =>
        lane.owner === caster.owner &&
        lane.direction &&
        windLaneAxis(lane.direction) === dashAxis &&
        lane.position[0] === row &&
        lane.position[1] === col
    );
    return boost ? LANE_DASH_DISTANCE : NORMAL_DASH_DISTANCE;
}
