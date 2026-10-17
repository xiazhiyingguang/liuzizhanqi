import { useGameStore } from '../store/game-store';
import { collectFormShiftLogIds } from '../core/mechanism-fx-events';
import {
    collectImpactPositions,
    primarySkillFxLogs,
    computeFxAngleDeg,
    computeFxDirection,
    computeSkillAreaBounds,
    resolveSkillFx,
    SKILL_FX_PROFILES
} from '../core/skill-fx';
import { computeFxCoveredPositions } from '../core/skill-fx-coverage';
import { MovementSystem } from '../core/movement-system';
import { getSkill } from '../data/skills';
import { collapseCoalescedSkillFxRequests } from '../data/extended-skills';
import type { PendingSkillFxRequest } from '../data/extended-skills';
import type { Player, Position } from '../types/game';

/**
 * 联机快照归一化与本地应用。
 * 从 useOnlineSync 中抽出为纯模块：联机回归测试需要直接驱动同一份逻辑，
 * 而不是在测试里复刻一份会漂移的实现。
 */

const isCloneHero = (hero: any) => {
    if (!hero) return false;
    if (hero?.counters?.['__isClone'] === 1) return true;
    if (typeof hero?.id === 'string' && (hero.id.startsWith('wukong-clone|') || hero.id.startsWith('mirror-clone|'))) {
        return true;
    }
    return false;
};

export function normalizeGameState(gameState: any) {
    if (!gameState) return gameState;
    const player1Heroes = Array.isArray(gameState.player1Heroes)
        ? gameState.player1Heroes.filter((h: any) => !isCloneHero(h))
        : [];
    const player2Heroes = Array.isArray(gameState.player2Heroes)
        ? gameState.player2Heroes.filter((h: any) => !isCloneHero(h))
        : [];
    const byId = new Map<string, any>();
    for (const hero of [...player1Heroes, ...player2Heroes]) {
        if (hero?.id) byId.set(hero.id, hero);
    }

    const board = Array.isArray(gameState.board)
        ? gameState.board.map((row: any[]) =>
            Array.isArray(row)
                ? row.map((cell: any) => {
                    if (!cell) return null;
                    // 真实死亡与暂时阵亡都不应再占据棋盘格：
                    // 暂时阵亡英雄在快照里仍带 position，若不清理会在对端"诈尸"成
                    // 0 血占位单位，还会挡住补员落位与移动路径。
                    if (cell?.state === 'dead' || cell?.state === 'temp_dead') return null;
                    const found = cell?.id ? byId.get(cell.id) : null;
                    if (found) {
                        if (!found.position && cell.position) found.position = cell.position;
                        return found;
                    }
                    if (cell?.id) byId.set(cell.id, cell);
                    return cell;
                })
                : row
        )
        : gameState.board;

    // 只有存活英雄才回填棋盘；暂时阵亡(0血)与真实死亡英雄一律不再回填，
    // 修复"对手出手后本方暂时阵亡英雄突然诈尸占位"的问题。
    for (const hero of byId.values()) {
        if (hero?.state !== 'alive') continue;
        if (!hero?.position || !Array.isArray(hero.position)) continue;
        const [r, c] = hero.position;
        if (board?.[r]?.[c] == null) {
            board[r][c] = hero;
        }
    }

    const ensureList = (list: any[], owner: 'player1' | 'player2') => {
        const existing = new Set(list.map(h => h?.id).filter(Boolean));
        for (const hero of byId.values()) {
            if (hero?.owner !== owner) continue;
            if (isCloneHero(hero)) continue;
            if (!existing.has(hero.id)) {
                list.push(hero);
                existing.add(hero.id);
            }
        }
    };

    ensureList(player1Heroes, 'player1');
    ensureList(player2Heroes, 'player2');

    const mapHero = (hero: any) => {
        if (!hero?.id) return hero ?? null;
        return byId.get(hero.id) || hero;
    };

    // 自愈守卫：醉步留痕链只在链主人的行动回合内存在。
    // 若收到的链不属于当前行动方，说明这是一条已经结束的残留链被对端回传，
    // 照单收下会让本地李太白卡在"被动链进行中"而无法移动/施法，直接丢弃。
    const chain = gameState.libaiChainState;
    const chainOwner = chain?.heroId ? byId.get(chain.heroId) : null;
    const libaiChainState =
        chainOwner && chainOwner.owner !== gameState.currentPlayer ? undefined : chain;

    return {
        ...gameState,
        board,
        player1Heroes,
        player2Heroes,
        selectedHero: mapHero(gameState.selectedHero),
        activeHero: mapHero(gameState.activeHero),
        libaiChainState
    };
}

/**
 * 以"字段缺失"表达"已清理"的挂起态字段。
 *
 * 联机传输是 JSON 编码，值为 undefined 的属性会被整体丢弃，而 setState 是浅合并
 * （快照里没有的 key 会保留本地旧值）。因此发起方 `set({ libaiChainState: undefined })`
 * 这类清理动作传不到对端：对端会一直留着这条链，并在自己行动时原样回传给真正的拥有者，
 * 拥有者本地守卫（被动链进行中禁止移动/施法）随即把该英雄锁死。
 * 应用快照时必须显式补回缺失的 key，清理信号才能生效。
 */
const CLEAR_WHEN_MISSING_KEYS = [
    'libaiChainState',
    'shangguanDashState',
    'wukongSkill2State',
    'pendingBoardAction',
    'baizeReviveTargetHeroId',
    'daiReviveHeroId',
    'reinforceResumeContext',
    'resumePlayer',
    'pendingForcedActionHeroId',
    'forcedActionResumePlayer',
    'skillFxExtras'
] as const;

export function applyServerGameState(gameState: any) {
    if (!gameState) return;
    const normalized = normalizeGameState(gameState);
    const {
        localPlayerNumber: _lp,
        localPlayerName: _ln,
        isOnlineMode: _online,
        onlineRoomId: _room,
        ...rest
    } = normalized;
    const patch = rest as Record<string, any>;
    for (const key of CLEAR_WHEN_MISSING_KEYS) {
        if (!(key in normalized)) patch[key] = undefined;
    }
    useGameStore.setState(patch);
}

/** 一次待确认的施法表现回放：记录行动方施法瞬间本地 store 里才有的信息 */
export interface OnlineCastReplay {
    skillId: string;
    sourceHeroId?: string;
    owner: Player;
    fromPos: Position;
    targetPos: Position;
    /** 快照应用前的日志 id 集合，用于差分出新日志 */
    logIdsBefore: Set<string>;
}

/**
 * 联机对端的施法表现回放（准备阶段）。
 *
 * 战斗阶段行动方提交的是"技能已结算完"的权威快照，对端直接 setState 落地、
 * 不会重跑 executeSkill。这里按 action 载荷重建事件，音效和画面统一由
 * pushSkillFx 派发，特效所需数据先从本地快照取。
 */
export function prepareOnlineCastReplay(action: any): OnlineCastReplay | null {
    if (action?.type !== 'skill') return null;
    const { heroId, skillId, targetPos } = action.data ?? {};
    if (typeof skillId !== 'string') return null;
    if (!Array.isArray(targetPos) || targetPos.length !== 2) return null;

    const state = useGameStore.getState();
    const hero = [...state.player1Heroes, ...state.player2Heroes].find(h => h.id === heroId);

    return {
        skillId,
        sourceHeroId: hero?.id,
        owner: hero?.owner ?? state.currentPlayer,
        // 瞬移/位移类技能会改写 hero.position，必须在快照落地前读起始格
        fromPos: hero?.position ?? (targetPos as Position),
        targetPos: targetPos as Position,
        logIdsBefore: new Set(state.battleLog.map(entry => entry.id)),
    };
}

/**
 * 施法表现回放（确认阶段）：与行动方 executeSkill 用同一判据——
 * 本次动作产生了非 system 类新日志，才视为真实施法并派发特效。
 * 新日志按 id 集合差分取出：battleLog 里伤害日志是原地 push、其余是换新数组，
 * 两者混排后并不按时间有序，按锚点切片会把本次的伤害日志漏掉。
 *
 * 也供"纯状态同步"路径（game-state-update）复用：挂起选格确认、行动结束的延迟段
 * 这些走 sync 而不是 action 的更新，若不在这里重建，对手整段都看不到画面与音效。
 */
export function commitOnlineTriggeredFx(logIdsBefore: Set<string>): void {
    const state = useGameStore.getState();
    const requests: PendingSkillFxRequest[] = [];
    for (const log of state.battleLog.filter(entry => !logIdsBefore.has(entry.id))) {
        const request = log.details?.skillFxRequest as PendingSkillFxRequest | undefined;
        if (!request || !SKILL_FX_PROFILES[request.skillId]) continue;
        requests.push(request);
    }
    // 与本地派发同一套合并口径：逐格上报的恢复段只响一次音效
    for (const request of collapseCoalescedSkillFxRequests(requests)) {
        const angleDeg = computeFxAngleDeg(request.fromPos, request.targetPos);
        state.pushSkillFx({ ...request, profile: resolveSkillFx(request.skillId), angleDeg,
            direction: computeFxDirection(angleDeg), coveredPositions: request.coveredPositions ?? request.impactPositions });
    }
}

export function commitOnlineCastReplay(replay: OnlineCastReplay | null): void {
    if (!replay) return;
    const state = useGameStore.getState();
    const freshLogs = state.battleLog.filter(entry => !replay.logIdsBefore.has(entry.id));
    if (!freshLogs.some(entry => entry.type !== 'system')) return;

    const extras = state.skillFxExtras;
    useGameStore.setState({ skillFxExtras: undefined });
    const fromPos = extras?.fromPos ?? replay.fromPos;
    const targetPos = extras?.targetPos ?? replay.targetPos;
    const angleDeg = computeFxAngleDeg(fromPos, targetPos);
    // 与行动方 executeSkill 包装层同判据：命中格取本次新增日志，区域格按技能几何重算。
    // 两者只依赖静态技能数据与已随快照同步的 battleLog，无需新增网络字段。
    // 特例：绯雪技能1击碎冰冻时，行动方以 fxVariant 切换「破冰爆震」形态，
    // 对端按其专属技能日志（"击碎了…的冰冻"）识别同一形态并同步铺 3x3 爆震范围。
    const shatteredFrozen = replay.skillId === 'feixue_skill1' &&
        freshLogs.some(entry => entry.type === 'skill' && /击碎了.+的冰冻/.test(entry.message));
    const profile = extras?.fxVariant && SKILL_FX_PROFILES[extras.fxVariant]
        ? SKILL_FX_PROFILES[extras.fxVariant]
        : shatteredFrozen
        ? (SKILL_FX_PROFILES.feixue_shatter ?? resolveSkillFx(replay.skillId))
        : resolveSkillFx(replay.skillId);
    const ownLogs = primarySkillFxLogs(freshLogs, replay.sourceHeroId);
    const impacts = collectImpactPositions(ownLogs, targetPos);
    const coveredPositions = extras?.coveredPositions?.length ? extras.coveredPositions
        : shatteredFrozen ? [targetPos, ...MovementSystem.getAreaPositions(targetPos, 3)]
        : computeFxCoveredPositions(getSkill(replay.skillId), fromPos, targetPos, profile);
    state.pushSkillFx({
        profile,
        skillId: replay.skillId,
        sourceHeroId: replay.sourceHeroId,
        logIds: replay.skillId === 'jetzmi_skill2'
            ? [...ownLogs.map(entry => entry.id), ...collectFormShiftLogIds(freshLogs, replay.sourceHeroId)]
            : ownLogs.map(entry => entry.id),
        damagePositions: impacts.damagePositions ?? [],
        empowered: extras?.empowered,
        owner: replay.owner,
        fromPos,
        targetPos,
        angleDeg,
        direction: computeFxDirection(angleDeg),
        impactPositions: ['coin-blessing', 'chord-aura', 'chord-notes'].includes(profile.kind)
            ? coveredPositions : impacts.impactPositions,
        softImpactPositions: profile.recovery === 'sonata' ? coveredPositions : impacts.softImpactPositions,
        coveredPositions,
        splashPositions: extras?.splashPositions,
        chainLinks: extras?.chainLinks,
        areaBounds: profile.fxArea === 'none' ? undefined : computeSkillAreaBounds(getSkill(replay.skillId) ?? { type: 'special', rangeType: 'single' }, coveredPositions) ?? undefined,
    });
}

/** 服务端席位重连宽限（对应 server.js 的 RECONNECT_GRACE_MS），仅用于对面也掉线时的倒计时显示 */
const RESUME_OPPONENT_GRACE_MS = 120_000;

/**
 * 掉线重连后重建局面：战斗阶段直接落服务端权威快照；选将/布阵阶段按服务端记录重放。
 * 抽到 online-state 里是因为两条回席路径（连接自动重连、刷新后重新输入房间码）
 * 必须走同一份实现，否则一边能救回对局、另一边不能。
 */
export function applyResumePayload(payload: any): void {
    const store = useGameStore.getState();
    useGameStore.setState({ suppressOnlineBroadcast: true });
    try {
        store.initGame();
        // 模式要在回放选将之前落位：确认选将时按它决定进"武装"还是直接"布阵"
        useGameStore.setState({ gameMode: payload.gameMode === 'classic' ? 'classic' : 'standard' });
        // initGame 会清掉联机临时状态，重连标记必须落在它之后
        useGameStore.setState({
            isOnlineMode: true,
            onlineRoomId: payload.roomId ?? useGameStore.getState().onlineRoomId,
            localPlayerNumber: payload.playerNumber ?? useGameStore.getState().localPlayerNumber,
            onlineSelfReconnecting: false,
            onlineOpponentOfflineUntil: payload.opponentOffline
                ? Date.now() + RESUME_OPPONENT_GRACE_MS
                : undefined
        });

        if (payload.gameState) {
            applyServerGameState(payload.gameState);
            return;
        }

        for (const side of ['player1', 'player2'] as const) {
            for (const heroId of payload.heroSelections?.[side] ?? []) {
                useGameStore.getState().selectHeroForPlayer(side, heroId);
            }
            if (payload.heroSelectReady?.[side]) {
                useGameStore.getState().confirmHeroSelectionForPlayer(side);
            }
        }
        // 武装账本重放：标准模式房间里 phase 已是 deploy，这段会被阶段守卫自然挡掉
        for (const side of ['player1', 'player2'] as const) {
            for (const heroId of Object.keys(payload.weaponSelections?.[side] ?? {})) {
                useGameStore.getState().toggleWeaponForPlayer(side, heroId);
            }
            if (payload.weaponReady?.[side]) {
                useGameStore.getState().confirmWeaponSelectionForPlayer(side);
            }
        }
        if (payload.phase === 'deploy' || payload.phase === 'battle') {
            for (const side of ['player1', 'player2'] as const) {
                for (const [heroId, cell] of payload.deployments?.[side] ?? []) {
                    const [row, col] = String(cell).split(',').map(Number);
                    useGameStore.getState().deployHeroForPlayer(side, heroId, [row, col]);
                }
                if (payload.deployReady?.[side]) {
                    useGameStore.getState().confirmDeploymentForPlayer(side);
                }
            }
        }
    } catch (error) {
        console.error('[联机同步] 重连后重建局面失败:', error);
    } finally {
        useGameStore.setState({ suppressOnlineBroadcast: false });
    }
}

/**
 * 应用"携带权威快照的对手动作"：重建施法表现 → 落地快照 → 确认特效。
 * 抽成单一入口，是为了让联机回归测试驱动与 useOnlineSync 完全相同的分支。
 */
export function applySnapshotAction(action: any, gameState: any): void {
    const logIdsBefore = new Set(useGameStore.getState().battleLog.map(log => log.id));
    const castReplay = prepareOnlineCastReplay(action);
    applyServerGameState(gameState);
    commitOnlineTriggeredFx(logIdsBefore);
    commitOnlineCastReplay(castReplay);
}
