import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WeaponCodex from '../../src/components/WeaponCodex/WeaponCodex';
import { AVAILABLE_HERO_IDS, createHero, HIDDEN_HERO_IDS } from '../../src/data/heroes';
import { HERO_CODEX } from '../../src/data/hero-codex';

/**
 * 暂时下架英雄的前端可见性回归。
 *
 * 背景：量子观测者·薛定谔暂时下架。要求是"只从前端摘掉、代码全留"，
 * 所以这里同时钉住两侧：既不能在任何界面里露出来，
 * 也不能把机制/图鉴/音效代码删掉（否则恢复时要重写）。
 */
describe('下架英雄的前端可见性', () => {
    it('选将池与英雄图鉴都不含下架英雄', () => {
        expect(HIDDEN_HERO_IDS.length, '当前应有下架英雄').toBeGreaterThan(0);
        for (const heroId of HIDDEN_HERO_IDS) {
            expect(AVAILABLE_HERO_IDS, `${heroId} 不应出现在选将池`).not.toContain(heroId);
            expect(HERO_CODEX.some(entry => entry.id === heroId), `${heroId} 不应出现在英雄图鉴`).toBe(false);
        }
    });

    it('武器图鉴页面不再渲染下架英雄及其武器', () => {
        const html = renderToStaticMarkup(<WeaponCodex />);
        expect(html).not.toContain('薛定谔');
        expect(html).not.toContain('坍缩之眼');
        expect(html, '在池英雄的武器应照常展示').toContain('墨阑');
    });

    it('战斗侧代码保持完整，去掉下架名单即可恢复', () => {
        // createHero 走英雄模板而非选将池：下架不得损伤战斗路径
        const hero = createHero('schrodinger', 'player1');
        expect(hero.name).toBe('量子观测者·薛定谔');
        expect(hero.skill1Id).toBe('schrodinger_skill1');
        expect(hero.skill2Id).toBe('schrodinger_skill2');
    });
});
