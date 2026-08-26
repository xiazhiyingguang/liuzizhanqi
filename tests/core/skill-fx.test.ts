import { describe, expect, it } from 'vitest';
import { resolveSkillFx, SKILL_FX_PROFILES } from '../../src/core/skill-fx';

describe('resolveSkillFx', () => {
    it('首批五位定制英雄命中各自的专属特效档案', () => {
        expect(resolveSkillFx('wukong').kind).toBe('wukong');
        expect(resolveSkillFx('feixue').kind).toBe('feixue');
        expect(resolveSkillFx('soul_lamp').kind).toBe('soul-lamp');
        expect(resolveSkillFx('libai').kind).toBe('libai');
        expect(resolveSkillFx('feynman').kind).toBe('feynman');
    });

    it('定制英雄档案均带有正数的存活时长', () => {
        for (const profile of Object.values(SKILL_FX_PROFILES)) {
            expect(profile.durationMs).toBeGreaterThan(0);
        }
    });

    it('未定制英雄回落到墨韵波纹兜底档案', () => {
        const fallback = resolveSkillFx('some-unknown-hero');
        expect(fallback.kind).toBe('ink');
        expect(fallback.durationMs).toBeGreaterThan(0);
        expect(resolveSkillFx('').kind).toBe('ink');
    });
});
