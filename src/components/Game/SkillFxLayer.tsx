/**
 * 英雄技能特效层（技能级专属动效）。
 *
 * SkillFxLifecycle：隐形生命周期组件，负责把到期事件从 store 队列移除；
 * SkillFxVisual：单个特效事件在某个格子上的视觉呈现——
 *   - caster 变体渲染在起手格（毫毛起飞、光束发射、通用光环）；
 *   - target 变体渲染在目标格（砸击、绽放、剑气等着弹表现）。
 * 跨格飞行（毫毛/粒子束）通过 CSS 变量 --fx-travel-x/--fx-travel-y 与
 * --fx-rot/--fx-dist 以起手格为锚向外延伸，动画细节见 ink-wash.css。
 */
import { useEffect, type CSSProperties } from 'react';
import type { SkillFxEvent } from '../../core/skill-fx';
import { useGameStore } from '../../store/game-store';

/** 动画结束后额外存活的余量（毫秒），保证淡出帧完整播放 */
const FX_LINGER_MS = 200;

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

/** 把事件的方向几何注入 CSS 变量（子元素按需取用） */
function fxStyleVars(event: SkillFxEvent): CSSProperties {
    const dx = event.targetPos[1] - event.fromPos[1];
    const dy = event.targetPos[0] - event.fromPos[0];
    return {
        '--fx-rot': `${event.angleDeg}deg`,
        // 棒体基准竖直，旋转后棒头指向攻击方向
        '--fx-staff-rot': `${event.angleDeg - 90}deg`,
        '--fx-travel-x': String(dx),
        '--fx-travel-y': String(dy),
        '--fx-dist': String(Math.round(Math.hypot(dx, dy) * 100) / 100),
    } as CSSProperties;
}

/** 起手格变体：毫毛起飞 / 光束发射 / 通用光环 */
function CasterFx({ event }: { event: SkillFxEvent }) {
    switch (event.profile.kind) {
        case 'wukong-clone':
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-hair">
                        <svg className="fx-hair-body" viewBox="0 0 20 44" aria-hidden="true">
                            <defs>
                                <linearGradient id="fx-hair-grad" x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0" stopColor="#c98f2e" />
                                    <stop offset="0.5" stopColor="#ffe9a8" />
                                    <stop offset="1" stopColor="#b97f22" />
                                </linearGradient>
                            </defs>
                            <path d="M10 1 C 15 9, 16 27, 10 43 C 4 27, 5 9, 10 1 Z" fill="url(#fx-hair-grad)" />
                            <path d="M10 3 C 12.5 12, 13 27, 10 41" fill="none" stroke="rgba(255,251,230,0.85)" strokeWidth="1" />
                        </svg>
                    </i>
                </span>
            );
        case 'feynman-beam':
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-beam" />
                    <i className="fx-beam-muzzle" />
                </span>
            );
        default:
            return <span className="fx-halo" />;
    }
}

const PARTICLE_COUNT = 8;

/** 粒子环：角度由 CSS 变量驱动，费曼轰爆双环与着弹火花共用 */
function ParticleRing({
    className = '',
    beginAngle = 0,
    reverse = false,
}: {
    className?: string;
    beginAngle?: number;
    reverse?: boolean;
}) {
    return (
        <i className={['fx-orbit', ...(reverse ? ['fx-orbit-reverse'] : []), ...(className ? [className] : [])].join(' ')}>
            {Array.from({ length: PARTICLE_COUNT }).map((_, index) => (
                <b
                    key={index}
                    style={{ '--fx-angle': `${beginAngle + index * (360 / PARTICLE_COUNT)}deg` } as CSSProperties}
                />
            ))}
        </i>
    );
}

/** 六瓣雪花（Lucide 标准雪花轮廓，ISC 协议） */
function FrostSnow() {
    return (
        <svg
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

/** 悟空·毫毛化分身：烟雾绽开 + 金色光柱（毫毛本体渲染在起手格） */
function WukongCloneFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-clone-flash" />
            <i className="fx-smoke fx-smoke-1" />
            <i className="fx-smoke fx-smoke-2" />
            <i className="fx-smoke fx-smoke-3" />
            <i className="fx-smoke fx-smoke-4" />
            <i className="fx-smoke fx-smoke-5" />
        </span>
    );
}

/** 悟空·金箍棒砸击：循攻击方向落棒 + 冲击波 + 尘土 */
function WukongStaffFx({ event }: { event: SkillFxEvent }) {
    return (
        <span className="fx-anchor" style={fxStyleVars(event)}>
            <i className="fx-staff">
                <b className="fx-staff-shaft" />
                <b className="fx-staff-cap fx-staff-cap-top" />
                <b className="fx-staff-cap fx-staff-cap-bottom" />
            </i>
            <i className="fx-impact" />
            <i className="fx-dust fx-dust-1" />
            <i className="fx-dust fx-dust-2" />
            <i className="fx-dust fx-dust-3" />
            <i className="fx-dust fx-dust-4" />
            <i className="fx-dust fx-dust-5" />
        </span>
    );
}

/** 目标格主效：按技能档案分发到各自的 DOM 结构 */
function TargetFx({ event }: { event: SkillFxEvent }) {
    switch (event.profile.kind) {
        case 'wukong-clone':
            return <WukongCloneFx />;
        case 'wukong-staff':
            return <WukongStaffFx event={event} />;
        case 'feixue-blade':
            // 霜刃破阵：冰蓝光刃循攻击方向斜掠 + 碎冰飞溅
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-ice-blade" />
                    <i className="fx-shard fx-shard-1" />
                    <i className="fx-shard fx-shard-2" />
                    <i className="fx-shard fx-shard-3" />
                    <i className="fx-shard fx-shard-4" />
                </span>
            );
        case 'feixue-stomp':
            // 踏雪追命：大雪花压落 + 冰环扩散 + 寒雾
            return (
                <span className="fx-anchor">
                    <i className="fx-stomp-snow"><FrostSnow /></i>
                    <i className="fx-frost-ring" />
                    <i className="fx-mist fx-mist-1" />
                    <i className="fx-mist fx-mist-2" />
                </span>
            );
        case 'soul-lamp-array':
            // 暗夜法阵：双环法阵 + 幽绿光柱 + 四散鬼火
            return (
                <span className="fx-anchor">
                    <i className="fx-array-outer" />
                    <i className="fx-array-inner" />
                    <i className="fx-array-pillar" />
                    <i className="fx-wisp fx-wisp-a" />
                    <i className="fx-wisp fx-wisp-b" />
                    <i className="fx-wisp fx-wisp-c" />
                    <i className="fx-wisp fx-wisp-d" />
                </span>
            );
        case 'soul-lamp-cycle':
            // 缚魂轮转：交错轮环 + 灯焰摇曳 + 绿色涟漪
            return (
                <span className="fx-anchor">
                    <i className="fx-cycle-ring fx-cycle-ring-a" />
                    <i className="fx-cycle-ring fx-cycle-ring-b" />
                    <i className="fx-flame" />
                    <i className="fx-green-ripple" />
                </span>
            );
        case 'libai-slash':
            // 醉剑：青白剑光循攻击方向速闪 + 酒气光点
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-sword-flash" />
                    <i className="fx-wine-dot fx-wine-dot-1" />
                    <i className="fx-wine-dot fx-wine-dot-2" />
                    <i className="fx-wine-dot fx-wine-dot-3" />
                </span>
            );
        case 'libai-flurry':
            // 剑气纵横：三道剑气循攻击方向依次扫过
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-moon-blade fx-moon-blade-1" />
                    <i className="fx-moon-blade fx-moon-blade-2" />
                    <i className="fx-moon-blade fx-moon-blade-3" />
                </span>
            );
        case 'feynman-beam':
            // 粒子束着弹：紫色火花迸溅（光束本体渲染在起手格）
            return (
                <span className="fx-anchor">
                    <i className="fx-beam-spark" />
                    <ParticleRing className="fx-spark-ring" beginAngle={30} />
                </span>
            );
        case 'feynman-burst':
            // 粒子轰爆：中心白闪 + 双粒子环对转
            return (
                <span className="fx-anchor">
                    <i className="fx-core-flash" />
                    <ParticleRing beginAngle={0} />
                    <ParticleRing beginAngle={22} reverse />
                </span>
            );
        case 'ink':
        default:
            // 默认兜底：双层墨韵涟漪
            return (
                <span className="fx-anchor">
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
    return (
        <span
            className={[
                'skill-fx',
                `skill-fx-kind-${event.profile.kind}`,
                variant === 'caster' ? 'skill-fx-caster' : 'skill-fx-target',
                event.owner === 'player1' ? 'skill-fx-owner-p1' : 'skill-fx-owner-p2',
            ].join(' ')}
            aria-hidden="true"
        >
            {variant === 'caster' ? <CasterFx event={event} /> : <TargetFx event={event} />}
        </span>
    );
}
