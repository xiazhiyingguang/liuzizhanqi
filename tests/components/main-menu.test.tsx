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

    it('人机对战不再有二级难度菜单，入口直接标明宗师档', () => {
        const html = renderToStaticMarkup(<MainMenu />);

        expect(html).not.toContain('menu-ai-master');
        expect(html).not.toContain('menu-ai-normal');
        expect(html).not.toContain('menu-ai-easy');
        expect(html).not.toContain('menu-ai-difficulty-back');
        expect(html).not.toContain('简单电脑');
        expect(html).not.toContain('普通电脑');
        expect(html).toContain('宗师电脑');
    });
});
