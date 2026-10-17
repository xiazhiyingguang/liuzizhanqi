import { AVAILABLE_HERO_IDS } from './heroes';

/**
 * 致知总表（设计稿 2026-10-01 版）。每个英雄三条，依次对应
 * `hero.counters['talent_1' | 'talent_2' | 'talent_3']`。
 *
 * 这里只是"有哪些致知"的唯一权威来源：图鉴直接渲染它，
 * tests/heroes/zhizhi.test.ts 用它断言"每个可上场英雄都有三条致知"。
 * 真正的战斗结算是散在各技能里读 talent_N 完成的，改数值时两边都要对得上。
 *
 * 授予/消费层只在经典模式里发生（标准模式永远不授予），入口见 core/hero-zhizhi.ts。
 */

export type ZhizhiTier = 1 | 2 | 3;

export interface ZhizhiEntry {
    tier: ZhizhiTier;
    /** 效果原文；null = 设计稿留白（"暂无"），图鉴显示占位、战斗不结算 */
    text: string | null;
}

/** 键必须是英雄模板 id：英雄图鉴里出现的每一个人，这里都要有三条 */
const ZHIZHI_DRAFTS: Record<string, readonly (string | null)[]> = {
    // ===== 武曲：近战锋刃 =====
    moran: ['生命增加 10', '为道解除后的那次立即出手，技能伤害提升 40%', '为道期间的免伤提升到 60%'],
    zhenxiao: ['技能耗血 20% → 15%', '生命 46 → 54', '金银错回击 6 → 8'],
    huifeng: ['生命增加 8', '每层「破锋」的增伤 10% → 15%', '技能二伤害 5 → 7'],
    wukong: ['初始暴击率提升 20%', '分身生命 10 → 12', '「灵犀」每层提供的暴击率 20% → 30%'],
    mirror: ['技能二伤害 10 → 14', '天威由 3 层「破镜之刃」提升为 4 层', '「破镜之刃」伤害 5 → 7'],
    skeletonking: [
        '天威复活时的生命改为 亡灵共鸣 × 3',
        '被动护盾上限 6 → 10',
        '技能二的亡灵共鸣系数 1 → 2',
    ],
    jetzmi: [
        '天威获得的亡灵共鸣 2 → 3',
        '终焉国王形态技能一额外获得（亡灵共鸣 × 1）点护盾',
        '技能一的亡灵共鸣系数 1 → 2',
    ],
    nightowl: ['每潜行一回合，暴击率提升 30%', '技能二基础伤害 +3', '暴击伤害提升 40%'],
    mowen: ['生命增加 8', '技能二的额外伤害变为已损生命值的 40%', '生命低于 50% 时闪避概率即提升至 50%'],
    guying: [
        '技能二伤害 10 → 12，断雪期间 12 → 15',
        '「寒星」每层技能增伤 10% → 15%（上限仍是 5 层）',
        '技能一有 50% 概率附加 2 层「寒天」',
    ],
    libai: ['生命增加 6', '技能一伤害 7 → 8', '技能二的醉意上限 4 → 5'],
    zuizhendao: ['技能一伤害 4 → 5', '技能二伤害 5 → 6', '醉意上限 4 → 5'],
    feixue: ['生命增加 8（45 → 53）', '技能一伤害 8 → 10，连枝追击 6 → 7', '连枝状态的追击也会施加一层「寒天」'],
    fengling: ['生命增加 7', '技能一伤害 8 → 10', '天威追击伤害 8 → 10'],
    youjun: ['技能一基础伤害 5 → 6', '技能二风刃伤害 4 → 5', '天威飞刀伤害 4 → 5'],
    yunying: ['生命 45 → 52', '烈火燎原变为 已损生命 40% + 5', '每次攻击改为先施加祥瑞，再造成伤害'],
    jinghong: ['生命增加 8', '技能一伤害 9 → 11', '技能二第二段伤害 10 → 12'],
    huanongying: ['生命增加 6', '技能一扇形斩 6 → 7', '技能二换位落地的环身斩 8 → 9'],

    // ===== 天师：辅助与风向 =====
    xuanxiao: ['技能一改为 +30% 暴击、+30% 暴伤', '技能二额外附带 +30% 暴击、+30% 暴伤', '「化险为夷」的转化值提升 2 倍'],
    pipa: ['基础攻击力 +4', '技能二的和弦系数 3 → 4', '每有 1 层「和弦」永久增加 1 点基础攻击力'],
    bounty: ['生命增加 8', '技能二伤害 8 → 10、回复 6 → 8', '天威改为对所有存活敌人追加「猎杀令」'],
    yinyang: ['生命增加 10', '阴阳线每回合的效果增长 5% → 10%', '阳线、阴线的连接数各提升为 2 条'],
    soul_lamp: [
        '生命增加 12',
        '复活时每层「亡灵之魂」的回复量 20% → 30%',
        '被动吸血初始 30% → 50%，上限 90% → 100%',
    ],
    dilan: ['技能一伤害 3 → 4', '技能二伤害 3 → 4', '「羽化」每移动 1 格的固定伤害 1 → 2'],
    jinghua: ['生命增加 8', '「水月」护盾 5 → 7', '天威伤害 5 → 7'],

    // ===== 霸魁：防御与承伤 =====
    liuli: ['生命增加 15', '技能二回复 10% → 12% 最大生命值', '每层「禅定」额外提供 10% 免伤'],
    hero_x: [
        '技能一由随机目标改为选定目标',
        '回合末改为对 1 格内敌人施加 2 层「震怒」、2 格内施加 1 层',
        '「增势」触发免伤所需层数 3 → 2',
    ],
    chenyuan: ['生命增加 10', '技能一伤害 6 → 9', '技能二的承伤比例 30% → 40%'],
    xueqi: ['生命增加 10', '移动力 +1', '技能二使用后本回合不会死亡'],

    // ===== 素问：恢复与净化 =====
    baize: ['生命增加 8', '「白泽之力」的提升 10% → 15%，上限 50% → 60%', '开局自带 1 层「天禄」'],
    bard: ['生命增加 10', '「和声」每次攻击回复 5 → 6', '技能二作用范围 1 格 → 3 格'],
    xubai: ['黑白球每颗回复 4 → 5', '登场被动的回复 8 → 10', '黑白球同时净化一层负面效果'],
    wangshu: ['生命增加 10（50 → 60）', '移动力 2 → 3', '满月倍率 80% → 100%'],

    // ===== 化识：远程与场地 =====
    wither_lord: [
        '被动改为每 5 层「凋零」增加一条生命',
        '初始拥有 3 条生命',
        '技能二的系数由「亡灵之力」改为「亡灵共鸣」（上限仍是 20%）',
    ],
    t_painting: [
        '召唤物阵亡时的自损 30% → 20% 当前生命',
        '召唤物生命 +4（金乌 12 → 16、玄龟 18 → 22）',
        '金乌伤害变为 范围内敌人数 × 4',
    ],
    dai: ['生命增加 8', '生命再增加 10', '技能二不再有冷却'],
    feynman: ['技能二的标记系数 2 → 3', '天威粒子风暴落点数 8 → 12', '被动触发所需能量 3 → 2'],
    hanjiangxue: ['生命增加 8', '技能一伤害 5 → 6', '「冰甲」减伤 20% → 40%'],
    // 致知3 设计稿写"暂无"：留占位，等设定补齐
    shangguan: ['生命增加 8', '技能二冲刺伤害 6 → 8', '每层「墨意」使技能伤害提升 5%，最多提升 30%'],
    nanfeng: ['生命增加 8', '技能一旋风伤害 4 → 5', '风道内闪避提升 25% → 30%'],
    lingxi: ['移动力 2 → 3', '被动的友方攻击提升 20% → 25%', '天威溢出护盾上限 10 → 15'],
    lilith: ['生命增加 7', '恐惧之箭伤害 8 → 10', '恐惧蔓延的额外伤害系数 3 → 5'],
    zhiguang: ['生命 +6', '光束基础伤害 6 → 8', '「光棱」存续 3 → 4 回合'],
    zhiyuan: ['生命 +8', '连击伤害 6 → 7', '追击伤害 4 → 5'],
    xihuan: ['生命 +10', '均光的残血补量 6 → 8', '回晖回复 5 → 6'],
    duosui: ['生命 45 → 52', '天威「血诏」附加 20% → 30%', '技能二已损系数 25% → 40%'],
    jiangtaigong: ['生命 +8', '水泽闪避 20% → 25%', '鲸落概率 25% 起、每次 +25% → 30% 起、每次 +30%'],
    tingyuan: ['生命 +8', '引雷伤害 10 → 12', null],
    aoyuan: ['生命 +8', '游龙伤害 4 → 5', '每层「龙鳞」攻击与闪避 6% → 10%'],
    yunxiu: ['生命 50 → 58', '雷云落雷伤害 4 → 5', null],
    daizong: ['生命 +10', '镇守承转 40% → 50%', '不动如山 25%/50%/回复10% → 30%/60%/15%'],
    xuanyuan: ['技能一跃迁与周圈伤害各 +1', '技能二剑气伤害 6 → 7', '每把飞剑的御剑免伤 10% → 12%'],

    // ===== 通灵：变身与复活 =====
    changli: ['技能一伤害 3 → 4', '每层「暗夜星火」的增伤 10% → 12%', '复活后生命为上次的 60%、攻击力提升 50%'],
    wangcai: ['生命增加 8', '初始基础攻击力 +1（4 → 5）', '天威永久增加基础攻击力 2 → 3'],
};

/** 英雄模板 id → 三条致知；顺序即 tier 1/2/3 */
export const HERO_ZHIZHI: Record<string, ZhizhiEntry[]> = Object.fromEntries(
    Object.entries(ZHIZHI_DRAFTS).map(([heroId, texts]) => [
        heroId,
        texts.map((text, index) => ({ tier: (index + 1) as ZhizhiTier, text })),
    ])
);

const ZHIZHI_TIER_LABELS = ['一', '二', '三'];

/**
 * "常驻属性"类的致知：开局一次性写进实例即可，不需要在各技能结算里散读 talent 计数。
 * 由 core/hero-zhizhi.ts 的 applyZhizhiForMode 在授予致知时一并落地，
 * 所以标准模式（不授予）天然保持原值。
 */
export interface ZhizhiStatBonus {
    maxHp?: number;
    moveRange?: number;
    baseAttack?: number;
}

export const ZHIZHI_STAT_BONUSES: Record<string, Partial<Record<ZhizhiTier, ZhizhiStatBonus>>> = {
    moran: { 1: { maxHp: 10 } },
    zhenxiao: { 2: { maxHp: 8 } },
    huifeng: { 1: { maxHp: 8 } },
    mowen: { 1: { maxHp: 8 } },
    libai: { 1: { maxHp: 6 } },
    feixue: { 1: { maxHp: 8 } },
    fengling: { 1: { maxHp: 7 } },
    yunying: { 1: { maxHp: 7 } },
    jinghong: { 1: { maxHp: 8 } },
    huanongying: { 1: { maxHp: 6 } },
    bounty: { 1: { maxHp: 8 } },
    pipa: { 1: { baseAttack: 4 } },
    yinyang: { 1: { maxHp: 10 } },
    soul_lamp: { 1: { maxHp: 12 } },
    jinghua: { 1: { maxHp: 8 } },
    liuli: { 1: { maxHp: 15 } },
    chenyuan: { 1: { maxHp: 10 } },
    xueqi: { 1: { maxHp: 10 }, 2: { moveRange: 1 } },
    baize: { 1: { maxHp: 8 } },
    wangshu: { 1: { maxHp: 10 }, 2: { moveRange: 1 } },
    bard: { 1: { maxHp: 10 } },
    dai: { 1: { maxHp: 8 }, 2: { maxHp: 10 } },
    hanjiangxue: { 1: { maxHp: 8 } },
    shangguan: { 1: { maxHp: 8 } },
    nanfeng: { 1: { maxHp: 8 } },
    lingxi: { 1: { moveRange: 1 } },
    lilith: { 1: { maxHp: 7 } },
    zhiguang: { 1: { maxHp: 6 } },
    zhiyuan: { 1: { maxHp: 8 } },
    xihuan: { 1: { maxHp: 10 } },
    duosui: { 1: { maxHp: 7 } },
    wangcai: { 1: { maxHp: 8 }, 2: { baseAttack: 1 } },
    jiangtaigong: { 1: { maxHp: 8 } },
    tingyuan: { 1: { maxHp: 8 } },
    aoyuan: { 1: { maxHp: 8 } },
    yunxiu: { 1: { maxHp: 8 } },
    daizong: { 1: { maxHp: 10 } },
};

/** 某个英雄的致知条目；没有登记时返回空数组（调用方据此显示"致知待定"） */
export function getZhizhi(heroTemplateId: string): ZhizhiEntry[] {
    return HERO_ZHIZHI[heroTemplateId] ?? [];
}

/**
 * "开局自带某层资源"类的致知：在授予时把计数加上去（增量，不是赋值），
 * 例如白泽致知3 的"初始化 1 层天禄"、凋零之主致知2 的"初始 3 条生命"（基础已是 2）。
 */
export const ZHIZHI_START_COUNTERS: Record<string, Partial<Record<ZhizhiTier, Record<string, number>>>> = {
    baize: { 3: { '天禄': 1 } },
    wither_lord: { 2: { wither_lives: 1 } },
    // 缚魂灯致知3：吸血率基础是 0.3，这里补 +0.2 抬到 0.5（上限另由 zhizhiValue 放到 100%）
    soul_lamp: { 3: { soul_lamp_vampire_rate: 0.2 } },
};

/** 图鉴标题用：致知一 / 致知二 / 致知三 */
export function zhizhiTierLabel(tier: ZhizhiTier): string {
    return `致知${ZHIZHI_TIER_LABELS[tier - 1]}`;
}

/** 登记齐了吗——测试用：返回缺少致知登记的可上场英雄 */
export function getHeroesWithoutZhizhi(): string[] {
    return AVAILABLE_HERO_IDS.filter(heroId => getZhizhi(heroId).length !== 3);
}
