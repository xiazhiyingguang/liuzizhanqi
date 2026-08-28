import { describe, expect, it } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';
import type { BattleLogEntry } from '../../src/types/game';

/**
 * 伤害结算日志是棋盘飘字（Board 按 battleLog 增量解析 details.amount/position）的唯一数据源，
 * 而引擎侧的日志由 DamageCalculator 直接 push 进传入的 state.battleLog 数组。
 * 这里守住两条会让伤害"打了但看不见"的链路。
 */

function loadIntoStore(state: ReturnType<typeof makeGameState>, logCount: number) {
    const pad: BattleLogEntry[] = Array.from({ length: logCount }, (_, index) => ({
        id: `pad-${index}`,
        type: 'system' as const,
        player: 'player1' as const,
        message: `历史日志 ${index}`,
        timestamp: Date.now(),
    }));
    useGameStore.setState({
        ...state,
        battleLog: pad,
        moveRange: [],
        skillRange: [],
        highlightedPositions: [],
        selectedSkill: null,
        selectedHero: null,
        activeHero: null,
        suppressOnlineBroadcast: false,
        isOnlineMode: false,
        isAiMode: false,
    });
}

function damageLogs() {
    return useGameStore.getState().battleLog.filter(entry => entry.type === 'damage');
}

describe('伤害结算日志与飘字数据源', () => {
    it('醉枕刀技能1：施法前写过提示日志，伤害结算日志仍要进入 store', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const enemyA = addHero(state, 'moran', 'player2', [2, 3]);
        const enemyB = addHero(state, 'baize', 'player2', [2, 4]);
        loadIntoStore(state, 0);

        const store = useGameStore.getState();
        store.selectHeroForAction(zui);
        store.selectSkill('zuizhendao_skill1');
        store.executeSkill([2, 3]);

        expect(enemyA.maxHp - enemyA.currentHp).toBe(6);
        expect(enemyB.maxHp - enemyB.currentHp).toBe(6);

        const logs = damageLogs();
        expect(logs).toHaveLength(2);
        for (const entry of logs) {
            const details = entry.details as { amount?: number; position?: number[] };
            expect(details.amount).toBe(6);
            expect(details.position).toHaveLength(2);
        }
    });

    it('日志已达 200 条上限时，一次结算的多条伤害日志都不能丢', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const enemyA = addHero(state, 'moran', 'player2', [2, 3]);
        const enemyB = addHero(state, 'baize', 'player2', [2, 4]);
        loadIntoStore(state, 200);

        const store = useGameStore.getState();
        store.selectHeroForAction(zui);
        store.selectSkill('zuizhendao_skill1');
        store.executeSkill([2, 3]);

        expect(enemyA.maxHp - enemyA.currentHp).toBe(6);
        expect(enemyB.maxHp - enemyB.currentHp).toBe(6);
        expect(damageLogs()).toHaveLength(2);
        expect(useGameStore.getState().battleLog.length).toBeLessThanOrEqual(200);
    });
});
