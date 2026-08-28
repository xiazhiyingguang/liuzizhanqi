/**
 * 英雄持续状态的常驻特效层（渲染在棋子之上，纯装饰、不拦截交互）。
 *
 * 状态→特效的判定见 core/hero-status-fx（纯函数、可单测）；
 * 本组件只负责把每种状态组合成 DOM 零件：
 *   sfx-ring 脉冲环 / sfx-orbit 旋转环绕点 / sfx-rise 升腾粒子 /
 *   sfx-stream 流动风纹 / sfx-shell 覆盖壳（冰封/潜行）/
 *   sfx-blink 闪烁核点 / sfx-cross 旋转十字刻度 / sfx-drop 飘落粒子。
 * 每种状态的配色与节奏由 ink-wash.css 的 .sfx-* 规则定义。
 */
import type { CSSProperties, ReactNode } from 'react';
import type { Hero } from '../../types/game';
import { resolveHeroStatusFx, type HeroStatusFxKind } from '../../core/hero-status-fx';

/** 环绕点：n 粒沿圆环均分布点并整体旋转 */
function Orbit({ count, className = '' }: { count: number; className?: string }) {
    return (
        <i className={`sfx-orbit ${className}`}>
            {Array.from({ length: count }).map((_, index) => (
                <b
                    key={index}
                    style={{ '--sfx-angle': `${(360 / count) * index}deg` } as CSSProperties}
                />
            ))}
        </i>
    );
}

/** 升腾粒子：n 粒自下而上飘散 */
function Rise({ count }: { count: number }) {
    return (
        <>
            {Array.from({ length: count }).map((_, index) => (
                <i key={index} className="sfx-rise" style={{ '--sfx-i': index } as CSSProperties} />
            ))}
        </>
    );
}

/** 飘落粒子：n 粒自上而下（羽化/酒泡） */
function Drop({ count }: { count: number }) {
    return (
        <>
            {Array.from({ length: count }).map((_, index) => (
                <i key={index} className="sfx-drop" style={{ '--sfx-i': index } as CSSProperties} />
            ))}
        </>
    );
}

/** 闪烁核点 */
function Blink({ count }: { count: number }) {
    return (
        <>
            {Array.from({ length: count }).map((_, index) => (
                <i key={index} className="sfx-blink" style={{ '--sfx-i': index } as CSSProperties} />
            ))}
        </>
    );
}

function partsFor(kind: HeroStatusFxKind): ReactNode {
    switch (kind) {
        case 'frozen':
            return (
                <>
                    <i className="sfx-shell" />
                    <Blink count={2} />
                </>
            );
        case 'stun':
            return <Orbit count={3} className="sfx-orbit-stars" />;
        case 'stealth':
            return (
                <>
                    <i className="sfx-shell sfx-veil" />
                    <i className="sfx-ring sfx-veil-ring" />
                </>
            );
        case 'bounty':
            return (
                <>
                    <i className="sfx-cross" />
                    <i className="sfx-ring" />
                </>
            );
        case 'deathmark':
            return (
                <>
                    <i className="sfx-ring" />
                    <Blink count={1} />
                </>
            );
        case 'fear':
            return (
                <>
                    <Rise count={3} />
                    <i className="sfx-ring sfx-fear-ring" />
                </>
            );
        case 'wither':
            return <Rise count={3} />;
        case 'headwind':
        case 'tailwind':
            return (
                <>
                    <i className="sfx-stream" />
                    <i className="sfx-stream sfx-stream-b" />
                </>
            );
        case 'chill':
            return (
                <>
                    <Orbit count={4} className="sfx-orbit-snow" />
                    <i className="sfx-ring sfx-chill-ring" />
                </>
            );
        case 'feather':
            return <Drop count={2} />;
        case 'inlay':
            return (
                <>
                    <i className="sfx-ring sfx-inlay-ring" />
                    <Orbit count={2} className="sfx-orbit-inlay" />
                </>
            );
        case 'way':
            return (
                <>
                    <i className="sfx-ring sfx-way-ring" />
                    <Rise count={2} />
                </>
            );
        case 'guard':
            return (
                <>
                    <i className="sfx-ring sfx-guard-ring" />
                    <Blink count={1} />
                </>
            );
        case 'ice-armor':
            return (
                <>
                    <i className="sfx-ring sfx-hex-ring" />
                    <Blink count={2} />
                </>
            );
        case 'harmony':
            return (
                <>
                    <i className="sfx-ring sfx-harmony-ring" />
                    <Rise count={2} />
                </>
            );
        case 'note':
            return <Blink count={2} />;
        case 'vampire':
            return (
                <>
                    <i className="sfx-ring" />
                    <Rise count={2} />
                </>
            );
        case 'edge':
            return <i className="sfx-cross sfx-edge-cross" />;
        case 'combo':
            return (
                <>
                    <i className="sfx-stream" />
                    <i className="sfx-stream sfx-stream-b" />
                </>
            );
        case 'particle':
            return <Orbit count={3} className="sfx-orbit-particle" />;
        case 'observe-hit':
        case 'observe-miss':
            return (
                <>
                    <i className="sfx-blink sfx-observe" />
                    <Blink count={2} />
                </>
            );
        case 'entangle':
            return (
                <>
                    <Orbit count={2} className="sfx-orbit-entangle" />
                    <i className="sfx-ring sfx-entangle-ring" />
                </>
            );
        case 'fortune':
            return (
                <>
                    <Rise count={3} />
                    <Blink count={1} />
                </>
            );
        case 'mirror-blade':
            return <Orbit count={3} className="sfx-orbit-blade" />;
        case 'momentum':
            return <Rise count={3} />;
        case 'drunk':
            return (
                <>
                    <Drop count={2} />
                    <Blink count={1} />
                </>
            );
        default:
            return null;
    }
}

export function HeroStatusFx({ hero }: { hero: Hero }) {
    const kinds = resolveHeroStatusFx(hero);
    if (kinds.length === 0) return null;
    return (
        <>
            {kinds.map(kind => (
                <span key={kind} className={`status-fx sfx-${kind}`} aria-hidden="true">
                    {partsFor(kind)}
                </span>
            ))}
        </>
    );
}
