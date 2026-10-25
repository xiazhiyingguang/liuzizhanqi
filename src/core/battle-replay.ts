import type { BattleLogEntry, BoardEffect, GameState, Hero, Player, Position } from '../types/game';
import { HeroState } from '../types/game';
import { resolveHeroLinks } from './hero-link-view';

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
/** 单帧内每个单位最多保留的玩家可读计数器条数，控制体积 */
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
    /** 被动 id：机制徽章（月相/王冠/复生…）按它解析 */
    passiveId?: string;
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
    /** 原始计数器（含机制用英文键）：仅供机制徽章与状态解析，不直接展示 */
    rawCounters?: Record<string, number>;
}

export interface ReplayArea {
    type: BoardEffect['type'];
    r: number;
    c: number;
    owner: Player;
    duration: number;
    direction?: BoardEffect['direction'];
    /** 水泽等区域的半径：1=3×3，2=5×5 */
    radius?: number;
}

/** 棋盘上的持久连线（阴阳线/血契/连枝），按帧快照保存，避免回放时重造英雄对象 */
export interface ReplayLink {
    from: [number, number];
    to: [number, number];
    kind: 'yang' | 'yin' | 'rage' | 'frost';
    length: number;
    angleDeg: number;
}

/** 时空停滞残影：阵亡但时间被凝固的单位，仍躺在其死亡格上 */
export interface ReplayGhost {
    def: number;
    r: number;
    c: number;
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
    /** 英雄之间的持久连线 */
    links?: ReplayLink[];
    /** 时空停滞残影 */
    ghosts?: ReplayGhost[];
    /** 本帧对应的战报区间（指向主叙列表，半开区间） */
    logFrom: number;
    logTo: number;
    /** 去重签名：与上一帧相同则不产生新帧 */
    sig: string;
    ended: boolean;
    winner?: Player;
}

export type ReplayMarkKind = 'kill' | 'tianwei' | 'reinforce' | 'return' | 'critical' | 'round' | 'end';

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
                passiveId: hero.passiveId,
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

/** 机制徽章需要、但不在玩家可读中文计数器里的键 */
const MECHANISM_COUNTER_KEYS = new Set(['jetzmi_form', 'wangshu_moon_phase', 'xuanxiao_danger_armed']);

function signatureCounters(hero: Hero): string {
    const parts: string[] = [];
    for (const [name, value] of Object.entries(hero.counters)) {
        if (name.startsWith('__') || !Number.isFinite(value)) continue;
        if (!MECHANISM_COUNTER_KEYS.has(name) && !(value > 0 && /[\u3400-\u9fff]/.test(name))) continue;
        parts.push(`${name}${value}`);
    }
    return parts.join(',');
}

function signatureEffects(hero: Hero): string {
    return hero.effects
        .filter(effect => !effect.name.startsWith('__'))
        .map(effect => `${effect.name}:${effect.stackCount ?? 1}`)
        .join(',');
}

function signatureAreas(effects: BoardEffect[] | undefined): string {
    return (effects ?? [])
        .map(effect => `${effect.type}@${effect.position[0]},${effect.position[1]}:`
            + `${effect.owner}:${effect.duration}:${effect.direction ?? ''}:${effect.radius ?? ''}`)
        .sort()
        .join(';');
}

/**
 * 帧签名的组成：逐单位记录棋盘格坐标、生命、护盾、状态与可见效果。
 * 不能用血量/坐标的“总和”：两人互换位置、一伤一疗同值、换一个场地效果，
 * 总和都可能不变，回放就会整步漏录。这里改为逐单位令牌串，代价仍然只有几十次访问。
 */
export function stepSignature(state: GameState): string {
    const parts: string[] = [
        state.phase,
        String(state.roundNumber),
        state.currentPlayer,
        String(state.actionsThisTurn),
        String(state.actionsRequiredThisTurn),
        String(state.deathCounters?.totalDead ?? 0),
        state.reinforcingPlayer ?? '-',
        state.performingExtraAction ? '1' : '0',
        state.winner ?? '-',
    ];
    const units: string[] = [];
    const onBoard = new Set<string>();
    for (let row = 0; row < state.board.length; row++) {
        for (let col = 0; col < (state.board[row]?.length ?? 0); col++) {
            const hero = state.board[row][col];
            if (!hero) continue;
            onBoard.add(hero.id);
            units.push(`${hero.id}@${row},${col}:${hero.currentHp}:${hero.shield}:${hero.state}`
                + `:${signatureEffects(hero)}:${signatureCounters(hero)}`);
        }
    }
    for (const hero of [...state.player1Heroes, ...state.player2Heroes]) {
        if (onBoard.has(hero.id)) continue;
        units.push(`${hero.id}@off:${hero.currentHp}:${hero.shield}:${hero.state}`
            + `:${signatureEffects(hero)}:${signatureCounters(hero)}`);
    }
    units.sort();
    const actor = state.activeHero ?? state.selectedHero;
    const actorId = actor
        ? `${actor.id}@${actor.position ? `${actor.position[0]},${actor.position[1]}` : '-'}`
        : '-';
    parts.push(units.join('|'), signatureAreas(state.boardEffects), actorId);
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
        .map(effect => [effect.name, effect.stackCount ?? 1] as [string, number]);
}

/** 机制徽章与状态解析需要的原始计数器；`__` 内部标记仍不保留 */
function rawCounters(hero: Hero): Record<string, number> {
    const entries: Record<string, number> = {};
    for (const [name, value] of Object.entries(hero.counters)) {
        if (name.startsWith('__') || !Number.isFinite(value)) continue;
        entries[name] = value;
    }
    return entries;
}

/** 时空停滞残影：阵亡但时间被凝固、且死亡格还空着的单位 */
function stasisGhosts(state: GameState, interner: ReplayInterner): ReplayGhost[] {
    const ghosts: ReplayGhost[] = [];
    for (const hero of [...state.player1Heroes, ...state.player2Heroes]) {
        if (hero.state !== HeroState.DEAD || !hero.position) continue;
        if (hero.class === '通灵') continue;
        if (hero.counters['__isClone'] === 1 || hero.counters['__isSummon'] === 1) continue;
        if (hero.counters['__dai_revived_once']) continue;
        const until = hero.counters['__dai_stasis_until'];
        if (until === undefined || state.roundNumber > until) continue;
        const [row, col] = hero.position;
        if (row < 0 || col < 0 || row >= state.board.length || col >= (state.board[row]?.length ?? 0)) continue;
        if (state.board[row][col]) continue;
        ghosts.push({ def: interner.indexOf(hero), r: row, c: col });
    }
    return ghosts;
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
            rawCounters: rawCounters(hero),
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
        radius: effect.radius,
    }));
    const links: ReplayLink[] = resolveHeroLinks(state.board).map(link => ({
        from: [link.from[0], link.from[1]],
        to: [link.to[0], link.to[1]],
        kind: link.kind,
        length: link.length,
        angleDeg: link.angleDeg,
    }));
    const ghosts = stasisGhosts(state, interner);

    return {
        index,
        round: state.roundNumber,
        player: state.currentPlayer,
        actions: state.actionsThisTurn,
        required: state.actionsRequiredThisTurn,
        actor,
        units,
        areas,
        links,
        ghosts,
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
    // 濒危按"每名单位整局一次"记账：残血往往持续好几回合且来回拉扯，
    // 按回合记账会让同一个名字在关键节点里反复出现。
    const criticalSeen = new Set<number>();
    for (let i = 1; i < frames.length; i++) {
        const previous = frames[i - 1];
        const current = frames[i];
        if (current.round !== previous.round) push(i, 'round', `第 ${current.round} 回合`);
        if (current.ended) push(i, 'end', current.winner ? `${current.winner === 'player1' ? '玩家一' : '玩家二'}获胜` : '对局结束');

        for (const unit of current.units) {
            if (unit.r < 0) continue;
            const before = previous.units.find(candidate => candidate.def === unit.def);
            const isSummon = statics[unit.def]?.heroId.includes('|');
            // 补员是"整局第一次出现"的新单位（替补席里的英雄在上场那一刻才创建）；
            // 老单位从离场状态回到棋盘则是复活/唤回/归位，不能冒充补员。
            if (!isSummon) {
                const name = statics[unit.def]?.name ?? '单位';
                if (!before) push(i, 'reinforce', `${name}替补上场`);
                else if (before.r < 0) push(i, 'return', `${name}返场`);
            }
            // 濒死：从安全区首次跌破阈值
            const ratio = hpRatioOf(current, unit.def, statics);
            const previousRatio = before ? hpRatioOf(previous, unit.def, statics) : null;
            if (ratio === null || previousRatio === null) continue;
            if (
                previousRatio >= CRITICAL_PREVIOUS_FLOOR &&
                ratio < CRITICAL_HP_RATIO &&
                !criticalSeen.has(unit.def)
            ) {
                criticalSeen.add(unit.def);
                push(i, 'critical', `${statics[unit.def]?.name ?? '单位'}跌入濒危（${unit.hp}/${statics[unit.def]?.maxHp}）`);
            }
        }
    }

    // 击杀与它触发的天威是同一次事件的两半，合成一枚标签：
    // 两者都落在同一帧上，分开的话右下角成对刷屏、时间轴刻度也叠在同一个位置。
    const tianweiByFrame = new Map<number, ReplayMark[]>();
    for (const mark of marks) {
        if (mark.kind !== 'tianwei') continue;
        const queue = tianweiByFrame.get(mark.frame) ?? [];
        queue.push(mark);
        tianweiByFrame.set(mark.frame, queue);
    }
    const absorbed = new Set<ReplayMark>();
    for (const mark of marks) {
        if (mark.kind !== 'kill') continue;
        const twin = tianweiByFrame.get(mark.frame)?.shift();
        if (!twin) continue;
        mark.label = `${mark.label}；${twin.label}`;
        absorbed.add(twin);
    }

    return marks
        .filter(mark => !absorbed.has(mark))
        .sort((left, right) => left.frame - right.frame || left.kind.localeCompare(right.kind));
}

export interface ReplayDelta {
    def: number;
    hp: number;
    shield: number;
    /** 数字要落下的格子：优先取当前格；已离场时取上一帧的格子 */
    r: number;
    c: number;
    /** 本步是否从存活转为真实阵亡（离场单位的击杀数字也要能落在死亡格） */
    died: boolean;
}

/** 相邻两帧的血量/护盾变化：v1 用它代替特效重放，在格子上标注本步挨了多少打、回了多少 */
export function computeFrameDeltas(prevFrame: ReplayFrame | null, frame: ReplayFrame): ReplayDelta[] {
    if (!prevFrame) return [];
    const previousDefs = new Map(prevFrame.units.map(unit => [unit.def, unit]));
    const currentDefs = new Map(frame.units.map(unit => [unit.def, unit]));
    const defs = new Set([...previousDefs.keys(), ...currentDefs.keys()]);
    const deltas: ReplayDelta[] = [];
    for (const def of [...defs].sort((left, right) => left - right)) {
        const before = previousDefs.get(def);
        if (!before) continue;
        const after = currentDefs.get(def);
        const hp = (after?.hp ?? 0) - before.hp;
        const shield = (after?.shield ?? 0) - before.shield;
        const died = !after || (after.state === 2 && before.state !== 2);
        if (hp === 0 && shield === 0 && !died) continue;
        const spot = after && after.r >= 0 ? after : before.r >= 0 ? before : null;
        if (!spot) continue;
        deltas.push({ def, hp, shield, r: spot.r, c: spot.c, died });
    }
    return deltas;
}
