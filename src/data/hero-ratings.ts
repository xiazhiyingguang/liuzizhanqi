export const HERO_ABILITY_KEYS = ['输出', '生存', '机动', '控制', '支援', '覆盖', '节奏'] as const;

export type HeroAbilityKey = typeof HERO_ABILITY_KEYS[number];
export type HeroAbilityRatings = Record<HeroAbilityKey, number>;

function ratings(
    output: number,
    survival: number,
    mobility: number,
    control: number,
    support: number,
    coverage: number,
    tempo: number
): HeroAbilityRatings {
    return {
        输出: output,
        生存: survival,
        机动: mobility,
        控制: control,
        支援: support,
        覆盖: coverage,
        节奏: tempo,
    };
}

/**
 * 英雄七维能力评分。
 *
 * 使用英雄显示名作为索引，让尚未进入可选英雄池的设计稿英雄也能预先保留数据；
 * 当这些英雄完成机制并加入图鉴后，无需再次迁移评分。
 */
export const HERO_ABILITY_RATINGS: Record<string, HeroAbilityRatings> = {
    墨阑: ratings(7, 4, 4, 1, 1, 2, 9),
    震霄: ratings(7, 7, 4, 6, 1, 5, 6),
    回锋: ratings(8, 3, 6, 5, 1, 6, 8),
    孙悟空: ratings(8, 6, 6, 1, 2, 7, 10),
    镜: ratings(9, 6, 9, 2, 1, 8, 8),
    '骸骨君王·厄瑞波斯': ratings(7, 7, 4, 1, 9, 4, 7),
    '亡灵城主·杰茨米': ratings(8, 8, 4, 1, 8, 4, 7),
    '暗影猎手·夜枭': ratings(9, 8, 6, 2, 1, 6, 7),
    '时光剑客·莫问': ratings(8, 9, 6, 1, 1, 2, 4),
    露娜: ratings(7, 5, 10, 6, 2, 9, 10),
    孤影: ratings(9, 4, 8, 7, 1, 7, 5),
    曜斩: ratings(7, 9, 4, 1, 7, 5, 4),
    玄霄: ratings(1, 6, 6, 1, 10, 5, 10),
    五弦琵琶: ratings(7, 6, 6, 1, 8, 6, 7),
    赏金猎人: ratings(6, 7, 4, 1, 9, 8, 6),
    阴阳师: ratings(7, 6, 6, 6, 9, 6, 8),
    缚魂灯: ratings(1, 4, 4, 1, 10, 7, 8),
    琉璃: ratings(1, 9, 4, 1, 9, 3, 3),
    英雄X: ratings(4, 8, 5, 9, 6, 7, 4),
    '沉渊·镇岳': ratings(3, 9, 2, 8, 9, 6, 3),
    白泽: ratings(1, 6, 4, 1, 10, 10, 7),
    吟游诗人: ratings(1, 7, 6, 1, 9, 7, 6),
    长离: ratings(9, 10, 4, 5, 1, 10, 7),
    凋零之主: ratings(10, 9, 4, 2, 1, 9, 7),
    T型帛画: ratings(8, 8, 4, 6, 5, 9, 10),
    '时空旅者·戴尔': ratings(7, 8, 10, 8, 10, 10, 8),
    '粒子加速者·费曼': ratings(9, 3, 4, 2, 1, 10, 6),
    寒江雪: ratings(6, 4, 4, 9, 7, 7, 6),
    旺财: ratings(9, 8, 4, 1, 8, 6, 7),
    '量子观测者·薛定谔': ratings(8, 5, 10, 5, 1, 9, 6),
    '恐惧编织者·莉莉丝': ratings(8, 3, 6, 10, 1, 10, 9),
    '星象师·诺亚': ratings(1, 5, 4, 2, 10, 10, 8),
    '太阳骑士·赫利俄斯': ratings(8, 6, 4, 2, 5, 7, 5),
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
