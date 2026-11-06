import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HeroIcon, { HERO_ICON_IDS } from '../../src/components/ui/HeroIcon';
import HeroAvatar from '../../src/components/ui/HeroAvatar';
import { getHeroAvatarUrl, getHeroFullBodyUrl, resolveHeroTemplateId } from '../../src/data/hero-assets';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';

/** HeroIcon 内部按 resolveHeroTemplateId 归一化后再查图标表，测试沿用同一口径 */
function iconKey(heroId: string): string {
    return resolveHeroTemplateId(heroId) ?? heroId;
}

describe('英雄选将线性图标', () => {
    it('可选阵容里每名英雄都有专属图标，不会掉进通用兜底', () => {
        const missing = AVAILABLE_HERO_IDS.filter(heroId => !HERO_ICON_IDS.includes(iconKey(heroId)));
        expect(missing).toEqual([]);
    });

    it('每名英雄的图标互不相同', () => {
        const markup = AVAILABLE_HERO_IDS.map(heroId => renderToStaticMarkup(<HeroIcon heroId={heroId} />));
        expect(new Set(markup).size).toBe(AVAILABLE_HERO_IDS.length);
    });

    it('部署实例与分身的 id 也能解析回本体图标', () => {
        expect(renderToStaticMarkup(<HeroIcon heroId="wangshu-player1-abc" />))
            .toBe(renderToStaticMarkup(<HeroIcon heroId="wangshu" />));
        expect(renderToStaticMarkup(<HeroIcon heroId="youjun-player1-abc" />))
            .toBe(renderToStaticMarkup(<HeroIcon heroId="youjun" />));
        expect(renderToStaticMarkup(<HeroIcon heroId="wukong-clone|wukong-player1-x|1" />))
            .toBe(renderToStaticMarkup(<HeroIcon heroId="wukong" />));
    });

    it('未知英雄退回通用图标', () => {
        const fallback = renderToStaticMarkup(<HeroIcon heroId="not-a-hero" />);
        expect(fallback).toContain('M8 28 Q8 20 16 18 Q24 20 24 28');
        const dedicated = AVAILABLE_HERO_IDS.map(heroId => renderToStaticMarkup(<HeroIcon heroId={heroId} />));
        expect(dedicated).not.toContain(fallback);
    });

    it.each(['canglan', 'flower_fog'])('%s 暂无正式图片时，战斗头像和花影沿用专属线性图标', id => {
        const deployedId = `${id}-player1-123`;
        const decoyId = `flower-decoy|flower_fog-player1-456|${deployedId}`;
        const icon = renderToStaticMarkup(<HeroIcon heroId={id} size={23} />);
        expect(getHeroAvatarUrl(deployedId)).toBeUndefined();
        expect(getHeroFullBodyUrl(id)).toBeUndefined();
        expect(renderToStaticMarkup(<HeroAvatar heroId={deployedId} />)).toBe(icon);
        expect(renderToStaticMarkup(<HeroAvatar heroId={decoyId} />)).toBe(icon);
    });
});
