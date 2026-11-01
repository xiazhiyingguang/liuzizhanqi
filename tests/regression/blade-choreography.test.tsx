import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHero, makeGameState } from '../helpers/game-state';
import { bladePoint, bladePresentation, requestBladeScene } from '../../src/core/blade-choreography';
import { driftFlyingSwords, restoreDriftedSwords, placeFlyingSword, getFlyingSwords, fireAttachedSwords } from '../../src/core/flying-sword';
import { getSkill } from '../../src/data/skills';
import { placeBounties } from '../../src/data/extended-heroes';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { drainPendingSkillFxRequests, runWithoutSkillFx } from '../../src/data/extended-skills';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, commitOnlineTriggeredFx } from '../../src/services/online-state';
import { computeFxLogImpactDelayMs, computeFxTailMs } from '../../src/core/skill-fx';
import { buildSkillPreviewScene, previewCellVariants } from '../../src/core/skill-fx-preview';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';

beforeEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.spyOn(Math, 'random').mockReturnValue(.99); });
afterEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.restoreAllMocks(); });

function board(heroId = 'xuanyuan') {
    const state = makeGameState({ boardEffects: [] });
    const hero = addHero(state, heroId, 'player1', [3, 2]);
    const enemy = addHero(state, 'baize', 'player2', [2, 2]);
    enemy.passiveId = ''; enemy.tianweiId = ''; enemy.defense = 0; enemy.currentHp = enemy.maxHp = 300;
    addHero(state, 'baize', 'player2', [5, 5]);
    return { state, hero, enemy };
}

describe('御剑、悬赏与回锋：真实路径表现', () => {
    it('漂移与撤回逐把记录同一个剑 ID，不额外掷骰或改变漂移结果', () => {
        const { state, hero } = board(); placeFlyingSword(state, hero, [1, 1]);
        const id = getFlyingSwords(state)[0].id;
        const random = vi.mocked(Math.random); random.mockClear();
        driftFlyingSwords(state, hero);
        expect(random).toHaveBeenCalledTimes(1);
        const moved = drainPendingSkillFxRequests().find(e => e.choreography?.scene === 'drift')!;
        expect(moved.choreography!.strokes[0]).toMatchObject({ from: [1, 1], to: [1, 2], swordId: id });
        restoreDriftedSwords(state, hero);
        expect(getFlyingSwords(state)[0].position).toEqual([1, 1]);
        expect(drainPendingSkillFxRequests()[0].choreography!.strokes[0]).toMatchObject({ from: [1, 2], to: [1, 1], swordId: id });
    });
    it('归元附剑仍各找最近的友方，保存的是回收前的剑位', () => {
        const { state, hero } = board(); hero.counters['昭神'] = 1;
        const ally = addHero(state, 'moran', 'player1', [0, 0]);
        placeFlyingSword(state, hero, [0, 1]); placeFlyingSword(state, hero, [3, 3]);
        getSkill('xuanyuan_skill2')!.execute(hero, [hero], state);
        const event = drainPendingSkillFxRequests().find(e => e.choreography?.scene === 'attach')!;
        expect(event.choreography!.strokes.map(s => [s.from, s.to])).toEqual([[[0, 1], [0, 0]], [[3, 3], [3, 2]]]);
        expect(ally.counters['御剑']).toBe(1); expect(hero.counters['御剑']).toBe(1);
        expect(getFlyingSwords(state)).toHaveLength(0);
    });
    it('下一回合射出只画合法主方向，落剑 ID 与真实地面资源一致', () => {
        const { state, hero } = board(); hero.counters['御剑'] = 2;
        fireAttachedSwords(hero, state);
        const event = drainPendingSkillFxRequests().find(e => e.choreography?.scene === 'volley')!;
        expect(event.choreography!.strokes).toHaveLength(4);
        expect(event.choreography!.strokes.every(s => getFlyingSwords(state).some(b => b.id === s.swordId && b.position.join() === s.to.join()))).toBe(true);
        expect(event.choreography!.strokes[0].count).toBe(2);
        expect(hero.counters['御剑']).toBeUndefined(); expect(state.boardEffects).toHaveLength(4);
    });
    it('悬赏各落在真实敌人上，奖励种类与状态一致，不落到友方', () => {
        const { state, hero } = board('bounty'); placeBounties(hero, state);
        const event = drainPendingSkillFxRequests().find(e => e.choreography?.scene === 'order')!;
        expect(event.choreography!.strokes).toHaveLength(2);
        for (const stroke of event.choreography!.strokes) {
            const enemy = state.player2Heroes.find(h => h.position?.join() === stroke.to.join())!;
            expect(stroke.reward).toBe(enemy.effects.find(e => e.name.startsWith('悬赏·'))!.value);
        }
    });
    it('赏金从阵亡坐标到实际击杀者，不错误飞给赏金猎人；复活后不重复领', () => {
        const { state, hero, enemy } = board('bounty');
        const killer = addHero(state, 'moran', 'player1', [1, 2]); killer.tianweiId = '';
        placeBounties(hero, state); drainPendingSkillFxRequests();
        const kill = () => DamageCalculator.applyDamage(enemy,
            DamageCalculator.calculate(killer, enemy, 999, false, false, { fixedDamage: true }), killer, state);
        kill();
        const event = drainPendingSkillFxRequests().find(e => e.choreography?.scene === 'reward')!;
        expect(event.sourceHeroId).toBe(killer.id);
        expect(event.choreography!.strokes[0]).toMatchObject({ from: [2, 2], to: [1, 2] });
        expect(hero.effects.some(e => e.name.startsWith('赏金'))).toBe(false);
        enemy.state = 'alive' as typeof enemy.state; enemy.currentHp = 1; state.board[2][2] = enemy;
        kill(); expect(drainPendingSkillFxRequests().some(e => e.choreography?.scene === 'reward')).toBe(false);
    });
    it.each([false, true])('回锋技能一恢复旧三连斩，不叠加新飞刃，专武=%s 的真实段数不变', weapon => {
        const { state, hero, enemy } = board('huifeng'); if (weapon) hero.weaponId = 'huifeng';
        getSkill('huifeng_skill1')!.execute(hero, [enemy], state);
        expect(drainPendingSkillFxRequests().some(e => e.choreography?.scene === 'cuts')).toBe(false);
        expect(state.battleLog.filter(log => log.type === 'damage' && log.details?.sourceHeroId === hero.id)).toHaveLength(weapon ? 4 : 3);
        const { event } = buildSkillPreviewScene('huifeng_skill1');
        expect(event.profile).toMatchObject({ kind: 'triple-slash', durationMs: 950, c1: '#ff4655', c2: '#ffc9b8' });
        expect(event.profile.choreography).toBeUndefined();
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="target" />)).toContain('skill-fx-kind-triple-slash');
    });
    it('击杀后剩余连斩落空，不制造后续命中特效', () => {
        const { state, hero, enemy } = board('huifeng'); enemy.currentHp = 1; hero.tianweiId = '';
        getSkill('huifeng_skill1')!.execute(hero, [enemy], state);
        expect(state.battleLog.filter(log => log.type === 'damage' && log.details?.sourceHeroId === hero.id)).toHaveLength(1);
        expect(drainPendingSkillFxRequests().some(e => e.choreography?.scene === 'cuts')).toBe(false);
    });
    it('AI 推演期间既不泄漏特效队列，也不把纯视觉日志塞入模拟盘面', () => {
        const { state, hero } = board();
        runWithoutSkillFx(() => requestBladeScene(hero, state, 'drift', [{ from: [1, 1], to: [1, 2], start: 0, arrive: 300 }], '不应写入'));
        expect(drainPendingSkillFxRequests()).toHaveLength(0); expect(state.battleLog).toHaveLength(0);
    });
    it('联机纯 JSON 快照能重建同样的剑路元数据与坐标，不重新随机', () => {
        const { state, hero } = board(); placeFlyingSword(state, hero, [1, 1]); driftFlyingSwords(state, hero);
        useGameStore.setState({ ...state, isOnlineMode: false, isAiMode: false });
        const local = useGameStore.getState().skillFx.find(e => e.choreography)!;
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot); commitOnlineTriggeredFx(new Set());
        const received = useGameStore.getState().skillFx.find(e => e.choreography)!;
        expect(received.choreography).toEqual(local.choreography);
        expect(received.fromPos).toEqual(local.fromPos); expect(received.targetPos).toEqual(local.targetPos);
    });
    it('同剑连续移动仅最后一段控制落位图标，动画结束恢复实际棋子', () => {
        const { event } = buildSkillPreviewScene('choreography_drift'); event.bornAt = 100;
        event.choreography!.strokes[0].swordId = 'sword';
        expect(bladePresentation([event], 200).hiddenSwords.has('sword')).toBe(true);
        expect(bladePresentation([event], 1000).hiddenSwords.size).toBe(0);
        const leap = buildSkillPreviewScene('xuanyuan_skill1').event; leap.bornAt = 100;
        expect(bladePresentation([leap], 200).hiddenActors.has('xuanyuan')).toBe(true);
        expect(bladePresentation([leap], 1000).hiddenActors.size).toBe(0);
    });
    it('每段飘字按日志身份对齐，长连锁生命周期容纳最后一刀与收势', () => {
        const { event } = buildSkillPreviewScene('choreography_cuts');
        expect(computeFxLogImpactDelayMs(event, [2, 4], 'preview-2')).toBe(430);
        event.choreography!.strokes[2].arrive = 2400;
        expect(computeFxTailMs(event)).toBe(1620); // 2400 + 收势420 - 场景时长1200
    });
    it.each(['xuanyuan_skill1', 'xuanyuan_skill2', 'bounty_skill1', 'huifeng_skill2'])('图鉴 %s 复用同一场景组件，而非空白预览', id => {
        const { event, cols } = buildSkillPreviewScene(id);
        expect(cols).toBe(6); expect(event.choreography!.strokes.length).toBeGreaterThan(0);
        expect(previewCellVariants(event, ...event.fromPos)).toEqual(['caster']);
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html).toContain('data-blade-scene'); expect(html).toContain('data-blade-route');
        expect(renderToStaticMarkup(<SkillFxVisual event={event} variant="target" />)).toBe('');
    });
    it('回锋技能二保留逐目标新刀路，技能一回退不影响技能二', () => {
        const { state, hero } = board('huifeng');
        getSkill('huifeng_skill2')!.execute(hero, [hero], state);
        const event = drainPendingSkillFxRequests().find(e => e.choreography?.scene === 'cuts')!;
        expect(event.choreography!.strokes).toHaveLength(2);
        expect(new Set(event.choreography!.strokes.map(s => s.to.join())).size).toBe(2);
        expect(buildSkillPreviewScene('huifeng_skill2').event.profile.choreography).toBe(true);
    });
    it('轨迹端点严格等于快照格中心，跃迁弧线不改变最终落格', () => {
        const stroke = { from: [4, 1] as [number, number], to: [2, 3] as [number, number], start: 60, arrive: 430 };
        expect(bladePoint(stroke, 0, true)).toMatchObject({ x: 150, y: 450 });
        expect(bladePoint(stroke, 430, true).x).toBe(350);
        expect(bladePoint(stroke, 430, true).y).toBeCloseTo(250);
        const html = renderToStaticMarkup(<SkillFxVisual event={buildSkillPreviewScene('xuanyuan_skill1').event} variant="caster" />);
        expect(html).toContain('M0-40 6-25');
        // 运动用 SVG 已有负坐标 viewBox，不能再嵌一个默认位于 (0,0) 的完整 SVG，避免剑身被裁半。
        expect(html).not.toContain('class="bc-sword-glyph"');
    });
});
