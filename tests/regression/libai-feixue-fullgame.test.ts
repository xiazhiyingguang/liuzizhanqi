import { describe, expect, it } from 'vitest';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import type { Hero } from '../../src/types/game';

/**
 * 复现用户报告：绯雪攻击李太白后，李太白未受伤 + 控制权错乱（被迫操作对手李太白）+ 卡死。
 * 场景：AI 模式，玩家1 含绯雪，AI（player2）含李太白且与绯雪相邻。
 */
function setupBattle(): void {
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
    // 李太白 [2,3] 与绯雪 [2,2] 相邻
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
}

function libaiOf(): Hero | undefined {
    return [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-'));
}

function feixueOf(): Hero | undefined {
    return [...useGameStore.getState().player1Heroes].find(h => h.id.startsWith('feixue-player1-'));
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
        `reinf:${s.reinforcingPlayer ?? '-'}`,
        s.libaiChainState ? `chain:${s.libaiChainState.heroId.split('-')[0]}:${s.libaiChainState.awaitingPosition ? 1 : 0}:${s.libaiChainState.pending.length}` : 'no-chain',
        heroes,
    ].join('|');
}

/** 模拟玩家1的简单操作：补员挂起时补员，否则逐个英雄结束行动 */
function drivePlayer1(): boolean {
    const s = useGameStore.getState();
    if (s.phase !== 'battle') return false;
    if (s.reinforcingPlayer === 'player1') {
        const bench = s.player1BenchHeroIds ?? [];
        if (bench.length === 0) return false;
        if (!useGameStore.getState().selectReinforcementHero(bench[0])) return false;
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 3; c++) {
                if (!useGameStore.getState().board[r][c]) {
                    useGameStore.getState().deployReinforcement([r, c]);
                    return true;
                }
            }
        }
        return false;
    }
    if (s.currentPlayer !== 'player1' || s.reinforcingPlayer) return false;
    const next = [...s.player1Heroes].find(h => h.state === 'alive' && !h.hasActedThisTurn);
    if (!next) {
        useGameStore.getState().endHeroAction();
        return true;
    }
    useGameStore.getState().selectHeroForAction(next);
    useGameStore.getState().endHeroAction();
    return true;
}

describe('绯雪攻击李太白场景回归', () => {
    it('绯雪技能1攻击李太白应正常造成伤害', () => {
        setupBattle();
        const libai = libaiOf()!;
        const hpBefore = libai.currentHp;

        useGameStore.getState().selectHeroForAction(feixueOf()!);
        useGameStore.getState().selectSkill('feixue_skill1');
        useGameStore.getState().executeSkill([2, 3]);

        const s = useGameStore.getState();
        expect(
            libai.currentHp,
            `绯雪攻击李太白后血量未变化。日志：\n${s.battleLog.slice(-5).map(l => `[${l.type}]${l.message}`).join('\n')}`
        ).toBeLessThan(hpBefore);
    });

    it('绯雪攻击李太白后整局自动推进不卡死', () => {
        setupBattle();

        // 玩家1第一步：绯雪攻击李太白（用户实际操作）
        useGameStore.getState().selectHeroForAction(feixueOf()!);
        useGameStore.getState().selectSkill('feixue_skill1');
        useGameStore.getState().executeSkill([2, 3]);

        // 之后模拟真实 hook 语义：AI 方固定以 player2 驱动（含补员挂起），玩家1 用简单策略
        let lastSig = '';
        let repeatCount = 0;
        let steps = 0;
        const MAX_STEPS = 3000;
        let stuck = false;

        while (steps < MAX_STEPS) {
            const s = useGameStore.getState();
            if (s.phase === 'ended') break;
            const sig = snapshot();
            const repeat = sig === lastSig ? repeatCount + 1 : 0;
            lastSig = sig;
            repeatCount = repeat;
            if (repeat > 12) { stuck = true; break; }

            if (s.reinforcingPlayer === 'player1') {
                // 玩家1补员挂起：无论 currentPlayer 是谁都由玩家1操作补员（与真实 UI 一致）
                drivePlayer1();
            } else if (s.reinforcingPlayer === 'player2') {
                runComputerBattleStep('player2', repeat);
            } else if (s.currentPlayer === 'player1') {
                drivePlayer1();
            } else {
                runComputerBattleStep('player2', repeat);
            }
            steps++;

            // 每一步都校验不变量：链不得跨回合残留到非李太白方
            const cur = useGameStore.getState();
            if (cur.phase !== 'battle') continue;
            if (cur.libaiChainState && cur.currentPlayer !== 'player2') {
                throw new Error(
                    `链状态残留到非李太白方回合：currentPlayer=${cur.currentPlayer}\n现场：${snapshot()}\n日志尾部：\n${cur.battleLog.slice(-8).map(l => `[${l.type}]${l.message}`).join('\n')}`
                );
            }
        }

        const s = useGameStore.getState();
        expect(
            !stuck,
            `对局在 ${steps} 步后卡死。现场：${snapshot()}\n日志尾部：\n${s.battleLog.slice(-10).map(l => `[${l.type}]${l.message}`).join('\n')}`
        ).toBe(true);
        expect(['ended', 'battle']).toContain(s.phase);
    });
});
