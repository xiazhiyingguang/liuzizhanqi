import { useId } from 'react';
import { HeroState, type Hero } from '../../types/game';
import { getWangshuPhase } from '../../core/wangshu';
import '../../styles/wangshu-skill-fx.css';
import '../../styles/mechanism-skill-fx.css';

/** 静态的小标识补充当前形态/被动准备情况，不使用持续粒子或遮住头像。 */
export function HeroMechanismState({ hero }: { hero: Hero }) {
    const id = useId().replace(/:/g, '');
    if (hero.state !== HeroState.ALIVE) return null;
    if (hero.passiveId === 'wangshu_passive') {
        const phase = getWangshuPhase(hero);
        return <span className="wangshu-phase-badge" data-moon-phase={phase} aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill={phase === 0 ? '#253440' : '#cfdad7'} stroke="#778d99" strokeWidth="1" />
                {phase === 0 && <path d="M12 3A9 9 0 0 1 12 21A11 11 0 0 0 12 3Z" fill="#cfdad7" />}
                {phase === 1 && <path d="M12 3A9 9 0 0 0 12 21Z" fill="#253440" />}
                <path d="M6 8L8 6M15 16L17 14" stroke="#8fa4aa" strokeWidth="1" opacity=".7" />
            </svg>
        </span>;
    }
    const king = hero.counters['jetzmi_form'] === 1;
    const kind = hero.passiveId === 'jetzmi_passive' ? (king ? 'king' : 'lord')
        : hero.passiveId === 'changli_passive' && hero.effects.some(e => e.name === '长离复生增伤') ? 'rebirth'
        : hero.passiveId === 'xuanxiao_passive' && hero.counters['xuanxiao_danger_armed'] === 1 ? 'danger'
        : hero.passiveId === 'moran_passive' && hero.effects.some(e => e.name === '为道') ? 'way' : null;
    if (!kind) return null;
    const a = kind === 'lord' ? '#635079' : kind === 'rebirth' ? '#983247' : '#987034';
    const b = kind === 'lord' ? '#d5c2eb' : kind === 'danger' ? '#bceacf' : '#f3d79a';
    const material = <defs><linearGradient id={`mechanism-state-${id}`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor={a} /><stop offset=".45" stopColor={b} /><stop offset=".7" stopColor={a} /><stop offset="1" stopColor={b} />
    </linearGradient></defs>;
    return <span className="hero-mechanism-state" data-mechanism-state={kind} aria-hidden="true">
        {(kind === 'king' || kind === 'lord') && <svg className="hero-mechanism-crown" viewBox="0 0 32 24">
            {material}<path d="M 4 19 L 1 7 L 9 12 L 11 3 L 16 9 L 21 3 L 23 12 L 31 7 L 28 19 Q 16 23 4 19 Z"
                fill={`url(#mechanism-state-${id})`} stroke={b} strokeWidth=".7" />
            <path d="M 6 19 Q 16 22 26 19" fill="none" stroke="#362536" strokeWidth="1.4" />
        </svg>}
        {kind === 'rebirth' && <svg className="hero-mechanism-embers" viewBox="0 0 100 100">
            {material}<path d="M 3 23 L 3 7 L 17 7 M 97 77 L 97 93 L 83 93" fill="none"
                stroke={`url(#mechanism-state-${id})`} strokeWidth="1.6" />
            <path d="M 9 7 L 5 2 L 3 7 L 5 11 Z M 95 89 L 93 94 L 95 99 L 99 94 Z" fill={b} />
        </svg>}
        {kind === 'danger' && <svg className="hero-mechanism-seal" viewBox="0 0 24 40">
            {material}<path d="M 12 1 L 22 20 L 12 39 L 2 20 Z" fill="#21483e" stroke={`url(#mechanism-state-${id})`} />
            <path d="M 8 11 L 16 11 L 10 18 L 16 25 L 8 29 M 6 20 L 18 20" fill="none" stroke="#c2e7bc" strokeWidth="1.2" />
        </svg>}
        {kind === 'way' && <svg className="hero-mechanism-way" viewBox="0 0 28 10">
            <path d="M 10 5 L 18 5" stroke="#988b67" strokeWidth=".7" />
            {[6, 22].map((x, i) => <path key={x} d={`M ${x} 1 L ${x + 4} 5 L ${x} 9 L ${x - 4} 5 Z`}
                fill={(hero.counters['为道受击'] ?? 0) > i ? '#d5b873' : '#39403c'} stroke="#a29263" strokeWidth=".7" />)}
        </svg>}
    </span>;
}
