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

    // ===== 回锋：连刃斩与风过留痕 =====
    huifeng_skill1: 'buff',
    huifeng_skill2: 'slash',

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
    mirror_blade: 'ice',       // 破镜之刃层数爆发（辅助特效，与破镜分光同音色）

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
    feixue_shatter: 'ice', // 破冰爆震（技能1击碎冰冻形态）

    // ===== 风铃：流沙追猎爪牙与天威闪袭 =====
    fengling_skill1: 'slash',
    fengling_skill2: 'slash',
    // 天威「猎砂追击」的闪现扑咬（辅助特效，与流沙追猎同一路爪牙、更重一档）
    fengling_pounce: 'heavy_slash',

    // ===== 帝兰：顺逆风操纵与羽化 =====
    dilan_skill1: 'snow',
    dilan_skill2: 'snow',

    // ===== 上官婉儿：毛笔落子与笔走龙蛇 =====
    shangguan_skill1: 'dash',
    shangguan_skill2: 'impact',

    // ===== 南风：扶摇吹散与引风成道 =====
    nanfeng_skill1: 'snow',
    nanfeng_skill2: 'dash',

    // ===== 云缨：星火、长驱与烈火燎原 =====
    yunying_skill1: 'fire',           // 星火照野
    yunying_skill2: 'slash',          // 踏火长驱：两道圆弧火斩
    yunying_liehuo: 'explosion',      // 烈火燎原射线（被动引燃，辅助特效）

    // ===== 惊鸿·止水：掠水突进与止水决渊 =====
    jinghong_skill1: 'dash',          // 掠水惊鸿：贴敌斩过并绕后
    jinghong_skill2: 'slash',         // 止水决渊：刀痕绕 5×5 外圈顺时针斩过
    jinghong_still: 'buff',           // 静水（技能2蓄力形态）

    // ===== 镜花·水月：水月换身与印月替身 =====
    jinghua_skill1: 'dash',           // 水月换身：镜面两端换身（专属银泠音效优先）
    jinghua_skill2: 'summon',         // 印月替身：唤候补登场、本体退场
    jinghua_tianwei: 'slash',         // 镜花照水：登场月华弧斩
    jinghua_tianwei_echo: 'revive',   // 月影回声：被点名友方脚下的月华光柱

    // ===== 沉渊·镇岳：极寒领域与拖拽援护 =====
    chenyuan_skill1: 'snow',
    chenyuan_skill2: 'impact',

    // ===== 血契：血誓横扫与强锁 =====
    xueqi_skill1: 'heavy_slash',   // 血誓横扫
    xueqi_skill2: 'curse',         // 血契锁

    // ===== 戴尔：时空回溯与时空置换 =====
    dai_skill1: 'revive',
    dai_skill2: 'teleport',

    // ===== 游隼：疾掠冲锋与四向风刃 =====
    youjun_skill1: 'dash',
    youjun_skill2: 'snow',

    // ===== 叙白：净化治疗与黑白凝珠 =====
    xubai_skill1: 'heal',
    xubai_skill2: 'buff',

    // ===== 泠汐：潮汐多段攻击 =====
    lingxi_skill1: 'snow',
    lingxi_skill2: 'impact',
};

/** 取技能对应音效，未登记的技能回落到通用打击音效。 */
export function getSkillSound(skillId: string): SoundName {
    return SKILL_SOUND_MAP[skillId] ?? 'impact';
}
