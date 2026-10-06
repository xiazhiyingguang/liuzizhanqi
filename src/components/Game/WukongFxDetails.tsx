import { useId, type CSSProperties } from 'react';

/** 云气有实面、暗部和金边；不用 SVG 滤镜，群体合击时也保持轻量。 */
export function WukongCloudFx({ front = false }: { front?: boolean }) {
    const id = `wk-cloud-${useId().replace(/:/g, '')}`;
    return (
        <svg className={`wk-cloud ${front ? 'wk-cloud-front' : 'wk-cloud-back'}`} viewBox="0 0 160 140" aria-hidden="true">
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0.7" y2="1">
                    <stop stopColor="#fff5da" stopOpacity="0.88" />
                    <stop offset="0.45" stopColor="#dad0b8" stopOpacity="0.62" />
                    <stop offset="1" stopColor="#6f6554" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d="M77 104C48 106 21 96 20 74C18 56 34 50 46 61C29 53 27 70 38 76C50 84 62 78 60 63C59 48 42 46 35 33C28 20 35 8 45 8C30 18 44 27 54 35C72 48 68 65 83 76C98 85 118 78 120 63C122 51 109 45 101 51C116 34 143 45 141 67C139 92 111 107 77 104Z" fill={`url(#${id})`} />
            <path d="M25 72C24 57 35 51 44 58M47 31C70 47 63 65 80 78C101 93 128 78 127 60" fill="none" stroke="#fff0c6" strokeWidth="1.2" opacity="0.65" strokeLinecap="round" />
            <path d="M20 100C40 84 52 118 77 111C98 106 99 91 126 99C137 102 145 100 151 94C145 109 128 115 113 111C96 107 86 128 65 124C46 121 41 103 20 100Z" fill={`url(#${id})`} opacity="0.7" />
        </svg>
    );
}

/** 金色剪影保留“烟中凝形”，冠翎、肩甲、披帛和持棒姿态让轮廓可识别。 */
export function WukongFigureGlyph() {
    const id = `wk-figure-${useId().replace(/:/g, '')}`;
    return (
        <svg viewBox="0 0 80 110" aria-hidden="true">
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="1" y2="0.8">
                    <stop stopColor="#76501c" stopOpacity="0.8" />
                    <stop offset="0.35" stopColor="#fff2b6" />
                    <stop offset="0.62" stopColor="#d4a64b" />
                    <stop offset="1" stopColor="#946027" stopOpacity="0.2" />
                </linearGradient>
            </defs>
            <g fill={`url(#${id})`} stroke="#ffe9a3" strokeWidth="0.6" strokeLinejoin="round">
                <path d="M33 32L31 23L36 25L40 19L45 25L51 23L49 34Q52 44 46 49L48 52L56 51L63 59L61 66L50 63L49 77L54 94L62 100L62 104L48 103L40 84L34 99L21 103L19 99L27 92L29 76L27 64L19 69L14 65L20 56L31 51L34 47Q28 41 33 32Z" />
                <path d="M27 69Q12 66 7 51Q14 62 25 60L30 57L32 70Z" opacity="0.75" />
                <path d="M47 72Q64 71 73 57Q70 76 52 80Z" opacity="0.65" />
                <path d="M60 30L64 30L59 105L55 105Z" />
            </g>
            <path d="M36 25C30 9 16 17 17 3M44 25C49 5 65 17 65 3" fill="none" stroke="#e6bd69" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M33 55L41 59L49 55M32 63L40 68L48 63M30 75L47 75M34 35Q40 31 46 35" fill="none" stroke="#fff8d8" strokeWidth="1.1" opacity="0.85" />
        </svg>
    );
}

/** 分叉地裂有暗缝和细金边，地面透视与棒体方向解耦。 */
export function WukongGroundFx() {
    return (
        <svg className="wk-ground" viewBox="0 0 180 90" aria-hidden="true">
            <g className="wk-ground-cracks" fill="#735329" opacity="0.65">
                <path d="M90 44L68 38L51 24L42 27L24 15L43 23L53 20L70 35Z M90 44L116 33L129 36L151 20L135 38L119 38Z M90 44L117 51L128 65L151 68L126 69L114 55Z M90 44L68 57L58 54L38 73L55 50L67 52Z M90 44L88 22L96 13L92 25L94 40Z M90 44L91 65L102 78L87 67L86 48Z" />
            </g>
            <g className="wk-ground-edges" fill="none" stroke="#ffdd87" strokeWidth="0.9" strokeLinecap="round">
                <path pathLength="100" d="M90 44L69 36L52 22L43 25L24 15M90 44L118 35L132 37L151 20M90 44L115 53L127 67L151 68M90 44L67 55L56 52L38 73M90 44L90 24L96 13M90 44L89 66L102 78" />
            </g>
        </svg>
    );
}

export function WukongStaffWakeFx() {
    return (
        <i className="wk-staff-wake">
            <svg viewBox="0 0 100 200" aria-hidden="true">
                <path d="M51 181C-5 123 12 39 57 12C30 52 26 104 51 181Z" fill="#dbb266" opacity="0.14" />
                <path d="M51 181C7 111 24 53 53 18M44 174C-2 103 18 41 40 23" fill="none" stroke="#ffe2a3" strokeWidth="1.1" opacity="0.65" />
                <path d="M53 181C21 116 35 62 58 28" fill="none" stroke="#fff8de" strokeWidth="2" opacity="0.6" />
            </svg>
        </i>
    );
}

export function WukongDebrisFx() {
    return <>{Array.from({ length: 6 }, (_, i) => {
        const a = (i * 60 + 18) * Math.PI / 180;
        return <i key={i} className="wk-debris" style={{
            '--wk-x': Math.cos(a) * 0.55,
            '--wk-y': Math.sin(a) * 0.2,
            '--wk-step': `${i * 12}ms`,
            '--wk-spin': `${i % 2 ? 190 : -150}deg`,
        } as CSSProperties} />;
    })}</>;
}
