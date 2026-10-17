import { EffectManager } from './effect-manager';
import { GameState, Hero, HeroState } from '../types/game';

/**
 * 霆渊的两枚雷印。
 * 口径（2026-10-14 与用户确认）：
 * - 链式闪电**不是全局被动**，只有技能自报"可触发链式闪电"的那些技能才引爆，以后新技能会逐条写明；
 * - 只认霆渊自己的手，队友打带链的人不会连锁；
 * - 只跳一层：传导出去的伤不再引发新一轮传导；
 * - 技能一"先打完再挂"，那一记本身不带传导。
 */
export const THUNDER_MARK_NAME = '引雷印';
export const CHAIN_MARK_NAME = '链式闪电';
export const THUNDER_MARK_DURATION = 3;
export const CHAIN_MARK_DURATION = 2;
export const TINGYUAN_HIT_DAMAGE = 10;

function enemiesOf(gameState: GameState, caster: Hero): Hero[] {
    const pool = caster.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
    return pool.filter(hero => hero.state === HeroState.ALIVE && hero.position);
}

/** 引雷印/链式闪电都是"可刷新、不可叠加"：先摘掉自己这一枚旧的，再挂新的 */
function refreshMark(target: Hero, name: string, duration: number, casterId: string, description: string): void {
    target.effects = target.effects.filter(effect =>
        !(effect.name === name && effect.sourceHeroId === casterId));
    EffectManager.addEffect(target, {
        type: 'mark',
        name,
        duration,
        sourceHeroId: casterId,
        description,
    });
}

export function applyThunderMark(target: Hero, casterId: string): void {
    refreshMark(target, THUNDER_MARK_NAME, THUNDER_MARK_DURATION, casterId,
        '被霆渊引上雷，3回合内会被「万雷朝宗」点中');
}

export function applyChainMark(target: Hero, casterId: string): void {
    refreshMark(target, CHAIN_MARK_NAME, CHAIN_MARK_DURATION, casterId,
        '霆渊对其造成伤害时，其余带链者各吃一份传导伤害');
}

function markedWith(gameState: GameState, caster: Hero, name: string): Hero[] {
    return enemiesOf(gameState, caster).filter(hero =>
        hero.effects.some(effect => effect.name === name && effect.sourceHeroId === caster.id));
}

/** 技能二的靶子 */
export function thunderMarkedEnemies(gameState: GameState, caster: Hero): Hero[] {
    return markedWith(gameState, caster, THUNDER_MARK_NAME);
}

/** 传导的落点集合：只在这些单位之间跳 */
export function chainMarkedEnemies(gameState: GameState, caster: Hero): Hero[] {
    return markedWith(gameState, caster, CHAIN_MARK_NAME);
}

export function hasThunderMark(hero: Hero, casterId: string): boolean {
    return hero.effects.some(effect => effect.name === THUNDER_MARK_NAME && effect.sourceHeroId === casterId);
}

export function hasChainMark(hero: Hero, casterId: string): boolean {
    return hero.effects.some(effect => effect.name === CHAIN_MARK_NAME && effect.sourceHeroId === casterId);
}

/** 传导伤害＝1 + 本次攻击命中的引雷印数量：攒得越满，一跳越疼 */
export function chainDamageFor(markCount: number): number {
    return 1 + markCount;
}
