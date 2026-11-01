import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseComputerMove, simulateComputerMove } from '../../src/core/computer-ai';
import { addDilanFeather } from '../../src/data/extended-heroes';
import { mirrorSkill1 } from '../../src/data/skills';
import { youjunSkill2 } from '../../src/data/extended-skills';
import { placeHook } from '../../src/core/water-marsh';
import { setStance, hasStance } from '../../src/core/mountain-stance';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('AI 移动预测复用真实移动规则', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(.99));
    afterEach(() => vi.restoreAllMocks());

    it('镜：本体与镜像必须一起移动，原盘位置和血量不变', () => {
        const state = makeGameState();
        const hero = addHero(state, 'mirror', 'player1', [2, 1]);
        addHero(state, 'baize', 'player2', [0, 0]);
        mirrorSkill1.execute!(hero, [], state);
        const before = structuredClone(state);
        const predicted = simulateComputerMove(state, hero, [2, 2])!;
        expect(predicted.board[2][2]?.id).toBe(hero.id);
        expect(predicted.board[3][3]?.counters.__isClone).toBe(1);
        expect(predicted.board[3][4]).toBeNull();
        expect(state).toEqual(before);
    });

    it.each(['moran', 'huifeng', 'baize'])('%s：走过敌方风刃会扣血、消耗风刃，不能当无成本瞬移', id => {
        const state = makeGameState();
        const youjun = addHero(state, 'youjun', 'player2', [2, 2]);
        const hero = addHero(state, id, 'player1', [5, 2]);
        youjunSkill2.execute!(youjun, [], state);
        const predicted = simulateComputerMove(state, hero, [3, 2])!;
        expect(predicted.board[3][2]?.currentHp).toBe(hero.maxHp - 4);
        expect(predicted.boardEffects?.some(effect => effect.type === 'wind-blade' && effect.position.join() === '3,2')).toBe(false);
        expect(hero.currentHp).toBe(hero.maxHp);
        expect(state.boardEffects?.filter(effect => effect.type === 'wind-blade')).toHaveLength(4);
    });

    it('游隼：移动收回自己的风刃，正确刷新疾掠并累计路径', () => {
        const state = makeGameState();
        const hero = addHero(state, 'youjun', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [5, 5]);
        youjunSkill2.execute!(hero, [], state);
        const predicted = simulateComputerMove(state, hero, [2, 3])!;
        expect(predicted.board[2][3]?.counters.youjun_skill1_refreshed).toBe(1);
        expect(predicted.board[2][3]?.counters.youjun_moved_path).toBe(1);
    });

    it('帝兰羽化：走两格的固定受伤必须进预测，包括途中死亡', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player2', [5, 5]);
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addDilanFeather(hero, dilan);
        hero.currentHp = 1;
        const predicted = simulateComputerMove(state, hero, [0, 2])!;
        expect(predicted.player1Heroes[0].state).not.toBe(HeroState.ALIVE);
        expect(hero.currentHp).toBe(1);
        expect(hero.state).toBe(HeroState.ALIVE);
        expect(chooseComputerMove(state, hero)).toBeNull();
    });

    it('寒江雪：拾取冰晶会移除冰晶并获得冰甲', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        const snow = addHero(state, 'hanjiangxue', 'player1', [5, 5]);
        addHero(state, 'baize', 'player2', [0, 0]);
        state.boardEffects = [{ id: 'ice', type: 'ice-crystal', position: [2, 3], owner: 'player1', sourceHeroId: snow.id, duration: 2 }];
        const predicted = simulateComputerMove(state, hero, [2, 3])!;
        expect(predicted.board[2][3]?.effects.some(effect => effect.name === '冰甲')).toBe(true);
        expect(predicted.boardEffects).toHaveLength(0);
        expect(hero.effects.some(effect => effect.name === '冰甲')).toBe(false);
    });

    it('姜太公：经过鱼钩会进入抛掷挂起，不能继续假设原落点施法', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 1]);
        const fisher = addHero(state, 'jiangtaigong', 'player2', [5, 5]);
        placeHook(state, fisher, [2, 2]);
        const predicted = simulateComputerMove(state, hero, [2, 2])!;
        expect(predicted.pendingBoardAction?.type).toBe('jiangtaigong-hook');
        expect(state.pendingBoardAction).toBeUndefined();
    });

    it('岱宗：移动后镇守失效，原盘仍保留镇守', () => {
        const state = makeGameState();
        const hero = addHero(state, 'daizong', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [5, 5]);
        setStance(hero, 1);
        const predicted = simulateComputerMove(state, hero, [2, 3])!;
        expect(hasStance(predicted.player1Heroes[0])).toBe(false);
        expect(hasStance(hero)).toBe(true);
    });
});
