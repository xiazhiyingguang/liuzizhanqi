import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import type { BoardEffect } from '../../src/types/game';

/**
 * 回归：重开对局的状态隔离。
 *
 * 历史漏洞：initialState 曾是模块级共享常量，而引擎在局内会原地修改这些容器
 * （如冰晶技能直接 push 进 boardEffects 数组）。initGame/resetGame 展开同一个
 * 常量时，第一局写入的数组/对象引用被原样带进第二局——
 * 典型症状：第二轮游戏棋盘上残留上一局的雪花（冰晶）等区域效果图标。
 */
describe('重开对局的状态隔离', () => {
    const crystal: BoardEffect = {
        id: 'ice-crystal-test-0',
        type: 'ice-crystal',
        position: [2, 2],
        owner: 'player1',
        sourceHeroId: 'test-hero',
        duration: 3
    };

    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('resetGame 后棋盘效果不残留（雪花图标回归）', () => {
        // 模拟第一局中技能结算对共享数组的原地写入（引擎实际工作方式）
        const before = useGameStore.getState();
        (before.boardEffects ??= []).push({ ...crystal });
        expect(before.boardEffects!.length).toBe(1);

        useGameStore.getState().resetGame();

        expect(useGameStore.getState().boardEffects!.length).toBe(0);
    });

    it('initGame 后棋盘效果同样不残留', () => {
        const before = useGameStore.getState();
        (before.boardEffects ??= []).push({ ...crystal });
        expect(before.boardEffects!.length).toBe(1);

        useGameStore.getState().initGame();

        expect(useGameStore.getState().boardEffects!.length).toBe(0);
    });

    it('连续两局的可变对象互不共享（死亡计数）', () => {
        useGameStore.getState().deathCounters.totalDead = 7;
        expect(useGameStore.getState().deathCounters.totalDead).toBe(7);

        useGameStore.getState().initGame();

        expect(useGameStore.getState().deathCounters.totalDead).toBe(0);
    });

    it('连续两局的战斗统计互不共享', () => {
        useGameStore.getState().battleStatistics['dummy-stat'] = 99;

        useGameStore.getState().initGame();

        expect(Object.keys(useGameStore.getState().battleStatistics).length).toBe(0);
    });

    it('棋盘格子数组每次重置都是全新实例', () => {
        useGameStore.getState().initGame();
        const first = useGameStore.getState().board;
        useGameStore.getState().initGame();
        const second = useGameStore.getState().board;

        expect(first).not.toBe(second);
        expect(first[0]).not.toBe(second[0]);
    });
});
