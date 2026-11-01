import { afterEach, describe, expect, it, vi } from 'vitest';
import { withAiSimulationRandom } from '../../src/core/ai-simulation-random';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { chooseComputerSkillPlan, scoreComputerPosition, setComputerAiDifficulty, simulateComputerMove } from '../../src/core/computer-ai';
import { addHero, makeGameState } from '../helpers/game-state';

afterEach(() => vi.restoreAllMocks());

describe('AI 的概率估算不扰动实战随机数', () => {
    it('同样的种子与样本可复现，不同样本分层；原随机流零消耗', () => {
        const real = vi.spyOn(Math, 'random').mockReturnValue(.9);
        const sample = (index: number) => withAiSimulationRandom(123, index, 3, () => [Math.random(), Math.random()]);
        expect(sample(0)).toEqual(sample(0));
        expect(sample(1)).not.toEqual(sample(0));
        expect(real).not.toHaveBeenCalled();
        expect(Math.random).toBe(real);
    });

    it('嵌套及异常也还原随机流', () => {
        const real = Math.random;
        expect(() => withAiSimulationRandom(10, 0, 3, () => {
            const outer = Math.random;
            withAiSimulationRandom(20, 1, 3, () => Math.random());
            expect(Math.random).toBe(outer);
            throw new Error('simulation failure');
        })).toThrow('simulation failure');
        expect(Math.random).toBe(real);
    });

    it.each([0, .2, .5, 1])('暴击率 %s 的估伤按均值计算，不掷骰；真实攻击照常掷骰', chance => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        enemy.defense = 0;
        hero.effects.push({ id: 'crit', type: 'buff', name: '暴击率', duration: 1, sourceHeroId: hero.id, value: chance });
        const real = vi.spyOn(Math, 'random').mockReturnValue(.99);
        const estimated = DamageCalculator.calculate(hero, enemy, 20, false, false, { expectedCrit: true });
        expect(estimated.finalDamage).toBe(Math.floor(20 * (1 + chance * .5)));
        expect(estimated.isCrit).toBe(false);
        expect(real).not.toHaveBeenCalled();
        const actual = DamageCalculator.calculate(hero, enemy, 20);
        expect(real).toHaveBeenCalledOnce();
        expect(actual.isCrit).toBe(chance === 1);
    });

    it.each(['moran', 'wukong', 'schrodinger', 'lilith', 'skeletonking'])('%s：相同局面的候选分不随外部随机数变化', id => {
        setComputerAiDifficulty('master');
        const state = makeGameState();
        const hero = addHero(state, id, 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 3]);
        addHero(state, 'liuli', 'player2', [3, 3]);
        const real = vi.spyOn(Math, 'random').mockReturnValue(.01);
        const first = { candidates: [], chosen: null };
        chooseComputerSkillPlan(state, hero, undefined, first);
        real.mockReturnValue(.99);
        const second = { candidates: [], chosen: null };
        chooseComputerSkillPlan(state, hero, undefined, second);
        expect(first.candidates.length).toBeGreaterThan(0);
        expect(first.candidates).toEqual(second.candidates);
    });

    it('站位估算与移动预测完全不消耗实战随机流', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        addHero(state, 'wukong', 'player2', [4, 4]);
        const real = vi.spyOn(Math, 'random').mockReturnValue(.5);
        scoreComputerPosition(state, hero, [2, 3]);
        simulateComputerMove(state, hero, [2, 3]);
        expect(real).not.toHaveBeenCalled();
    });
});
