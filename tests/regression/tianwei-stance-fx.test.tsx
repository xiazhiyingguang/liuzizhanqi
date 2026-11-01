import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHero, makeGameState } from '../helpers/game-state';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { drainPendingSkillFxRequests, runWithoutSkillFx } from '../../src/data/extended-skills';
import { stanceAnchor } from '../../src/core/tianwei-stance-fx';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, commitOnlineTriggeredFx } from '../../src/services/online-state';
import { buildSkillPreviewScene, previewCellVariants } from '../../src/core/skill-fx-preview';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { HeroStatusFx } from '../../src/components/Game/HeroStatusFx';
import { SkillFxStage } from '../../src/components/HeroCodex/SkillFxPreview';
import { HeroState } from '../../src/types/game';

beforeEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.spyOn(Math, 'random').mockReturnValue(.99); });
afterEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.restoreAllMocks(); });
const cases: ReadonlyArray<readonly [string, string, string]> = [['guying', '断雪', 'snow-break']];
function scene(id: string) {
    const state = makeGameState(), hero = addHero(state, id, 'player1', [3, 1]);
    const victim = addHero(state, 'moran', 'player2', [3, 2]); victim.passiveId = ''; victim.tianweiId = ''; victim.currentHp = 1;
    return { state, hero, victim };
}
describe.each(cases)('%s 天威入势表现', (id, name, kind) => {
    it('真实击杀后只演本人，保留已结算状态与原日志', () => {
        const { state, hero, victim } = scene(id);
        DamageCalculator.applyDamage(victim, DamageCalculator.calculate(hero, victim, 100, false, false, { fixedDamage: true }), hero, state);
        const requests = drainPendingSkillFxRequests().filter(r => r.skillId === `${id}_tianwei`);
        expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ sourceHeroId: hero.id, fromPos: [3, 1], targetPos: [3, 1], damagePositions: [] });
        expect(hero.effects.some(e => e.name === name)).toBe(true);
        expect(state.battleLog.find(l => requests[0].logIds!.includes(l.id))!.type).toBe('tianwei');
        if (id === 'guying') expect(hero.effects.find(e => e.name === name)!.duration).toBe(2);
        else { expect(hero.counters.ignore_defense_next).toBe(1); expect(hero.counters.stealth_turns).toBe(1); }
    });
    it('非致死伤害不会伪造入势', () => {
        const { state, hero, victim } = scene(id); victim.currentHp = victim.maxHp;
        DamageCalculator.applyDamage(victim, DamageCalculator.calculate(hero, victim, 1, false, false, { fixedDamage: true }), hero, state);
        expect(drainPendingSkillFxRequests().some(r => r.skillId === `${id}_tianwei`)).toBe(false);
    });
    it('麻痹封印天威，无演出无新姿态', () => {
        const { state, hero } = scene(id);
        EffectManager.addEffect(hero, { name: '麻痹', type: 'debuff', duration: 1, sourceHeroId: 'test' });
        DamageCalculator.triggerTianwei(hero, state);
        expect(drainPendingSkillFxRequests()).toEqual([]); expect(hero.effects.some(e => e.name === name)).toBe(false);
    });
    it('AI 试算不发事件，演出不多消耗随机数', () => {
        const run = (silent: boolean) => {
            const { state, hero } = scene(id); vi.mocked(Math.random).mockClear();
            if (silent) runWithoutSkillFx(() => DamageCalculator.triggerTianwei(hero, state)); else DamageCalculator.triggerTianwei(hero, state);
            const random = vi.mocked(Math.random).mock.calls.length;
            const requests = drainPendingSkillFxRequests(); if (silent) expect(requests).toEqual([]);
            return { random, effects: hero.effects.map(e => [e.name, e.duration]), counters: hero.counters };
        };
        expect(run(false)).toEqual(run(true));
    });
    it('跟随突进后的落点，死亡/状态移除后不再在旧格播放', () => {
        const { state, hero } = scene(id); DamageCalculator.triggerTianwei(hero, state);
        const event = buildSkillPreviewScene(`${id}_tianwei`).event; event.sourceHeroId = hero.id;
        state.board[3][1] = null; state.board[1][0] = hero; hero.position = [1, 0];
        expect(stanceAnchor(event, state.board)).toEqual([1, 0]);
        hero.state = HeroState.DEAD; expect(stanceAnchor(event, state.board)).toBeUndefined();
        hero.state = HeroState.ALIVE; EffectManager.removeEffectByName(hero, name); expect(stanceAnchor(event, state.board)).toBeUndefined();
    });
    it('连续击杀只显示最新一份入势，多个减益不会挤掉身份标记', () => {
        const { state, hero } = scene(id); DamageCalculator.triggerTianwei(hero, state);
        const old = buildSkillPreviewScene(`${id}_tianwei`).event; old.sourceHeroId = hero.id;
        const next = { ...old, id: old.id + 1 };
        expect(stanceAnchor(old, state.board, [old, next])).toBeUndefined();
        expect(stanceAnchor(next, state.board, [old, next])).toEqual([3, 1]);
        for (const name of ['冰冻', '眩晕']) EffectManager.addEffect(hero, { name, type: 'stun', duration: 1, sourceHeroId: 'test' });
        expect(renderToStaticMarkup(<HeroStatusFx hero={hero} />)).toContain(`ts-emblem-${id === 'guying' ? 'snow' : 'owl'}`);
    });
    it('JSON 权威快照重建同一人的姿态，不重跑机制', () => {
        const { state, hero } = scene(id); DamageCalculator.triggerTianwei(hero, state);
        useGameStore.setState({ ...state, isOnlineMode: false, isAiMode: false });
        const local = useGameStore.getState().skillFx.find(e => e.profile.stance)!;
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame(); applyServerGameState(snapshot); commitOnlineTriggeredFx(new Set());
        const remote = useGameStore.getState().skillFx.find(e => e.profile.stance)!;
        expect(remote.sourceHeroId).toBe(local.sourceHeroId); expect(remote.profile.stance).toBe(kind);
        expect(remote.fromPos).toEqual(local.fromPos); expect(useGameStore.getState().player1Heroes[0].effects.filter(e => e.name === name)).toHaveLength(1);
    });
    it('图鉴/战斗只有一份入势，常驻标记无旧光环且随状态移除', () => {
        const event = buildSkillPreviewScene(`${id}_tianwei`).event;
        expect(previewCellVariants(event, ...event.fromPos)).toEqual(['caster']);
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="target" />)).toBe('');
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html).toContain(`ts-${kind}`); expect(html).not.toContain('fxp-ink');
        const { state, hero } = scene(id); DamageCalculator.triggerTianwei(hero, state);
        const mark = renderToStaticMarkup(<HeroStatusFx hero={hero} />);
        expect(mark).toContain(`ts-emblem-${id === 'guying' ? 'snow' : 'owl'}`);
        expect(mark).not.toContain('sfx-ring');
        EffectManager.removeEffectByName(hero, name);
        expect(renderToStaticMarkup(<HeroStatusFx hero={hero} />)).not.toContain('ts-emblem');
    });
    it('图鉴使用大格自我型预览，不误标为通用兜底', () => {
        const scene = buildSkillPreviewScene(`${id}_tianwei`);
        expect(scene.cols).toBe(3); expect(scene.rows).toBe(2);
        const html = renderToStaticMarkup(<SkillFxStage skillId={`${id}_tianwei`} accent="#a9bfc7" />);
        expect(html).toContain('天威入势'); expect(html).not.toContain('未定制');
    });
});
it('夜枭同回合连续天威不额外增加潜行层数，重复事件不制造状态', () => {
    const { state, hero } = scene('nightowl');
    DamageCalculator.triggerTianwei(hero, state); DamageCalculator.triggerTianwei(hero, state);
    expect(hero.counters.stealth_turns).toBe(1); expect(hero.effects.filter(e => e.name === '潜行')).toHaveLength(1);
    expect(hero.counters.ignore_defense_next).toBe(1);
    expect(drainPendingSkillFxRequests()).toEqual([]);
    const html = renderToStaticMarkup(<HeroStatusFx hero={hero} />);
    expect(html).not.toContain('ts-emblem-owl'); expect(html).not.toContain('sfx-stealth');
    const event = buildSkillPreviewScene('nightowl_tianwei').event;
    expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />)).toBe('');
});
