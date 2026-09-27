import { describe, expect, it } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { MovementSystem } from '../../src/core/movement-system';
import { SkillSystem } from '../../src/core/skill-system';
import { resolveHeroStatusFx } from '../../src/core/hero-status-fx';
import { guyingSkill1, guyingSkill2 } from '../../src/data/skills';
import { GUYING_DUANXUE, guyingTianwei } from '../../src/data/heroes';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 孤影重做后的口径：
 * - 天威从"回收剑影"换成「断雪」姿态（两回合）；
 * - 断雪期间技能一贯穿整条射线、技能二基础伤害 12、每次使用技能再 +1 寒星；
 * - 「脆伤」只算她自己的加成（带寒天的目标 +20%）；
 * - 技能二破冰：对冰冻目标 +50% 后解除冰冻。
 */

function freeze(hero: ReturnType<typeof addHero>, sourceId: string) {
    EffectManager.addEffect(hero, {
        type: 'stun', name: '冰冻', duration: 1, sourceHeroId: sourceId,
    });
}

function hantian(hero: ReturnType<typeof addHero>, stacks: number, sourceId: string) {
    EffectManager.addEffect(hero, {
        type: 'debuff', name: '寒天', duration: -1, stackCount: stacks, sourceHeroId: sourceId,
    });
}

describe('孤影 · 断雪', () => {
    it('天威改为进入断雪姿态，不再留下任何剑影记账', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 0]);

        guyingTianwei.execute(hero, state);

        expect(EffectManager.hasEffect(hero, GUYING_DUANXUE)).toBe(true);
        expect(resolveHeroStatusFx(hero), '断雪必须在棋子上看得见').toContain('duanxue');
        expect(state.battleLog.some(entry => entry.message.includes('断雪'))).toBe(true);

        // 旧机制彻底摘除：移动与技能一都不再写 guying_sword_shadow_mask
        MovementSystem.moveHero(hero, [3, 0], state);
        hantian(addHero(state, 'baize', 'player2', [3, 2]), 1, hero.id);
        expect(hero.counters['guying_sword_shadow_mask']).toBeUndefined();
    });

    it('平时技能一只斩路径上第一个敌人，断雪期间贯穿整条射线', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 0]);
        const near = addHero(state, 'baize', 'player2', [2, 2]);
        const far = addHero(state, 'liuli', 'player2', [2, 4]);

        SkillSystem.executeSkill(hero, guyingSkill1, [[2, 5]], state);
        expect(near.currentHp).toBeLessThan(near.maxHp);
        expect(far.currentHp).toBe(far.maxHp);

        // 复位后进入断雪，再打同一排
        const state2 = makeGameState();
        const hero2 = addHero(state2, 'guying', 'player1', [2, 0]);
        const near2 = addHero(state2, 'baize', 'player2', [2, 2]);
        const far2 = addHero(state2, 'liuli', 'player2', [2, 4]);
        guyingTianwei.execute(hero2, state2);

        const result = SkillSystem.executeSkill(hero2, guyingSkill1, [[2, 5]], state2);

        expect(result.success).toBe(true);
        expect(result.damageDealt ?? []).toHaveLength(2);
        expect(near2.currentHp).toBeLessThan(near2.maxHp);
        expect(far2.currentHp, '断雪期间剑光要割到更远的敌人').toBeLessThan(far2.maxHp);
        expect(hero2.position, '她本人仍然只穿到第一个敌人身后').toEqual([2, 3]);
    });

    it('脆伤：孤影对带寒天的目标伤害提升 20%', () => {
        const plain = makeGameState();
        const plainHero = addHero(plain, 'guying', 'player1', [2, 2]);
        const plainEnemy = addHero(plain, 'liuli', 'player2', [2, 3]);
        const plainResult = guyingSkill2.execute!(plainHero, [plainEnemy], plain);

        const marked = makeGameState();
        const markedHero = addHero(marked, 'guying', 'player1', [2, 2]);
        const markedEnemy = addHero(marked, 'liuli', 'player2', [2, 3]);
        hantian(markedEnemy, 1, markedHero.id);
        const markedResult = guyingSkill2.execute!(markedHero, [markedEnemy], marked);

        expect(plainResult.damageDealt).toEqual([10]);
        expect(markedResult.damageDealt).toEqual([12], '10 × 1.2');
    });

    it('技能二破冰：对冰冻目标 +50% 并解除其冰冻', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 2]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);
        freeze(enemy, hero.id);

        const result = guyingSkill2.execute!(hero, [enemy], state);

        expect(result.damageDealt).toEqual([15]);
        expect(EffectManager.hasEffect(enemy, '冰冻'), '冰应当被击碎').toBe(false);
        expect(result.log.join()).toContain('击碎');
    });

    it('断雪期间技能二基础伤害提升到 12', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 2]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);
        guyingTianwei.execute(hero, state);

        const result = guyingSkill2.execute!(hero, [enemy], state);

        expect(result.damageDealt).toEqual([12]);
    });

    it('断雪期间每次使用技能 +1 寒星，命中带寒天的目标再 +1，5 层封顶', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 2]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);
        guyingTianwei.execute(hero, state);

        guyingSkill2.execute!(hero, [enemy], state);
        expect(hero.counters['寒星']).toBe(1, '断雪期间使用技能 +1');

        hantian(enemy, 1, hero.id);
        guyingSkill2.execute!(hero, [enemy], state);
        expect(hero.counters['寒星']).toBe(3, '断雪 +1 与寒星被动 +1 同时成立');

        hero.counters['寒星'] = 5;
        guyingSkill2.execute!(hero, [enemy], state);
        expect(hero.counters['寒星'], '上限 5 层，满了不再叠').toBe(5);
    });

    it('断雪持续两回合后自动消散', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 2]);
        guyingTianwei.execute(hero, state);

        EffectManager.updateEffectDurations(state);
        expect(EffectManager.hasEffect(hero, GUYING_DUANXUE)).toBe(true);
        EffectManager.updateEffectDurations(state);
        expect(EffectManager.hasEffect(hero, GUYING_DUANXUE)).toBe(false);
    });

    it('断雪期间的伤害仍然走一次性攻击分组，寒星按命中前层数结算', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 0]);
        const near = addHero(state, 'baize', 'player2', [2, 2]);
        const far = addHero(state, 'liuli', 'player2', [2, 4]);
        guyingTianwei.execute(hero, state);
        hero.counters['寒星'] = 2;

        const result = SkillSystem.executeSkill(hero, guyingSkill1, [[2, 5]], state);

        // 8 × (1 + 2×0.1) = 9.6 → 9；两枚伤害在结算前就算好，不因中途 +寒星 而变
        expect(result.damageDealt).toEqual([9, 9]);
        expect(DamageCalculator.getHantianStackCount(near)).toBe(1);
        expect(DamageCalculator.getHantianStackCount(far), '只有第一个敌人被附加寒天').toBe(0);
    });
});
