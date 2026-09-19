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
import { WindBladeGlyph } from './WindBladeGlyph';
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
        case 'fengling-claw':
        case 'fengling-pounce':
            // 风铃起手：残影沿闪袭方向铺开（天威跨多格时拖尾更长）
            return <FenglingPounceFx />;
        case 'yunying-sweep':
            // 云缨起手：长枪在周身凌乱横扫，弧刃以自身为圆心甩开
            return <YunyingSweepFx />;
        case 'yunying-thrust':
            // 云缨起手：枪尖前送拉出一段速度光痕，突刺本体在命中格贯出
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fxp-trail" />
                </span>
            );
        case 'liehuo-blaze':
            // 烈火燎原起手：火种在云缨脚下炸开，火线由她向外逐格烧出去
            return <LiehuoIgniteHubFx />;
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
        case 'wind-blade-volley':
            // 四向风刃是自身技，四弯风刃自施法者格射向周身四格
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <WindBladeVolleyFx />
                </span>
            );
        case 'xueqi-scythe':
            // 血誓横扫（天威复用）：血镰绕自身旋满一圈，扫过周身一格
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <XueqiScytheFx />
                </span>
            );
        case 'zuizhen-throw':
            // 醉掷寒锋：掷刀沿路径疾飞，光轨与逐段疾光把冲刺路线整条点亮
            return <ZuizhenThrowDashFx event={event} />;
        case 'zuizhen-wheel':
            // 醉影换位（起手格）：本体在双涡环中淡去，斩击在落位格展开
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fxp-implode" />
                    <i className="fxp-implode fxp-implode-b" />
                    <i className="fx-zw-vanish" />
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

/** 风铃·掠沙闪袭（起手格）：跨格疾光拖尾 + 三段渐淡残影 + 起跳尘环 */
function FenglingPounceFx() {
    return (
        <span className="fx-anchor fx-flp">
            <i className="fx-flp-streak" />
            <i className="fx-flp-echo fx-flp-echo-1" />
            <i className="fx-flp-echo fx-flp-echo-2" />
            <i className="fx-flp-echo fx-flp-echo-3" />
            <i className="fx-flp-dust" />
        </span>
    );
}

/** 风铃·爪牙撕裂（命中格）：三道爪痕沿攻击方向扇形依次撕开，每道带白热爪尖 */
function FenglingClawFx() {
    return (
        <span className="fx-anchor fx-flc">
            <i className="fx-flc-slash fx-flc-slash-1"><b className="fx-flc-tip" /></i>
            <i className="fx-flc-slash fx-flc-slash-2"><b className="fx-flc-tip" /></i>
            <i className="fx-flc-slash fx-flc-slash-3"><b className="fx-flc-tip" /></i>
            <i className="fx-flc-rip" />
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
            <Shards count={5} />
        </span>
    );
}

/** 云缨·星火照野（起手格）：四道弧刃按先后顺序逐条甩开 + 收势时一记枪杆抽打 */
function YunyingSweepFx() {
    return (
        <span className="fx-anchor fx-yys">
            <i className="fx-yys-arc fx-yys-arc-1" />
            <i className="fx-yys-arc fx-yys-arc-2" />
            <i className="fx-yys-arc fx-yys-arc-3" />
            <i className="fx-yys-arc fx-yys-arc-4" />
            <i className="fx-yys-shaft" />
            <i className="fxp-hitflash" />
            <Shards count={5} />
        </span>
    );
}

/** 云缨·踏火长驱（命中格）：一杆长枪（枪杆+枪头+红缨）贯出一记，到位时炸震环 */
function YunyingThrustFx() {
    return (
        <span className="fx-anchor fx-yyt">
            <i className="fx-yyt-speed fx-yyt-speed-1" />
            <i className="fx-yyt-speed fx-yyt-speed-2" />
            <i className="fx-yyt-spear">
                <b className="fx-yyt-bar" />
                <b className="fx-yyt-head" />
                <b className="fx-yyt-tassel" />
            </i>
            <i className="fx-yyt-wave" />
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
            <Shards count={6} />
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

/** 一段圆弧坐标（viewBox 100×100，圆心 50,50；0°=右、顺时针，270°=正上方） */
function arcPoint(r: number, deg: number): string {
    const a = (deg * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
}

/** 环形扇面：外弧顺行 → 落到内半径 → 内弧逆行 → 闭合。
 *  中段厚实、两端收到刀锋，正是俯视下一道翻卷浪头的轮廓——
 *  等宽描边只会画出一根彩虹拱。 */
function crescentPath(rOuter: number, rInner: number, fromDeg: number, toDeg: number): string {
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M${arcPoint(rOuter, fromDeg)} ` +
        `A${rOuter} ${rOuter} 0 ${large} 1 ${arcPoint(rOuter, toDeg)} ` +
        `L${arcPoint(rInner, toDeg)} ` +
        `A${rInner} ${rInner} 0 ${large} 0 ${arcPoint(rInner, fromDeg)} Z`;
}

/** 一道浪分三层叠出体积：背光的水壁 → 受光的浪腹 → 翻卷出来的白沫浪尖。
 *  俯视棋盘上没有透视，"立体"全靠这套明暗分层加一道投影交代离地高度。 */
const LINGXI_WAVE_LAYERS = [
    { cls: 'fx-wave-shade', d: crescentPath(46, 24, 200, 340) },
    { cls: 'fx-wave-body', d: crescentPath(46, 33, 203, 337) },
    { cls: 'fx-wave-face', d: crescentPath(46, 39, 207, 333) },
    { cls: 'fx-wave-lip', d: crescentPath(46, 43, 213, 327) },
];

/** 翻卷的浪头：涌起→前倾翻卷→压扁拍碎，动画在 CSS 里按实例类分派 */
function WaveCrestGlyph({ className, style }: { className: string; style?: CSSProperties }) {
    return (
        <i className={className} style={style} aria-hidden="true">
            <svg viewBox="0 0 100 100">
                {LINGXI_WAVE_LAYERS.map(layer => (
                    <path key={layer.cls} className={layer.cls} d={layer.d} />
                ))}
            </svg>
        </i>
    );
}

/** 涟漪环轮廓：半径沿角度做低幅正弦起伏，让一圈浪略带自然的卵形，
 *  而不是几何正圆——正圆描边在浅色盘面上读作瞄准环。 */
function rippleRingPath(radius: number, crests: number, amp: number, phase: number): string {
    const steps = 72;
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const r = radius * (1 + amp * Math.sin(a * crests + phase));
        pts.push(`${i === 0 ? 'M' : 'L'}${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`);
    }
    return `${pts.join(' ')} Z`;
}

/** 一道余波涟漪的两条描边：外圈迎光的浪峰，内圈偏暗一档即波谷阴影 */
function rippleRing(crests: number, amp: number, phase: number) {
    return {
        crest: rippleRingPath(46, crests, amp, phase),
        trough: rippleRingPath(41.5, crests, amp, phase),
    };
}

/** 三道余波涟漪：浪拍碎之后一圈圈向外荡 */
const LINGXI_RIPPLE_RINGS = [0, 1, 2].map(i => rippleRing(3, 0.016, i * 1.4));

/** 区域级大浪环：自潮心荡向区缘的潮头 */
const LINGXI_TIDE_RINGS = [0, 1, 2].map(i => rippleRingPath(46, 3, 0.02, i * 1.9));

/** 泠汐·技能一「海螺回响」：潮面漫染 → 浪头涌起翻卷拍碎 → 余波涟漪逐圈荡开 */
function LingxiWaveFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-ripple-wash" />
            <i className="fx-wave-cast" />
            <WaveCrestGlyph className="fx-wave" />
            {LINGXI_RIPPLE_RINGS.map((ring, i) => (
                <i key={i} className={`fx-ripple fx-ripple-${i + 1}`} aria-hidden="true">
                    <svg viewBox="0 0 100 100">
                        <path className="fx-ripple-trough" d={ring.trough} vectorEffect="non-scaling-stroke" />
                        <path className="fx-ripple-crest" d={ring.crest} vectorEffect="non-scaling-stroke" />
                    </svg>
                </i>
            ))}
            <i className="fx-wave-spray fx-wave-spray-1" />
            <i className="fx-wave-spray fx-wave-spray-2" />
            <i className="fx-wave-spray fx-wave-spray-3" />
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

/** 云缨·烈火燎原（射线上的每一格）：火舌自地面窜起，灼环烙在格心，余烬上腾。
 *  起燃时刻由 --fx-ray-delay 逐格推后，看上去是一道火线往前烧。 */
function LiehuoBlazeCellFx({ tall = false }: { tall?: boolean }) {
    return (
        <span className={`fx-anchor fx-lhb${tall ? ' fx-lhb-tall' : ''}`}>
            <i className="fx-lhb-heat" />
            <i className="fx-lhb-base" />
            <i className="fx-lhb-tongue fx-lhb-tongue-1" />
            <i className="fx-lhb-tongue fx-lhb-tongue-2" />
            <i className="fx-lhb-tongue fx-lhb-tongue-3" />
            <Sparks count={4} className="fxp-spark-ember" />
        </span>
    );
}

/** 云缨·烈火燎原（云缨脚下）：火种炸开，火线由此向外铺开 */
function LiehuoIgniteHubFx() {
    return (
        <span className="fx-anchor fx-lhb-hub">
            <i className="fx-lhb-core" />
            <i className="fx-lhb-ring" />
            <Sparks count={6} className="fxp-spark-ember" />
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

/** 四向风刃：中央气流绽开 + 四弯风刃分射上下左右（刃身与落地陷阱同一图形） */
function WindBladeVolleyFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-ring" />
            {(['0', '90', '180', '270'] as const).map(rot => (
                <i key={rot} className="fx-wbv-dir" style={{ '--wb-rot': `${rot}deg` } as CSSProperties}>
                    <i className="fx-wbv-blade">
                        <i className="fx-wbv-trail" />
                        <WindBladeGlyph className="fx-wbv-glyph" />
                    </i>
                </i>
            ))}
            <Sparks count={4} className="fxp-spark-wind" />
        </span>
    );
}

/** 血契镰刀：弯月刃 + 长柄 + 缠绳，刃尖朝 -x（绕身旋转时刃尖先行） */
function ScytheGlyph({ className = '' }: { className?: string }) {
    return (
        <svg className={className} viewBox="-12 -12 24 24" aria-hidden="true">
            <path className="xq-haft" d="M2.6 -6.2 L9.4 9.6" />
            <path className="xq-wrap" d="M4.2 -2.6 l3.2 -1.2 M5.4 0.4 l3.2 -1.2" />
            <path className="xq-blade" d="M-11.4 -5.6 C -9.2 -11.2 -1.6 -11.8 2.6 -6.2 C -1.8 -8 -6.6 -7.4 -9.4 -3.4 Z" />
            <path className="xq-edge" d="M-11.4 -5.6 C -9.2 -11.2 -1.6 -11.8 2.6 -6.2" />
        </svg>
    );
}

/**
 * 血镰旋环：一柄血镰绕施法者格心转满一圈，刀尖拖着血色扫弧划过周身。
 * 只服务血誓横扫（天威复用同一档案），血契锁仍走笼环收拢的束缚原型。
 */
function XueqiScytheFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-xs-orbit">
                <i className="fx-xs-trail" />
                <i className="fx-xs-scythe"><ScytheGlyph className="fx-xs-glyph" /></i>
            </i>
            <i className="fx-xs-ring" />
            <i className="fx-xs-hitflash" />
            <Sparks count={5} />
        </span>
    );
}

/* ============================================================
   醉枕刀专属：醉掷寒锋（疾影光轨）/ 醉影换位（太刀旋斩）
   ============================================================ */

/** 冲刺路径上的逐段疾光（三段先后掠过同一条光轨，营造高速残影感） */
function ZuizhenThrowDashFx({ event }: { event: SkillFxEvent }) {
    return (
        <span className="fx-anchor" style={fxStyleVars(event)}>
            <i className="fx-zt-rail" />
            <i className="fx-zt-rail fx-zt-rail-b" />
            <i className="fx-zt-streak fx-zt-streak-1" />
            <i className="fx-zt-streak fx-zt-streak-2" />
            <i className="fx-zt-streak fx-zt-streak-3" />
            <i className="fx-zt-knife" />
            <i className="fx-beam-muzzle fxp-muzzle" />
            <i className="fx-zt-kick" />
        </span>
    );
}

/** 贯斩命中特写：爆闪核 + 双刀交叉斩痕 + 冲击双环 + 晶屑光尘。
 *  各零件统一延后 --zt-hit-delay 起播——那是冲刺抵达本格的时刻 */
function ZuizhenThrowHitFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-zt-burst" />
            <i className="fx-zt-slash fx-zt-slash-a" />
            <i className="fx-zt-slash fx-zt-slash-b" />
            <i className="fx-zt-wave" />
            <i className="fx-zt-wave fx-zt-wave-b" />
            <Shards count={3} />
            <Sparks count={3} className="fxp-spark-fast" />
        </span>
    );
}

/** 沿路跟踪格：一格一盏琥珀光痕 + 疾光与回声顺着本格的前进方向掠过，
 *  起播时刻由 --fx-path-step（刀跑到第几格）驱动，整条路径亮起来即"光的足迹" */
function ZuizhenThrowPathFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-zt-ptile" />
            <i className="fx-zt-pass" />
            <i className="fx-zt-pass fx-zt-pass-b" />
        </span>
    );
}

/** 太刀（刀柄钉在格心、刀身沿 +x 径向伸出，顺时针旋转时整刃绕中心扫圆） */
function KatanaGlyph() {
    return (
        <svg className="fx-zw-glyph" viewBox="0 0 170 60" aria-hidden="true">
            <path className="zw-blade" d="M22 34 Q90 24 158 12 Q161 13 160 17 Q92 31 26 42 Z" />
            <path className="zw-edge" d="M22 34 Q90 24 158 12" />
            <circle className="zw-tsuba" cx="18" cy="36" r="5.4" />
            <path className="zw-hilt" d="M17 39 L3 47" />
        </svg>
    );
}

/** 旋刃斩痕圈：八道短斩痕按刀锋扫过的顺序依次点亮，标出"周围一圈"的界
 *  （太刀起势刀尖朝东，顺时针一周：东→东南→南→西南→西→西北→北→东北） */
const WHEEL_TICK_ANGLES = [90, 135, 180, 225, 270, 315, 0, 45];

/** 醉影换位（落位格）：凝环收拢落位 → 一柄太刀绕格心旋满一周，
 *  刃尖拖出主副两道旋扫弧 + 一道渐隐余痕，周身八道斩痕随扫过依次亮起 */
function ZuizhenBladeWheelFx() {
    return (
        <span className="fx-anchor">
            <i className="fxp-implode" />
            <i className="fxp-implode fxp-implode-b" />
            <i className="fx-zw-orbit">
                <i className="fx-zw-trail" />
                <i className="fx-zw-trail fx-zw-trail-b" />
                <i className="fx-zw-katana"><KatanaGlyph /></i>
            </i>
            <i className="fx-zw-hub" />
            <i className="fx-zw-orbit fx-zw-orbit-echo">
                <i className="fx-zw-trail fx-zw-trail-echo" />
            </i>
            {WHEEL_TICK_ANGLES.map((angle, index) => (
                <i
                    key={angle}
                    className="fx-zw-tick"
                    style={{ '--zw-a': `${angle}deg`, '--zw-i': index } as CSSProperties}
                />
            ))}
            <i className="fxp-hitflash fxp-hitflash-big" />
            <i className="fxp-ring" />
            <i className="fxp-ring fxp-ring-b" />
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
        case 'xueqi-scythe':
            // 血镰扫过的每一格：爆点由环形爆发零件承担，配色随血契档案
            return <RadialBurstFx />;
        case 'zuizhen-throw':
            // 醉掷寒锋（落点格/沿途每格）：疾影贯斩——爆闪核 + 交刃斩光 + 双冲击环
            return <ZuizhenThrowHitFx />;
        case 'zuizhen-wheel':
            // 醉影换位（落位格）：太刀绕格心旋满一周，刃尖拖出旋扫弧光，周身斩痕依次亮起
            return <ZuizhenBladeWheelFx />;
        case 'fengling-claw':
        case 'fengling-pounce':
            // 风铃落点：爪牙撕咬特写（天威由 pounce 档案加重拖尾与配色）
            return <FenglingClawFx />;
        case 'yunying-thrust':
            // 云缨落点：整杆长枪贯出一记，刺到位时炸出震环并震格
            return <YunyingThrustFx />;
        case 'yunying-sweep':
            // 3×3 的次要命中格只点一记爆点，弧刃主效由起手格那份承担
            return <RadialBurstFx />;
        case 'crystal-shatter':
            return <CrystalShatterFx />;
        case 'ember-flare':
            return <EmberFlareFx />;
        case 'liehuo-blaze':
            // 烈火燎原首格：这道火线的第一格烧得最高
            return <LiehuoBlazeCellFx tall />;
        case 'storm-bolt':
            return <StormBoltFx />;
        case 'gale-vortex':
            return <GaleVortexFx />;
        case 'wind-blade-volley':
            // 自身技：目标格与起手格重合，四弯风刃已由 caster 变体承载，这里只补气流绽放
            return (
                <span className="fx-anchor">
                    <i className="fxp-auraglow" />
                </span>
            );
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

    // 醉枕刀冲刺：主落点（target）、打到的格（impact）与路过的格（area）
    // 全部按"刀跑到第几步"起播（--fx-path-step），末格特写压轴晚于一切沿途格；
    // 疾光零件（area）再把 --fx-rot 改成本格前进方向，让光真正沿着绕路序列跟踪
    if (atPos && event.profile.kind === 'zuizhen-throw') {
        const covered = event.coveredPositions ?? [];
        const pathIndex = covered.findIndex(([r, c]) => r === atPos[0] && c === atPos[1]);
        const isLast = pathIndex === covered.length - 1;
        const pathSteps = pathIndex >= 0
            ? (isLast ? covered.length + 1 : pathIndex + 1)
            : Math.max(
                Math.abs(atPos[0] - event.fromPos[0]),
                Math.abs(atPos[1] - event.fromPos[1])
            );
        style = { ...style, '--fx-path-step': String(pathSteps) } as CSSProperties;
        if (variant === 'area' && pathIndex >= 0) {
            const prev = pathIndex === 0 ? event.fromPos : covered[pathIndex - 1];
            style = {
                ...style,
                '--fx-rot': `${computeFxAngleDeg(prev, atPos)}deg`,
            } as CSSProperties;
        }
    }

    // 烈火燎原：射线上的第 N 格晚 N 拍起燃（--fx-ray-delay），让火是一路烧过去的
    // 而不是整条线同帧点亮；云缨脚下那一格始终是最先引爆的火种
    if (atPos && event.profile.kind === 'liehuo-blaze') {
        const rayIndex = (event.coveredPositions ?? [])
            .findIndex(([r, c]) => r === atPos[0] && c === atPos[1]);
        style = {
            ...style,
            '--fx-ray-delay': `${Math.max(0, rayIndex) * LIEHUO_STEP_MS}ms`,
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
            {variant === 'area' && (event.profile.kind === 'zuizhen-throw'
                ? <ZuizhenThrowPathFx />
                : event.profile.kind === 'liehuo-blaze'
                    ? <LiehuoBlazeCellFx />
                    : <AreaTileFx />)}
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

/** 燎原火墙沿射线逐格起燃的间隔（毫秒）——一格一拍，火才看得出是在往前烧 */
const LIEHUO_STEP_MS = 150;

/** 燎原火墙：火线自云缨那一端沿射线长到棋盘尽头 + 焦痕 + 沿轴向飘的余烬 */
function AreaFirewallFx() {
    // 余烬按 --fw-i 沿攻击轴分布（-1..1 对应射线两端），轴向由 --fx-travel-x/y 决定，
    // 因此同一套零件在横烧与竖烧下都沿着这条线排布
    const offsets = [-1, -0.5, 0, 0.5, 1];
    return (
        <>
            <i className="saf-fw-scorch" />
            <i className="saf-fw-wash" />
            <i className="saf-fw-wash saf-fw-wash-b" />
            <i className="saf-fw-edge" />
            {offsets.map((ratio, index) => (
                <i
                    key={index}
                    className="saf-fw-ember"
                    style={{ '--fw-i': String(ratio), '--fw-d': `${120 + index * 130}ms` } as CSSProperties}
                />
            ))}
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

/** 潮纹涟漪（区域级）：潮水漫过作用区 + 三道大浪环自潮心荡向区缘 + 浪沫漂移。
 *  立体浪头刻意不放这一层——区域特效在格底光之下，再厚的浪也会被盘面洗淡，
 *  翻卷的浪头交给逐格主效去承担，打中谁就在谁脚下起浪。 */
function AreaRippleTideFx() {
    return (
        <>
            <i className="saf-tide-wash" />
            {LINGXI_TIDE_RINGS.map((d, i) => (
                <i key={i} className={`saf-tide-ring saf-tide-ring-${i + 1}`} aria-hidden="true">
                    <svg viewBox="0 0 100 100">
                        <path d={d} vectorEffect="non-scaling-stroke" />
                    </svg>
                </i>
            ))}
            <i className="saf-tide-foam saf-tide-foam-a" />
            <i className="saf-tide-foam saf-tide-foam-b" />
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
            {archetype === 'firewall' && <AreaFirewallFx />}
            {archetype === 'thunderstorm' && <AreaThunderstormFx />}
            {archetype === 'cage' && <AreaCageFx />}
            {archetype === 'runearray' && <AreaRuneArrayFx />}
            {archetype === 'rippletide' && <AreaRippleTideFx />}
            {archetype === 'groundwave' && <AreaGroundwaveFx />}
            {archetype === 'slashwave' && <AreaSlashwaveFx />}
            {archetype === 'icespikes' && <AreaIceSpikesFx />}
            {archetype === 'iceshatter' && <AreaShatterFx />}
        </span>
    );
}
