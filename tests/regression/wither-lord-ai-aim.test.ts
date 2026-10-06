import { describe, expect, it } from 'vitest';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { chooseComputerSkillPlan, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';
import { BOARD_SIZE, type GameState, type Position } from '../../src/types/game';

/**
 * 电脑操作凋零之主「凋零播撒」的瞄准回归。
 *
 * 历史问题：这个技能靠两次对角点击确定一个 2x2 区域，而电脑每一步都会重新规划一次方案，
 * 方案挑选带容差随机。旧实现在点第二角时先找"新方案里的对角格"，找不到就退化成
 * "取高亮表里的第一个对角格"，于是圈出来的 2x2 常常一个敌人都没有
 * （实测同一批随机布阵 120 次里空放 52 次，表现为战报反复出现「2x2区域内没有敌人」）。
 */

let seed = 20261003;
function rand(): number {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}

/** 随机布阵：凋零之主 + 一名队友在己方，2~4 名敌人在另一方 */
function makeLayout(enemyCount: number): GameState {
    const taken: Position[] = [];
    const take = (): Position => {
        for (let guard = 0; guard < 60; guard++) {
            const pos: Position = [Math.floor(rand() * BOARD_SIZE), Math.floor(rand() * BOARD_SIZE)];
            if (!taken.some(cell => cell[0] === pos[0] && cell[1] === pos[1])) {
                taken.push(pos);
                return pos;
            }
        }
        return [0, 0];
    };
    const state = makeGameState({
        isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master',
        currentPlayer: 'player2', phase: 'battle', roundNumber: 3,
        actionsThisTurn: 0, actionsRequiredThisTurn: 4,
    });
    addHero(state, 'wither_lord', 'player2', take());
    addHero(state, 'xuanxiao', 'player2', take());
    for (let i = 0; i < enemyCount; i++) addHero(state, 'yunying', 'player1', take());
    return state;
}

function loadIntoStore(state: GameState): void {
    useGameStore.setState({
        ...state,
        battleLog: [],
        reinforcingPlayer: undefined,
        pendingSkillTargetPositions: undefined,
        selectedHero: null,
        selectedSkill: null,
        activeHero: null,
    });
}

/** 两次点击展开出的 2x2 区域（与 SkillSystem 的口径一致：取两角的外接矩形） */
function regionOf(pair: Position[]): Position[] {
    const minRow = Math.min(pair[0][0], pair[1][0]);
    const maxRow = Math.max(pair[0][0], pair[1][0]);
    const minCol = Math.min(pair[0][1], pair[1][1]);
    const maxCol = Math.max(pair[0][1], pair[1][1]);
    const cells: Position[] = [];
    for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) cells.push([row, col]);
    }
    return cells;
}

describe('电脑操作凋零播撒', () => {
    setComputerAiDifficulty('master');

    it('方案给出的对角对必定罩得住至少一名敌人', () => {
        for (let trial = 0; trial < 80; trial++) {
            const state = makeLayout(2 + (trial % 3));
            const wither = state.player2Heroes.find(hero => hero.id.startsWith('wither_lord-'))!;
            const plan = chooseComputerSkillPlan(state, wither, 'wither_lord_skill1');
            if (!plan) continue;
            expect(plan.targetPositions, `方案 ${JSON.stringify(plan.targetPositions)} 不是两个对角格`)
                .toHaveLength(2);
            const covered = regionOf(plan.targetPositions)
                .some(([row, col]) => state.player1Heroes.some(enemy =>
                    enemy.state === 'alive' && enemy.position?.[0] === row && enemy.position?.[1] === col));
            expect(
                covered,
                `方案 ${JSON.stringify(plan.targetPositions)} 的 2x2 区域里没有敌人`
            ).toBe(true);
        }
    });

    it('两次点击不再脱节：整条释放链不会打出空 2x2', () => {
        let casts = 0;
        for (let trial = 0; trial < 60; trial++) {
            loadIntoStore(makeLayout(2 + (trial % 3)));
            for (let step = 0; step < 12; step++) {
                if (useGameStore.getState().phase !== 'battle') break;
                runComputerBattleStep('player2', step >= 10 ? 1 : 0);
            }
            const messages = useGameStore.getState().battleLog.map(entry => entry.message);
            expect(
                messages.filter(message =>
                    message.includes('2x2区域内没有敌人') || message.includes('凋零播撒没有找到有效目标')
                ),
                `布阵第 ${trial} 次出现空放：\n${messages.join('\n')}`
            ).toHaveLength(0);
            casts += messages.filter(message => message.startsWith('凋零之主对')).length;
        }
        // 60 次布阵里电脑确实在用这个技能，而不是改口什么都不放
        expect(casts).toBeGreaterThan(0);
    });
});
