import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HERO_CODEX, type HeroCodexEntry } from '../../data/hero-codex';
import { getSummonImageUrl, prepareSummonImages } from './summon-images';
import { SummonAudio } from '../../audio/summon-audio';
import './hero-summon.css';

type Phase = 'idle' | 'gather' | 'open' | 'reveal';

export function SummonPortrait({ hero }: { hero: HeroCodexEntry }) {
    const [failed, setFailed] = useState(false);
    const src = getSummonImageUrl(hero.id);
    return !src || failed ? <div className="summon-portrait-fallback">{hero.name}</div> :
        <img decoding="async" src={src} alt={hero.name} onError={() => setFailed(true)} />;
}

function InkLandscape() {
    return <svg className="summon-landscape" viewBox="0 0 800 460" fill="none" aria-hidden="true">
        <circle cx="400" cy="216" r="184" stroke="#b29a6b" strokeWidth=".7" strokeDasharray="840 320" transform="rotate(-52 400 216)" />
        <circle cx="400" cy="216" r="177" stroke="#b29a6b" strokeWidth=".4" opacity=".4" />
        <path d="M100 318 155 294 197 305 260 214 295 239 350 152 389 194 425 171 503 256 551 223 640 302 705 320Z" fill="#bcc6be" opacity=".44" />
        <path d="m172 325 85-52 35 9 63-79 52 47 40-19 66 77 51-26 70 49Z" fill="#788f83" opacity=".32" />
        <path d="m81 345 107-33 70 15 69-37 43 16 82-27 66 39 83-15 112 40Z" fill="#45675c" opacity=".22" />
        <path d="m350 152-19 69 16-9-15 45m93-86 26 74-12-5 34 48m78-65-9 47 20 19" stroke="#688174" strokeWidth="1" opacity=".4" />
        <path d="M132 352c140-13 267 14 529-5M239 369c116-9 240 10 327-1M320 385h168" stroke="#87998a" strokeWidth=".7" opacity=".6" />
        <path d="m570 148 9-4 7 5m-35 18 7-4 8 3" stroke="#4d665b" strokeWidth="1.3" />
        <circle cx="487" cy="107" r="22" fill="#ad5440" opacity=".8" />
        <path d="m384 361 8 5h31l8-5zm17-3v-18l13 18" stroke="#3a5149" strokeWidth="1" />
    </svg>;
}

/** Presentation only: drawing never changes battle ownership or spends resources. */
export default function HeroSummon({ onClose }: { onClose: () => void }) {
    const [phase, setPhase] = useState<Phase>('idle');
    const [results, setResults] = useState<HeroCodexEntry[]>([]);
    const [run, setRun] = useState(0);
    const startRef = useRef<HTMLButtonElement>(null);
    const soundRef = useRef<SummonAudio | null>(null);
    const drawingRef = useRef(false);
    const busy = phase === 'gather' || phase === 'open';
    const multi = results.length > 1;
    const hero = results[0];

    useEffect(() => { startRef.current?.focus(); return () => soundRef.current?.dispose(); }, []);
    useEffect(() => {
        if (phase === 'gather') {
            void prepareSummonImages(results.map(entry => entry.id));
            // The new composition commits before audio and portrait preparation.
            soundRef.current ??= new SummonAudio();
            soundRef.current.play(results.length);
        }
        if (phase === 'open') soundRef.current?.cue(1.8);
        if (phase === 'reveal') { drawingRef.current = false; soundRef.current?.cue(2.75); }
    }, [phase, results]);
    useEffect(() => {
        if (!busy) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const timer = window.setTimeout(() => setPhase(phase === 'gather' ? 'open' : 'reveal'), reduced ? 60 : phase === 'gather' ? 1800 : 950);
        return () => window.clearTimeout(timer);
    }, [phase, busy]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { if (busy) setPhase('reveal'); else onClose(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [busy, onClose]);

    const draw = (count: number) => {
        if (drawingRef.current) return;
        drawingRef.current = true;
        setResults(Array.from({ length: count }, () => HERO_CODEX[Math.floor(Math.random() * HERO_CODEX.length)]));
        setRun(value => value + 1);
        setPhase('gather');
    };

    return <section className={`summon-stage summon-${phase}${multi ? ' summon-multi' : ''}`} aria-label="山河唤灵">
        <header className="summon-header">
            <button onClick={onClose} data-sfx="cancel">← <span>返回</span></button>
            <span className="summon-brand">六子战棋 <i /> 群英入卷</span>
            {busy ? <button onClick={() => setPhase('reveal')}>跳过演出 →</button> : <span className="summon-chapter">山河卷 · 壹</span>}
        </header>
        <div className="summon-heading"><p>以 墨 为 引 · 以 棋 为 契</p><h1>{phase === 'reveal' ? '幸会，山河故人' : '山河唤灵'}</h1><span>{phase === 'reveal' ? '此后长路，与君同行。' : '一子落，万象生。'}</span></div>
        <div className="summon-theatre" key={run}>
            {phase !== 'reveal' && <div className="summon-invitation" aria-hidden="true">
                <InkLandscape />
                <div className="summon-inscription">山河远阔<span>静候君来</span></div>
                <div className="summon-stone"><span>缘</span></div>
                <div className="summon-ripple" /><div className="summon-ripple summon-ripple-second" />
                <span className="summon-seal">山河<br />有约</span>
            </div>}
            {phase === 'reveal' && multi && <div className="summon-gallery" aria-label="本次结缘英雄">{results.map((entry, index) => <article className="summon-result-card" key={`${run}-${index}`} style={{ '--card-origin': `${(2.5 - index) * 20}px` } as CSSProperties}>
                <div className="summon-scroll"><SummonPortrait hero={entry} /></div>
                <span className="summon-card-number">{String(index + 1).padStart(2, '0')}</span>
                <div className="summon-card-copy"><span>{entry.class}</span><h2 title={entry.name}>{entry.name.split('·').pop()?.trim()}</h2><p>{entry.epithet}</p></div>
            </article>)}</div>}
            {phase === 'reveal' && !multi && hero && <article className="summon-revelation">
                <div className="summon-single-art"><div className="summon-scroll"><SummonPortrait key={hero.id} hero={hero} /></div><span className="summon-art-caption">山河有幸 · 与君相逢</span></div>
                <div className="summon-hero-copy"><span className="summon-class">{hero.class} / {hero.epithet}</span><h2>{hero.name.split('·').pop()?.trim()}</h2><span className="summon-rule" /><p className="summon-hero-role">{hero.role}</p><p className="summon-hero-summary">{hero.summary}</p><span className="summon-arrival">缘定<br />此间</span></div>
            </article>}
            {phase === 'open' && <div className="summon-opening" aria-hidden="true"><i /><i /></div>}
        </div>
        <footer className="summon-footer">
            <div className="summon-status" role="status" aria-live="polite">{phase === 'gather' ? '落子入墨，山河渐醒…' : phase === 'open' ? '长卷初展，故人将至…' : phase === 'reveal' ? (multi ? '六子齐聚 · 共赴山河' : `已结缘 · ${hero?.name}`) : '万千风华，皆在一卷之间'}</div>
            <div className="summon-actions"><button ref={startRef} disabled={busy} onClick={() => draw(1)}> {phase === 'reveal' ? '再结一缘' : '结缘一次'} <span>壹</span></button><button disabled={busy} onClick={() => draw(6)}>结缘六次 <span>陆</span></button></div>
            <p className="summon-note">自由试抽 · 英雄等概率 · 不消耗资源</p>
        </footer>
    </section>;
}
