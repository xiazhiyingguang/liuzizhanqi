import { DamageCalculator } from '../core/damage-calculator';
import { EffectManager } from '../core/effect-manager';
import { GameEngine } from '../core/game-engine';
import { MovementSystem } from '../core/movement-system';
import { GameState, Hero, HeroState, Position, Skill, SkillExecuteResult } from '../types/game';
import {
    addHeroToOwnerList,
    createTPaintingSummon,
    currentDeadCount,
    getAllies,
    getEnemies,
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
    scalesWithAttack = false
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
    const damage = DamageCalculator.calculate(caster, target, adjusted, false, ignoreDefense);
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
    description: '为两格内友方施加音符，攻击时附伤并为琵琶增加和弦',
    rangeType: 'single',
    range: 2,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets) => {
        const target = targets[0];
        if (!target) return fail('没有友方目标');
        EffectManager.removeEffectByName(target, '音符');
        EffectManager.addEffect(target, {
            type: 'buff',
            name: '音符',
            duration: 2,
            value: 0.25,
            sourceHeroId: caster.id,
            description: '攻击时附加琵琶基础攻击力25%的伤害',
        });
        return result([`${target.name}获得音符`]);
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
            DamageCalculator.applyHeal(target, Math.floor((target.maxHp - target.currentHp) * healRate), gameState);
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
    rangeType: 'area',
    range: 2,
    areaSize: 3,
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
    rangeType: 'area',
    range: 2,
    areaSize: 3,
    targetType: 'ally',
    targetCount: 'all',
    execute: (_caster, targets, gameState) => {
        if (!targets.length) return fail('范围内没有友方');
        const output = result();
        for (const target of targets) {
            const passion = EffectManager.getCounter(target, '激情');
            const healed = DamageCalculator.applyHeal(target, 5 + passion * 3, gameState);
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
    description: '选择四格内一点，对周围敌人造成伤害并施加凋零',
    rangeType: 'single',
    range: 4,
    targetType: 'any',
    targetCount: 'all',
    execute: (caster, _targets, gameState) => {
        const center = encodedTarget(caster);
        if (!center) return fail('没有选择范围中心');
        const positions = MovementSystem.getAreaPositions(center, 3).concat([center]);
        const targets = positions.map(([r, c]) => gameState.board[r][c])
            .filter((hero): hero is Hero => !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);
        if (!targets.length) return fail('范围内没有敌人');
        const base = 5 + resonanceCount(caster.owner, gameState) * 2;
        const output = result();
        for (const target of targets) {
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

export const tPaintingSkill1: Skill = {
    id: 't_painting_skill1',
    name: '金乌',
    type: 'summon',
    description: '召唤金乌；已有金乌时改为两格6伤害攻击',
    rangeType: 'single',
    range: 2,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        if (!findPaintingSummon(caster, gameState, 1)) return summonPaintingUnit(caster, gameState, 'jinwu');
        const target = targets.find(hero => hero.owner !== caster.owner);
        if (!target) return fail('已有金乌，请选择敌人进行普通攻击');
        const damage = damageOne(caster, target, 6, gameState);
        return { ...result(), damageDealt: [damage.finalDamage] };
    },
};

export const tPaintingSkill2: Skill = {
    id: 't_painting_skill2',
    name: '玄龟',
    type: 'summon',
    description: '召唤玄龟；已有玄龟时改为两格6伤害攻击',
    rangeType: 'single',
    range: 2,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        if (!findPaintingSummon(caster, gameState, 2)) return summonPaintingUnit(caster, gameState, 'xuangui');
        const target = targets.find(hero => hero.owner !== caster.owner);
        if (!target) return fail('已有玄龟，请选择敌人进行普通攻击');
        const damage = damageOne(caster, target, 6, gameState);
        return { ...result(), damageDealt: [damage.finalDamage] };
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
        const positions = MovementSystem.getAreaPositions(center, 3).concat([center]);
        const targets = positions.map(([r, c]) => gameState.board[r][c])
            .filter((hero): hero is Hero => !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);
        const output = result();
        for (const target of targets) {
            const damage = damageOne(caster, target, targets.length * 3, gameState, true);
            output.damageDealt?.push(damage.finalDamage);
        }
        return output;
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
        const damage = damageOne(caster, target, 6, gameState);
        if (Math.random() < 0.5 && target.state === HeroState.ALIVE) {
            EffectManager.addEffect(target, {
                type: 'stun', name: '眩晕', duration: 2, sourceHeroId: caster.id,
                description: '停止行动一回合',
            });
        }
        return { ...result(), damageDealt: [damage.finalDamage] };
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
};
