import { Skill, Hero, GameState, SkillExecuteResult, HeroState, Position } from '../types/game';
import { DamageCalculator } from '../core/damage-calculator';
import { EffectManager } from '../core/effect-manager';
import { GameEngine } from '../core/game-engine';
import { createMirrorClone, getMirrorOwnerIdFromCloneId } from '../data/heroes';
import { MovementSystem } from '../core/movement-system';
import { EXTENDED_SKILLS } from './extended-skills';

/**
 * 墨阑的技能
 */

function getAliveAllies(gameState: GameState, owner: Hero['owner']): Hero[] {
    const allies = owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    return allies.filter(h => h.state === HeroState.ALIVE);
}

function getLowestHpAlly(gameState: GameState, owner: Hero['owner']): Hero | null {
    const allies = getAliveAllies(gameState, owner);
    if (allies.length === 0) return null;
    let best = allies[0];
    for (const h of allies) {
        if (h.currentHp < best.currentHp) best = h;
    }
    return best;
}

function getDeadAllies(gameState: GameState, owner: Hero['owner']): Hero[] {
    const allies = owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    return allies.filter(h => h.state === HeroState.DEAD);
}

export const baizeSkill1: Skill = {
    id: 'baize_skill1',
    name: '技能1',
    type: 'heal',
    description: '恢复我方血量最低单位生命，为目标+1白泽之力，自身+1天禄',
    rangeType: '全场',
    range: 6,
    targetType: 'any',
    targetCount: 1,
    execute: (caster: Hero, _targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        const target = getLowestHpAlly(gameState, caster.owner);
        if (!target) {
            result.success = false;
            result.log.push(`${caster.name}没有找到可治疗目标`);
            return result;
        }

        const power = EffectManager.getCounter(target, '白泽之力');
        const bonus = Math.min(0.5, power * 0.1);
        const healAmount = Math.floor(8 * (1 + bonus));
        const actualHeal = DamageCalculator.applyHeal(target, healAmount, gameState, caster);

        EffectManager.addCounter(target, '白泽之力', 1);
        EffectManager.addCounter(caster, '天禄', 1);

        result.healingDone?.push(actualHeal);
        result.log.push(`${caster.name}恢复${target.name}${actualHeal}点生命，${target.name}白泽之力+1，${caster.name}天禄+1`);
        return result;
    }
};

export const baizeSkill2: Skill = {
    id: 'baize_skill2',
    name: '技能2',
    type: 'special',
    description: '天禄不足时治疗；天禄充足时消耗复活阵亡单位',
    rangeType: '全场',
    range: 6,
    targetType: 'any',
    targetCount: 1,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        const tianlu = EffectManager.getCounter(caster, '天禄');

        if (tianlu >= 3) {
            const deadAllies = getDeadAllies(gameState, caster.owner);
            if (deadAllies.length > 0) {
                const requestedTarget = targets.find(
                    target => target.owner === caster.owner && target.state === HeroState.DEAD
                );
                const candidates = requestedTarget
                    ? [requestedTarget]
                    : deadAllies;
                let reviveTarget: Hero | null = null;
                for (const target of candidates) {
                    if (!GameEngine.reviveDeadHero(target, 0.5, caster, gameState)) continue;
                    reviveTarget = target;
                    break;
                }

                if (reviveTarget) {
                    EffectManager.consumeCounter(caster, '天禄', 3);
                    result.log.push(`${caster.name}消耗3层天禄，复活了${reviveTarget.name}`);
                    return result;
                } else {
                    result.success = false;
                    result.log.push(`${caster.name}无法复活任何目标（可能无空位）`);
                    return result;
                }
            }

            EffectManager.addCounter(caster, '天禄', 1);
        }

        const target = getLowestHpAlly(gameState, caster.owner);
        if (!target) {
            result.success = false;
            result.log.push(`${caster.name}没有找到可治疗目标`);
            return result;
        }

        const power = EffectManager.getCounter(target, '白泽之力');
        const healAmount = Math.floor((caster.currentHp / 3) * (1 + power / 10));
        const actualHeal = DamageCalculator.applyHeal(target, healAmount, gameState, caster);

        result.healingDone?.push(actualHeal);
        result.log.push(`${caster.name}恢复${target.name}${actualHeal}点生命`);
        return result;
    }
};

export const wukongSkill1: Skill = {
    id: 'wukong_skill1',
    name: '技能1',
    type: 'summon',
    description: '在周围一格内释放一个分身',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'any',
    targetCount: 1,
};

export const wukongSkill2: Skill = {
    id: 'wukong_skill2',
    name: '技能2',
    type: 'special',
    description: '释放前只能移动一格，然后对一格内的一名敌人造成8伤害；分身可分别选择目标',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 8,
    scalesWithAttack: true,
    canCrit: true,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        void gameState;
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}的技能2没有找到目标`);
            return result;
        }

        const target = targets[0];
        const damageResult = DamageCalculator.calculate(caster, target, 8, true);
        DamageCalculator.applyDamage(target, damageResult, caster, gameState);

        result.damageDealt?.push(damageResult.finalDamage);
        result.log.push(
            `${caster.name}使用技能2对${target.name}造成${damageResult.finalDamage}点伤害${damageResult.isCrit ? '(暴击!)' : ''}`
        );

        if (damageResult.killed) {
            result.log.push(`${target.name}被击杀！`);
        }

        return result;
    }
};

function executeHuifengCombo(
    caster: Hero,
    target: Hero,
    gameState: GameState,
    triggerPassive: boolean
): SkillExecuteResult {
    const result: SkillExecuteResult = {
        success: true,
        damageDealt: [],
        healingDone: [],
        effectsApplied: [],
        triggeredPassives: [],
        log: []
    };

    for (let hit = 1; hit <= 3; hit++) {
        if (target.state !== HeroState.ALIVE) break;
        const stacks = EffectManager.getCounter(caster, '破锋');
        const baseDamage = Math.floor(4 * (1 + stacks * 0.1));
        const damage = DamageCalculator.calculate(caster, target, baseDamage, false);
        DamageCalculator.applyDamage(target, damage, caster, gameState);
        result.damageDealt?.push(damage.finalDamage);
        EffectManager.addCounter(caster, '破锋', 1);
        result.log.push(`${caster.name}第${hit}段攻击对${target.name}造成${damage.finalDamage}点伤害，破锋+1`);
    }

    const linked = target.effects.find(
        effect => effect.name === '连破' && effect.sourceHeroId === caster.id
    );
    if (triggerPassive && linked && target.state === HeroState.ALIVE) {
        EffectManager.addEffect(target, {
            type: 'mark',
            name: '锋鸣',
            duration: 1,
            stackCount: 1,
            sourceHeroId: caster.id,
            description: '达到3层时触发连刃斩'
        });
        const fengming = target.effects.find(
            effect => effect.name === '锋鸣' && effect.sourceHeroId === caster.id
        );
        if ((fengming?.stackCount ?? 0) >= 3) {
            target.effects = target.effects.filter(effect => effect !== fengming);
            const bonus = executeHuifengCombo(caster, target, gameState, false);
            result.damageDealt?.push(...(bonus.damageDealt ?? []));
            result.log.push(`${caster.name}触发锋鸣，自动释放连刃斩`, ...bonus.log);
        }
    }

    return result;
}

export const huifengSkill1: Skill = {
    id: 'huifeng_skill1',
    name: '连刃斩',
    type: 'damage',
    description: '对一格内敌人进行3段攻击，每段4点伤害，每段获得1层破锋',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 4,
    scalesWithAttack: false,
    canCrit: true,
    execute: (caster, targets, gameState) => {
        if (!targets[0]) return { success: false, log: [`${caster.name}没有找到目标`] };
        return executeHuifengCombo(caster, targets[0], gameState, true);
    }
};

export const huifengSkill2: Skill = {
    id: 'huifeng_skill2',
    name: '留痕',
    type: 'special',
    description: '跳到相邻空位，在原地留下持续3回合的刃痕',
    rangeType: 'cross',
    range: 1,
    targetType: 'empty',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        const encoded = caster.counters['__huifeng_skill2_target'];
        if (encoded === undefined || !caster.position) {
            return { success: false, log: [`${caster.name}没有选择跳跃位置`] };
        }
        const target: Position = [Math.floor(encoded / 6), encoded % 6];
        const from: Position = [...caster.position];
        if (MovementSystem.getManhattanDistance(from, target) !== 1) {
            return { success: false, log: ['只能跳跃到相邻一格'] };
        }
        if (!MovementSystem.moveHero(caster, target, gameState)) {
            return { success: false, log: ['目标位置不可到达'] };
        }
        if (caster.state !== HeroState.ALIVE) {
            return { success: true, log: [`${caster.name}在跳跃中触发羽化伤害并阵亡`] };
        }
        caster.hasMovedThisTurn = true;
        gameState.boardEffects ??= [];
        gameState.boardEffects.push({
            id: `blade-mark-${Date.now()}-${Math.random()}`,
            type: 'blade-mark',
            position: from,
            owner: caster.owner,
            sourceHeroId: caster.id,
            duration: 3
        });
        return {
            success: true,
            log: [`${caster.name}跳跃到(${target[0] + 1},${target[1] + 1})，并在原地留下刃痕`]
        };
    }
};

export const xuanxiaoSkill1: Skill = {
    id: 'xuanxiao_skill1',
    name: '玄光加持',
    type: 'buff',
    description: '使两格内一名友方攻击、暴击率和暴伤各提升20%，持续2回合',
    rangeType: 'single',
    range: 2,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets) => {
        const target = targets[0];
        if (!target) return { success: false, log: [`${caster.name}没有找到友方目标`] };
        for (const [name, value] of [
            ['玄霄攻击提升', 0.2],
            ['玄霄暴击率提升', 0.2],
            ['玄霄暴伤提升', 0.2]
        ] as const) {
            EffectManager.removeEffectByName(target, name);
            EffectManager.addEffect(target, {
                type: 'buff',
                name,
                duration: 2,
                value,
                sourceHeroId: caster.id,
                description: '玄霄的强化效果'
            });
        }
        return { success: true, log: [`${caster.name}强化了${target.name}`] };
    }
};

export const xuanxiaoSkill2: Skill = {
    id: 'xuanxiao_skill2',
    name: '再动',
    type: 'special',
    description: '令一格内一名友方英雄立即行动一次',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target || target.state !== HeroState.ALIVE) {
            return { success: false, log: [`${caster.name}没有找到可再动的友方`] };
        }
        target.counters['__extra_preActed'] = target.hasActedThisTurn ? 1 : 0;
        target.counters['__extra_preMoved'] = target.hasMovedThisTurn ? 1 : 0;
        gameState.pendingExtraActionHeroIds ??= {};
        gameState.pendingExtraActionHeroIds[target.owner] = target.id;
        return { success: true, log: [`${caster.name}令${target.name}立即再动`] };
    }
};

export const changliSkill1: Skill = {
    id: 'changli_skill1',
    name: '暗夜燎原',
    type: 'damage',
    description: '对敌方所有单位造成3点伤害，每命中一人获得1层暗夜星火',
    rangeType: '全场',
    range: 6,
    targetType: 'enemy',
    targetCount: 'all',
    baseDamage: 3,
    scalesWithAttack: false,
    execute: (caster, targets, gameState) => {
        void targets;
        // 技能为全场技能：直接命中场上所有存活敌人，而不是只命中点击位置
        const enemies = (caster.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes)
            .filter(hero => hero.state === HeroState.ALIVE);
        const result: SkillExecuteResult = { success: true, damageDealt: [], log: [] };
        if (enemies.length === 0) return { success: false, log: [`${caster.name}没有找到敌人`] };
        for (const target of enemies) {
            const damage = DamageCalculator.calculate(caster, target, 3, false);
            DamageCalculator.applyDamage(target, damage, caster, gameState, true);
            result.damageDealt?.push(damage.finalDamage);
        }
        EffectManager.addCounter(caster, '暗夜星火', enemies.length);
        result.log.push(`${caster.name}攻击${enemies.length}名敌人，获得${enemies.length}层暗夜星火`);
        return result;
    }
};

export const changliSkill2: Skill = {
    id: 'changli_skill2',
    name: '星火贯日',
    type: 'damage',
    description: '攻击同行或同列敌人，基础8伤害，每层暗夜星火+10%、每格距离+10%；可消耗2层尝试眩晕',
    rangeType: 'line',
    range: 5,
    targetType: 'enemy',
    targetCount: 1,
    scalesWithAttack: false,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target || !caster.position || !target.position) {
            return { success: false, log: [`${caster.name}没有找到直线目标`] };
        }
        const sameLine =
            caster.position[0] === target.position[0] ||
            caster.position[1] === target.position[1];
        if (!sameLine) return { success: false, log: ['目标必须与长离处于同行或同列'] };
        const starfire = EffectManager.getCounter(caster, '暗夜星火');
        if (starfire <= 0) return { success: false, log: ['暗夜星火不足，无法造成伤害'] };
        const distance = MovementSystem.getManhattanDistance(caster.position, target.position);
        // 每层暗夜星火 +10% 伤害，每格距离 +10% 伤害
        const baseDamage = Math.floor(8 * (1 + starfire * 0.1) * (1 + distance * 0.1));
        const damage = DamageCalculator.calculate(caster, target, baseDamage, false);
        DamageCalculator.applyDamage(target, damage, caster, gameState);
        let stunText = '';
        if (caster.counters['__changli_empowered'] === 1 && starfire >= 2) {
            EffectManager.addCounter(caster, '暗夜星火', -2);
            if (Math.random() < 0.5 && target.state === HeroState.ALIVE) {
                EffectManager.addEffect(target, {
                    type: 'stun',
                    name: '眩晕',
                    // 行动中施加：已行动的目标剥夺下回合（2），未行动的目标剥夺本回合（1），恰好1次行动
                    duration: target.hasActedThisTurn ? 2 : 1,
                    sourceHeroId: caster.id,
                    description: '停止行动一回合'
                });
                stunText = '并造成眩晕';
            }
        }
        return {
            success: true,
            damageDealt: [damage.finalDamage],
            log: [`${caster.name}对${target.name}造成${damage.finalDamage}点伤害${stunText}`]
        };
    }
};

// 墨阑技能1：十字10伤害，进入"为道"状态
export const moranSkill1: Skill = {
    id: 'moran_skill1',
    name: '技能1',
    type: 'damage',
    description: '对周围十字范围内的一人造成10点伤害，使自身进入"为道"状态',
    rangeType: 'cross',
    range: 1,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 10,
    scalesWithAttack: false,
    canCrit: true,

    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        void targets;
        void gameState;
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}的技能1没有找到目标`);
            return result;
        }

        const target = targets[0];

        // 计算伤害
        // 致知2："为道"解除后的立即出手，技能伤害提升40%（一次性消耗）
        let skillDamage = 10;
        let burstText = '';
        if (caster.counters['talent_2'] && caster.counters['__weidao_burst']) {
            skillDamage = Math.floor(skillDamage * 1.4);
            delete caster.counters['__weidao_burst'];
            burstText = '（为道爆发+40%）';
        }
        const damageResult = DamageCalculator.calculate(caster, target, skillDamage, false);
        DamageCalculator.applyDamage(target, damageResult, caster, gameState);

        result.damageDealt?.push(damageResult.finalDamage);
        result.log.push(
            `${caster.name}使用技能1对${target.name}造成${damageResult.finalDamage}点伤害${damageResult.isCrit ? '(暴击!)' : ''}${burstText}`
        );

        if (damageResult.killed) {
            result.log.push(`${target.name}被击杀！`);
        }

        // 施加"为道"状态（如果还没有的话）
        const hasWeidao = caster.effects.some(e => e.name === '为道');
        if (!hasWeidao) {
            EffectManager.addEffect(caster, {
                type: 'buff',
                name: '为道',
                duration: -1, // 持续到被触发
                sourceHeroId: caster.id,
                description: '受到两次攻击后立即行动一次'
            });
            // 初始化计数器（只在首次进入为道状态时）
            if (caster.counters['为道受击'] === undefined) {
                EffectManager.setCounter(caster, '为道受击', 0);
            }
            result.log.push(`${caster.name}进入"为道"状态`);
        } else {
            result.log.push(`${caster.name}保持"为道"状态`);
        }

        return result;
    }
};

// 墨阑技能2：十字15伤害
export const moranSkill2: Skill = {
    id: 'moran_skill2',
    name: '技能2',
    type: 'damage',
    description: '对周围十字范围内的一人造成15点伤害',
    rangeType: 'cross',
    range: 1,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 15,
    scalesWithAttack: false,
    canCrit: true,

    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        void targets;
        void gameState;
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}的技能2没有找到目标`);
            return result;
        }

        const target = targets[0];

        // 计算伤害
        // 基础伤害设为15，不随攻击力变化
        // 致知2："为道"解除后的立即出手，技能伤害提升40%（一次性消耗）
        let skillDamage = 15;
        let burstText = '';
        if (caster.counters['talent_2'] && caster.counters['__weidao_burst']) {
            skillDamage = Math.floor(skillDamage * 1.4);
            delete caster.counters['__weidao_burst'];
            burstText = '（为道爆发+40%）';
        }
        const damageResult = DamageCalculator.calculate(caster, target, skillDamage, false);
        DamageCalculator.applyDamage(target, damageResult, caster, gameState);

        result.damageDealt?.push(damageResult.finalDamage);
        result.log.push(
            `${caster.name}使用技能2对${target.name}造成${damageResult.finalDamage}点伤害${damageResult.isCrit ? '(暴击!)' : ''}${burstText}`
        );

        if (damageResult.killed) {
            result.log.push(`${target.name}被击杀！`);
        }

        return result;
    }
};

/**
 * 震霄的技能
 */

// 震霄技能1：消耗20%生命，直线攻击造成8伤害
export const zhenxiaoSkill1: Skill = {
    id: 'zhenxiao_skill1',
    name: '技能1',
    type: 'damage',
    description: '消耗当前生命20%，对一个方向造成8点伤害',
    rangeType: 'line', // 实际上是特殊范围，但在UI上可能复用line的选择逻辑
    range: 1, // 距离1
    targetType: 'enemy',
    targetCount: 'all',
    baseDamage: 8,
    scalesWithAttack: false,

    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        void targets;
        void gameState;
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        // 消耗生命
        const hpCost = Math.floor(caster.currentHp * 0.2);
        caster.currentHp = Math.max(1, caster.currentHp - hpCost);
        result.log.push(`${caster.name}消耗了${hpCost}点生命`);

        for (const target of targets) {
            const damageResult = DamageCalculator.calculate(caster, target, 8, false);
            DamageCalculator.applyDamage(target, damageResult, caster, gameState, true);

            result.damageDealt?.push(damageResult.finalDamage);
            result.log.push(`${caster.name}使用技能1对${target.name}造成${damageResult.finalDamage}点伤害`);

            if (damageResult.killed) {
                result.log.push(`${target.name}被击杀！`);
            }
        }

        return result;
    }
};

// 震霄技能2：形成束缚格，进入"金银错"状态
export const zhenxiaoSkill2: Skill = {
    id: 'zhenxiao_skill2',
    name: '技能2',
    type: 'special',
    description: '消耗当前生命20%，形成束缚格，进入"金银错"状态',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'any',
    targetCount: 'all',

    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        void targets;
        void gameState;
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        // 消耗生命
        const hpCost = Math.floor(caster.currentHp * 0.2);
        caster.currentHp = Math.max(1, caster.currentHp - hpCost);
        result.log.push(`${caster.name}消耗了${hpCost}点生命`);

        // 进入"金银错"状态
        EffectManager.removeEffectByName(caster, '金银错');
        EffectManager.addEffect(caster, {
            type: 'buff',
            name: '金银错',
            duration: -1,
            expireAtActionSerial: (caster.counters['__actionSerial'] ?? 0) + 2,
            sourceHeroId: caster.id,
            description: '受到伤害后进行回击，造成6点伤害并吸血50%'
        });

        result.log.push(`${caster.name}进入"金银错"状态`);

        return result;
    }
};

/**
 * 琉璃的技能
 */

// 琉璃技能1：援护周围一格范围内的所有友方
export const liuliSkill1: Skill = {
    id: 'liuli_skill1',
    name: '援护',
    type: 'buff',
    description: '援护周围一格范围内的友方受到的任意伤害一回，添加1"禅定"',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'ally',
    targetCount: 'all',

    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        void gameState;
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}没有找到可援护的目标`);
            return result;
        }

        for (const target of targets) {
            // 先移除目标身上旧的援护效果（如果有的话）
            target.effects = target.effects.filter(e => e.name !== '援护');

            // 添加援护标记
            // duration: -1 表示持续到琉璃下次出手时移除
            EffectManager.addEffect(target, {
                type: 'buff',
                name: '援护',
                duration: -1,  // 持续到琉璃下次出手
                sourceHeroId: caster.id,
                description: '受到的伤害由琉璃承担，直到琉璃下次行动'
            });
        }

        // 添加禅定
        EffectManager.addCounter(caster, '禅定', 1);

        result.log.push(`${caster.name}援护了${targets.length}名友方，获得1层禅定`);

        return result;
    }
};

// 琉璃技能2：消耗禅定恢复生命
export const liuliSkill2: Skill = {
    id: 'liuli_skill2',
    name: '禅悟',
    type: 'heal',
    description: '消耗所有禅定，每层恢复10%最大生命值，援护增加一回合',
    rangeType: 'single',
    range: 0,
    targetType: 'self',
    targetCount: 1,

    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        void targets;
        void gameState;
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        const zendingCount = EffectManager.getCounter(caster, '禅定');

        if (zendingCount === 0) {
            result.success = false;
            result.log.push(`${caster.name}没有禅定可消耗`);
            return result;
        }

        // 恢复生命
        const healAmount = Math.floor(caster.maxHp * 0.1 * zendingCount);
        const actualHeal = DamageCalculator.applyHeal(caster, healAmount, gameState);

        // 消耗禅定
        EffectManager.setCounter(caster, '禅定', 0);

        result.healingDone?.push(actualHeal);
        result.log.push(`${caster.name}使用技能2(禅悟)消耗${zendingCount}层禅定，恢复${actualHeal}点生命`);

        return result;
    }
};

// 暗影猎手·夜枭技能1：标记
export const nightowlSkill1: Skill = {
    id: 'nightowl_skill1',
    name: '死亡标记',
    type: 'debuff',
    description: '标记3格范围内的一个敌方单位，持续3回合，首次攻击必暴，击杀刷新',
    rangeType: 'single',
    range: 3,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}没有找到目标`);
            return result;
        }

        const target = targets[0];

        const allEnemies = caster.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
        for (const enemy of allEnemies) {
            EffectManager.removeEffectByName(enemy, '猎杀标记');
        }

        EffectManager.addEffect(target, {
            type: 'debuff',
            name: '猎杀标记',
            duration: 3,
            sourceHeroId: caster.id,
            description: '被夜枭标记，夜枭首次攻击必定暴击'
        });
        
        caster.counters['mark_first_hit_consumed'] = 0;

        if (!EffectManager.hasEffect(caster, '潜行')) {
            EffectManager.addEffect(caster, {
                type: 'buff',
                name: '潜行',
                duration: -1,
                sourceHeroId: caster.id,
                description: '潜行状态，免疫单体伤害，范围伤害每回合最多10点'
            });
            caster.counters['stealth_turns'] = 1;
        } else {
            caster.counters['stealth_turns'] = (caster.counters['stealth_turns'] || 1) + 1;
        }

        result.log.push(`${caster.name}标记了${target.name}`);
        return result;
    }
};

// 暗影猎手·夜枭技能2：潜行爆发
export const nightowlSkill2: Skill = {
    id: 'nightowl_skill2',
    name: '暗影突袭',
    type: 'damage',
    description: '潜行状态下对标记目标造成高额伤害，击杀保持潜行',
    rangeType: 'single',
    range: 3, 
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (targets.length === 0) {
            result.success = false;
            return result;
        }
        
        const target = targets[0];

        // 检查潜行
        if (!EffectManager.hasEffect(caster, '潜行')) {
            result.success = false;
            result.log.push(`${caster.name}未处于潜行状态，无法使用技能`);
            return result;
        }

        // 检查标记
        const mark = target.effects.find(e => e.name === '猎杀标记' && e.sourceHeroId === caster.id);
        if (!mark) {
            result.success = false;
            result.log.push(`${target.name}未被标记，无法使用技能`);
            return result;
        }

        // 计算伤害
        let baseDamage = 12;
        if (caster.counters['talent_2']) {
            baseDamage += 3;
        }
        
        const stealthTurns = caster.counters['stealth_turns'] || 0;
        const multiplier = 1 + stealthTurns * 0.2;
        const finalBaseDamage = Math.floor(baseDamage * multiplier);
        const damageResult = DamageCalculator.calculate(caster, target, finalBaseDamage, false);
        DamageCalculator.applyDamage(target, damageResult, caster, gameState);

        EffectManager.removeEffectByName(caster, '潜行');
        caster.counters['stealth_turns'] = 0;
        caster.counters['stealth_damage_taken'] = 0;

        result.damageDealt?.push(damageResult.finalDamage);
        result.log.push(`${caster.name}对${target.name}造成${damageResult.finalDamage}点伤害`);

        if (damageResult.killed) {
            result.log.push(`${target.name}被击杀！`);
            // 标记特殊状态：击杀保持潜行 (已在 onAttack 中处理)
        }

        return result;
    }
};

export const mirrorSkill1: Skill = {
    id: 'mirror_skill1',
    name: '开锋',
    type: 'summon',
    description: '在中心对称位置召唤镜像，将当前生命值分为一半给本体与镜像，本体与镜像各恢复4点生命值。若当前生命值超过20，获得1层破镜之刃（立即释放）',
    rangeType: '全场',
    range: 0,
    targetType: 'self',
    targetCount: 0,
    execute: (caster: Hero, _targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (!caster.position) {
            result.success = false;
            return result;
        }

        const [r, c] = caster.position;
        const targetR = 5 - r;
        const targetC = 5 - c;
        const targetPos: Position = [targetR, targetC];

        if (gameState.board[targetR][targetC] !== null) {
            result.success = false;
            result.log.push(`${caster.name}召唤失败：目标位置已有单位`);
            return result;
        }

        const splitHp = Math.max(1, Math.floor(caster.currentHp / 2));
        caster.currentHp = splitHp;

        // 召唤镜像
        const clone = createMirrorClone(caster.owner, caster.id, targetPos, caster.maxHp, splitHp);
        gameState.board[targetR][targetC] = clone;
        result.log.push(`${caster.name}在(${targetR},${targetC})召唤了镜像`);

        // 本体和镜像各恢复4点生命
        const healAmount = 4;
        const casterHeal = DamageCalculator.applyHeal(caster, healAmount, gameState, caster);
        const cloneHeal = DamageCalculator.applyHeal(clone, healAmount, gameState, caster);
        
        result.healingDone?.push(casterHeal);
        result.log.push(`${caster.name}恢复了${casterHeal}点生命，镜像恢复了${cloneHeal}点生命`);

        // 判断破镜之刃条件 (当前生命 > 20)
        if (caster.currentHp > 20) {
            EffectManager.addCounter(caster, '破镜之刃', 1);
            result.log.push(`${caster.name}生命值(${caster.currentHp})高于20，获得1层破镜之刃`);
        }

        DamageCalculator.triggerMirrorBrokenBlade(caster, gameState);
        return result;
    }
};

export const mirrorSkill2: Skill = {
    id: 'mirror_skill2',
    name: '移形换影',
    type: 'damage',
    description: '点击镜像：交换位置并对路径敌人造成10+攻击伤害，不收回镜像获得1层破镜之刃；点击本体：划伤路径敌人，收回镜像使生命合体并恢复12点（允许溢出）',
    rangeType: '全场',
    range: 100,
    targetType: 'any',
    targetCount: 1,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        const target = targets[0];
        if (!target) {
            result.success = false;
            return result;
        }

        const isTargetSelf = target.id === caster.id;
        const isTargetClone = target.counters?.['__isClone'] === 1 && getMirrorOwnerIdFromCloneId(target.id) === caster.id;
        
        if (!isTargetSelf && !isTargetClone) {
            result.success = false;
            result.log.push('目标必须是本体或镜像');
            return result;
        }

        if (isTargetSelf) {
            // 点击本体：划伤路径敌人（对角路径），收回镜像使生命合体，再恢复6点（允许溢出）
            const clones: Hero[] = [];
             for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 6; c++) {
                    const h = gameState.board[r][c];
                    if (h && h.counters?.['__isClone'] === 1 && getMirrorOwnerIdFromCloneId(h.id) === caster.id) {
                        clones.push(h);
                    }
                }
            }
            if (clones.length === 0) {
                 result.success = false;
                 result.log.push('场上没有镜像');
                 return result;
            }
            const mirrorClone = clones[0];

            // 1. 路径伤害（与交换一致：对角路径，10 + 基础攻击力）
            if (caster.position && mirrorClone.position) {
                const [r1, c1] = caster.position;
                const [r2, c2] = mirrorClone.position;
                if (Math.abs(r1 - r2) === Math.abs(c1 - c2)) {
                    const dr = r2 > r1 ? 1 : -1;
                    const dc = c2 > c1 ? 1 : -1;
                    let currR = r1 + dr;
                    let currC = c1 + dc;
                    while (currR !== r2 && currC !== c2) {
                        if (currR >= 0 && currR < 6 && currC >= 0 && currC < 6) {
                            const h = gameState.board[currR][currC];
                            if (h && h.owner !== caster.owner && h.state === HeroState.ALIVE) {
                                const realDmg = DamageCalculator.calculate(caster, h, 10, true);
                                DamageCalculator.applyDamage(h, realDmg, caster, gameState);
                                result.damageDealt?.push(realDmg.finalDamage);
                                result.log.push(`${caster.name}划伤${h.name}造成${realDmg.finalDamage}点伤害`);
                            }
                        }
                        currR += dr;
                        currC += dc;
                    }
                }
            }

            // 2. 收回镜像：分身生命与本体生命合体（允许溢出），再恢复12点
            const [cr, cc] = mirrorClone.position!;
            gameState.board[cr][cc] = null;
            mirrorClone.state = HeroState.DEAD;
            caster.currentHp += mirrorClone.currentHp + 12;
            result.healingDone?.push(mirrorClone.currentHp + 12);
            
            result.log.push(`${caster.name}收回镜像，生命合体并恢复12点`);
            return result;

        } else {
            // 点击镜像：交换位置，对路径造成伤害，不收回镜像（+1破镜之刃）
            const mirrorClone = target;
            const mirrorHero = caster;

            if (getMirrorOwnerIdFromCloneId(mirrorClone.id) !== caster.id) {
                 result.success = false;
                 return result;
            }

            if (!mirrorHero.position || !mirrorClone.position) {
                 result.success = false;
                 return result;
            }

            const [r1, c1] = mirrorHero.position;
            const [r2, c2] = mirrorClone.position;
            
            // 路径伤害逻辑（10 + 基础攻击力）
            if (Math.abs(r1 - r2) === Math.abs(c1 - c2)) {
                const dr = r2 > r1 ? 1 : -1;
                const dc = c2 > c1 ? 1 : -1;
                
                let currR = r1 + dr;
                let currC = c1 + dc;
                
                while (currR !== r2 && currC !== c2) {
                     if (currR >= 0 && currR < 6 && currC >= 0 && currC < 6) {
                         const h = gameState.board[currR][currC];
                         if (h && h.owner !== caster.owner && h.state === HeroState.ALIVE) {
                             const realDmg = DamageCalculator.calculate(caster, h, 10, true);
                             DamageCalculator.applyDamage(h, realDmg, caster, gameState);
                             result.damageDealt?.push(realDmg.finalDamage);
                             result.log.push(`${caster.name}穿过${h.name}造成${realDmg.finalDamage}点伤害`);
                         }
                     }
                     currR += dr;
                     currC += dc;
                }
            }

            // 交换位置
            const pos1 = mirrorHero.position;
            const pos2 = mirrorClone.position;

            gameState.board[pos1[0]][pos1[1]] = mirrorClone;
            gameState.board[pos2[0]][pos2[1]] = mirrorHero;

            mirrorHero.position = pos2;
            mirrorClone.position = pos1;

            const movedSteps = MovementSystem.getManhattanDistance(pos1, pos2);
            DamageCalculator.applyDilanMovementDamage(mirrorHero, movedSteps, gameState);
            DamageCalculator.applyDilanMovementDamage(mirrorClone, movedSteps, gameState);
            if (mirrorHero.state !== HeroState.ALIVE) {
                result.log.push(`${mirrorHero.name}在交换位置时触发羽化伤害并阵亡`);
                return result;
            }

            // 不收回镜像：获得1层破镜之刃并立即释放
            EffectManager.addCounter(caster, '破镜之刃', 1);
            result.log.push(`${caster.name}未收回镜像，获得1层破镜之刃`);
            DamageCalculator.triggerMirrorBrokenBlade(caster, gameState);

            result.log.push(`${caster.name}与镜像交换了位置`);
            return result;
        }
    }
};

export const mowenSkill1: Skill = {
    id: 'mowen_skill1',
    name: '技能1',
    type: 'damage',
    description: '对一格内单体敌人造成8点伤害，随后回溯至上一回合末生命值状态（冷却：2个自己回合）',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 8,
    scalesWithAttack: false,
    canCrit: true,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        const cd = caster.counters['mowen_skill1_cd'] || 0;
        if (cd > 0) {
            result.success = false;
            result.log.push(`${caster.name}的技能1冷却中（剩余${cd}）`);
            return result;
        }

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}的技能1没有找到目标`);
            return result;
        }

        const target = targets[0];
        const damageResult = DamageCalculator.calculate(caster, target, 8, false);
        DamageCalculator.applyDamage(target, damageResult, caster, gameState);
        result.damageDealt?.push(damageResult.finalDamage);

        caster.counters['mowen_skill1_cd'] = 2;

        const prevHp = caster.counters['mowen_prev_hp'];
        const fallbackHp = caster.maxHp;
        const restoreTo = typeof prevHp === 'number' ? prevHp : fallbackHp;
        const desiredHp = Math.min(caster.maxHp, Math.max(0, restoreTo));
        const healed = desiredHp > caster.currentHp
            ? DamageCalculator.applyHeal(caster, desiredHp - caster.currentHp, gameState, caster)
            : 0;
        if (desiredHp < caster.currentHp) caster.currentHp = desiredHp;
        if (healed > 0) {
            result.healingDone?.push(healed);
        }

        result.log.push(`${caster.name}使用技能1对${target.name}造成${damageResult.finalDamage}点伤害${damageResult.isCrit ? '(暴击!)' : ''}`);
        result.log.push(`${caster.name}回溯至上一回合末生命值（${caster.currentHp}/${caster.maxHp}）`);

        return result;
    }
};

export const mowenSkill2: Skill = {
    id: 'mowen_skill2',
    name: '技能2',
    type: 'damage',
    description: '消耗自身20%当前生命值，对一格内敌人造成(12 + 已损生命值*0.3)伤害（不属于基础攻击力）',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    scalesWithAttack: false,
    canCrit: true,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}的技能2没有找到目标`);
            return result;
        }

        const target = targets[0];

        const cost = Math.floor(caster.currentHp * 0.2);
        caster.currentHp = Math.max(0, caster.currentHp - cost);

        const lostHp = caster.maxHp - caster.currentHp;
        const factor = caster.counters['talent_2'] ? 0.4 : 0.3;
        const baseDamage = Math.floor(12 + lostHp * factor);
        const damageResult = DamageCalculator.calculate(caster, target, baseDamage, false);
        DamageCalculator.applyDamage(target, damageResult, caster, gameState);

        result.damageDealt?.push(damageResult.finalDamage);
        result.log.push(`${caster.name}使用技能2消耗${cost}点生命`);
        result.log.push(`${caster.name}使用技能2对${target.name}造成${damageResult.finalDamage}点伤害${damageResult.isCrit ? '(暴击!)' : ''}`);

        if (damageResult.killed) {
            result.log.push(`${target.name}被击杀！`);
        }

        return result;
    }
};

export const guyingSkill1: Skill = {
    id: 'guying_skill1',
    name: '技能1',
    type: 'damage',
    description: '选择一个直线方向，攻击路径上第一个敌人并移动到其身后，造成8点伤害并附加寒天',
    rangeType: 'line',
    range: 5,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 8,
    scalesWithAttack: false,
    canCrit: true,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        void targets;
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (!caster.position) {
            result.success = false;
            result.log.push(`${caster.name}无法释放技能1`);
            return result;
        }

        const dirCode = caster.counters['__guying_skill1_dir'];
        if (dirCode === undefined) {
            result.success = false;
            result.log.push(`${caster.name}释放技能1失败：未选择方向`);
            return result;
        }

        const dir =
            dirCode === 0 ? 'up'
                : dirCode === 1 ? 'down'
                    : dirCode === 2 ? 'left'
                        : 'right';

        const [cr, cc] = caster.position;
        const step =
            dir === 'up' ? [-1, 0]
                : dir === 'down' ? [1, 0]
                    : dir === 'left' ? [0, -1]
                        : [0, 1];

        let firstEnemy: Hero | null = null;
        let firstEnemyPos: Position | null = null;
        for (let dist = 1; dist <= 5; dist++) {
            const r = cr + step[0] * dist;
            const c = cc + step[1] * dist;
            if (r < 0 || r >= 6 || c < 0 || c >= 6) break;
            const h = gameState.board[r][c];
            if (!h || h.state !== HeroState.ALIVE) continue;
            if (h.owner === caster.owner) continue;
            firstEnemy = h;
            firstEnemyPos = [r, c];
            break;
        }

        if (!firstEnemy || !firstEnemyPos) {
            result.success = false;
            result.log.push(`${caster.name}技能1释放失败：该方向没有可攻击的敌人`);
            return result;
        }

        let landingPos: Position | null = null;
        for (let behind = 1; behind <= 5; behind++) {
            const r = firstEnemyPos[0] + step[0] * behind;
            const c = firstEnemyPos[1] + step[1] * behind;
            if (r < 0 || r >= 6 || c < 0 || c >= 6) break;
            if (gameState.board[r][c] === null) {
                landingPos = [r, c];
                break;
            }
        }

        if (!landingPos) {
            result.success = false;
            result.log.push(`${caster.name}技能1释放失败：敌人身后没有空位`);
            return result;
        }

        const hadHantianBefore = firstEnemy.effects.some(e => e.name === '寒天');

        const hanxingStacks = Math.min(5, caster.counters['寒星'] ?? 0);
        const hanxingRate = caster.counters['talent_2'] ? 0.15 : 0.1;
        const rawDamage = 8 * (1 + hanxingStacks * hanxingRate);
        const damageResult = DamageCalculator.calculate(caster, firstEnemy, Math.floor(rawDamage), false);
        DamageCalculator.applyDamage(firstEnemy, damageResult, caster, gameState);
        result.damageDealt?.push(damageResult.finalDamage);

        const stacksToAdd = caster.counters['talent_3'] && Math.random() < 0.5 ? 2 : 1;
        DamageCalculator.applyHantianStacks(firstEnemy, stacksToAdd, caster.id, gameState);
        if (EffectManager.hasEffect(firstEnemy, '冰冻')) {
            result.log.push(`${firstEnemy.name}进入冰冻`);
        } else {
            result.log.push(
                `${firstEnemy.name}获得寒天+${stacksToAdd}（当前${DamageCalculator.getHantianStackCount(firstEnemy)}层）`
            );
        }

        if (hadHantianBefore) {
            const current = caster.counters['寒星'] ?? 0;
            const next = Math.min(5, current + 1);
            caster.counters['寒星'] = next;
            if (next !== current) {
                result.log.push(`${caster.name}获得寒星+1（当前${next}层）`);
            }
        }

        const fromPos = caster.position;
        const [fr, fc] = fromPos;
        const idx = fr * 6 + fc;
        const bit = Math.pow(2, idx);
        const current = caster.counters['guying_sword_shadow_mask'] || 0;
        const hasBit = Math.floor(current / bit) % 2 === 1;
        if (!hasBit) {
            caster.counters['guying_sword_shadow_mask'] = current + bit;
        }
        gameState.board[fr][fc] = null;
        gameState.board[landingPos[0]][landingPos[1]] = caster;
        caster.position = landingPos;
        caster.hasMovedThisTurn = true;
        DamageCalculator.applyDilanMovementDamage(
            caster,
            MovementSystem.getManhattanDistance(fromPos, landingPos),
            gameState
        );

        result.log.unshift(`${caster.name}使用技能1对${firstEnemy.name}造成${damageResult.finalDamage}点伤害${damageResult.isCrit ? '(暴击!)' : ''}，并移动到(${landingPos[0] + 1},${landingPos[1] + 1})`);

        return result;
    }
};

export const guyingSkill2: Skill = {
    id: 'guying_skill2',
    name: '技能2',
    type: 'damage',
    description: '对周围一格范围内单体目标造成伤害，若目标处于冰冻则伤害提升50%',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 10,
    scalesWithAttack: false,
    canCrit: true,
    execute: (caster: Hero, targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}的技能2没有找到目标`);
            return result;
        }

        const target = targets[0];
        const hadHantianBefore = target.effects.some(e => e.name === '寒天');

        const base = caster.counters['talent_1'] ? 12 : 10;
        const hanxingStacks = Math.min(5, caster.counters['寒星'] ?? 0);
        const hanxingRate = caster.counters['talent_2'] ? 0.15 : 0.1;
        let rawDamage = base * (1 + hanxingStacks * hanxingRate);
        if (EffectManager.hasEffect(target, '冰冻')) {
            rawDamage *= 1.5;
        }

        const damageResult = DamageCalculator.calculate(caster, target, Math.floor(rawDamage), false);
        DamageCalculator.applyDamage(target, damageResult, caster, gameState);
        result.damageDealt?.push(damageResult.finalDamage);

        result.log.push(`${caster.name}使用技能2对${target.name}造成${damageResult.finalDamage}点伤害${damageResult.isCrit ? '(暴击!)' : ''}`);

        if (hadHantianBefore) {
            const current = caster.counters['寒星'] ?? 0;
            const next = Math.min(5, current + 1);
            caster.counters['寒星'] = next;
            if (next !== current) {
                result.log.push(`${caster.name}获得寒星+1（当前${next}层）`);
            }
        }

        if (damageResult.killed) {
            result.log.push(`${target.name}被击杀！`);
        }

        return result;
    }
};

// 寒江雪技能1：选定直线2格内一点，对3x3范围造成5点伤害并附加1层寒天；对已带寒天的敌人造成脆伤（+20%）
export const hanjiangxueSkill1: Skill = {
    id: 'hanjiangxue_skill1',
    name: '霜华覆地',
    type: 'damage',
    description: '选定直线2格内一点，对周围3x3范围敌人造成5点伤害并附加1层寒天；对已带寒天的敌人造成脆伤伤害（+20%）',
    rangeType: 'line',
    range: 2,
    targetType: 'any',
    targetCount: 'all',
    baseDamage: 5,
    scalesWithAttack: false,
    execute: (caster: Hero, _targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const encoded = caster.counters['__extended_target'];
        if (encoded === undefined) return { success: false, log: [`${caster.name}没有选择范围中心`] };
        const center: Position = [Math.floor(encoded / 6), encoded % 6];

        const positions = MovementSystem.getAreaPositions(center, 3).concat([center]);
        const targets = positions
            .map(([r, c]) => gameState.board[r][c])
            .filter((hero): hero is Hero => !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);
        if (targets.length === 0) return { success: false, log: [`${caster.name}的技能1范围内没有敌人`] };

        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        for (const target of targets) {
            const hasHantian = target.effects.some(effect => effect.name === '寒天');
            // 脆伤：对已带寒天的敌人伤害 +20%
            const base = hasHantian ? Math.floor(5 * 1.2) : 5;
            const damage = DamageCalculator.calculate(caster, target, base, false);
            DamageCalculator.applyDamage(target, damage, caster, gameState, true);
            result.damageDealt?.push(damage.finalDamage);
            DamageCalculator.applyHantianStacks(target, 1, caster.id, gameState);
        }

        // 特殊联动：3x3范围覆盖己方冰晶时，寒江雪通过技能1获得冰甲（冰晶被消耗），触发再次释放技能1的机制
        const crystal = gameState.boardEffects?.find(effect =>
            effect.type === 'ice-crystal' &&
            effect.owner === caster.owner &&
            Math.abs(effect.position[0] - center[0]) <= 1 &&
            Math.abs(effect.position[1] - center[1]) <= 1
        );
        if (crystal && EffectManager.addIceArmor(caster, crystal.sourceHeroId)) {
            gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => effect.id !== crystal.id);
            gameState.pendingExtraActionHeroIds ??= {};
            gameState.pendingExtraActionHeroIds[caster.owner] = caster.id;
            result.log.push(`${caster.name}通过技能1获得冰甲（冰晶被消耗），触发再次释放技能1的机制`);
        }

        result.log.push(
            `${caster.name}使用技能1对${targets.map(target => target.name).join('、')}造成伤害并附加寒天`
        );
        return result;
    }
};

// 寒江雪技能2：在周围2格范围内的一个位置释放冰晶（持续2回合，敌方视为障碍物）
export const hanjiangxueSkill2: Skill = {
    id: 'hanjiangxue_skill2',
    name: '冰晶壁垒',
    type: 'special',
    description: '在周围2格范围内的一个空位释放冰晶；冰晶持续2回合，对敌方是障碍物，友方到达可获得冰甲（冰晶被获得后消失）',
    rangeType: 'single',
    range: 2,
    targetType: 'empty',
    targetCount: 1,
    execute: (caster: Hero, _targets: Hero[], gameState: GameState): SkillExecuteResult => {
        const encoded = caster.counters['__extended_target'];
        if (encoded === undefined) return { success: false, log: [`${caster.name}没有选择冰晶位置`] };
        const target: Position = [Math.floor(encoded / 6), encoded % 6];

        if (gameState.board[target[0]][target[1]] !== null) {
            return { success: false, log: [`${caster.name}释放冰晶失败：该位置被占据`] };
        }
        if (gameState.boardEffects?.some(effect =>
            effect.type === 'ice-crystal' &&
            effect.position[0] === target[0] && effect.position[1] === target[1]
        )) {
            return { success: false, log: [`${caster.name}释放冰晶失败：该位置已有冰晶`] };
        }

        gameState.boardEffects ??= [];
        gameState.boardEffects.push({
            id: `ice-crystal-${Date.now()}-${Math.random()}`,
            type: 'ice-crystal',
            position: [...target],
            owner: caster.owner,
            sourceHeroId: caster.id,
            duration: 2,
        });
        return { success: true, log: [`${caster.name}在(${target[0] + 1},${target[1] + 1})释放了冰晶，持续2回合`] };
    }
};

// 导出所有技能
export const SKILLS: Record<string, Skill> = {
    ...EXTENDED_SKILLS,
    huifeng_skill1: huifengSkill1,
    huifeng_skill2: huifengSkill2,
    xuanxiao_skill1: xuanxiaoSkill1,
    xuanxiao_skill2: xuanxiaoSkill2,
    changli_skill1: changliSkill1,
    changli_skill2: changliSkill2,
    mirror_skill1: mirrorSkill1,
    mirror_skill2: mirrorSkill2,
    nightowl_skill1: nightowlSkill1,
    nightowl_skill2: nightowlSkill2,
    wukong_skill1: wukongSkill1,
    wukong_skill2: wukongSkill2,
    baize_skill1: baizeSkill1,
    baize_skill2: baizeSkill2,
    moran_skill1: moranSkill1,
    moran_skill2: moranSkill2,
    zhenxiao_skill1: zhenxiaoSkill1,
    zhenxiao_skill2: zhenxiaoSkill2,
    liuli_skill1: liuliSkill1,
    liuli_skill2: liuliSkill2,
    mowen_skill1: mowenSkill1,
    mowen_skill2: mowenSkill2,
    guying_skill1: guyingSkill1,
    guying_skill2: guyingSkill2,
    hanjiangxue_skill1: hanjiangxueSkill1,
    hanjiangxue_skill2: hanjiangxueSkill2,
};

// 根据ID获取技能
export function getSkill(skillId: string): Skill | undefined {
    return SKILLS[skillId];
}
