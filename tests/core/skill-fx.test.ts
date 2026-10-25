import { describe, expect, it } from 'vitest';
import {
    computeFxAngleDeg,
    computeFxDirection,
    computeFxImpactDelayMs,
    type SkillFxEvent,
    isImpactFxKind,
    isPerTargetFxKind,
    resolveSkillFx,
    SKILL_FX_KIND_LABELS,
    SKILL_FX_PROFILES,
} from '../../src/core/skill-fx';
import { isDirectionalFxKind } from '../../src/core/skill-fx-preview';
import { SKILL_SOUND_MAP } from '../../src/data/skill-sounds';

describe('resolveSkillFx', () => {
    it('大圣合击在落棒时触发命中反馈，次格保留相同的落棒与爆点间隔', () => {
        const event: SkillFxEvent = { id: 1, bornAt: 0, profile: resolveSkillFx('wukong_skill2'), owner: 'player1',
            fromPos: [2, 2], targetPos: [2, 3], angleDeg: 0, direction: 'E' };
        expect(computeFxImpactDelayMs(event, [2, 3])).toBe(250);
        expect(computeFxImpactDelayMs(event, [3, 4])).toBe(295);
        expect(resolveSkillFx('wukong_skill999').impactMs).toBe(250);
    });
    it('技能级档案精确命中各自的专属特效', () => {
        expect(resolveSkillFx('wukong_skill1').kind).toBe('wukong-clone');
        expect(resolveSkillFx('wukong_skill2').kind).toBe('wukong-staff');
        expect(resolveSkillFx('feixue_skill1').kind).toBe('feixue-blade');
        expect(resolveSkillFx('feixue_skill2').kind).toBe('feixue-bond');
        expect(resolveSkillFx('soul_lamp_skill1').kind).toBe('soul-lamp-array');
        expect(resolveSkillFx('soul_lamp_skill2').kind).toBe('soul-lamp-cycle');
        expect(resolveSkillFx('libai_skill1').kind).toBe('libai-slash');
        expect(resolveSkillFx('libai_skill2').kind).toBe('libai-flurry');
        expect(resolveSkillFx('feynman_skill1').kind).toBe('feynman-beam');
        expect(resolveSkillFx('feynman_skill2').kind).toBe('feynman-burst');
        expect(resolveSkillFx('moran_skill1').kind).toBe('moran-inkway');
        expect(resolveSkillFx('dai_skill2').kind).toBe('phase-swap');
        expect(resolveSkillFx('fengling_skill1').kind).toBe('fengling-claw');
        // 天威「猎砂追击」的闪袭档案（由战报标记派发，不是技能）
        expect(resolveSkillFx('fengling_pounce').kind).toBe('fengling-pounce');
    });

    it('恢复类技能各归各的原型，不再共用一套祝福光环', () => {
        // 单体治疗：光丝向内收拢，与"向外扩环"的增益读法相反
        expect(resolveSkillFx('baize_skill1').kind).toBe('heal-single');
        expect(resolveSkillFx('xubai_skill1').kind).toBe('heal-single');
        // 群体恢复：同心波自施法者荡开，每格各起一根光柱
        expect(resolveSkillFx('bard_skill2').kind).toBe('heal-wave');
        expect(resolveSkillFx('liuli_skill2').kind).toBe('heal-wave');
        expect(resolveSkillFx('pipa_skill1').kind).toBe('chord-aura');
        // 持续/延迟回血：挂在既有专属档案旁边的辅助档案，映射待定稿
        expect(resolveSkillFx('xubai_regen').kind).toBe('regen-orb');
        expect(resolveSkillFx('lingxi_regen').kind).toBe('regen-orb');
        // 复活：走同一套唤回仪式
        expect(resolveSkillFx('baize_skill2').kind).toBe('revive-rise');
        expect(resolveSkillFx('skeletonking_skill2').kind).toBe('bone-slash');
        expect(resolveSkillFx('dai_skill1').kind).toBe('rewind-state');
        expect(resolveSkillFx('dai_revive').kind).toBe('revive-rise');
        // 护盾援护：六边形罩面
        expect(resolveSkillFx('liuli_skill1').kind).toBe('shield-ward');
        expect(resolveSkillFx('jinghua_skill1').kind).toBe('shield-ward');
        // 既有专属原型一个都没被删掉，仍在原技能上
        expect(resolveSkillFx('xubai_skill2').kind).toBe('xubai-pearls');
        expect(resolveSkillFx('lingxi_skill1').kind).toBe('lingxi-wave');
        expect(resolveSkillFx('lingxi_skill2').kind).toBe('lingxi-fan');
        expect(resolveSkillFx('bard_skill1').kind).toBe('chord-notes');
        // 各主题保留展开与收尾时间，治疗与复活都控制在两秒以内。
        expect(resolveSkillFx('baize_skill2').durationMs).toBeLessThanOrEqual(1700);
        expect(resolveSkillFx('bard_skill2').durationMs).toBeLessThanOrEqual(1500);
        // 只有群体恢复是"每格各出一份本体"，其余恢复类都是单格
        expect(isPerTargetFxKind('heal-wave')).toBe(true);
        expect(isPerTargetFxKind('heal-single')).toBe(false);
        expect(isPerTargetFxKind('regen-orb')).toBe(false);
        expect(isPerTargetFxKind('revive-rise')).toBe(false);
        expect(isPerTargetFxKind('shield-ward')).toBe(false);
        // 恢复类都不该震屏闪白
        for (const kind of ['heal-single', 'heal-wave', 'regen-orb', 'revive-rise', 'shield-ward'] as const) {
            expect(isImpactFxKind(kind), `${kind} 不该触发震屏`).toBe(false);
        }
    });

    it('醉枕刀专属原型：冲刺光轨与太刀旋斩', () => {
        const dash = resolveSkillFx('zuizhendao_skill1');
        expect(dash.kind).toBe('zuizhen-throw');
        // 沿途每格都是"刀到才爆"的贯斩特写，且各格都要震屏
        expect(isPerTargetFxKind(dash.kind)).toBe(true);
        expect(isImpactFxKind(dash.kind)).toBe(true);
        // 真实冲刺序列由引擎自报（fxCoveredPositions），但整格只走逐格跟踪，
        // 不允许包围盒扩成区域整体特效
        expect(dash.fxArea).toBe('none');

        const wheel = resolveSkillFx('zuizhendao_skill2');
        expect(wheel.kind).toBe('zuizhen-wheel');
        expect(isImpactFxKind(wheel.kind)).toBe(true);
        // 全场选点、局部结算：不铺整盘区域特效，旋刃只在落位格出一次
        expect(wheel.fxArea).toBe('none');
        expect(isPerTargetFxKind(wheel.kind)).toBe(false);
    });

    it('闻人翊悬两式技能各走专属手绘材质，昭神变体换成金白一套', () => {
        const leap = resolveSkillFx('wenren_skill1');
        expect(leap.kind).toBe('wenren-leap');
        expect(leap.crafted).toBe('wenren-leap');
        expect(SKILL_FX_KIND_LABELS[leap.kind]).toBe('烬步火环');
        // 跃阵是跨格位移，图鉴预览必须摆成起手格→落点格
        expect(isDirectionalFxKind(leap.kind)).toBe(true);

        const reap = resolveSkillFx('wenren_skill2');
        expect(reap.kind).toBe('wenren-reap');
        expect(reap.crafted).toBe('wenren-reap');
        expect(SKILL_FX_KIND_LABELS[reap.kind]).toBe('裂焰燎原');
        expect(isDirectionalFxKind(reap.kind)).toBe(false);

        expect(resolveSkillFx('wenren_skill1_zhaoshen').crafted).toBe('wenren-leap-zhaoshen');
        expect(resolveSkillFx('wenren_skill2_zhaoshen').crafted).toBe('wenren-reap-zhaoshen');

        // 昭神入场是火行自己的变身，不能借轩辕的剑阵：换成火纹升腾的专属机制演出
        const ascend = resolveSkillFx('wenren_zhaoshen');
        expect(ascend.mechanism).toBe('ember-ascend');
        expect(ascend.durationMs).toBeGreaterThanOrEqual(1500);
        expect(ascend.fxArea).toBe('none');
        // 轩辕那套剑阵原样保留
        expect(resolveSkillFx('xuanyuan_zhaoshen').mechanism).toBe('zhaoshen');
    });

    it('云缨天威·燎原百斩：落点格一记火焰旋斩，全场只出一次本体', () => {
        const tianwei = resolveSkillFx('yunying_tianwei');
        expect(tianwei.kind).toBe('liehuo-wheel');
        expect(isImpactFxKind(tianwei.kind)).toBe(true);
        // 旋斩是"落在哪一格"的落点特写：被斩中的每一格只补轻量印记，不各转一圈
        expect(isPerTargetFxKind(tianwei.kind)).toBe(false);
    });

    it('所有档案均带正数存活时长', () => {
        for (const profile of Object.values(SKILL_FX_PROFILES)) {
            expect(profile.durationMs).toBeGreaterThan(0);
        }
    });

    it('每个登记了音效的技能都有专属特效档案（双轨覆盖一致）', () => {
        for (const skillId of Object.keys(SKILL_SOUND_MAP)) {
            expect(SKILL_FX_PROFILES[skillId], `${skillId} 缺少特效档案`).toBeDefined();
        }
    });

    it('未定制技能由技能 ID 推导英雄级兜底，未知技能回落墨韵波纹', () => {
        // wukong_skill3（假想未定制技能）应推导出英雄 wukong 的兜底
        expect(resolveSkillFx('wukong_skill3').kind).toBe('wukong-staff');
        expect(resolveSkillFx('libai_skill9').kind).toBe('libai-slash');
        // 完全未收录的英雄回落墨韵波纹
        expect(resolveSkillFx('ghosthero_skill1').kind).toBe('ink');
        expect(resolveSkillFx('unknown-skill')).toEqual({ kind: 'ink', durationMs: 750 });
        expect(resolveSkillFx(undefined)).toEqual({ kind: 'ink', durationMs: 750 });
        expect(resolveSkillFx()).toEqual({ kind: 'ink', durationMs: 750 });
    });
});

describe('computeFxAngleDeg', () => {
    it('四正方向角度与 CSS rotate 约定一致（0=右 90=下 180=左 -90=上）', () => {
        expect(computeFxAngleDeg([2, 2], [2, 3])).toBeCloseTo(0);      // 向右
        expect(computeFxAngleDeg([2, 2], [3, 2])).toBeCloseTo(90);    // 向下
        expect(computeFxAngleDeg([2, 2], [2, 1])).toBeCloseTo(180);    // 向左
        expect(computeFxAngleDeg([2, 2], [1, 2])).toBeCloseTo(-90);   // 向上
        expect(computeFxAngleDeg([2, 2], [2, 2])).toBe(0);             // 原地
    });

    it('对角方向为 45° 的倍数', () => {
        expect(computeFxAngleDeg([2, 2], [3, 3])).toBeCloseTo(45);   // 右下
        expect(computeFxAngleDeg([2, 2], [3, 1])).toBeCloseTo(135);   // 左下
        expect(computeFxAngleDeg([2, 2], [1, 1])).toBeCloseTo(-135);  // 左上
        expect(computeFxAngleDeg([2, 2], [1, 3])).toBeCloseTo(-45);   // 右上
    });
});

describe('computeFxDirection', () => {
    it('45° 扇区量化为八向标签', () => {
        expect(computeFxDirection(0)).toBe('E');
        expect(computeFxDirection(45)).toBe('SE');
        expect(computeFxDirection(90)).toBe('S');
        expect(computeFxDirection(135)).toBe('SW');
        expect(computeFxDirection(180)).toBe('W');
        expect(computeFxDirection(-135)).toBe('NW');
        expect(computeFxDirection(-90)).toBe('N');
        expect(computeFxDirection(-45)).toBe('NE');
    });

    it('负角度先归一化再量化', () => {
        expect(computeFxDirection(-10)).toBe('E');
        expect(computeFxDirection(-190)).toBe('W');
        expect(computeFxDirection(350)).toBe('E');
    });
});
