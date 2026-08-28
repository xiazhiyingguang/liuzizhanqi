/**
 * 英雄技能特效层（技能级专属动效）。
 *
 * SkillFxLifecycle：隐形生命周期组件，负责把到期事件从 store 队列移除；
 * SkillFxVisual：单个特效事件在某个格子上的视觉呈现——
 *   - caster 变体渲染在起手格（毫毛起飞、光束发射、投射物、通用光环）；
 *   - target 变体渲染在目标格（砸击、绽放、剑气等着弹表现）。
 * 跨格飞行（毫毛/粒子束/投射物/冲刺拖尾）通过 CSS 变量
 * --fx-travel-x/--fx-travel-y 与 --fx-rot/--fx-dist 以起手格为锚向外延伸。
 *
 * 通用原型（arc-slash/pierce/burst/…）的配色由档案 c1/c2 注入：
 * --fx-c1 主色、--fx-c2 辅色、--fx-glow 光晕，动画细节见 ink-wash.css。
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

/** #rrggbb → rgba() 字符串 */
function withAlpha(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 把事件的方向几何与档案配色注入 CSS 变量（子元素按需取用） */
function fxStyleVars(event: SkillFxEvent): CSSProperties {
    const dx = event.targetPos[1] - event.fromPos[1];
    const dy = event.targetPos[0] - event.fromPos[0];
    const vars: Record<string, string> = {
        '--fx-rot': `${event.angleDeg}deg`,
        // 棒体基准竖直，旋转后棒头指向攻击方向
        '--fx-staff-rot': `${event.angleDeg - 90}deg`,
        '--fx-travel-x': String(dx),
        '--fx-travel-y': String(dy),
        '--fx-dist': String(Math.round(Math.hypot(dx, dy) * 100) / 100),
    };
    const { c1, c2 } = event.profile;
    if (c1) {
        vars['--fx-c1'] = c1;
        vars['--fx-glow'] = withAlpha(c1, 0.55);
    }
    if (c2) {
        vars['--fx-c2'] = c2;
    }
    return vars as CSSProperties;
}

/** 起手格变体：毫毛起飞 / 光束发射 / 投射物 / 冲刺拖尾 / 通用光环 */
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
        case 'pierce':
            // 投射物自起手格飞向目标格（着弹表现渲染在目标格）
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fxp-dart" />
                    <i className="fx-beam-muzzle fxp-muzzle" />
                </span>
            );
        case 'shadow-dash':
            // 冲刺拖尾：沿位移方向铺展的光痕
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fxp-trail" />
                </span>
            );
        case 'phase-swap':
            // 起手段：内向收缩涡环
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fxp-implode" />
                    <i className="fxp-implode fxp-implode-b" />
                </span>
            );
        default:
            return <span className="fx-halo" />;
    }
}

const PARTICLE_COUNT = 8;

/** 粒子环：角度由 CSS 变量驱动，轰爆双环与着弹火花共用；加 fxp-orbit 类则套用档案配色 */
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

/** 晶屑飞溅：n 枚菱形晶粒按预设方向散开（配色取档案） */
function Shards({ count }: { count: number }) {
    return (
        <>
            {Array.from({ length: count }).map((_, index) => (
                <i key={index} className={`fxp-shard fxp-shard-${index + 1}`} />
            ))}
        </>
    );
}

/** 上浮微光：n 粒光点自下而上飘起（祝福/增益/余烬共用，类名决定节奏） */
function Sparks({ count, className = '' }: { count: number; className?: string }) {
    return (
        <>
            {Array.from({ length: count }).map((_, index) => (
                <i key={index} className={['fxp-spark', `fxp-spark-${index + 1}`, className].join(' ')} />
            ))}
        </>
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

/** 音符（Lucide music 轮廓，ISC 协议），配色取 currentColor */
function NoteGlyph() {
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
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
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

/* ============================================================
   通用原型渲染器（配色由档案注入 --fx-c1/--fx-c2/--fx-glow）
   ============================================================ */

/** 弧光斩：循攻击方向掠过的双层弧刃 + 闪核 + 冲击环 + 晶屑 */
function ArcSlashFx({ double = false }: { double?: boolean }) {
    return (
        <span className="fx-anchor">
            <i className="fxp-arc" />
            {double && <i className="fxp-arc fxp-arc-b" />}
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
            <Shards count={4} />
        </span>
    );
}

/** 三连斩：三道弧刃错落扫过 + 尾随爆闪与冲击环 */
function TripleSlashFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-arc fxp-arc-1" />
            <i className="fxp-arc fxp-arc-2" />
            <i className="fxp-arc fxp-arc-3" />
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
        </span>
    );
}

/** 着弹大闪核 + 双层冲击环 + 晶屑光尘（pierce 目标格） */
function PierceImpactFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-hitflash fxp-hitflash-big" />
            <i className="fxp-ring" />
            <i className="fxp-ring fxp-ring-b" />
            <Shards count={3} />
            <Sparks count={3} className="fxp-spark-fast" />
        </span>
    );
}

/** 环形爆发：中心闪爆 + 双粒子环 + 冲击环 + 地裂 */
function RadialBurstFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-crack" />
            <i className="fxp-hitflash fxp-hitflash-big" />
            <ParticleRing className="fxp-orbit" beginAngle={0} />
            <ParticleRing className="fxp-orbit" beginAngle={22} reverse />
            <i className="fxp-ring" />
        </span>
    );
}

/** 法阵：地面辉光 + 双层对旋符环 + 光柱 + 符火 */
function MagicArrayFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-auraglow" />
            <i className="fxp-rune fxp-rune-a" />
            <i className="fxp-rune fxp-rune-b" />
            <i className="fxp-pillar" />
            <Sparks count={4} className="fxp-spark-wisp" />
        </span>
    );
}

/** 召光：底环 + 光柱 + 调色烟团 + 辉闪 + 升尘 */
function LightSummonFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-hitflash fxp-hitflash-big" />
            <i className="fxp-ring" />
            <i className="fxp-pillar" />
            <i className="fxp-smoke fxp-smoke-1" />
            <i className="fxp-smoke fxp-smoke-2" />
            <i className="fxp-smoke fxp-smoke-3" />
            <i className="fxp-smoke fxp-smoke-4" />
            <Sparks count={3} />
        </span>
    );
}

/** 祝福/治愈：柔和光环 + 上浮微光 + 中心暖辉 */
function BlessingFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-auraglow" />
            <i className="fxp-ring" />
            <i className="fxp-ring fxp-ring-b" />
            <Sparks count={5} />
        </span>
    );
}

/** 增益：上升辉光 + 扩环 + 光尘 */
function AuraBuffFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-auraglow" />
            <i className="fxp-ring" />
            <Sparks count={3} className="fxp-spark-fast" />
        </span>
    );
}

/** 诅咒：暗影触须 + 暗环 + 暗闪核心 + 下沉符点 */
function HexCurseFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-tendril fxp-tendril-1" />
            <i className="fxp-tendril fxp-tendril-2" />
            <i className="fxp-tendril fxp-tendril-3" />
            <i className="fxp-tendril fxp-tendril-4" />
            <i className="fxp-rune fxp-rune-a fxp-rune-dark" />
            <i className="fxp-hitflash" />
            <Sparks count={4} className="fxp-spark-fall" />
        </span>
    );
}

/** 落点尘环 + 本体残影（shadow-dash 目标格） */
function DashLandingFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-ghost" />
            <i className="fxp-ring" />
            <i className="fxp-smoke fxp-smoke-a" />
            <i className="fxp-smoke fxp-smoke-b" />
        </span>
    );
}

/** 换位/瞬移：双内向涡环 + 外扩副环 + 闪光 */
function PhaseSwapFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-implode" />
            <i className="fxp-implode fxp-implode-b" />
            <i className="fxp-ring" />
            <i className="fxp-hitflash" />
        </span>
    );
}

/** 领域：贴地波纹双扩散 + 地面辉光 + 内旋符环 + 边缘符火 */
function GroundZoneFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-groundglow" />
            <i className="fxp-groundwave" />
            <i className="fxp-groundwave fxp-groundwave-b" />
            <i className="fxp-rune fxp-rune-a" />
            <Sparks count={4} className="fxp-spark-wisp" />
        </span>
    );
}

/** 束缚：收拢笼环 + 交叉锁光 + 爆闪 + 扣点光尘 */
function CageBindFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-cage" />
            <i className="fxp-lockbar fxp-lockbar-a" />
            <i className="fxp-lockbar fxp-lockbar-b" />
            <i className="fxp-hitflash" />
            <Sparks count={4} className="fxp-spark-fast" />
        </span>
    );
}

/** 晶碎：闪核 + 晶屑迸溅 + 双层玻璃环 + 地裂 */
function CrystalShatterFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-crack" />
            <i className="fxp-hitflash" />
            <Shards count={6} />
            <i className="fxp-ring" />
            <i className="fxp-ring fxp-ring-b" />
        </span>
    );
}

/** 焰浪：火热闪焰 + 闪核 + 上升余烬 + 冲击环 */
function EmberFlareFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-flare" />
            <i className="fxp-hitflash" />
            <Sparks count={5} className="fxp-spark-ember" />
            <i className="fxp-ring" />
        </span>
    );
}

/** 雷霆：双道锯齿电光 + 爆闪 + 震环 + 溅射光尘 */
function StormBoltFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-bolt" />
            <i className="fxp-bolt fxp-bolt-b" />
            <i className="fxp-hitflash fxp-hitflash-big" />
            <i className="fxp-ring" />
            <Sparks count={4} className="fxp-spark-fast" />
        </span>
    );
}

/** 旋风：对旋涡环 + 中心闪核 + 风纹光点 */
function GaleVortexFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-swirl fxp-swirl-a" />
            <i className="fxp-swirl fxp-swirl-b" />
            <i className="fxp-hitflash" />
            <Sparks count={4} className="fxp-spark-wind" />
        </span>
    );
}

/** 乐律：三枚音符上浮 + 弦波涟漪 */
function ChordNotesFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-note fxp-note-1"><NoteGlyph /></i>
            <i className="fxp-note fxp-note-2"><NoteGlyph /></i>
            <i className="fxp-note fxp-note-3"><NoteGlyph /></i>
            <i className="fxp-ring" />
            <i className="fxp-ring fxp-ring-b" />
        </span>
    );
}

/** 时溯：倒转符环 + 逆走指针 + 辉光 */
function TimeRewindFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-rune fxp-rune-a fxp-rune-rewind" />
            <i className="fxp-clockhand fxp-clockhand-a" />
            <i className="fxp-clockhand fxp-clockhand-b" />
            <i className="fxp-auraglow" />
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
        // —— 通用原型（配色随档案）——
        case 'arc-slash':
            return <ArcSlashFx />;
        case 'triple-slash':
            return <TripleSlashFx />;
        case 'pierce':
            return <PierceImpactFx />;
        case 'radial-burst':
            return <RadialBurstFx />;
        case 'magic-array':
            return <MagicArrayFx />;
        case 'light-summon':
            return <LightSummonFx />;
        case 'blessing':
            return <BlessingFx />;
        case 'aura-buff':
            return <AuraBuffFx />;
        case 'hex-curse':
            return <HexCurseFx />;
        case 'shadow-dash':
            return <DashLandingFx />;
        case 'phase-swap':
            return <PhaseSwapFx />;
        case 'ground-zone':
            return <GroundZoneFx />;
        case 'cage-bind':
            return <CageBindFx />;
        case 'crystal-shatter':
            return <CrystalShatterFx />;
        case 'ember-flare':
            return <EmberFlareFx />;
        case 'storm-bolt':
            return <StormBoltFx />;
        case 'gale-vortex':
            return <GaleVortexFx />;
        case 'chord-notes':
            return <ChordNotesFx />;
        case 'time-rewind':
            return <TimeRewindFx />;
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
            style={fxStyleVars(event)}
            aria-hidden="true"
        >
            {variant === 'caster' ? <CasterFx event={event} /> : <TargetFx event={event} />}
        </span>
    );
}
