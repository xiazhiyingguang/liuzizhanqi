import { describe, expect, it } from 'vitest';
import {
    computeFxAngleDeg,
    computeFxDirection,
    resolveSkillFx,
    SKILL_FX_PROFILES,
} from '../../src/core/skill-fx';

describe('resolveSkillFx', () => {
    it('技能级档案精确命中各自的专属特效', () => {
        expect(resolveSkillFx('wukong_skill1').kind).toBe('wukong-clone');
        expect(resolveSkillFx('wukong_skill2').kind).toBe('wukong-staff');
        expect(resolveSkillFx('feixue_skill1').kind).toBe('feixue-blade');
        expect(resolveSkillFx('feixue_skill2').kind).toBe('feixue-stomp');
        expect(resolveSkillFx('soul_lamp_skill1').kind).toBe('soul-lamp-array');
        expect(resolveSkillFx('soul_lamp_skill2').kind).toBe('soul-lamp-cycle');
        expect(resolveSkillFx('libai_skill1').kind).toBe('libai-slash');
        expect(resolveSkillFx('libai_skill2').kind).toBe('libai-flurry');
        expect(resolveSkillFx('feynman_skill1').kind).toBe('feynman-beam');
        expect(resolveSkillFx('feynman_skill2').kind).toBe('feynman-burst');
    });

    it('所有档案均带正数存活时长', () => {
        for (const profile of Object.values(SKILL_FX_PROFILES)) {
            expect(profile.durationMs).toBeGreaterThan(0);
        }
    });

    it('未定制技能由技能 ID 推导英雄级兜底，未知技能回落墨韵波纹', () => {
        // wukong_skill3（假想未定制技能）应推导出英雄 wukong 的兜底
        expect(resolveSkillFx('wukong_skill3').kind).toBe('wukong-staff');
        expect(resolveSkillFx('libai_skill9').kind).toBe('libai-slash');
        expect(resolveSkillFx('moran_skill1').kind).toBe('ink');
        expect(resolveSkillFx('unknown-skill')).toEqual({ kind: 'ink', durationMs: 750 });
        expect(resolveSkillFx(undefined)).toEqual({ kind: 'ink', durationMs: 750 });
        expect(resolveSkillFx()).toEqual({ kind: 'ink', durationMs: 750 });
    });
});

describe('computeFxAngleDeg', () => {
    it('四正方向角度与 CSS rotate 约定一致（0=右 90=下 180=左 -90=上）', () => {
        expect(computeFxAngleDeg([2, 2], [2, 3])).toBeCloseTo(0);      // 向右
        expect(computeFxAngleDeg([2, 2], [3, 2])).toBeCloseTo(90);    // 向下
        expect(computeFxAngleDeg([2, 2], [2, 1])).toBeCloseTo(180);    // 向左
        expect(computeFxAngleDeg([2, 2], [1, 2])).toBeCloseTo(-90);   // 向上
        expect(computeFxAngleDeg([2, 2], [2, 2])).toBe(0);             // 原地
    });

    it('对角方向为 45° 的倍数', () => {
        expect(computeFxAngleDeg([2, 2], [3, 3])).toBeCloseTo(45);   // 右下
        expect(computeFxAngleDeg([2, 2], [3, 1])).toBeCloseTo(135);   // 左下
        expect(computeFxAngleDeg([2, 2], [1, 1])).toBeCloseTo(-135);  // 左上
        expect(computeFxAngleDeg([2, 2], [1, 3])).toBeCloseTo(-45);   // 右上
    });
});

describe('computeFxDirection', () => {
    it('45° 扇区量化为八向标签', () => {
        expect(computeFxDirection(0)).toBe('E');
        expect(computeFxDirection(45)).toBe('SE');
        expect(computeFxDirection(90)).toBe('S');
        expect(computeFxDirection(135)).toBe('SW');
        expect(computeFxDirection(180)).toBe('W');
        expect(computeFxDirection(-135)).toBe('NW');
        expect(computeFxDirection(-90)).toBe('N');
        expect(computeFxDirection(-45)).toBe('NE');
    });

    it('负角度先归一化再量化', () => {
        expect(computeFxDirection(-10)).toBe('E');
        expect(computeFxDirection(-190)).toBe('W');
        expect(computeFxDirection(350)).toBe('E');
    });
});
