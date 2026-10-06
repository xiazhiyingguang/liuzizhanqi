import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { isDamageFxAt } from '../../src/core/skill-fx';
import { getSkill } from '../../src/data/skills';
import { drainPendingSkillFxRequests, triggerXubaiEntrance } from '../../src/data/extended-skills';
import { applySnapshotAction } from '../../src/services/online-state';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('恢复主题与真实受益者', () => {
    beforeEach(() => { drainPendingSkillFxRequests(); useGameStore.getState().resetGame(); });
    afterEach(() => { drainPendingSkillFxRequests(); useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

    it('白泽瑞泽点击自己时，主效仍追随最低生命比例的友方', () => {
        const state = makeGameState();
        const baize = addHero(state, 'baize', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 4]);
        addHero(state, 'huifeng', 'player2', [5, 5]);
        ally.currentHp = 5;
        useGameStore.setState({ ...state, selectedHero: baize, selectedSkill: getSkill('baize_skill1')!, skillFx: [] });
        useGameStore.getState().executeSkill([2, 2]);
        const fx = useGameStore.getState().skillFx.at(-1)!;
        expect(fx.targetPos).toEqual(ally.position);
        expect(fx.profile.recovery).toBe('auspice');
        expect(isDamageFxAt(fx, ally.position!)).toBe(false);
    });

    it('吟游和声标记全部真实受益者，后续回血记在吟游来源下', () => {
        const state = makeGameState();
        const bard = addHero(state, 'bard', 'player1', [2, 2]);
        const ally = addHero(state, 'huifeng', 'player1', [2, 3]);
        const enemy = addHero(state, 'moran', 'player2', [3, 3]);
        ally.currentHp = 10;
        useGameStore.setState({ ...state, selectedHero: bard, selectedSkill: getSkill('bard_skill1')!, skillFx: [] });
        useGameStore.getState().executeSkill([2, 3]);
        const cast = useGameStore.getState().skillFx.at(-1)!;
        expect(cast.softImpactPositions).toContainEqual(ally.position);
        const live = useGameStore.getState();
        DamageCalculator.asOneAttack(() => DamageCalculator.applyDamage(enemy, DamageCalculator.calculate(ally, enemy, 2, false), ally, live));
        const request = drainPendingSkillFxRequests().find(fx => fx.skillId === 'bard_regen')!;
        expect(request).toMatchObject({ sourceHeroId: bard.id, targetPos: ally.position, damagePositions: [] });
        expect(live.battleLog.find(log => request.logIds?.includes(log.id))?.details?.sourceHeroId).toBe(bard.id);
    });

    it('潮汐回血只在实际抬血后派发，联机快照重建一次', () => {
        const state = makeGameState();
        const lingxi = addHero(state, 'lingxi', 'player1', [2, 1]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        ally.currentHp = 10;
        DamageCalculator.applyHeal(ally, 4, state, lingxi);
        const requests = drainPendingSkillFxRequests();
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ skillId: 'lingxi_regen', targetPos: [2, 3], sourceHeroId: lingxi.id, damagePositions: [] });
        expect(state.battleLog.at(-1)?.details?.skillFxRequest).toBeDefined();
        useGameStore.setState({ ...state, battleLog: [], skillFx: [] });
        const snapshot = createOnlineStateSnapshot({ ...useGameStore.getState(), battleLog: state.battleLog });
        applySnapshotAction({ type: 'end-turn', data: { heroId: ally.id } }, snapshot);
        applySnapshotAction({ type: 'end-turn', data: { heroId: ally.id } }, snapshot);
        expect(useGameStore.getState().skillFx.filter(fx => fx.skillId === 'lingxi_regen')).toHaveLength(1);
        ally.currentHp = ally.maxHp;
        DamageCalculator.applyHeal(ally, 4, state, lingxi);
        expect(drainPendingSkillFxRequests()).toHaveLength(0);
    });

    it('初雪只给实际恢复或净化到的单位出主题，魂灯成功回归才出复活', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        ally.currentHp = 10;
        triggerXubaiEntrance(xubai, state);
        const entrance = drainPendingSkillFxRequests().find(fx => fx.skillId === 'xubai_entrance')!;
        expect(entrance.impactPositions).toEqual([[2, 3]]);
        expect(entrance.damagePositions).toEqual([]);
        const lamp = addHero(state, 'soul_lamp', 'player1', [1, 1]);
        lamp.state = HeroState.TEMP_DEAD;
        lamp.currentHp = 0;
        state.board[1][1] = null;
        expect(GameEngine.resurrectHero(lamp, .5, state)).toBe(true);
        expect(drainPendingSkillFxRequests().find(fx => fx.skillId === 'soul_lamp_revive')?.targetPos).toEqual([1, 1]);
    });
});
