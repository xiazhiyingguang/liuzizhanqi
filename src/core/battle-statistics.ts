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

export function recordBattleKill(gameState: GameState, killer: Hero, target?: Hero): void {
    ensureStatistics(gameState, killer).kills += 1;
    if (target && target.counters?.['__isClone'] !== 1 && target.counters?.['__isSummon'] !== 1) {
        ensureStatistics(gameState, target).lastDeathRound = Math.max(1, gameState.roundNumber);
    }
}

export function recordBattleSkillUse(gameState: GameState, caster: Hero, skillId: string): void {
    const statistics = ensureStatistics(gameState, caster);
    if (skillId === caster.skill1Id) statistics.skill1Casts = (statistics.skill1Casts ?? 0) + 1;
    else if (skillId === caster.skill2Id) statistics.skill2Casts = (statistics.skill2Casts ?? 0) + 1;
}
