import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MainMenu from '../../src/components/Menu/MainMenu';

describe('主界面视觉版本', () => {
    it('固定使用新水墨长卷布局且不再提供样式切换入口', () => {
        const html = renderToStaticMarkup(<MainMenu />);

        expect(html).toContain('main-menu-stage-enhanced');
        expect(html).toContain('main-menu-stage-cinematic');
        expect(html).not.toContain('menu-visual-toggle');
        expect(html).not.toContain('切回原版');
        expect(html).not.toContain('水墨策略对弈');
        expect(html).toContain('原创水墨长卷');
        expect(html).toContain('人机对战');
        expect(html).toContain('本地双人');
        expect(html).toContain('联机对战');
        expect(html).toContain('武器图鉴');
    });
});
