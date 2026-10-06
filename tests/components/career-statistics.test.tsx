import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerStatisticsPanel, sortCareerRecords } from '../../src/components/CareerStatistics/CareerStatistics';
import {
    createEmptyCareerStatistics,
    getHeroCareerMetrics,
    type CareerStatisticsData,
    type HeroCareerRecord,
} from '../../src/services/career-statistics';

/** 造一条战录记录：只关心参与排序的几个字段，其余给固定值 */
function record(overrides: Partial<HeroCareerRecord> & { heroId: string; name: string }): HeroCareerRecord {
    return {
        heroClass: '武曲',
        appearances: 1,
        wins: 0,
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        totalHealingDone: 0,
        totalShieldAbsorbed: 0,
        totalKills: 0,
        totalSurvivalRounds: 0,
        ...overrides,
    };
}

describe('群英战录排序', () => {
    const roster = [
        record({ heroId: 'moran', name: '墨阑', appearances: 4, wins: 1, totalDamageDealt: 120 }),
        record({ heroId: 'liuli', name: '琉璃', appearances: 2, wins: 2, totalDamageDealt: 40 }),
        record({ heroId: 'baize', name: '白泽', appearances: 6, wins: 3, totalDamageDealt: 90 }),
    ].map(item => getHeroCareerMetrics(item, 6));

    const names = (key: Parameters<typeof sortCareerRecords>[1], ascending: boolean) =>
        sortCareerRecords(roster, key, ascending).map(item => item.name);

    it('点同一列即翻向：升序就是降序的完全倒序', () => {
        expect(names('pickRate', false)).toEqual(['白泽', '墨阑', '琉璃']);
        expect(names('pickRate', true)).toEqual(['琉璃', '墨阑', '白泽']);
    });

    it('每列各按自己的数值排，不看别的列', () => {
        // 胜率：琉璃 100% > 白泽 50% > 墨阑 25%；场均输出：30 > 20 > 15
        expect(names('winRate', false)).toEqual(['琉璃', '白泽', '墨阑']);
        expect(names('averageDamageDealt', false)).toEqual(['墨阑', '琉璃', '白泽']);
    });

    it('数值并列时按登场次数与名字收口，且这个次序不随升降序翻转', () => {
        const tied = [
            record({ heroId: 'a', name: '乙', appearances: 2, wins: 1 }),
            record({ heroId: 'b', name: '甲', appearances: 2, wins: 1 }),
            record({ heroId: 'c', name: '丙', appearances: 4, wins: 2 }),
        ].map(item => getHeroCareerMetrics(item, 6));

        // 三人胜率都是 50% → 先按登场次数（丙 4 次最多），再按中文名字（甲 在 乙 前）
        expect(sortCareerRecords(tied, 'winRate', false).map(item => item.name)).toEqual(['丙', '甲', '乙']);
        expect(sortCareerRecords(tied, 'winRate', true).map(item => item.name)).toEqual(['丙', '甲', '乙']);
    });

    it('排序不改写入参顺序', () => {
        const snapshot = roster.map(item => item.heroId);
        sortCareerRecords(roster, 'averageSurvivalRounds', true);
        expect(roster.map(item => item.heroId)).toEqual(snapshot);
    });
});

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
        expect(html).toContain('平均承伤');
        expect(html).toContain('平均存活');
        expect(html).not.toContain('登场次数');
        expect(html).toContain('25.0%');
        expect(html).toContain('50.0%');
    });
});
