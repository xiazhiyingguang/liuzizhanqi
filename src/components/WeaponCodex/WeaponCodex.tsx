import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/game-store';
import { WEAPON_CODEX, WEAPON_SYSTEMS, WeaponCodexEntry, WeaponSystem } from '../../data/weapon-codex';
import HeroAvatar from '../ui/HeroAvatar';
import './weapon-codex.css';

const SYSTEM_THEME: Record<WeaponSystem, { color: string; soft: string; title: string }> = {
    武曲: { color: '#9f342b', soft: 'rgba(159,52,43,.10)', title: '锋刃破阵' },
    天师: { color: '#9a6b1d', soft: 'rgba(154,107,29,.11)', title: '玄术通幽' },
    猎户: { color: '#256b55', soft: 'rgba(37,107,85,.10)', title: '逐影猎心' },
    霸魁: { color: '#314e7c', soft: 'rgba(49,78,124,.10)', title: '重器镇岳' },
    素问: { color: '#4f775d', soft: 'rgba(79,119,93,.10)', title: '仁心济世' },
    化识: { color: '#71518a', soft: 'rgba(113,81,138,.10)', title: '万象化形' },
    通灵: { color: '#8c692c', soft: 'rgba(140,105,44,.11)', title: '灵契共鸣' },
    科学家: { color: '#246a78', soft: 'rgba(36,106,120,.10)', title: '格物穷理' },
    神话: { color: '#8e5632', soft: 'rgba(142,86,50,.10)', title: '神迹遗珍' },
};

function WeaponSigil({ weapon, compact = false }: { weapon: WeaponCodexEntry; compact?: boolean }) {
    const theme = SYSTEM_THEME[weapon.system];
    return (
        <div
            className={`weapon-sigil${compact ? ' weapon-sigil-compact' : ''}`}
            style={{ color: theme.color, backgroundColor: theme.soft }}
            aria-hidden="true"
        >
            <span className="weapon-sigil-orbit" />
            <span className="weapon-sigil-blade" />
            <span className="weapon-sigil-mark">{weapon.name.slice(0, 1)}</span>
        </div>
    );
}

function HeroOwner({ weapon }: { weapon: WeaponCodexEntry }) {
    const theme = SYSTEM_THEME[weapon.system];
    return (
        <div className="weapon-owner-card">
            <div className="weapon-owner-avatar" style={{ color: theme.color, backgroundColor: theme.soft }}>
                <HeroAvatar
                    heroId={weapon.heroId ?? weapon.id}
                    heroName={weapon.heroName}
                    size={68}
                    eager
                    className="h-full w-full object-cover"
                    fallbackClassName="text-current"
                />
            </div>
            <div className="min-w-0">
                <span>专属英雄</span>
                <strong>{weapon.heroName}</strong>
                <small>{weapon.system}体系 · 专属绑定</small>
            </div>
        </div>
    );
}

function WeaponDetail({ weapon }: { weapon: WeaponCodexEntry }) {
    const theme = SYSTEM_THEME[weapon.system];
    const hasDraft = weapon.effects.length > 0;

    return (
        <div key={weapon.id} className="weapon-detail animate-fade-up">
            <section
                className="weapon-detail-hero"
                style={{ background: `linear-gradient(128deg, rgba(255,255,255,.82), ${theme.soft})` }}
            >
                <span className="weapon-detail-watermark">器</span>
                <div className="weapon-detail-copy">
                    <div className="weapon-detail-meta">
                        <span style={{ color: theme.color, backgroundColor: theme.soft }}>
                            {weapon.system} · {theme.title}
                        </span>
                        <i className={hasDraft ? 'is-drafted' : 'is-pending'}>
                            {hasDraft ? '效果草案' : '效果待定'}
                        </i>
                    </div>
                    <h2>{weapon.name}</h2>
                    <p>一器一主，因人而鸣。此页收录武器的专属归属与当前策划构想。</p>
                    <HeroOwner weapon={weapon} />
                </div>
                <div className="weapon-detail-art">
                    <span className="weapon-detail-halo" style={{ borderColor: `${theme.color}20` }} />
                    <WeaponSigil weapon={weapon} />
                    <b style={{ color: theme.color }}>{weapon.name}</b>
                    <small>EXCLUSIVE RELIC</small>
                </div>
            </section>

            <section className="weapon-effect-panel">
                <div className="weapon-effect-heading">
                    <div>
                        <span style={{ backgroundColor: theme.color }} />
                        <h3>武器效果</h3>
                    </div>
                    <em>策划记录</em>
                </div>

                {hasDraft ? (
                    <ol className="weapon-effect-list">
                        {weapon.effects.map((effect, index) => (
                            <li key={effect}>
                                <span style={{ color: theme.color, borderColor: `${theme.color}45`, backgroundColor: theme.soft }}>
                                    {String(index + 1).padStart(2, '0')}
                                </span>
                                <p>{effect}</p>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <div className="weapon-effect-empty">
                        <span style={{ color: theme.color }}>待</span>
                        <div>
                            <strong>效果尚在构思</strong>
                            <p>已收录武器名称与专属英雄，具体机制将在策划确认后补入。</p>
                        </div>
                    </div>
                )}
            </section>

            <section className="weapon-design-note">
                <span className="weapon-design-seal">未实装</span>
                <div>
                    <h3>设计阶段说明</h3>
                    <p>本页效果均为图鉴草案，目前不会改变英雄属性、技能结算或联机战斗。后续实装时可继续在此处同步最终说明。</p>
                </div>
            </section>
        </div>
    );
}

export default function WeaponCodex() {
    const [query, setQuery] = useState('');
    const [selectedSystem, setSelectedSystem] = useState<'全部' | WeaponSystem>('全部');
    const [selectedWeaponId, setSelectedWeaponId] = useState(WEAPON_CODEX[0].id);

    const filteredWeapons = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return WEAPON_CODEX.filter(weapon => {
            const systemMatches = selectedSystem === '全部' || weapon.system === selectedSystem;
            const searchText = [weapon.name, weapon.heroName, weapon.system, ...weapon.effects].join(' ').toLowerCase();
            return systemMatches && (!normalized || searchText.includes(normalized));
        });
    }, [query, selectedSystem]);

    const selectedWeapon = filteredWeapons.find(weapon => weapon.id === selectedWeaponId)
        ?? filteredWeapons[0]
        ?? WEAPON_CODEX.find(weapon => weapon.id === selectedWeaponId)
        ?? WEAPON_CODEX[0];

    const chooseSystem = (system: '全部' | WeaponSystem) => {
        setSelectedSystem(system);
        const firstMatch = WEAPON_CODEX.find(weapon => system === '全部' || weapon.system === system);
        if (firstMatch) setSelectedWeaponId(firstMatch.id);
    };

    return (
        <main className="weapon-codex-stage">
            <span className="weapon-codex-page-mark" aria-hidden="true">兵</span>
            <header className="weapon-codex-header">
                <div className="weapon-codex-header-inner">
                    <button
                        type="button"
                        data-sfx="cancel"
                        onClick={() => useGameStore.setState({ phase: 'menu' })}
                        className="weapon-codex-back"
                    >
                        <span>←</span>
                        <span className="weapon-codex-back-copy">返回主界面</span>
                    </button>
                    <div className="weapon-codex-title">
                        <div>
                            <h1>武器图鉴</h1>
                            <span>神兵入卷 · 各择其主</span>
                        </div>
                        <p>专属武器策划档案</p>
                    </div>
                    <div className="weapon-codex-count">
                        <strong>{WEAPON_CODEX.length}</strong>
                        <span>件藏品</span>
                    </div>
                </div>
            </header>

            <div className="weapon-codex-layout">
                <aside className="weapon-codex-sidebar">
                    <div className="weapon-codex-tools">
                        <label className="weapon-codex-search">
                            <span>⌕</span>
                            <input
                                type="search"
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder="搜索武器、英雄或效果"
                            />
                        </label>
                        <div className="weapon-system-filters">
                            {(['全部', ...WEAPON_SYSTEMS] as const).map(system => (
                                <button
                                    key={system}
                                    type="button"
                                    data-sfx="tab"
                                    className={selectedSystem === system ? 'is-active' : ''}
                                    onClick={() => chooseSystem(system)}
                                >
                                    {system}
                                </button>
                            ))}
                        </div>
                        <p>当前展卷 {filteredWeapons.length} 件</p>
                    </div>

                    <div className="weapon-codex-list light-scrollbar">
                        {filteredWeapons.length ? filteredWeapons.map((weapon, index) => {
                            const selected = selectedWeapon.id === weapon.id;
                            const theme = SYSTEM_THEME[weapon.system];
                            return (
                                <button
                                    key={weapon.id}
                                    type="button"
                                    data-sfx="tab"
                                    className={`weapon-list-item${selected ? ' is-selected' : ''}`}
                                    style={selected ? { borderColor: `${theme.color}45`, boxShadow: `inset 3px 0 0 ${theme.color}` } : undefined}
                                    onClick={() => setSelectedWeaponId(weapon.id)}
                                >
                                    <span className="weapon-list-index">{String(index + 1).padStart(2, '0')}</span>
                                    <WeaponSigil weapon={weapon} compact />
                                    <span className="weapon-list-copy">
                                        <strong>{weapon.name}</strong>
                                        <small>{weapon.heroName}</small>
                                    </span>
                                    <span className="weapon-list-system" style={{ color: theme.color }}>{weapon.system}</span>
                                </button>
                            );
                        }) : (
                            <div className="weapon-list-empty">
                                <span>空</span>
                                <p>没有找到相符的武器</p>
                                <button type="button" data-sfx="tab" onClick={() => { setQuery(''); chooseSystem('全部'); }}>清除筛选</button>
                            </div>
                        )}
                    </div>
                </aside>

                <section className="weapon-codex-content light-scrollbar">
                    <WeaponDetail weapon={selectedWeapon} />
                    <p className="weapon-codex-footer">武器效果尚未接入战斗 · 最终机制以实装版本为准</p>
                </section>
            </div>
        </main>
    );
}

