import { Hero, DamageResult, GameState, HeroState, BattleLogEntry } from '../types/game';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import {
    moranPassive,
    zhenxiaoPassive,
    liuliPassive,
    mowenPassive,
    moranTianwei,
    zhenxiaoTianwei,
    wukongPassive,
    wukongTianwei,
    nightowlTianwei,
    mirrorTianwei,
    mowenTianwei,
    guyingPassive,
    guyingTianwei,
    hanjiangxueTianwei,
    huifengTianwei,
    changliTianwei,
    getMirrorOwnerIdFromCloneId
} from '../data/heroes';
import { findSoulLampBeneficiary } from '../data/extended-heroes';

/**
 * 伤害计算系统
 */
export class DamageCalculator {
    private static getWukongOwnerIdFromCloneId(cloneId: string): string | null {
        const parts = cloneId.split('|');
        if (parts.length < 3) return null;
        if (parts[0] !== 'wukong-clone') return null;
        return parts[1] || null;
    }

    private static syncWukongCritToSelfAndClones(wukong: Hero, gameState: GameState): void {
        const lingxi = wukong.counters['灵犀'] ?? 0;
        const critRate = Math.min(1, 0.2 + lingxi * 0.2);

        wukong.effects = wukong.effects.filter(e => e.name !== '悟空暴击率');
        wukong.effects.push({
            id: `effect-${Date.now()}-${Math.random()}`,
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
                if (!h.counters || h.counters['__isClone'] !== 1) continue;
                if (this.getWukongOwnerIdFromCloneId(h.id) !== wukong.id) continue;

                h.effects = h.effects.filter(e => e.name !== '悟空暴击率');
                h.effects.push({
                    id: `effect-${Date.now()}-${Math.random()}`,
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

    static triggerMirrorBrokenBlade(hero: Hero, gameState: GameState): void {
        if (hero.state !== HeroState.ALIVE) return;
        if (hero.passiveId !== 'mirror_passive') return;
        if (!hero.position) return;

        while (EffectManager.getCounter(hero, '破镜之刃') > 0) {
            const origins: [number, number][] = [hero.position];
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 6; c++) {
                    const h = gameState.board[r][c];
                    if (!h || h.state !== HeroState.ALIVE) continue;
                    if (h.counters?.['__isClone'] !== 1) continue;
                    if (getMirrorOwnerIdFromCloneId(h.id) !== hero.id) continue;
                    if (h.position) origins.push(h.position);
                }
            }

            const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;

            let target: Hero | null = null;
            let minHp = Infinity;

            for (const enemy of enemies) {
                if (enemy.state !== HeroState.ALIVE || !enemy.position) continue;
                let inRange = false;
                for (const origin of origins) {
                    if (MovementSystem.isInRange(origin, enemy.position, 2)) {
                        inRange = true;
                        break;
                    }
                }
                if (!inRange) continue;

                if (enemy.currentHp < minHp) {
                    minHp = enemy.currentHp;
                    target = enemy;
                }
            }

            if (!target) return;

            EffectManager.addCounter(hero, '破镜之刃', -1);
            const damageResult = this.calculate(hero, target, 5, false);
            this.applyDamage(target, damageResult, hero, gameState);

            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'passive' as const,
                    player: hero.owner,
                    message: `${hero.name}触发"破镜之刃"，对${target.name}造成${damageResult.finalDamage}点伤害`,
                    timestamp: Date.now()
                });
            }
        }
    }

    /**
     * 计算最终伤害
     * @param attacker 攻击者
     * @param target 目标
     * @param baseDamage 基础伤害
     * @param scalesWithAttack 是否受基础攻击力加成
     * @param gameState 游戏状态
     * @returns 伤害结果
     */
    static calculate(
        attacker: Hero,
        target: Hero,
        baseDamage: number,
        scalesWithAttack: boolean = false,
        ignoreDefense: boolean = false
    ): DamageResult {
        let finalDamage = baseDamage;

        // 1. 基础攻击力加成
        if (scalesWithAttack && attacker.baseAttack) {
            // 获取所有攻击力加成（同类相加）
            const attackBonuses = this.getModifiers(attacker, 'attackBonus');
            const totalAttackBonus = attackBonuses.reduce((sum, bonus) => sum + bonus, 0);
            finalDamage += attacker.baseAttack * (1 + totalAttackBonus);
        }

        // 2. 增伤效果（不同类相乘）
        const damageBonuses = this.getModifiers(attacker, 'damageBonus');
        for (const bonus of damageBonuses) {
            finalDamage *= (1 + bonus);
        }
        for (const effect of attacker.effects) {
            if (effect.type === 'debuff' && effect.value !== undefined &&
                (effect.name.includes('攻击降低') || effect.name === '恐惧')) {
                finalDamage *= Math.max(0, 1 - effect.value * (effect.stackCount ?? 1));
            }
        }

        if (target.effects.some(e => e.name === '观测坍缩未受伤')) {
            finalDamage *= 1.5;
            target.effects = target.effects.filter(e => e.name !== '观测坍缩未受伤');
        }

        if (attacker.name === '孤影' && attacker.owner !== target.owner) {
            const hasHantian = target.effects.some(e => e.name === '寒天' && (e.stackCount ?? 1) > 0);
            if (hasHantian) {
                finalDamage *= 1.2;
            }
        }

        // 3. 暴击判定
        let critRate = this.getCritRate(attacker);

        // 夜枭致知1：每潜行一回合，暴击率提升30%
        if (attacker.name === '暗影猎手·夜枭' && attacker.effects.some(e => e.name === '潜行')) {
            if (attacker.counters['talent_1']) {
                const stealthTurns = attacker.counters['stealth_turns'] || 0;
                critRate += stealthTurns * 0.3;
            }
        }

        // 夜枭技能1：对被标记目标的首次攻击必定暴击
        let guaranteedCrit = false;
        if (attacker.name === '暗影猎手·夜枭') {
            const markEffect = target.effects.find(e => e.name === '猎杀标记' && e.sourceHeroId === attacker.id);
            if (markEffect && !attacker.counters['mark_first_hit_consumed']) {
                guaranteedCrit = true;
            }
        }

        const isCrit = guaranteedCrit || Math.random() < critRate;
        if (isCrit) {
            let critDamage = this.getCritDamage(attacker);
            // 夜枭致知3：暴击伤害提升40%
            if (attacker.name === '暗影猎手·夜枭' && attacker.counters['talent_3']) {
                critDamage += 0.4;
            }
            finalDamage *= critDamage; // 基础1.5倍
        }

        // 4. 防御减免
        if (!ignoreDefense) {
            let defense = target.defense;
            for (const effect of target.effects) {
                if (effect.value === undefined) continue;
                if (effect.type === 'buff' &&
                    (effect.name.includes('免伤') || effect.name.includes('防御') || effect.name === '来财')) {
                    defense += effect.value * (effect.stackCount ?? 1);
                }
                if (effect.type === 'debuff' && effect.name.includes('防御降低')) {
                    defense -= effect.value * (effect.stackCount ?? 1);
                }
            }
            
            // 夜枭天威：下次攻击无视目标50%防御
            if (attacker.name === '暗影猎手·夜枭' && attacker.counters['ignore_defense_next']) {
                defense *= 0.5;
            }

            finalDamage *= Math.max(0, 1 - defense);
        }

        // 5. 免伤效果
        const damageReduction = this.getModifiers(target, 'damageReduction');
        for (const reduction of damageReduction) {
            finalDamage *= Math.max(0, 1 - reduction);
        }

        // 冰甲：受到的伤害降低 20%
        if (target.effects.some(e => e.name === '冰甲')) {
            finalDamage *= 0.8;
        }

        // 6. 取整
        finalDamage = Math.floor(Math.max(0, finalDamage));

        // 7. 吸血计算
        const vampireRate = this.getModifiers(attacker, 'vampire').reduce((sum, v) => sum + v, 0);
        const vampireAmount = Math.floor(finalDamage * vampireRate);

        return {
            finalDamage,
            isCrit,
            vampireAmount,
            shieldDamage: 0,
            hpDamage: 0,
            killed: false
        };
    }

    /**
     * 应用伤害到目标
     */
    static applyDamage(
        target: Hero,
        damageResult: DamageResult,
        attacker: Hero,
        gameState: GameState,
        isAreaDamage: boolean = false
    ): void {
        const targetWasAlive = target.state === HeroState.ALIVE;
        if (attacker.owner !== target.owner && damageResult.finalDamage > 0) {
            const allies = attacker.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            if (attacker.passiveId === 't_painting_passive') {
                const summons = allies.filter(hero =>
                    hero.state === HeroState.ALIVE &&
                    hero.counters['__isSummon'] === 1 &&
                    hero.id.split('|')[2] === attacker.id
                ).length;
                damageResult.finalDamage += summons;
            }
        }
        let remainingDamage = damageResult.finalDamage;
        let actualTarget = target;
        let maxEffectiveDamageForKill = (target.currentHp + target.shield);

        if (
            target.passiveId === 'hero_x_passive' &&
            (target.counters['增势'] ?? 0) >= 3 &&
            target.counters['__hero_x_redirecting'] !== 1
        ) {
            const redirectId = gameState.heroXRedirectTargetIds?.[target.id];
            const redirect = redirectId ? this.findHeroById(redirectId, gameState) : null;
            if (redirect?.state === HeroState.ALIVE && redirect.owner === target.owner && redirect.id !== target.id) {
                target.counters['增势'] -= 3;
                target.counters['__hero_x_redirecting'] = 1;
                const redirected = this.calculate(attacker, redirect, Math.floor(remainingDamage * 0.5), false, true);
                this.applyDamage(redirect, redirected, attacker, gameState, isAreaDamage);
                delete target.counters['__hero_x_redirecting'];
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.hpDamage = 0;
            }
        }

        const nightowlStealthed = target.name === '暗影猎手·夜枭' && EffectManager.hasEffect(target, '潜行');
        if (nightowlStealthed) {
            if (!isAreaDamage) {
                damageResult.finalDamage = 0;
                remainingDamage = 0;
            } else {
                const currentRoundDamage = target.counters['stealth_damage_taken'] || 0;
                const maxDamagePerRound = 10;
                const availableDamageQuota = Math.max(0, maxDamagePerRound - currentRoundDamage);

                if (remainingDamage > availableDamageQuota) {
                    remainingDamage = availableDamageQuota;
                    damageResult.finalDamage = remainingDamage;
                }

                target.counters['stealth_damage_taken'] = currentRoundDamage + remainingDamage;
            }
        }

        // 消耗夜枭的天威（无视防御）
        if (attacker.name === '暗影猎手·夜枭' && attacker.counters['ignore_defense_next']) {
            attacker.counters['ignore_defense_next'] = 0;
        }

        // 消耗夜枭的标记必暴
        if (attacker.name === '暗影猎手·夜枭') {
             const markEffect = target.effects.find(e => e.name === '猎杀标记' && e.sourceHeroId === attacker.id);
             if (markEffect && !attacker.counters['mark_first_hit_consumed']) {
                 attacker.counters['mark_first_hit_consumed'] = 1;
             }
        }

        // 0. 检查援护效果（琉璃的技能）
        const guardEffect = target.effects.find(e => e.name === '援护');

        if (guardEffect && guardEffect.sourceHeroId) {
            // 找到援护来源（琉璃）
            const guardianHero = this.findHeroById(guardEffect.sourceHeroId, gameState);

            if (guardianHero && guardianHero.state === HeroState.ALIVE && guardianHero.id !== target.id) {
                // 将伤害转移给琉璃
                actualTarget = guardianHero;
                maxEffectiveDamageForKill = guardianHero.currentHp + guardianHero.shield;

                // 援护效果持续到琉璃下次行动，不在这里移除
                // 会在skill-system.ts的removeGuardEffectsFromLiuli中移除

                // 触发琉璃的被动（增加禅定）
                this.triggerPassiveSkill(guardianHero, 'onAllyDamaged', gameState, {
                    isGuardTrigger: true,
                    originalTarget: target
                });

                // 添加日志
                if (gameState.battleLog) {
                    const logEntry = {
                        id: `log-${Date.now()}-${Math.random()}`,
                        type: 'passive' as const,
                        player: guardianHero.owner,
                        message: `${guardianHero.name}援护${target.name}，承担了${remainingDamage}点伤害`,
                        timestamp: Date.now()
                    };
                    gameState.battleLog.push(logEntry);
                }
            }
        }

        if (
            remainingDamage > 0 &&
            actualTarget.state === HeroState.ALIVE &&
            actualTarget.passiveId === 'mowen_passive' &&
            attacker.owner !== actualTarget.owner
        ) {
            const hpRatio = actualTarget.maxHp > 0 ? actualTarget.currentHp / actualTarget.maxHp : 0;
            const threshold = actualTarget.counters['talent_3'] ? 0.5 : 0.3;
            const chance = hpRatio < threshold ? 0.5 : 0.25;

            if (Math.random() < chance) {
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.shieldDamage = 0;
                damageResult.hpDamage = 0;

                if (gameState.battleLog) {
                    gameState.battleLog.push({
                        id: `log-${Date.now()}-${Math.random()}`,
                        type: 'passive' as const,
                        player: actualTarget.owner,
                        message: `${actualTarget.name}触发时间裂隙，闪避本次伤害`,
                        timestamp: Date.now()
                    });
                }
            }
        }

        // 冰甲：攻击冰甲所有者后，攻击者获得1层寒天（来源为冰甲提供者）
        if (
            remainingDamage > 0 &&
            attacker.state === HeroState.ALIVE &&
            attacker.owner !== actualTarget.owner
        ) {
            const armor = actualTarget.effects.find(e => e.name === '冰甲');
            if (armor?.sourceHeroId) {
                this.applyHantianStacks(attacker, 1, armor.sourceHeroId, gameState);
            }
        }

        const hpBeforeDamage = actualTarget.currentHp;
        if (
            remainingDamage > 0 &&
            actualTarget.passiveId === 'xuanxiao_passive' &&
            actualTarget.counters['xuanxiao_danger_armed'] === 1
        ) {
            const healed = this.applyHeal(actualTarget, remainingDamage, gameState);
            actualTarget.counters['xuanxiao_danger_armed'] = 0;
            actualTarget.counters['xuanxiao_danger_used'] = 1;
            remainingDamage = 0;
            damageResult.finalDamage = 0;
            damageResult.hpDamage = 0;
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}触发化险为夷，将伤害转化为${healed}点治疗`,
                    timestamp: Date.now()
                });
            }
        }

        // 1. 先扣护盾
        if (actualTarget.shield > 0) {
            if (actualTarget.shield >= remainingDamage) {
                damageResult.shieldDamage = remainingDamage;
                actualTarget.shield -= remainingDamage;
                remainingDamage = 0;
            } else {
                damageResult.shieldDamage = actualTarget.shield;
                remainingDamage -= actualTarget.shield;
                actualTarget.shield = 0;
            }
        }

        // 2. 再扣生命
        damageResult.hpDamage = remainingDamage;
        actualTarget.currentHp = Math.max(0, actualTarget.currentHp - remainingDamage);
        const actualHpDamage = Math.min(hpBeforeDamage, Math.max(0, remainingDamage));

        if (actualTarget.passiveId === 'bard_passive' && actualTarget.currentHp < actualTarget.maxHp * 0.4) {
            const allies = actualTarget.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            const passion = allies.reduce((sum, hero) => sum + (hero.counters['激情'] ?? 0), 0);
            if (passion > 0) {
                const healed = this.applyHeal(actualTarget, passion * 3, gameState);
                // 终曲回响：消耗全队激情，重新积攒后才能再次触发
                for (const ally of allies) {
                    ally.counters['激情'] = 0;
                }
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}触发终曲回响，消耗全队${passion}点激情，恢复${healed}点生命`
                });
            }
        }

        if (
            actualTarget.passiveId === 'xuanxiao_passive' &&
            actualTarget.counters['xuanxiao_danger_used'] !== 1 &&
            actualTarget.counters['xuanxiao_danger_armed'] !== 1 &&
            hpBeforeDamage >= 16 &&
            actualTarget.currentHp > 0 &&
            actualTarget.currentHp < 16
        ) {
            actualTarget.counters['xuanxiao_danger_armed'] = 1;
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}进入化险为夷状态`,
                    timestamp: Date.now()
                });
            }
        }

        // 3. 触发被动技能：onDamaged（在死亡之前触发，确保反击等被动能生效）
        if (remainingDamage > 0 && actualTarget.state === HeroState.ALIVE) {
            this.triggerPassiveSkill(actualTarget, 'onDamaged', gameState, { attacker, damage: remainingDamage });
        }

        // 4. 吸血
        if (attacker.counters['jetzmi_shield_conversion_next'] === 1 && damageResult.hpDamage > 0) {
            attacker.shield += Math.floor(damageResult.hpDamage * 0.5);
            attacker.counters['jetzmi_shield_conversion_next'] = 0;
        }
        if (damageResult.vampireAmount > 0) {
            attacker.currentHp = Math.min(
                attacker.maxHp,
                attacker.currentHp + damageResult.vampireAmount
            );
        }

        if (targetWasAlive) {
            const appliedDamage = damageResult.shieldDamage + actualHpDamage;
            const detailParts: string[] = [];
            if (damageResult.isCrit && appliedDamage > 0) detailParts.push('暴击');
            if (damageResult.shieldDamage > 0) detailParts.push(`护盾吸收${damageResult.shieldDamage}`);
            if (actualHpDamage > 0) detailParts.push(`生命-${actualHpDamage}`);
            const detailText = detailParts.length > 0 ? `（${detailParts.join('，')}）` : '';
            this.addBattleLog(gameState, {
                type: 'damage',
                player: attacker.owner,
                message: appliedDamage > 0
                    ? `${attacker.name}对${actualTarget.name}造成${appliedDamage}点伤害${detailText}`
                    : `${attacker.name}对${actualTarget.name}的攻击未造成伤害`,
                details: {
                    kind: 'damage',
                    targetHeroId: actualTarget.id,
                    amount: appliedDamage,
                    isCrit: damageResult.isCrit && appliedDamage > 0,
                    position: actualTarget.position ? [...actualTarget.position] : undefined,
                }
            });
        }

        // 5. 检查是否击杀（在被动技能触发之后）
        if (actualTarget.currentHp <= 0 && actualTarget.state === HeroState.ALIVE) {
            if (attacker.tianweiId === 'mowen_tianwei') {
                attacker.counters['__last_kill_damage'] = Math.min(maxEffectiveDamageForKill, damageResult.finalDamage);
            }
            damageResult.killed = this.handleDeath(actualTarget, attacker, gameState);
        }

        // 扩展英雄的攻击后效果。
        if (remainingDamage > 0 && attacker.state === HeroState.ALIVE) {
            const note = attacker.effects.find(e => e.name === '音符');
            if (note?.sourceHeroId) {
                const pipa = this.findHeroById(note.sourceHeroId, gameState);
                if (pipa?.state === HeroState.ALIVE) {
                    const extra = Math.max(1, Math.floor((pipa.baseAttack ?? 8) * (note.value ?? 0.25)));
                    const extraResult = this.calculate(pipa, actualTarget, extra, false, true);
                    this.applyDamage(actualTarget, extraResult, pipa, gameState, isAreaDamage);
                    EffectManager.addCounter(pipa, '和弦', 1);
                }
            }

            const harmony = attacker.effects.find(e => e.name === '和声');
            if (harmony) this.applyHeal(attacker, harmony.value ?? 5, gameState);

        }
        if (attacker.counters['jetzmi_vampire_next'] === 1) {
            attacker.counters['jetzmi_vampire_next'] = 0;
            EffectManager.removeEffectByName(attacker, '亡灵吸血');
        }

        // 量子纠缠：只传播实际生命伤害，传播伤害本身不会再次传播。
        if (damageResult.hpDamage > 0 && actualTarget.counters['__entangle_propagating'] !== 1) {
            const entangle = actualTarget.effects.find(e => e.name === '量子纠缠' && e.linkId);
            if (entangle?.sourceHeroId) {
                const partner = this.findHeroById(entangle.sourceHeroId, gameState);
                if (partner?.state === HeroState.ALIVE) {
                    partner.counters['__entangle_propagating'] = 1;
                    const shared = this.calculate(attacker, partner, Math.floor(damageResult.hpDamage * 0.5), false, true);
                    this.applyDamage(partner, shared, attacker, gameState, true);
                    delete partner.counters['__entangle_propagating'];
                }
            }
        }

        // 赏金猎人「猎杀令」：友方命中带猎杀令的目标后，猎人追加一次追击。
        // 排除猎人自己作为攻击者（追击本身不再次触发，避免递归）。
        const huntMark = target.effects.find(effect => effect.name === '猎杀令');
        if (huntMark?.sourceHeroId && target.state === HeroState.ALIVE) {
            const hunter = this.findHeroById(huntMark.sourceHeroId, gameState);
            if (hunter && hunter.state === HeroState.ALIVE && hunter.id !== attacker.id && hunter.owner === attacker.owner) {
                const pursuit = this.calculate(hunter, target, 4, false);
                this.applyDamage(target, pursuit, hunter, gameState, false);
            }
        }

        // 6. 触发攻击者被动（onAttack）
        // 在伤害处理和击杀判定之后触发，以便判断是否保持潜行
        if (attacker && attacker.state === HeroState.ALIVE) {
             this.triggerPassiveSkill(attacker, 'onAttack', gameState, { target: actualTarget, killed: damageResult.killed });
        }
    }

    static resolveThreeStackControl(target: Hero, effectName: string, sourceHeroId: string): void {
        const effect = target.effects.find(e => e.name === effectName && e.sourceHeroId === sourceHeroId);
        if (!effect || (effect.stackCount ?? 1) < 3) return;
        target.effects = target.effects.filter(e => e !== effect);
        EffectManager.addEffect(target, {
            type: 'stun',
            name: `${effectName}眩晕`,
            duration: 2,
            sourceHeroId,
            description: '下一次行动被跳过',
        });
    }

    /**
     * 施加寒天层数，累计3层时转为冰冻（与孤影的寒天体系共用）
     */
    static applyHantianStacks(target: Hero, stacks: number, sourceHeroId: string, gameState: GameState): void {
        EffectManager.addEffect(target, {
            type: 'debuff',
            name: '寒天',
            duration: -1,
            stackCount: stacks,
            sourceHeroId,
            description: '累计3层进入冰冻'
        });

        const effect = target.effects.find(e => e.name === '寒天' && e.sourceHeroId === sourceHeroId);
        const total = effect?.stackCount ?? stacks;
        if (total >= 3) {
            target.effects = target.effects.filter(e => e !== effect);
            EffectManager.removeEffectByName(target, '冰冻');
            EffectManager.addEffect(target, {
                type: 'stun',
                name: '冰冻',
                duration: 2,
                sourceHeroId,
                description: '停止行动一回合'
            });
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'passive' as const,
                    player: target.owner,
                    message: `${target.name}寒天叠加至3层，进入冰冻`,
                    timestamp: Date.now()
                });
            }
        } else if (gameState.battleLog) {
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'passive' as const,
                player: target.owner,
                message: `${target.name}获得寒天+${stacks}（当前${total}层）`,
                timestamp: Date.now()
            });
        }
    }

    static forceDeath(target: Hero, killer: Hero, gameState: GameState): boolean {
        if (target.state !== HeroState.ALIVE) return false;
        target.currentHp = 0;
        return this.handleDeath(target, killer, gameState);
    }

    /**
     * 根据ID查找英雄
     */
    private static findHeroById(heroId: string, gameState: GameState): Hero | null {
        // 在棋盘上查找
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                const hero = gameState.board[row][col];
                if (hero && hero.id === heroId) {
                    return hero;
                }
            }
        }

        // 在玩家英雄列表中查找（可能已死亡但仍在列表中）
        for (const hero of gameState.player1Heroes) {
            if (hero.id === heroId) return hero;
        }
        for (const hero of gameState.player2Heroes) {
            if (hero.id === heroId) return hero;
        }

        return null;
    }

    private static addBattleLog(
        gameState: GameState,
        entry: Omit<BattleLogEntry, 'id' | 'timestamp'>
    ): void {
        gameState.battleLog.push({
            ...entry,
            id: `log-${Date.now()}-${Math.random()}`,
            timestamp: Date.now()
        });
        if (gameState.battleLog.length > 200) {
            gameState.battleLog = gameState.battleLog.slice(-200);
        }
    }

    private static resolveBountyRewards(target: Hero, killer: Hero, gameState: GameState): void {
        const bountyEffects = target.effects.filter(effect => {
            if (!effect.name.startsWith('悬赏·') || !effect.sourceHeroId) return false;
            const bountyHunter = this.findHeroById(effect.sourceHeroId, gameState);
            return bountyHunter?.owner === killer.owner;
        });

        if (bountyEffects.length === 0) return;
        target.effects = target.effects.filter(effect => !bountyEffects.includes(effect));

        for (const bounty of bountyEffects) {
            const reward = bounty.value ?? -1;
            let rewardText = bounty.name.replace('悬赏·', '');

            if (reward === 0) {
                if (killer.tianweiId) this.triggerTianwei(killer, gameState);
                rewardText += '：再次触发天威';
            } else if (reward === 1) {
                const healed = this.applyHeal(killer, Math.floor((killer.maxHp - killer.currentHp) * 0.5), gameState);
                rewardText += `：恢复${healed}点生命`;
            } else if (reward === 2) {
                EffectManager.addEffect(killer, {
                    type: 'buff',
                    name: '赏金暴击率',
                    duration: -1,
                    value: 0.5,
                    sourceHeroId: bounty.sourceHeroId,
                    description: '永久提升50%暴击率',
                });
                rewardText += '：永久提升50%暴击率';
            } else if (reward === 3) {
                EffectManager.addEffect(killer, {
                    type: 'buff',
                    name: '赏金吸血',
                    duration: -1,
                    value: 0.3,
                    sourceHeroId: bounty.sourceHeroId,
                    description: '永久提升30%吸血',
                });
                rewardText += '：永久提升30%吸血';
            }

            this.addBattleLog(gameState, {
                type: 'effect',
                player: killer.owner,
                message: `${killer.name}领取${target.name}的${rewardText}`
            });
        }
    }

    /**
     * 触发被动技能
     */
    private static triggerPassiveSkill(
        hero: Hero,
        triggerType: string,
        gameState: GameState,
        context?: any
    ): void {
        // 根据被动ID查找并执行
        if (hero.passiveId === 'moran_passive') {
            if (moranPassive.triggerOn === triggerType) {
                moranPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'zhenxiao_passive') {
            if (zhenxiaoPassive.triggerOn === triggerType) {
                zhenxiaoPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'liuli_passive') {
            if (liuliPassive.triggerOn === triggerType) {
                liuliPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'wukong_passive') {
            if (wukongPassive.triggerOn === triggerType) {
                wukongPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'mowen_passive') {
            if (mowenPassive.triggerOn === triggerType) {
                mowenPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'guying_passive') {
            if (guyingPassive.triggerOn === triggerType) {
                guyingPassive.execute(hero, gameState, context);
            }
        }
        // 可以继续添加其他英雄的被动
    }

    /**
     * 处理英雄死亡
     */
    private static handleDeath(target: Hero, killer: Hero, gameState: GameState): boolean {
        const deathPosition = target.position ? [...target.position] as [number, number] : null;
        if (target.passiveId === 'wither_lord_passive') {
            const lives = target.counters['wither_lives'] ?? 0;
            if (lives > 1) {
                target.counters['wither_lives'] = lives - 1;
                target.currentHp = target.maxHp;
                target.shield = 0;
                return false;
            }
        }

        if (target.counters && target.counters['__isClone'] === 1) {
            target.state = HeroState.DEAD;

            this.addBattleLog(gameState, {
                type: 'kill',
                player: killer.owner,
                message: `${killer.name}击杀了${target.name}`
            });

            if (target.position) {
                const [row, col] = target.position;
                if (gameState.board[row] && gameState.board[row][col] === target) {
                    gameState.board[row][col] = null;
                }
            }

            const ownerId = this.getWukongOwnerIdFromCloneId(target.id);
            if (ownerId) {
                const owner = this.findHeroById(ownerId, gameState);
                if (owner && owner.state === HeroState.ALIVE && owner.name === '孙悟空') {
                    owner.counters['灵犀'] = (owner.counters['灵犀'] ?? 0) + 1;
                    this.syncWukongCritToSelfAndClones(owner, gameState);

                    if (gameState.battleLog) {
                        gameState.battleLog.push({
                            id: `log-${Date.now()}-${Math.random()}`,
                            type: 'passive' as const,
                            player: owner.owner,
                            message: `${owner.name}的分身阵亡，灵犀+1（当前${owner.counters['灵犀']}）`,
                            timestamp: Date.now()
                        });
                    }
                }
            }

            return true;
        }

        if (target.passiveId === 'changli_passive') {
            const used = target.counters['changli_revives'] ?? 0;
            const requiredStarfire = used === 0 ? 8 : 4;
            const starfire = target.counters['暗夜星火'] ?? 0;
            if (used < 3 && starfire >= requiredStarfire) {
                target.counters['暗夜星火'] = starfire - requiredStarfire;
                target.counters['changli_revives'] = used + 1;
                target.currentHp = Math.max(1, Math.floor(target.maxHp * Math.pow(0.5, used + 1)));
                EffectManager.removeEffectByName(target, '长离复生增伤');
                EffectManager.addEffect(target, {
                    type: 'buff',
                    name: '长离复生增伤',
                    duration: -1,
                    value: (used + 1) * 0.2,
                    sourceHeroId: target.id,
                    description: '每次复生提升20%伤害'
                });
                if (target.owner === 'player1') {
                    gameState.deathCounters.player1Resurrections++;
                } else {
                    gameState.deathCounters.player2Resurrections++;
                }
                if (gameState.battleLog) {
                    gameState.battleLog.push({
                        id: `log-${Date.now()}-${Math.random()}`,
                        type: 'passive',
                        player: target.owner,
                        message: `${target.name}消耗${requiredStarfire}层暗夜星火复生，生命值${target.currentHp}`,
                        timestamp: Date.now()
                    });
                }
                return false;
            }
        }

        target.state = HeroState.DEAD;
        killer.killCount++;

        this.addBattleLog(gameState, {
            type: 'kill',
            player: killer.owner,
            message: `${killer.name}击杀了${target.name}`,
            details: {
                kind: 'hero-kill',
                killerHeroId: killer.id,
                killerName: killer.name,
                victimHeroId: target.id,
                victimName: target.name,
                killCount: killer.killCount
            }
        });

        // 从棋盘上移除英雄
        if (target.position) {
            const [row, col] = target.position;
            if (gameState.board[row] && gameState.board[row][col] === target) {
                gameState.board[row][col] = null;
            }
        }

        let removedCloneCount = 0;
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const h = gameState.board[r][c];
                if (!h || h.state !== HeroState.ALIVE) continue;
                if (!h.counters || h.counters['__isClone'] !== 1) continue;

                const wukongOwnerId = this.getWukongOwnerIdFromCloneId(h.id);
                const mirrorOwnerId = getMirrorOwnerIdFromCloneId(h.id);

                if (wukongOwnerId !== target.id && mirrorOwnerId !== target.id) continue;

                h.state = HeroState.DEAD;
                gameState.board[r][c] = null;
                removedCloneCount++;
            }
        }

        if (removedCloneCount > 0 && gameState.battleLog) {
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'system' as const,
                player: target.owner,
                message: `${target.name}阵亡，${removedCloneCount}个分身随之消散`,
                timestamp: Date.now()
            });
        }

        // 更新死亡计数器
        if (target.owner === 'player1') {
            gameState.deathCounters.player1Dead++;
        } else {
            gameState.deathCounters.player2Dead++;
        }
        gameState.deathCounters.totalDead++;

        if (deathPosition) {
            const inCircle = gameState.boardEffects?.some(effect =>
                effect.type === 'dark-circle' &&
                effect.owner === target.owner &&
                effect.sourceHeroId !== target.id &&
                Math.abs(effect.position[0] - deathPosition[0]) <= 1 &&
                Math.abs(effect.position[1] - deathPosition[1]) <= 1
            );
            if (inCircle) {
                if (target.owner === 'player1') gameState.deathCounters.player1Dead++;
                else gameState.deathCounters.player2Dead++;
            }
        }

        // 触发击杀者的天威
        if (killer.tianweiId && killer.id !== target.id && killer.owner !== target.owner) {
            this.triggerTianwei(killer, gameState);
        }
        if (killer.id !== target.id && killer.owner !== target.owner) {
            this.resolveBountyRewards(target, killer, gameState);
        }

        if (target.counters['__isSummon'] === 1) {
            const parts = target.id.split('|');
            const owner = parts.length >= 4 ? this.findHeroById(parts[2], gameState) : null;
            if (owner?.state === HeroState.ALIVE) {
                owner.currentHp = Math.max(1, owner.currentHp - Math.floor(owner.currentHp * 0.3));
            }
        }

        if (target.passiveId === 't_painting_passive') {
            for (let row = 0; row < 6; row++) {
                for (let col = 0; col < 6; col++) {
                    const unit = gameState.board[row][col];
                    if (unit?.counters['__isSummon'] === 1 && unit.id.split('|')[2] === target.id) {
                        unit.state = HeroState.DEAD;
                        gameState.board[row][col] = null;
                    }
                }
            }
        }

        if (target.passiveId === 'soul_lamp_passive') {
            // 真实死亡：移除临时的，改为永久吸血；数值为当前累计吸血率（真实死亡本身不再+20%）
            const beneficiary = findSoulLampBeneficiary(target, gameState);
            if (beneficiary) {
                beneficiary.effects = beneficiary.effects.filter(effect =>
                    !((effect.name === '缚魂吸血' || effect.name === '缚魂吸血·永驻') && effect.sourceHeroId === target.id)
                );
                EffectManager.addEffect(beneficiary, {
                    type: 'buff',
                    name: '缚魂吸血·永驻',
                    duration: -1,
                    value: target.counters['soul_lamp_vampire_rate'] ?? 0.3,
                    sourceHeroId: target.id,
                    description: '缚魂灯真实死亡后留下的永久吸血',
                });
                if (gameState.battleLog) {
                    gameState.battleLog.push({
                        id: `log-${Date.now()}-${Math.random()}`,
                        type: 'passive' as const,
                        player: beneficiary.owner,
                        message: `${target.name}真实死亡，${beneficiary.name}获得永久吸血${Math.round((target.counters['soul_lamp_vampire_rate'] ?? 0.3) * 100)}%`,
                        timestamp: Date.now()
                    });
                }
            }
        }
        return true;
    }

    /**
     * 触发天威技能
     */
    private static triggerTianwei(hero: Hero, gameState: GameState): void {
        if (hero.tianweiId === 'moran_tianwei') {
            moranTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'zhenxiao_tianwei') {
            zhenxiaoTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'wukong_tianwei') {
            wukongTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'nightowl_tianwei') {
            nightowlTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'mirror_tianwei') {
            mirrorTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'mowen_tianwei') {
            mowenTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'guying_tianwei') {
            guyingTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'huifeng_tianwei') {
            huifengTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'changli_tianwei') {
            changliTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'jetzmi_tianwei') {
            if (hero.owner === 'player1') gameState.deathCounters.player1Dead += 2;
            else gameState.deathCounters.player2Dead += 2;
        } else if (hero.tianweiId === 'wither_lord_tianwei') {
            EffectManager.addCounter(hero, 'wither_lives', 1);
        } else if (hero.tianweiId === 'wangcai_tianwei') {
            hero.baseAttack = (hero.baseAttack ?? 0) + 2;
        } else if (hero.tianweiId === 'skeletonking_tianwei') {
            const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            const dead = allies.filter(item => item.state === HeroState.DEAD);
            const target = dead[Math.floor(Math.random() * dead.length)];
            if (target) {
                const resonance = hero.owner === 'player1'
                    ? gameState.deathCounters.player1Dead
                    : gameState.deathCounters.player2Dead;
                const empty = MovementSystem.findNearestEmptyPosition(hero.position ?? [0, 0], gameState);
                if (empty) {
                    target.state = HeroState.ALIVE;
                    target.position = empty;
                    target.currentHp = Math.max(1, Math.min(target.maxHp, resonance * 3));
                    // 复活后本回合可正常行动
                    target.hasActedThisTurn = false;
                    target.hasMovedThisTurn = false;
                    gameState.board[empty[0]][empty[1]] = target;
                    if (target.owner === 'player1') gameState.deathCounters.player1Resurrections++;
                    else gameState.deathCounters.player2Resurrections++;
                    this.addBattleLog(gameState, {
                        type: 'system',
                        player: hero.owner,
                        message: `${hero.name}触发天威，复活了${target.name}（生命值${target.currentHp}）`
                    });
                }
            } else {
                const living = allies.filter(item => item.state === HeroState.ALIVE).sort((a, b) => a.currentHp - b.currentHp);
                if (living[0]) {
                    this.applyHeal(living[0], 8, gameState);
                    this.addBattleLog(gameState, {
                        type: 'system',
                        player: hero.owner,
                        message: `${hero.name}触发天威，治疗了${living[0].name}`
                    });
                }
            }
        } else if (hero.tianweiId === 'pipa_tianwei') {
            const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            const target = allies.filter(item => item.state === HeroState.ALIVE).sort((a, b) => a.currentHp - b.currentHp)[0];
            if (target) this.applyHeal(target, hero.counters['pipa_last_skill2_damage'] ?? 0, gameState);
        } else if (hero.tianweiId === 'bounty_tianwei') {
            // 击杀后向随机一个存活敌人追加猎杀令（致知3：改为所有存活敌人）
            const enemies = (hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes)
                .filter(item => item.state === HeroState.ALIVE);
            const targets = hero.counters['talent_3']
                ? enemies
                : (enemies.length > 0 ? [enemies[Math.floor(Math.random() * enemies.length)]] : []);
            for (const enemy of targets) {
                EffectManager.removeEffectByName(enemy, '猎杀令');
                EffectManager.addEffect(enemy, {
                    type: 'mark',
                    name: '猎杀令',
                    duration: 2,
                    sourceHeroId: hero.id,
                    description: '友方对其造成伤害时，赏金猎人追加一次4点伤害的追击',
                });
            }
            this.addBattleLog(gameState, {
                type: 'tianwei',
                player: hero.owner,
                message: `${hero.name}触发天威，${hero.counters['talent_3']
                    ? '向所有存活敌人发布猎杀令'
                    : `向${targets[0]?.name ?? '存活敌人'}发布猎杀令`}`
            });
        } else if (hero.tianweiId === 'yinyang_tianwei') {
            const all = [...gameState.player1Heroes, ...gameState.player2Heroes];
            const linked = all.find(item => item.effects.some(effect =>
                effect.sourceHeroId === hero.id && effect.name.startsWith('阳线')
            ));
            if (linked?.tianweiId) this.triggerTianwei(linked, gameState);
        } else if (hero.tianweiId === 't_painting_tianwei') {
            this.applyHeal(hero, 8, gameState);
            for (const ally of hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes) {
                if (ally.counters['__isSummon'] === 1 && ally.id.split('|')[2] === hero.id) this.applyHeal(ally, 8, gameState);
            }
        } else if (hero.tianweiId === 'lilith_tianwei') {
            const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
            for (const enemy of enemies.filter(item => item.state === HeroState.ALIVE)) {
                EffectManager.addEffect(enemy, {
                    type: 'debuff', name: '恐惧', duration: 1, value: 0.2,
                    sourceHeroId: hero.id, description: '攻击降低20%，行动时可能失败',
                });
                if (Math.random() < 0.5) {
                    const damage = this.calculate(hero, enemy, 10, false);
                    this.applyDamage(enemy, damage, hero, gameState, true);
                }
            }
        } else if (hero.tianweiId === 'schrodinger_tianwei') {
            gameState.pendingBoardAction = { type: 'schrodinger-tianwei', heroId: hero.id };
        } else if (hero.tianweiId === 'feynman_tianwei') {
            const positions: [number, number][] = [];
            for (let row = 0; row < 6; row++) {
                for (let col = 0; col < 6; col++) positions.push([row, col]);
            }
            const centers = positions.sort(() => Math.random() - 0.5).slice(0, 8);
            const expanded = (hero.counters['能量'] ?? 0) >= 3;
            if (expanded) hero.counters['能量'] -= 3;
            const affected = new Set(centers.map(([row, col]) => `${row},${col}`));
            if (expanded) {
                for (const center of centers) {
                    for (const [row, col] of [center, ...MovementSystem.getAreaPositions(center, 3)]) {
                        affected.add(`${row},${col}`);
                    }
                }
            }
            for (const key of affected) {
                const [row, col] = key.split(',').map(Number);
                const target = gameState.board[row][col];
                if (!target || target.owner === hero.owner || target.state !== HeroState.ALIVE) continue;
                const damage = this.calculate(hero, target, 5, false);
                this.applyDamage(target, damage, hero, gameState, true);
                if (target.state === HeroState.ALIVE) {
                    EffectManager.addEffect(target, {
                        type: 'mark',
                        name: '粒子标记',
                        duration: 3,
                        stackCount: 1,
                        sourceHeroId: hero.id,
                        description: '粒子轰击的目标',
                    });
                    EffectManager.addCounter(hero, '能量', 1);
                }
            }
        } else if (hero.tianweiId === 'hanjiangxue_tianwei') {
            hanjiangxueTianwei.execute(hero, gameState);
        }
        this.triggerMirrorBrokenBlade(hero, gameState);
    }

    /**
     * 获取暴击率
     */
    private static getCritRate(hero: Hero): number {
        const critRates = this.getModifiers(hero, 'critRate');
        return Math.min(1, critRates.reduce((sum, rate) => sum + rate, 0));
    }

    /**
     * 获取暴击伤害倍率
     */
    private static getCritDamage(hero: Hero): number {
        const baseCritDamage = 1.5; // 基础暴击倍率
        const critDamageBonuses = this.getModifiers(hero, 'critDamage');
        return baseCritDamage + critDamageBonuses.reduce((sum, bonus) => sum + bonus, 0);
    }

    /**
     * 获取修正值（从效果和计数器中提取）
     */
    private static getModifiers(hero: Hero, type: string): number[] {
        const modifiers: number[] = [];

        // 从效果中提取
        for (const effect of hero.effects) {
            if (effect.type === 'buff' && effect.value !== undefined) {
                // 根据效果名称判断类型
                // 这里简化处理，实际应该在effect中有明确的修正类型
                if (type === 'attackBonus' && (effect.name.includes('攻击') || effect.name === '来财')) {
                    modifiers.push(effect.value);
                } else if (type === 'damageBonus' && effect.name.includes('增伤')) {
                    modifiers.push(effect.value);
                } else if (type === 'critRate' && effect.name.includes('暴击率')) {
                    modifiers.push(effect.value);
                } else if (type === 'critDamage' && effect.name.includes('暴伤')) {
                    modifiers.push(effect.value);
                } else if (type === 'vampire' && effect.name.includes('吸血')) {
                    modifiers.push(effect.value);
                } else if (type === 'damageReduction' && effect.name.includes('免伤')) {
                    modifiers.push(effect.value);
                }
            }
        }

        return modifiers;
    }

    /**
     * 计算治疗
     */
    static calculateHeal(healer: Hero, target: Hero, baseHeal: number): number {
        void target;
        let finalHeal = baseHeal;

        // 获取治疗加成
        const healBonuses = this.getModifiers(healer, 'healBonus');
        for (const bonus of healBonuses) {
            finalHeal *= (1 + bonus);
        }

        return Math.floor(finalHeal);
    }

    /**
     * 应用治疗。传入 gameState 时会写入带位置信息的治疗日志，供 UI 飘字使用。
     */
    static applyHeal(target: Hero, healAmount: number, gameState?: GameState): number {
        const oldHp = target.currentHp;
        target.currentHp = Math.min(target.maxHp, target.currentHp + healAmount);
        const healed = target.currentHp - oldHp; // 实际治疗量

        if (gameState?.battleLog && healed > 0 && target.state === HeroState.ALIVE && target.position) {
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'heal',
                player: target.owner,
                message: `${target.name}恢复了${healed}点生命`,
                timestamp: Date.now(),
                details: {
                    kind: 'heal',
                    targetHeroId: target.id,
                    amount: healed,
                    position: [...target.position],
                }
            });
        }

        return healed;
    }
}
