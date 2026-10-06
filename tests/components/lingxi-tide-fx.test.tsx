import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkillAreaFx, SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';
import { lingxiTideAngle, lingxiTideHitMs } from '../../src/core/lingxi-tide-fx';
import { MovementSystem } from '../../src/core/movement-system';
import { computeFxImpactDelayMs, type SkillFxEvent } from '../../src/core/skill-fx';

describe('泠汐挥扇推潮', () => {
    it('前方六格共用一份纸扇和两道潮头，不叠区域爆炸或逐格大浪', () => {
        const { event } = buildSkillPreviewScene('lingxi_skill2');
        expect(event.coveredPositions).toEqual(MovementSystem.getLingxiFrontRect(event.fromPos, 3));
        const caster = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" />);
        expect(caster.match(/class="lx-tide-fan"/g)).toHaveLength(1);
        expect(caster.match(/class="lx-tide-front"/g)).toHaveLength(2);
        for (const variant of ['target', 'impact', 'area'] as const) {
            const html = renderToStaticMarkup(<SkillFxVisual event={event} variant={variant} atPos={[2, 2]} />);
            expect(html).not.toContain('lx-tide-front');
            expect(html).not.toContain('fx-wavering');
            expect(html).not.toContain('fxp-hitflash');
            expect(html.includes('lx-tide-splash')).toBe(variant !== 'area');
        }
        expect(renderToStaticMarkup(<SkillAreaFx event={event} />)).toBe('');
    });

    it.each([[0, 270], [1, 90], [2, 180], [3, 0]])('真实方向 %i 的浪沿覆盖矩形推进（主目标可能偏在侧翼）', (direction, angle) => {
        const { event } = buildSkillPreviewScene('lingxi_skill2');
        event.fromPos = [2, 2];
        event.coveredPositions = MovementSystem.getLingxiFrontRect(event.fromPos, direction);
        event.targetPos = event.coveredPositions[0];
        expect(lingxiTideAngle(event)).toBe(angle);
        const [firstRow, firstCol] = event.coveredPositions;
        const secondRow = event.coveredPositions[3];
        expect(lingxiTideHitMs(event, firstRow)).toBe(lingxiTideHitMs(event, firstCol));
        expect(lingxiTideHitMs(event, firstRow)).toBeLessThan(lingxiTideHitMs(event, secondRow));
        expect(computeFxImpactDelayMs(event, secondRow)).toBe(lingxiTideHitMs(event, secondRow));
    });

    it('边界裁掉半排也不把涌潮方向歪向第一个目标', () => {
        const { event } = buildSkillPreviewScene('lingxi_skill2');
        const edge = { ...event, fromPos: [0, 0], targetPos: [1, 1], angleDeg: 45,
            coveredPositions: MovementSystem.getLingxiFrontRect([0, 0], 3) } as SkillFxEvent;
        expect(lingxiTideAngle(edge)).toBe(0);
    });
});
