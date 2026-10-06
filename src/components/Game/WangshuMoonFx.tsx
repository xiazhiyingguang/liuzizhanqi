import { useId, type CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import '../../styles/wangshu-skill-fx.css';

type MoonVariant = 'caster' | 'target' | 'impact' | 'area' | 'splash' | 'chain';
const STARS = [[16, 32, 0], [82, 19, 70], [22, 80, 130], [78, 70, 180]] as const;

/** A matte lunar surface, fine silverwork and a different contact gesture for each skill. */
export function WangshuMoonFx({ event, variant }: { event: SkillFxEvent; variant: MoonVariant }) {
    const id = useId().replace(/:/g, '');
    const theme = event.profile.moon;
    if (!theme || !['caster', 'target'].includes(variant) || (theme === 'full' && variant === 'caster')) return null;
    const source = variant === 'caster';
    const surface = `moon-surface-${id}`, eclipse = `moon-eclipse-${id}`, disc = `moon-disc-${id}`;
    const silver = `moon-silver-${id}`, veil = `moon-veil-${id}`;

    return <span className={`fx-anchor wangshu-moon-fx is-${theme} ${source ? 'is-source' : 'is-contact'}`}>
        {source && <span className="wangshu-moon-thread"><svg viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id={`moon-thread-${id}`}>
                <stop stopColor="var(--fx-c1)" stopOpacity="0" /><stop offset=".45" stopColor="#a9c7cc" />
                <stop offset=".85" stopColor="#faf1d4" /><stop offset="1" stopColor="#ffffff" />
            </linearGradient></defs>
            <path className="wangshu-thread-shadow" d="M0 20C55 -8 135 48 200 20" />
            <path className="wangshu-thread-core" d="M0 20C55 -8 135 48 200 20" stroke={`url(#moon-thread-${id})`} />
            <path className="wangshu-thread-companion" d="M0 20C60 43 145 -3 200 20" />
            <path className="wangshu-thread-bead" d="M0 20C55 -8 135 48 200 20" />
        </svg></span>}
        <svg className="wangshu-moon-disc" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
                <radialGradient id={surface} cx="32%" cy="26%" r="88%">
                    <stop stopColor="#fff5dc" /><stop offset=".48" stopColor="#e7e8de" />
                    <stop offset=".82" stopColor="#b3c6c8" /><stop offset="1" stopColor="#718d9e" />
                </radialGradient>
                <linearGradient id={silver} x1="0" y1="0" x2="1" y2="1">
                    <stop stopColor="#657e94" /><stop offset=".3" stopColor="#e2e9df" />
                    <stop offset=".58" stopColor="#f8e5b9" /><stop offset="1" stopColor="#789fa8" />
                </linearGradient>
                <filter id={`moon-grain-${id}`} x="0" y="0" width="100%" height="100%">
                    <feTurbulence type="fractalNoise" baseFrequency=".14" numOctaves="2" seed="17" />
                    <feColorMatrix type="saturate" values="0" />
                    <feComponentTransfer><feFuncA type="linear" slope=".12" /></feComponentTransfer>
                </filter>
                <clipPath id={disc}><circle cx="50" cy="50" r="29" /></clipPath>
                <mask id={eclipse}>
                    <rect width="100" height="100" fill="white" />
                    {theme !== 'full' && <circle className="wangshu-moon-shadow" cx={theme === 'heal' ? 29 : 64} cy="44" r="28" fill="black" />}
                </mask>
            </defs>
            <circle className="wangshu-moon-dark" cx="50" cy="50" r="29.5" fill="#354c61" />
            <g mask={`url(#${eclipse})`} clipPath={`url(#${disc})`}>
                <circle cx="50" cy="50" r="29" fill={`url(#${surface})`} />
                <path d="M28 41C24 34 31 30 36 33C40 25 49 32 45 39C53 43 48 50 42 47C35 55 28 48 28 41Z M39 61C40 57 47 58 49 63C51 70 43 74 40 68Z M59 40C64 35 69 42 65 47C60 50 56 45 59 40Z" fill="#6b8996" opacity=".17" />
                <rect className="wangshu-moon-grain" width="100" height="100" filter={`url(#moon-grain-${id})`} />
                <g stroke="#8095a0" strokeWidth=".4" fill="#d1d9d2" opacity=".35">
                    <circle cx="55" cy="33" r="1.6" /><circle cx="34" cy="62" r="1.8" />
                    <circle cx="65" cy="57" r="1.2" />
                </g>
            </g>
            <circle cx="50" cy="50" r="29.5" stroke={`url(#${silver})`} strokeWidth=".85" fill="none" />
            <path d="M24 44A27 27 0 0 1 46 23" fill="none" stroke="#fff4d4" strokeWidth="1.5" opacity=".85" />
            <g className="wangshu-moon-orbit" fill="none" stroke={`url(#${silver})`} strokeWidth=".85">
                <path d="M7 50A43 43 0 0 1 50 7M93 50A43 43 0 0 1 50 93" />
                <ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(-36 50 50)" strokeWidth=".65" />
                <path d="M13 31L18 33M70 13L68 18M87 68L82 66M32 87L34 82" stroke="#8ca4ad" />
            </g>
            <g className="wangshu-moon-settings" fill="#e7d1a2" stroke="#8c8e82" strokeWidth=".4">
                <path d="M50 1L52 7L50 12L48 7ZM99 50L93 52L88 50L93 48Z" />
                <circle cx="14" cy="76" r="1.4" /><circle cx="77" cy="14" r="1.2" />
                <path d="M44 88Q50 98 56 88M47 93L50 99L53 93" fill="none" strokeWidth=".75" />
            </g>
        </svg>
        {!source && <>
            <svg className="wangshu-moon-ground" viewBox="0 0 100 40" aria-hidden="true" fill="none">
                <ellipse cx="50" cy="20" rx="43" ry="13" stroke="var(--fx-c1)" strokeWidth=".8" />
                <path d="M7 20A43 13 0 0 1 71 9M93 20A43 13 0 0 1 29 31" stroke="#e6d1a5" strokeWidth="1.2" />
                <ellipse cx="50" cy="20" rx="33" ry="9" stroke="#889fa8" strokeWidth=".55" strokeDasharray="12 4 1 4" />
                <path d="M50 3V9M50 31V37M2 20H11M89 20H98" stroke="var(--fx-c1)" strokeWidth=".7" />
            </svg>

            {theme === 'drain' ? <svg className="wangshu-lunar-cut" viewBox="0 0 120 120" aria-hidden="true">
                <defs><linearGradient id={`moon-cut-${id}`} x1="0" y1="1" x2="1" y2="0">
                    <stop stopColor="#57798d" stopOpacity="0" /><stop offset=".4" stopColor="#dce9e8" />
                    <stop offset=".72" stopColor="#fff3d5" /><stop offset="1" stopColor="#769baa" stopOpacity=".1" />
                </linearGradient></defs>
                <path className="wangshu-cut-shadow" d="M15 100C12 55 58 6 103 23C64 25 33 53 15 100Z" fill="#354d69" opacity=".28" />
                <path d="M16 96C16 51 60 7 103 23C65 27 35 54 16 96Z" fill={`url(#moon-cut-${id})`} />
                <path d="M18 93C23 50 66 12 101 24" stroke="#f9edce" strokeWidth="1.4" fill="none" />
                <path d="M102 37C101 68 79 98 46 101" stroke="#789bae" strokeWidth="1.4" fill="none" />
            </svg> : <svg className="wangshu-moon-veil" viewBox="0 0 100 100" aria-hidden="true" fill="none">
                <defs><linearGradient id={veil} x1="0" y1="1" x2="0" y2="0">
                    <stop stopColor="#708f9b" stopOpacity="0" /><stop offset=".3" stopColor="#93b7bb" />
                    <stop offset=".72" stopColor="#e8eee0" /><stop offset="1" stopColor="#e0c78e" stopOpacity="0" />
                </linearGradient></defs>
                <path d="M24 92C1 68 17 33 35 25M76 92C99 68 83 33 65 25" stroke={`url(#${veil})`} strokeWidth="2.8" />
                <path d="M21 87C7 65 20 40 36 34M79 87C93 65 80 40 64 34" stroke="#b5c8c6" strokeWidth=".75" />
                <path d="M33 89Q16 73 23 58M67 89Q84 73 77 58" stroke="#e5d2ab" strokeWidth="1" />
            </svg>}

            <svg className="wangshu-moon-traces" viewBox="0 0 100 100" fill="none" stroke="var(--fx-c2)" strokeWidth=".8" aria-hidden="true">
                {theme === 'drain' ? <><path d="M9 35Q45 1 83 26M90 70Q61 96 23 82" /><path d="M15 53L29 45M68 73L85 79" stroke="var(--fx-c1)" /></>
                    : <><path d="M13 82Q9 34 36 19M87 82Q91 34 64 19" /><path d="M30 90Q20 58 43 40M70 90Q80 58 57 40" stroke="#b1c9ca" /></>}
            </svg>

            {theme === 'full' && <svg className="wangshu-phase-crown" viewBox="0 0 160 80" aria-hidden="true" fill="none">
                <path d="M18 51Q80 -6 142 51M28 55Q80 12 132 55" stroke="#b9c5bb" strokeWidth=".7" />
                <path d="M23 33A12 12 0 1 0 31 55A11 11 0 0 1 23 33Z" fill="#e7e4d0" stroke="#8a9eab" strokeWidth=".7" />
                <circle cx="135" cy="45" r="12" fill="#41556c" stroke="#d9d4bd" strokeWidth=".7" />
                <path d="M135 33A12 12 0 0 1 135 57Z" fill="#e7e4d0" />
                <path d="M80 2L82 8L80 13L78 8ZM55 13L57 16L55 20L53 16ZM105 13L107 16L105 20L103 16Z" fill="#e6d1a2" stroke="#879a9c" strokeWidth=".4" />
            </svg>}
        </>}

        <span className="wangshu-moon-stars" aria-hidden="true">
            {STARS.slice(0, source ? 2 : 4).map(([x, y, delay], index) => <i key={index} className="wangshu-moon-star" style={{
                '--moon-star-x': `${x}%`, '--moon-star-y': `${y}%`, '--moon-star-delay': `${delay}ms`,
            } as CSSProperties} />)}
        </span>
    </span>;
}
