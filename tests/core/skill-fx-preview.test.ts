import { describe, expect, it } from 'vitest';
import {
    DIRECTIONAL_FX_KINDS,
    PREVIEW_GRID_COLS,
    PREVIEW_SELF_POS,
    buildPreviewFxEvent,
    isDirectionalFxKind,
    previewCellVariants,
} from '../../src/core/skill-fx-preview';
import { SKILL_FX_KIND_LABELS, resolveSkillFx } from '../../src/core/skill-fx';

describe('技能特效预览事件构造', () => {
    it('方向型原型跨格演示，角度为斜向 NE', () => {
        const event = buildPreviewFxEvent(resolveSkillFx('moran_skill2'));
        expect(event.profile.kind).toBe('arc-slash');
        expect(isDirectionalFxKind(event.profile.kind)).toBe(true);
        expect(event.fromPos).toEqual([1, 0]);
        expect(event.targetPos).toEqual([0, PREVIEW_GRID_COLS - 1]);
        expect(Math.round(event.angleDeg)).toBe(-27);
        expect(event.direction).toBe('NE');
    });

    it('自我型原型起点与落点同格，两变体叠渲在同一格', () => {
        const event = buildPreviewFxEvent(resolveSkillFx('xuanxiao_skill1'));
        expect(event.profile.kind).toBe('aura-buff');
        expect(event.targetPos).toEqual(PREVIEW_SELF_POS);
        expect(event.angleDeg).toBe(0);
        expect(previewCellVariants(event, 1, 1)).toEqual(['caster', 'target']);
        expect(previewCellVariants(event, 0, 0)).toEqual([]);
    });

    it('跨格几何依赖的原型不得归入单格布局', () => {
        // 粒子束宽度、投射物飞行、突进拖尾都以 --fx-dist 取值，同格会塌成零长度
        for (const kind of ['feynman-beam', 'pierce', 'shadow-dash', 'wukong-clone'] as const) {
            expect(DIRECTIONAL_FX_KINDS.has(kind), `${kind} 需要跨格演示`).toBe(true);
        }
    });

    it('每个档案用到的原型都有中文展示名', () => {
        for (const kind of DIRECTIONAL_FX_KINDS) {
            expect(SKILL_FX_KIND_LABELS[kind].length).toBeGreaterThan(0);
        }
        expect(SKILL_FX_KIND_LABELS['ink']).toBe('墨韵波纹');
    });
});
