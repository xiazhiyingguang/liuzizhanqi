import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SkillFxPreview, { SkillFxStage } from '../../src/components/HeroCodex/SkillFxPreview';
import { SkillAreaFx, SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { computeFxAngleDeg, computeFxDirection, isImpactFxKind, isPerTargetFxKind, resolveSkillFx, type SkillFxEvent } from '../../src/core/skill-fx';

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

/** 手工构造一次踏火长驱的特效事件（云缨在 [2,2] 向东，命中面是那一列 3 格） */
function makeChargeEvent(): SkillFxEvent {
    const fromPos: [number, number] = [2, 2];
    const targetPos: [number, number] = [2, 3];
    const angleDeg = computeFxAngleDeg(fromPos, targetPos);
    return {
        id: 2,
        bornAt: 0,
        profile: resolveSkillFx('yunying_skill2'),
        owner: 'player1',
        fromPos,
        targetPos,
        angleDeg,
        direction: computeFxDirection(angleDeg),
        coveredPositions: [[1, 3], [2, 3], [3, 3]],
        // 圆弧刀光由区域层画在整片命中面上，没有包围盒就什么都不会出现
        areaBounds: { r0: 1, c0: 3, rows: 3, cols: 1 },
    };
}

const THEME_COLOR = '#a7372d';

function renderStage(skillId: string) {
    return renderToStaticMarkup(<SkillFxStage skillId={skillId} accent={THEME_COLOR} />);
}

describe('SkillFxStage 特效演示舞台', () => {
    it('方向型技能同时渲染起手格与目标格', () => {
        const html = renderStage('moran_skill2');
        expect(html).toContain('skill-fx skill-fx-kind-ink-cut skill-fx-caster');
        expect(html).toContain('skill-fx skill-fx-kind-ink-cut skill-fx-target');
        expect(html).toContain('skill-fx-stage-piece');
    });

    it('友方加持展示施法者和受益者', () => {
        const html = renderStage('xuanxiao_skill1');
        expect(html).toContain('skill-fx skill-fx-kind-spirit-rune skill-fx-caster');
        expect(html).toContain('skill-fx skill-fx-kind-spirit-rune skill-fx-target');
        // 加持的目标是友方，源端和受益端都可辨认。
        expect(html.split('class="skill-fx ').length - 1).toBe(2);
        expect(html).toContain('施');
    });

    it('花弄影·花间辞：折扇起手后由一整面花刃扫过三格', () => {
        const html = renderStage('huanongying_skill1');
        expect(html).toContain('skill-fx-kind-huanongying-fan skill-fx-caster');
        expect(html).toContain('hny-fan-glyph');
        expect(html).toContain('skill-area-fx-petalfan');
        expect(html).toContain('hny-fan-area');
        expect(html.split('hny-fan-sweep hny-fan-sweep-').length - 1).toBe(3);
        expect(html).toContain('hny-area-petal-5');
        expect(html).not.toContain('fxs-redslash');
        expect(html).toContain('花扇横斩');
    });

    it('花弄影·弄影：旧位收身、花瓣跨格、新位绽放并环斩', () => {
        const html = renderStage('huanongying_skill2');
        expect(html).toContain('skill-fx-kind-huanongying-swap skill-fx-caster');
        expect(html).toContain('skill-fx-kind-huanongying-swap skill-fx-target');
        expect(html).toContain('hny-swap-silhouette');
        expect(html).toContain('hny-swap-thread');
        expect(html).toContain('hny-petal-travel');
        expect(html).toContain('hny-arrival-bloom');
        expect(html).toContain('hny-ring-blade');
        expect(html.split('hny-cardinal-cut hny-cardinal-cut-').length - 1).toBe(4);
        expect(html).not.toContain('fxp-implode');
        expect(html).toContain('身影换舞');
    });

    it('花弄影影子重演使用半透明月影与影字封印', () => {
        const html = renderStage('huanongying_replay');
        expect(html).toContain('skill-fx-kind-huanongying-replay skill-fx-caster');
        expect(html).toContain('skill-fx-kind-huanongying-replay skill-fx-target');
        expect(html).toContain('hny-replay-figure');
        expect(html).toContain('hny-replay-cut');
        expect(html).toContain('hny-replay-seal');
        expect(html).toContain('月影重演');
    });

    it('惊鸿止水·决渊：楔形水刃绕场一周，沿途逐段卷起浪冠', () => {
        const html = renderStage('jinghong_skill2');
        expect(html).toContain('skill-fx-kind-jinghong-slash-ring skill-fx-caster');
        expect(html).toContain('jh-waterblade');
        expect(html).toContain('jh-waterblade-body');
        expect(html).toContain('jh-wake-water');
        expect(html.split('jh-wave-crest jh-wave-crest-').length - 1).toBe(12);
        expect(html.split('--jh-angle:').length - 1).toBe(26);
        expect(html).toContain('jh-broken-ring');
        expect(html).toContain('jh-ring-spray');
        expect(html).not.toContain('fx-slashring-flash');
        expect(html).toContain('1080ms');
        // 浪冠必须与 320ms/360° 的巡行同拍：首朵与刃头同时起，末朵在收刀前
        expect(html).toContain('--jh-delay:110ms');
        expect(html).toContain('--jh-delay:396ms');
    });

    it('舞台固定 3×2 演示格位', () => {
        const html = renderStage('wukong_skill1');
        expect(html.split('skill-fx-stage-cell').length - 1).toBe(6);
    });

    it('档案行展示原型名、时长与配色', () => {
        const html = renderStage('moran_skill1');
        expect(html).toContain('一笔画墨');
        expect(html).toContain('1240ms');
        expect(html).toContain('#2f2740');
        expect(html).toContain('moran-inkway');
        expect(html).toContain('skill-fx-stage-replay');
    });

    it('墨阑·入道：起手格画墨环落"道"字，目标格铺墨痕并炸出横斩与印', () => {
        const html = renderStage('moran_skill1');
        expect(html).toContain('skill-fx skill-fx-kind-moran-inkway skill-fx-caster');
        expect(html).toContain('skill-fx skill-fx-kind-moran-inkway skill-fx-target');
        // 起手：一笔画成的墨环（底圈/正笔/追笔尖的金色一段）与收笔落下的"道"
        expect(html).toContain('fx-mw-enso');
        expect(html).toContain('mw-enso-stroke');
        expect(html).toContain('mw-enso-tip');
        expect(html).toContain('fx-mw-glyph');
        // 命中：沿攻击轴铺过来的墨痕 + 飞白横斩 + 迸溅墨点 + 收尾道印
        expect(html).toContain('fx-mw-dash');
        expect(html).toContain('mw-slash-core');
        expect(html).toContain('mw-slash-dry');
        expect(html).toContain('fx-mw-splat-6');
        expect(html).toContain('fx-mw-seal');
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

    it('云缨天威·燎原百斩：起手格火线拖尾，落点格焰缨枪旋一周带火舌圈', () => {
        const wheel = renderStage('yunying_tianwei');
        expect(wheel).toContain('skill-fx skill-fx-kind-liehuo-wheel skill-fx-caster');
        expect(wheel).toContain('skill-fx skill-fx-kind-liehuo-wheel skill-fx-target');
        expect(wheel).toContain('fxp-trail');
        expect(wheel).toContain('class="fx-lw-orbit"');
        expect(wheel).toContain('class="fx-lw-orbit fx-lw-orbit-echo"');
        expect(wheel).toContain('fx-lw-spear');
        expect(wheel).toContain('lw-blade');
        expect(wheel).toContain('fx-lw-ring');
        expect(wheel.split('class="fx-lw-tick"').length - 1).toBe(8);
    });

    it('折光棱光千折：光路按方向不变的段切开，折点亮一枚棱片', () => {
        // 光从 [3,0] 向东走过 [3,1]→[3,2]，在 [3,2] 被光棱拐向南，再走 [4,2]→[5,2]
        const angleDeg = computeFxAngleDeg([3, 0], [3, 1]);
        const event: SkillFxEvent = {
            id: 7,
            bornAt: 0,
            profile: resolveSkillFx('zhiguang_skill2'),
            owner: 'player1',
            fromPos: [3, 0],
            targetPos: [3, 1],
            angleDeg,
            direction: computeFxDirection(angleDeg),
            coveredPositions: [[3, 1], [3, 2], [4, 2], [5, 2]],
            impactPositions: [[4, 2]],
            areaBounds: { r0: 3, c0: 0, rows: 3, cols: 3 },
        };
        const html = renderToStaticMarkup(<SkillAreaFx event={event} />);
        expect(html).toContain('skill-area-fx-lightpath');
        expect(html).toContain('saf-lp-muzzle');
        // 两段：东向两格 + 南向两格；折点只在真的拐了弯的第一段末尾亮
        expect(html.split('class="saf-lp-seg"').length - 1).toBe(2);
        expect(html.split('class="saf-lp-node"').length - 1).toBe(1);
        expect(html).toContain('--lp-rot:0deg');
        expect(html).toContain('--lp-rot:90deg');
        // 后一段延后两格起播，光才是一格一格走过去而不是整条同时亮
        expect(html).toContain('--lp-delay:0ms');
        expect(html).toContain('--lp-delay:140ms');
    });

    it('折光棱光千折：去重后跳步的光路不会被连成一根穿过的长线', () => {
        // [4,1]→[4,2] 相邻一段，之后光折回并跳到 [4,5]（中间三格是首次经过时已点亮的旧格）
        const angleDeg = computeFxAngleDeg([4, 0], [4, 1]);
        const event: SkillFxEvent = {
            id: 8,
            bornAt: 0,
            profile: resolveSkillFx('zhiguang_skill2'),
            owner: 'player2',
            fromPos: [4, 0],
            targetPos: [4, 1],
            angleDeg,
            direction: computeFxDirection(angleDeg),
            coveredPositions: [[4, 1], [4, 2], [4, 5]],
            areaBounds: { r0: 4, c0: 0, rows: 1, cols: 6 },
        };
        const html = renderToStaticMarkup(<SkillAreaFx event={event} />);
        expect(html.split('class="saf-lp-seg"').length - 1).toBe(2);
        expect(html.split('class="saf-lp-node"').length - 1).toBe(1);
        // 跳步那段的长度按真实跨度算：3 格
        expect(html).toContain('--lp-len:3');
    });

    it('云缨星火照野：长枪绕身旋舞一周，起手格甩出四道凌乱弧刃与一记枪杆抽打', () => {
        const html = renderStage('yunying_skill1');
        expect(html).toContain('skill-fx skill-fx-kind-yunying-sweep skill-fx-caster');
        // 旋枪本体与枪尖划出的圆——先看清"人在转枪"，弧刃才是扫出来的残影
        expect(html).toContain('fx-yys-spear');
        expect(html).toContain('fx-yys-circle');
        expect(html.split('fx-yys-arc fx-yys-arc-').length - 1).toBe(4);
        expect(html).toContain('fx-yys-shaft');
        expect(html).toContain('yy-spear-material');
        expect((html.match(/class="yy-arc-ribbon"/g) ?? []).length).toBe(4);
        expect((html.match(/fx-yys-ember fx-yys-ember-/g) ?? []).length).toBe(3);
    });

    it('云缨踏火长驱：逐格火爆不刻刀痕，区域层是一柄真枪扫过、枪尖所到之处烧成火扇', () => {
        const html = renderStage('yunying_skill2');
        expect(html).toContain('skill-fx skill-fx-kind-yunying-arc-slash skill-fx-target');
        expect(html).toContain('fx-yas-glow');
        // 被扫中的格子要腾起火爆，而不只是一圈柔光
        expect(html).toContain('fx-yas-flare');
        // 三格各刻一道刀痕会被看成三刀，逐格刀痕必须彻底没有
        expect(html).not.toContain('fx-yas-arc');
        expect(html).not.toContain('fx-yyt-');

        const area = renderToStaticMarkup(<SkillAreaFx event={makeChargeEvent()} />);
        expect(area).toContain('skill-area-fx-bladesweep');
        expect(area).toContain('saf-yas-arc');
        expect((area.match(/class="yy-swing-spear"/g) ?? []).length).toBe(1);
        expect(area).toContain('--yy-pivot-x:-0.5');
        expect(area).toContain('--yy-pivot-y:1.5');
        // 去程/回程各四层：实心火扇 + 外沿火舌带 + 暗红热晕 + 扇形斩痕 + 白热刃头
        expect((area.match(/class="saf-yas-fanfire/g) ?? []).length).toBe(2);
        expect((area.match(/class="saf-yas-fanrim/g) ?? []).length).toBe(2);
        expect((area.match(/class="saf-yas-blaze/g) ?? []).length).toBe(2);
        expect((area.match(/class="saf-yas-trail/g) ?? []).length).toBe(2);
        expect((area.match(/class="saf-yas-edge/g) ?? []).length).toBe(2);
        // 火头只附在这一柄真枪上，往返两扫不用另外复制火球。
        expect((area.match(/class="yy-spear-fire"/g) ?? []).length).toBe(1);
        expect(area).not.toContain('saf-yas-fire');
        expect((area.match(/saf-yas-spark saf-yas-spark-/g) ?? []).length).toBe(4);
        // 旧的平移巨刃图元必须彻底退场，不许残留第三种读法
        expect(area).not.toContain('saf-blade');
        expect(area).not.toContain('fx-yas-blade');
    });

    it('踏火长驱逐格的火气跟上刀锋扫到本格的时刻', () => {
        const event = makeChargeEvent();
        const first = renderToStaticMarkup(<SkillFxVisual event={event} variant="area" atPos={[1, 3]} />);
        const last = renderToStaticMarkup(<SkillFxVisual event={event} variant="area" atPos={[3, 3]} />);
        expect(first).toContain('--yas-fwd:0ms');
        expect(last).toContain('--yas-fwd:300ms');
    });

    it('李太白谪仙醉斩：剑阵边框钉住命中矩形，四道剑光穿阵', () => {
        const fromPos: [number, number] = [2, 1];
        const targetPos: [number, number] = [2, 2];
        const angleDeg = computeFxAngleDeg(fromPos, targetPos);
        const event: SkillFxEvent = {
            id: 3,
            bornAt: 0,
            profile: resolveSkillFx('libai_skill2'),
            owner: 'player1',
            fromPos,
            targetPos,
            angleDeg,
            direction: computeFxDirection(angleDeg),
            coveredPositions: [[1, 2], [1, 3], [2, 2], [2, 3], [3, 2], [3, 3]],
            impactPositions: [[2, 2], [2, 3]],
            // 谪仙醉斩的命中面是身前 3×2 剑阵，范围必须先于剑光被看见
            areaBounds: { r0: 1, c0: 2, rows: 3, cols: 2 },
        };
        const area = renderToStaticMarkup(<SkillAreaFx event={event} />);
        expect(area).toContain('skill-area-fx-swordzone');
        expect(area).toContain('saf-sz-frame');
        expect((area.match(/saf-sz-corner saf-sz-corner-/g) ?? []).length).toBe(4);
        expect((area.match(/saf-sz-beam saf-sz-beam-/g) ?? []).length).toBe(4);
        expect(area).toContain('saf-sz-flash');
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

describe('恢复类原型互不混用', () => {
    it('白泽治疗使用瑞云与露滴，保留治疗语义', () => {
        const html = renderStage('baize_skill1');
        expect(html).toContain('skill-fx skill-fx-kind-heal-single skill-fx-caster');
        expect(html).toContain('skill-fx skill-fx-kind-heal-single skill-fx-target');
        expect(html).toContain('recovery-auspice');
        expect(html).toContain('recovery-clouds');
        expect(html).toContain('recovery-dew');
        // 治疗环（fxp-ring）是增益的读法，单体回春不该再出现
        expect(html).not.toContain('fxp-ring');
        expect(html).toContain('单体回春');
        expect(html).toContain('1250ms');
        // 配色仍走白泽档案
        expect(html).toContain('#397d70');
    });

    it('叙白净化和白泽瑞泽有不同物象，不只更换颜色', () => {
        const xubai = renderStage('xubai_skill1');
        expect(xubai).toContain('skill-fx-kind-heal-single');
        expect(xubai).toContain('rfx-purify');
        expect(xubai).not.toContain('recovery-clouds');
        expect(xubai).toContain('#718e8b');
    });

    it('吟游群疗逐个受益者展开乐谱，空格没有巨型法阵', () => {
        const html = renderStage('bard_skill2');
        // 波心在施法格
        expect(html).toContain('skill-fx skill-fx-kind-heal-wave skill-fx-caster');
        expect(html).toContain('recovery-chorus');
        // 受益格各起一根柱
        expect((html.match(/class="recovery-notes"/g) ?? []).length).toBe(4);
        // 完整棋盘展示范围与多名受益者，波幅按实际覆盖范围展开。
        expect(html.split('skill-fx-stage-cell').length - 1).toBe(36);
        expect(html).not.toContain('skill-area-fx-runearray');
        expect(renderStage('liuli_skill2')).toContain('rfx-lotus');
        expect(html).toContain('群体恢复');
    });

    it('叙白珠子向内回补，泠汐持续恢复使用贝壳回潮', () => {
        const html = renderStage('xubai_regen');
        expect(html).toContain('skill-fx-kind-regen-orb');
        expect(html).toContain('rfx-pearls is-returning');
        expect(html).toContain('is-white');
        expect(html).toContain('is-ink');
        // 三颗绿点排在三个跳拍上（每 280ms 一跳）
        expect(renderStage('lingxi_regen')).toContain('rfx-tide');
        expect(renderStage('lingxi_regen')).not.toContain('rfx-pearls');
        expect(html).toContain('凝珠回血');
    });

    it('叙白黑白凝珠保留专属汇聚和环绕珠阵，不被通用治疗的落珠覆盖', () => {
        const html = renderStage('xubai_skill2');
        expect(html).toContain('fx-pearl-formation');
        expect(html.match(/class="fx-pearl fx-pearl-in-/g)).toHaveLength(3);
        expect(html.match(/class="fx-pearl-orb fx-pearl-orb-/g)).toHaveLength(3);
        expect(html).toContain('fx-pearl-arc-ink');
        expect(html).toContain('fx-pearl-arc-white');
        expect(html).not.toContain('class="rfx-art rfx-pearls');
        // 消耗珠子回补生命仍使用独立的吸收动画。
        expect(renderStage('xubai_regen')).toContain('rfx-pearls is-returning');
    });

    it('瑞兽、时空、骸骨与魂灯复活有各自轮廓', () => {
        const html = renderStage('baize_skill2');
        expect(html).toContain('skill-fx skill-fx-kind-revive-rise skill-fx-target');
        expect(html).toContain('recovery-auspice-rebirth');
        expect(renderStage('dai_revive')).toContain('rfx-time-gate');
        expect(renderStage('skeletonking_revive')).toContain('recovery-bone-soul');
        expect(renderStage('soul_lamp_revive')).toContain('recovery-lantern');
        expect(html).toContain('唤回仪式');
        expect(html).toContain('1600ms');
    });

    it('护盾援护：六边形罩面 + 沿棱走一圈的流光 + 六角锚点，没有朝攻击方向的分量', () => {
        const html = renderStage('liuli_skill1');
        expect(html).toContain('skill-fx skill-fx-kind-shield-ward skill-fx-target');
        expect(html).toContain('fx-sw-face');
        expect(html).toContain('fx-sw-rim');
        expect(html).toContain('fx-sw-sweep');
        expect(html).toContain('fx-sw-inner');
        expect((html.match(/class="fx-sw-stud"/g) ?? []).length).toBe(6);
        // 纯防御观感：既没有受击爆闪，也没有沿攻击轴落下的分量
        expect(html).not.toContain('fxp-hitflash');
        expect(html).not.toContain('fxp-crack');
        expect(html).toContain('护盾援护');
    });

    it('换影护盾段与映月承锋同原型，各自沿用原档案配色', () => {
        const html = renderStage('jinghua_skill1');
        expect(html).toContain('skill-fx-kind-shield-ward');
        expect(html).toContain('#a8d4f0');
    });

    it('恢复类不进震屏白闪名单，只有群体恢复逐格出本体', () => {
        for (const kind of ['heal-single', 'regen-orb', 'revive-rise', 'shield-ward'] as const) {
            expect(isPerTargetFxKind(kind), `${kind} 不该逐格出本体`).toBe(false);
        }
        expect(isPerTargetFxKind('heal-wave')).toBe(true);
        for (const kind of ['heal-single', 'heal-wave', 'regen-orb', 'revive-rise', 'shield-ward'] as const) {
            expect(isImpactFxKind(kind), `${kind} 不该触发震屏`).toBe(false);
        }
    });
});

describe('SkillFxPreview 悬停触发器', () => {
    it('旺财通灵只显示一次七钱聚印，不叠加起手钱币或普通攻击爆点', () => {
        const html = renderStage('wangcai_awaken');
        expect((html.match(/data-wangcai-awaken/g) ?? []).length).toBe(1);
        expect((html.match(/class="wc-awaken-gather"/g) ?? []).length).toBe(7);
        expect(html).toContain('财神通灵');
        expect(html).toContain('wc-awaken-seal');
        expect(html).not.toContain('fx-theme-coin-main');
        expect(html).not.toContain('fx-theme-coin-source');
        expect(html).not.toContain('fxp-hitflash');
    });
    it('静止状态只渲染图标，不预先挂载舞台', () => {
        const html = renderToStaticMarkup(
            <SkillFxPreview skillId="moran_skill1" skillName="入道" accent={THEME_COLOR} />
        );
        expect(html).toContain('skill-fx-peek-trigger');
        expect(html).toContain('入道 的技能特效');
        expect(html).not.toContain('skill-fx-stage');
    });
});
