import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useGameStore } from '../../store/game-store';
import { Position } from '../../types/game';
import HeroAvatar from '../ui/HeroAvatar';
import HeroStatusPopover from './HeroStatusPopover';

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
        currentPlayer
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

        if (isAiMode && currentPlayer === aiPlayer) return;

        const targetPos: Position = [row, col];

        if (pendingBoardAction) {
            resolvePendingBoardAction(targetPos);
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

    const isMoveTarget = (row: number, col: number): boolean => {
        return moveRange.length > 0 && isHighlighted(row, col);
    };

    const isSkillTarget = (row: number, col: number): boolean => {
        return skillRange.length > 0 && isHighlighted(row, col);
    };

    return (
        <div className="battle-board-shell">
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

                            let cellClass = 'battle-cell';
                            if (isSelected) cellClass += ' cell-selected';
                            else if (moveTarget) cellClass += ' cell-move';
                            else if (skillTarget) cellClass += ' cell-attack';

                            return (
                                <div
                                    key={`${rowIndex}-${colIndex}`}
                                    onClick={(e) => handleCellClick(e, rowIndex, colIndex)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    style={{ userSelect: 'none' }}
                                    className={`${cellClass} battle-board-cell flex flex-col items-center justify-center`}
                                >
                                    {/* 移动目标点 */}
                                    {moveTarget && !cell && (
                                        <div className="w-3 h-3 rounded-full bg-jade/30 shadow-[0_0_6px_rgba(45,106,79,0.3)]" />
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

                                    {iceCrystal && (
                                        <div
                                            className="absolute inset-1 flex items-center justify-center pointer-events-none"
                                            title="冰晶"
                                        >
                                            <svg className="ice-crystal-snow" viewBox="0 0 24 24" aria-hidden="true">
                                                <g stroke="#7db4f2" strokeWidth="1.35" strokeLinecap="round" fill="none">
                                                    <line x1="12" y1="2.6" x2="12" y2="21.4" />
                                                    <line x1="3.9" y1="7.1" x2="20.1" y2="16.9" />
                                                    <line x1="3.9" y1="16.9" x2="20.1" y2="7.1" />
                                                </g>
                                                <g stroke="#a8ccf7" strokeWidth="1.05" strokeLinecap="round" fill="none">
                                                    <line x1="12" y1="2.6" x2="9.9" y2="4.7" />
                                                    <line x1="12" y1="2.6" x2="14.1" y2="4.7" />
                                                    <line x1="12" y1="21.4" x2="9.9" y2="19.3" />
                                                    <line x1="12" y1="21.4" x2="14.1" y2="19.3" />
                                                    <line x1="3.9" y1="7.1" x2="5.1" y2="5.3" />
                                                    <line x1="3.9" y1="7.1" x2="2.9" y2="9.2" />
                                                    <line x1="20.1" y1="16.9" x2="18.9" y2="18.7" />
                                                    <line x1="20.1" y1="16.9" x2="21.1" y2="14.8" />
                                                    <line x1="3.9" y1="16.9" x2="5.1" y2="18.7" />
                                                    <line x1="3.9" y1="16.9" x2="2.9" y2="14.8" />
                                                    <line x1="20.1" y1="7.1" x2="18.9" y2="5.3" />
                                                    <line x1="20.1" y1="7.1" x2="21.1" y2="9.2" />
                                                    <line x1="12" y1="6.9" x2="9.9" y2="6.9" />
                                                    <line x1="12" y1="6.9" x2="14.1" y2="6.9" />
                                                    <line x1="12" y1="17.1" x2="9.9" y2="17.1" />
                                                    <line x1="12" y1="17.1" x2="14.1" y2="17.1" />
                                                </g>
                                                <circle cx="12" cy="12" r="1.5" fill="#dbeafe" />
                                            </svg>
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
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
