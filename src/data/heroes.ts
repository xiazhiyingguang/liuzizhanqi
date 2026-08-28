import { Hero, HeroState, Player, PassiveSkill, TianweiSkill, Position, GameState, BattleLogEntry } from '../types/game';
import { EffectManager } from '../core/effect-manager';
import { DamageCalculator } from '../core/damage-calculator';
import { recordBattleDamage, recordBattleHealing, recordBattleKill } from '../core/battle-statistics';
import {
    EXTENDED_HERO_IDS,
    EXTENDED_HERO_INFO,
    EXTENDED_HERO_TEMPLATES,
    initializeExtendedHero,
    addDilanFeather,
    applyDilanWind,
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

function getWukongCritRate(hero: Hero): number {
    const lingxi = hero.counters['灵犀'] ?? 0;
    return Math.min(1, 0.2 + lingxi * 0.2);
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
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'system' as const,
                    player: hero.owner,
                    message: `${hero.name}的"为道"触发！获得额外行动机会${burstText}`,
                    timestamp: Date.now()
                };
                gameState.battleLog.push(logEntry);
            }
        }
    }
};

// 震霄被动："金银错"反击
export const zhenxiaoPassive: PassiveSkill = {
    id: 'zhenxiao_passive',
    name: '金银错',
    description: '受到敌方英雄造成的伤害后，进行回击，伤害为6，吸血50%',
    triggerOn: 'onDamaged',
    execute: (hero, gameState, context) => {
        // 检查是否处于"金银错"状态
        const hasJinyincuo = hero.effects.some(e => e.name === '金银错');
        if (!hasJinyincuo) {
            return;
        }

        // 检查攻击者是否存在且为敌方
        if (!context?.attacker) {
            return;
        }

        const attacker = context.attacker;

        if (attacker.owner === hero.owner) {
            return;
        }

        if (attacker.state !== HeroState.ALIVE) {
            return;
        }

        const counterDamage = 6;

        // 计算实际伤害（考虑护盾和防御）
        let finalDamage = counterDamage;
        let shieldDamage = 0;

        // 先扣除护盾
        if (attacker.shield > 0) {
            const shieldAbsorb = Math.min(attacker.shield, finalDamage);
            attacker.shield -= shieldAbsorb;
            finalDamage -= shieldAbsorb;
            shieldDamage = shieldAbsorb;
        }
        if (shieldDamage > 0) recordBattleDamage(gameState, hero, attacker, 0, shieldDamage);

        // 再计算防御减免
        if (finalDamage > 0 && attacker.defense > 0) {
            finalDamage = Math.max(1, finalDamage * (1 - attacker.defense / 100));
        }

        // 扣除生命值
        if (finalDamage > 0) {
            const hpBeforeDamage = attacker.currentHp;
            attacker.currentHp = Math.max(0, attacker.currentHp - finalDamage);
            const actualHpDamage = Math.min(hpBeforeDamage, Math.floor(finalDamage));
            recordBattleDamage(gameState, hero, attacker, actualHpDamage);

            // 吸血50%
            const healAmount = Math.floor(finalDamage * 0.5);
            const hpBeforeHeal = hero.currentHp;
            hero.currentHp = Math.min(hero.maxHp, hero.currentHp + healAmount);
            const actualHealing = hero.currentHp - hpBeforeHeal;
            recordBattleHealing(gameState, hero, actualHealing);

            // 添加日志
            if (gameState.battleLog) {
                const logEntry = {
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'passive' as const,
                    player: hero.owner,
                    message: `${hero.name}反击${attacker.name}，造成${Math.floor(finalDamage)}点伤害，回复${healAmount}点生命`,
                    timestamp: Date.now()
                };
                gameState.battleLog.push(logEntry);
            }

            // 检查是否击杀
            if (attacker.currentHp <= 0 && attacker.state === HeroState.ALIVE) {
                attacker.state = HeroState.DEAD;
                hero.killCount++;
                recordBattleKill(gameState, hero, attacker);

                // 从棋盘上移除
                const [row, col] = attacker.position;
                if (gameState.board[row] && gameState.board[row][col] === attacker) {
                    gameState.board[row][col] = null;
                }
            }
        }
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
                    id: `log-${Date.now()}-${Math.random()}`,
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
    description: '每个分身阵亡，增加1点灵犀，提升暴击率',
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
                id: `log-${Date.now()}-${Math.random()}`,
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
    description: '攻击带有连破的目标时叠加锋鸣，3层自动释放连刃斩',
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
    description: '拥有足够暗夜星火时可以复生，最多复生3次',
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
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威！获得额外行动机会`,
                timestamp: Date.now()
            };
            gameState.battleLog.push(logEntry);
        }
    }
};

// 震霄天威：吸取周围生命
export const zhenxiaoTianwei: TianweiSkill = {
    id: 'zhenxiao_tianwei',
    name: '天威',
    description: '吸取周围一格范围内(3x3)的敌人数量*4的生命值',
    execute: (hero, gameState) => {
        if (!hero.position) return;

        const [row, col] = hero.position;
        // 3x3范围，包括对角线方向
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],  // 上方一排
            [0, -1], [0, 1],   // 左右（不包括自己）
            [1, -1], [1, 0], [1, 1]    // 下方一排
        ];

        let enemyCount = 0;
        const enemies: Hero[] = [];

        // 查找周围一格内(3x3)的敌人
        for (const [dr, dc] of directions) {
            const newRow = row + dr;
            const newCol = col + dc;

            if (newRow >= 0 && newRow < 6 && newCol >= 0 && newCol < 6) {
                const target = gameState.board[newRow][newCol];
                if (target && target.owner !== hero.owner && target.state === HeroState.ALIVE) {
                    enemyCount++;
                    enemies.push(target);
                }
            }
        }

        if (enemyCount > 0) {
            const totalDrain = enemyCount * 4;
            const drainPerEnemy = Math.floor(totalDrain / enemyCount);
            let totalHealed = 0;

            DamageCalculator.asOneAttack(() => {
                for (const enemy of enemies) {
                    const dmg = DamageCalculator.calculate(hero, enemy, drainPerEnemy, false, true);
                    DamageCalculator.applyDamage(enemy, dmg, hero, gameState, true);
                    totalHealed += dmg.hpDamage;
                }
            });

            // 恢复生命
            DamageCalculator.applyHeal(hero, totalHealed, gameState, hero);

            // 添加日志
            if (gameState.battleLog) {
                const logEntry = {
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'tianwei' as const,
                    player: hero.owner,
                    message: `${hero.name}天威吸取周围${enemyCount}个敌人，造成${totalDrain}点伤害，回复${totalHealed}点生命`,
                    timestamp: Date.now()
                };
                gameState.battleLog.push(logEntry);
            }
        }
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
                    id: `log-${Date.now()}-${Math.random()}`,
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
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'tianwei' as const,
                    player: hero.owner,
                    message: `${hero.name}的天威未生效：周围没有空位召唤分身`,
                    timestamp: Date.now()
                });
            }
            return;
        }

        const clone = createWukongClone(hero.owner, hero.id, summonPos, 10);
        gameState.board[summonPos[0]][summonPos[1]] = clone;

        if (hero.counters['灵犀'] === undefined) {
            hero.counters['灵犀'] = 0;
        }
        syncWukongCritToSelfAndClones(hero, gameState);

        if (gameState.battleLog) {
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
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
        if (!EffectManager.hasEffect(hero, '潜行')) {
            EffectManager.addEffect(hero, {
                type: 'buff',
                name: '潜行',
                duration: -1, 
                sourceHeroId: hero.id,
                description: '潜行状态，免疫单体伤害，范围伤害每回合最多10点'
            });
            hero.counters['stealth_turns'] = 1;
        } else {
            hero.counters['stealth_turns'] = (hero.counters['stealth_turns'] || 1) + 1;
        }

        // 下次攻击无视50%防御
        hero.counters['ignore_defense_next'] = 1;

        if (gameState.battleLog) {
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
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
    description: '获得破镜之刃后立即释放，对范围内血量最低的敌人造成伤害',
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
        hero.counters['破镜之刃'] += 3;
        
        if (gameState.battleLog) {
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威，获得3层破镜之刃`,
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
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威，回复${healed}点生命`,
                timestamp: Date.now()
            });
        }
    }
};

export const guyingTianwei: TianweiSkill = {
    id: 'guying_tianwei',
    name: '天威',
    description: '回收直线与对角线上的剑影，对沿途敌人造成伤害',
    execute: (hero: Hero, gameState: GameState) => {
        if (!hero.position) return;

        const mask = hero.counters['guying_sword_shadow_mask'] || 0;
        if (!mask) return;

        const [hr, hc] = hero.position;
        let remainingMask = mask;
        let reclaimed = 0;
        let totalDamage = 0;

        const getBit = (idx: number) => Math.pow(2, idx);
        const hasBit = (m: number, b: number) => Math.floor(m / b) % 2 === 1;

        DamageCalculator.asOneAttack(() => {
            for (let idx = 0; idx < 36; idx++) {
                const bit = getBit(idx);
                if (!hasBit(remainingMask, bit)) continue;

                const sr = Math.floor(idx / 6);
                const sc = idx % 6;

                const drRaw = hr - sr;
                const dcRaw = hc - sc;
                const isSameRow = sr === hr;
                const isSameCol = sc === hc;
                const isDiag = Math.abs(drRaw) === Math.abs(dcRaw) && drRaw !== 0;
                if (!isSameRow && !isSameCol && !isDiag) continue;

                const stepR = drRaw === 0 ? 0 : (drRaw > 0 ? 1 : -1);
                const stepC = dcRaw === 0 ? 0 : (dcRaw > 0 ? 1 : -1);

                let cr = sr;
                let cc = sc;
                while (cr !== hr || cc !== hc) {
                    const target = gameState.board[cr][cc];
                    if (target && target.owner !== hero.owner && target.state === HeroState.ALIVE) {
                        const damageResult = DamageCalculator.calculate(hero, target, 4, false);
                        DamageCalculator.applyDamage(target, damageResult, hero, gameState, true);
                        totalDamage += damageResult.finalDamage;
                    }
                    cr += stepR;
                    cc += stepC;
                }

                remainingMask -= bit;
                reclaimed++;
            }
        });

        hero.counters['guying_sword_shadow_mask'] = remainingMask;

        if (reclaimed > 0 && gameState.battleLog) {
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'tianwei' as const,
                player: hero.owner,
                message: `${hero.name}触发天威，回收${reclaimed}道剑影，造成${totalDamage}点伤害`,
                timestamp: Date.now()
            });
        }
    }
};

export const huifengTianwei: TianweiSkill = {
    id: 'huifeng_tianwei',
    name: '天威',
    description: '在周围四格留下持续3回合的刃痕',
    execute: (hero, gameState) => {
        if (!hero.position) return;
        gameState.boardEffects ??= [];
        const [row, col] = hero.position;
        const positions: Position[] = [
            [row - 1, col],
            [row + 1, col],
            [row, col - 1],
            [row, col + 1]
        ].filter(([r, c]) => r >= 0 && r < 6 && c >= 0 && c < 6) as Position[];
        for (const position of positions) {
            gameState.boardEffects.push({
                id: `blade-mark-${Date.now()}-${Math.random()}`,
                type: 'blade-mark',
                position,
                owner: hero.owner,
                sourceHeroId: hero.id,
                duration: 3
            });
        }
    }
};

export const changliTianwei: TianweiSkill = {
    id: 'changli_tianwei',
    name: '天威',
    description: '立即获得4层暗夜星火',
    execute: (hero) => {
        EffectManager.addCounter(hero, '暗夜星火', 4);
    }
};

/**
 * 游隼天威「裂空」：击杀敌人后，对死亡格所在整行与整列的其余敌人造成5点伤害，
 * 并各施加1层羽化与1层逆风（羽化联动帝兰的引爆与南风的移动伤害）。
 */
export const youjunTianwei: TianweiSkill = {
    id: 'youjun_tianwei',
    name: '天威',
    description: '击杀敌人后，对死亡格所在整行与整列的其余敌人造成5点伤害，并各施加1层羽化与1层逆风。',
    execute: (hero, gameState) => {
        const code = hero.counters['__youjun_kill_pos'];
        if (code === undefined || !hero.position) return;
        const dr = Math.floor(code / 6);
        const dc = code % 6;
        const enemies = (hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes)
            .filter(e => e.state === HeroState.ALIVE && !!e.position);
        const affected: Hero[] = [];
        for (const target of enemies) {
            const [tr, tc] = target.position!;
            if ((tr === dr || tc === dc) && !(tr === dr && tc === dc)) {
                affected.push(target);
            }
        }
        DamageCalculator.asOneAttack(() => {
            for (const target of affected) {
                const dmg = DamageCalculator.calculate(hero, target, 5, false, false, { canCrit: true });
                DamageCalculator.applyDamage(target, dmg, hero, gameState);
                addDilanFeather(target, hero);
                applyDilanWind(target, hero, '逆风');
            }
        });
        if (affected.length > 0 && gameState.battleLog) {
            const entry: BattleLogEntry = {
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'tianwei',
                player: hero.owner,
                message: `${hero.name}触发天威·裂空，十字上的${affected.length}名敌人受到5点伤害并被施加羽化与逆风`,
                timestamp: Date.now(),
            };
            gameState.battleLog.push(entry);
        }
    },
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
            maxHp: 42,
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
            class: '猎户',
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
        hero.counters['guying_sword_shadow_mask'] = 0;
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

export const AVAILABLE_HERO_IDS = [
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
];

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
            description: '反击吸血。生命46，移动力2'
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
            class: '猎户',
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
            description: '复活续航。生命42，移动力2'
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
            description: '寒天冻结，剑影回收。生命41，移动力2'
        },
        hanjiangxue: {
            name: '寒江雪',
            class: '天师',
            description: '群体寒天，地形冰晶。生命40，移动力2'
        },
    };

    return infoMap[heroId] || EXTENDED_HERO_INFO[heroId] || { name: '未知', class: '未知', description: '未知英雄' };
}
