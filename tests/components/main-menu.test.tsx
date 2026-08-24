import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MainMenu from '../../src/components/Menu/MainMenu';

describe('主界面视觉版本', () => {
    it('默认使用新水墨布局并保留原版切换入口', () => {
        const html = renderToStaticMarkup(<MainMenu />);

        expect(html).toContain('main-menu-stage-enhanced');
        expect(html).toContain('main-menu-stage-cinematic');
        expect(html).toContain('menu-visual-toggle');
        expect(html).toContain('切回原版');
        expect(html).toContain('人机对战');
        expect(html).toContain('本地双人');
        expect(html).toContain('联机对战');
        expect(html).toContain('武器图鉴');
    });
});
