import { beforeEach, describe, expect, it } from 'vitest';
import { runComputerOpponentStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import { HeroState } from '../../src/types/game';
import { GameEngine } from '../../src/core/game-engine';

/** 替补制：人类玩家补员辅助——点选替补席首位英雄并部署到本方半场第一个空格。 */
function deployHumanReinforcement(): void {
    const benchHead = useGameStore.getState().player1BenchHeroIds[0];
    if (!benchHead) return;
    let cell: [number, number] | null = null;
    for (let row = 0; row < 6 && !cell; row++) {
        for (let col = 0; col < 3; col++) {
            if (!useGameStore.getState().board[row][col]) {
                cell = [row, col];
                break;
            }
        }
    }
    if (!cell) return;
    useGameStore.getState().selectReinforcementHero(benchHead);
    useGameStore.getState().deployReinforcement(cell);
}

describe('computer opponent integration', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            isOnlineMode: false,
            isAiMode: true,
            aiPlayer: 'player2',
            aiDifficulty: 'master'
        });
        useGameStore.getState().initGame();
    });

    it('自动完成反制选将、右侧布阵，并能走完实际战斗行动', () => {
        const humanTeam = ['moran', 'zhenxiao', 'huifeng', 'baize', 'liuli', 'changli'];
        for (const heroId of humanTeam) {
            expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
        }
        useGameStore.getState().confirmHeroSelection();

        runComputerOpponentStep();
        let state = useGameStore.getState();
        expect(state.phase).toBe('deploy');
        expect(state.player2SelectedHeroIds).toHaveLength(6);
        expect(new Set(state.player2SelectedHeroIds).size).toBe(6);

        // 替补制：布阵阶段只部署四名首发，其余两人留在替补席
        const humanStarters = humanTeam.slice(0, 4);
        const humanPositions: [number, number][] = [[1, 0], [2, 0], [3, 1], [4, 1]];
        humanStarters.forEach((heroId, index) => {
            expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, humanPositions[index])).toBe(true);
        });
        useGameStore.getState().confirmDeployment();
        runComputerOpponentStep();

        state = useGameStore.getState();
        expect(state.phase).toBe('battle');
        expect(state.player2Heroes).toHaveLength(4);
        expect(state.player2Heroes.every(hero => hero.position && hero.position[1] >= 3)).toBe(true);

        const firstHuman = state.player1Heroes.find(hero => hero.state === HeroState.ALIVE && !hero.hasActedThisTurn)!;
        useGameStore.getState().selectHeroForAction(firstHuman);
        useGameStore.getState().endHeroAction();
        expect(useGameStore.getState().currentPlayer).toBe('player2');

        let steps = 0;
        while (
            useGameStore.getState().phase === 'battle' &&
            useGameStore.getState().currentPlayer === 'player2' &&
            steps < 24
        ) {
            runComputerOpponentStep();
            steps++;
        }

        state = useGameStore.getState();
        expect(steps).toBeLessThan(24);
        expect(state.currentPlayer === 'player1' || state.phase === 'ended').toBe(true);
        // AI 可能原地释放全场/AOE 技能（日志类型为 damage/heal 等），不移动也属于有效行动。
        expect(state.battleLog.some(log => log.player === 'player2' && log.type !== 'system')).toBe(true);

        let guard = 0;
        let previousAiSignature = '';
        let repeatedAiState = 0;
        while (useGameStore.getState().phase === 'battle' && useGameStore.getState().roundNumber === 1 && guard < 160) {
            // 替补制：人类方待补员时优先完成上场交互，否则对局会一直挂起
            if (useGameStore.getState().reinforcingPlayer === 'player1') {
                deployHumanReinforcement();
                guard++;
                continue;
            }
            state = useGameStore.getState();
            if (state.currentPlayer === 'player1') {
                const hero = GameEngine.getAvailableHeroesForPlayer(state, 'player1')[0];
                expect(hero, '玩家回合应存在可行动英雄').toBeDefined();
                useGameStore.getState().selectHeroForAction(hero!);
                if (useGameStore.getState().currentPlayer === 'player1' && useGameStore.getState().selectedHero) {
                    useGameStore.getState().endHeroAction();
                }
            } else {
                const signature = [
                    state.actionsThisTurn,
                    state.selectedHero?.id,
                    state.selectedSkill?.id,
                    state.moveRange.length,
                    state.skillRange.length,
                    state.pendingSkillTargetPositions?.length ?? 0,
                    state.player1Heroes.map(hero => hero.currentHp).join(','),
                    state.player2Heroes.map(hero => hero.currentHp).join(','),
                ].join('|');
                repeatedAiState = signature === previousAiSignature ? repeatedAiState + 1 : 0;
                previousAiSignature = signature;
                runComputerOpponentStep(repeatedAiState);
            }
            guard++;
        }

        state = useGameStore.getState();
        expect(guard).toBeLessThan(160);
        expect(state.roundNumber >= 2 || state.phase === 'ended').toBe(true);

        let matchGuard = 0;
        previousAiSignature = '';
        repeatedAiState = 0;
        while (useGameStore.getState().phase === 'battle' && useGameStore.getState().roundNumber < 6 && matchGuard < 900) {
            // 替补制：人类方待补员时优先完成上场交互，否则对局会一直挂起
            if (useGameStore.getState().reinforcingPlayer === 'player1') {
                deployHumanReinforcement();
                matchGuard++;
                continue;
            }
            state = useGameStore.getState();
            if (state.currentPlayer === 'player1') {
                const hero = GameEngine.getAvailableHeroesForPlayer(state, 'player1')[0];
                expect(hero, '多轮玩家回合应存在可行动英雄').toBeDefined();
                useGameStore.getState().selectHeroForAction(hero!);
                if (useGameStore.getState().currentPlayer === 'player1' && useGameStore.getState().selectedHero) {
                    useGameStore.getState().endHeroAction();
                }
            } else {
                const signature = [
                    state.roundNumber,
                    state.actionsThisTurn,
                    state.selectedHero?.id,
                    state.selectedSkill?.id,
                    state.moveRange.length,
                    state.skillRange.length,
                    state.pendingSkillTargetPositions?.length ?? 0,
                    state.pendingBoardAction?.heroId,
                    state.player1Heroes.map(hero => `${hero.state}:${hero.currentHp}`).join(','),
                    state.player2Heroes.map(hero => `${hero.state}:${hero.currentHp}`).join(','),
                ].join('|');
                repeatedAiState = signature === previousAiSignature ? repeatedAiState + 1 : 0;
                previousAiSignature = signature;
                runComputerOpponentStep(repeatedAiState);
            }
            matchGuard++;
        }

        state = useGameStore.getState();
        expect(matchGuard).toBeLessThan(900);
        expect(state.phase === 'ended' || state.roundNumber >= 6).toBe(true);
    });
});
