import { describe, expect, it } from 'vitest';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { SKILL_FX_KIND_LABELS, SKILL_FX_PROFILES, resolveSkillFx } from '../../src/core/skill-fx';
import { SKILL_SOUND_MAP } from '../../src/data/skill-sounds';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';

/**
 * 图鉴是特效的验收入口：新增英雄若漏做技能特效，预览会直接显示「未定制 · 通用兜底」，
 * 这里把同一件事变成 CI 约束，避免只在页面上才被发现。
 */
describe('英雄图鉴技能特效覆盖', () => {
    it('图鉴收录了全部可选英雄', () => {
        expect(HERO_CODEX.map(hero => hero.id).sort()).toEqual([...AVAILABLE_HERO_IDS].sort());
    });

    it('每位英雄的每个主动技能都命中专属特效档案', () => {
        for (const hero of HERO_CODEX) {
            for (const slot of [1, 2]) {
                const skillId = `${hero.id}_skill${slot}`;
                expect(SKILL_FX_PROFILES[skillId], `${skillId} 缺少特效档案`).toBeDefined();
                expect(resolveSkillFx(skillId).kind, `${skillId} 仍在用通用兜底`).not.toBe('ink');
            }
        }
    });

    it('特效档案与专属音效双轨一致，技能名与描述同步可见', () => {
        for (const skillId of Object.keys(SKILL_FX_PROFILES)) {
            expect(SKILL_SOUND_MAP[skillId], `${skillId} 缺音效`).toBeDefined();
        }
        for (const hero of HERO_CODEX) {
            expect(hero.skills).toHaveLength(2);
        }
    });

    it('全部在用原型都有中文展示名，供图鉴预览标注', () => {
        const usedKinds = new Set(Object.values(SKILL_FX_PROFILES).map(profile => profile.kind));
        for (const kind of usedKinds) {
            expect(SKILL_FX_KIND_LABELS[kind], `${kind} 缺中文名`).toBeTruthy();
        }
    });
});
