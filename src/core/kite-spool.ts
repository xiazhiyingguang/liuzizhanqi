import { nextBattleLogId } from './battle-log-id';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import { zhizhiValue } from './hero-zhizhi';
import { addDilanFeather } from '../data/extended-heroes';
import { BOARD_SIZE, HeroState, type GameState, type Hero, type Position } from '../types/game';

/**
 * 纸鸢「线轴 / 击飞 / 牵丝追击 / 引线天威」的收口。
 *
 * 线轴是挂在敌人身上的永久标记（与回锋的连破同类）：追击时放线，纸鸢自己收线才值钱——
 * 技能1按人头收（附带线轴飞回轨迹的刮擦伤），技能2把全场线轴一次性烧掉换连击。
 * 所有"谁身上有几层"的读写都走本模块，别在技能里散落 effects.find。
 */

export const ZHIYUAN_SPOOL_NAME = '线轴';
/** 单人线轴上限：技能1单体最高 4+5×2=14，避免无限堆叠 */
export const ZHIYUAN_SPOOL_MAX = 5;
/** 技能1本体伤害与轨迹刮擦伤 */
export const ZHIYUAN_REEL_BASE = 4;
export const ZHIYUAN_PATH_BASE = 2;
/** 技能2连击：每 3 层线轴一次，最多 4 次，每次 6 点（致知2 抬到 7） */
export const ZHIYUAN_COMBO_PER_STACKS = 3;
export const ZHIYUAN_COMBO_MAX = 4;
export const ZHIYUAN_COMBO_DAMAGE = 6;
/** 被动追击伤害（致知3 抬到 5） */
export const ZHIYUAN_PURSUE_DAMAGE = 4;
/** 每出手 3 次，下一击附带击飞 */
export const ZHIYUAN_KNOCKUP_EVERY = 3;

const ATTACK_COUNT_KEY = '__zhiyuan_attacks';
export const PURSUE_GUARD_KEY = '__zhiyuan_pursuing';
const TIANWEI_MARK_KEY = '__zhiyuan_lead';

/** 是纸鸢本人且还在场（被动与天威的归属判定都走这里） */
export function isZhiyuan(hero: Hero | null | undefined): hero is Hero {
    return !!hero && hero.passiveId === 'zhiyuan_passive' && hero.state === HeroState.ALIVE;
}

/** 敌人身上的线轴层数（只认这名纸鸢放的线） */
export function getSpoolStacks(target: Hero, sourceHeroId?: string): number {
    const effect = target.effects.find(entry => entry.name === ZHIYUAN_SPOOL_NAME
        && (!sourceHeroId || entry.sourceHeroId === sourceHeroId));
    return Math.min(ZHIYUAN_SPOOL_MAX, effect?.stackCount ?? 0);
}

/** 放线：叠 1 层线轴，封顶 ZHIYUAN_SPOOL_MAX */
export function addSpool(target: Hero, caster: Hero): number {
    if (target.state !== HeroState.ALIVE) return 0;
    const stacks = Math.min(ZHIYUAN_SPOOL_MAX, getSpoolStacks(target, caster.id) + 1);
    removeSpools(target, caster.id);
    EffectManager.addEffect(target, {
        type: 'mark',
        name: ZHIYUAN_SPOOL_NAME,
        duration: -1,
        stackCount: stacks,
        sourceHeroId: caster.id,
        description: '纸鸢牵住的线：被收线时按层数结算伤害',
    });
    return stacks;
}

/** 收线：摘掉这个敌人身上的线轴，返回摘掉的层数 */
export function removeSpools(target: Hero, sourceHeroId: string): number {
    const stacks = getSpoolStacks(target, sourceHeroId);
    if (stacks > 0) {
        target.effects = target.effects.filter(entry =>
            !(entry.name === ZHIYUAN_SPOOL_NAME && entry.sourceHeroId === sourceHeroId));
    }
    return stacks;
}

/** 场上带线轴的敌方角色（只认这名纸鸢放的线） */
export function spoolBearingEnemies(state: GameState, caster: Hero): Hero[] {
    return [...state.player1Heroes, ...state.player2Heroes].filter(hero =>
        hero.owner !== caster.owner && hero.state === HeroState.ALIVE && hero.position
        && getSpoolStacks(hero, caster.id) > 0);
}

/**
 * 线轴飞回纸鸢的直线轨迹：标准 Bresenham，返回沿途格子（不含放线的敌人与纸鸢所在格）。
 * 两点间按主轴步进、误差项修正次轴，轨迹看起来才真是一条线，而不是先横再竖的折角。
 */
export function spoolTravelCells(from: Position, to: Position): Position[] {
    const cells: Position[] = [];
    const dr = Math.abs(to[0] - from[0]);
    const dc = Math.abs(to[1] - from[1]);
    const sr = Math.sign(to[0] - from[0]);
    const sc = Math.sign(to[1] - from[1]);
    let row = from[0];
    let col = from[1];
    let err = dr - dc;
    let guard = 0;
    while ((row !== to[0] || col !== to[1]) && guard++ < BOARD_SIZE * 2) {
        if (2 * err > -dc) { row += sr; err -= dc; }
        if (2 * err < dr) { col += sc; err += dr; }
        const cell: Position = [row, col];
        if (!MovementSystem.inBounds(cell)) break;
        if (row === to[0] && col === to[1]) break;   // 终点是纸鸢自己脚下，不算"途中"
        cells.push(cell);
    }
    return cells;
}

/** 这一击是否附带击飞：每满 3 次出手后的下一击 */
export function zhiyuanKnockUpArmed(hero: Hero): boolean {
    const attacks = hero.counters[ATTACK_COUNT_KEY] ?? 0;
    return attacks > 0 && attacks % ZHIYUAN_KNOCKUP_EVERY === 0;
}

/** 一次出手结束：累计纸鸢的出手次数（普攻、技能段、追击都算一次） */
export function noteZhiyuanAttack(hero: Hero): void {
    hero.counters[ATTACK_COUNT_KEY] = (hero.counters[ATTACK_COUNT_KEY] ?? 0) + 1;
}

/**
 * 击飞：本回合还没行动过的敌人被这一击打中，就直接被挑起来（跳过其行动）。
 * 已经动过的人再晕没有意义，所以只在他未行动时生效——这是纸鸢的控制价值所在。
 */
export function applyZhiyuanKnockUp(target: Hero, caster: Hero, gameState: GameState): boolean {
    if (target.state !== HeroState.ALIVE || target.hasActedThisTurn) return false;
    if (target.effects.some(effect => effect.type === 'stun' && effect.duration > 0)) return false;
    EffectManager.addEffect(target, {
        type: 'stun',
        name: '击飞',
        duration: 1,
        sourceHeroId: caster.id,
        description: '被纸鸢挑上线，本回合无法行动',
    });
    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'effect',
        player: caster.owner,
        message: `${caster.name}击飞了${target.name}，她本回合无法行动`,
        timestamp: Date.now(),
    });
    return true;
}

/** 追击伤害：致知3 把 4 抬到 5 */
export function zhiyuanPursueDamage(hero: Hero): number {
    return zhizhiValue(hero, 3, ZHIYUAN_PURSUE_DAMAGE, ZHIYUAN_PURSUE_DAMAGE + 1);
}

/** 连击伤害：致知2 把 6 抬到 7 */
export function zhiyuanComboDamage(hero: Hero): number {
    return zhizhiValue(hero, 2, ZHIYUAN_COMBO_DAMAGE, ZHIYUAN_COMBO_DAMAGE + 1);
}

/**
 * 被动「牵丝」：友方一次出手结束后，纸鸢追出一击。
 * 打中过的人里随机取一个（单体攻击就只有一个，即"直接追击"）；
 * 目标全死了就从场上存活敌人里补一个，保证线不断。追击本身由调用方加守卫，不再触发追击。
 */
export function pickZhiyuanPursueTarget(kite: Hero, hits: Hero[], state: GameState): Hero | null {
    const alive = hits.filter(hero => hero.state === HeroState.ALIVE && hero.position);
    const pool = alive.length > 0 ? alive
        : [...state.player1Heroes, ...state.player2Heroes].filter(hero =>
            hero.owner !== kite.owner && hero.state === HeroState.ALIVE && hero.position);
    if (pool.length === 0) return null;
    return pool.length === 1 ? pool[0] : pool[Math.floor(Math.random() * pool.length)];
}

/** 收线时给被攻击到的敌人补一层羽化：纸鸢的线会把人"吹"起来，与帝兰的羽化同一套账 */
export function zhiyuanFeather(target: Hero, kite: Hero): void {
    if (target.state !== HeroState.ALIVE) return;
    addDilanFeather(target, kite, 1);
}

/** 天威「纸鸢引线」：挂上"下一个出手的我方角色行动结束后触发其自身天威"的标记 */
export function armZhiyuanTianweiLead(kite: Hero, state: GameState): void {
    kite.counters[TIANWEI_MARK_KEY] = 1;
    state.battleLog.push({
        id: nextBattleLogId(),
        type: 'tianwei',
        player: kite.owner,
        message: `${kite.name}天威·纸鸢引线：下一个出手的我方角色收线时响起他自己的天威`,
        timestamp: Date.now(),
    });
}

/**
 * 队友行动结束时消费引线标记。
 * 纸鸢本人不算"下一个出手的人"（她的天威多半就在自己这一刀里触发），
 * 没有天威的队友也不消费，标记继续往后传。
 */
export function consumeZhiyuanTianweiLead(actor: Hero, state: GameState): Hero | null {
    const kite = [...state.player1Heroes, ...state.player2Heroes].find(hero =>
        isZhiyuan(hero) && (hero.counters[TIANWEI_MARK_KEY] ?? 0) > 0 && hero.id !== actor.id);
    if (!kite) return null;
    if (actor.owner !== kite.owner || actor.state !== HeroState.ALIVE || !actor.tianweiId) return null;
    kite.counters[TIANWEI_MARK_KEY] = 0;
    return kite;
}
