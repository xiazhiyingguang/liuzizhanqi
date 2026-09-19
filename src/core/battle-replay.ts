import type { BattleLogEntry, BoardEffect, GameState, Hero, Player, Position } from '../types/game';
import { HeroState } from '../types/game';

/**
 * 对局回放的数据层（纯函数 + 纯类型，不依赖 store，便于单测）。
 *
 * 设计要点：
 * - 帧只存**数字与字符串**，绝不持有 Hero 对象引用。棋盘格里的 Hero 是活引用，
 *   `undoMove` 等流程还会原地改写 `hero.position`，一旦引用进帧里，历史帧会"跟着现在变"。
 * - `Skill` 带 `execute` 函数，`structuredClone` 会直接抛错，所以也不进帧。
 * - 战报另存一条不受 `battleLog` 200 条环形上限影响的主叙列表，
 *   每帧记录 `[logFrom, logTo)` 区间，回放时能准确回答"这一步发生了什么"。
 */

/** 帧数硬上限：约 50 回合大师级 AI 对局的量级；超限后转入按回合抽样 */
export const MAX_REPLAY_FRAMES = 1400;
/** 主叙列表上限，防止极端长局无限增长 */
export const MAX_REPLAY_NARRATION = 4000;
/** 生命比例首次跌破该值记一个"濒死"关键节点 */
export const CRITICAL_HP_RATIO = 0.25;
/** 从该值以上跌破濒死线才算一次新事件，避免残血单位每步都打点 */
const CRITICAL_PREVIOUS_FLOOR = 0.5;
/** 单帧内每个单位最多保留的状态/计数器条数，控制体积 */
const MAX_UNIT_EFFECTS = 6;
const MAX_UNIT_COUNTERS = 4;

export interface ReplayStatic {
    /** 英雄实例 id（含部署后缀，保证同模板多实例也能跨帧唯一比对） */
    heroId: string;
    /** 模板 id：头像与线性图标按它解析 */
    templateId: string;
    name: string;
    className: string;
    owner: Player;
    maxHp: number;
}

export interface ReplayUnit {
    /** 指向 BattleReplay.statics */
    def: number;
    /** 棋盘坐标；不在场上时为 -1, -1 */
    r: number;
    c: number;
    hp: number;
    shield: number;
    /** 0=存活 1=暂时阵亡 2=真实阵亡 */
    state: 0 | 1 | 2;
    /** 状态名与层数，供状态光效与信息面板复用 */
    effects: Array<[string, number]>;
    /** 玩家可见的中文计数器（破锋/潮汐/暗夜星火…） */
    counters: Array<[string, number]>;
}

export interface ReplayArea {
    type: BoardEffect['type'];
    r: number;
    c: number;
    owner: Player;
    duration: number;
    direction?: BoardEffect['direction'];
}

export interface ReplayFrame {
    index: number;
    round: number;
    player: Player;
    actions: number;
    required: number;
    /** 当前行动者在 units 中的下标；-1 表示无 */
    actor: number;
    units: ReplayUnit[];
    areas: ReplayArea[];
    /** 本帧对应的战报区间（指向主叙列表，半开区间） */
    logFrom: number;
    logTo: number;
    /** 去重签名：与上一帧相同则不产生新帧 */
    sig: string;
    ended: boolean;
    winner?: Player;
}

export type ReplayMarkKind = 'kill' | 'tianwei' | 'reinforce' | 'critical' | 'round' | 'end';

export interface ReplayMark {
    frame: number;
    kind: ReplayMarkKind;
    label: string;
}

/** AI 在一次决策里看到的单个候选方案 */
export interface AiDecisionCandidate {
    skillId: string;
    score: number;
}

/**
 * AI 的一次技能决策留档：复盘时用来回答"它当时为什么这么选、放弃了什么"。
 * regret > 0 说明 AI 主动放弃了分数最高的候选（低难度的失误抖动或技能多样性采样）。
 */
export interface AiDecision {
    seq: number;
    round: number;
    player: Player;
    heroId: string;
    heroName: string;
    /** 决策时该英雄本回合是否已经移动过 */
    hadMoved: boolean;
    /** 决策发生时已录到第几帧，便于和回放时间轴对齐 */
    frame: number;
    candidates: AiDecisionCandidate[];
    chosenSkillId: string | null;
    chosenScore: number | null;
    bestScore: number | null;
    regret: number | null;
}

/** 决策记录上限：一场对局约 8 人 × 50 回合，留足余量即可 */
export const MAX_REPLAY_DECISIONS = 3000;

export interface BattleReplay {
    matchId?: string;
    statics: ReplayStatic[];
    narration: BattleLogEntry[];
    frames: ReplayFrame[];
    marks: ReplayMark[];
    decisions: AiDecision[];
    /** 是否因超过帧上限而按回合抽样；界面据此提示 */
    coarsened: boolean;
}

export interface ReplayInterner {
    statics: ReplayStatic[];
    indexOf: (hero: Hero) => number;
}

/** 把英雄实例 id 归一成模板 id，供头像与线性图标解析 */
export function templateIdOf(hero: Hero): string {
    return hero.id.replace(/-(player1|player2)-\d+$/, '');
}

/** 创建跨帧稳定的单位登记表：同一实例在任何帧里都指向同一个 statics 下标 */
export function createInterner(): ReplayInterner {
    const byHeroId = new Map<string, number>();
    const statics: ReplayStatic[] = [];
    return {
        statics,
        indexOf(hero) {
            const existing = byHeroId.get(hero.id);
            if (existing !== undefined) return existing;
            const index = statics.length;
            statics.push({
                heroId: hero.id,
                templateId: templateIdOf(hero),
                name: hero.name,
                className: hero.class,
                owner: hero.owner,
                maxHp: hero.maxHp,
            });
            byHeroId.set(hero.id, index);
            return index;
        },
    };
}

function heroStateCode(hero: Hero): 0 | 1 | 2 {
    if (hero.state === HeroState.ALIVE) return 0;
    if (hero.state === HeroState.TEMP_DEAD) return 1;
    return 2;
}

/** 帧签名的组成：只读原始字段，约 30 次访问，可以在每次 store 提交时廉价调用 */
export function stepSignature(state: GameState): string {
    const parts: string[] = [
        state.phase,
        String(state.roundNumber),
        state.currentPlayer,
        String(state.actionsThisTurn),
        String(state.boardEffects?.length ?? 0),
        String(state.deathCounters?.totalDead ?? 0),
        state.reinforcingPlayer ?? '-',
        state.performingExtraAction ? '1' : '0',
    ];
    let hpSum = 0;
    let posSum = 0;
    let actorId = '-';
    for (const row of state.board) {
        for (const cell of row) {
            if (!cell) continue;
            hpSum += cell.currentHp + cell.shield;
            posSum += cell.position ? cell.position[0] * 6 + cell.position[1] + 1 : 0;
        }
    }
    for (const hero of [...state.player1Heroes, ...state.player2Heroes]) {
        if (!hero.position) {
            hpSum += hero.currentHp + hero.shield;
            posSum += 997;
        }
    }
    const actor = state.activeHero ?? state.selectedHero;
    if (actor) actorId = `${actor.id}@${actor.position ? `${actor.position[0]},${actor.position[1]}` : '-'}`;
    parts.push(String(hpSum), String(posSum), actorId);
    return parts.join('|');
}

/** 场上单位优先取棋盘格（位置权威），再补上名单里未上场的（替补/阵亡/暂时阵亡） */
function collectUnits(state: GameState): Hero[] {
    const seen = new Map<string, Hero>();
    for (const row of state.board) {
        for (const cell of row) {
            if (cell) seen.set(cell.id, cell);
        }
    }
    for (const hero of [...state.player1Heroes, ...state.player2Heroes]) {
        if (!seen.has(hero.id)) seen.set(hero.id, hero);
    }
    return [...seen.values()];
}

/**
 * 单位当前真正占据的棋盘格。
 * 只认棋盘，不认 hero.position：位移类结算若漏改 position，回放就会把棋子画到旧格；
 * 离场单位（阵亡/暂时阵亡/替补）也保留着死亡时的 position，
 * 照那个值画就会和后来站上这格的单位叠在一起，回放棋盘于是"少了几格、位置乱跳"。
 */
function boardCellsByHero(state: GameState): Map<string, Position> {
    const cells = new Map<string, Position>();
    for (let row = 0; row < state.board.length; row++) {
        for (let col = 0; col < (state.board[row]?.length ?? 0); col++) {
            const hero = state.board[row][col];
            if (hero) cells.set(hero.id, [row, col]);
        }
    }
    return cells;
}

/** 只保留玩家可读的中文计数器，隐藏 `__` 开头的内部标记 */
function readableCounters(hero: Hero): Array<[string, number]> {
    const entries: Array<[string, number]> = [];
    for (const [name, value] of Object.entries(hero.counters)) {
        if (!Number.isFinite(value) || value <= 0) continue;
        if (!/[\u3400-\u9fff]/.test(name)) continue;
        entries.push([name, value]);
        if (entries.length >= MAX_UNIT_COUNTERS) break;
    }
    return entries;
}

function readableEffects(hero: Hero): Array<[string, number]> {
    return hero.effects
        .filter(effect => !effect.name.startsWith('__'))
        .slice(0, MAX_UNIT_EFFECTS)
        .map(effect => [effect.name, effect.stackCount ?? 1] as [string, number]);
}

/**
 * 由当前 store 状态构建一帧。
 * `logFrom` / `logTo` 是主叙列表下标区间，由录制器负责推进。
 */
export function buildFrame(
    state: GameState,
    index: number,
    sig: string,
    logFrom: number,
    logTo: number,
    interner: ReplayInterner
): ReplayFrame {
    const actorHero = state.activeHero ?? state.selectedHero;
    const cells = boardCellsByHero(state);
    const units: ReplayUnit[] = collectUnits(state).map(hero => {
        const cell = cells.get(hero.id);
        return {
            def: interner.indexOf(hero),
            r: cell ? cell[0] : -1,
            c: cell ? cell[1] : -1,
            hp: hero.currentHp,
            shield: hero.shield,
            state: heroStateCode(hero),
            effects: readableEffects(hero),
            counters: readableCounters(hero),
        };
    });
    // 按登记顺序排序，保证同一帧序列里 units 的次序稳定，便于跨帧比对
    units.sort((left, right) => left.def - right.def);

    const actorDef = actorHero ? interner.indexOf(actorHero) : -1;
    const actor = actorDef < 0 ? -1 : units.findIndex(unit => unit.def === actorDef);

    const areas: ReplayArea[] = (state.boardEffects ?? []).map(effect => ({
        type: effect.type,
        r: effect.position[0],
        c: effect.position[1],
        owner: effect.owner,
        duration: effect.duration,
        direction: effect.direction,
    }));

    return {
        index,
        round: state.roundNumber,
        player: state.currentPlayer,
        actions: state.actionsThisTurn,
        required: state.actionsRequiredThisTurn,
        actor,
        units,
        areas,
        logFrom,
        logTo,
        sig,
        ended: state.phase === 'ended',
        winner: state.winner,
    };
}

/** 抽样模式下的准入判据：回合/行动方切换或本帧有人掉血才留帧 */
export function isCoarseWorthy(prevFrame: ReplayFrame | null, frame: ReplayFrame): boolean {
    if (!prevFrame) return true;
    if (frame.round !== prevFrame.round) return true;
    if (frame.player !== prevFrame.player) return true;
    if (frame.ended) return true;
    const previousHp = new Map(prevFrame.units.map(unit => [unit.def, unit.hp]));
    for (const unit of frame.units) {
        const before = previousHp.get(unit.def);
        if (before !== undefined && unit.hp < before) return true;
    }
    return false;
}

/** 单位在某帧里的生命比例；找不到返回 null（新召唤或未登场） */
function hpRatioOf(frame: ReplayFrame, def: number, statics: ReplayStatic[]): number | null {
    const unit = frame.units.find(candidate => candidate.def === def);
    const maxHp = statics[def]?.maxHp;
    if (!unit || !maxHp) return null;
    return unit.hp / maxHp;
}

/**
 * 从帧序列与战报里提取关键节点。纯函数，界面打开时算一次。
 * 优先用结构化信号（日志 type、帧差分），不做中文文案匹配。
 */
export function detectKeyMoments(frames: ReplayFrame[], statics: ReplayStatic[], narration: BattleLogEntry[]): ReplayMark[] {
    if (frames.length === 0) return [];
    const marks: ReplayMark[] = [];
    const seenKeys = new Set<string>();
    const push = (frameIndex: number, kind: ReplayMarkKind, label: string) => {
        const key = `${frameIndex}:${kind}:${label}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        marks.push({ frame: frameIndex, kind, label });
    };

    // 日志类节点：把每条战报归到"区间包含它的最后一帧"
    for (let logIndex = 0; logIndex < narration.length; logIndex++) {
        const entry = narration[logIndex];
        if (entry.type !== 'kill' && entry.type !== 'tianwei') continue;
        let owner = -1;
        for (let i = frames.length - 1; i >= 0; i--) {
            if (logIndex >= frames[i].logFrom && logIndex < frames[i].logTo) { owner = i; break; }
        }
        if (owner < 0) continue;
        push(owner, entry.type === 'kill' ? 'kill' : 'tianwei', entry.message);
    }

    // 帧差分节点：补员上场、濒死、回合切换、终局
    const criticalSeen = new Set<number>();
    for (let i = 1; i < frames.length; i++) {
        const previous = frames[i - 1];
        const current = frames[i];
        if (current.round !== previous.round) push(i, 'round', `第 ${current.round} 回合`);
        if (current.ended) push(i, 'end', current.winner ? `${current.winner === 'player1' ? '玩家一' : '玩家二'}获胜` : '对局结束');

        for (const unit of current.units) {
            if (unit.r < 0) continue;
            const before = previous.units.find(candidate => candidate.def === unit.def);
            // 补员/新单位上场：上一帧不在场上，且不是召唤物/分身（其 id 含分隔符）
            if (before && before.r < 0 && !statics[unit.def]?.heroId.includes('|')) {
                push(i, 'reinforce', `${statics[unit.def]?.name ?? '单位'}替补上场`);
            }
            // 濒死：从安全区首次跌破阈值
            const ratio = hpRatioOf(current, unit.def, statics);
            const previousRatio = before ? hpRatioOf(previous, unit.def, statics) : null;
            if (ratio === null || previousRatio === null) continue;
            if (
                previousRatio >= CRITICAL_PREVIOUS_FLOOR &&
                ratio < CRITICAL_HP_RATIO &&
                !criticalSeen.has(unit.def * 10000 + current.round)
            ) {
                criticalSeen.add(unit.def * 10000 + current.round);
                push(i, 'critical', `${statics[unit.def]?.name ?? '单位'}跌入濒危（${unit.hp}/${statics[unit.def]?.maxHp}）`);
            }
        }
    }

    return marks.sort((left, right) => left.frame - right.frame || left.kind.localeCompare(right.kind));
}

export interface ReplayDelta {
    def: number;
    hp: number;
    shield: number;
}

/** 相邻两帧的血量/护盾变化：v1 用它代替特效重放，在格子上标注本步挨了多少打、回了多少 */
export function computeFrameDeltas(prevFrame: ReplayFrame | null, frame: ReplayFrame): ReplayDelta[] {
    if (!prevFrame) return [];
    const previousDefs = new Map(prevFrame.units.map(unit => [unit.def, unit]));
    const deltas: ReplayDelta[] = [];
    for (const unit of frame.units) {
        const before = previousDefs.get(unit.def);
        if (!before) continue;
        const hp = unit.hp - before.hp;
        const shield = unit.shield - before.shield;
        if (hp === 0 && shield === 0) continue;
        deltas.push({ def: unit.def, hp, shield });
    }
    return deltas;
}
