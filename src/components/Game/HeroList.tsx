import { useGameStore } from '../../store/game-store';
import { Hero, HeroState } from '../../types/game';
import HeroAvatar from '../ui/HeroAvatar';
import HeroStatusPopover from './HeroStatusPopover';

interface HeroListProps {
    player: 'player1' | 'player2';
    label?: string;
}

export default function HeroList({ player, label }: HeroListProps) {
    const heroes = useGameStore(state =>
        player === 'player1' ? state.player1Heroes : state.player2Heroes
    );
    const selectedHero = useGameStore(state => state.selectedHero);
    const selectHeroForAction = useGameStore(state => state.selectHeroForAction);
    const isAiMode = useGameStore(state => state.isAiMode);
    const aiPlayer = useGameStore(state => state.aiPlayer);
    const currentPlayer = useGameStore(state => state.currentPlayer);
    const computerIsActing = Boolean(isAiMode && currentPlayer === aiPlayer);

    const isCloneHero = (hero: Hero) => {
        if (hero.counters?.['__isClone'] === 1) return true;
        if (hero.id.startsWith('wukong-clone|') || hero.id.startsWith('mirror-clone|')) return true;
        return false;
    };

    const visibleHeroes = heroes.filter(hero => !isCloneHero(hero));

    const isP1 = player === 'player1';

    return (
        <div className="h-full flex flex-col">
            {/* 标题 */}
            <h3 className={`font-title text-base mb-3 flex items-center gap-2.5 ${isP1 ? 'text-indigo-ink' : 'text-vermillion'}`}>
                <span className="w-1 h-5 rounded-full" style={{
                    background: isP1
                        ? 'linear-gradient(180deg, #3d5a99, #2c3e6b)'
                        : 'linear-gradient(180deg, #e74c3c, #c0392b)'
                }} />
                {label ?? (isP1 ? '我方' : '敌方')}
            </h3>

            {/* 英雄列表 */}
            <div
                className="grid flex-1 min-h-0 gap-2 overflow-hidden"
                style={{ gridTemplateRows: `repeat(${Math.max(visibleHeroes.length, 1)}, minmax(0, 1fr))` }}
            >
                {visibleHeroes.length === 0 ? (
                    <p className="text-ink-faint text-sm font-body text-center py-4">暂无英雄</p>
                ) : (
                    visibleHeroes.map(hero => {
                        const isSelected = selectedHero?.id === hero.id;
                        const isAlive = hero.state === HeroState.ALIVE;
                        const isTempDead = hero.state === HeroState.TEMP_DEAD;
                        const isDead = hero.state === HeroState.DEAD;

                        return (
                            <HeroStatusPopover
                                key={hero.id}
                                hero={hero}
                                delayMs={520}
                                placement="right"
                                className="h-full min-h-0 outline-none"
                            >
                                <div
                                    onClick={() => isAlive && !computerIsActing && selectHeroForAction(hero)}
                                    className={`game-card flex h-full min-h-0 flex-col justify-center p-3 transition-all duration-200
                                        ${isAlive
                                            ? (computerIsActing ? 'cursor-default' : 'cursor-pointer')
                                            : 'opacity-30 grayscale'}
                                        ${isSelected ? 'game-card-selected animate-pulse-glow' : ''}
                                        ${hero.hasActedThisTurn && isAlive ? 'opacity-50' : ''}`}
                                >
                                    <div className="mb-2 flex items-center gap-2.5">
                                        <div className={`
                                            h-8 w-8 flex-shrink-0 rounded-lg border flex items-center justify-center
                                            ${isP1
                                                ? 'border-indigo-ink/20 bg-indigo-ink/10'
                                                : 'border-vermillion/20 bg-vermillion/10'}
                                        `}>
                                            <HeroAvatar
                                                heroId={hero.id}
                                                heroName={hero.name}
                                                size={32}
                                                className="h-full w-full rounded-[7px] object-cover"
                                                fallbackClassName={isP1 ? 'text-indigo-ink' : 'text-vermillion'}
                                            />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-1">
                                                <span className="truncate font-title text-sm text-ink">{hero.name}</span>
                                                {hero.hasActedThisTurn && isAlive && (
                                                    <span className="flex-shrink-0 text-[10px] text-ink-faint font-body">已行动</span>
                                                )}
                                                {isDead && <span className="ink-seal-sm flex-shrink-0 text-[9px]">殁</span>}
                                                {isTempDead && <span className="flex-shrink-0 text-[10px] text-gold-dark font-body">暂离</span>}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="hp-bar-lg">
                                        <div
                                            className={`hp-bar-fill ${
                                                hero.currentHp / hero.maxHp > 0.6 ? 'hp-high' :
                                                hero.currentHp / hero.maxHp > 0.3 ? 'hp-mid' :
                                                'hp-low'
                                            }`}
                                            style={{ width: `${(hero.currentHp / hero.maxHp) * 100}%` }}
                                        />
                                    </div>

                                    <div className="mt-1 flex justify-between text-[10px] text-ink-faint font-body">
                                        <span>HP</span>
                                        <span>{hero.currentHp}/{hero.maxHp}</span>
                                    </div>

                                    {hero.shield > 0 && (
                                        <div className="mt-1.5 text-[10px] text-indigo-ink font-body">
                                            护盾 {hero.shield}
                                        </div>
                                    )}
                                </div>
                            </HeroStatusPopover>
                        );
                    })
                )}
            </div>
        </div>
    );
}
