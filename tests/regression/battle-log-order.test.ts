import { describe, expect, it } from 'vitest';
import { runComputerBattleStep, runComputerOpponentStep } from '../../src/hooks/useComputerOpponent';
import { mergeEngineLogs, useGameStore } from '../../src/store/game-store';
import { battleLogSeq, nextBattleLogId } from '../../src/core/battle-log-id';
import type { BattleLogEntry, GameState } from '../../src/types/game';

function makeLogEntry(message: string): BattleLogEntry {
    return {
        id: nextBattleLogId(),
        timestamp: Date.now(),
        type: 'system',
        player: 'player1',
        message,
    };
}

/**
 * 战报顺序回归。
 *
 * 历史问题：战报由 store（addLog 会换新数组）与引擎（往调用方持有的数组原地 push）两路写入，
 * 一旦引擎侧在 200 条上限处也把数组换掉，两边就此分叉；随后 mergeEngineLogs 用
 * "当前数组里没有 = 新日志"补条目，于是被上限挤掉的早期日志会被当成新条目贴回末尾，
 * 表现为"第 1 回合的伤害出现在第 20 回合之后"。
 */

function driveUntilCap(starters: string[]): { peak: number; evicted: boolean } {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();
    for (const heroId of starters) {
        useGameStore.getState().selectHeroForPlayer('player1', heroId);
    }
    useGameStore.getState().confirmHeroSelection();
    runComputerOpponentStep();
    const spots: [number, number][] = [[1, 0], [2, 0], [3, 1], [4, 1]];
    starters.slice(0, 4).forEach((heroId, i) => {
        useGameStore.getState().deployHeroForPlayer('player1', heroId, spots[i]);
    });
    useGameStore.getState().confirmDeployment();
    runComputerOpponentStep();

    // 一把 AI 对局只写得动几十条战报，够不到 200 条环形上限，而"挤掉早期日志后又把它
    // 复活贴回末尾"这个缺陷恰恰只在越过上限后才暴露。开局预填到接近上限，强制越线。
    const seedEntries: BattleLogEntry[] = [];
    for (let i = 0; i < 180; i++) seedEntries.push(makeLogEntry(`预填战报 ${i + 1}`));
    useGameStore.setState({ battleLog: seedEntries });
    const seedIds = new Set(seedEntries.map(entry => entry.id));

    let steps = 0;
    let lastSignature = '';
    let repeat = 0;
    let peak = 0;
    let evicted = false;
    while (useGameStore.getState().phase === 'battle' && steps < 1200) {
        const state = useGameStore.getState();
        const signature = [
            state.roundNumber, state.currentPlayer, state.actionsThisTurn,
            [...state.player1Heroes, ...state.player2Heroes]
                .map(h => `${h.id}:${h.state}:${h.currentHp}:${h.position?.join(',') ?? '-'}`).join(';'),
        ].join('|');
        repeat = signature === lastSignature ? repeat + 1 : 0;
        lastSignature = signature;
        if (repeat > 30) break;
        runComputerBattleStep(state.reinforcingPlayer ?? state.currentPlayer, repeat);
        steps++;
        // 每步都验：乱序往往只存在几帧，最后再看数组就漏了
        const after = useGameStore.getState();
        peak = Math.max(peak, after.battleLog.length);
        if (!evicted) {
            const live = new Set(after.battleLog.map(entry => entry.id));
            for (const id of seedIds) if (!live.has(id)) evicted = true;
        }
        assertOrdered(after);
    }
    return { peak, evicted };
}

function assertOrdered(state: GameState): void {
    const log = state.battleLog;
    let prev = -1;
    const ids = new Set<string>();
    for (const entry of log) {
        const seq = battleLogSeq(entry.id);
        expect(ids.has(entry.id), `战报出现重复 id：${entry.id}`).toBe(false);
        ids.add(entry.id);
        expect(
            seq >= prev,
            `战报顺序倒挂：${prev} -> ${seq}\n` +
            log.slice(Math.max(0, log.indexOf(entry) - 3), log.indexOf(entry) + 2)
                .map(item => `  [${battleLogSeq(item.id)}] (${item.type}) ${item.message}`).join('\n')
        ).toBe(true);
        prev = seq;
    }
    expect(log.length, '战报条数不得超过 200 条上限').toBeLessThanOrEqual(200);
}

describe('战报顺序', () => {
    it('对局全程每一帧的战报都按创建顺序排列，且样本真的越过 200 条上限', () => {
        const rosters: string[][] = [
            ['dilan', 'nanfeng', 'yunying', 'zhiguang', 'shangguan', 'huifeng'],
            ['feixue', 'xueqi', 'lingxi', 'mowen', 'guying', 'fengling'],
        ];
        const runs = rosters.map(driveUntilCap);
        for (const run of runs) {
            expect(run.peak, `战报峰值只有 ${run.peak} 条，未触及 200 条上限`).toBeGreaterThanOrEqual(200);
            // 上限真把早期条目挤掉了，才说明本样本覆盖了环形截断之后的合并路径
            expect(run.evicted, '预填战报没有被上限挤掉，样本未覆盖截断路径').toBe(true);
        }
    });

    it('被上限挤掉的旧日志不会当成新日志贴回末尾', () => {
        useGameStore.getState().resetGame();
        const all: BattleLogEntry[] = [];
        for (let i = 0; i < 210; i++) all.push(makeLogEntry(`结算 ${i + 1}`));

        // 先按完整数组发布一次：这 210 条都算"已经显示过"
        useGameStore.setState({ battleLog: [...all] });
        useGameStore.setState(mergeEngineLogs({ battleLog: all } as unknown as GameState));

        // 界面按 200 条上限只留后半段，引擎手里还攥着那条更早的数组
        useGameStore.setState({ battleLog: all.slice(-200) });
        const merged = mergeEngineLogs({ battleLog: all } as unknown as GameState).battleLog ?? [];

        expect(merged).toHaveLength(200);
        expect(merged.map(entry => entry.id)).toEqual(all.slice(-200).map(entry => entry.id));
    });

    it('补进来的引擎条目按创建顺序归位，不是追加到末尾', () => {
        useGameStore.getState().resetGame();
        // 引擎这批是在 store 换新数组之前 push 进旧数组的，创建序号早于界面上的后写条目
        const engineEntries: BattleLogEntry[] = [];
        for (let i = 0; i < 3; i++) engineEntries.push(makeLogEntry(`引擎结算 ${i + 1}`));

        const later = makeLogEntry('store 后写的说明');
        useGameStore.setState({ battleLog: [later] });
        useGameStore.setState(mergeEngineLogs({ battleLog: [later] } as unknown as GameState));

        const merged = mergeEngineLogs({ battleLog: engineEntries } as unknown as GameState).battleLog ?? [];
        expect(merged.map(entry => entry.message)).toEqual([
            '引擎结算 1', '引擎结算 2', '引擎结算 3', 'store 后写的说明',
        ]);
    });
});
