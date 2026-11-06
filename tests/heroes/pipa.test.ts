import { afterEach, describe, expect, it } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { triggerPipaEntrance } from '../../src/core/pipa';
import { SkillSystem } from '../../src/core/skill-system';
import { pipaSkill1, pipaSkill2 } from '../../src/data/extended-skills';
import { applyServerGameState } from '../../src/services/online-state';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import type { Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

afterEach(() => useGameStore.getState().resetGame());

describe('五弦琵琶', () => {
    it('音符逐段增加和弦，下一回合清除，致知成长在断弦后保留', () => {
        const state = makeGameState();
        const pipa = addHero(state, 'pipa', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        enemy.defense = 0;
        grantZhizhi(pipa, 1);
        grantZhizhi(pipa, 2);
        grantZhizhi(pipa, 3);
        expect(pipa.baseAttack).toBe(12);
        expect(SkillSystem.executeSkill(pipa, pipaSkill1, [[2, 3]], state).success).toBe(true);
        expect(EffectManager.getEffect(ally, '音符')?.duration).toBe(1);
        DamageCalculator.asOneAttack(() => {
            for (let i = 0; i < 2; i++) {
                const damage = DamageCalculator.calculate(ally, enemy, 3, false, false, { canCrit: false });
                DamageCalculator.applyDamage(enemy, damage, ally, state);
            }
        });
        expect(enemy.maxHp - enemy.currentHp).toBe(12);
        expect(pipa.counters['和弦']).toBe(2);
        expect(pipa.baseAttack).toBe(14);
        EffectManager.updateEffectDurations(state);
        expect(EffectManager.hasEffect(ally, '音符')).toBe(false);
        expect(SkillSystem.executeSkill(pipa, pipaSkill2, [[2, 4]], state).damageDealt).toEqual([8]);
        expect(pipa.counters['和弦']).toBe(0);
        expect(pipa.baseAttack).toBe(14);
    });

    it.each([0, 1, 5])('行动结束时 %i 名邻近友方按人数回血，自己不计入', count => {
        const state = makeGameState();
        const pipa = addHero(state, 'pipa', 'player1', [2, 2]);
        pipa.currentHp = 25;
        const neighbors: Position[] = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 3]];
        for (const pos of neighbors.slice(0, count)) addHero(state, 'moran', 'player1', pos);
        addHero(state, 'baize', 'player2', [3, 2]);
        GameEngine.endHeroAction(pipa, state);
        expect(pipa.currentHp).toBe(25 + Math.min(8, count * 2));
    });

    it('开战确认后每方只触发一次，联机快照保留神威记录', () => {
        useGameStore.getState().resetGame();
        const state = makeGameState({ phase: 'deploy', player1ReadyDeploy: false, player2ReadyDeploy: false });
        const pipa = addHero(state, 'pipa', 'player1', [0, 0]);
        for (let row = 1; row < 4; row++) addHero(state, 'moran', 'player1', [row, 0]);
        for (let row = 0; row < 4; row++) addHero(state, 'baize', 'player2', [row, 5]);
        useGameStore.setState(state);
        expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
        expect(pipa.effects).toHaveLength(0);
        expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);
        const live = useGameStore.getState();
        expect(pipa.tianweiId).toBe('');
        expect(live.pipaEntranceTriggered).toEqual({ player1: true });
        expect(live.player1Heroes.every(hero => EffectManager.getEffect(hero, '神威·攻击提升')?.value === 0.2)).toBe(true);
        expect(live.player2Heroes.some(hero => EffectManager.hasEffect(hero, '神威·攻击提升'))).toBe(false);
        triggerPipaEntrance(pipa, live);
        expect(pipa.effects.filter(effect => effect.name === '神威·攻击提升')).toHaveLength(1);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(live)));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        expect(useGameStore.getState().pipaEntranceTriggered).toEqual({ player1: true });
    });

    it('作为替补首次上场也会给当前队友增加攻击力', () => {
        useGameStore.getState().resetGame();
        const state = makeGameState({ reinforcingPlayer: 'player1', player1BenchHeroIds: ['pipa'] });
        const ally = addHero(state, 'moran', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 5]);
        ally.baseAttack = 10;
        enemy.defense = 0;
        const attack = () => DamageCalculator.calculate(ally, enemy, 0, true, false, { canCrit: false }).finalDamage;
        const baseline = attack();
        useGameStore.setState(state);
        expect(useGameStore.getState().selectReinforcementHero('pipa')).toBe(true);
        expect(useGameStore.getState().deployReinforcement([0, 1])).toBe(true);
        expect(attack() - baseline).toBe(2);
        expect(useGameStore.getState().pipaEntranceTriggered?.player1).toBe(true);
    });
});
