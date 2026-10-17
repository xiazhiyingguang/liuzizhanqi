import { CHAIN_MARK_DURATION, CHAIN_MARK_NAME } from './chain-lightning';
import { DamageCalculator } from './damage-calculator';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import { zhizhiValue } from './hero-zhizhi';
import { requestSkillFx } from '../data/extended-skills';
import {
    BOARD_SIZE,
    HeroState,
    type BoardEffect,
    type GameState,
    type Hero,
    type Player,
    type Position,
} from '../types/game';

/**
 * 云岫「雷云 / 引雷针 / 霆息 / 麻痹」的收口。
 *
 * 她的打法是布雨而不是追人：雷云是自己会挪窝的场地物，引雷针是一次性的风向标。
 * 口径（2026-10-15 与用户逐条确认）：
 * - **落云当拍先炸一次**，此后每回合开始**先移动一格、再炸一次**（移动在前、落在后，
 *   所以"云压到你头上"这件事永远比伤害晚半拍，看得见也躲得掉）；
 * - 每阵营独立 3 团，第 4 团挤掉自己最旧的那团（与姜太公鱼钩同一口径）；
 * - 随机移动只在**盘内的 8 个方向**里摇，贴边时不会飘出棋盘；
 * - 引雷针**只生效一次**：落针后的那一次移动，她名下所有雷云都改朝针走一格（不再随机），
 *   拉完这一拍针就消失。场上没有她的云时针原地等着，最多留 3 回合；
 * - 雷云打中的敌人若带「链式闪电」（霆渊钉的印），把那条印的回合数**续回 2 回合**——
 *   她不改传导规则、不自己引爆，只替队友把链子养着；
 * - 霆息按"被云打中的敌人数"叠，封顶 5 层，每层 +1 移动力与 5% 防御。
 *
 * 云的寿命自己管（像上官婉儿的毛笔那样豁免通用回合衰减）：`duration` 记的是"还剩几次移动+落雷"，
 * 这样"存在 3 回合"在画面上就是清清楚楚的三拍雷。
 */

export const CLOUD_TYPE = 'thunder-cloud';
export const ROD_TYPE = 'lightning-rod';
/** 落雷次数：每回合开始一次，共 3 拍。致知三策划案留白，所以这里没有第二档 */
export const CLOUD_STRIKES = 3;
export const CLOUD_DAMAGE = 4;
export const CLOUD_DAMAGE_TALENT = 5;
/** 半径 1 = 3×3 */
export const CLOUD_RADIUS = 1;
export const CLOUD_MAX = 3;
/** 引雷针没人可拉时的兜底寿命（回合） */
export const ROD_DURATION = 3;
export const ROD_DAMAGE = 6;
export const PARALYSIS_NAME = '麻痹';
export const PARALYSIS_DURATION = 1;
export const TINGXI_COUNTER = '霆息';
export const TINGXI_MAX = 5;
export const TINGXI_MOVE_PER_LAYER = 1;
export const TINGXI_DEFENSE_PER_LAYER = 0.05;
/** 被动与雷云共用的特效档案 id（不是技能，走 requestSkillFx） */
export const CLOUD_FX_ID = 'yunxiu_cloud';

/** 云能挪去的八个方向（电脑估"挪一格之后最狠的那一格"也用它，别在它那边另抄一份） */
export const CLOUD_DRIFT_OFFSETS: Array<[number, number]> = [
    [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];

const EIGHT_DIRECTIONS = CLOUD_DRIFT_OFFSETS;

let cloudSeq = 0;
let rodSeq = 0;

function inBounds(cell: Position): boolean {
    return cell[0] >= 0 && cell[0] < BOARD_SIZE && cell[1] >= 0 && cell[1] < BOARD_SIZE;
}

function findHero(gameState: GameState, heroId: string): Hero | undefined {
    return [...gameState.player1Heroes, ...gameState.player2Heroes].find(hero => hero.id === heroId);
}

/** 雷云覆盖的格子：以云心为圆心的 3×3，出界部分不算 */
export function cloudCells(cloud: BoardEffect): Position[] {
    return MovementSystem.getBoxPositions(cloud.position, CLOUD_RADIUS * 2 + 1).filter(inBounds);
}

export function cloudsOf(gameState: GameState, owner: Hero['owner']): BoardEffect[] {
    return (gameState.boardEffects ?? []).filter(effect => effect.type === CLOUD_TYPE && effect.owner === owner);
}

export function rodsOf(gameState: GameState, owner: Hero['owner']): BoardEffect[] {
    return (gameState.boardEffects ?? []).filter(effect => effect.type === ROD_TYPE && effect.owner === owner);
}

/** 这一格是否被这团云压住（覆盖窗口与结算共用一份口径，别在渲染层另算一遍） */
export function cloudCovers(cloud: BoardEffect, row: number, col: number): boolean {
    return Math.abs(row - cloud.position[0]) <= CLOUD_RADIUS &&
        Math.abs(col - cloud.position[1]) <= CLOUD_RADIUS;
}

/** 云压着谁：范围内存活的敌方单位（云的归属看铺设方阵营，不是看云心站了谁） */
export function cloudVictims(gameState: GameState, cloud: BoardEffect): Hero[] {
    return cloudCells(cloud).flatMap(cell => {
        const occupant = gameState.board[cell[0]][cell[1]];
        return occupant && occupant.owner !== cloud.owner && occupant.state === HeroState.ALIVE
            ? [occupant]
            : [];
    });
}

/**
 * 落一团云：同阵营最多 3 团，第 4 团挤掉最早的那团。
 * 云不占格、不挡路（与游龙同一口径），所以落点允许站着人。
 */
export function placeCloud(
    gameState: GameState,
    caster: Hero,
    center: Position,
    log: string[] = []
): BoardEffect | null {
    if (!inBounds(center)) return null;
    gameState.boardEffects ??= [];
    const owned = cloudsOf(gameState, caster.owner);
    while (owned.length >= CLOUD_MAX) {
        const oldest = owned.shift();
        if (oldest) {
            gameState.boardEffects = gameState.boardEffects.filter(effect => effect.id !== oldest.id);
            log.push(`${caster.name}名下第 4 团雷云挤散了最早的那团`);
        }
    }
    const cloud: BoardEffect = {
        id: `${CLOUD_TYPE}-${caster.id}-${Date.now()}-${cloudSeq++}`,
        type: CLOUD_TYPE,
        position: [center[0], center[1]],
        owner: caster.owner,
        sourceHeroId: caster.id,
        duration: CLOUD_STRIKES,
        radius: CLOUD_RADIUS,
    };
    gameState.boardEffects.push(cloud);
    return cloud;
}

/** 放一枚引雷针：同格重复投放只刷新，等着下一次云移动时被消耗 */
export function placeRod(gameState: GameState, caster: Hero, cell: Position): BoardEffect {
    gameState.boardEffects ??= [];
    gameState.boardEffects = gameState.boardEffects.filter(effect =>
        !(effect.type === ROD_TYPE &&
            effect.owner === caster.owner &&
            effect.position[0] === cell[0] &&
            effect.position[1] === cell[1]));
    const rod: BoardEffect = {
        id: `${ROD_TYPE}-${caster.id}-${Date.now()}-${rodSeq++}`,
        type: ROD_TYPE,
        position: [cell[0], cell[1]],
        owner: caster.owner,
        sourceHeroId: caster.id,
        duration: ROD_DURATION,
    };
    gameState.boardEffects.push(rod);
    return rod;
}

/** 朝目标走一格：八向里同时收行列差，所以斜着也能贴过去 */
export function stepToward(from: Position, to: Position): Position {
    const cell: Position = [
        from[0] + Math.sign(to[0] - from[0]),
        from[1] + Math.sign(to[1] - from[1]),
    ];
    return inBounds(cell) ? cell : [...from] as Position;
}

/** 随机挪一格：只在盘内的方向里摇，贴边时那几格本来就去不了 */
export function randomCloudStep(from: Position): Position {
    const options = EIGHT_DIRECTIONS
        .map(([dr, dc]) => [from[0] + dr, from[1] + dc] as Position)
        .filter(inBounds);
    if (options.length === 0) return [...from] as Position;
    return options[Math.floor(Math.random() * options.length)];
}

/** 霆息层数（封顶 5，所以移动力最多从 2 涨到 7） */
export function tingxiLayers(hero: Hero): number {
    return Math.min(TINGXI_MAX, hero.counters[TINGXI_COUNTER] ?? 0);
}

/**
 * 叠一层霆息：顺手把 +1 移动力落到 `hero.moveRange` 上。
 * 记在属性而不是只读计数器，是因为棋盘高亮、电脑寻路、操作面板全都直接读 moveRange，
 * 只在一处加成的话"面板写着 5 格、实际走 6 格"这种裂缝迟早露。
 */
export function gainTingxi(hero: Hero): number {
    if (tingxiLayers(hero) >= TINGXI_MAX) return tingxiLayers(hero);
    EffectManager.addCounter(hero, TINGXI_COUNTER, TINGXI_MOVE_PER_LAYER);
    hero.moveRange += TINGXI_MOVE_PER_LAYER;
    return tingxiLayers(hero);
}

/** 霆息换算成的防御加成（在伤害结算里按层数现算，不占效果栏） */
export function tingxiDefenseRate(hero: Hero): number {
    if (hero.passiveId !== 'yunxiu_passive') return 0;
    return tingxiLayers(hero) * TINGXI_DEFENSE_PER_LAYER;
}

/** 被雷云打中且带着链式闪电的人：把印的回合数续回 2（只续时长，不改归属、不引爆） */
function refreshChainMarks(victim: Hero): boolean {
    let refreshed = false;
    for (const effect of victim.effects) {
        if (effect.name !== CHAIN_MARK_NAME) continue;
        effect.duration = CHAIN_MARK_DURATION;
        refreshed = true;
    }
    return refreshed;
}

/**
 * 一团云落一次雷：范围内每个敌人各吃一发，打中谁就给云岫叠一层霆息，
 * 顺带把被打中者身上的链式闪电续回 2 回合。整团算一次出手（和声/吸血只结一次）。
 */
export function strikeCloud(gameState: GameState, cloud: BoardEffect, log: string[]): number {
    const caster = findHero(gameState, cloud.sourceHeroId);
    if (!caster || caster.state !== HeroState.ALIVE) return 0;
    const victims = cloudVictims(gameState, cloud);
    if (victims.length === 0) return 0;
    const amount = zhizhiValue(caster, 2, CLOUD_DAMAGE, CLOUD_DAMAGE_TALENT);
    let hits = 0;
    let chained = 0;
    DamageCalculator.asOneAttack(() => {
        for (const victim of victims) {
            if (victim.state !== HeroState.ALIVE) continue;
            const damage = DamageCalculator.calculate(caster, victim, amount, false);
            DamageCalculator.applyDamage(victim, damage, caster, gameState, true);
            if (damage.finalDamage <= 0) continue;
            hits++;
            gainTingxi(caster);
            if (refreshChainMarks(victim)) chained++;
        }
    });
    if (hits > 0) {
        log.push(`${caster.name}的雷云劈中${hits}名敌人，造成${amount}点伤害`);
        if (chained > 0) log.push(`雷云续上${chained}条「链式闪电」，霆渊的链子又活了`);
        log.push(`${caster.name}霆息叠至${tingxiLayers(caster)}层`);
    }
    return hits;
}

/** 一团云的一拍：先挪一格（有针就朝针走），再落一次雷，寿命耗尽即散 */
function tickCloud(
    gameState: GameState,
    cloud: BoardEffect,
    rods: BoardEffect[],
    log: string[],
    expired: string[]
): void {
    const before = [...cloud.position] as Position;
    if (rods.length > 0) {
        const anchor = nearestRod(cloud.position, rods);
        cloud.position = stepToward(before, anchor.position);
    } else {
        cloud.position = randomCloudStep(before);
    }
    cloud.duration = (cloud.duration ?? 0) - 1;
    // 雷落下的格要在结算之前抄下来：被这一拍劈死的人已经不是"存活敌人"，
    // 结算之后再问"云压着谁"就会把那一格的雷光一起弄丢
    const struckCells = cloudVictims(gameState, cloud)
        .map(victim => [...victim.position!] as Position);
    const logsBefore = new Set(gameState.battleLog.map(entry => entry.id));
    const hits = strikeCloud(gameState, cloud, log);
    const logIds = gameState.battleLog.filter(entry => !logsBefore.has(entry.id)).map(entry => entry.id);
    requestCloudFx(gameState, cloud, before, struckCells, hits, logIds);
    if ((cloud.duration ?? 0) <= 0) {
        expired.push(cloud.id);
        log.push(`${cloud.owner === 'player1' ? '我方' : '敌方'}的一团雷云散尽`);
    }
}

function nearestRod(from: Position, rods: BoardEffect[]): BoardEffect {
    return rods.reduce((best, rod) => {
        const span = (cell: Position) =>
            Math.max(Math.abs(cell[0] - from[0]), Math.abs(cell[1] - from[1]));
        return span(rod.position) < span(best.position) ? rod : best;
    }, rods[0]);
}

/**
 * 雷云整团移动，落雷事件只给一张区域 SVG 提供这次被攻击的位置。
 */
function requestCloudFx(
    gameState: GameState,
    cloud: BoardEffect,
    fromPos: Position,
    struckCells: Position[],
    hits: number,
    logIds: string[]
): void {
    requestSkillFx({
        skillId: CLOUD_FX_ID,
        owner: cloud.owner,
        sourceHeroId: cloud.sourceHeroId,
        logIds,
        fromPos: [...fromPos] as Position,
        targetPos: [...cloud.position] as Position,
        impactPositions: struckCells,
        coveredPositions: hits > 0 ? struckCells : [],
    }, gameState);
}

/**
 * 回合开始：这名云岫名下所有雷云各挪一格并落一次雷，随后引雷针作废。
 * 挂在 GameEngine 的回合开始里，所以"这一轮谁都没出手"也照样打雷。
 */
export function tickCloudsAtRoundStart(gameState: GameState, caster: Hero): string[] {
    const clouds = cloudsOf(gameState, caster.owner);
    if (clouds.length === 0) return [];
    const rods = rodsOf(gameState, caster.owner);
    const log: string[] = [];
    const expired: string[] = [];
    for (const cloud of clouds) {
        tickCloud(gameState, cloud, rods, log, expired);
    }
    const spent = [...expired, ...rods.map(rod => rod.id)];
    if (spent.length > 0) {
        gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => !spent.includes(effect.id));
    }
    return log;
}

/** 「麻痹」：这一回合内无法触发天威。收口在 DamageCalculator.triggerTianwei */
export function applyParalysis(target: Hero, sourceHeroId: string): void {
    EffectManager.addEffect(target, {
        type: 'debuff',
        name: PARALYSIS_NAME,
        duration: PARALYSIS_DURATION,
        sourceHeroId,
        description: '雷气锁住经脉：本回合无法触发天威',
    });
}

export function isParalyzed(hero: Hero): boolean {
    return hero.effects.some(effect => effect.name === PARALYSIS_NAME);
}

/** 云岫技能一的可落点：自身两格十字范围内（上下左右各 1~2 格，共 8 格） */
export function cloudAnchorCellsFrom(from: Position): Position[] {
    const cells: Position[] = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
        for (let step = 1; step <= 2; step++) {
            const cell: Position = [from[0] + dr * step, from[1] + dc * step];
            if (inBounds(cell)) cells.push(cell);
        }
    }
    return cells;
}

/** 以某一格为云心时，这片 3×3 会压住几名敌人（电脑选点与站位都读这个） */
export function cloudVictimCountAt(gameState: GameState, owner: Player, center: Position): number {
    let count = 0;
    for (let dr = -CLOUD_RADIUS; dr <= CLOUD_RADIUS; dr++) {
        for (let dc = -CLOUD_RADIUS; dc <= CLOUD_RADIUS; dc++) {
            const row = center[0] + dr;
            const col = center[1] + dc;
            if (!inBounds([row, col])) continue;
            const occupant = gameState.board[row][col];
            if (occupant && occupant.owner !== owner && occupant.state === HeroState.ALIVE) count++;
        }
    }
    return count;
}

/** 站在某一格时，她下一团云最多能压住几个人 */
export function bestCloudAnchorCover(gameState: GameState, caster: Hero, from: Position): number {
    return cloudAnchorCellsFrom(from).reduce(
        (max, cell) => Math.max(max, cloudVictimCountAt(gameState, caster.owner, cell)), 0);
}

/** 云岫技能一的可落点：自身两格十字范围内（上下左右各 1~2 格，共 8 格） */
export function cloudAnchorCells(caster: Hero): Position[] {
    return caster.position ? cloudAnchorCellsFrom(caster.position) : [];
}

/** 云岫技能二的可打目标格：自身 5×5 范围内站着敌人的格 */
export function rodTargetCells(gameState: GameState, caster: Hero): Position[] {
    if (!caster.position) return [];
    return MovementSystem.getBoxPositions(caster.position, 5)
        .filter(cell => {
            const occupant = gameState.board[cell[0]][cell[1]];
            return !!occupant && occupant.owner !== caster.owner && occupant.state === HeroState.ALIVE;
        });
}
