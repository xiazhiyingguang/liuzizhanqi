export type WeaponSystem = '武曲' | '天师' | '猎户' | '霸魁' | '素问' | '化识' | '通灵' | '科学家' | '神话';

export interface WeaponCodexEntry {
    id: string;
    name: string;
    heroId?: string;
    heroName: string;
    system: WeaponSystem;
    effects: string[];
}

function weapon(
    id: string,
    name: string,
    heroName: string,
    system: WeaponSystem,
    heroId?: string,
    effects: string[] = []
): WeaponCodexEntry {
    return { id, name, heroName, system, heroId, effects };
}

/**
 * 武器效果目前仅作为策划草案展示，不参与战斗结算。
 * 无效果文本的条目会在图鉴中显示为“效果待定”。
 */
export const WEAPON_CODEX: WeaponCodexEntry[] = [
    weapon('wendao', '问道', '墨阑', '武曲', 'moran', [
        '每次攻击都会永久增加 1 点技能伤害。',
        '特殊情况下额外出手时，技能伤害提升 20%。',
    ]),
    weapon('jinglei-suiyue', '惊雷碎岳', '震霄', '武曲', 'zhenxiao'),
    weapon('qianfeng-jin', '千锋尽', '回锋', '武曲', 'huifeng'),
    weapon('wanren', '万仞', '孙悟空', '武曲', 'wukong', ['初始暴击率增加 40%。']),
    weapon('pojing-zhi-ren', '破镜之刃', '镜', '武曲', 'mirror', [
        '每次「破镜之刃」触发时，额外对目标施加 1 层「碎镜」标记，持续 2 回合。',
        '带有「碎镜」标记的敌人受到「破镜之刃」伤害时，伤害提升 30%。',
    ]),
    weapon('mingwang-quanzhang', '冥王权杖', '骸骨君王·厄瑞波斯', '武曲', 'skeletonking', [
        '始终拥有 1 层亡灵之力、1 层亡灵之魂与 1 层亡灵共鸣。',
    ]),
    weapon('shuangsheng-zhilian', '双生之镰', '亡灵城主·杰茨米', '武曲', 'jetzmi'),
    weapon('yeyun', '夜陨', '暗影猎手·夜枭', '武曲', 'nightowl'),
    weapon('suguang', '溯光', '时光剑客·莫问', '武曲', 'mowen'),
    weapon('yueliushuang', '月流霜', '露娜', '武曲', 'luna'),
    weapon('hanyuan', '寒渊', '孤影', '武曲', 'guying', [
        '主动使用：本次攻击额外施加 1 层寒天。',
        '整场战斗共有 2 次机会，且不可连续回合使用；冷却时间为 1 回合。',
    ]),
    weapon('liangyi', '两仪', '曜斩', '武曲', 'yaozhan'),
    weapon('zuiyue', '醉月', '李太白', '武曲', 'libai'),
    weapon('jiukuang', '酒狂', '醉枕刀', '武曲', 'zuizhendao'),
    weapon('shuangsui', '霜碎', '绯雪', '武曲', 'feixue', [
        '击碎「冰冻」目标时，额外对目标造成其最大生命值 20% 的真实伤害。',
    ]),

    // 风铃当前在英雄实现中属于猎户；其武器效果尚未给出。
    weapon('liesha-zhizhao', '猎砂之爪', '风铃', '猎户', 'fengling'),

    weapon('tianji-shan', '天机扇', '玄霄', '天师', 'xuanxiao', [
        '技能二令友方立即出手时，额外为目标恢复其已损生命值的 15%。',
        '「化险为夷」触发时，转化值额外提升 1 倍。',
    ]),
    weapon('wuxian-xieming', '五弦·谐鸣', '五弦琵琶', '天师', 'pipa', [
        '「音符」的附加伤害提升为基础攻击力的 35%。',
        '每消耗 1 层「和弦」，为自身恢复 3 点生命。',
    ]),
    weapon('zhuiming', '追命', '赏金猎人', '天师', 'bounty', [
        '追击伤害 +2。',
        '释放赏金时，若触发「回复已损生命值 50%」效果，额外恢复已损生命值的 15%。',
    ]),
    weapon('liangjie-fu', '两界符', '阴阳师', '天师', 'yinyang', [
        '「阳线」与「阴线」的初始效果提升至 25%。',
        '连接范围扩大为 3 格，超出 3 格后失效。',
    ]),
    weapon('youming-yin', '幽明引', '缚魂灯', '天师', 'soul_lamp', [
        '自身每次死亡时，额外为一名随机友方增加 15% 吸血，可叠加至被动上限。',
        '「暗夜法阵」持续回合数 +1。',
    ]),

    weapon('jingliuli', '净琉璃', '琉璃', '霸魁', 'liuli', [
        '每次援护友方时，额外获得 1 层「禅定」。',
        '「禅定」层数上限 +3。',
    ]),
    weapon('zhennu', '震怒', '英雄X', '霸魁', 'hero_x', [
        '「震怒」达到 2 层即可触发眩晕，原为 3 层。',
        '「增势」每 2 层即可触发免伤，原为 3 层。',
    ]),
    weapon('zhenyue', '镇岳', '沉渊·镇岳', '霸魁', 'zhenyue', [
        '拖拽距离 +1 格，提升至 4 格。',
        '「极寒领域」范围扩大为周围 2 格。',
    ]),

    weapon('tianlu-shu', '天禄书', '白泽', '素问', 'baize', [
        '每回合开始，额外为 1 名随机友方增加 1 点「白泽之力」。',
        '「天禄」达到 2 层即可消耗并触发复活效果，原为 3 层。',
    ]),
    weapon('jiaoxiang-shipian', '交响诗篇', '吟游诗人', '素问', 'bard', [
        '「和声」的每次攻击恢复量 +2。',
        '技能二每消耗 1 层「激情」，额外恢复 2 点生命。',
    ]),

    weapon('bumie-xinghuo', '不灭星火', '长离', '化识', 'changli', [
        '每次复活时，额外获得 2 层「暗夜星火」。',
        '最大复活次数 +1，提升至 5 次。',
    ]),
    weapon('wanwu-diaoling', '万物凋零', '凋零之主', '化识', 'wither_lord', [
        '「凋零」结算伤害时，每层额外造成目标最大生命值 1% 的伤害。',
        '每拥有一条额外生命，技能伤害 +2。',
    ]),
    weapon('riyue-bo', '日月帛', 'T型帛画', '化识', 't_painting', [
        '召唤物死亡时，自身不再损失生命值。',
        '场上每有 1 个召唤物，所有召唤物伤害 +2。',
    ]),
    weapon('shizhi-sha', '时之沙', '时空旅者·戴尔', '化识', 'daier', [
        '「时空回溯」可额外选择 1 个目标，即同时回溯 2 个单位。',
        '技能二冷却时间 -1 回合，变为 0 回合冷却。',
    ]),
    weapon('lizi-duizhuangji', '粒子对撞机', '粒子加速者·费曼', '化识', 'feynman', [
        '「粒子标记」持续时间 +1 回合。',
        '每有 1 点「能量」，技能基础伤害 +1。',
    ]),
    weapon('bingxin', '冰心', '寒江雪', '化识', 'hanjiangxue', [
        '「冰甲」的减伤效果提升至 30%。',
        '「冰晶」存在时间 +1 回合。',
    ]),
    weapon('mengyan-zhixian', '梦魇之弦', '恐惧编织者·莉莉丝', '化识', 'lilith', [
        '「恐惧」状态下无法行动的概率提升至 35%。',
        '每有 1 点「恐惧情绪能量」，所有技能伤害 +1。',
    ]),

    weapon('jubaopen', '聚宝盆', '旺财', '通灵', 'wangcai', [
        '每消耗 1 层「财气」，永久增加 1 点基础攻击力。',
        '通灵所需「财气」层数 -1，变为 6 层。',
    ]),
    weapon('fengyan-ling', '凤炎翎', '涅槃·凤', '通灵', undefined, [
        '每次对敌人施加「灼烧」时，额外获得 1 层「灰烬」。',
        '通灵变身后，每回合结束时自动获得 1 层「灰烬」。',
    ]),

    weapon('tansuozhi-yan', '坍缩之眼', '量子观测者·薛定谔', '科学家', 'schrodinger', [
        '「叠加态攻击」的命中概率提升至 65%。',
        '「纠缠状态」的伤害传导比例提升至 65%。',
    ]),

    weapon('xinggui-yi', '星轨仪', '星象师·诺亚', '神话', undefined, [
        '「星辰」持续时间 +1 回合。',
        '每有 3 点「星力」即可额外放置一颗「星辰」，原为 4 点；致知后变为 2 点。',
    ]),
    weapon('rimian', '日冕', '太阳骑士·赫利俄斯', '神话', undefined, [
        '处于「日星辰」范围内时，技能伤害额外 +25%。',
        '「光明之力」提供的护盾值 +2。',
    ]),
];

export const WEAPON_SYSTEMS: WeaponSystem[] = [
    '武曲', '天师', '猎户', '霸魁', '素问', '化识', '通灵', '科学家', '神话',
];

