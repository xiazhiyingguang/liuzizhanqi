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
    scoreComputerPosition,
} from '../core/computer-ai';
import { useGameStore } from '../store/game-store';
import type { GameState, Hero, Position, Skill } from '../types/game';

const AI_PLAYER = 'player2' as const;
const THINK_DELAY_MS = 430;

function samePosition(left: Position, right: Position): boolean {
    return left[0] === right[0] && left[1] === right[1];
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
        state.player2Heroes.map(hero => `${hero.id}:${hero.state}:${hero.currentHp}:${hero.position?.join(',') ?? '-'}`).join(';'),
        state.player1Heroes.map(hero => `${hero.id}:${hero.state}:${hero.currentHp}:${hero.position?.join(',') ?? '-'}`).join(';'),
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

function executeSelectedSkillStep(state: ReturnType<typeof useGameStore.getState>): void {
    const store = useGameStore.getState();
    const caster = state.selectedHero;
    const skill = state.selectedSkill;
    if (!caster || !skill) return;

    if (skill.id === 'baize_skill2' && (caster.counters['天禄'] ?? 0) >= 3) {
        const dead = chooseComputerReviveTarget(state, AI_PLAYER);
        if (dead && state.baizeReviveTargetHeroId !== dead.id) {
            store.selectBaizeReviveTarget(dead.id);
            return;
        }
    }

    if (skill.id === 'jetzmi_skill2') {
        const dead = chooseComputerTemporaryDeadTarget(state, AI_PLAYER);
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

    const target = nextPlannedTarget(state, caster, skill);
    if (!target) {
        store.endHeroAction();
        return;
    }
    store.executeSkill(target);
}

function executeBattleStep(state: ReturnType<typeof useGameStore.getState>): void {
    const store = useGameStore.getState();

    if (state.pendingBoardAction) {
        const hero = [...state.player1Heroes, ...state.player2Heroes]
            .find(candidate => candidate.id === state.pendingBoardAction?.heroId);
        if (hero?.owner === AI_PLAYER) {
            const position = chooseComputerPendingBoardPosition(state, hero);
            if (position) store.resolvePendingBoardAction(position);
            return;
        }
    }

    if (state.selectedSkill && state.selectedHero?.owner === AI_PLAYER) {
        executeSelectedSkillStep(state);
        return;
    }

    if (state.moveRange.length > 0 && state.selectedHero?.owner === AI_PLAYER) {
        const move = chooseComputerMove(state, state.selectedHero);
        if (move) store.moveHero(move);
        else store.endHeroAction();
        return;
    }

    let caster = state.selectedHero;
    if (!caster || caster.owner !== AI_PLAYER) {
        caster = chooseComputerHero(state, AI_PLAYER);
        if (caster) store.selectHeroForAction(caster);
        return;
    }

    if (configurePassiveChoice(state, caster)) return;

    const skillPlan = chooseComputerSkillPlan(state, caster);
    const move = chooseComputerMove(state, caster);
    if (!caster.hasMovedThisTurn && move && (!skillPlan || skillPlan.score < 55)) {
        store.showMoveRange();
        return;
    }

    if (skillPlan && skillPlan.score > 0) {
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

    if (state.phase === 'hero-select' && state.selectingPlayer === AI_PLAYER && !state.player2ReadyHeroSelect) {
        const desiredTeam = chooseComputerTeam(state.player1SelectedHeroIds);
        for (const heroId of desiredTeam) {
            if (useGameStore.getState().player2SelectedHeroIds.length >= 4) break;
            if (!useGameStore.getState().player2SelectedHeroIds.includes(heroId)) {
                useGameStore.getState().selectHeroForPlayer(AI_PLAYER, heroId);
            }
        }
        if (useGameStore.getState().player2SelectedHeroIds.length === 4) {
            useGameStore.getState().confirmHeroSelectionForPlayer(AI_PLAYER);
            useGameStore.getState().addLog({ type: 'system', player: AI_PLAYER, message: '宗师电脑已完成选将' });
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
            useGameStore.getState().addLog({ type: 'system', player: AI_PLAYER, message: '宗师电脑已完成布阵' });
        }
        return;
    }

    if (state.phase !== 'battle' || state.currentPlayer !== AI_PLAYER) return;
    if (repeatCount >= 2 && state.selectedHero?.owner === AI_PLAYER) {
        // 任何未覆盖到的复杂技能都必须安全收束，不能让对局卡死。
        useGameStore.getState().endHeroAction();
        return;
    }
    executeBattleStep(state);
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
