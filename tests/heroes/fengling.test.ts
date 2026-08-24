import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { fenglingSkill1, fenglingSkill2 } from '../../src/data/extended-skills';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';

describe('风铃完整机制', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('技能1对未行动目标造成8伤并登记强制行动', () => {
        const state = makeGameState();
        const fengling = addHero(state, 'fengling', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);

        const result = SkillSystem.executeSkill(fengling, fenglingSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(result.damageDealt).toEqual([8]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
        expect(state.pendingForcedActionHeroId).toBe(enemy.id);
    });

    it('技能1对已行动目标伤害提高50%，且不会再次强制行动', () => {
        const state = makeGameState();
        const fengling = addHero(state, 'fengling', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        enemy.hasActedThisTurn = true;

        const result = SkillSystem.executeSkill(fengling, fenglingSkill1, [[2, 3]], state);

        expect(result.damageDealt).toEqual([12]);
        expect(state.pendingForcedActionHeroId).toBeUndefined();
    });

    it('强制行动会锁定目标，消耗其正常行动后把控制权交还', () => {
        const state = makeGameState();
        const fengling = addHero(state, 'fengling', 'player1', [2, 2]);
        addHero(state, 'moran', 'player1', [4, 0]);
        const forcedEnemy = addHero(state, 'baize', 'player2', [2, 3]);
        const otherEnemy = addHero(state, 'zhenxiao', 'player2', [4, 5]);

        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            suppressOnlineBroadcast: false,
        });
        useGameStore.getState().selectHeroForAction(fengling);
        useGameStore.getState().selectSkill(fengling.skill1Id);
        useGameStore.getState().executeSkill([2, 3]);

        let current = useGameStore.getState();
        expect(current.currentPlayer).toBe('player2');
        expect(current.activeHero?.id).toBe(forcedEnemy.id);
        expect(current.selectedHero?.id).toBe(forcedEnemy.id);
        expect(forcedEnemy.hasActedThisTurn).toBe(false);

        useGameStore.getState().selectHeroForAction(otherEnemy);
        current = useGameStore.getState();
        expect(current.activeHero?.id).toBe(forcedEnemy.id);
        expect(current.selectedHero?.id).toBe(forcedEnemy.id);

        useGameStore.getState().endHeroAction();
        current = useGameStore.getState();
        expect(forcedEnemy.hasActedThisTurn).toBe(true);
        expect(current.currentPlayer).toBe('player1');
        expect(current.activeHero).toBeNull();
    });

    it('连续命中同一目标从第二次开始叠猎砂，切换目标会重置连续判定', () => {
        const state = makeGameState();
        const fengling = addHero(state, 'fengling', 'player1', [2, 2]);
        const firstEnemy = addHero(state, 'baize', 'player2', [2, 3]);
        const secondEnemy = addHero(state, 'moran', 'player2', [3, 2]);
        firstEnemy.hasActedThisTurn = true;
        secondEnemy.hasActedThisTurn = true;

        SkillSystem.executeSkill(fengling, fenglingSkill1, [[2, 3]], state);
        expect(EffectManager.getCounter(fengling, '猎砂')).toBe(0);
        SkillSystem.executeSkill(fengling, fenglingSkill1, [[2, 3]], state);
        expect(EffectManager.getCounter(fengling, '猎砂')).toBe(1);
        SkillSystem.executeSkill(fengling, fenglingSkill1, [[3, 2]], state);
        expect(EffectManager.getCounter(fengling, '猎砂')).toBe(1);
        SkillSystem.executeSkill(fengling, fenglingSkill1, [[3, 2]], state);
        expect(EffectManager.getCounter(fengling, '猎砂')).toBe(2);
    });

    it('沙丘以自身为中心持续2回合，并提供30%攻击增伤', () => {
        const state = makeGameState();
        const fengling = addHero(state, 'fengling', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);

        const field = SkillSystem.executeSkill(fengling, fenglingSkill2, [[2, 2]], state);
        expect(field.success).toBe(true);
        expect(state.boardEffects).toEqual([
            expect.objectContaining({
                type: 'sand-dune',
                position: [2, 2],
                sourceHeroId: fengling.id,
                duration: 2,
            }),
        ]);

        const attack = SkillSystem.executeSkill(fengling, fenglingSkill1, [[2, 3]], state);
        expect(attack.damageDealt).toEqual([10]);

        GameEngine.startNewTurn(state);
        expect(state.boardEffects?.[0].duration).toBe(1);
        GameEngine.startNewTurn(state);
        expect(state.boardEffects).toEqual([]);
    });

    it('在沙丘中每次实际受伤累积20%闪避，闪避后不继续叠层', () => {
        const state = makeGameState();
        const fengling = addHero(state, 'fengling', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        SkillSystem.executeSkill(fengling, fenglingSkill2, [[2, 2]], state);

        const first = DamageCalculator.calculate(enemy, fengling, 5, false);
        DamageCalculator.applyDamage(fengling, first, enemy, state);
        expect(fengling.currentHp).toBe(40);
        expect(EffectManager.getCounter(fengling, '沙丘闪避')).toBe(1);

        vi.mocked(Math.random).mockReturnValue(0.1);
        const second = DamageCalculator.calculate(enemy, fengling, 5, false);
        DamageCalculator.applyDamage(fengling, second, enemy, state);
        expect(second.finalDamage).toBe(0);
        expect(fengling.currentHp).toBe(40);
        expect(EffectManager.getCounter(fengling, '沙丘闪避')).toBe(1);
    });

    it('猎砂提供攻击与暴击，并可闪避致命伤害后折半', () => {
        const state = makeGameState();
        const fengling = addHero(state, 'fengling', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        EffectManager.setCounter(fengling, '猎砂', 4);

        vi.mocked(Math.random).mockReturnValue(0.79);
        const lethal = DamageCalculator.calculate(enemy, fengling, 100, false);
        DamageCalculator.applyDamage(fengling, lethal, enemy, state);

        expect(lethal.finalDamage).toBe(0);
        expect(fengling.currentHp).toBe(45);
        expect(EffectManager.getCounter(fengling, '猎砂')).toBe(2);
    });

    it('天威获得2层猎砂，并以成长后的基础攻击追击最近敌人', () => {
        const state = makeGameState();
        const fengling = addHero(state, 'fengling', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        const nearest = addHero(state, 'baize', 'player2', [2, 4]);
        addHero(state, 'zhenxiao', 'player2', [5, 5]);
        victim.currentHp = 1;

        SkillSystem.executeSkill(fengling, fenglingSkill1, [[2, 3]], state);

        expect(EffectManager.getCounter(fengling, '猎砂')).toBe(2);
        expect(nearest.currentHp).toBe(nearest.maxHp - 11);
        expect(state.battleLog.some(log => log.type === 'tianwei' && log.message.includes(nearest.name))).toBe(true);
    });
});
