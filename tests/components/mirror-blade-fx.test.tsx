import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { collectMirrorBladeFx, mirrorBladeMotion, mirrorBladePath } from '../../src/core/mirror-blade-fx';
import { computeFxImpactDelayMs, computeFxLogImpactDelayMs, computeFxTailMs, computeMirrorBladeTiming, type SkillFxEvent } from '../../src/core/skill-fx';
import { HeroState, type BattleLogEntry } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

function battle(count: number, lethal = false) {
    const state = makeGameState();
    const mirror = addHero(state, 'mirror', 'player1', [2, 1]);
    const first = addHero(state, 'moran', 'player2', [2, 3]);
    first.currentHp = lethal ? 4 : 300;
    first.maxHp = 300;
    const second = addHero(state, 'baize', 'player2', [1, 3]);
    second.currentHp = second.maxHp = 350;
    mirror.counters['破镜之刃'] = count;
    DamageCalculator.triggerMirrorBrokenBlade(mirror, state);
    const events = collectMirrorBladeFx(state.battleLog);
    const event: SkillFxEvent = { ...events[0], id: 1, bornAt: 0 };
    return { state, mirror, first, second, events, event };
}

describe('镜·真实层数的追踪棱镜飞刃', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it.each([1, 2, 4, 20])('%i 层只生成对应数量的飞刃，不受 16 个特效队列上限影响', count => {
        const { events, event, mirror } = battle(count);
        expect(events).toHaveLength(1);
        expect(event.mirrorBlades).toHaveLength(count);
        expect(mirror.counters['破镜之刃']).toBe(0);
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(html.match(/class="fx-mirror-projectile"/g)).toHaveLength(count);
        expect(html).not.toContain('<animateMotion');
        expect(html).not.toContain('<svg');
        expect(html.match(/class="fx-mirror-prism"/g)).toHaveLength(count);
        // 飞刃每枚只有外壳、棱镜和短拖尾三个元素，无逐帧描线/滤镜子树。
        expect(html.match(/class="fx-mirror-tail"/g)).toHaveLength(count);
        expect(html).not.toContain('fx-mirrorblade-a');
    });

    it('击杀后的后续飞刃转向新目标，每格只显示属于该格的命中碎片', () => {
        const { event, first, second } = battle(4, true);
        expect(first.state).toBe(HeroState.DEAD);
        // 镜的击杀天威额外获得 3 层，因此本次 4 + 3 = 7 枚真实飞刃。
        expect(second.currentHp).toBe(320);
        expect(event.mirrorBlades!.map(blade => blade.targetPos)).toEqual([[2, 3], ...Array.from({ length: 6 }, () => [1, 3])]);
        const primary = renderToStaticMarkup(<SkillFxVisual event={event} variant="target" atPos={[2, 3]} />);
        const secondary = renderToStaticMarkup(<SkillFxVisual event={event} variant="impact" atPos={[1, 3]} />);
        expect(primary.match(/data-blade-impact=/g)).toHaveLength(1);
        expect(secondary.match(/data-blade-impact=/g)).toHaveLength(6);
    });

    it('同格多段伤害与击杀分别延迟至对应飞刃抵达，不全部挤在第一刃时刻', () => {
        const { event, state } = battle(4, true);
        event.mirrorBlades!.forEach((blade, index) => {
            const hit = state.battleLog.find(entry => entry.type === 'damage' && blade.logIds.includes(entry.id));
            expect(hit).toBeDefined();
            expect(computeFxLogImpactDelayMs(event, blade.targetPos, hit!.id)).toBe(computeMirrorBladeTiming(blade, index).impactMs);
        });
        const kill = state.battleLog.find(entry => entry.type === 'kill')!;
        expect(event.logIds).toContain(kill.id);
        expect(computeFxLogImpactDelayMs(event, [2, 3], kill.id)).toBe(computeMirrorBladeTiming(event.mirrorBlades![0], 0).impactMs);
        const lastHit = computeMirrorBladeTiming(event.mirrorBlades![3], 3).impactMs;
        expect(event.profile.durationMs + computeFxTailMs(event)).toBeGreaterThanOrEqual(lastHit + 520);
    });

    it('联机 JSON 快照还原相同数量、目标与时间', () => {
        const { state, events } = battle(4, true);
        expect(collectMirrorBladeFx(JSON.parse(JSON.stringify(state.battleLog)))).toEqual(events);
    });

    it('镜域内没有目标时不生成虚假的攻击，保留层数', () => {
        const state = makeGameState();
        const mirror = addHero(state, 'mirror', 'player1', [0, 0]);
        addHero(state, 'moran', 'player2', [5, 5]);
        mirror.counters['破镜之刃'] = 4;
        DamageCalculator.triggerMirrorBrokenBlade(mirror, state, true);
        expect(collectMirrorBladeFx(state.battleLog)).toEqual([]);
        expect(mirror.counters['破镜之刃']).toBe(4);
    });

    it('目标全部死亡后只渲染实际消耗的刃，剩余层数不变成假攻击', () => {
        const state = makeGameState();
        const mirror = addHero(state, 'mirror', 'player1', [2, 1]);
        const victim = addHero(state, 'moran', 'player2', [2, 2]);
        victim.currentHp = 1;
        mirror.counters['破镜之刃'] = 4;
        DamageCalculator.triggerMirrorBrokenBlade(mirror, state);
        expect(collectMirrorBladeFx(state.battleLog)[0].mirrorBlades).toHaveLength(1);
        expect(mirror.counters['破镜之刃']).toBe(6); // 未消耗的 3 层 + 击杀天威新增 3 层
    });

    it('不同触发批次不合并；旧战报一条攻击也只显示一把刃', () => {
        const { state } = battle(2);
        const markers = state.battleLog.filter(entry => entry.details?.fxSkillId === 'mirror_blade');
        const legacy: BattleLogEntry = { ...markers[0], id: 'legacy', details: { fxSkillId: 'mirror_blade', fxFrom: [0, 0], fxTarget: [5, 5] } };
        expect(collectMirrorBladeFx([...markers, legacy])).toHaveLength(2);
        const event: SkillFxEvent = { ...collectMirrorBladeFx([legacy])[0], id: 9, bornAt: 0 };
        expect(computeFxImpactDelayMs(event, [5, 5])).toBeGreaterThan(500);
    });

    it('过滤无效坐标，不产生 NaN 路径；上/下两侧飞刃有不同的弧线', () => {
        const { state, event } = battle(2);
        const marker = state.battleLog.find(entry => entry.details?.fxSkillId === 'mirror_blade')!;
        expect(collectMirrorBladeFx([{ ...marker, details: { ...marker.details, fxTarget: [NaN, 3] } }])).toEqual([]);
        const blade = event.mirrorBlades![0];
        const a = mirrorBladePath(blade, event.fromPos, 0);
        const b = mirrorBladePath(blade, event.fromPos, 1);
        expect(a).not.toBe(b);
        expect(a).toMatch(/2 0$/);
    });

    it('预采样弧线准确抵达目标，旋转不会绕远路整圈抖动', () => {
        const origin: [number, number] = [2, 2];
        for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
            const samples = mirrorBladeMotion({ fromPos: origin, targetPos: [row, col], logIds: [] }, origin, row + col);
            expect(samples).toHaveLength(9);
            expect(samples[8].x).toBe(col - 2);
            expect(samples[8].y).toBe(row - 2);
            samples.forEach((point, index) => {
                expect(Number.isFinite(point.angle)).toBe(true);
                if (index) expect(Math.abs(point.angle - samples[index - 1].angle)).toBeLessThanOrEqual(180);
            });
        }
    });

    it('每次命中只生成两枚碎片，同一个受击格只生成一个冲击环', () => {
        const { event } = battle(20);
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="target" atPos={[2, 3]} />);
        expect(html.match(/class="fx-mirror-shard"/g)).toHaveLength(40);
        expect(html.match(/class="fx-mirror-hit-ring"/g)).toHaveLength(1);
    });
});
