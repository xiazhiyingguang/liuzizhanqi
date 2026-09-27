import type { BattleStatistics, GameState, Hero } from '../types/game';

const EMPTY_STATISTICS: Readonly<BattleStatistics> = {
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    shieldAbsorbed: 0,
    kills: 0,
};

function sourceHeroId(hero: Hero): string {
    const parts = hero.id.split('|');
    if ((parts[0] === 'wukong-clone' || parts[0] === 'mirror-clone') && parts[1]) {
        return parts[1];
    }
    if (parts[0] === 't-summon' && parts[2]) return parts[2];
    return hero.id;
}

function ensureStatistics(gameState: GameState, hero: Hero): BattleStatistics {
    gameState.battleStatistics ??= {};
    const heroId = sourceHeroId(hero);
    gameState.battleStatistics[heroId] ??= { ...EMPTY_STATISTICS };
    return gameState.battleStatistics[heroId];
}

export function getHeroBattleStatistics(gameState: GameState, hero: Hero): BattleStatistics {
    return gameState.battleStatistics?.[sourceHeroId(hero)] ?? { ...EMPTY_STATISTICS };
}

export function recordBattleDamage(
    gameState: GameState,
    attacker: Hero,
    target: Hero,
    hpDamage: number,
    shieldDamage = 0
): void {
    const appliedHpDamage = Math.max(0, Math.floor(hpDamage));
    const appliedShieldDamage = Math.max(0, Math.floor(shieldDamage));
    const appliedDamage = appliedHpDamage + appliedShieldDamage;
    if (appliedDamage <= 0) return;

    ensureStatistics(gameState, attacker).damageDealt += appliedDamage;
    const targetStatistics = ensureStatistics(gameState, target);
    targetStatistics.damageTaken += appliedDamage;
    targetStatistics.shieldAbsorbed += appliedShieldDamage;
}

export function recordBattleHealing(
    gameState: GameState,
    healer: Hero,
    healed: number
): void {
    const actualHealing = Math.max(0, Math.floor(healed));
    if (actualHealing <= 0) return;
    ensureStatistics(gameState, healer).healingDone += actualHealing;
}

/**
 * "算不算一名角色"的唯一口径：召唤物与分身都是临时战术单位，不是名册上的英雄。
 * 天威的击杀判定、全灭判定、替补编制计数都必须走这里，否则各条链会各自漏一类单位。
 * 镜花的替身不算在内——那是候补席上那名英雄的本体，杀掉他就是杀掉一个角色。
 */
export function isRealCharacterHero(hero: Hero): boolean {
    return hero.counters?.['__isClone'] !== 1 &&
        hero.counters?.['__isSummon'] !== 1 &&
        !hero.id.startsWith('wukong-clone|') &&
        !hero.id.startsWith('mirror-clone|') &&
        !hero.id.startsWith('t-summon|');
}

export function recordBattleKill(gameState: GameState, killer: Hero, target?: Hero): void {
    ensureStatistics(gameState, killer).kills += 1;
    if (target && isRealCharacterHero(target)) {
        ensureStatistics(gameState, target).lastDeathRound = Math.max(1, gameState.roundNumber);
    }
}

export function recordBattleSkillUse(gameState: GameState, caster: Hero, skillId: string): void {
    const statistics = ensureStatistics(gameState, caster);
    if (skillId === caster.skill1Id) statistics.skill1Casts = (statistics.skill1Casts ?? 0) + 1;
    else if (skillId === caster.skill2Id) statistics.skill2Casts = (statistics.skill2Casts ?? 0) + 1;
}
