import { EffectManager } from '../core/effect-manager';
import { MovementSystem } from '../core/movement-system';
import {
    BoardEffect,
    GameState,
    Hero,
    HeroClass,
    HeroState,
    Player,
    Position,
    TianweiSkill,
} from '../types/game';

export type ExtendedHeroTemplate = {
    name: string;
    class: HeroClass;
    maxHp: number;
    moveRange: number;
    baseAttack?: number;
    skill1Id: string;
    skill2Id: string;
    passiveId: string;
    tianweiId?: string;
};

export const EXTENDED_HERO_IDS = [
    'skeletonking',
    'jetzmi',
    'pipa',
    'bounty',
    'yinyang',
    'soul_lamp',
    'hero_x',
    'bard',
    'wither_lord',
    't_painting',
    'feynman',
    'wangcai',
    'schrodinger',
    'lilith',
    'libai',
    'zuizhendao',
    'feixue',
    'fengling',
    'dilan',
    'nanfeng',
    'shangguan',
    'chenyuan',
    'dai',
    'youjun',
    'xubai',
    'lingxi',
    'xueqi',
    'yunying',
    'jinghong',
    'jinghua',
] as const;

export const EXTENDED_HERO_TEMPLATES: Record<string, ExtendedHeroTemplate> = {
    skeletonking: {
        name: '骸骨君王·厄瑞波斯',
        class: '武曲',
        maxHp: 48,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'skeletonking_skill1',
        skill2Id: 'skeletonking_skill2',
        passiveId: 'skeletonking_passive',
        tianweiId: 'skeletonking_tianwei',
    },
    jetzmi: {
        name: '亡灵城主·杰茨米',
        class: '武曲',
        maxHp: 45,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'jetzmi_skill1',
        skill2Id: 'jetzmi_skill2',
        passiveId: 'jetzmi_passive',
        tianweiId: 'jetzmi_tianwei',
    },
    pipa: {
        name: '五弦琵琶',
        class: '天师',
        maxHp: 45,
        moveRange: 3,
        baseAttack: 8,
        skill1Id: 'pipa_skill1',
        skill2Id: 'pipa_skill2',
        passiveId: 'pipa_passive',
        tianweiId: 'pipa_tianwei',
    },
    bounty: {
        name: '赏金猎人',
        class: '天师',
        maxHp: 42,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'bounty_skill1',
        skill2Id: 'bounty_skill2',
        passiveId: 'bounty_passive',
        tianweiId: 'bounty_tianwei',
    },
    yinyang: {
        name: '阴阳师',
        class: '天师',
        maxHp: 45,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'yinyang_skill1',
        skill2Id: 'yinyang_skill2',
        passiveId: 'yinyang_passive',
        tianweiId: 'yinyang_tianwei',
    },
    soul_lamp: {
        name: '缚魂灯',
        class: '天师',
        maxHp: 50,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'soul_lamp_skill1',
        skill2Id: 'soul_lamp_skill2',
        passiveId: 'soul_lamp_passive',
    },
    hero_x: {
        name: '英雄X',
        class: '霸魁',
        maxHp: 54,
        moveRange: 1,
        baseAttack: 0,
        skill1Id: 'hero_x_skill1',
        skill2Id: 'hero_x_skill2',
        passiveId: 'hero_x_passive',
    },
    bard: {
        name: '吟游诗人',
        class: '素问',
        maxHp: 55,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'bard_skill1',
        skill2Id: 'bard_skill2',
        passiveId: 'bard_passive',
    },
    wither_lord: {
        name: '凋零之主',
        class: '化识',
        maxHp: 20,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'wither_lord_skill1',
        skill2Id: 'wither_lord_skill2',
        passiveId: 'wither_lord_passive',
        tianweiId: 'wither_lord_tianwei',
    },
    t_painting: {
        name: 'T型帛画',
        class: '化识',
        maxHp: 45,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 't_painting_skill1',
        skill2Id: 't_painting_skill2',
        passiveId: 't_painting_passive',
        tianweiId: 't_painting_tianwei',
    },
    feynman: {
        name: '粒子加速者·费曼',
        class: '化识',
        maxHp: 40,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'feynman_skill1',
        skill2Id: 'feynman_skill2',
        passiveId: 'feynman_passive',
        tianweiId: 'feynman_tianwei',
    },
    wangcai: {
        name: '旺财',
        class: '通灵',
        maxHp: 42,
        moveRange: 2,
        baseAttack: 4,
        skill1Id: 'wangcai_skill1',
        skill2Id: 'wangcai_skill2',
        passiveId: 'wangcai_passive',
        tianweiId: 'wangcai_tianwei',
    },
    schrodinger: {
        name: '量子观测者·薛定谔',
        class: '化识',
        maxHp: 43,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'schrodinger_skill1',
        skill2Id: 'schrodinger_skill2',
        passiveId: 'schrodinger_passive',
        tianweiId: 'schrodinger_tianwei',
    },
    lilith: {
        name: '恐惧编织者·莉莉丝',
        class: '猎户',
        maxHp: 38,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'lilith_skill1',
        skill2Id: 'lilith_skill2',
        passiveId: 'lilith_passive',
        tianweiId: 'lilith_tianwei',
    },
    libai: {
        name: '李太白',
        class: '武曲',
        maxHp: 40,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'libai_skill1',
        skill2Id: 'libai_skill2',
        passiveId: 'libai_passive',
        tianweiId: 'libai_tianwei',
    },
    zuizhendao: {
        name: '醉枕刀',
        class: '武曲',
        maxHp: 46,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'zuizhendao_skill1',
        skill2Id: 'zuizhendao_skill2',
        passiveId: 'zuizhendao_passive',
        tianweiId: 'zuizhendao_tianwei',
    },
    feixue: {
        name: '绯雪',
        class: '武曲',
        maxHp: 45,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'feixue_skill1',
        skill2Id: 'feixue_skill2',
        passiveId: 'feixue_passive',
        tianweiId: 'feixue_tianwei',
    },
    fengling: {
        name: '风铃',
        class: '猎户',
        maxHp: 45,
        moveRange: 2,
        baseAttack: 8,
        skill1Id: 'fengling_skill1',
        skill2Id: 'fengling_skill2',
        passiveId: 'fengling_passive',
        tianweiId: 'fengling_tianwei',
    },
    dilan: {
        name: '帝兰',
        class: '天师',
        maxHp: 48,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'dilan_skill1',
        skill2Id: 'dilan_skill2',
        passiveId: 'dilan_passive',
        tianweiId: 'dilan_tianwei',
    },
    nanfeng: {
        name: '南风',
        class: '化识',
        maxHp: 48,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'nanfeng_skill1',
        skill2Id: 'nanfeng_skill2',
        passiveId: 'nanfeng_passive',
        tianweiId: 'nanfeng_tianwei',
    },
    shangguan: {
        name: '上官婉儿',
        class: '化识',
        maxHp: 42,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'shangguan_skill1',
        skill2Id: 'shangguan_skill2',
        passiveId: 'shangguan_passive',
        // 天威暂未设计，留空
    },
    youjun: {
        name: '游隼',
        class: '猎户',
        maxHp: 44,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'youjun_skill1',
        skill2Id: 'youjun_skill2',
        passiveId: 'youjun_passive',
        // 天威：无
    },
    chenyuan: {
        name: '沉渊·镇岳',
        class: '霸魁',
        maxHp: 60,
        moveRange: 1,
        baseAttack: 0,
        skill1Id: 'chenyuan_skill1',
        skill2Id: 'chenyuan_skill2',
        passiveId: 'chenyuan_passive',
        tianweiId: 'chenyuan_tianwei',
    },
    dai: {
        name: '时空旅者·戴尔',
        class: '天师',
        maxHp: 45,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'dai_skill1',
        skill2Id: 'dai_skill2',
        passiveId: 'dai_passive',
        // 天威：无
    },
    xubai: {
        name: '叙白',
        class: '素问',
        maxHp: 55,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'xubai_skill1',
        skill2Id: 'xubai_skill2',
        passiveId: 'xubai_passive',
        // 天威：无
    },
    lingxi: {
        name: '泠汐',
        class: '天师',
        maxHp: 46,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'lingxi_skill1',
        skill2Id: 'lingxi_skill2',
        passiveId: 'lingxi_passive',
        tianweiId: 'lingxi_tianwei',
    },
    xueqi: {
        name: '血契',
        class: '霸魁',
        maxHp: 58,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'xueqi_skill1',
        skill2Id: 'xueqi_skill2',
        passiveId: 'xueqi_passive',
        tianweiId: 'xueqi_tianwei',
    },
    yunying: {
        name: '云缨',
        class: '武曲',
        maxHp: 45,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'yunying_skill1',
        skill2Id: 'yunying_skill2',
        passiveId: 'yunying_passive',
    },
    jinghong: {
        name: '惊鸿·止水',
        class: '武曲',
        maxHp: 48,
        moveRange: 2,
        baseAttack: 0,
        skill1Id: 'jinghong_skill1',
        skill2Id: 'jinghong_skill2',
        passiveId: 'jinghong_passive',
        // 天威暂未设计，留空
    },
    jinghua: {
        name: '镜花·水月',
        class: '通灵',
        maxHp: 48,
        moveRange: 3,
        baseAttack: 0,
        skill1Id: 'jinghua_skill1',
        skill2Id: 'jinghua_skill2',
        passiveId: 'jinghua_passive',
        tianweiId: 'jinghua_tianwei',
    },
};

export const EXTENDED_HERO_INFO: Record<string, { name: string; class: string; description: string }> = {
    skeletonking: { name: '骸骨君王·厄瑞波斯', class: '武曲', description: '死亡计数、护盾与复活。生命48，移动力2' },
    jetzmi: { name: '亡灵城主·杰茨米', class: '武曲', description: '暂时死亡切换形态。生命45，移动力2' },
    pipa: { name: '五弦琵琶', class: '天师', description: '音符追击与和弦爆发。生命45，移动力3' },
    bounty: { name: '赏金猎人', class: '天师', description: '猎杀令集火与悬赏奖励。生命42，移动力2' },
    yinyang: { name: '阴阳师', class: '天师', description: '阳线强化、阴线削弱。生命45，移动力3' },
    soul_lamp: { name: '缚魂灯', class: '天师', description: '法阵与死亡辅助。生命50，移动力2' },
    hero_x: { name: '英雄X', class: '霸魁', description: '震怒控制与增势援护。生命54，移动力1' },
    bard: { name: '吟游诗人', class: '素问', description: '和声、激情与群体恢复。生命55，移动力3' },
    wither_lord: { name: '凋零之主', class: '化识', description: '凋零层数与多条生命。生命20，移动力2' },
    t_painting: { name: 'T型帛画', class: '化识', description: '召唤金乌与玄龟。生命45，移动力2' },
    feynman: { name: '粒子加速者·费曼', class: '化识', description: '粒子标记与范围爆发。生命40，移动力2' },
    wangcai: { name: '旺财', class: '通灵', description: '财气积累并通灵财神。生命42，移动力2' },
    schrodinger: { name: '量子观测者·薛定谔', class: '化识', description: '概率坍缩与量子纠缠。生命43，移动力2' },
    lilith: { name: '恐惧编织者·莉莉丝', class: '猎户', description: '恐惧控制与情绪能量。生命38，移动力3' },
    libai: { name: '李太白', class: '武曲', description: '醉意累积与脚印瞬移连击。生命40，移动力2' },
    zuizhendao: { name: '醉枕刀', class: '武曲', description: '醉掷寒锋穿敌、醉影换位与醉意闪避反击。生命46，移动力2' },
    feixue: { name: '绯雪', class: '武曲', description: '破冰爆发、寒天收割与击杀追猎。生命45，移动力2' },
    fengling: { name: '风铃', class: '猎户', description: '强制锁敌、沙丘伏击与单体猎杀。生命45，移动力2' },
    dilan: { name: '帝兰', class: '天师', description: '操纵顺逆风、击退与羽化移动伤害。生命48，移动力3' },
    nanfeng: { name: '南风', class: '化识', description: '旋风吹散敌人、铺设风道让友方免费滑行并强化自身闪避。生命48，移动力3' },
    shangguan: { name: '上官婉儿', class: '化识', description: '毛笔落子、多段笔走龙蛇与墨意闪避。生命42，移动力3' },
    youjun: { name: '游隼', class: '猎户', description: '路径冲刺、爆发伤害的猎手。借风道延展冲刺并沿直线穿透敌阵，在周身四格布下风刃陷阱，收回风刃可刷新疾掠再冲锋。生命44，移动力3' },
    chenyuan: { name: '沉渊·镇岳', class: '霸魁', description: '极寒领域、拖拽控场与援护承伤。生命60，移动力1' },
    dai: { name: '时空旅者·戴尔', class: '天师', description: '时空回溯复活与状态还原、时空置换换位换血。生命45，移动力3' },
    xubai: { name: '叙白', class: '素问', description: '单体净化治疗，黑白球在队友残血时自动回血，首次登场抚育周围友军。生命55，移动力2' },
    lingxi: { name: '泠汐', class: '天师', description: '多段潮汐攻击：本回合命中留下延迟段，下一回合自动补击并叠加潮汐，攻防兼备。生命46，移动力2' },
    xueqi: { name: '血契', class: '霸魁', description: '周身血誓横扫、以血还血，强锁敌人钉在身边替全队挨打。生命58，移动力2' },
    yunying: { name: '云缨', class: '武曲', description: '攻击为敌人叠祥瑞，满3层引燃烈火燎原；范围星火按敌人已有祥瑞增伤，长驱一记为下一次攻击附加吸血。生命45，移动力2' },
    jinghong: { name: '惊鸿·止水', class: '武曲', description: '掠水一击后落到敌人身后并攒惊鸿；消耗全部惊鸿蓄力止水，下一回合放弃移动换来决渊外环爆发。满血时更锋利，残血时更硬。生命48，移动力2' },
    jinghua: { name: '镜花·水月', class: '通灵', description: '与友方换位并在水月格留影，被换上的队友落地即得5点护盾，此后友方可反复踏月换影；每次交换为镜花叠一层镜影（攻防提升，上限5层）。必要时把镜影印给候补替身登场、自己退坐月座，有人踏月即归场、替身退回候补席。登场刹那天威照向最近的敌人。生命48，移动力3' },
};

export function initializeExtendedHero(hero: Hero): void {
    switch (hero.passiveId) {
        case 'jetzmi_passive':
            hero.counters['jetzmi_form'] = 0;
            hero.counters['jetzmi_vampire_rate'] = 0.5;
            break;
        case 'pipa_passive':
            hero.counters['和弦'] = 0;
            break;
        case 'yinyang_passive':
            hero.counters['yinyang_yang_rate'] = 0.2;
            hero.counters['yinyang_yin_rate'] = 0.2;
            hero.counters['yinyang_yang_repeat'] = 0.2;
            hero.counters['yinyang_yin_repeat'] = 0.2;
            break;
        case 'soul_lamp_passive':
            hero.counters['soul_lamp_vampire_rate'] = 0.3;
            break;
        case 'hero_x_passive':
            hero.counters['增势'] = 0;
            break;
        case 'wither_lord_passive':
            hero.counters['wither_lives'] = 2;
            hero.counters['wither_applied_total'] = 0;
            hero.counters['wither_skill2_death_chance'] = 0.25;
            break;
        case 'feynman_passive':
            hero.counters['能量'] = 0;
            break;
        case 'wangcai_passive':
            hero.counters['财气'] = 0;
            hero.counters['wangcai_transformed'] = 0;
            break;
        case 'schrodinger_passive':
            hero.counters['schrodinger_extra_used'] = 0;
            break;
        case 'lilith_passive':
            hero.counters['恐惧情绪能量'] = 0;
            break;
        case 'libai_passive':
            hero.counters['醉意'] = 0;
            break;
        case 'zuizhendao_passive':
            hero.counters['醉意'] = 0;
            break;
        case 'fengling_passive':
            hero.counters['猎砂'] = 0;
            hero.counters['沙丘闪避'] = 0;
            break;
        case 'shangguan_passive':
            hero.counters['墨意'] = 0;
            hero.counters['闪避'] = 0;
            break;
        case 'youjun_passive':
            hero.counters['youjun_lastMove'] = 0;
            hero.counters['youjun_moved_path'] = 0;
            hero.counters['youjun_blade_refresh_used'] = 0;
            break;
        case 'xubai_passive':
            hero.counters['黑白球'] = 0;
            break;
        case 'lingxi_passive':
            hero.counters['lingxi_echo1_round'] = 0;   // 技能1延迟段：武装于哪一轮
            hero.counters['lingxi_echo2_round'] = 0;   // 技能2延迟段
            hero.counters['lingxi_echo2_dir'] = -1;
            hero.counters['lingxi_assist_pending'] = 0; // 被动：待发放的助力层数
            break;
        case 'yunying_passive':
            // 烈火燎原的引燃额度按轮记账（等于 roundNumber 即本回合已用过）
            hero.counters['liehuo_round'] = -1;
            break;
        case 'jinghong_passive':
            hero.counters['惊鸿'] = 0;              // 资源层数，上限 JINGHONG_MAX
            hero.counters['jinghong_charge_round'] = -1; // 蓄力起始回合，-1 表示未在蓄力
            hero.counters['jinghong_charge_stacks'] = 0; // 蓄力时锁定的惊鸿层数（加成与回血都读它）
            break;
        case 'jinghua_passive':
            hero.counters['镜影'] = 0;                 // 被动叠层，上限 JINGHUA_STACK_MAX
            hero.counters['__jinghua_offboard'] = 0;   // 1=退入月座下场中
            hero.counters['__jinghua_return_hp'] = hero.currentHp;
            break;
    }
}

/** 「镜影」层数上限：每层 +10% 闪避与增伤，交换位置即叠一层 */
export const JINGHUA_STACK_MAX = 5;

/** 读取镜花·水月的镜影层数（夹到上限，防历史脏数据） */
export function getJinghuaStacks(hero: Hero): number {
    return Math.min(JINGHUA_STACK_MAX, hero.counters['镜影'] ?? 0);
}

/** 找某方的镜花·水月本体（无论在场与否） */
export function findJinghua(gameState: GameState, owner: Player): Hero | null {
    const pool = owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    return pool.find(hero => hero.passiveId === 'jinghua_passive') ?? null;
}

/** 某方当前有效的「水月」标记（镜像交换点） */
export function findWaterMoon(gameState: GameState, owner: Player) {
    return (gameState.boardEffects ?? []).find(
        effect => effect.type === 'water-moon' && effect.owner === owner
    ) ?? null;
}

/** 某方当前有效的「月座」（等待镜花归场的落点） */
export function findMoonSeat(gameState: GameState, owner: Player) {
    return (gameState.boardEffects ?? []).find(
        effect => effect.type === 'moon-seat' && effect.owner === owner
    ) ?? null;
}

/** 镜花是否正退入月座、等待归场 */
export function isJinghuaOffboard(hero: Hero): boolean {
    return (hero.counters['__jinghua_offboard'] ?? 0) === 1;
}

/** 「惊鸿」层数上限：技能1 的所有获取途径都受此约束 */
export const JINGHONG_MAX = 3;

/** 本回合是否正处于「止水」蓄力回合（第一段刚放出去，整回合结束时结算回血） */
export function isJinghongCharging(hero: Hero, gameState: GameState): boolean {
    const charged = hero.counters['jinghong_charge_round'] ?? -1;
    return charged >= 0 && charged === gameState.roundNumber;
}

/**
 * 本回合是否是「决渊」第二段的释放窗口（蓄力的下一回合）。
 * 窗口内禁止移动，只能主动放出第二段；错过即消散，惊鸿不返还。
 */
export function isJinghongReleaseWindow(hero: Hero, gameState: GameState): boolean {
    const charged = hero.counters['jinghong_charge_round'] ?? -1;
    return charged >= 0 && gameState.roundNumber === charged + 1;
}

/**
 * 「决渊」的落点环：以自身为中心的 5×5 去掉身周 3×3，即最外一圈 16 格。
 * 顺序刻意按**屏幕顺时针**给出（左上角起 → 上边向右 → 右边向下 → 下边向左 → 左边向上），
 * 特效层直接拿这个下标排起播延迟，刀痕才会绕着一圈转着走，而不是各格同时乱砍。
 * 出界的格子在这一步就剔掉，所以贴边施放时那一圈只是少几道，不会拖到棋盘外面。
 */
export function getJinghongOuterRing(center: Position): Position[] {
    const [cr, cc] = center;
    const clockwise: Position[] = [];
    for (let col = cc - 2; col <= cc + 2; col++) clockwise.push([cr - 2, col]);
    for (let row = cr - 1; row <= cr + 2; row++) clockwise.push([row, cc + 2]);
    for (let col = cc + 1; col >= cc - 2; col--) clockwise.push([cr + 2, col]);
    for (let row = cr + 1; row >= cr - 1; row--) clockwise.push([row, cc - 2]);
    return clockwise.filter(cell => MovementSystem.inBounds(cell));
}

/**
 * 替补席血量账。
 *
 * 替补席本身只存模板 id（未登场单位没有 Hero 实例），所以"临时被拉上场、
 * 又退回候补席"的单位一旦回席，实例连同受过的伤就一起没了——再补员时会
 * 按 createHero 开出一个满血新号。这里把离场那一刻的生命记下来，
 * 真正登场时按这份血量入场，做到"血量随人走"。
 */
function benchHpMap(gameState: GameState, owner: Player): Record<string, number> {
    if (owner === 'player1') {
        gameState.player1BenchHp = gameState.player1BenchHp ?? {};
        return gameState.player1BenchHp;
    }
    gameState.player2BenchHp = gameState.player2BenchHp ?? {};
    return gameState.player2BenchHp;
}

export function setBenchHeroHp(gameState: GameState, owner: Player, templateId: string, hp: number): void {
    benchHpMap(gameState, owner)[templateId] = Math.max(0, Math.floor(hp));
}

/** 取出并销账：只有真正登场的那一次能用掉这份带伤入场的记录 */
export function takeBenchHeroHp(gameState: GameState, owner: Player, templateId: string): number | undefined {
    const map = benchHpMap(gameState, owner);
    const hp = map[templateId];
    if (hp === undefined) return undefined;
    delete map[templateId];
    return hp;
}

export function clearBenchHeroHp(gameState: GameState, owner: Player, templateId: string): void {
    delete benchHpMap(gameState, owner)[templateId];
}

/**
 * 羽化是目标身上的共享资源：帝兰与南风叠加同一份层数（上限3层），
 * 不按施加者分家——否则帝兰看不见南风种的层数，也就无法引爆。
 * 逐格固定伤害按当初种下羽化的英雄结算（sourceHeroId 只用于伤害归属）。
 */
export function getDilanFeatherStacks(target: Hero): number {
    return Math.min(3, target.effects.find(effect =>
        effect.name === '羽化'
    )?.stackCount ?? 0);
}

export function addDilanFeather(target: Hero, source: Hero, amount = 1): number {
    const existing = target.effects.find(effect => effect.name === '羽化');
    if (existing) {
        existing.stackCount = Math.min(3, (existing.stackCount ?? 1) + amount);
        existing.duration = -1;
        return existing.stackCount;
    }
    EffectManager.addEffect(target, {
        type: 'debuff',
        name: '羽化',
        duration: -1,
        stackCount: Math.min(3, amount),
        sourceHeroId: source.id,
        description: `每次位移1格受到${source.counters['talent_3'] ? 2 : 1}点不可规避、无视护盾的固定伤害；3层时帝兰技能或击杀风暴会引爆`,
    });
    return Math.min(3, amount);
}

export function consumeDilanFeather(target: Hero): number {
    const stacks = getDilanFeatherStacks(target);
    target.effects = target.effects.filter(effect => effect.name !== '羽化');
    return stacks;
}

/* ---------------- 云缨：祥瑞与烈火燎原 ---------------- */

/** 祥瑞累计到该层数即引燃烈火燎原，随后清空该目标身上的祥瑞 */
export const XIANGRUI_TRIGGER_STACKS = 3;
/** 祥瑞层数上限：与引燃阈值一致，不会无限堆叠 */
export const XIANGRUI_MAX_STACKS = XIANGRUI_TRIGGER_STACKS;

/** 读取目标身上的祥瑞层数 */
export function getXiangruiStacks(target: Hero): number {
    return Math.min(XIANGRUI_MAX_STACKS, target.effects.find(effect =>
        effect.name === '祥瑞'
    )?.stackCount ?? 0);
}

/** 叠加祥瑞，返回叠中之后的层数（sourceHeroId 只用于归属显示） */
export function addXiangrui(target: Hero, source: Hero, amount = 1): number {
    const existing = target.effects.find(effect => effect.name === '祥瑞');
    if (existing) {
        existing.stackCount = Math.min(XIANGRUI_MAX_STACKS, (existing.stackCount ?? 1) + amount);
        existing.duration = -1;
        return existing.stackCount;
    }
    EffectManager.addEffect(target, {
        type: 'debuff',
        name: '祥瑞',
        duration: -1,
        stackCount: Math.min(XIANGRUI_MAX_STACKS, amount),
        sourceHeroId: source.id,
        description: `云缨命火的印记：被云缨攻击一次叠1层，累计${XIANGRUI_TRIGGER_STACKS}层会引燃烈火燎原并清空`,
    });
    return Math.min(XIANGRUI_MAX_STACKS, amount);
}

/** 引燃后摘除目标身上的祥瑞，返回被清掉的层数 */
export function consumeXiangrui(target: Hero): number {
    const stacks = getXiangruiStacks(target);
    target.effects = target.effects.filter(effect => effect.name !== '祥瑞');
    return stacks;
}

/**
 * 云缨技能二为"下一次攻击"挂上的吸血 buff 名。
 * 名称必须含"吸血"：伤害结算按效果名归集 vampire 修正（见 DamageCalculator.getModifiers）。
 */
export const YUNYING_VAMPIRE_EFFECT = '燎原吸血';

/**
 * 潮汐：泠汐攻击命中的敌人身上的层数资源（上限3层）。
 * 属于 debuff，所以会被叙白「涤秽回春」洗掉；洗掉后需要重新叠加。
 */
export const TIDE_MAX = 3;
export const TIDE_EFFECT_NAME = '潮汐';

export function getTideStacks(target: Hero): number {
    return Math.min(TIDE_MAX, target.effects.find(effect =>
        effect.name === TIDE_EFFECT_NAME
    )?.stackCount ?? 0);
}

export function addTide(target: Hero, source: Hero, amount = 1): number {
    const existing = target.effects.find(effect => effect.name === TIDE_EFFECT_NAME);
    if (existing) {
        existing.stackCount = Math.min(TIDE_MAX, (existing.stackCount ?? 1) + amount);
        existing.duration = -1;
        return existing.stackCount;
    }
    EffectManager.addEffect(target, {
        type: 'debuff',
        name: TIDE_EFFECT_NAME,
        duration: -1,
        stackCount: Math.min(TIDE_MAX, amount),
        sourceHeroId: source.id,
        description: `上限${TIDE_MAX}层；被泠汐造成伤害时，以其为中心3×3的友方恢复当前层数的生命`,
    });
    return Math.min(TIDE_MAX, amount);
}

export function consumeTide(target: Hero): number {
    const stacks = getTideStacks(target);
    target.effects = target.effects.filter(effect => effect.name !== TIDE_EFFECT_NAME);
    return stacks;
}

/** 场上某一方的敌方英雄身上的潮汐总层数（天威按这个值群体治疗） */
export function totalTideOnEnemiesOf(gameState: GameState, owner: Player): number {
    const enemies = owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
    return enemies.reduce((sum, hero) => sum + getTideStacks(hero), 0);
}

/**
 * 泠汐的延迟段是否已跨到更晚的回合（同回合武装的不算，避免自己立刻触发自己）。
 * 技能结算与技能范围高亮共用这一份口径，避免两处判断漂移。
 */
export function isLingxiEchoPending(caster: Hero, gameState: GameState, key: string): boolean {
    const armedRound = caster.counters[key] ?? 0;
    return armedRound > 0 && armedRound < gameState.roundNumber;
}

export function applyDilanWind(target: Hero, source: Hero, kind: '顺风' | '逆风'): void {
    EffectManager.addEffect(target, {
        type: kind === '顺风' ? 'buff' : 'debuff',
        name: kind,
        duration: target.hasActedThisTurn ? 2 : 1,
        value: kind === '顺风' ? 1 : -1,
        stackCount: 1,
        sourceHeroId: source.id,
        description: `${kind === '顺风' ? '移动力+1' : '移动力-1'}，持续1回合`,
    });
}

export function getAllHeroes(gameState: GameState): Hero[] {
    return [...gameState.player1Heroes, ...gameState.player2Heroes];
}

export function getAllies(hero: Hero, gameState: GameState): Hero[] {
    return hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
}

export function getEnemies(hero: Hero, gameState: GameState): Hero[] {
    return hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
}

export function getLivingHeroes(heroes: Hero[]): Hero[] {
    return heroes.filter(hero => hero.state === HeroState.ALIVE && hero.position);
}

export function currentDeadCount(owner: Player, gameState: GameState): number {
    const heroes = owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    return heroes.filter(hero => hero.state !== HeroState.ALIVE).length;
}

/**
 * 选择缚魂灯的吸血受益者：优先玩家选定的存活友方，否则选血量最低的存活友方。
 */
export function findSoulLampBeneficiary(lamp: Hero, gameState: GameState): Hero | null {
    const allies = (lamp.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes)
        .filter(hero => hero.state === HeroState.ALIVE && hero.id !== lamp.id)
        .sort((a, b) => a.currentHp - b.currentHp);
    const selectedId = gameState.soulLampBeneficiaryIds?.[lamp.id];
    return allies.find(hero => hero.id === selectedId) ?? allies[0] ?? null;
}

/**
 * 赏金猎人被动：向敌方所有存活单位随机发布悬赏（每局触发一次）。
 */
export function placeBounties(hunter: Hero, gameState: GameState): string[] {
    const enemies = getLivingHeroes(getEnemies(hunter, gameState));
    const rewardNames = ['天威再临', '半血回生', '永久暴击', '永久吸血'];
    const assignments: string[] = [];
    for (const enemy of enemies) {
        const reward = Math.floor(Math.random() * rewardNames.length);
        enemy.effects = enemy.effects.filter(effect =>
            !(effect.name.startsWith('悬赏·') && effect.sourceHeroId === hunter.id)
        );
        EffectManager.addEffect(enemy, {
            type: 'debuff',
            name: `悬赏·${rewardNames[reward]}`,
            duration: -1,
            value: reward,
            sourceHeroId: hunter.id,
            description: '被击杀时，实际击杀者获得对应赏金奖励',
        });
        assignments.push(`${enemy.name}（${rewardNames[reward]}）`);
    }
    return assignments;
}

/**
 * 检查阴阳师的线：目标超出两格范围立即断线，并重置对应线路的倍率（哪条断重置哪条）。
 * 任何单位移动或位移类技能结算后都应调用，由 checkAllYinyangLinks 统一驱动。
 */
export function checkYinyangLinks(hero: Hero, gameState: GameState): boolean {
    if (!hero.position) return false;
    const all = [...gameState.player1Heroes, ...gameState.player2Heroes];
    let yangBroken = false;
    let yinBroken = false;
    for (const target of all) {
        if (!target.position || target.id === hero.id) continue;
        const hasYang = target.effects.some(effect =>
            effect.name.startsWith('阳线') && effect.sourceHeroId === hero.id
        );
        const hasYin = target.effects.some(effect =>
            effect.name.startsWith('阴线') && effect.sourceHeroId === hero.id
        );
        if (!hasYang && !hasYin) continue;
        if (MovementSystem.getManhattanDistance(hero.position, target.position) > 2) {
            if (hasYang) yangBroken = true;
            if (hasYin) yinBroken = true;
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
                timestamp: Date.now(),
                type: 'system',
                player: hero.owner,
                message: `${hero.name}与${target.name}的${hasYang && hasYin ? '阳线/阴线' : hasYang ? '阳线' : '阴线'}超出两格范围，断开了`
            });
            target.effects = target.effects.filter(effect =>
                !(effect.sourceHeroId === hero.id &&
                    (effect.name.startsWith('阳线') || effect.name.startsWith('阴线')))
            );
        }
    }
    if (yangBroken) {
        hero.counters['yinyang_yang_rate'] = 0.2;
        hero.counters['yinyang_yang_repeat'] = 0.2;
    }
    if (yinBroken) {
        hero.counters['yinyang_yin_rate'] = 0.2;
        hero.counters['yinyang_yin_repeat'] = 0.2;
    }
    return yangBroken || yinBroken;
}

/**
 * 阴阳线随本体消散：把挂在其他英雄身上的、由该阴阳师施加的阳线/阴线全部移除，
 * 并重置其倍率计数。真阵亡（含死后回替补席、日后被唤回）与暂时阵亡都必须
 * 在死亡结算当场调用——只靠"移动后重算"会漏掉不伴随位移的死亡，
 * 让死者持续给全场挂攻防加成、复活回归时线还会原样接上。
 * 返回是否真的移除过效果（调用方可据此决定是否播日志/触发重渲染）。
 */
export function purgeYinyangLinksOf(
    hero: Hero,
    gameState: GameState,
    verb = '已离场'
): boolean {
    const all = [...gameState.player1Heroes, ...gameState.player2Heroes];
    let removed = false;
    for (const target of all) {
        if (target.id === hero.id) continue;
        const before = target.effects.length;
        target.effects = target.effects.filter(effect =>
            !(effect.sourceHeroId === hero.id &&
                (effect.name.startsWith('阳线') || effect.name.startsWith('阴线')))
        );
        if (target.effects.length !== before) removed = true;
    }
    if (removed) {
        hero.counters['yinyang_yang_rate'] = 0.2;
        hero.counters['yinyang_yang_repeat'] = 0.2;
        hero.counters['yinyang_yin_rate'] = 0.2;
        hero.counters['yinyang_yin_repeat'] = 0.2;
        gameState.battleLog.push({
            id: `log-${Date.now()}-${Math.random()}`,
            timestamp: Date.now(),
            type: 'system',
            player: hero.owner,
            message: `${hero.name}${verb}，其阳线/阴线全部消散`
        });
    }
    return removed;
}

/**
 * 场上所有阴阳师的线统一检查：位置发生变化后立即调用。
 * - 存活的阴阳师：目标超出两格立即断线并重置倍率
 * - 死亡（含暂时死亡）的阴阳师：其全部阳线/阴线随本体消散并重置倍率
 *   （死亡当场也会直接 purgeYinyangLinksOf，这里只是兜底）
 */
export function checkAllYinyangLinks(gameState: GameState): boolean {
    const all = [...gameState.player1Heroes, ...gameState.player2Heroes];
    let changed = false;
    for (const hero of all) {
        if (hero.passiveId !== 'yinyang_passive') continue;
        if (hero.state === HeroState.ALIVE && hero.position) {
            changed = checkYinyangLinks(hero, gameState) || changed;
            continue;
        }
        changed = purgeYinyangLinksOf(hero, gameState) || changed;
    }
    return changed;
}

/**
 * 血契的禁足圈是"以血契为中心"的活区域（文案口径：只能留在血契身边）。
 * 本体被击退/拖拽/瞬移/天威跃迁改格后，整片 3×3 跟着重铺，
 * 否则圈会白白留在旧位置，被锁的敌人反而自由了。
 */
export function recenterXueqiBindingZones(gameState: GameState): boolean {
    const effects = gameState.boardEffects;
    if (!effects || effects.length === 0) return false;

    const groups = new Map<string, BoardEffect[]>();
    for (const effect of effects) {
        if (effect.type !== 'binding-zone' || !effect.linkId?.startsWith('xueqi-binding-')) continue;
        groups.set(effect.linkId, [...(groups.get(effect.linkId) ?? []), effect]);
    }
    if (groups.size === 0) return false;

    const all = getAllHeroes(gameState);
    let changed = false;
    for (const [linkId, group] of groups) {
        const binder = all.find(hero => hero.id === group[0].sourceHeroId);
        if (!binder?.position || binder.state !== HeroState.ALIVE) continue;

        const cells = MovementSystem.getBoxPositions(binder.position, 3);
        const unchanged = cells.length === group.length && cells.every(([row, col]) =>
            group.some(effect => effect.position[0] === row && effect.position[1] === col));
        if (unchanged) continue;

        const [template] = group;
        gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => effect.linkId !== linkId);
        for (const [row, col] of cells) {
            gameState.boardEffects!.push({
                ...template,
                id: `${linkId}-${row}-${col}`,
                position: [row, col],
                owner: binder.owner,
                sourceHeroId: binder.id,
            });
        }
        changed = true;
    }
    return changed;
}

/**
 * 位置发生变化后统一重算"以某单位为中心/为半径"的持续效果：
 * 血契的禁足圈跟着本体重铺，阴阳线按新距离判定是否超距断开。
 * 任何移动、位移技能、传送、风道推移与复活落位之后都要走一次。
 */
export function syncPositionAnchoredEffects(gameState: GameState): boolean {
    const rebound = recenterXueqiBindingZones(gameState);
    const broken = checkAllYinyangLinks(gameState);
    return rebound || broken;
}

export function currentTotalDead(gameState: GameState): number {
    return getAllHeroes(gameState).filter(hero => hero.state !== HeroState.ALIVE).length;
}

export function resonanceCount(owner: Player, gameState: GameState): number {
    return owner === 'player1'
        ? gameState.deathCounters.player1Dead
        : gameState.deathCounters.player2Dead;
}

export function createTPaintingSummon(
    kind: 'jinwu' | 'xuangui',
    owner: Player,
    sourceHeroId: string,
    position: Position
): Hero {
    const isJinwu = kind === 'jinwu';
    const maxHp = isJinwu ? 12 : 18;
    return {
        id: `t-summon|${kind}|${sourceHeroId}|${Date.now()}|${Math.random()}`,
        name: isJinwu ? '金乌' : '玄龟',
        class: '化识',
        maxHp,
        currentHp: maxHp,
        moveRange: 2,
        baseAttack: 0,
        position,
        state: HeroState.ALIVE,
        owner,
        skill1Id: isJinwu ? 'jinwu_skill' : 'xuangui_skill',
        skill2Id: isJinwu ? 'jinwu_skill' : 'xuangui_skill',
        passiveId: 't_summon_passive',
        effects: [],
        shield: 0,
        defense: 0,
        killCount: 0,
        hasActedThisTurn: true,
        hasMovedThisTurn: true,
        counters: {
            __isSummon: 1,
            __summonKind: isJinwu ? 1 : 2,
        },
    };
}

export function getSummonOwnerId(summon: Hero): string | null {
    if (summon.counters['__isSummon'] !== 1) return null;
    const parts = summon.id.split('|');
    return parts.length >= 4 ? parts[2] : null;
}

export function findHero(gameState: GameState, heroId: string): Hero | null {
    return getAllHeroes(gameState).find(hero => hero.id === heroId) ?? null;
}

export function findNearestEmptyForHero(hero: Hero, gameState: GameState): Position | null {
    return MovementSystem.findNearestEmptyPosition(hero.position ?? [0, 0], gameState);
}

export const jetzmiTianwei: TianweiSkill = {
    id: 'jetzmi_tianwei',
    name: '天威',
    description: '获得2点亡灵共鸣',
    execute: (hero, gameState) => {
        if (hero.owner === 'player1') gameState.deathCounters.player1Dead += 2;
        else gameState.deathCounters.player2Dead += 2;
    },
};

export const witherLordTianwei: TianweiSkill = {
    id: 'wither_lord_tianwei',
    name: '天威',
    description: '增加一条生命',
    execute: hero => {
        EffectManager.addCounter(hero, 'wither_lives', 1);
    },
};

export const wangcaiTianwei: TianweiSkill = {
    id: 'wangcai_tianwei',
    name: '天威',
    description: '永久增加2点基础攻击力',
    execute: hero => {
        hero.baseAttack = (hero.baseAttack ?? 0) + 2;
    },
};

export function addHeroToOwnerList(hero: Hero, gameState: GameState): void {
    const list = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    if (!list.some(existing => existing.id === hero.id)) list.push(hero);
}
