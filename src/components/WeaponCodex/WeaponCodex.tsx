import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/game-store';
import { WEAPON_CODEX, type WeaponCodexEntry } from '../../data/weapon-codex';
import { HERO_CLASSES } from '../../data/hero-codex';
import { HIDDEN_HERO_IDS } from '../../data/heroes';
import { getSkill } from '../../data/skills';
import HeroAvatar from '../ui/HeroAvatar';
import { classTheme } from '../HeroCodex/class-theme';

// 与选将池共用同一份下架名单：下架英雄的武器不进图鉴
const VISIBLE_WEAPONS = WEAPON_CODEX.filter(weapon => !HIDDEN_HERO_IDS.includes(weapon.heroId));

/** 英雄的两招技能名：让武器页能说出"这口器配的是哪一路本事" */
function skillNames(weapon: WeaponCodexEntry): string[] {
    return [1, 2]
        .map(index => getSkill(`${weapon.heroId}_skill${index}`)?.name)
        .filter((name): name is string => Boolean(name));
}

function Pill({ children, accent }: { children: string; accent?: string }) {
    const theme = accent ?? '#3d3d3d';
    return (
        <span
            className="rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ color: theme, backgroundColor: `${theme}18` }}
        >
            {children}
        </span>
    );
}

function OwnerCard({ weapon }: { weapon: WeaponCodexEntry }) {
    const theme = classTheme(weapon.system);
    const skills = skillNames(weapon);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="relative">
                <span
                    className="absolute inset-[-18%] rounded-full"
                    style={{ backgroundColor: `${theme.color}14`, filter: 'blur(18px)' }}
                />
                <div
                    className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border border-ink/[0.08] sm:h-32 sm:w-32"
                    style={{ backgroundColor: theme.soft }}
                >
                    <HeroAvatar
                        heroId={weapon.heroId}
                        heroName={weapon.heroName}
                        size={128}
                        eager
                        className="h-full w-full rounded-full object-cover"
                        fallbackClassName="text-ink-light"
                    />
                </div>
            </div>
            <div>
                <div className="text-[10px] tracking-[.2em] text-ink-faint">专属英雄</div>
                <div className="mt-0.5 flex items-baseline justify-center gap-2">
                    <h4 className="font-title text-2xl text-ink">{weapon.heroName}</h4>
                    <span className="text-xs" style={{ color: theme.color }}>{weapon.system}</span>
                </div>
            </div>
            {skills.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                    {skills.map(name => (
                        <span
                            key={name}
                            className="rounded-full border border-ink/10 bg-white/50 px-2.5 py-1 text-[11px] text-ink-light"
                        >
                            {name}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function WeaponDetail({ weapon }: { weapon: WeaponCodexEntry }) {
    const theme = classTheme(weapon.system);
    const drafted = weapon.effects.length > 0;

    return (
        <div key={weapon.id} className="animate-fade-up">
            <section
                className="relative grid min-h-[280px] items-center gap-5 overflow-hidden rounded-2xl border border-ink/[0.07] p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(230px,32%)]"
                style={{ background: `linear-gradient(125deg, rgba(255,255,255,.72), ${theme.soft})` }}
            >
                <span className="pointer-events-none absolute -right-3 -top-14 select-none font-title text-[10rem] text-ink/[0.025]">
                    器
                </span>
                <div className="relative z-10">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Pill accent={theme.color}>{`${weapon.system} · ${theme.label}`}</Pill>
                        <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] ${
                                drafted
                                    ? 'border-gold/40 bg-gold/[0.08] text-gold-dark'
                                    : 'border-ink/10 bg-white/40 text-ink-faint'
                            }`}
                        >
                            {drafted ? '效果草案' : '效果待定'}
                        </span>
                    </div>
                    <h2 className="font-title text-4xl leading-tight text-ink sm:text-5xl">{weapon.name}</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-faint">
                        一器一主，因人而鸣。此页收录武器的专属归属与当前策划构想。
                    </p>
                </div>
                <div className="relative z-10 rounded-xl border border-ink/[0.07] bg-white/45 p-5">
                    <OwnerCard weapon={weapon} />
                </div>
            </section>

            <section className="mt-5 rounded-xl border border-ink/[0.07] bg-white/35 p-4">
                <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span className="h-4 w-1 rounded-full" style={{ backgroundColor: theme.color }} />
                        <h3 className="font-title text-xl text-ink">武器效果</h3>
                    </div>
                    <span className="text-[10px] tracking-[.16em] text-ink-faint">策划记录</span>
                </div>

                {drafted ? (
                    <ol className="mt-3 space-y-2">
                        {weapon.effects.map((effect, index) => (
                            <li key={effect} className="flex gap-3 text-sm leading-6 text-ink-light">
                                <span className="font-title text-lg" style={{ color: theme.color }}>
                                    {String(index + 1).padStart(2, '0')}
                                </span>
                                <span>{effect}</span>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <article className="mt-3 rounded-xl border border-dashed border-ink/[0.09] bg-ink/[0.015] p-4">
                        <div className="flex items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 font-title text-lg text-ink-faint">
                                待
                            </span>
                            <div>
                                <h4 className="font-title text-xl text-ink-light">效果尚在构思</h4>
                                <p className="mt-1.5 text-sm leading-6 text-ink-faint">
                                    已收录武器名称与专属英雄，具体机制将在策划确认后补入。
                                </p>
                            </div>
                        </div>
                    </article>
                )}
            </section>

            <section className="mt-5 rounded-xl border border-ink/[0.07] bg-white/35 p-4">
                <div className="flex items-start gap-3">
                    <span className="shrink-0 rounded-full border border-vermillion/25 bg-vermillion/[0.06] px-2.5 py-1 text-[11px] text-vermillion">
                        未实装
                    </span>
                    <div>
                        <h3 className="font-title text-xl text-ink">设计阶段说明</h3>
                        <p className="mt-1.5 text-sm leading-6 text-ink-faint">
                            本页效果均为图鉴草案，目前不会改变英雄属性、技能结算或联机战斗。后续实装时继续在此处同步最终说明。
                        </p>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default function WeaponCodex() {
    const [query, setQuery] = useState('');
    const [selectedSystem, setSelectedSystem] = useState('全部');
    const [selectedWeaponId, setSelectedWeaponId] = useState(VISIBLE_WEAPONS[0].id);

    const filteredWeapons = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return VISIBLE_WEAPONS.filter(weapon => {
            const systemMatches = selectedSystem === '全部' || weapon.system === selectedSystem;
            const searchText = [weapon.name, weapon.heroName, weapon.system, ...weapon.effects]
                .join(' ')
                .toLowerCase();
            return systemMatches && (!normalized || searchText.includes(normalized));
        });
    }, [query, selectedSystem]);

    const selectedWeapon = filteredWeapons.find(weapon => weapon.id === selectedWeaponId)
        ?? filteredWeapons[0]
        ?? VISIBLE_WEAPONS.find(weapon => weapon.id === selectedWeaponId)
        ?? VISIBLE_WEAPONS[0];

    const chooseSystem = (system: string) => {
        setSelectedSystem(system);
        const firstMatch = VISIBLE_WEAPONS.find(weapon => system === '全部' || weapon.system === system);
        if (firstMatch) setSelectedWeaponId(firstMatch.id);
    };

    return (
        <main className="relative flex h-full w-full flex-col overflow-hidden bg-rice">
            <span className="pointer-events-none absolute right-[7%] top-[8%] select-none font-title text-[18rem] text-ink/[0.018]">兵</span>
            <header className="relative z-10 shrink-0 border-b border-ink/[0.07] bg-rice-light/75 px-4 py-3 backdrop-blur-md sm:px-7">
                <div className="mx-auto flex max-w-[1480px] items-center gap-4">
                    <button
                        type="button"
                        data-sfx="cancel"
                        onClick={() => useGameStore.setState({ phase: 'menu' })}
                        className="group flex h-10 items-center gap-2 rounded-lg border border-ink/10 bg-white/45 px-3 text-sm text-ink-light transition hover:border-ink/20 hover:bg-white/80 hover:text-ink"
                    >
                        <span className="text-lg transition-transform group-hover:-translate-x-0.5">←</span>
                        <span className="hidden sm:inline">返回主界面</span>
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-3">
                            <h1 className="font-title text-3xl tracking-wider text-ink">武器图鉴</h1>
                            <span className="hidden text-xs tracking-[.18em] text-ink-faint sm:inline">神兵入卷 · 各择其主</span>
                        </div>
                    </div>
                    <div className="rounded-full border border-vermillion/20 bg-vermillion/[0.05] px-3 py-1.5 text-xs text-vermillion">
                        已收录 {VISIBLE_WEAPONS.length} 件
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
                                placeholder="搜索武器、英雄或效果"
                                className="h-10 w-full rounded-lg border border-ink/10 bg-rice-light/70 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-faint/70 focus:border-gold/70 focus:ring-2 focus:ring-gold/10"
                            />
                        </label>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {['全部', ...HERO_CLASSES].map(system => (
                                <button
                                    key={system}
                                    type="button"
                                    data-sfx="tab"
                                    onClick={() => chooseSystem(system)}
                                    className={`rounded-full px-2.5 py-1 text-xs transition ${
                                        selectedSystem === system
                                            ? 'bg-ink text-rice-light shadow-sm'
                                            : 'border border-ink/[0.08] bg-white/35 text-ink-faint hover:bg-white/70 hover:text-ink'
                                    }`}
                                >
                                    {system}
                                </button>
                            ))}
                        </div>
                        <p className="mt-3 text-[11px] text-ink-faint">当前显示 {filteredWeapons.length} 件武器</p>
                    </div>

                    <div className="light-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
                        {filteredWeapons.length ? (
                            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                                {filteredWeapons.map(weapon => {
                                    const selected = selectedWeapon.id === weapon.id;
                                    const theme = classTheme(weapon.system);
                                    return (
                                        <button
                                            key={weapon.id}
                                            type="button"
                                            data-sfx="tab"
                                            onClick={() => setSelectedWeaponId(weapon.id)}
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
                                                    heroId={weapon.heroId}
                                                    heroName={weapon.heroName}
                                                    size={48}
                                                    className="h-full w-full rounded-full object-cover"
                                                    fallbackClassName="text-ink-light"
                                                />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <h3 className="truncate font-title text-lg text-ink">{weapon.name}</h3>
                                                    <span className="shrink-0 text-[10px]" style={{ color: theme.color }}>{weapon.system}</span>
                                                </div>
                                                <p className="mt-0.5 truncate text-[11px] text-ink-faint">{weapon.heroName}</p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex h-full min-h-36 flex-col items-center justify-center px-4 text-center">
                                <span className="font-title text-4xl text-ink/15">空</span>
                                <p className="mt-2 text-sm text-ink-faint">没有找到相符的武器</p>
                                <button
                                    type="button"
                                    data-sfx="tab"
                                    onClick={() => { setQuery(''); chooseSystem('全部'); }}
                                    className="mt-3 text-xs text-vermillion hover:underline"
                                >
                                    清除筛选
                                </button>
                            </div>
                        )}
                    </div>
                </aside>

                <section className="light-scrollbar min-h-0 overflow-y-auto rounded-2xl border border-ink/[0.07] bg-rice-light/50 p-4 shadow-[0_8px_32px_rgba(26,26,26,.05)] sm:p-6">
                    <WeaponDetail weapon={selectedWeapon} />
                    <p className="mt-7 text-center text-[10px] tracking-[.15em] text-ink-faint">
                        武器效果尚未接入战斗 · 一器一主随英雄图鉴同步
                    </p>
                </section>
            </div>
        </main>
    );
}
