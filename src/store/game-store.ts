import { create } from 'zustand';
import { GameState, Hero, Position, BattleLogEntry, HeroState, Player } from '../types/game';
import { AVAILABLE_HERO_IDS, createHero, createWukongClone } from '../data/heroes';
import { getSkill } from '../data/skills';
import { MovementSystem } from '../core/movement-system';
import { SkillSystem } from '../core/skill-system';
import { GameEngine } from '../core/game-engine';
import { EffectManager } from '../core/effect-manager';
import { DamageCalculator } from '../core/damage-calculator';
import { sendPlayerAction, syncGameState } from '../services/socket-service';
import { checkYinyangLinks } from '../data/extended-heroes';
import { getDilanFrontRect, getLibaiFrontRect, hasShangguanDashOption, performShangguanDashSegment } from '../data/extended-skills';
import { recordBattleSkillUse } from '../core/battle-statistics';
import {
    computeFxAngleDeg,
    computeFxDirection,
    resolveSkillFx,
    type SkillFxEvent,
} from '../core/skill-fx';

/** 技能特效事件的自增序号（仅本地视觉层使用） */
let skillFxSeq = 0;

type WukongSkill2Phase = 'pickWukongTarget' | 'pickCloneTarget';

type WukongSkill2State = {
    phase: WukongSkill2Phase;
    wukongId: string;
    cloneIds: string[];
    clonePickIndex: number;
    wukongMoved: boolean;
    wukongTargetPos?: Position;
    cloneTargetsByCloneId: Record<string, Position>;
    cloneMovedById: Record<string, boolean>;
};

function getWukongOwnerIdFromCloneId(cloneId: string): string | null {
    const parts = cloneId.split('|');
    if (parts.length < 3) return null;
    if (parts[0] !== 'wukong-clone') return null;
    return parts[1] || null;
}

function getWukongClonesOnBoard(gameState: GameState, wukongId: string): Hero[] {
    const clones: Hero[] = [];
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            const h = gameState.board[r][c];
            if (!h) continue;
            if (!h.counters || h.counters['__isClone'] !== 1) continue;
            if (getWukongOwnerIdFromCloneId(h.id) !== wukongId) continue;
            if (h.state !== HeroState.ALIVE) continue;
            clones.push(h);
        }
    }
    return clones;
}

function countWukongClonesOnBoard(gameState: GameState, wukongId: string): number {
    return getWukongClonesOnBoard(gameState, wukongId).length;
}

function computeWukongCritRate(wukong: Hero): number {
    const lingxi = wukong.counters['灵犀'] ?? 0;
    return Math.min(1, 0.2 + lingxi * 0.2);
}

function syncWukongCritToSelfAndClones(wukong: Hero, gameState: GameState): void {
    const critRate = computeWukongCritRate(wukong);
    EffectManager.removeEffectByName(wukong, '悟空暴击率');
    EffectManager.addEffect(wukong, {
        type: 'buff',
        name: '悟空暴击率',
        duration: -1,
        value: critRate,
        sourceHeroId: wukong.id,
        description: '基础暴击率与灵犀叠加'
    });

    for (const clone of getWukongClonesOnBoard(gameState, wukong.id)) {
        EffectManager.removeEffectByName(clone, '悟空暴击率');
        EffectManager.addEffect(clone, {
            type: 'buff',
            name: '悟空暴击率',
            duration: -1,
            value: critRate,
            sourceHeroId: wukong.id,
            description: '基础暴击率与灵犀叠加'
        });
    }
}

function getAdjacentEmptyPositions(pos: Position, gameState: GameState): Position[] {
    const [row, col] = pos;
    const candidates: Position[] = [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
    ];
    return candidates.filter(([r, c]) => r >= 0 && r < 6 && c >= 0 && c < 6 && gameState.board[r][c] === null);
}

function isValidBoardPosition(position: unknown): position is Position {
    if (!Array.isArray(position) || position.length !== 2) return false;
    const [row, col] = position;
    return Number.isInteger(row)
        && Number.isInteger(col)
        && row >= 0
        && row < 6
        && col >= 0
        && col < 6;
}

function getEnemyPositionsInArea(center: Position, owner: Hero['owner'], gameState: GameState): Position[] {
    const positions: Position[] = [];
    for (const [r, c] of MovementSystem.getAreaPositions(center, 3)) {
        const h = gameState.board[r][c];
        if (h && h.owner !== owner && h.state === HeroState.ALIVE) {
            positions.push([r, c]);
        }
    }
    return positions;
}

/** 读取李太白的历史位置（上次/上上次停留位置，可能为空） */
function getLibaiHistoryPositions(hero: Hero): Position[] {
    const positions: Position[] = [];
    const prev = hero.counters['__libai_prev_pos'];
    const prev2 = hero.counters['__libai_prev2_pos'];
    if (prev !== undefined) positions.push([Math.floor(prev / 6), prev % 6]);
    if (prev2 !== undefined) positions.push([Math.floor(prev2 / 6), prev2 % 6]);
    return positions;
}

/** 李太白归位：瞬移回主位置并结束行动 */
function finalizeLibaiChain(
    hero: Hero,
    state: GameStore,
    addLog: (entry: Omit<BattleLogEntry, 'id' | 'timestamp'>) => void
): void {
    const chain = state.libaiChainState;
    state.libaiChainState = undefined;
    if (chain && hero.state === HeroState.ALIVE && hero.position) {
        const [homeRow, homeCol] = chain.home;
        const moved = homeRow !== hero.position[0] || homeCol !== hero.position[1];
        if (moved) {
            const [oldRow, oldCol] = hero.position;
            const oldPosition: Position = [oldRow, oldCol];
            if (state.board[oldRow][oldCol] === hero) state.board[oldRow][oldCol] = null;
            hero.position = [homeRow, homeCol];
            state.board[homeRow][homeCol] = hero;
            DamageCalculator.applyDilanMovementDamage(
                hero,
                MovementSystem.getManhattanDistance(oldPosition, hero.position),
                state
            );
            addLog({
                type: 'passive',
                player: hero.owner,
                message: hero.state === HeroState.ALIVE
                    ? `${hero.name}醉步归位到(${homeRow + 1},${homeCol + 1})`
                    : `${hero.name}醉步归位时触发羽化伤害并阵亡`
            });
        }
    }
    hero.hasActedThisTurn = true;
    GameEngine.endHeroAction(hero, state);
}

/**
 * 引擎回合流程权威字段的同步片段。
 *
 * 背景：action 内 `const state = get()` 取得的顶层对象，可能在引擎 mutate 之前
 * 就因 addLog 等其他 set 而被浅拷贝换代；此后引擎写入该旧对象的挂起/切边值，
 * 若收尾 set 不显式列出这些字段，Zustand 会以"最后一次 set 的产物"为基底合并，
 * 导致引擎晚写入的值永久丢失（典型症状：补员挂起不同步 → AI 全员行动完后控制权悬空）。
 *
 * 因此：凡调用 GameEngine.endHeroAction / startNewTurn / advancePastBlockedPlayer /
 * continueTurnFlow 等会 mutate 回合流程状态的代码路径，其收尾 set 必须展开本片段。
 */
function syncEngineFlowFields(state: GameState): Partial<GameStore> {
    return {
        currentPlayer: state.currentPlayer,
        actionsThisTurn: state.actionsThisTurn,
        roundNumber: state.roundNumber,
        phase: state.phase,
        winner: state.winner,
        // 替补制补员挂起三件套 + 替补席
        reinforcingPlayer: state.reinforcingPlayer,
        reinforcementSelectableHeroId: state.reinforcementSelectableHeroId,
        reinforceResumeContext: state.reinforceResumeContext,
        player1BenchHeroIds: state.player1BenchHeroIds,
        player2BenchHeroIds: state.player2BenchHeroIds,
        // 额外行动 / 强制行动（continueTurnFlow 可能发起或收尾）
        pendingExtraActionHeroIds: state.pendingExtraActionHeroIds,
        performingExtraAction: state.performingExtraAction,
        resumePlayer: state.resumePlayer,
        pendingForcedActionHeroId: state.pendingForcedActionHeroId,
        performingForcedAction: state.performingForcedAction,
        forcedActionResumePlayer: state.forcedActionResumePlayer,
    };
}

interface GameStore extends GameState {
    // 新增状态
    moveRange: Position[];
    skillRange: Position[];
    wukongSkill2State?: WukongSkill2State;
    suppressOnlineBroadcast: boolean;
    // 英雄技能特效事件队列（瞬态视觉层，动画结束后自动清除）
    skillFx: SkillFxEvent[];
    pushSkillFx: (event: Omit<SkillFxEvent, 'id' | 'bornAt'>) => void;
    dismissSkillFx: (id: number) => void;

    // 初始化游戏
    initGame: () => void;

    // 英雄选择
    selectHero: (heroId: string) => void;
    selectHeroForPlayer: (playerKey: Player, heroId: string) => boolean;
    confirmHeroSelection: () => void;
    confirmHeroSelectionForPlayer: (playerKey: Player) => boolean;

    // 部署
    deployHero: (heroId: string, position: Position) => void;
    deployHeroForPlayer: (playerKey: Player, heroId: string, position: Position) => boolean;
    /** 布阵阶段调整已上阵英雄位置：目标空格为移动，目标为己方英雄则交换 */
    repositionDeployHero: (heroId: string, position: Position) => void;
    repositionDeployHeroForPlayer: (playerKey: Player, heroId: string, position: Position) => boolean;
    confirmDeployment: () => void;
    confirmDeploymentForPlayer: (playerKey: Player) => boolean;

    // 替补制补员：阵亡后从替补席立即上场（本方半场任选，当轮即可行动）
    selectReinforcementHero: (heroId: string) => boolean;
    deployReinforcement: (position: Position) => boolean;
    clearReinforcementSelection: () => void;

    // 战斗操作
    selectHeroForAction: (hero: Hero | null) => void;
    showMoveRange: () => void;
    moveHero: (to: Position) => void;
    undoMove: () => void;
    selectSkill: (skillId: string) => void;
    selectBaizeReviveTarget: (heroId: string) => void;
    toggleChangliSkill2Empowered: () => void;
    toggleJetzmiSkill1Enhanced: () => void;
    selectHeroXRedirectTarget: (heroId: string) => void;
    selectSoulLampBeneficiary: (heroId: string) => void;
    selectSkillHeroTarget: (heroId: string) => void;
    executeSkill: (targetPos: Position) => void;
    /** @internal executeSkill 的原始实现；外层包装负责探测真实施法并派发技能特效 */
    executeSkillBase: (targetPos: Position) => void;
    resolvePendingBoardAction: (targetPos: Position) => void;
    // 李太白被动链
    selectLibaiChainPosition: (position: Position) => void;
    skipLibaiChainAttack: () => void;

    // 回合管理
    endHeroAction: () => void;

    // 日志
    addLog: (entry: Omit<BattleLogEntry, 'id' | 'timestamp'>) => void;
    clearLogs: () => void;

    // 重置游戏
    resetGame: () => void;
}

function getLocalPlayerKey(state: GameStore): 'player1' | 'player2' | null {
    if (state.localPlayerNumber === 1) return 'player1';
    if (state.localPlayerNumber === 2) return 'player2';
    return null;
}

export function createOnlineStateSnapshot(state: GameStore) {
    return {
        matchId: state.matchId,
        board: state.board,
        boardEffects: state.boardEffects,
        player1Heroes: state.player1Heroes,
        player2Heroes: state.player2Heroes,
        currentPlayer: state.currentPlayer,
        roundNumber: state.roundNumber,
        actionsThisTurn: state.actionsThisTurn,
        actionsRequiredThisTurn: state.actionsRequiredThisTurn,
        phase: state.phase,
        winner: state.winner,
        selectedHero: state.selectedHero,
        activeHero: state.activeHero,
        highlightedPositions: state.highlightedPositions,
        selectedSkill: state.selectedSkill,
        battleLog: state.battleLog,
        battleStatistics: state.battleStatistics,
        deathCounters: state.deathCounters,
        player1SelectedHeroIds: state.player1SelectedHeroIds,
        player2SelectedHeroIds: state.player2SelectedHeroIds,
        selectingPlayer: state.selectingPlayer,
        player1ReadyHeroSelect: state.player1ReadyHeroSelect,
        player2ReadyHeroSelect: state.player2ReadyHeroSelect,
        player1ReadyDeploy: state.player1ReadyDeploy,
        player2ReadyDeploy: state.player2ReadyDeploy,
        player1BenchHeroIds: state.player1BenchHeroIds,
        player2BenchHeroIds: state.player2BenchHeroIds,
        reinforcingPlayer: state.reinforcingPlayer,
        reinforceResumeContext: state.reinforceResumeContext,
        pendingExtraActionHeroIds: state.pendingExtraActionHeroIds,
        performingExtraAction: state.performingExtraAction,
        resumePlayer: state.resumePlayer,
        pendingForcedActionHeroId: state.pendingForcedActionHeroId,
        performingForcedAction: state.performingForcedAction,
        forcedActionResumePlayer: state.forcedActionResumePlayer,
        pendingSkillTargetPositions: state.pendingSkillTargetPositions,
        skillOptionFlags: state.skillOptionFlags,
        heroXRedirectTargetIds: state.heroXRedirectTargetIds,
        soulLampBeneficiaryIds: state.soulLampBeneficiaryIds,
        skillSelectedHeroIds: state.skillSelectedHeroIds,
        pendingBoardAction: state.pendingBoardAction,
        moveRange: state.moveRange,
        skillRange: state.skillRange,
        wukongSkill2State: state.wukongSkill2State,
        baizeReviveTargetHeroId: state.baizeReviveTargetHeroId,
        changliSkill2Empowered: state.changliSkill2Empowered,
        jetzmiSkill1Enhanced: state.jetzmiSkill1Enhanced,
        libaiChainState: state.libaiChainState,
        shangguanDashState: state.shangguanDashState
    };
}

function sendOnlineActionIfNeeded(state: GameStore, action: any) {
    if (!state.isOnlineMode || !state.onlineRoomId || state.suppressOnlineBroadcast) return;
    const includeAuthoritativeState = state.phase === 'battle' || state.phase === 'ended';
    sendPlayerAction(
        state.onlineRoomId,
        action,
        includeAuthoritativeState ? createOnlineStateSnapshot(state) : undefined
    );
}

function sendOnlineStateIfNeeded(state: GameStore) {
    if (!state.isOnlineMode || !state.onlineRoomId || state.suppressOnlineBroadcast) return;
    syncGameState(state.onlineRoomId, createOnlineStateSnapshot(state));
}

const createEmptyBoard = (): (Hero | null)[][] => {
    return Array(6).fill(null).map(() => Array(6).fill(null));
};

function createMatchId(): string {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `match-${Date.now().toString(36)}-${randomPart}`;
}

// 必须是工厂函数而非共享常量：引擎在局内会原地修改这些容器（如冰晶技能直接 push 进
// boardEffects 数组）。若各处重置都展开同一个模块级常量，第一局写入的数组/对象引用会
// 被原样带进后续对局（典型症状：第二轮游戏棋盘上残留上一局的雪花等区域效果图标）。
const createInitialState = (): GameState => ({
    board: createEmptyBoard(),
    player1Heroes: [],
    player2Heroes: [],
    currentPlayer: 'player1',
    roundNumber: 1,
    actionsThisTurn: 0,
    actionsRequiredThisTurn: 8, // 默认双方各4个英雄
    phase: 'menu',
    selectedHero: null,
    activeHero: null,  // 当前回合正在操作的英雄
    highlightedPositions: [],
    selectedSkill: null,
    battleLog: [],
    battleStatistics: {},
    deathCounters: {
        player1Dead: 0,
        player2Dead: 0,
        totalDead: 0,
        player1Resurrections: 0,
        player2Resurrections: 0
    },
    player1SelectedHeroIds: [],
    player2SelectedHeroIds: [],
    selectingPlayer: 'player1',
    player1ReadyHeroSelect: false,
    player2ReadyHeroSelect: false,
    player1ReadyDeploy: false,
    player2ReadyDeploy: false,
    player1BenchHeroIds: [],
    player2BenchHeroIds: [],
    reinforcingPlayer: null,
    reinforcementSelectableHeroId: null,
    reinforceResumeContext: undefined,
    pendingExtraActionHeroIds: {},
    boardEffects: [],
    isOnlineMode: false,
    onlineRoomId: undefined,
    localPlayerNumber: undefined,
    localPlayerName: undefined,
    isAiMode: false,
    aiPlayer: undefined,
    aiDifficulty: undefined,
    performingExtraAction: false,
    resumePlayer: undefined,
    pendingForcedActionHeroId: undefined,
    performingForcedAction: false,
    forcedActionResumePlayer: undefined,
    baizeReviveTargetHeroId: undefined,
    changliSkill2Empowered: false,
    jetzmiSkill1Enhanced: false,
    pendingSkillTargetPositions: [],
    skillOptionFlags: {},
    heroXRedirectTargetIds: {},
    soulLampBeneficiaryIds: {},
    skillSelectedHeroIds: {},
    libaiChainState: undefined,
    shangguanDashState: undefined,
    pendingBoardAction: undefined
});

export const useGameStore = create<GameStore>((set, get) => ({
    ...createInitialState(),
    moveRange: [],
    skillRange: [],
    wukongSkill2State: undefined,
    suppressOnlineBroadcast: false,
    skillFx: [],

    initGame: () => {
        const onlineContext = get();
        set({
            ...createInitialState(),
            matchId: createMatchId(),
            phase: 'hero-select',
            isOnlineMode: onlineContext.isOnlineMode,
            onlineRoomId: onlineContext.onlineRoomId,
            localPlayerNumber: onlineContext.localPlayerNumber,
            localPlayerName: onlineContext.localPlayerName,
            isAiMode: onlineContext.isAiMode,
            aiPlayer: onlineContext.aiPlayer,
            aiDifficulty: onlineContext.aiDifficulty,
            activeHero: null,
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined,
            suppressOnlineBroadcast: false
        });
    },

    selectHero: (heroId: string) => {
        const state = get();
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey) return;
            const changed = get().selectHeroForPlayer(localPlayerKey, heroId);
            if (changed) sendOnlineActionIfNeeded(get(), { type: 'select-hero', data: { heroId } });
            return;
        }
        const selectingPlayer = state.selectingPlayer;
        const changed = get().selectHeroForPlayer(selectingPlayer, heroId);
        if (changed) sendOnlineActionIfNeeded(get(), { type: 'select-hero', data: { heroId } });
    },

    confirmHeroSelection: () => {
        const state = get();
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey) return;
            const changed = get().confirmHeroSelectionForPlayer(localPlayerKey);
            if (changed) sendOnlineActionIfNeeded(get(), { type: 'confirm-hero-selection', data: {} });
            return;
        }
        const selectingPlayer = state.selectingPlayer;
        const changed = get().confirmHeroSelectionForPlayer(selectingPlayer);
        if (!changed) return;
        if (selectingPlayer === 'player1') {
            set({ selectingPlayer: 'player2' });
        }
        sendOnlineActionIfNeeded(get(), { type: 'confirm-hero-selection', data: {} });
    },

    deployHero: (heroId: string, position: Position) => {
        const state = get();
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey) return;
            const changed = get().deployHeroForPlayer(localPlayerKey, heroId, position);
            if (changed) sendOnlineActionIfNeeded(get(), { type: 'deploy-hero', data: { heroId, position } });
            return;
        }
        const selectingPlayer = state.selectingPlayer;
        const changed = get().deployHeroForPlayer(selectingPlayer, heroId, position);
        if (changed) sendOnlineActionIfNeeded(get(), { type: 'deploy-hero', data: { heroId, position } });
    },

    confirmDeployment: () => {
        const state = get();
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey) return;
            const changed = get().confirmDeploymentForPlayer(localPlayerKey);
            if (changed) sendOnlineActionIfNeeded(get(), { type: 'confirm-deployment', data: {} });
            return;
        }
        const selectingPlayer = state.selectingPlayer;
        const changed = get().confirmDeploymentForPlayer(selectingPlayer);
        if (!changed) return;
        if (selectingPlayer === 'player1') {
            set({ selectingPlayer: 'player2' });
        }
        sendOnlineActionIfNeeded(get(), { type: 'confirm-deployment', data: {} });
    },

    selectHeroForPlayer: (playerKey: Player, heroId: string) => {
        const state = get();
        if (state.phase !== 'hero-select' || !AVAILABLE_HERO_IDS.includes(heroId)) return false;
        const readyKey = playerKey === 'player1' ? 'player1ReadyHeroSelect' : 'player2ReadyHeroSelect';
        if (state[readyKey]) return false;
        const selectedIds = playerKey === 'player1'
            ? state.player1SelectedHeroIds
            : state.player2SelectedHeroIds;

        if (selectedIds.includes(heroId)) {
            const newIds = selectedIds.filter(id => id !== heroId);
            set({
                [playerKey === 'player1' ? 'player1SelectedHeroIds' : 'player2SelectedHeroIds']: newIds
            });
            return true;
        }

        if (selectedIds.length < 6) {
            set({
                [playerKey === 'player1' ? 'player1SelectedHeroIds' : 'player2SelectedHeroIds']: [...selectedIds, heroId]
            });
            return true;
        }

        return false;
    },

    confirmHeroSelectionForPlayer: (playerKey: Player) => {
        const state = get();
        if (state.phase !== 'hero-select') return false;
        const readyKey = playerKey === 'player1' ? 'player1ReadyHeroSelect' : 'player2ReadyHeroSelect';
        if (state[readyKey]) return false;
        const selectedIds = playerKey === 'player1'
            ? state.player1SelectedHeroIds
            : state.player2SelectedHeroIds;
        if (selectedIds.length !== 6) return false;

        const updates: Partial<GameStore> = {
            [readyKey]: true
        };

        const nextPlayer1Ready = playerKey === 'player1' ? true : state.player1ReadyHeroSelect;
        const nextPlayer2Ready = playerKey === 'player2' ? true : state.player2ReadyHeroSelect;

        if (nextPlayer1Ready && nextPlayer2Ready) {
            updates.phase = 'deploy';
            updates.selectingPlayer = 'player1';
            updates.player1ReadyDeploy = false;
            updates.player2ReadyDeploy = false;
        }

        set(updates);
        return true;
    },

    deployHeroForPlayer: (playerKey: Player, heroId: string, position: Position) => {
        const state = get();
        if (state.phase !== 'deploy' || !isValidBoardPosition(position)) return false;
        const readyKey = playerKey === 'player1' ? 'player1ReadyDeploy' : 'player2ReadyDeploy';
        if (state[readyKey]) return false;

        const [row, col] = position;
        if (state.board[row][col] !== null) return false;

        const isPlayer1 = playerKey === 'player1';
        const selectedIds = isPlayer1 ? state.player1SelectedHeroIds : state.player2SelectedHeroIds;
        if (!selectedIds.includes(heroId)) return false;
        if (isPlayer1 && col >= 3) return false;
        if (!isPlayer1 && col < 3) return false;

        const heroListKey = isPlayer1 ? 'player1Heroes' : 'player2Heroes';
        const currentHeroes = state[heroListKey];
        if (currentHeroes.some(h => h.id.startsWith(`${heroId}-${playerKey}-`))) return false;
        // 首发硬上限 4 人：UI 已禁用替补按钮，此处兜底拦截联机消息等旁路上阵
        if (currentHeroes.length >= 4) return false;

        const hero = createHero(heroId, playerKey, position);
        const newBoard = state.board.map(r => [...r]);
        newBoard[row][col] = hero;

        set({
            board: newBoard,
            [heroListKey]: [...currentHeroes, hero]
        });
        return true;
    },

    confirmDeploymentForPlayer: (playerKey: Player) => {
        const state = get();
        if (state.phase !== 'deploy') return false;
        const readyKey = playerKey === 'player1' ? 'player1ReadyDeploy' : 'player2ReadyDeploy';
        if (state[readyKey]) return false;
        const deployedHeroes = playerKey === 'player1' ? state.player1Heroes : state.player2Heroes;
        if (deployedHeroes.length !== 4) return false;

        const updates: Partial<GameStore> = {
            [readyKey]: true
        };

        const nextPlayer1Ready = playerKey === 'player1' ? true : state.player1ReadyDeploy;
        const nextPlayer2Ready = playerKey === 'player2' ? true : state.player2ReadyDeploy;

        if (nextPlayer1Ready && nextPlayer2Ready) {
            updates.phase = 'battle';
            updates.currentPlayer = 'player1';
            updates.roundNumber = 1;
            updates.actionsThisTurn = 0;
            // 替补制：已选将但未上场的英雄进入替补席，阵亡后立即补员
            updates.player1BenchHeroIds = state.player1SelectedHeroIds.filter(id =>
                !state.player1Heroes.some(h => h.id.startsWith(`${id}-player1-`))
            );
            updates.player2BenchHeroIds = state.player2SelectedHeroIds.filter(id =>
                !state.player2Heroes.some(h => h.id.startsWith(`${id}-player2-`))
            );
        }

        set(updates);

        if (nextPlayer1Ready && nextPlayer2Ready) {
            GameEngine.startNewTurn(state);
            get().addLog({
                type: 'system',
                player: 'player1',
                message: '战斗开始！第1轮'
            });
        }

        return true;
    },

    // ===== 布阵阶段位置调整：空格=移动，己方英雄=交换，无需撤下重放 =====

    repositionDeployHero: (heroId: string, position: Position) => {
        const state = get();
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey) return;
            const changed = get().repositionDeployHeroForPlayer(localPlayerKey, heroId, position);
            if (changed) sendOnlineActionIfNeeded(get(), { type: 'reposition-deploy-hero', data: { heroId, position } });
            return;
        }
        const selectingPlayer = state.selectingPlayer;
        const changed = get().repositionDeployHeroForPlayer(selectingPlayer, heroId, position);
        if (changed) sendOnlineActionIfNeeded(get(), { type: 'reposition-deploy-hero', data: { heroId, position } });
    },

    repositionDeployHeroForPlayer: (playerKey: Player, heroId: string, position: Position) => {
        const state = get();
        if (state.phase !== 'deploy' || !isValidBoardPosition(position)) return false;
        const readyKey = playerKey === 'player1' ? 'player1ReadyDeploy' : 'player2ReadyDeploy';
        if (state[readyKey]) return false;

        const [toRow, toCol] = position;
        if (playerKey === 'player1' && toCol >= 3) return false;
        if (playerKey !== 'player1' && toCol < 3) return false;

        const isPlayer1 = playerKey === 'player1';
        const heroListKey = isPlayer1 ? 'player1Heroes' : 'player2Heroes';
        const currentHeroes = state[heroListKey];
        const movingHero = currentHeroes.find(h => h.id === heroId);
        if (!movingHero || !movingHero.position) return false;
        if (movingHero.position[0] === toRow && movingHero.position[1] === toCol) return false;

        const [fromRow, fromCol] = movingHero.position;
        const targetHero = state.board[toRow][toCol];

        // 目标是对方英雄：布阵期双方各在自己半场，正常不可达，防御性拒绝
        if (targetHero && targetHero.owner !== playerKey) return false;

        const newBoard = state.board.map(r => [...r]);
        let updatedHeroes = currentHeroes;

        const movedMoving = { ...movingHero, position: [toRow, toCol] as Position };
        updatedHeroes = updatedHeroes.map(h => (h.id === movingHero.id ? movedMoving : h));
        newBoard[toRow][toCol] = movedMoving;

        if (targetHero) {
            // 交换两名己方英雄的位置
            const movedTarget = { ...targetHero, position: [fromRow, fromCol] as Position };
            updatedHeroes = updatedHeroes.map(h => (h.id === targetHero.id ? movedTarget : h));
            newBoard[fromRow][fromCol] = movedTarget;
        } else {
            // 移动到空格
            newBoard[fromRow][fromCol] = null;
        }

        set({ board: newBoard, [heroListKey]: updatedHeroes });
        return true;
    },

    // ===== 替补制补员：阵亡后立即上场（本方半场任选空位，当轮即可行动）=====

    selectReinforcementHero: (heroId: string) => {
        const state = get();
        if (state.phase !== 'battle') return false;
        const player = state.reinforcingPlayer;
        if (!player) return false;
        // 联机模式只允许补员方本人操作；热座/人机由当前交互方决定
        if (state.isOnlineMode && getLocalPlayerKey(state) !== player) return false;

        const bench = player === 'player1' ? state.player1BenchHeroIds : state.player2BenchHeroIds;
        if (!bench?.includes(heroId)) return false;

        set({ reinforcementSelectableHeroId: heroId });
        return true;
    },

    clearReinforcementSelection: () => {
        set({ reinforcementSelectableHeroId: null });
    },

    deployReinforcement: (position: Position) => {
        const state = get();
        if (state.phase !== 'battle' || !isValidBoardPosition(position)) return false;
        const player = state.reinforcingPlayer;
        if (!player) return false;
        if (state.isOnlineMode && getLocalPlayerKey(state) !== player) return false;
        const heroId = state.reinforcementSelectableHeroId;
        if (!heroId) return false;

        const [row, col] = position;
        if (state.board[row][col] !== null) return false;
        // 上场位置限本方半场
        if (player === 'player1' && col >= 3) return false;
        if (player === 'player2' && col < 3) return false;

        const bench = player === 'player1' ? state.player1BenchHeroIds : state.player2BenchHeroIds;
        if (!bench?.includes(heroId)) return false;

        // 补员前再次校验仍需补员（防止竞态下重复上场）；
        // 口径与调度一致：「场上存活+暂时阵亡」已满编4人则不再放行
        if (!GameEngine.hasReinforcementNeed(state, player)) return false;

        const hero = createHero(heroId, player, position);
        hero.hasActedThisTurn = false;  // 当轮即可行动
        hero.hasMovedThisTurn = false;

        const newBoard = state.board.map(r => [...r]);
        newBoard[row][col] = hero;

        const isPlayer1 = player === 'player1';
        const heroListKey = isPlayer1 ? 'player1Heroes' : 'player2Heroes';
        const currentHeroes = state[heroListKey];
        const newBench = bench.filter(id => id !== heroId);

        const after: Partial<GameStore> = {
            board: newBoard,
            [heroListKey]: [...currentHeroes, hero],
            [isPlayer1 ? 'player1BenchHeroIds' : 'player2BenchHeroIds']: newBench,
            reinforcementSelectableHeroId: null,
            // 场上战力回归，本回合所需行动数同步+1（保持4v4每轮8动的节奏）
            actionsRequiredThisTurn: state.actionsRequiredThisTurn + 1,
        };
        set(after);

        get().addLog({
            type: 'system',
            player,
            message: `${hero.name}从替补席上场！`
        });

        // 用最新状态驱动引擎续跑：可能还有其他待补员方，或恢复被挂起的回合流程
        const latest = get();
        GameEngine.afterReinforcementDeployed(latest);

        // 引擎续跑会直接修改状态对象（切换控制权/继续额外行动链/结束对局），显式同步以触发渲染
        const finalState = get();
        set({
            currentPlayer: finalState.currentPlayer,
            actionsThisTurn: finalState.actionsThisTurn,
            roundNumber: finalState.roundNumber,
            phase: finalState.phase,
            winner: finalState.winner,
            activeHero: finalState.activeHero,
            selectedHero: finalState.selectedHero,
            highlightedPositions: [],
            selectedSkill: null,
            moveRange: [],
            skillRange: [],
            reinforcingPlayer: finalState.reinforcingPlayer,
            reinforcementSelectableHeroId: finalState.reinforcementSelectableHeroId,
            reinforceResumeContext: finalState.reinforceResumeContext,
            pendingForcedActionHeroId: finalState.pendingForcedActionHeroId,
            performingForcedAction: finalState.performingForcedAction,
            forcedActionResumePlayer: finalState.forcedActionResumePlayer,
            pendingExtraActionHeroIds: finalState.pendingExtraActionHeroIds,
            performingExtraAction: finalState.performingExtraAction,
            resumePlayer: finalState.resumePlayer,
            board: [...finalState.board],
            player1Heroes: [...finalState.player1Heroes],
            player2Heroes: [...finalState.player2Heroes],
        });

        sendOnlineActionIfNeeded(get(), {
            type: 'reinforce-deploy',
            data: { heroId, position }
        });
        return true;
    },

    selectHeroForAction: (hero: Hero | null) => {
        const state = get();
        if (state.suppressOnlineBroadcast) {
            set({
                selectedHero: hero,
                highlightedPositions: [],
                selectedSkill: null,
                moveRange: [],
                skillRange: []
            });
            return;
        }
        if (state.isOnlineMode && !state.suppressOnlineBroadcast && hero) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey) {
                return;
            }
            if (state.currentPlayer !== localPlayerKey) {
                get().addLog({ type: 'system', player: localPlayerKey, message: '当前是对手回合，无法操作' });
                return;
            }
            if (hero.owner !== localPlayerKey) {
                return;
            }
        }

        // 如果已有activeHero，只能选择该英雄或取消选择
        if (state.activeHero && hero && hero !== state.activeHero) {
            get().addLog({
                type: 'system',
                player: state.currentPlayer,
                message: `请先完成${state.activeHero.name}的行动！`
            });
            return;
        }

        // 检查是否可以操作该英雄
        if (hero && !GameEngine.canPerformAction(hero, state)) {
            if (EffectManager.isStunned(hero)) {
                get().addLog({ type: 'system', player: hero.owner, message: `${hero.name}被眩晕，无法行动` });
            } else if (hero.hasActedThisTurn) {
                get().addLog({ type: 'system', player: hero.owner, message: `${hero.name}本回合已经行动过了` });
            } else if (hero.state !== HeroState.ALIVE) {
                get().addLog({ type: 'system', player: hero.owner, message: `${hero.name}已阵亡，无法行动` });
            }
            return;
        }

        // 阴阳师出手时：检查阳线/阴线链接是否仍在两格范围内（超出则断线并重置倍率）
        if (hero?.passiveId === 'yinyang_passive') {
            checkYinyangLinks(hero, state);
        }

        if (hero) {
            const fear = hero.effects.find(effect => effect.name === '恐惧' && effect.duration > 0);
            const checkedRound = hero.counters['__fear_checked_round'];
            if (fear && checkedRound !== state.roundNumber) {
                hero.counters['__fear_checked_round'] = state.roundNumber;
                if (Math.random() < 0.25) {
                    const source = [...state.player1Heroes, ...state.player2Heroes]
                        .find(candidate => candidate.id === fear.sourceHeroId);
                    if (source?.passiveId === 'lilith_passive') {
                        EffectManager.addCounter(source, '恐惧情绪能量', 1);
                        source.counters['lilith_next_damage_bonus'] = 1;
                    }
                    get().addLog({
                        type: 'passive',
                        player: hero.owner,
                        message: `${hero.name}因恐惧无法行动`
                    });
                    GameEngine.endHeroAction(hero, state);
                    set({
                        ...syncEngineFlowFields(state),
                        board: state.board.map(row => [...row]),
                        player1Heroes: [...state.player1Heroes],
                        player2Heroes: [...state.player2Heroes],
                        selectedHero: state.activeHero,
                        activeHero: state.activeHero
                    });
                    sendOnlineStateIfNeeded(get());
                    return;
                }
            }
        }

        set({
            selectedHero: hero,
            highlightedPositions: [],
            selectedSkill: null,
            moveRange: [],
            skillRange: []
        });
    },

    showMoveRange: () => {
        const state = get();
        const hero = state.selectedHero;
        if (!hero) return;
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey || state.currentPlayer !== localPlayerKey || hero.owner !== localPlayerKey) {
                get().addLog({ type: 'system', player: localPlayerKey ?? state.currentPlayer, message: '当前无法操作' });
                return;
            }
        }

        if (
            state.selectedSkill?.id === 'wukong_skill2' &&
            state.wukongSkill2State &&
            state.wukongSkill2State.wukongId === hero.id &&
            hero.name === '孙悟空'
        ) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: '正在释放技能2，无法使用普通移动'
            });
            return;
        }

        // 李太白被动链：链进行中不允许普通移动（会破坏归位点与瞬移高亮）
        if (state.libaiChainState?.heroId === hero.id) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}酒意正浓：被动链进行中，无法普通移动`
            });
            return;
        }

        // 检查是否已经移动过
        if (hero.hasMovedThisTurn) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}本回合已经移动过了！`
            });
            return;
        }

        // 检查是否被眩晕
        if (EffectManager.isStunned(hero)) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}被眩晕，无法移动！`
            });
            return;
        }

        const movablePositions = MovementSystem.getMovablePositions(hero, state);
        set({
            highlightedPositions: movablePositions,
            moveRange: movablePositions,
            skillRange: [],
            selectedSkill: null
        });
    },

    moveHero: (to: Position) => {
        const state = get();
        const hero = state.selectedHero;
        if (!hero) return;
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey || state.currentPlayer !== localPlayerKey || hero.owner !== localPlayerKey) {
                get().addLog({ type: 'system', player: localPlayerKey ?? state.currentPlayer, message: '当前无法操作' });
                return;
            }
        }

        // 检查是否已经移动过
        if (hero.hasMovedThisTurn) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}本回合已经移动过了！`
            });
            return;
        }

        // 使用MovementSystem进行移动
        const fromPosition = hero.position ? [...hero.position] : null;
        const hadDilanFeatherBeforeMove = hero.effects.some(effect =>
            effect.name === '羽化' && (effect.stackCount ?? 0) > 0
        );
        // 醉枕刀：移动前计算路径，供踩过带醉意友方时触发交换
        const zuizhendaoPath = hero.passiveId === 'zuizhendao_passive' && fromPosition
            ? MovementSystem.getMovePath(hero, to, state)
            : [];
        const success = MovementSystem.moveHero(hero, to, state);

        if (success) {
            if (hero.name === '琉璃') {
                SkillSystem.removeGuardEffectsFromLiuli(hero.id, state);
            }

            // 标记已移动
            hero.hasMovedThisTurn = true;
            // 记录移动前位置，供撤回使用
            if (fromPosition && !hadDilanFeatherBeforeMove) {
                hero.counters['__move_from'] = fromPosition[0] * 6 + fromPosition[1];
            } else if (hadDilanFeatherBeforeMove) {
                delete hero.counters['__move_from'];
            }

            // 醉枕刀被动：踩过带醉意（>=1层）的友方格子 -> 交换1层醉意并再次移动一次
            if (zuizhendaoPath.length > 0) {
                const drunkAlly = zuizhendaoPath
                    .map(([r, c]) => state.board[r][c])
                    .find((h): h is Hero =>
                        !!h && h.owner === hero.owner && h !== hero && h.state === HeroState.ALIVE &&
                        (h.counters['醉意'] ?? 0) >= 1
                    );
                if (drunkAlly) {
                    drunkAlly.counters['醉意'] = (drunkAlly.counters['醉意'] ?? 0) - 1;
                    hero.counters['醉意'] = (hero.counters['醉意'] ?? 0) + 1;
                    hero.hasMovedThisTurn = false;
                    get().addLog({
                        type: 'passive',
                        player: hero.owner,
                        message: `${hero.name}踩过${drunkAlly.name}，交换1层醉意并再次移动`
                    });
                }
            }

            const [toRow, toCol] = to;
            get().addLog({
                type: 'move',
                player: hero.owner,
                message: `${hero.name}移动到(${toRow + 1},${toCol + 1})`
            });

            if (hero.state !== HeroState.ALIVE) {
                GameEngine.endHeroAction(hero, state);
                set({
                    ...syncEngineFlowFields(state),
                    board: state.board.map(row => [...row]),
                    player1Heroes: [...state.player1Heroes],
                    player2Heroes: [...state.player2Heroes],
                    selectedHero: state.activeHero,
                    activeHero: state.activeHero,
                    highlightedPositions: [],
                    moveRange: [],
                    skillRange: [],
                });
                sendOnlineStateIfNeeded(get());
                return;
            }

            set({
                board: [...state.board],
                highlightedPositions: [],
                moveRange: [],
                activeHero: hero  // 锁定当前英雄，防止切换到其他英雄
            });
            const after = get();
            sendOnlineActionIfNeeded(after, {
                type: 'move',
                data: { heroId: hero.id, to },
                meta: { beforePlayer: state.currentPlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
            });
        }
    },

    undoMove: () => {
        const state = get();
        const hero = state.selectedHero;
        if (!hero) return;
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey || state.currentPlayer !== localPlayerKey || hero.owner !== localPlayerKey) {
                get().addLog({ type: 'system', player: localPlayerKey ?? state.currentPlayer, message: '当前无法操作' });
                return;
            }
        }

        // 只有已移动且尚未行动时才能撤回
        if (!hero.hasMovedThisTurn || hero.hasActedThisTurn) return;
        // 李太白被动链：链进行中禁止撤回移动（会传回归位点之外的位置，破坏链状态）
        if (state.libaiChainState?.heroId === hero.id) return;
        const encoded = hero.counters['__move_from'];
        if (encoded === undefined) return;
        const from: Position = [Math.floor(encoded / 6), encoded % 6];

        // 移回原位（宽限距离，撤回不校验移动力）
        const moved = MovementSystem.moveHero(hero, from, state, 99);
        if (!moved) return;
        delete hero.counters['__move_from'];
        hero.hasMovedThisTurn = false;

        get().addLog({
            type: 'move',
            player: hero.owner,
            message: `${hero.name}撤回移动，返回原位`
        });

        set({
            board: [...state.board],
            highlightedPositions: [],
            moveRange: [],
            activeHero: hero
        });

        // 撤回后重新显示移动范围，允许重新选择位置
        get().showMoveRange();

        const after = get();
        sendOnlineActionIfNeeded(after, {
            type: 'undo-move',
            data: { heroId: hero.id },
            meta: { beforePlayer: state.currentPlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
        });
    },

    selectSkill: (skillId: string) => {
        const state = get();
        const hero = state.selectedHero;
        if (!hero) return;
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey || state.currentPlayer !== localPlayerKey || hero.owner !== localPlayerKey) {
                get().addLog({ type: 'system', player: localPlayerKey ?? state.currentPlayer, message: '当前无法操作' });
                return;
            }
        }

        // 检查是否已经行动过
        if (hero.hasActedThisTurn) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}本回合已经行动过了！`
            });
            return;
        }

        // 李太白被动链：等待瞬移历史位置时不能原地反复施法（防止出手次数突破被动上限）
        if (state.libaiChainState?.heroId === hero.id && state.libaiChainState.awaitingPosition) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}酒意翻涌：请先点击高亮的历史位置瞬移，或跳过攻击`
            });
            return;
        }

        if (skillId === 'mowen_skill1') {
            const cd = hero.counters['mowen_skill1_cd'] || 0;
            if (cd > 0) {
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: `${hero.name}的技能1冷却中（剩余${cd}）`
                });
                return;
            }
        }

        // 时空旅者·戴尔：技能2「时空置换」冷却前置拦截（与莫问同模式）
        if (skillId === 'dai_skill2') {
            const cd = hero.counters['dai_skill2_cd'] || 0;
            if (cd > 0) {
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: `${hero.name}的时空置换冷却中（剩余${cd}回合）`
                });
                return;
            }
        }

        const skill = getSkill(skillId);
        if (!skill) return;

        if (skill.id === 'baize_skill2') {
            const tianlu = EffectManager.getCounter(hero, '天禄');
            const deadAllies = hero.owner === 'player1'
                ? state.player1Heroes.filter(h => h.state === HeroState.DEAD)
                : state.player2Heroes.filter(h => h.state === HeroState.DEAD);

            if (tianlu >= 3 && deadAllies.length > 0) {
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: `请先选择要复活的队友`
                });

                set({
                    selectedSkill: skill,
                    changliSkill2Empowered: false,
                    jetzmiSkill1Enhanced: false,
                    baizeReviveTargetHeroId: undefined,
                    highlightedPositions: [],
                    skillRange: [],
                    moveRange: [],
                    activeHero: hero
                });
                return;
            }
        }

        if (skill.id === 'wukong_skill2' && hero.name === '孙悟空') {
            if (hero.hasMovedThisTurn) {
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: `${hero.name}已移动过，无法释放技能2`
                });
                return;
            }
            if (!hero.position) return;

            if (hero.counters['灵犀'] === undefined) {
                hero.counters['灵犀'] = 0;
            }
            syncWukongCritToSelfAndClones(hero, state);

            const rangePositions = MovementSystem.getAreaPositions(hero.position, 3);
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: '请选择本体的攻击目标（可先移动一格再攻击）'
            });
            set({
                selectedSkill: skill,
                highlightedPositions: rangePositions,
                moveRange: [],
                skillRange: rangePositions,
                activeHero: hero,
                wukongSkill2State: {
                    phase: 'pickWukongTarget',
                    wukongId: hero.id,
                    cloneIds: [],
                    clonePickIndex: 0,
                    wukongMoved: false,
                    cloneTargetsByCloneId: {},
                    cloneMovedById: {}
                }
            });
            return;
        }

        if (skill.id === 'libai_skill2') {
            // 先选择方向（上下左右），再显示 2x3 矩形范围
            if (!hero.position) return;
            const [cr, cc] = hero.position;
            const dirPositions: Position[] = [];
            for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                const r = cr + dr;
                const c = cc + dc;
                if (r >= 0 && r < 6 && c >= 0 && c < 6) dirPositions.push([r, c]);
            }
            set({
                selectedSkill: skill,
                highlightedPositions: dirPositions,
                skillRange: dirPositions,
                moveRange: [],
                activeHero: hero
            });
            get().addLog({ type: 'system', player: hero.owner, message: '请选择醉斩的方向（上下左右）' });
            return;
        }

        if (skill.id === 'shangguan_skill2') {
            // 连冲：先选冲刺方向（上下左右相邻格），命中敌人/毛笔后可继续选新方向
            if (!hero.position) return;
            const [cr, cc] = hero.position;
            const dirPositions: Position[] = [];
            for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                const r = cr + dr;
                const c = cc + dc;
                if (r >= 0 && r < 6 && c >= 0 && c < 6) dirPositions.push([r, c]);
            }
            set({
                selectedSkill: skill,
                highlightedPositions: dirPositions,
                skillRange: dirPositions,
                moveRange: [],
                activeHero: hero
            });
            get().addLog({ type: 'system', player: hero.owner, message: '请选择连冲的方向（上下左右）' });
            return;
        }

        if (skill.id === 'dilan_skill1' || skill.id === 'dilan_skill2') {
            if (!hero.position) return;
            const [cr, cc] = hero.position;
            const dirPositions: Position[] = [];
            for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                const row = cr + dr;
                const col = cc + dc;
                if (row >= 0 && row < 6 && col >= 0 && col < 6) dirPositions.push([row, col]);
            }
            set({
                selectedSkill: skill,
                highlightedPositions: dirPositions,
                skillRange: dirPositions,
                moveRange: [],
                activeHero: hero,
            });
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: skill.id === 'dilan_skill1'
                    ? '请选择横向或纵向，决定顺逆长风作用的行列'
                    : '请选择风压横扫的方向（上下左右）',
            });
            return;
        }

        if (skill.id === 'zuizhendao_skill1') {
            // 先选择掷刀方向（上下左右），方向确定后自动计算路径并掷刀
            if (!hero.position) return;
            const [cr, cc] = hero.position;
            const dirPositions: Position[] = [];
            for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                const r = cr + dr;
                const c = cc + dc;
                if (r >= 0 && r < 6 && c >= 0 && c < 6) dirPositions.push([r, c]);
            }
            set({
                selectedSkill: skill,
                highlightedPositions: dirPositions,
                skillRange: dirPositions,
                moveRange: [],
                activeHero: hero
            });
            get().addLog({ type: 'system', player: hero.owner, message: '请选择掷刀的方向（上下左右）' });
            return;
        }

        // 显示技能范围
        const rangePositions = SkillSystem.getValidTargetPositions(
            hero,
            skill
        );

        // 获取有效目标
        SkillSystem.getHeroesAtPositions(rangePositions, hero, skill.targetType, state);

        // 总是显示范围让玩家选择，即使只有一个目标
        // 这样玩家可以确认技能范围和效果
        set({
            selectedSkill: skill,
            baizeReviveTargetHeroId: undefined,
            changliSkill2Empowered: false,
            jetzmiSkill1Enhanced: false,
            highlightedPositions: rangePositions,
            skillRange: rangePositions,
            moveRange: []
        });
    },

    selectBaizeReviveTarget: (heroId: string) => {
        const state = get();
        const caster = state.selectedHero;
        if (!caster || state.selectedSkill?.id !== 'baize_skill2') return;
        const allies = caster.owner === 'player1' ? state.player1Heroes : state.player2Heroes;
        const target = allies.find(hero => hero.id === heroId && hero.state === HeroState.DEAD);
        if (!target) return;

        // 替补制：复活会让阵亡英雄重新上场，若本方场上真实存活已达4人上限则不允许复活
        if (GameEngine.countRealAliveOnBoard(state, caster.owner) >= 4) {
            get().addLog({
                type: 'system',
                player: caster.owner,
                message: '场上已有四名英雄，无法复活（替补制上限）'
            });
            return;
        }

        const emptyPositions: Position[] = [];
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                if (state.board[row][col] === null) emptyPositions.push([row, col]);
            }
        }

        set({
            baizeReviveTargetHeroId: target.id,
            highlightedPositions: emptyPositions,
            skillRange: emptyPositions,
            moveRange: [],
            pendingSkillTargetPositions: []
        });
        get().addLog({
            type: 'system',
            player: caster.owner,
            message: `已选择复活${target.name}，请选择复活位置`
        });
    },

    toggleChangliSkill2Empowered: () => {
        const state = get();
        if (state.selectedSkill?.id !== 'changli_skill2' || state.selectedHero?.name !== '长离') return;
        if (EffectManager.getCounter(state.selectedHero, '暗夜星火') < 2) return;
        set({ changliSkill2Empowered: !state.changliSkill2Empowered });
    },

    toggleJetzmiSkill1Enhanced: () => {
        const state = get();
        const hero = state.selectedHero;
        if (!hero || state.selectedSkill?.id !== 'jetzmi_skill1' || hero.name !== '亡灵城主·杰茨米') return;
        if ((hero.counters['jetzmi_form'] ?? 0) === 1) return; // 终焉国王形态固定攻击一个目标
        const resonance = hero.owner === 'player1'
            ? state.deathCounters.player1Dead
            : state.deathCounters.player2Dead;
        if (resonance < 2) return;
        set({ jetzmiSkill1Enhanced: !state.jetzmiSkill1Enhanced });
    },

    selectHeroXRedirectTarget: (heroId: string) => {
        const state = get();
        const caster = state.selectedHero;
        if (!caster || caster.passiveId !== 'hero_x_passive' || (caster.counters['增势'] ?? 0) < 3) return;
        const allies = caster.owner === 'player1' ? state.player1Heroes : state.player2Heroes;
        const target = allies.find(hero => hero.id === heroId && hero.state === HeroState.ALIVE && hero.id !== caster.id);
        if (!target) return;
        set({
            heroXRedirectTargetIds: {
                ...(state.heroXRedirectTargetIds ?? {}),
                [caster.id]: target.id
            }
        });
        sendOnlineStateIfNeeded(get());
    },

    selectSoulLampBeneficiary: (heroId: string) => {
        const state = get();
        const caster = state.selectedHero;
        if (!caster || caster.passiveId !== 'soul_lamp_passive') return;
        const allies = caster.owner === 'player1' ? state.player1Heroes : state.player2Heroes;
        const target = allies.find(hero => hero.id === heroId && hero.state === HeroState.ALIVE && hero.id !== caster.id);
        if (!target) return;
        set({
            soulLampBeneficiaryIds: {
                ...(state.soulLampBeneficiaryIds ?? {}),
                [caster.id]: target.id
            }
        });
        sendOnlineStateIfNeeded(get());
    },

    selectSkillHeroTarget: (heroId: string) => {
        const state = get();
        const caster = state.selectedHero;
        if (!caster || state.selectedSkill?.id !== 'jetzmi_skill2') return;
        const allies = caster.owner === 'player1' ? state.player1Heroes : state.player2Heroes;
        if (!allies.some(hero => hero.id === heroId && hero.state === HeroState.TEMP_DEAD)) return;
        set({
            skillSelectedHeroIds: {
                ...(state.skillSelectedHeroIds ?? {}),
                [caster.id]: heroId
            }
        });
        sendOnlineStateIfNeeded(get());
    },

    executeSkillBase: (targetPos: Position) => {
        const state = get();
        const hero = state.selectedHero;
        const skill = state.selectedSkill;

        if (!hero || !skill || !isValidBoardPosition(targetPos)) {
            return;
        }

        // 李太白被动链：等待瞬移历史位置时不允许执行技能（双保险，正常流程已被 selectSkill 拦截）
        if (state.libaiChainState?.heroId === hero.id && state.libaiChainState.awaitingPosition) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}酒意翻涌：请先点击高亮的历史位置瞬移，或跳过攻击`
            });
            return;
        }

        const beforePlayer = state.currentPlayer;
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey || state.currentPlayer !== localPlayerKey || hero.owner !== localPlayerKey) {
                get().addLog({ type: 'system', player: localPlayerKey ?? state.currentPlayer, message: '当前无法操作' });
                return;
            }
        }

        if (skill.id === 'wukong_skill1' && hero.name === '孙悟空') {
            if (!hero.position) return;
            const [r, c] = targetPos;
            if (state.board[r][c] !== null) {
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: '目标位置不为空，无法召唤分身'
                });
                return;
            }
            if (countWukongClonesOnBoard(state, hero.id) >= 3) {
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: '分身数量已达上限'
                });
                return;
            }

            const clone = createWukongClone(hero.owner, hero.id, targetPos, 10);
            state.board[r][c] = clone;

            if (hero.counters['灵犀'] === undefined) {
                hero.counters['灵犀'] = 0;
            }
            syncWukongCritToSelfAndClones(hero, state);

            get().addLog({
                type: 'skill',
                player: hero.owner,
                message: `${hero.name}召唤了一个分身`
            });
            recordBattleSkillUse(state, hero, skill.id);

            hero.hasActedThisTurn = true;
            GameEngine.endHeroAction(hero, state);

            set({
                ...syncEngineFlowFields(state),
                board: state.board.map(row => [...row]),
                player1Heroes: [...state.player1Heroes],
                player2Heroes: [...state.player2Heroes],
                battleLog: [...get().battleLog],
                highlightedPositions: [],
                selectedSkill: null,
                skillRange: [],
                moveRange: [],
                selectedHero: state.activeHero,
                activeHero: state.activeHero
            });
            const after = get();
            sendOnlineActionIfNeeded(after, {
                type: 'skill',
                data: { heroId: hero.id, skillId: skill.id, targetPos },
                meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
            });
            return;
        }

        if (skill.id === 'baize_skill2') {
            const tianlu = EffectManager.getCounter(hero, '天禄');
            if (tianlu >= 3) {
                const [r, c] = targetPos;
                if (state.board[r][c] !== null) {
                    get().addLog({
                        type: 'system',
                        player: hero.owner,
                        message: '请选择一个空位置'
                    });
                    return;
                }

                const deadAllies = hero.owner === 'player1'
                    ? state.player1Heroes.filter(h => h.state === HeroState.DEAD)
                    : state.player2Heroes.filter(h => h.state === HeroState.DEAD);

                if (deadAllies.length > 0) {
                    const reviveTarget = deadAllies.find(
                        candidate => candidate.id === state.baizeReviveTargetHeroId
                    );
                    if (!reviveTarget) {
                        get().addLog({
                            type: 'system',
                            player: hero.owner,
                            message: '请先选择要复活的队友'
                        });
                        return;
                    }
                    
                    const ok = GameEngine.reviveHeroAtPosition(reviveTarget, targetPos, 0.5, state);
                    
                    if (ok) {
                        EffectManager.consumeCounter(hero, '天禄', 3);
                        recordBattleSkillUse(state, hero, skill.id);
                        
                        get().addLog({
                            type: 'skill',
                            player: hero.owner,
                            message: `${hero.name}消耗3层天禄，在(${r + 1},${c + 1})复活了${reviveTarget.name}`
                        });

                        hero.hasActedThisTurn = true;
                        GameEngine.endHeroAction(hero, state);

                        set({
                            ...syncEngineFlowFields(state),
                            board: state.board.map(row => [...row]),
                            player1Heroes: [...state.player1Heroes],
                            player2Heroes: [...state.player2Heroes],
                            battleLog: [...get().battleLog],
                            highlightedPositions: [],
                            selectedSkill: null,
                            baizeReviveTargetHeroId: undefined,
                            skillRange: [],
                            moveRange: [],
                            selectedHero: state.activeHero,
                            activeHero: state.activeHero
                        });
                        const after = get();
                        sendOnlineActionIfNeeded(after, {
                            type: 'skill',
                            data: {
                                heroId: hero.id,
                                skillId: skill.id,
                                targetPos,
                                reviveTargetHeroId: reviveTarget.id
                            },
                            meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
                        });
                        return;
                    }
                }
            }
        }

        if (skill.id === 'wukong_skill2' && hero.name === '孙悟空') {
            const wState = state.wukongSkill2State;
            if (!wState || wState.wukongId !== hero.id) {
                return;
            }

            if (wState.phase === 'pickWukongTarget') {
                const [r, c] = targetPos;
                const target = state.board[r][c];
                if (!target) {
                    if (!hero.position) return;
                    if (wState.wukongMoved) {
                        get().addLog({
                            type: 'system',
                            player: hero.owner,
                            message: '本体已移动过，无法再次移动'
                        });
                        return;
                    }

                    const movable = getAdjacentEmptyPositions(hero.position, state);
                    const isMovePos = movable.some(([mr, mc]) => mr === r && mc === c);
                    if (!isMovePos) {
                        get().addLog({
                            type: 'system',
                            player: hero.owner,
                            message: '只能移动一格到空位'
                        });
                        return;
                    }

                    const ok = MovementSystem.moveHero(hero, targetPos, state);
                    if (!ok) {
                        get().addLog({
                            type: 'system',
                            player: hero.owner,
                            message: '移动失败'
                        });
                        return;
                    }

                    const nextRange = hero.position ? MovementSystem.getAreaPositions(hero.position, 3) : [];
                    set({
                        board: state.board.map(row => [...row]),
                        highlightedPositions: nextRange,
                        skillRange: nextRange,
                        moveRange: [],
                        wukongSkill2State: {
                            ...wState,
                            wukongMoved: true
                        }
                    });
                    const after = get();
                    sendOnlineActionIfNeeded(after, {
                        type: 'skill',
                        data: { heroId: hero.id, skillId: skill.id, targetPos },
                        meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
                    });
                    return;
                }

                if (target.owner === hero.owner || target.state !== 'alive') {
                    get().addLog({
                        type: 'system',
                        player: hero.owner,
                        message: '请选择一格内的敌人作为目标'
                    });
                    return;
                }

                const clones = getWukongClonesOnBoard(state, hero.id);
                const cloneIds = clones.map(x => x.id);

                if (cloneIds.length === 0) {
                    const damageResult = SkillSystem.executeSkill(hero, skill, [targetPos], state);
                    if (!damageResult.success) {
                        get().addLog({
                            type: 'system',
                            player: hero.owner,
                            message: damageResult.log[0] || '技能释放失败'
                        });
                        return;
                    }
                    for (const log of damageResult.log) {
                        get().addLog({ type: 'skill', player: hero.owner, message: log });
                    }

                    hero.hasActedThisTurn = true;
                    GameEngine.endHeroAction(hero, state);

                    set({
                        ...syncEngineFlowFields(state),
                        board: state.board.map(row => [...row]),
                        player1Heroes: [...state.player1Heroes],
                        player2Heroes: [...state.player2Heroes],
                        battleLog: [...get().battleLog],
                        highlightedPositions: [],
                        selectedSkill: null,
                        skillRange: [],
                        moveRange: [],
                        selectedHero: state.activeHero,
                        activeHero: state.activeHero,
                        wukongSkill2State: undefined
                    });
                    const after = get();
                    sendOnlineActionIfNeeded(after, {
                        type: 'skill',
                        data: { heroId: hero.id, skillId: skill.id, targetPos },
                        meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
                    });
                    return;
                }

                const firstClone = clones[0];
                const nextRange = firstClone.position ? MovementSystem.getAreaPositions(firstClone.position, 3) : [];
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: `请选择分身1的攻击目标（可先移动一格再攻击）`
                });

                set({
                    highlightedPositions: nextRange,
                    skillRange: nextRange,
                    moveRange: [],
                    wukongSkill2State: {
                        phase: 'pickCloneTarget',
                        wukongId: hero.id,
                        cloneIds,
                        clonePickIndex: 0,
                        wukongMoved: wState.wukongMoved,
                        wukongTargetPos: targetPos,
                        cloneTargetsByCloneId: {},
                        cloneMovedById: {}
                    }
                });
                const after = get();
                sendOnlineActionIfNeeded(after, {
                    type: 'skill',
                    data: { heroId: hero.id, skillId: skill.id, targetPos },
                    meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
                });
                return;
            }

            if (wState.phase === 'pickCloneTarget') {
                const clones = getWukongClonesOnBoard(state, hero.id).filter(c => wState.cloneIds.includes(c.id));
                if (clones.length === 0) {
                    get().addLog({
                        type: 'system',
                        player: hero.owner,
                        message: '当前没有可用分身'
                    });
                    set({ wukongSkill2State: undefined, highlightedPositions: [], skillRange: [], moveRange: [], selectedSkill: null });
                    return;
                }

                const currentIndex = Math.min(wState.clonePickIndex, clones.length - 1);
                const currentClone = clones[currentIndex];
                const [r, c] = targetPos;
                const target = state.board[r][c];
                const moved = wState.cloneMovedById[currentClone.id] ?? false;

                const settleNow = (cloneTargetsByCloneId: Record<string, Position>) => {
                    const wukongTargetPos = wState.wukongTargetPos;
                    if (!wukongTargetPos) {
                        set({ wukongSkill2State: undefined, highlightedPositions: [], skillRange: [], moveRange: [], selectedSkill: null });
                        return;
                    }

                    const result = SkillSystem.executeSkill(hero, skill, [wukongTargetPos], state);
                    if (!result.success) {
                        get().addLog({
                            type: 'system',
                            player: hero.owner,
                            message: result.log[0] || '技能释放失败'
                        });
                        return;
                    }
                    for (const log of result.log) {
                        get().addLog({
                            type: 'skill',
                            player: hero.owner,
                            message: log
                        });
                    }

                    for (const clone of clones) {
                        const pos = cloneTargetsByCloneId[clone.id];
                        if (!pos) continue;
                        const cloneResult = SkillSystem.executeSkill(clone, skill, [pos], state);
                        if (!cloneResult.success) continue;
                        for (const log of cloneResult.log) {
                            get().addLog({
                                type: 'skill',
                                player: hero.owner,
                                message: log
                            });
                        }
                    }

                    hero.hasActedThisTurn = true;
                    GameEngine.endHeroAction(hero, state);

                    set({
                        ...syncEngineFlowFields(state),
                        board: state.board.map(row => [...row]),
                        player1Heroes: [...state.player1Heroes],
                        player2Heroes: [...state.player2Heroes],
                        battleLog: [...get().battleLog],
                        highlightedPositions: [],
                        selectedSkill: null,
                        skillRange: [],
                        moveRange: [],
                        selectedHero: state.activeHero,
                        activeHero: state.activeHero,
                        wukongSkill2State: undefined
                    });
                    const after = get();
                    sendOnlineActionIfNeeded(after, {
                        type: 'skill',
                        data: { heroId: hero.id, skillId: skill.id, targetPos },
                        meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
                    });
                };

                const advanceToNextCloneOrSettle = (
                    startIndex: number,
                    cloneTargetsByCloneId: Record<string, Position>,
                    cloneMovedById: Record<string, boolean>
                ) => {
                    let idx = startIndex;
                    while (idx < clones.length) {
                        const cl = clones[idx];
                        if (!cl.position) {
                            idx++;
                            continue;
                        }
                        const movedFlag = cloneMovedById[cl.id] ?? false;
                        const attackable = getEnemyPositionsInArea(cl.position, hero.owner, state);
                        const movable = movedFlag ? [] : getAdjacentEmptyPositions(cl.position, state);
                        if (attackable.length > 0 || movable.length > 0) {
                            break;
                        }
                        get().addLog({
                            type: 'system',
                            player: hero.owner,
                            message: `分身${idx + 1}周围没有可行动目标，自动跳过`
                        });
                        idx++;
                    }

                    if (idx >= clones.length) {
                        settleNow(cloneTargetsByCloneId);
                        return;
                    }

                    const nextClone = clones[idx];
                    const nextRange = nextClone.position ? MovementSystem.getAreaPositions(nextClone.position, 3) : [];
                    get().addLog({
                        type: 'system',
                        player: hero.owner,
                        message: `请选择分身${idx + 1}的攻击目标（可先移动一格再攻击）`
                    });
                    set({
                        highlightedPositions: nextRange,
                        skillRange: nextRange,
                        moveRange: [],
                        wukongSkill2State: {
                            ...wState,
                            clonePickIndex: idx,
                            cloneTargetsByCloneId,
                            cloneMovedById
                        }
                    });
                    const after = get();
                    sendOnlineActionIfNeeded(after, {
                        type: 'skill',
                        data: { heroId: hero.id, skillId: skill.id, targetPos },
                        meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
                    });
                };

                if (!currentClone.position) {
                    advanceToNextCloneOrSettle(currentIndex + 1, wState.cloneTargetsByCloneId, wState.cloneMovedById);
                    return;
                }

                const attackableNow = getEnemyPositionsInArea(currentClone.position, hero.owner, state);
                const movableNow = moved ? [] : getAdjacentEmptyPositions(currentClone.position, state);
                if (attackableNow.length === 0 && (moved || movableNow.length === 0)) {
                    get().addLog({
                        type: 'system',
                        player: hero.owner,
                        message: `分身${currentIndex + 1}周围没有可选目标，自动跳过`
                    });
                    advanceToNextCloneOrSettle(currentIndex + 1, wState.cloneTargetsByCloneId, wState.cloneMovedById);
                    return;
                }

                if (!moved && (!target || target.state !== 'alive') && currentClone.position) {
                    const movable = getAdjacentEmptyPositions(currentClone.position, state);
                    const isMovePos = movable.some(([mr, mc]) => mr === r && mc === c);
                    if (isMovePos) {
                        const ok = MovementSystem.moveHero(currentClone, targetPos, state, 1);
                        if (ok) {
                            const cloneMovedById = { ...wState.cloneMovedById, [currentClone.id]: true };
                            const nextAttackable = currentClone.position ? getEnemyPositionsInArea(currentClone.position, hero.owner, state) : [];
                            if (nextAttackable.length === 0) {
                                get().addLog({
                                    type: 'system',
                                    player: hero.owner,
                                    message: `分身${currentIndex + 1}移动到(${r + 1},${c + 1})，但周围仍无可选目标，自动跳过`
                                });
                                advanceToNextCloneOrSettle(currentIndex + 1, wState.cloneTargetsByCloneId, cloneMovedById);
                                return;
                            }

                            const nextRange = currentClone.position ? MovementSystem.getAreaPositions(currentClone.position, 3) : [];
                            get().addLog({
                                type: 'system',
                                player: hero.owner,
                                message: `分身${currentIndex + 1}移动到(${r + 1},${c + 1})，请选择攻击目标`
                            });
                            set({
                                highlightedPositions: nextRange,
                                skillRange: nextRange,
                                moveRange: [],
                                wukongSkill2State: {
                                    ...wState,
                                    cloneMovedById
                                }
                            });
                            const after = get();
                            sendOnlineActionIfNeeded(after, {
                                type: 'skill',
                                data: { heroId: hero.id, skillId: skill.id, targetPos },
                                meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
                            });
                            return;
                        }
                    }
                }

                if (!target || target.owner === hero.owner || target.state !== 'alive') {
                    get().addLog({
                        type: 'system',
                        player: hero.owner,
                        message: '请选择一格内的敌人作为目标'
                    });
                    return;
                }

                const nextTargetsById = { ...wState.cloneTargetsByCloneId, [currentClone.id]: targetPos };
                advanceToNextCloneOrSettle(currentIndex + 1, nextTargetsById, wState.cloneMovedById);
                return;
            }
        }

        // 检查是否已经行动过
        if (hero.hasActedThisTurn) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}本回合已经行动过了！`
            });
            return;
        }

        // 上官婉儿技能2：多段连冲。每段点击相邻方向格冲刺；命中敌人/毛笔后停下，
        // 若仍有可命中的目标则等待玩家选新方向继续，否则正常结束行动。
        // （全程快照同步，不走 action 回放，避免接收端重放结算）
        if (skill.id === 'shangguan_skill2') {
            if (!hero.position) return;
            const [cr, cc] = hero.position;
            const isDirUp = targetPos[0] === cr - 1 && targetPos[1] === cc;
            const isDirDown = targetPos[0] === cr + 1 && targetPos[1] === cc;
            const isDirLeft = targetPos[1] === cc - 1 && targetPos[0] === cr;
            const isDirRight = targetPos[1] === cc + 1 && targetPos[0] === cr;
            if (!isDirUp && !isDirDown && !isDirLeft && !isDirRight) {
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: '请点击相邻的方向格选择连冲方向'
                });
                return;
            }
            const dirR = isDirUp ? -1 : isDirDown ? 1 : 0;
            const dirC = isDirLeft ? -1 : isDirRight ? 1 : 0;

            // 处于连冲中则延续已命中列表；否则这是第一段
            const activeDash =
                state.shangguanDashState?.heroId === hero.id ? state.shangguanDashState : undefined;
            const hitTargets: string[] = activeDash ? [...activeDash.hitTargets] : [];

            const outcome = performShangguanDashSegment(hero, dirR, dirC, hitTargets, state);
            if (!outcome.success) {
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: outcome.message ?? '该方向无法连冲'
                });
                // 第一段失败不消耗行动次数；连冲中失败保留状态等待换方向
                sendOnlineStateIfNeeded(get());
                return;
            }

            if (outcome.hitId) hitTargets.push(outcome.hitId);
            if (outcome.hitKind === 'enemy') {
                get().addLog({
                    type: 'damage',
                    player: hero.owner,
                    message: `连冲撞击${outcome.hitName}，造成${outcome.damage}点固定伤害${outcome.killed ? '，目标阵亡' : ''}`
                });
            } else {
                get().addLog({
                    type: 'passive',
                    player: hero.owner,
                    message: `${hero.name}掠过毛笔获得再次冲刺之势`
                });
            }
            const dashPos = hero.position!;
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: `${hero.name}落至(${dashPos[0] + 1},${dashPos[1] + 1})`
            });

            // 命中后若还有可继续的目标：暂停等待玩家选新方向
            if (hasShangguanDashOption(hero, hitTargets, state)) {
                const [nr, nc] = hero.position!;
                const dirPositions: Position[] = [];
                for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                    const rr = nr + dr;
                    const ccc = nc + dc;
                    if (rr >= 0 && rr < 6 && ccc >= 0 && ccc < 6) dirPositions.push([rr, ccc]);
                }
                set({
                    shangguanDashState: { heroId: hero.id, hitTargets },
                    selectedHero: hero,
                    activeHero: hero,
                    selectedSkill: skill,
                    highlightedPositions: dirPositions,
                    skillRange: dirPositions,
                    moveRange: [],
                    board: state.board.map(row => [...row]),
                    player1Heroes: [...state.player1Heroes],
                    player2Heroes: [...state.player2Heroes],
                    battleLog: [...get().battleLog]
                });
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: '可选择新方向继续连冲，或结束行动'
                });
                sendOnlineStateIfNeeded(get());
                return;
            }

            // 无法继续连冲：标记已行动并结束（触发行动结束后毛笔移动）
            hero.hasActedThisTurn = true;
            GameEngine.endHeroAction(hero, state);
            set({
                ...syncEngineFlowFields(state),
                board: state.board.map(row => [...row]),
                player1Heroes: [...state.player1Heroes],
                player2Heroes: [...state.player2Heroes],
                battleLog: [...get().battleLog],
                highlightedPositions: [],
                selectedSkill: null,
                shangguanDashState: undefined,
                pendingSkillTargetPositions: [],
                skillRange: [],
                moveRange: [],
                selectedHero: state.activeHero,
                activeHero: state.activeHero
            });
            sendOnlineStateIfNeeded(get());
            return;
        }

        // 李太白技能2：先选方向（点击上下左右方向格），再选范围内敌人
        if (skill.id === 'libai_skill2' && hero.counters['__libai_skill2_dir'] === undefined) {
            if (!hero.position) return;
            const [cr, cc] = hero.position;
            const isDirUp = targetPos[0] === cr - 1 && targetPos[1] === cc;
            const isDirDown = targetPos[0] === cr + 1 && targetPos[1] === cc;
            const isDirLeft = targetPos[1] === cc - 1 && targetPos[0] === cr;
            const isDirRight = targetPos[1] === cc + 1 && targetPos[0] === cr;
            if (!isDirUp && !isDirDown && !isDirLeft && !isDirRight) {
                get().addLog({ type: 'system', player: hero.owner, message: '请先点击方向格确定醉斩方向' });
                return;
            }
            hero.counters['__libai_skill2_dir'] = isDirUp ? 0 : isDirDown ? 1 : isDirLeft ? 2 : 3;
            const rect = getLibaiFrontRect(hero);
            set({
                highlightedPositions: rect,
                skillRange: rect,
                moveRange: []
            });
            get().addLog({ type: 'system', player: hero.owner, message: '方向已确定，请选择范围内的敌人' });
            return;
        }

        if (
            (skill.id === 'dilan_skill1' && hero.counters['__dilan_skill1_axis'] === undefined) ||
            (skill.id === 'dilan_skill2' && hero.counters['__dilan_skill2_dir'] === undefined)
        ) {
            if (!hero.position) return;
            const [cr, cc] = hero.position;
            const isDirUp = targetPos[0] === cr - 1 && targetPos[1] === cc;
            const isDirDown = targetPos[0] === cr + 1 && targetPos[1] === cc;
            const isDirLeft = targetPos[1] === cc - 1 && targetPos[0] === cr;
            const isDirRight = targetPos[1] === cc + 1 && targetPos[0] === cr;
            if (!isDirUp && !isDirDown && !isDirLeft && !isDirRight) {
                get().addLog({ type: 'system', player: hero.owner, message: '请先点击相邻方向格' });
                return;
            }
            if (skill.id === 'dilan_skill1') {
                hero.counters['__dilan_skill1_axis'] = isDirUp || isDirDown ? 1 : 0;
            } else {
                hero.counters['__dilan_skill2_dir'] = isDirUp ? 0 : isDirDown ? 1 : isDirLeft ? 2 : 3;
                const rect = getDilanFrontRect(hero);
                set({ highlightedPositions: rect, skillRange: rect, moveRange: [] });
            }
        }

        // 醉枕刀技能1：先选方向（点击上下左右方向格），方向确定后自动掷刀
        if (skill.id === 'zuizhendao_skill1') {
            if (!hero.position) return;
            const [cr, cc] = hero.position;
            const isDirUp = targetPos[0] === cr - 1 && targetPos[1] === cc;
            const isDirDown = targetPos[0] === cr + 1 && targetPos[1] === cc;
            const isDirLeft = targetPos[1] === cc - 1 && targetPos[0] === cr;
            const isDirRight = targetPos[1] === cc + 1 && targetPos[0] === cr;
            if (!isDirUp && !isDirDown && !isDirLeft && !isDirRight) {
                get().addLog({ type: 'system', player: hero.owner, message: '请先点击方向格确定掷刀方向' });
                return;
            }
            hero.counters['__zuizhendao_skill1_dir'] = isDirUp ? 0 : isDirDown ? 1 : isDirLeft ? 2 : 3;
            get().addLog({ type: 'system', player: hero.owner, message: '掷刀方向已确定，正在掷刀' });
        }

        // 通用多目标选择：依次点击；可选目标技能再次点击已选目标即可提前释放。
        let targetPositions: Position[] = [targetPos];
        if (typeof skill.targetCount === 'number' && skill.targetCount > 1) {
            const pending = state.pendingSkillTargetPositions ?? [];
            const duplicate = pending.some(([row, col]) => row === targetPos[0] && col === targetPos[1]);
            const canFinishEarly = skill.id === 'wangcai_skill2';
            // 杰茨米终焉斩：强化释放时选两个目标，否则只选一个
            let effectiveCount = skill.targetCount;
            if (skill.id === 'jetzmi_skill1') {
                effectiveCount = state.jetzmiSkill1Enhanced ? 2 : 1;
            }
            // 凋零之主技能1：两个位置必须成对角（行差1列差1）才能构成 2x2 区域
            if (skill.id === 'wither_lord_skill1' && pending.length === 1 && !duplicate) {
                const [first] = pending;
                const rowDiff = Math.abs(first[0] - targetPos[0]);
                const colDiff = Math.abs(first[1] - targetPos[1]);
                if (rowDiff !== 1 || colDiff !== 1) {
                    get().addLog({
                        type: 'system',
                        player: hero.owner,
                        message: '第二个位置需与第一个位置成对角，构成2x2区域'
                    });
                    return;
                }
            }
            if (!duplicate && pending.length + 1 < effectiveCount) {
                const next = [...pending, targetPos];
                set({ pendingSkillTargetPositions: next });
                get().addLog({
                    type: 'system',
                    player: hero.owner,
                    message: canFinishEarly
                        ? `已选择${next.length}个目标；继续选择，或再次点击已选目标立即释放`
                        : `已选择${next.length}/${effectiveCount}个目标`
                });
                const afterProgress = get();
                sendOnlineActionIfNeeded(afterProgress, {
                    type: 'skill',
                    data: {
                        heroId: hero.id,
                        skillId: skill.id,
                        targetPos,
                        jetzmiEnhanced: skill.id === 'jetzmi_skill1' && state.jetzmiSkill1Enhanced
                    }
                });
                return;
            }
            if (duplicate && !canFinishEarly) return;
            targetPositions = duplicate ? pending : [...pending, targetPos];
        }

        // 执行技能
        if (skill.id === 'changli_skill2') {
            hero.counters['__changli_empowered'] = state.changliSkill2Empowered ? 1 : 0;
        }
        if (skill.id === 'jetzmi_skill1') {
            hero.counters['__jetzmi_enhanced'] = state.jetzmiSkill1Enhanced ? 1 : 0;
        }
        const result = SkillSystem.executeSkill(hero, skill, targetPositions, state);
        delete hero.counters['__changli_empowered'];
        delete hero.counters['__jetzmi_enhanced'];

        // 如果技能执行失败，添加日志并返回，不消耗行动次数
        if (!result.success) {
            get().addLog({
                type: 'system',
                player: hero.owner,
                message: result.log[0] || '技能释放失败'
            });
            return;
        }

        // 添加日志
        for (const log of result.log) {
            get().addLog({
                type: 'skill',
                player: hero.owner,
                message: log
            });
        }

        // 醉枕刀：技能成功后清除掷刀方向
        if (hero.passiveId === 'zuizhendao_passive') {
            delete hero.counters['__zuizhendao_skill1_dir'];
        }
        if (hero.passiveId === 'dilan_passive') {
            delete hero.counters['__dilan_skill1_axis'];
            delete hero.counters['__dilan_skill2_dir'];
        }

        // 李太白被动链：技能成功后瞬移到历史位置继续攻击，全部用完自动归位
        if (hero.passiveId === 'libai_passive') {
            delete hero.counters['__libai_skill2_dir'];
            const chain = state.libaiChainState;
            if (chain) {
                if (chain.pending.length > 0) {
                    // 链中攻击完成，还有历史位置：高亮等待选择（回到等待瞬移阶段）
                    set({
                        libaiChainState: { ...chain, awaitingPosition: true },
                        highlightedPositions: chain.pending,
                        skillRange: chain.pending,
                        moveRange: [],
                        selectedSkill: null,
                        board: state.board.map(row => [...row]),
                        player1Heroes: [...state.player1Heroes],
                        player2Heroes: [...state.player2Heroes],
                    });
                    get().addLog({
                        type: 'passive',
                        player: hero.owner,
                        message: `${hero.name}可瞬移到历史位置继续攻击（剩余${chain.pending.length}个）`
                    });
                    sendOnlineStateIfNeeded(get());
                    return;
                }
                // 全部用完：归位结束
                finalizeLibaiChain(hero, state, (entry) => get().addLog(entry));
                set({
                    currentPlayer: state.currentPlayer,
                    roundNumber: state.roundNumber,
                    phase: state.phase,
                    winner: state.winner,
                    board: state.board.map(row => [...row]),
                    player1Heroes: [...state.player1Heroes],
                    player2Heroes: [...state.player2Heroes],
                    battleLog: [...get().battleLog],
                    libaiChainState: undefined,
                    selectedSkill: null,
                    highlightedPositions: [],
                    skillRange: [],
                    moveRange: [],
                    selectedHero: state.activeHero,
                    activeHero: state.activeHero
                });
                const after = get();
                sendOnlineActionIfNeeded(after, {
                    type: 'end-turn',
                    data: { heroId: hero.id },
                    meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
                });
                return;
            }
            // 首次技能：有历史位置则进入链（等待选择瞬移位置，期间禁止再次施法）
            const historyPositions = getLibaiHistoryPositions(hero);
            if (historyPositions.length > 0 && hero.position) {
                state.libaiChainState = {
                    heroId: hero.id,
                    home: [...hero.position],
                    pending: historyPositions,
                    awaitingPosition: true
                };
                set({
                    libaiChainState: state.libaiChainState,
                    highlightedPositions: historyPositions,
                    skillRange: historyPositions,
                    moveRange: [],
                    selectedSkill: null,
                    board: state.board.map(row => [...row]),
                    player1Heroes: [...state.player1Heroes],
                    player2Heroes: [...state.player2Heroes],
                });
                get().addLog({
                    type: 'passive',
                    player: hero.owner,
                    message: `${hero.name}酒意上涌，可瞬移到历史位置继续攻击`
                });
                sendOnlineStateIfNeeded(get());
                return;
            }
        }

        // 标记已行动
        hero.hasActedThisTurn = true;

        // 使用GameEngine结束英雄行动（切换玩家）
        GameEngine.endHeroAction(hero, state);

        // 立即使用 set 更新所有状态，确保 React 重新渲染
        // 重要：不要创建新的英雄对象，因为伤害已经应用到原始对象上了
        // 只需要创建新的数组引用来触发 React 重新渲染
        set({
            ...syncEngineFlowFields(state),  // 引擎可能在 endHeroAction 中挂起补员/发起额外行动，必须同步
            board: state.board.map(row => [...row]),  // 浅拷贝，保持英雄对象引用
            player1Heroes: [...state.player1Heroes],  // 浅拷贝，保持英雄对象引用
            player2Heroes: [...state.player2Heroes],  // 浅拷贝，保持英雄对象引用
            battleLog: [...get().battleLog],
            highlightedPositions: state.pendingBoardAction
                ? Array.from({ length: 36 }, (_, index) => [Math.floor(index / 6), index % 6] as Position)
                : [],
            selectedSkill: null,
            baizeReviveTargetHeroId: undefined,
            changliSkill2Empowered: false,
            jetzmiSkill1Enhanced: false,
            pendingSkillTargetPositions: [],
            skillRange: state.pendingBoardAction
                ? Array.from({ length: 36 }, (_, index) => [Math.floor(index / 6), index % 6] as Position)
                : [],
            moveRange: [],
            // 如果GameEngine设置了activeHero（额外行动），则选中并锁定
            selectedHero: state.activeHero,
            activeHero: state.activeHero
        });
        const after = get();
        sendOnlineActionIfNeeded(after, {
            type: 'skill',
            data: {
                heroId: hero.id,
                skillId: skill.id,
                targetPos,
                changliEmpowered: skill.id === 'changli_skill2' && state.changliSkill2Empowered,
                jetzmiEnhanced: skill.id === 'jetzmi_skill1' && state.jetzmiSkill1Enhanced
            },
            meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
        });
    },

    resolvePendingBoardAction: (targetPos: Position) => {
        const state = get();
        const pending = state.pendingBoardAction;
        if (!pending || !isValidBoardPosition(targetPos)) return;
        const hero = [...state.player1Heroes, ...state.player2Heroes].find(item => item.id === pending.heroId);
        if (!hero || hero.state !== HeroState.ALIVE || !hero.position) return;
        const [row, col] = targetPos;
        const occupant = state.board[row][col];
        if (occupant && occupant !== hero) {
            get().addLog({ type: 'system', player: hero.owner, message: '量子跃迁必须选择空位' });
            return;
        }
        const [oldRow, oldCol] = hero.position;
        const oldPosition: Position = [oldRow, oldCol];
        if (state.board[oldRow][oldCol] === hero) state.board[oldRow][oldCol] = null;
        hero.position = targetPos;
        state.board[row][col] = hero;
        DamageCalculator.applyDilanMovementDamage(
            hero,
            MovementSystem.getManhattanDistance(oldPosition, targetPos),
            state
        );
        if (hero.state !== HeroState.ALIVE) {
            state.pendingBoardAction = undefined;
            set({
                pendingBoardAction: undefined,
                board: state.board.map(boardRow => [...boardRow]),
                player1Heroes: [...state.player1Heroes],
                player2Heroes: [...state.player2Heroes],
                highlightedPositions: [],
                skillRange: [],
                selectedHero: null,
                activeHero: null,
                battleLog: [...state.battleLog]
            });
            sendOnlineStateIfNeeded(get());
            return;
        }

        const affected = MovementSystem.getPositionsInRange(targetPos, 2);
        for (const [r, c] of affected) {
            const target = state.board[r][c];
            if (!target || target.owner === hero.owner || target.state !== HeroState.ALIVE) continue;
            const hit = Math.random() < 0.5;
            EffectManager.removeEffectByName(target, '观测坍缩受伤');
            EffectManager.removeEffectByName(target, '观测坍缩未受伤');
            if (hit) {
                const damage = DamageCalculator.calculate(hero, target, 6, false);
                DamageCalculator.applyDamage(target, damage, hero, state, true);
            }
            EffectManager.addEffect(target, {
                type: hit ? 'debuff' : 'mark',
                name: hit ? '观测坍缩受伤' : '观测坍缩未受伤',
                duration: 2,
                sourceHeroId: hero.id,
                description: hit ? '本次观测受到伤害' : '下次受到攻击伤害提高50%'
            });
        }
        state.pendingBoardAction = undefined;
        set({
            pendingBoardAction: undefined,
            board: state.board.map(boardRow => [...boardRow]),
            player1Heroes: [...state.player1Heroes],
            player2Heroes: [...state.player2Heroes],
            highlightedPositions: [],
            skillRange: [],
            battleLog: [...state.battleLog]
        });
        sendOnlineStateIfNeeded(get());
    },

    selectLibaiChainPosition: (position: Position) => {
        const state = get();
        const chain = state.libaiChainState;
        if (!chain || !isValidBoardPosition(position)) return;
        const hero = [...state.player1Heroes, ...state.player2Heroes].find(item => item.id === chain.heroId);
        if (!hero || hero.state !== HeroState.ALIVE || !hero.position) return;
        // 联机模式下只有链英雄所属方（且为当前行动方）能操作链；
        // 否则对手点击同步过来的高亮位置会在本地操纵对方李太白，
        // 且该状态无法通过服务器校验回传，造成两端分叉卡死。
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localKey = getLocalPlayerKey(state);
            if (!localKey || hero.owner !== localKey || state.currentPlayer !== localKey) {
                get().addLog({ type: 'system', player: state.currentPlayer, message: '等待对方完成醉步留痕' });
                return;
            }
        }
        const idx = chain.pending.findIndex(([r, c]) => r === position[0] && c === position[1]);
        if (idx === -1) {
            get().addLog({ type: 'system', player: hero.owner, message: '请选择高亮的历史位置' });
            return;
        }
        const occupant = state.board[position[0]][position[1]];
        if (occupant && occupant !== hero) {
            get().addLog({ type: 'system', player: hero.owner, message: '该位置已被占用，无法瞬移' });
            return;
        }
        // 瞬移
        const [oldRow, oldCol] = hero.position;
        const oldPosition: Position = [oldRow, oldCol];
        if (state.board[oldRow][oldCol] === hero) state.board[oldRow][oldCol] = null;
        hero.position = [position[0], position[1]];
        state.board[position[0]][position[1]] = hero;
        DamageCalculator.applyDilanMovementDamage(
            hero,
            MovementSystem.getManhattanDistance(oldPosition, position),
            state
        );
        if (hero.state !== HeroState.ALIVE) {
            state.libaiChainState = undefined;
            set({
                libaiChainState: undefined,
                board: state.board.map(row => [...row]),
                player1Heroes: [...state.player1Heroes],
                player2Heroes: [...state.player2Heroes],
                highlightedPositions: [],
                skillRange: [],
                moveRange: [],
                selectedSkill: null,
                selectedHero: null,
                activeHero: null,
                battleLog: [...state.battleLog]
            });
            sendOnlineStateIfNeeded(get());
            return;
        }
        const pending = chain.pending.filter((_, i) => i !== idx);
        state.libaiChainState = { ...chain, pending, awaitingPosition: false };
        set({
            libaiChainState: state.libaiChainState,
            board: state.board.map(row => [...row]),
            player1Heroes: [...state.player1Heroes],
            player2Heroes: [...state.player2Heroes],
            highlightedPositions: [],
            skillRange: [],
            moveRange: [],
            selectedSkill: null,
            selectedHero: hero,
            activeHero: hero
        });
        get().addLog({
            type: 'passive',
            player: hero.owner,
            message: `${hero.name}瞬移到(${position[0] + 1},${position[1] + 1})，请选择技能继续攻击，或跳过攻击`
        });
        sendOnlineStateIfNeeded(get());
    },

    skipLibaiChainAttack: () => {
        const state = get();
        const chain = state.libaiChainState;
        if (!chain) return;
        const hero = [...state.player1Heroes, ...state.player2Heroes].find(item => item.id === chain.heroId);
        if (!hero) return;
        // 联机模式下只有链英雄所属方（且为当前行动方）能跳过链攻击（与瞬移选择同一套校验）
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localKey = getLocalPlayerKey(state);
            if (!localKey || hero.owner !== localKey || state.currentPlayer !== localKey) {
                get().addLog({ type: 'system', player: state.currentPlayer, message: '等待对方完成醉步留痕' });
                return;
            }
        }
        if (chain.pending.length > 0) {
            // 还有历史位置：回到选位置阶段（恢复等待瞬移标记，禁止原地施法）
            set({
                libaiChainState: { ...chain, awaitingPosition: true },
                highlightedPositions: chain.pending,
                skillRange: chain.pending,
                moveRange: [],
                selectedSkill: null
            });
            get().addLog({
                type: 'passive',
                player: hero.owner,
                message: `${hero.name}放弃本次攻击，请选择下一个历史位置或结束行动`
            });
            sendOnlineStateIfNeeded(get());
            return;
        }
        // 没有剩余位置：归位结束
        const beforePlayer = state.currentPlayer;
        finalizeLibaiChain(hero, state, (entry) => get().addLog(entry));
        set({
            currentPlayer: state.currentPlayer,
            roundNumber: state.roundNumber,
            phase: state.phase,
            winner: state.winner,
            board: state.board.map(row => [...row]),
            player1Heroes: [...state.player1Heroes],
            player2Heroes: [...state.player2Heroes],
            battleLog: [...get().battleLog],
            libaiChainState: undefined,
            selectedSkill: null,
            highlightedPositions: [],
            skillRange: [],
            moveRange: [],
            selectedHero: state.activeHero,
            activeHero: state.activeHero
        });
        const after = get();
        sendOnlineActionIfNeeded(after, {
            type: 'end-turn',
            data: { heroId: hero.id },
            meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
        });
    },

    endHeroAction: () => {
        const state = get();
        if (!state.selectedHero) {
            // 没有选中英雄时：若当前玩家无可行动英雄（全员眩晕/已行动），自动跳过该玩家
            // 替补制：存在待补员方时不自动跳过，等待其完成上场交互
            if (!state.reinforcingPlayer && GameEngine.getAvailableHeroesForPlayer(state, state.currentPlayer).length === 0) {
                GameEngine.advancePastBlockedPlayer(state);
                set({
                    ...syncEngineFlowFields(state),
                    board: state.board.map(row => [...row]),
                    player1Heroes: [...state.player1Heroes],
                    player2Heroes: [...state.player2Heroes],
                    selectedHero: state.selectedHero,
                    activeHero: state.activeHero,
                    highlightedPositions: [],
                    selectedSkill: null,
                    moveRange: [],
                    skillRange: []
                });
            }
            return;
        }

        const hero = state.selectedHero;
        const wState = state.wukongSkill2State;
        const skill = state.selectedSkill;
        const beforePlayer = state.currentPlayer;

        // 上官婉儿连冲挂起时结束行动：清理连冲状态后正常走结束流程
        // （不提前return——必须让 GameEngine.endHeroAction 执行以触发行动结束后的毛笔移动）
        if (state.shangguanDashState?.heroId === hero.id) {
            set({ shangguanDashState: undefined });
        }

        // 李太白链状态：结束行动 = 归位并结束
        if (state.libaiChainState?.heroId === hero.id) {
            finalizeLibaiChain(hero, state, (entry) => get().addLog(entry));
            set({
                ...syncEngineFlowFields(state),
                board: state.board.map(row => [...row]),
                player1Heroes: [...state.player1Heroes],
                player2Heroes: [...state.player2Heroes],
                battleLog: [...get().battleLog],
                libaiChainState: undefined,
                highlightedPositions: [],
                selectedSkill: null,
                moveRange: [],
                skillRange: [],
                selectedHero: state.activeHero,
                activeHero: state.activeHero
            });
            const after = get();
            sendOnlineActionIfNeeded(after, {
                type: 'end-turn',
                data: { heroId: hero.id },
                meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
            });
            return;
        }
        if (state.isOnlineMode && !state.suppressOnlineBroadcast) {
            const localPlayerKey = getLocalPlayerKey(state);
            if (!localPlayerKey || state.currentPlayer !== localPlayerKey || hero.owner !== localPlayerKey) {
                get().addLog({ type: 'system', player: localPlayerKey ?? state.currentPlayer, message: '当前无法操作' });
                return;
            }
        }

        if (wState && wState.wukongId === hero.id && hero.name === '孙悟空') {
            const settlementSkill = (skill && skill.id === 'wukong_skill2') ? skill : (getSkill('wukong_skill2') ?? getSkill(hero.skill2Id));
            if (!settlementSkill) {
                return;
            }
            const clones = getWukongClonesOnBoard(state, hero.id).filter(c => wState.cloneIds.includes(c.id));

            if (wState.wukongTargetPos) {
                const result = SkillSystem.executeSkill(hero, settlementSkill, [wState.wukongTargetPos], state);
                if (result.success) {
                    for (const log of result.log) {
                        get().addLog({ type: 'skill', player: hero.owner, message: log });
                    }
                }
            }

            for (const clone of clones) {
                const pos = wState.cloneTargetsByCloneId[clone.id];
                if (!pos) continue;
                const cloneResult = SkillSystem.executeSkill(clone, settlementSkill, [pos], state);
                if (cloneResult.success) {
                    for (const log of cloneResult.log) {
                        get().addLog({ type: 'skill', player: hero.owner, message: log });
                    }
                }
            }

            hero.hasActedThisTurn = true;
            GameEngine.endHeroAction(hero, state);

            set({
                ...syncEngineFlowFields(state),
                board: [...state.board],
                player1Heroes: [...state.player1Heroes],
                player2Heroes: [...state.player2Heroes],
                selectedHero: state.activeHero,
                activeHero: state.activeHero,
                highlightedPositions: [],
                selectedSkill: null,
                moveRange: [],
                skillRange: [],
                wukongSkill2State: undefined
            });
            const after = get();
            sendOnlineActionIfNeeded(after, {
                type: 'end-turn',
                data: { heroId: hero.id },
                meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
            });
            return;
        }

        // 标记英雄已行动
        hero.hasActedThisTurn = true;

        // 使用GameEngine结束英雄行动（会修改state对象）
        GameEngine.endHeroAction(hero, state);

        // GameEngine已经修改了state对象，现在需要触发Zustand的更新
        // 重要：需要显式设置 GameEngine 更新的字段（回合流程权威字段统一由 syncEngineFlowFields 提供）
        set({
            ...syncEngineFlowFields(state),
            board: [...state.board],
            player1Heroes: [...state.player1Heroes],
            player2Heroes: [...state.player2Heroes],
            // 如果GameEngine设置了activeHero（额外行动），则选中并锁定
            selectedHero: state.activeHero,
            activeHero: state.activeHero,  // 清除锁定状态或设置新的锁定
            highlightedPositions: [],
            selectedSkill: null,
            baizeReviveTargetHeroId: undefined,
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined
        });
        const after = get();
        sendOnlineActionIfNeeded(after, {
            type: 'end-turn',
            data: { heroId: hero.id },
            meta: { beforePlayer, afterPlayer: after.currentPlayer, afterPhase: after.phase }
        });
    },

    /**
     * executeSkill 的特效包装层：先快照施法者、技能、起手格与日志长度，
     * 再执行原始实现，最后依据"是否产生了非 system 类新日志"判断本次
     * 点击是否真实施法成功——失败分支只会写 system 提示或静默早退。
     * 成功则向特效队列派发一次事件，Board 在起手格与目标格渲染专属动画。
     *
     * 本地玩家、人机 AI 与联机远端动作重放都经由本入口，
     * 因此特效在所有对局形态下表现一致，无需额外的网络消息。
     */
    executeSkill: (targetPos: Position) => {
        const before = get();
        const hero = before.selectedHero;
        const skill = before.selectedSkill;
        const logLengthBefore = before.battleLog.length;
        // 施法前的位置快照：瞬移/移动类技能会改写 hero.position，
        // 必须在执行前捕获起手格
        const casterFromPos: Position = hero?.position ?? targetPos;

        get().executeSkillBase(targetPos);

        if (!hero || !skill) return;
        const freshLogs = get().battleLog.slice(logLengthBefore);
        const castHappened = freshLogs.some(entry => entry.type !== 'system');
        if (!castHappened) return;

        const angleDeg = computeFxAngleDeg(casterFromPos, targetPos);
        get().pushSkillFx({
            profile: resolveSkillFx(skill.id),
            owner: hero.owner,
            fromPos: casterFromPos,
            targetPos,
            angleDeg,
            direction: computeFxDirection(angleDeg),
        });
    },

    pushSkillFx: (event) => {
        const next: SkillFxEvent[] = [
            ...get().skillFx,
            { ...event, id: ++skillFxSeq, bornAt: Date.now() }
        ].slice(-6);
        set({ skillFx: next });
    },

    dismissSkillFx: (id) => {
        set({ skillFx: get().skillFx.filter(fx => fx.id !== id) });
    },

    addLog: (entry) => {
        const state = get();
        const newEntry: BattleLogEntry = {
            ...entry,
            id: `log-${Date.now()}-${Math.random()}`,
            timestamp: Date.now()
        };

        set({
            battleLog: [...state.battleLog, newEntry].slice(-200)
        });
    },

    clearLogs: () => {
        set({ battleLog: [] });
    },

    resetGame: () => {
        set({
            ...createInitialState(),
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined,
            suppressOnlineBroadcast: false
        });
    }
}));
