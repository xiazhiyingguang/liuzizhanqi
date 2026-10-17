import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, applySnapshotAction } from '../../src/services/online-state';
import { attachDragon } from '../../src/core/dragon-orbit';
import { dragonDashTiming, dragonSweepGeometry } from '../../src/core/dragon-sweep-fx';
import { aoyuanPresentation, dragonBodyEndMs } from '../../src/core/aoyuan-presentation';
import { computeFxImpactDelayMs, type SkillFxEvent } from '../../src/core/skill-fx';
import { getSkill } from '../../src/data/skills';
import { soundManager } from '../../src/core/sound-manager';
import { addHero, makeGameState } from '../helpers/game-state';

function prepare(skill: 'aoyuan_skill1' | 'aoyuan_skill2') {
    const state = makeGameState();
    const caster = addHero(state, 'aoyuan', 'player1', skill.endsWith('1') ? [2, 2] : [2, 1]);
    const enemies = skill.endsWith('1') ? [[1, 3], [2, 3]] as const : [[2, 2], [1, 3]] as const;
    for (const cell of enemies) {
        const enemy = addHero(state, 'baize', 'player2', [...cell]);
        enemy.maxHp = enemy.currentHp = 100; enemy.defense = 0; enemy.passiveId = '';
    }
    if (skill.endsWith('2')) attachDragon(caster, [1, 1]);
    useGameStore.setState({ ...state, isOnlineMode: false, isAiMode: false, gameMode: 'standard',
        selectedHero: caster, activeHero: caster, selectedSkill: getSkill(skill)!, skillFx: [],
        performingExtraAction: false, pendingBoardAction: undefined, skillFxExtras: undefined });
    return caster;
}

beforeEach(() => {
    useGameStore.getState().resetGame();
    vi.spyOn(Math, 'random').mockReturnValue(.99);
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(soundManager, 'playSkillFx').mockImplementation(() => undefined);
});
afterEach(() => { useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

describe('游龙实战连续演出', () => {
    it.each(['aoyuan_skill1', 'aoyuan_skill2'] as const)('%s 联机接收端也保留唯一龙身与分段时序', skillId => {
        const caster = prepare(skillId);
        const before = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        const targetPos = skillId.endsWith('1') ? [1, 2] as [number, number] : [2, 3] as [number, number];
        useGameStore.getState().executeSkill(targetPos);
        const after = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        const actor = useGameStore.getState().skillFx;
        useGameStore.setState({ skillFx: [] });
        applyServerGameState(before);
        applySnapshotAction({ type: 'skill', data: { heroId: caster.id, skillId, targetPos } }, after);
        const received = useGameStore.getState().skillFx;
        expect(received).toHaveLength(2);
        for (const local of actor) {
            const remote = received.find(e => e.skillId === local.skillId)!;
            expect(remote).toBeDefined();
            expect(remote.dragonContactsOnly).toBe(local.dragonContactsOnly);
            expect(remote.bornAt).toBe(local.bornAt);
            expect(remote.dragonStartDeg).toBe(local.dragonStartDeg);
            expect(remote.logIds).toEqual(local.logIds);
        }
    });
    it('唤龙保留整圈，行动被动仅保留命中，伤害日志不重复归属', () => {
        const caster = prepare('aoyuan_skill1');
        useGameStore.getState().executeSkill([1, 2]);
        const { skillFx, player2Heroes } = useGameStore.getState();
        const call = skillFx.find(e => e.skillId === 'aoyuan_skill1')!;
        const orbit = skillFx.find(e => e.skillId === 'aoyuan_orbit')!;
        expect(call).toBeDefined(); expect(orbit).toBeDefined();
        expect(orbit.dragonContactsOnly).toBe(true);
        expect(skillFx.filter(e => dragonBodyEndMs(e) > 0)).toHaveLength(1);
        expect(player2Heroes.map(h => h.currentHp)).toEqual([92, 96]);
        expect(call.logIds?.some(id => orbit.logIds?.includes(id))).toBe(false);
        expect(aoyuanPresentation(skillFx, 1200).hideIdle.has(caster.id)).toBe(true);
        expect(aoyuanPresentation(skillFx, 2500).hideIdle.has(caster.id)).toBe(false);
    });

    it('冲刺先结算，展示中人龙同行，落地后才播放唯一半圈', () => {
        const caster = prepare('aoyuan_skill2');
        useGameStore.getState().executeSkill([2, 3]);
        const { skillFx, board, player2Heroes } = useGameStore.getState();
        const dash = skillFx.find(e => e.skillId === 'aoyuan_skill2')!;
        const sweeps = skillFx.filter(e => e.skillId === 'aoyuan_orbit');
        expect(dash).toBeDefined(); expect(sweeps).toHaveLength(1);
        const sweep = sweeps[0], timing = dragonDashTiming(2);
        expect(board[2][3]?.id).toBe(caster.id);
        expect(player2Heroes[0].currentHp).toBeLessThan(100);
        expect(dash.fromPos).toEqual([2, 1]); expect(dash.targetPos).toEqual([2, 3]);
        expect(sweep.bornAt - dash.bornAt).toBe(timing.sweepDelayMs);
        expect(dragonSweepGeometry(sweep).sweepDeg).toBe(180);
        expect(dash.logIds?.some(id => sweep.logIds?.includes(id))).toBe(false);
        expect(aoyuanPresentation(skillFx, 1100).hideArrived.has(caster.id)).toBe(true);
        expect(aoyuanPresentation(skillFx, 1501).hideArrived.has(caster.id)).toBe(false);
        expect(aoyuanPresentation(skillFx, 1501).hideIdle.has(caster.id)).toBe(true);
        expect(aoyuanPresentation(skillFx, 2800).hideIdle.has(caster.id)).toBe(false);
    });

    it('盘边缺格不会加快半圈或提前命中', () => {
        const caster = prepare('aoyuan_skill2');
        useGameStore.getState().executeSkill([2, 3]);
        const template = useGameStore.getState().skillFx.find(e => e.skillId === 'aoyuan_orbit')!;
        const clipped: SkillFxEvent = { ...template, sourceHeroId: caster.id, fromPos: [0, 0],
            targetPos: [0, 1], dragonStartDeg: 0, coveredPositions: [[0, 1], [1, 1], [1, 0]] };
        expect(dragonSweepGeometry(clipped).sweepDeg).toBe(180);
        expect(computeFxImpactDelayMs(clipped, [0, 1])).toBe(500);
        expect(computeFxImpactDelayMs(clipped, [1, 0])).toBe(860);
    });
});
