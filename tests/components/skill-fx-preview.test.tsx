import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SkillFxPreview, { SkillFxStage } from '../../src/components/HeroCodex/SkillFxPreview';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { computeFxAngleDeg, computeFxDirection, resolveSkillFx, type SkillFxEvent } from '../../src/core/skill-fx';

/** 手工构造一次烈火燎原的特效事件（射线向东，覆盖 [2,3]→[2,5]） */
function makeLiehuoEvent(): SkillFxEvent {
    const fromPos: [number, number] = [2, 2];
    const targetPos: [number, number] = [2, 3];
    const angleDeg = computeFxAngleDeg(fromPos, targetPos);
    return {
        id: 1,
        bornAt: 0,
        profile: resolveSkillFx('yunying_liehuo'),
        owner: 'player1',
        fromPos,
        targetPos,
        angleDeg,
        direction: computeFxDirection(angleDeg),
        coveredPositions: [[2, 3], [2, 4], [2, 5]],
        areaBounds: { r0: 2, c0: 3, rows: 1, cols: 3 },
    };
}

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

    it('风铃爪牙：起手格铺残影拖尾，目标格出三道带爪尖的爪痕', () => {
        const claw = renderStage('fengling_skill1');
        expect(claw).toContain('skill-fx skill-fx-kind-fengling-claw skill-fx-caster');
        expect(claw).toContain('skill-fx skill-fx-kind-fengling-claw skill-fx-target');
        expect(claw).toContain('fx-flp-streak');
        expect(claw.split('fx-flp-echo fx-flp-echo-').length - 1).toBe(3);
        expect(claw.split('fx-flc-slash fx-flc-slash-').length - 1).toBe(3);
        expect(claw.split('class="fx-flc-tip"').length - 1).toBe(3);
        expect(claw).toContain('fx-flc-rip');
    });

    it('风铃天威闪袭：同一套爪牙零件走独立档案', () => {
        const pounce = renderStage('fengling_pounce');
        expect(pounce).toContain('skill-fx-kind-fengling-pounce');
        expect(pounce).toContain('fx-flp-dust');
        expect(pounce).toContain('fx-flc-rip');
        expect(pounce).toContain('1080ms');
        expect(pounce).toContain('掠沙闪袭');
    });

    it('醉枕刀·醉掷寒锋：起手格铺冲刺光轨，落点格出贯斩特写', () => {
        const dash = renderStage('zuizhendao_skill1');
        expect(dash).toContain('skill-fx skill-fx-kind-zuizhen-throw skill-fx-caster');
        expect(dash).toContain('skill-fx skill-fx-kind-zuizhen-throw skill-fx-target');
        expect(dash).toContain('fx-zt-rail');
        expect(dash.split('fx-zt-streak fx-zt-streak-').length - 1).toBe(3);
        expect(dash).toContain('fx-zt-knife');
        expect(dash).toContain('fx-zt-burst');
        expect(dash).toContain('fx-zt-slash-a');
        expect(dash).toContain('fx-zt-slash-b');
        expect(dash.split('fx-zt-wave fx-zt-wave-b').length - 1).toBe(1);
    });

    it('醉枕刀·醉影换位：起手格涡环淡出，落位格太刀旋一周带斩痕圈', () => {
        const wheel = renderStage('zuizhendao_skill2');
        expect(wheel).toContain('skill-fx skill-fx-kind-zuizhen-wheel skill-fx-caster');
        expect(wheel).toContain('skill-fx skill-fx-kind-zuizhen-wheel skill-fx-target');
        expect(wheel).toContain('fx-zw-vanish');
        expect(wheel).toContain('class="fx-zw-orbit"');
        expect(wheel).toContain('class="fx-zw-orbit fx-zw-orbit-echo"');
        expect(wheel).toContain('fx-zw-katana');
        expect(wheel).toContain('zw-blade');
        expect(wheel.split('class="fx-zw-tick"').length - 1).toBe(8);
    });

    it('云缨星火照野：起手格甩出四道凌乱弧刃与一记枪杆抽打', () => {
        const html = renderStage('yunying_skill1');
        expect(html).toContain('skill-fx skill-fx-kind-yunying-sweep skill-fx-caster');
        expect(html.split('fx-yys-arc fx-yys-arc-').length - 1).toBe(4);
        expect(html).toContain('fx-yys-shaft');
    });

    it('云缨踏火长驱：只一记突刺，整杆长枪带枪杆/枪头/红缨 + 速度线与震环', () => {
        const html = renderStage('yunying_skill2');
        expect(html).toContain('skill-fx skill-fx-kind-yunying-thrust skill-fx-target');
        expect(html).toContain('class="fx-yyt-spear"');
        expect(html).not.toContain('fx-yyt-spear-');
        expect(html).toContain('class="fx-yyt-bar"');
        expect(html).toContain('class="fx-yyt-head"');
        expect(html).toContain('class="fx-yyt-tassel"');
        expect((html.match(/class="fx-yyt-(bar|head|tassel)"/g) ?? []).length).toBe(3);
        expect(html.split('fx-yyt-speed fx-yyt-speed-').length - 1).toBe(2);
        expect(html).toContain('fx-yyt-wave');
    });

    it('烈火燎原：起手格火种炸开，射线格各起三道火舌 + 灼地环与热浪', () => {
        const html = renderStage('yunying_liehuo');
        expect(html).toContain('skill-fx skill-fx-kind-liehuo-blaze skill-fx-caster');
        expect(html).toContain('skill-fx skill-fx-kind-liehuo-blaze skill-fx-target');
        expect(html).toContain('fx-lhb-hub');
        expect(html).toContain('fx-lhb-core');
        expect(html).toContain('fx-lhb fx-lhb-tall');
        expect(html.split('fx-lhb-tongue fx-lhb-tongue-').length - 1).toBeGreaterThanOrEqual(3);
        expect(html).toContain('fx-lhb-base');
        expect(html).toContain('fx-lhb-heat');
    });

    it('烈火燎原按射线序号逐格延后起燃，火才是一路烧到棋盘尽头', () => {
        const event = makeLiehuoEvent();
        const second = renderToStaticMarkup(
            <SkillFxVisual event={event} variant="area" atPos={[2, 4]} />
        );
        const last = renderToStaticMarkup(
            <SkillFxVisual event={event} variant="area" atPos={[2, 5]} />
        );
        expect(second).toContain('--fx-ray-delay:150ms');
        expect(last).toContain('--fx-ray-delay:300ms');
        // 射线上的每一格都得自己那一道火舌，而不是只有一团爆点
        expect((last.match(/fx-lhb-tongue fx-lhb-tongue-/g) ?? []).length).toBe(3);
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
