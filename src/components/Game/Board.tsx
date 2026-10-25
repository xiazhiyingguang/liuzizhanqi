import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useGameStore, getPendingActionCells } from '../../store/game-store';
import { Position, type Hero } from '../../types/game';
import { GameEngine } from '../../core/game-engine';
import type { SkillFxEvent } from '../../core/skill-fx';
import { computeFxAngleDeg, computeFxLogImpactDelayMs, computeFxDirection, resolveSkillFx } from '../../core/skill-fx';
import { cellFxKey, planCellFx } from '../../core/cell-fx-arbitration';
import { collectMirrorBladeFx } from '../../core/mirror-blade-fx';
import HeroAvatar from '../ui/HeroAvatar';
import HeroStatusPopover from './HeroStatusPopover';
import { SkillAreaFx, SkillFxLifecycle, SkillFxVisual } from './SkillFxLayer';
import { HeroStatusFx } from './HeroStatusFx';
import { WindBladeGlyph } from './WindBladeGlyph';
import { resolveHeroLinks } from '../../core/hero-link-view';
import { isLowQuality } from '../../core/render-quality';
import { marshCovers } from '../../core/water-marsh';
import { lampShadows } from '../../core/lamp-shadow';
import { ThunderCloudLayer } from './ThunderCloudField';
import { isYunxiuCloudFx } from '../../core/yunxiu-cloud-fx';
import '../../styles/thunder-cloud-fx.css';
import { guardedCellKeys } from '../../core/mountain-stance';
import { resolveHitFeedback, type HitFeedback } from '../../core/hit-feedback';
import { HitContactFx, HitResponsivePiece } from './HitFeedbackFx';
import { useAoyuanPresentation } from '../../hooks/useAoyuanPresentation';

/**
 * 流畅档下一张范围技能最多铺开几格"逐格特效"（impact/area）。
 * 主目标格的那一份始终保留，其余按离主目标的远近取前几格：
 * 一次范围技能按格复制出的动画数是手机上掉帧的主因（实测同屏可到 90+）。
 */
const LOW_QUALITY_FX_CELL_LIMIT = 4;

/** 束缚格的四条边：true = 这一侧贴着圈外，要画一道锁栏 */
type BindingEdgeMask = { north: boolean; east: boolean; south: boolean; west: boolean };

function bindingEdgeMask(cells: Set<string> | undefined, row: number, col: number): BindingEdgeMask {
    const outside = (r: number, c: number) => !cells?.has(`${r},${c}`);
    return {
        north: outside(row - 1, col),
        east: outside(row, col + 1),
        south: outside(row + 1, col),
        west: outside(row, col - 1),
    };
}

/**
 * 锁栏向格缝两侧各探出 4px，相邻格的同侧栏才能在 6px 缝隙里搭接成不断线；
 * 但转角处两侧都有栏时，探出去的那截会戳到笼子外面变成毛刺，所以要收口。
 */
function bindingBarClass(side: keyof BindingEdgeMask, edges: BindingEdgeMask): string {
    const vertical = side === 'north' || side === 'south';
    const shortBar = side === 'east' || side === 'west';
    const barKey = { north: 'n', east: 'e', south: 's', west: 'w' }[side];
    const before = vertical ? edges.west : edges.north;
    const after = vertical ? edges.east : edges.south;
    const beforeCls = shortBar ? 'bf-cap-t' : 'bf-cap-l';
    const afterCls = shortBar ? 'bf-cap-b' : 'bf-cap-r';
    return `bf-binding-bar bf-binding-bar-${barKey}${before ? ` ${beforeCls}` : ''}${after ? ` ${afterCls}` : ''}`;
}

type FloatingDamage = {
    id: number;
    row: number;
    col: number;
    amount: number;
    kind: 'damage' | 'crit' | 'heal' | 'burn' | 'bleed' | 'chain' | 'shield';
    /** 同格错位序号：多段伤害/追击同时落格时错开显示，避免叠成一团 */
    offsetIndex: number;
    delayMs: number;
    shieldBroken?: boolean;
};

/** 灼烧跳伤/流血移动掉血的格子小特效（一次性爆点，由 damage 日志 fxTag 驱动） */
type MinorFx = {
    id: number;
    row: number;
    col: number;
    kind: 'burn-tick' | 'bleed-tick';
};

/** 英雄阵亡的水墨消散特效（由 kill 日志 details.victimPosition 驱动） */
type DeathFx = {
    id: number;
    row: number;
    col: number;
    delayMs: number;
};

type SkillFxVariant = 'caster' | 'target' | 'impact' | 'area' | 'splash' | 'chain';

/** 一格内的最终渲染清单：主效全尺寸，回声缩进格角，第三份起只剩格边短线 */
type CellFxRender = {
    event: SkillFxEvent;
    variant: SkillFxVariant;
    emphasis: 'main' | 'echo';
};
type CellFxCellPlan = {
    renders: CellFxRender[];
    notches: SkillFxEvent[];
    hot: boolean;
};
const EMPTY_CELL_FX_PLAN: CellFxCellPlan = { renders: [], notches: [], hot: false };

/** 格边短线的颜色：优先用技能档案主色，缺省退回施法方阵营色 */
function cellFxNotchColor(event: SkillFxEvent): string {
    return event.profile.c1 ?? (event.owner === 'player1'
        ? 'rgba(63, 143, 107, 0.9)'
        : 'rgba(192, 57, 43, 0.9)');
}

/** 同格飘字偏移表（px）：第 0 条居中，后续左右交错向上错开 */
const FLOATING_OFFSETS: Array<[number, number]> = [
    [0, 0],
    [-18, -14],
    [18, -14],
    [-18, -28],
    [18, -28],
];

/** 风道风向的中文显示名（上=吹向北、下=吹向南…） */
const WIND_LANE_DIRECTION_LABELS: Record<'up' | 'down' | 'left' | 'right', string> = {
    up: '北',
    down: '南',
    left: '西',
    right: '东',
};

/** 挂起选格时的提示语（天威/被动触发后必须在棋盘上说清楚"现在点哪"） */
const PENDING_CHOICE_HINTS: Record<string, { title: string; detail: string }> = {
    'yunying-liehuo': { title: '烈火燎原', detail: '点选云缨相邻的方向格，决定这道火线烧向哪条线' },
    'yunying-tianwei': { title: '云缨·天威', detail: '点选一处与她同行、同列或同对角线的空格，枪光斩向那里' },
    'xueqi-tianwei': { title: '血契·天威', detail: '点选一处空格跃落' },
    'zhiguang-tianwei': { title: '折光·天威', detail: '点选一处空格降落，以落点为中心展开 5×5 万华镜光界' },
    'schrodinger-tianwei': { title: '薛定谔·天威', detail: '点选一格确定观测落点' },
    'jiangtaigong-hook': { title: '姜太公·鱼钩', detail: '有人上钩了：点选场上任意空格，把这个人抛到那里（吃10点伤害）' },
};

export default function Board() {
    const {
        board,
        boardEffects,
        battleLog,
        skillFx,
        selectedHero,
        highlightedPositions,
        selectHeroForAction,
        moveRange,
        skillRange,
        moveHero,
        executeSkill,
        pendingBoardAction,
        isOnlineMode,
        localPlayerNumber,
        suppressOnlineBroadcast,
        resolvePendingBoardAction,
        isAiMode,
        aiPlayer,
        currentPlayer,
        libaiChainState,
        selectLibaiChainPosition,
        pendingSkillTargetPositions,
        reinforcingPlayer,
        reinforcementSelectableHeroId,
        deployReinforcement,
        player1Heroes,
        player2Heroes,
        roundNumber,
        selectedSkill,
        daiReviveHeroId,
        selectDaiReviveTarget,
        releaseAutoBattle
    } = useGameStore();
    const dragonPresentation = useAoyuanPresentation(skillFx);

    // 挂起的棋盘动作：可点格直接从挂起态推导，不依赖各条 set 路径是否记得同步 skillRange，
    // 否则会出现"天威已经触发、棋盘上却没有任何提示"的错觉
    // 岱宗的镇守护的是"半区"，不摆出来玩家根本不知道自己盖住了哪几列——
    // 实测玩家把岱宗摆在边列时朝右摆只能护住一列，看起来就像技能毫无作用
    const daizongGuardedCells = guardedCellKeys({ player1Heroes, player2Heroes });
    const pendingChoiceHero = pendingBoardAction
        ? [...player1Heroes, ...player2Heroes].find(item => item.id === pendingBoardAction.heroId)
        : undefined;
    const pendingChoiceCells = pendingBoardAction
        ? getPendingActionCells({
            pendingBoardAction, player1Heroes, player2Heroes, board,
            isOnlineMode, isAiMode, localPlayerNumber, suppressOnlineBroadcast,
        })
        : [];
    // 不是本地该操作的挂起（例如电脑的天威落点）就不给提示，免得看着像自己的回合
    const pendingChoiceHint = pendingBoardAction && pendingChoiceCells.length > 0
        ? PENDING_CHOICE_HINTS[pendingBoardAction.type]
        : undefined;
    const isPendingChoice = (row: number, col: number): boolean =>
        pendingChoiceCells.some(([r, c]) => r === row && c === col);

    // 伤害飘字：订阅战斗日志增量，把新产生的伤害解析到对应格子
    const [floatingDamages, setFloatingDamages] = useState<FloatingDamage[]>([]);
    const [minorFx, setMinorFx] = useState<MinorFx[]>([]);
    const [deathFx, setDeathFx] = useState<DeathFx[]>([]);
    const [hitFeedbacks, setHitFeedbacks] = useState<HitFeedback[]>([]);
    const hitCleanupTimers = useRef(new Set<number>());
    const [shakeKey, setShakeKey] = useState(0);
    const shellRef = useRef<HTMLDivElement>(null);
    const seenLogIdsRef = useRef<Set<string> | null>(null);
    const floatingIdRef = useRef(0);

    useEffect(() => {
        const timers = hitCleanupTimers.current;
        return () => { for (const timer of timers) window.clearTimeout(timer); timers.clear(); };
    }, []);

    useEffect(() => {
        const log = battleLog ?? [];
        // 日志满 200 条后 addLog 会做环形截断，长度不再单调增长，
        // 只能按条目身份识别新增，否则长对局里飘字会彻底停止出现。
        const seenIds = seenLogIdsRef.current;
        const fresh = seenIds ? log.filter(entry => !seenIds.has(entry.id)) : [];
        seenLogIdsRef.current = new Set(log.map(entry => entry.id));
        if (log.length === 0) {
            setHitFeedbacks([]);
            for (const timer of hitCleanupTimers.current) window.clearTimeout(timer);
            hitCleanupTimers.current.clear();
        }
        if (fresh.length === 0) return;
        // 先派发整批镜刃，再读伤害/击杀，让飘字与实际抵达时刻对齐。
        for (const event of collectMirrorBladeFx(fresh)) useGameStore.getState().pushSkillFx(event);

        const next: FloatingDamage[] = [];
        const nextMinor: MinorFx[] = [];
        const nextDeath: DeathFx[] = [];
        const nextHits: HitFeedback[] = [];
        const hitCounts = new Map<string, number>();
        let killShakes = 0;
        for (const entry of fresh) {
            if (!entry.details) continue;
            const { amount, isCrit, kind, position, fxTag, victimPosition, fxSkillId, fxFrom, fxTarget, hpDamage, shieldDamage, shieldBroken } = entry.details as {
                amount?: number;
                isCrit?: boolean;
                kind?: string;
                position?: number[];
                fxTag?: string;
                victimPosition?: number[];
                fxSkillId?: string;
                fxFrom?: number[];
                fxTarget?: number[];
                hpDamage?: number;
                shieldDamage?: number;
                shieldBroken?: boolean;
            };
            // 引擎内部触发的攻击（如镜的"破镜之刃"）通过日志标记请求特效：
            // fxSkillId 指向特效档案，fxFrom→fxTarget 为飞刃动线（无起点则原格起爆）
            if (typeof fxSkillId === 'string' && fxSkillId !== 'mirror_blade' && fxTarget && fxTarget.length === 2) {
                const targetCell: Position = [fxTarget[0], fxTarget[1]];
                const fromCell: Position =
                    fxFrom && fxFrom.length === 2 ? [fxFrom[0], fxFrom[1]] : targetCell;
                const angle = computeFxAngleDeg(fromCell, targetCell);
                useGameStore.getState().pushSkillFx({
                    profile: resolveSkillFx(fxSkillId),
                    owner: entry.player,
                    fromPos: fromCell,
                    targetPos: targetCell,
                    angleDeg: angle,
                    direction: computeFxDirection(angle),
                });
            }
            // 阵亡特效：kill 日志携带阵亡格坐标，驱动水墨消散动画并触发全局震屏
            if (entry.type === 'kill' && victimPosition && victimPosition.length === 2) {
                const event = [...useGameStore.getState().skillFx].reverse().find(fx => fx.logIds?.includes(entry.id));
                const delayMs = event ? Math.max(0, computeFxLogImpactDelayMs(event, [victimPosition[0], victimPosition[1]], entry.id) - (Date.now() - event.bornAt)) : 0;
                nextDeath.push({
                    id: floatingIdRef.current++,
                    row: victimPosition[0],
                    col: victimPosition[1],
                    delayMs,
                });
                // 只有真英雄阵亡才配一次全局震屏：召唤物/分身被打散是"清掉一个场"，不是"击杀"
                if (kind === 'hero-kill') {
                    if (delayMs > 0) window.setTimeout(() => setShakeKey(key => key + 1), delayMs);
                    else killShakes += 1;
                }
                continue;
            }
            if (typeof amount !== 'number' || amount <= 0) continue;
            if (!position || position.length !== 2) continue;
            const fxEvent = [...useGameStore.getState().skillFx].reverse().find(event => event.logIds?.includes(entry.id));
            const delayMs = fxEvent ? Math.max(0, computeFxLogImpactDelayMs(fxEvent, [position[0], position[1]], entry.id) - (Date.now() - fxEvent.bornAt)) : 0;
            const hitKey = `${fxEvent?.id ?? entry.id}-${position.join(',')}-${entry.type}`;
            const hitIndex = hitCounts.get(hitKey) ?? 0;
            hitCounts.set(hitKey, hitIndex + 1);
            if (entry.type === 'damage') {
                const contactDelay = delayMs + (fxEvent?.mirrorBlades ? 0 : hitIndex * 130);
                const contact = resolveHitFeedback(entry, Date.now() + contactDelay, fxEvent?.fromPos);
                if (contact) nextHits.push(contact);
                // 来源标签：灼烧/流血/链电伤害的飘字换用专属配色
                const taggedKind: FloatingDamage['kind'] =
                    fxTag === 'burn' ? 'burn' :
                    fxTag === 'bleed' ? 'bleed' :
                    fxTag === 'chain' ? 'chain' :
                    (shieldDamage ?? 0) > 0 && hpDamage === 0 ? 'shield' :
                    isCrit ? 'crit' : 'damage';
                next.push({
                    id: floatingIdRef.current++,
                    row: position[0],
                    col: position[1],
                    amount,
                    kind: taggedKind,
                    offsetIndex: 0,
                    // 镜刃已有逐刃发射时钟，不再叠加通用多段伤害的错峰延迟。
                    delayMs: contactDelay,
                    shieldBroken,
                });
                // 灼烧跳伤/流血掉血：格子上一记小火爆点/血溅
                if (fxTag === 'burn' || fxTag === 'bleed') {
                    nextMinor.push({
                        id: floatingIdRef.current++,
                        row: position[0],
                        col: position[1],
                        kind: fxTag === 'burn' ? 'burn-tick' : 'bleed-tick',
                    });
                }
            } else if (entry.type === 'heal') {
                next.push({
                    id: floatingIdRef.current++,
                    row: position[0],
                    col: position[1],
                    amount,
                    kind: 'heal',
                    offsetIndex: 0,
                    delayMs,
                });
            }
        }
        if (nextHits.length > 0) {
            const ids = new Set(nextHits.map(hit => hit.id));
            setHitFeedbacks(previous => [...previous, ...nextHits].slice(-72));
            const timer = window.setTimeout(() => {
                setHitFeedbacks(previous => previous.filter(hit => !ids.has(hit.id)));
                hitCleanupTimers.current.delete(timer);
            }, Math.max(...nextHits.map(hit => hit.at - Date.now())) + 750);
            hitCleanupTimers.current.add(timer);
        }
        if (next.length > 0) {
            const ids = next.map(item => item.id);
            setFloatingDamages(prev => {
                const cellCounts = new Map<string, number>();
                for (const item of prev) {
                    const key = `${item.row}-${item.col}`;
                    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
                }
                const withOffset = next.map(item => {
                    const key = `${item.row}-${item.col}`;
                    const idx = cellCounts.get(key) ?? 0;
                    cellCounts.set(key, idx + 1);
                    return { ...item, offsetIndex: idx };
                });
                return [...prev, ...withOffset];
            });
            window.setTimeout(() => {
                setFloatingDamages(prev => prev.filter(item => !ids.includes(item.id)));
            }, 1000 + Math.max(...next.map(item => item.delayMs)));
        }
        if (nextMinor.length > 0) {
            const ids = nextMinor.map(item => item.id);
            setMinorFx(prev => [...prev, ...nextMinor]);
            window.setTimeout(() => {
                setMinorFx(prev => prev.filter(item => !ids.includes(item.id)));
            }, 750);
        }
        if (nextDeath.length > 0) {
            const ids = nextDeath.map(item => item.id);
            setDeathFx(prev => [...prev, ...nextDeath]);
            window.setTimeout(() => {
                setDeathFx(prev => prev.filter(item => !ids.includes(item.id)));
            }, 1000 + Math.max(...nextDeath.map(item => item.delayMs)));
        }
        if (killShakes > 0) {
            setShakeKey(key => key + killShakes);
        }
    }, [battleLog]);

    // 击杀震屏：重触发式动画（先移除类名再强制回流，快速连杀时每杀都完整播放）
    useEffect(() => {
        if (shakeKey === 0) return;
        const el = shellRef.current;
        if (!el) return;
        el.classList.remove('stage-shake');
        void el.offsetWidth;
        el.classList.add('stage-shake');
        const timer = window.setTimeout(() => el.classList.remove('stage-shake'), 400);
        return () => window.clearTimeout(timer);
    }, [shakeKey]);

    const handleCellClick = (e: MouseEvent, row: number, col: number) => {
        e.preventDefault();
        e.stopPropagation();

        // AI 接管中玩家点棋盘＝收回这一侧的操作权，本次点击照常执行。
        // 放在 AI 回合门禁之前：对手回合点一下也该把接管停下来。
        releaseAutoBattle();

        // 人机模式下 AI 回合禁止玩家操作；
        // 但补员挂起期间回合尚未切边（currentPlayer 可能仍是 AI），
        // 此时必须放行人类补员方的落位点击，否则替补永远无法上场。
        const humanReinforcePending = reinforcingPlayer !== null && reinforcingPlayer !== aiPlayer;
        if (isAiMode && currentPlayer === aiPlayer && !humanReinforcePending) return;

        const targetPos: Position = [row, col];

        // 替补制补员模式：点击本方半场空格让替补英雄上场
        if (reinforcingPlayer && reinforcementSelectableHeroId) {
            if (!isReinforceTarget(row, col)) return;
            deployReinforcement(targetPos);
            return;
        }

        if (pendingBoardAction) {
            resolvePendingBoardAction(targetPos);
            return;
        }

        // 李太白链状态：点击历史位置进行瞬移
        if (libaiChainState && libaiChainState.pending.some(([r, c]) => r === row && c === col)) {
            selectLibaiChainPosition(targetPos);
            return;
        }

        // 戴尔「时空回溯」第一段：点击时空停滞残影锚定要唤回的阵亡单位，随后在空格上选落点
        if (selectedSkill?.id === 'dai_skill1') {
            const ghost = stasisGhostAt(row, col);
            if (ghost && isStasisAnchorable(ghost)) {
                selectDaiReviveTarget(ghost.id);
                return;
            }
        }

        if (moveRange.length > 0 && isHighlighted(row, col)) {
            moveHero(targetPos);
            return;
        }

        // 只有真的选好了技能才把点击交给 executeSkill：残留的 skillRange（例如挂起收尾时
        // 把整盘涂成可攻击格）否则会把每一格点击都吞成一次空释放，表现为"满盘红格却点不动"
        if (skillRange.length > 0 && selectedSkill && isHighlighted(row, col)) {
            executeSkill(targetPos);
            return;
        }

        const hero = board[row][col];
        if (hero) {
            selectHeroForAction(hero);
        }
    };

    const isHighlighted = (row: number, col: number): boolean => {
        return highlightedPositions.some(([r, c]) => r === row && c === col);
    };

    // 补员落位判定：补员方本方半场的空格
    const isReinforceTarget = (row: number, col: number): boolean => {
        if (!reinforcingPlayer || !reinforcementSelectableHeroId) return false;
        const isP1Half = col < 3;
        if (reinforcingPlayer === 'player1' && !isP1Half) return false;
        if (reinforcingPlayer === 'player2' && isP1Half) return false;
        return board[row][col] === null;
    };

    const isMoveTarget = (row: number, col: number): boolean => {
        return moveRange.length > 0 && isHighlighted(row, col);
    };

    const isSkillTarget = (row: number, col: number): boolean => {
        return skillRange.length > 0 && isHighlighted(row, col);
    };

    // 束缚区的持续显示：同一次施法布下的格子共用一个 linkId，先按组归拢，
    // 每格再算出自己哪几条边贴着"圈外"——这样 3×3 的锁栏能连成一体，
    // 而不是九个各自独立的虚线框（血契的环形禁足也走同一套判据）
    const bindingGroups = useMemo(() => {
        const groups = new Map<string, Set<string>>();
        for (const effect of boardEffects ?? []) {
            if (effect.type !== 'binding-zone') continue;
            const key = effect.linkId ?? `single-${effect.id}`;
            const cells = groups.get(key) ?? new Set<string>();
            cells.add(`${effect.position[0]},${effect.position[1]}`);
            groups.set(key, cells);
        }
        return groups;
    }, [boardEffects]);

    // 夕月辞的灯影：由"灯 + 此刻站位"当场推导，影子不占格——别人照样能走上去，
    // 但这一格从此替本体挨打。逐格建一次索引供 36 格查表，免得每格重扫一遍灯与人。
    const lampShadowNames = useMemo(() => {
        const byCell = new Map<string, string[]>();
        for (const shadow of lampShadows({ board, boardEffects, player1Heroes, player2Heroes })) {
            const key = `${shadow.cell[0]},${shadow.cell[1]}`;
            const names = byCell.get(key) ?? [];
            if (!names.includes(shadow.body.name)) names.push(shadow.body.name);
            byCell.set(key, names);
        }
        return byCell;
    }, [board, boardEffects, player1Heroes, player2Heroes]);

    // 命中本格的技能特效事件：起手格渲染光环，目标格渲染主效，溅射格与链电链路格
    // 渲染各自的多格变体；AOE 真正打到的每一格各渲染一份 impact，
    // 落在作用区域但未被更强变体占用的格子渲染 area 贴地底光
    const lowQualityFxCellBudget = isLowQuality() ? LOW_QUALITY_FX_CELL_LIMIT : 0;

    /**
     * 逐格特效按格建索引，一次算好供 36 格查表。
     * 原来每格都把整条特效队列重扫一遍（36 格 × 队列 × 5 个坐标数组的 some），
     * 施法时队列每变一次就要重做一轮，等于把特效数量平方付在主线程上。
     * 低画质还顺手限制一张 AOE 能铺开的逐格份数：区域底光/印记是按格复制的，
     * 一次范围技能就能把同屏动画数顶到近百个。
     */
    const fxHitCells = useMemo(() => {
        const index = new Map<string, Array<{ event: SkillFxEvent; variant: SkillFxVariant }>>();
        const push = (row: number, col: number, event: SkillFxEvent, variant: SkillFxVariant) => {
            const key = `${row},${col}`;
            const list = index.get(key);
            if (!list) {
                index.set(key, [{ event, variant }]);
                return;
            }
            if (!list.some(hit => hit.event.id === event.id && hit.variant === variant)) {
                list.push({ event, variant });
            }
        };
        const byDistanceToTarget = (event: SkillFxEvent) => (a: Position, b: Position): number => {
            const span = (cell: Position) =>
                (cell[0] - event.targetPos[0]) ** 2 + (cell[1] - event.targetPos[1]) ** 2;
            return span(a) - span(b);
        };
        const budget = (event: SkillFxEvent, cells: Position[]): Position[] => {
            if (!lowQualityFxCellBudget || cells.length <= lowQualityFxCellBudget) return cells;
            return [...cells].sort(byDistanceToTarget(event)).slice(0, lowQualityFxCellBudget);
        };

        for (const event of skillFx) {
            if (isYunxiuCloudFx(event.profile.kind)) {
                push(event.targetPos[0], event.targetPos[1], event, 'target');
                continue;
            }
            push(event.fromPos[0], event.fromPos[1], event, 'caster');
            push(event.targetPos[0], event.targetPos[1], event, 'target');
            for (const [row, col] of event.splashPositions ?? []) push(row, col, event, 'splash');
            for (const [row, col] of event.chainLinks ?? []) push(row, col, event, 'chain');

            // 主目标格已承载完整主效，同格不再重复出 impact；其余命中格各来一份
            const impactCells = (event.impactPositions ?? []).filter(
                ([row, col]) => row !== event.targetPos[0] || col !== event.targetPos[1]
            );
            // 燎原火墙的首格已由 target 那份高火焰承载，别再叠一份同尺寸火舌
            const areaCells = (event.coveredPositions ?? []).filter(cell =>
                !impactCells.some(other => other[0] === cell[0] && other[1] === cell[1]) &&
                !(event.profile.kind === 'liehuo-blaze' &&
                    cell[0] === event.targetPos[0] && cell[1] === event.targetPos[1])
            );
            for (const [row, col] of budget(event, impactCells)) push(row, col, event, 'impact');
            for (const [row, col] of budget(event, areaCells)) push(row, col, event, 'area');
        }
        return index;
    }, [skillFx, lowQualityFxCellBudget]);

    // 一格一主演出：同格多来源先仲裁，再交给格子渲染；回声与短线只表达"还有谁打到这格"
    const fxCellPlans = useMemo(() => {
        const plans = new Map<string, CellFxCellPlan>();
        for (const [cellKey, entries] of fxHitCells) {
            const plan = planCellFx(entries.map(({ event, variant }) => ({ eventId: event.id, variant })));
            const renders: CellFxRender[] = [];
            for (const { event, variant } of entries) {
                const role = plan.roles.get(cellFxKey(event.id, variant));
                if (role === 'show') renders.push({ event, variant, emphasis: 'main' });
                else if (role === 'echo') renders.push({ event, variant, emphasis: 'echo' });
            }
            const notches = plan.notchEventIds
                .map(eventId => entries.find(entry => entry.event.id === eventId)?.event)
                .filter((event): event is SkillFxEvent => Boolean(event));
            if (renders.length === 0 && notches.length === 0) continue;
            plans.set(cellKey, { renders, notches, hot: plan.hot });
        }
        return plans;
    }, [fxHitCells]);

    // 时空停滞残影：被戴尔凝固时间的阵亡单位，其死亡格上留下的可点残影
    const stasisGhostAt = (row: number, col: number): Hero | null => {
        if (board[row]?.[col]) return null;
        return [...player1Heroes, ...player2Heroes].find(hero =>
            GameEngine.isInStasis(hero, roundNumber) &&
            hero.position?.[0] === row && hero.position?.[1] === col
        ) ?? null;
    };

    // 残影是否可点：本方戴尔选中「时空回溯」且尚未锚定时，第一段就是点残影
    const isStasisAnchorable = (ghost: Hero): boolean =>
        selectedSkill?.id === 'dai_skill1' &&
        !daiReviveHeroId &&
        selectedHero?.passiveId === 'dai_passive' &&
        selectedHero?.owner === ghost.owner;

    return (
        <div className="battle-board-shell" ref={shellRef}>
            <SkillFxLifecycle />
            <div className="battle-field battle-board-frame">
                <div className="battle-board-grid">
                    {board.map((row, rowIndex) =>
                        row.map((cell, colIndex) => {
                            const isSelected = selectedHero?.position?.[0] === rowIndex &&
                                selectedHero?.position?.[1] === colIndex;
                            const moveTarget = isMoveTarget(rowIndex, colIndex);
                            const skillTarget = isSkillTarget(rowIndex, colIndex);
                            const bladeMark = boardEffects?.some(
                                effect =>
                                    effect.type === 'blade-mark' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            const darkCircle = boardEffects?.some(
                                effect =>
                                    effect.type === 'dark-circle' &&
                                    Math.abs(effect.position[0] - rowIndex) <= 1 &&
                                    Math.abs(effect.position[1] - colIndex) <= 1
                            );
                            const iceCrystal = boardEffects?.some(
                                effect =>
                                    effect.type === 'ice-crystal' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            const sandDune = boardEffects?.some(
                                effect =>
                                    effect.type === 'sand-dune' &&
                                    Math.abs(effect.position[0] - rowIndex) <= 1 &&
                                    Math.abs(effect.position[1] - colIndex) <= 1
                            );
                            const brush = boardEffects?.find(
                                effect =>
                                    effect.type === 'brush' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            const bindingZone = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'binding-zone' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            const bindingEdges = bindingZone
                                ? bindingEdgeMask(
                                    bindingGroups.get(bindingZone.linkId ?? `single-${bindingZone.id}`),
                                    rowIndex, colIndex)
                                : null;
                            // 一格最多同时被横、纵两道风道覆盖，因此取列表而非单个
                            const windLanes = (boardEffects ?? []).filter(
                                effect =>
                                    effect.type === 'wind-lane' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            const windBlade = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'wind-blade' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            // 轩辕神君的飞剑：命中痕迹、昭神态的跃剑跳板与御剑回收的资源，同屏至多 6 把
                            const flyingSword = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'flying-sword' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            // 双飞燕的回旋镖：落在格上，按她的出手序号返航；两把可以叠在同一格
                            const boomerangsHere = (boardEffects ?? []).filter(
                                effect =>
                                    effect.type === 'boomerang' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            const boomerang = boomerangsHere[0];
                            const boomerangSource = boomerang
                                ? [...player1Heroes, ...player2Heroes].find(item => item.id === boomerang.sourceHeroId)
                                : undefined;
                            const boomerangRemaining = boomerang?.returnAtSkillSerial !== undefined && boomerangSource
                                ? Math.max(0, boomerang.returnAtSkillSerial - (boomerangSource.counters['sfy_skillSerial'] ?? 0))
                                : undefined;
                            const boomerangTitle = boomerang
                                ? `回旋镖：${boomerangRemaining !== undefined
                                    ? `再${boomerangRemaining}次出手后沿最短路径返航`
                                    : '下下次出手后沿最短路径返航'}`
                                : '';
                            // 镜花·水月的两枚镜像标记：水月（可踏的跳板）与月座（等她归场）
                            const waterMoon = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'water-moon' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            const moonSeat = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'moon-seat' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            // 花弄影甩在场上的影子：重演的落点，也是弄影的换身跳板
                            const shadowMark = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'shadow-mark' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            // 折光布下的光棱：她技能二的光束扫到这一格就会换轴折射一次并追加伤害
                            const lightPrism = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'light-prism' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            // 姜太公的水泽：覆盖窗口由 water-marsh 统一算（贴边整体平移，不裁切）
                            const marshesHere = (boardEffects ?? []).filter(effect =>
                                effect.type === 'water-marsh' && marshCovers(effect, rowIndex, colIndex));
                            const waterMarsh = marshesHere[0];
                            // 鱼钩：沉在某一格里，敌人经过即上钩
                            const fishHook = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'fish-hook' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            // 引雷针：钉在一格里，只管用一次——下一拍所有云都朝它挪一格
                            const lightningRod = (boardEffects ?? []).find(
                                effect =>
                                    effect.type === 'lightning-rod' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            // 夕月辞的明灯：她点的灯，也包括她倒下后留下的那一盏
                            const lamp = (boardEffects ?? []).find(
                                effect =>
                                    (effect.type === 'lit-lamp' || effect.type === 'wake-lamp') &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
                            // 压在本格上的灯影：影子不占格，所以站着的人可以和影子同框
                            const lampShadowHere = lampShadowNames.get(`${rowIndex},${colIndex}`);
                            // 时空停滞残影：本格空着、但躺着一个被戴尔凝固时间的阵亡单位
                            const stasisGhost = stasisGhostAt(rowIndex, colIndex);
                            const stasisAnchored = stasisGhost !== null && daiReviveHeroId === stasisGhost.id;
                            const stasisCallable = stasisGhost !== null && isStasisAnchorable(stasisGhost);

                            let cellClass = 'battle-cell';
                            // 复活落点是"把人放下来"，不是攻击：用补员落位那套青金标记，避免整盘泛红
                            const reviveLanding = daiReviveHeroId !== undefined && skillTarget;
                            // 烈火燎原这类"只有几格可选"的挂起选择：给一套专属焰色脉冲标记，
                            // 不能和普通攻击高亮混为一谈，否则玩家不知道被动已经触发
                            const pendingChoice = (pendingBoardAction?.type === 'yunying-liehuo' ||
                                pendingBoardAction?.type === 'yunying-tianwei' ||
                                pendingBoardAction?.type === 'zhiguang-tianwei') &&
                                isPendingChoice(rowIndex, colIndex);
                            // 鱼钩抛掷的可选落点是"全盘任意空格"：套用烈焰脉冲会把整盘涂成一片噪声，
                            // 换成一层很轻的水纹描边，玩家读的是"能落"而不是"在闪"
                            const hookLandingChoice = pendingBoardAction?.type === 'jiangtaigong-hook' &&
                                isPendingChoice(rowIndex, colIndex);
                            // 箭头朝向即这条火线烧过去的方向（云缨 → 本格）
                            const pendingChoiceRot = pendingChoice && pendingChoiceHero?.position
                                ? computeFxAngleDeg(pendingChoiceHero.position, [rowIndex, colIndex])
                                : 0;
                            if (isSelected) cellClass += ' cell-selected';
                            else if (pendingChoice) cellClass += ' cell-pending-choice';
                            else if (hookLandingChoice) cellClass += ' cell-hook-landing';
                            else if (moveTarget) cellClass += ' cell-move';
                            else if (reviveLanding) cellClass += ' cell-move';
                            else if (skillTarget) cellClass += ' cell-attack';
                            else if (isReinforceTarget(rowIndex, colIndex)) cellClass += ' cell-move';

                            // 受击只由真实伤害日志派发；不再把点选格或闪避当作命中。
                            const cellContacts = hitFeedbacks.filter(hit => hit.row === rowIndex && hit.col === colIndex);
                            // 多目标技能的已选格（如凋零播撒的第一角）：金色角标标记
                            const pickedCorner = (pendingSkillTargetPositions ?? []).some(
                                ([r, c]) => r === rowIndex && c === colIndex
                            );
                            const cellFxPlan = fxCellPlans.get(`${rowIndex},${colIndex}`) ?? EMPTY_CELL_FX_PLAN;

                            return (
                                <div
                                    key={`${rowIndex}-${colIndex}`}
                                    data-testid={`battle-cell-${rowIndex}-${colIndex}`}
                                    onClick={(e) => handleCellClick(e, rowIndex, colIndex)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    style={{ userSelect: 'none' }}
                                    className={`${cellClass}${daizongGuardedCells.has(`${rowIndex},${colIndex}`) ? ' cell-daizong-guard' : ''}${cellFxPlan.hot ? ' cell-fx-hot' : ''} battle-board-cell flex flex-col items-center justify-center`}
                                >
                                    {cellContacts.map(hit => <HitContactFx key={hit.id} hit={hit} />)}
                                    {pickedCorner && (
                                        <span className="cell-picked-corner" aria-hidden="true">
                                            <i /><i /><i /><i />
                                        </span>
                                    )}
                                    {/* 烈火燎原等待选向的方向格：焰环 + 指向这条火线的箭头 */}
                                    {pendingChoice && (
                                        <span
                                            className="cell-pending-mark"
                                            aria-hidden="true"
                                            style={{ '--pc-rot': `${pendingChoiceRot}deg` } as CSSProperties}
                                        >
                                            <i className="cell-pending-arrow" />
                                        </span>
                                    )}
                                    {/* 移动目标点 */}
                                    {moveTarget && !cell && (
                                        <div className="w-3 h-3 rounded-full bg-jade/30 shadow-[0_0_6px_rgba(45,106,79,0.3)]" />
                                    )}
                                    {/* 镜花真身格作为免费交换落点：占格不能画普通点，改描一圈镜面环 */}
                                    {moveTarget && cell && cell.owner === selectedHero?.owner && cell.id !== selectedHero?.id && (
                                        <i className="cell-swap-mark pointer-events-none" aria-hidden="true" />
                                    )}

                                    {/* 补员落位点 */}
                                    {!cell && !moveTarget && isReinforceTarget(rowIndex, colIndex) && (
                                        <div
                                            className="h-3 w-3 rotate-45 border border-gold/60 bg-gold/10 shadow-[0_0_6px_rgba(212,168,67,0.35)]"
                                            title="替补上场位置"
                                        />
                                    )}

                                    {/* 复活落位点（残影格自身由金环表达可选，不再叠菱形标记） */}
                                    {reviveLanding && !cell && !stasisGhost && (
                                        <div
                                            className="h-3 w-3 rotate-45 border border-gold/60 bg-gold/10 shadow-[0_0_6px_rgba(212,168,67,0.35)]"
                                            title="时空回溯复活落点"
                                        />
                                    )}

                                    {bladeMark && (
                                        <div
                                            className="bf-blade-mark absolute inset-2 border border-vermillion/40 rotate-45 pointer-events-none"
                                            title="刃痕"
                                        />
                                    )}

                                    {darkCircle && (
                                        <div
                                            className="bf-dark-circle absolute inset-1 rounded-md bg-indigo-950/15 border border-indigo-500/30 pointer-events-none"
                                            title="暗夜法阵"
                                        />
                                    )}

                                    {sandDune && (
                                        <div
                                            className="bf-sand-dune absolute inset-1 rounded-md border border-amber-600/35 bg-amber-300/15 pointer-events-none"
                                            title="沙丘"
                                        >
                                            <div className="absolute inset-x-2 bottom-1 h-1.5 rounded-[50%] border-t border-amber-700/35" />
                                            <div className="absolute inset-x-3 bottom-2 h-1 rounded-[50%] border-t border-amber-500/25" />
                                        </div>
                                    )}

                                    {waterMarsh && (
                                        <div
                                            className={`bf-water-marsh bf-water-marsh-${waterMarsh.owner === 'player1' ? 'p1' : 'p2'} pointer-events-none`}
                                            title={marshesHere.length > 1
                                                ? `水泽：${marshesHere.length}片重叠，我方角色在其中的闪避率按片累加`
                                                : '水泽：我方角色在其中提升闪避'}
                                        >
                                            <span className="bf-water-marsh-ripple" />
                                            <span className="bf-water-marsh-ripple bf-water-marsh-ripple-2" />
                                            {marshesHere.length > 1 && (
                                                <span className="bf-water-marsh-layer">{marshesHere.length}</span>
                                            )}
                                        </div>
                                    )}

                                    {fishHook && (
                                        <div
                                            className={`bf-fish-hook bf-fish-hook-${fishHook.owner === 'player1' ? 'p1' : 'p2'} pointer-events-none`}
                                            title={`鱼钩：敌人经过这一格即刻上钩（剩${fishHook.duration}回合）`}
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M12 2v7" />
                                                <path d="M12 9c0 4-2.5 6-4.5 6S4 13 5.5 11.5" />
                                                <circle cx="12" cy="2.6" r="1.1" />
                                            </svg>
                                        </div>
                                    )}


                                    {lightningRod && (
                                        <div
                                            className={`bf-rod bf-rod-${lightningRod.owner === 'player1' ? 'p1' : 'p2'} pointer-events-none`}
                                            title="引雷针：下一拍她名下所有雷云都会朝这一格挪一格，随后针作废"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M12 3v13" />
                                                <path d="M8.4 16.2h7.2L12 21z" />
                                                <path d="M12 6.5l3.2-2.2M12 9.5l-3-2" />
                                            </svg>
                                        </div>
                                    )}

                                    {windLanes.map(lane => (
                                        <div
                                            key={lane.id}
                                            className={`wind-lane-band wind-lane-band-${lane.direction ?? 'right'} wind-lane-owner-${lane.owner === 'player1' ? 'p1' : 'p2'} pointer-events-none`}
                                            title={`风道：顺风吹向${WIND_LANE_DIRECTION_LABELS[lane.direction ?? 'right']}`}
                                        />
                                    ))}

                                    {windBlade && (
                                        <div
                                            className={`bf-wind-blade bf-wind-blade-${windBlade.owner === 'player1' ? 'p1' : 'p2'} bf-wind-blade-${windBlade.direction ?? 'up'} pointer-events-none`}
                                            title="风刃：敌人踏入受到4点伤害后消失；游隼经过时收回并刷新疾掠"
                                        >
                                            <WindBladeGlyph />
                                        </div>
                                    )}

                                    {flyingSword && (
                                        <div
                                            className={`bf-flying-sword bf-flying-sword-${flyingSword.owner === 'player1' ? 'p1' : 'p2'} pointer-events-none`}
                                            title={`飞剑：轩辕神君的剑罡（剩${flyingSword.duration}回合）。昭神态可跃上它（那把剑消失），技能可回收/召它化盾；敌方踩上去不受影响也拆不掉`}
                                        >
                                            {/* Lucide 标准佩剑图标（ISC 协议） */}
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
                                                <path d="m13 19 6-6" />
                                                <path d="m16 16 4 4" />
                                                <path d="m19 14 2 2" />
                                            </svg>
                                        </div>
                                    )}

                                    {boomerang && !cell && (
                                        <div
                                            className={`bf-boomerang bf-boomerang-${boomerang.owner === 'player1' ? 'p1' : 'p2'} pointer-events-none`}
                                            title={boomerangTitle}
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M3 8 Q10 3 18 8 Q12 11 8 19 Q7 13 3 8 Z" />
                                                <path d="M21 16 Q14 21 6 16 Q12 13 16 5 Q17 11 21 16 Z" />
                                            </svg>
                                            {boomerangsHere.length > 1 && (
                                                <span className="bf-boomerang-count">{boomerangsHere.length}</span>
                                            )}
                                        </div>
                                    )}

                                    {iceCrystal && (
                                        <div
                                            className="bf-ice-crystal absolute inset-1 flex items-center justify-center pointer-events-none"
                                            title="冰晶"
                                        >
                                            {/* Lucide 标准雪花图标（ISC 协议） */}
                                            <svg
                                                className="ice-crystal-snow"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                aria-hidden="true"
                                            >
                                                <path d="m10 20-1.25-2.5L6 18" />
                                                <path d="M10 4 8.75 6.5 6 6" />
                                                <path d="m14 20 1.25-2.5L18 18" />
                                                <path d="m14 4 1.25 2.5L18 6" />
                                                <path d="m17 21-3-6h-4" />
                                                <path d="m17 3-3 6 1.5 3" />
                                                <path d="M2 12h6.5L10 9" />
                                                <path d="m20 10-1.5 2 1.5 2" />
                                                <path d="M22 12h-6.5L14 15" />
                                                <path d="m4 10 1.5 2L4 14" />
                                                <path d="m7 21 3-6-1.5-3" />
                                                <path d="m7 3 3 6h4" />
                                            </svg>
                                        </div>
                                    )}

                                    {bindingZone && bindingEdges && (
                                        <div
                                            className={`bf-binding-zone bf-binding-${bindingZone.owner === 'player1' ? 'p1' : 'p2'} absolute inset-0 pointer-events-none`}
                                            title="束缚格：圈内敌人无法靠移动脱身（技能造成的位移仍可离开）"
                                        >
                                            {bindingEdges.north && <i className={bindingBarClass('north', bindingEdges)} aria-hidden="true" />}
                                            {bindingEdges.east && <i className={bindingBarClass('east', bindingEdges)} aria-hidden="true" />}
                                            {bindingEdges.south && <i className={bindingBarClass('south', bindingEdges)} aria-hidden="true" />}
                                            {bindingEdges.west && <i className={bindingBarClass('west', bindingEdges)} aria-hidden="true" />}
                                            <i className="bf-binding-seal" aria-hidden="true" />
                                        </div>
                                    )}

                                    {waterMoon && (
                                        <div
                                            className={`bf-water-moon bf-water-moon-${waterMoon.owner === 'player1' ? 'p1' : 'p2'} absolute inset-1 pointer-events-none`}
                                            title="水月：友方每次移动可踏入换影，白得5点护盾"
                                        >
                                            <i className="bf-water-moon-ring" aria-hidden="true" />
                                            <i className="bf-water-moon-core" aria-hidden="true" />
                                        </div>
                                    )}

                                    {moonSeat && (
                                        <div
                                            className="bf-moon-seat absolute inset-1 pointer-events-none"
                                            title={`月座：友方踏上即接镜花归场（${moonSeat.duration}回合内无人踏则自动归位）`}
                                        >
                                            <i className="bf-moon-seat-ring" aria-hidden="true" />
                                            <i className="bf-moon-seat-ring bf-moon-seat-ring-b" aria-hidden="true" />
                                            <i className="bf-moon-seat-dot" aria-hidden="true" />
                                        </div>
                                    )}

                                    {shadowMark && (
                                        <div
                                            className={`bf-shadow-mark bf-shadow-mark-${shadowMark.owner === 'player1' ? 'p1' : 'p2'} absolute inset-1 pointer-events-none`}
                                            title="残影：花弄影的影子留在此处，行动末会重演她最后一击；她可点击影子与身互换"
                                        >
                                            <i className="bf-shadow-pool" aria-hidden="true" />
                                            <svg className="bf-shadow-figure" viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="M12 3.4c1.7 0 2.9 1.2 2.9 2.8 0 1.1-.6 1.9-1.3 2.5.9.5 1.6 1.4 1.9 2.6l.7 3.9c.1.6-.3 1-.8 1h-6.8c-.5 0-.9-.4-.8-1l.7-3.9c.3-1.2 1-2.1 1.9-2.6-.7-.6-1.3-1.4-1.3-2.5 0-1.6 1.2-2.8 2.9-2.8z" />
                                            </svg>
                                            <i className="bf-shadow-petal bf-shadow-petal-a" aria-hidden="true" />
                                            <i className="bf-shadow-petal bf-shadow-petal-b" aria-hidden="true" />
                                        </div>
                                    )}

                                    {lightPrism && (
                                        <div
                                            className={`bf-prism absolute inset-1 pointer-events-none bf-prism-${lightPrism.owner === 'player1' ? 'p1' : 'p2'}`}
                                            title="光棱：折光布下的折射点，她的光束扫过这一格会换轴折射一次并追加2点伤害"
                                        >
                                            <i className="bf-prism-halo" aria-hidden="true" />
                                            <svg className="bf-prism-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                                <path className="bf-prism-face" d="M12 3.2 L20.2 18 L3.8 18 Z" />
                                                <path className="bf-prism-edge" d="M12 3.2 L20.2 18 M12 3.2 L3.8 18 M3.8 18 L20.2 18 M12 3.2 L12 18" />
                                                <path className="bf-prism-ray" d="M0.6 12.4 L8.4 12.4 M15.6 12.4 L23.4 9.2" />
                                            </svg>
                                        </div>
                                    )}

                                    {lamp && (
                                        <div
                                            className={`bf-lamp bf-lamp-${lamp.owner === 'player1' ? 'p1' : 'p2'}${lamp.type === 'wake-lamp' ? ' bf-lamp-wake' : ''} absolute inset-1 pointer-events-none`}
                                            title={lamp.type === 'wake-lamp'
                                                ? `留灯：${lamp.duration}回合内每回合末为两格内友方恢复5点生命`
                                                : `明灯：照出周围一圈敌人的影子（剩${lamp.duration}回合），灯下两格内夕月辞免伤30%`}
                                        >
                                            <i className="bf-lamp-halo" aria-hidden="true" />
                                            <svg className="bf-lamp-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                                <path className="bf-lamp-flame" d="M12 4.2c1.9 2.1 2.8 3.7 2.8 5.1a2.8 2.8 0 0 1-5.6 0c0-1.4.9-3 2.8-5.1z" />
                                                <path className="bf-lamp-body" d="M7.6 12.4h8.8l-1.3 6.2q-.1.6-.7.6H9.6q-.6 0-.7-.6z" />
                                                <path className="bf-lamp-base" d="M6.4 20.2h11.2" />
                                            </svg>
                                        </div>
                                    )}

                                    {lampShadowHere && (
                                        <div
                                            className="bf-lamp-shadow absolute inset-1 pointer-events-none"
                                            title={`灯影：这一格连着${lampShadowHere.join('、')}本人，打中影子就照到本体`}
                                        >
                                            <i className="bf-lamp-shadow-stretch" aria-hidden="true" />
                                            <i className="bf-lamp-shadow-tip" aria-hidden="true" />
                                        </div>
                                    )}

                                    {brush && (
                                        <div
                                            className={`bf-brush absolute inset-1 pointer-events-none flex flex-col items-center justify-center brush-owner-${brush.owner === 'player1' ? 'p1' : 'p2'}`}
                                            title={`毛笔（剩余移动${Math.max(0, brush.duration)}次）`}
                                        >
                                            <i className="bf-brush-glow" aria-hidden="true" />
                                            <svg
                                                className="brush-mark-svg"
                                                viewBox="0 0 24 24"
                                                aria-hidden="true"
                                            >
                                                <defs>
                                                    <linearGradient id="brush-handle-g" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0" stopColor="#b98a5a" />
                                                        <stop offset="0.55" stopColor="#8a5f33" />
                                                        <stop offset="1" stopColor="#5d3d1c" />
                                                    </linearGradient>
                                                    <linearGradient id="brush-tip-g" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0" stopColor="#4a4a4a" />
                                                        <stop offset="1" stopColor="#0b0b0d" />
                                                    </linearGradient>
                                                </defs>
                                                {/* 底部墨晕 */}
                                                <ellipse cx="12.6" cy="21.2" rx="3.4" ry="1.15" fill="#1c1c22" opacity="0.22" />
                                                <g transform="rotate(38 12 12)">
                                                    {/* 笔杆 */}
                                                    <rect x="10.85" y="4.2" width="2.3" height="9" rx="1.05" fill="url(#brush-handle-g)" />
                                                    {/* 杆顶竹节与顶珠 */}
                                                    <rect x="10.35" y="2.1" width="3.3" height="2.1" rx="0.7" fill="#3e2c17" />
                                                    <circle cx="12" cy="2.5" r="0.75" fill="#d8c087" />
                                                    {/* 杆箍 */}
                                                    <rect x="10.25" y="12.9" width="3.5" height="1.7" rx="0.55" fill="#caa96c" />
                                                    <rect x="10.25" y="13.45" width="3.5" height="0.42" fill="#8f7434" opacity="0.65" />
                                                    {/* 笔腹（米白毫毛） */}
                                                    <path
                                                        d="M9.35 14.5 C9.2 16.9 10.4 19.3 12 20.9 C13.6 19.3 14.8 16.9 14.65 14.5 C13.8 15.1 10.2 15.1 9.35 14.5 Z"
                                                        fill="#f4eedd"
                                                    />
                                                    <path
                                                        d="M9.35 14.5 C9.2 16.9 10.4 19.3 12 20.9 C11 18.9 10.4 16.7 10.5 14.7 Z"
                                                        fill="#ddd3ba"
                                                        opacity="0.8"
                                                    />
                                                    {/* 笔锋（墨色锋颖） */}
                                                    <path
                                                        d="M10.95 17.4 C11.1 19.2 11.5 20.3 12 21.3 C12.5 20.3 12.9 19.2 13.05 17.4 C12.7 17.9 11.3 17.9 10.95 17.4 Z"
                                                        fill="url(#brush-tip-g)"
                                                    />
                                                </g>
                                                {/* 溅落的墨滴 */}
                                                <circle cx="18.2" cy="18.6" r="1.05" fill="#14141a" opacity="0.85" />
                                                <circle cx="16.6" cy="20.3" r="0.55" fill="#14141a" opacity="0.6" />
                                            </svg>
                                            {brush.duration > 0 && (
                                                <div className="brush-life-dots">
                                                    {Array.from({ length: Math.min(3, Math.max(0, brush.duration)) }).map((_, i) => (
                                                        <span key={i} className="brush-life-dot" />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* 时空停滞残影：可被戴尔「时空回溯」唤回的阵亡单位 */}
                                    {stasisGhost && (
                                        <div
                                            className={`dai-stasis-ghost pointer-events-none${stasisCallable ? ' dai-stasis-callable' : ''}${stasisAnchored ? ' dai-stasis-anchored' : ''}`}
                                            data-testid={`dai-stasis-${stasisGhost.id}`}
                                            title={`时空停滞：${stasisGhost.name}（时间已被凝固，戴尔·时空回溯可将其唤回）`}
                                        >
                                            <span className="dai-stasis-clock" aria-hidden="true">
                                                <i /><i />
                                            </span>
                                            <span className="dai-stasis-ring" aria-hidden="true" />
                                            <span className="dai-stasis-ring dai-stasis-ring-2" aria-hidden="true" />
                                            <HeroAvatar
                                                heroId={stasisGhost.id}
                                                heroName={stasisGhost.name}
                                                size={44}
                                                className="dai-stasis-avatar"
                                            />
                                            <span className="dai-stasis-name">{stasisGhost.name}</span>
                                        </div>
                                    )}

                                    {/* 技能目标标记 */}
                                    {skillTarget && !cell && !reviveLanding && (
                                        <div className="w-3 h-3 rounded-full bg-vermillion/30 shadow-[0_0_6px_rgba(192,57,43,0.3)]" />
                                    )}

                                    {/* 英雄棋子 */}
                                    {cell && (
                                        <HeroStatusPopover
                                            hero={cell}
                                            delayMs={650}
                                            placement="auto-vertical"
                                            className={`board-hero-content flex flex-col items-center gap-0.5 outline-none${dragonPresentation.hideIdle.has(cell.id) ? ' ao-dragon-performing' : ''}${dragonPresentation.hideArrived.has(cell.id) ? ' ao-dash-arrival-hidden' : ''}`}
                                        >
                                            <HitResponsivePiece key={cell.id} hits={cellContacts.filter(hit => !hit.targetHeroId || hit.targetHeroId === cell.id)}>
                                            <div className="piece-shell">
                                                <div className={`
                                                    piece battle-board-piece
                                                    ${cell.owner === 'player1' ? 'piece-p1' : 'piece-p2'}
                                                    ${isSelected ? 'piece-selected' : ''}
                                                    ${skillTarget ? 'ring-2 ring-vermillion/50' : ''}
                                                `}>
                                                    <HeroAvatar
                                                        heroId={cell.id}
                                                        heroName={cell.name}
                                                        size={56}
                                                        className="hero-piece-avatar"
                                                        fallbackClassName="text-white drop-shadow-sm"
                                                        eager
                                                    />
                                                </div>
                                                <HeroStatusFx hero={cell} />
                                                {/* 泠汐的水波与折扇贴角色本身，不受下方名字与血条影响。 */}
                                                {cellFxPlan.renders
                                                    .filter(({ event, variant }) => variant === 'caster' && ['lingxi-wave', 'lingxi-fan'].includes(event.profile.kind))
                                                    .map(({ event, variant, emphasis }) => (
                                                        <SkillFxVisual key={`${event.id}-${variant}`} event={event} variant={variant} atPos={[rowIndex, colIndex]} emphasis={emphasis} />
                                                    ))}
                                            </div>
                                            </HitResponsivePiece>
                                            <span className="battle-board-piece-name text-ink-faint font-body leading-none">
                                                {cell.name.length > 3 ? cell.name.slice(0, 3) : cell.name}
                                            </span>
                                            {/* 微型血条 */}
                                            <div className="hp-bar battle-board-hp">
                                                <div
                                                    className={`hp-bar-fill ${
                                                        cell.currentHp / cell.maxHp > 0.6 ? 'hp-high' :
                                                        cell.currentHp / cell.maxHp > 0.3 ? 'hp-mid' :
                                                        'hp-low'
                                                    }`}
                                                    style={{ width: `${(cell.currentHp / cell.maxHp) * 100}%` }}
                                                />
                                            </div>
                                            {/* 护盾 */}
                                            {cell.shield > 0 && (
                                                <div className="absolute -top-0.5 -right-0.5 text-[8px] text-white font-bold bg-indigo-ink rounded-full w-4 h-4 flex items-center justify-center shadow-sm">
                                                    {cell.shield}
                                                </div>
                                            )}
                                        </HeroStatusPopover>
                                    )}

                                    {/* 镖落在人身上：棋子会盖住整格标记，改在左上角钉一枚小镖徽 */}
                                    {cell && boomerang && (
                                        <div
                                            className={`bf-boomerang-occupied bf-boomerang-${boomerang.owner === 'player1' ? 'p1' : 'p2'} pointer-events-none`}
                                            title={boomerangTitle}
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M3 8 Q10 3 18 8 Q12 11 8 19 Q7 13 3 8 Z" />
                                                <path d="M21 16 Q14 21 6 16 Q12 13 16 5 Q17 11 21 16 Z" />
                                            </svg>
                                            {boomerangsHere.length > 1 && (
                                                <span className="bf-boomerang-count">{boomerangsHere.length}</span>
                                            )}
                                        </div>
                                    )}

                                    {/* 伤害飘字：灼烧/流血/链电伤害使用专属来源配色 */}
                                    {floatingDamages
                                        .filter(damage => damage.row === rowIndex && damage.col === colIndex)
                                        .map(damage => {
                                            const [dx, dy] =
                                                FLOATING_OFFSETS[damage.offsetIndex % FLOATING_OFFSETS.length];
                                            const kindClass =
                                                damage.kind === 'crit' ? ' is-crit' :
                                                damage.kind === 'heal' ? ' is-heal' :
                                                damage.kind === 'burn' ? ' is-burn' :
                                                damage.kind === 'bleed' ? ' is-bleed' :
                                                damage.kind === 'chain' ? ' is-chain' : '';
                                            const shieldClass = damage.kind === 'shield' ? ' is-shield' : '';
                                            return (
                                                <div
                                                    key={damage.id}
                                                    className={`floating-damage${kindClass}${shieldClass}`}
                                                    style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, animationDelay: `${damage.delayMs}ms`, animationFillMode: 'both' } as CSSProperties}
                                                >
                                                    {(damage.kind === 'crit' || damage.kind === 'shield') && !damage.shieldBroken && <span className="damage-caption">{damage.kind === 'crit' ? '暴击' : '护盾'}</span>}
                                                    {damage.kind === 'heal' ? `+${damage.amount}` : damage.amount}
                                                </div>
                                            );
                                        })}

                                    {/* 灼烧跳伤 / 流血掉血：格子上的小火爆点与血溅 */}
                                    {minorFx
                                        .filter(fx => fx.row === rowIndex && fx.col === colIndex)
                                        .map(fx => (
                                            <span
                                                key={fx.id}
                                                className={`tick-fx tick-fx-${fx.kind}`}
                                                aria-hidden="true"
                                            >
                                                <i className="tick-fx-burst" />
                                                <i className="tick-fx-ring" />
                                                <i className="tick-fx-dot tick-fx-dot-1" />
                                                <i className="tick-fx-dot tick-fx-dot-2" />
                                                <i className="tick-fx-dot tick-fx-dot-3" />
                                            </span>
                                        ))}

                                    {/* 英雄阵亡：水墨消散（棋子本体由状态变化自然移除） */}
                                    {deathFx
                                        .filter(fx => fx.row === rowIndex && fx.col === colIndex)
                                        .map(fx => (
                                            <span key={fx.id} className="death-fx" style={{ '--death-delay': `${fx.delayMs}ms` } as CSSProperties} aria-hidden="true">
                                                <i className="death-fx-core" />
                                                <i className="death-fx-ghost" />
                                                <i className="death-fx-ring" />
                                                <i className="death-fx-cross death-fx-cross-a" />
                                                <i className="death-fx-cross death-fx-cross-b" />
                                                <i className="death-fx-splat death-fx-splat-1" />
                                                <i className="death-fx-splat death-fx-splat-2" />
                                                <i className="death-fx-splat death-fx-splat-3" />
                                                <i className="death-fx-splat death-fx-splat-4" />
                                                <i className="death-fx-splat death-fx-splat-5" />
                                                <i className="death-fx-stain" />
                                            </span>
                                        ))}

                                    {/* 英雄技能特效：同格先仲裁，主效全尺寸、旧的回声、再往后的只留格边短线 */}
                                    {cellFxPlan.renders
                                        .filter(({ event, variant }) => !cell || variant !== 'caster' || !['lingxi-wave', 'lingxi-fan'].includes(event.profile.kind))
                                        .map(({ event, variant, emphasis }) => (
                                        <SkillFxVisual
                                            key={`${event.id}-${variant}`}
                                            event={event}
                                            variant={variant}
                                            atPos={[rowIndex, colIndex]}
                                            emphasis={emphasis}
                                        />
                                    ))}
                                    {cellFxPlan.notches.length > 0 && (
                                        <span className="cell-fx-notches" aria-hidden="true">
                                            {cellFxPlan.notches.slice(0, 3).map(event => (
                                                <i
                                                    key={event.id}
                                                    style={{ '--notch-color': cellFxNotchColor(event) } as CSSProperties}
                                                />
                                            ))}
                                        </span>
                                    )}
                                </div>
                            );
                        })
                    )}

                    <ThunderCloudLayer effects={boardEffects} />

                    {/* AOE 整体特效：覆盖整个作用范围的一体化动效（冲击波/火海/雷暴…），
                        单元素跨格子铺在区域包围盒上，与逐格特效叠加而非替代 */}
                    {skillFx.map(event =>
                        event.areaBounds ? (
                            <SkillAreaFx key={`area-${event.id}`} event={event} />
                        ) : null
                    )}

                    {/* 英雄之间的持久连线（阳线金 / 阴线玄紫 / 血契赤红血线）：
                        由棋子身上的持续效果实时驱动，断线、离场或到期后自动消失 */}
                    {resolveHeroLinks(board).map(link => (
                        <div
                            key={link.key}
                            className={`hero-link hero-link-${link.kind}`}
                            style={{
                                '--l-r': link.from[0],
                                '--l-c': link.from[1],
                                '--l-len': link.length,
                                '--l-rot': `${link.angleDeg}deg`,
                            } as CSSProperties}
                            aria-hidden="true"
                        >
                            <i className="hero-link-core" />
                            <i className="hero-link-flow" />
                            <i className="hero-link-pulse" />
                        </div>
                    ))}
                    {/* 天威/被动挂起选格时的提示条：触发的那一刻就得说清楚触发了什么、点哪里 */}
                    {pendingBoardAction && pendingChoiceHint && (
                        <div className="board-pending-prompt" data-testid="board-pending-prompt" role="status">
                            <span className="board-pending-flame" aria-hidden="true" />
                            <span className="board-pending-title font-title">
                                {pendingChoiceHero ? `${pendingChoiceHero.name}·${pendingChoiceHint.title}` : pendingChoiceHint.title}
                            </span>
                            <span className="board-pending-detail font-body">{pendingChoiceHint.detail}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
