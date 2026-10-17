import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, applySnapshotAction, commitOnlineTriggeredFx } from '../../src/services/online-state';
import { getSkill } from '../../src/data/skills';
import { drainPendingSkillFxRequests } from '../../src/data/extended-skills';
import { placeRod, tickCloudsAtRoundStart } from '../../src/core/thunder-cloud';
import { soundManager } from '../../src/core/sound-manager';
import { cloudStrikePaths } from '../../src/core/yunxiu-cloud-fx';
import { addHero, makeGameState } from '../helpers/game-state';

function scene(empty = false, lethal = false) {
    const state = makeGameState();
    const caster = addHero(state, 'yunxiu', 'player1', [2, 0]);
    const cells: [number, number][] = empty ? [[5, 5]] : [[1, 2], [2, 3], [3, 3]];
    for (const cell of cells) {
        const enemy = addHero(state, 'baize', 'player2', cell);
        enemy.currentHp = lethal && cell[0] === 1 ? 1 : 100;
        enemy.maxHp = 100; enemy.defense = 0; enemy.passiveId = '';
    }
    useGameStore.setState({ ...state, selectedHero: caster, activeHero: caster, selectedSkill: getSkill('yunxiu_skill1')!,
        skillFx: [], skillFxExtras: undefined, isAiMode: false, isOnlineMode: false, gameMode: 'standard',
        pendingBoardAction: undefined, performingExtraAction: false });
    return caster;
}

beforeEach(() => {
    useGameStore.getState().resetGame(); drainPendingSkillFxRequests();
    vi.spyOn(Math, 'random').mockReturnValue(.99);
    vi.spyOn(soundManager, 'playSkillFx').mockImplementation(() => undefined);
});
afterEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.restoreAllMocks(); });

describe('云岫真实施法与每轮落雷', () => {
    it('一次布云一团区域，三人受击由同一个事件记录', () => {
        scene(); useGameStore.getState().executeSkill([2, 2]);
        const state = useGameStore.getState(), events = state.skillFx.filter(e => e.skillId === 'yunxiu_skill1');
        expect(events).toHaveLength(1);
        expect(state.boardEffects?.filter(e => e.type === 'thunder-cloud')).toHaveLength(1);
        expect(events[0].targetPos).toEqual([2, 2]);
        expect(events[0].impactPositions).toHaveLength(3);
        expect(state.player2Heroes.map(h => h.currentHp)).toEqual([96, 96, 96]);
    });
    it('每轮整团移位后新发一组闪电，伤害日志归属落雷事件', () => {
        const caster = scene(); useGameStore.getState().executeSkill([2, 2]);
        useGameStore.setState({ skillFx: [] });
        const state = useGameStore.getState(), cloudId = state.boardEffects![0].id;
        placeRod(state, caster, [2, 4]);
        tickCloudsAtRoundStart(state, caster);
        useGameStore.setState({ boardEffects: [...state.boardEffects!], battleLog: [...state.battleLog] });
        const next = useGameStore.getState(), event = next.skillFx.find(e => e.skillId === 'yunxiu_cloud')!;
        expect(event).toBeDefined(); expect(event.targetPos).toEqual([2, 3]);
        expect(event.logIds).toHaveLength(3);
        expect(next.boardEffects?.find(e => e.id === cloudId)?.position).toEqual([2, 3]);
        expect(next.player2Heroes.map(h => h.currentHp)).toEqual([92, 92, 92]);
        expect(next.battleLog.some(log => !!log.details?.skillFxRequest)).toBe(true);
    });
    it('被落云击杀的人仍保留闪电位置；空云不会向友方或空格补雷', () => {
        scene(false, true); useGameStore.getState().executeSkill([2, 2]);
        const event = useGameStore.getState().skillFx.find(e => e.skillId === 'yunxiu_skill1')!;
        expect(event.impactPositions).toContainEqual([1, 2]);
        scene(true); useGameStore.getState().executeSkill([2, 2]);
        const empty = useGameStore.getState().skillFx.find(e => e.skillId === 'yunxiu_skill1')!;
        expect(cloudStrikePaths(empty.targetPos, empty.impactPositions ?? [])).toEqual([]);
    });
    it('联机对端重建布云与后续落雷，保留同一组真实目标', () => {
        const caster = scene();
        const before = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().executeSkill([2, 2]);
        const after = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.setState({ skillFx: [] }); applyServerGameState(before);
        applySnapshotAction({ type: 'skill', data: { heroId: caster.id, skillId: 'yunxiu_skill1', targetPos: [2, 2] } }, after);
        expect(useGameStore.getState().skillFx[0].impactPositions).toHaveLength(3);
        useGameStore.setState({ skillFx: [] });
        const state = useGameStore.getState(), localCaster = state.player1Heroes[0];
        const logIdsBefore = new Set(state.battleLog.map(log => log.id));
        placeRod(state, localCaster, [2, 4]); tickCloudsAtRoundStart(state, localCaster);
        const postTick = JSON.parse(JSON.stringify(createOnlineStateSnapshot(state)));
        drainPendingSkillFxRequests();
        applyServerGameState(after); applyServerGameState(postTick); commitOnlineTriggeredFx(logIdsBefore);
        const events = useGameStore.getState().skillFx.filter(e => e.skillId === 'yunxiu_cloud');
        expect(events).toHaveLength(1); expect(events[0].targetPos).toEqual([2, 3]);
        expect(events[0].impactPositions).toHaveLength(3); expect(events[0].logIds).toHaveLength(3);
    });
});
