import { describe, expect, it } from 'vitest';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { HERO_ABILITY_KEYS, HERO_ABILITY_RATINGS, getHeroAbilityRatings } from '../../src/data/hero-ratings';

describe('英雄图鉴数据', () => {
    it('完整收录所有可选英雄且没有重复', () => {
        expect(HERO_CODEX).toHaveLength(AVAILABLE_HERO_IDS.length);
        expect(new Set(HERO_CODEX.map(hero => hero.id)).size).toBe(HERO_CODEX.length);
        expect(HERO_CODEX.map(hero => hero.id)).toEqual(AVAILABLE_HERO_IDS);
    });

    it('每名英雄都有完整的玩家可读资料', () => {
        for (const hero of HERO_CODEX) {
            expect(hero.name).not.toBe('');
            expect(hero.maxHp).toBeGreaterThan(0);
            expect(hero.moveRange).toBeGreaterThan(0);
            expect(hero.skills).toHaveLength(2);
            expect(hero.skills.every(skill => skill.name && skill.description)).toBe(true);
            expect(hero.passive.name).not.toMatch(/_passive$/);
            expect(hero.passive.description.length).toBeGreaterThan(8);
            expect(hero.tags.length).toBeGreaterThanOrEqual(3);
            expect(hero.tips.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('不向图鉴暴露内部标识或调试字段', () => {
        const visibleCopy = JSON.stringify(HERO_CODEX);
        expect(visibleCopy).not.toContain('__actionSerial');
        expect(visibleCopy).not.toContain('entangle-');
        expect(visibleCopy).not.toContain('zhenxiao_passive');
        expect(visibleCopy).not.toContain('zhenxiao_tianwei');
    });

    it('每名已实装英雄都有完整且有效的七维能力评分', () => {
        for (const hero of HERO_CODEX) {
            const ratings = getHeroAbilityRatings(hero.name);
            expect(ratings, `${hero.name}缺少能力评分`).toBeDefined();
            expect(Object.keys(ratings ?? {})).toEqual([...HERO_ABILITY_KEYS]);
            for (const value of Object.values(ratings ?? {})) {
                expect(value).toBeGreaterThanOrEqual(1);
                expect(value).toBeLessThanOrEqual(10);
            }
        }
        expect(Object.keys(HERO_ABILITY_RATINGS).length).toBeGreaterThanOrEqual(HERO_CODEX.length);
    });
});
