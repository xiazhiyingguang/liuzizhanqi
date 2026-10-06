import { useId, type CSSProperties } from 'react';
import '../../styles/wangcai-awaken-fx.css';

function FortuneCoin({ main = false }: { main?: boolean }) {
    const id = useId().replace(/:/g, '');
    const contour = 'M50 10A40 40 0 1 1 50 90A40 40 0 1 1 50 10ZM39 39V61H61V39Z';
    return <svg className="wc-awaken-coin" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
            <linearGradient id={`${id}-gold`} x1="0" y1="1" x2=".8" y2="0"><stop stopColor="#73501c" /><stop offset=".3" stopColor="#d3a347" /><stop offset=".48" stopColor="#fff0be" /><stop offset=".61" stopColor="#d4a34b" /><stop offset="1" stopColor="#8c6225" /></linearGradient>
            <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffedb2" /><stop offset=".45" stopColor="#c69840" /><stop offset="1" stopColor="#67421e" /></linearGradient>
            <clipPath id={`${id}-clip`}><path d={contour} clipRule="evenodd" /></clipPath>
        </defs>
        <path d={contour} fill={`url(#${id}-gold)`} fillRule="evenodd" stroke="#79551f" strokeWidth="1.6" />
        <circle cx="50" cy="50" r="36.5" stroke={`url(#${id}-edge)`} strokeWidth="2.4" fill="none" />
        <circle cx="50" cy="50" r="30.5" stroke="#8a642c" strokeWidth=".8" fill="none" />
        <path d="M38 38H62V62H38Z" fill="none" stroke="#fff0b0" strokeWidth="1.2" />
        <path d="M50 20V30M50 70V80M20 50H30M70 50H80M32 30L36 34M64 66L68 70M68 30L64 34M36 66L32 70" fill="none" stroke="#91692d" strokeWidth="2" />
        <path d="M50 19V28M19 50H28M33 28L37 32" fill="none" stroke="#ffefb8" strokeWidth="1" />
        {main && <g clipPath={`url(#${id}-clip)`}><path className="wc-awaken-glint" d="M-15 0H-4L46 100H35Z" fill="#fff9dc" opacity=".72" /></g>}
    </svg>;
}

const COIN_ORIGINS = [[-.53, .18], [-.36, -.26], [-.1, -.52], [.3, -.4], [.54, .02], [.34, .46], [-.2, .5]];

/** 只在真实通灵事件的目标格播放：聚财 → 升印 → 显示通灵名 → 收光。 */
export function WangcaiAwakenFx() {
    return <span className="fx-anchor wc-awaken" data-wangcai-awaken>
        <i className="wc-awaken-ground" />
        <i className="wc-awaken-rise" />
        {COIN_ORIGINS.map(([x, y], index) => <i key={index} className="wc-awaken-gather" style={{ '--wc-x': x, '--wc-y': y, '--wc-delay': `${index * 30}ms` } as CSSProperties}><FortuneCoin /></i>)}
        <span className="wc-awaken-seal"><FortuneCoin main /></span>
        <svg className="wc-awaken-cloud" viewBox="0 0 120 32" aria-hidden="true"><path d="M3 24C11 13 20 17 20 23C20 29 10 28 12 23C19 17 28 23 36 21M117 24C109 13 100 17 100 23C100 29 110 28 108 23C101 17 92 23 84 21M29 28Q60 13 91 28" fill="none" stroke="#cda254" strokeWidth="1.1" strokeLinecap="round" /><path d="M30 25Q60 7 90 25" fill="none" stroke="#f4df9e" strokeWidth=".7" /></svg>
        <span className="wc-awaken-title">财神通灵</span>
        <i className="wc-awaken-ember wc-awaken-ember-a" /><i className="wc-awaken-ember wc-awaken-ember-b" /><i className="wc-awaken-ember wc-awaken-ember-c" />
    </span>;
}
