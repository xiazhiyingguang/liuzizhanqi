import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HeroSelect from '../../src/components/HeroSelect/HeroSelect';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';

describe('点将界面', () => {
    it('为所有可选英雄渲染原尺寸的线性图标，不请求头像图片', () => {
        const html = renderToStaticMarkup(<HeroSelect />);
        const cards = html.split(/data-testid="hero-select-[^"]+"/).slice(1);
        expect(cards).toHaveLength(AVAILABLE_HERO_IDS.length);
        for (const card of cards) {
            expect(card).toContain('<svg width="40" height="40" viewBox="0 0 32 32"');
            expect(card).not.toMatch(/<img\b|\/hero-images\//);
        }
    });
});
