import { BOARD_SIZE, Hero, Skill, Position, GameState, SkillExecuteResult, HeroState } from '../types/game';
import { MovementSystem } from './movement-system';
import { DamageCalculator } from './damage-calculator';
import { EffectManager } from './effect-manager';
import { recordBattleSkillUse } from './battle-statistics';
import { youjunDashMaxDistance } from './wind-blade';
import { filterPositionsByRage, getRageBinder, rageBlocksCast } from './taunt';
import { getJinghongOuterRing, isJinghongCharging, isJinghongReleaseWindow, isLingxiEchoPending } from '../data/extended-heroes';

/**
 * 技能系统
 */
export class SkillSystem {
    /**
     * 获取技能有效目标位置
     * gameState 可选：游隼疾掠的落点范围取决于起点风道，需要读取棋盘效果；
     * 未传入时按无风道加成的常规距离计算。
     *
     * 愤怒（嘲讽）在这里统一收窄：界面高亮、AI 选目标与 canUseSkill 都走本函数，
     * 不传 gameState 时无法读取愤怒状态，因此调用方应尽可能把 state 传进来。
     */
    static getValidTargetPositions(
        caster: Hero,
        skill: Skill,
        gameState?: GameState
    ): Position[] {
        return filterPositionsByRage(
            caster,
            skill,
            this.getTargetPositionsRaw(caster, skill, gameState),
            gameState
        );
    }

    private static getTargetPositionsRaw(
        caster: Hero,
        skill: Skill,
        gameState?: GameState
    ): Position[] {
        if (!caster.position) return [];

        // 惊鸿·止水技能2：决渊段要放开 5×5 外环让玩家看清这一圈打到谁，
        // 因此必须抢在 targetType==='self' 的统一收口之前——蓄力段仍走自指。
        if (skill.id === 'jinghong_skill2' && gameState && isJinghongReleaseWindow(caster, gameState)) {
            return [caster.position, ...getJinghongOuterRing(caster.position)];
        }

        if (skill.targetType === 'self') {
            return caster.position ? [caster.position] : [];
        }

        // 游隼疾掠：四方向冲刺落点；起点处于同轴友方风道时该方向可冲刺整行/整列。
        // 路径上的单位不再阻挡（友军照常穿过），但落点必须是空格
        if (skill.id === 'youjun_skill1') {
            const positions: Position[] = [];
            for (const dir of ['up', 'down', 'left', 'right'] as const) {
                const maxDistance = youjunDashMaxDistance(gameState as GameState, caster, dir);
                positions.push(...MovementSystem.getLinePositions(caster.position, dir, maxDistance).filter(
                    ([row, col]) => (gameState as GameState).board[row][col] === null
                ));
            }
            return positions;
        }

        const positions: Position[] = [];

        // 特殊处理震霄技能1
        if (skill.id === 'zhenxiao_skill1') {
             const allDirections: Array<'up' | 'down' | 'left' | 'right'> = ['up', 'down', 'left', 'right'];
             for (const dir of allDirections) {
                 positions.push(...MovementSystem.getZhenxiaoSkill1Positions(caster.position, dir));
             }
             return positions;
        }

        // 5×5 方盒（切比雪夫距离≤2），且允许直接点自己脚下的格子
        if (skill.id === 'nanfeng_skill1' || skill.id === 'xubai_skill1') {
            return MovementSystem.getBoxPositions(caster.position, 5);
        }

        // 泠汐技能1：与上一回合的回响合并时，实际范围扩大到 5×5，高亮要如实反映
        if (skill.id === 'lingxi_skill1' && gameState) {
            const merged = isLingxiEchoPending(caster, gameState, 'lingxi_echo1_round');
            return MovementSystem.getBoxPositions(caster.position, merged ? 5 : 3);
        }

        // 泠汐技能2：两步交互——未定方向时只亮四个方向格，定了方向才展开前方 2×3
        if (skill.id === 'lingxi_skill2' && caster.position) {
            const dirCode = caster.counters['__lingxi_skill2_dir'];
            return dirCode === undefined
                ? MovementSystem.getCrossPositions(caster.position)
                : MovementSystem.getLingxiFrontRect(caster.position, dirCode);
        }

        switch (skill.rangeType) {
            case 'single':
                // 单体目标（曼哈顿距离范围内）
                return MovementSystem.getPositionsInRange(caster.position, skill.range);

            case 'cross':
                // 十字范围（上下左右）
                return MovementSystem.getCrossPositions(caster.position);

            case 'line':
                // 直线范围（需要额外指定方向）
                // 这里返回所有四个方向的位置，实际使用时需要玩家选择方向
                const allDirections: Array<'up' | 'down' | 'left' | 'right'> = ['up', 'down', 'left', 'right'];
                for (const dir of allDirections) {
                    positions.push(...MovementSystem.getLinePositions(caster.position, dir, skill.range));
                }
                return positions;

            case 'area':
                // 区域范围
                const size = skill.areaSize || 3;
                return MovementSystem.getAreaPositions(caster.position, size);

            case '全场':
                // 全场所有位置
                for (let row = 0; row < BOARD_SIZE; row++) {
                    for (let col = 0; col < BOARD_SIZE; col++) {
                        positions.push([row, col]);
                    }
                }
                return positions;

            default:
                return [];
        }
    }

    /**
     * 获取位置上的英雄（过滤目标类型）
     */
    static getHeroesAtPositions(
        positions: Position[],
        caster: Hero,
        targetType: Skill['targetType'],
        gameState: GameState
    ): Hero[] {
        const heroes: Hero[] = [];

        for (const pos of positions) {
            const [row, col] = pos;
            if (row < 0 || row >= 6 || col < 0 || col >= 6) continue;
            const hero = gameState.board[row][col];

            if (!hero || hero.state !== HeroState.ALIVE) continue;

            // 根据目标类型过滤
            switch (targetType) {
                case 'enemy':
                    if (hero.owner !== caster.owner) {
                        heroes.push(hero);
                    }
                    break;

                case 'ally':
                    if (hero.owner === caster.owner && hero.id !== caster.id) {
                        heroes.push(hero);
                    }
                    break;

                case 'self':
                    if (hero.id === caster.id) {
                        heroes.push(hero);
                    }
                    break;

                case 'any':
                    heroes.push(hero);
                    break;
            }
        }

        return heroes;
    }

    /**
     * 选择目标
     */
    static selectTargets(
        availableTargets: Hero[],
        targetCount: Skill['targetCount']
    ): Hero[] {
        if (availableTargets.length === 0) return [];

        if (targetCount === 'all') {
            return availableTargets;
        }

        if (targetCount === 'random') {
            // 随机选择一个
            const randomIndex = Math.floor(Math.random() * availableTargets.length);
            return [availableTargets[randomIndex]];
        }

        // 数字类型：返回最多指定数量的目标
        return availableTargets.slice(0, targetCount as number);
    }

    /**
     * 执行技能（通用逻辑）
     */
    static executeSkill(
        caster: Hero,
        skill: Skill,
        targetPositions: Position[],
        gameState: GameState
    ): SkillExecuteResult {
        if (caster.name === '琉璃') {
            this.removeGuardEffectsFromLiuli(caster.id, gameState);
        }

        // 愤怒（嘲讽）兜底：绕过界面高亮的直接调用同样不成立，
        // 失败时不消耗行动，界面据此提示"只能攻击锁住你的对象"
        const rageBinder = getRageBinder(caster, gameState);
        if (rageBlocksCast(caster, skill, targetPositions, gameState)) {
            return {
                success: false,
                log: [`${caster.name}被${rageBinder?.name ?? '血契'}锁住，这一击必须落在它身上`],
            };
        }

        // 如果技能有自定义执行函数，使用自定义函数
        if (skill.execute) {
            let finalTargetPositions = targetPositions;
            // 引擎为群体技能展开过的完整范围格：特效层直接采用，不必再从静态元数据二次推导
            let autoCoveredPositions: Position[] = [];
            let shouldClearGuyingDir = false;
            let shouldClearExtendedTarget = false;

            if (targetPositions.length > 0) {
                const [row, col] = targetPositions[targetPositions.length - 1];
                caster.counters['__extended_target'] = row * 6 + col;
                shouldClearExtendedTarget = true;
            }

            if (
                skill.rangeType === 'line' &&
                skill.targetCount === 'all' &&
                targetPositions.length === 1 &&
                caster.position
            ) {
                const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
                if (direction) {
            if (skill.id === 'schrodinger_skill1') {
                        const [row, col] = targetPositions[0];
                        const center: Position = [row, col];
                        finalTargetPositions = [center, ...MovementSystem.getAreaPositions(center, 3)];
                    } else if (skill.id === 'hanjiangxue_skill1') {
                        // 寒江雪技能1：以点击位置为中心展开3x3范围，而非整条直线
                        const [row, col] = targetPositions[0];
                        const center: Position = [row, col];
                        finalTargetPositions = [center, ...MovementSystem.getAreaPositions(center, 3)];
                    } else {
                        finalTargetPositions = MovementSystem.getLinePositions(caster.position, direction, skill.range);
                        if (skill.id === 'feynman_skill1' && (caster.counters['能量'] ?? 0) >= 3) {
                            caster.counters['能量'] -= 3;
                            const widened: Position[] = [...finalTargetPositions];
                            for (const [row, col] of finalTargetPositions) {
                                const sideA: Position = direction === 'up' || direction === 'down'
                                    ? [row, col - 1] : [row - 1, col];
                                const sideB: Position = direction === 'up' || direction === 'down'
                                    ? [row, col + 1] : [row + 1, col];
                                for (const position of [sideA, sideB]) {
                                    if (position[0] >= 0 && position[0] < 6 && position[1] >= 0 && position[1] < 6) {
                                        widened.push(position);
                                    }
                                }
                            }
                            finalTargetPositions = widened;
                        }
                    }
                }
            }

            // 特殊处理震霄技能1：根据点击的位置判断方向，然后扩展攻击范围
            if (skill.id === 'zhenxiao_skill1' && targetPositions.length === 1) {
                if (caster.position) {
                    const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
                    if (direction) {
                        finalTargetPositions = MovementSystem.getZhenxiaoSkill1Positions(caster.position, direction);
                    }
                }
            }

            if (skill.id === 'guying_skill1' && targetPositions.length === 1) {
                if (caster.position) {
                    const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
                    if (direction) {
                        finalTargetPositions = MovementSystem.getLinePositions(caster.position, direction, skill.range);
                        caster.counters['__guying_skill1_dir'] =
                            direction === 'up' ? 0
                                : direction === 'down' ? 1
                                    : direction === 'left' ? 2
                                        : 3;
                        shouldClearGuyingDir = true;
                    }
                }
            }

            // 泠汐技能2：方向已由第一步确定；未走过 staging 的调用方（如 AI 直接点方向格）在此推导
            if (skill.id === 'lingxi_skill2' && targetPositions.length === 1 && caster.position) {
                if (caster.counters['__lingxi_skill2_dir'] === undefined) {
                    const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
                    if (direction) {
                        caster.counters['__lingxi_skill2_dir'] =
                            direction === 'up' ? 0 : direction === 'down' ? 1 : direction === 'left' ? 2 : 3;
                    }
                }
                const dirCode = caster.counters['__lingxi_skill2_dir'];
                if (dirCode !== undefined) {
                    finalTargetPositions = MovementSystem.getLingxiFrontRect(caster.position, dirCode);
                }
            }

            // 凋零之主技能1：两个对角位置展开为 2x2 区域
            if (skill.id === 'wither_lord_skill1' && targetPositions.length === 2) {
                const [first, second] = targetPositions;
                const rowDiff = Math.abs(first[0] - second[0]);
                const colDiff = Math.abs(first[1] - second[1]);
                if (rowDiff === 1 && colDiff === 1) {
                    const minRow = Math.min(first[0], second[0]);
                    const maxRow = Math.max(first[0], second[0]);
                    const minCol = Math.min(first[1], second[1]);
                    const maxCol = Math.max(first[1], second[1]);
                    finalTargetPositions = [
                        [minRow, minCol],
                        [minRow, maxCol],
                        [maxRow, minCol],
                        [maxRow, maxCol],
                    ];
                }
            }

            if (skill.targetType === 'self') {
                finalTargetPositions = caster.position ? [caster.position] : [];
            } else if (
                skill.targetCount === 'all' &&
                skill.rangeType !== 'line' &&
                skill.rangeType !== '全场'
            ) {
                // 群体技能：目标覆盖技能全范围，而不是玩家点击的单格。
                // line/全场类型已在上面特判或由 execute 自行结算。
                const fullRange = this.getValidTargetPositions(caster, skill, gameState);
                if (fullRange.length > 0) {
                    finalTargetPositions = fullRange;
                    autoCoveredPositions = fullRange;
                }
            }

            let targets = this.getHeroesAtPositions(
                finalTargetPositions,
                caster,
                skill.targetType,
                gameState
            );
            const result = skill.execute(caster, targets, gameState);
            // 特效作用区兜优先级：技能自报的真实格 > 引擎展开群体范围时用的那份格子。
            // 后者让"选点高亮范围＝目标选择范围＝特效范围"三者天然同源，不再各算一遍
            if (result.success && !result.fxCoveredPositions && autoCoveredPositions.length > 0) {
                result.fxCoveredPositions = autoCoveredPositions;
            }
            if (result.success) recordBattleSkillUse(gameState, caster, skill.id);
            if (
                result.success &&
                caster.passiveId === 'schrodinger_passive' &&
                caster.counters['schrodinger_extra_used'] !== 1
            ) {
                caster.counters['schrodinger_extra_used'] = 1;
                if (Math.random() < 0.5) {
                    gameState.pendingExtraActionHeroIds ??= {};
                    gameState.pendingExtraActionHeroIds[caster.owner] = caster.id;
                }
            }
            // 游隼被动「再动」：技能结算成功后可再移动一次（额外行动窗口由
            // GameEngine.continueTurnFlow 标记为仅移动，收回风刃刷新疾掠后才放行技能1）
            if (
                result.success &&
                caster.passiveId === 'youjun_passive' &&
                caster.state === HeroState.ALIVE
            ) {
                gameState.pendingExtraActionHeroIds ??= {};
                gameState.pendingExtraActionHeroIds[caster.owner] = caster.id;
                gameState.battleLog?.push({
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'passive' as const,
                    player: caster.owner,
                    message: `${caster.name}收势再起，还可以再移动一次`,
                    timestamp: Date.now(),
                });
            }
            if (shouldClearGuyingDir) {
                delete caster.counters['__guying_skill1_dir'];
            }
            if (shouldClearExtendedTarget) {
                delete caster.counters['__extended_target'];
            }
            return result;
        }

        // 否则使用默认逻辑
        const result = this.executeDefaultSkill(caster, skill, targetPositions, gameState);
        if (result.success) recordBattleSkillUse(gameState, caster, skill.id);
        return result;
    }

    /**
     * 移除琉璃施加的援护效果（在琉璃出手时调用）
     */
    static removeGuardEffectsFromLiuli(liuliId: string, gameState: GameState): void {
        const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];
        for (const hero of allHeroes) {
            // 移除由该琉璃施加的援护效果
            const hadGuard = hero.effects.some(e => e.name === '援护' && e.sourceHeroId === liuliId);
            if (hadGuard) {
                hero.effects = hero.effects.filter(e => !(e.name === '援护' && e.sourceHeroId === liuliId));
                // 添加日志
                if (gameState.battleLog) {
                    gameState.battleLog.push({
                        id: `log-${Date.now()}-${Math.random()}`,
                        type: 'system' as const,
                        player: hero.owner,
                        message: `${hero.name}身上的援护效果消失了`,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }

    /**
     * 执行默认技能逻辑
     */
    private static executeDefaultSkill(
        caster: Hero,
        skill: Skill,
        targetPositions: Position[],
        gameState: GameState
    ): SkillExecuteResult {
        const result: SkillExecuteResult = {
            success: true,
            damageDealt: [],
            healingDone: [],
            effectsApplied: [],
            triggeredPassives: [],
            log: []
        };

        // 获取所有可能的目标
        const availableTargets = this.getHeroesAtPositions(
            targetPositions,
            caster,
            skill.targetType,
            gameState
        );

        // 选择目标
        const targets = this.selectTargets(availableTargets, skill.targetCount);

        if (targets.length === 0) {
            result.success = false;
            result.log.push(`${caster.name}的${skill.name}没有找到有效目标`);
            return result;
        }

        result.log.push(`${caster.name}使用了${skill.name}`);

        // 处理伤害
        if (skill.baseDamage !== undefined) {
            const baseDamage = skill.baseDamage;
            // 一次施放命中多目标 = 一次攻击：和声等按攻击触发的效果整组只结算一次
            DamageCalculator.asOneAttack(() => {
                for (const target of targets) {
                    const damage = DamageCalculator.calculate(
                        caster,
                        target,
                        baseDamage,
                        skill.scalesWithAttack ?? false,
                        skill.ignoreDefense ?? false
                    );
                    DamageCalculator.applyDamage(target, damage, caster, gameState);
                    result.damageDealt?.push(damage.finalDamage);
                    result.log.push(`对${target.name}造成了${damage.finalDamage}点伤害`);
                }
            });
        }

        // 处理治疗
        if (skill.baseHeal !== undefined) {
            for (const target of targets) {
                const healed = DamageCalculator.applyHeal(target, skill.baseHeal, gameState, caster);
                result.healingDone?.push(healed);
                result.log.push(`为${target.name}恢复了${healed}点生命`);
            }
        }

        // 施加效果
        if (skill.effectsToApply) {
            for (const target of targets) {
                for (const effect of skill.effectsToApply) {
                    EffectManager.addEffect(target, {
                        ...effect,
                        sourceHeroId: caster.id
                    });
                    const applied = target.effects.find(item =>
                        item.name === effect.name && item.sourceHeroId === caster.id
                    );
                    if (applied) result.effectsApplied?.push(applied);
                    result.log.push(`${target.name}获得了${effect.name}`);
                }
            }
        }

        return result;
    }

    /**
     * 检查技能是否可用
     */
    static canUseSkill(caster: Hero, skill: Skill, gameState: GameState): boolean {
        if (caster.state !== HeroState.ALIVE || !caster.position) return false;

        // 检查是否已行动
        if (caster.hasActedThisTurn) return false;

        // 检查是否被眩晕
        if (EffectManager.isStunned(caster)) return false;

        // 游隼再动窗口：额外行动里仅允许移动；收回风刃刷新疾掠后才放行技能1
        if (
            caster.passiveId === 'youjun_passive' &&
            caster.counters['youjun_extra_move_only'] === 1 &&
            (skill.id !== 'youjun_skill1' || caster.counters['youjun_skill1_refreshed'] !== 1)
        ) {
            return false;
        }

        // 惊鸿·止水「止水决渊」：不在蓄力/释放窗口、手里又没有惊鸿时，这一手无事可做，
        // 提前判不可用，界面按钮直接灰掉，免得玩家点下去只吃到一句失败提示。
        // 释放回合还要求外环确有敌人——落空的施放会失败且不消耗行动，
        // 电脑对手会因此原地反复重试而卡住，所以宁可不给它选。
        if (skill.id === 'jinghong_skill2') {
            const charged = caster.counters['jinghong_charge_round'] ?? -1;
            if (charged < 0) return (caster.counters['惊鸿'] ?? 0) >= 1;
            if (isJinghongCharging(caster, gameState)) return true;
            if (!isJinghongReleaseWindow(caster, gameState)) return false;
            return getJinghongOuterRing(caster.position as Position).some(cell => {
                const occupant = gameState.board[cell[0]][cell[1]];
                return !!occupant && occupant.owner !== caster.owner && occupant.state === HeroState.ALIVE;
            });
        }

        // 检查是否有有效目标
        const validPositions = this.getValidTargetPositions(caster, skill, gameState);
        if (skill.targetType === 'empty') {
            return validPositions.some(([row, col]) => gameState.board[row][col] === null);
        }
        if (skill.targetType === 'self' || skill.targetType === 'any') return validPositions.length > 0;
        const targets = this.getHeroesAtPositions(validPositions, caster, skill.targetType, gameState);

        return targets.length > 0;
    }

    /**
     * 获取技能范围预览
     */
    static getSkillRangePreview(
        caster: Hero,
        skill: Skill,
        gameState: GameState
    ): Position[] {
        return this.getValidTargetPositions(caster, skill, gameState);
    }
}
