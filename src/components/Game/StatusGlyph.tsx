/**
 * 状态字形（StatusGlyph）：信息卡里代表一条状态的几何小图标。
 *
 * 这里只放笔画；配色在 core/hero-status-icons 的 GLYPH_TONES，状态名文字与图标共用同一个颜色，
 * 玩家扫一眼颜色就能分辨"这是冰、这是火、这是控制"，不必逐条读名字。
 * 本文件只导出组件，多导一个函数会让 react-refresh 放弃这个文件的热更新边界。
 */
import type { ReactNode } from 'react';
import { statusGlyphTone, type StatusGlyphId } from '../../core/hero-status-icons';

const SHAPES: Record<StatusGlyphId, ReactNode> = {
    ice: <>
        <path d="M12 2.5l8 4.6v9.8l-8 4.6-8-4.6V7.1z" />
        <path d="M12 7v10M8 9.2l8 5.6M16 9.2l-8 5.6" />
    </>,
    frost: <path d="M4 7l3.2 3.2L10.4 7M13.6 7l3.2 3.2L20 7M8.4 15.2L12 18.8l3.6-3.6" />,
    stun: <>
        <path d="M12.4 12.4a2.4 2.4 0 1 1-2.4-2.4 5.2 5.2 0 1 1 5.2 5.2" />
        <path d="M4.6 4.6l1.6 1.6M19.4 4.6l-1.6 1.6" />
    </>,
    lock: <>
        <path d="M8.4 11V8.2a3.6 3.6 0 0 1 7.2 0V11" />
        <rect x="5.6" y="11" width="12.8" height="9" rx="2" />
    </>,
    veil: <>
        <path d="M15.6 3.4a9 9 0 1 0 5 15.2 7.2 7.2 0 0 1-5-15.2z" />
        <path d="M3.6 20.8h5.2" />
    </>,
    sight: <>
        <circle cx="12" cy="12" r="6" />
        <path d="M12 2.6v4M12 17.4v4M2.6 12h4M17.4 12h4" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>,
    eye: <>
        <path d="M2.6 12S6.4 6.4 12 6.4 21.4 12 21.4 12 17.6 17.6 12 17.6 2.6 12 2.6 12z" />
        <circle cx="12" cy="12" r="2.4" />
    </>,
    bolt: <path d="M13.4 2.4L5.6 13.6h4.6l-.8 8 8.6-11.4h-5z" />,
    fear: <>
        <path d="M5 5.6h14v5.8c0 4.4-3.1 7.6-7 8.6-3.9-1-7-4.2-7-8.6z" />
        <path d="M9 10.6v1.6M15 10.6v1.6" />
    </>,
    wither: <>
        <path d="M12 3v8" />
        <path d="M12 11c-3 0-5-2-5-5M12 11c3 0 5-2 5-5" />
        <path d="M8 16l4 4 4-4" />
    </>,
    flame: <>
        <path d="M12 21.6c3.8 0 6.2-2.6 6.2-6 0-5-5.6-6.2-5.6-11.6C9.8 7.6 5.8 9.6 5.8 15.2c0 3.6 2.4 6.4 6.2 6.4z" />
        <path d="M12 21.6c-1.6-1.8-2.4-3.4-2.4-5 0-1.8 1.4-3 2.4-4.4 1 1.4 2.4 2.6 2.4 4.4 0 1.6-.8 3.2-2.4 5z" />
    </>,
    drop: <path d="M12 3.2s6.2 6.8 6.2 10.8a6.2 6.2 0 0 1-12.4 0C5.8 10 12 3.2 12 3.2z" />,
    wind: <>
        <path d="M3 8.4h10.6a2.8 2.8 0 1 0-2.8-2.8" />
        <path d="M3 13.6h14a2.8 2.8 0 1 1-2.8 2.8" />
        <path d="M3 19h6.4" />
    </>,
    shield: <path d="M12 2.6l8 2.8v6.4c0 5-3.6 8.2-8 9.8-4.4-1.6-8-4.8-8-9.8V5.4z" />,
    blade: <>
        <path d="M20.8 3.2L10.4 13.6l-2 5.2 5.2-2z" />
        <path d="M3.2 20.8l4.4-4.4" />
    </>,
    notch: <path d="M4.6 19.4L19.4 4.6M8.6 20.6L20.6 8.6M3.4 15.4L15.4 3.4" />,
    chime: <>
        <path d="M9.4 17.6V5.8l10-2.2v11.8" />
        <circle cx="6.6" cy="17.8" r="2.8" />
        <circle cx="16.6" cy="15.6" r="2.8" />
    </>,
    fang: <>
        <path d="M4.4 5.6h15.2" />
        <path d="M7.6 5.6l2.6 8.4 2.6-8.4M14.6 5.6l2 6.2 2-6.2" />
    </>,
    atom: <>
        <ellipse cx="12" cy="12" rx="9.6" ry="4.2" />
        <ellipse cx="12" cy="12" rx="9.6" ry="4.2" transform="rotate(60 12 12)" />
        <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </>,
    coin: <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.6 8.6h6.8v6.8H8.6z" />
    </>,
    cup: <>
        <path d="M6 4.6h12l-1.2 8.2a4.8 4.8 0 0 1-9.6 0z" />
        <path d="M12 17.6v3.6M8.4 21.2h7.2" />
    </>,
    moon: <path d="M19.4 14.6A8.6 8.6 0 1 1 10.2 4.4a6.8 6.8 0 0 0 9.2 10.2z" />,
    sun: <>
        <circle cx="12" cy="12" r="4.8" />
        <path d="M12 2.4v2.8M12 18.8v2.8M2.4 12h2.8M18.8 12h2.8M5.2 5.2l2 2M16.8 16.8l2 2M18.8 5.2l-2 2M7.2 16.8l-2 2" />
    </>,
    taiji: <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18 4.5 4.5 0 0 1 0-9 4.5 4.5 0 0 0 0-9z" fill="currentColor" stroke="none" />
    </>,
    brush: <>
        <path d="M14.2 3.4l6.4 6.4-7.6 3-1.8-1.8z" />
        <path d="M11.2 11c-3 1.2-4 4-4 7.4 3.4 0 6.2-1 7.4-4" />
    </>,
    tide: <>
        <path d="M2.6 9.4c3-3.6 6-3.6 9 0s6 3.6 9 0" />
        <path d="M2.6 16.4c3-3.6 6-3.6 9 0s6 3.6 9 0" />
    </>,
    kite: <>
        <path d="M12 2.6l7.4 7.4L12 21.4 4.6 10z" />
        <path d="M12 2.6v18.8M4.6 10h14.8" />
    </>,
    prism: <>
        <path d="M12 3l9 16.4H3z" />
        <path d="M12 3v16.4" />
    </>,
    seal: <>
        <rect x="4" y="4" width="16" height="16" rx="2.4" />
        <path d="M8.4 9.2h7.2M12 9.2v6.6" />
    </>,
    surge: <path d="M12 3.2l7.2 8.2h-4v6.2H8.8v-6.2h-4z" />,
    decline: <path d="M12 20.8l-7.2-8.2h4V6.4h6.4v6.2h4z" />,
    spark: <path d="M12 2.6l2.4 7 7 2.4-7 2.4-2.4 7-2.4-7-7-2.4 7-2.4z" />,
    bloom: <>
        <path d="M12 21.4V10.6" />
        <path d="M12 10.6c0-3.8 2.6-5.8 6.2-5.8 0 3.8-2.6 5.8-6.2 5.8z" />
        <path d="M12 15.4c0-3-2-4.6-4.8-4.6C7.2 13.8 9.2 15.4 12 15.4z" />
    </>,
    bone: <>
        <path d="M12 3a7.6 7.6 0 0 1 7.6 7.6c0 2.8-1.4 4.6-2.8 5.8v2.4a1.6 1.6 0 0 1-1.6 1.6H8.8a1.6 1.6 0 0 1-1.6-1.6v-2.4C5.8 15.2 4.4 13.4 4.4 10.6A7.6 7.6 0 0 1 12 3z" />
        <circle cx="9.2" cy="11" r="1.8" />
        <circle cx="14.8" cy="11" r="1.8" />
    </>,
    hourglass: <>
        <path d="M6 3.4h12M6 20.6h12" />
        <path d="M7.2 3.4c0 6 4.8 6 4.8 8.6s-4.8 2.6-4.8 8.6M16.8 3.4c0 6-4.8 6-4.8 8.6s4.8 2.6 4.8 8.6" />
    </>,
    claw: <path d="M5.4 3.6c1.4 6.6 3.4 10.6 5.6 16.8M12 3.6c.2 6.6 1 10.6 2 16.8M18.6 3.6c-1.4 6.6-3.4 10.6-5.6 16.8" />,
    mirror: <>
        <circle cx="12" cy="12" r="8.8" />
        <path d="M6.6 6.4l5 5.2-3 6M17.6 7l-4.2 6.8 3.2 5" />
    </>,
    flower: <>
        <circle cx="12" cy="12" r="2.4" />
        <path d="M12 3.6a3.4 3.4 0 0 1 0 5.4 3.4 3.4 0 0 1 0-5.4zM20.4 12a3.4 3.4 0 0 1-5.4 0 3.4 3.4 0 0 1 5.4 0zM12 20.4a3.4 3.4 0 0 1 0-5.4 3.4 3.4 0 0 1 0 5.4zM3.6 12a3.4 3.4 0 0 1 5.4 0 3.4 3.4 0 0 1-5.4 0z" />
    </>,
    mark: <>
        <circle cx="12" cy="12" r="8.4" />
        <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>,
};

interface StatusGlyphProps {
    id: StatusGlyphId;
    /** 边长（px），默认 16；状态行用 18，计数器与属性标签用 12~13 */
    size?: number;
    className?: string;
}

/** 一枚状态字形：纯装饰，读屏由外层文字承担，所以整颗 aria-hidden */
export default function StatusGlyph({ id, size = 16, className = '' }: StatusGlyphProps) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            aria-hidden="true"
            className={`flex-shrink-0 ${className}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: statusGlyphTone(id) }}
        >
            {SHAPES[id]}
        </svg>
    );
}
