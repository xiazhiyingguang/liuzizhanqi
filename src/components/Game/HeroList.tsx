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

            {/* 英雄列表：卡片保持自然紧凑高度，空间不足时滚动而非压缩裁切 */}
            <div className="hero-roster-list flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
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
                                className="hero-roster-item outline-none"
                            >
                                <div
                                    onClick={() => isAlive && !computerIsActing && selectHeroForAction(hero)}
                                    className={`game-card flex h-full w-full min-h-0 flex-col justify-center gap-1.5 px-2.5 transition-all duration-200
                                        ${isAlive
                                            ? (computerIsActing ? 'cursor-default' : 'cursor-pointer')
                                            : 'opacity-30 grayscale'}
                                        ${isSelected ? 'game-card-selected animate-pulse-glow' : ''}
                                        ${hero.hasActedThisTurn && isAlive ? 'opacity-50' : ''}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`
                                            h-7 w-7 flex-shrink-0 rounded-lg border flex items-center justify-center
                                            ${isP1
                                                ? 'border-indigo-ink/20 bg-indigo-ink/10'
                                                : 'border-vermillion/20 bg-vermillion/10'}
                                        `}>
                                            <HeroAvatar
                                                heroId={hero.id}
                                                heroName={hero.name}
                                                size={28}
                                                className="h-full w-full rounded-[7px] object-cover"
                                                fallbackClassName={isP1 ? 'text-indigo-ink' : 'text-vermillion'}
                                            />
                                        </div>

                                        <span className="min-w-0 flex-1 truncate font-title text-sm text-ink">{hero.name}</span>

                                        {hero.hasActedThisTurn && isAlive && (
                                            <span className="flex-shrink-0 text-[10px] leading-none text-ink-faint font-body">已行动</span>
                                        )}
                                        {isTempDead && (
                                            <span className="flex-shrink-0 text-[10px] leading-none text-gold-dark font-body">暂离</span>
                                        )}
                                        {isDead && <span className="ink-seal-sm flex-shrink-0 text-[9px] leading-none">殁</span>}
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <div className="hp-bar-lg hp-bar-roster min-w-0 flex-1">
                                            <div
                                                className={`hp-bar-fill ${
                                                    hero.currentHp / hero.maxHp > 0.6 ? 'hp-high' :
                                                    hero.currentHp / hero.maxHp > 0.3 ? 'hp-mid' :
                                                    'hp-low'
                                                }`}
                                                style={{ width: `${(hero.currentHp / hero.maxHp) * 100}%` }}
                                            />
                                        </div>
                                        <span
                                            className="flex-shrink-0 whitespace-nowrap text-[10px] leading-none text-ink-faint font-body"
                                            style={{ fontVariantNumeric: 'tabular-nums' }}
                                        >
                                            {hero.currentHp}/{hero.maxHp}
                                        </span>
                                        {hero.shield > 0 && (
                                            <span
                                                className={`flex-shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] leading-none font-body
                                                    ${isP1 ? 'bg-indigo-ink/10 text-indigo-ink' : 'bg-vermillion/10 text-vermillion'}`}
                                            >
                                                盾 {hero.shield}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </HeroStatusPopover>
                        );
                    })
                )}
            </div>
        </div>
    );
}
