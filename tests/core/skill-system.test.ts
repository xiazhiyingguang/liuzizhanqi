import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillSystem } from '../../src/core/skill-system';
import { EffectManager } from '../../src/core/effect-manager';
import { Skill } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

function createBasicSkill(overrides: Partial<Skill> = {}): Skill {
    return {
        id: 'test_basic_skill',
        name: '测试技能',
        type: 'damage',
        description: '用于验证通用技能执行路径',
        rangeType: 'single',
        range: 2,
        targetType: 'enemy',
        targetCount: 1,
        baseDamage: 10,
        ...overrides,
    };
}

describe('SkillSystem default execution', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('applies damage through the shared damage calculator', () => {
        const state = makeGameState();
        const caster = addHero(state, 'moran', 'player1', [2, 2]);
        const target = addHero(state, 'baize', 'player2', [2, 3]);
        const initialHp = target.currentHp;

        const result = SkillSystem.executeSkill(caster, createBasicSkill(), [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(result.damageDealt).toEqual([10]);
        expect(target.currentHp).toBe(initialHp - 10);
    });

    it('applies healing and effects to valid targets', () => {
        const state = makeGameState();
        const caster = addHero(state, 'baize', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        ally.currentHp -= 8;
        const skill = createBasicSkill({
            id: 'test_support_skill',
            type: 'heal',
            targetType: 'ally',
            baseDamage: undefined,
            baseHeal: 6,
            effectsToApply: [{
                type: 'buff',
                name: '测试祝福',
                duration: 2,
                value: 0.1,
            }],
        });

        const result = SkillSystem.executeSkill(caster, skill, [[2, 3]], state);

        expect(result.healingDone).toEqual([6]);
        expect(EffectManager.hasEffect(ally, '测试祝福')).toBe(true);
        expect(result.effectsApplied).toHaveLength(1);
    });

    it('rejects skill use while the caster is stunned', () => {
        const state = makeGameState();
        const caster = addHero(state, 'moran', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 3]);
        EffectManager.addEffect(caster, {
            type: 'stun',
            name: '眩晕',
            duration: 1,
            sourceHeroId: 'enemy',
        });

        expect(SkillSystem.canUseSkill(caster, createBasicSkill(), state)).toBe(false);
    });

    it('ignores invalid target coordinates without throwing', () => {
        const state = makeGameState();
        const caster = addHero(state, 'moran', 'player1', [2, 2]);

        expect(() => SkillSystem.executeSkill(caster, createBasicSkill(), [[9, 9]], state)).not.toThrow();
        expect(SkillSystem.executeSkill(caster, createBasicSkill(), [[9, 9]], state).success).toBe(false);
    });
});
