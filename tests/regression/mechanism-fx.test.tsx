import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { EffectManager } from '../../src/core/effect-manager';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';
import { isDamageFxAt } from '../../src/core/skill-fx';
import { drainPendingSkillFxRequests } from '../../src/data/extended-skills';
import { moranPassive } from '../../src/data/heroes';
import { getSkill } from '../../src/data/skills';
import { SkillFxStage } from '../../src/components/HeroCodex/SkillFxPreview';
import { HeroStatusFx } from '../../src/components/Game/HeroStatusFx';
import { HeroState, type GameState, type Hero } from '../../src/types/game';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applySnapshotAction } from '../../src/services/online-state';
import { addHero, makeGameState } from '../helpers/game-state';

function hit(state: GameState, attacker: Hero, target: Hero, amount: number) {
    DamageCalculator.applyDamage(target, DamageCalculator.calculate(attacker, target, amount, false), attacker, state);
}
function buff(hero: Hero, name: string) {
    EffectManager.addEffect(hero, { name, type: 'buff', duration: -1, sourceHeroId: hero.id, description: '' });
}

describe('高优先级机制的真实触发', () => {
    beforeEach(() => { drainPendingSkillFxRequests(); useGameStore.getState().resetGame(); vi.spyOn(Math, 'random').mockReturnValue(.99); });
    afterEach(() => { drainPendingSkillFxRequests(); useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

    it('长离首次致命伤复生，普通受伤及已用尽复生不重复播放', () => {
        const state = makeGameState();
        const hero = addHero(state, 'changli', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        hit(state, enemy, hero, 3);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        hit(state, enemy, hero, 1000);
        const [event] = drainPendingSkillFxRequests();
        expect(event).toMatchObject({ skillId: 'changli_rebirth', sourceHeroId: hero.id, fromPos: [2, 2], targetPos: [2, 2], damagePositions: [] });
        expect(hero.state).toBe(HeroState.ALIVE);
        expect(hero.effects.some(e => e.name === '长离复生增伤')).toBe(true);
        expect(state.battleLog.find(log => event.logIds?.includes(log.id))?.details?.skillFxRequest).toEqual(event);
        hit(state, enemy, hero, 1000);
        expect(drainPendingSkillFxRequests().some(fx => fx.skillId === 'changli_rebirth')).toBe(false);
        expect(hero.state).toBe(HeroState.DEAD);
    });

    it('杰茨米往返切形各出一份演出，保持生命与棋盘位置', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jetzmi', 'player1', [0, 5]);
        const hp = hero.currentHp;
        GameEngine.switchJetzmiFormInPlace(hero, state);
        GameEngine.switchJetzmiFormInPlace(hero, state);
        const events = drainPendingSkillFxRequests();
        expect(events.map(e => e.skillId)).toEqual(['jetzmi_king_shift', 'jetzmi_lord_shift']);
        expect(events.every(e => e.fromPos[0] === 0 && e.targetPos[1] === 5 && e.damagePositions?.length === 0)).toBe(true);
        expect(hero.currentHp).toBe(hp);
        expect(hero.state).toBe(HeroState.ALIVE);
        expect(state.board[0][5]).toBe(hero);
    });

    it('暂时阵亡切形使用离场前位置，真实死亡不伪造切形', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jetzmi', 'player1', [3, 1]);
        GameEngine.tempDeath(hero, state);
        expect(drainPendingSkillFxRequests()).toMatchObject([{ skillId: 'jetzmi_king_shift', targetPos: [3, 1] }]);
        GameEngine.tempDeath(hero, state);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        const real = addHero(state, 'jetzmi', 'player2', [3, 4]);
        const enemy = addHero(state, 'moran', 'player1', [3, 3]);
        hit(state, enemy, real, 1000);
        expect(drainPendingSkillFxRequests().some(e => e.skillId.includes('shift'))).toBe(false);
    });

    it('玄霄先蓄势，再将真实来袭转为治疗，之后不重复转化', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanxiao', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [1, 2]);
        hero.currentHp = 20;
        hit(state, enemy, hero, 6);
        expect(hero.counters['xuanxiao_danger_armed']).toBe(1);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        const hp = hero.currentHp;
        hit(state, enemy, hero, 6);
        const [event] = drainPendingSkillFxRequests();
        expect(event).toMatchObject({ skillId: 'xuanxiao_conversion', sourceHeroId: hero.id, fromPos: [1, 2], targetPos: [2, 2], damagePositions: [] });
        expect(hero.currentHp).toBeGreaterThan(hp);
        expect(hero.counters['xuanxiao_danger_used']).toBe(1);
        hit(state, enemy, hero, 2);
        expect(drainPendingSkillFxRequests()).toEqual([]);
    });

    it('金银错回击指向实际攻击者，致命回击保留死亡前落点与伤害日志', () => {
        const state = makeGameState();
        const hero = addHero(state, 'zhenxiao', 'player1', [4, 1]);
        const enemy = addHero(state, 'moran', 'player2', [1, 4]);
        buff(hero, '金银错'); enemy.currentHp = 1;
        hit(state, enemy, hero, 8);
        const [event] = drainPendingSkillFxRequests().filter(e => e.skillId === 'zhenxiao_counter');
        expect(event).toMatchObject({ sourceHeroId: hero.id, fromPos: [4, 1], targetPos: [1, 4], damagePositions: [[1, 4]], softImpactPositions: [[4, 1]] });
        expect(enemy.state).toBe(HeroState.DEAD);
        const log = state.battleLog.find(log => event.logIds?.includes(log.id));
        expect(log?.details?.sourceHeroId).toBe(hero.id);
        expect(log?.details?.targetHeroId).toBe(enemy.id);
        hero.position = [5, 0];
        expect(event.fromPos).toEqual([4, 1]);
    });

    it('双方金银错仍只有一次回击演出，反击锁不变', () => {
        const state = makeGameState();
        const a = addHero(state, 'zhenxiao', 'player1', [2, 2]);
        const b = addHero(state, 'zhenxiao', 'player2', [2, 3]);
        buff(a, '金银错'); buff(b, '金银错');
        hit(state, b, a, 5);
        expect(drainPendingSkillFxRequests().filter(e => e.skillId === 'zhenxiao_counter')).toHaveLength(1);
    });

    it('龙势只在真正抵住致命伤时护身，护盾完全吸收和普通受伤不触发', () => {
        const state = makeGameState();
        const hero = addHero(state, 'zhenxiao', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        buff(hero, '龙势'); hero.shield = 1000;
        hit(state, enemy, hero, 200);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        hero.shield = 0; hit(state, enemy, hero, 2);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        hit(state, enemy, hero, 200);
        expect(drainPendingSkillFxRequests()).toMatchObject([{ skillId: 'zhenxiao_laststand', targetPos: [2, 2], damagePositions: [] }]);
        expect(hero.currentHp).toBeGreaterThan(0);
        expect(hero.state).toBe(HeroState.ALIVE);
    });

    it('墨阑第二击获得再动时才展开墨印，额外行动期间不会循环播放', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'nightowl', 'player2', [2, 3]);
        buff(hero, '为道'); hero.hasActedThisTurn = true;
        hit(state, enemy, hero, 2);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        expect(hero.counters['为道受击']).toBe(1);
        hit(state, enemy, hero, 2);
        expect(drainPendingSkillFxRequests()).toMatchObject([{ skillId: 'moran_extra_action', fromPos: [2, 2], targetPos: [2, 2], damagePositions: [] }]);
        expect(state.pendingExtraActionHeroIds?.player1).toBe(hero.id);
        expect(hero.hasActedThisTurn).toBe(false);
        buff(hero, '为道'); state.performingExtraAction = true; state.activeHero = hero;
        moranPassive.execute!(hero, state);
        expect(drainPendingSkillFxRequests()).toEqual([]);
    });

    it('联机快照可重建被动演出，同一快照重收不会重复派发', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jetzmi', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [2, 3]);
        GameEngine.switchJetzmiFormInPlace(hero, state);
        drainPendingSkillFxRequests();
        useGameStore.setState({ ...state, skillFx: [] });
        const snapshot = createOnlineStateSnapshot(useGameStore.getState());
        useGameStore.setState({ battleLog: [], skillFx: [] });
        const action = { type: 'end-turn', data: { heroId: hero.id } };
        applySnapshotAction(action, snapshot);
        expect(useGameStore.getState().skillFx).toHaveLength(1);
        const event = useGameStore.getState().skillFx[0];
        expect(event.profile.mechanism).toBe('king-shift');
        expect(isDamageFxAt(event, event.targetPos)).toBe(false);
        applySnapshotAction(action, snapshot);
        expect(useGameStore.getState().skillFx).toHaveLength(1);
    });

    it('杰茨米技能二切形合成一份王冠，本地与联机一致；未切形仍播原效果', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jetzmi', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [4, 4]);
        useGameStore.setState({ ...state, selectedHero: hero, selectedSkill: getSkill('jetzmi_skill2')!, skillFx: [] });
        vi.mocked(Math.random).mockReturnValue(.1);
        useGameStore.getState().executeSkill([2, 2]);
        const local = useGameStore.getState().skillFx;
        expect(local.filter(e => e.skillId === 'jetzmi_king_shift')).toHaveLength(1);
        expect(local.some(e => e.skillId === 'jetzmi_skill2')).toBe(false);
        const snapshot = createOnlineStateSnapshot(useGameStore.getState());
        useGameStore.setState({ ...state, battleLog: [], skillFx: [] });
        applySnapshotAction({ type: 'skill', data: { heroId: hero.id, skillId: 'jetzmi_skill2', targetPos: [2, 2] } }, snapshot);
        expect(useGameStore.getState().skillFx.filter(e => e.skillId === 'jetzmi_king_shift')).toHaveLength(1);
        expect(useGameStore.getState().skillFx.some(e => e.skillId === 'jetzmi_skill2')).toBe(false);
        useGameStore.setState({ ...state, battleLog: [], skillFx: [], selectedHero: hero,
            selectedSkill: getSkill('jetzmi_skill2')!, activeHero: null });
        hero.hasActedThisTurn = false; hero.hasMovedThisTurn = false;
        vi.mocked(Math.random).mockReturnValue(.99);
        useGameStore.getState().executeSkill([2, 2]);
        expect(useGameStore.getState().skillFx.some(e => e.skillId === 'jetzmi_skill2')).toBe(true);
        expect(useGameStore.getState().skillFx.some(e => e.profile.mechanism)).toBe(false);
    });
});

describe('机制演出与静态标识', () => {
    it.each(['changli_rebirth', 'jetzmi_king_shift', 'jetzmi_lord_shift', 'xuanxiao_conversion',
        'zhenxiao_counter', 'zhenxiao_laststand', 'moran_extra_action'])('%s 每次只有一个主体，不铺范围底光', skillId => {
        const html = renderToStaticMarkup(<SkillFxStage skillId={skillId} accent="#967340" />);
        expect(html.match(/data-mechanism=/g)).toHaveLength(1);
        expect(html).not.toContain('skill-area-fx');
        expect(html).not.toContain('fxp-hitflash');
        const { event } = buildSkillPreviewScene(skillId);
        expect(isDamageFxAt(event, event.targetPos)).toBe(skillId === 'zhenxiao_counter');
    });

    it('当前形态可见，复生强化与化险为夷标识随真实状态移除', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jetzmi', 'player1', [0, 0]);
        const draw = () => renderToStaticMarkup(<HeroStatusFx hero={hero} />);
        expect(draw()).toContain('data-mechanism-state="lord"');
        hero.counters['jetzmi_form'] = 1;
        expect(draw()).toContain('data-mechanism-state="king"');
        hero.state = HeroState.TEMP_DEAD;
        expect(draw()).not.toContain('data-mechanism-state');
        const changli = addHero(state, 'changli', 'player1', [1, 0]);
        buff(changli, '长离复生增伤');
        expect(renderToStaticMarkup(<HeroStatusFx hero={changli} />)).toContain('data-mechanism-state="rebirth"');
        changli.effects = [];
        expect(renderToStaticMarkup(<HeroStatusFx hero={changli} />)).not.toContain('data-mechanism-state');
        const xuanxiao = addHero(state, 'xuanxiao', 'player1', [1, 1]);
        xuanxiao.counters['xuanxiao_danger_armed'] = 1;
        expect(renderToStaticMarkup(<HeroStatusFx hero={xuanxiao} />)).toContain('data-mechanism-state="danger"');
        xuanxiao.counters['xuanxiao_danger_armed'] = 0;
        expect(renderToStaticMarkup(<HeroStatusFx hero={xuanxiao} />)).not.toContain('data-mechanism-state');
    });
});
