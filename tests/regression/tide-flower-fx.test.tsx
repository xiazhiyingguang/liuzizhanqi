import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillAreaFx } from '../../src/components/Game/SkillFxLayer';
import { FlowerFogLayer } from '../../src/components/Game/TideFlowerSceneFx';
import { SkillFxStage } from '../../src/components/HeroCodex/SkillFxPreview';
import { computeFxImpactDelayMs } from '../../src/core/skill-fx';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';
import { plantFlowerFog } from '../../src/core/flower-fog';
import { applyServerGameState, commitOnlineTriggeredFx } from '../../src/services/online-state';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';
import type { Position } from '../../src/types/game';

const cases = [
    ['canglan_skill1', 'tide-cut'], ['canglan_skill1_phantom', 'tide-cut-phantom'],
    ['canglan_skill2', 'tide-sweep'], ['canglan_skill2_phantom', 'tide-sweep-phantom'],
    ['flower_fog_skill1', 'flower-decoy'], ['flower_fog_skill2', 'flower-mist'], ['flower_fog_stab', 'flower-stab'],
];

afterEach(() => useGameStore.getState().resetGame());

describe('顾行舟与雾里看花专属表现', () => {
    it.each(cases)('%s：图鉴只挂一张 %s 演出，不生成逐格通用光效', (skillId, scene) => {
        const html = renderToStaticMarkup(<SkillFxStage skillId={skillId} accent="#667" />);
        expect(html.match(/data-ink-scene=/g)).toHaveLength(1);
        expect(html).toContain(`data-ink-scene="${scene}"`);
        expect(html).not.toContain('skill-fx-caster');
        expect(html).not.toContain('skill-fx-impact');
    });

    it('贯穿到结算路径末格，受击切痕只落在真实伤害格', () => {
        const { event } = buildSkillPreviewScene('canglan_skill1_phantom');
        const [near, far] = event.coveredPositions!;
        const html = renderToStaticMarkup(<SkillAreaFx event={{ ...event, targetPos: near, damagePositions: [far] }} />);
        expect(html).toContain(`data-ink-contact="${far.join(',')}"`);
        expect(html).not.toContain(`data-ink-contact="${near.join(',')}"`);
        expect(computeFxImpactDelayMs(event, far)).toBeGreaterThan(computeFxImpactDelayMs(event, near));
    });

    it('边角花雾只有一张静态雾面，不逐格铺特效', () => {
        const html = renderToStaticMarkup(<FlowerFogLayer fields={[{ key: 'fog', center: [0, 0], friendly: true }]} />);
        expect(html.match(/data-fog-center=/g)).toHaveLength(1);
        expect(html).toContain('data-fog-center="0,0"');
        expect(html).toContain('--tf-r:-1;--tf-c:-1');
    });

    it.each([
        ['flower_fog_skill1', [1, 3]], ['flower_fog_skill2', [2, 2]],
    ] as const)('%s 挂起选格起手在对端只重建一次', (skillId, cell) => {
        const state = makeGameState();
        const hero = addHero(state, 'flower_fog', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [2, 3]);
        useGameStore.setState({ ...state, selectedHero: hero, activeHero: hero });
        useGameStore.getState().selectSkill(skillId);
        useGameStore.getState().executeSkill([...cell] as Position);
        expect(useGameStore.getState().pendingBoardAction).toBeDefined();
        expect(useGameStore.getState().skillFx.map(event => event.skillId)).toEqual([skillId]);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        commitOnlineTriggeredFx(new Set());
        expect(useGameStore.getState().skillFx.map(event => [event.skillId, event.targetPos])).toEqual([[skillId, cell]]);
    });

    it('盲刺空格仍有剑路，对端同步时不生成受击切痕', () => {
        const state = makeGameState();
        const hero = addHero(state, 'flower_fog', 'player1', [2, 2]);
        const foe = addHero(state, 'moran', 'player2', [4, 4]);
        plantFlowerFog(state, foe, [2, 3]);
        useGameStore.setState({ ...state, selectedHero: hero, activeHero: hero });
        useGameStore.getState().selectSkill('flower_fog_skill2');
        useGameStore.getState().executeSkill([2, 2]);
        const before = new Set(useGameStore.getState().battleLog.map(log => log.id));
        useGameStore.getState().resolvePendingBoardAction([1, 3]);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        commitOnlineTriggeredFx(before);
        const [event] = useGameStore.getState().skillFx;
        expect(event).toMatchObject({ skillId: 'flower_fog_stab', targetPos: [1, 3], damagePositions: [] });
        const html = renderToStaticMarkup(<SkillAreaFx event={event} />);
        expect(html).toContain('tf-moving-blade');
        expect(html).not.toContain('data-ink-contact=');
    });
});
