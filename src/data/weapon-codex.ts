import { HERO_CODEX } from './hero-codex';

export type WeaponSystem = '武曲' | '天师' | '猎户' | '霸魁' | '素问' | '化识' | '通灵' | '科学家' | '神话';

export interface WeaponCodexEntry {
    /** 一器一主：武器 id 就是它主人的英雄模板 id，不再另起一套编号 */
    id: string;
    name: string;
    heroId: string;
    heroName: string;
    /** 体系与英雄职业同源，避免两处各写一份而慢慢对不上 */
    system: WeaponSystem;
    effects: string[];
}

/** 新英雄漏登武器时的占位器名：图鉴会直接显示，配套测试也会立刻报出来 */
export const UNNAMED_WEAPON = '未名之器';

interface WeaponDraft {
    name: string;
    /** 效果目前只是策划草案，不参与战斗结算；留空即在图鉴显示"效果待定" */
    effects?: string[];
}

/**
 * 武器草案表。键必须是英雄模板 id —— 英雄图鉴里出现的每一个人，
 * 这里都要有一口对应的器，否则武器图鉴就会和角色界面脱节。
 */
const WEAPON_DRAFTS: Record<string, WeaponDraft> = {
    // ===== 武曲：锋刃破阵 =====
    moran: { name: '问道', effects: [
        '每次攻击都会永久增加 1 点技能伤害。',
        '特殊情况下额外出手时，技能伤害提升 20%。',
    ] },
    zhenxiao: { name: '惊雷碎岳' },
    huifeng: { name: '千锋尽' },
    wukong: { name: '万仞', effects: ['初始暴击率增加 40%。'] },
    mirror: { name: '破镜之刃', effects: [
        '每次「破镜之刃」触发时，额外对目标施加 1 层「碎镜」标记，持续 2 回合。',
        '带有「碎镜」标记的敌人受到「破镜之刃」伤害时，伤害提升 30%。',
    ] },
    skeletonking: { name: '冥王权杖', effects: [
        '始终拥有 1 层亡灵之力、1 层亡灵之魂与 1 层亡灵共鸣。',
    ] },
    jetzmi: { name: '双生之镰' },
    nightowl: { name: '夜陨' },
    mowen: { name: '溯光' },
    guying: { name: '寒渊', effects: [
        '主动使用：本次攻击额外施加 1 层寒天。',
        '整场战斗共有 2 次机会，且不可连续回合使用；冷却时间为 1 回合。',
    ] },
    libai: { name: '醉月' },
    zuizhendao: { name: '酒狂' },
    feixue: { name: '霜碎', effects: [
        '击碎「冰冻」目标时，额外对目标造成其最大生命值 20% 的真实伤害。',
    ] },
    yunying: { name: '燎原缨' },
    jinghong: { name: '横江苇' },
    huanongying: { name: '弄影簪' },

    // ===== 天师：玄术通幽 =====
    xuanxiao: { name: '天机扇', effects: [
        '技能二令友方立即出手时，额外为目标恢复其已损生命值的 15%。',
        '「化险为夷」触发时，转化值额外提升 1 倍。',
    ] },
    pipa: { name: '五弦·谐鸣', effects: [
        '「音符」的附加伤害提升为基础攻击力的 35%。',
        '每消耗 1 层「和弦」，为自身恢复 3 点生命。',
    ] },
    bounty: { name: '追命', effects: [
        '追击伤害 +2。',
        '释放赏金时，若触发「回复已损生命值 50%」效果，额外恢复已损生命值的 15%。',
    ] },
    yinyang: { name: '两界符', effects: [
        '「阳线」与「阴线」的初始效果提升至 25%。',
        '连接范围扩大为 3 格，超出 3 格后失效。',
    ] },
    soul_lamp: { name: '幽明引', effects: [
        '自身每次死亡时，额外为一名随机友方增加 15% 吸血，可叠加至被动上限。',
        '「暗夜法阵」持续回合数 +1。',
    ] },
    dilan: { name: '引羽签' },
    dai: { name: '时之沙', effects: [
        '「时空回溯」可额外选择 1 个目标，即同时回溯 2 个单位。',
        '技能二冷却时间 -1 回合，变为 0 回合冷却。',
    ] },
    lingxi: { name: '听潮螺' },

    // ===== 猎户：逐影猎心 =====
    fengling: { name: '猎砂之爪' },
    youjun: { name: '穿云哨' },

    // ===== 霸魁：重器镇岳 =====
    liuli: { name: '净琉璃', effects: [
        '每次援护友方时，额外获得 1 层「禅定」。',
        '「禅定」层数上限 +3。',
    ] },
    hero_x: { name: '震怒', effects: [
        '「震怒」达到 2 层即可触发眩晕，原为 3 层。',
        '「增势」每 2 层即可触发免伤，原为 3 层。',
    ] },
    chenyuan: { name: '镇岳', effects: [
        '拖拽距离 +1 格，提升至 4 格。',
        '「极寒领域」范围扩大为周围 2 格。',
    ] },
    xueqi: { name: '朱砂契' },

    // ===== 素问：仁心济世 =====
    baize: { name: '天禄书', effects: [
        '每回合开始，额外为 1 名随机友方增加 1 点「白泽之力」。',
        '「天禄」达到 2 层即可消耗并触发复活效果，原为 3 层。',
    ] },
    bard: { name: '交响诗篇', effects: [
        '「和声」的每次攻击恢复量 +2。',
        '技能二每消耗 1 层「激情」，额外恢复 2 点生命。',
    ] },
    xubai: { name: '两仪珠' },

    // ===== 化识：万象化形 =====
    changli: { name: '不灭星火', effects: [
        '每次复活时，额外获得 2 层「暗夜星火」。',
        '最大复活次数 +1，提升至 5 次。',
    ] },
    wither_lord: { name: '万物凋零', effects: [
        '「凋零」结算伤害时，每层额外造成目标最大生命值 1% 的伤害。',
        '每拥有一条额外生命，技能伤害 +2。',
    ] },
    t_painting: { name: '日月帛', effects: [
        '召唤物死亡时，自身不再损失生命值。',
        '场上每有 1 个召唤物，所有召唤物伤害 +2。',
    ] },
    feynman: { name: '粒子对撞机', effects: [
        '「粒子标记」持续时间 +1 回合。',
        '每有 1 点「能量」，技能基础伤害 +1。',
    ] },
    hanjiangxue: { name: '冰心', effects: [
        '「冰甲」的减伤效果提升至 30%。',
        '「冰晶」存在时间 +1 回合。',
    ] },
    lilith: { name: '梦魇之弦', effects: [
        '「恐惧」状态下无法行动的概率提升至 35%。',
        '每有 1 点「恐惧情绪能量」，所有技能伤害 +1。',
    ] },
    nanfeng: { name: '九万里' },
    shangguan: { name: '落纸云' },

    // ===== 通灵：灵契共鸣 =====
    wangcai: { name: '聚宝盆', effects: [
        '每消耗 1 层「财气」，永久增加 1 点基础攻击力。',
        '通灵所需「财气」层数 -1，变为 6 层。',
    ] },
    jinghua: { name: '照水镜' },

    // ===== 科学家：格物穷理 =====
    schrodinger: { name: '坍缩之眼', effects: [
        '「叠加态攻击」的命中概率提升至 65%。',
        '「纠缠状态」的伤害传导比例提升至 65%。',
    ] },
};

/**
 * 武器图鉴由英雄图鉴派生：一个英雄一口器，顺序、职业配色都跟着英雄走。
 * 这样新增英雄时只要往草案表里补一口器名，两个界面就不会再各说各话。
 */
export const WEAPON_CODEX: WeaponCodexEntry[] = HERO_CODEX.map(hero => {
    const draft = WEAPON_DRAFTS[hero.id];
    return {
        id: hero.id,
        name: draft?.name ?? UNNAMED_WEAPON,
        heroId: hero.id,
        heroName: hero.name,
        system: hero.class as WeaponSystem,
        effects: draft?.effects ?? [],
    };
});

export const WEAPON_SYSTEMS: WeaponSystem[] = [
    '武曲', '天师', '猎户', '霸魁', '素问', '化识', '通灵', '科学家', '神话',
];
