import { describe, expect, it } from 'vitest';
import { createHero } from '../../src/data/heroes';
import { MAX_HERO_STATUS_FX, resolveHeroStatusFx } from '../../src/core/hero-status-fx';
import type { Hero } from '../../src/types/game';

function heroWithEffects(names: string[], counters: Record<string, number> = {}): Hero {
    const hero = createHero('moran', 'player1', [0, 0]);
    hero.effects = names.map((name, index) => ({
        type: 'debuff',
        name,
        duration: 2,
        description: '',
        sourceHeroId: `source-${index}`,
    }));
    Object.assign(hero.counters, counters);
    return hero;
}

describe('resolveHeroStatusFx', () => {
    it('无状态英雄不渲染任何特效层', () => {
        expect(resolveHeroStatusFx(createHero('moran', 'player1', [0, 0]))).toEqual([]);
    });

    it('硬控状态优先级最高', () => {
        const hero = heroWithEffects(['和声', '冰冻', '顺风']);
        expect(resolveHeroStatusFx(hero)[0]).toBe('frozen');
    });

    it('最多渲染两层且按优先级取', () => {
        const hero = heroWithEffects(['冰冻', '眩晕', '凋零']);
        const kinds = resolveHeroStatusFx(hero);
        expect(kinds).toHaveLength(MAX_HERO_STATUS_FX);
        expect(kinds).toEqual(['frozen', 'stun']);
    });

    it('层数型资源（醉意/增势/破镜之刃）也参与解析', () => {
        const hero = heroWithEffects([], { 醉意: 2, 增势: 1, 破镜之刃: 3 });
        const kinds = resolveHeroStatusFx(hero);
        expect(kinds).toHaveLength(MAX_HERO_STATUS_FX);
        expect(kinds).toContain('mirror-blade');
        expect(kinds).toContain('momentum');
    });

    it('零值计数器不触发特效', () => {
        const hero = heroWithEffects([], { 醉意: 0 });
        expect(resolveHeroStatusFx(hero)).toEqual([]);
    });

    it('关键状态名逐一映射', () => {
        const cases: Array<[string, string]> = [
            ['寒天', 'chill'],
            ['羽化', 'feather'],
            ['猎杀令', 'bounty'],
            ['猎杀标记', 'deathmark'],
            ['恐惧', 'fear'],
            ['凋零', 'wither'],
            ['逆风', 'headwind'],
            ['顺风', 'tailwind'],
            ['为道', 'way'],
            ['金银错', 'inlay'],
            ['潜行', 'stealth'],
            ['粒子标记', 'particle'],
            ['量子纠缠', 'entangle'],
            ['和声', 'harmony'],
            ['音符', 'note'],
            ['冰甲', 'ice-armor'],
            ['眩晕', 'stun'],
        ];
        for (const [effectName, kind] of cases) {
            expect(resolveHeroStatusFx(heroWithEffects([effectName]))[0], effectName).toBe(kind);
        }
    });
});
