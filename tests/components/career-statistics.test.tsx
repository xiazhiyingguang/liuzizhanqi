import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerStatisticsPanel } from '../../src/components/CareerStatistics/CareerStatistics';
import type { CareerStatisticsData } from '../../src/services/career-statistics';

describe('CareerStatisticsPanel', () => {
    it('展示长期对局总览与英雄核心指标', () => {
        const data: CareerStatisticsData = {
            version: 1,
            totalMatches: 4,
            totalRounds: 20,
            modeMatches: { ai: 2, local: 1, online: 1 },
            recordedMatchIds: ['match-1'],
            updatedAt: 1000,
            heroes: {
                moran: {
                    heroId: 'moran',
                    name: '墨阑',
                    heroClass: '武曲',
                    appearances: 2,
                    wins: 1,
                    totalDamageDealt: 120,
                    totalDamageTaken: 50,
                    totalHealingDone: 8,
                    totalShieldAbsorbed: 4,
                    totalKills: 3,
                    totalSurvivalRounds: 9,
                },
            },
        };

        const html = renderToStaticMarkup(
            <CareerStatisticsPanel data={data} onBack={() => undefined} onClear={() => undefined} />
        );

        expect(html).toContain('弈谱');
        expect(html).toContain('累计对局');
        expect(html).toContain('人机对战');
        expect(html).toContain('墨阑');
        expect(html).toContain('登场率');
        expect(html).toContain('胜率');
        expect(html).toContain('场均输出');
        expect(html).toContain('平均存活');
        expect(html).toContain('25.0%');
        expect(html).toContain('50.0%');
    });
});
