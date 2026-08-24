import { useGameStore } from '../../store/game-store';
import { AVAILABLE_HERO_IDS, getHeroInfo } from '../../data/heroes';
import InkButton from '../ui/InkButton';
import InkCard from '../ui/InkCard';
import InkDivider from '../ui/InkDivider';
import HeroIcon from '../ui/HeroIcon';
import SetupExitButton from '../GameSetup/SetupExitButton';

export default function HeroSelect() {
    const {
        selectingPlayer,
        player1SelectedHeroIds,
        player2SelectedHeroIds,
        confirmHeroSelection,
        isOnlineMode,
        isAiMode,
        localPlayerNumber,
        player1ReadyHeroSelect,
        player2ReadyHeroSelect
    } = useGameStore();

    const localPlayerKey = localPlayerNumber === 1 ? 'player1' : localPlayerNumber === 2 ? 'player2' : null;
    const viewPlayer = isAiMode ? 'player1' : (isOnlineMode && localPlayerKey ? localPlayerKey : selectingPlayer);
    const localReady = viewPlayer === 'player1' ? player1ReadyHeroSelect : player2ReadyHeroSelect;
    const opponentReady = viewPlayer === 'player1' ? player2ReadyHeroSelect : player1ReadyHeroSelect;
    const canSelect = isAiMode ? !player1ReadyHeroSelect : (isOnlineMode ? !localReady : selectingPlayer === viewPlayer);
    const selectedIds = viewPlayer === 'player1' ? player1SelectedHeroIds : player2SelectedHeroIds;
    const isComplete = selectedIds.length === 4;

    const playerColor = viewPlayer === 'player1' ? 'indigo-ink' : 'vermillion';
    const playerLabel = isAiMode ? '你' : (viewPlayer === 'player1' ? '玩家一' : '玩家二');

    return (
        <div className="w-full h-full flex flex-col items-center justify-start px-6 py-8 relative overflow-y-auto">
            <SetupExitButton stage="点将" />
            {/* 背景水印 */}
            <span className="absolute font-title text-[16rem] text-ink/[0.02] select-none pointer-events-none"
                style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                选
            </span>

            <div className="w-full max-w-5xl relative z-10">
                {/* 标题区 */}
                <div className="text-center mb-6 animate-fade-up">
                    <h2 className="font-title text-4xl text-ink tracking-wider mb-1">
                        {playerLabel} · 点将
                    </h2>
                    <InkDivider variant="cloud" className="max-w-[180px] mx-auto mb-2" />
                    <p className="text-ink-light text-sm font-body">
                        已选 <span className={`font-bold text-${playerColor}`}>{selectedIds.length}</span> / 4 位英雄
                    </p>
                    {isOnlineMode && localReady && !opponentReady && (
                        <p className="text-gold text-sm font-body mt-1 animate-pulse">
                            等待对手确认中...
                        </p>
                    )}
                    {isAiMode && player1ReadyHeroSelect && !player2ReadyHeroSelect && (
                        <p className="mt-1 text-sm text-gold-dark font-body animate-pulse">
                            宗师电脑正在分析你的阵容并选将…
                        </p>
                    )}
                </div>

                {/* 英雄卡片网格 */}
                <div className="grid grid-cols-3 gap-4 mb-6 sm:grid-cols-3 lg:grid-cols-3">
                    {AVAILABLE_HERO_IDS.map((heroId, index) => {
                        const isSelected = selectedIds.includes(heroId);
                        const info = getHeroInfo(heroId);

                        return (
                            <div
                                key={heroId}
                                data-testid={`hero-select-${heroId}`}
                                onClick={() => {
                                    if (canSelect) {
                                        useGameStore.getState().selectHero(heroId);
                                    }
                                }}
                                className={`
                                    animate-fade-up
                                    ${!canSelect ? 'pointer-events-none' : ''}
                                `}
                                style={{ animationDelay: `${index * 60}ms` }}
                            >
                                <InkCard
                                    variant={isSelected ? 'selected' : 'interactive'}
                                    className={`
                                        p-4 text-center relative
                                        ${!canSelect && !isSelected ? 'opacity-40 grayscale' : ''}
                                    `}
                                >
                                    {/* 选中印章 */}
                                    {isSelected && (
                                        <div className="absolute top-2 right-2 animate-seal-stamp">
                                            <span className="ink-seal-sm">选</span>
                                        </div>
                                    )}

                                    {/* 英雄图标 */}
                                    <div className="w-16 h-16 mx-auto mb-2 rounded-full flex items-center justify-center"
                                        style={{
                                            background: isSelected
                                                ? `radial-gradient(circle, rgba(212,168,67,0.15), transparent)`
                                                : `radial-gradient(circle, rgba(26,26,26,0.04), transparent)`
                                        }}>
                                        <HeroIcon
                                            heroId={heroId}
                                            size={40}
                                            className={isSelected ? 'text-gold-dark' : 'text-ink-light'}
                                        />
                                    </div>

                                    {/* 英雄名 */}
                                    <h3 className="font-title text-xl text-ink mb-0.5">
                                        {info.name}
                                    </h3>

                                    {/* 职业 */}
                                    <span className={`
                                        inline-block text-xs px-2 py-0.5 rounded-sm font-body mb-1.5
                                        ${info.class === '武曲' ? 'bg-vermillion/10 text-vermillion' :
                                            info.class === '猎户' ? 'bg-jade/10 text-jade' :
                                            info.class === '霸魁' ? 'bg-indigo-ink/10 text-indigo-ink' :
                                            info.class === '素问' ? 'bg-jade/10 text-jade' :
                                            'bg-ink/5 text-ink-light'}
                                    `}>
                                        {info.class}
                                    </span>

                                    {/* 描述 */}
                                    <p className="text-xs text-ink-faint font-body leading-relaxed line-clamp-2">
                                        {info.description}
                                    </p>
                                </InkCard>
                            </div>
                        );
                    })}
                </div>

                {/* 确认按钮 */}
                <div className="text-center animate-fade-up" style={{ animationDelay: '500ms' }}>
                    <InkButton
                        data-testid="confirm-hero-selection"
                        variant="primary"
                        size="lg"
                        onClick={confirmHeroSelection}
                        disabled={!isComplete || !canSelect}
                        className="min-w-[200px]"
                    >
                        确认选择
                    </InkButton>
                </div>
            </div>
        </div>
    );
}
