import { describe, expect, it } from 'vitest';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import type { Hero } from '../../src/types/game';

/** 搭建"绯雪(player1) 对阵 AI 李太白(player2)"的战斗局面 */
function setupFeixueVsLibaiBattle(): { feixue: () => Hero | undefined; libai: () => Hero | undefined } {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();

    for (const heroId of ['feixue', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    }
    for (const heroId of ['libai', 'moran', 'zhenxiao', 'huifeng', 'baize', 'liuli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player2', heroId)).toBe(true);
    }
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmHeroSelectionForPlayer('player2')).toBe(true);

    for (const [heroId, pos] of [
        ['feixue', [2, 2]],
        ['moran', [1, 0]],
        ['zhenxiao', [3, 0]],
        ['huifeng', [1, 1]],
    ] as Array<[string, [number, number]]>) {
        expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, pos)).toBe(true);
    }
    for (const [heroId, pos] of [
        ['libai', [2, 3]],
        ['moran', [2, 5]],
        ['zhenxiao', [3, 5]],
        ['huifeng', [3, 4]],
    ] as Array<[string, [number, number]]>) {
        expect(useGameStore.getState().deployHeroForPlayer('player2', heroId, pos)).toBe(true);
    }
    expect(useGameStore.getState().confirmDeploymentForPlayer('player1')).toBe(true);
    expect(useGameStore.getState().confirmDeploymentForPlayer('player2')).toBe(true);

    expect(useGameStore.getState().phase).toBe('battle');
    return {
        feixue: () => [...useGameStore.getState().player1Heroes].find(h => h.id.startsWith('feixue-player1-')),
        libai: () => [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-')),
    };
}

function snapshot(): string {
    const s = useGameStore.getState();
    const heroes = [...s.player1Heroes, ...s.player2Heroes]
        .map(h => `${h.id.split('-')[0]}:${h.state}:${h.currentHp}:${h.hasActedThisTurn ? 1 : 0}:${h.position?.join(',') ?? '-'}`)
        .join(';');
    return [
        s.phase, s.currentPlayer, String(s.roundNumber), String(s.actionsThisTurn),
        s.selectedHero?.id.split('-')[0] ?? '-', s.selectedSkill?.id ?? '-',
        String(s.moveRange.length), String(s.skillRange.length),
        `reinf:${s.reinforcingPlayer ?? '-'}:sel:${s.reinforcementSelectableHeroId ?? '-'}`,
        s.libaiChainState ? `chain:${s.libaiChainState.heroId.split('-')[0]}:${s.libaiChainState.awaitingPosition ? 1 : 0}:${s.libaiChainState.pending.length}` : 'no-chain',
        heroes,
    ].join('|');
}

/** 步进一次（当前玩家是 AI 时走 AI；连续不变由调用方计数判死锁） */
function stepAI(): void {
    runComputerBattleStep(useGameStore.getState().currentPlayer, 0);
}

describe('绯雪攻击李太白后的 AI 回合死锁回归', () => {
    it('绯雪持续攻击李太白的多轮对局中，AI 回合不卡死且李太白掉血', () => {
        const { feixue, libai } = setupFeixueVsLibaiBattle();

        let lastSig = '';
        let staleCount = 0;
        let totalSteps = 0;
        const MAX_STEPS = 600;

        while (totalSteps < MAX_STEPS && useGameStore.getState().phase === 'battle') {
            const s = useGameStore.getState();

            // 玩家1 补员挂起：无论 currentPlayer 是谁都由玩家操作补员（与真实 UI 一致）
            if (s.reinforcingPlayer === 'player1') {
                const bench = s.player1BenchHeroIds ?? [];
                let deployed = false;
                if (bench.length > 0 && useGameStore.getState().selectReinforcementHero(bench[0])) {
                    outer:
                    for (let r = 0; r < 6; r++) {
                        for (let c = 0; c < 3; c++) {
                            if (!useGameStore.getState().board[r][c]) {
                                useGameStore.getState().deployReinforcement([r, c]);
                                deployed = true;
                                break outer;
                            }
                        }
                    }
                }
                if (!deployed) {
                    useGameStore.getState().clearReinforcementSelection();
                    useGameStore.getState().endHeroAction();
                }
                totalSteps++;
                if (deployed) { lastSig = ''; staleCount = 0; }
                continue;
            }

            // 玩家回合：绯雪攻击李太白（相邻时用技能1，否则结束行动）
            if (s.currentPlayer === 'player1') {
                const feixueHero = feixue();
                const libaiHero = libai();
                const acted = tryPlayerAttack(feixueHero, libaiHero);
                if (!acted) {
                    // 绯雪不可用（已行动/阵亡）：直接结束所有剩余英雄的行动
                    let progressed = false;
                    for (const hero of useGameStore.getState().player1Heroes) {
                        if (hero.state === 'alive' && !hero.hasActedThisTurn) {
                            useGameStore.getState().selectHeroForAction(hero);
                            useGameStore.getState().endHeroAction();
                            progressed = true;
                            break;
                        }
                    }
                    if (!progressed) {
                        useGameStore.getState().endHeroAction();
                    }
                }
                totalSteps++;
                continue;
            }

            // AI 回合步进
            stepAI();
            totalSteps++;

            const sig = snapshot();
            if (sig === lastSig) staleCount++;
            else { staleCount = 0; lastSig = sig; }
            expect(staleCount, `AI 回合死锁（连续${staleCount}步无变化）。现场：${sig}\n日志尾部：\n${useGameStore.getState().battleLog.slice(-8).map(l => `[${l.type}]${l.message}`).join('\n')}`).toBeLessThan(40);
        }

        const s = useGameStore.getState();
        // 对局应正常进行或结束（非卡死）
        expect(['battle', 'ended']).toContain(s.phase);
    });

    /** 绯雪对李太白发起一次攻击；返回是否真的发起（含 endHeroAction） */
    function tryPlayerAttack(feixueHero: Hero | undefined, libaiHero: Hero | undefined): boolean {
        if (!feixueHero || feixueHero.state !== 'alive' || feixueHero.hasActedThisTurn) return false;
        if (!libaiHero || libaiHero.state !== 'alive' || !feixueHero.position || !libaiHero.position) return false;

        useGameStore.getState().selectHeroForAction(feixueHero);
        const dist = Math.abs(feixueHero.position[0] - libaiHero.position[0]) + Math.abs(feixueHero.position[1] - libaiHero.position[1]);
        if (dist <= 2) {
            useGameStore.getState().selectSkill('feixue_skill1');
            useGameStore.getState().executeSkill([...libaiHero.position]);
        }
        // 无论是否命中，结束行动推进回合
        useGameStore.getState().endHeroAction();
        return true;
    }
});
