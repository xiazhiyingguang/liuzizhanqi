import { afterEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { addHero, makeGameState } from '../helpers/game-state';

describe('冰冻/眩晕持续机制', () => {
    afterEach(() => vi.restoreAllMocks());

    it('未行动目标被冰冻：duration 1，下一回合开始解除（恰好剥夺本回合）', () => {
        const state = makeGameState();
        const source = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        target.hasActedThisTurn = false;
        DamageCalculator.applyHantianStacks(target, 3, source.id, state);
        const freeze = target.effects.find(effect => effect.name === '冰冻');
        expect(freeze).toBeTruthy();
        expect(freeze!.duration).toBe(1);
        expect(EffectManager.isStunned(target)).toBe(true);
        // 下一回合开始：冰冻解除，可正常行动
        GameEngine.startNewTurn(state);
        expect(target.effects.some(effect => effect.name === '冰冻')).toBe(false);
        expect(EffectManager.isStunned(target)).toBe(false);
    });

    it('已行动目标被冰冻：duration 2，下回合不能动，下下回合解除（恰好剥夺1次行动）', () => {
        const state = makeGameState();
        const source = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        target.hasActedThisTurn = true;
        DamageCalculator.applyHantianStacks(target, 3, source.id, state);
        const freeze = target.effects.find(effect => effect.name === '冰冻');
        expect(freeze).toBeTruthy();
        expect(freeze!.duration).toBe(2);
        // 下一回合：仍被冰冻（剥夺行动）
        GameEngine.startNewTurn(state);
        expect(EffectManager.isStunned(target)).toBe(true);
        // 下下回合：解除
        GameEngine.startNewTurn(state);
        expect(EffectManager.isStunned(target)).toBe(false);
    });

    it('英雄X技能1行动中施加的震怒眩晕按已行动状态决定持续时间', () => {
        const state = makeGameState();
        const heroX = addHero(state, 'hero_x', 'player1', [2, 2]);
        const target = addHero(state, 'moran', 'player2', [2, 3]);
        // 未行动目标：duration 1
        target.hasActedThisTurn = false;
        EffectManager.addEffect(target, {
            type: 'debuff', name: '震怒', duration: -1, stackCount: 3,
            sourceHeroId: heroX.id, description: '',
        });
        DamageCalculator.resolveThreeStackControl(target, '震怒', heroX.id);
        const stun = target.effects.find(effect => effect.name === '震怒眩晕');
        expect(stun).toBeTruthy();
        expect(stun!.duration).toBe(1);
    });

    it('英雄X回合末被动施加的震怒眩晕保持 duration 2（剥夺下回合）', () => {
        const state = makeGameState();
        const heroX = addHero(state, 'hero_x', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 4]);
        // 预置 2 层震怒，回合末叠到 3 层触发眩晕
        EffectManager.addEffect(enemy, {
            type: 'debuff', name: '震怒', duration: -1, stackCount: 2,
            sourceHeroId: heroX.id, description: '',
        });
        // 双方英雄都已行动，结束最后一个英雄的行动触发 endTurn -> 回合末效果
        heroX.hasActedThisTurn = true;
        enemy.hasActedThisTurn = true;
        GameEngine.endHeroAction(enemy, state);
        const stun = enemy.effects.find(effect => effect.name === '震怒眩晕');
        expect(stun).toBeTruthy();
        // 回合末施加 duration 2，endTurn 内部 startNewTurn 已递减为 1：下回合仍被眩晕（剥夺1次行动）
        expect(stun!.duration).toBe(1);
        expect(EffectManager.isStunned(enemy)).toBe(true);
        // 再下一回合：解除
        GameEngine.startNewTurn(state);
        expect(EffectManager.isStunned(enemy)).toBe(false);
    });
});
