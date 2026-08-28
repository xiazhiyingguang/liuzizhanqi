import { useGameStore } from '../store/game-store';
import { soundManager } from '../core/sound-manager';
import { getSkillSound } from '../data/skill-sounds';
import {
    computeFxAngleDeg,
    computeFxDirection,
    resolveSkillFx
} from '../core/skill-fx';
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
    'reinforceResumeContext',
    'resumePlayer',
    'pendingForcedActionHeroId',
    'forcedActionResumePlayer'
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
    owner: Player;
    fromPos: Position;
    targetPos: Position;
    /** 快照应用前最后一条日志的 id，用于在新日志里定位本次施法新增的部分 */
    lastLogIdBefore: string | undefined;
}

/**
 * 联机对端的施法表现回放（准备阶段）。
 *
 * 战斗阶段行动方提交的是"技能已结算完"的权威快照，对端直接 setState 落地、
 * 不会重跑 executeSkill —— 而音效挂在 executeSkillBase、特效挂在 executeSkill
 * 包装层，因此未出手的一方原本看不到任何战斗表现。这里按 action 载荷重建：
 * 音效与行动方同一时机播放（结算开始即响），特效所需数据先从本地快照取。
 */
export function prepareOnlineCastReplay(action: any): OnlineCastReplay | null {
    if (action?.type !== 'skill') return null;
    const { heroId, skillId, targetPos } = action.data ?? {};
    if (typeof skillId !== 'string') return null;
    if (!Array.isArray(targetPos) || targetPos.length !== 2) return null;

    const state = useGameStore.getState();
    const hero = [...state.player1Heroes, ...state.player2Heroes].find(h => h.id === heroId);
    soundManager.playSkill(skillId, getSkillSound(skillId));

    return {
        skillId,
        owner: hero?.owner ?? state.currentPlayer,
        // 瞬移/位移类技能会改写 hero.position，必须在快照落地前读起始格
        fromPos: hero?.position ?? (targetPos as Position),
        targetPos: targetPos as Position,
        lastLogIdBefore: state.battleLog[state.battleLog.length - 1]?.id,
    };
}

/**
 * 施法表现回放（确认阶段）：与行动方 executeSkill 用同一判据——
 * 本次动作产生了非 system 类新日志，才视为真实施法并派发特效。
 * 日志按 id 定位而非按长度切片：battleLog 有 200 条上限，截断会让长度差算错。
 */
export function commitOnlineCastReplay(replay: OnlineCastReplay | null): void {
    if (!replay) return;
    const state = useGameStore.getState();
    const anchor = state.battleLog.findIndex(entry => entry.id === replay.lastLogIdBefore);
    const freshLogs = anchor >= 0 ? state.battleLog.slice(anchor + 1) : state.battleLog;
    if (!freshLogs.some(entry => entry.type !== 'system')) return;

    const angleDeg = computeFxAngleDeg(replay.fromPos, replay.targetPos);
    state.pushSkillFx({
        profile: resolveSkillFx(replay.skillId),
        owner: replay.owner,
        fromPos: replay.fromPos,
        targetPos: replay.targetPos,
        angleDeg,
        direction: computeFxDirection(angleDeg),
    });
}

/**
 * 应用"携带权威快照的对手动作"：重建施法表现 → 落地快照 → 确认特效。
 * 抽成单一入口，是为了让联机回归测试驱动与 useOnlineSync 完全相同的分支。
 */
export function applySnapshotAction(action: any, gameState: any): void {
    const castReplay = prepareOnlineCastReplay(action);
    applyServerGameState(gameState);
    commitOnlineCastReplay(castReplay);
}
