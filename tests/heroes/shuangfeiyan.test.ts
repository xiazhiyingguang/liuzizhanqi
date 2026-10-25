import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { MovementSystem } from '../../src/core/movement-system';
import { SkillSystem } from '../../src/core/skill-system';
import { shuangfeiyanSkill1, shuangfeiyanSkill2 } from '../../src/data/extended-skills';
import { Hero, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

function boomerangs(state: ReturnType<typeof makeGameState>, hero: Hero) {
    return (state.boardEffects ?? []).filter(
        effect => effect.type === 'boomerang' && effect.sourceHeroId === hero.id
    );
}

function boomerangCells(state: ReturnType<typeof makeGameState>, hero: Hero): string[] {
    return boomerangs(state, hero)
        .map(effect => `${effect.position[0]},${effect.position[1]}`)
        .sort();
}

/** 测试里直接摆放施法者位置：返航路径要以她“现在站哪”为准 */
function relocate(state: ReturnType<typeof makeGameState>, hero: Hero, to: Position): void {
    if (hero.position) state.board[hero.position[0]][hero.position[1]] = null;
    state.board[to[0]][to[1]] = hero;
    hero.position = to;
}

describe('双飞燕完整机制（天威暂留空）', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('拥有46生命、2移动、两个主动技能与被动，且没有天威', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);

        expect(hero.name).toBe('双飞燕');
        expect(hero.class).toBe('武曲');
        expect(hero.maxHp).toBe(46);
        expect(hero.moveRange).toBe(2);
        expect(hero.skill1Id).toBe('shuangfeiyan_skill1');
        expect(hero.skill2Id).toBe('shuangfeiyan_skill2');
        expect(hero.passiveId).toBe('shuangfeiyan_passive');
        expect(hero.tianweiId).toBeUndefined();
        expect(boomerangs(state, hero)).toHaveLength(0);
    });

    it('技能一沿八个方向最远掷3格，去程对路径敌人各造成4点并留下回旋镖', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 0]);
        const enemy = addHero(state, 'baize', 'player2', [2, 1]);

        const result = SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 4);
        expect(boomerangCells(state, hero)).toEqual(['2,3']);
        expect(boomerangs(state, hero)[0].returnAtSkillSerial).toBe(3);
    });

    it('致知三把回旋镖的往返伤害从4提升到5', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 0]);
        grantZhizhi(hero, 3);
        const enemy = addHero(state, 'baize', 'player2', [2, 1]);

        const result = SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 5);
    });

    it('掷镖只能落在八方向3格内；两把都在外时技能一改为三角模式', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [5, 5]);

        const cells = SkillSystem.getValidTargetPositions(hero, shuangfeiyanSkill1, state);
        expect(cells).toContainEqual([2, 5]);
        expect(cells).toContainEqual([5, 5]);
        expect(cells).toContainEqual([0, 0]);
        expect(cells).not.toContainEqual([5, 4]);

        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[2, 5]], state);
        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[5, 2]], state);

        expect(boomerangCells(state, hero)).toEqual(['2,5', '5,2']);
        expect(SkillSystem.getValidTargetPositions(hero, shuangfeiyanSkill1, state)).toEqual([[2, 2]]);
    });

    it('掷镖落点可以是敌占格，但技能二只能跃向空格上的回旋镖', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 0]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);

        const thrown = SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[2, 3]], state);
        expect(thrown.success).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 4);
        expect(boomerangCells(state, hero)).toEqual(['2,3']);
        expect(SkillSystem.getValidTargetPositions(hero, shuangfeiyanSkill2, state)).toEqual([]);

        const teleport = SkillSystem.executeSkill(hero, shuangfeiyanSkill2, [[2, 3]], state);
        expect(teleport.success).toBe(false);
        expect(hero.position).toEqual([2, 0]);
        expect(boomerangCells(state, hero)).toEqual(['2,3']);
    });

    it('返航按“下下次出手”计时：第一把在第三次出手后回手，第二把在第四次', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [5, 5]);

        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[0, 3]], state); // 第1次出手
        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[3, 0]], state); // 第2次出手
        expect(boomerangCells(state, hero)).toEqual(['0,3', '3,0']);

        const triangle = SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[0, 0]], state); // 第3次出手
        expect(triangle.success).toBe(true);
        expect(boomerangCells(state, hero)).toEqual(['3,0']);

        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[0, 3]], state); // 第4次出手
        expect(boomerangCells(state, hero)).toEqual(['0,3']);
    });

    it('返航沿最短路径飞向她当前位置，路径上的敌人吃4点；三角之外的敌不吃三角伤', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [0, 0]);

        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[0, 3]], state);
        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[3, 0]], state);

        // 她在第三次出手前站到了 (5,5)：第一把镖的归途会经过 (1,4)，而该格在三角之外
        relocate(state, hero, [5, 5]);
        const enemy = addHero(state, 'baize', 'player2', [1, 4]);

        const triangle = SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[5, 5]], state);

        expect(triangle.success).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 4);
        expect(boomerangCells(state, hero)).toEqual(['3,0']);
    });

    it('两把镖都在外时，技能一对三角内所有敌人造成7点，三角外不受影响', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);
        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[2, 5]], state);
        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[5, 2]], state);
        const inside = addHero(state, 'baize', 'player2', [3, 3]);
        const outside = addHero(state, 'liuli', 'player2', [5, 5]);

        const result = SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[2, 2]], state);

        expect(result.success).toBe(true);
        expect(result.damageDealt).toEqual([7]);
        expect(inside.currentHp).toBe(inside.maxHp - 7);
        expect(outside.currentHp).toBe(outside.maxHp);
        // 第一把镖在第三次出手结束后返航，第二把仍在场
        expect(boomerangCells(state, hero)).toEqual(['5,2']);
    });

    it('技能二跃向回旋镖并拾回，落地时对周围3×3所有敌人造成7点', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);
        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[4, 4]], state);
        const cornerA = addHero(state, 'baize', 'player2', [3, 3]);
        const cornerB = addHero(state, 'liuli', 'player2', [4, 5]);
        const cornerC = addHero(state, 'moran', 'player2', [5, 5]);

        const result = SkillSystem.executeSkill(hero, shuangfeiyanSkill2, [[4, 4]], state);

        expect(result.success).toBe(true);
        expect(hero.position).toEqual([4, 4]);
        expect(state.board[2][2]).toBeNull();
        expect(state.board[4][4]).toBe(hero);
        expect(boomerangs(state, hero)).toHaveLength(0);
        expect(cornerA.currentHp).toBe(cornerA.maxHp - 7);
        expect(cornerB.currentHp).toBe(cornerB.maxHp - 7);
        expect(cornerC.currentHp).toBe(cornerC.maxHp - 7);
    });

    it('技能二拾回会取消这只镖的返航计时，重掷后按新计时重新等', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [5, 5]);

        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[4, 4]], state); // 出手1
        SkillSystem.executeSkill(hero, shuangfeiyanSkill2, [[4, 4]], state); // 出手2：拾回，旧计时作废
        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[1, 1]], state); // 出手3：新掷

        expect(boomerangCells(state, hero)).toEqual(['1,1']);
    });

    it('被动让她每次行动出手两次：第一次技能后登记额外行动，额外行动只能放技能不能走位', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [5, 5]);

        const first = SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[2, 5]], state);
        expect(first.success).toBe(true);
        expect(state.pendingExtraActionHeroIds?.player1).toBe(hero.id);

        // 让引擎真的开启这次额外行动
        GameEngine.endHeroAction(hero, state);
        expect(state.performingExtraAction).toBe(true);
        expect(state.activeHero?.id).toBe(hero.id);
        expect(hero.counters['sfy_extra_skill_only']).toBe(1);
        expect(MovementSystem.getMovablePositions(hero, state)).toEqual([]);
        expect(MovementSystem.moveHero(hero, [2, 3], state)).toBe(false);

        state.pendingExtraActionHeroIds = {};
        const second = SkillSystem.executeSkill(hero, shuangfeiyanSkill2, [[2, 5]], state);
        expect(second.success).toBe(true);
        expect(state.pendingExtraActionHeroIds?.player1).toBeUndefined();

        GameEngine.endHeroAction(hero, state);
        expect(hero.counters['sfy_extra_skill_only']).toBeUndefined();
        expect(hero.counters['sfy_second_queued']).toBeUndefined();
    });

    it('双飞燕阵亡时清掉场上所有回旋镖与双出手记账', () => {
        const state = makeGameState();
        const hero = addHero(state, 'shuangfeiyan', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 5]);
        SkillSystem.executeSkill(hero, shuangfeiyanSkill1, [[4, 4]], state);
        hero.counters['sfy_second_queued'] = 1;
        hero.currentHp = 1;

        const damage = DamageCalculator.calculate(enemy, hero, 10, false, true);
        DamageCalculator.applyDamage(hero, damage, enemy, state);

        expect(hero.state).not.toBe('alive');
        expect(boomerangs(state, hero)).toHaveLength(0);
        expect(hero.counters['sfy_second_queued']).toBeUndefined();
        expect(hero.counters['sfy_extra_skill_only']).toBeUndefined();
    });
});
