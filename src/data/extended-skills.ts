import { nextBattleLogId } from '../core/battle-log-id';
import type { SkillAreaBounds } from '../core/skill-fx';
import {
    getSpoolStacks,
    removeSpools,
    spoolBearingEnemies,
    spoolTravelCells,
    zhiyuanComboDamage,
    zhiyuanFeather,
    ZHIYUAN_COMBO_MAX,
    ZHIYUAN_COMBO_DAMAGE,
    ZHIYUAN_COMBO_PER_STACKS,
    ZHIYUAN_PATH_BASE,
    ZHIYUAN_REEL_BASE,
} from '../core/kite-spool';
import {
    findHookAt,
    MARSH_SKILL2_RADIUS,
    marshCells,
    placeHook,
    placeMarsh,
    rollWhaleFall,
    triggerHookBite,
} from '../core/water-marsh';
import { DamageCalculator } from '../core/damage-calculator';
import { EffectManager } from '../core/effect-manager';
import { GameEngine } from '../core/game-engine';
import { MovementSystem } from '../core/movement-system';
import { WindLaneDirection, createWindLane, windLaneAxis, windLaneDirectionFromCode } from '../core/wind-lane';
import { applyRage } from '../core/taunt';
import { markYoujunKnifeSpot, placeWindBlade, retractWindBladesOnCells, WIND_BLADE_DAMAGE, youjunDashMaxDistance } from '../core/wind-blade';
import { BOARD_SIZE, BoardEffect, Effect, GameState, Hero, HeroState, Player, Position, Skill, SkillExecuteResult } from '../types/game';
import {
    addHeroToOwnerList,
    addDilanFeather,
    addTide,
    applyDilanWind,
    clearBenchHeroHp,
    consumeDilanFeather,
    consumeTide,
    createTPaintingSummon,
    currentDeadCount,
    findJinghua,
    findMoonSeat,
    findWaterMoon,
    findHnyShadow,
    getAllies,
    getEnemies,
    getDilanFeatherStacks,
    getHnyFanPositions,
    getJinghongOuterRing,
    getJinghuaStacks,
    getLivingHeroes,
    getSummonOwnerId,
    getXiangruiStacks,
    isJinghuaOffboard,
    isJinghongCharging,
    isJinghongReleaseWindow,
    isLingxiEchoPending,
    JINGHONG_MAX,
    JINGHUA_STACK_MAX,
    resonanceCount,
    setBenchHeroHp,
    syncPositionAnchoredEffects,
    YUNYING_VAMPIRE_EFFECT,
} from './extended-heroes';
import { applyHeroWeapon, createHero } from './heroes';
import { applyWeaponOnArrival } from '../core/weapon-effects';
import { applyZhizhiForMode, hasZhizhi, zhizhiValue } from '../core/hero-zhizhi';
import { advanceWangshuPhase, getWangshuAllies, getWangshuMultiplier, getWangshuPhase, WANGSHU_PHASE_NAMES } from '../core/wangshu';

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
    options: { forceCrit?: boolean; canCrit?: boolean; fixedDamage?: boolean; logTag?: string } = {}
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
        DamageCalculator.asOneAttack(() => {
            for (const target of targets) {
                const damage = damageOne(caster, target, base, gameState, true, false, true);
                output.damageDealt?.push(damage.finalDamage);
            }
        });
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
    description: '对一格内敌人造成7+亡灵共鸣×1伤害，50%复活随机暂时阵亡友方',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有可攻击目标');
        // 致知3：亡灵共鸣的系数 1 → 3
        const base = 7 + resonanceCount(caster.owner, gameState) * zhizhiValue(caster, 3, 1, 3);
        const damage = damageOne(caster, target, base, gameState, false, false, true);
        const output = result([`${caster.name}造成${damage.finalDamage}点伤害`]);
        output.damageDealt?.push(damage.finalDamage);
        if (Math.random() < 0.5) {
            const reviveLogIdsBefore = new Set(gameState.battleLog.map(log => log.id));
            const dead = randomDeadHero(getAllies(caster, gameState), HeroState.TEMP_DEAD);
            if (dead && GameEngine.resurrectHero(dead, 0.5, gameState)) {
                output.log.push(`${dead.name}从暂时阵亡中复苏`);
                if (caster.position && dead.position) requestSkillFx({
                    skillId: 'skeletonking_revive', owner: caster.owner, sourceHeroId: caster.id,
                    fromPos: [...caster.position], targetPos: [...dead.position], damagePositions: [],
                    impactPositions: [[...dead.position]], softImpactPositions: [[...dead.position]],
                    logIds: gameState.battleLog.filter(log => !reviveLogIdsBefore.has(log.id)).map(log => log.id),
                }, gameState);
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
        // 致知3：终焉国王形态的亡灵共鸣系数 1 → 2
        const base = kingForm ? resonance * zhizhiValue(caster, 3, 1, 2) : 6 + resonance;
        const output = result();
        // 终焉斩斩的是离散的 1~2 个目标，不是 3×3 区域：特效底光只铺真正被斩的格
        output.fxCoveredPositions = chosen.map(target => [...target.position!] as Position);
        for (const target of chosen) {
            const damage = damageOne(caster, target, base, gameState, false, false, true);
            output.damageDealt?.push(damage.finalDamage);
        }
        if (kingForm) {
            // 致知2：终焉国王收刀时把亡灵共鸣凝成护盾（1 点/层），再转入下一形态
            if (hasZhizhi(caster, 2)) caster.shield += resonance;
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
    name: '五弦流转',
    type: 'buff',
    description: '为两格内所有友方施加音符：其伤害附加琵琶基础攻击力25%，并为琵琶积累和弦',
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
        const output = result([`${targets.length}名友方获得音符`]);
        output.fxCoveredPositions = targets.filter(target => target.position).map(target => [...target.position!] as Position);
        return output;
    },
};

export const pipaSkill2: Skill = {
    id: 'pipa_skill2',
    name: '裂帛和弦',
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
        // 致知2：每层和弦的伤害 3 → 4
        const damage = damageOne(caster, target, chord * zhizhiValue(caster, 2, 3, 4), gameState);
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
    name: '衔令追猎',
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
        // 致知2：技能二伤害 8 → 10，命中最低血量者的回复 6 → 8
        const damage = damageOne(caster, target, zhizhiValue(caster, 2, 8, 10), gameState);
        if (wasLowest) DamageCalculator.applyHeal(caster, zhizhiValue(caster, 2, 6, 8), gameState);
        return { ...result(), damageDealt: [damage.finalDamage] };
    },
};

/**
 * 阴阳线同时能牵着几个人：默认各 1 条，致知3 抬到各 2 条。
 * 挂新线前先淘汰"最早挂上的那条"——effect.id 里带毫秒时间戳，可以直接比先后。
 */
function yinyangLinkLimit(caster: Hero): number {
    return zhizhiValue(caster, 3, 1, 2);
}

function dropOldestLinks(caster: Hero, units: Hero[], prefix: string, keepTargetId: string): void {
    const holders = units
        .filter(unit => unit.id !== keepTargetId &&
            unit.effects.some(effect => effect.name.startsWith(prefix) && effect.sourceHeroId === caster.id))
        .map(unit => ({
            unit,
            newest: unit.effects
                .filter(effect => effect.name.startsWith(prefix) && effect.sourceHeroId === caster.id)
                .reduce((max, effect) => (effect.id > max ? effect.id : max), ''),
        }))
        .sort((left, right) => (left.newest < right.newest ? -1 : 1));
    const keepOthers = yinyangLinkLimit(caster) - 1;
    for (const { unit } of holders.slice(0, Math.max(0, holders.length - keepOthers))) {
        unit.effects = unit.effects.filter(effect =>
            !(effect.name.startsWith(prefix) && effect.sourceHeroId === caster.id));
    }
}

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
    name: '纯阳一线',
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
        // 只淘汰最早的旧线，致知3 之后可以同时牵着两个人
        dropOldestLinks(caster, getAllies(caster, gameState), '阳线', target.id);
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
    name: '玄阴一线',
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
        dropOldestLinks(caster, getEnemies(caster, gameState), '阴线', target.id);
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
        // 法阵区：以自己为中心的 3×3（dark-circle 判定 abs≤1）
        const zone = MovementSystem.getBoxPositions(caster.position, 3);
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
        const output = result([`${caster.name}展开暗夜法阵并暂时阵亡`]);
        output.fxCoveredPositions = zone;
        return output;
    },
};

export const soulLampSkill2: Skill = {
    id: 'soul_lamp_skill2',
    name: '缚魂轮转',
    type: 'special',
    description: '令一名存活队友暂时阵亡并于下一轮复活，自身也暂时阵亡轮转回归',
    rangeType: '全场',
    range: 6,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target) return fail('没有友方目标');
        // 缚魂灯的技能代价均为暂时阵亡而非真实死亡（不腾出编制、不触发替补补员）；
        // 先置自身暂离：随后的队友暂离若落在暗夜法阵一格范围内，会立即将自己复苏
        GameEngine.tempDeath(caster, gameState);
        GameEngine.tempDeath(target, gameState);
        if (target.state === HeroState.TEMP_DEAD) {
            target.counters['soul_lamp_revive_round'] = gameState.roundNumber + 1;
        }
        // 未被法阵联动立即复活时，同样于下一轮轮转回归，避免永久滞留暂离
        if (caster.state === HeroState.TEMP_DEAD) {
            caster.counters['soul_lamp_revive_round'] = gameState.roundNumber + 1;
        }
        return result([`${target.name}将于下一轮复活，${caster.name}暂时阵亡轮转`]);
    },
};

export const heroXSkill1: Skill = {
    id: 'hero_x_skill1',
    name: '天神震怒',
    type: 'damage',
    description: '随机攻击一名敌人造成8伤害并施加震怒（致知1改为选定目标）',
    rangeType: '全场',
    range: 6,
    targetType: 'enemy',
    targetCount: 'random',
    // 致知1：不再随机，点谁打谁
    targetCountFor: caster => (hasZhizhi(caster, 1) ? 1 : undefined),
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
        // 自己的技能位移不吃羽化（skillMovement），但沿途风刃照常结算
        if (!MovementSystem.moveHero(caster, target, gameState, 2, { ignoreBindingZone: true, skillMovement: true })) return fail('无法瞬移到该位置');
        if (caster.state !== HeroState.ALIVE) {
            return result([`${caster.name}在跃迁途中阵亡`]);
        }
        const allies = getLivingHeroes(getAllies(caster, gameState)).filter(
            ally => ally.id !== caster.id && ally.position &&
                MovementSystem.getManhattanDistance(target, ally.position) <= 1
        );
        for (const ally of allies) EffectManager.addShield(ally, 5);
        EffectManager.addCounter(caster, '增势', allies.length);
        const output = result([`${caster.name}为${allies.length}名友方提供护盾并获得${allies.length}层增势`]);
        // 护盾按落点曼哈顿距离 ≤1 结算：作用区就是落点 + 上下左右
        output.fxCoveredPositions = [target, ...MovementSystem.getCrossPositions(target)];
        return output;
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
                // 致知2：和声的每次攻击回复 5 → 6
                type: 'buff', name: '和声', duration: 2, value: zhizhiValue(caster, 2, 5, 6),
                sourceHeroId: caster.id, description: '攻击后恢复生命',
            });
            EffectManager.addCounter(target, '激情', 1);
        }
        const output = result([`${targets.length}名友方获得和声与激情`]);
        output.fxCoveredPositions = targets.flatMap(target => target.position ? [[...target.position] as Position] : []);
        return output;
    },
};

export const bardSkill2: Skill = {
    id: 'bard_skill2',
    name: '协奏曲',
    type: 'heal',
    description: '消耗两格范围内友方的激情，恢复5+激情×3生命',
    rangeType: 'single',
    range: 2,
    // 致知3：协奏曲的作用范围从 2 格扩到 3 格
    rangeFor: caster => zhizhiValue(caster, 3, undefined, 3),
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
        const base = 5 + resonanceCount(caster.owner, gameState);
        const output = result();
        // 2×2 外接区由引擎按两次点击展开进 targets：整块交给特效层铺底光
        output.fxCoveredPositions = targets
            .filter(target => !!target.position)
            .map(target => [...target.position!] as Position);
        DamageCalculator.asOneAttack(() => {
            for (const target of enemies) {
                const damage = damageOne(caster, target, base, gameState, true);
                output.damageDealt?.push(damage.finalDamage);
                EffectManager.addEffect(target, {
                    type: 'debuff', name: '凋零', duration: -1, stackCount: 1,
                    sourceHeroId: caster.id, description: '可由凋零引爆',
                });
            }
        });
        caster.counters['wither_skill2_death_chance'] = Math.min(
            1,
            (caster.counters['wither_skill2_death_chance'] ?? 0.25) + 0.25
        );
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
        // 致知3：每层的额外比例改看"亡灵共鸣"（我方阵亡总次数），并封顶在 20%
        const perStackBonus = zhizhiValue(caster, 3,
            currentDeadCount(caster.owner, gameState) * 0.02,
            Math.min(0.2, resonanceCount(caster.owner, gameState) * 0.02));
        const percentPerStack = 0.1 + perStackBonus;
        let consumedStacks = 0;
        DamageCalculator.asOneAttack(() => {
            for (const target of targets) {
                const effect = target.effects.find(item => item.name === '凋零' && item.sourceHeroId === caster.id)!;
                const stacks = effect.stackCount ?? 1;
                const amount = Math.max(1, Math.floor(target.maxHp * percentPerStack * stacks));
                const damage = damageOne(caster, target, amount, gameState, true, true);
                output.damageDealt?.push(damage.finalDamage);
                target.effects = target.effects.filter(item => item !== effect);
                consumedStacks += stacks;
            }
        });
        // 引爆凋零才会累计被动层数：每满 6 层获得一条生命（致知1 降到 5 层）
        if (consumedStacks > 0) {
            const lifeEvery = zhizhiValue(caster, 1, 6, 5);
            caster.counters['wither_applied_total'] = (caster.counters['wither_applied_total'] ?? 0) + consumedStacks;
            while (caster.counters['wither_applied_total'] >= lifeEvery) {
                caster.counters['wither_applied_total'] -= lifeEvery;
                EffectManager.addCounter(caster, 'wither_lives', 1);
            }
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

function summonPaintingUnit(
    caster: Hero,
    gameState: GameState,
    kind: 'jinwu' | 'xuangui',
    existing?: Hero
): SkillExecuteResult {
    const target = encodedTarget(caster);
    if (!target || gameState.board[target[0]][target[1]] !== null) return fail('请选择空位置召唤');
    if (!caster.position || MovementSystem.getManhattanDistance(caster.position, target) > 2) {
        return fail('召唤位置必须在两格范围内');
    }
    if (existing) {
        // 位移重置：沿用同一个单位，只换格并回满生命，不算阵亡（不触发本体扣血与死亡统计）
        if (existing.position) gameState.board[existing.position[0]][existing.position[1]] = null;
        gameState.board[target[0]][target[1]] = existing;
        existing.position = target;
        existing.state = HeroState.ALIVE;
        existing.currentHp = existing.maxHp;
        // 与初次召唤一致：落位的当回合不再行动
        existing.hasActedThisTurn = true;
        existing.hasMovedThisTurn = true;
        return result([`${caster.name}重新唤出${existing.name}，生命恢复至满血`]);
    }
    const summon = createTPaintingSummon(kind, caster.owner, caster.id, target, hasZhizhi(caster, 2) ? 4 : 0);
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
    output.fxCoveredPositions = positions;
    // 金乌自己没有致知：耀斑的系数看的是布画本体的致知3（3 → 4）
    const painter = [...gameState.player1Heroes, ...gameState.player2Heroes]
        .find(hero => hero.id === jinwu.id.split('|')[2]);
    const perTarget = zhizhiValue(painter, 3, 3, 4);
    DamageCalculator.asOneAttack(() => {
        for (const target of targets) {
            const damage = damageOne(jinwu, target, targets.length * perTarget, gameState, true);
            output.damageDealt?.push(damage.finalDamage);
        }
    });
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
    gameState.skillFxExtras = { fxVariant: 'painting_attack', targetPos: target.position ? [...target.position] as Position : undefined };
    const damage = damageOne(caster, target, 6, gameState);
    output.damageDealt?.push(damage.finalDamage);
    // 伤害数额由引擎的 damage 日志播报，这里不再重复一行
    if (summon.state !== HeroState.ALIVE || EffectManager.isStunned(summon)) {
        output.log.push(`${summon.name}无法连锁出手`);
        return output;
    }
    if (!summon.position || !target.position ||
        MovementSystem.getManhattanDistance(summon.position, target.position) > 2) {
        output.log.push(`${summon.name}距离目标过远，无法连锁出手`);
        return output;
    }
    const previousLogIds = new Set(gameState.battleLog.map(log => log.id));
    const targetPosition = [...target.position] as Position;
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
    const logs = gameState.battleLog.filter(log => !previousLogIds.has(log.id) && log.type === 'damage');
    if (summon.position && logs.length) requestSkillFx({
        skillId: summon.counters['__summonKind'] === 1 ? 'jinwu_skill' : 'xuangui_skill',
        owner: summon.owner, sourceHeroId: summon.id,
        fromPos: [...summon.position], targetPos: targetPosition,
        impactPositions: logs.map(log => log.details?.position as Position).filter(Boolean),
        damagePositions: logs.map(log => log.details?.position as Position).filter(Boolean),
        logIds: logs.map(log => log.id),
    }, gameState);
    return output;
}

export const tPaintingSkill1: Skill = {
    id: 't_painting_skill1',
    name: '金乌',
    type: 'summon',
    description: '召唤金乌；金乌在场时点击敌人改为本体普攻6伤害并让金乌连锁出手，点击两格内空位则让金乌重新落位并回满生命',
    rangeType: 'single',
    range: 2,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const jinwu = findPaintingSummon(caster, gameState, 1);
        if (!jinwu) return summonPaintingUnit(caster, gameState, 'jinwu');
        const target = targets.find(hero => hero.owner !== caster.owner);
        if (!target) return summonPaintingUnit(caster, gameState, 'jinwu', jinwu);
        return paintingChainAttack(caster, target, jinwu, gameState);
    },
};

export const tPaintingSkill2: Skill = {
    id: 't_painting_skill2',
    name: '玄龟',
    type: 'summon',
    description: '召唤玄龟；玄龟在场时点击敌人改为本体普攻6伤害并让玄龟连锁出手，点击两格内空位则让玄龟重新落位并回满生命',
    rangeType: 'single',
    range: 2,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const xuangui = findPaintingSummon(caster, gameState, 2);
        if (!xuangui) return summonPaintingUnit(caster, gameState, 'xuangui');
        const target = targets.find(hero => hero.owner !== caster.owner);
        if (!target) return summonPaintingUnit(caster, gameState, 'xuangui', xuangui);
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
        DamageCalculator.asOneAttack(() => {
            targets.forEach((target, index) => {
                const damage = damageOne(caster, target, Math.max(2, 8 - index * 2), gameState, true);
                output.damageDealt?.push(damage.finalDamage);
                EffectManager.addEffect(target, {
                    type: 'mark', name: '粒子标记', duration: 3, stackCount: 1,
                    sourceHeroId: caster.id, description: '粒子轰爆的目标',
                });
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
        // 致知3：扩范围所需能量 3 → 2
        const energyNeeded = zhizhiValue(caster, 3, 3, 2);
        const expanded = EffectManager.getCounter(caster, '能量') >= energyNeeded;
        if (expanded) EffectManager.addCounter(caster, '能量', -energyNeeded);
        const margin = expanded ? 1 : 0;
        const minRow = Math.max(0, Math.min(a[0], b[0]) - margin);
        const maxRow = Math.min(5, Math.max(a[0], b[0]) + margin);
        const minCol = Math.max(0, Math.min(a[1], b[1]) - margin);
        const maxCol = Math.min(5, Math.max(a[1], b[1]) + margin);
        // 真实作用矩形＝两点外接盒（能量≥3 时四周各外扩一格），逐格交给特效层
        const rectCells: Position[] = [];
        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) rectCells.push([row, col]);
        }
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
        output.fxCoveredPositions = rectCells;
        DamageCalculator.asOneAttack(() => {
            for (const target of targetsInArea) {
                // 致知1：粒子标记的附加系数 2 → 3
                const damage = damageOne(caster, target, 8 + markCount * zhizhiValue(caster, 1, 2, 3), gameState, true);
                output.damageDealt?.push(damage.finalDamage);
            }
        });
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
        gameState.skillFxExtras = { empowered: transformed };
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
        const chosen = targets.slice(0, 2);
        for (const target of chosen) {
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
        const output = result([`${targets.length}名友方获得来财`]);
        // 来财只落在离散的一两名友方身上，不是菱形区域
        output.fxCoveredPositions = chosen.map(target => [...target.position!] as Position);
        return output;
    },
};

export const schrodingerSkill1: Skill = {
    id: 'schrodinger_skill1',
    name: '生死叠加',
    type: 'damage',
    description: '攻击一个方向的3×3范围，每个敌人50%受6伤害或免疫',
    rangeType: 'line',
    range: 1,
    targetType: 'enemy',
    targetCount: 'all',
    execute: (caster, targets, gameState) => {
        if (!targets.length) return fail('范围内没有敌人');
        const output = result();
        DamageCalculator.asOneAttack(() => {
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
        });
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
        // 致知2：恐惧之箭 8 → 10
        const damage = damageOne(caster, target, Math.floor(zhizhiValue(caster, 2, 8, 10) * energyBuff), gameState);
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
        // 致知3：恐惧情绪能量的系数 3 → 5
        const damage = damageOne(caster, target, Math.floor((5 + energy * zhizhiValue(caster, 3, 3, 5)) * bonus), gameState);
        for (const enemy of getLivingHeroes(getEnemies(caster, gameState))) {
            if (enemy.position && MovementSystem.getManhattanDistance(target.position, enemy.position) <= 2) {
                addFear(enemy, caster, 1);
            }
        }
        // 蔓延判据即"以初始目标为中心曼哈顿≤2"：作用区取同一份菱形 + 目标本格
        const spreadCells: Position[] = [
            [...target.position] as Position,
            ...MovementSystem.getPositionsInRange(target.position, 2),
        ];
        return { ...result(), damageDealt: [damage.finalDamage], fxCoveredPositions: spreadCells };
    },
};

/**
 * 李太白技能1：一格十字内（上下左右）单体 7 伤害，自己获得一层醉意
 */
export const libaiSkill1: Skill = {
    id: 'libai_skill1',
    name: '青莲醉剑',
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
        // 致知2：技能一 7 → 8；致知3：醉意上限 4 → 5
        const damage = damageOne(caster, target, zhizhiValue(caster, 2, 7, 8), gameState);
        EffectManager.setCounter(caster, '醉意',
            Math.min(zhizhiValue(caster, 3, 4, 5), EffectManager.getCounter(caster, '醉意') + 1));
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
    name: '谪仙醉斩',
    type: 'damage',
    description: '对前方2x3范围内的所有敌方角色造成醉意数x4伤害，醉意清空',
    rangeType: 'line',
    range: 2,
    targetType: 'enemy',
    targetCount: 'all',
    execute: (caster, _targets, gameState) => {
        const zuiyi = EffectManager.getCounter(caster, '醉意');
        if (zuiyi < 1) return fail('醉意不足，无法释放谪仙醉斩');
        const rect = getLibaiFrontRect(caster);
        if (rect.length === 0) return fail('未选择方向');
        const targets = rect.map(([r, c]) => gameState.board[r][c])
            .filter((hero): hero is Hero => !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);
        if (targets.length === 0) return fail('前方范围内没有敌人');
        const output = result();
        output.fxCoveredPositions = rect;
        DamageCalculator.asOneAttack(() => {
            for (const target of targets) {
                const damage = damageOne(caster, target, zuiyi * 4, gameState, true);
                output.damageDealt?.push(damage.finalDamage);
            }
        });
        EffectManager.addCounter(caster, '醉意', -zuiyi);
        output.log.push(`${caster.name}释放谪仙醉斩，消耗了${zuiyi}层醉意`);
        return output;
    },
};

/** 醉枕刀的醉意层数上限（技能、天威、踩友方交换等所有获取途径都受此约束）；与李太白同为4层 */
export const ZUIYI_MAX = 4;

/** 致知3 把醉枕刀自己的醉意上限抬到 5 层；李太白另有其上限，不读这里 */
export function zuiyiCap(hero: Hero | null | undefined): number {
    return zhizhiValue(hero, 3, ZUIYI_MAX, ZUIYI_MAX + 1);
}

/**
 * 计算醉枕刀醉掷寒锋的最优路径：≤7步从起点到终点，踩过敌人最多（不重复踩同一格子）。
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
 * 醉枕刀技能1：向前方三格醉掷寒锋，7步内沿踩敌最多的路径拾刀
 */
export const zuizhendaoSkill1: Skill = {
    id: 'zuizhendao_skill1',
    name: '醉掷寒锋',
    type: 'damage',
    description: '向前方三格掷出刀，7步内沿踩敌最多的路径拾刀；沿途敌人受4伤害，每穿过1个敌人获得1层醉意（醉意上限4层）',
    rangeType: 'line',
    range: 3,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        const dirCode = caster.counters['__zuizhendao_skill1_dir'];
        if (dirCode === undefined || !caster.position) return fail('未选择醉掷寒锋方向');
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
        // 自报真实冲刺序列（含绕路）：特效沿这条路径逐格铺光影，做到真正的"跟踪"
        output.fxCoveredPositions = plan.path;
        let gained = 0;
        const zuiyiLimit = zuiyiCap(caster);
        DamageCalculator.asOneAttack(() => {
            for (const enemy of plan.enemies) {
                // 致知1：踩过一名敌人 4 → 5 点
                const damage = damageOne(caster, enemy, zhizhiValue(caster, 1, 4, 5), gameState);
                output.damageDealt?.push(damage.finalDamage);
                const stacks = EffectManager.getCounter(caster, '醉意');
                if (stacks < zuiyiLimit) {
                    EffectManager.setCounter(caster, '醉意', stacks + 1);
                    gained += 1;
                }
            }
        });
        output.log.push(gained > 0
            ? `${caster.name}拾刀后获得${gained}层醉意${gained < plan.enemies.length ? `（已达上限${zuiyiLimit}层）` : ''}`
            : `${caster.name}拾刀路径上没有踩到敌人，未造成伤害`);
        return output;
    },
};

/**
 * 醉枕刀技能2：与任意友方交换位置，随后对周围一圈敌人造成8伤害
 */
export const zuizhendaoSkill2: Skill = {
    id: 'zuizhendao_skill2',
    name: '醉影换位',
    type: 'damage',
    description: '与任意距离的友方交换位置，随后对周围一圈敌方角色造成5点伤害，每命中1个获得1层醉意（醉意上限4层）',
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
        // 换位是己方技能造成的位移，不再吃羽化逐格伤害
        const output = result();
        // 周围一圈（8方向）敌人
        const ring = MovementSystem.getAreaPositions(caster.position, 3);
        const enemies = ring.map(([r, c]) => gameState.board[r][c])
            .filter((hero): hero is Hero => !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);
        DamageCalculator.asOneAttack(() => {
            const zuiyiLimit = zuiyiCap(caster);
            for (const enemy of enemies) {
                // 致知2：换位旋斩 5 → 6 点
                const damage = damageOne(caster, enemy, zhizhiValue(caster, 2, 5, 6), gameState, true);
                output.damageDealt?.push(damage.finalDamage);
                const stacks = EffectManager.getCounter(caster, '醉意');
                if (stacks < zuiyiLimit) {
                    EffectManager.setCounter(caster, '醉意', stacks + 1);
                }
            }
        });
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
        // 致知2：技能一主目标 8 → 10
        const primary = dealFeixueSkillDamage(caster, target, zhizhiValue(caster, 2, 8, 10), gameState, {
            ignoreDefense: shattered,
        });
        output.damageDealt?.push(primary.damage.finalDamage);
        // 这一击本身由 DamageCalculator 播报（含暴击/破盾），这里只补它说不清的寒天霜噬附加
        if (primary.passiveDamage > 0) {
            output.log.push(
                `${target.name}身上${primary.hantianStacks}层寒天引发霜噬，附加${primary.passiveDamage}点真实伤害`
            );
        }

        if (!shattered) {
            // 未破冰的一刀是寒天的主要铺层入口：只挂层，不爆炸
            if (target.state === HeroState.ALIVE) {
                DamageCalculator.applyHantianStacks(target, 1, caster.id, gameState);
                output.log.push(`${target.name}被附着1层寒天`);
            }
            return output;
        }
        if (!targetPosition) return output;

        // 特效管线：本次击碎了冰冻——上报「破冰爆震」专属形态与 3x3 爆震范围，
        // 供 executeSkill 包装层覆盖默认档案（fxVariant）并铺 AOE 整体特效（coveredPositions）
        gameState.skillFxExtras = {
            fxVariant: 'feixue_shatter',
            coveredPositions: [targetPosition, ...MovementSystem.getAreaPositions(targetPosition, 3)],
        };

        const splashDamage = caster.counters['talent_2'] ? 8 : 6;
        const splashTargets = MovementSystem.getAreaPositions(targetPosition, 3)
            .map(([row, col]) => gameState.board[row][col])
            .filter((hero): hero is Hero =>
                !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE
            );

        DamageCalculator.asOneAttack(() => {
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
        });

        output.log.push(`${caster.name}击碎了${target.name}的冰冻`);
        return output;
    },
};

export const LIANZHI_EFFECT = '连枝';
/** 连枝持续回合：策划文案漏了数字，先按 2 回合定，调参只改这里 */
export const LIANZHI_ROUNDS = 2;
export const LIANZHI_PURSUE_DAMAGE = 6;

export const feixueSkill2: Skill = {
    id: 'feixue_skill2',
    name: '连枝',
    type: 'special',
    description: '与一名存活友方结为连枝，持续2回合：对方每次主动出手打到敌人后，绯雪随之追出6点伤害（群攻则随机追一名被命中者）；对方触发天威时，绯雪也触发一次绝对零度',
    rangeType: 'single',
    range: 99,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets) => {
        const ally = targets[0];
        if (!ally || ally.state !== HeroState.ALIVE) return fail('请选择一名存活友方');
        if (ally.id === caster.id) return fail('连枝要系在别人身上');

        EffectManager.removeEffectByName(ally, LIANZHI_EFFECT);
        EffectManager.addEffect(ally, {
            type: 'buff',
            name: LIANZHI_EFFECT,
            duration: LIANZHI_ROUNDS,
            sourceHeroId: caster.id,
            description: '绯雪与之连枝：每次主动出手后被追加一次6点伤害，触发天威时绯雪同步触发',
        });
        return result([`${caster.name}与${ally.name}结为连枝，霜影随身`]);
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
    // 致知2：流沙追猎的 8 点（=基础攻击）抬到 10，用固定加成避免改动 baseAttack
    const damage = DamageCalculator.calculate(caster, target, zhizhiValue(caster, 2, 0, 2), true, false, {
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
        // 沙丘区：以自身为中心的 3×3（锚点记录中心，判定按 abs≤1）
        const zone = MovementSystem.getBoxPositions(caster.position, 3);
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
        const output = result([`${caster.name}在周围创造了持续2回合的沙丘猎场`]);
        output.fxCoveredPositions = zone;
        return output;
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
    const featherStacks = getDilanFeatherStacks(target);
    const detonatedStacks = featherStacks >= 3 ? consumeDilanFeather(target) : 0;
    const amount = detonatedStacks > 0 ? baseDamage * detonatedStacks : baseDamage;
    const hit = damageOne(caster, target, amount, gameState, area);
    if (target.state === HeroState.ALIVE && detonatedStacks === 0) {
        addDilanFeather(target, caster, 1);
    }
    return { damage: hit.finalDamage, detonatedStacks };
}

/**
 * 帝兰技能1的作用格：从自身沿所选方向一直延伸到棋盘边缘（不含自己所在格）。
 * 方向编码：0=上，1=下，2=左，3=右。
 */
export function getDilanSkill1Cells(caster: Hero, directionCode: number): Position[] {
    if (!caster.position) return [];
    const [row, col] = caster.position;
    const [dr, dc] =
        directionCode === 0 ? [-1, 0] : directionCode === 1 ? [1, 0] : directionCode === 2 ? [0, -1] : [0, 1];
    const cells: Position[] = [];
    for (let step = 1; step < 6; step++) {
        const next: Position = [row + dr * step, col + dc * step];
        if (next[0] < 0 || next[0] > 5 || next[1] < 0 || next[1] > 5) break;
        cells.push(next);
    }
    return cells;
}

export const dilanSkill1: Skill = {
    id: 'dilan_skill1',
    name: '顺逆长风',
    type: 'damage',
    description: '选择上下左右任一方向：对该方向上从自身延伸到边缘的直线，敌人造成3点伤害并施加1层逆风，友方改为获得1层顺风。致知1使伤害提高至4点',
    rangeType: 'line',
    range: 6,
    targetType: 'any',
    targetCount: 'all',
    baseDamage: 3,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('帝兰尚未部署');
        const directionCode = caster.counters['__dilan_skill1_dir'];
        if (directionCode === undefined) return fail('请先选择顺逆长风的方向');
        delete caster.counters['__dilan_skill1_dir'];
        const line = getDilanSkill1Cells(caster, directionCode)
            .map(([row, col]) => gameState.board[row][col])
            .filter((hero): hero is Hero => !!hero && hero !== caster && hero.state === HeroState.ALIVE);
        if (line.length === 0) return fail('该方向上没有其他角色');

        const output = result();
        const baseDamage = caster.counters['talent_1'] ? 4 : 3;
        DamageCalculator.asOneAttack(() => {
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
        });
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
        output.fxCoveredPositions = rect;
        const baseDamage = caster.counters['talent_2'] ? 4 : 3;
        const [dr, dc] = dilanDirectionStep(dirCode);
        const hitEnemies: Hero[] = [];
        DamageCalculator.asOneAttack(() => {
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
        });

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
            // 我方把敌人推出的一格算强制位移，羽化照常逐格掉血
            DamageCalculator.applyDilanMovementDamage(enemy, 1, gameState, caster.owner);
            output.log.push(`${enemy.name}被击退1格`);
        }
        return output;
    },
};

/** 南风技能2的风向编码：0=上、1=下、2=左、3=右（见 WIND_LANE_DIRECTIONS） */
const NANFENG_WIND_LABELS = ['向北', '向南', '向西', '向东'];

function nanfengWindLabel(dirCode: number): string {
    return NANFENG_WIND_LABELS[dirCode] ?? '风起';
}

/** 把风道所在线转成中文可读描述（第N行 / 第N列），用于战斗日志 */
export function getNanfengLineDescription(direction: WindLaneDirection, position: Position): string {
    return windLaneAxis(direction) === 'row'
        ? `第${position[0] + 1}行`
        : `第${position[1] + 1}列`;
}

export const nanfengSkill1: Skill = {
    id: 'nanfeng_skill1',
    name: '扶摇',
    type: 'damage',
    description: '在以南风为中心的5×5范围内选一格掀起旋风：吹散该格周围3×3内的所有敌人，各造成4点伤害并施加1层羽化，再沿远离风心的方向推移1格（越界或受阻则原地不动，风眼不被吹动）',
    rangeType: 'single',
    range: 2,
    targetType: 'any',
    targetCount: 1,
    baseDamage: 4,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('南风尚未部署');
        const center = encodedTarget(caster);
        if (!center) return fail('请选择旋风中心');

        const output = result();
        const cells: Position[] = [center, ...MovementSystem.getAreaPositions(center, 3)];
        output.fxCoveredPositions = cells;
        const enemies = cells
            .map(([row, col]) => gameState.board[row][col])
            .filter((hero): hero is Hero =>
                !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE
            );

        if (enemies.length === 0) {
            output.log.push(`${caster.name}卷起扶摇，旋风扫过空巷`);
            return output;
        }

        DamageCalculator.asOneAttack(() => {
            for (const enemy of enemies) {
                // 致知2：旋风伤害 4 → 5
                const hit = damageOne(caster, enemy, zhizhiValue(caster, 2, 4, 5), gameState, true);
                output.damageDealt?.push(hit.finalDamage);
                addDilanFeather(enemy, caster);
                output.log.push(
                    `${caster.name}的旋风命中${enemy.name}，造成${hit.finalDamage}点伤害并施加羽化`
                );
            }
        });

        // 由外向内吹，外侧目标先腾空，同线上的内侧目标才有机会被依次推出
        const pushable = enemies.filter(enemy => enemy.state === HeroState.ALIVE && !!enemy.position);
        const chebyshev = ([row, col]: Position) =>
            Math.max(Math.abs(row - center[0]), Math.abs(col - center[1]));
        pushable.sort((left, right) => chebyshev(right.position!) - chebyshev(left.position!));

        for (const enemy of pushable) {
            const [row, col] = enemy.position!;
            const dr = Math.sign(row - center[0]);
            const dc = Math.sign(col - center[1]);
            if (dr === 0 && dc === 0) continue;
            const destination: Position = [row + dr, col + dc];
            if (
                destination[0] < 0 || destination[0] >= 6 ||
                destination[1] < 0 || destination[1] >= 6 ||
                gameState.board[destination[0]][destination[1]] !== null
            ) {
                output.log.push(`${enemy.name}抵住风势，未被吹散`);
                continue;
            }
            gameState.board[row][col] = null;
            gameState.board[destination[0]][destination[1]] = enemy;
            enemy.position = destination;
            // 同击退：我方旋风把他吹走的一格仍算被摆布的位移
            DamageCalculator.applyDilanMovementDamage(enemy, 1, gameState, caster.owner);
            output.log.push(`${enemy.name}被吹散1格`);
        }
        return output;
    },
};

export const nanfengSkill2: Skill = {
    id: 'nanfeng_skill2',
    name: '引风成道',
    type: 'special',
    description: '先选风向，再点任意格子：沿该格所在的一整行或一整列铺开通风廊。友方在风道内滑行不消耗移动力，敌人在风道内行动结束时顺风向被推移1格；风道在南风存活期间常驻',
    rangeType: '全场',
    range: 6,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('南风尚未部署');
        const dirCode = caster.counters['__nanfeng_skill2_dir'];
        const direction = windLaneDirectionFromCode(dirCode);
        if (!direction) return fail('请先选择风向');
        const lineCell = encodedTarget(caster);
        if (!lineCell) return fail('请选择风道要铺开的行或列');
        delete caster.counters['__nanfeng_skill2_dir'];

        // 风向决定轴：上下→纵向风道（沿列），左右→横向风道（沿行）
        const anchor: Position = windLaneAxis(direction) === 'row'
            ? [lineCell[0], caster.position[1]]
            : [caster.position[0], lineCell[1]];
        createWindLane(gameState, caster, anchor, direction);

        // 风道沿锚点整行/整列铺开：把这条线交给特效层
        const laneCells: Position[] = [];
        for (let step = 0; step < BOARD_SIZE; step++) {
            laneCells.push(windLaneAxis(direction) === 'row' ? [anchor[0], step] : [step, anchor[1]]);
        }
        const output = result();
        output.fxCoveredPositions = laneCells;
        output.log.push(
            `${caster.name}引风成道：${getNanfengLineDescription(direction, anchor)}${nanfengWindLabel(dirCode)}风起，风廊铺满6格`
        );
        return output;
    },
};

/** 上官婉儿毛笔寿命：最多朝婉儿移动的次数 */
export const SHANGGUAN_BRUSH_LIFETIME = 3;

/** 上官婉儿毛笔落下/经过格子的固定伤害（策划案 2026-09 上调为 9） */
export const SHANGGUAN_BRUSH_DAMAGE = 9;

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
 * 只读扫描一个笔走龙蛇方向（不修改状态）：
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

/** 一段笔走龙蛇的结算结果 */
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
 * 执行一段笔走龙蛇：
 * - 命中敌方英雄：6点固定伤害（不可闪避）；
 * - 命中毛笔：撞碎回收（从棋盘移除），获得再次冲刺之势；
 * - 随后把婉儿移动到落点（落点等于当前位置时不移动）。
 * 目标通过 hitTargets 去重；命中后调用方应把 hitId 追加进去。
 * 场上所有毛笔（不分落笔者阵营）均可作为冲刺道具。
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
        return { success: false, message: scan.reason ?? '该方向无法笔走龙蛇' };
    }

    const output: ShangguanDashOutcome = { success: true, hitKind: scan.kind, hitId: scan.targetId, hitName: scan.targetName };

    // 结算目标
    if (scan.kind === 'enemy') {
        const enemy = gameState.board[scan.targetPos[0]][scan.targetPos[1]];
        if (enemy && enemy.state === HeroState.ALIVE) {
            const dmg = DamageCalculator.calculate(
                caster,
                enemy,
                // 致知2：每段冲刺 6 → 8 点固定伤害
                zhizhiValue(caster, 2, 6, 8),
                false,
                false,
                { fixedDamage: true, canCrit: false }
            );
            DamageCalculator.applyDamage(enemy, dmg, caster, gameState);
            output.damage = dmg.finalDamage;
            output.killed = enemy.state !== HeroState.ALIVE;
        }
    }
    // 毛笔：撞碎回收（从棋盘移除），获得再次冲刺之势
    if (scan.kind === 'brush' && scan.targetId) {
        gameState.boardEffects = (gameState.boardEffects ?? []).filter(
            effect => effect.id !== scan.targetId
        );
    }

    // 移动到落点
    const [lr, lc] = scan.landPos;
    const [hr, hc] = caster.position;
    const path: Position[] = [];
    const steps = Math.max(Math.abs(lr - hr), Math.abs(lc - hc));
    for (let step = 1; step <= steps; step++) path.push([hr + dirR * step, hc + dirC * step]);
    gameState.skillFxExtras = { targetPos: [...scan.targetPos], coveredPositions: path };
    if (lr !== hr || lc !== hc) {
        if (gameState.board[hr][hc] === caster) gameState.board[hr][hc] = null;
        gameState.board[lr][lc] = caster;
        caster.position = [lr, lc];
    }
    return output;
}

/** 是否还存在可继续的笔走龙蛇方向（任一方向上有未命中的敌人或毛笔） */
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
 * 9点固定伤害）；毛笔落成的当回合不推进，此后每次婉儿行动结束朝她移动1格
 * （最多移动3次），经过/落点处的敌人受到9点固定伤害，抵达婉儿或寿命耗尽时消失。
 */
export const shangguanSkill1: Skill = {
    id: 'shangguan_skill1',
    name: '落笔',
    type: 'special',
    description: '在四方向之一、距离1~3格处落下毛笔（可落在敌人身上并立即造成9点固定伤害）；毛笔落成当回合不移动，之后每次婉儿行动结束朝自己移动1格（最多3次），经过的敌人受到9点固定伤害。',
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
        // 落在敌方英雄身上：立即造成9点固定伤害（不可闪避）
        if (occupant && occupant.owner !== caster.owner && occupant.state === HeroState.ALIVE) {
            const dmg = DamageCalculator.calculate(
                caster,
                occupant,
                SHANGGUAN_BRUSH_DAMAGE,
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
            // 落成的当回合（婉儿这次行动结束）不推进，下一回合起才开始朝她移动
            placedAtRound: gameState.roundNumber,
        });
        output.log.push(`${caster.name}在(${r},${c})落下一支毛笔`);
        return output;
    },
};

/**
 * 上官婉儿技能2：笔走龙蛇（多段）
 * 每段朝选定方向冲刺，命中路径上最近的敌人（6点固定伤害）或毛笔（撞碎回收、刷新冲刺）后停下，
 * 落点为目标身后一格；玩家可继续选新方向笔走龙蛇，同一目标不可重复命中。
 * 场上所有毛笔（不分落笔者阵营）均可作为刷新冲刺的道具。
 * 多段交互由 game-store 的 shangguanDashState 管理。
 */
export const shangguanSkill2: Skill = {
    id: 'shangguan_skill2',
    name: '笔走龙蛇',
    type: 'damage',
    description: '朝选定方向冲刺，撞上敌人造成6点固定伤害，或撞碎毛笔回收并刷新冲刺，停在目标身后一格；命中后可选择新方向继续笔走龙蛇，同一目标不可重复。',
    rangeType: 'line',
    range: 4,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('婉儿不在场上');
        const clicked = encodedTarget(caster);
        if (!clicked) return fail('未选择笔走龙蛇方向');
        const [hr, hc] = caster.position;
        const isAdj =
            (Math.abs(clicked[0] - hr) === 1 && clicked[1] === hc) ||
            (Math.abs(clicked[1] - hc) === 1 && clicked[0] === hr);
        if (!isAdj) return fail('请点击相邻的方向格选择笔走龙蛇方向');
        const dirR = Math.sign(clicked[0] - hr);
        const dirC = Math.sign(clicked[1] - hc);

        const outcome = performShangguanDashSegment(caster, dirR, dirC, [], gameState);
        if (!outcome.success) return fail(outcome.message ?? '该方向无法笔走龙蛇');

        const output = result();
        output.log.push(`${caster.name}发动笔走龙蛇`);
        if (outcome.hitKind === 'enemy') {
            output.damageDealt?.push(outcome.damage ?? 0);
            output.log.push(`撞击${outcome.hitName}，造成${outcome.damage}点固定伤害`);
        } else {
            output.log.push(`撞碎${outcome.hitName}回收在身，获得再次冲刺之势`);
        }
        const pos = caster.position;
        output.log.push(`${caster.name}落至(${pos[0]},${pos[1]})`);
        return output;
    },
};

/**
 * 游隼技能1「疾掠」
 * 选择四方向之一冲刺：常规最多 3 格；起点处于同轴友方风道上时可顺着风道
 * 冲刺整行/整列。路径上的友军与敌人都不阻挡，只要落点（点击格）是盘内空格
 * 就能直穿过去，路径上的敌人受到 5×(1+冲刺距离×0.1)×(1+上回合移动距离×0.1) 伤害。
 * 疾掠同时收回路径上的风刃，并消耗已武装的疾掠刷新。
 */
export const youjunSkill1: Skill = {
    id: 'youjun_skill1',
    name: '疾掠',
    type: 'damage',
    description: '选择四方向之一冲刺（常规最多3格，身处同轴友方风道时可冲刺整行/整列），路径上的友军与敌人都可穿过、落点须为空格，穿透敌人造成 5×(1+冲刺距离×0.1)×(1+上回合移动距离×0.1) 伤害；沿途收回风刃并刷新疾掠',
    rangeType: 'line',
    range: 5,
    targetType: 'any',
    targetCount: 'all',
    execute: (caster, _targets, gameState) => {
        if (!caster.position || caster.state !== HeroState.ALIVE) return fail('游隼不在场上');
        const clicked = encodedTarget(caster);
        if (!clicked) return fail('未选择疾掠落点');
        const direction = MovementSystem.getDirection(caster.position, clicked);
        if (!direction) return fail('疾掠必须沿上下左右之一的直线冲刺');
        const maxDistance = youjunDashMaxDistance(gameState, caster, direction);
        const clickedDistance = MovementSystem.getManhattanDistance(caster.position, clicked);
        if (clickedDistance > maxDistance) {
            return fail(maxDistance >= 5
                ? '疾掠最远只能冲刺到棋盘边缘'
                : '常规疾掠最多3格，需身处同轴友方风道才能冲刺整行/整列');
        }

        // 落点必须是盘内空格；路径上的友军与敌人都可直接穿过
        if (
            clicked[0] < 0 || clicked[0] >= 6 || clicked[1] < 0 || clicked[1] >= 6 ||
            gameState.board[clicked[0]][clicked[1]] !== null
        ) {
            return fail('疾掠落点必须是空格');
        }

        const deltas: Record<'up' | 'down' | 'left' | 'right', [number, number]> = {
            up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1],
        };
        const [dr, dc] = deltas[direction];
        const start: Position = [caster.position[0], caster.position[1]];
        const landing: Position = [clicked[0], clicked[1]];
        const piercedEnemies: Hero[] = [];
        for (let step = 1; step < clickedDistance; step++) {
            const occupant = gameState.board[start[0] + dr * step][start[1] + dc * step];
            if (occupant && occupant.state === HeroState.ALIVE && occupant.owner !== caster.owner) {
                piercedEnemies.push(occupant);
            }
        }

        const dashDistance = clickedDistance;
        const lastMove = Math.min(6, caster.counters['youjun_lastMove'] ?? 0);
        // 致知1：疾掠基础伤害 5 → 6（两个倍率项不变）
        const baseDamage = zhizhiValue(caster, 1, 5, 6) * (1 + dashDistance * 0.1) * (1 + lastMove * 0.1);

        const output = result();
        DamageCalculator.asOneAttack(() => {
            for (const enemy of piercedEnemies) {
                const damage = damageOne(caster, enemy, baseDamage, gameState, true);
                output.damageDealt?.push(damage.finalDamage);
            }
        });

        // 位移到落点
        gameState.board[start[0]][start[1]] = null;
        gameState.board[landing[0]][landing[1]] = caster;
        caster.position = landing;
        // 疾掠的落点同样算"停留过的位置"，天威归翎会从这里收回飞刀
        markYoujunKnifeSpot(caster);
        // 疾掠是她自己冲出去的位移，不吃羽化；流血仍按格结算
        DamageCalculator.applyBleedMovementDamage(caster, dashDistance, gameState);

        // 消耗已武装的疾掠刷新；收回冲刺路径上的风刃（刷新供下一轮冲锋使用）
        delete caster.counters['youjun_skill1_refreshed'];
        const traversed: Position[] = [];
        for (let step = 1; step <= dashDistance; step++) {
            traversed.push([start[0] + dr * step, start[1] + dc * step]);
        }
        retractWindBladesOnCells(caster, traversed, gameState);

        const hitText = piercedEnemies.length > 0
            ? `，穿透${piercedEnemies.length}名敌人共造成${output.damageDealt?.reduce((sum, amount) => sum + amount, 0) ?? 0}点伤害`
            : '';
        output.log.unshift(
            `${caster.name}疾掠${dashDistance}格（上回合移动${lastMove}格）${hitText}`
        );
        return output;
    },
};

/**
 * 游隼技能2「四向风刃」
 * 风刃不抛出：直接在周围一格的上、下、左、右四个位置各留下一道风刃，持续3回合；
 * 敌人踏入风刃格受到4点不可规避、无视护盾的固定伤害，风刃随即消失；
 * 释放时若相邻格已站着敌人，同样按接触结算——立即吃到这4点伤害且该方向不留风刃；
 * 友军所在格照样留刃（友方不受风刃伤害），只有棋盘外的方向放不出。
 * 游隼经过风刃时将其收回，每回合第一次收回会刷新疾掠。
 */
export const youjunSkill2: Skill = {
    id: 'youjun_skill2',
    name: '四向风刃',
    type: 'damage',
    description: '在周围一格的上、下、左、右各留下一道风刃（友军所在格也会留刃，友方不受伤害；棋盘外方向除外），持续3回合；敌人踏入风刃格受到4点固定伤害并使风刃消失，释放时已贴身的敌人立即吃到这次伤害。游隼经过风刃时将其收回，每回合第一次收回刷新疾掠',
    rangeType: 'single',
    range: 0,
    targetType: 'self',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        if (!caster.position || caster.state !== HeroState.ALIVE) return fail('游隼不在场上');

        const [row, col] = caster.position;
        const output = result();
        let placed = 0;
        let hitCount = 0;
        let totalDamage = 0;
        const bladeCells: Position[] = [];
        DamageCalculator.asOneAttack(() => {
            for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                const cell: Position = [row + dr, col + dc];
                if (cell[0] < 0 || cell[0] >= 6 || cell[1] < 0 || cell[1] >= 6) continue;
                bladeCells.push(cell);
                const occupant = gameState.board[cell[0]][cell[1]];
                if (occupant && occupant.state === HeroState.ALIVE && occupant.owner !== caster.owner) {
                    // 敌人正站在落刃格上：按接触风刃结算，风刃随即消耗、不留在该格
                    const damage = damageOne(caster, occupant, zhizhiValue(caster, 2, WIND_BLADE_DAMAGE, WIND_BLADE_DAMAGE + 1), gameState, true, false, false, { fixedDamage: true, canCrit: false });
                    output.damageDealt?.push(damage.finalDamage);
                    totalDamage += damage.finalDamage;
                    hitCount++;
                    continue;
                }
                placeWindBlade(gameState, caster, cell);
                placed++;
            }
        });
        output.fxCoveredPositions = bladeCells;

        const hitText = hitCount > 0 ? `，割中${hitCount}名敌人共${totalDamage}点伤害` : '';
        output.log.push(`${caster.name}在四周布下${placed}道风刃${hitText}`);
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

        // 拖拽是我方造成的强制位移，被拖着的格子照常吃羽化
        if (pulled > 0) {
            DamageCalculator.applyDilanMovementDamage(target, pulled, gameState, caster.owner);
        }

        output.log.push(
            pulled > 0
                ? `${caster.name}将${target.name}拖拽${pulled}格至身旁`
                : `${target.name}的拖拽路径受阻`
        );

        if (target.state !== HeroState.ALIVE) {
            output.log.push(`${target.name}在拖拽途中触发羽化伤害并阵亡`);
            return output;
        }

        // 造成6点伤害（致知2 → 9）并施加1层寒天
        const damage = damageOne(caster, target, zhizhiValue(caster, 2, 6, 9), gameState);
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
        output.fxCoveredPositions = targets.flatMap(target => target.position ? [[...target.position] as Position] : []);
        for (const target of targets) {
            // 先移除目标身上由自己施加的旧援护效果（如果有的话）
            target.effects = target.effects.filter(effect =>
                !(effect.name === '援护' && effect.sourceHeroId === caster.id)
            );
            // 致知3：承伤比例 30% → 40%
            const carryRate = zhizhiValue(caster, 3, 0.3, 0.4);
            EffectManager.addEffect(target, {
                type: 'buff',
                name: '援护',
                duration: 2,
                value: carryRate,
                sourceHeroId: caster.id,
                description: `受到伤害的${Math.round(carryRate * 100)}%由沉渊·镇岳承担，持续2回合`,
            });
            output.log.push(`${target.name}获得沉渊的援护`);
        }
        return output;
    },
};

/**
 * 时空旅者·戴尔技能1「时空回溯」：
 * 选择我方或敌方的一名角色，使其回到本回合开始时的状态（生命与效果）。
 * 不可以对通灵角色使用。复活处于「时空停滞」的阵亡友方走两段式交互：
 * 先锚定停滞单位（selectDaiReviveTarget），再点选任意空格作为复活落点，
 * 落点结算在 game-store 的 executeSkillBase 分支里完成。
 */
export const daiSkill1: Skill = {
    id: 'dai_skill1',
    name: '时空回溯',
    type: 'special',
    description: '选择我方或敌方的一名角色回到本回合开始时的状态（生命与效果）；不可对通灵角色使用。也可唤回处于时空停滞的阵亡友方（先选单位再选落点，每名英雄限一次）',
    rangeType: '全场',
    range: 0,
    targetType: 'any',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        if (!caster.position) return fail('时空旅者尚未部署');
        const target = targets[0];
        if (!target) return fail('请选择场上的一名角色');

        if (target.state === HeroState.DEAD) {
            return fail('请先选择要唤回的时空停滞单位，再点击复活落点');
        }
        if (target.state !== HeroState.ALIVE) {
            return fail('请选择场上存活的角色');
        }
        if (target.class === '通灵') {
            return fail('通灵角色的命运纠缠着生死契约，无法被时空回溯改写');
        }
        const snap = gameState.heroSnapshots?.[target.id];
        if (!snap) {
            return fail(`${target.name}还没有可供回溯的状态记录`);
        }

        const desiredHp = Math.max(1, Math.min(target.maxHp, snap.hp));
        const output = result();
        if (desiredHp > target.currentHp) {
            const healed = DamageCalculator.applyHeal(target, desiredHp - target.currentHp, gameState, caster);
            output.healingDone?.push(healed);
        } else if (desiredHp < target.currentHp) {
            target.currentHp = desiredHp;
        }
        target.effects = snap.effects.map(effect => ({ ...effect }));
        output.log.push(
            `${caster.name}发动时空回溯，${target.name}回到了回合开始时的状态（生命${target.currentHp}/${target.maxHp}）`
        );
        return output;
    },
};

/**
 * 时空旅者·戴尔技能2「时空置换」：
 * 选择场上任意两个存活单位，交换它们的位置与当前生命值百分比。冷却：一回合。
 */
export const daiSkill2: Skill = {
    id: 'dai_skill2',
    name: '时空置换',
    type: 'special',
    description: '选择场上任意两个存活单位，交换位置与当前生命值百分比（冷却：一回合）',
    rangeType: '全场',
    range: 0,
    targetType: 'any',
    targetCount: 2,
    execute: (caster, targets, gameState) => {
        if (!caster.position) return fail('时空旅者尚未部署');
        // 致知3：时空置换不再有冷却
        const cd = hasZhizhi(caster, 3) ? 0 : caster.counters['dai_skill2_cd'] ?? 0;
        if (cd > 0) {
            return fail(`时空置换冷却中（剩余${cd}回合）`);
        }
        const first = targets[0];
        const second = targets[1];
        if (!first || !second || first.id === second.id) {
            return fail('请选择场上两个不同的存活单位');
        }
        if (!first.position || !second.position) {
            return fail('两个单位都必须已部署在棋盘上');
        }

        // 交换棋盘位置
        const posFirst: Position = [first.position[0], first.position[1]];
        const posSecond: Position = [second.position[0], second.position[1]];
        gameState.board[posFirst[0]][posFirst[1]] = second;
        gameState.board[posSecond[0]][posSecond[1]] = first;
        first.position = posSecond;
        second.position = posFirst;

        // 特效落在真正交换的两格；施法者不一定是被交换的单位。
        gameState.skillFxExtras = { ...gameState.skillFxExtras, fromPos: posFirst, targetPos: posSecond };

        // 交换当前生命值百分比
        const ratioFirst = first.currentHp / first.maxHp;
        const ratioSecond = second.currentHp / second.maxHp;
        first.currentHp = Math.max(1, Math.round(ratioSecond * first.maxHp));
        second.currentHp = Math.max(1, Math.round(ratioFirst * second.maxHp));

        // 进入冷却：本回合结束后需间隔一个完整回合才能再次使用
        caster.counters['dai_skill2_cd'] = 2;

        const output = result();
        output.log.push(
            `${caster.name}发动时空置换：${first.name}与${second.name}互换了位置与生命轨迹` +
            `（${first.name} ${first.currentHp}/${first.maxHp}，${second.name} ${second.currentHp}/${second.maxHp}）`
        );
        return output;
    },
};

/**
 * 叙白「净化恢复」
 */

export const XUBAI_ORB_MAX = 3;
export const XUBAI_ORB_HEAL = 4;
/** 生命低于自身上限的这个比例时，行动开始会消耗黑白球回血 */
export const XUBAI_HP_THRESHOLD = 0.4;

/**
 * 负面效果口径：只清 `type === 'debuff'` 的效果。
 * 猎杀令属于标记、冰冻与眩晕属于状态，均不在净化范围内。
 */
function purgeNegativeEffects(target: Hero): string[] {
    const purged = target.effects.filter(effect => effect.type === 'debuff').map(effect => effect.name);
    if (purged.length > 0) {
        target.effects = target.effects.filter(effect => effect.type !== 'debuff');
    }
    return purged;
}

function purgeRandomNegativeEffect(target: Hero): string | null {
    const negatives = target.effects.filter(effect => effect.type === 'debuff');
    if (negatives.length === 0) return null;
    const picked = negatives[Math.floor(Math.random() * negatives.length)];
    target.effects = target.effects.filter(effect => effect !== picked);
    return picked.name;
}

/**
 * 黑白球结算：某个友方英雄行动开始时，若其生命低于上限40%，
 * 逐颗消耗叙白存着的黑白球，每颗回复4点，直到回到40%以上或用尽。
 * 每个英雄每轮只结算一次；只在被选中行动的一方触发，因此敌方回合完全不回血。
 */
export function settleXubaiOrbs(hero: Hero, gameState: GameState): string | null {
    if (hero.state !== HeroState.ALIVE) return null;
    if (hero.counters['__xubai_orb_round'] === gameState.roundNumber) return null;
    hero.counters['__xubai_orb_round'] = gameState.roundNumber;

    const keeper = getLivingHeroes(getAllies(hero, gameState)).find(candidate =>
        candidate.passiveId === 'xubai_passive' && (candidate.counters['黑白球'] ?? 0) > 0
    );
    if (!keeper) return null;

    const logIdsBefore = new Set(gameState.battleLog.map(entry => entry.id));
    let consumed = 0;
    let healed = 0;
    let purged = 0;
    // 致知1：每颗黑白球的回复 4 → 5
    const orbHeal = zhizhiValue(keeper, 1, XUBAI_ORB_HEAL, XUBAI_ORB_HEAL + 1);
    while (hero.currentHp < hero.maxHp * XUBAI_HP_THRESHOLD && (keeper.counters['黑白球'] ?? 0) > 0) {
        keeper.counters['黑白球'] = (keeper.counters['黑白球'] ?? 0) - 1;
        // 致知3：每颗球顺带净化一层负面效果
        if (hasZhizhi(keeper, 3) && purgeRandomNegativeEffect(hero)) purged += 1;
        const gained = DamageCalculator.applyHeal(hero, orbHeal, gameState, keeper);
        if (gained <= 0) break;
        consumed++;
        healed += gained;
    }
    if (consumed === 0) return null;
    if (keeper.position && hero.position) requestSkillFx({
        skillId: 'xubai_regen', owner: keeper.owner, sourceHeroId: keeper.id,
        fromPos: [...keeper.position], targetPos: [...hero.position],
        impactPositions: [[...hero.position]], softImpactPositions: [[...hero.position]], damagePositions: [],
        logIds: gameState.battleLog.filter(entry => !logIdsBefore.has(entry.id) && entry.type === 'heal').map(entry => entry.id),
    }, gameState);
    return `${hero.name}消耗${consumed}颗黑白球，恢复${healed}点生命` +
        (purged > 0 ? `，并净化${purged}层负面效果` : '');
}

/**
 * 被动「初雪」：叙白每场战斗首次登场时，恢复登场位置3×3范围内友方（含自己）8点生命，
 * 并各净化随机1个负面效果。补员上场也算登场，但整场只触发一次。
 */
export function triggerXubaiEntrance(hero: Hero, gameState: GameState): void {
    if (hero.state !== HeroState.ALIVE || !hero.position) return;
    if (hero.counters['__xubai_entered'] === 1) return;
    hero.counters['__xubai_entered'] = 1;

    const cells: Position[] = [hero.position, ...MovementSystem.getAreaPositions(hero.position, 3)];
    const nearby = cells
        .map(([row, col]) => gameState.board[row]?.[col])
        .filter((unit): unit is Hero =>
            !!unit && unit.owner === hero.owner && unit.state === HeroState.ALIVE);

    const names: string[] = [];
    const affected: Position[] = [];
    const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
    // 致知2：登场被动的回复 8 → 10
    const entranceHeal = zhizhiValue(hero, 2, 8, 10);
    for (const ally of nearby) {
        const healed = DamageCalculator.applyHeal(ally, entranceHeal, gameState, hero);
        const purged = purgeRandomNegativeEffect(ally);
        if (healed > 0 || purged) {
            if (ally.position) affected.push([...ally.position]);
            names.push(`${ally.name}${healed > 0 ? `回复${healed}` : ''}${purged ? `净化${purged}` : ''}`);
        }
    }
    if (names.length === 0) return;

    gameState.battleLog?.push({
        id: nextBattleLogId(),
        type: 'passive',
        player: hero.owner,
        message: `${hero.name}初至战场，抚育周围友军：${names.join('、')}`,
        timestamp: Date.now(),
    });
    requestSkillFx({ skillId: 'xubai_entrance', owner: hero.owner, sourceHeroId: hero.id,
        fromPos: [...hero.position], targetPos: affected[0], impactPositions: affected,
        softImpactPositions: affected, damagePositions: [],
        logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
    }, gameState);
}

/** Single selected character within the inclusive 5x5 square; validate direct calls too. */
function wangshuTarget(caster: Hero, targets: Hero[], state: GameState, healing: boolean): Hero | undefined {
    if (caster.state !== HeroState.ALIVE || !caster.position) return;
    const cells = MovementSystem.getBoxPositions(caster.position, 5);
    const allies = healing ? getWangshuAllies(caster, state) : [];
    return targets.find(target => target.state === HeroState.ALIVE && target.position &&
        state.board[target.position[0]]?.[target.position[1]]?.id === target.id &&
        cells.some(([r, c]) => r === target.position![0] && c === target.position![1]) &&
        (healing ? allies.some(ally => ally.id === target.id) : target.owner !== caster.owner));
}

export const wangshuSkill1: Skill = {
    id: 'wangshu_skill1', name: '月蚀生朔', type: 'damage',
    description: '攻击自身5×5内一名敌人，造成其当前生命20%＋望×当前月相倍率的伤害（不吃基础攻击力）；结算后，以该敌人与全场存活友方角色中最低当前生命的绝对差值覆盖朔，再提升一级月相',
    rangeType: 'area', range: 2, areaSize: 5, targetType: 'enemy', targetCount: 1,
    scalesWithAttack: false,
    execute: (caster, targets, state) => {
        const target = wangshuTarget(caster, targets, state, false);
        if (!target) return fail('请选择望舒5×5范围内的一名敌人');
        const multiplier = getWangshuMultiplier(caster);
        const amount = Math.floor(target.currentHp * .2 + Math.max(0, caster.counters['望'] ?? 0) * multiplier);
        DamageCalculator.addBattleLog(state, { type: 'skill', player: caster.owner,
            message: `${caster.name}使用月蚀生朔（${WANGSHU_PHASE_NAMES[getWangshuPhase(caster)]}，${Math.round(multiplier * 100)}%）` });
        const damage = damageOne(caster, target, amount, state);
        const allies = getWangshuAllies(caster, state);
        const lowest = allies.length ? Math.min(...allies.map(ally => ally.currentHp)) : 0;
        caster.counters['朔'] = Math.abs(Math.max(0, target.currentHp) - lowest);
        // A kill can already have raised the phase to full moon; this must never lower it.
        advanceWangshuPhase(caster);
        const output = result([`${caster.name}记录朔${caster.counters['朔']}，月相为${WANGSHU_PHASE_NAMES[getWangshuPhase(caster)]}`]);
        output.damageDealt?.push(damage.finalDamage);
        return output;
    },
};

export const wangshuSkill2: Skill = {
    id: 'wangshu_skill2', name: '月华寄望', type: 'heal',
    description: '恢复自身5×5内一名友方角色（含自己）已损生命20%＋朔×当前月相倍率的生命；结算后，以该友方与全场存活友方角色中最高当前生命的差值覆盖望，再提升一级月相。朔、望初始为0，储值不消耗',
    rangeType: 'area', range: 2, areaSize: 5, targetType: 'any', targetCount: 1,
    scalesWithAttack: false,
    execute: (caster, targets, state) => {
        const target = wangshuTarget(caster, targets, state, true);
        if (!target) return fail('请选择望舒5×5范围内的一名友方角色（含自己）');
        const multiplier = getWangshuMultiplier(caster), lost = Math.max(0, target.maxHp - target.currentHp);
        const amount = Math.min(lost, Math.floor(lost * .2 + Math.max(0, caster.counters['朔'] ?? 0) * multiplier));
        DamageCalculator.addBattleLog(state, { type: 'skill', player: caster.owner,
            message: `${caster.name}使用月华寄望（${WANGSHU_PHASE_NAMES[getWangshuPhase(caster)]}，${Math.round(multiplier * 100)}%）` });
        const healed = amount > 0 ? DamageCalculator.applyHeal(target, amount, state, caster) : 0;
        const highest = Math.max(...getWangshuAllies(caster, state).map(ally => ally.currentHp));
        caster.counters['望'] = Math.max(0, highest - target.currentHp);
        advanceWangshuPhase(caster);
        const output = result([`${caster.name}记录望${caster.counters['望']}，月相为${WANGSHU_PHASE_NAMES[getWangshuPhase(caster)]}`]);
        output.healingDone?.push(healed);
        return output;
    },
};

export const xubaiSkill1: Skill = {
    id: 'xubai_skill1',
    name: '涤秽回春',
    type: 'heal',
    description: '恢复5×5范围内一名友方8点生命，并净化其身上所有负面效果；每净化1个额外恢复2点生命',
    rangeType: 'area',
    range: 2,
    areaSize: 5,
    targetType: 'any',
    targetCount: 1,
    baseHeal: 8,
    execute: (caster, targets, gameState) => {
        const ally = targets.find(target =>
            target.owner === caster.owner && target.state === HeroState.ALIVE);
        if (!ally) return fail('范围内没有可治疗的友方');

        const purged = purgeNegativeEffects(ally);
        const healed = DamageCalculator.applyHeal(ally, 8 + purged.length * 2, gameState, caster);

        const output = result();
        output.healingDone?.push(healed);
        output.log.push(
            `${ally.name}恢复${healed}点生命${purged.length > 0 ? `，净化${purged.join('、')}` : '，身上没有负面效果'}`
        );
        return output;
    },
};

export const xubaiSkill2: Skill = {
    id: 'xubai_skill2',
    name: '黑白凝珠',
    type: 'buff',
    description: `凝聚黑白球至${XUBAI_ORB_MAX}颗：此后我方英雄每次行动开始时，若其生命低于上限40%，自动消耗黑白球每颗恢复${XUBAI_ORB_HEAL}点生命，直到回到40%以上`,
    rangeType: 'area',
    range: 0,
    areaSize: 3,
    targetType: 'self',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        void gameState;
        caster.counters['黑白球'] = XUBAI_ORB_MAX;
        return result([`${caster.name}凝出黑白球（${XUBAI_ORB_MAX}颗）`]);
    },
};

/**
 * 泠汐「潮汐多段攻击」
 *
 * 延迟段挂在泠汐自己的计数器上，只有跨到更晚的回合才可结算：
 * - lingxi_echo1_round：技能1的回响，由"泠汐本回合已行动后的下一个友方行动结束"触发
 * - lingxi_echo2_round / lingxi_echo2_dir：技能2的回潮，由"下一回合技能攻击结束"触发
 * - lingxi_assist_pending：被动待发放的助力层数，由下一个出手的友方领取
 */
export const LINGXI_ECHO1_DAMAGE = 3;
export const LINGXI_MERGED_DAMAGE = 5;
export const LINGXI_ECHO2_DAMAGE = 8;

/**
 * 延迟段特效请求队列。
 *
 * 回响在引擎里结算（友方行动结束、或另一次施法的收尾），走不到 store 的
 * `executeSkill` 特效包装层，于是伤害飘字有、专属特效与音效没有。
 * 数据层把"该播一次什么特效"记到这里，store 在状态提交后统一取走派发。
 */
export interface PendingSkillFxRequest {
    skillId: string;
    owner: Player;
    fromPos: Position;
    targetPos: Position;
    impactPositions: Position[];
    damagePositions?: Position[];
    softImpactPositions?: Position[];
    coveredPositions?: Position[];
    /** 区域层包围盒：火墙这类"铺满整条射线"的特效需要它才能画出整面 */
    areaBounds?: SkillAreaBounds;
    sourceHeroId?: string;
    logIds?: string[];
    /**
     * 逐格上报的恢复段（攻击附带治疗、潮汐回血一类）：一次结算里会有 N 条，
     * 但它们本质是"同一个治疗主题的一次爆发"，派发前按 skillId+来源单位合并成一份，
     * 音效才只响一次，落点格仍各自出球。见 collapseCoalescedSkillFxRequests。
     */
    coalesce?: boolean;
}

let pendingSkillFxRequests: PendingSkillFxRequest[] = [];
let skillFxSuppressionDepth = 0;

/**
 * 电脑思考时会在克隆盘上跑真实的技能结算，而那些结算同样往上面这条全局队列里塞特效请求。
 * 队列不属于 GameState，克隆盘上的"假想施法"因此会留在队里，等下一次状态提交被真盘面
 * 一起派发出去——表现为没人放技能却响了音效、格子上凭空起特效，命中几个人就响几遍。
 * 模拟期间用本函数把队列入口关掉。
 */
export function runWithoutSkillFx<T>(run: () => T): T {
    skillFxSuppressionDepth++;
    try {
        return run();
    } finally {
        skillFxSuppressionDepth--;
    }
}

/** 位置数组按格子去重合并（保持首次出现顺序，特效逐格节拍才不会乱） */
function mergePositions(existing: Position[] | undefined, extra: Position[] | undefined): Position[] | undefined {
    if (!extra || extra.length === 0) return existing;
    if (!existing || existing.length === 0) return extra.map(pos => [...pos] as Position);
    const seen = new Set(existing.map(pos => `${pos[0]},${pos[1]}`));
    const merged = existing.map(pos => [...pos] as Position);
    for (const pos of extra) {
        const key = `${pos[0]},${pos[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push([...pos] as Position);
    }
    return merged;
}

/**
 * 把同一批里重复的恢复段合并成一份特效：
 * 泠汐命中三名敌人会按"每个敌人周围的友方各一条"上报 lingxi_regen，
 * 合并前音效就连响三声、同一个格子上叠三个光球。
 * 只动打了 coalesce 标记的请求，伤害/斩击类逐格特效一律原样保留。
 */
export function collapseCoalescedSkillFxRequests(requests: PendingSkillFxRequest[]): PendingSkillFxRequest[] {
    if (!requests.some(request => request.coalesce)) return requests;
    const ordered: PendingSkillFxRequest[] = [];
    const byKey = new Map<string, PendingSkillFxRequest>();
    for (const request of requests) {
        if (!request.coalesce) {
            const { coalesce: _coalesce, ...rest } = request;
            ordered.push(rest);
            continue;
        }
        const key = `${request.skillId}|${request.sourceHeroId ?? request.owner}`;
        const held = byKey.get(key);
        if (!held) {
            const { coalesce: _coalesce, ...rest } = request;
            byKey.set(key, rest);
            ordered.push(rest);
            continue;
        }
        held.impactPositions = mergePositions(held.impactPositions, request.impactPositions) ?? held.impactPositions;
        held.softImpactPositions = mergePositions(held.softImpactPositions, request.softImpactPositions);
        held.damagePositions = mergePositions(held.damagePositions, request.damagePositions);
        held.coveredPositions = mergePositions(held.coveredPositions, request.coveredPositions);
        if (request.logIds?.length) held.logIds = [...(held.logIds ?? []), ...request.logIds];
    }
    return ordered;
}

export function drainPendingSkillFxRequests(): PendingSkillFxRequest[] {
    if (pendingSkillFxRequests.length === 0) return [];
    const requests = pendingSkillFxRequests;
    pendingSkillFxRequests = [];
    return collapseCoalescedSkillFxRequests(requests);
}

export function requestSkillFx(request: PendingSkillFxRequest, gameState?: GameState): void {
    if (skillFxSuppressionDepth > 0) return;
    publishSkillFxAnchor(request, gameState);
    pendingSkillFxRequests.push(request);
}

/**
 * 只登记锚点、不入本地队列：本地已经自己派发过的表现事件（挂起选格的火墙、天威落点横扫
 * 这类不在技能结算里的补充动画），用它把同一份请求写进本次新写的战斗日志，
 * 对端才能随快照或状态同步按 `commitOnlineTriggeredFx` 重建——否则只有出手方看得见。
 */
export function publishSkillFxAnchor(request: PendingSkillFxRequest, gameState?: GameState): void {
    // 追击日志随权威快照一起传递；只在首条日志留一份描述，避免对端重复派发。
    const anchor = gameState?.battleLog.find(log => request.logIds?.includes(log.id));
    if (anchor) anchor.details = { ...anchor.details, skillFxRequest: { ...request } };
}

/** 自动治疗段用结算来源，而非正在攻击的单位，决定恢复主题。 */
export function requestRecoveryFx(source: Hero, target: Hero, skillId: string, gameState: GameState): void {
    if (!target.position) return;
    const anchor = [...gameState.battleLog].reverse().find(log =>
        log.type === 'heal' && log.details?.targetHeroId === target.id && log.details?.sourceHeroId === source.id);
    requestSkillFx({ skillId, owner: source.owner, sourceHeroId: source.id,
        fromPos: [...(source.position ?? target.position)], targetPos: [...target.position],
        impactPositions: [[...target.position]], softImpactPositions: [[...target.position]], damagePositions: [],
        logIds: anchor ? [anchor.id] : [],
        coalesce: true,
    }, gameState);
}

function lingxiEnemiesInCells(cells: Position[], gameState: GameState, caster: Hero): Hero[] {
    return cells
        .map(([row, col]) => gameState.board[row]?.[col])
        .filter((unit): unit is Hero =>
            !!unit && unit.owner !== caster.owner && unit.state === HeroState.ALIVE);
}

function lingxiBoxEnemies(caster: Hero, gameState: GameState, size: number): Hero[] {
    if (!caster.position) return [];
    return lingxiEnemiesInCells(MovementSystem.getBoxPositions(caster.position, size), gameState, caster);
}

/** 一次攻击命中：伤害结算（潮汐回血在 damage-calculator 内统一处理）+ 可选叠加一层潮汐 */
function lingxiStrike(
    caster: Hero, target: Hero, damage: number, gameState: GameState, grantTide: boolean
): number {
    const hit = DamageCalculator.calculate(caster, target, damage, false);
    DamageCalculator.applyDamage(target, hit, caster, gameState, true);
    if (grantTide && target.state === HeroState.ALIVE) addTide(target, caster, 1);
    return hit.finalDamage;
}

/** 技能2的回潮：沿施放时记录的方向补击 2×3，一次性消耗命中敌人的潮汐并按层数×3自疗 */
function resolveLingxiEcho2(caster: Hero, gameState: GameState, output: SkillExecuteResult): void {
    caster.counters['lingxi_echo2_round'] = 0;
    const dirCode = caster.counters['lingxi_echo2_dir'];
    if (!caster.position || dirCode === undefined || dirCode < 0) return;

    const cells = MovementSystem.getLingxiFrontRect(caster.position, dirCode);
    const enemies = lingxiEnemiesInCells(cells, gameState, caster);
    if (enemies.length === 0) {
        output.log.push(`${caster.name}的回潮拍岸落空，前方没有敌人`);
        return;
    }

    const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
    let consumedTide = 0;
    const hitCells: Position[] = [];
    for (const enemy of enemies) {
        if (enemy.position) hitCells.push([...enemy.position] as Position);
        output.damageDealt?.push(lingxiStrike(caster, enemy, LINGXI_ECHO2_DAMAGE, gameState, false));
        consumedTide += consumeTide(enemy);
    }
    if (caster.position && hitCells.length > 0) {
        requestSkillFx({
            skillId: 'lingxi_skill2',
            owner: caster.owner,
            fromPos: [...caster.position] as Position,
            targetPos: hitCells[0],
            impactPositions: hitCells,
            coveredPositions: cells,
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
    }
    if (consumedTide > 0) {
        const healed = DamageCalculator.applyHeal(caster, consumedTide * 3, gameState, caster);
        output.log.push(
            `${caster.name}回潮拍岸，命中${enemies.length}名敌人并消耗${consumedTide}层潮汐，恢复${healed}点生命`
        );
    } else {
        output.log.push(`${caster.name}回潮拍岸，命中${enemies.length}名敌人`);
    }
}

/** 一次攻击动作收尾：先结算已跨回合的技能2回潮，再为被动积攒一层助力 */
function finishLingxiAttack(caster: Hero, gameState: GameState, output: SkillExecuteResult): void {
    if (isLingxiEchoPending(caster, gameState, 'lingxi_echo2_round')) {
        resolveLingxiEcho2(caster, gameState, output);
    }
    caster.counters['lingxi_assist_pending'] = (caster.counters['lingxi_assist_pending'] ?? 0) + 1;
}

/**
 * 被动「潮声相和」：泠汐每次攻击动作后积攒一层助力，
 * 下一个开始出手的友方一次性领走全部层数，每层 +20% 增伤（同一效果叠加，跨回合保留）。
 * 挂"增伤"而非"攻击"：attackBonus 通道只对带基础攻击力且按攻击力结算的技能生效，
 * 队里绝大多数英雄的固定伤害技能完全吃不到。
 */
export function grantLingxiAssist(hero: Hero, gameState: GameState): number {
    if (hero.state !== HeroState.ALIVE) return 0;
    const lingxi = (hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes)
        .find(candidate => candidate.passiveId === 'lingxi_passive' && candidate.id !== hero.id);
    const pending = lingxi?.counters['lingxi_assist_pending'] ?? 0;
    if (!lingxi || pending <= 0) return 0;

    lingxi.counters['lingxi_assist_pending'] = 0;
    const existing = hero.effects.find(effect => effect.name === '泠汐增伤提升');
    const layers = (existing?.stackCount ?? 0) + pending;
    // 致知2：每层助力增伤 20% → 25%
    const perLayer = zhizhiValue(lingxi, 2, 0.2, 0.25);
    if (existing) {
        existing.stackCount = layers;
        existing.value = perLayer * layers;
        existing.duration = 2;
    } else {
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: '泠汐增伤提升',
            duration: 2,
            value: perLayer * layers,
            stackCount: layers,
            sourceHeroId: lingxi.id,
            description: `泠汐的潮声相和：增伤提升${Math.round(perLayer * 100 * layers)}%`,
        });
    }
    return layers;
}

/**
 * 技能1的回响：由 GameEngine 在"泠汐本回合已行动、且下一个友方行动结束"时调用。
 * 回响自身不再续挂延迟段——只有再次施放技能1才会把链条接下去。
 */
export function resolveLingxiEcho1(caster: Hero, gameState: GameState): void {
    if (!isLingxiEchoPending(caster, gameState, 'lingxi_echo1_round')) return;
    if (caster.counters['__lingxi_resolving'] === 1) return;
    caster.counters['lingxi_echo1_round'] = 0;

    const enemies = lingxiBoxEnemies(caster, gameState, 3);
    if (enemies.length === 0) return;

    caster.counters['__lingxi_resolving'] = 1;
    const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
    const hitCells: Position[] = [];
    try {
        for (const enemy of enemies) {
            if (enemy.position) hitCells.push([...enemy.position] as Position);
            lingxiStrike(caster, enemy, LINGXI_ECHO1_DAMAGE, gameState, true);
        }
    } finally {
        delete caster.counters['__lingxi_resolving'];
    }

    gameState.battleLog?.push({
        id: nextBattleLogId(),
        type: 'passive',
        player: caster.owner,
        message: `${caster.name}的海螺回响再起，命中${enemies.length}名敌人并施加潮汐`,
        timestamp: Date.now(),
    });
    if (caster.position && hitCells.length > 0) {
        requestSkillFx({
            skillId: 'lingxi_skill1',
            owner: caster.owner,
            fromPos: [...caster.position] as Position,
            targetPos: hitCells[0],
            impactPositions: hitCells,
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
    }
    // 回响同样算一次攻击动作
    caster.counters['lingxi_assist_pending'] = (caster.counters['lingxi_assist_pending'] ?? 0) + 1;
}

export const lingxiSkill1: Skill = {
    id: 'lingxi_skill1',
    name: '海螺回响',
    type: 'damage',
    description: '对周围3×3的敌人造成2点伤害并各施加1层潮汐；下一回合自己行动后的下一个友方行动结束时自动补击3点。若下一回合再次施放，前一段与本次合并为5×5、5点伤害，并继续挂下一段',
    rangeType: 'area',
    range: 0,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 'all',
    baseDamage: 2,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        const merged = isLingxiEchoPending(caster, gameState, 'lingxi_echo1_round');
        const cells = caster.position
            ? MovementSystem.getBoxPositions(caster.position, merged ? 5 : 3)
            : [];
        const enemies = lingxiEnemiesInCells(cells, gameState, caster);
        if (enemies.length === 0) return fail('周围没有敌人');

        const output = result();
        output.fxCoveredPositions = cells;
        const damage = merged ? LINGXI_MERGED_DAMAGE : 2;
        for (const enemy of enemies) {
            output.damageDealt?.push(lingxiStrike(caster, enemy, damage, gameState, true));
        }
        // 每次施放（含合并）都为下一回合续上一发回响
        caster.counters['lingxi_echo1_round'] = gameState.roundNumber;
        output.log.push(
            `${caster.name}吹响海螺${merged ? '，两段潮声合并为5×5/5点' : ''}，命中${enemies.length}名敌人`
        );
        finishLingxiAttack(caster, gameState, output);
        return output;
    },
};

export const lingxiSkill2: Skill = {
    id: 'lingxi_skill2',
    name: '涌潮拍岸',
    type: 'damage',
    description: '对前方2×3的敌人造成3点伤害；下一回合技能攻击结束后自动沿同一方向再拍一次，造成8点伤害并一次性消耗命中敌人的潮汐，每层为自身恢复3点生命',
    rangeType: 'line',
    range: 2,
    targetType: 'enemy',
    targetCount: 'all',
    baseDamage: 3,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        const dirCode = caster.counters['__lingxi_skill2_dir'];
        delete caster.counters['__lingxi_skill2_dir'];
        if (dirCode === undefined || !caster.position) return fail('请先选择涌潮方向');

        const cells = MovementSystem.getLingxiFrontRect(caster.position, dirCode);
        const enemies = lingxiEnemiesInCells(cells, gameState, caster);
        if (enemies.length === 0) return fail('前方范围内没有敌人');

        const output = result();
        output.fxCoveredPositions = cells;
        for (const enemy of enemies) {
            output.damageDealt?.push(lingxiStrike(caster, enemy, 3, gameState, false));
        }
        caster.counters['lingxi_echo2_round'] = gameState.roundNumber;
        caster.counters['lingxi_echo2_dir'] = dirCode;
        output.log.push(`${caster.name}涌潮拍岸，命中${enemies.length}名敌人，回潮蓄势待发`);
        finishLingxiAttack(caster, gameState, output);
        return output;
    },
};

/**
 * 血契：以血为誓的重装者。技能1 与天威共用同一段横扫结算，
 * 保证伤害、回血与（天威独有的）愤怒施加在两条路径上完全一致。
 */

/** 血契束缚格的存活范围：到他下一次行动结束（与震霄同一套 serial 语义） */
function xueqiBindingExpireSerial(caster: Hero): number {
    return (caster.counters['__actionSerial'] ?? 0) + 2;
}

/**
 * 一次血誓横扫：以 center 为中心的 3×3 内所有敌人各受 4 点伤害，
 * 施法者回复「已损生命 × 20%」。withRage 时对被斩中的存活敌人施加愤怒。
 */
export function castBloodSweep(
    caster: Hero,
    center: Position,
    gameState: GameState,
    options: { withRage?: boolean } = {}
): SkillExecuteResult {
    const cells: Position[] = [];
    for (let row = center[0] - 1; row <= center[0] + 1; row++) {
        for (let col = center[1] - 1; col <= center[1] + 1; col++) {
            if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
            cells.push([row, col]);
        }
    }
    const enemies = cells
        .map(([row, col]) => gameState.board[row][col])
        .filter((hero): hero is Hero =>
            !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE);

    const output = result();
    const expireAtActionSerial = xueqiBindingExpireSerial(caster);
    DamageCalculator.asOneAttack(() => {
        for (const enemy of enemies) {
            const damage = damageOne(caster, enemy, 4, gameState, true);
            output.damageDealt?.push(damage.finalDamage);
            if (options.withRage && enemy.state === HeroState.ALIVE) {
                applyRage(enemy, caster, expireAtActionSerial);
            }
        }
    });
    output.fxCoveredPositions = cells;

    const missing = Math.max(0, caster.maxHp - caster.currentHp);
    const healed = caster.state === HeroState.ALIVE && missing > 0
        ? DamageCalculator.applyHeal(caster, Math.floor(missing * 0.2), gameState, caster)
        : 0;
    if (healed > 0) output.healingDone?.push(healed);

    output.log.push(enemies.length > 0
        ? `${caster.name}血誓横扫，斩中${enemies.length}名敌人${options.withRage ? '，并激起他们的愤怒' : ''}`
        : `${caster.name}血誓横扫，这一圈没有敌人`);
    if (healed > 0) {
        output.log.push(`${caster.name}以血还血，回复${healed}点生命（当前${caster.currentHp}/${caster.maxHp}）`);
    }
    return output;
}

export const xueqiSkill1: Skill = {
    id: 'xueqi_skill1',
    name: '血誓横扫',
    type: 'damage',
    description: '对周围一格（3×3）范围内的所有敌人造成4点伤害，并回复已损生命值20%的生命',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 'all',
    baseDamage: 4,
    canCrit: false,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('血契尚未部署');
        return castBloodSweep(caster, caster.position, gameState);
    },
};

export const xueqiSkill2: Skill = {
    id: 'xueqi_skill2',
    name: '血契锁',
    type: 'control',
    description: '强锁周围一格（3×3）内的一名敌人：它攻击必须指向血契，且在血契下一回合行动前不得离开血契周围一格',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        if (!caster.position) return fail('血契尚未部署');
        const target = targets[0];
        if (!target?.position) return fail('请选择周围一格内的敌人');
        const chebyshev = Math.max(
            Math.abs(target.position[0] - caster.position[0]),
            Math.abs(target.position[1] - caster.position[1])
        );
        if (chebyshev > 1) return fail('只能强锁周围一格内的敌人');

        const output = result();
        const expireAtActionSerial = xueqiBindingExpireSerial(caster);
        applyRage(target, caster, expireAtActionSerial);

        // 以血契为中心的 3×3 束缚格：被锁者起点在圈内就出不去（友方不受自家区域限制）
        const linkId = `xueqi-binding-${caster.id}-${(caster.counters['__actionSerial'] ?? 0) + 1}`;
        const cells: Position[] = [[...caster.position] as Position];
        for (let row = caster.position[0] - 1; row <= caster.position[0] + 1; row++) {
            for (let col = caster.position[1] - 1; col <= caster.position[1] + 1; col++) {
                if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
                if (row === caster.position[0] && col === caster.position[1]) continue;
                cells.push([row, col]);
            }
        }
        gameState.boardEffects ??= [];
        for (const [row, col] of cells) {
            gameState.boardEffects.push({
                id: `${linkId}-${row}-${col}`,
                type: 'binding-zone',
                position: [row, col],
                owner: caster.owner,
                sourceHeroId: caster.id,
                duration: 2,
                linkId,
                expireAtActionSerial,
            });
        }
        output.fxCoveredPositions = cells;
        // 致知3：立契这一手之后，本回合她不会倒下（标记在回合初清除）
        if (hasZhizhi(caster, 3)) caster.counters['__xueqi_immune'] = 1;
        output.log.push(`${caster.name}与${target.name}立下血契：它下一回合行动前只能留在${caster.name}身边`);
        return output;
    },
};

/* ============================================================
   云缨：祥瑞 · 星火照野 · 踏火长驱 · 烈火燎原
   ============================================================ */

const YUNYING_SPARK_DAMAGE = 3;           // 技能一：每名敌人 3 点
const YUNYING_SPARK_PER_STACK = 2;        // 技能一：目标每有 1 层祥瑞，这一击再 +2 点
const YUNYING_CHARGE_DAMAGE = 6;          // 技能二：正前方每格 6 点
const YUNYING_VAMPIRE_PER_TARGET = 0.2;   // 每个命中敌人为下一次攻击提供 20% 吸血
const YUNYING_TIANWEI_DAMAGE = 4;         // 天威·燎原百斩：路径与落点火圈每处 4 点

function yunyingDirectionStep(dirCode: number): [number, number] {
    if (dirCode === 0) return [-1, 0];
    if (dirCode === 1) return [1, 0];
    if (dirCode === 2) return [0, -1];
    return [0, 1];
}

/**
 * 云缨技能二：正前方那一排 3 格（宽 3、纵深 1，垂直于所选朝向）。
 * 返回顺序恒为"横扫的正方向"（横排=左→右，竖排=上→下），特效据此排两道火斩的先后。
 */
export function getYunyingChargeCells(caster: Hero, dirCode: number): Position[] {
    if (!caster.position) return [];
    const [dr, dc] = yunyingDirectionStep(dirCode);
    // 铺开方向是朝向的垂直轴
    const [wr, wc] = dc !== 0 ? [1, 0] : [0, 1];
    const cells: Position[] = [];
    for (let offset = -1; offset <= 1; offset++) {
        const row = caster.position[0] + dr + wr * offset;
        const col = caster.position[1] + dc + wc * offset;
        if (row < 0 || row >= 6 || col < 0 || col >= 6) continue;
        cells.push([row, col]);
    }
    return cells;
}

function yunyingEnemiesOn(caster: Hero, cells: Position[], gameState: GameState): Hero[] {
    return cells
        .map(([row, col]) => gameState.board[row]?.[col])
        .filter((hero): hero is Hero =>
            !!hero && hero.owner !== caster.owner && hero.state === HeroState.ALIVE
        );
}

/** 技能整批命中期间挂起标记，避免"下一次攻击"的吸血在半途被摘掉 */
function beginYunyingAttack(caster: Hero): void {
    caster.counters['__yunying_in_skill_cast'] = 1;
}

/** 本批命中结算完：摘掉已享用过的燎原吸血 */
function finishYunyingAttack(caster: Hero): void {
    caster.counters['__yunying_in_skill_cast'] = 0;
    caster.effects = caster.effects.filter(effect => effect.name !== YUNYING_VAMPIRE_EFFECT);
}

/**
 * 烈火燎原：沿所选方向、从云缨所在格一直到棋盘边缘的射线，
 * 对路径上每名敌人造成「已损生命 30% + 4」伤害。
 * 引燃不再叠加祥瑞（用 __liehuo_resolving 标记跳过被动）。
 */
export function castLiehuoBurn(caster: Hero, gameState: GameState, dirCode: number): SkillExecuteResult {
    const cells = getDilanSkill1Cells(caster, dirCode);
    const enemies = yunyingEnemiesOn(caster, cells, gameState);
    const output = result();
    output.fxCoveredPositions = cells;

    caster.counters['__liehuo_resolving'] = 1;
    beginYunyingAttack(caster);
    DamageCalculator.asOneAttack(() => {
        for (const enemy of enemies) {
            const missingHp = Math.max(0, enemy.maxHp - enemy.currentHp);
            // 致知2：烈火燎原变为 已损生命 40% + 5
            const liehuoRate = zhizhiValue(caster, 2, 0.3, 0.4);
            const liehuoFlat = zhizhiValue(caster, 2, 4, 5);
            const hit = damageOne(caster, enemy, Math.floor(missingHp * liehuoRate) + liehuoFlat, gameState, true);
            output.damageDealt?.push(hit.finalDamage);
            output.log.push(
                `${caster.name}的烈火燎原烧过${enemy.name}，造成${hit.finalDamage}点伤害`
            );
        }
    });
    finishYunyingAttack(caster);
    delete caster.counters['__liehuo_resolving'];

    if (enemies.length === 0) {
        output.log.push(`${caster.name}的烈火燎原只烧过一片空处`);
    }
    return output;
}

/* ---------------- 云缨：天威·燎原百斩 ---------------- */

/**
 * 燎原百斩的可选落点：与她同行、同列或同处一条对角线上的空格，距离不限。
 * 共线判据与游隼「归翎」一致（斜线即 |Δ行| == |Δ列|），不另立一套口径。
 */
export function getYunyingTianweiLandings(hero: Hero, gameState: Pick<GameState, 'board'>): Position[] {
    if (!hero.position) return [];
    const [row, col] = hero.position;
    const landings: Position[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (r === row && c === col) continue;
            const onRow = r === row;
            const onCol = c === col;
            const onDiagonal = Math.abs(r - row) === Math.abs(c - col);
            if (!onRow && !onCol && !onDiagonal) continue;
            if (gameState.board[r]?.[c]) continue;
            landings.push([r, c]);
        }
    }
    return landings;
}

/** 从她原位置到落点这条直线上的格子：不含起点、含落点。 */
function yunyingSlashPathCells(from: Position, landing: Position): Position[] {
    const stepR = Math.sign(landing[0] - from[0]);
    const stepC = Math.sign(landing[1] - from[1]);
    const cells: Position[] = [];
    let row = from[0] + stepR;
    let col = from[1] + stepC;
    while (row !== landing[0] || col !== landing[1]) {
        cells.push([row, col]);
        row += stepR;
        col += stepC;
    }
    cells.push([landing[0], landing[1]]);
    return cells;
}

function pushYunyingTianweiLog(gameState: GameState, player: Player, message: string): void {
    gameState.battleLog?.push({
        id: nextBattleLogId(),
        type: 'tianwei',
        player,
        message,
        timestamp: Date.now(),
    });
}

/**
 * 天威「燎原百斩」结算：先沿她与落点这条直线逐格斩过（每处4点），
 * 再在落点炸开3×3火圈（每处4点），最后人才落到那一格。
 * 与烈火燎原同一口径：整批命中不再叠加祥瑞（__liehuo_resolving）。
 */
export function castLiaoyuanHundredSlash(
    caster: Hero,
    gameState: GameState,
    landing: Position
): SkillExecuteResult {
    if (!caster.position) return fail('云缨尚未部署');
    // 这一记自己的斩击把人打死会再走一遍天威分发：不挡住就会用陈旧的起点二次落位
    if ((caster.counters['__yunying_tianwei_resolving'] ?? 0) === 1) return fail('燎原百斩正在斩击之中');
    if (!getYunyingTianweiLandings(caster, gameState).some(([r, c]) => r === landing[0] && c === landing[1])) {
        return fail('燎原百斩只能落在与她同行、同列或同对角线的空格');
    }

    const output = result();
    const origin: Position = [...caster.position] as Position;
    const slashCells = (cells: Position[]): { hits: number; damage: number; impact: Position[] } => {
        let hits = 0;
        let damage = 0;
        const impact: Position[] = [];
        DamageCalculator.asOneAttack(() => {
            for (const [row, col] of cells) {
                const target = gameState.board[row]?.[col];
                if (!target || target.owner === caster.owner || target.state !== HeroState.ALIVE) continue;
                const hit = damageOne(caster, target, YUNYING_TIANWEI_DAMAGE, gameState, true);
                output.damageDealt?.push(hit.finalDamage);
                if (target.position) impact.push([...target.position] as Position);
                hits += 1;
                damage += hit.finalDamage;
            }
        });
        return { hits, damage, impact };
    };

    caster.counters['__yunying_tianwei_resolving'] = 1;
    // 燎原烧死人时天威就嵌在燎原自己的挂起标记里结算，收尾要还原原值而非直接删除：
    // 删了会让燎原剩下的命中重新开始叠祥瑞
    const resolvingBefore = caster.counters['__liehuo_resolving'];
    caster.counters['__liehuo_resolving'] = 1;
    try {
        const path = slashCells(yunyingSlashPathCells(origin, landing));
        const blast = slashCells(MovementSystem.getAreaPositions(landing, 3));
        const hits = path.hits + blast.hits;

        if (caster.state === HeroState.ALIVE && !gameState.board[landing[0]][landing[1]]) {
            gameState.board[origin[0]][origin[1]] = null;
            gameState.board[landing[0]][landing[1]] = caster;
            caster.position = landing;
            syncPositionAnchoredEffects(gameState);
            // 直线穿敌，普通寻路走不通：与惊鸿绕后同一口径手动落位后逐格补回移动连带结算
            const steps = Math.max(Math.abs(landing[0] - origin[0]), Math.abs(landing[1] - origin[1]));
            // 天威是自己落过去的位移，不吃羽化；流血仍逐格结算
            DamageCalculator.applyBleedMovementDamage(caster, steps, gameState);
        }

        const tianweiLogIdsBefore = new Set(gameState.battleLog.map(log => log.id));
        pushYunyingTianweiLog(gameState, caster.owner, hits > 0
            ? `${caster.name}天威·燎原百斩，枪光扫过${hits}处造成${path.damage + blast.damage}点伤害，人落到(${landing[0] + 1},${landing[1] + 1})`
            : `${caster.name}天威·燎原百斩斩向空处，只在那一格留下火线`);
        requestSkillFx({
            skillId: 'yunying_tianwei',
            owner: caster.owner,
            fromPos: origin,
            targetPos: landing,
            impactPositions: [...path.impact, ...blast.impact],
            logIds: gameState.battleLog.filter(log => !tianweiLogIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
    } finally {
        if (resolvingBefore === undefined) delete caster.counters['__liehuo_resolving'];
        else caster.counters['__liehuo_resolving'] = resolvingBefore;
        delete caster.counters['__yunying_tianwei_resolving'];
    }
    return output;
}

/**
 * 天威与燎原的排队标记：`pendingBoardAction` 一次只存得下一个挂起，
 * 而策划口径是"先天威、后燎原"，所以谁在等谁要各记一笔账。
 */
const LIEHUO_QUEUED_KEY = '__yunying_liehuo_queued';
const TIANWEI_QUEUED_KEY = '__yunying_tianwei_queued';

function takeYunyingQueuedPick(hero: Hero, key: string): boolean {
    if (hero.counters[key] !== 1) return false;
    delete hero.counters[key];
    return true;
}

/** 她的烈火燎原排在天威之后：取走这次排队，由 game-store 在天威斩完后补挂方向选择 */
export function takeYunyingQueuedLiehuo(hero: Hero): boolean {
    return takeYunyingQueuedPick(hero, LIEHUO_QUEUED_KEY);
}

/** 她的天威排在燎原那次燃烧之后：取走这次排队，由 game-store 在烧完后补挂落点选择 */
export function takeYunyingQueuedTianwei(hero: Hero): boolean {
    return takeYunyingQueuedPick(hero, TIANWEI_QUEUED_KEY);
}

/** 引燃撞上她自己挂起的天威：这次燎原记到排队账上，等天威斩完再补挂方向选择 */
export function queueYunyingLiehuoBehindTianwei(attacker: Hero): void {
    attacker.counters[LIEHUO_QUEUED_KEY] = 1;
}

/**
 * 自动挑选落点：直线与火圈合计斩中人数最多者，同分取更近的那格
 * （与南风天威"方向不可选择"同一口径）。
 * 玩家手点是主路径，这里只服务电脑与"行动收尾时她始终没点"的兜底放行。
 */
export function pickYunyingTianweiLanding(hero: Hero, gameState: GameState): Position | null {
    if (hero.state !== HeroState.ALIVE || !hero.position) return null;
    const landings = getYunyingTianweiLandings(hero, gameState);
    if (landings.length === 0) return null;

    const origin = hero.position;
    let best: Position | null = null;
    let bestScore = 0;
    let bestSteps = BOARD_SIZE * 2;
    for (const landing of landings) {
        const struck = new Set<string>();
        for (const [row, col] of [...yunyingSlashPathCells(origin, landing),
            ...MovementSystem.getAreaPositions(landing, 3)]) {
            const target = gameState.board[row]?.[col];
            if (target && target.owner !== hero.owner && target.state === HeroState.ALIVE) {
                struck.add(`${row},${col}`);
            }
        }
        const steps = Math.max(Math.abs(landing[0] - origin[0]), Math.abs(landing[1] - origin[1]));
        if (struck.size > bestScore || (struck.size === bestScore && struck.size > 0 && steps < bestSteps)) {
            best = landing;
            bestScore = struck.size;
            bestSteps = steps;
        }
    }
    return bestScore > 0 ? best : null;
}

/**
 * 击杀触发的天威入口：挂起玩家手点落点，返回是否真的挂上了（调用方据此决定是否扣住行动）。
 * 没有合法落点（共线格被占满）时沿用旧口径——不斩不位移，直接放行，绝不留下无人可解的挂起。
 */
export function requestYunyingTianweiLanding(hero: Hero, gameState: GameState): boolean {
    if (hero.state !== HeroState.ALIVE || !hero.position) return false;
    const pending = gameState.pendingBoardAction;
    const ownLiehuo = pending?.type === 'yunying-liehuo' && pending.heroId === hero.id;
    if (pending && !ownLiehuo) return false;
    if (getYunyingTianweiLandings(hero, gameState).length === 0) return false;
    if (ownLiehuo) {
        if (hero.counters['__liehuo_resolving'] === 1) {
            // 正嵌在这一次燎原的批量命中里结算：挂起槽要等 game-store 收尾才空出来，先记下排队
            hero.counters[TIANWEI_QUEUED_KEY] = 1;
            return false;
        }
        // 先天威后燎原：天威夺下挂起槽，刚引燃的燎原回炉排队，两者都不会被对方覆盖掉
        hero.counters[LIEHUO_QUEUED_KEY] = 1;
    }
    gameState.pendingBoardAction = { type: 'yunying-tianwei', heroId: hero.id };
    pushYunyingTianweiLog(gameState, hero.owner,
        `${hero.name}触发天威·燎原百斩：请选择枪光斩向的落点（与她同行、同列或同对角线的空格）`);
    return true;
}

export const yunyingSkill1: Skill = {
    id: 'yunying_skill1',
    name: '星火照野',
    type: 'damage',
    description: '对周围一格（含斜角）的所有敌人各造成3点伤害，并按每名敌人引火前已有的祥瑞层数增伤（每层+2点）',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 'all',
    baseDamage: YUNYING_SPARK_DAMAGE,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('云缨尚未部署');
        const cells: Position[] = [caster.position, ...MovementSystem.getAreaPositions(caster.position, 3)];
        const enemies = yunyingEnemiesOn(caster, cells, gameState);
        if (enemies.length === 0) return fail('周围没有可烧到的敌人');

        // 增伤只看引火前已有的层数：本次命中刚叠上的那层不计入，否则越打越自我放大。
        // 致知3 把顺序倒过来——先施加祥瑞再打伤害，于是每个人都多算一层。
        const stackedBeforeHit = hasZhizhi(caster, 3) ? 1 : 0;
        const bonusByEnemy = new Map(enemies.map(enemy => [enemy.id, getXiangruiStacks(enemy) + stackedBeforeHit]));

        const output = result();
        output.fxCoveredPositions = MovementSystem.getAreaPositions(caster.position, 3);
        beginYunyingAttack(caster);
        DamageCalculator.asOneAttack(() => {
            for (const enemy of enemies) {
                const stacks = bonusByEnemy.get(enemy.id) ?? 0;
                const hit = damageOne(caster, enemy, YUNYING_SPARK_DAMAGE + stacks * YUNYING_SPARK_PER_STACK, gameState, true);
                output.damageDealt?.push(hit.finalDamage);
            }
        });
        finishYunyingAttack(caster);

        output.log.push(`${caster.name}星火照野，烧过${enemies.length}名敌人`);
        return output;
    },
};

export const yunyingSkill2: Skill = {
    id: 'yunying_skill2',
    name: '踏火长驱',
    type: 'damage',
    description: '选择一个方向，对正前方一排3格（宽3深1）上的所有敌人造成6点伤害；按命中人数为下一次攻击附加吸血（每人20%，再次释放可刷新）',
    rangeType: 'line',
    range: 1,
    targetType: 'enemy',
    targetCount: 'all',
    baseDamage: YUNYING_CHARGE_DAMAGE,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        const dirCode = caster.counters['__yunying_skill2_dir'];
        if (dirCode === undefined) return fail('请先选择长驱方向');
        delete caster.counters['__yunying_skill2_dir'];
        const cells = getYunyingChargeCells(caster, dirCode);
        const enemies = yunyingEnemiesOn(caster, cells, gameState);
        if (enemies.length === 0) return fail('该方向前方没有敌人');

        const output = result();
        output.fxCoveredPositions = cells;
        beginYunyingAttack(caster);
        DamageCalculator.asOneAttack(() => {
            for (const enemy of enemies) {
                const hit = damageOne(caster, enemy, YUNYING_CHARGE_DAMAGE, gameState, true);
                output.damageDealt?.push(hit.finalDamage);
            }
        });
        // 这批命中已经把上一次的吸血用掉，之后再挂新的（刷新数值，不叠加）
        finishYunyingAttack(caster);

        const rate = enemies.length * YUNYING_VAMPIRE_PER_TARGET;
        EffectManager.addEffect(caster, {
            type: 'buff',
            name: YUNYING_VAMPIRE_EFFECT,
            duration: -1,
            value: rate,
            sourceHeroId: caster.id,
            description: `下一次攻击造成实际伤害时按${Math.round(rate * 100)}%吸血`,
        });
        output.log.push(
            `${caster.name}踏火长驱命中${enemies.length}名敌人，下一次攻击获得${Math.round(rate * 100)}%吸血`
        );
        return output;
    },
};

/**
 * 技能1「掠水惊鸿」：身周 3×3 内单体 9 点，随后沿攻击方向落到目标身后一格。
 * 落点越界或被占据时只打不移；绕后是穿过目标格的冲刺，因此与游隼疾掠同一口径
 * 手动落位并补回流血/风刃等移动连带结算，同时占用本回合的移动额度。
 */
export const jinghongSkill1: Skill = {
    id: 'jinghong_skill1',
    name: '掠水惊鸿',
    type: 'damage',
    description: '攻击身周3×3内的一名敌人造成9点伤害，随后朝攻击方向落到该敌人身后一格；身后越界或被占据则只攻击不位移。命中后获得1层惊鸿（上限3层）',
    rangeType: 'area',
    range: 0,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: 9,
    canCrit: true,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target?.position || !caster.position) return fail('请选择身周的一名敌人');

        const output = result();
        output.fxCoveredPositions = [target.position];
        // 致知2：掠水惊鸿 9 → 11
        const damage = damageOne(caster, target, zhizhiValue(caster, 2, 9, 11), gameState, true);
        output.damageDealt?.push(damage.finalDamage);

        const [cr, cc] = caster.position;
        const [tr, tc] = target.position;
        const behind: Position = [tr + Math.sign(tr - cr), tc + Math.sign(tc - cc)];
        if (!MovementSystem.inBounds(behind)) {
            output.log.push(`${caster.name}的掠水惊鸿出界，身后已无落点`);
        } else if (gameState.board[behind[0]][behind[1]] !== null) {
            output.log.push(`${caster.name}的落点被占据，止步于${target.name}身前`);
        } else if (caster.state !== HeroState.ALIVE) {
            output.log.push(`${caster.name}在斩击中阵亡，未能位移`);
        } else {
            // 绕后要从被斩中的敌人身上"穿"过去，普通寻路会把这条路判死，
            // 因此与游隼疾掠同一口径：手动落位后，逐格补回移动连带结算。
            const start: Position = [...caster.position] as Position;
            gameState.board[start[0]][start[1]] = null;
            gameState.board[behind[0]][behind[1]] = caster;
            caster.position = behind;
            caster.hasMovedThisTurn = true;
            const steps = Math.max(Math.abs(behind[0] - start[0]), Math.abs(behind[1] - start[1]));
            // 绕后是她自己掠过去的位移，不吃羽化；流血仍逐格结算
            DamageCalculator.applyBleedMovementDamage(caster, steps, gameState);
            retractWindBladesOnCells(caster, [target.position, behind], gameState);
            output.log.push(`${caster.name}掠过${target.name}身侧，落向其后`);
        }

        const stacks = EffectManager.getCounter(caster, '惊鸿');
        if (stacks < JINGHONG_MAX) {
            EffectManager.setCounter(caster, '惊鸿', stacks + 1);
            output.log.push(
                `${caster.name}攒下惊鸿第${stacks + 1}层${stacks + 1 >= JINGHONG_MAX ? '（已满3层）' : ''}`
            );
        }
        return output;
    },
};

/**
 * 技能2「止水决渊」两段式：
 * 第一段（蓄力）消耗全部惊鸿，按消耗前的层数提升防御，整回合结束时按届时已损生命回复；
 * 第二段只能在紧接的下一回合主动释放，放弃移动换取 5×5 外环 10 点群体伤害。
 * 错过释放窗口即消散，惊鸿不返还。
 */
export const jinghongSkill2: Skill = {
    id: 'jinghong_skill2',
    name: '止水决渊',
    type: 'damage',
    description: '消耗全部惊鸿蓄力止水：本回合防御提升(10%+惊鸿×10%)，并在整回合结束时恢复已损生命的(20%+惊鸿×10%)。下一回合不能移动，可主动放出决渊，对身周5×5外环（不含3×3）的敌人造成10点伤害；错过则蓄力消散',
    rangeType: 'area',
    range: 0,
    areaSize: 5,
    // 两段都不靠引擎选敌：蓄力段点自己脚下，决渊段在 execute 里自己扫外环
    targetType: 'self',
    targetCount: 1,
    baseDamage: 10,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('尚未就位');

        // 第二段：只在蓄力的下一回合开放
        if (isJinghongReleaseWindow(caster, gameState)) {
            const ring = getJinghongOuterRing(caster.position);
            const enemies = lingxiEnemiesInCells(ring, gameState, caster);
            if (enemies.length === 0) return fail('决渊的外环上没有敌人');
            const output = result();
            output.fxCoveredPositions = ring;
            DamageCalculator.asOneAttack(() => {
                for (const enemy of enemies) {
                    // 致知3：决渊第二段 10 → 12
                    const hit = damageOne(caster, enemy, zhizhiValue(caster, 3, 10, 12), gameState, true);
                    output.damageDealt?.push(hit.finalDamage);
                }
            });
            caster.counters['jinghong_charge_round'] = -1;
            caster.counters['jinghong_charge_stacks'] = 0;
            output.log.push(`${caster.name}决渊而出，外环${enemies.length}名敌人受创`);
            return output;
        }

        if (isJinghongCharging(caster, gameState)) {
            return fail('止水已在蓄力中，决渊要等下一回合');
        }

        // 第一段：消耗全部惊鸿，加成按消耗前的层数算
        const stacks = EffectManager.getCounter(caster, '惊鸿');
        if (stacks < 1) return fail('惊鸿不足，无法蓄力止水');
        EffectManager.addCounter(caster, '惊鸿', -stacks);

        const defenseRate = 0.1 + stacks * 0.1;
        EffectManager.addEffect(caster, {
            type: 'buff',
            // 名字必须含"防御"，否则进不了 damage-calculator 的防御减免通道
            name: '止水防御提升',
            duration: 1,
            value: defenseRate,
            stackCount: 1,
            sourceHeroId: caster.id,
            description: `蓄力之刻防御提升${Math.round(defenseRate * 100)}%`,
        });
        caster.counters['jinghong_charge_round'] = gameState.roundNumber;
        caster.counters['jinghong_charge_stacks'] = stacks;

        const output = result();
        output.fxCoveredPositions = [caster.position];
        // 蓄力段不是斩击，切到「静水」自养光环的条件形态，别套用决渊那圈刀痕
        gameState.skillFxExtras = {
            fxVariant: 'jinghong_still',
            coveredPositions: [caster.position],
        };
        output.log.push(
            `${caster.name}敛息止水，消耗${stacks}层惊鸿，防御提升${Math.round(defenseRate * 100)}%`
        );
        return output;
    },
};

/* ============================================================
   镜花·水月：水月换身 / 印月替身 / 镜湖双照
   换位是她的骨架：技能1与友方真身换身并在水中留影，被动让队友拿移动力
   换"镜像"（水月）或换本体，每一次交换都替她叠一层镜影；
   大招把镜影印给候补替身，自己退坐月座，等人来踏座接她回场。
   ============================================================ */

/** 水月瞬身的护盾值（镜花致知2 从 5 抬到 7） */
const JINGHUA_MOON_SHIELD = 5;
/** 天威登场照击的基础伤害（镜花致知3 从 5 抬到 7） */
const JINGHUA_ENTRANCE_DAMAGE = 5;

/** 踏月的护盾看的是镜花本人的致知，不是踩月那位 */
function jinghuaMoonShield(jinghua: Hero | null | undefined): number {
    return zhizhiValue(jinghua, 2, JINGHUA_MOON_SHIELD, JINGHUA_MOON_SHIELD + 2);
}

function pushJinghuaLog(gameState: GameState, player: Player, message: string): void {
    gameState.battleLog.push({
        id: nextBattleLogId(),
        timestamp: Date.now(),
        type: 'passive',
        player,
        message,
    });
}

function addJingyingFromSwap(jinghua: Hero, mover: Hero, gameState: GameState): void {
    if (jinghua.state !== HeroState.ALIVE) return;
    const before = jinghua.counters['镜影'] ?? 0;
    if (before >= JINGHUA_STACK_MAX) {
        pushJinghuaLog(gameState, jinghua.owner, `${jinghua.name}镜影已满（${JINGHUA_STACK_MAX}层），水面平静无波`);
        return;
    }
    jinghua.counters['镜影'] = before + 1;
    pushJinghuaLog(gameState, jinghua.owner,
        `${jinghua.name}借${mover.name}的交换凝出镜影第${before + 1}层（${before + 1}/${JINGHUA_STACK_MAX}）`);
}

/**
 * 某名友方移动时可选的"免费镜像落点"：镜花真身格 / 水月影格 / （镜花下场时）月座格。
 * 这些格子并入移动高亮，点击后由 resolveJinghuaSwapMove 以交换结算，不走普通寻路。
 */
export function getJinghuaSwapDestinations(mover: Hero, gameState: GameState): Position[] {
    if (mover.passiveId === 'jinghua_passive' || !mover.position) return [];
    const jinghua = findJinghua(gameState, mover.owner);
    if (!jinghua || jinghua.state === HeroState.DEAD) return [];
    const [mr, mc] = mover.position;
    const dests: Position[] = [];
    if (isJinghuaOffboard(jinghua)) {
        // 月座格被占时不再提供踏座落点（敌人压上占位就只能等自动归位）
        const seat = findMoonSeat(gameState, mover.owner);
        if (seat && !gameState.board[seat.position[0]][seat.position[1]]) {
            dests.push([...seat.position] as Position);
        }
    } else {
        if (jinghua.position && jinghua.state === HeroState.ALIVE) dests.push([...jinghua.position] as Position);
        // 月影格被任何单位占着时不再提供踏月落点（ occupant 走开后可再踩）
        const moon = findWaterMoon(gameState, mover.owner);
        if (moon && !gameState.board[moon.position[0]][moon.position[1]]) {
            dests.push([...moon.position] as Position);
        }
    }
    return dests.filter(([r, c]) => !(r === mr && c === mc));
}

/**
 * 天威·镜花照水：登场刹那照向离自己最近的敌人（并列即群攻），
 * 造成5点伤害；若这一照击杀了敌人，随机回声一名友方单位的天威。
 */
export function jinghuaEntranceStrike(jinghua: Hero, gameState: GameState): void {
    if (jinghua.state !== HeroState.ALIVE || !jinghua.position) return;
    const enemies = getEnemies(jinghua, gameState).filter(
        enemy => enemy.state === HeroState.ALIVE && enemy.position
    );
    if (enemies.length === 0) {
        pushJinghuaLog(gameState, jinghua.owner, `${jinghua.name}登场，镜光落在空处`);
        return;
    }
    let minDist = Infinity;
    for (const enemy of enemies) {
        minDist = Math.min(minDist, MovementSystem.getManhattanDistance(jinghua.position, enemy.position!));
    }
    const targets = enemies.filter(enemy =>
        MovementSystem.getManhattanDistance(jinghua.position!, enemy.position!) === minDist);
    let killed = 0;
    // 致知3：登场照击 5 → 7
    const entranceDamage = zhizhiValue(jinghua, 3, JINGHUA_ENTRANCE_DAMAGE, JINGHUA_ENTRANCE_DAMAGE + 2);
    const impactPositions: Position[] = [];
    for (const enemy of targets) {
        const before = enemy.state;
        if (enemy.position) impactPositions.push([...enemy.position] as Position);
        damageOne(jinghua, enemy, entranceDamage, gameState, targets.length > 1);
        if (before === HeroState.ALIVE && enemy.state !== HeroState.ALIVE) killed += 1;
    }
    const entranceLogIdsBefore = new Set(gameState.battleLog.map(log => log.id));
    pushJinghuaLog(gameState, jinghua.owner,
        `${jinghua.name}天威·镜花照水，登场即照${targets.length === 1 ? `${targets[0].name}` : `${targets.length}名敌人`}，造成${entranceDamage}点伤害`);
    if (impactPositions.length > 0) {
        requestSkillFx({
            skillId: 'jinghua_tianwei',
            owner: jinghua.owner,
            fromPos: [...jinghua.position] as Position,
            targetPos: impactPositions[0],
            impactPositions,
            logIds: gameState.battleLog.filter(log => !entranceLogIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
    }
    if (killed > 0) {
        const echoLogIdsBefore = new Set(gameState.battleLog.map(log => log.id));
        const echoed = DamageCalculator.rollRandomAllyTianwei(gameState, jinghua.owner, jinghua.id);
        if (echoed?.position) {
            // 回声也要"看得见"：被点名友方脚下亮起一轮月华，播专属铃音
            requestSkillFx({
                skillId: 'jinghua_tianwei_echo',
                owner: jinghua.owner,
                fromPos: [...echoed.position] as Position,
                targetPos: [...echoed.position] as Position,
                impactPositions: [[...echoed.position] as Position],
                logIds: gameState.battleLog.filter(log => !echoLogIdsBefore.has(log.id)).map(log => log.id),
            }, gameState);
        }
    }
}

/**
 * 真身归场即收回替身：经「印月替身」登场的候补是镜中虚影——镜花回到场上，
 * 虚影就散去：离场（棋盘+名册移除），模板 id 回候补席（若替身已经真阵亡则
 * 不回收，保持死亡事实）。
 */
function retireJinghuaSubstitute(jinghua: Hero, gameState: GameState): Hero | null {
    const pool = jinghua.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    const sub = pool.find(hero => (hero.counters['__jinghua_substitute'] ?? 0) === 1);
    if (!sub) return null;
    sub.counters['__jinghua_substitute'] = 0;
    if (sub.position) {
        const [r, c] = sub.position;
        if (gameState.board[r][c] === sub) gameState.board[r][c] = null;
        sub.position = null;
    }
    const stillUsable = sub.state === HeroState.ALIVE || sub.state === HeroState.TEMP_DEAD;
    // 替身是借来的形：消散后不留尸体，死亡账已由 handleDeath 记过
    const idx = pool.indexOf(sub);
    if (idx >= 0) pool.splice(idx, 1);
    if (stillUsable) {
        const templateId = sub.id.replace(/-(player1|player2)-\d+$/, '');
        if (jinghua.owner === 'player1') {
            gameState.player1BenchHeroIds = [...(gameState.player1BenchHeroIds ?? []), templateId];
        } else {
            gameState.player2BenchHeroIds = [...(gameState.player2BenchHeroIds ?? []), templateId];
        }
        // 候补席只存模板 id，实例连同伤口会被丢掉；不记这一笔，
        // 替身挨的打就在真正补员登场时被清零
        setBenchHeroHp(gameState, jinghua.owner, templateId, sub.currentHp);
        pushJinghuaLog(gameState, jinghua.owner, `${sub.name}的月影替身功成身退，回到候补席`);
    } else {
        // 已经真阵亡：不回收，也别留下会被误用的残血记录
        clearBenchHeroHp(gameState, jinghua.owner, sub.id.replace(/-(player1|player2)-\d+$/, ''));
        pushJinghuaLog(gameState, jinghua.owner, `${sub.name}的月影替身随镜花归场散去`);
    }
    return sub;
}

/**
 * 月座归场：镜花重返月座格（被占则就近让位），踏座者被安置到月座旁最近空格；
 * 归场即触发天威登场照击。stepper 为 null 时是"三回合无人触发自动归位"。
 */
export function jinghuaMoonSeatReturn(
    jinghua: Hero,
    stepperArg: Hero | null,
    gameState: GameState,
    verb = '踏座而来'
): void {
    const seat = findMoonSeat(gameState, jinghua.owner);
    if (!seat || !isJinghuaOffboard(jinghua)) return;
    // 先收替身再落本体：棋盘同一时刻不出现 5 个现役角色。
    // retired 必须带出去——踏座者往往就是替身自己，若不再拦一道，
    // 下面的"让位"会把这名已从名册移除的虚影重新摆回棋盘，变成永远下场的卡死棋子
    const retired = retireJinghuaSubstitute(jinghua, gameState);
    const stepper = stepperArg && stepperArg !== retired ? stepperArg : null;
    const [sr, sc] = seat.position;
    if (stepper && gameState.board[sr][sc] === stepper) {
        gameState.board[sr][sc] = null;
    }
    let landing: Position | null = gameState.board[sr][sc] === null ? [sr, sc] : null;
    if (!landing) landing = MovementSystem.findNearestEmptyPosition([sr, sc], gameState);
    if (!landing) return; // 棋盘塞满：继续留在月座等下一轮

    gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => effect.id !== seat.id);
    jinghua.state = HeroState.ALIVE;
    jinghua.currentHp = Math.max(1, jinghua.counters['__jinghua_return_hp'] || Math.ceil(jinghua.maxHp / 2));
    jinghua.counters['__jinghua_offboard'] = 0;
    jinghua.position = landing;
    jinghua.hasActedThisTurn = false;
    jinghua.hasMovedThisTurn = false;
    gameState.board[landing[0]][landing[1]] = jinghua;
    if (stepper) {
        // 只有"此刻还站在月座上"的踏座者才需要让位。
        // 他在这一手里可能被击退/拖拽挪走，甚至已经被打死：那时无图可让，
        // 硬把他安置到月座旁会把不在名册上的单位摆回棋盘（幽灵棋子）。
        const stillOnSeat = stepper.state === HeroState.ALIVE
            && !!stepper.position && stepper.position[0] === sr && stepper.position[1] === sc;
        if (stillOnSeat) {
            // 月座格此刻已经归了镜花，这里只需把他安置到附近空格，不要再动那一格
            const spot = MovementSystem.findNearestEmptyPosition(landing, gameState);
            if (spot) {
                stepper.position = spot;
                gameState.board[spot[0]][spot[1]] = stepper;
            } else {
                stepper.position = null;
            }
        }
    }
    pushJinghuaLog(gameState, jinghua.owner,
        stepper
            ? `${stepper.name}${verb}，${jinghua.name}携月之倒影归场（生命${jinghua.currentHp}）`
            : stepperArg && stepperArg === retired
                ? `${stepperArg.name}踏座交还月影，${jinghua.name}携月之倒影归场（生命${jinghua.currentHp}）`
                : `月落时辰到，${jinghua.name}携月之倒影归场（生命${jinghua.currentHp}）`);
    jinghuaEntranceStrike(jinghua, gameState);
}

/**
 * 踏座者的行动结束时兑现月座：镜花归场、踏座者让位、登场即照一击。
 * 收口在 GameEngine.endHeroAction，所以普攻/技能/直接结束行动三条路都走得到。
 */
export function settleJinghuaSeatReturn(hero: Hero, gameState: GameState): boolean {
    if (hero.counters['__jinghua_seat_return_pending'] !== 1) return false;
    delete hero.counters['__jinghua_seat_return_pending'];
    const jinghua = findJinghua(gameState, hero.owner);
    if (!jinghua) return false;
    // 踏座者可能在这一手里倒下：座仍然兑现（他把这一手交出去了），但绝不能再把他搬上棋盘
    if (hero.state !== HeroState.ALIVE) {
        pushJinghuaLog(gameState, hero.owner, `${hero.name}踏响的月座随他的倒下仍然兑现`);
        jinghuaMoonSeatReturn(jinghua, null, gameState);
        return true;
    }
    jinghuaMoonSeatReturn(jinghua, hero, gameState);
    return true;
}

/** 回合初结算：三回合将满仍未被踏响的月座自动归位（在通用 duration 衰减移除它之前抢一步） */
export function tickJinghuaMoonSeats(gameState: GameState): void {
    for (const seat of (gameState.boardEffects ?? []).filter(effect => effect.type === 'moon-seat')) {
        if (seat.duration > 1) continue;
        const jinghua = findJinghua(gameState, seat.owner);
        if (jinghua && isJinghuaOffboard(jinghua)) {
            jinghuaMoonSeatReturn(jinghua, null, gameState, '月落无声，自动归位');
        } else {
            gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => effect.id !== seat.id);
        }
    }
}

/**
 * 镜花·水月被真阵亡带走时，水面倒影与月座随镜碎散（防止无人认领的常驻标记留在场地上）。
 */
export function purgeJinghuaMarks(hero: Hero, gameState: GameState): boolean {
    const before = (gameState.boardEffects ?? []).length;
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect =>
        !((effect.type === 'water-moon' || effect.type === 'moon-seat') && effect.sourceHeroId === hero.id)
    );
    if (gameState.boardEffects.length === before) return false;
    pushJinghuaLog(gameState, hero.owner, `${hero.name}阵亡，水月与月座随镜碎散`);
    return true;
}

/**
 * 队友"移动"点击镜像落点时的统一结算：真身换位 / 水月换影 / 踏座归场。
 * 命中任一模式就完成全部盘面改动与日志，返回模式名；未命中返回 null 走普通移动。
 */
export function resolveJinghuaSwapMove(
    mover: Hero,
    to: Position,
    gameState: GameState
): 'self' | 'moon' | 'moonseat' | null {
    if (!mover.position || mover.passiveId === 'jinghua_passive') return null;
    const jinghua = findJinghua(gameState, mover.owner);
    if (!jinghua) return null;
    const [mr, mc] = mover.position;
    const same = (pos: Position) => pos[0] === to[0] && pos[1] === to[1];
    // 任何交换结算都即时定格，不允许"撤回移动"回退位置/镜影/护盾收益
    const lockSwap = () => { mover.counters['__jinghua_swap_no_undo'] = 1; };

    if (isJinghuaOffboard(jinghua)) {
        const seat = findMoonSeat(gameState, mover.owner);
        if (seat && same(seat.position)) {
            // 月座只认本方队友的踏座，且格上必须无人：被敌方站上时踏不响、
            // 也绝不允许把占格的敌人挤开或把镜花硬塞进旁边格子
            const occupant = gameState.board[seat.position[0]][seat.position[1]];
            if (occupant && occupant !== mover) return null;
            // 已经有人把这张座踩响在排队了：再让第二人踏一次只会空转，白扔一次移动
            const seatClaimed = [...gameState.player1Heroes, ...gameState.player2Heroes]
                .some(hero => hero.counters['__jinghua_seat_return_pending'] === 1);
            if (seatClaimed) return null;
            lockSwap();
            // 踏座是真的走上去站住：这一手还没打完，镜花不许现在就把人挤走。
            // 归场与让位留到他的行动结束再兑现（见 settleJinghuaSeatReturn）。
            const [fromR, fromC] = mover.position;
            const [seatR, seatC] = seat.position;
            gameState.board[fromR][fromC] = null;
            gameState.board[seatR][seatC] = mover;
            mover.position = [seatR, seatC];
            // 踏座归位是己方技能位移，不吃羽化
            mover.counters['__jinghua_seat_return_pending'] = 1;
            return 'moonseat';
        }
        return null;
    }

    if (jinghua.state === HeroState.ALIVE && jinghua.position && same(jinghua.position)) {
        const [jr, jc] = jinghua.position;
        lockSwap();
        gameState.board[mr][mc] = jinghua;
        gameState.board[jr][jc] = mover;
        mover.position = [jr, jc];
        jinghua.position = [mr, mc];
        // 镜面互换是己方技能位移，不吃羽化
        addJingyingFromSwap(jinghua, mover, gameState);
        pushJinghuaLog(gameState, mover.owner, `${mover.name}与${jinghua.name}穿过镜面互换了位置`);
        return 'self';
    }

    const moon = findWaterMoon(gameState, mover.owner);
    if (moon && same(moon.position)) {
        // 月影格上站着别人时无法再踩：先让 occupant 走开，水月才可再次换影
        const occupant = gameState.board[to[0]][to[1]];
        if (occupant && occupant !== mover) return null;
        lockSwap();
        gameState.board[mr][mc] = null;
        gameState.board[to[0]][to[1]] = mover;
        mover.position = [to[0], to[1]];
        moon.position = [mr, mc];
        EffectManager.addShield(mover, jinghuaMoonShield(jinghua));
        // 借月换影是己方技能位移，不吃羽化
        addJingyingFromSwap(jinghua, mover, gameState);
        pushJinghuaLog(gameState, mover.owner,
            `${mover.name}借水月换影，不耗移动力掠至月影处并获得${jinghuaMoonShield(jinghua)}点护盾，月影退回其原位`);
        return 'moon';
    }
    return null;
}

/**
 * 换位印的镜影不该被"撤回移动"白嫖：交换完成即落账，标记拒绝撤回。
 */
export function jinghuaSwapLocked(hero: Hero): boolean {
    return (hero.counters['__jinghua_swap_no_undo'] ?? 0) === 1;
}

/** 技能1「水月换身」：全场任选一名友方换身，原位放水月 */
export const jinghuaSkill1: Skill = {
    id: 'jinghua_skill1',
    name: '水月换身',
    type: 'special',
    description: '与全场任意一名友方交换位置，并在自己原来的位置放置「水月」：被换上的队友正好落进水月格、立刻获得5点护盾；此后友方每次移动仍可再踏月换影（每次都得5护盾，水月随之挪到其出发格）。水月持续一回合，且镜花下一次行动后消失',
    rangeType: '全场',
    range: 6,
    targetType: 'ally',
    targetCount: 1,
    execute: (caster, targets, gameState) => {
        const ally = targets[0];
        if (!ally?.position || !caster.position || ally === caster) return fail('请选择一名友方交换位置');
        const [cr, cc] = caster.position;
        const [ar, ac] = ally.position;
        gameState.board[cr][cc] = ally;
        gameState.board[ar][ac] = caster;
        caster.position = [ar, ac];
        ally.position = [cr, cc];
        const output = result();
        // 换身是己方技能位移，不吃羽化
        // 换身把队友恰好送进水月格里：落地即结一次踏月收益（5点护盾），
        // 之后他每次移动还能再来踩月；月影本体留在镜花的出发格
        EffectManager.addShield(ally, jinghuaMoonShield(caster));
        output.log.push(`${caster.name}与${ally.name}换身归位，${ally.name}踏上月影获${jinghuaMoonShield(caster)}点护盾`);
        const effects = gameState.boardEffects ?? [];
        effects.push({
            id: `water-moon-${caster.id}-${Date.now()}`,
            type: 'water-moon',
            position: [cr, cc],
            owner: caster.owner,
            sourceHeroId: caster.id,
            duration: 1,
            // 下一回合开始前一直可用；镜花再完成一次行动（计数+2）则由行动清理撤除
            expireAtActionSerial: (caster.counters['__actionSerial'] ?? 0) + 2,
        });
        gameState.boardEffects = effects;
        output.fxCoveredPositions = [[cr, cc]];
        return output;
    },
};

/** 技能2「印月替身」：唤候补登场携印月，自己退入月座等踏座归场 */
export const jinghuaSkill2: Skill = {
    id: 'jinghua_skill2',
    name: '印月替身',
    type: 'summon',
    description: '选择一名候补友方登场到镜花周围3×3内的空格，按镜花当前镜影层数获得「印月」（每层攻防+10%，持续三回合），登场当回合不行动；镜花下场，原位留下「月座」：友方踏上月座即接镜花归场，三回合无人触发则自动归位',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'empty',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        const landing = encodedTarget(caster);
        if (!caster.position || !landing) return fail('请选择登场落点');
        const pickIndex = caster.counters['__jinghua_summon_pick'];
        if (typeof pickIndex !== 'number' || pickIndex < 0) return fail('请先在技能栏选择一名候补友方');
        const bench = caster.owner === 'player1'
            ? gameState.player1BenchHeroIds ?? []
            : gameState.player2BenchHeroIds ?? [];
        const pick = bench[pickIndex];
        if (!pick) return fail('该候补已不在席上');
        if (pick === 'jinghua') return fail('镜中无处照出第二个镜花');
        const [cr, cc] = caster.position;
        const [lr, lc] = landing;
        if (Math.abs(lr - cr) > 1 || Math.abs(lc - cc) > 1 || (lr === cr && lc === cc)) {
            return fail('只能让友方落到镜花周围3×3内的空格');
        }
        if (!MovementSystem.inBounds(landing) || gameState.board[lr][lc] !== null) {
            return fail('落点已被占据');
        }

        delete caster.counters['__jinghua_summon_pick'];
        const stacks = getJinghuaStacks(caster);
        const output = result();
        const rookie = applyZhizhiForMode(applyHeroWeapon(createHero(pick, caster.owner, landing),
            caster.owner === 'player1' ? gameState.player1WeaponIds : gameState.player2WeaponIds), gameState.gameMode);
        // 标记月影替身：镜花归场时这一具要退回候补席
        applyWeaponOnArrival(rookie);
        rookie.counters['__jinghua_substitute'] = 1;
        // 与 T 型帛画重新落位同口径：登场这一拍只入座，不当回合行动
        rookie.hasActedThisTurn = true;
        rookie.hasMovedThisTurn = true;
        addHeroToOwnerList(rookie, gameState);
        gameState.board[lr][lc] = rookie;
        if (caster.owner === 'player1') {
            gameState.player1BenchHeroIds = (gameState.player1BenchHeroIds ?? []).filter(id => id !== pick);
        } else {
            gameState.player2BenchHeroIds = (gameState.player2BenchHeroIds ?? []).filter(id => id !== pick);
        }
        if (stacks > 0) {
            // 印月要盖住替身真正能动手的那两拍：登场当回合只入座不行动，
            // 三回合的月座窗口里它才有两次行动，增益不能比窗口先到期
            EffectManager.addEffect(rookie, {
                type: 'buff', name: '印月增伤', duration: 3, value: 0.1 * stacks,
                sourceHeroId: caster.id, description: `镜影${stacks}层映入其身：攻击提升${stacks * 10}%`,
            });
            EffectManager.addEffect(rookie, {
                type: 'buff', name: '印月免伤', duration: 3, value: 0.1 * stacks,
                sourceHeroId: caster.id, description: `镜影${stacks}层映入其身：防御提升${stacks * 10}%`,
            });
        }
        output.log.push(`${caster.name}推镜让身：${rookie.name}踏月登场${stacks > 0 ? `，携${stacks}层镜影凝成的印月` : ''}`);

        // 下场：暂死留编制、不占死亡计数；镜影随印月清空，原位留下月座
        const oldPos: Position = [cr, cc];
        gameState.board[cr][cc] = null;
        caster.counters['__jinghua_return_hp'] = caster.currentHp;
        caster.currentHp = 0;
        caster.state = HeroState.TEMP_DEAD;
        caster.position = null;
        caster.counters['__jinghua_offboard'] = 1;
        caster.counters['镜影'] = 0;
        const effects = gameState.boardEffects ?? [];
        effects.push({
            id: `moon-seat-${caster.id}-${Date.now()}`,
            type: 'moon-seat',
            position: oldPos,
            owner: caster.owner,
            sourceHeroId: caster.id,
            // 三回合窗口：替身登场当回合只入座，之后才有两拍可动手
            duration: 3,
        });
        gameState.boardEffects = effects;
        output.log.push(`${caster.name}退入月座，静候有人踏月而来`);
        output.fxCoveredPositions = [oldPos, landing];
        return output;
    },
};

export const jinghuaPassiveInfo = {
    id: 'jinghua_passive',
    name: '镜湖双照',
    description: '友方每次移动都可以不消耗移动力选择与镜花·水月或其「水月」交换位置：每次交换为镜花叠1层镜影（上限5层）。镜影：每层提升10%闪避与10%攻击',
};

// ============================================================================
// 花弄影：身影互召，行动末影子重演这一击
// ============================================================================

const HNY_FAN_DAMAGE = 6;       // 技能1「花间辞」扇形三格（致知2 → 7）
const HNY_LAND_DAMAGE = 8;      // 技能2「弄影」落点周圈斩（致知3 → 9）

/** 花弄影自己的两记斩击按致知抬一档；影子的重演沿用原系数，不跟着放大 */
const hnyFanDamage = (caster: Hero) => zhizhiValue(caster, 2, HNY_FAN_DAMAGE, HNY_FAN_DAMAGE + 1);
const hnyLandDamage = (caster: Hero) => zhizhiValue(caster, 3, HNY_LAND_DAMAGE, HNY_LAND_DAMAGE + 1);
const HNY_REPLAY_FAN = 3;       // 重演·花间辞：影子在影格同方向再挥扇形
const HNY_REPLAY_LAND = 4;      // 重演·弄影：影子在自身周围补一圈
const HNY_TIANWEI_RATIO = 0.7;  // 天威追加重演的折减

function pushHnyLog(gameState: GameState, player: Player, message: string): void {
    gameState.battleLog?.push({
        id: nextBattleLogId(),
        type: 'skill',
        player,
        message,
        timestamp: Date.now(),
    });
}

function hnyEnemiesInCells(cells: Position[], gameState: GameState, caster: Hero): Hero[] {
    return cells
        .map(([row, col]) => gameState.board[row]?.[col])
        .filter((unit): unit is Hero =>
            !!unit && unit.owner !== caster.owner && unit.state === HeroState.ALIVE);
}

/** 中心的正交四格（弄影的落点斩与影子的周圈重演共用） */
function hnyRingCells(center: Position): Position[] {
    const [row, col] = center;
    return ([[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]] as Position[])
        .filter(([r, c]) => r >= 0 && r < 6 && c >= 0 && c < 6);
}

/**
 * 影子重演的形态：花间辞→影格沿同方向再挥扇形；其余（弄影）→影格环身周圈斩。
 * 结算与 AI 估值共用这一份定义，避免两边对"重演打哪几格"各算各的。
 */
export function getHnyReplayForm(
    shadowPos: Position, lastAttack: number, lastDir: number
): { cells: Position[]; damage: number } {
    const fanForm = lastAttack === 1 && lastDir >= 0;
    return {
        cells: fanForm ? getHnyFanPositions(shadowPos, lastDir) : hnyRingCells(shadowPos),
        damage: fanForm ? HNY_REPLAY_FAN : HNY_REPLAY_LAND,
    };
}

/** 由点击的相邻格推导挥斩方向（0上1下2左3右）；点击不是正交邻格时返回 null */
function hnyDirFromClick(from: Position, clicked: Position | null): number | null {
    if (!clicked) return null;
    const dr = clicked[0] - from[0];
    const dc = clicked[1] - from[1];
    if (dr === 0 && dc === 0) return null;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return null;
    return dr === -1 ? 0 : dr === 1 ? 1 : dc === -1 ? 2 : 3;
}

/**
 * 放置/刷新影子：场上至多一朵。duration 2 = 跨过下一整轮，
 * 在「再下一轮开始」时才被通用衰减抹掉——正好覆盖她下一次行动结束时的重演。
 */
function placeHnyShadow(hanying: Hero, gameState: GameState, cell: Position): void {
    const effects = (gameState.boardEffects ?? []).filter(
        effect => !(effect.type === 'shadow-mark' && effect.owner === hanying.owner)
    );
    effects.push({
        id: `shadow-mark-${hanying.id}-${Date.now()}`,
        type: 'shadow-mark',
        position: [...cell] as Position,
        owner: hanying.owner,
        sourceHeroId: hanying.id,
        duration: 2,
    });
    gameState.boardEffects = effects;
}

/**
 * 影子重演她最后一次攻击动作：
 * 花间辞→影子在影格沿同方向再挥一记扇形；弄影→影子环身补一圈斩。
 * 重演算她的攻击（吃增伤/吸血/和声），但不产影、不再触发天威追加（in_replay 守卫）。
 */
function performHnyReplay(hanying: Hero, gameState: GameState, multiplier: number): void {
    const shadow = findHnyShadow(gameState, hanying.owner);
    const lastAttack = hanying.counters['__hny_last_attack'] ?? 0;
    if (!shadow || lastAttack <= 0) return;

    const dirCode = hanying.counters['__hny_last_dir'] ?? -1;
    const form = getHnyReplayForm(shadow.position, lastAttack, dirCode);
    const damage = Math.max(1, Math.round(form.damage * multiplier));
    const targets = hnyEnemiesInCells(form.cells, gameState, hanying);

    hanying.counters['__hny_in_replay'] = 1;
    try {
        for (const target of targets) {
            if (target.state !== HeroState.ALIVE) continue;
            damageOne(hanying, target, damage, gameState, true);
        }
    } finally {
        hanying.counters['__hny_in_replay'] = 0;
    }

    const fanForm = lastAttack === 1 && dirCode >= 0;
    const formName = fanForm ? '花间辞' : '周圈一斩';
    const replayLogIdsBefore = new Set(gameState.battleLog.map(log => log.id));
    if (targets.length === 0) {
        pushHnyLog(gameState, hanying.owner, `${hanying.name}的影子举起刀，只斩了个空`);
    } else {
        pushHnyLog(gameState, hanying.owner,
            `${hanying.name}的影子在月下落${formName}，${targets.length}名敌人各受${damage}点`);
    }
    const replayDelta: Position = dirCode === 0 ? [-1, 0]
        : dirCode === 1 ? [1, 0]
            : dirCode === 2 ? [0, -1]
                : dirCode === 3 ? [0, 1]
                    : [0, 0];
    const replayFront: Position = [
        shadow.position[0] + replayDelta[0],
        shadow.position[1] + replayDelta[1],
    ];
    const replayTarget = fanForm && replayFront[0] >= 0 && replayFront[0] < 6
        && replayFront[1] >= 0 && replayFront[1] < 6
        ? replayFront
        : shadow.position;
    requestSkillFx({
        skillId: 'huanongying_replay',
        owner: hanying.owner,
        fromPos: [...shadow.position] as Position,
        targetPos: [...replayTarget] as Position,
        impactPositions: form.cells.filter(([r, c]) => gameState.board[r]?.[c]),
        logIds: gameState.battleLog.filter(log => !replayLogIdsBefore.has(log.id)).map(log => log.id),
    }, gameState);
}

/** 被动「弄影」重演段：她行动结束时，影子重演本动作的最后一击（随后消耗重演额度） */
export function resolveHnyReplay(hero: Hero, gameState: GameState): void {
    if (hero.passiveId !== 'huanongying_passive') return;
    if (hero.state !== HeroState.ALIVE || !hero.position) return;
    if ((hero.counters['__hny_last_attack'] ?? 0) <= 0) return;
    performHnyReplay(hero, gameState, 1);
    hero.counters['__hny_last_attack'] = 0;
    hero.counters['__hny_last_dir'] = -1;
}

/** 天威「花谢影不落」：她击杀时立刻追加一次70%重演；重演中的击杀不再连锁 */
export function huanongyingTianweiExecute(hero: Hero, gameState: GameState): void {
    if (hero.state !== HeroState.ALIVE) return;
    if ((hero.counters['__hny_in_replay'] ?? 0) === 1) return;
    if ((hero.counters['__hny_last_attack'] ?? 0) <= 0) return;
    if (!findHnyShadow(gameState, hero.owner)) return;
    pushHnyLog(gameState, hero.owner, `${hero.name}天威·花谢影不落，影子抢在行动末之前再舞了一回`);
    performHnyReplay(hero, gameState, HNY_TIANWEI_RATIO);
}

/** 花弄影阵亡/离场时抹掉她的影子，不留无主残墨 */
export function purgeHnyShadow(hero: Hero, gameState: GameState): void {
    if (hero.passiveId !== 'huanongying_passive') return;
    const before = (gameState.boardEffects ?? []).length;
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(
        effect => !(effect.type === 'shadow-mark' && effect.sourceHeroId === hero.id)
    );
    if ((gameState.boardEffects?.length ?? 0) !== before) {
        pushHnyLog(gameState, hero.owner, `${hero.name}身陨，地上的影子跟着淡去了`);
    }
}

/** 技能1「花间辞」：扇形三格挥斩6点，把影子甩到最后一个被斩中的格子 */
export const huanongyingSkill1: Skill = {
    id: 'huanongying_skill1',
    name: '花间辞',
    type: 'damage',
    description: '向身前锋形三格（左前/正前/右前）挥斩6点，并把影子甩到最后一个被斩中的格子（全部落空则落在正前格）；影子存续两回合，行动末影子会沿同一方向在影格再挥一记扇形（3点）',
    rangeType: 'cross',
    range: 1,
    targetType: 'any',
    targetCount: 'all',
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('花弄影没有立足之地');
        const stagedDir = caster.counters['__hny_dir'];
        const dirCode = stagedDir !== undefined && stagedDir >= 0
            ? stagedDir
            : hnyDirFromClick(caster.position, encodedTarget(caster));
        if (dirCode === null) return fail('请点击她身旁的方向格决定挥斩朝向');

        const fanCells = getHnyFanPositions(caster.position, dirCode);
        const enemies = hnyEnemiesInCells(fanCells, gameState, caster);
        // 影子落点：扫描序里最后一个被斩中的格子；全空则正前格（扇形索引1）
        const shadowCell = enemies.length > 0
            ? (fanCells.filter(cell =>
                enemies.some(enemy => enemy.position &&
                    enemy.position[0] === cell[0] && enemy.position[1] === cell[1]))
                .pop() ?? fanCells[1] ?? fanCells[0])
            : fanCells[1] ?? fanCells[0];
        if (!shadowCell) return fail('身前没有格子可以落影');

        const output = result();
        caster.counters['__hny_last_attack'] = 1;
        caster.counters['__hny_last_dir'] = dirCode;
        placeHnyShadow(caster, gameState, shadowCell);

        const fanDamage = hnyFanDamage(caster);
        for (const enemy of enemies) {
            if (enemy.state !== HeroState.ALIVE) continue;
            damageOne(caster, enemy, fanDamage, gameState, true);
        }
        if (enemies.length === 0) {
            output.log.push(`${caster.name}一记花间辞斩向空处，影子悄悄落到${shadowCell[0] + 1}行${shadowCell[1] + 1}列`);
        } else {
            output.log.push(`${caster.name}花间辞扇形挥斩，${enemies.length}名敌人各受${fanDamage}点，影子甩向敌阵`);
        }
        output.fxCoveredPositions = fanCells;
        return output;
    },
};

/** 技能2「弄影」：与影子互换位置（位移），落地瞬间斩击周身正交敌人8点 */
export const huanongyingSkill2: Skill = {
    id: 'huanongying_skill2',
    name: '弄影',
    type: 'damage',
    description: '与场上的影子互换位置（视为位移，不触发移动类效果），落地瞬间对相邻敌人各斩8点；影子留在她出发的那格，行动末会环身补一圈4点斩',
    rangeType: 'single',
    range: 6,
    targetType: 'self',
    targetCount: 1,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('花弄影没有立足之地');
        const shadow = findHnyShadow(gameState, caster.owner);
        if (!shadow) return fail('场上没有她的影子——先用花间辞把影子甩出去');
        const [oldR, oldC] = caster.position;
        const [newR, newC] = shadow.position;
        if (oldR === newR && oldC === newC) return fail('她与影子本就同格，无需互换');
        if (gameState.board[newR][newC]) return fail('影子上站着别人，换不进去');

        const output = result();
        // 身影互换：身体落进影格，影子回到她的出发格等待行动末的周圈重演
        gameState.board[oldR][oldC] = null;
        gameState.board[newR][newC] = caster;
        caster.position = [newR, newC];
        shadow.position = [oldR, oldC];
        // 与惊鸿绕后同口径：位移算一次正常移动，之后不能再步行
        caster.hasMovedThisTurn = true;
        caster.counters['__hny_last_attack'] = 2;
        caster.counters['__hny_last_dir'] = -1;

        // 视觉轴必须是真实的旧位→影位。技能本身以 self 触发，若不显式上报，
        // store 只能拿到点击自身的零距离坐标，花瓣轨迹和落位绽放都会叠在旧位。
        gameState.skillFxExtras = {
            ...gameState.skillFxExtras,
            fromPos: [oldR, oldC],
            targetPos: [newR, newC],
        };

        const landDamage = hnyLandDamage(caster);
        const enemies = hnyEnemiesInCells(hnyRingCells(caster.position), gameState, caster);
        for (const enemy of enemies) {
            if (enemy.state !== HeroState.ALIVE) continue;
            damageOne(caster, enemy, landDamage, gameState, true);
        }
        output.log.push(enemies.length > 0
            ? `${caster.name}与影子换身，落地一斩扫中${enemies.length}名敌人（${landDamage}点）`
            : `${caster.name}与影子换身，落地时身旁空无一人`);
        output.fxCoveredPositions = [[oldR, oldC], [newR, newC]];
        return output;
    },
};

export const huanongyingPassiveInfo = {
    id: 'huanongying_passive',
    name: '花间一舞',
    description: '她每次出手都会在影子身上留下招式记忆：行动结束时，影子在她的影格重演最后一次攻击（花间辞→同向扇形3点；弄影→环身周圈斩4点）。重演算作她的攻击，但不会再次触发天威',
};

export const huanongyingTianweiInfo = {
    id: 'huanongying_tianwei',
    name: '花谢影不落',
    description: '她击杀敌人时，影子立刻按七折追加一次重演；重演造成的击杀不再连锁',
};

/* ============================================================
   折光：光路折射 · 角度杀（生命42 / 移动力3 / 化识）
   光棱只认她自己布下的：技能一钉棱、被动撒棱、天威铺棱；
   技能二的光束沿八向射出，每经过一枚自己的棱就顺时针换轴 90°，
   整条光束还自带一次撞边镜面反射——摆棱就是摆角度。
   ============================================================ */

/** 光棱的持续回合数：回合开始统一递减，3 = 跨过三轮 */
export const ZHIGUANG_PRISM_DURATION = 3;
/** 技能一「凝光为棱」伤害 */
export const ZHIGUANG_MARK_DAMAGE = 8;
/** 技能二「棱光千折」基础伤害与每枚棱的追加伤害 */
export const ZHIGUANG_BEAM_BASE_DAMAGE = 6;
export const ZHIGUANG_BEAM_PER_PRISM_DAMAGE = 2;
/** 天威「万华镜」铺棱时的伤害 */
export const ZHIGUANG_TIANWEI_DAMAGE = 4;
/** 光束最多走过的格数：棱每枚只折一次、边缘反射只有一次，正常路径远不到此，纯防意外 */
const ZHIGUANG_BEAM_MAX_CELLS = BOARD_SIZE * BOARD_SIZE;

/** 八向增量：0=北 1=东北 2=东 3=东南 4=南 5=西南 6=西 7=西北（顺时针，与方向格同序） */
export const ZHIGUANG_DIRECTION_DELTAS: ReadonlyArray<readonly [number, number]> = [
    [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1],
];

/** 折射 = 方向换轴转 90°。顺时针优先：东→南→西→北，东北→东南→西南→西北 */
function refractZhiguangClockwise([dr, dc]: readonly [number, number]): [number, number] {
    return [dc, -dr];
}

/**
 * 光棱把光折向"还能走的那一边"：顺时针优先，顺时针那一头正对棋盘边缘时改用逆时针。
 * 否则会出现"光走到有棱的边缘格、棱确实折了、却把光折进墙里当场断掉"——
 * 光棱的职责是把光折出去，不是把光折进墙。两侧都出界（棱在角落）时仍按顺时针返回，
 * 交给外层的撞边反射/终止规则处理。
 */
function refractZhiguangAtPrism(
    [dr, dc]: readonly [number, number], row: number, col: number
): [number, number] {
    const clockwise = refractZhiguangClockwise([dr, dc]);
    const counterClockwise: [number, number] = [-dc, dr];
    if (isZhiguangInside(row + clockwise[0], col + clockwise[1])) return clockwise;
    if (isZhiguangInside(row + counterClockwise[0], col + counterClockwise[1])) return counterClockwise;
    return clockwise;
}

function isZhiguangInside(row: number, col: number): boolean {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** 撞边镜面反射：越界的那个分量取反；正对角落时两分量一起反，即原路返回 */
function reflectZhiguangDirection(
    [dr, dc]: readonly [number, number], blockedRow: boolean, blockedCol: boolean
): [number, number] {
    return [blockedRow ? -dr : dr, blockedCol ? -dc : dc];
}

let zhiguangPrismSeq = 0;

/** 场上属于某一位折光的光棱：镜像对局里两边的棱互不相干，只认自己布下的 */
export function getZhiguangPrisms(
    hero: Hero, gameState: Pick<GameState, 'boardEffects'>
): BoardEffect[] {
    return (gameState.boardEffects ?? []).filter(effect =>
        effect.type === 'light-prism' && effect.sourceHeroId === hero.id);
}

/** 在指定格钉下一枚光棱；同格已有她的棱时只把持续回合刷回去，不叠第二枚。返回是否新钉了一枚 */
export function placeZhiguangPrism(hero: Hero, gameState: GameState, position: Position): boolean {
    // 致知3：光棱存续 3 → 4 回合
    const prismDuration = zhizhiValue(hero, 3, ZHIGUANG_PRISM_DURATION, ZHIGUANG_PRISM_DURATION + 1);
    const effects = gameState.boardEffects ??= [];
    const existing = effects.find(effect =>
        effect.type === 'light-prism' && effect.sourceHeroId === hero.id &&
        effect.position[0] === position[0] && effect.position[1] === position[1]);
    if (existing) {
        existing.duration = prismDuration;
        return false;
    }
    effects.push({
        id: `light-prism-${hero.id}-${position[0]}-${position[1]}-${++zhiguangPrismSeq}`,
        type: 'light-prism',
        position: [...position] as Position,
        owner: hero.owner,
        sourceHeroId: hero.id,
        duration: prismDuration,
    });
    return true;
}

/** 一次光束的完整轨迹：走过的格子（不含她脚下起点、按行进顺序）与她扫过的光棱枚数 */
export interface ZhiguangBeamTrace {
    cells: Position[];
    prismCount: number;
}

/**
 * 描出技能二的光路：逐格向前推，经过自己的棱就换轴折 90°（一枚棱只折一次，
 * 免得光束在两枚棱之间来回打转），并且折向"还能走出去的那一边"（顺时针优先）；
 * 撞上棋盘边缘时镜面反射一次再继续，反射额度用完还出界就散。
 */
export function traceZhiguangBeam(
    hero: Hero, gameState: Pick<GameState, 'boardEffects'>, directionCode: number
): ZhiguangBeamTrace {
    if (!hero.position) return { cells: [], prismCount: 0 };
    const prisms = new Set(getZhiguangPrisms(hero, gameState)
        .map(effect => `${effect.position[0]},${effect.position[1]}`));
    const touched = new Set<string>();
    let [dr, dc] = ZHIGUANG_DIRECTION_DELTAS[directionCode] ?? ZHIGUANG_DIRECTION_DELTAS[0];
    let row = hero.position[0];
    let col = hero.position[1];
    let bounceLeft = 1;
    const cells: Position[] = [];
    while (cells.length < ZHIGUANG_BEAM_MAX_CELLS) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (!isZhiguangInside(nextRow, nextCol)) {
            if (bounceLeft === 0) break;
            bounceLeft = 0;
            [dr, dc] = reflectZhiguangDirection([dr, dc],
                nextRow < 0 || nextRow >= BOARD_SIZE, nextCol < 0 || nextCol >= BOARD_SIZE);
            continue;
        }
        row = nextRow;
        col = nextCol;
        cells.push([row, col]);
        const key = `${row},${col}`;
        if (!prisms.has(key)) continue;
        touched.add(key);
        prisms.delete(key);                       // 一枚棱只折一次
        [dr, dc] = refractZhiguangAtPrism([dr, dc], row, col);
    }
    return { cells, prismCount: touched.size };
}

/** 光束伤害：基础 6 点（致知2 → 8），加上她扫过的每枚光棱各 2 点 */
export function getZhiguangBeamDamage(caster: Hero, prismCount: number): number {
    return zhizhiValue(caster, 2, ZHIGUANG_BEAM_BASE_DAMAGE, ZHIGUANG_BEAM_BASE_DAMAGE + 2)
        + prismCount * ZHIGUANG_BEAM_PER_PRISM_DAMAGE;
}

function zhiguangEnemiesOn(cells: Position[], caster: Hero, gameState: GameState): Hero[] {
    const seen = new Set<string>();
    const enemies: Hero[] = [];
    for (const [row, col] of cells) {
        const hero = gameState.board[row]?.[col];
        if (!hero || hero.owner === caster.owner || hero.state !== HeroState.ALIVE) continue;
        // 按格子去重：撞边折回来的光会再压过同一格，同一个人不该被结算两次。
        // 不能按英雄 id 去重——同一毫秒造出的两个同名单位会共用一个 id
        const key = `${row},${col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        enemies.push(hero);
    }
    return enemies;
}

function pushZhiguangTianweiLog(gameState: GameState, player: Player, message: string): void {
    gameState.battleLog?.push({
        id: nextBattleLogId(),
        type: 'tianwei',
        player,
        message,
        timestamp: Date.now(),
    });
}

export const zhiguangSkill1: Skill = {
    id: 'zhiguang_skill1',
    name: '凝光为棱',
    type: 'damage',
    description: '选择 5×5 范围内的一名敌人，造成8点伤害，并在它所在的那一格钉下一枚「光棱」（持续3回合，同格再放只刷新）',
    rangeType: 'single',
    range: 2,
    targetType: 'enemy',
    targetCount: 1,
    baseDamage: ZHIGUANG_MARK_DAMAGE,
    canCrit: true,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target?.position) return fail('折光没有锁定目标');
        // 先记下格子再结算：把人打死之后位置会被清掉，棱仍要落在那一格（打格子不打身份）
        const cell = [...target.position] as Position;
        const output = result();
        const hit = damageOne(caster, target, ZHIGUANG_MARK_DAMAGE, gameState);
        output.damageDealt?.push(hit.finalDamage);
        output.fxCoveredPositions = [cell];
        const placed = placeZhiguangPrism(caster, gameState, cell);
        output.log.push(placed
            ? `${caster.name}凝光为棱，${target.name}受到${hit.finalDamage}点伤害，(${cell[0] + 1},${cell[1] + 1})亮起一枚光棱`
            : `${caster.name}凝光为棱，${target.name}受到${hit.finalDamage}点伤害，那一格的光棱重新亮起`);
        return output;
    },
};

export const zhiguangSkill2: Skill = {
    id: 'zhiguang_skill2',
    name: '棱光千折',
    type: 'damage',
    description: '朝八个方向之一射出光束，对路径上所有敌人造成（6+扫过的光棱数×2）点伤害；光束每经过一枚自己的光棱就换轴折 90°（折向还能走出去的那一边，顺时针优先），整条光束另有一次触碰棋盘边缘的镜面反射',
    rangeType: 'line',
    range: 6,
    targetType: 'any',
    targetCount: 'all',
    baseDamage: ZHIGUANG_BEAM_BASE_DAMAGE,
    canCrit: true,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('折光尚未部署');
        const dirCode = caster.counters['__zhiguang_skill2_dir'];
        if (dirCode === undefined) return fail('请先点击身旁的方向格，决定光束射向哪一边');
        delete caster.counters['__zhiguang_skill2_dir'];

        const { cells, prismCount } = traceZhiguangBeam(caster, gameState, dirCode);
        const damage = getZhiguangBeamDamage(caster, prismCount);
        const enemies = zhiguangEnemiesOn(cells, caster, gameState);
        const output = result();
        output.fxCoveredPositions = cells;

        DamageCalculator.asOneAttack(() => {
            for (const enemy of enemies) {
                const hit = damageOne(caster, enemy, damage, gameState, true);
                output.damageDealt?.push(hit.finalDamage);
                output.log.push(`${caster.name}的棱光千折扫过${enemy.name}，造成${hit.finalDamage}点伤害`);
            }
        });
        const pathNote = prismCount > 0 ? `借${prismCount}枚光棱折射` : '未借到光棱';
        if (enemies.length === 0) {
            output.log.push(`${caster.name}射出棱光千折，${pathNote}，只穿过一片空处`);
        } else {
            output.log.unshift(
                `${caster.name}射出棱光千折，${pathNote}，斩中${enemies.length}人各${damage}点伤害`
            );
        }
        return output;
    },
};

/**
 * 天威「万华镜」的合法落点：场上任意空格，外加她自己脚下那一格（等于原地展开）。
 * 与 game-store 里"跃向任意空格"类挂起的高亮口径保持一致。
 */
export function getZhiguangTianweiLandings(
    hero: Hero, gameState: Pick<GameState, 'board'>
): Position[] {
    if (!hero.position) return [];
    const landings: Position[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const occupant = gameState.board[row]?.[col];
            if (!occupant || occupant.id === hero.id) landings.push([row, col]);
        }
    }
    return landings;
}

/**
 * 击杀触发的天威入口：挂起玩家手选落点。
 * 槽位已被别的挂起占住、或场上没有可落的格子时直接返回 false（这次天威作废，行动照常放行），
 * 绝不留下无人可解的挂起。
 */
export function requestZhiguangTianweiLanding(hero: Hero, gameState: GameState): boolean {
    if (hero.state !== HeroState.ALIVE || !hero.position) return false;
    if ((hero.counters['__zhiguang_tianwei_resolving'] ?? 0) === 1) return false;
    if (gameState.pendingBoardAction) return false;
    if (getZhiguangTianweiLandings(hero, gameState).length === 0) return false;
    gameState.pendingBoardAction = { type: 'zhiguang-tianwei', heroId: hero.id };
    pushZhiguangTianweiLog(gameState, hero.owner,
        `${hero.name}触发天威·万华镜：请选择她降落的位置，落点周围 5×5 的敌人都会被钉上光棱`);
    return true;
}

/**
 * 万华镜结算：瞬移到落点，再以新位置为中心，在 5×5 范围内每名敌人所在的格各钉一枚光棱并造成4点伤害。
 * 瞬移是天威自带的降落，不按普通位移结算移动连带伤害。
 */
export function castZhiguangKaleidoscope(
    caster: Hero, gameState: GameState, landing: Position
): SkillExecuteResult {
    if (!caster.position) return fail('折光尚未部署');
    if ((caster.counters['__zhiguang_tianwei_resolving'] ?? 0) === 1) return fail('万华镜正在展开');
    const output = result();
    const origin = [...caster.position] as Position;

    caster.counters['__zhiguang_tianwei_resolving'] = 1;
    try {
        if (origin[0] !== landing[0] || origin[1] !== landing[1]) {
            if (gameState.board[landing[0]][landing[1]]) return fail('万华镜只能降落在空格');
            gameState.board[origin[0]][origin[1]] = null;
            gameState.board[landing[0]][landing[1]] = caster;
            caster.position = [...landing] as Position;
            syncPositionAnchoredEffects(gameState);
        }

        const cells = MovementSystem.getBoxPositions(landing, 5);
        const enemies = zhiguangEnemiesOn(cells, caster, gameState);
        DamageCalculator.asOneAttack(() => {
            for (const enemy of enemies) {
                if (!enemy.position) continue;
                placeZhiguangPrism(caster, gameState, [...enemy.position] as Position);
                const hit = damageOne(caster, enemy, ZHIGUANG_TIANWEI_DAMAGE, gameState, true);
                output.damageDealt?.push(hit.finalDamage);
            }
        });
        const zhiguangLogIdsBefore = new Set(gameState.battleLog.map(log => log.id));
        pushZhiguangTianweiLog(gameState, caster.owner, enemies.length > 0
            ? `${caster.name}天威·万华镜，落到(${landing[0] + 1},${landing[1] + 1})铺开${enemies.length}枚光棱并造成${ZHIGUANG_TIANWEI_DAMAGE}点伤害`
            : `${caster.name}天威·万华镜，落到(${landing[0] + 1},${landing[1] + 1})，四周没有可照的敌人`);
        requestSkillFx({
            skillId: 'zhiguang_tianwei',
            owner: caster.owner,
            fromPos: origin,
            targetPos: [...landing] as Position,
            impactPositions: enemies.filter(enemy => enemy.position)
                .map(enemy => [...enemy.position!] as Position),
            logIds: gameState.battleLog.filter(log => !zhiguangLogIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
        if (enemies.length > 0) {
            output.log.push(`${caster.name}的万华镜照向${enemies.map(enemy => enemy.name).join('、')}`);
        }
    } finally {
        delete caster.counters['__zhiguang_tianwei_resolving'];
    }
    return output;
}

/** 电脑与兜底放行用的自动落点：5×5 内能照到最多敌人的一格，同分取更近的 */
export function pickZhiguangTianweiLanding(
    hero: Hero, gameState: GameState
): Position | null {
    if (hero.state !== HeroState.ALIVE || !hero.position) return null;
    const landings = getZhiguangTianweiLandings(hero, gameState);
    let best: Position | null = null;
    let bestScore = 0;
    let bestSteps = BOARD_SIZE * 2;
    for (const landing of landings) {
        const struck = zhiguangEnemiesOn(MovementSystem.getBoxPositions(landing, 5), hero, gameState).length;
        if (struck === 0) continue;
        const steps = Math.max(
            Math.abs(landing[0] - hero.position[0]),
            Math.abs(landing[1] - hero.position[1])
        );
        if (struck > bestScore || (struck === bestScore && steps < bestSteps)) {
            best = landing;
            bestScore = struck;
            bestSteps = steps;
        }
    }
    return best;
}

/** 被动「拾光」：每回合开始时在随机空格撒下一枚光棱，由 game-engine 的回合开始流程调用 */
export function placeZhiguangPassivePrism(hero: Hero, gameState: GameState): Position | null {
    if (hero.state !== HeroState.ALIVE) return null;
    const taken = new Set((gameState.boardEffects ?? [])
        .filter(effect => effect.type === 'light-prism')
        .map(effect => `${effect.position[0]},${effect.position[1]}`));
    const candidates: Position[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if (gameState.board[row][col] || taken.has(`${row},${col}`)) continue;
            candidates.push([row, col]);
        }
    }
    if (candidates.length === 0) return null;
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    placeZhiguangPrism(hero, gameState, picked);
    return picked;
}

/**
 * 折光阵亡：她布下的光棱一并碎掉。光棱只认她本人（技能二才借它折射与增伤），
 * 她不在场了却留一堆无主的棱在棋盘上，既没有归属也没有作用，只会误导判断。
 * 返回清掉的枚数。
 */
export function purgeZhiguangPrisms(hero: Hero, gameState: GameState): number {
    if (hero.passiveId !== 'zhiguang_passive') return 0;
    const before = (gameState.boardEffects ?? []).length;
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect =>
        !(effect.type === 'light-prism' && effect.sourceHeroId === hero.id));
    const removed = before - (gameState.boardEffects?.length ?? 0);
    if (removed > 0) {
        gameState.battleLog?.push({
            id: nextBattleLogId(),
            type: 'passive',
            player: hero.owner,
            message: `${hero.name}身陨，场上${removed}枚光棱随之碎散`,
            timestamp: Date.now(),
        });
    }
    return removed;
}

export const zhiguangPassiveInfo = {
    id: 'zhiguang_passive',
    name: '拾光',
    description: '每回合开始时，折光在场上一处随机空格撒下一枚「光棱」（持续3回合）。光棱只属于她：她的光束经过时会换轴折射一次并追加2点伤害；她阵亡时场上所有光棱随之碎散',
};

export const zhiguangTianweiInfo = {
    id: 'zhiguang_tianwei',
    name: '万华镜',
    description: '折光击杀敌人时触发：由玩家选择她降落的空格，落点后以她为中心展开 5×5 光界，范围内每名敌人所在的格各钉下一枚光棱并造成4点伤害',
};

/**
 * 纸鸢·技能一「收线·回风」：不需要选目标，她拽线，5×5 内所有被线轴牵住的敌人一起被拖回来。
 * 带线轴的人吃（4+线轴×2），线轴飞回她手上的那条轨迹上的其他人吃（2+线轴×2），
 * 被攻击到的都挂 1 层羽化——她的位移与队友的击退都能把羽化炸开。
 */
export const zhiyuanSkill1: Skill = {
    id: 'zhiyuan_skill1',
    name: '收线·回风',
    type: 'damage',
    description: '收回自身5×5范围内的所有「线轴」：带线轴的敌人受到（4+线轴×2）点伤害，线轴飞回纸鸢的直线轨迹上的敌人受到（2+线轴×2）点伤害；被攻击到的敌人各施加1层羽化',
    rangeType: 'single',
    range: 0,
    targetType: 'self',
    targetCount: 1,
    scalesWithAttack: false,
    canCrit: true,
    // 只作 AI 估值与预览用：本技能走自定义 execute，引擎不会按它再打一遍
    baseDamage: ZHIYUAN_REEL_BASE,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('纸鸢不在场上');
        const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
        const box = MovementSystem.getBoxPositions(caster.position, 5);
        const inRange = (hero: Hero) => hero.position
            && box.some(([row, col]) => row === hero.position![0] && col === hero.position![1]);
        const bearing = spoolBearingEnemies(gameState, caster).filter(inRange);
        if (bearing.length === 0) return fail('5×5内没有被线轴牵住的敌人');

        const output = result();
        const attacked: Hero[] = [];
        const impact: Position[] = [];
        const origin: Position = [...caster.position] as Position;
        // 一次施放命中多人 = 一次出手：包成同一个攻击组，纸鸢的追击与"每3次出手附带击飞"
        // 才按"一次"计，而不是每个被刮到的人各算一手
        DamageCalculator.asOneAttack(() => {
            for (const enemy of bearing) {
                const stacks = getSpoolStacks(enemy, caster.id);
                output.damageDealt?.push(damageOne(caster, enemy, ZHIYUAN_REEL_BASE + stacks * 2, gameState, true).finalDamage);
                attacked.push(enemy);
                impact.push([...enemy.position!] as Position);
                // 线轴沿直线飞回纸鸢：途中格子上的敌人被线刮到
                for (const cell of spoolTravelCells(enemy.position!, origin)) {
                    const rider = gameState.board[cell[0]]?.[cell[1]];
                    if (!rider || rider.owner === caster.owner || rider.state !== HeroState.ALIVE) continue;
                    if (attacked.includes(rider)) continue;
                    output.damageDealt?.push(damageOne(caster, rider, ZHIYUAN_PATH_BASE + stacks * 2, gameState, true).finalDamage);
                    attacked.push(rider);
                    impact.push(cell);
                }
                removeSpools(enemy, caster.id);
            }
        });
        for (const hero of attacked) zhiyuanFeather(hero, caster);
        output.log.push(`${caster.name}收线，牵动${bearing.length}处线轴，刮中${attacked.length}名敌人`);
        // 方向是"从敌人身上收回到她自己"：起手格取离她最远的那名带线轴敌人（线最长、最看得见），
        // 落点是她脚下。反过来画就成了她朝敌人射线。
        const reelFrom = bearing.reduce((farthest, hero) => (
            Math.abs(farthest.position![0] - origin[0]) + Math.abs(farthest.position![1] - origin[1])
                <= Math.abs(hero.position![0] - origin[0]) + Math.abs(hero.position![1] - origin[1])
                ? hero : farthest
        ), bearing[0]);
        requestSkillFx({
            skillId: 'zhiyuan_skill1',
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: [...reelFrom.position!] as Position,
            targetPos: [...origin] as Position,
            impactPositions: impact,
            damagePositions: impact,
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
        return output;
    },
};

/**
 * 纸鸢·技能二「断线·冲天」：把全场线轴一次烧光换连击，每 3 层一次、最多 4 次，
 * 全部打在选定的那一名敌人身上；斩完她自己被反作用力带得倒退一格（朝攻击反方向）。
 * 线轴不足 3 层时不放出去——否则就是白烧掉队友辛苦攒下的线。
 */
export const zhiyuanSkill2: Skill = {
    id: 'zhiyuan_skill2',
    name: '断线·冲天',
    type: 'damage',
    description: '消耗场上所有敌人身上的全部线轴：至少造成一段6点伤害，线轴每满3层额外增加一段（最多4段）；随后纸鸢朝攻击的相反方向退一格',
    rangeType: 'area',
    range: 2,
    areaSize: 5,
    targetType: 'enemy',
    targetCount: 1,
    scalesWithAttack: false,
    canCrit: true,
    // 同技能一：只供 AI 估值与范围预览，实际伤害由 execute 按连击段数结算
    baseDamage: ZHIYUAN_COMBO_DAMAGE,
    execute: (caster, targets, gameState) => {
        if (!caster.position) return fail('纸鸢不在场上');
        const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
        const target = targets.find(candidate =>
            candidate.owner !== caster.owner && candidate.state === HeroState.ALIVE && candidate.position);
        if (!target?.position) return fail('请选择纸鸢5×5范围内的一名敌人');
        const total = spoolBearingEnemies(gameState, caster)
            .reduce((sum, hero) => sum + getSpoolStacks(hero, caster.id), 0);
        // 保底一段：线轴只是"每满 3 层多送一段"，没攒到 3 层也照样能断线，不至于放不出手
        const combos = Math.min(ZHIYUAN_COMBO_MAX, 1 + Math.floor(total / ZHIYUAN_COMBO_PER_STACKS));
        for (const hero of spoolBearingEnemies(gameState, caster)) removeSpools(hero, caster.id);

        const output = result();
        const damage = zhiyuanComboDamage(caster);
        let landed = 0;
        // 整段连击算"一次出手"：追击只跟一发，击飞计数也只推进一格
        DamageCalculator.asOneAttack(() => {
            for (let index = 0; index < combos; index++) {
                if (target.state !== HeroState.ALIVE) break;
                output.damageDealt?.push(damageOne(caster, target, damage, gameState, false).finalDamage);
                landed++;
            }
        });
        output.log.push(`${caster.name}断线冲天，${total}层线轴换来${landed}段连击`);

        // 反作用退一格：朝"攻击方向的反方向"，被占或到边就站着不动（不惩罚玩家选贴身位）
        const back: Position = [
            caster.position[0] + Math.sign(caster.position[0] - target.position[0]),
            caster.position[1] + Math.sign(caster.position[1] - target.position[1]),
        ];
        const stepped = MovementSystem.inBounds(back) && !gameState.board[back[0]][back[1]]
            && MovementSystem.moveHero(caster, back, gameState, undefined, { skillMovement: true });
        if (stepped) output.log.push(`${caster.name}被反作用力带回(${back[0] + 1},${back[1] + 1})`);

        requestSkillFx({
            skillId: 'zhiyuan_skill2',
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: stepped ? [...back] as Position : [...caster.position] as Position,
            targetPos: [...target.position] as Position,
            impactPositions: [[...target.position] as Position],
            damagePositions: [[...target.position] as Position],
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
        return output;
    },
};

/* ============================================================
   夺岁 —— 「血偿」延迟还血 / 「禁血」治疗封窗 / 「血诏」下一次攻击
   ============================================================ */

/** 一次魔斩之后目标欠下的两笔还血，在随后两轮开始时各还一笔 */
export const XUECHANG_EFFECT = '血偿';
export const XUECHANG_TICKS = 2;
export const XUECHANG_TICK_RATE = 0.2;
/**
 * 血偿标记要撑到"两轮开始各还一笔"：效果时长在每轮结束时减一，
 * 挂上那轮 + 两个还血轮 = 3 拍，少一拍就会在第二笔还血前自己消失。
 */
const XUECHANG_DURATION = XUECHANG_TICKS + 1;
/** 被夺岁打中的这一整轮，目标一滴血都回不了（禁血只封当轮，不会吞掉血偿的还血） */
export const JINXUE_EFFECT = '禁血';
/** 天威「血诏」：击杀后攒着，下一次攻击一并砍出去 */
export const DUOSUI_TIANWEI_EFFECT = '血诏';
const DUOSUI_SLASH_CURRENT_HP_RATE = 0.5;
const DUOSUI_RECKON_BASE = 5;
const DUOSUI_RECKON_MISSING_RATE = 0.25;
const DUOSUI_TIANWEI_MAX_HP_RATE = 0.2;

/**
 * 挂上或刷新「血偿」。
 * 后一发魔斩覆盖前一发：技能二取的是"目标身上那份血偿"，
 * 允许并存就得再定一次"取哪一份"的规则，不如直接只记最新一笔。
 */
export function applyXuechang(target: Hero, damageDealt: number, casterId: string, roundNumber: number): void {
    const perTick = Math.max(1, Math.floor(damageDealt * XUECHANG_TICK_RATE));
    removeXuechang(target);
    EffectManager.addEffect(target, {
        type: 'debuff',
        name: XUECHANG_EFFECT,
        duration: XUECHANG_DURATION,
        value: perTick * XUECHANG_TICKS,
        sourceHeroId: casterId,
        description: `接下来两轮开始时，各返还${perTick}点生命`,
    });
    target.counters = { ...(target.counters ?? {}) };
    target.counters['__xuechang_amount'] = perTick;
    target.counters['__xuechang_ticks'] = XUECHANG_TICKS;
    target.counters['__xuechang_next_round'] = roundNumber + 1;
}

function removeXuechang(target: Hero): void {
    EffectManager.removeEffectByName(target, XUECHANG_EFFECT);
    delete target.counters['__xuechang_amount'];
    delete target.counters['__xuechang_ticks'];
    delete target.counters['__xuechang_next_round'];
}

/** 血偿还没还完的总量：技能二把它整份收来当护盾 */
export function xuechangPending(target: Hero): number {
    const ticks = target.counters['__xuechang_ticks'] ?? 0;
    const perTick = target.counters['__xuechang_amount'] ?? 0;
    return ticks > 0 ? ticks * perTick : 0;
}

/**
 * 回合开始结算一笔血偿。
 * 按"轮次戳"而不是"每轮减一"来放血：目标被眩晕、被跳过、被换位都不影响还血节奏，
 * 而延迟段在引擎内部结算，也拿不到效果时长衰减的那一拍。
 * @returns 本次实际还了多少
 */
export function settleXuechangAtTurnStart(hero: Hero, gameState: GameState): number {
    if (hero.state !== HeroState.ALIVE) return 0;
    const ticks = hero.counters['__xuechang_ticks'] ?? 0;
    const nextRound = hero.counters['__xuechang_next_round'] ?? 0;
    if (ticks <= 0 || nextRound === 0 || gameState.roundNumber < nextRound) return 0;

    const perTick = hero.counters['__xuechang_amount'] ?? 0;
    const healed = DamageCalculator.applyHeal(hero, perTick, gameState, hero);
    const remaining = ticks - 1;
    if (remaining <= 0 || healed <= 0) {
        removeXuechang(hero);
        if (remaining > 0 && healed <= 0) {
            // 满血时 applyHeal 回 0：血偿不是"存着下次一起还"，还不上就当场结清
            EffectManager.removeEffectByName(hero, XUECHANG_EFFECT);
        }
    } else {
        hero.counters['__xuechang_ticks'] = remaining;
        hero.counters['__xuechang_next_round'] = nextRound + 1;
        const effect = hero.effects.find(item => item.name === XUECHANG_EFFECT);
        if (effect) effect.value = remaining * perTick;
    }
    return healed;
}

/** 天威「血诏」的领取：击杀时挂上，跨回合留存，直到下一次攻击把它砍出去 */
export function grantDuosuiTianwei(hero: Hero): void {
    hero.counters = { ...(hero.counters ?? {}) };
    hero.counters['__duosui_tianwei'] = 1;
    if (!hero.effects.some(effect => effect.name === DUOSUI_TIANWEI_EFFECT)) {
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: DUOSUI_TIANWEI_EFFECT,
            duration: -1,
            sourceHeroId: hero.id,
            description: '下一次攻击额外附加目标最大生命值20%的伤害',
        });
    }
}

/**
 * 天威「血诏」的消耗：附加的是**目标**最大生命，所以要在知道打谁之后才算。
 * 只在真正出手的调用点消耗——伤害预览与 AI 估伤也会走 calculate，
 * 挂在那里面会把攒着的天威白白烧掉一次。
 */
function consumeDuosuiTianwei(caster: Hero, target: Hero): number {
    if (caster.counters['__duosui_tianwei'] !== 1) return 0;
    caster.counters['__duosui_tianwei'] = 0;
    EffectManager.removeEffectByName(caster, DUOSUI_TIANWEI_EFFECT);
    const rate = zhizhiValue(caster, 2, DUOSUI_TIANWEI_MAX_HP_RATE, 0.3);
    return Math.max(1, Math.floor(target.maxHp * rate));
}

export const duosuiSkill1: Skill = {
    id: 'duosui_skill1',
    name: '斩岁',
    type: 'damage',
    description: '对周围3×3内一名敌人造成其当前生命值50%的真实伤害，并施加「血偿」：随后两轮开始时各返还本次伤害20%的生命',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    scalesWithAttack: false,
    ignoreDefense: true,
    canCrit: false,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target || target.state !== HeroState.ALIVE) return fail(`${caster.name}的斩岁没有找到目标`);

        const output = result();
        const tianwei = consumeDuosuiTianwei(caster, target);
        const raw = Math.max(1, Math.floor(target.currentHp * DUOSUI_SLASH_CURRENT_HP_RATE)) + tianwei;
        const damage = DamageCalculator.calculate(caster, target, raw, false, true, { canCrit: false });
        DamageCalculator.applyDamage(target, damage, caster, gameState);
        output.damageDealt?.push(damage.finalDamage);
        output.log.push(
            `${caster.name}斩岁落下，取走${target.name}${damage.finalDamage}点寿数${damage.isCrit ? '（暴击）' : ''}`
        );

        if (target.state !== HeroState.ALIVE) return output;

        applyXuechang(target, damage.finalDamage, caster.id, gameState.roundNumber);
        // 禁血只管被砍中的这一轮：血偿的两笔还血落在之后两轮开始，两者天然不撞车
        EffectManager.addEffect(target, {
            type: 'debuff',
            name: JINXUE_EFFECT,
            duration: 1,
            sourceHeroId: caster.id,
            description: '本回合内无法恢复生命',
        });
        output.effectsApplied?.push(...target.effects.filter(
            effect => effect.name === XUECHANG_EFFECT || effect.name === JINXUE_EFFECT
        ));
        output.log.push(`${target.name}被刻上血偿，本回合禁血`);
        return output;
    },
};

export const duosuiSkill2: Skill = {
    id: 'duosui_skill2',
    name: '偿岁',
    type: 'damage',
    description: '攻击周围3×3内一名敌人，造成5点加目标已损生命25%的伤害；若目标带「血偿」，把它还没还完的那份收作自身护盾',
    rangeType: 'area',
    range: 1,
    areaSize: 3,
    targetType: 'enemy',
    targetCount: 1,
    scalesWithAttack: false,
    canCrit: true,
    execute: (caster, targets, gameState) => {
        const target = targets[0];
        if (!target || target.state !== HeroState.ALIVE) return fail(`${caster.name}的偿岁没有找到目标`);

        const output = result();
        const missingRate = zhizhiValue(caster, 3, DUOSUI_RECKON_MISSING_RATE, 0.4);
        const missing = Math.max(0, target.maxHp - target.currentHp);
        const tianwei = consumeDuosuiTianwei(caster, target);
        // 护盾取"出手那一刻"目标欠着的血偿：这一刀把债主砍死，账仍然算数
        const debt = xuechangPending(target);
        const raw = DUOSUI_RECKON_BASE + Math.floor(missing * missingRate) + tianwei;
        const damage = DamageCalculator.calculate(caster, target, raw);
        DamageCalculator.applyDamage(target, damage, caster, gameState);
        output.damageDealt?.push(damage.finalDamage);
        output.log.push(
            `${caster.name}偿岁追讨${target.name}，造成${damage.finalDamage}点伤害${damage.isCrit ? '（暴击）' : ''}`
        );

        if (debt > 0 && caster.state === HeroState.ALIVE) {
            EffectManager.addShield(caster, debt);
            output.log.push(`${caster.name}收回${target.name}欠下的${debt}点血偿，化作护盾`);
        }
        return output;
    },
};

/**
 * 羲和：把一片友方的"百分比血量"抹平，从富的人身上抽走的那部分记作「盈光」。
 * 盈光只涨不跌（只保留历史上最大的一次交换量），技能二按它照人一回，溢出转护盾。
 */
export const XIHUAN_LEVEL_RANGE = 2;
/** 均光的残血补量：每名"低于自身最大生命50%"的友方各多吃一口（致知二 6 → 8） */
export const XIHUAN_LOW_HEAL = 6;
export const XIHUAN_LOW_HEAL_TALENT = 8;
export const XIHUAN_PASSIVE_HEAL = 5;
/** 玩家可见的资源计数器（中文键会自动进状态面板，见 hero-status-presentation） */
export const XIHUAN_SURPLUS_KEY = '盈光';

/** 以羲和为圆心、左右上下各 2 格的十字（含她自己脚下） */
function xihuanCrossCells(center: Position): Position[] {
    const cells: Position[] = [[center[0], center[1]]];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        for (let step = 1; step <= XIHUAN_LEVEL_RANGE; step++) {
            const cell: Position = [center[0] + dr * step, center[1] + dc * step];
            if (MovementSystem.inBounds(cell)) cells.push(cell);
        }
    }
    return cells;
}

/** 站在格子上的存活友方（只认棋盘上真实的那个人，避免幽灵单位） */
function alliesOnCells(hero: Hero, cells: Position[], gameState: GameState): Hero[] {
    const wanted = new Set(cells.map(([row, col]) => `${row},${col}`));
    const list = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    return list.filter(ally => ally.state === HeroState.ALIVE && ally.position
        && wanted.has(`${ally.position[0]},${ally.position[1]}`)
        && gameState.board[ally.position[0]]?.[ally.position[1]]?.id === ally.id);
}

/** 我方百分比血量最低的角色（含羲和自己），并列时取名单靠前的 */
function lowestRatioAlly(hero: Hero, gameState: GameState): Hero | null {
    const list = (hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes)
        .filter(ally => ally.state === HeroState.ALIVE && ally.maxHp > 0);
    let lowest: Hero | null = null;
    let lowestRatio = Infinity;
    for (const ally of list) {
        const ratio = ally.currentHp / ally.maxHp;
        if (ratio < lowestRatio) { lowestRatio = ratio; lowest = ally; }
    }
    return lowest;
}

/**
 * 技能一「均光」：把十字 2 格内所有友方（含自己）的百分比血量拉平到同一档。
 * 拉平后掉血的人，掉下来的生命合计记作本次交换量；盈光只保留最大值。
 * 拉平前每有一名"低于自己最大生命 50%"的友方，拉平后再各补 5 点（致知二抬到 6）。
 * 拉平不算伤害也不算治疗来源：它是"把血挪平"，所以不掉盾、不触发受击链，也绝不把人压到 0。
 */
export const xihuanSkill1: Skill = {
    id: 'xihuan_skill1',
    name: '均光',
    type: 'heal',
    description: '拉平自身两格十字范围内所有友方（包括自己）的百分比血量；拉平前每有一名低于自身最大生命50%的友方，拉平后再为其恢复6点生命。本次从友方身上抽走的生命总量记为「盈光」，盈光只保留最大值',
    rangeType: 'single',
    range: 0,
    targetType: 'self',
    targetCount: 1,
    scalesWithAttack: false,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('羲和不在场上');
        const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
        const allies = alliesOnCells(caster, xihuanCrossCells(caster.position), gameState);
        if (allies.length < 2) return fail('十字两格内需要至少另一名友方才能均光');
        const wounded = allies.filter(ally => ally.currentHp < ally.maxHp * 0.5);

        const averageRatio = allies.reduce((sum, ally) => sum + ally.currentHp / ally.maxHp, 0) / allies.length;
        let drained = 0;
        for (const ally of allies) {
            const leveled = Math.max(1, Math.min(ally.maxHp, Math.round(averageRatio * ally.maxHp)));
            if (leveled < ally.currentHp) drained += ally.currentHp - leveled;
            ally.currentHp = leveled;
        }
        // 残血的人再各吃一口：拉平只是挪血，救急的这 6 点才是她的治疗量
        const extra = zhizhiValue(caster, 2, XIHUAN_LOW_HEAL, XIHUAN_LOW_HEAL_TALENT);
        let boosted = 0;
        for (const ally of wounded) boosted += DamageCalculator.applyHeal(ally, extra, gameState, caster);

        const surplus = Math.max(caster.counters[XIHUAN_SURPLUS_KEY] ?? 0, drained);
        caster.counters[XIHUAN_SURPLUS_KEY] = surplus;

        const output = result([
            `${caster.name}均分曦光，${allies.length}名友方血量拉平至${Math.round(averageRatio * 100)}%`,
            drained > 0 ? `抽走${drained}点生命凝为盈光（盈光${surplus}）` : `本次无人被抽走生命，盈光仍为${surplus}`,
            boosted > 0 ? `${wounded.length}名残血友方各额外恢复${extra}点` : '',
        ].filter(Boolean));
        output.healingDone?.push(boosted);

        gameState.battleLog?.push({
            id: nextBattleLogId(),
            type: 'heal',
            player: caster.owner,
            message: output.log.join('；'),
            timestamp: Date.now(),
        });
        requestSkillFx({
            skillId: 'xihuan_skill1',
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: [...caster.position] as Position,
            targetPos: [...(allies.find(ally => ally.id !== caster.id)?.position ?? caster.position)] as Position,
            impactPositions: allies.filter(ally => ally.position).map(ally => [...ally.position!] as Position),
            softImpactPositions: wounded.filter(ally => ally.position).map(ally => [...ally.position!] as Position),
            damagePositions: [],
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
        return output;
    },
};

/**
 * 技能二「盈照」：把盈光整份照给场上任意一名友方（全场不限距离），
 * 溢出的生命凝成护盾。盈光不消耗——它是她"最多一次性挪动过多大一口血"的记录。
 */
export const xihuanSkill2: Skill = {
    id: 'xihuan_skill2',
    name: '盈照',
    type: 'heal',
    description: '为场上一名友方角色（不限距离）恢复「盈光」点生命，溢出的血量化为护盾',
    rangeType: '全场',
    range: 9,
    targetType: 'ally',
    targetCount: 1,
    scalesWithAttack: false,
    execute: (caster, targets, gameState) => {
        const target = targets.find(candidate =>
            candidate.owner === caster.owner && candidate.state === HeroState.ALIVE);
        if (!target) return fail('请选择一名友方角色');
        const surplus = caster.counters[XIHUAN_SURPLUS_KEY] ?? 0;
        if (surplus <= 0) return fail('还没有交换过血量，盈光是空的');
        const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));

        const healed = DamageCalculator.applyHeal(target, surplus, gameState, caster);
        const overflow = Math.max(0, surplus - healed);
        if (overflow > 0) target.shield += overflow;

        const output = result([
            `${caster.name}以盈光照向${target.name}：恢复${healed}点` +
                (overflow > 0 ? `，溢出${overflow}点凝为护盾` : ''),
        ]);
        output.healingDone?.push(healed);

        gameState.battleLog?.push({
            id: nextBattleLogId(),
            type: 'heal',
            player: caster.owner,
            message: output.log[0],
            timestamp: Date.now(),
            details: { targetHeroId: target.id, sourceHeroId: caster.id },
        });
        requestSkillFx({
            skillId: 'xihuan_skill2',
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: [...(caster.position ?? target.position!)] as Position,
            targetPos: [...target.position!] as Position,
            impactPositions: [[...target.position!] as Position],
            softImpactPositions: [[...target.position!] as Position],
            damagePositions: [],
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
        return output;
    },
};

/** 被动「回晖」：每回合末，我方百分比血量最低的角色（含她自己）恢复 5 点（致知三抬到 6） */
export function resolveXihuanBlessing(hero: Hero, gameState: GameState): void {
    if (hero.passiveId !== 'xihuan_passive' || hero.state !== HeroState.ALIVE) return;
    const target = lowestRatioAlly(hero, gameState);
    if (!target) return;
    const amount = zhizhiValue(hero, 3, XIHUAN_PASSIVE_HEAL, XIHUAN_PASSIVE_HEAL + 1);
    const healed = DamageCalculator.applyHeal(target, amount, gameState, hero);
    if (healed <= 0) return;
    const logId = nextBattleLogId();
    gameState.battleLog?.push({
        id: logId,
        type: 'passive',
        player: hero.owner,
        message: `${hero.name}的回晖照向${target.name}，恢复${healed}点生命`,
        timestamp: Date.now(),
    });
    if (target.position) {
        requestSkillFx({
            skillId: 'xihuan_passive',
            owner: hero.owner,
            sourceHeroId: hero.id,
            fromPos: [...(hero.position ?? target.position)] as Position,
            targetPos: [...target.position] as Position,
            impactPositions: [[...target.position] as Position],
            softImpactPositions: [[...target.position] as Position],
            damagePositions: [],
            logIds: [logId],
        }, gameState);
    }
}

/* ============================================================
   姜太公 —— 「水泽」环境 / 「鱼钩」陷阱 / 上钩抛掷
   ============================================================ */

/**
 * 姜太公·技能一「钓雪」：在自身 5×5 内挑一格空水下钩，下钩当场把鱼钩周围 3×3 泡成水泽。
 * 钩子本身不痛，痛的是上钩之后——敌人一踩就当场钩住，由他亲手把这个人丢到场上任意空格
 * （结算在 game-store 的挂起分支里）。钩子可以一直没人踩，那片水泽照样先立两回合。
 */
export const jiangtaigongSkill1: Skill = {
    id: 'jiangtaigong_skill1',
    name: '钓雪',
    type: 'special',
    description: '在自身5×5范围内的一格空水下钩（持续三回合，场上至多三枚），并当场在鱼钩周围铺开3×3水泽（持续两回合）：敌方经过那一格即刻上钩，鱼钩消失，随后把上钩者抛到场上任意空格并造成10点伤害',
    rangeType: 'area',
    range: 2,
    areaSize: 5,
    targetType: 'empty',
    targetCount: 1,
    canCrit: false,
    execute: (caster, _targets, gameState) => {
        if (!caster.position) return fail('姜太公不在场上');
        const cell = encodedTarget(caster);
        if (!cell) return fail('请选择下钩的位置');
        if (!MovementSystem.getBoxPositions(caster.position, 5).some(([row, col]) => row === cell[0] && col === cell[1])) {
            return fail('只能在自己周围5×5范围内下钩');
        }
        if (gameState.board[cell[0]][cell[1]]) return fail('鱼钩要沉进水底，不能下在别人脚下');
        if (findHookAt(gameState, cell)) return fail('那一格已经挂着一枚鱼钩');

        const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
        placeHook(gameState, caster, cell);
        // 下钩当场就把鱼钩周围 3×3 泡成水泽：钩子可以无人问津，这片地先立起来
        const marsh = placeMarsh(gameState, caster, cell);
        // 叙述只写进战斗日志一份：联机对端要靠这条日志当锚点重建画面，
        // 只填 output.log 的话本次施法新日志为空，钩子落水的表现只有出手方看得见
        gameState.battleLog?.push({
            id: nextBattleLogId(),
            type: 'skill',
            player: caster.owner,
            message: `${caster.name}在(${cell[0] + 1},${cell[1] + 1})下钩并漫开一片水泽，三回合内等人上钩`,
            timestamp: Date.now(),
        });
        const output = result();
        output.fxCoveredPositions = marsh ? marshCells(marsh) : [cell];
        // 用了技能就算出手：站在自己铺的泽里丢一竿，也在往鲸落的概率上加档
        rollWhaleFall(gameState, caster);
        requestSkillFx({
            skillId: 'jiangtaigong_skill1',
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: [...caster.position] as Position,
            targetPos: [...cell] as Position,
            impactPositions: [[...cell] as Position],
            coveredPositions: marsh ? marshCells(marsh) : [[...cell] as Position],
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
        return output;
    },
};

/**
 * 姜太公·技能二「渭水垂竿」：沿八条射线把两格内的敌人硬拽到自己身边。
 * 拽人本身不造成伤害，价值全在"把人摆进自己脚边的水泽里"——
 * 途中撞到鱼钩照样当场钩住（抛掷挂起在这一下拖完之后才轮到玩家点）。
 */
export const jiangtaigongSkill2: Skill = {
    id: 'jiangtaigong_skill2',
    name: '渭水垂竿',
    type: 'control',
    description: '沿八个方向把两格内的一名敌人强行拖到自己身边（途中撞到鱼钩会当场钩住），并在自己周围铺开一片5×5水泽',
    rangeType: 'single',
    range: 2,
    targetType: 'enemy',
    targetCount: 1,
    canCrit: false,
    execute: (caster, targets, gameState) => {
        if (!caster.position) return fail('姜太公不在场上');
        const target = targets.find(candidate =>
            candidate.owner !== caster.owner && candidate.state === HeroState.ALIVE && candidate.position);
        if (!target?.position) return fail('请选择八方向两格内的一名敌人');
        const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
        const origin: Position = [...target.position] as Position;
        const stepRow = Math.sign(caster.position[0] - origin[0]);
        const stepCol = Math.sign(caster.position[1] - origin[1]);

        let current: Position = [...origin] as Position;
        let pulled = 0;
        while (pulled < BOARD_SIZE) {
            const next: Position = [current[0] + stepRow, current[1] + stepCol];
            if (!MovementSystem.inBounds(next)) break;
            if (next[0] === caster.position[0] && next[1] === caster.position[1]) break;   // 已经贴到身边
            if (gameState.board[next[0]][next[1]]) break;                                  // 被别的单位挡住
            gameState.board[current[0]][current[1]] = null;
            gameState.board[next[0]][next[1]] = target;
            target.position = [...next] as Position;
            current = [...next] as Position;
            pulled++;
            triggerHookBite(gameState, target, current);
        }

        const output = result();
        // 同技能一：叙述写进战斗日志，才有一条可挂特效锚点的新日志
        const narrate = (message: string) => gameState.battleLog?.push({
            id: nextBattleLogId(),
            type: 'skill',
            player: caster.owner,
            message,
            timestamp: Date.now(),
        });
        if (pulled > 0) {
            narrate(`${caster.name}垂竿把${target.name}从(${origin[0] + 1},${origin[1] + 1})拖到(${current[0] + 1},${current[1] + 1})`);
            // 拖拽是姜太公这侧造成的位移：羽化按归属方记账，且要在人已经落定之后结算
            DamageCalculator.applyDilanMovementDamage(target, pulled, gameState, caster.owner);
        } else {
            narrate(`${caster.name}甩空了竿——${target.name}被挡住，一步都没被拖过来`);
        }
        const marsh = placeMarsh(gameState, caster, [...caster.position] as Position, MARSH_SKILL2_RADIUS);
        const zone = marsh ? marshCells(marsh) : [];
        narrate(`${caster.name}脚边漫开一片五乘五的水泽，我方在其中更善闪避`);
        output.fxCoveredPositions = zone;
        // 泽刚铺在脚下，这一竿本身也要算一次出手（放在铺完之后掷，才吃得到自己这片泽）
        rollWhaleFall(gameState, caster);
        requestSkillFx({
            skillId: 'jiangtaigong_skill2',
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: origin,
            targetPos: [...caster.position] as Position,
            impactPositions: [[...caster.position] as Position],
            coveredPositions: zone,
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
        return output;
    },
};

export const EXTENDED_SKILLS: Record<string, Skill> = {
    jiangtaigong_skill1: jiangtaigongSkill1,
    jiangtaigong_skill2: jiangtaigongSkill2,
    xihuan_skill1: xihuanSkill1,
    xihuan_skill2: xihuanSkill2,
    zhiyuan_skill1: zhiyuanSkill1,
    zhiyuan_skill2: zhiyuanSkill2,
    wangshu_skill1: wangshuSkill1,
    wangshu_skill2: wangshuSkill2,
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
    nanfeng_skill1: nanfengSkill1,
    nanfeng_skill2: nanfengSkill2,
    shangguan_skill1: shangguanSkill1,
    shangguan_skill2: shangguanSkill2,
    chenyuan_skill1: chenyuanSkill1,
    chenyuan_skill2: chenyuanSkill2,
    dai_skill1: daiSkill1,
    dai_skill2: daiSkill2,
    youjun_skill1: youjunSkill1,
    youjun_skill2: youjunSkill2,
    xubai_skill1: xubaiSkill1,
    xubai_skill2: xubaiSkill2,
    lingxi_skill1: lingxiSkill1,
    lingxi_skill2: lingxiSkill2,
    xueqi_skill1: xueqiSkill1,
    xueqi_skill2: xueqiSkill2,
    yunying_skill1: yunyingSkill1,
    yunying_skill2: yunyingSkill2,
    jinghong_skill1: jinghongSkill1,
    jinghong_skill2: jinghongSkill2,
    jinghua_skill1: jinghuaSkill1,
    jinghua_skill2: jinghuaSkill2,
    huanongying_skill1: huanongyingSkill1,
    huanongying_skill2: huanongyingSkill2,
    zhiguang_skill1: zhiguangSkill1,
    zhiguang_skill2: zhiguangSkill2,
    duosui_skill1: duosuiSkill1,
    duosui_skill2: duosuiSkill2,
};
