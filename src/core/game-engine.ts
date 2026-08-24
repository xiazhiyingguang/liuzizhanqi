import { GameState, Hero, HeroState, BattleLogEntry, Player } from '../types/game';
import { MovementSystem } from './movement-system';
import { EffectManager } from './effect-manager';
import { DamageCalculator } from './damage-calculator';
import { findSoulLampBeneficiary, placeBounties } from '../data/extended-heroes';
import { recordBattleHealing } from './battle-statistics';

/**
 * 游戏引擎 - 主控制器
 */
export class GameEngine {
    static reviveDeadHero(
        hero: Hero,
        hpPercent: number,
        near: Hero | null,
        gameState: GameState
    ): boolean {
        if (hero.state !== HeroState.DEAD) return false;

        const start = near?.position ?? hero.position ?? [0, 0];
        const emptyPos = MovementSystem.findNearestEmptyPosition(start, gameState);
        if (!emptyPos) return false;

        return this.reviveHeroAtPosition(hero, emptyPos, hpPercent, gameState);
    }

    /**
     * 在指定位置复活英雄
     */
    static reviveHeroAtPosition(
        hero: Hero,
        position: [number, number],
        hpPercent: number,
        gameState: GameState
    ): boolean {
        if (hero.state !== HeroState.DEAD) return false;
        
        const [row, col] = position;
        if (row < 0 || row >= 6 || col < 0 || col >= 6) return false;
        if (gameState.board[row][col] !== null) return false;

        const reviveHp = Math.max(1, Math.min(hero.maxHp, Math.floor(hero.maxHp * hpPercent)));
        
        hero.currentHp = reviveHp;
        hero.state = HeroState.ALIVE;
        hero.position = position;
        hero.hasActedThisTurn = false;
        hero.hasMovedThisTurn = false;

        gameState.board[row][col] = hero;
        this.recordResurrection(hero, gameState);

        this.addLog(gameState, {
            type: 'system',
            player: hero.owner,
            message: `${hero.name}复活了！生命值：${hero.currentHp}`
        });

        return true;
    }

    /**
     * 开始新回合
     */
    static startNewTurn(gameState: GameState): void {
        const scheduledRevives = [...gameState.player1Heroes, ...gameState.player2Heroes]
            .filter(hero =>
                hero.state === HeroState.TEMP_DEAD &&
                (hero.counters['soul_lamp_revive_round'] ?? Infinity) <= gameState.roundNumber
            );
        for (const hero of scheduledRevives) {
            const soulCount = [...gameState.player1Heroes, ...gameState.player2Heroes]
                .filter(candidate => candidate.state !== HeroState.ALIVE).length;
            const missingHealRate = Math.min(1, soulCount * 0.2);
            if (this.resurrectHero(hero, 0.01, gameState)) {
                // 在暂时阵亡时的生命值基础上，额外恢复（亡灵之魂×20% × 最大生命），上限为最大生命
                hero.currentHp = Math.max(1, Math.min(hero.maxHp, hero.currentHp + Math.floor(hero.maxHp * missingHealRate)));
            }
        }

        // 重置所有英雄的行动标记
        const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];
        gameState.actionsRequiredThisTurn = allHeroes.filter(hero => hero.state === HeroState.ALIVE).length;
        for (const hero of allHeroes) {
            if (hero.state !== HeroState.DEAD) {
                hero.hasActedThisTurn = false;
                hero.hasMovedThisTurn = false;
                if (hero.counters['tianwei_uses']) {
                    hero.counters['tianwei_uses'] = 0;
                }
                if (hero.counters['stealth_damage_taken']) {
                    hero.counters['stealth_damage_taken'] = 0;
                }
                if (hero.passiveId === 'schrodinger_passive') {
                    hero.counters['schrodinger_extra_used'] = 0;
                }
                if (hero.passiveId === 'yinyang_passive') {
                    // 被动：阳线/阴线的攻防加成每回合+5%（上限50%），并同步到已生效的链接效果上
                    hero.counters['yinyang_yang_rate'] = Math.min(0.5, (hero.counters['yinyang_yang_rate'] ?? 0.2) + 0.05);
                    hero.counters['yinyang_yin_rate'] = Math.min(0.5, (hero.counters['yinyang_yin_rate'] ?? 0.2) + 0.05);
                    const all = [...gameState.player1Heroes, ...gameState.player2Heroes];
                    for (const target of all) {
                        for (const effect of target.effects) {
                            if (effect.sourceHeroId !== hero.id) continue;
                            if (effect.name.startsWith('阳线')) effect.value = hero.counters['yinyang_yang_rate'];
                            if (effect.name.startsWith('阴线')) effect.value = hero.counters['yinyang_yin_rate'];
                        }
                    }
                }
                if (hero.counters['mowen_skill1_cd']) {
                    // 冷却按回合推进：使用技能1后必须间隔一个完整回合才能再次使用，
                    // 额外行动/再动不会提前结束冷却。
                    hero.counters['mowen_skill1_cd'] = Math.max(0, hero.counters['mowen_skill1_cd'] - 1);
                }
                if (hero.passiveId === 'libai_passive' && hero.state === HeroState.ALIVE) {
                    // 记录上次/上上次停留位置（滚动）：供被动瞬移链使用
                    const prev = hero.counters['__libai_prev_pos'];
                    if (prev !== undefined) hero.counters['__libai_prev2_pos'] = prev;
                    if (hero.position) {
                        hero.counters['__libai_prev_pos'] = hero.position[0] * 6 + hero.position[1];
                    }
                }
            }
        }

        // 行动计数归零
        gameState.actionsThisTurn = 0;
        
        // 默认 Player1 先手，或者根据游戏规则决定
        gameState.currentPlayer = 'player1';
        gameState.activeHero = null;  // 重置锁定状态
        gameState.pendingForcedActionHeroId = undefined;
        gameState.performingForcedAction = false;
        gameState.forcedActionResumePlayer = undefined;

        // 更新效果持续时间
        EffectManager.updateEffectDurations(gameState);
        gameState.boardEffects = (gameState.boardEffects ?? [])
            .map(effect => effect.type === 'brush' ? effect : { ...effect, duration: effect.duration - 1 })
            .filter(effect => effect.duration > 0);

        // 触发回合开始效果
        this.triggerTurnStartEffects(gameState);

        // 添加日志
        this.addLog(gameState, {
            type: 'system',
            player: 'player1',
            message: `第${gameState.roundNumber}轮开始`
        });

        // 回合开始兑底：自动跳过全员无法行动的一方（全员眩晕/冰冻/已行动）。
        // 双方都无法行动时推进回合，让控制效果递减；长时间未解除则强制清除控制。
        // 替补制：回合开始效果（如持续伤害）可能造成减员，先于跳过逻辑调度补员，
        // 刚上场的新英雄 hasActed=false 必然可行动，不会触发跳过死锁。
        if (this.beginPendingReinforcement(gameState)) {
            return;
        }
        this.advancePastBlockedPlayer(gameState);
    }

    /**
     * 当 currentPlayer 一方没有可行动英雄（全员眩晕/已行动）时，自动跳过该玩家：
     * - 另一方有可行动英雄 -> 切换过去
     * - 双方都没有 -> 推进回合（让控制效果递减）
     * - 连续超过 50 轮仍无法行动 -> 强制清除双方所有控制效果，防止死局
     * 返回是否执行了跳过。
     */
    static advancePastBlockedPlayer(gameState: GameState): boolean {
        const currentAvailable = this.getAvailableHeroesForPlayer(gameState, gameState.currentPlayer);
        if (currentAvailable.length > 0) return false;

        const other = gameState.currentPlayer === 'player1' ? 'player2' : 'player1';
        const otherAvailable = this.getAvailableHeroesForPlayer(gameState, other);

        if (otherAvailable.length > 0) {
            gameState.currentPlayer = other;
            gameState.activeHero = null;
            this.addLog(gameState, {
                type: 'system',
                player: other,
                message: `${other === 'player1' ? '玩家1' : '玩家2'}的英雄均无法行动，自动跳过其回合`
            });
            return true;
        }

        // 双方都无法行动：推进回合，让控制效果递减
        if (gameState.roundNumber < 50) {
            this.endTurn(gameState);
            return true;
        }

        // 保险丝：连续 50 轮双方都无法行动（控制效果被反复刷新），强制清除控制效果，避免死局
        const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];
        let cleared = 0;
        for (const hero of allHeroes) {
            const before = hero.effects.length;
            hero.effects = hero.effects.filter(effect => effect.type !== 'stun');
            cleared += before - hero.effects.length;
        }
        if (cleared > 0) {
            this.addLog(gameState, {
                type: 'system',
                player: 'player1',
                message: '双方长时间无法行动，眩晕效果已被强制清除'
            });
        }
        const restored = this.getAvailableHeroesForPlayer(gameState, gameState.currentPlayer);
        if (restored.length === 0) {
            gameState.currentPlayer = other;
            gameState.activeHero = null;
        }
        return true;
    }

    /**
     * 获取指定玩家可操作的英雄
     */
    static getAvailableHeroesForPlayer(gameState: GameState, player: Player): Hero[] {
        const heroes = player === 'player1'
            ? gameState.player1Heroes
            : gameState.player2Heroes;

        return heroes.filter(
            h => h.state === HeroState.ALIVE &&
                !h.hasActedThisTurn &&
                !EffectManager.isStunned(h)
        );
    }

    /**
     * 结束英雄行动
     */
    static endHeroAction(hero: Hero, gameState: GameState): void {
        const isFinishingExtraActionHero =
            !!gameState.performingExtraAction && gameState.activeHero?.id === hero.id;
        const isFinishingForcedActionHero =
            !!gameState.performingForcedAction && gameState.activeHero?.id === hero.id;

        if (!isFinishingExtraActionHero) {
            hero.hasActedThisTurn = true;
        }

        const nextActionSerial = (hero.counters['__actionSerial'] ?? 0) + 1;
        hero.counters['__actionSerial'] = nextActionSerial;
        hero.effects = hero.effects.filter(e => e.expireAtActionSerial === undefined || e.expireAtActionSerial > nextActionSerial);

        // 触发回合结束相关效果
        this.triggerActionEndEffects(hero, gameState);

        if (hero.passiveId === 'mowen_passive' && hero.state === HeroState.ALIVE) {
            hero.counters['mowen_prev_hp'] = hero.currentHp;
        }

        // 墨阑：致知2的"为道爆发"加成仅在"为道"解除后的立即出手内有效，行动结束即清除
        if (hero.passiveId === 'moran_passive') {
            delete hero.counters['__weidao_burst'];
        }

        if (!gameState.performingExtraAction) {
            gameState.actionsThisTurn++;
        }

        // 胜负必须先于换边、额外行动和进入下一轮结算。
        // TEMP_DEAD 不算场上存活单位，因此最后一个单位暂时阵亡会在这里立即失败。
        this.checkWinCondition(gameState);
        if (gameState.phase === 'ended') {
            gameState.activeHero = null;
            gameState.pendingExtraActionHeroIds = undefined;
            gameState.performingExtraAction = false;
            gameState.resumePlayer = undefined;
            gameState.pendingForcedActionHeroId = undefined;
            gameState.performingForcedAction = false;
            gameState.forcedActionResumePlayer = undefined;
            return;
        }

        // 替补制：英雄阵亡后立即从替补席补员。挂起回合流程，等待补员交互完成后再续跑
        // （continueTurnFlow 会接着执行风铃强制行动、额外行动与换边逻辑）。
        if (this.beginPendingReinforcement(gameState)) {
            gameState.reinforceResumeContext = {
                heroId: hero.id,
                isFinishingExtraActionHero: !!isFinishingExtraActionHero,
                isFinishingForcedActionHero: !!isFinishingForcedActionHero,
            };
            gameState.activeHero = null; // 解除锁定，允许补员方进行上场交互
            return;
        }

        this.continueTurnFlow(hero, gameState, isFinishingExtraActionHero, isFinishingForcedActionHero);
    }

    /**
     * endHeroAction 的后半段流程（胜负/补员检查之后）：风铃强制行动 → 额外行动发起 → 收尾切边 → 智能切换。
     * 补员挂起恢复时也会从这里继续，保证被中断的回合流程语义不变。
     */
    private static continueTurnFlow(
        hero: Hero,
        gameState: GameState,
        isFinishingExtraActionHero: boolean,
        isFinishingForcedActionHero: boolean,
    ): void {
        // 风铃的锁敌优先于额外行动：目标必须立刻完成并消耗自己的正常行动。
        const forcedActionHeroId = gameState.pendingForcedActionHeroId;
        gameState.pendingForcedActionHeroId = undefined;
        if (forcedActionHeroId) {
            const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];
            const forcedHero = allHeroes.find(candidate => candidate.id === forcedActionHeroId);
            if (forcedHero && forcedHero.state === HeroState.ALIVE && !forcedHero.hasActedThisTurn) {
                if (isFinishingExtraActionHero) {
                    const preActed = hero.counters['__extra_preActed'];
                    const preMoved = hero.counters['__extra_preMoved'];
                    if (preActed !== undefined || preMoved !== undefined) {
                        hero.hasActedThisTurn = preActed === 1;
                        hero.hasMovedThisTurn = preMoved === 1;
                        delete hero.counters['__extra_preActed'];
                        delete hero.counters['__extra_preMoved'];
                    }
                    gameState.performingExtraAction = false;
                    gameState.resumePlayer = undefined;
                }

                gameState.performingForcedAction = true;
                gameState.forcedActionResumePlayer = hero.owner;
                gameState.currentPlayer = forcedHero.owner;
                gameState.activeHero = forcedHero;
                this.addLog(gameState, {
                    type: 'system',
                    player: forcedHero.owner,
                    message: `${forcedHero.name}被风铃锁定，必须立即行动！`,
                });

                if (EffectManager.isStunned(forcedHero)) {
                    this.addLog(gameState, {
                        type: 'system',
                        player: forcedHero.owner,
                        message: `${forcedHero.name}无法行动，本回合行动机会被消耗`,
                    });
                    this.endHeroAction(forcedHero, gameState);
                }
                return;
            }
        }

        // 1. 检查是否有待执行的额外行动（如墨阑的天威或被动触发）
        const pendingExtra = gameState.pendingExtraActionHeroIds;
        const currentOwner = hero.owner;
        const otherOwner = currentOwner === 'player1' ? 'player2' : 'player1';
        const preferredExtraId = pendingExtra?.[currentOwner] ?? pendingExtra?.[otherOwner];
        const preferredExtraOwner: Player | undefined =
            pendingExtra?.[currentOwner] ? currentOwner : (pendingExtra?.[otherOwner] ? otherOwner : undefined);

        if (preferredExtraId && preferredExtraOwner) {
            const extraActionHeroId = preferredExtraId;
            if (gameState.pendingExtraActionHeroIds) {
                gameState.pendingExtraActionHeroIds[preferredExtraOwner] = undefined;
                const p = gameState.pendingExtraActionHeroIds;
                if (!p.player1 && !p.player2) {
                    gameState.pendingExtraActionHeroIds = undefined;
                }
            }

            // 查找英雄
            const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];
            const extraHero = allHeroes.find(h => h.id === extraActionHeroId);

            if (extraHero && extraHero.state === HeroState.ALIVE && !EffectManager.isStunned(extraHero)) {
                if (isFinishingForcedActionHero) {
                    gameState.performingForcedAction = false;
                    gameState.forcedActionResumePlayer = undefined;
                }
                // 允许该英雄再次行动
                extraHero.hasActedThisTurn = false;
                extraHero.hasMovedThisTurn = false;

                // 记录原本应该轮到的玩家（如果还没记录过，且当前不是已经在额外行动中）
                // 逻辑：如果当前是 P1 正常行动 -> 触发额外 -> 应该在额外结束后切给 P2
                // 如果当前是 P1 额外行动 -> 又触发额外 -> 保持 resumePlayer 不变
                if (!gameState.performingExtraAction) {
                    const originalPlayer = gameState.currentPlayer;
                    const otherPlayer = originalPlayer === 'player1' ? 'player2' : 'player1';
                    gameState.resumePlayer = extraHero.owner === originalPlayer ? otherPlayer : extraHero.owner;
                }

                // 标记正在执行额外行动
                gameState.performingExtraAction = true;

                // 切换控制权给该英雄的拥有者
                gameState.currentPlayer = extraHero.owner;
                gameState.activeHero = extraHero;

                // 添加日志
                this.addLog(gameState, {
                    type: 'system',
                    player: extraHero.owner,
                    message: `${extraHero.name}触发再次行动！`
                });

                // 直接返回，让该玩家继续行动
                return;
            }
        }

        // 2. 如果当前是额外行动结束
        if (gameState.performingForcedAction && isFinishingForcedActionHero) {
            gameState.performingForcedAction = false;
            gameState.activeHero = null;
            gameState.currentPlayer = gameState.forcedActionResumePlayer ??
                (gameState.currentPlayer === 'player1' ? 'player2' : 'player1');
            gameState.forcedActionResumePlayer = undefined;
        } else if (gameState.performingExtraAction) {
            if (isFinishingExtraActionHero) {
                const preActed = hero.counters['__extra_preActed'];
                const preMoved = hero.counters['__extra_preMoved'];
                if (preActed !== undefined || preMoved !== undefined) {
                    hero.hasActedThisTurn = preActed === 1;
                    hero.hasMovedThisTurn = preMoved === 1;
                    delete hero.counters['__extra_preActed'];
                    delete hero.counters['__extra_preMoved'];
                } else {
                    hero.hasActedThisTurn = true;
                }
            }
            gameState.performingExtraAction = false;
            gameState.activeHero = null;

            // 恢复原本应该行动的玩家
            if (gameState.resumePlayer) {
                gameState.currentPlayer = gameState.resumePlayer;
                gameState.resumePlayer = undefined;
            } else {
                // 如果没有记录 resumePlayer（异常情况），默认切给对方
                 gameState.currentPlayer = gameState.currentPlayer === 'player1' ? 'player2' : 'player1';
            }
        } else {
            // 正常行动结束，准备切换给对方
            gameState.currentPlayer = gameState.currentPlayer === 'player1' ? 'player2' : 'player1';
        }

        // 3. 智能切换逻辑：检查当前确定的 currentPlayer 是否有行动能力
        // 此时 gameState.currentPlayer 已经是理论上的下一个玩家
        
        let p1Available = this.getAvailableHeroesForPlayer(gameState, 'player1');
        let p2Available = this.getAvailableHeroesForPlayer(gameState, 'player2');

        // 如果双方都没得动了，结束回合
        if (p1Available.length === 0 && p2Available.length === 0) {
            this.endTurn(gameState);
            return;
        }

        // 检查当前玩家是否有行动能力
        const currentHasAction = gameState.currentPlayer === 'player1' ? p1Available.length > 0 : p2Available.length > 0;

        if (!currentHasAction) {
            // 当前玩家没得动，尝试切给对方
            const otherPlayer = gameState.currentPlayer === 'player1' ? 'player2' : 'player1';
            const otherHasAction = otherPlayer === 'player1' ? p1Available.length > 0 : p2Available.length > 0;

            if (otherHasAction) {
                // 对方有得动，切给对方
                gameState.currentPlayer = otherPlayer;
                this.addLog(gameState, {
                    type: 'system',
                    player: gameState.currentPlayer,
                    message: `轮到 ${gameState.currentPlayer === 'player1' ? '玩家1' : '玩家2'} 行动`
                });
            } else {
                // 对方也没得动？这应该被上面的 (p1=0 && p2=0) 拦截了
                // 但为了保险，强制结束回合
                this.endTurn(gameState);
                return;
            }
        }
        
        // 如果 currentHasAction 为 true，则保持当前 currentPlayer 不变
        
        // 解除锁定
        gameState.activeHero = null;

        // 检查胜负
        this.checkWinCondition(gameState);
    }

    /**
     * 结束回合
     */
    private static endTurn(gameState: GameState): void {
        // 触发回合结束效果
        this.triggerTurnEndEffects(gameState);

        // 进入下一轮
        gameState.roundNumber++;

        // 开始新回合
        this.startNewTurn(gameState);
    }

    /**
     * 检查胜利条件（替补制）：只有当一方"场上无存活单位且替补席已耗尽"（六人全灭）才判负。
     * 替补席尚有英雄未上场时，即使场上暂时无人也视为可以继续（等待补员上场）。
     */
    static checkWinCondition(gameState: GameState): void {
        if (gameState.phase === 'ended') return;
        const isAliveOnBoard = (hero: Hero) => {
            if (hero.state !== HeroState.ALIVE || !hero.position) return false;
            const [row, col] = hero.position;
            return gameState.board[row]?.[col] === hero;
        };
        // 替补席仍有英雄 = 该方尚未全灭（还有可上场战力）
        const p1HasBench = (gameState.player1BenchHeroIds?.length ?? 0) > 0;
        const p2HasBench = (gameState.player2BenchHeroIds?.length ?? 0) > 0;
        const p1AllDead = !gameState.player1Heroes.some(isAliveOnBoard) && !p1HasBench;
        const p2AllDead = !gameState.player2Heroes.some(isAliveOnBoard) && !p2HasBench;

        if (p1AllDead && p2AllDead) {
            // 双方同时全灭（极罕见）：判平局处理为进攻方失败前的最后状态，这里按先手方判负
            gameState.winner = 'player2';
            gameState.phase = 'ended';
            this.addLog(gameState, {
                type: 'system',
                player: 'player2',
                message: '双方所有英雄阵亡，玩家1先手告负，玩家2获胜！'
            });
        } else if (p1AllDead) {
            gameState.winner = 'player2';
            gameState.phase = 'ended';
            this.addLog(gameState, {
                type: 'system',
                player: 'player2',
                message: '玩家1所有英雄阵亡，玩家2获胜！'
            });
        } else if (p2AllDead) {
            gameState.winner = 'player1';
            gameState.phase = 'ended';
            this.addLog(gameState, {
                type: 'system',
                player: 'player1',
                message: '玩家2所有英雄阵亡，玩家1获胜！'
            });
        }
    }

    /**
     * 统计一方场上真实存活数：排除克隆体；TEMP_DEAD 不计入（与胜负判定口径一致）。
     */
    static countRealAliveOnBoard(gameState: GameState, player: Player): number {
        return [...(player === 'player1' ? gameState.player1Heroes : gameState.player2Heroes)]
            .filter(hero =>
                hero.state === HeroState.ALIVE &&
                hero.counters?.['__isClone'] !== 1 &&
                !hero.id.startsWith('wukong-clone|') &&
                !hero.id.startsWith('mirror-clone|') &&
                hero.position &&
                (() => {
                    const [row, col] = hero.position!;
                    return gameState.board[row]?.[col] === hero;
                })()
            ).length;
    }

    /**
     * 替补制补员调度：若存在"替补席非空且场上存活<4"的一方，将其设为 reinforcingPlayer 并返回 true（挂起当前流程等待补员交互）。
     * 先检查 player1 后 player2；无待补员时清除标记并返回 false。
     */
    static beginPendingReinforcement(gameState: GameState): boolean {
        if (gameState.phase === 'ended') return false;
        for (const player of ['player1', 'player2'] as Player[]) {
            const bench = player === 'player1' ? gameState.player1BenchHeroIds : gameState.player2BenchHeroIds;
            if ((bench?.length ?? 0) > 0 && this.countRealAliveOnBoard(gameState, player) < 4) {
                gameState.reinforcingPlayer = player;
                gameState.reinforcementSelectableHeroId = null;
                return true;
            }
        }
        gameState.reinforcingPlayer = null;
        return false;
    }

    /**
     * 补员上场完成后由 store 调用：若仍存在待补员方（可能换边）则继续挂起；
     * 否则清除挂起标记并按 endHeroAction 挂起时的上下文续跑回合流程。
     */
    static afterReinforcementDeployed(gameState: GameState): void {
        if (this.beginPendingReinforcement(gameState)) return; // 还有待补员（可能是另一方）
        gameState.reinforcingPlayer = null;
        gameState.reinforcementSelectableHeroId = null;
        const ctx = gameState.reinforceResumeContext;
        gameState.reinforceResumeContext = undefined;
        if (!ctx) return; // startNewTurn 型挂起：回合流程已就绪，无需续跑
        const hero = [...gameState.player1Heroes, ...gameState.player2Heroes]
            .find(candidate => candidate.id === ctx.heroId);
        if (!hero || hero.state === HeroState.DEAD) {
            // 防御：上下文英雄不可用时退化为正常切边，避免卡死
            gameState.activeHero = null;
            gameState.currentPlayer = gameState.currentPlayer === 'player1' ? 'player2' : 'player1';
            return;
        }
        this.continueTurnFlow(hero, gameState, !!ctx.isFinishingExtraActionHero, !!ctx.isFinishingForcedActionHero);
    }

    /**
     * 触发回合开始效果
     */
    private static triggerTurnStartEffects(gameState: GameState): void {
        const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];

        for (const hero of allHeroes) {
            if (hero.state !== HeroState.ALIVE) continue;

            if (hero.passiveId === 'baize_passive') {
                const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
                const aliveAllies = allies.filter(h => h.state === HeroState.ALIVE);
                if (aliveAllies.length === 0) continue;

                const shuffled = [...aliveAllies].sort(() => Math.random() - 0.5);
                const picked = shuffled.slice(0, Math.min(2, shuffled.length));
                for (const p of picked) {
                    EffectManager.addCounter(p, '白泽之力', 1);
                }

                const names = picked.map(p => p.name).join('、');
                this.addLog(gameState, {
                    type: 'passive',
                    player: hero.owner,
                    message: `${hero.name}被动触发：${names}获得白泽之力+1`
                });
            }

            if (hero.passiveId === 'mowen_passive') {
                if (hero.counters['talent_1'] && !hero.counters['__mowen_talent1_applied']) {
                    hero.counters['__mowen_talent1_applied'] = 1;
                    hero.maxHp += 8;
                    hero.currentHp += 8;
                    hero.counters['mowen_prev_hp'] = hero.maxHp;
                }
            }

            if (
                hero.passiveId === 'feixue_passive' &&
                hero.counters['talent_1'] &&
                !hero.counters['__feixue_talent1_applied']
            ) {
                hero.counters['__feixue_talent1_applied'] = 1;
                hero.maxHp += 8;
                hero.currentHp += 8;
            }

            // 墨阑致知1：生命增加10
            if (
                hero.passiveId === 'moran_passive' &&
                hero.counters['talent_1'] &&
                !hero.counters['__moran_talent1_applied']
            ) {
                hero.counters['__moran_talent1_applied'] = 1;
                hero.maxHp += 10;
                hero.currentHp += 10;
            }

            if (hero.passiveId === 'bounty_passive' && hero.counters['bounty_placed'] !== 1) {
                // 被动：战斗开始（第一回合）向敌方全员随机发布一次悬赏
                hero.counters['bounty_placed'] = 1;
                const assignments = placeBounties(hero, gameState);
                if (assignments.length > 0) {
                    this.addLog(gameState, {
                        type: 'passive',
                        player: hero.owner,
                        message: `${hero.name}被动触发，发布悬赏：${assignments.join('、')}`
                    });
                }
            }
        }
    }

    /**
     * 触发行动结束效果
     */
    private static triggerActionEndEffects(hero: Hero, gameState: GameState): void {
        if (hero.passiveId === 'pipa_passive' && hero.position) {
            const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            const count = allies.filter(item =>
                item.state === HeroState.ALIVE && item.position &&
                MovementSystem.getManhattanDistance(hero.position!, item.position) <= 1
            ).length;
            this.applyDirectHeal(hero, Math.min(5, count * 2), gameState);
        }

        for (const wangcai of (hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes)
            .filter(item => item.passiveId === 'wangcai_passive')) {
            if (hero.effects.some(effect => effect.name === '来财' && effect.sourceHeroId === wangcai.id)) {
                EffectManager.addCounter(wangcai, '财气', 1);
                if (wangcai.counters['wangcai_transformed'] === 1) {
                    wangcai.baseAttack = (wangcai.baseAttack ?? 0) + 1;
                }
                this.transformWangcaiIfReady(wangcai, gameState);
            }
        }

        // 上官婉儿：行动结束后，她落下的毛笔朝自己移动1格，经过的敌人受到6点固定伤害
        if (hero.passiveId === 'shangguan_passive' && hero.position) {
            this.moveShangguanBrushes(hero, gameState);
        }
    }

    /**
     * 上官婉儿的毛笔每回合朝她移动1格；移动到的格子若有敌人则造成6点固定伤害；
     * 毛笔抵达上官婉儿所在格时消失。毛笔寿命最多3次移动（复用 duration 字段），
     * 耗尽后自动消散。毛笔为不可规避的固定伤害。
     */
    private static moveShangguanBrushes(hero: Hero, gameState: GameState): void {
        const brushes = (gameState.boardEffects ?? []).filter(
            effect => effect.type === 'brush' && effect.sourceHeroId === hero.id
        );
        if (brushes.length === 0) return;
        const [hr, hc] = hero.position!;
        const toRemove = new Set<string>();

        for (const brush of brushes) {
            const [br, bc] = brush.position;
            if (br === hr && bc === hc) {
                toRemove.add(brush.id);
                continue;
            }
            const stepR = br < hr ? 1 : br > hr ? -1 : 0;
            const stepC = bc < hc ? 1 : bc > hc ? -1 : 0;
            const nr = br + stepR;
            const nc = bc + stepC;
            if (nr < 0 || nr >= 6 || nc < 0 || nc >= 6) continue;

            brush.position = [nr, nc];
            // 寿命递减：brush 豁免 boardEffect 的 duration 自动衰减，这里手动管理
            brush.duration = (brush.duration ?? 0) - 1;

            const occupant = gameState.board[nr][nc];
            if (occupant && occupant.owner !== hero.owner && occupant.state === HeroState.ALIVE) {
                const dmg = DamageCalculator.calculate(hero, occupant, 6, false, false, { fixedDamage: true, canCrit: false });
                DamageCalculator.applyDamage(occupant, dmg, hero, gameState);
                this.addLog(gameState, {
                    type: 'passive',
                    player: hero.owner,
                    message: `毛笔掠过${occupant.name}，造成${dmg.finalDamage}点伤害`,
                });
            }
            if ((nr === hr && nc === hc) || (brush.duration ?? 0) <= 0) {
                if ((brush.duration ?? 0) <= 0 && !(nr === hr && nc === hc)) {
                    this.addLog(gameState, {
                        type: 'passive',
                        player: hero.owner,
                        message: `一支毛笔墨迹用尽，消散于纸上`,
                    });
                }
                toRemove.add(brush.id);
            }
        }

        if (toRemove.size > 0) {
            gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => !toRemove.has(effect.id));
        }
    }

    private static applyDirectHeal(hero: Hero, amount: number, gameState: GameState): void {
        const hpBefore = hero.currentHp;
        hero.currentHp = Math.min(hero.maxHp, hero.currentHp + Math.max(0, Math.floor(amount)));
        recordBattleHealing(gameState, hero, hero.currentHp - hpBefore);
    }

    static transformWangcaiIfReady(hero: Hero, gameState: GameState): void {
        if (hero.counters['wangcai_transformed'] === 1 || (hero.counters['财气'] ?? 0) < 7) return;
        hero.counters['wangcai_transformed'] = 1;
        if (hero.state === HeroState.DEAD) {
            const position = MovementSystem.findNearestEmptyPosition(hero.position ?? [0, 0], gameState);
            if (!position) return;
            hero.state = HeroState.ALIVE;
            hero.position = position;
            hero.currentHp = hero.maxHp;
            gameState.board[position[0]][position[1]] = hero;
            this.recordResurrection(hero, gameState);
        } else {
            this.applyDirectHeal(hero, hero.maxHp * 0.5, gameState);
        }
    }

    /**
     * 触发回合结束效果
     */
    private static triggerTurnEndEffects(gameState: GameState): void {
        const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];

        for (const hero of allHeroes) {
            if (hero.state !== HeroState.ALIVE) continue;

            if (hero.passiveId === 'skeletonking_passive') {
                const dead = allHeroes.filter(item => item.state !== HeroState.ALIVE).length;
                if (dead > 0) {
                    // 叠加式护盾：每名阵亡单位提供3点，没有致知时上限为10（致知可提高上限）
                    const shieldCap = 10;
                    const gained = Math.min(shieldCap, hero.shield + dead * 3) - hero.shield;
                    hero.shield = Math.min(shieldCap, hero.shield + dead * 3);
                    if (gained > 0) {
                        this.addLog(gameState, {
                            type: 'passive',
                            player: hero.owner,
                            message: `${hero.name}的亡灵之力凝聚，获得${gained}点护盾（当前${hero.shield}）`
                        });
                    }
                }
            }

            if (hero.passiveId === 'hero_x_passive' && hero.position) {
                const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
                for (const enemy of enemies) {
                    if (enemy.state !== HeroState.ALIVE || !enemy.position) continue;
                    if (MovementSystem.getManhattanDistance(hero.position, enemy.position) > 2) continue;
                    EffectManager.addEffect(enemy, {
                        type: 'debuff',
                        name: '震怒',
                        duration: -1,
                        stackCount: 1,
                        sourceHeroId: hero.id,
                        description: '达到3层时眩晕',
                    });
                    const rage = enemy.effects.find(effect => effect.name === '震怒' && effect.sourceHeroId === hero.id);
                    if ((rage?.stackCount ?? 0) >= 3) {
                        enemy.effects = enemy.effects.filter(effect => effect !== rage);
                        EffectManager.addEffect(enemy, {
                            type: 'stun',
                            name: '震怒眩晕',
                            duration: 2,
                            sourceHeroId: hero.id,
                            description: '下一次行动被跳过',
                        });
                        this.addLog(gameState, {
                            type: 'passive',
                            player: enemy.owner,
                            message: `${enemy.name}震怒叠加至3层，进入眩晕`
                        });
                    } else {
                        this.addLog(gameState, {
                            type: 'passive',
                            player: enemy.owner,
                            message: `${enemy.name}获得震怒+1（当前${rage?.stackCount ?? 1}层）`
                        });
                    }
                }
            }

            if (hero.passiveId === 'hanjiangxue_passive') {
                // 被动·雪誓：回合结束时，为生命百分比最低的友方（不含自己）附加冰甲（不可叠加）
                const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
                let bestAlly: Hero | null = null;
                let bestRatio = Infinity;
                for (const ally of allies) {
                    if (ally.id === hero.id || ally.state !== HeroState.ALIVE) continue;
                    const ratio = ally.maxHp > 0 ? ally.currentHp / ally.maxHp : 1;
                    if (ratio < bestRatio) {
                        bestRatio = ratio;
                        bestAlly = ally;
                    }
                }
                if (bestAlly && EffectManager.addIceArmor(bestAlly, hero.id)) {
                    this.addLog(gameState, {
                        type: 'passive',
                        player: hero.owner,
                        message: `${hero.name}的雪誓保护${bestAlly.name}，为其附加冰甲`
                    });
                }
            }

            // 沉渊·镇岳被动「极寒领域」：周围一格范围属于极寒领域，
            // 每回合结束时领域内的敌人获得1层寒天
            if (hero.passiveId === 'chenyuan_passive' && hero.position) {
                const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
                for (const enemy of enemies) {
                    if (enemy.state !== HeroState.ALIVE || !enemy.position) continue;
                    if (MovementSystem.getManhattanDistance(hero.position, enemy.position) > 1) continue;
                    DamageCalculator.applyHantianStacks(enemy, 1, hero.id, gameState);
                    if (enemy.state === HeroState.ALIVE) {
                        this.addLog(gameState, {
                            type: 'passive',
                            player: enemy.owner,
                            message: `${enemy.name}陷入${hero.name}的极寒领域，获得1层寒天（当前${DamageCalculator.getHantianStackCount(enemy)}层）`
                        });
                    }
                }
            }
        }
    }

    /**
     * 复活英雄
     */
    static resurrectHero(
        hero: Hero,
        hpPercent: number,
        gameState: GameState
    ): boolean {
        if (hero.state !== HeroState.TEMP_DEAD) return false;

        let revivePosition: [number, number] | null = null;
        if (!hero.position) {
            revivePosition = MovementSystem.findNearestEmptyPosition([0, 0], gameState);
        } else {
            const [row, col] = hero.position;
            const occupant = gameState.board[row][col];
            if (occupant === null || occupant === hero) {
                revivePosition = [row, col];
            } else {
                revivePosition = MovementSystem.findNearestEmptyPosition(hero.position, gameState);
            }
        }

        // 必须先找到位置再改变状态，失败时保持 TEMP_DEAD、0 HP 和离场状态。
        if (!revivePosition) return false;

        // 优先恢复暂时阵亡时的生命值；无记录时按比例复活
        const recordedHp = hero.counters['__temp_dead_hp'];
        const reviveHp = typeof recordedHp === 'number' && recordedHp > 0
            ? Math.max(1, Math.min(hero.maxHp, Math.floor(recordedHp)))
            : Math.max(1, Math.min(hero.maxHp, Math.floor(hero.maxHp * hpPercent)));
        delete hero.counters['__temp_dead_hp'];

        hero.currentHp = reviveHp;
        hero.state = HeroState.ALIVE;
        hero.position = revivePosition;
        // 复活后本回合可正常行动
        hero.hasActedThisTurn = false;
        hero.hasMovedThisTurn = false;
        gameState.board[revivePosition[0]][revivePosition[1]] = hero;
        delete hero.counters['soul_lamp_revive_round'];
        this.recordResurrection(hero, gameState);

        if (hero.passiveId === 'soul_lamp_passive') {
            // 魂灯复活后，移除其提供的临时吸血（真实死亡留下的永久吸血不受影响）
            const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            for (const ally of allies) {
                ally.effects = ally.effects.filter(effect =>
                    !(effect.name === '缚魂吸血' && effect.sourceHeroId === hero.id)
                );
            }
        }

        this.addLog(gameState, {
            type: 'system',
            player: hero.owner,
            message: `${hero.name}复活了！生命值：${hero.currentHp}`
        });

        return true;
    }

    private static recordResurrection(hero: Hero, gameState: GameState): void {
        if (hero.owner === 'player1') {
            gameState.deathCounters.player1Resurrections++;
        } else {
            gameState.deathCounters.player2Resurrections++;
        }
    }

    /**
     * 暂时死亡
     */
    static tempDeath(hero: Hero, gameState: GameState): void {
        if (hero.state !== HeroState.ALIVE) return;

        const oldPosition = hero.position ? [...hero.position] as [number, number] : null;
        // 记录暂时阵亡时的生命值，供复活时恢复（如骸骨君王·亡灵唤回）
        hero.counters['__temp_dead_hp'] = hero.currentHp;
        hero.state = HeroState.TEMP_DEAD;
        hero.currentHp = 0;
        if (oldPosition && gameState.board[oldPosition[0]]?.[oldPosition[1]] === hero) {
            gameState.board[oldPosition[0]][oldPosition[1]] = null;
        }

        if (hero.owner === 'player1') gameState.deathCounters.player1Dead++;
        else gameState.deathCounters.player2Dead++;
        gameState.deathCounters.totalDead++;

        if (oldPosition) {
            const inCircle = gameState.boardEffects?.some(effect =>
                effect.type === 'dark-circle' &&
                effect.owner === hero.owner &&
                effect.sourceHeroId !== hero.id &&
                Math.abs(effect.position[0] - oldPosition[0]) <= 1 &&
                Math.abs(effect.position[1] - oldPosition[1]) <= 1
            );
            if (inCircle) {
                if (hero.owner === 'player1') gameState.deathCounters.player1Dead++;
                else gameState.deathCounters.player2Dead++;
            }
        }

        if (hero.passiveId === 'jetzmi_passive') {
            hero.counters['jetzmi_form'] = hero.counters['jetzmi_form'] === 1 ? 0 : 1;
        }

        if (hero.passiveId === 'soul_lamp_passive') {
            // 暂时阵亡：给受益者临时吸血；若已有永久吸血则不覆盖
            const beneficiary = findSoulLampBeneficiary(hero, gameState);
            if (beneficiary) {
                const permanent = beneficiary.effects.some(effect =>
                    effect.name === '缚魂吸血·永驻' && effect.sourceHeroId === hero.id
                );
                if (!permanent) {
                    beneficiary.effects = beneficiary.effects.filter(effect =>
                        !(effect.name === '缚魂吸血' && effect.sourceHeroId === hero.id)
                    );
                    EffectManager.addEffect(beneficiary, {
                        type: 'buff',
                        name: '缚魂吸血',
                        duration: -1,
                        value: hero.counters['soul_lamp_vampire_rate'] ?? 0.3,
                        sourceHeroId: hero.id,
                        description: '缚魂灯暂时阵亡期间提供的吸血，魂灯复活后消失',
                    });
                }
            }
            // 每次死亡使吸血效果增强20%，上限90%
            hero.counters['soul_lamp_vampire_rate'] = Math.min(
                0.9,
                (hero.counters['soul_lamp_vampire_rate'] ?? 0.3) + 0.2
            );
        }

        if (oldPosition) {
            const circles = gameState.boardEffects?.filter(effect =>
                effect.type === 'dark-circle' &&
                effect.owner === hero.owner &&
                effect.sourceHeroId !== hero.id &&
                Math.abs(effect.position[0] - oldPosition[0]) <= 1 &&
                Math.abs(effect.position[1] - oldPosition[1]) <= 1
            ) ?? [];
            for (const circle of circles) {
                const source = [...gameState.player1Heroes, ...gameState.player2Heroes]
                    .find(candidate => candidate.id === circle.sourceHeroId);
                if (source?.state === HeroState.TEMP_DEAD) {
                    this.resurrectHero(source, 0.01, gameState);
                }
            }
        }

        this.addLog(gameState, {
            type: 'system',
            player: hero.owner,
            message: `${hero.name}暂时阵亡`
        });

        this.checkWinCondition(gameState);
    }

    /**
     * 杰茨米专属：使用技能导致的"暂时死亡"为原地形态切换。
     * 保留在棋盘上（位置、生命不变），但仍计入一次死亡事件（亡灵共鸣）。
     * 真实死亡仍走 handleDeath 离场。
     */
    static switchJetzmiFormInPlace(hero: Hero, gameState: GameState): void {
        if (hero.state !== HeroState.ALIVE) return;

        hero.counters['jetzmi_form'] = hero.counters['jetzmi_form'] === 1 ? 0 : 1;

        // 计入一次死亡事件（亡灵共鸣）
        if (hero.owner === 'player1') gameState.deathCounters.player1Dead++;
        else gameState.deathCounters.player2Dead++;
        gameState.deathCounters.totalDead++;

        this.addLog(gameState, {
            type: 'system',
            player: hero.owner,
            message: `${hero.name}切换为${hero.counters['jetzmi_form'] === 1 ? '终焉国王' : '亡灵城主'}形态`
        });
    }

    /**
     * 添加战斗日志
     */
    static addLog(gameState: GameState, entry: Omit<BattleLogEntry, 'id' | 'timestamp'>): void {
        const newEntry: BattleLogEntry = {
            ...entry,
            id: `log-${Date.now()}-${Math.random()}`,
            timestamp: Date.now()
        };

        gameState.battleLog.push(newEntry);

        if (gameState.battleLog.length > 200) {
            gameState.battleLog = gameState.battleLog.slice(-200);
        }
    }

    /**
     * 获取当前玩家可操作的英雄
     */
    static getAvailableHeroes(gameState: GameState): Hero[] {
        const heroes = gameState.currentPlayer === 'player1'
            ? gameState.player1Heroes
            : gameState.player2Heroes;

        return heroes.filter(
            h => h.state === HeroState.ALIVE &&
                !h.hasActedThisTurn &&
                !EffectManager.isStunned(h)
        );
    }

    /**
     * 检查是否可以进行行动
     */
    static canPerformAction(hero: Hero, gameState: GameState): boolean {
        // 检查是否是当前玩家的英雄
        if (hero.owner !== gameState.currentPlayer) return false;

        // 检查英雄状态
        if (hero.state !== HeroState.ALIVE) return false;

        // 检查是否已行动
        if (hero.hasActedThisTurn) return false;

        // 检查是否被眩晕
        if (EffectManager.isStunned(hero)) return false;

        return true;
    }
}
