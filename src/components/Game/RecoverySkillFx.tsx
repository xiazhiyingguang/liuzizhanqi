import type { CSSProperties } from 'react';
import type { RecoveryFxTheme, SkillFxEvent } from '../../core/skill-fx';
import '../../styles/recovery-skill-fx.css';

function indexStyle(index: number): CSSProperties {
    return { '--recovery-i': index, '--recovery-angle': `${index * 60}deg` } as CSSProperties;
}

/** 细线物象围绕棋子展开，中心留空，让头像与生命数值仍可读。 */
function Motif({ shape, className = '' }: { shape: string; className?: string }) {
    return <svg className={`recovery-motif ${className}`} viewBox="0 0 100 100" aria-hidden="true">
        {shape === 'cloud' && <>
            <path d="M8 61C-1 46 15 37 25 44C19 26 42 20 49 34C60 16 83 30 77 46C95 34 105 56 90 63M15 72C29 62 35 80 51 70S78 77 90 67" />
            <path className="recovery-secondary" d="M18 53C30 46 38 59 48 52S70 54 82 49M30 37Q37 30 42 39" />
        </>}
        {shape === 'lotus' && <>
            {[-2, -1, 0, 1, 2].map((i, index) => <path key={i} className="recovery-petal" style={indexStyle(index)} d="M50 81C21 69 31 39 50 15C69 39 79 69 50 81Z" transform={`rotate(${i * 28} 50 81)`} />)}
            <path className="recovery-secondary" d="M15 82Q50 96 85 82M25 90Q50 98 75 90" />
        </>}
        {shape === 'harp' && <>
            <path d="M23 84L29 15Q55 2 81 23L61 83ZM29 15Q50 32 81 23M23 84Q41 95 61 83" />
            {[0, 1, 2, 3, 4].map(i => <path key={i} className="recovery-string" style={indexStyle(i)} d={`M${36 + i * 8} ${24 + i}L${32 + i * 6} 80`} />)}
        </>}
        {shape === 'note' && <>
            <path d="M35 68V25L70 16V59M35 37L70 28" />
            <ellipse cx="27" cy="70" rx="11" ry="7" className="recovery-solid" transform="rotate(-20 27 70)" />
            <ellipse cx="62" cy="61" rx="11" ry="7" className="recovery-solid" transform="rotate(-20 62 61)" />
        </>}
        {shape === 'plume' && <>
            <path d="M17 85C18 51 43 8 83 13C92 41 54 79 17 85ZM17 85L73 24M32 69L30 49M46 52L46 30M45 55L68 51M29 73L49 71" />
        </>}
        {shape === 'shell' && <>
            <path d="M49 85C19 73 3 48 15 27C26 7 44 13 49 23C59 6 79 11 89 31C101 54 78 77 49 85ZM49 85L28 23M49 85V24M49 85L72 22M49 85L15 39M49 85L87 41" />
        </>}
        {shape === 'gate' && <>
            <path d="M21 87V33Q50 -5 79 33V87M30 85V35Q50 7 70 35V85M12 89H88" />
            <path className="recovery-secondary" d="M38 25L50 14L62 25M15 65H26M74 65H85M15 47H26M74 47H85" />
        </>}
        {shape === 'bone' && <>
            <path d="M16 78Q4 80 10 68Q3 60 16 57L40 36L61 13Q57 2 69 8Q79 2 79 16L58 39L35 61Q39 75 27 69Q27 82 16 78ZM74 82Q82 88 86 80Q95 81 91 72L70 54M45 29L29 12Q30 2 20 7Q9 2 12 14Q4 20 13 25L27 40" />
        </>}
        {shape === 'lantern' && <>
            <path d="M50 3V17M33 20H67L78 37L74 72H26L22 37ZM33 20L38 37V70M67 20L62 37V70M22 37H78M26 72L33 82H67L74 72M50 82V95" />
            <path className="recovery-secondary" d="M50 63C32 53 49 43 48 33C66 48 66 58 50 63Z" />
        </>}
        {shape === 'time' && <>
            <path d="M18 30A38 38 0 1 1 13 58M18 30L6 33L11 18M50 27V50L67 60" />
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <path key={i} d="M50 12V19" transform={`rotate(${i * 45} 50 50)`} />)}
        </>}
        {shape === 'sun' && <>
            <circle cx="50" cy="50" r="22" />
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <path key={i} d="M50 7V18M46 10L50 5L54 10" transform={`rotate(${i * 45} 50 50)`} />)}
        </>}
    </svg>;
}

function Dust({ petals = false }: { petals?: boolean }) {
    return <span className={`recovery-dust${petals ? ' recovery-dust-petals' : ''}`}>
        {[0, 1, 2, 3, 4, 5].map(i => <i key={i} style={indexStyle(i)} />)}
    </span>;
}

function PearlCluster({ returning = false }: { returning?: boolean }) {
    return <span className={`recovery-pearls${returning ? ' is-returning' : ''}`}>
        {[0, 1, 2].map(i => <i key={i} style={indexStyle(i)} className={i % 2 ? 'is-white' : 'is-ink'}><b /></i>)}
        <svg viewBox="0 0 100 100" aria-hidden="true"><path d="M12 63C5 27 42 6 71 22S98 73 65 87" /></svg>
    </span>;
}

function Score() {
    return <svg className="recovery-score" viewBox="0 0 160 100" aria-hidden="true">
        {[0, 1, 2, 3, 4].map(i => <path key={i} style={indexStyle(i)} d={`M-10 ${30 + i * 7}C45 ${6 + i * 7} 100 ${66 + i * 7} 170 ${31 + i * 7}`} />)}
    </svg>;
}

function Rebirth({ theme }: { theme: RecoveryFxTheme }) {
    const shape = theme === 'time-gate' ? 'gate' : theme === 'bone-soul' ? 'bone' : theme === 'lantern' ? 'lantern' : 'sun';
    return <>
        <span className="recovery-rebirth-frame"><Motif shape={shape} /></span>
        <svg className="recovery-rise-lines" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M19 85C-2 55 22 34 27 6M81 85C102 55 78 34 73 6" />
            <path className="recovery-secondary" d="M30 90C12 66 36 43 37 15M70 90C88 66 64 43 63 15" />
        </svg>
        <i className="recovery-floor" /><Dust />
        {theme === 'auspice-rebirth' && <span className="recovery-clouds"><Motif shape="cloud" /><Motif shape="cloud" /></span>}
        {theme === 'bone-soul' && <span className="recovery-soul-flames">{[0, 1, 2].map(i => <i key={i} style={indexStyle(i)} />)}</span>}
    </>;
}

export function RecoveryCasterFx({ event }: { event: SkillFxEvent }) {
    const theme = event.profile.recovery;
    if (!theme) return null;
    const sameCell = event.fromPos[0] === event.targetPos[0] && event.fromPos[1] === event.targetPos[1];
    // 凝珠和自动回补只在受益者出主效，避免同格播放两组珠子。
    if ((sameCell && theme !== 'sonata' && theme !== 'chorus') || ['pearls', 'pearl-return', 'tide'].includes(theme) || event.skillId?.endsWith('_regen') || event.skillId === 'pipa_heal') return <span className={`fx-anchor recovery-fx recovery-${theme}`}><i className="recovery-source-glint" /></span>;
    const shape = theme === 'auspice' || theme === 'auspice-rebirth' ? 'cloud'
        : theme === 'lotus' ? 'lotus' : theme === 'sonata' || theme === 'chorus' ? 'harp'
            : theme === 'purify' ? 'plume' : theme === 'time-gate' || theme === 'time-seam' ? 'time'
                : theme === 'bone-soul' ? 'bone' : theme === 'lantern' ? 'lantern' : 'sun';
    return <span className={`fx-anchor recovery-fx recovery-${theme}`}>
        <span className="recovery-source"><Motif shape={shape} /></span>
        {['auspice', 'purify', 'sun-thread'].includes(theme) && <span className="recovery-stream">
            <svg viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true"><path d="M0 15Q50 -1 100 15T200 15" /><path className="recovery-secondary" d="M0 18Q50 5 100 18T200 18" /></svg><i />
        </span>}
        {(theme === 'chorus' || theme === 'sonata') && <Score />}
    </span>;
}

export function RecoveryTargetFx({ event }: { event: SkillFxEvent }) {
    const theme = event.profile.recovery;
    if (!theme) return null;
    return <span className={`fx-anchor recovery-fx recovery-${theme}`}>
        {theme === 'auspice' && <><span className="recovery-clouds"><Motif shape="cloud" /><Motif shape="cloud" /></span><i className="recovery-floor" /><span className="recovery-dew">{[0, 1, 2, 3].map(i => <i key={i} style={indexStyle(i)} />)}</span></>}
        {theme === 'lotus' && <><span className="recovery-lotus"><Motif shape="lotus" /></span><i className="recovery-floor" /><Dust petals /></>}
        {(theme === 'sonata' || theme === 'chorus') && <><Score /><span className="recovery-notes">{[0, 1, 2].map(i => <span key={i} style={indexStyle(i)}><Motif shape="note" /></span>)}</span><Dust /></>}
        {theme === 'purify' && <><span className="recovery-purify-plumes">{[0, 1, 2].map(i => <span key={i} style={indexStyle(i)}><Motif shape="plume" /></span>)}</span><svg className="recovery-wash" viewBox="0 0 100 100" aria-hidden="true"><path d="M13 83C76 82 90 35 69 15M24 91C92 86 100 30 77 7" /></svg><Dust petals /></>}
        {(theme === 'pearls' || theme === 'pearl-return') && <><PearlCluster returning={theme === 'pearl-return'} /><i className="recovery-floor" /></>}
        {theme === 'tide' && <><span className="recovery-shell"><Motif shape="shell" /></span><svg className="recovery-tide-lines" viewBox="0 0 130 100" aria-hidden="true"><path d="M-5 75C18 36 37 91 63 66S111 30 137 66M-5 86C25 55 43 99 70 79S115 53 137 76" /><path className="recovery-secondary" d="M9 60C28 36 42 68 66 48S108 36 120 48" /></svg><Dust /></>}
        {theme === 'time-seam' && <><span className="recovery-time-dial"><Motif shape="time" /></span><span className="recovery-time-shards">{[0, 1, 2, 3].map(i => <i key={i} style={indexStyle(i)} />)}</span></>}
        {theme === 'sun-thread' && <><span className="recovery-sun"><Motif shape="sun" /></span><i className="recovery-floor" /><Dust /></>}
        {['auspice-rebirth', 'time-gate', 'bone-soul', 'lantern'].includes(theme) && <Rebirth theme={theme} />}
    </span>;
}
