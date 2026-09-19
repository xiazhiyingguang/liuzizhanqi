import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useGameStore, getPendingActionCells } from '../../store/game-store';
import { Position, type Hero } from '../../types/game';
import { GameEngine } from '../../core/game-engine';
import type { SkillFxEvent } from '../../core/skill-fx';
import { computeFxAngleDeg, computeFxCellDelayMs, computeFxDirection, isImpactFxKind, resolveSkillFx } from '../../core/skill-fx';
import HeroAvatar from '../ui/HeroAvatar';
import HeroStatusPopover from './HeroStatusPopover';
import { SkillAreaFx, SkillFxLifecycle, SkillFxVisual } from './SkillFxLayer';
import { HeroStatusFx } from './HeroStatusFx';
import { WindBladeGlyph } from './WindBladeGlyph';
import { resolveHeroLinks } from '../../core/hero-link-view';

type FloatingDamage = {
    id: number;
    row: number;
    col: number;
    amount: number;
    kind: 'damage' | 'crit' | 'heal' | 'burn' | 'bleed' | 'chain';
    /** 同格错位序号：多段伤害/追击同时落格时错开显示，避免叠成一团 */
    offsetIndex: number;
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
};

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
    'xueqi-tianwei': { title: '血契·天威', detail: '点选一处空格跃落' },
    'schrodinger-tianwei': { title: '薛定谔·天威', detail: '点选一格确定观测落点' },
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
        selectDaiReviveTarget
    } = useGameStore();

    // 挂起的棋盘动作：可点格直接从挂起态推导，不依赖各条 set 路径是否记得同步 skillRange，
    // 否则会出现"天威已经触发、棋盘上却没有任何提示"的错觉
    const pendingChoiceHero = pendingBoardAction
        ? [...player1Heroes, ...player2Heroes].find(item => item.id === pendingBoardAction.heroId)
        : undefined;
    const pendingChoiceCells = pendingBoardAction
        ? getPendingActionCells({ pendingBoardAction, player1Heroes, player2Heroes })
        : [];
    const pendingChoiceHint = pendingBoardAction
        ? PENDING_CHOICE_HINTS[pendingBoardAction.type]
        : undefined;
    const isPendingChoice = (row: number, col: number): boolean =>
        pendingChoiceCells.some(([r, c]) => r === row && c === col);

    // 伤害飘字：订阅战斗日志增量，把新产生的伤害解析到对应格子
    const [floatingDamages, setFloatingDamages] = useState<FloatingDamage[]>([]);
    const [minorFx, setMinorFx] = useState<MinorFx[]>([]);
    const [deathFx, setDeathFx] = useState<DeathFx[]>([]);
    const [shakeKey, setShakeKey] = useState(0);
    const shellRef = useRef<HTMLDivElement>(null);
    const seenLogIdsRef = useRef<Set<string> | null>(null);
    const floatingIdRef = useRef(0);

    useEffect(() => {
        const log = battleLog ?? [];
        // 日志满 200 条后 addLog 会做环形截断，长度不再单调增长，
        // 只能按条目身份识别新增，否则长对局里飘字会彻底停止出现。
        const seenIds = seenLogIdsRef.current;
        const fresh = seenIds ? log.filter(entry => !seenIds.has(entry.id)) : [];
        seenLogIdsRef.current = new Set(log.map(entry => entry.id));
        if (fresh.length === 0) return;

        const next: FloatingDamage[] = [];
        const nextMinor: MinorFx[] = [];
        const nextDeath: DeathFx[] = [];
        let killShakes = 0;
        for (const entry of fresh) {
            if (!entry.details) continue;
            const { amount, isCrit, position, fxTag, victimPosition, fxSkillId, fxFrom, fxTarget } = entry.details as {
                amount?: number;
                isCrit?: boolean;
                position?: number[];
                fxTag?: string;
                victimPosition?: number[];
                fxSkillId?: string;
                fxFrom?: number[];
                fxTarget?: number[];
            };
            // 引擎内部触发的攻击（如镜的"破镜之刃"）通过日志标记请求特效：
            // fxSkillId 指向特效档案，fxFrom→fxTarget 为飞刃动线（无起点则原格起爆）
            if (typeof fxSkillId === 'string' && fxTarget && fxTarget.length === 2) {
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
                nextDeath.push({
                    id: floatingIdRef.current++,
                    row: victimPosition[0],
                    col: victimPosition[1],
                });
                killShakes += 1;
                continue;
            }
            if (typeof amount !== 'number' || amount <= 0) continue;
            if (!position || position.length !== 2) continue;
            if (entry.type === 'damage') {
                // 来源标签：灼烧/流血/链电伤害的飘字换用专属配色
                const taggedKind: FloatingDamage['kind'] =
                    fxTag === 'burn' ? 'burn' :
                    fxTag === 'bleed' ? 'bleed' :
                    fxTag === 'chain' ? 'chain' :
                    isCrit ? 'crit' : 'damage';
                next.push({
                    id: floatingIdRef.current++,
                    row: position[0],
                    col: position[1],
                    amount,
                    kind: taggedKind,
                    offsetIndex: 0,
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
                });
            }
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
            }, 1000);
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
            }, 1000);
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

        if (skillRange.length > 0 && isHighlighted(row, col)) {
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

    // 命中本格的技能特效事件：起手格渲染光环，目标格渲染主效，溅射格与链电链路格
    // 渲染各自的多格变体；AOE 真正打到的每一格各渲染一份 impact，
    // 落在作用区域但未被更强变体占用的格子渲染 area 贴地底光
    type SkillFxVariant = 'caster' | 'target' | 'impact' | 'area' | 'splash' | 'chain';

    const skillFxAtCell = (row: number, col: number): Array<{
        event: SkillFxEvent;
        variant: SkillFxVariant;
    }> => {
        const hits: Array<{ event: SkillFxEvent; variant: SkillFxVariant }> = [];
        const pushHit = (event: SkillFxEvent, variant: SkillFxVariant) => {
            if (!hits.some(hit => hit.event.id === event.id && hit.variant === variant)) {
                hits.push({ event, variant });
            }
        };
        const onCell = (cells: Position[] | undefined): boolean =>
            (cells ?? []).some(([r, c]) => r === row && c === col);

        for (const event of skillFx) {
            if (onCell([event.fromPos])) pushHit(event, 'caster');
            if (onCell([event.targetPos])) pushHit(event, 'target');
            if (onCell(event.splashPositions)) pushHit(event, 'splash');
            if (onCell(event.chainLinks)) pushHit(event, 'chain');
            // 主目标格已承载完整主效，同格不再重复出 impact；其余命中格各来一份
            if (!onCell([event.targetPos]) && onCell(event.impactPositions)) {
                pushHit(event, 'impact');
            } else if (onCell(event.coveredPositions) &&
                // 燎原火墙的首格已由 target 那份高火焰承载，别再叠一份同尺寸火舌
                !(event.profile.kind === 'liehuo-blaze' && onCell([event.targetPos]))) {
                pushHit(event, 'area');
            }
        }
        return hits;
    };

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
                            const bindingZone = boardEffects?.some(
                                effect =>
                                    effect.type === 'binding-zone' &&
                                    effect.position[0] === rowIndex &&
                                    effect.position[1] === colIndex
                            );
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
                            // 时空停滞残影：本格空着、但躺着一个被戴尔凝固时间的阵亡单位
                            const stasisGhost = stasisGhostAt(rowIndex, colIndex);
                            const stasisAnchored = stasisGhost !== null && daiReviveHeroId === stasisGhost.id;
                            const stasisCallable = stasisGhost !== null && isStasisAnchorable(stasisGhost);

                            let cellClass = 'battle-cell';
                            // 复活落点是"把人放下来"，不是攻击：用补员落位那套青金标记，避免整盘泛红
                            const reviveLanding = daiReviveHeroId !== undefined && skillTarget;
                            // 烈火燎原这类"只有几格可选"的挂起选择：给一套专属焰色脉冲标记，
                            // 不能和普通攻击高亮混为一谈，否则玩家不知道被动已经触发
                            const pendingChoice = pendingBoardAction?.type === 'yunying-liehuo' &&
                                isPendingChoice(rowIndex, colIndex);
                            // 箭头朝向即这条火线烧过去的方向（云缨 → 本格）
                            const pendingChoiceRot = pendingChoice && pendingChoiceHero?.position
                                ? computeFxAngleDeg(pendingChoiceHero.position, [rowIndex, colIndex])
                                : 0;
                            if (isSelected) cellClass += ' cell-selected';
                            else if (pendingChoice) cellClass += ' cell-pending-choice';
                            else if (moveTarget) cellClass += ' cell-move';
                            else if (reviveLanding) cellClass += ' cell-move';
                            else if (skillTarget) cellClass += ' cell-attack';
                            else if (isReinforceTarget(rowIndex, colIndex)) cellClass += ' cell-move';

                            // 本格技能特效：命中型给格子整体震屏反馈（key 含事件 id，重复施放可重触发）；
                            // AOE 的每个命中格各震一次，延迟与特效层共用同一份波浪算法，
                            // 避免多格同帧一起晃（柔光受益格不在命中型集合内，天然不抖）
                            const cellFx = skillFxAtCell(rowIndex, colIndex);
                            const impactHit = cellFx.find(
                                ({ event, variant }) =>
                                    (variant === 'target' || variant === 'impact') &&
                                    isImpactFxKind(event.profile.kind)
                            );
                            const impactEvent = impactHit?.event;
                            const impactDelayMs = impactHit
                                ? computeFxCellDelayMs(impactHit.event.targetPos, [rowIndex, colIndex])
                                : 0;
                            // 多目标技能的已选格（如凋零播撒的第一角）：金色角标标记
                            const pickedCorner = (pendingSkillTargetPositions ?? []).some(
                                ([r, c]) => r === rowIndex && c === colIndex
                            );

                            return (
                                <div
                                    key={`${rowIndex}-${colIndex}`}
                                    data-testid={`battle-cell-${rowIndex}-${colIndex}`}
                                    onClick={(e) => handleCellClick(e, rowIndex, colIndex)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    style={{ userSelect: 'none' }}
                                    className={`${cellClass} battle-board-cell flex flex-col items-center justify-center`}
                                >
                                    {impactEvent && (
                                        <span
                                            key={`fx-impact-${impactEvent.id}`}
                                            className="cell-fx-impact"
                                            aria-hidden="true"
                                            style={{
                                                '--fx-glow': impactEvent.profile.c1
                                                    ? `${impactEvent.profile.c1}66`
                                                    : undefined,
                                                '--fx-cell-delay': `${impactDelayMs}ms`,
                                            } as CSSProperties}
                                        />
                                    )}
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

                                    {bindingZone && (
                                        <div
                                            className="bf-binding-zone absolute inset-1 border border-dashed border-gold/60 rounded-sm pointer-events-none animate-pulse"
                                            title="束缚格：圈内敌人无法靠移动脱身"
                                        >
                                            <div className="absolute inset-1 border border-indigo-300/40 rounded-sm" />
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
                                            className="flex flex-col items-center gap-0.5 outline-none"
                                        >
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
                                            </div>
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
                                            return (
                                                <div
                                                    key={damage.id}
                                                    className={`floating-damage${kindClass}`}
                                                    style={{ '--dx': `${dx}px`, '--dy': `${dy}px` } as CSSProperties}
                                                >
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
                                            <span key={fx.id} className="death-fx" aria-hidden="true">
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

                                    {/* 英雄技能特效：起手格光环 + 目标格主效 + 溅射/链电多格变体 */}
                                    {skillFxAtCell(rowIndex, colIndex).map(({ event, variant }) => (
                                        <SkillFxVisual
                                            key={`${event.id}-${variant}`}
                                            event={event}
                                            variant={variant}
                                            atPos={[rowIndex, colIndex]}
                                        />
                                    ))}
                                </div>
                            );
                        })
                    )}

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
