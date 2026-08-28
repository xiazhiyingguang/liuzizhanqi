import { EffectManager } from '../core/effect-manager';
import { MovementSystem } from '../core/movement-system';
import {
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
    // youjun 技能尚未实现，先不入册（图鉴构造会因缺技能直接抛错）；补完 skill1/skill2 后放回
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
        tianweiId: 'youjun_tianwei',
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
    youjun: { name: '游隼', class: '猎户', description: '路径冲刺、爆发伤害的猎手。借风道滑行蓄力，沿直线穿透敌阵造成随距离与位移攀升的爆发伤害。生命44，移动力3' },
    chenyuan: { name: '沉渊·镇岳', class: '霸魁', description: '极寒领域、拖拽控场与援护承伤。生命60，移动力1' },
    dai: { name: '时空旅者·戴尔', class: '天师', description: '时空回溯复活与状态还原、时空置换换位换血。生命45，移动力3' },
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
            hero.counters['youjun_extra_move_only'] = 0;
            break;
    }
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
 * 场上所有阴阳师的线统一检查：位置发生变化后立即调用。
 * - 存活的阴阳师：目标超出两格立即断线并重置倍率
 * - 死亡（含暂时死亡）的阴阳师：其全部阳线/阴线随本体消散并重置倍率
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
                message: `${hero.name}已离场，其阳线/阴线全部消散`
            });
        }
        changed = removed || changed;
    }
    return changed;
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
