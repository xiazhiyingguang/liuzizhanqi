import { beforeEach, describe, expect, it } from 'vitest';
import {
    getBattleReplay,
    hasBattleReplay,
    noteReplayStep,
    resetBattleReplay,
    subscribeBattleReplay,
} from '../../src/services/battle-replay';
import { addHero, makeGameState } from '../helpers/game-state';
import type { GameState } from '../../src/types/game';

function battleFixture(matchId: string): GameState {
    const state = makeGameState({ phase: 'battle', matchId });
    addHero(state, 'huifeng', 'player1', [2, 2]);
    addHero(state, 'moran', 'player2', [3, 3]);
    return state;
}

describe('对局回放录制器', () => {
    beforeEach(() => resetBattleReplay());

    it('非战斗阶段不录制', () => {
        noteReplayStep(makeGameState({ phase: 'menu', matchId: 'm0' }));
        expect(getBattleReplay().frames).toHaveLength(0);
        expect(hasBattleReplay()).toBe(false);
    });

    it('同一签名的重复提交不产生新帧，但会把新战报并入当前帧', () => {
        const state = battleFixture('m1');
        noteReplayStep(state);
        expect(getBattleReplay().frames).toHaveLength(1);

        // 同一步里的纯视觉提交（签名不变）
        noteReplayStep({ ...state, skillFx: [] } as GameState);
        expect(getBattleReplay().frames).toHaveLength(1);

        // 新增一条战报：仍不产生新帧，但当前帧的战报区间要覆盖它
        state.battleLog = [{ id: 'log-1', timestamp: 0, type: 'damage', player: 'player1', message: '回锋造成4点伤害' }];
        noteReplayStep(state);
        const [frame] = getBattleReplay().frames;
        expect(getBattleReplay().frames).toHaveLength(1);
        expect(frame.logTo).toBe(1);
        expect(getBattleReplay().narration[0].id).toBe('log-1');
    });

    it('局面真正推进时产生新帧，并带上本步战报区间', () => {
        const state = battleFixture('m2');
        noteReplayStep(state);
        const hero = state.player1Heroes[0];

        hero.position = [2, 3];
        state.board[2][2] = null;
        state.board[2][3] = hero;
        state.battleLog = [{ id: 'log-move', timestamp: 0, type: 'move', player: 'player1', message: '回锋移动到(3,4)' }];
        noteReplayStep(state);

        const replay = getBattleReplay();
        expect(replay.frames).toHaveLength(2);
        expect(replay.frames[1].logFrom).toBe(0);
        expect(replay.frames[1].logTo).toBe(1);
        expect(hasBattleReplay()).toBe(true);
    });

    it('换局（matchId 变化）会丢弃上一局的录像', () => {
        noteReplayStep(battleFixture('m3'));
        expect(getBattleReplay().frames.length).toBeGreaterThan(0);

        noteReplayStep(battleFixture('m4'));
        const replay = getBattleReplay();
        expect(replay.matchId).toBe('m4');
        expect(replay.frames).toHaveLength(1);
        expect(replay.narration).toHaveLength(0);
    });

    it('快照对象引用稳定，只有新帧才通知订阅者', () => {
        const state = battleFixture('m5');
        noteReplayStep(state);
        const firstSnapshot = getBattleReplay();
        expect(getBattleReplay()).toBe(firstSnapshot);

        let notified = 0;
        const unsubscribe = subscribeBattleReplay(() => { notified++; });
        try {
            noteReplayStep(state);                       // 签名未变 → 不通知
            expect(notified).toBe(0);
            expect(getBattleReplay()).toBe(firstSnapshot);

            state.roundNumber = 2;                        // 真正推进 → 通知且换引用
            noteReplayStep(state);
            expect(notified).toBe(1);
            expect(getBattleReplay()).not.toBe(firstSnapshot);
        } finally {
            unsubscribe();
        }
    });
});
