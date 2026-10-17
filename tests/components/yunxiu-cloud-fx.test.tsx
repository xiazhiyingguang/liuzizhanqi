import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThunderCloudLayer } from '../../src/components/Game/ThunderCloudField';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { SkillFxStage } from '../../src/components/HeroCodex/SkillFxPreview';
import { buildSkillPreviewScene, previewCellVariants } from '../../src/core/skill-fx-preview';
import { cloudStrikePaths, cloudFieldClip } from '../../src/core/yunxiu-cloud-fx';
import { computeFxImpactDelayMs } from '../../src/core/skill-fx';

describe('云岫整片雷云', () => {
    it('一团云只渲染一张连续 SVG，范围不再复制九份', () => {
        const html = renderToStaticMarkup(<ThunderCloudLayer effects={[{ id: 'cloud', type: 'thunder-cloud',
            owner: 'player1', position: [2, 3], sourceHeroId: 'yunxiu', duration: 3 }]} />);
        expect(html.match(/class="yx-cloud-field /g)).toHaveLength(1);
        expect(html.match(/class="yx-cloud-art"/g)).toHaveLength(1);
        expect(html).not.toContain('bf-cloud');
        expect(html).toContain('--yx-cloud-col:2');
        expect(html).toContain('雷云 3');
    });
    it.each(['yunxiu_skill1', 'yunxiu_cloud'])('%s 只在云心挂一张跨格落雷，其余格不再出特效', id => {
        const { event } = buildSkillPreviewScene(id);
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="target" />);
        expect(html.match(/data-cloud-hit=/g)).toHaveLength(3);
        expect(html.match(/class="yx-cloud-lightning"/g)).toHaveLength(1);
        for (const variant of ['caster', 'area', 'impact'] as const) {
            expect(renderToStaticMarkup(<SkillFxVisual event={event} variant={variant} />)).toBe('');
        }
        const variants = Array.from({ length: 36 }, (_, i) => previewCellVariants(event, Math.floor(i / 6), i % 6)).flat();
        expect(variants).toEqual(['target']);
        expect(event.impactPositions!.map(cell => computeFxImpactDelayMs(event, cell))).toEqual(Array(3).fill(event.profile.impactMs));
    });
    it('空云只做云内蓄光，不凭空向空格画攻击', () => {
        const { event } = buildSkillPreviewScene('yunxiu_cloud');
        event.impactPositions = [];
        event.damagePositions = [];
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="target" />);
        expect(html).toContain('yx-cloud-charge'); expect(html).not.toContain('data-cloud-hit=');
    });
    it('同一技能附带恢复时，不向受到治疗的友方落雷', () => {
        const { event } = buildSkillPreviewScene('yunxiu_skill1');
        event.impactPositions = [[2, 3], [2, 2]];
        event.damagePositions = [[2, 3]];
        const html = renderToStaticMarkup(<SkillFxVisual event={event} variant="target" />);
        expect(html.match(/data-cloud-hit=/g)).toHaveLength(1);
        expect(html).toContain('data-cloud-hit="2,3"');
    });
    it('盘边裁切原来的 3×3，闪电端点去重并排除范围外格子', () => {
        expect(cloudFieldClip([0, 0])).toEqual({ top: 1, left: 1, right: 0, bottom: 0 });
        expect(cloudFieldClip([5, 5])).toEqual({ top: 0, left: 0, right: 1, bottom: 1 });
        const strikes = cloudStrikePaths([0, 0], [[0, 0], [0, 0], [1, 1], [-1, 0], [2, 0]]);
        expect(strikes.map(hit => [hit.x, hit.y])).toEqual([[150, 150], [250, 250]]);
        expect(strikes[0].d.endsWith('L 150 150')).toBe(true);
    });
    it('图鉴预览也使用整团雷云', () => {
        const html = renderToStaticMarkup(<SkillFxStage skillId="yunxiu_skill1" accent="#edb93f" />);
        expect(html.match(/class="yx-cloud-art"/g)).toHaveLength(1);
        expect(html.match(/data-cloud-attack=/g)).toHaveLength(1);
    });
});
