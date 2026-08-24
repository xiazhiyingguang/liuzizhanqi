import { Hero, Skill, Position, GameState, SkillExecuteResult, HeroState } from '../types/game';
import { MovementSystem } from './movement-system';
import { DamageCalculator } from './damage-calculator';
import { EffectManager } from './effect-manager';
import { recordBattleSkillUse } from './battle-statistics';

/**
 * 技能系统
 */
export class SkillSystem {
    /**
     * 获取技能有效目标位置
     */
    static getValidTargetPositions(
        caster: Hero,
        skill: Skill
    ): Position[] {
        if (!caster.position) return [];

        if (skill.targetType === 'self') {
            return caster.position ? [caster.position] : [];
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
                for (let row = 0; row < 6; row++) {
                    for (let col = 0; col < 6; col++) {
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

        // 如果技能有自定义执行函数，使用自定义函数
        if (skill.execute) {
            let finalTargetPositions = targetPositions;
            let shouldClearGuyingDir = false;
            let shouldClearHuifengTarget = false;
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

            if (skill.id === 'huifeng_skill2' && targetPositions.length === 1) {
                const [row, col] = targetPositions[0];
                caster.counters['__huifeng_skill2_target'] = row * 6 + col;
                shouldClearHuifengTarget = true;
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
                const fullRange = this.getValidTargetPositions(caster, skill);
                if (fullRange.length > 0) {
                    finalTargetPositions = fullRange;
                }
            }

            let targets = this.getHeroesAtPositions(
                finalTargetPositions,
                caster,
                skill.targetType,
                gameState
            );
            // 时空旅者·戴尔「时空回溯」：处于时空停滞的阵亡单位已不在棋盘上，
            // 点击其死亡位置时改为从英雄列表中收集该单位作为复活目标
            if (skill.id === 'dai_skill1') {
                const stalled = [...gameState.player1Heroes, ...gameState.player2Heroes].find(hero =>
                    hero.owner === caster.owner &&
                    hero.state === HeroState.DEAD &&
                    hero.counters['__dai_stasis_until'] !== undefined &&
                    hero.position !== null &&
                    finalTargetPositions.some(([row, col]) =>
                        hero.position![0] === row && hero.position![1] === col
                    )
                );
                if (stalled) targets = [stalled];
            }
            const result = skill.execute(caster, targets, gameState);
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
            if (shouldClearGuyingDir) {
                delete caster.counters['__guying_skill1_dir'];
            }
            if (shouldClearHuifengTarget) {
                delete caster.counters['__huifeng_skill2_target'];
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
            for (const target of targets) {
                const damage = DamageCalculator.calculate(
                    caster,
                    target,
                    skill.baseDamage,
                    skill.scalesWithAttack ?? false,
                    skill.ignoreDefense ?? false
                );
                DamageCalculator.applyDamage(target, damage, caster, gameState);
                result.damageDealt?.push(damage.finalDamage);
                result.log.push(`对${target.name}造成了${damage.finalDamage}点伤害`);
            }
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

        // 检查是否有有效目标
        const validPositions = this.getValidTargetPositions(caster, skill);
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
        void gameState;
        return this.getValidTargetPositions(caster, skill);
    }
}
