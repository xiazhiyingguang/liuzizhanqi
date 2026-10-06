import { useId } from 'react';
import '../../styles/yunying-skill-fx.css';

/** 枪刃、杆身与红缨用不同材质；两招复用同一柄枪。 */
export function YunyingSpearGlyph() {
    const id = useId().replace(/:/g, '');
    return <svg className="fx-yys-spear-svg yy-spear-material" viewBox="0 0 36 240" aria-hidden="true">
        <defs>
            <linearGradient id={`${id}-steel`}><stop stopColor="#567182" /><stop offset=".38" stopColor="#d8e8ed" /><stop offset=".5" stopColor="#fffaf0" /><stop offset=".66" stopColor="#809aa6" /><stop offset="1" stopColor="#324454" /></linearGradient>
            <linearGradient id={`${id}-shaft`}><stop stopColor="#2b2020" /><stop offset=".4" stopColor="#885332" /><stop offset=".55" stopColor="#c39861" /><stop offset="1" stopColor="#352827" /></linearGradient>
            <linearGradient id={`${id}-gold`}><stop stopColor="#6d4127" /><stop offset=".46" stopColor="#ffe5a3" /><stop offset=".6" stopColor="#c79244" /><stop offset="1" stopColor="#805228" /></linearGradient>
        </defs>
        <path d="M15.2 46 L20.8 46 L20 226 L16 226 Z" fill={`url(#${id}-shaft)`} />
        <path d="M17 52 L17 219" stroke="#edd8a3" strokeWidth=".55" opacity=".7" />
        <path d="M14.3 222 L21.7 222 L21 235 L18 239 L15 235 Z" fill={`url(#${id}-gold)`} />
        <path className="yy-tassel" d="M18 34 C5 42 20 48 8 65 C17 62 19 53 18 46 C27 54 22 62 28 67 C28 50 32 44 18 34 Z" fill="#b52e22" />
        <path className="yy-tassel" d="M17 38 C10 47 21 53 13 61 M20 39 C25 48 24 52 27 59" stroke="#ff9954" strokeWidth="1.1" fill="none" />
        <path d="M18 1 L25 26 L21.4 40 L18 45 L14.6 40 L11 26 Z" fill={`url(#${id}-steel)`} stroke="#d4dee1" strokeWidth=".55" />
        <path d="M18 2 L18 39 M18 6 L22 25" stroke="#fff9e8" strokeWidth=".8" fill="none" />
        <path d="M12.5 38 L23.5 38 L22.5 47 L13.5 47 Z" fill={`url(#${id}-gold)`} />
        <path d="M14 41 L22 41 M14 44 L22 44" stroke="#fff0c5" strokeWidth=".6" />
    </svg>;
}

/** 不规则的焰舌以一条亮芯收拢，尖端渐细，保留枪尖的位置。 */
export function YunyingFlameGlyph() {
    const id = useId().replace(/:/g, '');
    return <svg className="yy-flame-glyph" viewBox="0 0 60 100" aria-hidden="true">
        <defs><linearGradient id={`${id}-fire`} x1="0" y1="1" x2=".3" y2="0" gradientUnits="objectBoundingBox"><stop stopColor="#ffdf93" /><stop offset=".28" stopColor="#ffb54d" /><stop offset=".64" stopColor="#f35b27" stopOpacity=".85" /><stop offset="1" stopColor="#a9241b" stopOpacity="0" /></linearGradient></defs>
        <path className="yy-flame-outer" d="M31 95 C3 83 17 61 9 41 C27 59 11 29 30 3 C22 31 50 39 43 60 C51 47 57 43 53 30 C70 73 48 89 31 95 Z" fill={`url(#${id}-fire)`} />
        <path className="yy-flame-inner" d="M31 91 C16 79 32 62 27 44 C44 59 45 77 31 91 Z" fill="#ffeac0" opacity=".94" />
        <path d="M31 87 Q36 76 32 63" fill="none" stroke="#fffbdf" strokeWidth="1.6" strokeLinecap="round" />
    </svg>;
}

/** 旋枪的四道弧影仍按原来的拍子出场，轮廓替换为尖细的火焰丝带。 */
export function YunyingArcRibbon() {
    const id = useId().replace(/:/g, '');
    return <svg className="yy-arc-ribbon" viewBox="0 0 100 100" aria-hidden="true">
        <defs><linearGradient id={`${id}-ribbon`} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#bb3c22" stopOpacity="0" /><stop offset=".38" stopColor="#e2672b" stopOpacity=".38" /><stop offset=".75" stopColor="#ffb959" /><stop offset="1" stopColor="#fff0b8" /></linearGradient></defs>
        <path d="M11 76 C-5 39 24 6 56 9 C75 11 89 23 94 42 C77 17 49 16 30 29 C15 39 11 58 11 76 Z" fill={`url(#${id}-ribbon)`} />
        <path d="M13 68 C6 38 28 12 55 12 C76 12 87 25 94 42" fill="none" stroke="#ffedb4" strokeWidth=".8" opacity=".92" />
        <path d="M28 29 C47 8 70 15 80 19 C72 8 62 4 53 4 C77 3 91 18 94 42 C85 30 78 28 72 26 C78 28 71 33 64 30 C52 24 38 24 28 29 Z" fill={`url(#${id}-ribbon)`} opacity=".65" />
    </svg>;
}

export function YunyingSwingSpear() {
    return <i className="yy-swing-spear">
        <YunyingSpearGlyph />
        <i className="yy-spear-fire"><YunyingFlameGlyph /></i>
        <i className="yy-spear-glint" />
    </i>;
}
