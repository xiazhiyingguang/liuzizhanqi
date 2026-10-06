import { describe, expect, it } from 'vitest';
import {
    DIRECTIONAL_FX_KINDS,
    PREVIEW_GRID_COLS,
    PREVIEW_SELF_POS,
    buildPreviewFxEvent,
    buildSkillPreviewScene,
    isDirectionalFxKind,
    previewCellVariants,
} from '../../src/core/skill-fx-preview';
import { SKILL_FX_KIND_LABELS, resolveSkillFx } from '../../src/core/skill-fx';

describe('技能特效预览事件构造', () => {
    it('望舒攻疗预览展示跨格月华，满月天威在自己身上', () => {
        for (const skillId of ['wangshu_skill1', 'wangshu_skill2']) {
            const event = buildPreviewFxEvent(resolveSkillFx(skillId));
            expect(event.fromPos).toEqual([1, 0]);
            expect(event.targetPos).toEqual([0, 2]);
        }
        expect(buildPreviewFxEvent(resolveSkillFx('wangshu_tianwei')).targetPos).toEqual(PREVIEW_SELF_POS);
    });
    it('云缨长驱展示身前的一排三格，挥枪圆心在施法者而非命中面', () => {
        const { event } = buildSkillPreviewScene('yunying_skill2');
        expect(event.fromPos).toEqual([2, 1]);
        expect(event.targetPos).toEqual([2, 2]);
        expect(event.coveredPositions).toEqual([[1, 2], [2, 2], [3, 2]]);
        expect(event.areaBounds).toEqual({ r0: 1, c0: 2, rows: 3, cols: 1 });
    });
    it('方向型原型跨格演示，角度为斜向 NE', () => {
        const event = buildPreviewFxEvent(resolveSkillFx('moran_skill2'));
        expect(event.profile.kind).toBe('ink-cut');
        expect(isDirectionalFxKind(event.profile.kind)).toBe(true);
        expect(event.fromPos).toEqual([1, 0]);
        expect(event.targetPos).toEqual([0, PREVIEW_GRID_COLS - 1]);
        expect(Math.round(event.angleDeg)).toBe(-27);
        expect(event.direction).toBe('NE');
    });

    it('自我型原型起点与落点同格，两变体叠渲在同一格', () => {
        const event = buildPreviewFxEvent(resolveSkillFx('xuanxiao_skill1'));
        expect(event.profile.kind).toBe('spirit-rune');
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

    it('鲸落预览按战斗几何摆：太公在西、落点在东两格、落点 3×3 影响面不铺区域底效', () => {
        const { event, cols, rows } = buildSkillPreviewScene('jiangtaigong_whalefall');
        expect(cols).toBe(6);
        expect(rows).toBe(6);
        expect(event.fromPos).toEqual([2, 1]);
        expect(event.targetPos).toEqual([2, 3]);
        expect(event.coveredPositions).toHaveLength(9);
        expect(event.impactPositions).toContainEqual([2, 3]);
        expect(event.areaBounds).toBeUndefined();
    });

    it('每个档案用到的原型都有中文展示名', () => {
        for (const kind of DIRECTIONAL_FX_KINDS) {
            expect(SKILL_FX_KIND_LABELS[kind].length).toBeGreaterThan(0);
        }
        expect(SKILL_FX_KIND_LABELS['ink']).toBe('墨韵波纹');
    });
});
