import { useId, type CSSProperties } from 'react';
import type { Position, SkillFxEvent } from '../../core/skill-fx';
import { LINGXI_TIDE_TIMING, lingxiTideAngle, lingxiTideHitMs } from '../../core/lingxi-tide-fx';
import '../../styles/lingxi-tide-fx.css';

const FAN_LEAF = 'M18 50 L56 -6 A68 68 0 0 1 56 106 Z';
const FAN_TIPS = Array.from({ length: 9 }, (_, i) => {
    const angle = (-56 + i * 14) * Math.PI / 180;
    return `${(18 + 68 * Math.cos(angle)).toFixed(2)} ${(50 + 68 * Math.sin(angle)).toFixed(2)}`;
});
const CREST = 'M0 -132 C14 -119 -6 -104 5 -92 C18 -77 -7 -60 1 -46 C12 -26 -11 -14 4 0 C16 18 -8 35 1 48 C12 67 -11 81 4 94 C16 111 -5 125 0 132';
const BODY = `${CREST} C-19 117 -31 96 -22 74 C-32 51 -16 28 -25 4 C-15 -20 -31 -44 -22 -67 C-29 -94 -12 -119 0 -132 Z`;

/** A paper fan at the caster pushes one shared pair of crests through the 2×3 lane. */
export function LingxiTideCastFx({ event }: { event: SkillFxEvent }) {
    const id = `lt-${useId().replace(/:/g, '')}`;
    const timing = LINGXI_TIDE_TIMING;
    return <span className="lx-tide-source" style={{
        '--lt-angle': `${lingxiTideAngle(event)}deg`, '--lt-launch': `${timing.launchMs}ms`,
        '--lt-travel': `${timing.travelMs}ms`, '--lt-gap': `${timing.secondWaveMs}ms`,
    } as CSSProperties}>
        <span className="lx-tide-aim">
            <span className="lx-tide-fan">
                <svg viewBox="0 -12 100 124" aria-hidden="true">
                    <defs>
                        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2=".7">
                            <stop stopColor="#ddd7bb" />
                            <stop offset=".4" stopColor="#f5f0df" />
                            <stop offset="1" stopColor="#d8e7df" />
                        </linearGradient>
                        <clipPath id={`${id}-leaf`}><path d={FAN_LEAF} /></clipPath>
                    </defs>
                    <path d={FAN_LEAF} fill={`url(#${id}-paper)`} stroke="#659090" strokeWidth=".85" />
                    <g clipPath={`url(#${id}-leaf)`}>
                        {FAN_TIPS.slice(0, -1).map((tip, i) => i % 2 === 0 && <path key={i}
                            d={`M18 50 L${tip} L${FAN_TIPS[i + 1]} Z`} fill="#7f9991" opacity=".12" />)}
                        <g className="lx-tide-fan-paint">
                            <path d="M42 8 Q67 15 58 32 T73 57 T59 91 M53 4 Q78 16 68 31 T85 57 T72 99" />
                            <path d="M70 13 Q79 17 75 23 M72 69 Q85 72 79 81" />
                        </g>
                    </g>
                    <g fill="none" stroke="#85958c" strokeWidth=".65" opacity=".65">
                        {FAN_TIPS.map((tip, i) => <path key={i} d={`M18 50 L${tip}`} />)}
                    </g>
                    <path d="M8 50 H28" stroke="#8c7b59" strokeWidth="2.4" strokeLinecap="round" />
                    <circle cx="18" cy="50" r="2.2" fill="#baa77b" />
                </svg>
            </span>
            <svg className="lx-tide-lane" viewBox="0 -150 280 300" aria-hidden="true">
                <defs>
                    <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="0">
                        <stop stopColor="#83b6b3" stopOpacity="0" />
                        <stop offset=".6" stopColor="#6caaa9" stopOpacity=".2" />
                        <stop offset="1" stopColor="#407e8b" stopOpacity=".42" />
                    </linearGradient>
                    <linearGradient id={`${id}-crest`} x1="0" y1="0" x2="0" y2="1">
                        <stop stopColor="#65999e" stopOpacity="0" />
                        <stop offset=".18" stopColor="#4f8e97" stopOpacity=".7" />
                        <stop offset=".75" stopColor="#4c8c98" stopOpacity=".75" />
                        <stop offset="1" stopColor="#80afad" stopOpacity="0" />
                    </linearGradient>
                </defs>
                {[0, 1].map(i => <g key={i} className="lx-tide-front" style={{ '--lt-wave-index': i } as CSSProperties}>
                    <path d={BODY} fill={`url(#${id}-body)`} />
                    <path className="lx-tide-wake" d="M-25 -119 C-38 -82 -21 -55 -33 -19 S-21 40 -31 76 Q-34 100 -21 118 M-41 -97 Q-54 -72 -43 -52 M-43 35 Q-51 57 -41 86" />
                    <path className="lx-tide-crest" d={CREST} stroke={`url(#${id}-crest)`} />
                    <path className="lx-tide-foam" d={CREST} pathLength="100" />
                    <path className="lx-tide-lace" d="M-3 -106 Q13 -95 0 -87 M2 -58 Q15 -47 2 -42 M3 -14 Q17 1 3 10 M2 45 Q14 56 0 63 M3 97 Q14 106 2 116" />
                </g>)}
            </svg>
        </span>
    </span>;
}

/** Foam breaks locally when the shared crest arrives; no additional glowing circles. */
export function LingxiTideImpactFx({ event, atPos }: { event: SkillFxEvent; atPos?: Position }) {
    return <span className="lx-tide-impact" style={{
        '--lt-angle': `${lingxiTideAngle(event)}deg`, '--lt-hit': `${lingxiTideHitMs(event, atPos ?? event.targetPos)}ms`,
    } as CSSProperties}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
            <g className="lx-tide-splash">
                <path className="lx-tide-splash-wash" d="M36 20 Q60 28 58 44 Q72 61 41 83 Q55 61 44 51 Q54 38 36 20 Z" />
                <path className="lx-tide-splash-ink" d="M34 21 Q58 32 47 44 Q66 60 38 80 M54 19 Q74 29 66 42 M61 60 Q79 72 65 82" />
                <path className="lx-tide-splash-foam" d="M34 20 Q52 30 48 39 M49 47 Q60 61 41 77 M54 19 Q68 24 65 32 M63 64 Q73 72 66 77" />
                <path className="lx-tide-splash-drops" d="M68 15 Q80 16 75 23 Q74 18 68 15 Z M77 45 Q88 39 85 49 Q82 46 77 45 Z M76 80 Q86 87 80 90 Q81 84 76 80 Z" />
            </g>
        </svg>
    </span>;
}
