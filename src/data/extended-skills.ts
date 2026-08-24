import { DamageCalculator } from '../core/damage-calculator';
import { EffectManager } from '../core/effect-manager';
import { GameEngine } from '../core/game-engine';
import { MovementSystem } from '../core/movement-system';
import { BoardEffect, Effect, GameState, Hero, HeroState, Player, Position, Skill, SkillExecuteResult } from '../types/game';
import {
    addHeroToOwnerList,
    addDilanFeather,
    applyDilanWind,
    consumeDilanFeather,
    createTPaintingSummon,
    currentDeadCount,
    getAllies,
    getEnemies,
    getDilanFeatherStacks,
    getLivingHeroes,
    getSummonOwnerId,
    resonanceCount,
} from './extended-heroes';

function result(log: string[] = []): SkillExecuteResult {
    return { success: true, damageDealt: [], healingDone: [], effectsApplied: [], log };
}

function fail(message: string): SkillExecuteResult {
    return { success: false, log: [message] };
}

function damageOne(
    caster: Hero,
    target: Hero,
    amount: number,
    gameState: GameState,
    area = false,
    ignoreDefense = false,
    scalesWithAttack = false,
    options: { forceCrit?: boolean; canCrit?: boolean } = {}
) {
    let adjusted = amount;
    if (scalesWithAttack) {
        const attackBonus = caster.effects.reduce((sum, effect) => {
            if (effect.type === 'buff' && effect.value !== undefined &&
                (effect.name.includes('攻击') || effect.name === '来财')) {
                return sum + effect.value * (effect.stackCount ?? 1);
            }
            return sum;
        }, 0);
        adjusted *= 1 + attackBonus;
    }
    const damage = DamageCalculator.calculate(caster, target, adjusted, false, ignoreDefense, options);
    DamageCalculator.applyDamage(target, damage, caster, gameState, area);
    if (caster.passiveId === 'feynman_passive' && damage.finalDamage > 0) {
        EffectManager.addCounter(caster, '能量', 1);
    }
    return damage;
}

function encodedTarget(caster: Hero, key = '__extended_target'): Position | null {
    const encoded = caster.counters[key];
    return encoded === undefined ? null : [Math.floor(encoded / 6), encoded % 6];
}

function randomLivingHero(heroes: Hero[]): Hero | null {
    const living = getLivingHeroes(heroes);
    if (!living.length) return null;
    return living[Math.floor(Math.random() * living.length)];
}

function randomDeadHero(heroes: Hero[], state: HeroState = HeroState.DEAD): Hero | null {
    const dead = heroes.filter(hero => hero.state === state);
    if (!dead.length) return null;
    return dead[Math.floor(Math.random() * dead.length)];
}

function effectiveBaseAttack(hero: Hero): number {
    const bonus = hero.effects.reduce((sum, effect) => {
        if (effect.type === 'buff' && effect.value !== undefined &&
            (effect.name.includes('攻击') || effect.name === '来财')) {
            return sum + effect.value * (effect.stackCount ?? 1);
        }
        return sum;
    }, 0);
    return (hero.baseAttack ?? 0) * (1 + bonus);
}

function addFear(target: Hero, caster: Hero, duration: number): void {
    EffectManager.removeEffectByName(target, '恐惧');
    EffectManager.addEffect(target, {
        type: 'debuff',
        name: '恐惧',
        duration,
        value: 0.2,
        sourceHeroId: caster.id,
        description: '攻击降低20%，每轮有25%概率无法行动',
    });
}

export const skeletonkingSkill1: Skill = {
    id: 'skeletonking_skill1',
    name: '亡骨斩',
    type: 'damage',
    description: '攻击一个方向两格，造成8+亡灵之力×2伤害，50%暂时阵亡',
    rangeType: 'line',
    range: 2,
    targetType: 'enemy',
    targetCount: 'all',
    execute: (caster, targets, gameState) => {
        if (!targets.length) return fail('该方向没有敌人');
        const output = result();
        const base = 8 + currentDeadCount(caster.owner, gameState) * 2;
        for (const target of targets) {
            const damage = damageOne(caster, target, base, gameState, true, false, true);
            output.damageDealt?.push(damage.finalDamage);
        }
        if (Math.random() < 0.5 && caster.state === HeroState.ALIVE) {
            GameEngine.tempDeath(caster, gameState);
            output.log.push(`${caster.name}受到亡灵反噬，暂时阵亡`);
        }
        output.log.unshift(`${caster.name}向前方挥出亡骨斩`);
        return output;
    },
};

export const skeletonkingSkill2: Skill = {
    id: 'skeletonking_skill2',
    name: '亡灵唤回',
    type: 'damage',
    description: '对一格内敌人造成7+亡灵共鸣×2伤害，50%复活随机暂时阵亡友方',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有可攻击目标');
        const base = 7 + resonanceCount(caster.owner, gameState) * 2;
        const damage = damageOne(caster, target, base, gameState, false, false, true);
        const output = result([`${caster.name}造成${damage.finalDamage}点伤害`]);
        output.damageDealt?.push(damage.finalDamage);
        if (Math.random() < 0.5) {
            const dead = randomDeadHero(getAllies(caster, gameState), HeroState.TEMP_DEAD);
            if (dead && GameEngine.resurrectHero(dead, 0.5, gameState)) {
                output.log.push(`${dead.name}从暂时阵亡中复苏`);
            }
        }
        return output;
    },
};

export const jetzmiSkill1: Skill = {
    id: 'jetzmi_skill1',
    name: '终焉斩',
    type: 'damage',
    description: '根据当前形态攻击；强化释放可消耗2点亡灵共鸣攻击第二个目标',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 2,
    execute: (caster, targets, gameState) => {
        if (!targets.length) return fail('没有可攻击目标');
        const kingForm = caster.counters['jetzmi_form'] === 1;
        const enhanced = caster.counters['__jetzmi_enhanced'] === 1;
        const resonance = resonanceCount(caster.owner, gameState);
        const chosen = targets.slice(0, kingForm ? 1 : enhanced ? 2 : 1);
        if (!kingForm && chosen.length > 1 && resonance < 2) return fail('亡灵共鸣不足2点');
        if (!kingForm && chosen.length > 1) {
            if (caster.owner === 'player1') gameState.deathCounters.player1Dead -= 2;
            else gameState.deathCounters.player2Dead -= 2;
        }
        const base = kingForm ? 3 * resonance : 6 + resonance;
        const output = result();
        for (const target of chosen) {
            const damage = damageOne(caster, target, base, gameState, false, false, true);
            output.damageDealt?.push(damage.finalDamage);
        }
        if (kingForm) {
            GameEngine.switchJetzmiFormInPlace(caster, gameState);
            output.log.push('终焉国王必定暂时阵亡并切换形态');
        } else if (Math.random() < 0.5) {
            GameEngine.switchJetzmiFormInPlace(caster, gameState);
            output.log.push('亡灵城主暂时阵亡并切换形态');
        }
        return output;
    },
};

export const jetzmiSkill2: Skill = {
    id: 'jetzmi_skill2',
    name: '亡灵汲取',
    type: 'buff',
    description: '强化下一次攻击并复活暂时阵亡队友，50%使自己暂时阵亡',
    rangeType: '全场',
    range: 6,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const requestedId = gameState.skillSelectedHeroIds?.[caster.id];
        const requested = getAllies(caster, gameState).find(target =>
            target.id === requestedId && target.state === HeroState.TEMP_DEAD
        ) ?? targets.find(target => target.owner === caster.owner && target.state === HeroState.TEMP_DEAD);
        const dead = requested ?? randomDeadHero(getAllies(caster, gameState), HeroState.TEMP_DEAD);
        if (dead) GameEngine.resurrectHero(dead, 0.5, gameState);
        const kingForm = caster.counters['jetzmi_form'] === 1;
        if (kingForm) {
            caster.counters['jetzmi_shield_conversion_next'] = 1;
        } else {
            const current = caster.counters['jetzmi_vampire_rate'] || 0.5;
            caster.counters['jetzmi_vampire_rate'] = Math.min(1, current + 0.25);
            EffectManager.removeEffectByName(caster, '亡灵吸血');
            EffectManager.addEffect(caster, {
                type: 'buff',
                name: '亡灵吸血',
                duration: -1,
                value: current,
                sourceHeroId: caster.id,
                description: '下一次攻击吸血',
            });
            caster.counters['jetzmi_vampire_next'] = 1;
        }
        if (Math.random() < 0.5) GameEngine.switchJetzmiFormInPlace(caster, gameState);
        return result([`${caster.name}强化了下一次攻击${dead ? `并复活${dead.name}` : ''}`]);
    },
};

export const pipaSkill1: Skill = {
    id: 'pipa_skill1',
    name: '音符',
    type: 'buff',
    description: '为两格内所有友方施加音符，攻击时附伤并为琵琶增加和弦',
    rangeType: 'single',
    range: 2,
    targetType: 'ally',
    targetCount: 'all',
    execute: (caster, targets) => {
        if (!targets.length) return fail('范围内没有友方目标');
        for (const target of targets) {
            EffectManager.removeEffectByName(target, '音符');
            EffectManager.addEffect(target, {
                type: 'buff',
                name: '音符',
                duration: 2,
                value: 0.25,
                sourceHeroId: caster.id,
                description: '攻击时附加琵琶基础攻击力25%的伤害',
            });
        }
        return result([`${targets.length}名友方获得音符`]);
    },
};

export const pipaSkill2: Skill = {
    id: 'pipa_skill2',
    name: '和弦爆发',
    type: 'damage',
    description: '消耗所有和弦，对两格内敌人造成和弦×3伤害',
    rangeType: 'single',
    range: 2,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        const chord = EffectManager.getCounter(caster, '和弦');
        if (!target || chord <= 0) return fail('没有目标或和弦不足');
        const damage = damageOne(caster, target, chord * 3, gameState);
        EffectManager.setCounter(caster, '和弦', 0);
        caster.counters['pipa_last_skill2_damage'] = damage.finalDamage;
        return { ...result([`${caster.name}消耗${chord}层和弦`]), damageDealt: [damage.finalDamage] };
    },
};

export const bountySkill1: Skill = {
    id: 'bounty_skill1',
    name: '猎杀令',
    type: 'special',
    description: '指定一名敌人挂「猎杀令」（持续2回合）：友方对其造成伤害时，赏金猎人追加一次4点伤害的追击',
    rangeType: '全场',
    range: 6,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets) => {
        const target = targets[0];
        if (!target) return fail('没有敌方目标');
        EffectManager.removeEffectByName(target, '猎杀令');
        EffectManager.addEffect(target, {
            type: 'mark',
            name: '猎杀令',
            duration: 2,
            sourceHeroId: caster.id,
            description: '友方对其造成伤害时，赏金猎人追加一次4点伤害的追击',
        });
        return result([`${caster.name}对${target.name}发布了猎杀令`]);
    },
};

export const bountySkill2: Skill = {
    id: 'bounty_skill2',
    name: '猎杀',
    type: 'damage',
    description: '对两格内敌人造成8伤害；若为最低血量敌人则恢复6生命',
    rangeType: 'single',
    range: 2,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有敌方目标');
        const living = getLivingHeroes(getEnemies(caster, gameState));
        const minHp = Math.min(...living.map(hero => hero.currentHp));
        const wasLowest = target.currentHp === minHp;
        const damage = damageOne(caster, target, 8, gameState);
        if (wasLowest) DamageCalculator.applyHeal(caster, 6, gameState);
        return { ...result(), damageDealt: [damage.finalDamage] };
    },
};

function updateYangLine(caster: Hero, target: Hero): void {
    for (const ally of [caster, target]) {
        if (ally.id !== target.id) continue;
        ally.effects = ally.effects.filter(effect =>
            !(effect.name.startsWith('阳线') && effect.sourceHeroId === caster.id)
        );
    }
    const rate = (caster.counters['yinyang_yang_rate'] ?? 0.2);
    EffectManager.addEffect(target, {
        type: 'buff', name: '阳线攻击', duration: -1, value: rate,
        sourceHeroId: caster.id, description: '阳线提高攻击',
    });
    EffectManager.addEffect(target, {
        type: 'buff', name: '阳线免伤', duration: -1, value: rate,
        sourceHeroId: caster.id, description: '阳线提高防御',
    });
}

export const yinyangSkill1: Skill = {
    id: 'yinyang_skill1',
    name: '阳线',
    type: 'buff',
    description: '连接友方提高攻击与防御；重复连接时恢复已损生命',
    rangeType: 'single',
    range: 2,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有友方目标');
        const existing = target.effects.some(effect => effect.name === '阳线攻击' && effect.sourceHeroId === caster.id);
        for (const ally of getAllies(caster, gameState)) {
            ally.effects = ally.effects.filter(effect =>
                !(effect.name.startsWith('阳线') && effect.sourceHeroId === caster.id)
            );
        }
        // 重复连接：恢复已损生命，重复倍率+10%（上限50%）；连接新目标则攻防加成与重复倍率都重置为20%
        const repeatRate = existing
            ? Math.min(0.5, (caster.counters['yinyang_yang_repeat'] ?? 0.2) + 0.1)
            : 0.2;
        if (existing) {
            const healRate = caster.counters['yinyang_yang_repeat'] ?? 0.2;
            DamageCalculator.applyHeal(target, Math.floor((target.maxHp - target.currentHp) * healRate), gameState, caster);
        } else {
            caster.counters['yinyang_yang_rate'] = 0.2;
        }
        caster.counters['yinyang_yang_repeat'] = repeatRate;
        updateYangLine(caster, target);
        return result([existing
            ? `${caster.name}重复连接${target.name}，恢复其已损生命（重复效果${Math.floor(repeatRate * 100)}%）`
            : `${caster.name}与${target.name}建立阳线`]);
    },
};

export const yinyangSkill2: Skill = {
    id: 'yinyang_skill2',
    name: '阴线',
    type: 'debuff',
    description: '连接敌方降低攻击与防御；重复连接时损失现有生命',
    rangeType: 'single',
    range: 2,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有敌方目标');
        const existing = target.effects.some(effect => effect.name === '阴线攻击降低' && effect.sourceHeroId === caster.id);
        for (const enemy of getEnemies(caster, gameState)) {
            enemy.effects = enemy.effects.filter(effect =>
                !(effect.name.startsWith('阴线') && effect.sourceHeroId === caster.id)
            );
        }
        const rate = caster.counters['yinyang_yin_rate'] ?? 0.2;
        // 重复连接：造成现有生命伤害，重复倍率+10%（上限50%）；连接新目标则攻防加成与重复倍率都重置为20%
        const repeatRate = existing
            ? Math.min(0.5, (caster.counters['yinyang_yin_repeat'] ?? 0.2) + 0.1)
            : 0.2;
        if (existing) {
            const damageRate = caster.counters['yinyang_yin_repeat'] ?? 0.2;
            damageOne(caster, target, Math.max(1, Math.floor(target.currentHp * damageRate)), gameState, false, true);
        } else {
            caster.counters['yinyang_yin_rate'] = 0.2;
        }
        caster.counters['yinyang_yin_repeat'] = repeatRate;
        EffectManager.addEffect(target, {
            type: 'debuff', name: '阴线攻击降低', duration: -1, value: rate,
            sourceHeroId: caster.id, description: '阴线降低攻击',
        });
        EffectManager.addEffect(target, {
            type: 'debuff', name: '阴线防御降低', duration: -1, value: rate,
            sourceHeroId: caster.id, description: '阴线降低防御',
        });
        return result([existing
            ? `${caster.name}重复连接${target.name}，使其损失现有生命（重复效果${Math.floor(repeatRate * 100)}%）`
            : `${caster.name}与${target.name}建立阴线`]);
    },
};

export const soulLampSkill1: Skill = {
    id: 'soul_lamp_skill1',
    name: '暗夜法阵',
    type: 'special',
    description: '在周围形成持续2回合的法阵并使自己暂时阵亡',
    rangeType: 'single',
    range: 0,
    targetType: 'self',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('没有合法位置');
        gameState.boardEffects ??= [];
        gameState.boardEffects.push({
            id: `dark-circle-${Date.now()}-${Math.random()}`,
            type: 'dark-circle',
            position: [...caster.position],
            owner: caster.owner,
            sourceHeroId: caster.id,
            duration: 2,
        });
        GameEngine.tempDeath(caster, gameState);
        return result([`${caster.name}展开暗夜法阵并暂时阵亡`]);
    },
};

export const soulLampSkill2: Skill = {
    id: 'soul_lamp_skill2',
    name: '缚魂轮转',
    type: 'special',
    description: '令一名存活队友暂时阵亡并在下一轮复活，自己真实死亡',
    rangeType: '全场',
    range: 6,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有友方目标');
        GameEngine.tempDeath(target, gameState);
        target.counters['soul_lamp_revive_round'] = gameState.roundNumber + 1;
        DamageCalculator.forceDeath(caster, caster, gameState);
        return result([`${target.name}将在下一轮复活，${caster.name}真实死亡`]);
    },
};

export const heroXSkill1: Skill = {
    id: 'hero_x_skill1',
    name: '震怒打击',
    type: 'damage',
    description: '随机攻击一名敌人造成8伤害并施加震怒',
    rangeType: '全场',
    range: 6,
    targetType: 'enemy',
    targetCount: 'random',
    execute: (caster, targets, gameState) => {
        const target = targets[0] ?? randomLivingHero(getEnemies(caster, gameState));
        if (!target) return fail('没有敌人');
        const damage = damageOne(caster, target, 8, gameState);
        EffectManager.addEffect(target, {
            type: 'debuff', name: '震怒', duration: -1, stackCount: 1,
            sourceHeroId: caster.id, description: '达到3层眩晕',
        });
        DamageCalculator.resolveThreeStackControl(target, '震怒', caster.id);
        return { ...result(), damageDealt: [damage.finalDamage] };
    },
};

export const heroXSkill2: Skill = {
    id: 'hero_x_skill2',
    name: '增势跃迁',
    type: 'special',
    description: '瞬移到周围一格（含斜角）的空位，为周围友方增加5护盾并获得增势',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'empty',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        const target = encodedTarget(caster);
        if (!target || !caster.position) return fail('没有选择瞬移位置');
        const [fromRow, fromCol] = caster.position;
        const deltaRow = Math.abs(target[0] - fromRow);
        const deltaCol = Math.abs(target[1] - fromCol);
        // 一格范围 = 周围8个相邻格（含斜角），原地不算；
        // moveHero 按曼哈顿距离判断，斜角距离为2，因此先自行校验再以宽松距离移动。
        if (deltaRow > 1 || deltaCol > 1 || deltaRow + deltaCol === 0) {
            return fail('只能瞬移到周围一格范围');
        }
        if (!MovementSystem.moveHero(caster, target, gameState, 2)) return fail('无法瞬移到该位置');
        if (caster.state !== HeroState.ALIVE) {
            return result([`${caster.name}在跃迁中触发羽化伤害并阵亡`]);
        }
        const allies = getLivingHeroes(getAllies(caster, gameState)).filter(
            ally => ally.id !== caster.id && ally.position &&
                MovementSystem.getManhattanDistance(target, ally.position) <= 1
        );
        for (const ally of allies) EffectManager.addShield(ally, 5);
        EffectManager.addCounter(caster, '增势', allies.length);
        return result([`${caster.name}为${allies.length}名友方提供护盾并获得${allies.length}层增势`]);
    },
};

export const bardSkill1: Skill = {
    id: 'bard_skill1',
    name: '奏鸣曲',
    type: 'buff',
    description: '为两格范围内所有友方施加和声并增加激情',
    rangeType: 'single',
    range: 2,
    targetType: 'ally',
    targetCount: 'all',
    execute: (caster, targets) => {
        if (!targets.length) return fail('范围内没有友方');
        for (const target of targets) {
            EffectManager.addEffect(target, {
                type: 'buff', name: '和声', duration: 2, value: 5,
                sourceHeroId: caster.id, description: '攻击后恢复5生命',
            });
            EffectManager.addCounter(target, '激情', 1);
        }
        return result([`${targets.length}名友方获得和声与激情`]);
    },
};

export const bardSkill2: Skill = {
    id: 'bard_skill2',
    name: '协奏曲',
    type: 'heal',
    description: '消耗两格范围内友方的激情，恢复5+激情×3生命',
    rangeType: 'single',
    range: 2,
    targetType: 'ally',
    targetCount: 'all',
    execute: (caster, targets, gameState) => {
        if (!targets.length) return fail('范围内没有友方');
        const output = result();
        for (const target of targets) {
            const passion = EffectManager.getCounter(target, '激情');
            const healed = DamageCalculator.applyHeal(target, 5 + passion * 3, gameState, caster);
            EffectManager.setCounter(target, '激情', 0);
            output.healingDone?.push(healed);
        }
        return output;
    },
};

export const witherLordSkill1: Skill = {
    id: 'wither_lord_skill1',
    name: '凋零播撒',
    type: 'damage',
    description: '选择场上任意两个对角位置构成2x2区域，对该区域内所有敌人造成伤害并施加凋零，增加技能2的死亡概率25%',
    rangeType: '全场',
    range: 6,
    targetType: 'any',
    targetCount: 2,
    execute: (caster, targets, gameState) => {
        // targets 由 SkillSystem 展开为 2x2 区域内的所有英雄
        const enemies = targets.filter((hero): hero is Hero =>
            hero.owner !== caster.owner && hero.state === HeroState.ALIVE
        );
        if (!enemies.length) return fail('2x2区域内没有敌人');
        const base = 5 + resonanceCount(caster.owner, gameState) * 2;
        const output = result();
        for (const target of enemies) {
            const damage = damageOne(caster, target, base, gameState, true);
            output.damageDealt?.push(damage.finalDamage);
            EffectManager.addEffect(target, {
                type: 'debuff', name: '凋零', duration: -1, stackCount: 1,
                sourceHeroId: caster.id, description: '可由凋零引爆',
            });
            EffectManager.addCounter(caster, 'wither_applied_total', 1);
        }
        caster.counters['wither_skill2_death_chance'] = Math.min(
            1,
            (caster.counters['wither_skill2_death_chance'] ?? 0.25) + 0.25
        );
        while (caster.counters['wither_applied_total'] >= 6) {
            caster.counters['wither_applied_total'] -= 6;
            EffectManager.addCounter(caster, 'wither_lives', 1);
        }
        return output;
    },
};

export const witherLordSkill2: Skill = {
    id: 'wither_lord_skill2',
    name: '凋零引爆',
    type: 'damage',
    description: '引爆所有凋零层数，自己有累积概率真实死亡',
    rangeType: '全场',
    range: 6,
    targetType: 'enemy',
    targetCount: 'all',
    execute: (caster, _targets, gameState) => {
        const targets = getLivingHeroes(getEnemies(caster, gameState)).filter(target =>
            target.effects.some(effect => effect.name === '凋零' && effect.sourceHeroId === caster.id)
        );
        if (!targets.length) return fail('场上没有可引爆的凋零');
        const output = result();
        const percentPerStack = 0.1 + currentDeadCount(caster.owner, gameState) * 0.02;
        for (const target of targets) {
            const effect = target.effects.find(item => item.name === '凋零' && item.sourceHeroId === caster.id)!;
            const stacks = effect.stackCount ?? 1;
            const amount = Math.max(1, Math.floor(target.maxHp * percentPerStack * stacks));
            const damage = damageOne(caster, target, amount, gameState, true, true);
            output.damageDealt?.push(damage.finalDamage);
            target.effects = target.effects.filter(item => item !== effect);
        }
        const chance = caster.counters['wither_skill2_death_chance'] ?? 0.25;
        caster.counters['wither_skill2_death_chance'] = 0.25;
        if (Math.random() < chance) DamageCalculator.forceDeath(caster, caster, gameState);
        return output;
    },
};

function findPaintingSummon(caster: Hero, gameState: GameState, kind: 1 | 2): Hero | null {
    return getAllies(caster, gameState).find(hero =>
        hero.state === HeroState.ALIVE &&
        hero.counters['__isSummon'] === 1 &&
        hero.counters['__summonKind'] === kind &&
        getSummonOwnerId(hero) === caster.id
    ) ?? null;
}

function summonPaintingUnit(caster: Hero, gameState: GameState, kind: 'jinwu' | 'xuangui'): SkillExecuteResult {
    const target = encodedTarget(caster);
    if (!target || gameState.board[target[0]][target[1]] !== null) return fail('请选择空位置召唤');
    if (!caster.position || MovementSystem.getManhattanDistance(caster.position, target) > 2) {
        return fail('召唤位置必须在两格范围内');
    }
    const summon = createTPaintingSummon(kind, caster.owner, caster.id, target);
    gameState.board[target[0]][target[1]] = summon;
    addHeroToOwnerList(summon, gameState);
    return result([`${caster.name}召唤了${summon.name}`]);
}

/**
 * 金乌耀斑：以 center 为中心的 3x3 九宫格，对范围内敌人造成敌人数 x 3 伤害
 */
function jinwuBurstAt(jinwu: Hero, center: Position, gameState: GameState): SkillExecuteResult {
    const positions = MovementSystem.getAreaPositions(center, 3).concat([center]);
    const targets = positions.map(([r, c]) => gameState.board[r][c])
        .filter((hero): hero is Hero => !!hero && hero.owner !== jinwu.owner && hero.state === HeroState.ALIVE);
    const output = result();
    for (const target of targets) {
        const damage = damageOne(jinwu, target, targets.length * 3, gameState, true);
        output.damageDealt?.push(damage.finalDamage);
    }
    output.log.push(`${jinwu.name}耀斑波及了${targets.length}名敌人`);
    return output;
}

/**
 * 玄龟震击：对目标造成6伤害，50%概率眩晕一回合
 */
function xuanguiStrikeAt(xuangui: Hero, target: Hero, gameState: GameState): SkillExecuteResult {
    const damage = damageOne(xuangui, target, 6, gameState);
    const output = { ...result(), damageDealt: [damage.finalDamage] };
    if (Math.random() < 0.5 && target.state === HeroState.ALIVE) {
        const stunEffect: Effect = {
            id: `stun-${Date.now()}-${Math.random()}`, type: 'stun', name: '眩晕',
            // 行动中施加：已行动的目标剥夺下回合（2），未行动的目标剥夺本回合（1），恰好1次行动
            duration: target.hasActedThisTurn ? 2 : 1, sourceHeroId: xuangui.id,
            description: '停止行动一回合',
        };
        EffectManager.addEffect(target, stunEffect);
        output.effectsApplied?.push(stunEffect);
    }
    output.log.push(`${xuangui.name}震击了${target.name}`);
    return output;
}

/**
 * 本体普攻 6 伤害后，精灵连锁出手（金乌/玄龟）；精灵被眩晕或目标超出射程时不出手
 */
function paintingChainAttack(
    caster: Hero,
    target: Hero,
    summon: Hero,
    gameState: GameState
): SkillExecuteResult {
    const output = result();
    const damage = damageOne(caster, target, 6, gameState);
    output.damageDealt?.push(damage.finalDamage);
    output.log.push(`${caster.name}对${target.name}造成了${damage.finalDamage}点伤害`);
    if (summon.state !== HeroState.ALIVE || EffectManager.isStunned(summon)) {
        output.log.push(`${summon.name}无法连锁出手`);
        return output;
    }
    if (!summon.position || !target.position ||
        MovementSystem.getManhattanDistance(summon.position, target.position) > 2) {
        output.log.push(`${summon.name}距离目标过远，无法连锁出手`);
        return output;
    }
    if (summon.counters['__summonKind'] === 1) {
        const burst = jinwuBurstAt(summon, target.position, gameState);
        output.damageDealt?.push(...(burst.damageDealt ?? []));
        output.log.push(...burst.log);
    } else {
        const strike = xuanguiStrikeAt(summon, target, gameState);
        output.damageDealt?.push(...(strike.damageDealt ?? []));
        output.effectsApplied?.push(...(strike.effectsApplied ?? []));
        output.log.push(...strike.log);
    }
    return output;
}

export const tPaintingSkill1: Skill = {
    id: 't_painting_skill1',
    name: '金乌',
    type: 'summon',
    description: '召唤金乌；已有金乌时先普攻6伤害，金乌再连锁出手',
    rangeType: 'single',
    range: 2,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const jinwu = findPaintingSummon(caster, gameState, 1);
        if (!jinwu) return summonPaintingUnit(caster, gameState, 'jinwu');
        const target = targets.find(hero => hero.owner !== caster.owner);
        if (!target) return fail('已有金乌，请选择敌人进行普通攻击');
        return paintingChainAttack(caster, target, jinwu, gameState);
    },
};

export const tPaintingSkill2: Skill = {
    id: 't_painting_skill2',
    name: '玄龟',
    type: 'summon',
    description: '召唤玄龟；已有玄龟时先普攻6伤害，玄龟再连锁出手',
    rangeType: 'single',
    range: 2,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const xuangui = findPaintingSummon(caster, gameState, 2);
        if (!xuangui) return summonPaintingUnit(caster, gameState, 'xuangui');
        const target = targets.find(hero => hero.owner !== caster.owner);
        if (!target) return fail('已有玄龟，请选择敌人进行普通攻击');
        return paintingChainAttack(caster, target, xuangui, gameState);
    },
};

export const jinwuSkill: Skill = {
    id: 'jinwu_skill',
    name: '金乌耀斑',
    type: 'damage',
    description: '选择两格内一点，对九宫格敌人造成敌人数×3伤害',
    rangeType: 'single',
    range: 2,
    targetType: 'any',
    targetCount: 'all',
    execute: (caster, _targets, gameState) => {
        const center = encodedTarget(caster);
        if (!center) return fail('没有选择范围中心');
        return jinwuBurstAt(caster, center, gameState);
    },
};

export const xuanguiSkill: Skill = {
    id: 'xuangui_skill',
    name: '玄龟震击',
    type: 'damage',
    description: '对两格内敌人造成6伤害，50%眩晕',
    rangeType: 'single',
    range: 2,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有敌人');
        return xuanguiStrikeAt(caster, target, gameState);
    },
};

export const feynmanSkill1: Skill = {
    id: 'feynman_skill1',
    name: '粒子束',
    type: 'damage',
    description: '穿透直线敌人，伤害从8开始每个目标降低2，并施加粒子标记',
    rangeType: 'line',
    range: 5,
    targetType: 'enemy',
    targetCount: 'all',
    execute: (caster, targets, gameState) => {
        if (!targets.length) return fail('该方向没有敌人');
        const output = result();
        targets.forEach((target, index) => {
            const damage = damageOne(caster, target, Math.max(2, 8 - index * 2), gameState, true);
            output.damageDealt?.push(damage.finalDamage);
            EffectManager.addEffect(target, {
                type: 'mark', name: '粒子标记', duration: 3, stackCount: 1,
                sourceHeroId: caster.id, description: '粒子轰爆的目标',
            });
        });
        return output;
    },
};

export const feynmanSkill2: Skill = {
    id: 'feynman_skill2',
    name: '粒子轰爆',
    type: 'damage',
    description: '选择两个粒子标记目标，对矩形粒子群内敌人造成范围伤害',
    rangeType: '全场',
    range: 6,
    targetType: 'enemy',
    targetCount: 2,
    execute: (caster, targets, gameState) => {
        const marked = targets.filter(target =>
            target.effects.some(effect => effect.name === '粒子标记' && effect.sourceHeroId === caster.id)
        );
        if (marked.length !== 2 || !marked[0].position || !marked[1].position) {
            return fail('需要选择两个带粒子标记的敌人');
        }
        const [a, b] = marked.map(target => target.position!);
        const expanded = EffectManager.getCounter(caster, '能量') >= 3;
        if (expanded) EffectManager.addCounter(caster, '能量', -3);
        const margin = expanded ? 1 : 0;
        const minRow = Math.max(0, Math.min(a[0], b[0]) - margin);
        const maxRow = Math.min(5, Math.max(a[0], b[0]) + margin);
        const minCol = Math.max(0, Math.min(a[1], b[1]) - margin);
        const maxCol = Math.min(5, Math.max(a[1], b[1]) + margin);
        const targetsInArea = getLivingHeroes(getEnemies(caster, gameState)).filter(target =>
            target.position &&
            target.position[0] >= minRow && target.position[0] <= maxRow &&
            target.position[1] >= minCol && target.position[1] <= maxCol
        );
        const markCount = getLivingHeroes(getEnemies(caster, gameState)).reduce(
            (sum, target) => sum + target.effects
                .filter(effect => effect.name === '粒子标记' && effect.sourceHeroId === caster.id)
                .reduce((inner, effect) => inner + (effect.stackCount ?? 1), 0),
            0
        );
        const output = result();
        for (const target of targetsInArea) {
            const damage = damageOne(caster, target, 8 + markCount * 2, gameState, true);
            output.damageDealt?.push(damage.finalDamage);
        }
        return output;
    },
};

export const wangcaiSkill1: Skill = {
    id: 'wangcai_skill1',
    name: '聚财一击',
    type: 'damage',
    description: '普通形态造成基础攻击×3并增加财气；财神形态消耗财气爆发',
    rangeType: 'single',
    range: 2,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有敌人');
        const transformed = caster.counters['wangcai_transformed'] === 1;
        const fortune = EffectManager.getCounter(caster, '财气');
        const attack = effectiveBaseAttack(caster);
        const base = transformed
            ? attack * Math.max(1, fortune) * 4
            : attack * 3;
        const damage = damageOne(caster, target, base, gameState);
        if (transformed) EffectManager.setCounter(caster, '财气', 0);
        else {
            EffectManager.addCounter(caster, '财气', 1);
            GameEngine.transformWangcaiIfReady(caster, gameState);
        }
        return { ...result(), damageDealt: [damage.finalDamage] };
    },
};

export const wangcaiSkill2: Skill = {
    id: 'wangcai_skill2',
    name: '来财',
    type: 'buff',
    description: '为两名友方增加攻击与防御，出手时为旺财增加财气',
    rangeType: 'single',
    range: 2,
    targetType: 'ally',
    targetCount: 2,
    execute: (caster, targets) => {
        if (!targets.length) return fail('没有友方目标');
        const transformed = caster.counters['wangcai_transformed'] === 1;
        const value = transformed ? 0.4 : 0.2;
        for (const target of targets.slice(0, 2)) {
            const existing = target.effects.find(
                effect => effect.name === '来财' && effect.sourceHeroId === caster.id
            );
            if (existing && (existing.stackCount ?? 1) >= 2) continue;
            EffectManager.addEffect(target, {
                type: 'buff', name: '来财', duration: 2, value,
                stackCount: 1, sourceHeroId: caster.id,
                description: '提高攻击与防御，出手时为旺财增加财气',
            });
        }
        return result([`${targets.length}名友方获得来财`]);
    },
};

export const schrodingerSkill1: Skill = {
    id: 'schrodinger_skill1',
    name: '叠加态攻击',
    type: 'damage',
    description: '攻击一个方向的3×3范围，每个敌人50%受6伤害或免疫',
    rangeType: 'line',
    range: 1,
    targetType: 'enemy',
    targetCount: 'all',
    execute: (caster, targets, gameState) => {
        if (!targets.length) return fail('范围内没有敌人');
        const output = result();
        for (const target of targets) {
            const hit = Math.random() < 0.5;
            EffectManager.removeEffectByName(target, '观测坍缩受伤');
            EffectManager.removeEffectByName(target, '观测坍缩未受伤');
            if (hit) {
                const damage = damageOne(caster, target, 6, gameState, true);
                output.damageDealt?.push(damage.finalDamage);
            }
            EffectManager.addEffect(target, {
                type: hit ? 'debuff' : 'mark',
                name: hit ? '观测坍缩受伤' : '观测坍缩未受伤',
                duration: 2,
                sourceHeroId: caster.id,
                description: hit ? '本次观测受到伤害' : '下次受到攻击伤害提高50%',
            });
        }
        return output;
    },
};

export const schrodingerSkill2: Skill = {
    id: 'schrodinger_skill2',
    name: '量子纠缠',
    type: 'debuff',
    description: '选择两名敌人纠缠，一方受伤时另一方受到50%伤害',
    rangeType: '全场',
    range: 6,
    targetType: 'enemy',
    targetCount: 2,
    execute: (_caster, targets, gameState) => {
        if (targets.length !== 2 || targets[0].id === targets[1].id) return fail('需要选择两名不同敌人');
        const pairId = `entangle-${Date.now()}-${Math.random()}`;
        const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];
        const staleLinkIds = new Set(
            targets.flatMap(target =>
                target.effects
                    .filter(effect => effect.name === '量子纠缠' && effect.linkId)
                    .map(effect => effect.linkId!)
            )
        );
        if (staleLinkIds.size > 0) {
            for (const hero of allHeroes) {
                hero.effects = hero.effects.filter(effect =>
                    effect.name !== '量子纠缠' || !effect.linkId || !staleLinkIds.has(effect.linkId)
                );
            }
        }
        targets.forEach((target, index) => {
            EffectManager.addEffect(target, {
                type: 'debuff', name: '量子纠缠', duration: 2,
                linkId: pairId,
                value: 0.5, sourceHeroId: targets[1 - index].id,
                description: '另一名纠缠目标受伤时承受50%伤害',
            });
        });
        return result([`${targets[0].name}与${targets[1].name}进入量子纠缠`]);
    },
};

export const lilithSkill1: Skill = {
    id: 'lilith_skill1',
    name: '恐惧之箭',
    type: 'damage',
    description: '造成8伤害并施加持续2回合的恐惧',
    rangeType: 'single',
    range: 3,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有敌人');
        const energyBuff = caster.counters['lilith_next_damage_bonus'] === 1 ? 1.3 : 1;
        caster.counters['lilith_next_damage_bonus'] = 0;
        const damage = damageOne(caster, target, Math.floor(8 * energyBuff), gameState);
        addFear(target, caster, 2);
        return { ...result(), damageDealt: [damage.finalDamage] };
    },
};

export const lilithSkill2: Skill = {
    id: 'lilith_skill2',
    name: '恐惧蔓延',
    type: 'damage',
    description: '从恐惧目标向两格范围蔓延，并对初始目标造成额外伤害',
    rangeType: '全场',
    range: 6,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target?.position || !EffectManager.hasEffect(target, '恐惧')) return fail('目标没有恐惧');
        const energy = EffectManager.getCounter(caster, '恐惧情绪能量');
        const bonus = caster.counters['lilith_next_damage_bonus'] === 1 ? 1.3 : 1;
        caster.counters['lilith_next_damage_bonus'] = 0;
        const damage = damageOne(caster, target, Math.floor((5 + energy * 3) * bonus), gameState);
        for (const enemy of getLivingHeroes(getEnemies(caster, gameState))) {
            if (enemy.position && MovementSystem.getManhattanDistance(target.position, enemy.position) <= 2) {
                addFear(enemy, caster, 1);
            }
        }
        return { ...result(), damageDealt: [damage.finalDamage] };
    },
};

/**
 * 李太白技能1：一格十字内（上下左右）单体 7 伤害，自己获得一层醉意
 */
export const libaiSkill1: Skill = {
    id: 'libai_skill1',
    name: '醉剑',
    type: 'damage',
    description: '对一格十字内的单体目标造成7点伤害，自己获得一层醉意',
    rangeType: 'cross',
    range: 1,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target?.position || !caster.position) return fail('没有敌人');
        if (MovementSystem.getManhattanDistance(caster.position, target.position) !== 1) {
            return fail('目标必须在一格十字内（上下左右相邻）');
        }
        const damage = damageOne(caster, target, 7, gameState);
        // 醉意上限 4 层
        EffectManager.setCounter(caster, '醉意', Math.min(4, EffectManager.getCounter(caster, '醉意') + 1));
        return {
            ...result(),
            damageDealt: [damage.finalDamage],
            log: [`${caster.name}获得一层醉意`],
        };
    },
};

/**
 * 计算李太白技能2「前方 2x3」矩形范围（方向来自 __libai_skill2_dir：0上 1下 2左 3右）
 */
export function getLibaiFrontRect(caster: Hero): Position[] {
    const dirCode = caster.counters['__libai_skill2_dir'];
    if (dirCode === undefined || !caster.position) return [];
    const [cr, cc] = caster.position;
    const positions: Position[] = [];
    for (let i = 1; i <= 2; i++) {
        for (let j = -1; j <= 1; j++) {
            let r = cr;
            let c = cc;
            if (dirCode === 0) { r = cr - i; c = cc + j; }
            else if (dirCode === 1) { r = cr + i; c = cc + j; }
            else if (dirCode === 2) { r = cr + j; c = cc - i; }
            else { r = cr + j; c = cc + i; }
            if (r >= 0 && r < 6 && c >= 0 && c < 6) positions.push([r, c]);
        }
    }
    return positions;
}

/**
 * 李太白技能2：前方 2x3 矩形内所有敌人受到 醉意数 x 4 伤害，醉意清空
 */
export const libaiSkill2: Skill = {
    id: 'libai_skill2',
    name: '醉斩',
    type: 'damage',
    description: '对前方2x3范围内的所有敌方角色造成醉意数x4伤害，醉意清空',
    rangeType: 'line',
    range: 2,
    targetType: 'enemy',
    targetCount: 'all',
    execute: (caster, _targets, gameState) => {
        const zuiyi = EffectManager.getCounter(caster, '醉意');
        if (zuiyi < 1) return fail('醉意不足，无法释放醉斩');
        const rect = getLibaiFrontRect(caster);
        if (rect.length === 0) return fail('未选择方向');
        const targets = rect.map(([r, c]) => gameState.board[r][c])
            .filter((hero): hero is Hero => !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);
        if (targets.length === 0) return fail('前方范围内没有敌人');
        const output = result();
        for (const target of targets) {
            const damage = damageOne(caster, target, zuiyi * 4, gameState, true);
            output.damageDealt?.push(damage.finalDamage);
        }
        EffectManager.addCounter(caster, '醉意', -zuiyi);
        output.log.push(`${caster.name}释放醉斩，消耗了${zuiyi}层醉意`);
        return output;
    },
};

/**
 * 计算醉枕刀掷刀的最优路径：≤7步从起点到终点，踩过敌人最多（不重复踩同一格子）。
 * 可通行：空位与敌方格子；友方格子不可通行。返回路径（不含起点）与踩过的敌人。
 */
export function computeMaxEnemyPath(
    start: Position,
    end: Position,
    gameState: GameState,
    owner: Player
): { path: Position[]; enemies: Hero[] } | null {
    const maxSteps = 7;
    let best: { path: Position[]; enemies: Hero[] } | null = null;
    const visited = new Set<string>([`${start[0]},${start[1]}`]);
    const path: Position[] = [];
    const enemies: Hero[] = [];

    const dfs = (pos: Position, steps: number) => {
        if (pos[0] === end[0] && pos[1] === end[1]) {
            const better =
                !best ||
                enemies.length > best.enemies.length ||
                (enemies.length === best.enemies.length && path.length < best.path.length);
            if (better) {
                best = { path: [...path], enemies: [...enemies] };
            }
            return; // 到达终点即记录，不再继续扩展，避免绕圈
        }
        if (steps >= maxSteps) return;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const nr = pos[0] + dr;
            const nc = pos[1] + dc;
            if (nr < 0 || nr >= 6 || nc < 0 || nc >= 6) continue;
            const key = `${nr},${nc}`;
            if (visited.has(key)) continue;
            const occupant = gameState.board[nr][nc];
            if (occupant && occupant.owner === owner && occupant.state === HeroState.ALIVE) continue;
            const isEnemy = !!occupant && occupant.owner !== owner && occupant.state === HeroState.ALIVE;
            visited.add(key);
            path.push([nr, nc]);
            if (isEnemy) enemies.push(occupant);
            dfs([nr, nc], steps + 1);
            if (isEnemy) enemies.pop();
            path.pop();
            visited.delete(key);
        }
    };

    dfs(start, 0);
    return best;
}

/**
 * 醉枕刀技能1：向前方三格掷刀，7步内沿踩敌最多的路径拾刀
 */
export const zuizhendaoSkill1: Skill = {
    id: 'zuizhendao_skill1',
    name: '掷刀',
    type: 'damage',
    description: '向前方三格掷出刀，7步内沿踩敌最多的路径拾刀；沿途敌人受4伤害，每穿过1个敌人获得1层醉意',
    rangeType: 'line',
    range: 3,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        const dirCode = caster.counters['__zuizhendao_skill1_dir'];
        if (dirCode === undefined || !caster.position) return fail('未选择掷刀方向');
        const [cr, cc] = caster.position;
        const step = dirCode === 0 ? [-1, 0] : dirCode === 1 ? [1, 0] : dirCode === 2 ? [0, -1] : [0, 1];
        const end: Position = [cr + step[0] * 3, cc + step[1] * 3];
        if (end[0] < 0 || end[0] >= 6 || end[1] < 0 || end[1] >= 6) {
            return fail('刀飞出棋盘，请换一个方向');
        }
        if (gameState.board[end[0]][end[1]] !== null) {
            return fail('刀落点被占据，请换一个方向');
        }
        const plan = computeMaxEnemyPath(caster.position, end, gameState, caster.owner);
        if (!plan) return fail('7步内无法到达刀的位置');
        // 沿路径移动到刀的位置
        const [fromR, fromC] = caster.position;
        gameState.board[fromR][fromC] = null;
        gameState.board[end[0]][end[1]] = caster;
        caster.position = end;
        const output = result();
        DamageCalculator.applyDilanMovementDamage(caster, plan.path.length, gameState);
        if (caster.state !== HeroState.ALIVE) {
            output.log.push(`${caster.name}在拾刀移动中触发羽化伤害并阵亡`);
            return output;
        }
        for (const enemy of plan.enemies) {
            const damage = damageOne(caster, enemy, 4, gameState);
            output.damageDealt?.push(damage.finalDamage);
            EffectManager.addCounter(caster, '醉意', 1);
        }
        output.log.push(`${caster.name}拾刀后获得${plan.enemies.length}层醉意`);
        return output;
    },
};

/**
 * 醉枕刀技能2：与任意友方交换位置，随后对周围一圈敌人造成8伤害
 */
export const zuizhendaoSkill2: Skill = {
    id: 'zuizhendao_skill2',
    name: '换位斩',
    type: 'damage',
    description: '与任意距离的友方交换位置，随后对周围一圈敌方角色造成8点伤害，每命中1个获得1层醉意',
    rangeType: '全场',
    range: 6,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const ally = targets[0];
        if (!ally?.position || !caster.position) return fail('请选择友方交换位置');
        if (ally === caster) return fail('不能与自己交换位置');
        // 交换位置
        const [cr, cc] = caster.position;
        const [ar, ac] = ally.position;
        gameState.board[cr][cc] = ally;
        gameState.board[ar][ac] = caster;
        caster.position = [ar, ac];
        ally.position = [cr, cc];
        const movedSteps = Math.abs(cr - ar) + Math.abs(cc - ac);
        DamageCalculator.applyDilanMovementDamage(caster, movedSteps, gameState);
        DamageCalculator.applyDilanMovementDamage(ally, movedSteps, gameState);
        const output = result();
        if (caster.state !== HeroState.ALIVE) {
            output.log.push(`${caster.name}在换位中触发羽化伤害并阵亡`);
            return output;
        }
        // 周围一圈（8方向）敌人
        const ring = MovementSystem.getAreaPositions(caster.position, 3);
        const enemies = ring.map(([r, c]) => gameState.board[r][c])
            .filter((hero): hero is Hero => !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);
        for (const enemy of enemies) {
            const damage = damageOne(caster, enemy, 8, gameState, true);
            output.damageDealt?.push(damage.finalDamage);
            EffectManager.addCounter(caster, '醉意', 1);
        }
        output.log.push(`${caster.name}与${ally.name}交换位置，斩中${enemies.length}名敌人`);
        return output;
    },
};

type FeixueDamageOptions = {
    area?: boolean;
    ignoreDefense?: boolean;
    forceCrit?: boolean;
};

/**
 * 绯雪的百分比真实伤害与普通伤害视为同一次技能命中：
 * 普通段可以暴击，百分比段不暴击、不计入吸血，但两段只触发一次受击/击杀结算。
 */
function dealFeixueSkillDamage(
    caster: Hero,
    target: Hero,
    baseDamage: number,
    gameState: GameState,
    options: FeixueDamageOptions = {}
) {
    const hantianStacks = DamageCalculator.getHantianStackCount(target);
    const damage = DamageCalculator.calculate(
        caster,
        target,
        baseDamage,
        false,
        options.ignoreDefense ?? false,
        { forceCrit: options.forceCrit }
    );

    let passiveDamage = 0;
    if (hantianStacks > 0) {
        const ratePerStack = caster.counters['talent_3'] ? 0.1 : 0.05;
        const rawPassiveDamage = Math.max(
            1,
            Math.floor(target.maxHp * ratePerStack * hantianStacks)
        );
        const passive = DamageCalculator.calculate(
            caster,
            target,
            rawPassiveDamage,
            false,
            true,
            { canCrit: false }
        );
        passiveDamage = passive.finalDamage;
        damage.finalDamage += passiveDamage;
    }

    DamageCalculator.applyDamage(target, damage, caster, gameState, options.area ?? false);
    return { damage, hantianStacks, passiveDamage };
}

export const feixueSkill1: Skill = {
    id: 'feixue_skill1',
    name: '霜刃破阵',
    type: 'damage',
    description: '对两格内一名敌人造成8点伤害；若目标处于冰冻，则击碎冰冻，使主伤害与周围一格爆炸变为真实伤害，爆炸造成6点伤害并施加1层寒天',
    rangeType: 'single',
    range: 2,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 8,
    scalesWithAttack: false,
    canCrit: true,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target || target.state !== HeroState.ALIVE) return fail(`${caster.name}的技能1没有找到目标`);

        const targetPosition = target.position ? [...target.position] as Position : null;
        const shattered = EffectManager.hasEffect(target, '冰冻');
        if (shattered) EffectManager.removeEffectByName(target, '冰冻');

        const output = result();
        const primary = dealFeixueSkillDamage(caster, target, 8, gameState, {
            ignoreDefense: shattered,
        });
        output.damageDealt?.push(primary.damage.finalDamage);
        output.log.push(
            `${caster.name}使用霜刃破阵对${target.name}造成${primary.damage.finalDamage}点伤害${
                primary.damage.isCrit ? '（暴击）' : ''
            }${primary.passiveDamage > 0 ? `，其中霜噬附加${primary.passiveDamage}点真实伤害` : ''}`
        );

        if (!shattered || !targetPosition) return output;

        const splashDamage = caster.counters['talent_2'] ? 8 : 6;
        const splashTargets = MovementSystem.getAreaPositions(targetPosition, 3)
            .map(([row, col]) => gameState.board[row][col])
            .filter((hero): hero is Hero =>
                !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE
            );

        for (const splashTarget of splashTargets) {
            const splash = dealFeixueSkillDamage(caster, splashTarget, splashDamage, gameState, {
                area: true,
                ignoreDefense: true,
            });
            output.damageDealt?.push(splash.damage.finalDamage);
            const survived = splashTarget.state === HeroState.ALIVE;
            if (survived) {
                DamageCalculator.applyHantianStacks(splashTarget, 1, caster.id, gameState);
            }
            output.log.push(
                `破冰冲击对${splashTarget.name}造成${splash.damage.finalDamage}点真实伤害${
                    survived ? '并施加1层寒天' : ''
                }`
            );
        }

        output.log.push(`${caster.name}击碎了${target.name}的冰冻`);
        return output;
    },
};

export const feixueSkill2: Skill = {
    id: 'feixue_skill2',
    name: '踏雪追命',
    type: 'damage',
    description: '对周围一格一名敌人造成8点伤害，每层寒天额外增加2点、附加霜噬真实伤害并回复2点生命；未冰冻时消耗寒天，冰冻时必定暴击且保留寒天与冰冻',
    rangeType: 'single',
    range: 1,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 8,
    scalesWithAttack: false,
    canCrit: true,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target || target.state !== HeroState.ALIVE) return fail(`${caster.name}的技能2没有找到目标`);

        const frozen = EffectManager.hasEffect(target, '冰冻');
        const hantianStacks = DamageCalculator.getHantianStackCount(target);
        const hit = dealFeixueSkillDamage(
            caster,
            target,
            8 + hantianStacks * 2,
            gameState,
            { forceCrit: frozen }
        );

        const output = result();
        output.damageDealt?.push(hit.damage.finalDamage);
        output.log.push(
            `${caster.name}使用踏雪追命对${target.name}造成${hit.damage.finalDamage}点伤害${
                hit.damage.isCrit ? '（暴击）' : ''
            }${hit.passiveDamage > 0 ? `，其中霜噬附加${hit.passiveDamage}点真实伤害` : ''}`
        );

        if (hantianStacks > 0) {
            const consumed = frozen ? 0 : DamageCalculator.consumeHantianStacks(target);
            const healed = caster.state === HeroState.ALIVE
                ? DamageCalculator.applyHeal(caster, hantianStacks * 2, gameState, caster)
                : 0;
            output.healingDone?.push(healed);
            output.log.push(
                frozen
                    ? `${caster.name}借${hantianStacks}层寒天恢复${healed}点生命，${target.name}的冰冻与寒天被保留`
                    : `${caster.name}消耗${consumed}层寒天，恢复${healed}点生命`
            );
        } else if (frozen) {
            output.log.push(`${target.name}的冰冻与寒天被保留`);
        }

        return output;
    },
};

function isFenglingInOwnSandDune(caster: Hero, gameState: GameState): boolean {
    if (!caster.position) return false;
    return (gameState.boardEffects ?? []).some(effect =>
        effect.type === 'sand-dune' &&
        effect.sourceHeroId === caster.id &&
        Math.abs(effect.position[0] - caster.position![0]) <= 1 &&
        Math.abs(effect.position[1] - caster.position![1]) <= 1
    );
}

/** 风铃的基础攻击：8点基础攻击力，受猎砂与沙丘的攻击、暴击修正。 */
function dealFenglingBasicAttack(
    caster: Hero,
    target: Hero,
    gameState: GameState,
    targetAlreadyActed = false
) {
    const inSandDune = isFenglingInOwnSandDune(caster, gameState);
    const damage = DamageCalculator.calculate(caster, target, 0, true, false, {
        damageMultiplier: (targetAlreadyActed ? 1.5 : 1) * (inSandDune ? 1.3 : 1),
        critDamageBonus: inSandDune ? 0.2 : 0,
    });
    DamageCalculator.applyDamage(target, damage, caster, gameState);
    return damage;
}

export const fenglingSkill1: Skill = {
    id: 'fengling_skill1',
    name: '流沙追猎',
    type: 'damage',
    description: '对一格内一名敌人发动8点基础攻击；目标已行动则伤害提高50%，否则强制其立即完成本回合的正常行动',
    rangeType: 'single',
    range: 1,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 8,
    scalesWithAttack: true,
    canCrit: true,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target || target.state !== HeroState.ALIVE) return fail('请选择一格内的敌人');

        const targetAlreadyActed = target.hasActedThisTurn;
        const damage = dealFenglingBasicAttack(caster, target, gameState, targetAlreadyActed);
        const output = result([
            `${caster.name}追猎${target.name}，造成${damage.finalDamage}点伤害${
                targetAlreadyActed ? '（目标已行动，伤害提高50%）' : ''
            }${damage.isCrit ? '（暴击）' : ''}`,
        ]);
        output.damageDealt?.push(damage.finalDamage);

        if (!targetAlreadyActed && target.state === HeroState.ALIVE) {
            gameState.pendingForcedActionHeroId = target.id;
            output.log.push(`${target.name}被强制锁定，必须立即完成本回合行动`);
        }
        return output;
    },
};

export const fenglingSkill2: Skill = {
    id: 'fengling_skill2',
    name: '沙丘猎场',
    type: 'buff',
    description: '以自身为中心创造3×3沙丘，持续2回合；风铃在其中受伤会累积20%闪避，暴击伤害提高20%，攻击增伤30%',
    rangeType: 'area',
    range: 0,
    areaSize: 3,
    targetType: 'self',
    targetCount: 1,
    canCrit: false,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('风铃尚未部署');
        gameState.boardEffects ??= [];
        gameState.boardEffects = gameState.boardEffects.filter(effect =>
            !(effect.type === 'sand-dune' && effect.sourceHeroId === caster.id)
        );
        gameState.boardEffects.push({
            id: `sand-dune-${caster.id}-${Date.now()}-${Math.random()}`,
            type: 'sand-dune',
            position: [...caster.position],
            owner: caster.owner,
            sourceHeroId: caster.id,
            duration: 2,
        });
        EffectManager.setCounter(caster, '沙丘闪避', 0);
        return result([`${caster.name}在周围创造了持续2回合的沙丘猎场`]);
    },
};

function dilanDirectionStep(dirCode: number): Position {
    if (dirCode === 0) return [-1, 0];
    if (dirCode === 1) return [1, 0];
    if (dirCode === 2) return [0, -1];
    return [0, 1];
}

/** 帝兰技能2的前方2×3范围。 */
export function getDilanFrontRect(caster: Hero): Position[] {
    const dirCode = caster.counters['__dilan_skill2_dir'];
    if (dirCode === undefined || !caster.position) return [];
    const [cr, cc] = caster.position;
    const positions: Position[] = [];
    for (let depth = 1; depth <= 2; depth++) {
        for (let side = -1; side <= 1; side++) {
            let row = cr;
            let col = cc;
            if (dirCode === 0) { row = cr - depth; col = cc + side; }
            else if (dirCode === 1) { row = cr + depth; col = cc + side; }
            else if (dirCode === 2) { row = cr + side; col = cc - depth; }
            else { row = cr + side; col = cc + depth; }
            if (row >= 0 && row < 6 && col >= 0 && col < 6) positions.push([row, col]);
        }
    }
    return positions;
}

function dealDilanSkillHit(
    caster: Hero,
    target: Hero,
    baseDamage: number,
    gameState: GameState,
    area: boolean
): { damage: number; detonatedStacks: number } {
    const featherStacks = getDilanFeatherStacks(target, caster.id);
    const detonatedStacks = featherStacks >= 3 ? consumeDilanFeather(target, caster.id) : 0;
    const amount = detonatedStacks > 0 ? baseDamage * detonatedStacks : baseDamage;
    const hit = damageOne(caster, target, amount, gameState, area);
    if (target.state === HeroState.ALIVE && detonatedStacks === 0) {
        addDilanFeather(target, caster, 1);
    }
    return { damage: hit.finalDamage, detonatedStacks };
}

export const dilanSkill1: Skill = {
    id: 'dilan_skill1',
    name: '顺逆长风',
    type: 'damage',
    description: '选择所在行或列：对轴线上所有敌人造成3点伤害并施加1层逆风；所有友方改为获得1层顺风。致知1使伤害提高至4点',
    rangeType: 'line',
    range: 6,
    targetType: 'any',
    targetCount: 'all',
    baseDamage: 3,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('帝兰尚未部署');
        const axis = caster.counters['__dilan_skill1_axis'];
        if (axis !== 0 && axis !== 1) return fail('请先选择行或列');
        delete caster.counters['__dilan_skill1_axis'];
        const [casterRow, casterCol] = caster.position;
        const line: Hero[] = [];
        for (let index = 0; index < 6; index++) {
            const hero = axis === 0 ? gameState.board[casterRow][index] : gameState.board[index][casterCol];
            if (hero && hero !== caster && hero.state === HeroState.ALIVE) line.push(hero);
        }
        if (line.length === 0) return fail('所选行列上没有其他角色');

        const output = result();
        const baseDamage = caster.counters['talent_1'] ? 4 : 3;
        for (const target of line) {
            if (target.owner === caster.owner) {
                applyDilanWind(target, caster, '顺风');
                output.log.push(`${target.name}获得1层顺风`);
                continue;
            }
            const hit = dealDilanSkillHit(caster, target, baseDamage, gameState, true);
            output.damageDealt?.push(hit.damage);
            if (target.state === HeroState.ALIVE) applyDilanWind(target, caster, '逆风');
            output.log.push(
                `${caster.name}对${target.name}造成${hit.damage}点伤害并施加逆风${
                    hit.detonatedStacks > 0 ? `，引爆${hit.detonatedStacks}层羽化` : ''
                }`
            );
        }
        return output;
    },
};

export const dilanSkill2: Skill = {
    id: 'dilan_skill2',
    name: '风压横扫',
    type: 'damage',
    description: '对前方2×3范围内所有敌人造成3点伤害，并沿施法方向击退1格。致知2使伤害提高至4点',
    rangeType: 'line',
    range: 2,
    targetType: 'enemy',
    targetCount: 'all',
    baseDamage: 3,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        const dirCode = caster.counters['__dilan_skill2_dir'];
        if (dirCode === undefined) return fail('请先选择风压方向');
        const rect = getDilanFrontRect(caster);
        delete caster.counters['__dilan_skill2_dir'];
        const enemies = rect
            .map(([row, col]) => gameState.board[row][col])
            .filter((hero): hero is Hero => !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);
        if (enemies.length === 0) return fail('前方范围内没有敌人');

        const output = result();
        const baseDamage = caster.counters['talent_2'] ? 4 : 3;
        const [dr, dc] = dilanDirectionStep(dirCode);
        const hitEnemies: Hero[] = [];
        for (const enemy of enemies) {
            const hit = dealDilanSkillHit(caster, enemy, baseDamage, gameState, true);
            output.damageDealt?.push(hit.damage);
            output.log.push(
                `${caster.name}以风压命中${enemy.name}，造成${hit.damage}点伤害${
                    hit.detonatedStacks > 0 ? `并引爆${hit.detonatedStacks}层羽化` : ''
                }`
            );
            if (enemy.state === HeroState.ALIVE) hitEnemies.push(enemy);
        }

        // 按施法方向从远到近处理，允许同一直线上的多个目标依次被推出。
        hitEnemies.sort((left, right) => {
            const leftProjection = left.position![0] * dr + left.position![1] * dc;
            const rightProjection = right.position![0] * dr + right.position![1] * dc;
            return rightProjection - leftProjection;
        });
        for (const enemy of hitEnemies) {
            if (!enemy.position) continue;
            const [row, col] = enemy.position;
            const destination: Position = [row + dr, col + dc];
            if (
                destination[0] < 0 || destination[0] >= 6 ||
                destination[1] < 0 || destination[1] >= 6 ||
                gameState.board[destination[0]][destination[1]] !== null
            ) {
                output.log.push(`${enemy.name}的击退路径被阻挡`);
                continue;
            }
            gameState.board[row][col] = null;
            gameState.board[destination[0]][destination[1]] = enemy;
            enemy.position = destination;
            DamageCalculator.applyDilanMovementDamage(enemy, 1, gameState);
            output.log.push(`${enemy.name}被击退1格`);
        }
        return output;
    },
};

/** 上官婉儿毛笔寿命：最多朝婉儿移动的次数 */
export const SHANGGUAN_BRUSH_LIFETIME = 3;

/** 查找指定格子上的毛笔（上官婉儿的棋盘效果） */
export function findBrushAt(gameState: GameState, row: number, col: number): BoardEffect | undefined {
    return (gameState.boardEffects ?? []).find(
        effect =>
            effect.type === 'brush' &&
            effect.position[0] === row &&
            effect.position[1] === col
    );
}

export interface ShangguanDashScan {
    ok: boolean;
    reason?: string;
    kind?: 'enemy' | 'brush';
    targetId?: string;
    targetName?: string;
    /** 目标所在格 */
    targetPos?: Position;
    /** 本段落点（目标身后一格；无法越过后则停在目标前一格） */
    landPos?: Position;
}

/**
 * 只读扫描一个连冲方向（不修改状态）：
 * - 友方英雄、已命中过的敌方英雄、已借力过的毛笔均视为阻挡；
 * - 路径上第一个"未命中的敌方英雄或毛笔"即本段目标；
 * - 落点为目标身后一格；若该格越界/被英雄占据/有毛笔，则停在目标前一格
 *   （目标与婉儿相邻时原地不动，贴脸攻击）。
 */
export function scanShangguanDashDirection(
    caster: Hero,
    dirR: number,
    dirC: number,
    hitTargets: string[],
    gameState: GameState
): ShangguanDashScan {
    if (!caster.position) return { ok: false, reason: '婉儿不在场上' };
    const [hr, hc] = caster.position;
    let standR = hr;
    let standC = hc;
    let r = hr;
    let c = hc;

    for (let step = 0; step < 12; step++) {
        const nr = r + dirR;
        const nc = c + dirC;
        if (nr < 0 || nr >= 6 || nc < 0 || nc >= 6) {
            return { ok: false, reason: '该方向没有可命中的敌人或毛笔' };
        }
        const occupant = gameState.board[nr][nc];
        if (occupant && occupant.state === HeroState.ALIVE) {
            if (occupant.owner === caster.owner) {
                return { ok: false, reason: `${occupant.name}挡住了去路` };
            }
            if (hitTargets.includes(occupant.id)) {
                return { ok: false, reason: `${occupant.name}已被命中过，不可重复` };
            }
            return {
                ok: true,
                kind: 'enemy',
                targetId: occupant.id,
                targetName: occupant.name,
                targetPos: [nr, nc],
                landPos: shangguanLandingPos(gameState, nr, nc, dirR, dirC, standR, standC),
            };
        }
        const brush = findBrushAt(gameState, nr, nc);
        if (brush) {
            if (hitTargets.includes(brush.id)) {
                return { ok: false, reason: '这支毛笔已经借力过了，不可重复' };
            }
            return {
                ok: true,
                kind: 'brush',
                targetId: brush.id,
                targetName: '毛笔',
                targetPos: [nr, nc],
                landPos: shangguanLandingPos(gameState, nr, nc, dirR, dirC, standR, standC),
            };
        }
        if (!occupant && !brush) {
            standR = nr;
            standC = nc;
        }
        r = nr;
        c = nc;
    }
    return { ok: false, reason: '该方向没有可命中的敌人或毛笔' };
}

function shangguanLandingPos(
    gameState: GameState,
    targetR: number,
    targetC: number,
    dirR: number,
    dirC: number,
    fallbackR: number,
    fallbackC: number
): Position {
    const behindR = targetR + dirR;
    const behindC = targetC + dirC;
    const inBounds = behindR >= 0 && behindR < 6 && behindC >= 0 && behindC < 6;
    if (
        inBounds &&
        gameState.board[behindR][behindC] === null &&
        !findBrushAt(gameState, behindR, behindC)
    ) {
        return [behindR, behindC];
    }
    return [fallbackR, fallbackC];
}

/** 一段连冲的结算结果 */
export interface ShangguanDashOutcome {
    success: boolean;
    message?: string;
    hitKind?: 'enemy' | 'brush';
    hitId?: string;
    hitName?: string;
    damage?: number;
    killed?: boolean;
}

/**
 * 执行一段连冲：
 * - 命中敌方英雄：6点固定伤害（不可闪避）；
 * - 命中毛笔：借力（毛笔不受伤、不消失）；
 * - 随后把婉儿移动到落点（落点等于当前位置时不移动）。
 * 目标通过 hitTargets 去重；命中后调用方应把 hitId 追加进去。
 */
export function performShangguanDashSegment(
    caster: Hero,
    dirR: number,
    dirC: number,
    hitTargets: string[],
    gameState: GameState
): ShangguanDashOutcome {
    const scan = scanShangguanDashDirection(caster, dirR, dirC, hitTargets, gameState);
    if (!scan.ok || !scan.targetPos || !scan.landPos || !caster.position) {
        return { success: false, message: scan.reason ?? '该方向无法连冲' };
    }

    const output: ShangguanDashOutcome = { success: true, hitKind: scan.kind, hitId: scan.targetId, hitName: scan.targetName };

    // 结算目标
    if (scan.kind === 'enemy') {
        const enemy = gameState.board[scan.targetPos[0]][scan.targetPos[1]];
        if (enemy && enemy.state === HeroState.ALIVE) {
            const dmg = DamageCalculator.calculate(
                caster,
                enemy,
                6,
                false,
                false,
                { fixedDamage: true, canCrit: false }
            );
            DamageCalculator.applyDamage(enemy, dmg, caster, gameState);
            output.damage = dmg.finalDamage;
            output.killed = enemy.state !== HeroState.ALIVE;
        }
    }
    // 毛笔：借力，不受伤

    // 移动到落点
    const [lr, lc] = scan.landPos;
    const [hr, hc] = caster.position;
    if (lr !== hr || lc !== hc) {
        if (gameState.board[hr][hc] === caster) gameState.board[hr][hc] = null;
        gameState.board[lr][lc] = caster;
        caster.position = [lr, lc];
    }
    return output;
}

/** 是否还存在可继续的连冲方向（任一方向上有未命中的敌人或毛笔） */
export function hasShangguanDashOption(
    caster: Hero,
    hitTargets: string[],
    gameState: GameState
): boolean {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        if (scanShangguanDashDirection(caster, dr, dc, hitTargets, gameState).ok) {
            return true;
        }
    }
    return false;
}

/**
 * 上官婉儿技能1：落笔
 * 在四方向之一、距离1~3格处落下毛笔（允许落在敌方英雄身上，落笔瞬间对其造成
 * 6点固定伤害）；毛笔随后每回合朝婉儿移动1格（最多移动3次），经过/落点处的
 * 敌人受到6点固定伤害，抵达婉儿或寿命耗尽时消失。
 */
export const shangguanSkill1: Skill = {
    id: 'shangguan_skill1',
    name: '落笔',
    type: 'special',
    description: '在四方向之一、距离1~3格处落下毛笔（可落在敌人身上并立即造成6点固定伤害）；毛笔每回合朝自己移动1格（最多3次），经过的敌人受到6点固定伤害。',
    rangeType: 'line',
    range: 3,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('婉儿不在场上');
        const clicked = encodedTarget(caster);
        if (!clicked) return fail('未选择落笔位置');
        const dist = MovementSystem.getManhattanDistance(caster.position, clicked);
        const dir = MovementSystem.getDirection(caster.position, clicked);
        if (!dir || dist < 1 || dist > 3) {
            return fail('毛笔只能落在四方向距离1~3格的位置');
        }
        const [r, c] = clicked;
        const occupant = gameState.board[r][c];
        if (occupant && occupant.owner === caster.owner && occupant.state === HeroState.ALIVE) {
            return fail('毛笔不能落在友方英雄身上');
        }
        if (findBrushAt(gameState, r, c)) {
            return fail('该位置已有毛笔');
        }

        const output = result();
        // 落在敌方英雄身上：立即造成6点固定伤害（不可闪避）
        if (occupant && occupant.owner !== caster.owner && occupant.state === HeroState.ALIVE) {
            const dmg = DamageCalculator.calculate(
                caster,
                occupant,
                6,
                false,
                false,
                { fixedDamage: true, canCrit: false }
            );
            DamageCalculator.applyDamage(occupant, dmg, caster, gameState);
            output.damageDealt?.push(dmg.finalDamage);
            output.log.push(`毛笔直落${occupant.name}，造成${dmg.finalDamage}点固定伤害`);
        }

        gameState.boardEffects ??= [];
        gameState.boardEffects.push({
            id: `brush-${caster.id}-${Date.now()}-${Math.random()}`,
            type: 'brush',
            position: [r, c],
            owner: caster.owner,
            sourceHeroId: caster.id,
            duration: SHANGGUAN_BRUSH_LIFETIME,
        });
        output.log.push(`${caster.name}在(${r},${c})落下一支毛笔`);
        return output;
    },
};

/**
 * 上官婉儿技能2：连冲（多段）
 * 每段朝选定方向冲刺，命中路径上最近的敌人（6点固定伤害）或毛笔（借力）后停下，
 * 落点为目标身后一格；玩家可继续选新方向连冲，同一目标不可重复命中。
 * 多段交互由 game-store 的 shangguanDashState 管理。
 */
export const shangguanSkill2: Skill = {
    id: 'shangguan_skill2',
    name: '连冲',
    type: 'damage',
    description: '朝选定方向冲刺，撞上敌人造成6点固定伤害或借毛笔借力后停在目标身后一格；命中后可选择新方向继续连冲，同一目标不可重复。',
    rangeType: 'line',
    range: 4,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('婉儿不在场上');
        const clicked = encodedTarget(caster);
        if (!clicked) return fail('未选择连冲方向');
        const [hr, hc] = caster.position;
        const isAdj =
            (Math.abs(clicked[0] - hr) === 1 && clicked[1] === hc) ||
            (Math.abs(clicked[1] - hc) === 1 && clicked[0] === hr);
        if (!isAdj) return fail('请点击相邻的方向格选择连冲方向');
        const dirR = Math.sign(clicked[0] - hr);
        const dirC = Math.sign(clicked[1] - hc);

        const outcome = performShangguanDashSegment(caster, dirR, dirC, [], gameState);
        if (!outcome.success) return fail(outcome.message ?? '该方向无法连冲');

        const output = result();
        output.log.push(`${caster.name}发动连冲`);
        if (outcome.hitKind === 'enemy') {
            output.damageDealt?.push(outcome.damage ?? 0);
            output.log.push(`撞击${outcome.hitName}，造成${outcome.damage}点固定伤害`);
        } else {
            output.log.push(`掠过${outcome.hitName}获得再次冲刺之势`);
        }
        const pos = caster.position;
        output.log.push(`${caster.name}落至(${pos[0]},${pos[1]})`);
        return output;
    },
};

/**
 * 沉渊·镇岳技能1「渊引」：
 * 拖拽直线方向上3格内的一个敌人到自己周围一格范围内，
 * 对其造成6点伤害，并施加1层寒天。
 * 拉拽沿直线逐步进行，遇到障碍（棋盘边界或其他单位）即停下。
 */
export const chenyuanSkill1: Skill = {
    id: 'chenyuan_skill1',
    name: '渊引',
    type: 'damage',
    description: '拖拽直线方向上3格内的一个敌人到自己周围一格范围内，对其造成6点伤害并施加1层寒天',
    rangeType: 'single',
    range: 3,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 6,
    canCrit: false,
    execute: (caster, targets, gameState) => {
        if (!caster.position) return fail('沉渊尚未部署');
        const target = targets[0];
        if (!target || target.state !== HeroState.ALIVE || !target.position) {
            return fail('请选择直线方向上3格内的敌人');
        }
        const sameRow = target.position[0] === caster.position[0];
        const sameCol = target.position[1] === caster.position[1];
        const distance = MovementSystem.getManhattanDistance(caster.position, target.position);
        if ((!sameRow && !sameCol) || distance > 3) {
            return fail('目标必须与沉渊处于同一直线且距离不超过3格');
        }

        const output = result();

        // 沿直线逐步拉近，直到与施法者相邻或被阻挡
        let pulled = 0;
        while (caster.position && target.position) {
            if (MovementSystem.getManhattanDistance(caster.position, target.position) <= 1) break;
            const [tr, tc] = target.position;
            const stepRow = Math.sign(caster.position[0] - tr);
            const stepCol = Math.sign(caster.position[1] - tc);
            const next: Position = [tr + stepRow, tc + stepCol];
            if (next[0] < 0 || next[0] >= 6 || next[1] < 0 || next[1] >= 6) break;
            if (gameState.board[next[0]][next[1]] !== null) break;
            gameState.board[tr][tc] = null;
            gameState.board[next[0]][next[1]] = target;
            target.position = next;
            pulled++;
        }

        output.log.push(
            pulled > 0
                ? `${caster.name}将${target.name}拖拽${pulled}格至身旁`
                : `${target.name}的拖拽路径受阻`
        );

        // 造成6点伤害并施加1层寒天
        const damage = damageOne(caster, target, 6, gameState);
        output.damageDealt?.push(damage.finalDamage);
        DamageCalculator.applyHantianStacks(target, 1, caster.id, gameState);
        output.log.push(
            `${caster.name}对${target.name}造成${damage.finalDamage}点伤害${
                target.state === HeroState.ALIVE
                    ? `，获得1层寒天（当前${DamageCalculator.getHantianStackCount(target)}层）`
                    : ''
            }`
        );
        return output;
    },
};

/**
 * 沉渊·镇岳技能2「寒渊庇护」：
 * 援护周围2格范围内的所有友方：友方受到伤害的30%由沉渊承担，持续两回合。
 */
export const chenyuanSkill2: Skill = {
    id: 'chenyuan_skill2',
    name: '寒渊庇护',
    type: 'buff',
    description: '援护周围2格范围内的所有友方：友方受到的伤害30%由自己承担，持续两回合',
    rangeType: 'area',
    range: 2,
    areaSize: 5,
    targetType: 'ally',
    targetCount: 'all',
    execute: (caster, targets, _gameState) => {
        if (targets.length === 0) return fail('周围2格内没有可援护的友方');

        const output = result();
        for (const target of targets) {
            // 先移除目标身上由自己施加的旧援护效果（如果有的话）
            target.effects = target.effects.filter(effect =>
                !(effect.name === '援护' && effect.sourceHeroId === caster.id)
            );
            EffectManager.addEffect(target, {
                type: 'buff',
                name: '援护',
                duration: 2,
                value: 0.3,
                sourceHeroId: caster.id,
                description: '受到伤害的30%由沉渊·镇岳承担，持续2回合',
            });
            output.log.push(`${target.name}获得沉渊的援护`);
        }
        return output;
    },
};

export const EXTENDED_SKILLS: Record<string, Skill> = {
    skeletonking_skill1: skeletonkingSkill1,
    skeletonking_skill2: skeletonkingSkill2,
    jetzmi_skill1: jetzmiSkill1,
    jetzmi_skill2: jetzmiSkill2,
    pipa_skill1: pipaSkill1,
    pipa_skill2: pipaSkill2,
    bounty_skill1: bountySkill1,
    bounty_skill2: bountySkill2,
    yinyang_skill1: yinyangSkill1,
    yinyang_skill2: yinyangSkill2,
    soul_lamp_skill1: soulLampSkill1,
    soul_lamp_skill2: soulLampSkill2,
    hero_x_skill1: heroXSkill1,
    hero_x_skill2: heroXSkill2,
    bard_skill1: bardSkill1,
    bard_skill2: bardSkill2,
    wither_lord_skill1: witherLordSkill1,
    wither_lord_skill2: witherLordSkill2,
    t_painting_skill1: tPaintingSkill1,
    t_painting_skill2: tPaintingSkill2,
    jinwu_skill: jinwuSkill,
    xuangui_skill: xuanguiSkill,
    feynman_skill1: feynmanSkill1,
    feynman_skill2: feynmanSkill2,
    wangcai_skill1: wangcaiSkill1,
    wangcai_skill2: wangcaiSkill2,
    schrodinger_skill1: schrodingerSkill1,
    schrodinger_skill2: schrodingerSkill2,
    lilith_skill1: lilithSkill1,
    lilith_skill2: lilithSkill2,
    libai_skill1: libaiSkill1,
    libai_skill2: libaiSkill2,
    zuizhendao_skill1: zuizhendaoSkill1,
    zuizhendao_skill2: zuizhendaoSkill2,
    feixue_skill1: feixueSkill1,
    feixue_skill2: feixueSkill2,
    fengling_skill1: fenglingSkill1,
    fengling_skill2: fenglingSkill2,
    dilan_skill1: dilanSkill1,
    dilan_skill2: dilanSkill2,
    shangguan_skill1: shangguanSkill1,
    shangguan_skill2: shangguanSkill2,
    chenyuan_skill1: chenyuanSkill1,
    chenyuan_skill2: chenyuanSkill2,
};
