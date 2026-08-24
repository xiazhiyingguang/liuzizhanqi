import { describe, expect, it } from 'vitest';
import { WEAPON_CODEX, WEAPON_SYSTEMS } from '../../src/data/weapon-codex';

describe('武器图鉴数据', () => {
    it('完整收录38件武器且标识唯一', () => {
        expect(WEAPON_CODEX).toHaveLength(38);
        expect(new Set(WEAPON_CODEX.map(weapon => weapon.id)).size).toBe(WEAPON_CODEX.length);
        expect(new Set(WEAPON_CODEX.map(weapon => weapon.name)).size).toBe(WEAPON_CODEX.length);
    });

    it('每件武器都有专属英雄和有效体系', () => {
        for (const weapon of WEAPON_CODEX) {
            expect(weapon.heroName.trim()).not.toBe('');
            expect(WEAPON_SYSTEMS).toContain(weapon.system);
        }
    });

    it('保留已给出的关键效果草案', () => {
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'shuangsui')?.effects.join('')).toContain('20%');
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'wanren')?.effects.join('')).toContain('40%');
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'tansuozhi-yan')?.effects.join('')).toContain('65%');
    });

    it('没有给出效果的武器保持空草案', () => {
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'jinglei-suiyue')?.effects).toEqual([]);
        expect(WEAPON_CODEX.find(weapon => weapon.id === 'liesha-zhizhao')?.effects).toEqual([]);
    });
});

