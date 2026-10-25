import { describe, expect, it } from 'vitest';
import {
    cellFxKey,
    planCellFx,
    type CellFxEntry,
    type CellFxPlan,
    type CellFxVariant,
} from '../../src/core/cell-fx-arbitration';

function entries(...items: Array<[number, CellFxVariant]>): CellFxEntry[] {
    return items.map(([eventId, variant]) => ({ eventId, variant }));
}

function roleOf(plan: CellFxPlan, eventId: number, variant: CellFxVariant) {
    return plan.roles.get(cellFxKey(eventId, variant));
}

describe('planCellFx', () => {
    it('空格没有主效也不压暗常驻层', () => {
        const plan = planCellFx([]);
        expect(plan.mainEventId).toBeNull();
        expect(plan.hot).toBe(false);
        expect(plan.notchEventIds).toEqual([]);
        expect(plan.roles.size).toBe(0);
    });

    it('同一事件落在同格的起手、主效与底光照常全演', () => {
        const plan = planCellFx(entries([7, 'caster'], [7, 'target'], [7, 'area']));
        expect(plan.mainEventId).toBe(7);
        expect(plan.hot).toBe(true);
        expect(roleOf(plan, 7, 'caster')).toBe('show');
        expect(roleOf(plan, 7, 'target')).toBe('show');
        expect(roleOf(plan, 7, 'area')).toBe('show');
    });

    it('两件事同格命中：最新一手拿全尺寸，旧的那手退成回声', () => {
        const plan = planCellFx(entries([4, 'target'], [9, 'impact']));
        expect(plan.mainEventId).toBe(9);
        expect(plan.hot).toBe(true);
        expect(roleOf(plan, 9, 'impact')).toBe('show');
        expect(roleOf(plan, 4, 'target')).toBe('echo');
        expect(plan.notchEventIds).toEqual([]);
    });

    it('回声事件只保留落在本格的那一份主效，起手与底光一起让位', () => {
        const plan = planCellFx(entries(
            [4, 'caster'], [4, 'target'], [4, 'area'],
            [9, 'target'],
        ));
        expect(plan.mainEventId).toBe(9);
        expect(roleOf(plan, 4, 'target')).toBe('echo');
        expect(roleOf(plan, 4, 'caster')).toBe('hidden');
        expect(roleOf(plan, 4, 'area')).toBe('hidden');
    });

    it('第三件起画面全让，只留下格边短线', () => {
        const plan = planCellFx(entries(
            [1, 'target'], [2, 'impact'], [3, 'target'], [4, 'area'],
        ));
        expect(plan.mainEventId).toBe(3);
        expect(roleOf(plan, 2, 'impact')).toBe('echo');
        expect(roleOf(plan, 1, 'target')).toBe('hidden');
        expect(roleOf(plan, 4, 'area')).toBe('hidden');
        expect(plan.notchEventIds).toEqual([1]);
        expect(plan.hot).toBe(true);
    });

    it('多条短线按从新到旧排列，底光事件不占短线名额', () => {
        const plan = planCellFx(entries(
            [1, 'target'], [2, 'target'], [3, 'target'], [4, 'target'], [5, 'area'],
        ));
        expect(plan.mainEventId).toBe(4);
        expect(plan.notchEventIds).toEqual([2, 1]);
        expect(roleOf(plan, 3, 'target')).toBe('echo');
    });

    it('没有命中型事件时，同格底光只留最新一份', () => {
        const plan = planCellFx(entries(
            [1, 'area'], [2, 'area'], [2, 'caster'],
        ));
        expect(plan.mainEventId).toBeNull();
        expect(plan.hot).toBe(false);
        expect(roleOf(plan, 2, 'area')).toBe('show');
        expect(roleOf(plan, 1, 'area')).toBe('hidden');
        expect(roleOf(plan, 2, 'caster')).toBe('show');
    });

    it('没有命中型事件时，起手、溅射与链电这些小件都保留', () => {
        const plan = planCellFx(entries(
            [1, 'caster'], [2, 'splash'], [3, 'chain'],
        ));
        expect(plan.mainEventId).toBeNull();
        expect(plan.hot).toBe(false);
        expect(roleOf(plan, 1, 'caster')).toBe('show');
        expect(roleOf(plan, 2, 'splash')).toBe('show');
        expect(roleOf(plan, 3, 'chain')).toBe('show');
    });

    it('命中主效自己带的底光属于这一手的设计，不当作重复层砍掉', () => {
        const plan = planCellFx(entries([2, 'area'], [2, 'target']));
        expect(plan.mainEventId).toBe(2);
        expect(roleOf(plan, 2, 'area')).toBe('show');
        expect(roleOf(plan, 2, 'target')).toBe('show');
    });

    it('cellFxKey 用事件号与变体拼出可查表的键', () => {
        expect(cellFxKey(3, 'target')).toBe('3:target');
    });
});
