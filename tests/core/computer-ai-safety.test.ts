import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseComputerSkillPlan, evaluateComputerBoard, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('AI 胜负优先级', () => {
    beforeEach(() => { setComputerAiDifficulty('master'); vi.spyOn(Math, 'random').mockReturnValue(.99); });
    afterEach(() => vi.restoreAllMocks());

    it.each(['moran', 'huifeng', 'bounty', 'hanjiangxue', 'wukong', 'changli'])('%s：胜负不能被账面血量盖过', id => {
        const state = makeGameState();
        const hero = addHero(state, id, 'player1', [2, 2]);
        hero.currentHp = 1;
        const enemy = addHero(state, 'zhenxiao', 'player2', [2, 3]);
        enemy.currentHp = enemy.maxHp = 10000;
        expect(evaluateComputerBoard({ ...state, phase: 'ended', winner: 'player1' }, 'player1')).toBeGreaterThan(100000);
        expect(evaluateComputerBoard({ ...state, phase: 'ended', winner: 'player2' }, 'player1')).toBeLessThan(-100000);
    });

    it.each(['moran', 'huifeng', 'guying', 'mowen', 'fengling'])('%s：拿下最后一名敌人获得终局优先级', id => {
        const state = makeGameState();
        const hero = addHero(state, id, 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        enemy.currentHp = 1;
        expect(chooseComputerSkillPlan(state, hero)?.score).toBeGreaterThan(100000);
        expect(state.phase).toBe('battle');
        expect(enemy.state).toBe(HeroState.ALIVE);
        expect(enemy.currentHp).toBe(1);
    });

    it('敌方还有替补时，击杀场上最后一人不冒充获胜', () => {
        const state = makeGameState({ player2BenchHeroIds: ['liuli'] });
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        enemy.currentHp = 1;
        const plan = chooseComputerSkillPlan(state, hero);
        expect(plan?.score).toBeGreaterThan(0);
        expect(plan?.score).toBeLessThan(100000);
    });

    it('骸骨君王孤身作战：不为击杀一个残血而赌自己全灭', () => {
        const state = makeGameState();
        const king = addHero(state, 'skeletonking', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        enemy.currentHp = 1;
        addHero(state, 'liuli', 'player2', [5, 5]);
        const dangerous = chooseComputerSkillPlan(state, king, king.skill1Id);
        expect(dangerous?.score).toBeLessThan(0);
        expect(chooseComputerSkillPlan(state, king)?.skillId).not.toBe(king.skill1Id);
        expect(king.state).toBe(HeroState.ALIVE);
    });

    it('敌方仍有排程复活时，不能把暂时清场当作终局', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        enemy.currentHp = 1;
        const scheduled = addHero(state, 'soul_lamp', 'player2', [5, 5]);
        state.board[5][5] = null;
        scheduled.position = null;
        scheduled.state = HeroState.TEMP_DEAD;
        scheduled.counters.soul_lamp_revive_round = state.roundNumber + 1;
        expect(chooseComputerSkillPlan(state, hero)?.score).toBeLessThan(100000);
    });
});
