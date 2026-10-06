import { nextBattleLogId } from '../core/battle-log-id';
import { requestMechanismFx } from '../core/mechanism-fx';
import { Hero, HeroState, Player, PassiveSkill, TianweiSkill, Position, GameState } from '../types/game';
import { EffectManager } from '../core/effect-manager';
import { DamageCalculator } from '../core/damage-calculator';
import { executeHuifengTianwei } from '../core/huifeng-marks';
import { enterNightowlStealth } from '../core/nightowl-stealth';
import { YOUJUN_KNIFE_DAMAGE, YOUJUN_KNIFE_MASK } from '../core/wind-blade';
import { zhizhiValue } from '../core/hero-zhizhi';
import {
    EXTENDED_HERO_IDS,
    EXTENDED_HERO_INFO,
    EXTENDED_HERO_TEMPLATES,
    initializeExtendedHero,
} from './extended-heroes';

/**
 * 被动技能库
 */

export function createWukongClone(
    owner: Player,
    wukongId: string,
    position: Position,
    maxHp: number
): Hero {
    return {
        id: `wukong-clone|${wukongId}|${Date.now()}|${Math.random()}`,
        name: '分身',
        class: '武曲',
        maxHp,
        currentHp: maxHp,
        moveRange: 0,
        baseAttack: 0,
        position,
        state: HeroState.ALIVE,
        owner,
        skill1Id: '',
        skill2Id: '',
        passiveId: 'wukong_clone_passive',
        effects: [],
        shield: 0,
        defense: 0,
        killCount: 0,
        hasActedThisTurn: true,
        hasMovedThisTurn: true,
        counters: { __isClone: 1 },
    };
}

function getWukongOwnerIdFromCloneId(cloneId: string): string | null {
    const parts = cloneId.split('|');
    if (parts.length < 3) return null;
    if (parts[0] !== 'wukong-clone') return null;
    return parts[1] || null;
}

function countWukongClonesOnBoard(wukongId: string, gameState: { board: (Hero | null)[][] }): number {
    let count = 0;
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            const h = gameState.board[r][c];
            if (!h) continue;
            if (h.counters && h.counters['__isClone'] === 1 && getWukongOwnerIdFromCloneId(h.id) === wukongId) {
                count++;
            }
        }
    }
    return count;
}

/** 孙悟空的初始暴击率：不依赖灵犀就有 30%，之后每点灵犀再 +20%，封顶 100% */
export const WUKONG_BASE_CRIT_RATE = 0.3;
/** 灵犀每层提供的暴击率：基础 +20%，致知3 抬到 +30% */
const WUKONG_LINGXI_CRIT_PER_STACK = 0.2;

/**
 * 孙悟空的暴击率口径，三处结算（本体出手、分身出手、布阵同步）都走这里。
 * 之前 damage-calculator 与 game-store 各抄了一份公式，其中一份还把初始暴击率写成 0.2。
 */
export function getWukongCritRate(hero: Hero): number {
    const lingxi = hero.counters['灵犀'] ?? 0;
    // 致知1：初始暴击率 30% → 50%
    const base = zhizhiValue(hero, 1, WUKONG_BASE_CRIT_RATE, WUKONG_BASE_CRIT_RATE + 0.2);
    // 致知3：每层灵犀 +20% → +30%
    const perStack = zhizhiValue(hero, 3, WUKONG_LINGXI_CRIT_PER_STACK, 0.3);
    return Math.min(1, base + lingxi * perStack);
}

function syncWukongCritToSelfAndClones(wukong: Hero, gameState: { board: (Hero | null)[][] }): void {
    const critRate = getWukongCritRate(wukong);
    EffectManager.removeEffectByName(wukong, '悟空暴击率');
    EffectManager.addEffect(wukong, {
        type: 'buff',
        name: '悟空暴击率',
        duration: -1,
        value: critRate,
        sourceHeroId: wukong.id,
        description: '基础暴击率与灵犀叠加',
    });

    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            const h = gameState.board[r][c];
            if (!h) continue;
            if (h.counters && h.counters['__isClone'] === 1 && getWukongOwnerIdFromCloneId(h.id) === wukong.id) {
                EffectManager.removeEffectByName(h, '悟空暴击率');
                EffectManager.addEffect(h, {
                    type: 'buff',
                    name: '悟空暴击率',
                    duration: -1,
                    value: critRate,
                    sourceHeroId: wukong.id,
                    description: '基础暴击率与灵犀叠加',
                });
            }
        }
    }
}

// 墨阑被动："为道"
export const moranPassive: PassiveSkill = {
    id: 'moran_passive',
    name: '为道',
    description: '处于"为道"状态时防御提升30%；受到两次攻击后，在受到第二次攻击后，使自己立即行动一次并解除"为道"',
    triggerOn: 'onDamaged',
    execute: (hero, gameState, context) => {
        void context;
        const hasWeidao = hero.effects.some(e => e.name === '为道');
        if (!hasWeidao) {
            return;
        }

        // 如果当前是自己的额外行动回合，不积累层数也不触发（防止无限循环）
        if (gameState.performingExtraAction && gameState.activeHero?.id === hero.id) {
            return;
        }

        // 初始化计数器
        if (hero.counters['为道受击'] === undefined) {
            hero.counters['为道受击'] = 0;
        }

        hero.counters['为道受击']++;

        if (hero.counters['为道受击'] >= 2) {
            hero.counters['__extra_preActed'] = hero.hasActedThisTurn ? 1 : 0;
            hero.counters['__extra_preMoved'] = hero.hasMovedThisTurn ? 1 : 0;

            // 触发立即行动：重置行动标记，允许再次行动
            hero.hasActedThisTurn = false;
            hero.hasMovedThisTurn = false;
            hero.counters['为道受击'] = 0;

            // 致知2：为道解除后的立即出手，技能伤害提升40%（标记由技能消耗、行动结束清除）
            let burstText = '';
            if (hero.counters['talent_2']) {
                hero.counters['__weidao_burst'] = 1;
                burstText = '，且本次出手技能伤害提升40%';
            }

            hero.effects = hero.effects.filter(e => e.name !== '为道');

            // 设置额外行动标记，确保不消耗总回合数
            if (!gameState.pendingExtraActionHeroIds) {
                gameState.pendingExtraActionHeroIds = {};
            }
            gameState.pendingExtraActionHeroIds[hero.owner] = hero.id;

            // 添加日志
            if (gameState.battleLog) {
                const logEntry = {
                    id: nextBattleLogId(),
                    type: 'system' as const,
                    player: hero.owner,
                    message: `${hero.name}的"为道"触发！获得额外行动机会${burstText}`,
                    timestamp: Date.now()
                };
                gameState.battleLog.push(logEntry);
            }
            if (hero.currentHp > 0) requestMechanismFx(hero, 'moran_extra_action', gameState, {
                logId: gameState.battleLog[gameState.battleLog.length - 1]?.id,
            });
        }
    }
};

// ===== 震霄 =====

/** 被动「血锋」的刻度：每失去 2% 生命，提升 1% 增伤 */
const BLOOD_EDGE_STEP_PERCENT = 2;
const BLOOD_EDGE_GAIN = 0.01;
/** 龙势受伤回复比例（按已损失生命） */
const LONGSHI_HEAL_RATE = 0.15;

/**
 * 被动「血锋」：每失去 2% 生命提升 1% 增伤。
 * 走增伤通道而不是"攻击提升"——震霄没有基础攻击力，攻击通道对他恒等于 0。
 */
export function getZhenxiaoDamageBonus(hero: Hero): number {
    if (hero.maxHp <= 0) return 0;
    const lostPercent = ((hero.maxHp - hero.currentHp) / hero.maxHp) * 100;
    return Math.floor(lostPercent / BLOOD_EDGE_STEP_PERCENT) * BLOOD_EDGE_GAIN;
}

/** 耗血口径：技能一/技能二/天威共用，致知1 把 20% 降到 15%。 */
export function spendZhenxiaoBlood(hero: Hero): number {
    const rate = hero.counters['talent_1'] ? 0.15 : 0.2;
    const cost = Math.floor(hero.currentHp * rate);
    hero.currentHp = Math.max(1, hero.currentHp - cost);
    return cost;
}

function pushZhenxiaoLog(gameState: GameState, owner: Player, message: string): void {
    gameState.battleLog ??= [];
    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'passive',
        player: owner,
        message,
        timestamp: Date.now(),
    });
}

/** 龙势（天威给予）：每次受到伤害后，按已损失生命的 15% 回复。 */
function resolveLongshiRecovery(hero: Hero, gameState: GameState): void {
    if (!hero.effects.some(effect => effect.name === '龙势')) return;
    if (hero.state !== HeroState.ALIVE || hero.maxHp <= 0) return;
    const healed = Math.floor((hero.maxHp - hero.currentHp) * LONGSHI_HEAL_RATE);
    if (healed <= 0) return;
    DamageCalculator.applyHeal(hero, healed, gameState, hero);
    pushZhenxiaoLog(gameState, hero.owner, `${hero.name}的龙势涌动，恢复${healed}点生命`);
}

// 反击本身会造成一次新的伤害结算，若对面也带着「金银错」就会来回反弹到死。
// 用一把模块级锁把回击压成"一层"：回击途中不再触发回击。
let resolvingJinyincuo = false;

/** 金银错（技能二给予）：受到敌方英雄伤害后回击，回击吃增伤等一切增益，并吸血 50%。 */
function resolveJinyincuoCounter(
    hero: Hero,
    gameState: GameState,
    context?: { attacker?: Hero }
): void {
    if (resolvingJinyincuo) return;
    if (!hero.effects.some(effect => effect.name === '金银错')) return;
    const attacker = context?.attacker;
    if (!attacker || attacker.owner === hero.owner) return;
    if (attacker.state !== HeroState.ALIVE) return;

    const counterBase = hero.counters['talent_3'] ? 8 : 6;
    const counterTargetPos = attacker.position ? [...attacker.position] as Position : undefined;
    const counterLogStart = gameState.battleLog.length;
    resolvingJinyincuo = true;
    try {
        const result = DamageCalculator.asOneAttack(() => {
            const damage = DamageCalculator.calculate(hero, attacker, counterBase);
            DamageCalculator.applyDamage(attacker, damage, hero, gameState);
            return damage;
        });
        const healed = Math.floor(result.hpDamage * 0.5);
        const actualHealed = healed > 0 ? DamageCalculator.applyHeal(hero, healed, gameState, hero) : 0;
        pushZhenxiaoLog(gameState, hero.owner,
            `${hero.name}金银错回击${attacker.name}，造成${result.finalDamage}点伤害，回复${healed}点生命`);
        if (counterTargetPos) {
            const damageLog = gameState.battleLog.slice(counterLogStart).find(log =>
                log.type === 'damage' && log.details?.sourceHeroId === hero.id && log.details?.targetHeroId === attacker.id);
            requestMechanismFx(hero, 'zhenxiao_counter', gameState, {
                targetPos: counterTargetPos, damagePositions: result.finalDamage > 0 ? [counterTargetPos] : [],
                logId: damageLog?.id ?? gameState.battleLog[gameState.battleLog.length - 1]?.id,
                softImpactPositions: actualHealed > 0 && hero.position ? [hero.position] : [],
            });
        }
    } finally {
        resolvingJinyincuo = false;
    }
}

/**
 * 被动位「血锋」：常驻的残血增伤由 damage-calculator 直接读取，
 * 这里只承载两个状态的受击结算——「金银错」（技能二）与「龙势」（天威）。
 * 龙势的"不会死亡"落在 DamageCalculator 扣血的那一步，早于本钩子。
 */
export const zhenxiaoPassive: PassiveSkill = {
    id: 'zhenxiao_passive',
    name: '血锋',
    description: '每失去2%生命，提升1%增伤；受击时结算"金银错"回击与"龙势"回血',
    triggerOn: 'onDamaged',
    execute: (hero, gameState, context) => {
        resolveLongshiRecovery(hero, gameState);
        resolveJinyincuoCounter(hero, gameState, context);
    }
};

// 琉璃被动：每次援护增加禅定
export const liuliPassive: PassiveSkill = {
    id: 'liuli_passive',
    name: '援护被动',
    description: '每次援护（即承担伤害时），增加1层禅定',
    triggerOn: 'onAllyDamaged',
    execute: (hero, gameState, context) => {
        // 援护触发时（琉璃替友方承担伤害后），增加1层禅定
        // 实际的援护伤害转移逻辑在 DamageCalculator 中处理：
        // 1. 检查目标是否有"援护"效果
        // 2. 如果有，找到源英雄（琉璃），将伤害转移给她
        // 3. 伤害转移后，调用此被动增加禅定

        // 检查是否是因为援护被触发
        if (context?.isGuardTrigger) {
            // 增加禅定
            if (hero.counters['禅定'] === undefined) {
                hero.counters['禅定'] = 0;
            }
            hero.counters['禅定']++;

            // 添加日志
            if (gameState.battleLog) {
                const logEntry = {
                    id: nextBattleLogId(),
                    type: 'passive' as const,
                    player: hero.owner,
                    message: `${hero.name}援护触发，获得1层禅定（当前${hero.counters['禅定']}层）`,
                    timestamp: Date.now()
                };
                gameState.battleLog.push(logEntry);
            }
        }
    }
};

export const wukongPassive: PassiveSkill = {
    id: 'wukong_passive',
    name: '灵犀',
    description: '初始暴击率30%；每个分身阵亡增加1点灵犀，每点灵犀再提升20%暴击率（本体与现存分身共享，最高100%）',
    triggerOn: 'always',
    execute: () => {}
};

export const baizePassive: PassiveSkill = {
    id: 'baize_passive',
    name: '白泽图',
    description: '回合开始时，为我方随机2个单位提供"白泽之力"（治疗效果提升）',
    triggerOn: 'onTurnStart',
    execute: () => {}
};

export const mowenPassive: PassiveSkill = {
    id: 'mowen_passive',
    name: '时间裂隙',
    description: '受击时概率闪避伤害；低血时概率提升',
    triggerOn: 'always',
    execute: () => {}
};

export const guyingPassive: PassiveSkill = {
    id: 'guying_passive',
    name: '寒星',
    description: '技能命中带有“寒天”的敌人时，获得1层寒星（最多5层）',
    triggerOn: 'always',
    execute: () => {}
};

export const hanjiangxuePassive: PassiveSkill = {
    id: 'hanjiangxue_passive',
    name: '雪誓',
    description: '回合结束时，为生命百分比最低的友方附加冰甲',
    triggerOn: 'always',
    execute: () => {}
};

export const hanjiangxueTianwei: TianweiSkill = {
    id: 'hanjiangxue_tianwei',
    name: '天威',
    description: '击杀敌人后，对敌方场上所有存活单位附加1层寒天',
    execute: (hero: Hero, gameState: GameState) => {
        const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
        const alive = enemies.filter(enemy => enemy.state === HeroState.ALIVE);
        for (const enemy of alive) {
            DamageCalculator.applyHantianStacks(enemy, 1, hero.id, gameState);
        }
        if (alive.length > 0 && gameState.battleLog) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威，对全部存活敌人附加1层寒天`,
                timestamp: Date.now()
            });
        }
    }
};

export const huifengPassive: PassiveSkill = {
    id: 'huifeng_passive',
    name: '锋鸣',
    description: '每次攻击带啸刃的敌人叠1层锋鸣（上限3层）；满3层清空并自动释放连刃斩，3段各自随机攻击场上的敌人',
    triggerOn: 'always',
    execute: () => {}
};

export const xuanxiaoPassive: PassiveSkill = {
    id: 'xuanxiao_passive',
    name: '化险为夷',
    description: '首次低于16生命后，下一次受到的伤害转化为治疗',
    triggerOn: 'always',
    execute: () => {}
};

export const changliPassive: PassiveSkill = {
    id: 'changli_passive',
    name: '长夜轮回',
    description: '拥有一次复活机会：复活后生命为上一次的一半，并永久提升40%伤害',
    triggerOn: 'always',
    execute: () => {}
};

/**
 * 天威技能库
 */

// 墨阑天威：击杀敌人后立即出手一次
export const moranTianwei: TianweiSkill = {
    id: 'moran_tianwei',
    name: '天威',
    description: '击杀敌人后立即出手一次（每回合限1次）',
    execute: (hero, gameState) => {
        // 检查每回合触发限制
        const uses = hero.counters['tianwei_uses'] || 0;
        if (uses >= 1) {
            return;
        }
        hero.counters['tianwei_uses'] = uses + 1;

        hero.counters['__extra_preActed'] = hero.hasActedThisTurn ? 1 : 0;
        hero.counters['__extra_preMoved'] = hero.hasMovedThisTurn ? 1 : 0;

        // 设置标记，由GameEngine处理
        if (!gameState.pendingExtraActionHeroIds) {
            gameState.pendingExtraActionHeroIds = {};
        }
        gameState.pendingExtraActionHeroIds[hero.owner] = hero.id;

        // 添加日志
        if (gameState.battleLog) {
            const logEntry = {
                id: nextBattleLogId(),
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威！获得额外行动机会`,
                timestamp: Date.now()
            };
            gameState.battleLog.push(logEntry);
        }
    }
};

// 震霄天威：击杀后耗血进入「龙势」
/**
 * 天威 · 龙起：击杀敌人后立即消耗当前生命，进入「龙势」直到下一回合结束。
 * duration 2 的口径是"本回合 + 下一回合"（效果在回合初才衰减），即文案里的"持续到下一回合结束"。
 */
export const zhenxiaoTianwei: TianweiSkill = {
    id: 'zhenxiao_tianwei',
    name: '天威 · 龙起',
    description: '击杀敌人后消耗当前生命20%（致知1降至15%），进入"龙势"状态，持续到下一回合结束',
    execute: (hero, gameState) => {
        if (hero.state !== HeroState.ALIVE) return;

        const cost = spendZhenxiaoBlood(hero);
        EffectManager.removeEffectByName(hero, '龙势');
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: '龙势',
            duration: 2,
            sourceHeroId: hero.id,
            description: '每次受到伤害后恢复已损失生命15%，且不会死亡（至少保留1点生命）'
        });

        gameState.battleLog ??= [];
        gameState.battleLog.push({
            id: nextBattleLogId(),
            type: 'tianwei',
            player: hero.owner,
            message: `${hero.name}天威·龙起，耗去${cost}点生命进入龙势`,
            timestamp: Date.now()
        });
    }
};

export const wukongTianwei: TianweiSkill = {
    id: 'wukong_tianwei',
    name: '天威',
    description: '本人或分身击杀敌方英雄时，立即释放一个分身（战棋上分身数量不超过3个）',
    execute: (hero, gameState) => {
        if (!hero.position) return;
        if (countWukongClonesOnBoard(hero.id, gameState) >= 3) {
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: nextBattleLogId(),
                    type: 'tianwei' as const,
                    player: hero.owner,
                    message: `${hero.name}的天威未生效：场上分身已达上限（3个）`,
                    timestamp: Date.now()
                });
            }
            return;
        }

        const [row, col] = hero.position;
        const directions: [number, number][] = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1],
        ];

        let summonPos: Position | null = null;
        for (const [dr, dc] of directions) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || r >= 6 || c < 0 || c >= 6) continue;
            if (gameState.board[r][c] === null) {
                summonPos = [r, c];
                break;
            }
        }

        if (!summonPos) {
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: nextBattleLogId(),
                    type: 'tianwei' as const,
                    player: hero.owner,
                    message: `${hero.name}的天威未生效：周围没有空位召唤分身`,
                    timestamp: Date.now()
                });
            }
            return;
        }

        const clone = createWukongClone(hero.owner, hero.id, summonPos, zhizhiValue(hero, 2, 10, 12));
        gameState.board[summonPos[0]][summonPos[1]] = clone;

        if (hero.counters['灵犀'] === undefined) {
            hero.counters['灵犀'] = 0;
        }
        syncWukongCritToSelfAndClones(hero, gameState);

        if (gameState.battleLog) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威，召唤了一个分身`,
                timestamp: Date.now()
            });
        }
    }
};

export const nightowlTianwei: TianweiSkill = {
    id: 'nightowl_tianwei',
    name: '天威',
    description: '立即进入潜行状态，下次攻击无视目标50%防御',
    execute: (hero: Hero, gameState: GameState) => {
        enterNightowlStealth(hero, gameState.roundNumber);

        // 下次攻击无视50%防御
        hero.counters['ignore_defense_next'] = 1;

        if (gameState.battleLog) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威，进入潜行状态，下次攻击无视50%防御`,
                timestamp: Date.now()
            });
        }
    }
};

export function createMirrorClone(
    owner: Player,
    mirrorId: string,
    position: Position,
    maxHp: number,
    currentHp: number
): Hero {
    return {
        id: `mirror-clone|${mirrorId}|${Date.now()}|${Math.random()}`,
        name: '镜像',
        class: '武曲',
        maxHp,
        currentHp,
        moveRange: 3,
        baseAttack: 0,
        position,
        state: HeroState.ALIVE,
        owner,
        skill1Id: '',
        skill2Id: '',
        passiveId: 'mirror_clone_passive',
        effects: [],
        shield: 0,
        defense: 0,
        killCount: 0,
        hasActedThisTurn: true,
        hasMovedThisTurn: true,
        counters: { __isClone: 1 },
    };
}

export function getMirrorOwnerIdFromCloneId(cloneId: string): string | null {
    const parts = cloneId.split('|');
    if (parts.length < 3) return null;
    if (parts[0] !== 'mirror-clone') return null;
    return parts[1] || null;
}

export const mirrorPassive: PassiveSkill = {
    id: 'mirror_passive',
    name: '破镜之刃',
    description: '获得破镜之刃后立即释放，斩向"镜域"（本体与镜像张成的外接矩形）内血量最低的敌人；镜域里没人则层数留存，等敌人走进来补放',
    triggerOn: 'always',
    execute: () => {}
};

export const mirrorTianwei: TianweiSkill = {
    id: 'mirror_tianwei',
    name: '天威',
    description: '获得3层破镜之刃',
    execute: (hero: Hero, gameState: GameState) => {
        if (hero.counters['破镜之刃'] === undefined) {
            hero.counters['破镜之刃'] = 0;
        }
        // 致知2：天威给的破镜之刃 3 层 → 4 层
        const bladeStacks = zhizhiValue(hero, 2, 3, 4);
        hero.counters['破镜之刃'] += bladeStacks;
        
        if (gameState.battleLog) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威，获得${bladeStacks}层破镜之刃`,
                timestamp: Date.now()
            });
        }
    }
};

export const mowenTianwei: TianweiSkill = {
    id: 'mowen_tianwei',
    name: '天威',
    description: '击杀后回复等同于对目标造成的伤害',
    execute: (hero: Hero, gameState: GameState) => {
        const lastKillDamage = hero.counters['__last_kill_damage'] || 0;
        if (lastKillDamage <= 0) {
            return;
        }

        delete hero.counters['__last_kill_damage'];
        const healed = DamageCalculator.applyHeal(hero, lastKillDamage, gameState);

        if (gameState.battleLog) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威，回复${healed}点生命`,
                timestamp: Date.now()
            });
        }
    }
};

/** 孤影天威姿态名：技能一/二与图鉴、状态徽标共用这一个字符串 */
export const GUYING_DUANXUE = '断雪';

export const guyingTianwei: TianweiSkill = {
    id: 'guying_tianwei',
    name: '断雪',
    description: '进入「断雪」状态，持续两回合：技能一化为穿透斩，剑光贯穿整条路径上的所有敌人；技能二基础伤害提升到12；期间每次使用技能再获得1层寒星（上限仍是5层）',
    execute: (hero: Hero, gameState: GameState) => {
        EffectManager.removeEffectByName(hero, GUYING_DUANXUE);
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: GUYING_DUANXUE,
            // 回合开始时统一递减，2 表示"本回合 + 下一回合"都在势内
            duration: 2,
            sourceHeroId: hero.id,
            description: '技能一穿透斩、技能二基础伤害12，期间每次使用技能+1寒星'
        });

        if (gameState.battleLog) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威「断雪」，剑光断处不接两回合`,
                timestamp: Date.now()
            });
        }
    }
};

/**
 * 游隼天威「归翎」：她把飞刀留在自己停留过的格子上（不摆上棋盘，只记账），
 * 击杀时收回**与本尊同处一条直线或同一条对角线**的那些飞刀，
 * 飞刀沿收回路径割过敌人，每处造成 4 点伤害；不在同一线上的飞刀继续留在原地等下一次。
 */
export const youjunTianwei: TianweiSkill = {
    id: 'youjun_tianwei',
    name: '归翎',
    description: '收回与本尊同处直线或对角线上的所有飞刀，飞刀沿归途割过敌人，每处造成4点伤害',
    execute: (hero: Hero, gameState: GameState) => {
        if (!hero.position) return;

        let mask = hero.counters[YOUJUN_KNIFE_MASK] ?? 0;
        if (!mask) return;

        const [hr, hc] = hero.position;
        let reclaimed = 0;
        let totalDamage = 0;

        DamageCalculator.asOneAttack(() => {
            for (let idx = 0; idx < 36; idx++) {
                const bit = Math.pow(2, idx);
                if (Math.floor(mask / bit) % 2 === 0) continue;

                const sr = Math.floor(idx / 6);
                const sc = idx % 6;
                const drRaw = hr - sr;
                const dcRaw = hc - sc;
                const onRow = sr === hr;
                const onCol = sc === hc;
                const onDiagonal = Math.abs(drRaw) === Math.abs(dcRaw) && drRaw !== 0;
                if (!onRow && !onCol && !onDiagonal) continue;

                const stepR = drRaw === 0 ? 0 : (drRaw > 0 ? 1 : -1);
                const stepC = dcRaw === 0 ? 0 : (dcRaw > 0 ? 1 : -1);

                let cr = sr;
                let cc = sc;
                while (cr !== hr || cc !== hc) {
                    const target = gameState.board[cr][cc];
                    if (target && target.owner !== hero.owner && target.state === HeroState.ALIVE) {
                        // 游隼致知3：归翎飞刀 4 → 5
                        const damageResult = DamageCalculator.calculate(hero, target, zhizhiValue(hero, 3, YOUJUN_KNIFE_DAMAGE, YOUJUN_KNIFE_DAMAGE + 1), false);
                        DamageCalculator.applyDamage(target, damageResult, hero, gameState, true);
                        totalDamage += damageResult.finalDamage;
                    }
                    cr += stepR;
                    cc += stepC;
                }

                mask -= bit;
                reclaimed++;
            }
        });

        hero.counters[YOUJUN_KNIFE_MASK] = mask;

        if (reclaimed > 0 && gameState.battleLog) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威「归翎」，收回${reclaimed}柄飞刀，造成${totalDamage}点伤害`,
                timestamp: Date.now()
            });
        }
    }
};

export const huifengTianwei: TianweiSkill = {
    id: 'huifeng_tianwei',
    name: '天威',
    description: '对场上所有带连破标记的敌人造成4点伤害，并各施加一层连破',
    execute: (hero, gameState) => {
        executeHuifengTianwei(hero, gameState);
    }
};

export const changliTianwei: TianweiSkill = {
    id: 'changli_tianwei',
    name: '天威',
    description: '立即刷新一次被动（再获得一次复活机会）',
    execute: (hero) => {
        // 不给星火而是把被动充满：清掉"已用掉一次复活"的记账，下一次致命伤仍会被挡下。
        // 复活血量基准 changli_lastReviveHp 刻意保留，所以刷新后的这次只回到上一次的50%
        hero.counters['changli_revives'] = 0;
    }
};

/**
 * 创建英雄工厂函数
 */

export function createHero(
    heroId: string,
    owner: Player,
    position: [number, number] | null = null
): Hero {
    const heroTemplates: Record<string, Partial<Hero>> = {
        ...EXTENDED_HERO_TEMPLATES,
        moran: {
            name: '墨阑',
            class: '武曲',
            maxHp: 47,
            moveRange: 2,
            baseAttack: 0,
            skill1Id: 'moran_skill1',
            skill2Id: 'moran_skill2',
            passiveId: 'moran_passive',
            tianweiId: 'moran_tianwei',
        },
        zhenxiao: {
            name: '震霄',
            class: '武曲',
            maxHp: 46,
            moveRange: 2,
            baseAttack: 0,
            skill1Id: 'zhenxiao_skill1',
            skill2Id: 'zhenxiao_skill2',
            passiveId: 'zhenxiao_passive',
            tianweiId: 'zhenxiao_tianwei',
        },
        huifeng: {
            name: '回锋',
            class: '武曲',
            maxHp: 40,
            moveRange: 2,
            baseAttack: 0,
            skill1Id: 'huifeng_skill1',
            skill2Id: 'huifeng_skill2',
            passiveId: 'huifeng_passive',
            tianweiId: 'huifeng_tianwei',
        },
        wukong: {
            name: '孙悟空',
            class: '武曲',
            maxHp: 42,
            moveRange: 3,
            baseAttack: 0,
            skill1Id: 'wukong_skill1',
            skill2Id: 'wukong_skill2',
            passiveId: 'wukong_passive',
            tianweiId: 'wukong_tianwei',
        },
        xuanxiao: {
            name: '玄霄',
            class: '天师',
            maxHp: 45,
            moveRange: 3,
            skill1Id: 'xuanxiao_skill1',
            skill2Id: 'xuanxiao_skill2',
            passiveId: 'xuanxiao_passive',
        },
        liuli: {
            name: '琉璃',
            class: '霸魁',
            maxHp: 65,
            moveRange: 2,
            skill1Id: 'liuli_skill1',
            skill2Id: 'liuli_skill2',
            passiveId: 'liuli_passive',
        },
        baize: {
            name: '白泽',
            class: '素问',
            maxHp: 46,
            moveRange: 2,
            skill1Id: 'baize_skill1',
            skill2Id: 'baize_skill2',
            passiveId: 'baize_passive',
        },
        changli: {
            name: '长离',
            class: '化识',
            maxHp: 48,
            moveRange: 2,
            baseAttack: 0,
            skill1Id: 'changli_skill1',
            skill2Id: 'changli_skill2',
            passiveId: 'changli_passive',
            tianweiId: 'changli_tianwei',
        },
        mirror: {
            name: '镜',
            class: '武曲',
            maxHp: 40,
            moveRange: 3,
            baseAttack: 14,
            skill1Id: 'mirror_skill1',
            skill2Id: 'mirror_skill2',
            passiveId: 'mirror_passive',
            tianweiId: 'mirror_tianwei',
        },
        nightowl: {
            name: '暗影猎手·夜枭',
            class: '武曲',
            maxHp: 40,
            moveRange: 3,
            baseAttack: 0,
            skill1Id: 'nightowl_skill1',
            skill2Id: 'nightowl_skill2',
            passiveId: 'nightowl_passive',
            tianweiId: 'nightowl_tianwei',
        },
        mowen: {
            name: '时光剑客·莫问',
            class: '武曲',
            maxHp: 42,
            moveRange: 3,
            baseAttack: 0,
            skill1Id: 'mowen_skill1',
            skill2Id: 'mowen_skill2',
            passiveId: 'mowen_passive',
            tianweiId: 'mowen_tianwei',
        },
        guying: {
            name: '孤影',
            class: '武曲',
            maxHp: 41,
            moveRange: 2,
            baseAttack: 0,
            skill1Id: 'guying_skill1',
            skill2Id: 'guying_skill2',
            passiveId: 'guying_passive',
            tianweiId: 'guying_tianwei',
        },
        hanjiangxue: {
            name: '寒江雪',
            class: '天师',
            maxHp: 40,
            moveRange: 2,
            baseAttack: 0,
            skill1Id: 'hanjiangxue_skill1',
            skill2Id: 'hanjiangxue_skill2',
            passiveId: 'hanjiangxue_passive',
            tianweiId: 'hanjiangxue_tianwei',
        },
    };

    const template = heroTemplates[heroId];
    if (!template) {
        throw new Error(`Unknown hero: ${heroId}`);
    }

    const hero: Hero = {
        id: `${heroId}-${owner}-${Date.now()}`,
        name: template.name!,
        class: template.class!,
        maxHp: template.maxHp!,
        currentHp: template.maxHp!,
        moveRange: template.moveRange!,
        baseAttack: template.baseAttack,
        position,
        state: HeroState.ALIVE,
        owner,
        skill1Id: template.skill1Id!,
        skill2Id: template.skill2Id!,
        passiveId: template.passiveId!,
        tianweiId: template.tianweiId,
        effects: [],
        shield: 0,
        defense: 0,
        killCount: 0,
        hasActedThisTurn: false,
        hasMovedThisTurn: false,
        counters: {},
    };

    if (hero.name === '孙悟空') {
        if (hero.counters['灵犀'] === undefined) {
            hero.counters['灵犀'] = 0;
        }
        EffectManager.removeEffectByName(hero, '悟空暴击率');
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: '悟空暴击率',
            duration: -1,
            value: getWukongCritRate(hero),
            sourceHeroId: hero.id,
            description: '基础暴击率与灵犀叠加',
        });
    }

    if (hero.name === '时光剑客·莫问') {
        hero.counters['mowen_prev_hp'] = hero.maxHp;
        hero.counters['mowen_skill1_cd'] = 0;
    }

    if (hero.name === '孤影') {
        hero.counters['寒星'] = 0;
    }

    if (hero.name === '回锋') {
        hero.counters['破锋'] = 0;
    }

    if (hero.name === '玄霄') {
        hero.counters['xuanxiao_danger_armed'] = 0;
        hero.counters['xuanxiao_danger_used'] = 0;
    }

    if (hero.name === '长离') {
        hero.counters['暗夜星火'] = 0;
        hero.counters['changli_revives'] = 0;
    }

    initializeExtendedHero(hero);

    return hero;
}

/** 实例 id（`模板-player1-时间戳`）还原成模板 id；分身与召唤物还原不出来就还是自身 */
export function heroTemplateId(hero: { id: string }): string {
    return hero.id.replace(/-(player1|player2)-\d+$/, '');
}

/**
 * 把"武装"步骤选下的专属器写进英雄实例。权威账本是 playerNWeaponIds（模板 id → 武器 id），
 * 实例上的 weaponId 只是派生缓存：布阵撤下重选、补员上场、印月替身临时拉人都会重新
 * createHero，每次都必须按模板 id 重新派生，否则会出现"撤下再上阵就掉了武器"的静默失配。
 */
export function applyHeroWeapon<T extends { id: string; owner: Player; weaponId?: string | null }>(
    hero: T,
    weaponIds: Record<string, string | null> | undefined
): T {
    const templateId = heroTemplateId(hero);
    // 一器一主：值等于模板 id 才算启用，其余（含脏数据）一律视为未武装
    hero.weaponId = weaponIds?.[templateId] === templateId ? templateId : null;
    return hero;
}

/**
 * 暂时下架的英雄：机制、图鉴、特效、音效与测试全部保留，只是不进选将池。
 * AVAILABLE_HERO_IDS 是选将界面、英雄图鉴与 AI 选将的唯一入口，
 * 因此恢复上线只需把 id 从这个名单里删掉。
 */
export const HIDDEN_HERO_IDS = ['schrodinger', 'hero_x'];

export const AVAILABLE_HERO_IDS = ([
    'moran',
    'zhenxiao',
    'huifeng',
    'wukong',
    'xuanxiao',
    'nightowl',
    'liuli',
    'baize',
    'changli',
    'mirror',
    'mowen',
    'guying',
    'hanjiangxue',
    ...EXTENDED_HERO_IDS,
] as string[]).filter(id => !HIDDEN_HERO_IDS.includes(id));

// 获取英雄显示信息
export function getHeroInfo(heroId: string) {
    const infoMap: Record<string, { name: string; class: string; description: string }> = {
        moran: {
            name: '墨阑',
            class: '武曲',
            description: '多次出手，增加伤害。生命47，移动力2'
        },
        zhenxiao: {
            name: '震霄',
            class: '武曲',
            description: '耗血换伤、受击回吸。生命46，移动力2'
        },
        huifeng: {
            name: '回锋',
            class: '武曲',
            description: '连击爆发。生命40，移动力2'
        },
        wukong: {
            name: '孙悟空',
            class: '武曲',
            description: '分身爆发。生命42，移动力3'
        },
        xuanxiao: {
            name: '玄霄',
            class: '天师',
            description: '强化友方，令队友再次行动。生命45，移动力3'
        },
        nightowl: {
            name: '暗影猎手·夜枭',
            class: '武曲',
            description: '潜行刺杀。生命40，移动力3'
        },
        liuli: {
            name: '琉璃',
            class: '霸魁',
            description: '援护友军。生命65，移动力2'
        },
        baize: {
            name: '白泽',
            class: '素问',
            description: '单体恢复。生命46，移动力2'
        },
        changli: {
            name: '长离',
            class: '化识',
            description: '复活续航，单体爆发。生命48，移动力2'
        },
        mirror: {
            name: '镜',
            class: '武曲',
            description: '分身镜像，移形换影。生命40，移动力3'
        },
        mowen: {
            name: '时光剑客·莫问',
            class: '武曲',
            description: '回溯闪避。生命42，移动力3'
        },
        guying: {
            name: '孤影',
            class: '武曲',
            description: '寒天冻结，断雪贯穿。生命41，移动力2'
        },
        hanjiangxue: {
            name: '寒江雪',
            class: '天师',
            description: '群体寒天，地形冰晶。生命40，移动力2'
        },
    };

    return infoMap[heroId] || EXTENDED_HERO_INFO[heroId] || { name: '未知', class: '未知', description: '未知英雄' };
}
