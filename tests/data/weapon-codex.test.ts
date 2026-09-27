import { describe, expect, it } from 'vitest';
import { UNNAMED_WEAPON, WEAPON_CODEX, WEAPON_SYSTEMS } from '../../src/data/weapon-codex';
import { HERO_CODEX } from '../../src/data/hero-codex';

/**
 * 武器图鉴数据。
 *
 * 武器系统尚未实装，但"一器一主"的对应关系必须从第一天就成立：
 * 英雄图鉴里有几个人，武器图鉴就要有几口器，体系也要跟着英雄的职业走，
 * 否则两个界面会慢慢各说各话（这正是此前的问题）。
 */
describe('武器图鉴数据', () => {
    it('与英雄图鉴一一对应：人数即器数，id 与主人同名', () => {
        expect(WEAPON_CODEX).toHaveLength(HERO_CODEX.length);
        expect(WEAPON_CODEX.map(weapon => weapon.heroId)).toEqual(HERO_CODEX.map(hero => hero.id));
        expect(new Set(WEAPON_CODEX.map(weapon => weapon.id)).size).toBe(WEAPON_CODEX.length);
    });

    it('每件武器都有主人、有效体系，且器名不重复', () => {
        for (const weapon of WEAPON_CODEX) {
            expect(weapon.heroName.trim(), `${weapon.id} 缺少专属英雄`).not.toBe('');
            expect(weapon.name).not.toBe(UNNAMED_WEAPON);
            expect(WEAPON_SYSTEMS, `${weapon.id} 体系越界`).toContain(weapon.system);
        }
        expect(new Set(WEAPON_CODEX.map(weapon => weapon.name)).size).toBe(WEAPON_CODEX.length);
    });

    it('体系跟随英雄职业，两处不会再各写一份', () => {
        const classById = new Map(HERO_CODEX.map(hero => [hero.id, hero.class]));
        for (const weapon of WEAPON_CODEX) {
            expect(weapon.system, `${weapon.id} 与主人职业不符`).toBe(classById.get(weapon.heroId));
        }
    });

    it('保留已给出的关键效果草案', () => {
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'feixue')?.effects.join('')).toContain('20%');
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'wukong')?.effects.join('')).toContain('40%');
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'yinyang')?.effects.join('')).toContain('3 格');
    });

    it('没有给出效果的武器保持空草案（图鉴显示"效果待定"）', () => {
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'zhenxiao')?.effects).toEqual([]);
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'fengling')?.effects).toEqual([]);
    });
});
