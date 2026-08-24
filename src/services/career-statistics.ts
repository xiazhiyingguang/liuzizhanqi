import { getHeroBattleStatistics } from '../core/battle-statistics';
import type { GameState, Hero } from '../types/game';

export type CareerMatchMode = 'ai' | 'local' | 'online';

export interface HeroCareerRecord {
    heroId: string;
    name: string;
    heroClass: string;
    appearances: number;
    wins: number;
    totalDamageDealt: number;
    totalDamageTaken: number;
    totalHealingDone: number;
    totalShieldAbsorbed: number;
    totalKills: number;
    totalSurvivalRounds: number;
}

export interface CareerStatisticsData {
    version: 1;
    totalMatches: number;
    totalRounds: number;
    modeMatches: Record<CareerMatchMode, number>;
    heroes: Record<string, HeroCareerRecord>;
    recordedMatchIds: string[];
    updatedAt: number | null;
}

export interface HeroCareerMetrics extends HeroCareerRecord {
    pickRate: number;
    winRate: number;
    averageDamageDealt: number;
    averageDamageTaken: number;
    averageHealingDone: number;
    averageShieldAbsorbed: number;
    averageKills: number;
    averageSurvivalRounds: number;
}

const STORAGE_KEY = 'six-chess-career-statistics-v1';
const MAX_RECORDED_MATCH_IDS = 500;

export function createEmptyCareerStatistics(): CareerStatisticsData {
    return {
        version: 1,
        totalMatches: 0,
        totalRounds: 0,
        modeMatches: { ai: 0, local: 0, online: 0 },
        heroes: {},
        recordedMatchIds: [],
        updatedAt: null,
    };
}

function getBrowserStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function finiteNonNegative(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeHeroRecord(heroId: string, value: unknown): HeroCareerRecord | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<HeroCareerRecord>;
    if (typeof record.name !== 'string' || typeof record.heroClass !== 'string') return null;
    return {
        heroId,
        name: record.name,
        heroClass: record.heroClass,
        appearances: finiteNonNegative(record.appearances),
        wins: finiteNonNegative(record.wins),
        totalDamageDealt: finiteNonNegative(record.totalDamageDealt),
        totalDamageTaken: finiteNonNegative(record.totalDamageTaken),
        totalHealingDone: finiteNonNegative(record.totalHealingDone),
        totalShieldAbsorbed: finiteNonNegative(record.totalShieldAbsorbed),
        totalKills: finiteNonNegative(record.totalKills),
        totalSurvivalRounds: finiteNonNegative(record.totalSurvivalRounds),
    };
}

function normalizeCareerStatistics(value: unknown): CareerStatisticsData {
    if (!value || typeof value !== 'object') return createEmptyCareerStatistics();
    const parsed = value as Partial<CareerStatisticsData>;
    if (parsed.version !== 1) return createEmptyCareerStatistics();

    const heroes: Record<string, HeroCareerRecord> = {};
    if (parsed.heroes && typeof parsed.heroes === 'object') {
        Object.entries(parsed.heroes).forEach(([heroId, record]) => {
            const normalized = normalizeHeroRecord(heroId, record);
            if (normalized) heroes[heroId] = normalized;
        });
    }

    return {
        version: 1,
        totalMatches: finiteNonNegative(parsed.totalMatches),
        totalRounds: finiteNonNegative(parsed.totalRounds),
        modeMatches: {
            ai: finiteNonNegative(parsed.modeMatches?.ai),
            local: finiteNonNegative(parsed.modeMatches?.local),
            online: finiteNonNegative(parsed.modeMatches?.online),
        },
        heroes,
        recordedMatchIds: Array.isArray(parsed.recordedMatchIds)
            ? parsed.recordedMatchIds.filter((id): id is string => typeof id === 'string').slice(-MAX_RECORDED_MATCH_IDS)
            : [],
        updatedAt: typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : null,
    };
}

export function readCareerStatistics(storage: Storage | null = getBrowserStorage()): CareerStatisticsData {
    if (!storage) return createEmptyCareerStatistics();
    try {
        const saved = storage.getItem(STORAGE_KEY);
        return saved ? normalizeCareerStatistics(JSON.parse(saved)) : createEmptyCareerStatistics();
    } catch {
        return createEmptyCareerStatistics();
    }
}

export function writeCareerStatistics(data: CareerStatisticsData, storage: Storage | null = getBrowserStorage()): boolean {
    if (!storage) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch {
        return false;
    }
}

export function clearCareerStatistics(storage: Storage | null = getBrowserStorage()): void {
    try {
        storage?.removeItem(STORAGE_KEY);
    } catch {
        // 隐私模式或浏览器禁用存储时保持页面可用。
    }
}

function isPrimaryHero(hero: Hero): boolean {
    return hero.counters?.['__isClone'] !== 1 && hero.counters?.['__isSummon'] !== 1;
}

export function resolveCareerHeroId(hero: Hero): string {
    const match = hero.id.match(/^(.*)-player[12]-[^-]+$/);
    return match?.[1] ?? hero.id;
}

function matchMode(gameState: GameState): CareerMatchMode {
    if (gameState.isOnlineMode) return 'online';
    return gameState.isAiMode ? 'ai' : 'local';
}

function getMatchFingerprint(gameState: GameState, heroes: Hero[]): string {
    if (gameState.matchId) return gameState.matchId;
    const heroIds = heroes.map(hero => hero.id).sort().join('|');
    return `legacy:${heroIds}:${gameState.winner ?? 'none'}:${gameState.roundNumber}`;
}

function emptyHeroRecord(hero: Hero, heroId: string): HeroCareerRecord {
    return {
        heroId,
        name: hero.name,
        heroClass: hero.class,
        appearances: 0,
        wins: 0,
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        totalHealingDone: 0,
        totalShieldAbsorbed: 0,
        totalKills: 0,
        totalSurvivalRounds: 0,
    };
}

/**
 * 将一局已结束的对战合并进长期统计。函数保持纯净，便于测试和数据迁移。
 */
export function accumulateCompletedMatch(
    current: CareerStatisticsData,
    gameState: GameState,
    now = Date.now()
): { data: CareerStatisticsData; recorded: boolean } {
    if (gameState.phase !== 'ended' || !gameState.winner) return { data: current, recorded: false };

    const heroes = [...gameState.player1Heroes, ...gameState.player2Heroes].filter(isPrimaryHero);
    if (heroes.length === 0) return { data: current, recorded: false };

    const matchId = getMatchFingerprint(gameState, heroes);
    if (current.recordedMatchIds.includes(matchId)) return { data: current, recorded: false };

    const mode = matchMode(gameState);
    const next: CareerStatisticsData = {
        ...current,
        totalMatches: current.totalMatches + 1,
        totalRounds: current.totalRounds + Math.max(1, gameState.roundNumber),
        modeMatches: {
            ...current.modeMatches,
            [mode]: current.modeMatches[mode] + 1,
        },
        heroes: { ...current.heroes },
        recordedMatchIds: [...current.recordedMatchIds, matchId].slice(-MAX_RECORDED_MATCH_IDS),
        updatedAt: now,
    };

    heroes.forEach(hero => {
        const heroId = resolveCareerHeroId(hero);
        const oldRecord = next.heroes[heroId] ?? emptyHeroRecord(hero, heroId);
        const battle = getHeroBattleStatistics(gameState, hero);
        const survivedToRound = hero.state === 'alive'
            ? Math.max(1, gameState.roundNumber)
            : Math.max(1, battle.lastDeathRound ?? gameState.roundNumber);

        next.heroes[heroId] = {
            ...oldRecord,
            name: hero.name,
            heroClass: hero.class,
            appearances: oldRecord.appearances + 1,
            wins: oldRecord.wins + (hero.owner === gameState.winner ? 1 : 0),
            totalDamageDealt: oldRecord.totalDamageDealt + battle.damageDealt,
            totalDamageTaken: oldRecord.totalDamageTaken + battle.damageTaken,
            totalHealingDone: oldRecord.totalHealingDone + battle.healingDone,
            totalShieldAbsorbed: oldRecord.totalShieldAbsorbed + battle.shieldAbsorbed,
            totalKills: oldRecord.totalKills + battle.kills,
            totalSurvivalRounds: oldRecord.totalSurvivalRounds + survivedToRound,
        };
    });

    return { data: next, recorded: true };
}

export function recordCompletedMatch(gameState: GameState, storage: Storage | null = getBrowserStorage()): boolean {
    const result = accumulateCompletedMatch(readCareerStatistics(storage), gameState);
    return result.recorded && writeCareerStatistics(result.data, storage);
}

export function getHeroCareerMetrics(record: HeroCareerRecord, totalMatches: number): HeroCareerMetrics {
    const appearances = Math.max(1, record.appearances);
    const teamOpportunities = Math.max(1, totalMatches * 2);
    return {
        ...record,
        pickRate: record.appearances / teamOpportunities * 100,
        winRate: record.wins / appearances * 100,
        averageDamageDealt: record.totalDamageDealt / appearances,
        averageDamageTaken: record.totalDamageTaken / appearances,
        averageHealingDone: record.totalHealingDone / appearances,
        averageShieldAbsorbed: record.totalShieldAbsorbed / appearances,
        averageKills: record.totalKills / appearances,
        averageSurvivalRounds: record.totalSurvivalRounds / appearances,
    };
}
