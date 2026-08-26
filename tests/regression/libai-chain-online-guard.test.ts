import { describe, expect, it } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import type { Hero, Position } from '../../src/types/game';

/**
 * 联机模式李太白被动链的操作权校验回归。
 *
 * 背景：李太白进入"醉步留痕"链后，链状态（libaiChainState、pending 高亮、selectedHero）
 * 会作为权威快照同步到对手端。修复前 selectLibaiChainPosition / skipLibaiChainAttack
 * 没有操作者身份校验，对手端点击同步过来的高亮位置会直接在本地操纵对方李太白，
 * 且该状态变化无法通过服务器（非行动方）回传，造成两端状态分叉、对局卡死。
 */
function setupOnlineBattle(): { libai: () => Hero | undefined } {
    useGameStore.getState().resetGame();
    // 联机模式不设 onlineRoomId：sendOnlineStateIfNeeded 会静默跳过，专注 store 层校验
    useGameStore.setState({ isOnlineMode: true, isAiMode: false, localPlayerNumber: 2 });
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
    return {
        libai: () => [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-')),
    };
}

describe('联机模式李太白链操作权校验', () => {
    it('本地为李太白方时可以正常瞬移与跳过攻击', () => {
        setupOnlineBattle();

        // 玩家1 全员跳过，回合交给玩家2（本地）
        useGameStore.setState({ currentPlayer: 'player2' });
        for (const hero of [...useGameStore.getState().player1Heroes]) {
            hero.hasActedThisTurn = true;
        }

        const libai = [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-'))!;
        // 制造一个历史位置：模拟回合开始时记录的上次停留位置
        libai.counters['__libai_prev_pos'] = 4 * 6 + 4; // (4,4)

        useGameStore.getState().selectHeroForAction(libai);
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([2, 2]);

        const s = useGameStore.getState();
        expect(s.libaiChainState, '李太白技能1后应进入被动链').toBeDefined();
        expect(s.libaiChainState!.awaitingPosition).toBe(true);
        const pendingPos: Position = s.libaiChainState!.pending[0];

        // 本地（玩家2）点击历史位置：应成功瞬移
        useGameStore.getState().selectLibaiChainPosition(pendingPos);
        const after = useGameStore.getState();
        expect(after.libaiChainState, '瞬移后链应继续（剩余历史位置不足时结束）').toBeDefined();
        expect(after.libaiChainState!.awaitingPosition).toBe(false);
        expect(libai.position).toEqual(pendingPos);

        // 本地跳过攻击：链应正常收束（无剩余位置 → 归位结束）
        useGameStore.getState().skipLibaiChainAttack();
        const final = useGameStore.getState();
        expect(final.libaiChainState, '跳过且无剩余位置后链应结束').toBeUndefined();
        expect(libai.hasActedThisTurn, '链结束后李太白应已行动').toBe(true);
        // 玩家2 还有其他英雄未行动，回合不切边属于正常回合流程
        expect(final.currentPlayer).toBe('player2');
    });

    it('对手视角点击同步过来的链高亮位置应被拒绝，状态不被污染', () => {
        setupOnlineBattle();

        useGameStore.setState({ currentPlayer: 'player2' });
        for (const hero of [...useGameStore.getState().player1Heroes]) {
            hero.hasActedThisTurn = true;
        }

        const libai = [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-'))!;
        libai.counters['__libai_prev_pos'] = 4 * 6 + 4; // (4,4)

        // 玩家2（李太白方）放技能进链
        useGameStore.getState().selectHeroForAction(libai);
        useGameStore.getState().selectSkill('libai_skill1');
        useGameStore.getState().executeSkill([2, 2]);

        const chainState = useGameStore.getState().libaiChainState!;
        expect(chainState).toBeDefined();
        const pendingPos: Position = chainState.pending[0];
        const chainPendingBefore = chainState.pending.length;

        // 模拟玩家1 的设备收到同步快照后的视角：本地玩家是 player1
        useGameStore.setState({ localPlayerNumber: 1 });

        const posBefore = libai.position ? [...libai.position] as Position : null;
        useGameStore.getState().selectLibaiChainPosition(pendingPos);

        let s = useGameStore.getState();
        expect(s.libaiChainState, '对手操作不得清理链').toBeDefined();
        expect(s.libaiChainState!.pending.length, '对手操作不得消费历史位置').toBe(chainPendingBefore);
        expect(s.libaiChainState!.awaitingPosition, '链仍应处于等待瞬移').toBe(true);
        expect(libai.position, '对手操作不得移动对方李太白').toEqual(posBefore);

        // 对手调用跳过攻击同样应被拒绝
        useGameStore.getState().skipLibaiChainAttack();
        s = useGameStore.getState();
        expect(s.libaiChainState, '对手不得通过跳过按钮结束链').toBeDefined();
        expect(s.currentPlayer, '对手不得触发回合切换').toBe('player2');
    });
});
