import { describe, expect, it } from 'vitest';
import { runComputerBattleStep, runComputerOpponentStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import { GameEngine } from '../../src/core/game-engine';
import type { GameState } from '../../src/types/game';

/**
 * 游隼 AI 全流程冒烟：
 * - 游隼编入玩家1队伍，双方均由电脑步进器代打；
 * - 覆盖疾掠冲刺落点、四向风刃铺设与收回触发的「仅移动再动」窗口；
 * - 断言对局不死锁、不超员、控制权始终有效并正常分出胜负。
 */

function fingerprint(state: GameState): string {
    const cell = (hero: unknown) => {
        const h = hero as GameState['player1Heroes'][number] | undefined;
        return h ? `${h.id}:${h.state}:${h.currentHp}:${h.hasActedThisTurn ? 1 : 0}:${h.position?.join(',') ?? '-'}` : '-';
    };
    return JSON.stringify({
        phase: state.phase,
        round: state.roundNumber,
        current: state.currentPlayer,
        active: state.activeHero?.id ?? '-',
        performingExtra: state.performingExtraAction ? 1 : 0,
        board: state.board.map(row => row.map(cell).join(',')).join(';'),
    });
}

function assertNoOverpopulation(state: GameState): void {
    for (const player of ['player1', 'player2'] as const) {
        const alive = GameEngine.countRealAliveOnBoard(state, player);
        expect(alive, `${player} 场上存活 ${alive} 人超过上限`).toBeLessThanOrEqual(4);
    }
}

function playYoujunGame(seedLabel: string, maxSteps = 8000): { finished: boolean; steps: number; rounds: number } {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();

    for (const heroId of ['youjun', 'moran', 'baize', 'liuli', 'dilan', 'changli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    }
    useGameStore.getState().confirmHeroSelection();
    runComputerOpponentStep(); // AI 选将

    const starters: [string, [number, number]][] = [
        ['youjun', [2, 0]], ['moran', [1, 0]], ['baize', [4, 1]], ['liuli', [3, 1]],
    ];
    for (const [heroId, pos] of starters) {
        expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, pos)).toBe(true);
    }
    useGameStore.getState().confirmDeployment();
    runComputerOpponentStep(); // AI 布阵

    let steps = 0;
    let staleCount = 0;
    let lastFingerprint = '';
    while (useGameStore.getState().phase === 'battle' && steps < maxSteps) {
        const state = useGameStore.getState();
        const actor = state.reinforcingPlayer ?? state.currentPlayer;
        runComputerBattleStep(actor, 0);
        steps++;

        const after = useGameStore.getState();
        assertNoOverpopulation(after);

        const fp = fingerprint(after);
        staleCount = fp === lastFingerprint ? staleCount + 1 : 0;
        lastFingerprint = fp;
        const scene = `${seedLabel} 疑似死锁：连续 ${staleCount} 步状态无变化\n` +
            `round=${after.roundNumber} current=${after.currentPlayer} active=${after.activeHero?.id ?? '无'} ` +
            `performingExtra=${after.performingExtraAction ? 1 : 0}\n` +
            (after.battleLog ?? []).slice(-12).map(entry => entry.message).join('\n');
        expect(staleCount, scene).toBeLessThan(30);
    }

    return { finished: useGameStore.getState().phase === 'ended', steps, rounds: useGameStore.getState().roundNumber };
}

describe('游隼 AI 全流程冒烟（双电脑自动对局）', () => {
    it('游隼参战的对局不死锁、不超员并正常结束', () => {
        const report = playYoujunGame('游隼局1');
        expect(report.finished, `对局未能在 ${report.steps} 步内结束（round=${report.rounds}）`).toBe(true);
    }, 120000);

    it('第二局（AI 随机性压测）同样正常结束', () => {
        const report = playYoujunGame('游隼局2');
        expect(report.finished, `对局未能在 ${report.steps} 步内结束（round=${report.rounds}）`).toBe(true);
    }, 120000);
});
