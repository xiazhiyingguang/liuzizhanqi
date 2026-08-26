/**
 * 英雄技能特效层。
 *
 * SkillFxLifecycle：隐形生命周期组件，负责把到期事件从 store 队列移除；
 * SkillFxVisual：单个特效事件在某个格子上的视觉呈现（起手光环 / 目标主效），
 * 由 Board 在对应格内渲染，动画全部由 ink-wash.css 的 skill-fx 系列类驱动。
 */
import { useEffect, type CSSProperties } from 'react';
import type { SkillFxEvent, SkillFxKind } from '../../core/skill-fx';
import { useGameStore } from '../../store/game-store';

/** 动画结束后额外存活的余量（毫秒），保证淡出帧完整播放 */
const FX_LINGER_MS = 160;

export function SkillFxLifecycle() {
    const skillFx = useGameStore(state => state.skillFx);
    const dismissSkillFx = useGameStore(state => state.dismissSkillFx);

    useEffect(() => {
        if (skillFx.length === 0) return;
        const now = Date.now();
        const timers = skillFx.map(event => {
            const remaining = Math.max(
                0,
                event.profile.durationMs + FX_LINGER_MS - (now - event.bornAt)
            );
            return window.setTimeout(() => dismissSkillFx(event.id), remaining);
        });
        return () => timers.forEach(timer => window.clearTimeout(timer));
    }, [skillFx, dismissSkillFx]);

    return null;
}

/** 起手格通用光环：色调随英雄 kind 与阵营变化 */
function CasterHalo({ event }: { event: SkillFxEvent }) {
    return (
        <span
            className={[
                'skill-fx-caster-halo',
                `skill-fx-kind-${event.profile.kind}`,
                event.owner === 'player1' ? 'skill-fx-owner-p1' : 'skill-fx-owner-p2',
            ].join(' ')}
            aria-hidden="true"
        />
    );
}

const PARTICLE_COUNT = 8;

/** 粒子环：费曼爆发与悟空金屑共用结构，角度由 CSS 变量驱动 */
function ParticleRing({ className, beginAngle = 0 }: { className: string; beginAngle?: number }) {
    return (
        <i className={className}>
            {Array.from({ length: PARTICLE_COUNT }).map((_, index) => (
                <b
                    key={index}
                    style={{ '--fx-angle': `${beginAngle + index * (360 / PARTICLE_COUNT)}deg` } as CSSProperties}
                />
            ))}
        </i>
    );
}

/** 绯雪冰晶：六瓣雪花绽放（Lucide 标准雪花轮廓，ISC 协议） */
function FrostFlower() {
    return (
        <svg
            className="fx-frost-flower"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="m10 20-1.25-2.5L6 18" />
            <path d="M10 4 8.75 6.5 6 6" />
            <path d="m14 20 1.25-2.5L18 18" />
            <path d="m14 4 1.25 2.5L18 6" />
            <path d="m17 21-3-6h-4" />
            <path d="m17 3-3 6 1.5 3" />
            <path d="M2 12h6.5L10 9" />
            <path d="m20 10-1.5 2 1.5 2" />
            <path d="M22 12h-6.5L14 15" />
            <path d="m4 10 1.5 2L4 14" />
            <path d="m7 21 3-6-1.5-3" />
            <path d="m7 3 3 6h4" />
        </svg>
    );
}

/** 目标格主效：按英雄 kind 分发到各自的 DOM 结构（动画细节见 ink-wash.css） */
function TargetFx({ event }: { event: SkillFxEvent }) {
    switch (event.profile.kind) {
        case 'wukong':
            // 金色棍风交叉斜斩 + 迸溅金屑
            return (
                <span className="skill-fx-anchor">
                    <i className="fx-slash fx-slash-a" />
                    <i className="fx-slash fx-slash-b" />
                    <ParticleRing className="fx-sparks" beginAngle={22} />
                </span>
            );
        case 'feixue':
            // 冰晶绽放 + 冰蓝扩散环
            return (
                <span className="skill-fx-anchor">
                    <FrostFlower />
                    <i className="fx-frost-ring" />
                </span>
            );
        case 'soul-lamp':
            // 符文法阵旋转 + 三簇幽绿鬼火上浮
            return (
                <span className="skill-fx-anchor">
                    <i className="fx-rune-ring" />
                    <i className="fx-wisp fx-wisp-a" />
                    <i className="fx-wisp fx-wisp-b" />
                    <i className="fx-wisp fx-wisp-c" />
                </span>
            );
        case 'libai':
            // 青白剑气三连闪（延迟依次出现）
            return (
                <span className="skill-fx-anchor">
                    <i className="fx-blade fx-blade-1" />
                    <i className="fx-blade fx-blade-2" />
                    <i className="fx-blade fx-blade-3" />
                </span>
            );
        case 'feynman':
            // 紫金粒子环爆发 + 中心闪光
            return (
                <span className="skill-fx-anchor">
                    <i className="fx-core-flash" />
                    <ParticleRing className="fx-orbit" />
                </span>
            );
        case 'ink':
        default:
            // 默认兜底：双层墨韵涟漪
            return (
                <span className="skill-fx-anchor">
                    <i className="fx-ripple fx-ripple-a" />
                    <i className="fx-ripple fx-ripple-b" />
                </span>
            );
    }
}

/** 单个特效事件在某个格子上的渲染入口 */
export function SkillFxVisual({
    event,
    variant,
}: {
    event: SkillFxEvent;
    variant: 'caster' | 'target';
}) {
    if (variant === 'caster') {
        return <CasterHalo event={event} />;
    }
    return (
        <span
            className={[
                'skill-fx',
                `skill-fx-kind-${event.profile.kind as SkillFxKind}`,
                event.owner === 'player1' ? 'skill-fx-owner-p1' : 'skill-fx-owner-p2',
            ].join(' ')}
            aria-hidden="true"
        >
            <TargetFx event={event} />
        </span>
    );
}
