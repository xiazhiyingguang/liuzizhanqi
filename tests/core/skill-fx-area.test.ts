import { describe, expect, it } from 'vitest';
import {
    boundsFromCells,
    computeSkillAreaBounds,
    resolveAreaFxKind,
} from '../../src/core/skill-fx';
import type { Position } from '../../src/types/game';

describe('AOE 整体特效：区域包围盒', () => {
    it('boundsFromCells：取格集合的包围盒', () => {
        const cells: Position[] = [[1, 2], [2, 3], [1, 4]];
        expect(boundsFromCells(cells)).toEqual({ r0: 1, c0: 2, rows: 2, cols: 3 });
    });

    it('boundsFromCells：空集合与 undefined 返回 null（不铺整体特效）', () => {
        expect(boundsFromCells([])).toBeNull();
        expect(boundsFromCells(undefined)).toBeNull();
    });

    it('computeSkillAreaBounds：有区域格时取包围盒（3x3 中心扩撒）', () => {
        const bounds = computeSkillAreaBounds(
            { rangeType: 'area', type: 'damage' },
            [[0, 0], [0, 1], [1, 0], [1, 1]]
        );
        expect(bounds).toEqual({ r0: 0, c0: 0, rows: 2, cols: 2 });
    });

    it('computeSkillAreaBounds：无区域格的全场伤害技回退整盘（暗夜燎原/天神震怒类）', () => {
        const bounds = computeSkillAreaBounds({ rangeType: '全场', type: 'damage' }, []);
        expect(bounds).toEqual({ r0: 0, c0: 0, rows: 6, cols: 6 });
        expect(computeSkillAreaBounds({ rangeType: '全场', type: 'damage' }, undefined))
            .toEqual({ r0: 0, c0: 0, rows: 6, cols: 6 });
    });

    it('computeSkillAreaBounds：全场治疗/增益技不出整体特效', () => {
        expect(computeSkillAreaBounds({ rangeType: '全场', type: 'heal' }, undefined)).toBeNull();
        expect(computeSkillAreaBounds({ rangeType: '全场', type: 'buff' }, [])).toBeNull();
    });

    it('computeSkillAreaBounds：单体技能（无区域格）不出整体特效', () => {
        expect(computeSkillAreaBounds({ rangeType: 'single', type: 'damage' }, undefined)).toBeNull();
    });
});

describe('AOE 整体特效：逐格原型 → 区域原型映射', () => {
    it('伤害型原型映射到对应的区域动效', () => {
        expect(resolveAreaFxKind('ember-flare')).toBe('firestorm');
        expect(resolveAreaFxKind('liehuo-blaze')).toBe('firewall');
        expect(resolveAreaFxKind('storm-bolt')).toBe('thunderstorm');
        expect(resolveAreaFxKind('cage-bind')).toBe('cage');
        expect(resolveAreaFxKind('ground-zone')).toBe('groundwave');
        expect(resolveAreaFxKind('triple-slash')).toBe('slashwave');
        expect(resolveAreaFxKind('arc-slash')).toBe('slashwave');
        expect(resolveAreaFxKind('radial-burst')).toBe('shockwave');
    });

    it('召唤/法阵/增益类映射到守护法阵，未知原型兜底冲击波', () => {
        expect(resolveAreaFxKind('magic-array')).toBe('runearray');
        expect(resolveAreaFxKind('light-summon')).toBe('runearray');
        expect(resolveAreaFxKind('wukong-clone')).toBe('runearray');
        expect(resolveAreaFxKind('blessing')).toBe('runearray');
        expect(resolveAreaFxKind('aura-buff')).toBe('runearray');
        expect(resolveAreaFxKind('shadow-dash')).toBe('shockwave');
    });
});
