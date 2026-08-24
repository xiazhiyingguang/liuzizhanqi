import { useGameStore } from '../../store/game-store';
import { getHeroInfo } from '../../data/heroes';
import HeroAvatar from '../ui/HeroAvatar';

/**
 * 替补制补员面板：英雄阵亡后出现，供补员方从替补席点选英雄，
 * 再点击己方半场空格让其立即上场（当前轮次即可行动）。
 */
export default function ReinforcementPanel() {
    const {
        reinforcingPlayer,
        reinforcementSelectableHeroId,
        player1BenchHeroIds,
        player2BenchHeroIds,
        selectReinforcementHero,
        clearReinforcementSelection,
        isAiMode,
        aiPlayer,
        isOnlineMode,
        localPlayerNumber
    } = useGameStore();

    if (!reinforcingPlayer) return null;

    const isP1 = reinforcingPlayer === 'player1';
    const bench = (isP1 ? player1BenchHeroIds : player2BenchHeroIds) ?? [];
    const localPlayerKey = localPlayerNumber === 2 ? 'player2' : 'player1';
    const canOperate = isAiMode
        ? reinforcingPlayer !== aiPlayer
        : isOnlineMode
            ? reinforcingPlayer === localPlayerKey
            : true;
    const operatorLabel = isAiMode
        ? (reinforcingPlayer === aiPlayer ? '宗师电脑' : '你')
        : isOnlineMode
            ? (reinforcingPlayer === localPlayerKey ? '你' : '对手')
            : (isP1 ? '玩家一' : '玩家二');
    const sideLabel = isP1 ? '左侧' : '右侧';
    const chosenName = reinforcementSelectableHeroId
        ? getHeroInfo(reinforcementSelectableHeroId).name
        : null;

    return (
        <section
            data-testid="reinforcement-panel"
            aria-label="替补上场"
            className={`relative flex h-[64px] w-[min(560px,calc(100%-24px))] flex-shrink-0 animate-fade-up items-center gap-3 overflow-hidden rounded-xl border px-4 py-2 shadow-[0_7px_24px_rgba(26,26,26,0.08)] backdrop-blur-sm transition-colors
                ${isP1
                    ? 'border-indigo-ink/25 bg-[#eef0f5]/90'
                    : 'border-vermillion/25 bg-[#f7eeea]/90'}`}
        >
            <span className={`absolute inset-y-0 left-0 w-1 ${isP1 ? 'bg-indigo-ink' : 'bg-vermillion'}`} />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className={`font-title text-sm ${isP1 ? 'text-indigo-ink' : 'text-vermillion'}`}>
                        替补上场
                    </span>
                    <span className="rounded-full border border-gold/20 bg-gold/5 px-2 py-0.5 font-body text-[9px] text-gold-dark animate-pulse">
                        {operatorLabel}正在补员
                    </span>
                </div>
                <p className="mt-0.5 truncate font-body text-xs leading-5 text-ink-light">
                    {canOperate
                        ? (chosenName
                            ? <>点击{sideLabel}半场空格，「<strong className="font-title text-sm font-normal text-ink">{chosenName}</strong>」立即上场并可行动</>
                            : '请从右侧替补席中选择上场的英雄')
                        : `等待${operatorLabel}部署替补…`}
                </p>
            </div>

            {canOperate && (
                <div className="flex flex-shrink-0 items-center gap-2">
                    {bench.map(heroId => {
                        const info = getHeroInfo(heroId);
                        const isActive = reinforcementSelectableHeroId === heroId;
                        return (
                            <button
                                key={heroId}
                                type="button"
                                data-testid={`reinforce-hero-${heroId}`}
                                onClick={() => (isActive ? clearReinforcementSelection() : selectReinforcementHero(heroId))}
                                title={`${info.name} · ${info.class}`}
                                className={`
                                    game-card flex items-center gap-1.5 rounded-lg px-2 py-1 transition-all
                                    ${isActive ? 'game-card-selected scale-105' : 'opacity-80 hover:scale-105 hover:opacity-100'}
                                `}
                            >
                                <div className={`
                                    h-8 w-8 overflow-hidden rounded-md border
                                    ${isP1
                                        ? 'border-indigo-ink/25 bg-indigo-ink/10'
                                        : 'border-vermillion/25 bg-vermillion/10'}
                                `}>
                                    <HeroAvatar
                                        heroId={heroId}
                                        heroName={info.name}
                                        size={32}
                                        className="h-full w-full object-cover"
                                        fallbackClassName={isP1 ? 'text-indigo-ink' : 'text-vermillion'}
                                    />
                                </div>
                                <span className="font-title text-xs text-ink">{info.name}</span>
                            </button>
                        );
                    })}
                    {bench.length === 0 && (
                        <span className="font-body text-xs text-ink-faint">替补席已空</span>
                    )}
                </div>
            )}
        </section>
    );
}
