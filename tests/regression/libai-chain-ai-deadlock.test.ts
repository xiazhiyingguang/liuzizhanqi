import { describe, expect, it } from 'vitest';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import type { Hero } from '../../src/types/game';

/**
 * 定向复现：AI 方李太白释放技能进入"醉步留痕"被动链后的多步流程。
 * 链是挂起态（awaitingPosition -> 瞬移 -> 攻击/跳过 -> 归位），
 * AI 步进器必须能走完全部阶段，否则对局永远停在 AI 回合。
 */
function setupLibaiAiBattle(): { libai: () => Hero | undefined } {
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();

    for (const heroId of ['moran', 'zhenxiao', 'huifeng', 'feixue', 'baize', 'liuli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    }
    // AI 队伍含李太白
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
    // 李太白 [2,3] 与绯雪 [2,2] 相邻：技能1十字内直接可打
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
        `reinf:${s.reinforcingPlayer ?? '-'}`,
        s.libaiChainState ? `chain:${s.libaiChainState.heroId.split('-')[0]}:${s.libaiChainState.awaitingPosition ? 1 : 0}:${s.libaiChainState.pending.length}` : 'no-chain',
        heroes,
    ].join('|');
}

/** AI 步进（带真实 hook 的重复计数语义：状态不变时计数递增，≥2 强制收束） */
function stepAIWithRepeat(lastSig: string, repeatCount: number): { sig: string; repeat: number } {
    const sig = snapshot();
    const repeat = sig === lastSig ? repeatCount + 1 : 0;
    runComputerBattleStep(useGameStore.getState().currentPlayer, repeat);
    return { sig: snapshot(), repeat };
}

describe('AI 方李太白被动链死锁回归', () => {
    it('AI 的李太白进入醉步留痕链后能完整走完并交还控制权', () => {
        setupLibaiAiBattle();

        // 玩家1先清空本回合行动，把回合交给 AI
        for (const hero of [...useGameStore.getState().player1Heroes]) {
            if (hero.state === 'alive' && !hero.hasActedThisTurn) {
                useGameStore.getState().selectHeroForAction(hero);
                useGameStore.getState().endHeroAction();
            }
        }
        expect(useGameStore.getState().currentPlayer).toBe('player2');

        // AI 回合：手动让李太白放技能1（攻击相邻绯雪），触发醉步留痕链
        const libai = [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-'))!;
        useGameStore.getState().selectHeroForAction(libai);
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([2, 2]);

        let s = useGameStore.getState();
        expect(
            s.libaiChainState,
            `李太白技能1后被动链未挂起。日志：\n${s.battleLog.slice(-5).map(l => `[${l.type}]${l.message}`).join('\n')}`
        ).toBeDefined();
        expect(s.libaiChainState!.awaitingPosition).toBe(true);

        // AI 步进处理链：选位置 -> 攻击/跳过 -> 归位
        let lastSig = '';
        let repeatCount = 0;
        let steps = 0;
        const MAX_STEPS = 200;
        let handedOver = false;

        while (steps < MAX_STEPS && useGameStore.getState().phase === 'battle') {
            const sig = snapshot();
            const repeat = sig === lastSig ? repeatCount + 1 : 0;
            lastSig = sig;
            repeatCount = repeat;
            runComputerBattleStep(useGameStore.getState().currentPlayer, repeat);
            steps++;
            if (useGameStore.getState().currentPlayer === 'player1') {
                handedOver = true;
                break;
            }
        }

        s = useGameStore.getState();
        expect(
            handedOver || s.phase === 'ended',
            `李太白链流程 ${steps} 步后未交还控制权。现场：${snapshot()}\n日志尾部：\n${s.battleLog.slice(-10).map(l => `[${l.type}]${l.message}`).join('\n')}`
        ).toBe(true);
        expect(
            s.libaiChainState,
            '链结束后 libaiChainState 应被清理'
        ).toBeUndefined();
    });
});
