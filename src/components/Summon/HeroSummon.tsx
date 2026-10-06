import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HERO_CODEX, type HeroCodexEntry } from '../../data/hero-codex';
import { getSummonImageUrl, prepareSummonImages } from './summon-images';
import { classTheme } from '../HeroCodex/class-theme';
import './hero-summon.css';
import { SummonAudio } from '../../audio/summon-audio';

type Phase = 'idle' | 'gather' | 'open' | 'reveal';

/** Pure presentation: callers may supply an authoritative draw result later. */
export function SummonPortrait({ hero }: { hero: HeroCodexEntry }) {
    const [failed, setFailed] = useState(false);
    return failed ? <div className="summon-portrait-fallback">{hero.name}</div> :
        <img decoding="async" src={getSummonImageUrl(hero.id)} alt={hero.name} onError={() => setFailed(true)} />;
}

export default function HeroSummon({ onClose }: { onClose: () => void }) {
    const [phase, setPhase] = useState<Phase>('idle');
    const [results, setResults] = useState<HeroCodexEntry[]>([]);
    const [run, setRun] = useState(0);
    const startRef = useRef<HTMLButtonElement>(null);
    const soundRef = useRef<SummonAudio | null>(null);
    const busy = phase === 'gather' || phase === 'open';
    const hero = results[0];

    useEffect(() => { startRef.current?.focus(); }, []);
    useEffect(() => {
        const sound = new SummonAudio();
        soundRef.current = sound;
        return () => { sound.dispose(); soundRef.current = null; };
    }, []);
    // Start preparation after the gather UI commits; network/decode never gates the animation.
    useEffect(() => {
        if (phase === 'gather') void prepareSummonImages(results.map(entry => entry.id));
    }, [phase, results]);
    useEffect(() => {
        if (phase === 'open') soundRef.current?.cue(1.8);
        if (phase === 'reveal') soundRef.current?.cue(2.75);
    }, [phase]);
    useEffect(() => {
        if (phase !== 'gather' && phase !== 'open') return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const timer = window.setTimeout(() => setPhase(phase === 'gather' ? 'open' : 'reveal'), reduced ? 60 : phase === 'gather' ? 1800 : 950);
        return () => window.clearTimeout(timer);
    }, [phase]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { if (busy) setPhase('reveal'); else onClose(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [busy, onClose]);

    const draw = (count: number) => {
        if (busy) return;
        // Each draw is independent and uniform; this does not mutate battle ownership.
        const next = Array.from({ length: count }, () => HERO_CODEX[Math.floor(Math.random() * HERO_CODEX.length)]);
        soundRef.current?.play(count);
        setResults(next); setRun(value => value + 1); setPhase('gather');
    };

    return <section className={`summon-stage summon-${phase}${phase === 'reveal' && results.length > 1 ? ' summon-multi' : ''}`} aria-label="山河唤灵" style={{ '--hero-color': hero ? classTheme(hero.class).color : '#b59658' } as CSSProperties}>
        <div className="summon-grain" aria-hidden="true" />
        <div className="summon-mountains summon-mountains-far" aria-hidden="true" />
        <div className="summon-mountains" aria-hidden="true" />
        <header className="summon-header">
            <button onClick={onClose} data-sfx="cancel">‹ 返回</button>
            <span>六子战棋 <i /> 群英入卷</span>
            {busy ? <button onClick={() => setPhase('reveal')}>跳过演出 ›</button> : <span className="summon-chapter">山 河 卷 · 壹</span>}
        </header>
        <div className="summon-side-poem" aria-hidden="true">一滴墨，唤醒山河万象<br />一枚子，邀君共赴此局</div>
        <div className="summon-heading"><p>以 墨 为 引 · 以 棋 为 契</p><h1>山河唤灵</h1><span>落子入山河，故人自卷来。</span></div>
        <div className="summon-theatre" key={run}>
            <div className="summon-light-shafts" aria-hidden="true" />
            <svg className="summon-astrolabe" viewBox="0 0 600 600" fill="none" aria-hidden="true">
                <g className="summon-chart-outer">
                    <circle cx="300" cy="300" r="253" />
                    <circle cx="300" cy="300" r="243" strokeDasharray="1 9" strokeWidth="5" />
                    <circle cx="300" cy="300" r="228" strokeDasharray="100 19 4 19" />
                    {Array.from({ length: 12 }, (_, i) => <path key={i} d="M300 36 L304 46 L300 56 L296 46 Z" transform={`rotate(${i * 30} 300 300)`} />)}
                </g>
                <g className="summon-chart-inner">
                    <path d="M300 108 466 396 134 396Z M300 492 134 204 466 204Z" />
                    <circle cx="300" cy="300" r="193" strokeDasharray="40 11" />
                    {['乾', '坤', '巽', '震', '坎', '离'].map((symbol, i) => <text key={symbol} x="300" y="91" textAnchor="middle" transform={`rotate(${i * 60} 300 300)`}>{symbol}</text>)}
                </g>
                <g className="summon-brush-streams">
                    {[0, 120, 240].map(angle => <g key={angle} transform={`rotate(${angle} 300 300)`}>
                        <path className="summon-brush-body" d="M55 385 C-12 120 350 -20 479 173 C555 294 403 422 300 300" />
                        <path className="summon-brush-edge" d="M55 385 C-12 120 350 -20 479 173 C555 294 403 422 300 300" />
                    </g>)}
                </g>
            </svg>
            <div className="summon-water-ring" aria-hidden="true" />
            <div className="summon-burst" key={`burst-${phase}`} aria-hidden="true">
                <span className="summon-shockwave" /><span className="summon-shockwave summon-shockwave-second" />
                {Array.from({ length: 42 }, (_, i) => <i key={i} style={{ '--ray-angle': `${i * 137.508}deg`, '--ray-length': `${110 + i % 8 * 29}px`, '--ray-time': `${.85 + i % 6 * .17}s` } as CSSProperties} />)}
            </div>
            <div className="summon-halo" aria-hidden="true" />
            <div className="summon-orbit" aria-hidden="true"><span>天</span><span>地</span><span>玄</span><span>黄</span></div>
            <div className="summon-ink" aria-hidden="true" />
            <div className="summon-particles" aria-hidden="true">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ '--angle': `${i * 137.5}deg`, '--distance': `${150 + i % 7 * 25}px`, '--delay': `${i % 9 * -.31}s` } as CSSProperties} />)}</div>
            <div className="summon-seal" aria-hidden="true"><span>弈</span><small>落子 · 结契</small></div>
            <div className="summon-sweep" aria-hidden="true" />
            {phase === 'reveal' && results.length > 1 && <div className="summon-gallery" aria-label="本次结缘英雄">{results.map((entry, index) => <article className="summon-result-card" key={`${run}-${index}`} style={{ '--hero-color': classTheme(entry.class).color, '--card-origin': `${(index - 2.5) * -45}px`, '--card-tilt': `${(index - 2.5) * 3}deg` } as CSSProperties}>
                <div className="summon-scroll"><SummonPortrait hero={entry} /><span className="summon-card-number">{String(index + 1).padStart(2, '0')}</span></div>
                <div className="summon-card-copy"><span>{entry.class} · {entry.epithet}</span><h2>{entry.name}</h2><p>{entry.role}</p></div>
            </article>)}</div>}
            {phase === 'reveal' && results.length === 1 && hero && <article className="summon-revelation" key={run}>
                <div className="summon-scroll"><span className="summon-scroll-mark">山河有幸 · 与君相逢</span><SummonPortrait key={hero.id} hero={hero} /></div>
                <div className="summon-hero-copy"><span className="summon-class">{hero.class} · {classTheme(hero.class).label}</span><p>{hero.epithet}</p><h2>{hero.name}</h2><div className="summon-red-rule" /><span>{hero.role}</span><p className="summon-hero-summary">{hero.summary}</p><b className="summon-arrival">应召而来</b></div>
            </article>}
        </div>
        <footer className="summon-footer">
            <div className="summon-status" role="status" aria-live="polite">{phase === 'gather' ? '墨聚成阵 · 静候来者' : phase === 'open' ? '山河开卷 · 灵契初成' : phase === 'reveal' ? (results.length > 1 ? '六子齐聚 · 共赴山河' : `已结缘 1 位英雄 · ${hero?.name}`) : '万千风华，皆在一卷之间'}</div>
            <div className="summon-actions"><button ref={startRef} disabled={busy} onClick={() => draw(1)} data-sfx="primary">{phase === 'reveal' ? '再结一缘' : '结缘一次'}<small>一子问山河</small></button><button disabled={busy} onClick={() => draw(6)} data-sfx="primary">结缘六次<small>六子赴此局</small></button></div>
            <p className="summon-note">自由试抽 · 全体在场英雄等概率 · 结果仅供演出，不消耗资源</p>
        </footer>
    </section>;
}
