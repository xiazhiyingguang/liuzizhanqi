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

/** 闪电（Lucide zap 轮廓，ISC 协议），配色取 currentColor */
function BoltGlyph() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
        </svg>
    );
}

function partsFor(kind: HeroStatusFxKind, hero?: Hero): ReactNode {
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
        case 'paralysis':
            return (
                <>
                    <i className="sfx-bolt"><BoltGlyph /></i>
                    <Blink count={2} />
                </>
            );
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
        case 'bounty-tianwei':
            // 悬赏·天威再临：赤金印玺——旋转封印环 + 准星 + 金芒闪点
            return (
                <>
                    <i className="sfx-ring sfx-bounty-seal" />
                    <i className="sfx-cross" />
                    <Blink count={1} />
                </>
            );
        case 'bounty-revive':
            // 悬赏·半血回生：翡翠回生纹——回生十字 + 上升生机
            return (
                <>
                    <i className="sfx-cross sfx-bounty-revive-cross" />
                    <i className="sfx-ring" />
                    <Rise count={2} />
                </>
            );
        case 'bounty-crit':
            // 悬赏·永久暴击：绯红暴击刻——急旋锋刃十字 + 锐利闪点
            return (
                <>
                    <i className="sfx-cross sfx-bounty-crit-cross" />
                    <i className="sfx-cross sfx-bounty-crit-cross sfx-bounty-crit-cross-b" />
                    <Blink count={1} />
                </>
            );
        case 'bounty-vampire':
            // 悬赏·永久吸血：暗紫汲取环——下坠血珠 + 汲取环
            return (
                <>
                    <i className="sfx-ring sfx-bounty-vampire-ring" />
                    <Drop count={3} />
                </>
            );
        case 'deathmark':
            return (
                <>
                    <i className="sfx-ring" />
                    <Blink count={1} />
                </>
            );
        case 'chainmark':
            return (
                <>
                    <i className="sfx-bolt sfx-bolt-chain"><BoltGlyph /></i>
                    <i className="sfx-ring sfx-chain-ring" />
                </>
            );
        case 'fear':
            return (
                <>
                    <Rise count={3} />
                    <i className="sfx-ring sfx-fear-ring" />
                </>
            );
        case 'rage':
            return (
                <>
                    <i className="sfx-ring sfx-rage-ring" />
                    <Rise count={2} />
                </>
            );
        case 'wither':
            return <Rise count={3} />;
        case 'burn':
            return (
                <>
                    <i className="sfx-ring sfx-burn-ring" />
                    <Rise count={3} />
                </>
            );
        case 'bleed':
            return (
                <>
                    <i className="sfx-ring sfx-bleed-ring" />
                    <Drop count={2} />
                </>
            );
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
        case 'jingying':
            // 镜影：环绕的碎镜片数=当前层数（上限5），银蓝冷光
            return (
                <Orbit
                    count={Math.max(1, Math.min(5, hero?.counters['镜影'] ?? 0))}
                    className="sfx-orbit-jingying"
                />
            );
        case 'imprint':
            // 印月：一轮月环缓旋 + 上浮辉屑
            return (
                <>
                    <i className="sfx-ring sfx-imprint-ring" />
                    <Rise count={2} />
                </>
            );
        case 'xubai-orbs':
            // 黑白球：环绕珠数 = 剩余颗数（上限3），黑白交替阴阳配色
            return (
                <Orbit
                    count={Math.max(1, Math.min(3, hero?.counters['黑白球'] ?? 0))}
                    className="sfx-orb-pearls"
                />
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
                    {partsFor(kind, hero)}
                </span>
            ))}
        </>
    );
}
