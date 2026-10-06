import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkillAreaFx, SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { resolveSkillFx, type SkillFxEvent } from '../../src/core/skill-fx';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';

function waveEvent(): SkillFxEvent {
    return {
        id: 1, bornAt: 0, owner: 'player1', profile: resolveSkillFx('lingxi_skill1'),
        fromPos: [0, 0], targetPos: [1, 1], angleDeg: 45, direction: 'SE',
        coveredPositions: [[0, 0], [0, 1], [1, 0], [1, 1]],
        impactPositions: [[1, 0]], areaBounds: { r0: 0, c0: 0, rows: 2, cols: 2 },
    };
}

describe('泠汐自身涟漪', () => {
    it('图鉴的三乘三范围与波心也以施法者为中心', () => {
        const { event } = buildSkillPreviewScene('lingxi_skill1');
        expect(event.targetPos).toEqual(event.fromPos);
        expect(event.coveredPositions).toHaveLength(9);
        expect(event.coveredPositions?.every(([r, c]) => Math.max(
            Math.abs(r - event.fromPos[0]), Math.abs(c - event.fromPos[1])
        ) <= 1)).toBe(true);
    });
    it('棋盘角落仍只从自身起浪，目标和范围层不复制波心', () => {
        const event = waveEvent();
        const caster = renderToStaticMarkup(<SkillFxVisual event={event} variant="caster" atPos={event.fromPos} />);
        expect(caster).toContain('lx-ripple-source');
        expect(caster.match(/class="lx-water-wave"/g)).toHaveLength(4);
        expect(caster).not.toContain('fx-halo');
        for (const variant of ['target', 'impact', 'area'] as const) {
            const html = renderToStaticMarkup(<SkillFxVisual event={event} variant={variant} atPos={[1, 0]} />);
            expect(html).not.toContain('lx-ripple-source');
            expect(html).not.toContain('fx-wave');
            expect(html.includes('lx-water-touch')).toBe(variant !== 'area');
        }
        expect(renderToStaticMarkup(<SkillAreaFx event={event} />)).toBe('');
    });

    it('合并海螺扩大波面，缺少区域包围盒的延迟回响也会起浪', () => {
        const event = waveEvent();
        const render = (fx: SkillFxEvent) => renderToStaticMarkup(<SkillFxVisual event={fx} variant="caster" />);
        const span = (html: string) => Number(html.match(/--lx-span:([\d.]+)/)?.[1]);
        const merged = { ...event, coveredPositions: [[0, 0], [2, 2]] as [number, number][] };
        expect(span(render(merged))).toBeGreaterThan(span(render(event)));
        const echo = { ...event, areaBounds: undefined, coveredPositions: undefined };
        expect(render(echo)).toContain('lx-ripple-source');
    });

    it('水痕按离施法者的距离到达，不以主目标重排', () => {
        const event = { ...waveEvent(), fromPos: [2, 2] as [number, number], targetPos: [3, 3] as [number, number] };
        const delay = (cell: [number, number]) => Number(renderToStaticMarkup(
            <SkillFxVisual event={event} variant="impact" atPos={cell} />
        ).match(/--lx-touch-delay:(\d+)ms/)?.[1]);
        expect(delay([2, 3])).toBe(delay([3, 2]));
        expect(delay([2, 3])).toBeLessThan(delay([3, 3]));
    });
});
