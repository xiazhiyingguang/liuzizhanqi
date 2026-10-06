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
import { memo, useEffect, useId, type CSSProperties } from 'react';
import { WindBladeGlyph } from './WindBladeGlyph';
import { MirrorBladeLaunchFx, MirrorBladeImpactFx } from './MirrorBladeFx';
import { SkillThemeCasterFx, SkillThemeTargetFx } from './SkillThemeFx';
import { WukongCloudFx, WukongFigureGlyph, WukongGroundFx, WukongStaffWakeFx, WukongDebrisFx } from './WukongFxDetails';
import { SpectralSkillFx } from './SpectralSkillFx';
import { CraftedSkillFx } from './CraftedSkillFx';
import { YunyingSpearGlyph, YunyingArcRibbon, YunyingFlameGlyph, YunyingSwingSpear } from './YunyingFxDetails';
import { WangcaiAwakenFx } from './WangcaiAwakenFx';
import { WangshuMoonFx } from './WangshuMoonFx';
import { LingxiRippleFx, LingxiWaterTouchFx } from './LingxiRippleFx';
import { LingxiTideCastFx, LingxiTideImpactFx } from './LingxiTideFx';
import { MechanismSkillFx } from './MechanismSkillFx';
import {
    HuanongyingFanAreaFx,
    HuanongyingFanCasterFx,
    HuanongyingFanImpactFx,
    HuanongyingReplayImpactFx,
    HuanongyingReplaySourceFx,
    HuanongyingSwapCasterFx,
    HuanongyingSwapTargetFx,
} from './HuanongyingFx';
import '../../styles/wukong-skill-fx.css';
import '../../styles/zhiyuan-skill-fx.css';
import '../../styles/xihuan-skill-fx.css';
import '../../styles/jiangtaigong-skill-fx.css';
import '../../styles/huanongying-skill-fx.css';
import '../../styles/jinghong-skill-fx.css';
import type { Position, SkillAreaBounds, SkillFxEvent } from '../../core/skill-fx';
import { computeFxAngleDeg, computeFxCellDelayMs, computeFxImpactDelayMs, computeFxTravelMs, computeFxTailMs, isPerTargetFxKind, PRISM_BEAM_STEP_MS, resolveAreaFxKind } from '../../core/skill-fx';
import { useGameStore } from '../../store/game-store';
import { isLowQuality, scaleParticleCount } from '../../core/render-quality';

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
        '--fx-travel-ms': `${computeFxTravelMs(event)}ms`,
        '--fx-hit-ms': `${computeFxImpactDelayMs(event, event.targetPos)}ms`,
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
    const themed = SkillThemeCasterFx({ event });
    if (themed) return themed;
    switch (event.profile.kind) {
        case 'mirror-blades':
            return <MirrorBladeLaunchFx event={event} />;
        case 'wukong-clone':
            return (
                <span className="fx-anchor wk-hair-source" style={fxStyleVars(event)}>
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
                            <i className="wk-hair-thread" />
                            <HairGlyph />
                        </i>
                    </i>
                </span>
            );
        case 'wukong-staff':
            return <span className="fx-anchor wk-staff-source"><i className="wk-staff-gather" /></span>;
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
        case 'yunying-arc-slash':
            // 云缨起手：她这一格只起一道挥斩的起手光，两道火斩落在正前方那排格子上
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fxp-auraglow" />
                </span>
            );
        case 'liehuo-blaze':
            // 烈火燎原起手：火种在云缨脚下炸开，火线由她向外逐格烧出去
            return <LiehuoIgniteHubFx />;
        case 'liehuo-wheel':
            // 燎原百斩起手：她拖着一条火线冲出去，旋斩本体画在落点那一格
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fxp-trail" />
                    <i className="fxp-hitflash" />
                </span>
            );
        case 'prism-beam':
            // 棱光千折起手：出光口在她自己脚下，整条折线光路交给区域层画
            return (
                <span className="fx-anchor" style={fxStyleVars(event)}>
                    <i className="fxp-auraglow" />
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
        case 'huanongying-fan':
            return <HuanongyingFanCasterFx />;
        case 'huanongying-swap':
            return <HuanongyingSwapCasterFx />;
        case 'huanongying-replay':
            return <HuanongyingReplaySourceFx />;
        case 'lingxi-wave':
            return <LingxiRippleFx event={event} />;
        case 'lingxi-fan':
            return <LingxiTideCastFx event={event} />;
        case 'jinghong-slash-ring':
            // 惊鸿·环海旋斩：整圈斩痕以施法者为心划出，只在她脚下这一份
            return <JinghongSlashRingFx event={event} />;
        case 'jinghua-moonblade':
            // 镜花·天威起手：月华在她脚下凝成一弯刃，真正的飞斩画在敌人那一格
            return <JinghuaMoonGatherFx />;
        case 'moran-inkway':
            // 墨阑·入道起手：一笔在脚下画成墨环，劈出去的那一记画在目标格
            return <MoranInkwayGatherFx />;
        case 'duosui-reckon':
            // 偿岁收回来的那笔血落在夺岁自己身上，盾环在他脚下合拢
            return <DuosuiGuardFx />;
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
        case 'heal-wave':
            // 群体恢复起手：波从施法者身上荡出去，同心环一路漫到作用区边缘，
            // 受益格各自的细光柱由 target/impact/area 三个变体补上
            return <HealWaveSourceFx />;
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
    // 低画质减半后按新数量重新均分圆周，否则半圈空着会看出一边倒
    const count = scaleParticleCount(PARTICLE_COUNT);
    return (
        <i className={['fx-orbit', ...(reverse ? ['fx-orbit-reverse'] : []), ...(className ? [className] : [])].join(' ')}>
            {Array.from({ length: count }).map((_, index) => (
                <b
                    key={index}
                    style={{ '--fx-angle': `${beginAngle + index * (360 / count)}deg` } as CSSProperties}
                />
            ))}
        </i>
    );
}

/** 晶屑飞溅：n 枚菱形晶粒按预设方向散开（配色取档案） */
function Shards({ count }: { count: number }) {
    const parts = scaleParticleCount(count);
    return (
        <>
            {Array.from({ length: parts }).map((_, index) => (
                <i key={index} className={`fxp-shard fxp-shard-${index + 1}`} />
            ))}
        </>
    );
}

/** 上浮微光：n 粒光点自下而上飘起（祝福/增益/余烬共用，类名决定节奏） */
function Sparks({ count, className = '' }: { count: number; className?: string }) {
    const parts = scaleParticleCount(count);
    return (
        <>
            {Array.from({ length: parts }).map((_, index) => (
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
    const shards = scaleParticleCount(count);
    return (
        <>
            {Array.from({ length: shards }).map((_, index) => (
                <i
                    key={index}
                    className="fx-iceshard"
                    style={{
                        '--sh-angle': `${(360 / shards) * index + 14}deg`,
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
        <span className="fx-anchor wk-clone">
            <WukongCloudFx />
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
            <i className="fx-clone-figure"><WukongFigureGlyph /></i>
            <WukongCloudFx front />
            <i className="wk-clone-sweep" />
        </span>
    );
}

/** 悟空·金箍棒砸击：如意金箍棒自空中伸展砸落 + 冲击双环 + 地裂 + 金星迸溅 + 尘土 */
function WukongStaffFx({ event }: { event: SkillFxEvent }) {
    return (
        <span className="fx-anchor wk-staff" style={fxStyleVars(event)}>
            <WukongStaffWakeFx />
            <i className="fx-staff">
                <b className="fx-staff-shaft" />
                <b className="wk-staff-etch" />
                <b className="wk-staff-sheen" />
                <b className="fx-staff-cap fx-staff-cap-top" />
                <b className="fx-staff-cap fx-staff-cap-bottom" />
            </i>
            <i className="fx-staff-blur" />
            <i className="fx-staff-core" />
            <i className="fx-impact" />
            <i className="wk-impact-rim" />
            <WukongGroundFx />
            <WukongDebrisFx />
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

/**
 * 姜太公·垂钩：钓线自上方垂落，钩尖触水那一下荡开两圈涟漪。
 * 技能一落钩与敌人上钩共用这套语言，区别只在涟漪之后有没有人跟着浮上来。
 */
function JiangtaigongCastFx() {
    return (
        <span className="fx-anchor">
            <i className="fxjtg-line" />
            <i className="fxjtg-hook" />
            <i className="fxjtg-ripple" />
            <i className="fxjtg-ripple fxjtg-ripple-b" />
        </span>
    );
}

/** 姜太公·抛掷：钓线沿攻击轴绷紧甩过去，落点炸开一圈水花与八散水珠 */
function JiangtaigongThrowFx() {
    return (
        <span className="fx-anchor">
            <i className="fxjtgt-rope" />
            <i className="fxjtgt-splash" />
            {Array.from({ length: 8 }).map((_, index) => (
                <i
                    key={index}
                    className="fxjtgt-drop"
                    style={{ '--fx-angle': `${index * 45}deg` } as CSSProperties}
                />
            ))}
        </span>
    );
}

/** 姜太公·鲸落：整头巨鲸破水腾空、空中翻身拱背，再头朝下砸回水里，激起水幕、水冠与浪环 */
function JiangtaigongWhaleFallFx() {
    return (
        <span className="fx-anchor">
            <i className="fxjtgw-surface" />
            <i className="fxjtgw-sheet" />
            <span className="fxjtgw-whale">
                <svg viewBox="0 0 200 112" aria-hidden="true">
                    <path className="fxjtgw-whale-body" d="M40 52C66 33 108 24 140 29C160 32 176 40 186 50C193 57 193 65 184 70C176 74 162 77 148 78C118 82 82 78 54 67L40 58C31 70 18 85 6 98C15 86 22 72 24 58C22 44 15 30 6 20C18 33 31 45 40 52Z" />
                    <path className="fxjtgw-whale-belly" d="M54 67C82 78 118 82 148 78C162 77 176 74 184 70C186 73 180 77 168 79C142 84 100 83 68 74C58 71 52 69 54 67Z" />
                    <path className="fxjtgw-whale-fin" d="M120 78C112 90 96 99 78 100C90 90 100 82 108 74C112 72 118 74 120 78Z" />
                    <path className="fxjtgw-whale-dorsal" d="M112 28C114 21 120 19 126 22C122 25 118 27 116 29Z" />
                    <path className="fxjtgw-whale-pleats" d="M96 79C118 82 140 81 158 76M88 74C110 78 134 77 152 71" />
                    <path className="fxjtgw-whale-mouth" d="M188 60C178 68 162 72 144 73" />
                    <circle className="fxjtgw-whale-eye" cx="172" cy="62" r="2.4" />
                </svg>
            </span>
            {[0, 1, 2, 3].map(i => (
                <b key={i} className="fxjtgw-drip" style={{ '--drip-x': `${(i - 1.5) * 15}%`, '--drip-delay': `${250 + i * 45}ms` } as CSSProperties} />
            ))}
            <i className="fxjtgw-flash" />
            <i className="fxjtgw-crown" />
            {[-168, -136, -108, -90, -72, -44, -16].map(angle => (
                <b key={angle} className="fxjtgw-spray" style={{ '--fx-angle': `${angle}deg` } as CSSProperties} />
            ))}
            <i className="fxjtgw-wave" />
            <i className="fxjtgw-wave fxjtgw-wave-b" />
        </span>
    );
}

/** 羲和·均光：一圈曦光从她自己身上荡开，横面再扫过一道平光，把这一片友方的血量抹平 */
function XihuanLevelFx() {
    return (
        <span className="fx-anchor">
            <i className="fxhl-ring fxhl-ring-a" />
            <i className="fxhl-ring fxhl-ring-b" />
            <i className="fxhl-sweep" />
            <i className="fxhl-core" />
            <Sparks count={5} />
        </span>
    );
}

/**
 * 纸鸢·断线冲天：线轴一次烧光，五道斜斩在她身前来回乱劈。
 * 每道刃各自的角度、横向错位与起播时刻都不同，且左右交替（--fxzr-dir 决定扫掠方向），
 * 刻意不做成整齐三连——这一手要的是"断了线的鸢子乱甩"那股失控劲。
 */
function ZhiyuanReelFx() {
    return (
        <span className="fx-anchor">
            <i className="fxzr-slash fxzr-slash-1"><b className="fxzr-core" /></i>
            <i className="fxzr-slash fxzr-slash-2"><b className="fxzr-core" /></i>
            <i className="fxzr-slash fxzr-slash-3"><b className="fxzr-core" /></i>
            <i className="fxzr-slash fxzr-slash-4"><b className="fxzr-core" /></i>
            <i className="fxzr-slash fxzr-slash-5"><b className="fxzr-core" /></i>
            <i className="fxzr-thread fxzr-thread-a" />
            <i className="fxzr-thread fxzr-thread-b" />
            <i className="fxp-hitflash" />
            <i className="fxp-ring" />
            <Shards count={5} />
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

/** 云缨·星火照野（起手格）：长枪绕身旋舞一周，四道弧刃是枪尖扫出的残影（170ms 一拍逐条甩开），
 *  收势时枪杆整条抽打一记——先看清"人在转枪"，再谈凌乱枪影 */
function YunyingSweepFx() {
    return (
        <span className="fx-anchor fx-yys fx-yys-quality">
            <i className="fx-yys-circle" />
            <i className="fx-yys-spear"><YunyingSpearGlyph /><i className="yy-spin-fire"><YunyingFlameGlyph /></i></i>
            <i className="fx-yys-arc fx-yys-arc-1"><YunyingArcRibbon /></i>
            <i className="fx-yys-arc fx-yys-arc-2"><YunyingArcRibbon /></i>
            <i className="fx-yys-arc fx-yys-arc-3"><YunyingArcRibbon /></i>
            <i className="fx-yys-arc fx-yys-arc-4"><YunyingArcRibbon /></i>
            <i className="fx-yys-shaft" />
            <i className="fx-yys-ember fx-yys-ember-1" />
            <i className="fx-yys-ember fx-yys-ember-2" />
            <i className="fx-yys-ember fx-yys-ember-3" />
            <i className="fxp-hitflash" />
            <Shards count={5} />
        </span>
    );
}

/** 云缨·踏火长驱（命中格）：这一格只负责"被扫到"的反应——火气腾起 + 爆闪 + 余烬。
 *  刀光本体是区域层那道 120° 红色圆弧挥斩（AreaBladeSweepFx），逐格刻刀痕会看成三刀。
 *  --yas-fwd 让这团的亮起来的那一刻跟上刀锋扫到本格的时机。 */
function YunyingArcSlashFx() {
    return (
        <span className="fx-anchor fx-yas">
            <i className="fx-yas-glow" />
            <i className="fx-yas-flare" />
            <i className="fxp-hitflash" />
            <Sparks count={5} className="fxp-spark-ember" />
        </span>
    );
}

function YunyingSparkImpactFx() {
    return <span className="fx-anchor yy-spark-impact">
        <i className="yy-impact-warmth" />
        <i className="yy-impact-wisp" />
        <Sparks count={4} className="fxp-spark-ember" />
    </span>;
}

/** 叙白·黑白凝珠：三颗阴阳珠自四方汇入 + 环绕旋转成阵（施法瞬间） */
function XubaiPearlsFx() {
    return (
        <span className="fx-anchor fx-pearl-formation">
            <i className="fx-pearl fx-pearl-in-1" />
            <i className="fx-pearl fx-pearl-in-2" />
            <i className="fx-pearl fx-pearl-in-3" />
            <i className="fx-pearl-orbit">
                <i className="fx-pearl-arc fx-pearl-arc-ink" />
                <i className="fx-pearl-arc fx-pearl-arc-white" />
                <b className="fx-pearl-orb fx-pearl-orb-1" />
                <b className="fx-pearl-orb fx-pearl-orb-2" />
                <b className="fx-pearl-orb fx-pearl-orb-3" />
            </i>
            <i className="fx-pearl-bloom" />
        </span>
    );
}

/** 斩痕圆环相对棋盘四边该裁掉多少"格距"（格宽 + 格间距）。
 *  环身正好罩住以她为中心的 5×5，故中心格为 cr/cc 时，
 *  上方越界 (2-cr) 格、下方越界 (cr-3) 格，左右同理；不到 0 就不裁。
 *  贴边施放时斩痕到盘边即止，不会飘到棋盘外面。 */
function slashRingClip(from: Position) {
    return {
        '--fx-clip-t': `${Math.max(0, 2 - from[0])}`,
        '--fx-clip-b': `${Math.max(0, from[0] - 3)}`,
        '--fx-clip-l': `${Math.max(0, 2 - from[1])}`,
        '--fx-clip-r': `${Math.max(0, from[1] - 3)}`,
    } as CSSProperties;
}

/** 惊鸿·环海旋斩：一柄水蓝旋刃以她为心顺时针扫过一整圈。
 *  拖痕分四层叠出锥度——刃头最厚最亮，往后依次收细成一道水线，
 *  转满一周再炸开一圈外飞水沫，才读得出是"斩"而不是一根静止的圆。
 *  半径约 2.1 格正好压在 5×5 外圈那一环的伤害格上。 */
function JinghongSlashRingFx({ event }: { event: SkillFxEvent }) {
    return (
        <span className="fx-anchor">
            <i className="fx-slashring jh-abyss-slash" style={slashRingClip(event.fromPos)}>
                <i className="jh-stillwater" />
                <i className="jh-whirlpool jh-whirlpool-a" />
                <i className="jh-whirlpool jh-whirlpool-b" />
                <i className="jh-orbit">
                    <svg className="jh-wake" viewBox="0 0 100 100" aria-hidden="true">
                        <circle className="jh-wake-shadow" cx="50" cy="50" r="42" pathLength={100} />
                        <circle className="jh-wake-water" cx="50" cy="50" r="42" pathLength={100} />
                        <circle className="jh-wake-foam" cx="50" cy="50" r="42" pathLength={100} />
                    </svg>
                    <i className="jh-waterblade">
                        <svg viewBox="0 0 112 54" aria-hidden="true">
                            <path className="jh-waterblade-shadow" d="M4 43 C25 7 69 -4 108 17 C76 14 43 25 14 50 Z" />
                            <path className="jh-waterblade-body" d="M8 40 C30 11 69 3 103 17 C72 17 43 27 16 47 Z" />
                            <path className="jh-waterblade-core" d="M17 38 C42 16 72 11 96 18 C70 19 46 28 24 42" />
                            <path className="jh-waterblade-edge" d="M8 40 C30 11 69 3 103 17" />
                        </svg>
                        <b className="jh-blade-splash jh-blade-splash-a" />
                        <b className="jh-blade-splash jh-blade-splash-b" />
                    </i>
                </i>
                <i className="jh-wave-crests">
                    {Array.from({ length: 12 }).map((_, index) => (
                        <b
                            key={index}
                            className={`jh-wave-crest jh-wave-crest-${index + 1}`}
                            style={{
                                '--jh-angle': `${index * 30}deg`,
                                // 与 .jh-orbit 的 320ms/360° 匀速巡行同拍：刃头扫到该角度时浪冠才立起
                                '--jh-delay': `${110 + index * 26}ms`,
                            } as CSSProperties}
                        />
                    ))}
                </i>
                <i className="jh-broken-ring" />
                <i className="jh-ring-spray">
                    {Array.from({ length: 14 }).map((_, index) => (
                        <b
                            key={index}
                            style={{
                                '--jh-angle': `${index * (360 / 14)}deg`,
                                '--jh-delay': `${470 + (index % 4) * 18}ms`,
                            } as CSSProperties}
                        />
                    ))}
                </i>
                <i className="jh-finisher-flash" />
            </i>
        </span>
    );
}

/** 月牙刃轮廓：外接框以原点为中心，两尖在 ±y、鼓腹朝 +x。
 *  外层容器按 --fx-rot 旋转后，刃口（凸边）正对着飞行方向，
 *  看上去是"月牙砍过去"而不是"月牙飘过去"。
 *  用贝塞尔而不是 SVG 圆弧：圆弧的大弧/扫掠标志极易配错，
 *  一旦两段弧落到同一个圆上，刃身就填不出面积。 */
const MOONBLADE_PATH = 'M-4.8 -9.4 C 8 -6, 8 6, -4.8 9.4 C 0.4 4.6, 0.4 -4.6, -4.8 -9.4 Z';
/** 刃口弧线：只描外凸那一道，锋锐感全在这里 */
const MOONBLADE_EDGE = 'M-4.8 -9.4 C 8 -6, 8 6, -4.8 9.4';
/** 刃身中线：月华内瓤沿这条脊亮起，两侧仍留深色刃肉 */
const MOONBLADE_CORE = 'M-3.6 -7.2 C 3.8 -4.4, 3.8 4.4, -3.6 7.2';

/** 镜花·月牙刃图形：外晕 + 玄蓝刃体 + 月华内瓤 + 白热锋口。
 *  刻意不用 linearGradient defs：多处同时渲染时 SVG id 会相互覆盖。 */
function MoonBladeGlyph({ className = '' }: { className?: string }) {
    return (
        <svg className={className || undefined} viewBox="-12 -12 24 24" aria-hidden="true">
            <path className="mb-halo" d={MOONBLADE_PATH} />
            <path className="mb-body" d={MOONBLADE_PATH} />
            <path className="mb-core" d={MOONBLADE_CORE} />
            <path className="mb-edge" d={MOONBLADE_EDGE} />
        </svg>
    );
}

/** 镜花·天威起手格：月华在她脚下收拢凝刃，两圈反向螺光 + 出斩闪光 */
function JinghuaMoonGatherFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-moon-swell" />
            <i className="fx-moon-gather" />
            <i className="fx-moon-gather fx-moon-gather-b" />
            <i className="fx-moon-muzzle" />
        </span>
    );
}

/** 镜花·月华飞斩（命中格）：一弯月牙刃自镜花格沿攻击轴斩到本格，
 *  沿途拖出一道月华痕，到位后绽出斩痕印记、双道扩散月环与镜光碎屑。
 *  落在敌人身上的这记要压过棋子，故整段排在刃到位之后才起播。 */
function JinghuaMoonbladeFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-moonblade-trail" />
            <i className="fx-moonblade"><MoonBladeGlyph /></i>
            <i className="fx-moonblade-mark"><MoonBladeGlyph /></i>
            <i className="fx-moonblade-flash" />
            <i className="fx-moonblade-ring" />
            <i className="fx-moonblade-ring fx-moonblade-ring-b" />
            <i className="fxp-shard fxp-shard-1" />
            <i className="fxp-shard fxp-shard-2" />
            <i className="fxp-shard fxp-shard-3" />
            <i className="fxp-shard fxp-shard-4" />
        </span>
    );
}

/** 墨痕：一笔横扫的笔触轮廓，中段饱满、两端收尖，靠两条贝塞尔围出面积 */
const INK_SLASH_BODY = 'M-46 16 C -20 -14, 16 -30, 46 -20 C 12 -8, -18 4, -46 16 Z';
/** 笔锋亮线：压在墨身中脊上，是这一笔最吃光的那道边 */
const INK_SLASH_CORE = 'M-40 12 C -16 -12, 12 -24, 42 -18';
/** 飞白：枯笔扫过留下的断线，用 dasharray 断开而不是画实体 */
const INK_SLASH_DRY = 'M-34 9 C -12 -8, 14 -18, 38 -15';
/** 第二笔：收笔时在斩痕上补一记短促的顿点，两笔才像一次真正的落刀 */
const INK_SLASH_CROSS = 'M6 -32 C 14 -18, 20 -4, 24 14';

/** 墨阑·入道起手格：脚下运笔画出一圈留缺口的墨环（一笔画），
 *  墨气自环里升起，收笔时"道"字落定——这一笔没砍人，是把劲蓄在身上。 */
function MoranInkwayGatherFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-mw-pool" />
            <i className="fx-mw-enso">
                <svg viewBox="-50 -50 100 100" aria-hidden="true">
                    <circle className="mw-enso-ghost" cx="0" cy="0" r="37" pathLength={100} />
                    <circle className="mw-enso-stroke" cx="0" cy="0" r="37" pathLength={100} />
                    <circle className="mw-enso-tip" cx="0" cy="0" r="37" pathLength={100} />
                </svg>
            </i>
            <i className="fx-mw-wisp fx-mw-wisp-1" />
            <i className="fx-mw-wisp fx-mw-wisp-2" />
            <i className="fx-mw-wisp fx-mw-wisp-3" />
            <i className="fx-mw-glyph">道</i>
            <i className="fx-mw-muzzle" />
        </span>
    );
}

/** 墨阑·入道命中格：一道墨痕沿攻击轴从施法格铺到本格，笔到即炸出横斩、
 *  墨点迸溅与双圈金环，最后压上一枚"道"字印收尾。 */
function MoranInkwayStrikeFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-mw-dash" />
            <i className="fx-mw-slash">
                <svg viewBox="-50 -50 100 100" aria-hidden="true">
                    <path className="mw-slash-halo" d={INK_SLASH_BODY} />
                    <path className="mw-slash-body" d={INK_SLASH_BODY} />
                    <path className="mw-slash-dry" d={INK_SLASH_DRY} />
                    <path className="mw-slash-core" d={INK_SLASH_CORE} />
                    <path className="mw-slash-cross" d={INK_SLASH_CROSS} />
                </svg>
            </i>
            <i className="fx-mw-flash" />
            <i className="fx-mw-ring" />
            <i className="fx-mw-ring fx-mw-ring-b" />
            <i className="fx-mw-splat fx-mw-splat-1" />
            <i className="fx-mw-splat fx-mw-splat-2" />
            <i className="fx-mw-splat fx-mw-splat-3" />
            <i className="fx-mw-splat fx-mw-splat-4" />
            <i className="fx-mw-splat fx-mw-splat-5" />
            <i className="fx-mw-splat fx-mw-splat-6" />
            <i className="fx-mw-seal">道</i>
        </span>
    );
}

/**
 * 夺岁·斩岁（目标格）：一柄跨格的新月巨刃横扫而过（暗赤刃身 + 亮刃芯 + 回声刃），
 * 随后"血偿"刻印在目标脚下裂成三道口子，三缕血气被抽离往上飘——
 * 这一段是"砍走寿数"的可视化，血偿之后会还回来。
 */
function DuosuiReapFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-ds-flash" />
            <i className="fx-ds-reap">
                <svg viewBox="-50 -50 100 100" aria-hidden="true">
                    <defs>
                        <linearGradient id="ds-reap-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="#4a0d12" />
                            <stop offset="0.55" stopColor="#8e1f27" />
                            <stop offset="1" stopColor="#c23a34" />
                        </linearGradient>
                    </defs>
                    <path className="ds-reap-halo" d="M -46 16 Q 0 -32 46 2 Q 0 -10 -46 16 Z" />
                    <path className="ds-reap-body" d="M -46 16 Q 0 -32 46 2 Q 0 -10 -46 16 Z" />
                    <path className="ds-reap-edge" d="M -46 16 Q 0 -10 46 2" />
                    <path className="ds-reap-tip" d="M 39 -7 L 49 1 L 40 7 Z" />
                </svg>
            </i>
            <i className="fx-ds-reap fx-ds-reap-echo">
                <svg viewBox="-50 -50 100 100" aria-hidden="true">
                    <path className="ds-reap-body" d="M -46 16 Q 0 -32 46 2 Q 0 -10 -46 16 Z" />
                </svg>
            </i>
            <i className="fx-ds-wound">
                <i className="fx-ds-crack fx-ds-crack-1" />
                <i className="fx-ds-crack fx-ds-crack-2" />
                <i className="fx-ds-crack fx-ds-crack-3" />
            </i>
            <i className="fx-ds-thread fx-ds-thread-1" />
            <i className="fx-ds-thread fx-ds-thread-2" />
            <i className="fx-ds-thread fx-ds-thread-3" />
        </span>
    );
}

/** 夺岁·偿岁（目标格）：八道红刃围成圆环绕目标旋转，整环自地面升起再消散 */
function DuosuiTakeFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-ds-ground" />
            <i className="fx-ds-cage">
                <i className="fx-ds-orbit">
                    {Array.from({ length: 8 }, (_, index) => (
                        <b
                            key={index}
                            className="fx-ds-scar"
                            style={{ '--ds-angle': `${index * 45}deg` } as CSSProperties}
                        />
                    ))}
                </i>
            </i>
            <i className="fx-ds-spark fx-ds-spark-1" />
            <i className="fx-ds-spark fx-ds-spark-2" />
            <i className="fx-ds-spark fx-ds-spark-3" />
        </span>
    );
}

/** 夺岁·偿岁（施法格）：六瓣盾环从外圈合拢，把收回来的血偿铸成护盾 */
function DuosuiGuardFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-ds-guard">
                {Array.from({ length: 6 }, (_, index) => (
                    <b
                        key={index}
                        className="fx-ds-petal"
                        style={{ '--ds-petal': `${index * 60}deg` } as CSSProperties}
                    />
                ))}
            </i>
            <i className="fx-ds-shell" />
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

/* ============================================================
   恢复类专属原型（heal-single / heal-wave / regen-orb / revive-rise / shield-ward）
   目标是让"单体治疗 / 群体恢复 / 持续回血 / 复活 / 护盾援护"在看板上互相分辨：
   - 治疗向外扩环是增益的读法，恢复类一律换成各自的专属方向语言
     （收拢 / 荡开 / 绕体跳闪 / 向上拉起 / 罩面展开）；
   - 配色全部走档案注入的 --fx-c1 / --fx-c2 / --fx-glow，不在 CSS 里写死角色色。
   ============================================================ */

/** 汇入本格的净化光丝：八向均分 + 12° 偏移，避开与网格轴重合的呆板感 */
const HEAL_THREAD_ANGLES = Array.from({ length: 8 }, (_, index) => 12 + index * 45);

/** 单体净化回春：光丝自四周**向内收拢**汇入本格（与所有增益的"向外扩环"相反）
 *  + 一道竖直柔光柱 + 脚下缓慢正转的生环 + 收束处一团暖辉 */
function HealSingleFx() {
    return (
        <span className="fx-anchor">
            {HEAL_THREAD_ANGLES.map((angle, index) => (
                <i
                    key={angle}
                    className="fx-hs-thread"
                    style={{ '--hs-a': `${angle}deg`, '--hs-d': `${index * 34}ms` } as CSSProperties}
                />
            ))}
            <i className="fx-hs-core" />
            <i className="fx-hs-pillar" />
            <i className="fx-hs-ring" />
            <Sparks count={3} className="fxp-spark-wisp" />
        </span>
    );
}

/** 群体恢复（施法者格）：以本格为心荡出三道同心波，波幅按 --hw-span 长到作用区边缘 */
function HealWaveSourceFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-hw-core" />
            <i className="fx-hw-wave fx-hw-wave-1" />
            <i className="fx-hw-wave fx-hw-wave-2" />
            <i className="fx-hw-wave fx-hw-wave-3" />
        </span>
    );
}

/** 群体恢复（受益格）：波到之处各自升起一根细光柱 + 脚下一圈落脚环。
 *  dim=只是被波扫过、没真的吃到恢复的格子（例如给友方挂音符那一手），柱身收矮收淡 */
function HealWaveCellFx({ dim = false }: { dim?: boolean }) {
    return (
        <span className={`fx-anchor${dim ? ' fx-hw-dim' : ''}`}>
            <i className="fx-hw-base" />
            <i className="fx-hw-column" />
            <Sparks count={dim ? 2 : 3} className="fxp-spark-wisp" />
        </span>
    );
}

/** 回血珠绕体的三个锚角（120° 均分，珠身随 --ro-a 挂在轨道上） */
const REGEN_ORB_ANGLES = [0, 120, 240];

/** 持续/延迟回血：两三颗回血珠绕体缓转，每"跳"一下闪一次并冒一颗上飘的绿点 */
function RegenOrbFx({ orbs = 3 }: { orbs?: number }) {
    return (
        <span className="fx-anchor">
            <i className="fx-ro-glow" />
            <i className="fx-ro-orbit">
                {REGEN_ORB_ANGLES.slice(0, orbs).map(angle => (
                    <b key={angle} className="fx-ro-orb" style={{ '--ro-a': `${angle}deg` } as CSSProperties} />
                ))}
            </i>
            {REGEN_ORB_ANGLES.slice(0, orbs).map((angle, index) => (
                <i
                    key={angle}
                    className="fx-ro-drop"
                    style={{ '--ro-a': `${angle}deg`, '--ro-d': `${index * 280}ms` } as CSSProperties}
                />
            ))}
            <i className="fx-ro-ring" />
        </span>
    );
}

/** 复活血统的轮廓：躯干 + 头 + 顶上一圈光轮，由虚到实亮起（三件共用一个容器以便同步） */
function ReviveFigureFx() {
    return (
        <i className="fx-rv-figure">
            <i className="fx-rv-head" />
            <i className="fx-rv-body" />
            <i className="fx-rv-halo" />
        </i>
    );
}

/** 复活仪式：短暂压暗 → 光带自地面**向上拉起** → 人形轮廓由虚到实亮起 → 一圈扩散的金色涟漪 */
function ReviveRiseFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-rv-dim" />
            <i className="fx-rv-band fx-rv-band-1" />
            <i className="fx-rv-band fx-rv-band-2" />
            <i className="fx-rv-band fx-rv-band-3" />
            <ReviveFigureFx />
            <i className="fx-rv-ripple fx-rv-ripple-1" />
            <i className="fx-rv-ripple fx-rv-ripple-2" />
            <Sparks count={4} className="fxp-spark-wisp" />
        </span>
    );
}

/** 尖顶六边形罩面的顶点（100×100 视觉框）：棱面、描边与流光滑轨共用同一组点 */
const SHIELD_HEX_OUTER = '50,3 92,27 92,73 50,97 8,73 8,27';
const SHIELD_HEX_INNER = '50,17 80,32 80,68 50,83 20,68 20,32';
const SHIELD_HEX_VERTICES: Array<[number, number]> = [
    [50, 3], [92, 27], [92, 73], [50, 97], [8, 73], [8, 27],
];

/** 护盾援护：六边形罩面自中心展开、一道流光沿棱走一圈、六角依次钉住。
 *  纯防御观感——没有朝攻击方向的分量，也没有受击爆点，起手格同理 */
function ShieldWardFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-sw-face" />
            <i className="fx-sw-core" />
            <i className="fx-sw-shell">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                    <polygon className="fx-sw-rim" points={SHIELD_HEX_OUTER} pathLength={100} />
                    <polygon className="fx-sw-sweep" points={SHIELD_HEX_OUTER} pathLength={100} />
                    <polygon className="fx-sw-inner" points={SHIELD_HEX_INNER} pathLength={100} />
                    {SHIELD_HEX_VERTICES.map(([cx, cy], index) => (
                        <circle
                            key={`${cx}-${cy}`}
                            className="fx-sw-stud"
                            cx={cx}
                            cy={cy}
                            r="3.4"
                            style={{ '--sw-i': String(index) } as CSSProperties}
                        />
                    ))}
                </svg>
            </i>
            <Sparks count={3} className="fxp-spark-wisp" />
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

/* ============================================================
   云缨·燎原百斩（天威落点）：一柄红焰枪刃绕落点格心旋满一周
   ============================================================ */

/** 焰缨枪：柄尾钉在格心、双刃枪头沿 +x 径向伸出，红缨在枪头后飘两缕
 *  （随容器顺时针旋满一周时，枪尖画出的就是"周身一圈"的火线） */
function FlameSpearGlyph() {
    return (
        <svg className="fx-lw-glyph" viewBox="0 0 170 60" aria-hidden="true">
            <path className="lw-shaft" d="M8 33 L93 31" />
            <path className="lw-tassel" d="M92 26 q-10 -6 -21 -6 M93 36 q-12 5 -23 10" />
            <path className="lw-blade" d="M93 31 Q112 12 138 16 Q157 20 165 30 Q146 42 121 44 Q101 42 93 31 Z" />
            <path className="lw-core" d="M104 30 Q117 19 135 21 Q149 24 156 30 Q141 37 124 38 Q110 36 104 30 Z" />
            <path className="lw-edge" d="M93 31 Q112 12 138 16 Q157 20 165 30" />
        </svg>
    );
}

/** 燎原旋斩（落点格）：焰色枪刃绕格心旋满一周，主副两道火焰扫弧 + 一道迟半拍的余痕，
 *  周身八簇火舌按被扫过的次序窜起，收势时荡开一圈灼地火环标出 3×3 炸开的界 */
function LiehuoSpearWheelFx() {
    return (
        <span className="fx-anchor">
            <i className="fx-lw-heat" />
            <i className="fx-lw-orbit">
                <i className="fx-lw-trail" />
                <i className="fx-lw-trail fx-lw-trail-b" />
                <i className="fx-lw-spear"><FlameSpearGlyph /></i>
            </i>
            <i className="fx-lw-orbit fx-lw-orbit-echo">
                <i className="fx-lw-trail fx-lw-trail-echo" />
            </i>
            {WHEEL_TICK_ANGLES.map((angle, index) => (
                <i
                    key={angle}
                    className="fx-lw-tick"
                    style={{ '--lw-a': `${angle}deg`, '--lw-i': index } as CSSProperties}
                />
            ))}
            <i className="fx-lw-hub" />
            <i className="fx-lw-ring" />
            <i className="fxp-hitflash fxp-hitflash-big" />
            <Sparks count={5} className="fxp-spark-fast" />
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
function TargetFx({ event, atPos }: { event: SkillFxEvent; atPos?: Position }) {
    const themed = SkillThemeTargetFx({ event });
    if (themed) return themed;
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
        case 'zhiyuan-reel':
            return <ZhiyuanReelFx />;
        case 'xihuan-level':
            return <XihuanLevelFx />;
        case 'jiangtaigong-cast':
            return <JiangtaigongCastFx />;
        case 'jiangtaigong-throw':
            return <JiangtaigongThrowFx />;
        case 'jiangtaigong-whalefall':
            return <JiangtaigongWhaleFallFx />;
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
        // —— 恢复类专属原型（目标格/受益格主效）——
        case 'heal-single':
            // 单体净化回春：光丝收拢汇入 + 柔光柱 + 脚下生环
            return <HealSingleFx />;
        case 'heal-wave':
            // 群体恢复：波扫到的每一格（含主目标与逐格命中的受益者）各起一根细光柱
            return <HealWaveCellFx />;
        case 'regen-orb':
            // 持续/延迟回血：回血珠绕体缓转，跳一下闪一次并冒一颗绿点
            return <RegenOrbFx />;
        case 'revive-rise':
            // 复活仪式：压暗 → 光带向上拉起 → 轮廓凝实 → 金色涟漪
            return <ReviveRiseFx />;
        case 'shield-ward':
            // 护盾援护：六边形罩面展开 + 沿棱走一圈的流光
            return <ShieldWardFx />;
        case 'aura-buff':
            return <AuraBuffFx />;
        case 'hex-curse':
            return <HexCurseFx />;
        case 'shadow-dash':
            return <DashLandingFx />;
        case 'phase-swap':
            return <PhaseSwapFx />;
        case 'huanongying-fan':
            return <HuanongyingFanImpactFx />;
        case 'huanongying-swap':
            return <HuanongyingSwapTargetFx />;
        case 'huanongying-replay':
            return <HuanongyingReplayImpactFx />;
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
        case 'yunying-arc-slash':
            // 云缨落点：正前方那排格子各挨两道来回的圆弧火斩
            return <YunyingArcSlashFx />;
        case 'yunying-sweep':
            // 3×3 的次要命中格只点一记爆点，弧刃主效由起手格那份承担
            return <YunyingSparkImpactFx />;
        case 'crystal-shatter':
            return <CrystalShatterFx />;
        case 'ember-flare':
            return <EmberFlareFx />;
        case 'liehuo-blaze':
            // 烈火燎原首格：这道火线的第一格烧得最高
            return <LiehuoBlazeCellFx tall />;
        case 'liehuo-wheel':
            // 燎原百斩（落点格）：一柄红焰枪刃绕格心旋满一周
            return <LiehuoSpearWheelFx />;
        case 'prism-beam':
            // 棱光千折（方向格）：那只是光出去的第一格，本体由区域层那条折线承担
            return (
                <span className="fx-anchor">
                    <i className="fxp-auraglow" />
                </span>
            );
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
            return <MirrorBladeImpactFx event={event} atPos={atPos} />;
        case 'xubai-pearls':
            // 叙白·黑白凝珠：三珠汇聚环绕
            return <XubaiPearlsFx />;
        case 'lingxi-wave':
            // 主浪只从施法者扩散；命中格只留下水纹。
            return <LingxiWaterTouchFx event={event} atPos={atPos} />;
        case 'lingxi-fan':
            return <LingxiTideImpactFx event={event} atPos={atPos} />;
        case 'jinghong-slash-ring':
            // 惊鸿·环海旋斩：整圈斩痕在施法者格，玩家点中的那一格只留一记水花
            return <ImpactMarkFx />;
        case 'jinghua-moonblade':
            // 镜花·月华飞斩：月牙刃飞到本格并绽开（起手格只有凝刃月光）
            return <JinghuaMoonbladeFx />;
        case 'moran-inkway':
            // 墨阑·入道：墨痕从施法格铺到本格，笔到即炸出这一记横斩
            return <MoranInkwayStrikeFx />;
        case 'duosui-reap':
            return <DuosuiReapFx />;
        case 'duosui-reckon':
            return <DuosuiTakeFx />;
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
export const SkillFxVisual = memo(function SkillFxVisual({
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
    if (atPos) style = { ...style, '--fx-hit-ms': `${computeFxImpactDelayMs(event, atPos)}ms` } as CSSProperties;
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

    // 群体恢复的波心是施法者，不是玩家点中的那个受益者：主目标往往就在旁边，
    // 沿用上面那套"离主目标几格"会让整片光柱从队友身上同时炸开、读不出波是从琴前荡出去的。
    // 这里按"离施法者几格"重排，并把波能扫到的格数交给 --hw-span，同心环才真荡到区缘。
    if (event.profile.kind === 'heal-wave') {
        const cells = [event.targetPos, ...(event.impactPositions ?? []), ...(event.coveredPositions ?? [])];
        const reach = cells.reduce((max, cell) => Math.max(
            max,
            Math.max(Math.abs(cell[0] - event.fromPos[0]), Math.abs(cell[1] - event.fromPos[1]))
        ), 0);
        const patch: Record<string, string> = {
            // 环的身位留一格余量，最外圈落在最后一排受益格上而不是飘到盘外
            '--hw-span': String(Math.min(4.6, 1.5 + reach)),
        };
        if (atPos) {
            patch['--fx-cell-delay'] = `${computeFxCellDelayMs(event.fromPos, atPos)}ms`;
        }
        style = { ...style, ...patch } as CSSProperties;
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

    // 踏火长驱：本格那团火气要跟上巨刃扫到自己的时刻（按"横扫正方向"的格子序号排）
    if (atPos && event.profile.kind === 'yunying-arc-slash') {
        const bar = event.coveredPositions ?? [];
        const index = Math.max(0, bar.findIndex(([r, c]) => r === atPos[0] && c === atPos[1]));
        style = {
            ...style,
            '--yas-fwd': `${index * YUNYING_SLASH_STEP_MS}ms`,
        } as CSSProperties;
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

    // 棱光千折：命中格要等光真的走到那一格才炸，而不是按"离主目标几格"的波浪算——
    // 光会拐弯，波浪距离和光的行程根本不是一条轴，错开就成了"人还没被照到就先爆了"
    if (atPos && event.profile.kind === 'prism-beam'
        && (variant === 'impact' || variant === 'area')) {
        const order = (event.coveredPositions ?? [])
            .findIndex(([r, c]) => r === atPos[0] && c === atPos[1]);
        if (order >= 0) {
            style = {
                ...style,
                '--fx-cell-delay': `${(order + 1) * PRISM_BEAM_STEP_MS}ms`,
            } as CSSProperties;
        }
    }

    // 镜花·天威：照中几名敌人就飞来几弯月牙刃，刃画在敌人那一格，
    // 攻击轴得按"镜花格→本格"重算，否则次要命中格的飞刃会斜着指向主目标
    if (atPos && (variant === 'impact' || variant === 'target')
        && (event.profile.kind === 'jinghua-moonblade' || event.profile.kind === 'moran-inkway')) {
        const dx = atPos[1] - event.fromPos[1];
        const dy = atPos[0] - event.fromPos[0];
        style = {
            ...style,
            '--fx-rot': `${computeFxAngleDeg(event.fromPos, atPos)}deg`,
            '--fx-dist': String(Math.round(Math.hypot(dx, dy) * 100) / 100),
        } as CSSProperties;
    }

    // 命中型原型本身就是"一次命中的特写"，每个命中格各来一份完整主效；
    // 法阵/领域/增益类只在主格出本体，其余格退回轻量印记
    const isSoftImpact =
        variant === 'impact' &&
        !!atPos &&
        (event.softImpactPositions ?? []).some(([r, c]) => r === atPos[0] && c === atPos[1]);
    const perTargetMain = variant === 'impact' && (
        (isSoftImpact && !!event.profile.recovery) ||
        (isPerTargetFxKind(event.profile.kind) &&
            (!isSoftImpact || ['heal-wave', 'coin-blessing', 'chord-aura'].includes(event.profile.kind)))
    );

    return (
        <span
            className={[
                'skill-fx',
                `skill-fx-kind-${event.profile.kind}`,
                variantClass,
                event.owner === 'player1' ? 'skill-fx-owner-p1' : 'skill-fx-owner-p2',
                // 低画质挂这个类：只藏"撒出去的散件"，主体轮廓照常播（见 quality-low.css）
                isLowQuality() ? 'fx-lite' : '',
            ].join(' ')}
            style={style}
            aria-hidden="true"
        >
            {event.profile.moon ? <WangshuMoonFx event={event} variant={variant} /> : event.profile.crafted ? <CraftedSkillFx event={event} variant={variant} atPos={atPos} /> : event.profile.mechanism ? <MechanismSkillFx event={event} variant={variant} /> : event.profile.kind === 'coin-awaken' ? (variant === 'target' && <WangcaiAwakenFx />) : event.profile.spectral ? <SpectralSkillFx event={event} variant={variant} atPos={atPos} /> : <>
            {variant === 'caster' && <CasterFx event={event} />}
            {(variant === 'target' || perTargetMain) && <TargetFx event={event} atPos={atPos} />}
            {variant === 'impact' && !perTargetMain && (event.profile.kind === 'lingxi-wave'
                ? <LingxiWaterTouchFx event={event} atPos={atPos} />
                : event.profile.kind === 'lingxi-fan'
                    ? <LingxiTideImpactFx event={event} atPos={atPos} />
                : <ImpactMarkFx soft={isSoftImpact} />)}
            {variant === 'area' && !['lingxi-wave', 'lingxi-fan'].includes(event.profile.kind) && (event.profile.kind === 'zuizhen-throw'
                ? <ZuizhenThrowPathFx />
                : event.profile.kind === 'liehuo-blaze'
                    ? <LiehuoBlazeCellFx />
                    : event.profile.kind === 'yunying-arc-slash'
                        ? <YunyingArcSlashFx />
                        : event.profile.kind === 'heal-wave' && !event.profile.recovery
                            // 波扫过但没真的吃到恢复的格（例如只挂音符的友方格）：柱身收矮
                            ? <HealWaveCellFx dim />
                            : <AreaTileFx />)}
            {variant === 'splash' && <SplashEmberFx />}
            {variant === 'chain' && <ChainBoltFx />}
            </>}
        </span>
    );
}, (previous, next) => previous.event === next.event && previous.variant === next.variant
    && previous.atPos?.[0] === next.atPos?.[0] && previous.atPos?.[1] === next.atPos?.[1]);

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

/** 踏火长驱：巨刃扫过一整排格子时，每格的火气相隔多久亮起 */
const YUNYING_SLASH_STEP_MS = 150;

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

/** 踏火长驱的区域刀光：以云缨为圆心、罩住正前方三格命中面的一道 120° 红色圆弧挥斩。
 *  去程沿弧从左→右扫过（亮段行刀 + 身后渐显的斩痕轨迹），回程反着再扫一次右→左、更宽更亮。
 *  枪尖扫过的整片扇形同时烧成火扇（saf-yas-fanfire），刀光才读得出"火"而不只是一条线。
 *  圆心用 --fx-travel-x/y 从命中面中心反推一格回到云缨脚下，整组再按 --fx-rot 旋到攻击轴上，
 *  所以四个朝向共用同一段弧。伤害只结算一次，回程是纯特效。 */
const YUNYING_ARC_FWD = 'M -36.37 -21 A 42 42 0 0 1 36.37 -21';
const YUNYING_ARC_BACK = 'M 36.37 -21 A 42 42 0 0 0 -36.37 -21';
/* 扇面走"半径21 + 笔宽42"：笔宽正好是弧半径的两倍，内缘收拢到圆心，
   同一段 dashoffset 动画于是从"描一条弧"变成"从脚下铺出一个实心火扇"。 */
const YUNYING_FAN_FWD = 'M -18.19 -10.5 A 21 21 0 0 1 18.19 -10.5';
const YUNYING_FAN_BACK = 'M 18.19 -10.5 A 21 21 0 0 0 -18.19 -10.5';
/* 火舌带贴在扇面外沿内侧（半径38），比扇面窄成一圈，跟着同一时刻铺开 */
const YUNYING_RIM_FWD = 'M -32.91 -19 A 38 38 0 0 1 32.91 -19';
const YUNYING_RIM_BACK = 'M 32.91 -19 A 38 38 0 0 0 -32.91 -19';

function AreaBladeSweepFx({ event, bounds }: { event: SkillFxEvent; bounds: SkillAreaBounds }) {
    const id = useId().replace(/:/g, '');
    return (
        <span className="saf-yas-fan saf-yas-quality" style={{
            '--yy-pivot-x': event.fromPos[1] - bounds.c0 + .5,
            '--yy-pivot-y': event.fromPos[0] - bounds.r0 + .5,
        } as CSSProperties}>
            <YunyingSwingSpear />
            <svg className="saf-yas-arc" viewBox="-50 -50 100 100" aria-hidden="true">
                <defs>
                    <linearGradient id={`${id}-wake`} x1="0" y1="0" x2="1" y2="0"><stop stopColor="#b64124" stopOpacity="0" /><stop offset=".38" stopColor="#e98134" stopOpacity=".32" /><stop offset=".76" stopColor="#ffbc62" /><stop offset="1" stopColor="#fff0c3" /></linearGradient>
                    <linearGradient id={`${id}-return`} x1="1" y1="0" x2="0" y2="0"><stop stopColor="#b64124" stopOpacity="0" /><stop offset=".38" stopColor="#e98134" stopOpacity=".32" /><stop offset=".76" stopColor="#ffbc62" /><stop offset="1" stopColor="#fff0c3" /></linearGradient>
                    <radialGradient id={`${id}-fan`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="42"><stop offset="0" stopColor="#4a0a04" stopOpacity="0" /><stop offset=".3" stopColor="#8d1509" stopOpacity=".55" /><stop offset=".6" stopColor="#c2260b" stopOpacity=".75" /><stop offset=".85" stopColor="#ee4412" stopOpacity=".85" /><stop offset="1" stopColor="#ff7a2a" stopOpacity=".9" /></radialGradient>
                    <radialGradient id={`${id}-rim`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="44"><stop offset=".72" stopColor="#e8420f" stopOpacity=".55" /><stop offset=".88" stopColor="#ff8c2b" stopOpacity=".9" /><stop offset="1" stopColor="#ffe0a4" stopOpacity=".95" /></radialGradient>
                </defs>
                <path className="saf-yas-fanfire" d={YUNYING_FAN_FWD} pathLength={100} style={{ stroke: `url(#${id}-fan)` }} />
                <path className="saf-yas-fanfire saf-yas-fanfire-b" d={YUNYING_FAN_BACK} pathLength={100} style={{ stroke: `url(#${id}-fan)` }} />
                <path className="saf-yas-fanrim" d={YUNYING_RIM_FWD} pathLength={100} style={{ stroke: `url(#${id}-rim)` }} />
                <path className="saf-yas-fanrim saf-yas-fanrim-b" d={YUNYING_RIM_BACK} pathLength={100} style={{ stroke: `url(#${id}-rim)` }} />
                <path className="saf-yas-blaze" d={YUNYING_ARC_FWD} pathLength={100} />
                <path className="saf-yas-trail" d={YUNYING_ARC_FWD} pathLength={100} style={{ stroke: `url(#${id}-wake)` }} />
                <path className="saf-yas-edge" d={YUNYING_ARC_FWD} pathLength={100} style={{ stroke: `url(#${id}-wake)` }} />
                <path className="saf-yas-blaze saf-yas-blaze-b" d={YUNYING_ARC_BACK} pathLength={100} />
                <path className="saf-yas-trail saf-yas-trail-b" d={YUNYING_ARC_BACK} pathLength={100} style={{ stroke: `url(#${id}-return)` }} />
                <path className="saf-yas-edge saf-yas-edge-b" d={YUNYING_ARC_BACK} pathLength={100} style={{ stroke: `url(#${id}-return)` }} />
            </svg>
            {/* 火头附在真实枪尖上，往返两扫不复制浮动火球。 */}
            <i className="saf-yas-spark saf-yas-spark-1" />
            <i className="saf-yas-spark saf-yas-spark-2" />
            <i className="saf-yas-spark saf-yas-spark-3" />
            <i className="saf-yas-spark saf-yas-spark-4" />
        </span>
    );
}

/** 青莲剑阵（谪仙醉斩）：范围先行——剑阵边框钉住 2×3 命中矩形、四角括线收拢，
 *  随后四道对角剑光依次穿阵（两道大对角 + 两道偏置补斩），末了剑阵整体 bloom 收势。
 *  玩家先看清"斩哪几格"，再看清"怎么斩"，对齐王者李白大招的读法。 */
function AreaSwordZoneFx() {
    return (
        <>
            <i className="saf-sz-frame" />
            <i className="saf-sz-corner saf-sz-corner-tl" />
            <i className="saf-sz-corner saf-sz-corner-tr" />
            <i className="saf-sz-corner saf-sz-corner-bl" />
            <i className="saf-sz-corner saf-sz-corner-br" />
            <svg className="saf-sz-beams" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path className="saf-sz-beam saf-sz-beam-1" d="M -4 104 L 104 -4" pathLength={100} vectorEffect="non-scaling-stroke" />
                <path className="saf-sz-beam saf-sz-beam-2" d="M -4 -4 L 104 104" pathLength={100} vectorEffect="non-scaling-stroke" />
                <path className="saf-sz-beam saf-sz-beam-3" d="M -4 60 L 104 6" pathLength={100} vectorEffect="non-scaling-stroke" />
                <path className="saf-sz-beam saf-sz-beam-4" d="M -4 94 L 104 40" pathLength={100} vectorEffect="non-scaling-stroke" />
            </svg>
            <i className="saf-sz-flash" />
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

/** 光路的一段：方向不变的连续格子，length 以"格"为单位（斜向已含 √2） */
interface PrismBeamSegment {
    from: Position;
    to: Position;
    length: number;
    steps: number;
    angleDeg: number;
    startOrder: number;
    /** 本段终点之后光又拐了一次（撞在光棱或边缘上），值得补一枚折点闪光 */
    bends: boolean;
}

/**
 * 把光走过的格子序列切成直线段。撞边原路折回会压过已经走过的格，而 coveredPositions
 * 是按格去重的，序列里因此可能整格跳步——跳步处另起一段，不连成一根穿过的长线。
 */
function buildPrismBeamSegments(cells: Position[]): PrismBeamSegment[] {
    const segments: PrismBeamSegment[] = [];
    let index = 0;
    while (index < cells.length - 1) {
        const dr = Math.sign(cells[index + 1][0] - cells[index][0]);
        const dc = Math.sign(cells[index + 1][1] - cells[index][1]);
        let end = index + 1;
        while (end + 1 < cells.length
            && Math.abs(cells[end + 1][0] - cells[end][0]) <= 1
            && Math.abs(cells[end + 1][1] - cells[end][1]) <= 1
            && Math.sign(cells[end + 1][0] - cells[end][0]) === dr
            && Math.sign(cells[end + 1][1] - cells[end][1]) === dc) {
            end++;
        }
        const gapR = cells[end][0] - cells[index][0];
        const gapC = cells[end][1] - cells[index][1];
        segments.push({
            from: cells[index],
            to: cells[end],
            length: Math.hypot(gapR, gapC),
            steps: end - index,
            angleDeg: Math.atan2(gapR, gapC) * 180 / Math.PI,
            startOrder: index,
            bends: end < cells.length - 1,
        });
        index = end;
    }
    return segments;
}

/**
 * 棱光千折的光路（区域层）：按"光走到第几格"逐段点亮，折点补一枚棱形闪光，
 * 起点补一发出光口。玩家顺着这条线就能核对折射与撞边到底走了哪条路。
 */
function AreaLightPathFx({ event }: { event: SkillFxEvent }) {
    const bounds = event.areaBounds;
    if (!bounds) return null;
    const segments = buildPrismBeamSegments([event.fromPos, ...(event.coveredPositions ?? [])]);
    if (segments.length === 0) return null;
    const offset = (cell: Position): [number, number] => [cell[1] - bounds.c0, cell[0] - bounds.r0];
    const [muzzleX, muzzleY] = offset(event.fromPos);
    // 整条光路要在最后一格到达之后一起谢幕：每段"长出来"按自己那几格的行程计时，
    // "淡出去"却统一排在最后一段之后，否则先走过的段会提前消失，玩家看不到完整路径
    const lastOrder = Math.max(0, segments.reduce((max, segment) =>
        Math.max(max, segment.startOrder + segment.steps), 0));
    const fadeAtMs = lastOrder * PRISM_BEAM_STEP_MS + 260;
    return (
        <>
            <i
                className="saf-lp-muzzle"
                style={{ '--lp-x': String(muzzleX), '--lp-y': String(muzzleY) } as CSSProperties}
            />
            {segments.map((segment, index) => {
                const [x, y] = offset(segment.from);
                const [tipX, tipY] = offset(segment.to);
                return (
                    <span className="saf-lp-run" key={index}>
                        <i
                            className="saf-lp-seg"
                            style={{
                                '--lp-x': String(x),
                                '--lp-y': String(y),
                                '--lp-len': String(segment.length),
                                '--lp-rot': `${segment.angleDeg}deg`,
                                '--lp-delay': `${segment.startOrder * PRISM_BEAM_STEP_MS}ms`,
                                '--lp-dur': `${Math.max(180, segment.steps * PRISM_BEAM_STEP_MS)}ms`,
                                '--lp-fade-delay': `${fadeAtMs}ms`,
                            } as CSSProperties}
                        />
                        {segment.bends && (
                            <i
                                className="saf-lp-node"
                                style={{
                                    '--lp-x': String(tipX),
                                    '--lp-y': String(tipY),
                                    '--lp-delay': `${(segment.startOrder + segment.steps) * PRISM_BEAM_STEP_MS}ms`,
                                } as CSSProperties}
                            />
                        )}
                    </span>
                );
            })}
        </>
    );
}

/** AOE 整体特效渲染入口：渲染在棋盘网格层（跨格子绝对定位），每个事件一张 */
export function SkillAreaFx({ event }: { event: SkillFxEvent }) {
    if (event.profile.crafted || event.profile.spectral || event.profile.mechanism) return null;
    if (['yunying-sweep', 'lingxi-wave', 'lingxi-fan'].includes(event.profile.kind)) return null;
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
            {archetype === 'bladesweep' && <AreaBladeSweepFx event={event} bounds={bounds} />}
            {archetype === 'lightpath' && <AreaLightPathFx event={event} />}
            {archetype === 'swordzone' && <AreaSwordZoneFx />}
            {archetype === 'thunderstorm' && <AreaThunderstormFx />}
            {archetype === 'cage' && <AreaCageFx />}
            {archetype === 'runearray' && <AreaRuneArrayFx />}
            {archetype === 'groundwave' && <AreaGroundwaveFx />}
            {archetype === 'slashwave' && <AreaSlashwaveFx />}
            {archetype === 'petalfan' && <HuanongyingFanAreaFx event={event} bounds={bounds} />}
            {archetype === 'icespikes' && <AreaIceSpikesFx />}
            {archetype === 'iceshatter' && <AreaShatterFx />}
        </span>
    );
}
