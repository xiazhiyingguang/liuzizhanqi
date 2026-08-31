import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';
import type { Position } from '../../src/types/game';

const samePositions = (list: Position[], expected: Position[]) =>
    list.length === expected.length &&
    expected.every(([r, c]) => list.some(([x, y]) => x === r && y === c));

describe('凋零之主·凋零播撒两步选区交互', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
    });

    it('第一角选定后范围收窄为四个对角格，第二角点击才真实施放', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const state = makeGameState();
        const wither = addHero(state, 'wither_lord', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        useGameStore.setState({
            ...state,
            selectedHero: wither,
            currentPlayer: 'player1',
        });

        // 全场技能：选技后全部 36 格可选
        useGameStore.getState().selectSkill('wither_lord_skill1');
        expect(useGameStore.getState().skillRange).toHaveLength(36);

        // 第一步：点第一角 → 只记录、不收窄外不释放
        useGameStore.getState().executeSkill([2, 2]);
        expect(useGameStore.getState().pendingSkillTargetPositions).toEqual([[2, 2]]);
        expect(enemy.currentHp).toBe(enemy.maxHp);
        // 高亮收窄为能与 (2,2) 构成 2x2 的四个对角格
        expect(samePositions(useGameStore.getState().skillRange, [
            [1, 1], [1, 3], [3, 1], [3, 3],
        ])).toBe(true);

        // 直接调 store 点非对角格（绕过 UI 的兜底）：被拒绝，保持等待
        useGameStore.getState().executeSkill([0, 5]);
        expect(useGameStore.getState().pendingSkillTargetPositions).toEqual([[2, 2]]);
        expect(enemy.currentHp).toBe(enemy.maxHp);

        // 第二步：点对角格 → 确认释放，2x2 内敌人受击并挂凋零
        useGameStore.getState().executeSkill([3, 3]);
        expect(enemy.currentHp).toBeLessThan(enemy.maxHp);
        expect(enemy.effects.some(effect => effect.name === '凋零')).toBe(true);
        expect(useGameStore.getState().pendingSkillTargetPositions).toHaveLength(0);
        vi.restoreAllMocks();
    });

    it('边缘第一角只收窄出界内对角格', () => {
        const state = makeGameState();
        const wither = addHero(state, 'wither_lord', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [1, 1]);
        useGameStore.setState({ ...state, selectedHero: wither, currentPlayer: 'player1' });

        useGameStore.getState().selectSkill('wither_lord_skill1');
        useGameStore.getState().executeSkill([0, 0]);
        expect(useGameStore.getState().skillRange).toEqual([[1, 1]]);
    });

    it('重新选择技能会清空半程选择，可换点第一角重来', () => {
        const state = makeGameState();
        const wither = addHero(state, 'wither_lord', 'player1', [0, 0]);
        useGameStore.setState({ ...state, selectedHero: wither, currentPlayer: 'player1' });

        useGameStore.getState().selectSkill('wither_lord_skill1');
        useGameStore.getState().executeSkill([2, 2]);
        expect(useGameStore.getState().pendingSkillTargetPositions).toHaveLength(1);

        useGameStore.getState().selectSkill('wither_lord_skill1');
        expect(useGameStore.getState().pendingSkillTargetPositions).toHaveLength(0);
        expect(useGameStore.getState().skillRange).toHaveLength(36);
    });
});
