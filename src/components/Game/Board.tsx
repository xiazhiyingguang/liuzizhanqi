import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useGameStore } from '../../store/game-store';
import { Position } from '../../types/game';
import type { SkillFxEvent } from '../../core/skill-fx';
import HeroAvatar from '../ui/HeroAvatar';
import HeroStatusPopover from './HeroStatusPopover';
import { SkillFxLifecycle, SkillFxVisual } from './SkillFxLayer';

type FloatingDamage = {
    id: number;
    row: number;
    col: number;
    amount: number;
    kind: 'damage' | 'crit' | 'heal';
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
        reinforcingPlayer,
        reinforcementSelectableHeroId,
        deployReinforcement
    } = useGameStore();

    // 伤害飘字：订阅战斗日志增量，把新产生的伤害解析到对应格子
    const [floatingDamages, setFloatingDamages] = useState<FloatingDamage[]>([]);
    const lastLogLengthRef = useRef(0);
    const floatingIdRef = useRef(0);

    useEffect(() => {
        const log = battleLog ?? [];
        if (log.length <= lastLogLengthRef.current) {
            lastLogLengthRef.current = log.length;
            return;
        }
        const fresh = log.slice(lastLogLengthRef.current);
        lastLogLengthRef.current = log.length;

        const next: FloatingDamage[] = [];
        for (const entry of fresh) {
            if (!entry.details) continue;
            const { amount, isCrit, position } = entry.details as {
                amount?: number;
                isCrit?: boolean;
                position?: number[];
            };
            if (typeof amount !== 'number' || amount <= 0) continue;
            if (!position || position.length !== 2) continue;
            if (entry.type === 'damage') {
                next.push({
                    id: floatingIdRef.current++,
                    row: position[0],
                    col: position[1],
                    amount,
                    kind: isCrit ? 'crit' : 'damage',
                });
            } else if (entry.type === 'heal') {
                next.push({
                    id: floatingIdRef.current++,
                    row: position[0],
                    col: position[1],
                    amount,
                    kind: 'heal',
                });
            }
        }
        if (next.length === 0) return;

        const ids = next.map(item => item.id);
        setFloatingDamages(prev => [...prev, ...next]);
        window.setTimeout(() => {
            setFloatingDamages(prev => prev.filter(item => !ids.includes(item.id)));
        }, 1000);
    }, [battleLog]);

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

    // 命中本格的技能特效事件：起手格渲染光环，目标格渲染主效
    const skillFxAtCell = (row: number, col: number): Array<{
        event: SkillFxEvent;
        variant: 'caster' | 'target';
    }> => {
        const hits: Array<{ event: SkillFxEvent; variant: 'caster' | 'target' }> = [];
        for (const event of skillFx) {
            if (event.fromPos[0] === row && event.fromPos[1] === col) {
                hits.push({ event, variant: 'caster' });
            }
            if (event.targetPos[0] === row && event.targetPos[1] === col) {
                hits.push({ event, variant: 'target' });
            }
        }
        return hits;
    };

    return (
        <div className="battle-board-shell">
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

                            let cellClass = 'battle-cell';
                            if (isSelected) cellClass += ' cell-selected';
                            else if (moveTarget) cellClass += ' cell-move';
                            else if (skillTarget) cellClass += ' cell-attack';
                            else if (isReinforceTarget(rowIndex, colIndex)) cellClass += ' cell-move';

                            return (
                                <div
                                    key={`${rowIndex}-${colIndex}`}
                                    data-testid={`battle-cell-${rowIndex}-${colIndex}`}
                                    onClick={(e) => handleCellClick(e, rowIndex, colIndex)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    style={{ userSelect: 'none' }}
                                    className={`${cellClass} battle-board-cell flex flex-col items-center justify-center`}
                                >
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

                                    {bladeMark && (
                                        <div
                                            className="absolute inset-2 border border-vermillion/40 rotate-45 pointer-events-none"
                                            title="刃痕"
                                        />
                                    )}

                                    {darkCircle && (
                                        <div
                                            className="absolute inset-1 rounded-md bg-indigo-950/15 border border-indigo-500/30 pointer-events-none"
                                            title="暗夜法阵"
                                        />
                                    )}

                                    {sandDune && (
                                        <div
                                            className="absolute inset-1 rounded-md border border-amber-600/35 bg-amber-300/15 pointer-events-none"
                                            title="沙丘"
                                        >
                                            <div className="absolute inset-x-2 bottom-1 h-1.5 rounded-[50%] border-t border-amber-700/35" />
                                            <div className="absolute inset-x-3 bottom-2 h-1 rounded-[50%] border-t border-amber-500/25" />
                                        </div>
                                    )}

                                    {iceCrystal && (
                                        <div
                                            className="absolute inset-1 flex items-center justify-center pointer-events-none"
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

                                    {brush && (
                                        <div
                                            className={`absolute inset-1 pointer-events-none flex flex-col items-center justify-center brush-owner-${brush.owner === 'player1' ? 'p1' : 'p2'}`}
                                            title={`毛笔（剩余移动${Math.max(0, brush.duration)}次）`}
                                        >
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

                                    {/* 技能目标标记 */}
                                    {skillTarget && !cell && (
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

                                    {/* 伤害飘字 */}
                                    {floatingDamages
                                        .filter(damage => damage.row === rowIndex && damage.col === colIndex)
                                        .map(damage => (
                                            <div
                                                key={damage.id}
                                                className={`floating-damage${
                                                    damage.kind === 'crit' ? ' is-crit' :
                                                    damage.kind === 'heal' ? ' is-heal' : ''
                                                }`}
                                            >
                                                {damage.kind === 'heal' ? `+${damage.amount}` : damage.amount}
                                            </div>
                                        ))}

                                    {/* 英雄技能特效：起手格光环 + 目标格主效 */}
                                    {skillFxAtCell(rowIndex, colIndex).map(({ event, variant }) => (
                                        <SkillFxVisual
                                            key={`${event.id}-${variant}`}
                                            event={event}
                                            variant={variant}
                                        />
                                    ))}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
