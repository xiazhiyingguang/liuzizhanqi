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

    it('设定案写定的效果逐条落在图鉴上', () => {
        const effectsOf = (id: string) =>
            WEAPON_CODEX.find(weapon => weapon.id === id)?.effects.join('') ?? '';

        expect(effectsOf('wukong')).toContain('40%');
        expect(effectsOf('yinyang')).toContain('3 格');
        expect(effectsOf('zhenxiao')).toContain('反击伤害增加 2');
        expect(effectsOf('zuizhendao')).toContain('20%');
        expect(effectsOf('liuli')).toContain('禅定');
        expect(effectsOf('yunying')).toContain('2 次');
        expect(effectsOf('fengling')).toContain('猎砂');
    });

    it('设定案留白的器一律清空效果（图鉴显示"效果待定"）', () => {
        const effectless = ['feixue', 'mowen', 'xuanxiao', 'dai', 'baize', 'changli', 'jinghong', 'huanongying'];
        for (const id of effectless) {
            expect(WEAPON_CODEX.find(weapon => weapon.id === id)?.effects ?? null, `${id} 应无效果文案`).toEqual([]);
        }
    });

    it('已实装的器必须带效果文案，首批恰为设定案写明效果的 15 口', () => {
        const implemented = WEAPON_CODEX.filter(weapon => weapon.implemented);
        expect(implemented).toHaveLength(15);
        for (const weapon of implemented) {
            expect(weapon.effects.length, `${weapon.id} 已实装却没有效果说明`).toBeGreaterThan(0);
        }
    });

    it('器名与 2026-10 设定案一致，防止被旧文案回退', () => {
        const names: Record<string, string> = {
            yunying: '赤霄',
            jinghong: '惊鸿照影',
            huanongying: '破月扇',
            dilan: '青鸾羽',
            jinghua: '水月鉴',
            xueqi: '赤枷',
            xubai: '澄心笺',
            shangguan: '飞白',
            nanfeng: '熏风笛',
            lingxi: '汐音螺',
            youjun: '掠风翎',
            zhiguang: '虹棱',
        };
        for (const [id, name] of Object.entries(names)) {
            expect(WEAPON_CODEX.find(weapon => weapon.id === id)?.name, `${id} 器名不符`).toBe(name);
        }
    });
});
