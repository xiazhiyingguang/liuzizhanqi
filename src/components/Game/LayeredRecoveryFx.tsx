import { useId, type CSSProperties } from 'react';
import type { SkillFxEvent, SkillFxProfile } from '../../core/skill-fx';
import '../../styles/layered-recovery-fx.css';

function themeOf(profile: SkillFxProfile) {
    if (profile.kind === 'rewind-state') return 'time-restore';
    return profile.recovery;
}

function layerStyle(index: number): CSSProperties {
    return { '--rfx-i': index, '--rfx-angle': `${index * 60}deg` } as CSSProperties;
}

/** 每个受益格独立材质 ID，群体治疗时渐变和光斑不会串到另一格。 */
function Paint({ id }: { id: string }) {
    return <defs>
        <linearGradient id={`${id}-petal`} x1="0" y1="0" x2=".7" y2="1">
            <stop offset="0" stopColor="#fffdf0" /><stop offset=".25" stopColor="var(--fx-c2)" />
            <stop offset=".68" stopColor="var(--fx-c1)" stopOpacity=".8" /><stop offset="1" stopColor="var(--fx-c1)" stopOpacity=".05" />
        </linearGradient>
        <linearGradient id={`${id}-silk`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".35" stopColor="var(--fx-c2)" stopOpacity=".95" />
            <stop offset=".6" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="var(--fx-c1)" stopOpacity=".3" />
        </linearGradient>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f0fffc" stopOpacity=".9" /><stop offset=".3" stopColor="var(--fx-c2)" stopOpacity=".85" />
            <stop offset=".65" stopColor="var(--fx-c1)" stopOpacity=".65" /><stop offset="1" stopColor="var(--fx-c1)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--fx-c1)" stopOpacity="0" /><stop offset=".25" stopColor="var(--fx-c1)" />
            <stop offset=".5" stopColor="#fff" /><stop offset=".65" stopColor="var(--fx-c2)" /><stop offset="1" stopColor="var(--fx-c1)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
            <stop offset="0" stopColor="var(--fx-c2)" stopOpacity=".75" /><stop offset=".45" stopColor="var(--fx-c1)" stopOpacity=".2" /><stop offset="1" stopColor="var(--fx-c1)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-ink`} cx=".32" cy=".25" r=".8">
            <stop offset="0" stopColor="#d7d8e5" /><stop offset=".18" stopColor="#777b91" /><stop offset=".48" stopColor="#303544" /><stop offset="1" stopColor="#0b1424" />
        </radialGradient>
        <radialGradient id={`${id}-pearl`} cx=".32" cy=".25" r=".8">
            <stop offset="0" stopColor="#fff" /><stop offset=".3" stopColor="#fffdf6" /><stop offset=".65" stopColor="#d6dcd7" /><stop offset="1" stopColor="#788b97" />
        </radialGradient>
    </defs>;
}

function Motes({ snow = false }: { snow?: boolean }) {
    return <span className={`rfx-motes${snow ? ' rfx-snow' : ''}`}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <i key={i} style={layerStyle(i)} />)}
    </span>;
}

function Lotus({ id }: { id: string }) {
    const petals = [
        'M80 101C28 93 9 65 11 44C42 42 69 65 80 101Z',
        'M80 101C132 93 151 65 149 44C118 42 91 65 80 101Z',
        'M80 101C39 77 32 43 44 19C68 34 82 60 80 101Z',
        'M80 101C121 77 128 43 116 19C92 34 78 60 80 101Z',
        'M80 101C56 72 60 31 80 7C100 31 104 72 80 101Z',
        'M80 105C47 110 18 88 15 72C47 65 68 78 80 105Z',
        'M80 105C113 110 142 88 145 72C113 65 92 78 80 105Z',
    ];
    return <><i className="rfx-lotus-haze" />
        <svg className="rfx-art rfx-lotus" viewBox="0 0 160 140" aria-hidden="true">
            <Paint id={id} />
            <ellipse className="rfx-pool" cx="80" cy="111" rx="74" ry="19" fill={`url(#${id}-glow)`} />
            {petals.map((d, i) => <g key={d} className="rfx-lotus-petal" style={layerStyle(i)}>
                <path d={d} fill={`url(#${id}-petal)`} />
                <path d={d} fill="none" stroke={`url(#${id}-edge)`} strokeWidth=".9" />
            </g>)}
            <path className="rfx-lotus-vein" d="M80 98Q64 57 80 20M78 100Q52 70 46 34M82 100Q108 70 114 34" fill="none" stroke="#fff6d9" strokeWidth=".7" />
            <ellipse className="rfx-water-ring" cx="80" cy="113" rx="63" ry="9" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1.1" />
        </svg><Motes />
    </>;
}

function Purify({ id }: { id: string }) {
    return <><i className="rfx-purify-haze" />
        <svg className="rfx-art rfx-purify" viewBox="0 0 160 160" aria-hidden="true">
            <Paint id={id} />
            <g className="rfx-silk-back"><path d="M137 116C97 156 12 116 28 65C18 114 105 115 137 82C156 64 139 21 116 15C155 26 166 86 137 116Z" fill={`url(#${id}-silk)`} /><path d="M28 65C18 114 105 115 137 82" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1" /></g>
            <g className="rfx-silk-front"><path d="M5 104C25 127 89 129 119 107C161 76 139 23 115 17C158 63 134 98 97 104C51 113 28 86 5 104Z" fill={`url(#${id}-silk)`} /><path d="M5 104C42 120 106 120 131 90" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1.3" /></g>
            {[0, 1, 2, 3].map(i => <g key={i} transform={`rotate(${i * 85 + 15} 80 80)`}><path className="rfx-white-flake" style={layerStyle(i)} d="M80 47C73 40 73 28 81 18C87 30 89 41 80 47Z" fill={`url(#${id}-silk)`} /></g>)}
        </svg><Motes snow />
    </>;
}

function Pearls({ id, returning }: { id: string; returning: boolean }) {
    return <><i className="rfx-pearl-haze" />
        <svg className={`rfx-art rfx-pearls${returning ? ' is-returning' : ''}`} viewBox="0 0 160 160" aria-hidden="true">
            <Paint id={id} />
            <g className="rfx-pearl-current"><path d="M17 101C-6 58 53 14 106 28C149 39 153 87 126 115C153 74 129 42 99 39C55 29 15 61 17 101Z" fill={`url(#${id}-silk)`} /><path d="M21 117C59 143 120 137 146 95C121 147 50 161 21 117Z" fill={`url(#${id}-silk)`} /></g>
            {[0, 1, 2].map(i => {
                const angle = (i * 120 - 10) * Math.PI / 180;
                const x = Math.sin(angle) * 47;
                const y = -Math.cos(angle) * 47;
                return <g key={i} transform={`translate(${80 + x} ${80 + y})`}>
                    <g className={`rfx-pearl-body ${i % 2 ? 'is-white' : 'is-ink'}`} style={{ ...layerStyle(i), '--rfx-absorb-x': `${-x}px`, '--rfx-absorb-y': `${-y}px` } as CSSProperties}>
                        <ellipse cx="0" cy="9" rx="12" ry="4" fill="#20333e" opacity=".16" />
                        <circle cx="0" cy="0" r="12" fill={`url(#${id}-${i % 2 ? 'pearl' : 'ink'})`} />
                        <ellipse cx="-4" cy="-5" rx="3.6" ry="2.2" fill="#fff" opacity={i % 2 ? .8 : .65} transform="rotate(-25 -4 -5)" />
                        <path d="M-6 7Q2 14 9 2" fill="none" stroke="#e3f4ef" strokeWidth=".8" opacity=".6" />
                    </g>
                </g>;
            })}
        </svg><Motes snow />
    </>;
}

function Tide({ id }: { id: string }) {
    return <><i className="rfx-tide-haze" />
        <svg className="rfx-art rfx-tide" viewBox="0 0 180 160" aria-hidden="true">
            <Paint id={id} />
            <ellipse className="rfx-pool" cx="90" cy="114" rx="82" ry="27" fill={`url(#${id}-glow)`} />
            <g className="rfx-wave-back"><path d="M1 86C20 22 53 27 79 61C112 104 153 77 164 33C189 81 151 111 104 95C62 81 31 54 1 86Z" fill={`url(#${id}-water)`} /><path d="M1 86C20 22 53 27 79 61C112 104 153 77 164 33" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1.5" /></g>
            <g className="rfx-wave-front"><path d="M2 114C34 78 70 114 101 96C127 80 144 61 174 91C146 83 133 119 98 130C60 142 30 113 2 114Z" fill={`url(#${id}-water)`} /><path d="M2 114C34 78 70 114 101 96C127 80 144 61 174 91" fill="none" stroke="#eafff9" strokeOpacity=".9" strokeWidth="1.3" /></g>
            <ellipse className="rfx-water-ring" cx="90" cy="117" rx="70" ry="13" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1" />
            {[0, 1, 2, 3, 4].map(i => <path key={i} className="rfx-spray" style={layerStyle(i)} d="M35 88Q31 76 36 69Q42 80 35 88Z" fill={`url(#${id}-water)`} transform={`translate(${i * 26} ${i % 2 * -18})`} />)}
        </svg><Motes />
    </>;
}

function TimeLens({ id, revive }: { id: string; revive: boolean }) {
    return <><i className="rfx-time-haze" />
        <svg className={`rfx-art rfx-time${revive ? ' is-revive' : ''}`} viewBox="0 0 160 180" aria-hidden="true">
            <Paint id={id} />
            <ellipse className="rfx-time-plane" cx="80" cy="86" rx="51" ry="71" fill={`url(#${id}-glow)`} />
            <g className="rfx-time-rim"><path d="M80 10C10 10 1 158 80 160C13 144 28 23 80 10ZM80 10C150 10 159 158 80 160C147 144 132 23 80 10Z" fill={`url(#${id}-edge)`} /><ellipse cx="80" cy="85" rx="48" ry="69" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1" /></g>
            <g className="rfx-time-orbit"><ellipse cx="80" cy="88" rx="65" ry="31" transform="rotate(-48 80 88)" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1.3" /><path d="M25 113C46 140 91 149 127 122C145 104 144 77 134 61C146 103 110 125 74 125C54 125 39 120 25 113Z" fill={`url(#${id}-silk)`} /></g>
            {[0, 1, 2].map(i => <g key={i} className="rfx-time-fragment" style={layerStyle(i)}><path d="M34 43L47 35L51 61L38 70Z" fill={`url(#${id}-silk)`} /><path d="M110 113L126 106L132 124L117 135Z" fill={`url(#${id}-silk)`} /></g>)}
            <ellipse className="rfx-time-floor" cx="80" cy="156" rx="60" ry="10" fill={`url(#${id}-glow)`} />
        </svg><Motes />
    </>;
}

export function LayeredRecoveryCasterFx({ event }: { event: SkillFxEvent }) {
    const id = `rfx-source-${useId().replace(/:/g, '')}`;
    const theme = themeOf(event.profile);
    return <span className={`fx-anchor recovery-fx rfx rfx-${theme}`}>
        <i className="rfx-source-breath" />
        {theme === 'purify' && <svg className="rfx-transfer" viewBox="0 0 200 32" preserveAspectRatio="none" aria-hidden="true">
            <Paint id={id} /><path d="M0 18Q50 -6 100 15T200 15Q150 38 100 22T0 18Z" fill={`url(#${id}-silk)`} /><path d="M0 18Q50 -6 100 15T200 15" fill="none" stroke={`url(#${id}-edge)`} strokeWidth=".8" />
        </svg>}
    </span>;
}

export function LayeredRecoveryTargetFx({ event }: { event: SkillFxEvent }) {
    const id = `rfx-${useId().replace(/:/g, '')}`;
    const theme = themeOf(event.profile);
    return <span className={`fx-anchor recovery-fx rfx rfx-${theme}`}>
        {theme === 'lotus' && <Lotus id={id} />}
        {theme === 'purify' && <Purify id={id} />}
        {(theme === 'pearls' || theme === 'pearl-return') && <Pearls id={id} returning={theme === 'pearl-return'} />}
        {theme === 'tide' && <Tide id={id} />}
        {(theme === 'time-gate' || theme === 'time-restore') && <TimeLens id={id} revive={theme === 'time-gate'} />}
    </span>;
}
