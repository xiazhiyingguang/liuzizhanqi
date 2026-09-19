export const HERO_ABILITY_KEYS = ['输出', '生存', '机动', '控制', '支援', '覆盖', '成长'] as const;

export type HeroAbilityKey = typeof HERO_ABILITY_KEYS[number];
export type HeroAbilityRatings = Record<HeroAbilityKey, number>;

/**
 * 七维评分的最后一维「成长」＝越打越强：
 * 层数/资源可累积且不随时间衰减、击杀带来永久增益、拖得越久战力越高者给高分；
 * 数值全程恒定的面板型、以及"攒了就要花掉"的循环消耗型资源给低分。
 * 参考刻度：10＝永久成长无上限；8~9＝多套成型叠层，后期判若两人；
 * 6~7＝有叠层但有上限或会被周期消耗；4~5＝仅轻微积累；1~3＝全程恒定或越拖越弱。
 */
function ratings(
    output: number,
    survival: number,
    mobility: number,
    control: number,
    support: number,
    coverage: number,
    growth: number
): HeroAbilityRatings {
    return {
        输出: output,
        生存: survival,
        机动: mobility,
        控制: control,
        支援: support,
        覆盖: coverage,
        成长: growth,
    };
}

/**
 * 英雄七维能力评分。
 *
 * 使用英雄显示名作为索引，让尚未进入可选英雄池的设计稿英雄也能预先保留数据；
 * 当这些英雄完成机制并加入图鉴后，无需再次迁移评分。
 * 设计稿英雄（露娜/曜斩/星象师·诺亚/太阳骑士·赫利俄斯）的「成长」为暂定值，待机制落地后校准。
 */
export const HERO_ABILITY_RATINGS: Record<string, HeroAbilityRatings> = {
    墨阑: ratings(8, 6, 5, 1, 1, 2, 6),          // 受击攒再动，致知强化在单次窗口内，永久成长有限
    血契: ratings(5, 9, 3, 7, 6, 4, 6),          // 每损失2%生命+1%防御，挨打越多越硬
    震霄: ratings(7, 7, 4, 6, 1, 5, 4),          // 反击靠开启状态，无数值积累
    回锋: ratings(8, 3, 6, 5, 1, 6, 9),          // 破锋5层永久增伤+连破/啸刃/锋鸣永久标记滚雪球
    孙悟空: ratings(8, 6, 6, 1, 2, 7, 10),       // 分身阵亡灵犀+20%暴击至100%，战线越打越大
    镜: ratings(9, 6, 9, 2, 1, 8, 5),            // 破镜之刃击杀即时结算，不留存量
    '骸骨君王·厄瑞波斯': ratings(7, 7, 4, 1, 9, 4, 8), // 全场阵亡数换算护盾+亡灵共鸣越打越厚
    '亡灵城主·杰茨米': ratings(8, 8, 4, 1, 8, 4, 7),   // 亡灵共鸣积累（击杀+2）喂两形态爆发
    '暗影猎手·夜枭': ratings(9, 8, 6, 2, 1, 6, 4),     // 标记即结即抛，面板全程恒定
    '时光剑客·莫问': ratings(8, 9, 6, 1, 1, 2, 4),     // 残血高闪是机制不是积累，无叠层
    露娜: ratings(7, 5, 10, 6, 2, 9, 5),         // 设计稿暂定
    孤影: ratings(9, 4, 8, 7, 1, 7, 7),          // 寒星0→5层逐步成型（上限5）
    曜斩: ratings(7, 9, 4, 1, 7, 5, 5),          // 设计稿暂定
    玄霄: ratings(1, 6, 6, 1, 10, 5, 3),         // 纯工具人，自己全程恒定
    五弦琵琶: ratings(7, 6, 6, 1, 8, 6, 7),      // 和弦不自动清空，攒着养 big 爆发
    赏金猎人: ratings(6, 7, 4, 1, 9, 8, 9),      // 赏金奖励含永久暴击/永久吸血
    阴阳师: ratings(7, 6, 6, 6, 9, 6, 8),        // 阴阳线攻防倍率每轮+5%直至50%
    缚魂灯: ratings(1, 4, 4, 1, 10, 7, 9),       // 每死一次吸血率+20%上限90%，死着变强
    琉璃: ratings(1, 10, 4, 1, 9, 3, 6),         // 每次援护+1层禅定，承伤转化为底力
    英雄X: ratings(4, 8, 5, 9, 6, 7, 7),         // 震怒/增势双计数持续积累
    '沉渊·镇岳': ratings(3, 9, 2, 8, 9, 6, 7),   // 领域逐回合叠寒天，天威按全场层数回血
    白泽: ratings(1, 6, 4, 1, 10, 10, 5),        // 白泽之力/天禄有积累但收益平缓
    吟游诗人: ratings(1, 7, 6, 1, 9, 7, 4),      // 激情是攒了就花的团队资源
    长离: ratings(9, 10, 4, 5, 1, 10, 9),        // 星火换最多三次复生，每次复生+20%增伤
    凋零之主: ratings(10, 9, 4, 2, 1, 9, 9),     // 引爆每满6层多一条命，击杀再+1命，上不封顶
    T型帛画: ratings(8, 8, 4, 6, 5, 9, 5),       // 每存活召唤物+1伤害封顶2，重新落位不算涨
    '时空旅者·戴尔': ratings(7, 8, 10, 8, 10, 10, 4),  // 全套工具数值恒定，强度靠队友兑现
    '粒子加速者·费曼': ratings(9, 3, 4, 2, 1, 10, 6),  // 能量每3点扩一次范围，攒了要花
    寒江雪: ratings(6, 4, 4, 9, 7, 7, 4),        // 冰晶被消耗就得补，净存量低
    绯雪: ratings(9, 6, 4, 7, 1, 6, 5),          // 吃队友寒天的红利，自己不涨
    李太白: ratings(8, 3, 9, 1, 1, 6, 8),        // 醉意0→4层越喝越猛，击杀回2层
    醉枕刀: ratings(8, 7, 7, 1, 3, 5, 8),        // 醉意上限6层，层数换闪避与真实伤害反击
    风铃: ratings(9, 7, 5, 9, 1, 4, 8),          // 猎砂每层+20%暴击与攻击，击杀+2层
    帝兰: ratings(7, 6, 8, 9, 7, 10, 5),         // 羽化是引爆清空的循环，本体面板恒定
    南风: ratings(6, 8, 9, 6, 8, 10, 9),         // 风道无上限越铺越多，拖越久棋盘越是他家
    旺财: ratings(9, 8, 4, 1, 8, 6, 10),         // 通灵后每点财气永久+1攻击，击杀永久+2
    '量子观测者·薛定谔': ratings(8, 5, 10, 5, 1, 9, 6), // 未受伤目标下次+50%伤害，单层增幅
    '恐惧编织者·莉莉丝': ratings(8, 3, 6, 10, 1, 10, 7), // 恐惧情绪能量逐点+30%技能伤
    '星象师·诺亚': ratings(1, 5, 4, 2, 10, 10, 4),      // 设计稿暂定
    '太阳骑士·赫利俄斯': ratings(8, 6, 4, 2, 5, 7, 5),  // 设计稿暂定
    上官婉儿: ratings(7, 5, 9, 1, 1, 7, 6),      // 墨意凝闪避（存2次），笔走越冲越有盾
    游隼: ratings(9, 4, 10, 3, 1, 8, 7),         // 疾掠吃移动距离蓄力，跑动越多单发越痛
    叙白: ratings(1, 8, 4, 1, 10, 6, 3),         // 黑白球是消费型资源，本身不涨战力
    泠汐: ratings(8, 7, 4, 2, 6, 9, 6),          // 潮汐攒了就爆；助力增伤可跨回合叠存
    云缨: ratings(7, 6, 3, 2, 2, 8, 7),          // 祥瑞滚层引爆，护盾"第二轮后才真正厚起来"
    '惊鸿·止水': ratings(8, 8, 5, 1, 1, 7, 4),   // 惊鸿上限3且整押消耗，是弹药不是成长
};

export function getHeroAbilityRatings(heroName: string): HeroAbilityRatings | undefined {
    return HERO_ABILITY_RATINGS[heroName];
}

export function getAbilityHighlights(ratingValues: HeroAbilityRatings) {
    const ordered = [...HERO_ABILITY_KEYS].sort((a, b) => ratingValues[b] - ratingValues[a]);
    const average = HERO_ABILITY_KEYS.reduce((sum, key) => sum + ratingValues[key], 0) / HERO_ABILITY_KEYS.length;
    return {
        strongest: ordered.slice(0, 2) as [HeroAbilityKey, HeroAbilityKey],
        weakest: ordered[ordered.length - 1],
        average,
    };
}
