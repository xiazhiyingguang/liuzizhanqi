import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/game-store';
import { HERO_CLASSES, HERO_CODEX, HeroCodexEntry, SKILL_TYPE_LABELS } from '../../data/hero-codex';
import { HERO_ABILITY_KEYS, getAbilityHighlights, getHeroAbilityRatings, HeroAbilityKey } from '../../data/hero-ratings';
import { getHeroFullBodyUrl } from '../../data/hero-assets';
import HeroAvatar from '../ui/HeroAvatar';
import HeroIcon from '../ui/HeroIcon';
import HeroRadarChart from './HeroRadarChart';
import './hero-codex.css';

const CLASS_THEME: Record<string, { color: string; soft: string; label: string }> = {
    武曲: { color: '#a7372d', soft: 'rgba(167,55,45,.10)', label: '破阵之锋' },
    天师: { color: '#a97720', soft: 'rgba(169,119,32,.11)', label: '术法之枢' },
    猎户: { color: '#26705a', soft: 'rgba(38,112,90,.10)', label: '逐影之矢' },
    霸魁: { color: '#324e80', soft: 'rgba(50,78,128,.10)', label: '镇岳之壁' },
    素问: { color: '#4d7b60', soft: 'rgba(77,123,96,.10)', label: '济世之心' },
    化识: { color: '#74558f', soft: 'rgba(116,85,143,.10)', label: '万象之变' },
    通灵: { color: '#96702f', soft: 'rgba(150,112,47,.11)', label: '灵契之媒' },
};

function classTheme(heroClass: string) {
    return CLASS_THEME[heroClass] ?? { color: '#3d3d3d', soft: 'rgba(61,61,61,.08)', label: '无定之道' };
}

function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="min-w-[76px] rounded-lg border border-ink/[0.07] bg-white/45 px-3 py-2">
            <div className="text-[10px] tracking-[.16em] text-ink-faint">{label}</div>
            <div className="mt-0.5 font-title text-xl text-ink">{value}</div>
        </div>
    );
}

function AbilityCard({
    mark,
    title,
    subtitle,
    description,
    accent,
}: {
    mark: string;
    title: string;
    subtitle: string;
    description: string;
    accent: string;
}) {
    return (
        <article className="group rounded-xl border border-ink/[0.07] bg-white/45 p-4 transition-colors hover:bg-white/70">
            <div className="flex items-start gap-3">
                <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-title text-lg"
                    style={{ color: accent, borderColor: `${accent}55`, backgroundColor: `${accent}0d` }}
                >
                    {mark}
                </span>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                        <h4 className="font-title text-xl text-ink">{title}</h4>
                        <span className="text-[10px] tracking-[.14em] text-ink-faint">{subtitle}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-ink-light">{description}</p>
                </div>
            </div>
        </article>
    );
}

function AbilityProfile({ hero, accent }: { hero: HeroCodexEntry; accent: string }) {
    const ratings = getHeroAbilityRatings(hero.name);
    const [hoveredKey, setHoveredKey] = useState<HeroAbilityKey | null>(null);
    if (!ratings) return null;

    const highlights = getAbilityHighlights(ratings);
    const tendency = highlights.average >= 7.5
        ? '全域强势'
        : highlights.average >= 6
            ? '攻守均衡'
            : highlights.average >= 4.5
                ? '专精鲜明'
                : '战术辅助';

    return (
        <section className="hero-ability-panel mt-5">
            <div className="hero-ability-heading">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="hero-ability-title-mark" style={{ backgroundColor: accent }} />
                        <h3 className="font-title text-2xl text-ink">七维战势</h3>
                    </div>
                    <p className="mt-1 text-xs tracking-[.12em] text-ink-faint">能力评分范围 1—10 · 展现英雄的战术倾向</p>
                </div>
                <span className="hero-ability-score" style={{ color: accent, borderColor: `${accent}38`, backgroundColor: `${accent}0c` }}>
                    综合 {highlights.average.toFixed(1)}
                </span>
            </div>

            <div className="hero-ability-layout">
                <div className="hero-radar-wrap">
                    <HeroRadarChart
                        heroName={hero.name}
                        ratings={ratings}
                        accent={accent}
                        hoveredKey={hoveredKey}
                        onHover={setHoveredKey}
                    />
                </div>

                <div className="hero-ability-summary">
                    <div className="hero-ability-cards">
                        <div className="hero-ability-mini-card">
                            <span>优势维度</span>
                            <strong style={{ color: accent }}>
                                {highlights.strongest.map(key => `${key} ${ratings[key]}`).join(' · ')}
                            </strong>
                        </div>
                        <div className="hero-ability-mini-card">
                            <span>战势倾向</span>
                            <strong>{tendency}</strong>
                        </div>
                        <div className="hero-ability-mini-card">
                            <span>相对短板</span>
                            <strong>{highlights.weakest} {ratings[highlights.weakest]}</strong>
                        </div>
                    </div>

                    <div className="hero-ability-bars">
                        {HERO_ABILITY_KEYS.map(key => (
                            <div
                                key={key}
                                className={`hero-ability-bar-row${hoveredKey === key ? ' is-active' : ''}`}
                                onMouseEnter={() => setHoveredKey(key)}
                                onMouseLeave={() => setHoveredKey(null)}
                            >
                                <span>{key}</span>
                                <div className="hero-ability-bar-track">
                                    <i
                                        className="hero-ability-bar-fill"
                                        style={{
                                            width: `${ratings[key] * 10}%`,
                                            background: `linear-gradient(90deg, ${accent}90, ${accent})`,
                                        }}
                                    />
                                </div>
                                <b style={{ color: ratings[key] >= 8 ? accent : undefined }}>{ratings[key]}</b>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

function HeroFullBody({ hero, accent }: { hero: HeroCodexEntry; accent: string }) {
    const [failed, setFailed] = useState(false);
    const imageUrl = getHeroFullBodyUrl(hero.id);

    if (!imageUrl || failed) {
        return (
            <div className="hero-codex-figure hero-codex-figure-fallback" style={{ color: accent }}>
                <HeroIcon heroId={hero.id} size={116} />
                <span>形象绘制中</span>
            </div>
        );
    }

    return (
        <figure className="hero-codex-figure">
            <span className="hero-codex-figure-halo" style={{ backgroundColor: `${accent}18` }} />
            <img
                src={imageUrl}
                alt={`${hero.name}全身立绘`}
                loading="eager"
                decoding="async"
                draggable={false}
                onError={() => setFailed(true)}
            />
            <figcaption>角色立绘</figcaption>
        </figure>
    );
}

function HeroDetail({ hero }: { hero: HeroCodexEntry }) {
    const theme = classTheme(hero.class);
    return (
        <div key={hero.id} className="animate-fade-up">
            <section
                className="hero-codex-intro"
                style={{ background: `linear-gradient(125deg, rgba(255,255,255,.72), ${theme.soft})` }}
            >
                <span className="pointer-events-none absolute -right-3 -top-14 select-none font-title text-[10rem] text-ink/[0.025]">
                    {hero.name.slice(-1)}
                </span>
                <div className="hero-codex-intro-copy">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span
                            className="rounded-full px-2.5 py-1 text-xs font-medium"
                            style={{ color: theme.color, backgroundColor: theme.soft }}
                        >
                            {hero.class} · {theme.label}
                        </span>
                        <span className="text-xs tracking-[.18em] text-ink-faint">{hero.epithet}</span>
                    </div>
                    <h2 className="font-title text-4xl leading-tight text-ink sm:text-5xl">{hero.name}</h2>
                    <p className="mt-2 text-sm font-medium text-ink-light">{hero.role}</p>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-faint">{hero.summary}</p>

                    <div className="mt-6 flex flex-wrap gap-2">
                        <Stat label="生命" value={hero.maxHp} />
                        <Stat label="移动力" value={hero.moveRange} />
                        <Stat label="基础攻击" value={hero.baseAttack || '—'} />
                        <div className="min-w-[92px] rounded-lg border border-ink/[0.07] bg-white/45 px-3 py-2">
                            <div className="text-[10px] tracking-[.16em] text-ink-faint">上手难度</div>
                            <div className="mt-1 flex gap-1" aria-label={`${hero.difficulty}星难度`}>
                                {[1, 2, 3].map(level => (
                                    <span
                                        key={level}
                                        className="h-2 w-5 rounded-full"
                                        style={{ backgroundColor: level <= hero.difficulty ? theme.color : 'rgba(26,26,26,.09)' }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                <HeroFullBody key={hero.id} hero={hero} accent={theme.color} />
            </section>

            <AbilityProfile hero={hero} accent={theme.color} />

            <section className="mt-5 grid gap-3 sm:grid-cols-2">
                {hero.skills.map((skill, index) => (
                    <AbilityCard
                        key={`${hero.id}-${skill.name}`}
                        mark={`${index + 1}`}
                        title={skill.name}
                        subtitle={`${SKILL_TYPE_LABELS[skill.type]} · 射程 ${skill.range}`}
                        description={skill.description}
                        accent={theme.color}
                    />
                ))}
                <AbilityCard
                    mark="被"
                    title={hero.passive.name}
                    subtitle="被动能力"
                    description={hero.passive.description}
                    accent="#2d6a4f"
                />
                {hero.tianwei ? (
                    <AbilityCard
                        mark="威"
                        title={hero.tianwei.name}
                        subtitle="击杀触发"
                        description={hero.tianwei.description}
                        accent="#c0392b"
                    />
                ) : (
                    <article className="rounded-xl border border-dashed border-ink/[0.09] bg-ink/[0.015] p-4">
                        <div className="flex items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 font-title text-lg text-ink-faint">威</span>
                            <div>
                                <h4 className="font-title text-xl text-ink-light">无天威</h4>
                                <p className="mt-1.5 text-sm leading-6 text-ink-faint">这位英雄没有击杀触发的天威能力。</p>
                            </div>
                        </div>
                    </article>
                )}
            </section>

            <section className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
                <div className="rounded-xl border border-ink/[0.07] bg-white/35 p-4">
                    <h3 className="font-title text-xl text-ink">机制关键词</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {hero.tags.map(tag => (
                            <span key={tag} className="rounded-full border border-ink/10 bg-rice-light/70 px-3 py-1 text-xs text-ink-light">
                                {tag}
                            </span>
                        ))}
                    </div>
                    {hero.resource && (
                        <div className="mt-4 border-t border-ink/[0.06] pt-3">
                            <div className="text-[10px] tracking-[.18em] text-ink-faint">关键资源</div>
                            <p className="mt-1 text-sm text-ink-light">{hero.resource}</p>
                        </div>
                    )}
                </div>
                <div className="rounded-xl border border-ink/[0.07] bg-white/35 p-4">
                    <h3 className="font-title text-xl text-ink">对局要诀</h3>
                    <ol className="mt-2 space-y-2">
                        {hero.tips.map((tip, index) => (
                            <li key={tip} className="flex gap-3 text-sm leading-6 text-ink-light">
                                <span className="font-title text-lg" style={{ color: theme.color }}>{index + 1}</span>
                                <span>{tip}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>
        </div>
    );
}

export default function HeroCodex() {
    const [query, setQuery] = useState('');
    const [selectedClass, setSelectedClass] = useState('全部');
    const [selectedHeroId, setSelectedHeroId] = useState(HERO_CODEX[0].id);

    const filteredHeroes = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return HERO_CODEX.filter(hero => {
            const classMatches = selectedClass === '全部' || hero.class === selectedClass;
            const searchText = [hero.name, hero.class, hero.epithet, hero.role, hero.summary, ...hero.tags].join(' ').toLowerCase();
            return classMatches && (!normalized || searchText.includes(normalized));
        });
    }, [query, selectedClass]);

    const selectedHero = filteredHeroes.find(hero => hero.id === selectedHeroId)
        ?? filteredHeroes[0]
        ?? HERO_CODEX.find(hero => hero.id === selectedHeroId)
        ?? HERO_CODEX[0];

    const chooseClass = (heroClass: string) => {
        setSelectedClass(heroClass);
        const firstMatch = HERO_CODEX.find(hero => heroClass === '全部' || hero.class === heroClass);
        if (firstMatch) setSelectedHeroId(firstMatch.id);
    };

    return (
        <main className="relative flex h-full w-full flex-col overflow-hidden bg-rice">
            <span className="pointer-events-none absolute right-[7%] top-[8%] select-none font-title text-[18rem] text-ink/[0.018]">鉴</span>
            <header className="relative z-10 shrink-0 border-b border-ink/[0.07] bg-rice-light/75 px-4 py-3 backdrop-blur-md sm:px-7">
                <div className="mx-auto flex max-w-[1480px] items-center gap-4">
                    <button
                        type="button"
                        onClick={() => useGameStore.setState({ phase: 'menu' })}
                        className="group flex h-10 items-center gap-2 rounded-lg border border-ink/10 bg-white/45 px-3 text-sm text-ink-light transition hover:border-ink/20 hover:bg-white/80 hover:text-ink"
                    >
                        <span className="text-lg transition-transform group-hover:-translate-x-0.5">←</span>
                        <span className="hidden sm:inline">返回主界面</span>
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-3">
                            <h1 className="font-title text-3xl tracking-wider text-ink">英雄图鉴</h1>
                            <span className="hidden text-xs tracking-[.18em] text-ink-faint sm:inline">群英入卷 · 见招知势</span>
                        </div>
                    </div>
                    <div className="rounded-full border border-vermillion/20 bg-vermillion/[0.05] px-3 py-1.5 text-xs text-vermillion">
                        已收录 {HERO_CODEX.length} 位
                    </div>
                </div>
            </header>

            <div className="relative z-10 mx-auto grid min-h-0 w-full max-w-[1480px] flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[390px_minmax(0,1fr)]">
                <aside className="flex min-h-[280px] flex-col overflow-hidden rounded-2xl border border-ink/[0.07] bg-white/35 shadow-[0_8px_32px_rgba(26,26,26,.05)]">
                    <div className="shrink-0 border-b border-ink/[0.06] p-4">
                        <label className="relative block">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">⌕</span>
                            <input
                                type="search"
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder="搜索英雄、职业或机制"
                                className="h-10 w-full rounded-lg border border-ink/10 bg-rice-light/70 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-faint/70 focus:border-gold/70 focus:ring-2 focus:ring-gold/10"
                            />
                        </label>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {['全部', ...HERO_CLASSES].map(heroClass => (
                                <button
                                    key={heroClass}
                                    type="button"
                                    onClick={() => chooseClass(heroClass)}
                                    className={`rounded-full px-2.5 py-1 text-xs transition ${
                                        selectedClass === heroClass
                                            ? 'bg-ink text-rice-light shadow-sm'
                                            : 'border border-ink/[0.08] bg-white/35 text-ink-faint hover:bg-white/70 hover:text-ink'
                                    }`}
                                >
                                    {heroClass}
                                </button>
                            ))}
                        </div>
                        <p className="mt-3 text-[11px] text-ink-faint">当前显示 {filteredHeroes.length} 位英雄</p>
                    </div>

                    <div className="light-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
                        {filteredHeroes.length ? (
                            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                                {filteredHeroes.map(hero => {
                                    const selected = selectedHero.id === hero.id;
                                    const theme = classTheme(hero.class);
                                    return (
                                        <button
                                            key={hero.id}
                                            type="button"
                                            onClick={() => setSelectedHeroId(hero.id)}
                                            className={`group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                                                selected
                                                    ? 'border-gold/40 bg-gold/[0.07] shadow-[inset_3px_0_0_#d4a843]'
                                                    : 'border-transparent hover:border-ink/[0.07] hover:bg-white/55'
                                            }`}
                                        >
                                            <div
                                                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink/[0.08]"
                                                style={{ backgroundColor: theme.soft }}
                                            >
                                                <HeroAvatar
                                                    heroId={hero.id}
                                                    heroName={hero.name}
                                                    size={48}
                                                    className="h-full w-full rounded-full object-cover"
                                                    fallbackClassName="text-ink-light"
                                                />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <h3 className="truncate font-title text-lg text-ink">{hero.name}</h3>
                                                    <span className="shrink-0 text-[10px]" style={{ color: theme.color }}>{hero.class}</span>
                                                </div>
                                                <p className="mt-0.5 truncate text-[11px] text-ink-faint">{hero.role}</p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex h-full min-h-36 flex-col items-center justify-center px-4 text-center">
                                <span className="font-title text-4xl text-ink/15">空</span>
                                <p className="mt-2 text-sm text-ink-faint">没有找到相符的英雄</p>
                                <button
                                    type="button"
                                    onClick={() => { setQuery(''); chooseClass('全部'); }}
                                    className="mt-3 text-xs text-vermillion hover:underline"
                                >
                                    清除筛选
                                </button>
                            </div>
                        )}
                    </div>
                </aside>

                <section className="light-scrollbar min-h-0 overflow-y-auto rounded-2xl border border-ink/[0.07] bg-rice-light/50 p-4 shadow-[0_8px_32px_rgba(26,26,26,.05)] sm:p-6">
                    <HeroDetail hero={selectedHero} />
                    <p className="mt-7 text-center text-[10px] tracking-[.15em] text-ink-faint">
                        图鉴数值与当前战斗实现同步 · 机制说明以本版本为准
                    </p>
                </section>
            </div>
        </main>
    );
}
