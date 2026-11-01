import { runComputerBattleStep, battleActorFor } from '../../src/hooks/useComputerOpponent';
// 由比较脚本提供的虚拟模块，读取旧执行器，避免旧 AI 意外享受到新执行器的操作修复。
// @ts-expect-error virtual benchmark module
import { runComputerBattleStep as runBaselineStep } from '../../src/hooks/__benchmark_ai_baseline_hook';
import { useGameStore } from '../../src/store/game-store';
import { makeGameState, addHero } from '../../tests/helpers/game-state';
import type { GameState, Player, Position } from '../../src/types/game';
import { resetBattleReplay } from '../../src/services/battle-replay';
import { chooseComputerSkillPlan, chooseComputerMove, evaluateComputerBoard, simulateComputerMove } from '../../src/core/computer-ai';
import { addDilanFeather } from '../../src/data/extended-heroes';
import { GameEngine } from '../../src/core/game-engine';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { getXiangStepMovePlans } from '../../src/core/xuanyuan-form';
import { placeFlyingSword } from '../../src/core/flying-sword';

interface Scenario { name: string; left: string[]; right: string[]; leftBench?: string[]; rightBench?: string[] }
export const scenarios: Scenario[] = [
    { name: 'melee', left: ['moran', 'huifeng', 'wukong', 'bounty'], right: ['mirror', 'zhenxiao', 'baize', 'liuli'] },
    { name: 'magic', left: ['schrodinger', 'lilith', 'hanjiangxue', 'xuanxiao'], right: ['changli', 'wither_lord', 'yinyang', 'bard'] },
    { name: 'undead', left: ['skeletonking', 'jetzmi', 'soul_lamp', 't_painting'], right: ['fengling', 'nightowl', 'mowen', 'baize'] },
    { name: 'terrain', left: ['youjun', 'dilan', 'jiangtaigong', 'daizong'], right: ['aoyuan', 'yunxiu', 'tingyuan', 'nanfeng'] },
    { name: 'complex', left: ['libai', 'xuanyuan', 'shangguan', 'jinghua'], right: ['xueqi', 'jinghong', 'huanongying', 'zhiguang'] },
    { name: 'newcomers', left: ['xuanyuan', 'shangguan', 'jinghua', 'wangshu'], right: ['zhiyuan', 'xihuan', 'duosui', 'yunxiu'],
        leftBench: ['baize', 'huifeng'], rightBench: ['dilan', 'liuli'] },
    { name: 'new-support', left: ['xuanyuan', 'shangguan', 'jinghua', 'xuanxiao'], right: ['huanongying', 'jinghong', 'zhiguang', 'baize'],
        leftBench: ['aoyuan', 'wangcai'], rightBench: ['hanjiangxue', 'bounty'] },
];

export function compareTactics() {
    const original = Math.random;
    try {
        DamageCalculator.setBattleRound(1);
        const sacrifice = makeGameState();
        const king = addHero(sacrifice, 'skeletonking', 'player1', [2, 2]);
        const victim = addHero(sacrifice, 'baize', 'player2', [2, 3]);
        victim.currentHp = 1;
        addHero(sacrifice, 'liuli', 'player2', [5, 5]);
        const movement = makeGameState();
        const mover = addHero(movement, 'moran', 'player1', [0, 0]);
        mover.currentHp = 1;
        const dilan = addHero(movement, 'dilan', 'player2', [5, 5]);
        addDilanFeather(mover, dilan);
        const brushState = makeGameState();
        const shangguan = addHero(brushState, 'shangguan', 'player1', [4, 1]);
        addHero(brushState, 'moran', 'player2', [4, 2]);
        addHero(brushState, 'baize', 'player2', [1, 4]).currentHp = 1;
        brushState.boardEffects = [{ id: 'tactic-brush', type: 'brush', position: [2, 1], owner: 'player1', sourceHeroId: shangguan.id, duration: 3 }];
        const swordState = makeGameState();
        const swordsman = addHero(swordState, 'xuanyuan', 'player1', [2, 2]);
        swordsman.counters['昭神'] = 1;
        addHero(swordState, 'baize', 'player2', [0, 0]);
        addHero(swordState, 'liuli', 'player2', [5, 5]);
        for (const plan of getXiangStepMovePlans(swordsman.position!)) placeFlyingSword(swordState, swordsman, plan.to);
        const swapState = makeGameState({ player1BenchHeroIds: ['moran'] });
        const jinghua = addHero(swapState, 'jinghua', 'player1', [2, 2]);
        jinghua.counters['镜影'] = 3;
        addHero(swapState, 'baize', 'player2', [5, 5]);
        swapState.battleStatistics![jinghua.id] = { damageDealt: 0, damageTaken: 0, healingDone: 0, shieldAbsorbed: 0, kills: 0, skill2Casts: 2 };
        const results = [];
        for (const policy of ['baseline', 'current']) {
            (globalThis as unknown as Record<string, unknown>).__AI_BENCHMARK_POLICY__ = policy;
            Math.random = () => .01;
            const sacrificePlan = chooseComputerSkillPlan(sacrifice, king, king.skill1Id);
            const move = chooseComputerMove(movement, mover);
            const dash = chooseComputerSkillPlan(brushState, shangguan, shangguan.skill2Id);
            const audit = { candidates: [] as Array<{ skillId: string; score: number; targets: Position[] }>, chosen: null };
            chooseComputerSkillPlan(swordState, swordsman, swordsman.skill1Id, audit);
            const swap = simulateComputerMove(swapState, jinghua, [2, 3]);
            results.push({ policy, sacrificeScore: sacrificePlan?.score, move,
                shangguanFirstStep: dash?.targetPositions[0],
                xuanyuanDirectionViolations: audit.candidates.filter(plan => plan.targets.length !== 1
                    || Math.abs(plan.targets[0][0] - 2) !== Math.abs(plan.targets[0][1] - 2)
                    || ![1, 2].includes(Math.abs(plan.targets[0][0] - 2))).length,
                jinghuaUsesAfterMove: swap?.battleStatistics?.[jinghua.id]?.skill2Casts ?? 0,
                winScore: evaluateComputerBoard({ ...movement, phase: 'ended', winner: 'player1' }, 'player1'),
                lossScore: evaluateComputerBoard({ ...movement, phase: 'ended', winner: 'player2' }, 'player1') });
        }
        return results;
    } finally { Math.random = original; }
}

function signature(state: GameState): string {
    return JSON.stringify([state.currentPlayer, state.roundNumber, state.actionsThisTurn,
        state.selectedHero?.id, state.activeHero?.id, state.selectedSkill?.id, state.moveRange, state.skillRange,
        state.pendingSkillTargetPositions, state.pendingBoardAction, state.libaiChainState, state.wukongSkill2State,
        state.shangguanDashState, state.baizeReviveTargetHeroId, state.reinforcingPlayer,
        [...state.player1Heroes, ...state.player2Heroes].map(hero => [hero.id, hero.state, hero.currentHp,
            hero.shield, hero.position, hero.hasActedThisTurn, hero.hasMovedThisTurn, hero.counters])]);
}

export function runComparisonMatch(scenario: typeof scenarios[number], updatedSide: Player) {
    const originalRandom = Math.random;
    let rng = 20261023;
    Math.random = () => {
        rng = (rng + 0x6D2B79F5) >>> 0;
        let value = Math.imul(rng ^ (rng >>> 15), rng | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const start = performance.now();
    try {
        resetBattleReplay();
        useGameStore.getState().resetGame();
        const fixture = makeGameState({ actionsRequiredThisTurn: 8,
            player1BenchHeroIds: [...(scenario.leftBench ?? [])], player2BenchHeroIds: [...(scenario.rightBench ?? [])] });
        const leftPositions: Position[] = [[2, 1], [3, 1], [1, 0], [4, 0]];
        const rightPositions: Position[] = [[2, 4], [3, 4], [1, 5], [4, 5]];
        scenario.left.forEach((id, index) => addHero(fixture, id, 'player1', leftPositions[index]));
        scenario.right.forEach((id, index) => addHero(fixture, id, 'player2', rightPositions[index]));
        // 与真实布阵结束一致：初始化首轮被动/回溯快照，清除上一局的激战倍率。
        GameEngine.startNewTurn(fixture);
        useGameStore.setState({ ...fixture, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master', autoBattle: true });
        let steps = 0;
        let repeats = 0;
        let last = '';
        let forcedSkips = 0;
        let maxStepMs = 0;
        const policies = { current: 0, baseline: 0 };
        while (useGameStore.getState().phase === 'battle' && steps < 2000 && performance.now() - start < 120000) {
            const state = useGameStore.getState();
            const actor = battleActorFor(state);
            const sig = signature(state);
            repeats = last === sig ? repeats + 1 : 0;
            last = sig;
            if (repeats >= 2) forcedSkips++;
            const policy = actor === updatedSide ? 'current' : 'baseline';
            (globalThis as unknown as Record<string, unknown>).__AI_BENCHMARK_POLICY__ = policy;
            policies[policy]++;
            const stepStart = performance.now();
            if (policy === 'baseline') runBaselineStep(actor, repeats);
            else runComputerBattleStep(actor, repeats);
            maxStepMs = Math.max(maxStepMs, performance.now() - stepStart);
            steps++;
        }
        const end = useGameStore.getState();
        return { scenario: scenario.name, updatedSide, teams: [scenario.left, scenario.right],
            finished: end.phase === 'ended', winner: end.winner, updatedWon: end.winner === updatedSide,
            rounds: end.roundNumber, steps, forcedSkips, ms: Math.round(performance.now() - start),
            maxStepMs: Math.round(maxStepMs), policies,
            casts: Object.entries(end.battleStatistics ?? {}).map(([id, stats]) => ({
                name: [...end.player1Heroes, ...end.player2Heroes].find(hero => hero.id === id)?.name ?? id,
                skill1: stats.skill1Casts ?? 0, skill2: stats.skill2Casts ?? 0 })) };
    } finally { Math.random = originalRandom; }
}
