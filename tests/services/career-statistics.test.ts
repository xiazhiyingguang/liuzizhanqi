import { describe, expect, it } from 'vitest';
import {
    accumulateCompletedMatch,
    createEmptyCareerStatistics,
    getHeroCareerMetrics,
} from '../../src/services/career-statistics';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('career statistics', () => {
    it('汇总胜负、登场、实际战斗数据和存活轮数', () => {
        const state = makeGameState({
            matchId: 'match-career-1',
            phase: 'ended',
            winner: 'player1',
            roundNumber: 6,
            isAiMode: true,
        });
        const winner = addHero(state, 'moran', 'player1', [0, 0]);
        const loser = addHero(state, 'baize', 'player2', [0, 1]);
        loser.state = HeroState.DEAD;
        state.battleStatistics = {
            [winner.id]: {
                damageDealt: 80,
                damageTaken: 25,
                healingDone: 5,
                shieldAbsorbed: 3,
                kills: 2,
            },
            [loser.id]: {
                damageDealt: 20,
                damageTaken: 80,
                healingDone: 18,
                shieldAbsorbed: 0,
                kills: 0,
                lastDeathRound: 4,
            },
        };

        const result = accumulateCompletedMatch(createEmptyCareerStatistics(), state, 123456);

        expect(result.recorded).toBe(true);
        expect(result.data.totalMatches).toBe(1);
        expect(result.data.totalRounds).toBe(6);
        expect(result.data.modeMatches.ai).toBe(1);
        expect(result.data.heroes.moran).toMatchObject({
            appearances: 1,
            wins: 1,
            totalDamageDealt: 80,
            totalSurvivalRounds: 6,
        });
        expect(result.data.heroes.baize).toMatchObject({
            appearances: 1,
            wins: 0,
            totalHealingDone: 18,
            totalSurvivalRounds: 4,
        });

        const metrics = getHeroCareerMetrics(result.data.heroes.moran, result.data.totalMatches);
        expect(metrics.pickRate).toBe(50);
        expect(metrics.winRate).toBe(100);
        expect(metrics.averageDamageDealt).toBe(80);
        expect(metrics.averageSurvivalRounds).toBe(6);
    });

    it('同一局结算重复触发时不会重复累计', () => {
        const state = makeGameState({
            matchId: 'match-career-duplicate',
            phase: 'ended',
            winner: 'player2',
            roundNumber: 3,
        });
        addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 1]);

        const first = accumulateCompletedMatch(createEmptyCareerStatistics(), state);
        const second = accumulateCompletedMatch(first.data, state);

        expect(first.recorded).toBe(true);
        expect(second.recorded).toBe(false);
        expect(second.data.totalMatches).toBe(1);
        expect(second.data.heroes.moran.appearances).toBe(1);
    });

    it('未结束的对局不会写入长期统计', () => {
        const state = makeGameState({ matchId: 'match-in-progress', phase: 'battle' });
        addHero(state, 'moran', 'player1', [0, 0]);

        const result = accumulateCompletedMatch(createEmptyCareerStatistics(), state);

        expect(result.recorded).toBe(false);
        expect(result.data.totalMatches).toBe(0);
    });
});
