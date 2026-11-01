import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, applySnapshotAction } from '../../src/services/online-state';
import { placeShuangfeiyanBoomerang } from '../../src/core/boomerang';
import { drainPendingSkillFxRequests } from '../../src/data/extended-skills';
import { getSkill } from '../../src/data/skills';
import { soundManager } from '../../src/core/sound-manager';
import { computeFxImpactDelayMs } from '../../src/core/skill-fx';
import { swallowPresentation, swallowPose, swallowTravelPoints } from '../../src/core/swallow-fx';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';
import { addHero, makeGameState } from '../helpers/game-state';

function setup(mode: 'throw' | 'triangle' | 'leap' | 'return', empty = false) {
    const state = makeGameState(), hero = addHero(state, 'shuangfeiyan', 'player1', mode === 'return' ? [4, 1] : [2, 1]);
    const cells: [number, number][] = empty ? [[5, 5]] : mode === 'triangle' ? [[2, 3], [3, 2], [4, 1]] : mode === 'leap'
        ? [[3, 2], [4, 4], [5, 3]] : mode === 'return' ? [[3, 3], [4, 2]] : [[2, 2], [2, 3]];
    for (const cell of cells) { const enemy = addHero(state, 'baize', 'player2', cell);
        enemy.defense = 0; enemy.passiveId = ''; enemy.maxHp = enemy.currentHp = 100; }
    if (mode === 'triangle') { placeShuangfeiyanBoomerang(state, hero, [2, 4]); hero.counters.sfy_skillSerial = 1;
        placeShuangfeiyanBoomerang(state, hero, [5, 1]); hero.counters.sfy_skillSerial = 2; }
    if (mode === 'leap') { placeShuangfeiyanBoomerang(state, hero, [4, 3]); hero.counters.sfy_skillSerial = 1; }
    if (mode === 'return') { placeShuangfeiyanBoomerang(state, hero, [2, 4]); hero.counters.sfy_skillSerial = 2; }
    useGameStore.setState({ ...state, selectedHero: hero, activeHero: hero, selectedSkill: getSkill(mode === 'leap' ? hero.skill2Id : hero.skill1Id)!,
        isAiMode: false, isOnlineMode: false, gameMode: 'standard', skillFx: [], skillFxExtras: undefined,
        performingExtraAction: false, pendingBoardAction: undefined });
    return { hero, target: mode === 'triangle' ? [2, 1] as [number, number] : mode === 'throw' ? [2, 4] as [number, number] : [4, 3] as [number, number] };
}

beforeEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests();
    vi.spyOn(Math, 'random').mockReturnValue(.99); vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(soundManager, 'playSkillFx').mockImplementation(() => undefined); });
afterEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.restoreAllMocks(); });

describe('双飞燕动作与真实结算', () => {
    it('掷镖逐格抵达，落点镖影等飞行结束才显示', () => {
        const { hero, target } = setup('throw'); useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), event = state.skillFx[0];
        expect(event.profile.kind).toBe('swallow-throw');
        expect(event.swallow?.slot).toBe(0);
        expect(state.player2Heroes.map(h => h.currentHp)).toEqual([96, 96]);
        expect(computeFxImpactDelayMs(event, [2, 2])).toBe(260);
        expect(computeFxImpactDelayMs(event, [2, 4])).toBe(580);
        expect(swallowPresentation(state.skillFx, 1400).hiddenPins.has(`${hero.id}@2,4`)).toBe(true);
        expect(swallowPresentation(state.skillFx, 1600).hiddenPins.size).toBe(0);
    });
    it('三角顶点在返航移除镖之前快照，区域攻击与返航分别拥有伤害日志', () => {
        const { target } = setup('triangle'); useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), triangle = state.skillFx.find(e => e.profile.kind === 'swallow-triangle')!;
        const returning = state.skillFx.find(e => e.profile.kind === 'swallow-return')!;
        expect(triangle.swallow?.vertices).toEqual([[2, 1], [2, 4], [5, 1]]);
        expect(state.boardEffects?.filter(e => e.type === 'boomerang')).toHaveLength(1);
        expect(returning.bornAt - triangle.bornAt).toBe(960);
        expect(returning.logIds?.some(id => triangle.logIds?.includes(id))).toBe(false);
        expect(state.player2Heroes.map(h => h.currentHp)).toEqual([89, 93, 93]);
        expect(triangle.damagePositions?.map(cell => computeFxImpactDelayMs(triangle, cell))).toEqual([520, 520, 520]);
    });
    it('燕归巢沿弧线飞跃，落地再显示真实角色并保留七点环伤', () => {
        const { hero, target } = setup('leap'); useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), event = state.skillFx[0];
        expect(event.profile.kind).toBe('swallow-leap'); expect(event.fromPos).toEqual([2, 1]);
        expect(state.board[4][3]?.id).toBe(hero.id);
        expect(state.player2Heroes.map(h => h.currentHp)).toEqual([93, 93, 93]);
        expect(swallowPresentation(state.skillFx, 1200).hiddenArrivals.has(hero.id)).toBe(true);
        expect(swallowPresentation(state.skillFx, 1500).hiddenArrivals.size).toBe(0);
        const midpoint = swallowPose([event.fromPos, event.targetPos], .5, true);
        expect(midpoint.y).toBeLessThan((event.fromPos[0] + event.targetPos[0] + 1) * 50);
    });
    it('返航保持最短路径的拐点，空返航也留联机锚点', () => {
        const { target } = setup('return', true); useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), event = state.skillFx.find(e => e.profile.kind === 'swallow-return')!;
        expect(swallowTravelPoints(event)).toEqual([[2, 4], [3, 3], [4, 2], [4, 1]]);
        expect(event.logIds?.length).toBeGreaterThan(0);
        expect(state.battleLog.some(log => !!log.details?.skillFxRequest)).toBe(true);
    });
    it('返航击杀目标后仍保留命中格，不丢掉致命一击的刃光', () => {
        const { target } = setup('return');
        useGameStore.getState().player2Heroes[0].currentHp = 1;
        useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), event = state.skillFx.find(e => e.profile.kind === 'swallow-return')!;
        expect(state.player2Heroes[0].currentHp).toBe(0);
        expect(event.impactPositions).toContainEqual([3, 3]);
        expect(event.logIds?.length).toBeGreaterThan(0);
    });
    it.each(['throw', 'triangle', 'leap', 'return'] as const)('%s 联机接收端保留形态、路径和被动分段', mode => {
        const { hero, target } = setup(mode);
        const before = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        const skillId = useGameStore.getState().selectedSkill!.id;
        useGameStore.getState().executeSkill(target);
        const actor = useGameStore.getState().skillFx;
        const after = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.setState({ skillFx: [] }); applyServerGameState(before);
        applySnapshotAction({ type: 'skill', data: { heroId: hero.id, skillId, targetPos: target } }, after);
        const remote = useGameStore.getState().skillFx;
        expect(remote).toHaveLength(actor.length);
        for (const original of actor) { const copy = remote.find(e => e.profile.kind === original.profile.kind)!;
            expect(copy.profile.kind).toBe(original.profile.kind); expect(copy.swallow).toEqual(original.swallow);
            expect(copy.fromPos).toEqual(original.fromPos); expect(copy.targetPos).toEqual(original.targetPos);
            expect(copy.logIds).toEqual(original.logIds); expect(copy.bornAt).toBe(original.bornAt); }
    });
});

describe('双燕渲染结构', () => {
    it.each(['shuangfeiyan_skill1', 'shuangfeiyan_triangle', 'shuangfeiyan_skill2', 'shuangfeiyan_return'])('%s 每个事件只绘制一张跨棋盘场景', id => {
        const { event } = buildSkillPreviewScene(id); event.bornAt = 0;
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html.match(/class="sfy-scene"/g)).toHaveLength(1);
        for (const variant of ['target', 'area', 'impact'] as const) expect(renderToStaticMarkup(<SkillFxVisual event={event} variant={variant} />)).toBe('');
        if (id === 'shuangfeiyan_triangle') expect(html).toContain('sfy-triangle-wash');
    });
});
