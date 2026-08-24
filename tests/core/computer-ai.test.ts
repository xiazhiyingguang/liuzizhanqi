import { describe, expect, it } from 'vitest';
import { AVAILABLE_HERO_IDS, getHeroInfo } from '../../src/data/heroes';
import { getHeroAbilityRatings } from '../../src/data/hero-ratings';
import {
    chooseComputerDeployment,
    chooseComputerMove,
    chooseComputerSkillPlan,
    chooseComputerTeam,
    scoreComputerPosition,
} from '../../src/core/computer-ai';
import { addHero, makeGameState } from '../helpers/game-state';

describe('computer AI', () => {
    it('针对玩家阵容选择六名有效且职责完整的英雄（四人首发加两人替补）', () => {
        const team = chooseComputerTeam(['moran', 'huifeng', 'mirror', 'nightowl']);
        const ratings = team.map(id => getHeroAbilityRatings(getHeroInfo(id).name)!);

        expect(team).toHaveLength(6);
        expect(new Set(team).size).toBe(6);
        expect(team.every(id => AVAILABLE_HERO_IDS.includes(id))).toBe(true);
        expect(Math.max(...ratings.map(item => item.输出))).toBeGreaterThanOrEqual(8);
        expect(Math.max(...ratings.map(item => item.生存))).toBeGreaterThanOrEqual(8);
        expect(Math.max(...ratings.map(item => item.支援))).toBeGreaterThanOrEqual(8);
    });

    it('把电脑四名英雄部署到右半区的四个不同位置', () => {
        const state = makeGameState();
        addHero(state, 'moran', 'player1', [2, 0]);
        addHero(state, 'huifeng', 'player1', [3, 1]);
        const team = ['changli', 'liuli', 'baize', 'nightowl'];
        const deployment = chooseComputerDeployment(team, state.player1Heroes);

        expect(deployment).toHaveLength(4);
        expect(new Set(deployment.map(item => item.position.join(','))).size).toBe(4);
        expect(deployment.every(item => item.position[1] >= 3 && item.position[1] < 6)).toBe(true);
        expect(new Set(deployment.map(item => item.heroId))).toEqual(new Set(team));
    });

    it('发现并选择可以直接击杀低生命敌人的技能目标', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'moran', 'player2', [2, 3]);
        const target = addHero(state, 'baize', 'player1', [2, 2]);
        target.currentHp = 4;

        const plan = chooseComputerSkillPlan(state, caster);

        expect(plan).not.toBeNull();
        expect(plan?.targetPositions).toContainEqual([2, 2]);
        expect(plan?.score).toBeGreaterThan(50);
    });

    it('带厚盾的低血量目标不会被当作可斩杀目标（有效血量计算护盾）', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'moran', 'player2', [2, 3]);
        // 残血但带厚盾：1 血 + 30 盾，墨阑技能2 基础 15 伤（暴击约 22）也无法击穿
        const shielded = addHero(state, 'baize', 'player1', [2, 2]);
        shielded.currentHp = 1;
        shielded.shield = 30;
        // 无盾残血：3 血，墨阑 8 伤必杀
        const killable = addHero(state, 'changli', 'player1', [2, 4]);
        killable.currentHp = 3;

        const plan = chooseComputerSkillPlan(state, caster);

        expect(plan).not.toBeNull();
        expect(plan?.targetPositions[0]).toEqual([2, 4]);
    });

    it('残血英雄的走位会避开敌方伤害技能的射程', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const hero = addHero(state, 'huifeng', 'player2', [3, 3]);
        hero.currentHp = 6;
        // 莫问技能1/2 都是一格范围（3x3，含对角），12 伤可以秒杀 6 血回锋
        addHero(state, 'mowen', 'player1', [2, 2]);

        const inRange = scoreComputerPosition(state, hero, [3, 3]);
        const outOfRange = scoreComputerPosition(state, hero, [5, 3]);

        expect(outOfRange).toBeGreaterThan(inRange);
    });

    it('冷却中的技能不会被选入技能计划', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'mowen', 'player2', [2, 3]);
        addHero(state, 'baize', 'player1', [2, 2]);
        caster.counters['mowen_skill1_cd'] = 2;

        const plan = chooseComputerSkillPlan(state, caster);

        expect(plan).not.toBeNull();
        expect(plan?.skillId).not.toBe('mowen_skill1');
    });

    it('技能射程外时 AI 会放置冰晶封锁敌方走位', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'hanjiangxue', 'player2', [2, 5]);
        addHero(state, 'baize', 'player1', [2, 1]);

        const plan = chooseComputerSkillPlan(state, caster);

        expect(plan).not.toBeNull();
        expect(plan?.skillId).toBe('hanjiangxue_skill2');
    });

    it('没有攻击距离时会向敌人推进而不是原地结束', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const caster = addHero(state, 'moran', 'player2', [2, 5]);
        addHero(state, 'baize', 'player1', [2, 0]);

        const move = chooseComputerMove(state, caster);

        expect(move).not.toBeNull();
        expect(move?.[1]).toBeLessThan(5);
    });
});
