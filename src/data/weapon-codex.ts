import { HERO_CODEX } from './hero-codex';

export type WeaponSystem = '武曲' | '天师' | '霸魁' | '素问' | '化识' | '通灵' | '科学家' | '神话';

export interface WeaponCodexEntry {
    /** 一器一主：武器 id 就是它主人的英雄模板 id，不再另起一套编号 */
    id: string;
    name: string;
    heroId: string;
    heroName: string;
    /** 体系与英雄职业同源，避免两处各写一份而慢慢对不上 */
    system: WeaponSystem;
    effects: string[];
    /** 效果是否已在战斗结算里实装；未实装的器在"武装"步骤里不可启用 */
    implemented: boolean;
}

/** 新英雄漏登武器时的占位器名：图鉴会直接显示，配套测试也会立刻报出来 */
export const UNNAMED_WEAPON = '未名之器';

interface WeaponDraft {
    name: string;
    /** 效果目前只是策划草案，不参与战斗结算；留空即在图鉴显示"效果待定" */
    effects?: string[];
    /** 已实装：战斗里真的会结算这些效果（首批 = 2026-10 设定案里写了效果的 15 口） */
    implemented?: boolean;
}

/**
 * 武器草案表（2026-10-01 对齐最新武器设定案）。键必须是英雄模板 id —— 英雄图鉴里出现的每
 * 一个人，这里都要有一口对应的器，否则武器图鉴就会和角色界面脱节。
 * 口径：设定案写了效果的以设定案为准；设定案留白的一律清空（图鉴显示"效果待定"），
 * 不再保留早期自拟的草案文案，免得被当成已定稿的规则。
 *
 * 设定案已定名、主人却尚未上线的器（角色实装后照抄进来即可）：
 * 武曲·魔「蚀月」、武曲·煞「血戾」、武曲·扶摇「垂天翼」、武曲·辞岁·晏无咎「赊年刀」、
 * 天师·雾里看花「雾隐纱」。
 */
const WEAPON_DRAFTS: Record<string, WeaponDraft> = {
    // ===== 武曲：锋刃破阵 =====
    moran: { name: '问道', implemented: true, effects: [
        '每次攻击都会永久增加 1 点技能伤害。',
        '特殊情况下额外出手时，技能伤害提升 20%。',
    ] },
    zhenxiao: { name: '惊雷碎岳', implemented: true, effects: [
        '反击伤害增加 2。',
        '吸血率增加 20%。',
    ] },
    huifeng: { name: '千锋尽', implemented: true, effects: [
        '连击次数增加 1。',
    ] },
    wukong: { name: '万仞', implemented: true, effects: [
        '初始暴击率增加 40%。',
    ] },
    mirror: { name: '破镜之刃', implemented: true, effects: [
        '每次「破镜之刃」触发时，额外对目标施加 1 层「碎镜」标记，持续 2 回合。',
        '带有「碎镜」标记的敌人受到「破镜之刃」伤害时，伤害提升 30%。',
    ] },
    skeletonking: { name: '冥王权杖', implemented: true, effects: [
        '始终拥有 1 层亡灵之力、1 层亡灵之魂与 1 层亡灵共鸣。',
    ] },
    jetzmi: { name: '双生之镰', implemented: true, effects: [
        '每次转化形态，恢复 5 点生命。',
    ] },
    mowen: { name: '溯光' },
    guying: { name: '寒渊', implemented: true, effects: [
        '主动使用：本次攻击额外施加 1 层寒天。',
        '整场战斗共有 2 次机会，且不可连续回合使用；冷却时间为 1 回合。',
    ] },
    libai: { name: '醉月', implemented: true, effects: [
        '每次攻击（造成伤害）有 25% 的概率增加 1 层「醉意」。',
    ] },
    zuizhendao: { name: '酒狂', implemented: true, effects: [
        '每次使用技能攻击到一名角色，有 20% 的概率增加 1 层「醉意」。',
        '一次攻击命中 3 名角色时，独立判定 3 次。',
    ] },
    feixue: { name: '霜碎' },
    yunying: { name: '赤霄', implemented: true, effects: [
        '「烈火燎原」每回合最多触发次数由 1 次提升至 2 次。',
    ] },
    jinghong: { name: '惊鸿照影' },
    huanongying: { name: '破月扇' },
    duosui: { name: '岁尽' },
    zhiyuan: { name: '牵丝引' },

    // ===== 天师：玄术通幽 =====
    xuanxiao: { name: '天机扇' },
    hanjiangxue: { name: '冰心' },
    pipa: { name: '五弦·谐鸣' },
    bounty: { name: '追命' },
    yinyang: { name: '两界符', implemented: true, effects: [
        '「阳线」与「阴线」的连接范围扩大为 3 格十字（原为 2 格十字），超出 3 格后失效。',
    ] },
    soul_lamp: { name: '幽明引' },
    dilan: { name: '青鸾羽' },
    dai: { name: '时之沙' },
    lingxi: { name: '汐音螺' },

    // ===== 武曲（文档把夜枭/风铃/游隼列在武曲组）：逐影猎心 =====
    nightowl: { name: '夜陨', implemented: true, effects: [
        '若某一回合没有发起攻击，暴击率增加 40%。',
        '触发暴击后，消除其中一半的暴击率加成。',
    ] },
    fengling: { name: '猎砂之爪', implemented: true, effects: [
        '登场时即初始化拥有 1 层「猎砂」。',
    ] },
    youjun: { name: '掠风翎' },
    jiangtaigong: { name: '飞熊竿' },

    // ===== 霸魁：重器镇岳 =====
    liuli: { name: '净琉璃', implemented: true, effects: [
        '每次援护友方时，有 50% 的概率额外获得 1 层「禅定」。',
    ] },
    hero_x: { name: '震怒' },
    chenyuan: { name: '镇岳' },
    xueqi: { name: '赤枷' },

    // ===== 素问：仁心济世 =====
    baize: { name: '天禄书' },
    xihuan: { name: '衔明环' },
    bard: { name: '交响诗篇' },
    xubai: { name: '澄心笺' },
    wangshu: { name: '朔望仪' },

    // ===== 化识：万象化形 =====
    zhiguang: { name: '虹棱' },
    changli: { name: '不灭星火' },
    wither_lord: { name: '万物凋零' },
    t_painting: { name: '日月帛' },
    feynman: { name: '粒子对撞机' },
    nanfeng: { name: '熏风笛' },
    shangguan: { name: '飞白' },
    lilith: { name: '梦魇之弦' },

    // ===== 通灵：灵契共鸣 =====
    wangcai: { name: '聚宝盆' },
    jinghua: { name: '水月鉴' },

    // ===== 科学家：格物穷理（角色暂时下架，器名先留着待回归） =====
    schrodinger: { name: '坍缩之眼' },
};

/** 这把专属器是否已在战斗结算里实装（未实装的在"武装"步骤里点不动） */
export function isWeaponImplemented(templateId: string): boolean {
    return WEAPON_DRAFTS[templateId]?.implemented === true;
}

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
        implemented: draft?.implemented ?? false,
    };
});

export const WEAPON_SYSTEMS: WeaponSystem[] = [
    '武曲', '天师', '霸魁', '素问', '化识', '通灵', '科学家', '神话',
];
