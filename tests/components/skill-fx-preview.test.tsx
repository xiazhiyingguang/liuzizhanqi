import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SkillFxPreview, { SkillFxStage } from '../../src/components/HeroCodex/SkillFxPreview';

const THEME_COLOR = '#a7372d';

function renderStage(skillId: string) {
    return renderToStaticMarkup(<SkillFxStage skillId={skillId} accent={THEME_COLOR} />);
}

describe('SkillFxStage 特效演示舞台', () => {
    it('方向型技能同时渲染起手格与目标格', () => {
        const html = renderStage('moran_skill2');
        expect(html).toContain('skill-fx skill-fx-kind-arc-slash skill-fx-caster');
        expect(html).toContain('skill-fx skill-fx-kind-arc-slash skill-fx-target');
        expect(html).toContain('skill-fx-stage-piece');
    });

    it('自我型技能把主效落在施法格', () => {
        const html = renderStage('xuanxiao_skill1');
        expect(html).toContain('skill-fx skill-fx-kind-aura-buff skill-fx-caster');
        expect(html).toContain('skill-fx skill-fx-kind-aura-buff skill-fx-target');
        // 两变体同格叠渲，整台只剩两个特效节点，棋子标记为「身」
        expect(html.split('class="skill-fx ').length - 1).toBe(2);
        expect(html).toContain('身');
    });

    it('舞台固定 3×2 演示格位', () => {
        const html = renderStage('wukong_skill1');
        expect(html.split('skill-fx-stage-cell').length - 1).toBe(6);
    });

    it('档案行展示原型名、时长与配色', () => {
        const html = renderStage('moran_skill1');
        expect(html).toContain('法阵');
        expect(html).toContain('1150ms');
        expect(html).toContain('#8b7bb0');
        expect(html).toContain('magic-array');
        expect(html).toContain('skill-fx-stage-replay');
    });

    it('未定制技能明确标出兜底', () => {
        const html = renderStage('some_future_hero_skill1');
        expect(html).toContain('skill-fx-kind-ink');
        expect(html).toContain('未定制 · 通用兜底');
    });
});

describe('SkillFxPreview 悬停触发器', () => {
    it('静止状态只渲染图标，不预先挂载舞台', () => {
        const html = renderToStaticMarkup(
            <SkillFxPreview skillId="moran_skill1" skillName="入道" accent={THEME_COLOR} />
        );
        expect(html).toContain('skill-fx-peek-trigger');
        expect(html).toContain('入道 的技能特效');
        expect(html).not.toContain('skill-fx-stage');
    });
});
