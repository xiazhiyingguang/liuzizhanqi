/**
 * 英雄技能特效层（技能级专属动效）。
 *
 * SkillFxLifecycle：隐形生命周期组件，负责把到期事件从 store 队列移除；
 * SkillFxVisual：单个特效事件在某个格子上的视觉呈现——
 *   - caster 变体渲染在起手格（毫毛起飞、光束发射、投射物、通用光环）；
 *   - target 变体渲染在目标格（砸击、绽放、剑气等着弹表现）。
 * 跨格飞行（毫毛/粒子束/投射物/冲刺拖尾）通过 CSS 变量
 * --fx-travel-x/--fx-travel-y 与 --fx-rot/--fx-dist 以起手格为锚向外延伸。
 * AOE 真正打到的每一格各渲染一个 impact 变体、作用区域格渲染 area 底光，
 * 两者由 --fx-cell-delay 按离主目标的距离逐格错开起播。
 *
 * 通用原型（arc-slash/pierce/burst/…）的配色由档案 c1/c2 注入：
 * --fx-c1 主色、--fx-c2 辅色、--fx-glow 光晕，动画细节见 ink-wash.css。
 */
import { useEffect, type CSSProperties } from 'react';
import type { Position, SkillAreaBounds, SkillFxEvent } from '../../core/skill-fx';
import { computeFxAngleDeg, computeFxCellDelayMs, computeFxTailMs, isPerTargetFxKind, resolveAreaFxKind } from '../../core/skill-fx';
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
                event.profile.durationMs +
                    computeFxTailMs(event) +
                    FX_LINGER_MS -
                    (now - event.bornAt)
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
        // 本次特效的实际时长：供区域底光等"要陪完整场"的零件按比例呼吸
        '--fx-duration': `${event.profile.durationMs}ms`,
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

/** 毫毛本体：暗金轮廓 + 亮金毛身 + 白热高光三层叠出圆柱质感
 *  （不用 linearGradient defs，避免多处同时渲染时 SVG id 相互覆盖） */
function HairGlyph() {
    return (
        <svg className="fx-hair-body" viewBox="0 0 20 44" aria-hidden="true">
            <path d="M10 1 C 15 9, 16 27, 10 43 C 4 27, 5 9, 10 1 Z" fill="#c0801f" />
            <path d="M10 4 C 13 11, 13.6 26, 10 40 C 6.4 26, 7 11, 10 4 Z" fill="#ffd98a" />
            <path
                d="M10 6.5 C 11.3 13, 11.5 26, 10 37.5"
                fill="none"
                stroke="#fffbf0"
                strokeWidth="1.2"
                strokeLinecap="round"
            />
        </svg>
    );
}

/** 起手格变体：毫毛起飞 / 光束发射 / 投射物 / 冲刺拖尾 / 通用光环 */
function CasterFx({ event }: { event: SkillFxEvent }) {
    switch (event.profile.kind) {
        case 'wukong-clone':
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-hair-pluck" />
                    <i className="fx-hair fx-hair-echo fx-hair-echo-2">
                        <i className="fx-hair-arc"><HairGlyph /></i>
                    </i>
                    <i className="fx-hair fx-hair-echo fx-hair-echo-1">
                        <i className="fx-hair-arc"><HairGlyph /></i>
                    </i>
                    <i className="fx-hair">
                        <i className="fx-hair-arc">
                            <i className="fx-hair-trail" />
                            <HairGlyph />
                        </i>
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
        case 'feixue-blade':
        case 'feixue-stomp':
        case 'feixue-shatter':
            // 绯雪起手：霜气在脚下收拢凝聚
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-frost-gather" />
                    <i className="fx-frost-gather fx-frost-gather-b" />
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
        case 'lingxi-fan':
            // 泠汐·涌潮拍岸起手段：折扇自施法者格朝攻击方向展开
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <LingxiFanOpenFx />
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

/** 冰棱（踏雪迸刺用的小型冰锥，自地面向上贯出） */
function FrostSpikeGlyph() {
    return (
        <svg viewBox="0 0 28 96" aria-hidden="true">
            <path d="M14 0 L24 74 L14 96 L4 74 Z" fill="currentColor" opacity="0.92" />
            <path d="M14 2 L14 94" stroke="#ffffff" strokeWidth="1.6" opacity="0.85" />
        </svg>
    );
}

/** 冰晶迸溅：n 枚冰晶碎粒按 45° 均布方向旋转飞散（绯雪专属，方向由 CSS 变量驱动） */
function IceShards({ count }: { count: number }) {
    return (
        <>
            {Array.from({ length: count }).map((_, index) => (
                <i
                    key={index}
                    className="fx-iceshard"
                    style={{
                        '--sh-angle': `${(360 / count) * index + 14}deg`,
                        '--sh-delay': `${index % 2 === 0 ? 90 : 190}ms`,
                    } as CSSProperties}
                />
            ))}
        </>
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

/** 分身现身金芒的迸射角度（45° 均分 + 12° 起始偏移，避免与网格轴向重合显得呆板） */
const CLONE_MOTE_ANGLES = Array.from({ length: 8 }, (_, index) => 12 + index * 45);

/** 悟空·毫毛化分身：落地冲击环 + 中心爆闪 + 金色光柱 + 烟团绽开 + 金芒 + 分身凝形剪影 */
function WukongCloneFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-clone-ring fx-clone-ring-1" />
            <i className="fx-clone-ring fx-clone-ring-2" />
            <i className="fx-clone-core" />
            <i className="fx-clone-flash" />
            <i className="fx-smoke fx-smoke-1" />
            <i className="fx-smoke fx-smoke-2" />
            <i className="fx-smoke fx-smoke-3" />
            <i className="fx-smoke fx-smoke-4" />
            <i className="fx-smoke fx-smoke-5" />
            {CLONE_MOTE_ANGLES.map(angle => (
                <i key={angle} className="fx-clone-mote" style={{ '--fx-angle': `${angle}deg` } as CSSProperties} />
            ))}
            <i className="fx-clone-figure" />
            <i className="fx-clone-figure fx-clone-figure-b" />
        </span>
    );
}

/** 悟空·金箍棒砸击：如意金箍棒自空中伸展砸落 + 冲击双环 + 地裂 + 金星迸溅 + 尘土 */
function WukongStaffFx({ event }: { event: SkillFxEvent }) {
    return (
        <span className="fx-anchor" style={fxStyleVars(event)}>
            <i className="fx-staff">
                <b className="fx-staff-shaft" />
                <b className="fx-staff-cap fx-staff-cap-top" />
                <b className="fx-staff-cap fx-staff-cap-bottom" />
            </i>
            <i className="fx-staff-blur" />
            <i className="fx-staff-core" />
            <i className="fx-impact" />
            <i className="fx-staff-crack fx-staff-crack-a" />
            <i className="fx-staff-crack fx-staff-crack-b" />
            <i className="fx-staff-spark fx-staff-spark-1" />
            <i className="fx-staff-spark fx-staff-spark-2" />
            <i className="fx-staff-spark fx-staff-spark-3" />
            <i className="fx-staff-spark fx-staff-spark-4" />
            <i className="fx-staff-spark fx-staff-spark-5" />
            <i className="fx-staff-spark fx-staff-spark-6" />
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

/** 回锋·连刃斩：三段"/"向赤红斜斩依次劈落——斜刃主光 + 白炽刃芯 + 刃光残影 */
function RedTripleSlashFx() {
    return (
        <span className="fx-anchor">
            <i className="fxs-redslash fxs-redslash-1"><b className="fxs-redslash-core" /></i>
            <i className="fxs-redslash fxs-redslash-2"><b className="fxs-redslash-core" /></i>
            <i className="fxs-redslash fxs-redslash-3"><b className="fxs-redslash-core" /></i>
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
            <Shards count={4} />
        </span>
    );
}

/** 寒江雪·冰刺天降：巨型冰锥自空中砸落贯入地面 + 碎冰迸溅 + 严寒雾 */
function FrostSpikesFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-frostspike">
                <svg viewBox="0 0 28 96" aria-hidden="true">
                    <defs>
                        <linearGradient id="fx-frostspike-g" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="#eaf7ff" stopOpacity="0.55" />
                            <stop offset="0.55" stopColor="#bfe6ff" />
                            <stop offset="1" stopColor="#5da8e8" />
                        </linearGradient>
                    </defs>
                    <path d="M14 0 L24 74 L14 96 L4 74 Z" fill="url(#fx-frostspike-g)" />
                    <path d="M14 2 L14 94" stroke="#ffffff" strokeWidth="1.4" opacity="0.9" />
                    <path d="M14 20 L21 72 M14 20 L7 72" stroke="#ffffff" strokeWidth="0.8" opacity="0.5" fill="none" />
                </svg>
            </i>
            <i className="fx-frostspike-crack" />
            <i className="fx-shard fx-shard-1" />
            <i className="fx-shard fx-shard-2" />
            <i className="fx-shard fx-shard-3" />
            <i className="fx-shard fx-shard-4" />
            <i className="fx-mist fx-mist-1" />
            <i className="fx-mist fx-mist-2" />
        </span>
    );
}

/** 孤影·寒星剑气：冷焰巨剑光循攻击方向斜劈而过 + 星芒炸裂 + 剑光残刃 */
function GuyingSwordqiFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-swordqi"><b className="fx-swordqi-core" /></i>
            <i className="fx-swordqi fx-swordqi-echo"><b className="fx-swordqi-core" /></i>
            <i className="fxp-hitflash fxp-hitflash-big" />
            <i className="fx-starburst" />
            <Sparks count={4} className="fxp-spark-fast" />
        </span>
    );
}

/** 镜·破镜飞刃：三枚镜刃自左上/右上/正下三方合击刺入 + 碎镜闪光 + 镜片迸溅 */
function MirrorBladesFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-mirrorblade fx-mirrorblade-a" />
            <i className="fx-mirrorblade fx-mirrorblade-b" />
            <i className="fx-mirrorblade fx-mirrorblade-c" />
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
            <Shards count={5} />
        </span>
    );
}

/** 叙白·黑白凝珠：三颗阴阳珠自四方汇入 + 环绕旋转成阵（施法瞬间） */
function XubaiPearlsFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-pearl fx-pearl-in-1" />
            <i className="fx-pearl fx-pearl-in-2" />
            <i className="fx-pearl fx-pearl-in-3" />
            <i className="fx-pearl-orbit">
                <b className="fx-pearl-orb fx-pearl-orb-1" />
                <b className="fx-pearl-orb fx-pearl-orb-2" />
                <b className="fx-pearl-orb fx-pearl-orb-3" />
            </i>
            <i className="fxp-auraglow" />
        </span>
    );
}

/** 泠汐·海浪涟漪：三重浪环由心荡开 + 浪峰泡沫 + 潮雾 */
function LingxiWaveFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-wavering fx-wavering-1" />
            <i className="fx-wavering fx-wavering-2" />
            <i className="fx-wavering fx-wavering-3" />
            <i className="fx-wavefoam fx-wavefoam-1" />
            <i className="fx-wavefoam fx-wavefoam-2" />
            <i className="fx-wavefoam fx-wavefoam-3" />
            <i className="fxp-auraglow" />
        </span>
    );
}

/** 泠汐·涌潮折扇（施法者格）：折扇自收拢状态朝攻击方向展开 + 扇骨 + 潮光 */
function LingxiFanOpenFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-fan">
                <svg viewBox="0 0 100 74" aria-hidden="true">
                    <defs>
                        <linearGradient id="fx-fan-leaf-g" x1="0" y1="1" x2="0" y2="0">
                            <stop offset="0" stopColor="#5ab8d8" stopOpacity="0.9" />
                            <stop offset="0.62" stopColor="#c8f0ff" stopOpacity="0.75" />
                            <stop offset="1" stopColor="#ffffff" stopOpacity="0.55" />
                        </linearGradient>
                    </defs>
                    <path
                        className="fx-fan-leaf"
                        d="M50 68 L8 26 A52 52 0 0 1 92 26 Z"
                        fill="url(#fx-fan-leaf-g)"
                        stroke="#5ab8d8"
                        strokeWidth="1.6"
                    />
                    <g className="fx-fan-ribs" stroke="rgba(255,255,255,0.85)" strokeWidth="1.1">
                        <path d="M50 68 L50 12" />
                        <path d="M50 68 L18 20" />
                        <path d="M50 68 L82 20" />
                        <path d="M50 68 L30 14" />
                        <path d="M50 68 L70 14" />
                    </g>
                    <circle cx="50" cy="68" r="4.5" fill="#ffffff" opacity="0.95" />
                </svg>
            </i>
            <i className="fx-fan-gust" />
        </span>
    );
}

/** 泠汐·涌潮折扇（命中格）：浪头拍岸——浪环 + 溅起水花 + 潮雾 */
function LingxiFanCrashFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-wavering fx-wavering-1" />
            <i className="fx-wavering fx-wavering-2" />
            <i className="fx-wavefoam fx-wavefoam-1" />
            <i className="fx-wavefoam fx-wavefoam-2" />
            <i className="fx-wavefoam fx-wavefoam-3" />
            <i className="fxp-hitflash" />
            <Sparks count={3} className="fxp-spark-fast" />
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

/** 溅射余波（火系）：小型爆闪 + 火色扩环 + 上升余烬（配色随档案 --fx-c1/--fx-c2） */
function SplashEmberFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-hitflash" />
            <i className="fxp-splash-ring" />
            <i className="fxp-splash-ring fxp-splash-ring-b" />
            <Sparks count={3} className="fxp-spark-ember" />
        </span>
    );
}

/** 链式闪电链路段：锯齿电光自前一格延伸至本格 + 着链爆闪与震环 */
function ChainBoltFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-chainbolt">
                <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
                    <path
                        d="M0 12 L16 5 L30 19 L48 6 L64 18 L82 8 L100 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <path
                        d="M0 12 L16 5 L30 19 L48 6 L64 18 L82 8 L100 12"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.9"
                    />
                </svg>
            </i>
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
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
            // 霜刃破阵：三连冰刃循攻击方向依次斩过 + 冰核爆闪 + 双层霜环 + 碎冰八向迸溅
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-ice-blade fx-ice-blade-1" />
                    <i className="fx-ice-blade fx-ice-blade-2" />
                    <i className="fx-ice-blade fx-ice-blade-3" />
                    <i className="fx-ice-core" />
                    <i className="fx-frost-ring fx-frost-ring-fast" />
                    <i className="fx-frost-ring fx-frost-ring-b" />
                    <IceShards count={8} />
                    <i className="fx-mist fx-mist-1" />
                    <Sparks count={3} className="fxp-spark-fast" />
                </span>
            );
        case 'feixue-stomp':
            // 踏雪追命：巨型雪花自空压落 + 落地爆闪 + 地裂 + 三根冰棱迸刺 + 双层冰环 + 寒雾
            // （fxStyleVars 注入冰蓝档案色——fxp-hitflash/fxp-crack/fxp-spark 全靠 --fx-c1/--fx-c2 取色，
            //   漏传会回落到 .skill-fx 的暗金缺省调色板，冰系技能就变成"黑金"了）
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-stomp-snow"><FrostSnow /></i>
                    <i className="fxp-hitflash fxp-hitflash-big" />
                    <i className="fxp-crack" />
                    <i className="fx-stomp-spike fx-stomp-spike-1"><FrostSpikeGlyph /></i>
                    <i className="fx-stomp-spike fx-stomp-spike-2"><FrostSpikeGlyph /></i>
                    <i className="fx-stomp-spike fx-stomp-spike-3"><FrostSpikeGlyph /></i>
                    <i className="fx-frost-ring" />
                    <i className="fx-frost-ring fx-frost-ring-b" />
                    <i className="fx-mist fx-mist-1" />
                    <i className="fx-mist fx-mist-2" />
                    <i className="fx-mist fx-mist-3" />
                    <Sparks count={4} className="fxp-spark-fast" />
                </span>
            );
        case 'feixue-shatter':
            // 破冰爆震：冰核自内炸裂 + 霜柱冲天 + 双冲击环 + 十二枚冰晶环射四溅
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fx-shatter-core" />
                    <i className="fx-shatter-flash" />
                    <i className="fx-shatter-pillar" />
                    <i className="fx-shatter-ring" />
                    <i className="fx-shatter-ring fx-shatter-ring-b" />
                    <IceShards count={12} />
                    <i className="fx-mist fx-mist-1" />
                    <i className="fx-mist fx-mist-2" />
                    <Sparks count={4} className="fxp-spark-fast" />
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
            return <RedTripleSlashFx />;
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
        case 'frost-spikes':
            // 寒江雪·冰刺天降：巨型冰锥砸落贯地
            return <FrostSpikesFx />;
        case 'guying-swordqi':
            // 孤影·寒星剑气：冷焰巨剑光斜劈
            return <GuyingSwordqiFx />;
        case 'mirror-blades':
            // 镜·破镜飞刃：三枚镜刃合击
            return <MirrorBladesFx />;
        case 'xubai-pearls':
            // 叙白·黑白凝珠：三珠汇聚环绕
            return <XubaiPearlsFx />;
        case 'lingxi-wave':
            // 泠汐·海浪涟漪：浪环荡开
            return <LingxiWaveFx />;
        case 'lingxi-fan':
            // 泠汐·涌潮拍岸：命中格浪头拍击（扇面在施法者格展开）
            return <LingxiFanCrashFx />;
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

/** AOE 次要命中格的轻量印记：受击走出血爆闪 + 冲击环 + 晶屑，受益走柔光 + 光环 + 光尘。
 *  主目标格仍由 target 变体承载完整主效，这里只补"这一格也被打/被治疗到了"。 */
function ImpactMarkFx({ soft = false }: { soft?: boolean }) {
    if (soft) {
        return (
            <span className="fx-anchor">
                <i className="fxp-auraglow" />
                <i className="fxp-ring" />
                <Sparks count={4} />
            </span>
        );
    }
    return (
        <span className="fx-anchor">
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
            <Shards count={3} />
        </span>
    );
}

/** 作用区域格：辉光只作范围染色，轮廓由独立的锐利描边承担。
 *  两者必须分开——描边若挂在辉光的 ::before 上，会被父级淡出乘暗又被 blur 糊掉。 */
function AreaTileFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-areatile" />
            <i className="fxp-arearim" />
        </span>
    );
}

/** 单个特效事件在某个格子上的渲染入口。
 *  variant：caster=起手格光环 / target=目标格主效 / impact=AOE 次要命中格 /
 *  area=作用区域底光格 / splash=溅射余波格 / chain=链电链路格。
 *  impact/area/splash/chain 变体必须传入 atPos（该格坐标），用于逐格波浪延迟与多格匹配。 */
export function SkillFxVisual({
    event,
    variant,
    atPos,
}: {
    event: SkillFxEvent;
    variant: 'caster' | 'target' | 'impact' | 'area' | 'splash' | 'chain';
    atPos?: Position;
}) {
    const variantClass =
        variant === 'caster' ? 'skill-fx-caster' :
        variant === 'target' ? 'skill-fx-target' :
        variant === 'impact' ? 'skill-fx-impact' :
        variant === 'area' ? 'skill-fx-area' :
        variant === 'splash' ? 'skill-fx-splash' : 'skill-fx-chain';

    // 链路段角度：以链路序列 [主目标, ...传导格] 中前一格为基准，电光指向本格
    let style = fxStyleVars(event);
    if (variant === 'chain' && atPos) {
        const seq: Position[] = [event.targetPos, ...(event.chainLinks ?? [])];
        const idx = seq.findIndex(([r, c]) => r === atPos[0] && c === atPos[1]);
        if (idx > 0) {
            const angle = computeFxAngleDeg(seq[idx - 1], atPos);
            style = { ...style, '--fx-rot': `${angle + 180}deg` } as CSSProperties;
        }
    }

    // 逐格波浪：离主目标越远起播越晚，多格特效一层层荡开而不是同帧糊成一片
    if ((variant === 'impact' || variant === 'area') && atPos) {
        style = {
            ...style,
            '--fx-cell-delay': `${computeFxCellDelayMs(event.targetPos, atPos)}ms`,
        } as CSSProperties;
    }

    // 命中型原型本身就是"一次命中的特写"，每个命中格各来一份完整主效；
    // 法阵/领域/增益类只在主格出本体，其余格退回轻量印记
    const perTargetMain = variant === 'impact' && isPerTargetFxKind(event.profile.kind);
    const isSoftImpact =
        variant === 'impact' &&
        !!atPos &&
        (event.softImpactPositions ?? []).some(([r, c]) => r === atPos[0] && c === atPos[1]);

    return (
        <span
            className={[
                'skill-fx',
                `skill-fx-kind-${event.profile.kind}`,
                variantClass,
                event.owner === 'player1' ? 'skill-fx-owner-p1' : 'skill-fx-owner-p2',
            ].join(' ')}
            style={style}
            aria-hidden="true"
        >
            {variant === 'caster' && <CasterFx event={event} />}
            {(variant === 'target' || perTargetMain) && <TargetFx event={event} />}
            {variant === 'impact' && !perTargetMain && <ImpactMarkFx soft={isSoftImpact} />}
            {variant === 'area' && <AreaTileFx />}
            {variant === 'splash' && <SplashEmberFx />}
            {variant === 'chain' && <ChainBoltFx />}
        </span>
    );
}

/* ============================================================
   AOE 整体特效（区域级，一张覆盖整个作用范围的跨格子动效）
   与逐格特效叠加：底光/命中印记管"每一格"，这里管"整个范围"。
   覆盖范围由事件 areaBounds（作用区域包围盒 / 全场伤害技整盘）决定。
   ============================================================ */

/** 把包围盒换算成棋盘网格上的绝对定位 CSS 变量（格距 = 格宽 + 6px 间隙） */
function areaBoundsVars(bounds: SkillAreaBounds): CSSProperties {
    return {
        '--sa-r0': String(bounds.r0),
        '--sa-c0': String(bounds.c0),
        '--sa-rows': String(bounds.rows),
        '--sa-cols': String(bounds.cols),
    } as CSSProperties;
}

/** 区域冲击波：中心闪爆 + 双巨环扩张 + 放射地裂 + 外圈碎屑环 */
function AreaShockwaveFx() {
    return (
        <>
            <i className="saf-core" />
            <i className="saf-ring" />
            <i className="saf-ring saf-ring-b" />
            <i className="saf-crack saf-crack-a" />
            <i className="saf-crack saf-crack-b" />
            <i className="saf-crack saf-crack-c" />
            <ParticleRing className="saf-orbit" beginAngle={15} />
            <ParticleRing className="saf-orbit saf-orbit-b" beginAngle={40} reverse />
        </>
    );
}

/** 火海燎原：火焰前锋循攻击方向横扫全区域 + 灼地余晖 + 余烬升腾 */
function AreaFirestormFx() {
    return (
        <>
            <i className="saf-fire-flash" />
            <i className="saf-fire-front" />
            <i className="saf-fire-front saf-fire-front-b" />
            <i className="saf-fire-scorch" />
            <i className="saf-ember saf-ember-1" />
            <i className="saf-ember saf-ember-2" />
            <i className="saf-ember saf-ember-3" />
            <i className="saf-ember saf-ember-4" />
            <i className="saf-ember saf-ember-5" />
        </>
    );
}

/** 雷暴压顶：区域闪白 + 三道落雷错落劈下 + 电弧余韵 */
function AreaThunderstormFx() {
    return (
        <>
            <i className="saf-storm-flash" />
            <i className="saf-thunder saf-thunder-1">
                <svg viewBox="0 0 24 100" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M12 0 L7 30 L15 34 L9 64 L14 68 L10 100" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
                    <path d="M12 0 L7 30 L15 34 L9 64 L14 68 L10 100" fill="none" stroke="#ffffff" strokeWidth="0.9" strokeLinejoin="round" />
                </svg>
            </i>
            <i className="saf-thunder saf-thunder-2">
                <svg viewBox="0 0 24 100" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M12 0 L16 26 L8 32 L17 60 L11 66 L14 100" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
                    <path d="M12 0 L16 26 L8 32 L17 60 L11 66 L14 100" fill="none" stroke="#ffffff" strokeWidth="0.9" strokeLinejoin="round" />
                </svg>
            </i>
            <i className="saf-thunder saf-thunder-3">
                <svg viewBox="0 0 24 100" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M12 0 L9 28 L17 36 L8 62 L13 70 L11 100" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
                    <path d="M12 0 L9 28 L17 36 L8 62 L13 70 L11 100" fill="none" stroke="#ffffff" strokeWidth="0.9" strokeLinejoin="round" />
                </svg>
            </i>
            <i className="saf-storm-haze" />
        </>
    );
}

/** 缚域成形：四边锁栏向内收拢 + 四角封印旋锁 + 中心锁定闪光 */
function AreaCageFx() {
    return (
        <>
            <i className="saf-cage-bar saf-cage-bar-top" />
            <i className="saf-cage-bar saf-cage-bar-bottom" />
            <i className="saf-cage-bar saf-cage-bar-left" />
            <i className="saf-cage-bar saf-cage-bar-right" />
            <i className="saf-cage-seal saf-cage-seal-tl" />
            <i className="saf-cage-seal saf-cage-seal-tr" />
            <i className="saf-cage-seal saf-cage-seal-bl" />
            <i className="saf-cage-seal saf-cage-seal-br" />
            <i className="saf-cage-flash" />
        </>
    );
}

/** 守护法阵：覆盖范围的双层对旋巨符环 + 错落升起的光柱 + 底光呼吸 */
function AreaRuneArrayFx() {
    return (
        <>
            <i className="saf-rune-glow" />
            <i className="saf-rune" />
            <i className="saf-rune saf-rune-b" />
            <i className="saf-rune-pillar saf-rune-pillar-1" />
            <i className="saf-rune-pillar saf-rune-pillar-2" />
            <i className="saf-rune-pillar saf-rune-pillar-3" />
        </>
    );
}

/** 领域地波：贴地椭圆波由中心荡开至区域边缘 + 区域辉光滞留 */
function AreaGroundwaveFx() {
    return (
        <>
            <i className="saf-gwave-glow" />
            <i className="saf-gwave" />
            <i className="saf-gwave saf-gwave-b" />
            <i className="saf-gwave-wisp saf-gwave-wisp-a" />
            <i className="saf-gwave-wisp saf-gwave-wisp-b" />
        </>
    );
}

/** 巨刃横扫：循攻击方向掠过整片区域的双重大弧刃 + 扫过闪光 */
function AreaSlashwaveFx() {
    return (
        <>
            <i className="saf-slash-flash" />
            <i className="saf-slash" />
            <i className="saf-slash saf-slash-b" />
        </>
    );
}

/** 冰刺天降：成片冰锥自空砸落覆盖整个区域 + 落地碎冰 + 严寒雾 */
function AreaIceSpikesFx() {
    return (
        <>
            <i className="saf-frost-flash" />
            {[1, 2, 3, 4, 5, 6, 7].map(index => (
                <i key={index} className={`saf-icepike saf-icepike-${index}`}>
                    <svg viewBox="0 0 28 96" aria-hidden="true">
                        <path d="M14 0 L24 74 L14 96 L4 74 Z" fill="currentColor" opacity="0.92" />
                        <path d="M14 2 L14 94" stroke="#ffffff" strokeWidth="1.6" opacity="0.85" />
                    </svg>
                </i>
            ))}
            <i className="saf-frost-mist" />
        </>
    );
}

/** 破冰爆震：区域闪白 + 冰棱自中心向外环射 + 霜原滞留辉光 + 震环 */
function AreaShatterFx() {
    return (
        <>
            <i className="saf-shatter-flash" />
            <i className="saf-shatter-field" />
            <i className="saf-shatter-ring" />
            <i className="saf-shatter-ring saf-shatter-ring-b" />
            {[0, 1, 2, 3, 4, 5, 6, 7].map(index => (
                <i
                    key={index}
                    className="saf-shatter-pike"
                    style={{ '--sa-angle': `${index * 45 + 22}deg`, '--sa-i': index } as CSSProperties}
                >
                    <svg viewBox="0 0 28 96" aria-hidden="true">
                        <path d="M14 0 L24 74 L14 96 L4 74 Z" fill="currentColor" opacity="0.9" />
                        <path d="M14 2 L14 94" stroke="#ffffff" strokeWidth="1.6" opacity="0.85" />
                    </svg>
                </i>
            ))}
            <i className="saf-shatter-mist" />
        </>
    );
}

/** AOE 整体特效渲染入口：渲染在棋盘网格层（跨格子绝对定位），每个事件一张 */
export function SkillAreaFx({ event }: { event: SkillFxEvent }) {
    const bounds = event.areaBounds;
    if (!bounds) return null;
    const archetype = resolveAreaFxKind(event.profile.kind);
    return (
        <span
            className={[
                'skill-area-fx',
                `skill-area-fx-${archetype}`,
                event.owner === 'player1' ? 'skill-fx-owner-p1' : 'skill-fx-owner-p2',
            ].join(' ')}
            style={{ ...fxStyleVars(event), ...areaBoundsVars(bounds) }}
            aria-hidden="true"
        >
            {archetype === 'shockwave' && <AreaShockwaveFx />}
            {archetype === 'firestorm' && <AreaFirestormFx />}
            {archetype === 'thunderstorm' && <AreaThunderstormFx />}
            {archetype === 'cage' && <AreaCageFx />}
            {archetype === 'runearray' && <AreaRuneArrayFx />}
            {archetype === 'groundwave' && <AreaGroundwaveFx />}
            {archetype === 'slashwave' && <AreaSlashwaveFx />}
            {archetype === 'icespikes' && <AreaIceSpikesFx />}
            {archetype === 'iceshatter' && <AreaShatterFx />}
        </span>
    );
}
