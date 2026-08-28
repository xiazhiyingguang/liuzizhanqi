/**
 * 技能 → 音效映射表
 * 覆盖全部英雄技能；同一风格共用音效文件（public/sounds/*.wav，程序合成）。
 * 新增技能时在此登记即可自动获得战斗音效，未登记的技能默认使用 impact。
 */

import type { SoundName } from '../core/sound-manager';

export const SKILL_SOUND_MAP: Record<string, SoundName> = {
    // ===== 白泽：治疗与复生 =====
    baize_skill1: 'heal',        // 瑞泽：治疗
    baize_skill2: 'revive',      // 天禄归生：复活友方

    // ===== 悟空：分身与合击 =====
    wukong_skill1: 'summon',     // 毫毛化身：召唤分身
    wukong_skill2: 'heavy_slash',// 大圣合击：合力重击

    // ===== 惠风：玄光增益与再舞 =====
    huifeng_skill1: 'buff',
    huifeng_skill2: 'dash',

    // ===== 玄啸：惊鸿再舞、风过留痕 =====
    xuanxiao_skill1: 'dash',
    xuanxiao_skill2: 'dash',

    // ===== 长离：连破斩与刃痕 =====
    changli_skill1: 'slash',
    changli_skill2: 'slash',

    // ===== 莫兰：入道蓄势、墨断重斩 =====
    moran_skill1: 'buff',
    moran_skill2: 'heavy_slash',

    // ===== 镇枭：雷霆开锋、金银错反击 =====
    zhenxiao_skill1: 'thunder',
    zhenxiao_skill2: 'buff',

    // ===== 琉璃：映月承锋援护 =====
    liuli_skill1: 'buff',
    liuli_skill2: 'impact',

    // ===== 夜枭：死契之瞳标记与追猎 =====
    nightowl_skill1: 'curse',
    nightowl_skill2: 'slash',

    // ===== 明镜：破镜分光与镜像换位 =====
    mirror_skill1: 'ice',
    mirror_skill2: 'teleport',

    // ===== 墨文：时光回溯与逆时斩 =====
    mowen_skill1: 'teleport',
    mowen_skill2: 'slash',

    // ===== 孤影：踏雪留影潜行、寒星碎 =====
    guying_skill1: 'summon',
    guying_skill2: 'ice',

    // ===== 寒江雪：冰霜双技 =====
    hanjiangxue_skill1: 'ice',
    hanjiangxue_skill2: 'snow',

    // ===== 骸骨君王：亡骨斩与亡灵唤回 =====
    skeletonking_skill1: 'heavy_slash',
    skeletonking_skill2: 'revive',

    // ===== 杰茨米：终焉斩与形态切换 =====
    jetzmi_skill1: 'heavy_slash',
    jetzmi_skill2: 'revive',

    // ===== 五弦琵琶：音符流转与裂帛和弦 =====
    pipa_skill1: 'buff',
    pipa_skill2: 'explosion',

    // ===== 赏金猎人：衔令追猎与悬赏 =====
    bounty_skill1: 'dash',
    bounty_skill2: 'coin',

    // ===== 阴阳师：纯阳一线与玄阴一线 =====
    yinyang_skill1: 'buff',
    yinyang_skill2: 'curse',

    // ===== 缚魂灯：法阵与缚魂 =====
    soul_lamp_skill1: 'summon',
    soul_lamp_skill2: 'curse',

    // ===== 英雄X：天神震怒与增势援护 =====
    hero_x_skill1: 'impact',
    hero_x_skill2: 'buff',

    // ===== 吟游诗人：和声与激情恢复 =====
    bard_skill1: 'heal',
    bard_skill2: 'heal',

    // ===== 凋零之主：凋零播撒与凋零引爆 =====
    wither_lord_skill1: 'curse',
    wither_lord_skill2: 'explosion',

    // ===== T型帛画：召唤金乌与玄龟 =====
    t_painting_skill1: 'summon',
    t_painting_skill2: 'summon',
    jinwu_skill: 'fire',         // 金乌攻击
    xuangui_skill: 'impact',     // 玄龟承伤

    // ===== 费曼：粒子标记与范围爆发 =====
    feynman_skill1: 'thunder',
    feynman_skill2: 'explosion',

    // ===== 旺财：财气积累与通灵财神 =====
    wangcai_skill1: 'coin',
    wangcai_skill2: 'summon',

    // ===== 薛定谔：生死叠加与量子纠缠 =====
    schrodinger_skill1: 'teleport',
    schrodinger_skill2: 'teleport',

    // ===== 莉莉丝：恐惧编织与情绪汲取 =====
    lilith_skill1: 'curse',
    lilith_skill2: 'curse',

    // ===== 李太白：青莲醉剑与谪仙醉斩 =====
    libai_skill1: 'slash',
    libai_skill2: 'heavy_slash',

    // ===== 醉枕刀：醉掷寒锋与醉影换位 =====
    zuizhendao_skill1: 'dash',
    zuizhendao_skill2: 'teleport',

    // ===== 绯雪：破冰爆发与寒天收割 =====
    feixue_skill1: 'ice',
    feixue_skill2: 'snow',

    // ===== 风铃：强制锁敌与沙丘猎杀 =====
    fengling_skill1: 'curse',
    fengling_skill2: 'slash',

    // ===== 帝兰：顺逆风操纵与羽化 =====
    dilan_skill1: 'snow',
    dilan_skill2: 'snow',

    // ===== 上官婉儿：毛笔落子与笔走龙蛇 =====
    shangguan_skill1: 'dash',
    shangguan_skill2: 'impact',

    // ===== 南风：扶摇吹散与引风成道 =====
    nanfeng_skill1: 'snow',
    nanfeng_skill2: 'dash',

    // ===== 沉渊·镇岳：极寒领域与拖拽援护 =====
    chenyuan_skill1: 'snow',
    chenyuan_skill2: 'impact',

    // ===== 戴尔：时空回溯与时空置换 =====
    dai_skill1: 'revive',
    dai_skill2: 'teleport',
};

/** 取技能对应音效，未登记的技能回落到通用打击音效。 */
export function getSkillSound(skillId: string): SoundName {
    return SKILL_SOUND_MAP[skillId] ?? 'impact';
}
