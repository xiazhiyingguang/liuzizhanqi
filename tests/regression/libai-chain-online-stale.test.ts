import { describe, expect, it } from 'vitest';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState } from '../../src/services/online-state';
import type { Hero, Position } from '../../src/types/game';

/**
 * 联机快照对"挂起态清理"的传递回归。
 *
 * 背景：醉步留痕链（libaiChainState）是多步挂起状态，结束侧代码用
 * `set({ libaiChainState: undefined })` 清理。但联机传输是 JSON 编码，
 * 值为 undefined 的属性会被整体丢弃；而 applyServerGameState 走 Zustand 浅合并，
 * 快照里缺失的 key 会保留本地旧值。于是"链已结束"这个信号传不到对端，
 * 对端带着残留链行动时又会把它原样回传给真正的拥有者，
 * 拥有者本地守卫（被动链进行中禁止移动/施法）随即把李太白锁死。
 * 人机模式不经过 applyServerGameState，所以只在联机里复现。
 */

/** 模拟联机传输层：socket.io 对非二进制包做 JSON 编码，undefined 字段随之消失 */
function transport(value: any) {
    return JSON.parse(JSON.stringify(value));
}

function getLibai(): Hero {
    const hero = [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-'));
    if (!hero) throw new Error('李太白未上场');
    return hero;
}

/** 本地作为李太白拥有者走完整条链，返回开链/结链两份快照（均已过传输层） */
function playChainToEnd(): { open: any; ended: any } {
    useGameStore.getState().resetGame();
    // 联机模式不设 onlineRoomId：sendOnline* 静默跳过，专注快照与应用逻辑
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

    // 玩家1 全员已行动，把回合交给玩家2（本地拥有者）
    useGameStore.setState({ currentPlayer: 'player2' });
    for (const hero of [...useGameStore.getState().player1Heroes]) {
        hero.hasActedThisTurn = true;
    }

    const libai = getLibai();
    // 制造历史位置：模拟回合开始时记录的上次停留位置
    libai.counters['__libai_prev_pos'] = 4 * 6 + 4; // (4,4)

    useGameStore.getState().selectHeroForAction(libai);
    useGameStore.getState().selectSkill('libai_skill1');
    useGameStore.getState().executeSkill([2, 2]);

    const chainState = useGameStore.getState().libaiChainState;
    expect(chainState, '技能1后应进入醉步留痕链').toBeDefined();
    const open = transport(createOnlineStateSnapshot(useGameStore.getState()));

    const pendingPos: Position = chainState!.pending[0];
    useGameStore.getState().selectLibaiChainPosition(pendingPos);
    useGameStore.getState().skipLibaiChainAttack();

    expect(useGameStore.getState().libaiChainState, '链走完后本地应已清理').toBeUndefined();
    const ended = transport(createOnlineStateSnapshot(useGameStore.getState()));
    return { open, ended };
}

describe('联机快照的挂起态清理传递', () => {
    it('链结束快照必须清理对端残留的醉步留痕链', () => {
        const { open, ended } = playChainToEnd();
        expect('libaiChainState' in open, '开链快照应携带挂起链').toBe(true);
        expect('libaiChainState' in ended, '传输层丢弃 undefined 字段（清理信号只能靠显式补回）').toBe(false);

        // 对手端：先收到开链快照，再收到结链快照
        useGameStore.setState({ localPlayerNumber: 1 });
        applyServerGameState(open);
        expect(useGameStore.getState().libaiChainState, '对手端应显示对方的链').toBeDefined();

        applyServerGameState(ended);
        expect(useGameStore.getState().libaiChainState, '结链快照必须清理对手端残留链').toBeUndefined();
    });

    it('残留链不得经对手快照反弹回拥有者并锁死其移动', () => {
        const { open, ended } = playChainToEnd();

        // 对手端收到开链后，结链快照没能清理它
        useGameStore.setState({ localPlayerNumber: 1 });
        applyServerGameState(open);
        applyServerGameState(ended);

        // 对手带着残留链轮到自己行动：快照会把拥有者的链原样回传
        const fromOpponent = transport(createOnlineStateSnapshot(useGameStore.getState()));
        expect('libaiChainState' in fromOpponent, '残留链不得被对手回传').toBe(false);

        // 回到拥有者视角的下一回合
        useGameStore.setState({ localPlayerNumber: 2 });
        applyServerGameState(fromOpponent);
        useGameStore.setState({ currentPlayer: 'player2' });
        const libai = getLibai();
        libai.hasActedThisTurn = false;
        libai.hasMovedThisTurn = false;

        useGameStore.getState().selectHeroForAction(libai);
        useGameStore.getState().showMoveRange();
        expect(useGameStore.getState().moveRange.length, '李太白下一回合必须能普通移动').toBeGreaterThan(0);

        useGameStore.getState().selectSkill('libai_skill1');
        expect(useGameStore.getState().selectedSkill?.id, '李太白下一回合必须能施法').toBe('libai_skill1');
    });

    it('非行动方的残留链在应用快照时应被丢弃（自愈守卫）', () => {
        const { open } = playChainToEnd();

        // 对端在自己回合把已结束的李太白链回传回来
        const staleEcho = transport({ ...open, currentPlayer: 'player1' });
        expect(staleEcho.libaiChainState, '回传快照仍带着残留链').toBeDefined();

        useGameStore.setState({ localPlayerNumber: 2 });
        applyServerGameState(staleEcho);
        expect(useGameStore.getState().libaiChainState, '不属于行动方的残留链不得落地').toBeUndefined();
    });
});
