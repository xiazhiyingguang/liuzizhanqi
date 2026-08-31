import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HeroCodex from '../../src/components/HeroCodex/HeroCodex';

describe('英雄图鉴技能特效预览', () => {
    it('两个主动技能名旁各挂一个特效图标', () => {
        const html = renderToStaticMarkup(<HeroCodex />);
        expect(html.match(/skill-fx-peek-trigger/g)).toHaveLength(2);
    });

    it('特效舞台不预先内嵌在卡里，只在悬停浮层中出现', () => {
        const html = renderToStaticMarkup(<HeroCodex />);
        expect(html).not.toContain('skill-fx-stage');
    });
});
