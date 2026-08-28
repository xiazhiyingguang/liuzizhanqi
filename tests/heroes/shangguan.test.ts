import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { SkillSystem } from '../../src/core/skill-system';
import { GameEngine } from '../../src/core/game-engine';
import {
    findBrushAt,
    performShangguanDashSegment,
    hasShangguanDashOption,
    scanShangguanDashDirection,
    shangguanSkill1,
} from '../../src/data/extended-skills';
import { addHero, makeGameState } from '../helpers/game-state';
import { BoardEffect, GameState } from '../../src/types/game';

function loadBattleState(overrides: Record<string, unknown> = {}) {
    const state = makeGameState();
    useGameStore.setState({
        ...state,
        moveRange: [],
        skillRange: [],
        wukongSkill2State: undefined,
        suppressOnlineBroadcast: false,
        ...overrides,
    });
    return state;
}

function makeBrush(
    state: GameState,
    position: [number, number],
    owner: 'player1' | 'player2',
    sourceHeroId: string,
    id = `brush-test-${Math.random().toString(36).slice(2)}`
): BoardEffect {
    const brush: BoardEffect = {
        id,
        type: 'brush',
        position,
        owner,
        sourceHeroId,
        duration: 3,
    };
    state.boardEffects = [...(state.boardEffects ?? []), brush];
    return brush;
}

describe('上官婉儿笔走龙蛇：撞碎毛笔回收并刷新冲刺', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().resetGame();
    });

    it('落笔在棋盘上创建毛笔棋盘效果', () => {
        const state = makeGameState();
        const shangguan = addHero(state, 'shangguan', 'player1', [3, 3]);
        shangguan.counters['__extended_target'] = 3 * 6 + 5; // 落点 [3,5]

        const result = SkillSystem.executeSkill(shangguan, shangguanSkill1, [[3, 5]], state);

        expect(result.success).toBe(true);
        expect(findBrushAt(state, 3, 5)).toBeDefined();
    });

    it('冲刺撞碎毛笔：毛笔被回收，婉儿落到毛笔身后一格', () => {
        const state = makeGameState();
        const shangguan = addHero(state, 'shangguan', 'player1', [3, 2]);
        makeBrush(state, [3, 4], 'player1', shangguan.id, 'brush-A');

        const outcome = performShangguanDashSegment(shangguan, 0, 1, [], state);

        expect(outcome.success).toBe(true);
        expect(outcome.hitKind).toBe('brush');
        expect(outcome.hitId).toBe('brush-A');
        expect(outcome.damage).toBeUndefined();
        expect(findBrushAt(state, 3, 4)).toBeUndefined();
        expect(shangguan.position).toEqual([3, 5]);
    });

    it('撞碎毛笔不造成任何伤害（毛笔不是英雄目标）', () => {
        const state = makeGameState();
        const shangguan = addHero(state, 'shangguan', 'player1', [3, 2]);
        const enemy = addHero(state, 'baize', 'player2', [0, 0]);
        makeBrush(state, [3, 4], 'player1', shangguan.id);

        performShangguanDashSegment(shangguan, 0, 1, [], state);

        expect(enemy.currentHp).toBe(enemy.maxHp);
        expect(shangguan.currentHp).toBe(shangguan.maxHp);
    });

    it('场上所有毛笔（不同方向、不同距离、含对方落的）都可作为冲刺道具', () => {
        // 四个方向、不同距离、己方与对方落的毛笔逐一独立验证
        const cases: Array<{
            label: string;
            brushPos: [number, number];
            brushOwner: 'player1' | 'player2';
            dir: [number, number];
            expectLand: [number, number];
        }> = [
            { label: '右方1格对方毛笔', brushPos: [2, 3], brushOwner: 'player2', dir: [0, 1], expectLand: [2, 4] },
            { label: '左方3格己方毛笔（身后越界贴前格）', brushPos: [2, 0], brushOwner: 'player1', dir: [0, -1], expectLand: [2, 1] },
            { label: '上方2格己方毛笔（身后越界贴前格）', brushPos: [0, 2], brushOwner: 'player1', dir: [-1, 0], expectLand: [1, 2] },
            { label: '下方1格对方毛笔', brushPos: [4, 2], brushOwner: 'player2', dir: [1, 0], expectLand: [5, 2] },
        ];

        for (const c of cases) {
            const state = makeGameState();
            const shangguan = addHero(state, 'shangguan', 'player1', [2, 2]);
            const enemyShangguan = addHero(state, 'shangguan', 'player2', [0, 0]);
            const ownerId = c.brushOwner === 'player1' ? shangguan.id : enemyShangguan.id;
            makeBrush(state, c.brushPos, c.brushOwner, ownerId, 'brush-X');

            // 扫描可命中该毛笔（无论方向距离与落笔者阵营）
            expect(scanShangguanDashDirection(shangguan, c.dir[0], c.dir[1], [], state).ok).toBe(true);

            // 撞碎回收并落到正确落点
            const outcome = performShangguanDashSegment(shangguan, c.dir[0], c.dir[1], [], state);
            expect(outcome.success).toBe(true);
            expect(outcome.hitKind).toBe('brush');
            expect(findBrushAt(state, c.brushPos[0], c.brushPos[1])).toBeUndefined();
            expect(shangguan.position).toEqual(c.expectLand);

            // 回收后该方向无目标可冲
            expect(hasShangguanDashOption(shangguan, [], state)).toBe(false);
        }
    });

    it('撞碎的毛笔不可再次被撞（已从场上消失）', () => {
        const state = makeGameState();
        const shangguan = addHero(state, 'shangguan', 'player1', [3, 2]);
        makeBrush(state, [3, 4], 'player1', shangguan.id, 'brush-A');

        performShangguanDashSegment(shangguan, 0, 1, [], state);
        // 婉儿已落 [3,5]，毛笔 [3,4] 已消失：再往左冲无目标可命中
        const again = performShangguanDashSegment(shangguan, 0, -1, [], state);
        expect(again.success).toBe(false);
    });

    it('多段交互：撞敌人后撞毛笔刷新冲刺继续，毛笔被回收', () => {
        const state = makeGameState();
        const shangguan = addHero(state, 'shangguan', 'player1', [3, 2]);
        const enemy = addHero(state, 'baize', 'player2', [3, 4]);
        makeBrush(state, [1, 5], 'player1', shangguan.id, 'brush-B');
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined,
            suppressOnlineBroadcast: false,
            selectedHero: null,
            activeHero: null,
        });

        useGameStore.getState().selectHeroForAction(shangguan);
        useGameStore.getState().selectSkill('shangguan_skill2');
        // 第一段：向右撞敌人，落 [3,5]
        useGameStore.getState().executeSkill([3, 3]);

        expect(enemy.currentHp).toBe(enemy.maxHp - 6);
        expect(useGameStore.getState().shangguanDashState?.heroId).toBe(shangguan.id);
        expect(shangguan.position).toEqual([3, 5]);
        // 毛笔尚未被撞，仍在场上（boardEffects 更新在 store 根对象上）
        expect(findBrushAt(useGameStore.getState(), 1, 5)).toBeDefined();

        // 第二段：从 [3,5] 向上撞毛笔 [1,5]，回收后落 [0,5]
        useGameStore.getState().executeSkill([2, 5]);

        expect(findBrushAt(useGameStore.getState(), 1, 5)).toBeUndefined();
        expect(shangguan.position).toEqual([0, 5]);
        // store 的 boardEffects 同步刷新（UI 渲染依赖引用变化）
        expect(useGameStore.getState().boardEffects.some(e => e.id === 'brush-B')).toBe(false);
        // 场上无其他目标：冲刺链结束
        expect(useGameStore.getState().shangguanDashState).toBeUndefined();
        expect(shangguan.hasActedThisTurn).toBe(true);
    });

    it('多段交互：撞毛笔刷新冲刺并可衔接新方向的敌人', () => {
        const state = makeGameState();
        const shangguan = addHero(state, 'shangguan', 'player1', [3, 2]);
        const enemy = addHero(state, 'baize', 'player2', [3, 5]);
        makeBrush(state, [3, 4], 'player1', shangguan.id, 'brush-A');
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined,
            suppressOnlineBroadcast: false,
            selectedHero: null,
            activeHero: null,
        });

        useGameStore.getState().selectHeroForAction(shangguan);
        useGameStore.getState().selectSkill('shangguan_skill2');
        // 第一段：向右撞毛笔（毛笔 [3,4] 在敌人 [3,5] 前面）
        useGameStore.getState().executeSkill([3, 3]);

        // 毛笔被回收，婉儿落 [3,3]（毛笔身后是敌人 [3,5] 占据，停在毛笔前一格）
        expect(findBrushAt(useGameStore.getState(), 3, 4)).toBeUndefined();
        expect(useGameStore.getState().boardEffects.some(e => e.id === 'brush-A')).toBe(false);
        expect(shangguan.position).toEqual([3, 3]);
        expect(useGameStore.getState().shangguanDashState?.heroId).toBe(shangguan.id);

        // 第二段：刷新的冲刺继续向右撞敌人（现在 [3,4] 已空）
        useGameStore.getState().executeSkill([3, 4]);

        expect(enemy.currentHp).toBe(enemy.maxHp - 6);
        // 敌人 [3,5] 身后 [3,6] 越界：停在敌人前一格 [3,4]
        expect(shangguan.position).toEqual([3, 4]);
        // 场上无目标可冲：行动结束
        expect(useGameStore.getState().shangguanDashState).toBeUndefined();
        expect(shangguan.hasActedThisTurn).toBe(true);
    });

    it('行动结束后毛笔朝婉儿移动：未被撞碎回收的毛笔继续生效', () => {
        const state = makeGameState();
        const shangguan = addHero(state, 'shangguan', 'player1', [3, 3]);
        const brush = makeBrush(state, [3, 0], 'player1', shangguan.id, 'brush-live');
        const enemy = addHero(state, 'baize', 'player2', [3, 1]);

        GameEngine.endHeroAction(shangguan, state);

        // 毛笔朝婉儿移动1格到 [3,1]，敌人被毛笔掠过受6点固定伤害
        expect(brush.position).toEqual([3, 1]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 6);
    });
});
