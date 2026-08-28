import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, applySnapshotAction } from '../../src/services/online-state';
import { soundManager } from '../../src/core/sound-manager';
import { getSkillSound } from '../../src/data/skill-sounds';
import type { BattleLogEntry, Hero, Position } from '../../src/types/game';

/**
 * 联机模式下"未出手的一方"也必须看到战斗表现。
 *
 * 背景：战斗阶段行动方提交的是技能结算完的权威快照，对端 handleActionBroadcast
 * 直接 applyServerGameState 落地并 return，不会重跑 executeSkill ——
 * 而音效挂在 executeSkillBase、特效挂在 executeSkill 包装层，
 * 于是出手玩家看到完整表现、对手端全程静默无特效。
 * 现在由 applySnapshotAction 依据 action 载荷重建表现。
 */

function setupOnlineBattle(): Hero {
    useGameStore.getState().resetGame();
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

    // 轮到玩家2（施法方），玩家1 全员已行动
    useGameStore.setState({ currentPlayer: 'player2' });
    for (const hero of [...useGameStore.getState().player1Heroes]) {
        hero.hasActedThisTurn = true;
    }
    const libai = [...useGameStore.getState().player2Heroes].find(h => h.id.startsWith('libai-player2-'))!
    expect(libai).toBeDefined();
    return libai;
}

/** 行动方施放李太白技能1，返回线上会广播的 action 与前后两份权威快照 */
function actorCastSkill(libai: Hero) {
    const preSnapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
    useGameStore.getState().selectHeroForAction(libai);
    useGameStore.getState().selectSkill('libai_skill1');
    useGameStore.getState().executeSkill([2, 2]);
    const postSnapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
    const action = {
        type: 'skill',
        data: { heroId: libai.id, skillId: 'libai_skill1', targetPos: [2, 2] as Position }
    };
    return { preSnapshot, postSnapshot, action };
}

/** 把 store 切到对手视角：回到施法前的快照，并清空行动方本地的表现队列 */
function resetToReceiverView(preSnapshot: any) {
    useGameStore.setState({ skillFx: [], localPlayerNumber: 1 });
    applyServerGameState(preSnapshot);
    expect(useGameStore.getState().skillFx).toHaveLength(0);
}

function padBattleLog(count: number) {
    const filler: BattleLogEntry[] = Array.from({ length: count }, (_, index) => ({
        id: `filler-${index}`,
        timestamp: Date.now(),
        type: 'damage',
        player: 'player1',
        message: `填充日志 ${index}`
    }));
    useGameStore.setState({ battleLog: filler });
}

describe('联机对手施法的表现回放', () => {
    let playSpy: Mock;

    beforeEach(() => {
        playSpy = vi.spyOn(soundManager, 'playSkill').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().resetGame();
    });

    it('收到权威快照时重建音效与技能特效', () => {
        const libai = setupOnlineBattle();
        const homePos = [...libai.position!] as Position;
        const { preSnapshot, postSnapshot, action } = actorCastSkill(libai);

        resetToReceiverView(preSnapshot);
        playSpy.mockClear();

        applySnapshotAction(action, postSnapshot);

        const receiver = useGameStore.getState();
        expect(playSpy, '对手施法应在本端播放同一音效').toHaveBeenCalledWith(
            'libai_skill1',
            getSkillSound('libai_skill1')
        );
        expect(receiver.skillFx).toHaveLength(1);
        const [fx] = receiver.skillFx;
        expect(fx.profile.kind, '特效档案应与行动方一致').toBe('libai-slash');
        expect(fx.owner).toBe('player2');
        expect(fx.fromPos).toEqual(homePos);
        expect(fx.targetPos).toEqual([2, 2]);
        expect(fx.id, '特效 id 由本端序列生成').toBeGreaterThan(0);
    });

    it('battleLog 打满截断后仍按日志 id 判定，特效不丢', () => {
        const libai = setupOnlineBattle();
        padBattleLog(200);
        const { preSnapshot, postSnapshot, action } = actorCastSkill(libai);

        // 前后两份快照的日志条数相同（截断），长度差算不出新增条目
        expect(preSnapshot.battleLog).toHaveLength(200);
        expect(postSnapshot.battleLog).toHaveLength(200);

        resetToReceiverView(preSnapshot);
        applySnapshotAction(action, postSnapshot);

        expect(useGameStore.getState().skillFx, '截断不得让对手端丢失特效').toHaveLength(1);
    });

    it('非法或无关 action 不产生任何表现', () => {
        setupOnlineBattle();
        playSpy.mockClear();

        applySnapshotAction({ type: 'move', data: { heroId: 'x', to: [1, 1] } }, null);
        applySnapshotAction({ type: 'skill', data: { heroId: 'x', skillId: 'libai_skill1' } }, null);

        expect(playSpy, '非技能动作与缺少目标格的载荷都不应触发表现').not.toHaveBeenCalled();
        expect(useGameStore.getState().skillFx, 'resetGame 不应把上一局的特效带进新局').toHaveLength(0);
    });
});
