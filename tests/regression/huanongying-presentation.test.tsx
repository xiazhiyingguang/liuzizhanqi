import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState, applySnapshotAction } from '../../src/services/online-state';
import { getHnyFanPositions } from '../../src/data/extended-heroes';
import { drainPendingSkillFxRequests } from '../../src/data/extended-skills';
import { getSkill } from '../../src/data/skills';
import { soundManager } from '../../src/core/sound-manager';
import { hnyAngle, hnyPresentation, hnyTransitPoint } from '../../src/core/huanongying-fx';
import { computeFxImpactDelayMs } from '../../src/core/skill-fx';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';
import type { Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

function setup(mode: 'fan' | 'swap' | 'lethal' | 'echo-kill' = 'fan', direction = 3) {
    const state = makeGameState(), swap = mode === 'swap';
    const caster = addHero(state, 'huanongying', 'player1', swap ? [4, 1] : [2, 2]);
    caster.counters.__hny_dir = direction;
    const delta: Position = [[-1, 0], [1, 0], [0, -1], [0, 1]][direction] as Position;
    const front = getHnyFanPositions(caster.position!, direction), last = front[front.length - 1];
    const deep: Position = [last[0] + delta[0], last[1] + delta[1]];
    const cells: Position[] = swap ? [[1, 3], [2, 4], [3, 3], [4, 2]] : [...front, deep];
    const enemies = cells.map(position => { const enemy = addHero(state, 'baize', 'player2', position);
        enemy.maxHp = enemy.currentHp = 100; enemy.defense = 0; enemy.passiveId = ''; return enemy; });
    if (mode === 'lethal') enemies[2].currentHp = 1;
    if (mode === 'echo-kill') enemies[3].currentHp = 2;
    const ally = addHero(state, 'moran', 'player1', swap ? [2, 2] : [deep[0] + (delta[1] ? -1 : 0), deep[1] + (delta[0] ? 1 : 0)]);
    if (swap) state.boardEffects = [{ id: 'shadow', type: 'shadow-mark', position: [2, 3], owner: 'player1', sourceHeroId: caster.id, duration: 2 }];
    useGameStore.setState({ ...state, activeHero: caster, selectedHero: caster, selectedSkill: getSkill(swap ? caster.skill2Id : caster.skill1Id)!,
        skillFx: [], skillFxExtras: undefined, isAiMode: false, isOnlineMode: false, gameMode: 'standard', pendingBoardAction: undefined,
        pendingExtraActionHeroIds: {}, performingExtraAction: false });
    return { caster, ally, front, deep, target: swap ? [2, 3] as Position : [2 + delta[0], 2 + delta[1]] as Position };
}

beforeEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests();
    vi.spyOn(Math, 'random').mockReturnValue(.99); vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(soundManager, 'playSkillFx').mockImplementation(() => undefined); });
afterEach(() => { useGameStore.getState().resetGame(); drainPendingSkillFxRequests(); vi.restoreAllMocks(); });

describe('花弄影真实出手与重演表现', () => {
    it('互换的本体和影子沿分离的弧线行进，并准确抵达两端', () => {
        const from: Position = [4, 1], to: Position = [2, 3];
        expect(hnyTransitPoint(from, to, 0)).toEqual({ x: 150, y: 450 });
        expect(hnyTransitPoint(from, to, 1, true)).toEqual({ x: 350, y: 250 });
        const body = hnyTransitPoint(from, to, .5), shadow = hnyTransitPoint(from, to, .5, true);
        expect(Math.hypot(body.x - shadow.x, body.y - shadow.y)).toBeCloseTo(32);
    });
    it.each([0, 1, 2, 3])('方向 %i：本体和影子同向，伤害与日志分别归属', direction => {
        const { caster, ally, target, front, deep } = setup('fan', direction);
        useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), main = state.skillFx.find(e => e.skillId === 'huanongying_skill1')!;
        const echo = state.skillFx.find(e => e.skillId === 'huanongying_replay')!;
        expect(main).toBeDefined(); expect(echo).toBeDefined();
        expect(main.hny?.direction).toBe(direction); expect(echo.hny?.direction).toBe(direction);
        expect(main.coveredPositions).toEqual(front); expect(echo.hny?.form).toBe('fan');
        expect(hnyAngle(main.hny!.direction!)).toBe([-90, 90, 180, 0][direction]);
        expect(state.player2Heroes.map(h => h.currentHp)).toEqual([94, 94, 94, 97]);
        expect(ally.currentHp).toBe(ally.maxHp);
        expect(echo.damagePositions).toEqual([deep]); expect(echo.impactPositions).not.toContainEqual(ally.position);
        expect(echo.sourceHeroId).toBe(caster.id);
        expect(echo.logIds!.some(id => main.logIds?.includes(id))).toBe(false);
        expect(echo.bornAt - main.bornAt).toBe(660);
        expect(main.damagePositions!.map(cell => computeFxImpactDelayMs(main, cell))).toEqual([380, 380, 380]);
    });
    it('身影互换先行进、再落地；旧位重演环身斩', () => {
        const { caster, ally, target } = setup('swap'); useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), main = state.skillFx.find(e => e.skillId === 'huanongying_skill2')!;
        const echo = state.skillFx.find(e => e.skillId === 'huanongying_replay')!;
        expect(main.fromPos).toEqual([4, 1]); expect(main.targetPos).toEqual([2, 3]);
        expect(main.hny?.form).toBe('ring'); expect(echo.hny?.form).toBe('ring');
        expect(echo.fromPos).toEqual([4, 1]); expect(echo.bornAt - main.bornAt).toBe(940);
        expect(state.player2Heroes.map(h => h.currentHp)).toEqual([92, 92, 92, 96]);
        expect(ally.currentHp).toBe(ally.maxHp);
        expect(hnyPresentation(state.skillFx, 1300).hiddenActors.has(caster.id)).toBe(true);
        expect(hnyPresentation(state.skillFx, 1550).hiddenActors.size).toBe(0);
        expect(computeFxImpactDelayMs(main, [1, 3])).toBe(620);
        expect(computeFxImpactDelayMs(echo, [4, 2])).toBe(320);
    });
    it('天威与行动末的重演依次播放，不互相覆盖伤害日志', () => {
        const { target } = setup('lethal'); useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), main = state.skillFx.find(e => e.skillId === 'huanongying_skill1')!;
        const echoes = state.skillFx.filter(e => e.skillId === 'huanongying_replay');
        expect(echoes).toHaveLength(2);
        expect(echoes.map(e => e.bornAt - main.bornAt)).toEqual([660, 1460]);
        expect(main.damagePositions).toContainEqual([3, 3]);
        expect(state.player2Heroes[2].currentHp).toBe(0); expect(state.player2Heroes[3].currentHp).toBe(95);
        expect(echoes[0].logIds!.some(id => echoes[1].logIds!.includes(id))).toBe(false);
    });
    it('影子致命一击不丢掉落点，且不误绘友方命中', () => {
        const { deep, ally, target } = setup('echo-kill'); useGameStore.getState().executeSkill(target);
        const state = useGameStore.getState(), echo = state.skillFx.find(e => e.skillId === 'huanongying_replay')!;
        expect(state.player2Heroes[3].currentHp).toBe(0);
        expect(echo.damagePositions).toContainEqual(deep); expect(echo.impactPositions).toContainEqual(deep);
        expect(echo.damagePositions).not.toContainEqual(ally.position);
        expect(echo.logIds!.some(id => state.battleLog.find(log => log.id === id)?.type === 'damage')).toBe(true);
    });
    it.each(['fan', 'swap', 'lethal'] as const)('%s 联机接收端保留方向、形态、位置和各段日志', mode => {
        const { caster, target } = setup(mode);
        const skillId = useGameStore.getState().selectedSkill!.id;
        const before = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().executeSkill(target);
        const actor = useGameStore.getState().skillFx;
        const after = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.setState({ skillFx: [] }); applyServerGameState(before);
        applySnapshotAction({ type: 'skill', data: { heroId: caster.id, skillId, targetPos: target } }, after);
        const remote = useGameStore.getState().skillFx;
        expect(remote).toHaveLength(actor.length);
        for (const original of actor) {
            const copy = remote.find(e => e.profile.kind === original.profile.kind && JSON.stringify(e.logIds) === JSON.stringify(original.logIds))!;
            expect(copy).toBeDefined(); expect(copy.hny?.form).toBe(original.hny?.form);
            expect(copy.hny?.direction).toBe(original.hny?.direction);
            expect(copy.fromPos).toEqual(original.fromPos); expect(copy.targetPos).toEqual(original.targetPos);
            expect(copy.damagePositions).toEqual(original.damagePositions); expect(copy.bornAt).toBe(original.bornAt);
        }
    });
    it('每次出手只画一张跨格场景，重演按扇形或环斩显示', () => {
        for (const id of ['huanongying_skill1', 'huanongying_skill2', 'huanongying_replay']) {
            const { event } = buildSkillPreviewScene(id); event.bornAt = 0;
            const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
            expect(html.match(/class="hny2-scene"/g)).toHaveLength(1);
            for (const variant of ['target', 'area', 'impact'] as const) expect(renderToStaticMarkup(<SkillFxVisual event={event} variant={variant} />)).toBe('');
        }
    });
});
