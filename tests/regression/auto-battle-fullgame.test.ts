import { afterEach, describe, expect, it } from 'vitest';
import { runComputerOpponentStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import { GameEngine } from '../../src/core/game-engine';
import type { GameState, Position } from '../../src/types/game';

/**
 * AI 接管全流程冒烟：选将布阵由测试代填，战斗阶段两侧都走 UI 同一个入口
 * `runComputerOpponentStep()`（玩家一侧靠 autoBattle 交给电脑），
 * 断言对局能自己走完、不死锁、不超员，且玩家一侧确实被代打过。
 */

function signature(state: GameState): string {
    const heroesSig = [...state.player1Heroes, ...state.player2Heroes]
        .map(hero => `${hero.id}:${hero.state}:${hero.currentHp}:${hero.shield}:`
            + `${hero.hasActedThisTurn ? 1 : 0}:${hero.position?.join(',') ?? '-'}`)
        .join(';');
    return [
        state.phase,
        state.currentPlayer,
        state.roundNumber,
        state.actionsThisTurn,
        state.selectedHero?.id ?? '-',
        state.selectedSkill?.id ?? '-',
        state.reinforcingPlayer ?? '-',
        state.reinforcementSelectableHeroId ?? '-',
        heroesSig,
    ].join('|');
}

function assertNoOverpopulation(state: GameState): void {
    for (const player of ['player1', 'player2'] as const) {
        const alive = GameEngine.countRealAliveOnBoard(state, player);
        expect(alive, `${player} 场上存活 ${alive} 人超过上限`).toBeLessThanOrEqual(4);
    }
}

/** 玩家一侧是否被代打过：有人挪过位或结束过行动即算 */
function playerSideWasPiloted(startPositions: Map<string, Position>, state: GameState): boolean {
    return state.player1Heroes.some(hero => {
        const start = startPositions.get(hero.id);
        if (!start) return false;
        const moved = hero.position && (hero.position[0] !== start[0] || hero.position[1] !== start[1]);
        return Boolean(moved) || hero.hasActedThisTurn;
    });
}

function playTakenOverGame(maxSteps = 9000) {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();

    for (const heroId of ['moran', 'baize', 'liuli', 'dilan', 'changli', 'fengling']) {
        expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    }
    useGameStore.getState().confirmHeroSelection();
    runComputerOpponentStep(); // 电脑选将
    useGameStore.getState().confirmHeroSelectionForPlayer('player2');

    const starters: Array<[string, Position]> = [
        ['moran', [2, 0]], ['baize', [1, 0]], ['liuli', [4, 1]], ['dilan', [3, 1]],
    ];
    for (const [heroId, position] of starters) {
        expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, position)).toBe(true);
    }
    useGameStore.getState().confirmDeployment();
    runComputerOpponentStep(); // 电脑布阵
    useGameStore.getState().confirmDeploymentForPlayer('player2');

    const startPositions = new Map<string, Position>(
        useGameStore.getState().player1Heroes
            .filter(hero => hero.position)
            .map(hero => [hero.id, [...hero.position!] as Position])
    );

    // 打开接管：此后玩家一侧也交给同一套电脑决策
    useGameStore.getState().toggleAutoBattle();
    expect(useGameStore.getState().autoBattle).toBe(true);

    let steps = 0;
    let staleCount = 0;
    let lastSignature = '';
    let repeatCount = 0;
    let piloted = false;
    while (useGameStore.getState().phase === 'battle' && steps < maxSteps) {
        const current = signature(useGameStore.getState());
        repeatCount = current === lastSignature ? repeatCount + 1 : 0;
        lastSignature = current;
        runComputerOpponentStep(repeatCount);
        steps++;

        const after = useGameStore.getState();
        assertNoOverpopulation(after);
        if (!piloted) piloted = playerSideWasPiloted(startPositions, after);

        staleCount = current === signature(after) ? staleCount + 1 : 0;
        const scene = `接管局疑似死锁：连续 ${staleCount} 步状态无变化\n`
            + `round=${after.roundNumber} current=${after.currentPlayer} `
            + `active=${after.activeHero?.id ?? '无'} reinforcing=${after.reinforcingPlayer ?? '无'}\n`
            + (after.battleLog ?? []).slice(-12).map(entry => entry.message).join('\n');
        expect(staleCount, scene).toBeLessThan(40);
    }

    const final = useGameStore.getState();
    return { finished: final.phase === 'ended', steps, rounds: final.roundNumber, piloted };
}

describe('AI 接管整局冒烟', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
    });

    it('两侧都由电脑代打时能自己打完一整局', () => {
        const report = playTakenOverGame();
        expect(report.piloted, '玩家一侧没有被接管代打过').toBe(true);
        expect(report.finished, `对局未能在 ${report.steps} 步内结束（round=${report.rounds}）`).toBe(true);
    }, 240000);
});
