import { describe, expect, it } from 'vitest';
import { KILL_FANFARE_MIN_TIER, planKillFanfare } from '../../src/audio/kill-fanfare';

describe('连杀号角编曲表', () => {
    it('一到四杀不配号角，破格只属于五杀以上', () => {
        for (const tier of [0, 1, 2, 3, 4]) expect(planKillFanfare(tier)).toBeNull();
        expect(KILL_FANFARE_MIN_TIER).toBe(5);
    });

    it('非法档位不响', () => {
        expect(planKillFanfare(Number.NaN)).toBeNull();
        expect(planKillFanfare(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('五杀是逐级上行的四音号角，带鼓但不带钟', () => {
        const plan = planKillFanfare(5)!;
        expect(plan.notes).toHaveLength(4);
        expect(plan.bell).toBeUndefined();
        expect(plan.drums.length).toBeGreaterThanOrEqual(2);
        // 音高与进入时刻都必须单调递增，号角才是"往上走"而不是乱响
        expect(plan.notes.every((note, i) => i === 0 || note.freq > plan.notes[i - 1].freq)).toBe(true);
        expect(plan.notes.every((note, i) => i === 0 || note.atMs > plan.notes[i - 1].atMs)).toBe(true);
    });

    it('六杀比五杀再高一档：多一枚音、多一口长余韵的钟', () => {
        const penta = planKillFanfare(5)!;
        const hexa = planKillFanfare(6)!;
        const top = notes => Math.max(...notes.map(note => note.freq));
        expect(hexa.notes.length).toBeGreaterThan(penta.notes.length);
        expect(top(hexa.notes)).toBeGreaterThan(top(penta.notes));
        expect(hexa.bell).toBeDefined();
        expect(hexa.bell!.durMs).toBeGreaterThan(Math.max(...hexa.notes.map(note => note.durMs)));
    });

    it('超过六杀按六杀响，档位封顶', () => {
        expect(planKillFanfare(9)).toEqual(planKillFanfare(6));
    });
});
