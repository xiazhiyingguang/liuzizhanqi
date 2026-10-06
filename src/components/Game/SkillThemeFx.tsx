import type { CSSProperties, ReactNode } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import { computeFxAngleDeg, hasLayeredRecoveryFx } from '../../core/skill-fx';
import '../../styles/skill-fx-themes.css';
import { RecoveryCasterFx, RecoveryTargetFx } from './RecoverySkillFx';
import { LayeredRecoveryCasterFx, LayeredRecoveryTargetFx } from './LayeredRecoveryFx';

/** 主题图形使用实体轮廓；配色、路径、时序仍来自真实施法事件。 */
function Glyph({ shape, className = '' }: { shape: string; className?: string }) {
    return <svg className={`fx-theme-glyph ${className}`} viewBox="0 0 100 100" aria-hidden="true">
        {shape === 'coin' && <>
            <circle cx="50" cy="50" r="38" fill="var(--fx-c2)" stroke="currentColor" strokeWidth="6" />
            <circle cx="50" cy="50" r="29" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M39 39H61V61H39Z" fill="var(--fx-c1)" stroke="#fff3cd" strokeWidth="2" />
            <path d="M27 30L34 35M66 35L73 30M27 70L34 65M66 65L73 70" stroke="currentColor" strokeWidth="4" />
        </>}
        {shape === 'taiji' && <>
            <circle cx="50" cy="50" r="36" fill="var(--fx-c2)" stroke="currentColor" strokeWidth="3" />
            <path d="M50 14A36 36 0 0 1 50 86A18 18 0 0 1 50 50A18 18 0 0 0 50 14Z" fill="currentColor" />
            <circle cx="50" cy="32" r="5" fill="currentColor" /><circle cx="50" cy="68" r="5" fill="var(--fx-c2)" />
        </>}
        {shape === 'bird' && <>
            <circle cx="50" cy="42" r="32" fill="var(--fx-c2)" opacity=".35" />
            <path d="M49 45C39 24 19 15 6 21L30 39L12 36L36 53L22 51L44 63L47 80L40 89L50 84L59 91L56 79L60 64L82 51L68 52L91 34L73 39L95 18C74 21 63 27 54 45L56 35L64 31L56 28L49 31Z" fill="currentColor" stroke="var(--fx-c2)" strokeWidth="1.5" />
            <path d="M32 27L45 48M69 28L56 50M49 60L52 74" stroke="var(--fx-c2)" strokeWidth="3" />
        </>}
        {shape === 'turtle' && <>
            <path d="M32 28L22 18L15 24L23 38M68 28L78 18L86 25L78 39M30 70L20 83L28 89L40 78M70 70L80 84L71 90L60 78" fill="currentColor" />
            <ellipse cx="50" cy="19" rx="10" ry="13" fill="var(--fx-c2)" stroke="currentColor" strokeWidth="3" />
            <ellipse cx="50" cy="53" rx="31" ry="35" fill="var(--fx-c2)" stroke="currentColor" strokeWidth="5" />
            <path d="M50 25L68 39L68 60L50 77L32 60L32 39ZM32 39L22 34M68 39L79 34M32 60L21 66M68 60L80 66M50 25V18M50 77V87" fill="none" stroke="currentColor" strokeWidth="3" />
        </>}
        {shape === 'brush' && <>
            <path d="M47 7H56L53 66H44Z" fill="#8f6840" stroke="#372d31" strokeWidth="2" />
            <path d="M44 57H54L60 72L49 95L39 74Z" fill="currentColor" />
            <path d="M48 66L49 86L44 76" fill="none" stroke="var(--fx-c2)" strokeWidth="2" />
            <path d="M46 8L53 8M45 57L54 57" stroke="var(--fx-c2)" strokeWidth="3" />
        </>}
        {shape === 'sword' && <>
            <path d="M50 5L52.5 18L55 60H45L47.5 18Z" fill="var(--fx-c2)" stroke="currentColor" strokeWidth="2" />
            <path d="M50 14V55" stroke="#fff" strokeWidth="1.5" opacity=".5" />
            <path d="M36 60H64L59 67H41Z" fill="currentColor" stroke="var(--fx-c2)" strokeWidth="1.5" />
            <path d="M46 67H54L52.5 86H47.5Z" fill="#8f6840" stroke="#372d31" strokeWidth="2" />
            <path d="M47.2 73H52.8M47.6 79H52.4" stroke="#372d31" strokeWidth="1.5" />
            <circle cx="50" cy="91" r="4.5" fill="var(--fx-c2)" stroke="currentColor" strokeWidth="2" />
        </>}
        {shape === 'bone' && <>
            <path d="M17 81L24 70L19 63L27 60L35 66L72 22L85 11L80 31L43 74L49 81L42 88L36 81L25 90Z" fill="var(--fx-c2)" stroke="currentColor" strokeWidth="3" />
            <path d="M33 72L74 25M48 54L54 55M60 39L66 40" stroke="currentColor" strokeWidth="2" />
        </>}
        {shape === 'flower' && <>
            {Array.from({ length: 6 }, (_, i) => <path key={i} d="M50 50C23 41 33 12 50 17C67 12 77 41 50 50Z" fill="var(--fx-c2)" fillOpacity=".55" stroke="currentColor" strokeWidth="2" transform={`rotate(${i * 60} 50 50)`} />)}
            <circle cx="50" cy="50" r="6" fill="currentColor" />
        </>}
        {shape === 'rune' && <>
            <path d="M32 12H69L66 85L49 94L29 84Z" fill="var(--fx-c2)" fillOpacity=".55" stroke="currentColor" strokeWidth="3" />
            <path d="M40 25H60M50 21V34L40 42H60L50 52L61 62H39L50 71V83M35 75L41 78M59 78L65 75" fill="none" stroke="currentColor" strokeWidth="3" />
        </>}
    </svg>;
}

function Chips({ count = 6, shape = 'ink' }: { count?: number; shape?: string }) {
    return <>{Array.from({ length: count }, (_, i) => <i key={i} className={`fx-theme-chip fx-theme-chip-${shape}`} style={{ '--chip-angle': `${i * 360 / count}deg`, '--chip-step': i % 3 } as CSSProperties} />)}</>;
}

function Connector({ vine = false, reverse = false }: { vine?: boolean; reverse?: boolean }) {
    return <span className={`fx-theme-connector${reverse ? ' is-reverse' : ''}`}>
        <svg viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true">
            <path className="fx-theme-link-path" d={vine ? 'M0 15C30 -2 55 33 80 15S130 -2 155 15S180 30 200 15' : 'M0 15Q50 2 100 15T200 15'} />
            {vine && <path className="fx-theme-link-twigs" d="M37 12L43 2L51 4M78 16L86 27L95 24M132 11L141 2L150 6M173 20L182 28L190 24" />}
        </svg>
        <i className="fx-theme-link-bead" /><i className="fx-theme-link-bead fx-theme-link-bead-b" />
    </span>;
}

function InkPath({ event }: { event: SkillFxEvent }) {
    const cells = event.coveredPositions?.length ? event.coveredPositions : [event.targetPos];
    return <>{cells.map((cell, index) => {
        const previous = index ? cells[index - 1] : event.fromPos;
        const distance = Math.hypot(cell[0] - previous[0], cell[1] - previous[1]);
        if (!distance) return null;
        return <i key={`${index}-${cell.join('-')}`} className="fx-theme-ink-segment" style={{
            left: `calc(50% + ${previous[1] - event.fromPos[1]} * (var(--board-cell-size) + 6px))`,
            top: `calc(50% + ${previous[0] - event.fromPos[0]} * (var(--board-cell-size) + 6px))`,
            width: `calc(${distance} * (var(--board-cell-size) + 6px))`,
            '--segment-angle': `${computeFxAngleDeg(previous, cell)}deg`, '--segment-delay': `${index * 70 + 60}ms`,
        } as CSSProperties}><b /></i>;
    })}</>;
}

export function SkillThemeCasterFx({ event }: { event: SkillFxEvent }) {
    if (hasLayeredRecoveryFx(event.profile)) return <LayeredRecoveryCasterFx event={event} />;
    if (event.profile.recovery) return <RecoveryCasterFx event={event} />;
    const kind = event.profile.kind;
    if (kind === 'feixue-bond' || kind === 'yang-link' || kind === 'yin-link') return <span className="fx-anchor fx-theme">
        <span className="fx-theme-emblem fx-theme-source"><Glyph shape={kind === 'feixue-bond' ? 'flower' : 'taiji'} /></span>
        <Connector vine={kind === 'feixue-bond'} reverse={kind === 'yin-link'} />
    </span>;
    if (kind === 'ink-brush' || kind === 'starfire-lance') return <span className="fx-anchor fx-theme">
        <span className={`fx-theme-projectile fx-theme-projectile-${kind}`}>
            {kind === 'ink-brush' ? <Glyph shape="brush" /> : <i className="fx-theme-star-lance" />}
        </span><i className="fx-theme-gather" />
    </span>;
    if (kind === 'ink-dash') return <span className="fx-anchor fx-theme"><InkPath event={event} /><Glyph shape="brush" className="fx-theme-dash-brush" /></span>;
    if (kind === 'chord-aura' || kind === 'chord-break') return <span className={`fx-anchor fx-theme fx-theme-${kind}`}>
        <span className="fx-theme-strings">{Array.from({ length: 5 }, (_, i) => <i key={i} style={{ '--string-index': i } as CSSProperties} />)}</span>
    </span>;
    if (kind === 'nightowl-strike') return <span className="fx-anchor fx-theme"><i className="fx-theme-shadow-flight" /><Chips shape="feather" /></span>;
    if (kind === 'scroll-jinwu' || kind === 'scroll-xuangui') return <span className="fx-anchor fx-theme"><i className="fx-theme-scroll-source" /></span>;
    if (kind === 'coin-strike' || kind === 'coin-blessing' || kind === 'coin-awaken') return <span className="fx-anchor fx-theme"><span className="fx-theme-coin-source"><Glyph shape="coin" /></span></span>;
    if (kind === 'ink-cut' || kind === 'bone-slash' || kind === 'spirit-rune' || kind === 'decay-field' || kind === 'decay-bloom') {
        const shape = kind === 'ink-cut' ? 'sword' : kind === 'bone-slash' ? 'bone' : kind === 'spirit-rune' ? 'rune' : 'flower';
        // 墨断：剑锋沿真实攻击轴指向目标格，挥砍动画在这条轴上起落，而不是立剑戳向脚下
        const aim = kind === 'ink-cut' ? { transform: `rotate(${event.angleDeg + 90}deg)` } : undefined;
        return <span className="fx-anchor fx-theme">
            <span className="fx-theme-aim" style={aim}><span className="fx-theme-emblem fx-theme-source"><Glyph shape={shape} /></span></span>
        </span>;
    }
    if (['nightowl-eye', 'wind-line', 'wind-pressure', 'rewind-state', 'sand-field'].includes(kind)) {
        return <span className="fx-anchor fx-theme"><i className="fx-theme-gather" /><Chips shape={kind === 'sand-field' ? 'sand' : kind === 'nightowl-eye' ? 'feather' : 'rune'} /></span>;
    }
    return null;
}

export function SkillThemeTargetFx({ event }: { event: SkillFxEvent }) {
    // 黑白凝珠是凝聚/环绕珠阵，不使用通用治疗的落珠层；回补动画仍走 pearl-return。
    if (event.profile.kind === 'xubai-pearls') return null;
    if (hasLayeredRecoveryFx(event.profile)) return <LayeredRecoveryTargetFx event={event} />;
    if (event.profile.recovery) return <RecoveryTargetFx event={event} />;
    const kind = event.profile.kind;
    const wrap = (children: ReactNode) => <span className={`fx-anchor fx-theme fx-theme-${kind}${event.empowered ? ' is-empowered' : ''}`}>{children}</span>;
    if (kind === 'feixue-bond' || kind === 'yang-link' || kind === 'yin-link') return wrap(<>
        <span className="fx-theme-emblem"><Glyph shape={kind === 'feixue-bond' ? 'flower' : 'taiji'} /></span><Chips shape={kind === 'feixue-bond' ? 'ice' : 'rune'} />
    </>);
    if (kind === 'ink-brush' || kind === 'ink-dash' || kind === 'ink-cut') return wrap(<>
        {kind === 'ink-brush' && <Glyph shape="brush" className="fx-theme-brush-land" />}
        <i className="fx-theme-ink-main" /><i className="fx-theme-ink-dry" /><i className="fx-theme-ink-spread" /><Chips />
    </>);
    if (kind === 'coin-strike' || kind === 'coin-blessing' || kind === 'coin-awaken') return wrap(<>
        <span className="fx-theme-coin-main"><Glyph shape="coin" /></span>
        <span className="fx-theme-coin-orbit">{Array.from({ length: event.empowered ? 8 : 5 }, (_, i) => <span key={i} style={{ '--coin-angle': `${i * 360 / (event.empowered ? 8 : 5)}deg` } as CSSProperties}><Glyph shape="coin" /></span>)}</span>
        {kind === 'coin-awaken' && <span className="fx-theme-crown"><i /><i /><i /></span>}
        <i className="fx-theme-seal-impact" />
    </>);
    if (kind === 'scroll-jinwu' || kind === 'scroll-xuangui') return wrap(<>
        <span className="fx-theme-scroll"><i className="fx-theme-scroll-roller fx-theme-scroll-left" /><i className="fx-theme-scroll-paper" /><i className="fx-theme-scroll-roller fx-theme-scroll-right" /></span>
        <span className="fx-theme-beast"><Glyph shape={kind === 'scroll-jinwu' ? 'bird' : 'turtle'} /></span><Chips shape="rune" />
    </>);
    if (kind === 'chord-aura' || kind === 'chord-break') return wrap(<>
        <span className="fx-theme-score">{Array.from({ length: 5 }, (_, i) => <i key={i} style={{ '--string-index': i } as CSSProperties} />)}</span>
        <svg className="fx-theme-note" viewBox="0 0 60 80" aria-hidden="true"><path d="M24 57V15L49 7V49M24 26L49 18" fill="none" stroke="currentColor" strokeWidth="5" /><ellipse cx="16" cy="60" rx="10" ry="7" fill="currentColor" /><ellipse cx="41" cy="52" rx="10" ry="7" fill="currentColor" /></svg>
        {kind === 'chord-break' && <><i className="fx-theme-sound-cut" /><i className="fx-theme-sound-cut fx-theme-sound-cut-b" /></>}
    </>);
    if (kind === 'nightowl-eye' || kind === 'nightowl-strike') return wrap(<>
        <svg className="fx-theme-eye" viewBox="0 0 100 100" aria-hidden="true"><path d="M8 50Q50 8 92 50Q50 92 8 50Z" fill="var(--fx-c1)" fillOpacity=".18" stroke="currentColor" strokeWidth="3" /><path d="M50 26Q66 50 50 74Q34 50 50 26Z" fill="var(--fx-c2)" /><path d="M50 31V69M7 22L22 32M93 22L78 32M7 78L22 68M93 78L78 68" stroke="currentColor" strokeWidth="3" /></svg>
        {kind === 'nightowl-strike' && <><i className="fx-theme-shadow-cut" /><i className="fx-theme-shadow-cut fx-theme-shadow-cut-b" /><Chips shape="feather" /></>}
    </>);
    if (kind === 'bone-slash') return wrap(<><Glyph shape="bone" className="fx-theme-bone" /><i className="fx-theme-bone-cut" /><Chips shape="bone" /></>);
    if (kind === 'decay-field' || kind === 'decay-bloom' || kind === 'sand-field') return wrap(<>
        <svg className="fx-theme-roots" viewBox="0 0 100 100" aria-hidden="true"><path d={kind === 'sand-field' ? 'M3 76Q22 31 47 61T98 37M5 88Q33 50 57 78T100 56M0 55Q15 28 30 44' : 'M50 94L48 53L30 36L16 11M48 53L68 36L85 7M31 37L8 42M66 38L91 46M49 70L22 59L5 65M50 78L77 64L94 68'} fill="none" stroke="currentColor" strokeWidth={kind === 'sand-field' ? 5 : 3} strokeLinecap="round" /></svg>
        {kind === 'decay-bloom' && <Glyph shape="flower" className="fx-theme-wither-flower" />}<Chips shape={kind === 'sand-field' ? 'sand' : 'leaf'} />
    </>);
    if (kind === 'wind-line' || kind === 'wind-pressure') return wrap(<>
        <span className="fx-theme-wind-sheet"><svg viewBox="0 0 150 100" preserveAspectRatio="none" aria-hidden="true"><path d="M1 15C48 -2 80 30 143 12M0 38C55 14 92 65 149 37M0 65C61 37 92 90 148 65M8 87C72 66 100 100 143 88" fill="none" stroke="currentColor" strokeWidth="4" /><path d="M106 10L140 13L123 24M111 36L148 38L127 53M111 65L147 65L130 77" fill="none" stroke="var(--fx-c2)" strokeWidth="3" /></svg></span><Chips shape="feather" />
    </>);
    if (kind === 'starfire-lance') return wrap(<><i className="fx-theme-star-impact" /><Chips shape="ember" /></>);
    if (kind === 'spirit-rune') return wrap(<>
        <span className="fx-theme-runes">{[0, 1, 2].map(i => <Glyph key={i} shape="rune" className={`fx-theme-rune-${i}`} />)}</span><Chips shape="rune" />
    </>);
    if (kind === 'rewind-state') return wrap(<>
        <svg className="fx-theme-clock" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 5" />{Array.from({ length: 12 }, (_, i) => <path key={i} d="M50 10V19" transform={`rotate(${i * 30} 50 50)`} stroke="currentColor" strokeWidth={i % 3 ? 2 : 4} />)}<path className="fx-theme-clock-hand" d="M50 50L50 24M50 50L68 60" fill="none" stroke="var(--fx-c2)" strokeWidth="4" /><path d="M24 30L11 32L16 18M14 31A40 40 0 0 1 86 31" fill="none" stroke="currentColor" strokeWidth="3" /></svg><i className="fx-theme-rewind-echo" /><i className="fx-theme-rewind-echo fx-theme-rewind-echo-b" />
    </>);
    return null;
}
