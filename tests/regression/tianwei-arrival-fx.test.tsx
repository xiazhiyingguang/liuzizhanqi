import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHero, makeGameState } from '../helpers/game-state';
import { createWukongClone } from '../../src/data/heroes';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { drainPendingSkillFxRequests, runWithoutSkillFx } from '../../src/data/extended-skills';
import { arrivalPoint, arrivalPresentation, CLONE_REVEAL_MS, FROST_ARRIVE_MS } from '../../src/core/tianwei-arrival-fx';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, commitOnlineTriggeredFx } from '../../src/services/online-state';
import { buildSkillPreviewScene, previewCellVariants } from '../../src/core/skill-fx-preview';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { HeroStatusFx } from '../../src/components/Game/HeroStatusFx';
import { HeroState } from '../../src/types/game';
import type { Hero, GameState } from '../../src/types/game';

beforeEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.spyOn(Math, 'random').mockReturnValue(.99); });
afterEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.restoreAllMocks(); });
function scene(id: string) {
    const state = makeGameState(); const hero = addHero(state, id, 'player1', [3, 1]);
    const target = addHero(state, 'baize', 'player2', [1, 4]); target.passiveId = ''; target.tianweiId = '';
    return { state, hero, target };
}
function chill(hero: Hero, layers = 2) { EffectManager.addEffect(hero, { type: 'debuff', name: '寒天', stackCount: layers, duration: 3, sourceHeroId: 'test' }); }
function lethal(state: GameState, killer: Hero, victim: Hero) {
    victim.currentHp = 1; victim.defense = 0;
    DamageCalculator.applyDamage(victim, DamageCalculator.calculate(killer, victim, 100, false, false, { fixedDamage: true }), killer, state);
}

describe('绯雪绝对零度与悟空天威的成功到达演出', () => {
    it('绯雪指向生命比例最低的合法敌人，并保留寒天/原冻结时长', () => {
        const { state, hero, target } = scene('feixue'); chill(target); target.currentHp = 10;
        const other = addHero(state, 'moran', 'player2', [2, 4]); chill(other); other.currentHp = other.maxHp;
        DamageCalculator.triggerTianwei(hero, state);
        const requests = drainPendingSkillFxRequests(); expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ skillId: 'feixue_tianwei', fromPos: [3, 1], targetPos: [1, 4], arrival: { targetHeroId: target.id }, damagePositions: [] });
        expect(target.effects.find(e => e.name === '寒天')!.stackCount).toBe(2);
        expect(target.effects.find(e => e.name === '冰冻')!.duration).toBe(1);
        expect(target.currentHp).toBe(10);
        expect(state.battleLog.find(log => requests[0].logIds!.includes(log.id))!.details?.skillFxRequest).toBeDefined();
    });
    it.each(['无寒天', '已冰冻', '离场', '已阵亡'])('绯雪没有合法目标（%s）时不制造冰封画面或额外日志', why => {
        const { state, hero, target } = scene('feixue');
        if (why !== '无寒天') chill(target);
        if (why === '已冰冻') EffectManager.addEffect(target, { name: '冰冻', type: 'stun', duration: 1, sourceHeroId: 'test' });
        if (why === '离场') { state.board[1][4] = null; target.position = null; }
        if (why === '已阵亡') target.state = HeroState.DEAD;
        DamageCalculator.triggerTianwei(hero, state);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        expect(state.battleLog.some(log => log.details?.kind === 'feixue-absolute-zero')).toBe(false);
    });
    it('已行动目标的冻结仍为两回合，特效不改控制规则', () => {
        const { state, hero, target } = scene('feixue'); chill(target); target.hasActedThisTurn = true;
        DamageCalculator.triggerTianwei(hero, state);
        expect(target.effects.find(e => e.name === '冰冻')!.duration).toBe(2);
    });
    it('绯雪真实击杀后，寒气不是发往死者，而是发往另一个冻结目标', () => {
        const { state, hero, target } = scene('feixue'); chill(target);
        const victim = addHero(state, 'moran', 'player2', [3, 2]); victim.passiveId = ''; victim.tianweiId = '';
        lethal(state, hero, victim);
        expect(drainPendingSkillFxRequests().find(r => r.skillId === 'feixue_tianwei')!.targetPos).toEqual([1, 4]);
    });
    it('悟空演出保存实际分身 ID 与实际落点，不把装饰当成新单位', () => {
        const { state, hero } = scene('wukong');
        DamageCalculator.triggerTianwei(hero, state);
        const request = drainPendingSkillFxRequests().find(r => r.skillId === 'wukong_tianwei')!;
        const clone = state.board[request.targetPos[0]][request.targetPos[1]]!;
        expect(request.arrival!.targetHeroId).toBe(clone.id); expect(request.fromPos).toEqual(hero.position);
        expect(clone.counters.__isClone).toBe(1); expect(clone.currentHp).toBe(10);
        expect(state.board.flat().filter(h => h?.counters.__isClone === 1)).toHaveLength(1);
    });
    it('分身满三名时只保留原失败日志，不播放召唤', () => {
        const { state, hero } = scene('wukong');
        for (let i = 0; i < 3; i++) state.board[0][i] = createWukongClone(hero.owner, hero.id, [0, i], 10);
        DamageCalculator.triggerTianwei(hero, state);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        expect(state.board.flat().filter(h => h?.counters.__isClone === 1)).toHaveLength(3);
    });
    it('周围无空位时不播放召唤，不虚构落点', () => {
        const { state, hero } = scene('wukong');
        for (let r = 2; r <= 4; r++) for (let c = 0; c <= 2; c++) if (r !== 3 || c !== 1) addHero(state, 'baize', 'player1', [r, c]);
        DamageCalculator.triggerTianwei(hero, state);
        expect(drainPendingSkillFxRequests()).toEqual([]);
        expect(state.board.flat().some(h => h?.counters.__isClone === 1)).toBe(false);
    });
    it('分身完成击杀，毫毛仍来自本体，且仅生成一名分身', () => {
        const { state, hero, target } = scene('wukong');
        const clone = createWukongClone(hero.owner, hero.id, [1, 3], 10); state.board[1][3] = clone;
        lethal(state, clone, target);
        const requests = drainPendingSkillFxRequests().filter(r => r.skillId === 'wukong_tianwei');
        expect(requests).toHaveLength(1); expect(requests[0].sourceHeroId).toBe(hero.id); expect(requests[0].fromPos).toEqual(hero.position);
        expect(state.board.flat().filter(h => h?.counters.__isClone === 1)).toHaveLength(2);
    });
    it.each(['feixue', 'wukong'])('%s 被麻痹时不触发演出；AI 模拟也不污染队列', id => {
        const { state, hero, target } = scene(id); chill(target);
        EffectManager.addEffect(hero, { name: '麻痹', type: 'debuff', duration: 1, sourceHeroId: hero.id });
        DamageCalculator.triggerTianwei(hero, state); expect(drainPendingSkillFxRequests()).toEqual([]);
        EffectManager.removeEffectByName(hero, '麻痹');
        runWithoutSkillFx(() => DamageCalculator.triggerTianwei(hero, state));
        expect(drainPendingSkillFxRequests()).toEqual([]);
        expect(state.battleLog.some(log => log.details?.skillFxRequest)).toBe(false);
    });
    it.each(['feixue', 'wukong'])('%s 特效不额外消费随机数，与无特效结算结果一致', id => {
        const run = (suppressed: boolean) => {
            const { state, hero, target } = scene(id); chill(target);
            const random = vi.mocked(Math.random); random.mockClear();
            if (suppressed) runWithoutSkillFx(() => DamageCalculator.triggerTianwei(hero, state)); else DamageCalculator.triggerTianwei(hero, state);
            const calls = random.mock.calls.length; drainPendingSkillFxRequests();
            return { calls, units: state.board.flat().filter(Boolean).map(h => [h!.name, h!.currentHp, h!.position, h!.effects.map(e => [e.name, e.duration])]) };
        };
        expect(run(false)).toEqual(run(true));
    });
    it.each(['feixue', 'wukong'])('%s 经 JSON 联机快照重建相同目标与动画，不再掷骰/召唤', id => {
        const { state, hero, target } = scene(id); chill(target); DamageCalculator.triggerTianwei(hero, state);
        useGameStore.setState({ ...state, isOnlineMode: false, isAiMode: false });
        const local = useGameStore.getState().skillFx.find(e => e.profile.arrival)!;
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame(); applyServerGameState(snapshot); commitOnlineTriggeredFx(new Set());
        const remote = useGameStore.getState().skillFx.find(e => e.profile.arrival)!;
        expect(remote.arrival).toEqual(local.arrival); expect(remote.targetPos).toEqual(local.targetPos);
        expect(remote.fromPos).toEqual(local.fromPos);
    });
    it('动画衔接只隐藏表现，不延迟真实冻结或分身可用；结束后及时恢复', () => {
        const frost = buildSkillPreviewScene('feixue_tianwei').event, monkey = buildSkillPreviewScene('wukong_tianwei').event;
        frost.bornAt = monkey.bornAt = 100;
        expect(arrivalPresentation([frost], 200).pendingFrozen.has('preview-target')).toBe(true);
        expect(arrivalPresentation([frost], 100 + FROST_ARRIVE_MS).pendingFrozen.size).toBe(0);
        expect(arrivalPresentation([monkey], 200).hiddenClones.has('preview-target')).toBe(true);
        expect(arrivalPresentation([monkey], 100 + CLONE_REVEAL_MS).hiddenClones.size).toBe(0);
        const { target } = scene('feixue'); EffectManager.addEffect(target, { name: '冰冻', type: 'stun', duration: 1, sourceHeroId: 'test' });
        expect(renderToStaticMarkup(<HeroStatusFx hero={target} suppressFrozen />)).not.toContain('sfx-frozen');
        expect(renderToStaticMarkup(<HeroStatusFx hero={target} />)).toContain('sfx-frozen');
    });
    it.each(['feixue_tianwei', 'wukong_tianwei'])('%s 图鉴复用真实场景，只有一个 SVG 主效，不铺假伤害', id => {
        const { event, cols } = buildSkillPreviewScene(id); expect(cols).toBe(6);
        expect(previewCellVariants(event, ...event.fromPos)).toEqual(['caster']);
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html).toContain('data-tianwei-arrival'); expect(html).toContain('tw-traveller');
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="target" />)).toBe('');
        expect(event.damagePositions).toEqual([]);
    });
    it('轨迹起止点是快照格中心，没有越格或错目标', () => {
        expect(arrivalPoint([3, 1], [1, 4], 0)).toMatchObject({ x: 150, y: 350 });
        expect(arrivalPoint([3, 1], [1, 4], 1)).toMatchObject({ x: 450, y: 150 });
    });
});
