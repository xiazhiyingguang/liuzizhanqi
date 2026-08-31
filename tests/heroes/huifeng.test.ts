import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { SkillSystem } from '../../src/core/skill-system';
import { huifengMarkStacks } from '../../src/core/huifeng-marks';
import { huifengTianwei } from '../../src/data/heroes';
import { huifengSkill1, huifengSkill2 } from '../../src/data/skills';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 回锋：破锋（自身增伤层数，上限5）→ 连破（永久标记，满2层消耗）→ 啸刃（永久标记）
 * → 锋鸣（攻击啸刃目标叠层，满3层自动释放3段随机目标的连刃斩）。
 */
describe('回锋破锋/连破/啸刃/锋鸣体系', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    /** 让高血量敌人扛住整条连锁 */
    function makeTank(hero: ReturnType<typeof addHero>): ReturnType<typeof addHero> {
        hero.maxHp = 1000;
        hero.currentHp = 1000;
        return hero;
    }

    it('技能1连刃斩打3段，每段4点并叠1层破锋', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const enemy = makeTank(addHero(state, 'liuli', 'player2', [2, 3]));

        const result = SkillSystem.executeSkill(hero, huifengSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(result.damageDealt).toEqual([4, 4, 4]);
        expect(enemy.currentHp).toBe(1000 - 12);
        expect(EffectManager.getCounter(hero, '破锋')).toBe(3);
    });

    it('破锋封顶5层，并把10%增伤加成到回锋的所有伤害上', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const adjacent = makeTank(addHero(state, 'liuli', 'player2', [2, 3]));
        const far = makeTank(addHero(state, 'moran', 'player2', [0, 5]));
        EffectManager.setCounter(hero, '破锋', 5);

        const combo = SkillSystem.executeSkill(hero, huifengSkill1, [[2, 3]], state);
        // 满破锋：每段 floor(4×1.5)=6，且层数不再增长
        expect(combo.damageDealt).toEqual([6, 6, 6]);
        expect(EffectManager.getCounter(hero, '破锋')).toBe(5);

        // 技能2随机点到两名敌人，各吃 floor(5×1.5)=7
        const marks = SkillSystem.executeSkill(hero, huifengSkill2, [[2, 2]], state);
        expect(marks.damageDealt).toEqual([7, 7]);
        expect(adjacent.currentHp).toBe(1000 - 18 - 7);
        expect(far.currentHp).toBe(1000 - 7);

        // 天威的4点同样吃加成：floor(4×1.5)=6
        huifengTianwei.execute(hero, state);
        expect(adjacent.currentHp).toBe(1000 - 18 - 7 - 6);
        expect(far.currentHp).toBe(1000 - 7 - 6);
    });

    it('技能2随机点名两名敌人留下永久连破，无需玩家选目标且自身不位移', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const enemies = [
            makeTank(addHero(state, 'moran', 'player2', [0, 5])),
            makeTank(addHero(state, 'baize', 'player2', [5, 0])),
            makeTank(addHero(state, 'liuli', 'player2', [4, 4])),
        ];

        // self 型技能：可选目标只有回锋脚下这一格
        expect(SkillSystem.getValidTargetPositions(hero, huifengSkill2, state)).toEqual([[2, 2]]);

        const result = SkillSystem.executeSkill(hero, huifengSkill2, [[2, 2]], state);

        expect(result.success).toBe(true);
        expect(result.damageDealt).toEqual([5, 5]);
        expect(hero.position).toEqual([2, 2]);
        expect(state.boardEffects ?? []).toHaveLength(0);

        const marked = enemies.filter(enemy => huifengMarkStacks(enemy, hero, '连破') > 0);
        expect(marked).toHaveLength(2);
        expect(marked[0].effects.find(effect => effect.name === '连破')?.duration).toBe(-1);
        // 没被点到的那名敌人分毫未损
        expect(enemies.find(enemy => huifengMarkStacks(enemy, hero, '连破') === 0)?.currentHp).toBe(1000);
    });

    it('只剩一名敌人时技能2只点名那一名；场上没有敌人则释放失败', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const alone = makeTank(addHero(state, 'moran', 'player2', [0, 5]));

        const single = SkillSystem.executeSkill(hero, huifengSkill2, [[2, 2]], state);
        expect(single.damageDealt).toEqual([5]);
        expect(huifengMarkStacks(alone, hero, '连破')).toBe(1);

        const empty = makeGameState();
        const lonely = addHero(empty, 'huifeng', 'player1', [2, 2]);
        const failed = SkillSystem.executeSkill(lonely, huifengSkill2, [[2, 2]], empty);
        expect(failed.success).toBe(false);
    });

    it('连破叠满2层时消耗这2层，凝成永久啸刃', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const target = makeTank(addHero(state, 'moran', 'player2', [0, 5]));

        SkillSystem.executeSkill(hero, huifengSkill2, [[2, 2]], state);
        expect(huifengMarkStacks(target, hero, '连破')).toBe(1);

        SkillSystem.executeSkill(hero, huifengSkill2, [[2, 2]], state);
        expect(huifengMarkStacks(target, hero, '连破')).toBe(0);
        expect(huifengMarkStacks(target, hero, '啸刃')).toBe(1);
        expect(target.effects.find(effect => effect.name === '啸刃')?.duration).toBe(-1);
    });

    it('攻击带啸刃的目标会叠锋鸣，满3层清空并自动释放3段随机目标的连刃斩', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const quarry = makeTank(addHero(state, 'moran', 'player2', [2, 3]));
        // Math.random 固定为 0.99，随机目标会取名单里的最后一名
        const other = makeTank(addHero(state, 'baize', 'player2', [0, 0]));
        EffectManager.addEffect(quarry, {
            type: 'mark', name: '啸刃', duration: -1, stackCount: 1, sourceHeroId: hero.id,
            description: '演示',
        });
        EffectManager.addEffect(quarry, {
            type: 'mark', name: '锋鸣', duration: -1, stackCount: 2, sourceHeroId: hero.id,
            description: '演示',
        });

        const result = SkillSystem.executeSkill(hero, huifengSkill1, [[2, 3]], state);

        expect(result.log.some(line => line.includes('连刃斩自动出鞘'))).toBe(true);
        // 手动3段 + 自动3段
        expect(result.damageDealt).toHaveLength(6);
        // 自动连斩随机到了另一名敌人，因此它没有锋鸣
        expect(huifengMarkStacks(other, hero, '锋鸣')).toBe(0);
        expect(other.currentHp).toBeLessThan(other.maxHp);
        // 触发时锋鸣清空，之后手动余下的两段重新叠了2层
        expect(huifengMarkStacks(quarry, hero, '锋鸣')).toBe(2);
    });

    it('锋鸣连锁允许同回合连环触发，但受连锁上限保护', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const only = makeTank(addHero(state, 'moran', 'player2', [2, 3]));
        EffectManager.addEffect(only, {
            type: 'mark', name: '啸刃', duration: -1, stackCount: 1, sourceHeroId: hero.id,
            description: '演示',
        });

        const result = SkillSystem.executeSkill(hero, huifengSkill1, [[2, 3]], state);

        const autoCasts = result.log.filter(line => line.includes('连刃斩自动出鞘')).length;
        expect(autoCasts).toBe(6);
        expect(result.log.some(line => line.includes('本轮连锁已达上限'))).toBe(true);
        // 只有手动那一段算作回锋的3段连击，其余都是自动连斩
        expect(result.damageDealt.length).toBe(3 + autoCasts * 3);
    });

    it('天威打击所有带连破的敌人并再叠1层连破（满2层即凝成啸刃）', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const marked = makeTank(addHero(state, 'moran', 'player2', [0, 5]));
        const clean = makeTank(addHero(state, 'baize', 'player2', [5, 0]));
        EffectManager.addEffect(marked, {
            type: 'mark', name: '连破', duration: -1, stackCount: 1, sourceHeroId: hero.id,
            description: '演示',
        });

        huifengTianwei.execute(hero, state);

        expect(marked.currentHp).toBe(marked.maxHp - 4);
        expect(clean.currentHp).toBe(clean.maxHp);
        // 天威补的这层连破满2层，直接消耗并凝成啸刃
        expect(huifengMarkStacks(marked, hero, '连破')).toBe(0);
        expect(huifengMarkStacks(marked, hero, '啸刃')).toBe(1);
        expect(clean.effects.some(effect => effect.name === '连破' || effect.name === '啸刃')).toBe(false);
    });
});
