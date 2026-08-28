import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createHero } from '../../src/data/heroes';
import { HeroStatusFx } from '../../src/components/Game/HeroStatusFx';
import type { Hero } from '../../src/types/game';

function heroWithEffects(names: string[]): Hero {
    const hero = createHero('dilan', 'player1', [0, 0]);
    hero.effects = names.map((name, index) => ({
        type: 'debuff',
        name,
        duration: 2,
        description: '',
        sourceHeroId: `source-${index}`,
    }));
    return hero;
}

describe('HeroStatusFx 常驻状态特效层', () => {
    it('无状态时不渲染任何节点', () => {
        const html = renderToStaticMarkup(<HeroStatusFx hero={createHero('dilan', 'player1', [0, 0])} />);
        expect(html).toBe('');
    });

    it('冰冻渲染冰壳与霜点', () => {
        const html = renderToStaticMarkup(<HeroStatusFx hero={heroWithEffects(['冰冻'])} />);
        expect(html).toContain('status-fx sfx-frozen');
        expect(html).toContain('sfx-shell');
        expect(html).toContain('sfx-blink');
    });

    it('多状态按优先级最多渲染两层', () => {
        const html = renderToStaticMarkup(
            <HeroStatusFx hero={heroWithEffects(['寒天', '冰冻', '逆风'])} />
        );
        expect(html).toContain('sfx-frozen');
        expect(html).toContain('sfx-headwind');
        expect(html).not.toContain('sfx-chill');
    });

    it('风系状态渲染流动风纹', () => {
        const html = renderToStaticMarkup(<HeroStatusFx hero={heroWithEffects(['顺风'])} />);
        expect(html).toContain('sfx-tailwind');
        expect(html).toContain('sfx-stream');
    });
});
