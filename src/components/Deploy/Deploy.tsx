import { useGameStore } from '../../store/game-store';
import { getHeroInfo } from '../../data/heroes';
import { useState } from 'react';
import InkButton from '../ui/InkButton';
import InkDivider from '../ui/InkDivider';
import HeroAvatar from '../ui/HeroAvatar';
import SetupExitButton from '../GameSetup/SetupExitButton';

export default function Deploy() {
    const {
        selectingPlayer,
        confirmDeployment,
        player1SelectedHeroIds,
        player2SelectedHeroIds,
        board,
        deployHero,
        isOnlineMode,
        isAiMode,
        localPlayerNumber,
        player1ReadyDeploy,
        player2ReadyDeploy
    } = useGameStore();

    const [selectedHeroId, setSelectedHeroId] = useState<string | null>(null);

    const localPlayerKey = localPlayerNumber === 1 ? 'player1' : localPlayerNumber === 2 ? 'player2' : null;
    const viewPlayer = isAiMode ? 'player1' : (isOnlineMode && localPlayerKey ? localPlayerKey : selectingPlayer);
    const localReady = viewPlayer === 'player1' ? player1ReadyDeploy : player2ReadyDeploy;
    const canDeploy = isAiMode ? !player1ReadyDeploy : (isOnlineMode ? !localReady : selectingPlayer === viewPlayer);

    const selectedHeroIds = viewPlayer === 'player1'
        ? player1SelectedHeroIds
        : player2SelectedHeroIds;

    const deployedCount = board.flat().filter(
        hero => hero && hero.owner === viewPlayer
    ).length;

    const isComplete = deployedCount === 4;
    const isP1 = viewPlayer === 'player1';

    const handleCellClick = (row: number, col: number) => {
        if (!canDeploy) return;
        if (!selectedHeroId) return;
        if (isP1 && col >= 3) return;
        if (!isP1 && col < 3) return;
        if (board[row][col] !== null) return;
        deployHero(selectedHeroId, [row, col]);
        setSelectedHeroId(null);
    };

    return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 relative overflow-hidden">
            <SetupExitButton stage="布阵" />
            {/* 背景水印 */}
            <span className="absolute font-title text-[16rem] text-ink/[0.02] select-none pointer-events-none"
                style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                阵
            </span>

            <div className="relative z-10 flex flex-col items-center">
                {/* 标题 */}
                <div className="text-center mb-5 animate-fade-up">
                    <h2 className="font-title text-3xl text-ink tracking-wider mb-1">
                        {isP1 ? '玩家一' : '玩家二'} · 布阵
                    </h2>
                    <InkDivider variant="brush" className="max-w-[160px] mx-auto mb-2" />
                    <p className="text-ink-light text-sm font-body">
                        {isP1 ? '左侧三列' : '右侧三列'}放置首发英雄
                        <span className="ml-2 font-bold text-ink">({deployedCount}/4)</span>
                    </p>
                    <p className="text-ink-faint text-xs font-body mt-0.5">
                        其余 {Math.max(selectedHeroIds.length - 4, 0)} 位英雄作为替补，待己方英雄阵亡后立即上场
                    </p>
                    {!canDeploy && (
                        <p className="text-gold-dark text-sm font-body mt-1 animate-gentle-pulse">
                            {isAiMode ? '宗师电脑正在根据你的阵型布阵…' : '等待对手部署中...'}
                        </p>
                    )}
                </div>

                {/* 英雄选择条 */}
                <div className="flex gap-3 mb-5 animate-fade-up" style={{ animationDelay: '100ms' }}>
                    {selectedHeroIds.map(heroId => {
                        const info = getHeroInfo(heroId);
                        const isDeployed = board.flat().some(
                            h => h && h.owner === viewPlayer && h.name === info.name
                        );
                        const isActive = selectedHeroId === heroId && canDeploy;

                        return (
                            <button
                                key={heroId}
                                data-testid={`deploy-hero-${heroId}`}
                                disabled={isDeployed || !canDeploy}
                                onClick={() => setSelectedHeroId(heroId)}
                                className="relative"
                            >
                                <div className={`
                                    game-card p-3 text-center min-w-[90px] transition-all
                                    ${isDeployed ? 'opacity-25 grayscale' : ''}
                                    ${isActive ? 'game-card-selected scale-105' : ''}
                                    ${canDeploy ? 'cursor-pointer' : 'cursor-not-allowed'}
                                `}>
                                    <div className={`
                                        w-12 h-12 rounded-xl mx-auto mb-1.5 flex items-center justify-center
                                        ${isP1
                                            ? 'bg-indigo-ink/10 border border-indigo-ink/20'
                                            : 'bg-vermillion/10 border border-vermillion/20'}
                                    `}>
                                        <HeroAvatar
                                            heroId={heroId}
                                            heroName={info.name}
                                            size={48}
                                            className="h-full w-full rounded-[10px] object-cover"
                                            fallbackClassName={isP1 ? 'text-indigo-ink' : 'text-vermillion'}
                                        />
                                    </div>
                                    <div className="font-title text-sm text-ink">{info.name}</div>
                                    <div className="text-xs text-ink-faint font-body">{info.class}</div>
                                    {isDeployed && (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="ink-seal-sm opacity-80">已阵</span>
                                        </div>
                                    )}
                                    {!isDeployed && deployedCount >= 4 && (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="ink-seal-sm opacity-80">替补</span>
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* 提示 */}
                {selectedHeroId && (
                    <p className="text-gold-dark text-sm font-body mb-3 animate-gentle-pulse">
                        点击{isP1 ? '左侧' : '右侧'}区域放置「{getHeroInfo(selectedHeroId).name}」
                    </p>
                )}

                {/* 部署棋盘 */}
                <div className="battle-field p-4 animate-fade-up" style={{ animationDelay: '200ms' }}>
                    <div className="inline-grid grid-cols-6 gap-1.5">
                        {Array(6).fill(0).map((_, row) => (
                            Array(6).fill(0).map((_, col) => {
                                const isPlayer1Zone = col < 3;
                                const isActiveZone = canDeploy && (
                                    (viewPlayer === 'player1' && isPlayer1Zone) ||
                                    (viewPlayer === 'player2' && !isPlayer1Zone)
                                );
                                const hero = board[row][col];

                                return (
                                    <div
                                        key={`${row}-${col}`}
                                        data-testid={`deploy-cell-${row}-${col}`}
                                        onClick={() => handleCellClick(row, col)}
                                        className={`
                                            battle-cell w-[72px] h-[72px] flex items-center justify-center transition-all duration-150
                                            ${isActiveZone
                                                ? selectedHeroId
                                                    ? 'cell-move cursor-pointer'
                                                    : ''
                                                : 'opacity-40'
                                            }
                                            ${hero
                                                ? isP1 ? 'cell-p1' : 'cell-p2'
                                                : ''
                                            }
                                        `}
                                    >
                                        {hero ? (
                                            <div className="flex flex-col items-center gap-0.5 animate-seal-stamp">
                                                <div className={`
                                                    piece w-11 h-11
                                                    ${hero.owner === 'player1' ? 'piece-p1' : 'piece-p2'}
                                                `}>
                                                    <HeroAvatar
                                                        heroId={hero.id}
                                                        heroName={hero.name}
                                                        size={44}
                                                        className="hero-piece-avatar"
                                                        fallbackClassName="text-white"
                                                        eager
                                                    />
                                                </div>
                                                <span className="text-[9px] text-ink-faint">{hero.name}</span>
                                            </div>
                                        ) : (
                                            isActiveZone && (
                                                <span className="text-[10px] text-ink/10 font-body">
                                                    {row},{col}
                                                </span>
                                            )
                                        )}
                                    </div>
                                );
                            })
                        ))}
                    </div>
                </div>

                {/* 确认按钮 */}
                <div className="mt-5 animate-fade-up" style={{ animationDelay: '300ms' }}>
                    <InkButton
                        data-testid="confirm-deployment"
                        variant="primary"
                        size="lg"
                        onClick={confirmDeployment}
                        disabled={!isComplete || !canDeploy}
                        className="min-w-[200px]"
                    >
                        确认部署 {!isComplete && `(首发 ${deployedCount}/4)`}
                    </InkButton>
                </div>
            </div>
        </div>
    );
}
