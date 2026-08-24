import { useEffect, useRef } from 'react';
import {
    chooseComputerBeneficiary,
    chooseComputerDeployment,
    chooseComputerHero,
    chooseComputerMove,
    chooseComputerPendingBoardPosition,
    chooseComputerReviveTarget,
    chooseComputerSkillPlan,
    chooseComputerSupportTarget,
    chooseComputerTeam,
    chooseComputerTemporaryDeadTarget,
    chooseComputerWukongStepPosition,
    chooseComputerWukongStrikeTarget,
    planJointMoveForHero,
    resetCachedComputerTeam,
    scoreComputerPosition,
    setComputerAiDifficulty,
} from '../core/computer-ai';
import { useGameStore } from '../store/game-store';
import type { AiDifficulty, GameState, Hero, Player, Position, Skill } from '../types/game';
import { getLibaiFrontRect, scanShangguanDashDirection } from '../data/extended-skills';

const AI_PLAYER = 'player2' as const;
const THINK_DELAY_MS = 430;

function samePosition(left: Position, right: Position): boolean {
    return left[0] === right[0] && left[1] === right[1];
}

/** 效果签名：只取效果 ID 排序拼接，避免把 duration 等易变字段算进签名。 */
function effectSignature(hero: Hero): string {
    return hero.effects.map(effect => effect.id).sort().join('+');
}

function stateSignature(state: ReturnType<typeof useGameStore.getState>): string {
    return [
        state.phase,
        state.currentPlayer,
        state.roundNumber,
        state.actionsThisTurn,
        state.selectedHero?.id ?? '-',
        state.selectedSkill?.id ?? '-',
        state.moveRange.length,
        state.skillRange.length,
        state.pendingSkillTargetPositions?.length ?? 0,
        state.baizeReviveTargetHeroId ?? '-',
        state.changliSkill2Empowered ? 1 : 0,
        state.jetzmiSkill1Enhanced ? 1 : 0,
        state.pendingBoardAction?.heroId ?? '-',
        state.shangguanDashState
            ? `${state.shangguanDashState.heroId}:${[...state.shangguanDashState.hitTargets].sort().join(',')}`
            : '-',
        // 悟空分身指挥的挂起状态：阶段/当前分身序号/是否已移动/已选目标数都会改变下一步决策
        state.wukongSkill2State
            ? `${state.wukongSkill2State.phase}:${state.wukongSkill2State.clonePickIndex}:${state.wukongSkill2State.wukongMoved ? 1 : 0}:${Object.keys(state.wukongSkill2State.cloneTargetsByCloneId).length}`
            : '-',
        state.player2Heroes.map(hero =>
            `${hero.id}:${hero.state}:${hero.currentHp}:${hero.shield}:${effectSignature(hero)}:${hero.position?.join(',') ?? '-'}`
        ).join(';'),
        state.player1Heroes.map(hero =>
            `${hero.id}:${hero.state}:${hero.currentHp}:${hero.shield}:${effectSignature(hero)}:${hero.position?.join(',') ?? '-'}`
        ).join(';'),
    ].join('|');
}

function fallbackTargetPosition(
    state: GameState & { skillRange: Position[] },
    caster: Hero,
    skill: Skill
): Position | null {
    const positions = state.skillRange;
    if (positions.length === 0) return null;

    return [...positions].sort((left, right) => {
        const score = (position: Position) => {
            const target = state.board[position[0]][position[1]];
            if (skill.targetType === 'empty') {
                return target ? -1000 : scoreComputerPosition(state, caster, position);
            }
            if (target && target.owner !== caster.owner) {
                const hpRatio = target.maxHp > 0 ? Math.min(1, (target.currentHp + target.shield) / target.maxHp) : 1;
                return 100 + (1 - hpRatio) * 80;
            }
            if (target?.owner === caster.owner) {
                const missingHp = target.maxHp - target.currentHp;
                return skill.targetType === 'ally' ? missingHp * 3 : 5;
            }
            return skill.rangeType === 'area' || skill.rangeType === 'line' ? 10 : -20;
        };
        return score(right) - score(left);
    })[0] ?? null;
}

function nextPlannedTarget(
    state: ReturnType<typeof useGameStore.getState>,
    caster: Hero,
    skill: Skill
): Position | null {
    const plan = chooseComputerSkillPlan(state, caster, skill.id);
    const pending = state.pendingSkillTargetPositions ?? [];
    const allowed = state.skillRange;
    const isAllowed = (position: Position) => allowed.length === 0 || allowed.some(candidate => samePosition(candidate, position));

    // 凋零之主技能1：第二个位置必须与第一个位置成对角（构成 2x2 区域）
    if (skill.id === 'wither_lord_skill1' && pending.length === 1) {
        const [first] = pending;
        const isDiagonal = (position: Position) =>
            Math.abs(position[0] - first[0]) === 1 && Math.abs(position[1] - first[1]) === 1;
        const fromPlan = plan?.targetPositions.find(position =>
            isDiagonal(position) && isAllowed(position) && !pending.some(candidate => samePosition(candidate, position))
        );
        if (fromPlan) return fromPlan;
        const fallback = allowed.find(isDiagonal);
        if (fallback) return fallback;
        return null;
    }

    const unused = plan?.targetPositions.find(position =>
        isAllowed(position) && !pending.some(candidate => samePosition(candidate, position))
    );
    if (unused) return unused;

    const canFinishEarly = skill.id === 'wangcai_skill2';
    if (canFinishEarly && pending.length > 0) return pending[0];
    return fallbackTargetPosition(state, caster, skill);
}

function configurePassiveChoice(state: ReturnType<typeof useGameStore.getState>, caster: Hero): boolean {
    const store = useGameStore.getState();
    if (
        caster.passiveId === 'hero_x_passive' &&
        (caster.counters['增势'] ?? 0) >= 3 &&
        !state.heroXRedirectTargetIds?.[caster.id]
    ) {
        const target = chooseComputerSupportTarget(state, caster);
        if (target) {
            store.selectHeroXRedirectTarget(target.id);
            return true;
        }
    }
    if (caster.passiveId === 'soul_lamp_passive' && !state.soulLampBeneficiaryIds?.[caster.id]) {
        const target = chooseComputerBeneficiary(state, caster);
        if (target) {
            store.selectSoulLampBeneficiary(target.id);
            return true;
        }
    }
    return false;
}

function executeSelectedSkillStep(
    state: ReturnType<typeof useGameStore.getState>,
    aiPlayer: Player
): void {
    const store = useGameStore.getState();
    const caster = state.selectedHero;
    const skill = state.selectedSkill;
    if (!caster || !skill) return;

    if (skill.id === 'baize_skill2' && (caster.counters['天禄'] ?? 0) >= 3) {
        const dead = chooseComputerReviveTarget(state, aiPlayer);
        if (dead && state.baizeReviveTargetHeroId !== dead.id) {
            store.selectBaizeReviveTarget(dead.id);
            return;
        }
    }

    if (skill.id === 'jetzmi_skill2') {
        const dead = chooseComputerTemporaryDeadTarget(state, aiPlayer);
        if (dead && state.skillSelectedHeroIds?.[caster.id] !== dead.id) {
            store.selectSkillHeroTarget(dead.id);
            return;
        }
    }

    if (skill.id === 'jetzmi_skill1' && (caster.counters['jetzmi_form'] ?? 0) !== 1) {
        const resonance = caster.owner === 'player1'
            ? state.deathCounters.player1Dead
            : state.deathCounters.player2Dead;
        if (resonance >= 2 && !state.jetzmiSkill1Enhanced) {
            const plan = chooseComputerSkillPlan(state, caster, skill.id);
            if (plan && plan.targetPositions.length >= 2) {
                store.toggleJetzmiSkill1Enhanced();
                return;
            }
        }
    }

    if (
        skill.id === 'changli_skill2' &&
        (caster.counters['暗夜星火'] ?? 0) >= 2 &&
        !state.changliSkill2Empowered
    ) {
        store.toggleChangliSkill2Empowered();
        return;
    }

    if (skill.id === 'shangguan_skill2' && caster.passiveId === 'shangguan_passive') {
        // 连冲（含多段挂起）：扫描四方向选收益最高的一段执行；无可冲方向则结束行动
        if (!caster.position) return;
        const dash = state.shangguanDashState?.heroId === caster.id ? state.shangguanDashState : undefined;
        const hitTargets = dash ? [...dash.hitTargets] : [];
        let bestDirPos: Position | null = null;
        let bestScore = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const scan = scanShangguanDashDirection(caster, dr, dc, hitTargets, state);
            if (!scan.ok || !scan.landPos) continue;
            // 敌人价值高于毛笔借力
            let score = scan.kind === 'enemy' ? 10 : 3;
            if (scan.kind === 'enemy') {
                const victim = state.board[scan.targetPos![0]][scan.targetPos![1]];
                // 斩杀判定：撞敌固定 6 点伤害且不可闪避，护盾先抵扣
                if (victim && victim.currentHp + victim.shield <= 6) score += 30;
            }
            // 借力连锁一层：落点四方向还能继续冲则追加多段潜力分
            const probe = { ...caster, position: scan.landPos } as Hero;
            for (const [dr2, dc2] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                const second = scanShangguanDashDirection(probe, dr2, dc2, hitTargets, state);
                if (!second.ok) continue;
                score += second.kind === 'enemy' ? 8 : 4;
                break;
            }
            // 落点安危：连冲会强制位移，落点比原地更危险时要谨慎（可能因此放弃冲锋保命）
            const landingDelta =
                (scoreComputerPosition(state, caster, scan.landPos)
                    - scoreComputerPosition(state, caster, caster.position)) * 0.35;
            score += landingDelta;
            if (score > bestScore) {
                bestScore = score;
                bestDirPos = [caster.position[0] + dr, caster.position[1] + dc];
            }
        }
        if (bestDirPos) {
            store.executeSkill(bestDirPos);
        } else {
            store.endHeroAction();
        }
        return;
    }

    if (skill.id === 'zuizhendao_skill1' && caster.passiveId === 'zuizhendao_passive') {
        // 评估四个掷刀方向，选直线路径敌人收益最高的方向格执行
        if (!caster.position) return;
        let bestDirPos: Position | null = null;
        let bestScore = -1;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const dirPos: Position = [caster.position[0] + dr, caster.position[1] + dc];
            const end: Position = [caster.position[0] + dr * 3, caster.position[1] + dc * 3];
            if (end[0] < 0 || end[0] >= 6 || end[1] < 0 || end[1] >= 6) continue;
            const occupant = state.board[end[0]][end[1]];
            if (occupant && occupant !== caster) continue; // 刀落点需为空位
            let score = 0;
            for (let i = 1; i <= 3; i++) {
                const h = state.board[caster.position[0] + dr * i]?.[caster.position[1] + dc * i];
                if (h && h.owner !== caster.owner && h.state === 'alive') score += 4;
            }
            if (score > bestScore) {
                bestScore = score;
                bestDirPos = dirPos;
            }
        }
        if (bestDirPos) {
            store.executeSkill(bestDirPos);
        } else {
            store.endHeroAction();
        }
        return;
    }

    const target = nextPlannedTarget(state, caster, skill);
    if (!target) {
        store.endHeroAction();
        return;
    }
    store.executeSkill(target);
}

/** 李太白被动链的 AI 决策：选历史位置瞬移 -> 选技能攻击或跳过 -> 归位 */
function executeLibaiChainStep(
    state: ReturnType<typeof useGameStore.getState>,
    aiPlayer: Player
): void {
    const store = useGameStore.getState();
    const chain = state.libaiChainState;
    if (!chain) return;
    const libai = [...state.player1Heroes, ...state.player2Heroes].find(hero => hero.id === chain.heroId);
    if (!libai || libai.owner !== aiPlayer || libai.state !== 'alive') return;

    const isPickingPosition = state.skillRange.length > 0 && state.selectedSkill === null;
    if (isPickingPosition) {
        // 选位置阶段：评估每个历史位置瞬移后能打出的收益
        let best: Position | null = null;
        let bestScore = 0;
        for (const pos of chain.pending) {
            const score = libaiChainScoreAt(state, libai, pos);
            if (score > bestScore) {
                bestScore = score;
                best = pos;
            }
        }
        if (best) {
            store.selectLibaiChainPosition(best);
        } else {
            // 瞬移过去也打不到人：直接归位结束
            store.endHeroAction();
        }
        return;
    }

    // 攻击阶段（已瞬移）：选技能，打不到就跳过
    const zuiyi = libai.counters['醉意'] ?? 0;
    let bestSkillId: string | null = null;
    let bestDamage = 0;

    // 技能2 候选：醉斩（矩形范围，需要方向）
    if (zuiyi >= 1) {
        let bestDir = 0;
        let bestCount = 0;
        for (let dir = 0; dir < 4; dir++) {
            libai.counters['__libai_skill2_dir'] = dir;
            const rect = getLibaiFrontRect(libai);
            const count = rect.filter(([r, c]) => {
                const h = state.board[r]?.[c];
                return !!h && h.owner !== libai.owner && h.state === 'alive';
            }).length;
            if (count > bestCount) {
                bestCount = count;
                bestDir = dir;
            }
        }
        if (bestCount > 0) {
            bestSkillId = 'libai_skill2';
            bestDamage = zuiyi * 4 * bestCount;
            libai.counters['__libai_skill2_dir'] = bestDir;
        } else {
            delete libai.counters['__libai_skill2_dir'];
        }
    }

    // 技能1 候选：醉剑（十字内单体 7 伤害 + 1 醉意）
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const h = libai.position ? state.board[libai.position[0] + dr]?.[libai.position[1] + dc] : null;
        if (h && h.owner !== libai.owner && h.state === 'alive') {
            const value = 7 + (bestSkillId ? 0 : 1);
            if (value > bestDamage) {
                bestSkillId = 'libai_skill1';
                bestDamage = value;
                break;
            }
        }
    }

    if (!bestSkillId) {
        store.skipLibaiChainAttack();
        return;
    }
    store.selectSkill(bestSkillId);
    if (bestSkillId === 'libai_skill2') {
        // 方向已设置在 counter 上，直接点矩形内第一个敌人执行
        const rect = getLibaiFrontRect(libai);
        const enemyPos = rect.find(([r, c]) => {
            const h = state.board[r]?.[c];
            return !!h && h.owner !== libai.owner && h.state === 'alive';
        });
        if (enemyPos) {
            store.executeSkill(enemyPos);
        } else {
            store.skipLibaiChainAttack();
        }
        return;
    }
    // 技能1：直接点十字内敌人
    const crossEnemyPos = libai.position ? ([
        [-1, 0], [1, 0], [0, -1], [0, 1]
    ] as const).map(([dr, dc]) => [libai.position![0] + dr, libai.position![1] + dc] as Position)
        .find(([r, c]) => {
            const h = state.board[r]?.[c];
            return !!h && h.owner !== libai.owner && h.state === 'alive';
        }) : undefined;
    if (crossEnemyPos) {
        store.executeSkill(crossEnemyPos);
    } else {
        store.skipLibaiChainAttack();
    }
}

/** 评估李太白瞬移到指定位置后能打出的收益（技能1十字 + 技能2矩形，简化估值） */
function libaiChainScoreAt(
    state: ReturnType<typeof useGameStore.getState>,
    libai: Hero,
    pos: Position
): number {
    let score = 0;
    const zuiyi = libai.counters['醉意'] ?? 0;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const h = state.board[pos[0] + dr]?.[pos[1] + dc];
        if (h && h.owner !== libai.owner && h.state === 'alive') score += 10;
    }
    if (zuiyi >= 1) {
        const oldPos = libai.position;
        libai.position = pos;
        let bestCount = 0;
        for (let dir = 0; dir < 4; dir++) {
            libai.counters['__libai_skill2_dir'] = dir;
            const count = getLibaiFrontRect(libai).filter(([r, c]) => {
                const h = state.board[r]?.[c];
                return !!h && h.owner !== libai.owner && h.state === 'alive';
            }).length;
            if (count > bestCount) bestCount = count;
        }
        delete libai.counters['__libai_skill2_dir'];
        libai.position = oldPos;
        score += bestCount * 4;
    }
    return score;
}

/* ------------------------- 孙悟空分身指挥支持 ------------------------- */

/** 与 store 相同的行序扫描收集在板分身，保证 clonePickIndex 能对上当前分身。 */
function collectClonesInBoardOrder(state: GameState, cloneIds: string[]): Hero[] {
    const clones: Hero[] = [];
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            const hero = state.board[r][c];
            if (hero && hero.state === 'alive' && cloneIds.includes(hero.id)) clones.push(hero);
        }
    }
    return clones;
}

/** 分身兜底走位：没有"移动后有敌人"的好格时，挑评分最高的相邻空格移动，让 store 自动推进到下一分身。 */
function bestAnyAdjacentEmpty(state: GameState, unit: Hero): Position | null {
    if (!unit.position) return null;
    let best: Position | null = null;
    let bestScore = -Infinity;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const row = unit.position[0] + dr;
        const col = unit.position[1] + dc;
        if (row < 0 || row >= 6 || col < 0 || col >= 6) continue;
        if (state.board[row][col] !== null) continue;
        const score = scoreComputerPosition(state, unit, [row, col]);
        if (score > bestScore) {
            bestScore = score;
            best = [row, col];
        }
    }
    return best;
}

/**
 * 孙悟空技能2（身外化身）的 AI 决策：
 * - 本体阶段：优先直接打击 3x3 内收益最高的敌人；打不到且未移动则走位创造机会；否则结束行动。
 * - 分身阶段：依次指挥每个分身打击/走位；死角时借 store 的"任意点击自动跳过"推进到下一个分身。
 */
function executeWukongStep(
    state: ReturnType<typeof useGameStore.getState>,
    aiPlayer: Player
): void {
    const store = useGameStore.getState();
    const wState = state.wukongSkill2State;
    const skill = state.selectedSkill;
    if (!wState || !skill) return;
    const wukong = [...state.player1Heroes, ...state.player2Heroes]
        .find(hero => hero.id === wState.wukongId);
    if (!wukong || wukong.owner !== aiPlayer) return;

    if (wState.phase === 'pickWukongTarget') {
        const strike = wukong.state === 'alive'
            ? chooseComputerWukongStrikeTarget(state, wukong, skill)
            : null;
        if (strike) {
            store.executeSkill(strike);
            return;
        }
        if (!wState.wukongMoved && wukong.state === 'alive' && wukong.position) {
            const stepPos = chooseComputerWukongStepPosition(state, wukong);
            if (stepPos) {
                store.executeSkill(stepPos);
                return;
            }
        }
        // 无目标可打：正常结束行动，由 store 清理悟空挂起状态并结算已选目标
        store.endHeroAction();
        return;
    }

    const clones = collectClonesInBoardOrder(state, wState.cloneIds);
    if (clones.length === 0) {
        store.endHeroAction();
        return;
    }
    const currentIndex = Math.min(wState.clonePickIndex, clones.length - 1);
    const currentClone = clones[currentIndex];
    if (!currentClone?.position) {
        store.endHeroAction();
        return;
    }

    const moved = wState.cloneMovedById[currentClone.id] ?? false;
    const strike = chooseComputerWukongStrikeTarget(state, currentClone, skill);
    if (strike) {
        store.executeSkill(strike);
        return;
    }

    if (!moved) {
        const stepPos = chooseComputerWukongStepPosition(state, currentClone)
            ?? bestAnyAdjacentEmpty(state, currentClone);
        if (stepPos) {
            // 移动后若有敌人则下步继续打击；仍无敌人则 store 会自动跳过该分身
            store.executeSkill(stepPos);
            return;
        }
        // 未移动且无相邻空位：真死角，落到下方"任意点击自动跳过"
    }

    // 死角推进：无可打击目标且无法再移动时，store 会在目标校验前吞掉任意点击并自动推进
    store.executeSkill(currentClone.position);
}

/* --------------------------- 移动+技能联合规划 --------------------------- */

const JOINT_PLAN_SCORE_THRESHOLD = 55;

interface CachedJointMove {
    casterId: string;
    roundNumber: number;
    actionsThisTurn: number;
    position: Position;
}

let jointMoveCache: CachedJointMove | null = null;

/** 原地没有好技能时，评估"先移动到更优站位再放技能"，并把结论缓存供下一步的移动分支消费。 */
function rememberJointMovePlan(
    state: ReturnType<typeof useGameStore.getState>,
    caster: Hero
): void {
    if (
        jointMoveCache &&
        jointMoveCache.casterId === caster.id &&
        jointMoveCache.roundNumber === state.roundNumber &&
        jointMoveCache.actionsThisTurn === state.actionsThisTurn
    ) return; // 同一回合同一英雄只规划一次
    const plan = planJointMoveForHero(state, caster);
    jointMoveCache = plan
        ? {
              casterId: caster.id,
              roundNumber: state.roundNumber,
              actionsThisTurn: state.actionsThisTurn,
              position: plan.position,
          }
        : null;
}

/** 消费联合规划缓存：校验回合/行动序号/可达性，读后即清，避免跨回合污染。 */
function takeJointMovePosition(
    state: ReturnType<typeof useGameStore.getState>,
    hero: Hero | null
): Position | null {
    const cached = jointMoveCache;
    jointMoveCache = null;
    if (!cached || !hero || hero.hasMovedThisTurn) return null;
    if (cached.casterId !== hero.id) return null;
    if (cached.roundNumber !== state.roundNumber || cached.actionsThisTurn !== state.actionsThisTurn) return null;
    return state.moveRange.some(pos => samePosition(pos, cached.position)) ? cached.position : null;
}

function difficultyLabel(difficulty: AiDifficulty | undefined): string {
    switch (difficulty) {
        case 'easy': return '简单';
        case 'normal': return '普通';
        default: return '宗师';
    }
}

function executeBattleStep(
    state: ReturnType<typeof useGameStore.getState>,
    aiPlayer: Player
): void {
    const store = useGameStore.getState();

    if (state.libaiChainState) {
        executeLibaiChainStep(state, aiPlayer);
        return;
    }

    if (state.wukongSkill2State) {
        executeWukongStep(state, aiPlayer);
        return;
    }

    if (state.pendingBoardAction) {
        const hero = [...state.player1Heroes, ...state.player2Heroes]
            .find(candidate => candidate.id === state.pendingBoardAction?.heroId);
        if (hero?.owner === aiPlayer) {
            const position = chooseComputerPendingBoardPosition(state, hero);
            if (position) store.resolvePendingBoardAction(position);
            return;
        }
    }

    if (state.selectedSkill && state.selectedHero?.owner === aiPlayer) {
        executeSelectedSkillStep(state, aiPlayer);
        return;
    }

    if (state.moveRange.length > 0 && state.selectedHero?.owner === aiPlayer) {
        const hero = state.selectedHero;
        // 联合规划：若缓存了"移动后放技能"的更优站位且该格可达，直接移动过去
        const jointPos = takeJointMovePosition(state, hero);
        const move = jointPos ?? chooseComputerMove(state, hero);
        if (move) store.moveHero(move);
        else store.endHeroAction();
        return;
    }

    let caster = state.selectedHero;
    if (!caster || caster.owner !== aiPlayer) {
        caster = chooseComputerHero(state, aiPlayer);
        if (caster) store.selectHeroForAction(caster);
        return;
    }

    if (configurePassiveChoice(state, caster)) return;

    const skillPlan = chooseComputerSkillPlan(state, caster);
    const wantsReposition = !caster.hasMovedThisTurn && (!skillPlan || skillPlan.score < JOINT_PLAN_SCORE_THRESHOLD);

    // 联合规划：原地没有好技能时，评估"先移动到更优站位再放技能"是否显著更优
    if (wantsReposition) rememberJointMovePlan(state, caster);

    const move = chooseComputerMove(state, caster);
    if (wantsReposition && move) {
        store.showMoveRange();
        return;
    }

    if (skillPlan && skillPlan.score > 0) {
        // 记录最近使用的技能（0/1 技能序号），供技能轮换减分使用
        const realHero = [...state.player1Heroes, ...state.player2Heroes].find(candidate => candidate.id === caster.id);
        if (realHero) realHero.counters['__ai_last_skill_index'] = caster.skill1Id === skillPlan.skillId ? 0 : 1;
        store.selectSkill(skillPlan.skillId);
        return;
    }

    if (!caster.hasMovedThisTurn && move) {
        store.showMoveRange();
        return;
    }
    store.endHeroAction();
}

export function runComputerOpponentStep(repeatCount = 0): void {
    const state = useGameStore.getState();
    if (!state.isAiMode || state.aiPlayer !== AI_PLAYER || state.isOnlineMode) return;

    // 每步同步难度档位，保证容差/失误率/规划深度与玩家选择一致
    setComputerAiDifficulty(state.aiDifficulty);

    if (state.phase === 'hero-select' && state.selectingPlayer === AI_PLAYER && !state.player2ReadyHeroSelect) {
        // 新对局首次选将时清空阵容缓存，让跨局记忆与温度采样重新生效
        if (state.player2SelectedHeroIds.length === 0) resetCachedComputerTeam();
        const desiredTeam = chooseComputerTeam(state.player1SelectedHeroIds);
        for (const heroId of desiredTeam) {
            if (useGameStore.getState().player2SelectedHeroIds.length >= 4) break;
            if (!useGameStore.getState().player2SelectedHeroIds.includes(heroId)) {
                useGameStore.getState().selectHeroForPlayer(AI_PLAYER, heroId);
            }
        }
        if (useGameStore.getState().player2SelectedHeroIds.length === 4) {
            useGameStore.getState().confirmHeroSelectionForPlayer(AI_PLAYER);
            useGameStore.getState().addLog({ type: 'system', player: AI_PLAYER, message: `${difficultyLabel(state.aiDifficulty)}电脑已完成选将` });
        }
        return;
    }

    if (state.phase === 'deploy' && state.selectingPlayer === AI_PLAYER && !state.player2ReadyDeploy) {
        const plan = chooseComputerDeployment(state.player2SelectedHeroIds, state.player1Heroes);
        for (const deployment of plan) {
            const alreadyDeployed = useGameStore.getState().player2Heroes.some(hero =>
                hero.id.startsWith(`${deployment.heroId}-${AI_PLAYER}-`)
            );
            if (!alreadyDeployed) {
                useGameStore.getState().deployHeroForPlayer(AI_PLAYER, deployment.heroId, deployment.position);
            }
        }
        if (useGameStore.getState().player2Heroes.length === 4) {
            useGameStore.getState().confirmDeploymentForPlayer(AI_PLAYER);
            useGameStore.getState().addLog({ type: 'system', player: AI_PLAYER, message: `${difficultyLabel(state.aiDifficulty)}电脑已完成布阵` });
        }
        return;
    }

    if (state.phase !== 'battle' || state.currentPlayer !== AI_PLAYER) return;
    if (repeatCount >= 2) {
        // 任何未覆盖到的复杂技能都必须安全收束，不能让对局卡死。
        // selectedHero 为空（AI 全员眩晕/无可行动英雄）时同样收束，由 store 自动跳过。
        useGameStore.getState().endHeroAction();
        return;
    }
    executeBattleStep(state, AI_PLAYER);
}

/**
 * 无界面的通用宗师电脑战斗步进器。供平衡性仿真与测试复用，双方使用同一套决策逻辑。
 * 选将和布阵仍由调用方负责；本函数只处理当前战斗阶段的一次决策。
 */
export function runComputerBattleStep(aiPlayer: Player, repeatCount = 0): void {
    const state = useGameStore.getState();
    if (state.phase !== 'battle' || state.currentPlayer !== aiPlayer) return;
    if (repeatCount >= 2) {
        useGameStore.getState().endHeroAction();
        return;
    }
    executeBattleStep(state, aiPlayer);
}

/** 驱动玩家2的选将、布阵和战斗。每一步之间保留短暂停顿，便于玩家观察电脑决策。 */
export function useComputerOpponent(): void {
    const state = useGameStore(state => state);
    const lastExecutedSignatureRef = useRef('');
    const repeatCountRef = useRef(0);

    useEffect(() => {
        if (!state.isAiMode || state.aiPlayer !== AI_PLAYER || state.isOnlineMode) return;
        const shouldAct =
            (state.phase === 'hero-select' && state.selectingPlayer === AI_PLAYER && !state.player2ReadyHeroSelect) ||
            (state.phase === 'deploy' && state.selectingPlayer === AI_PLAYER && !state.player2ReadyDeploy) ||
            (state.phase === 'battle' && state.currentPlayer === AI_PLAYER);
        if (!shouldAct) return;

        const timer = window.setTimeout(() => {
            const current = useGameStore.getState();
            const signature = stateSignature(current);
            if (signature === lastExecutedSignatureRef.current) repeatCountRef.current++;
            else repeatCountRef.current = 0;
            lastExecutedSignatureRef.current = signature;
            runComputerOpponentStep(repeatCountRef.current);
        }, THINK_DELAY_MS);

        return () => window.clearTimeout(timer);
    }, [state]);
}
