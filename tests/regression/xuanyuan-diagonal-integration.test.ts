import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHero, makeGameState } from '../helpers/game-state';
import { getLeapsUsed, setLeapsUsed } from '../../src/core/xuanyuan-form';
import { getFlyingSwords, getXuanyuanLeapCells, placeFlyingSword } from '../../src/core/flying-sword';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState } from '../../src/services/online-state';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { simulateComputerMove, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { MovementSystem } from '../../src/core/movement-system';
import { getSkill } from '../../src/data/skills';

beforeEach(() => {
    useGameStore.getState().resetGame();
    setComputerAiDifficulty('master');
    vi.spyOn(Math, 'random').mockReturnValue(.99);
});
afterEach(() => { useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

function scene() {
    const state = makeGameState({ boardEffects: [] });
    const hero = addHero(state, 'xuanyuan', 'player1', [2, 2]);
    hero.counters['昭神'] = 1;
    const enemy = addHero(state, 'moran', 'player2', [2, 4]);
    enemy.currentHp = enemy.maxHp = 100;
    addHero(state, 'baize', 'player2', [5, 5]);
    return { state, hero, enemy };
}

describe('轩辕对角连跳执行、模拟及联机', () => {
    it('一格首跳直接落地，续跳踩漂移后的剑，三跳后正常交出控制权', () => {
        const { state, hero, enemy } = scene();
        placeFlyingSword(state, hero, [0, 3]);
        placeFlyingSword(state, hero, [2, 0]);
        useGameStore.setState({ ...state, isOnlineMode: false, isAiMode: false });
        useGameStore.getState().selectHeroForAction(hero);
        useGameStore.getState().selectSkill(hero.skill1Id);
        useGameStore.getState().executeSkill([1, 3]);
        expect(hero.position).toEqual([1, 3]);
        expect(hero.counters.__xuanyuan_leap_start).toBeUndefined();
        expect(enemy.currentHp).toBeLessThan(100);
        expect(getLeapsUsed(hero)).toBe(1);
        expect(getXuanyuanLeapCells(hero, useGameStore.getState())).toContainEqual([0, 4]);
        useGameStore.getState().executeSkill([0, 4]);
        expect(hero.position).toEqual([0, 4]);
        expect(getLeapsUsed(hero)).toBe(2);
        expect(getXuanyuanLeapCells(hero, useGameStore.getState())).toContainEqual([2, 2]);
        useGameStore.getState().executeSkill([2, 2]);
        expect(hero.position).toEqual([2, 2]);
        expect(hero.hasActedThisTurn).toBe(true);
        expect(useGameStore.getState().currentPlayer).toBe('player2');
        expect(getLeapsUsed(hero)).toBe(0);
        expect(useGameStore.getState().skillRange).toEqual([]);
    });

    it('AI 续跳只点击一次合法落点，不再遗留旧的两段起笔流程', () => {
        const { state, hero } = scene();
        state.board[2][4] = null;
        const enemy = state.player2Heroes[0];
        enemy.position = [0, 1];
        state.board[0][1] = enemy;
        setLeapsUsed(hero, 1);
        placeFlyingSword(state, hero, [1, 1]);
        useGameStore.setState({ ...state, isAiMode: true, isOnlineMode: false,
            activeHero: hero, selectedHero: hero, selectedSkill: getSkill(hero.skill1Id)!, skillRange: [[1, 1]], moveRange: [] });
        runComputerBattleStep('player1');
        expect(hero.position).toEqual([1, 1]);
        expect(enemy.currentHp).toBeLessThan(100);
    });

    it('AI 普通移动模拟也会漂移飞剑，但不修改真盘或消耗实战随机数', () => {
        const { state, hero } = scene();
        placeFlyingSword(state, hero, [2, 3]);
        const before = structuredClone(state);
        vi.mocked(Math.random).mockClear();
        const simulated = simulateComputerMove(state, hero, [1, 1])!;
        expect(simulated).not.toBeNull();
        const sword = getFlyingSwords(simulated, hero.id)[0];
        expect(Math.abs(sword.position[0] - 2) + Math.abs(sword.position[1] - 3)).toBe(1);
        expect(sword.prevPosition).toEqual([2, 3]);
        expect(state).toEqual(before);
        expect(Math.random).not.toHaveBeenCalled();
    });

    it('技能或外部造成的移动不冒充主动走位，不触发飞剑漂移', () => {
        const { state, hero } = scene();
        placeFlyingSword(state, hero, [2, 3]);
        expect(MovementSystem.moveHero(hero, [1, 1], state, { skillMovement: true })).toBe(true);
        expect(getFlyingSwords(state, hero.id)[0].position).toEqual([2, 3]);
    });

    it('联机快照保留飞剑撤回坐标，接收后撤回仍恢复本次起点', () => {
        const { state, hero } = scene();
        placeFlyingSword(state, hero, [2, 3]);
        useGameStore.setState({ ...state, isOnlineMode: false, selectedHero: hero, activeHero: hero, moveRange: [] });
        useGameStore.getState().moveHero([1, 1]);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        const received = useGameStore.getState();
        expect(received.boardEffects?.[0].prevPosition).toEqual([2, 3]);
        useGameStore.getState().undoMove();
        expect(received.player1Heroes[0].position).toEqual([2, 2]);
        expect(getFlyingSwords(useGameStore.getState(), hero.id)[0].position).toEqual([2, 3]);
    });
});
