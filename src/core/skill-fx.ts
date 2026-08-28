/**
 * 英雄技能特效档案（技能级定制）。
 *
 * 档案精确到"英雄 × 技能"：每个技能有专属的视觉原型（kind）、
 * 时长与配色（c1 主色 / c2 辅色，驱动 CSS 变量 --fx-c1/--fx-c2/--fx-glow）。
 * 档案以裸技能 ID 为键（如 `wukong_skill1`）——运行时 Hero.id 形如
 * `wukong-player1-<时间戳>`，不能直接用作键；而技能 ID 全局唯一且
 * 按约定 `${heroId}_skill${n}` 命名，未命中技能级档案时可由技能 ID
 * 推导英雄 ID 查英雄级兜底，最后回落通用墨韵波纹。
 *
 * 特效信号由 game-store 的 executeSkill 包装层在"真实施法成功"时派发
 * （本地玩家、人机 AI、联机远端动作重放共用同一条入口，因此所有对局
 * 形态下特效表现一致，无需额外网络消息）。Board 在起手格与目标格内
 * 渲染 SkillFxVisual，动画结束后由生命周期组件统一回收事件。
 *
 * 方向约定（屏幕坐标，row 向下）：
 * - angleDeg：atan2(dy, dx) 的顺时针角度，0=右、90=下、±180=左、-90=上，
 *   与 CSS rotate() 的旋转方向一致，可直接用于旋转对齐；
 * - direction：angleDeg 按 45° 扇区量化的八向标签。
 */
import type { Player, Position } from '../types/game';

/** 技能特效视觉方案（定制原型 + 通用原型） */
export type SkillFxKind =
    // —— 初代定制（悟空/绯雪/缚魂灯/太白/费曼，样式已固化在各自 CSS 段）——
    | 'wukong-clone'    // 悟空·毫毛化分身：毫毛飘落 + 烟雾绽开 + 光柱闪现
    | 'wukong-staff'    // 悟空·金箍棒砸击：循攻击方向落棒 + 冲击波 + 尘土
    | 'feixue-blade'    // 绯雪·霜刃破阵：冰蓝光刃斜掠 + 碎冰飞溅
    | 'feixue-stomp'    // 绯雪·踏雪追命：大雪花压落 + 冰环扩散
    | 'soul-lamp-array' // 缚魂灯·暗夜法阵：双环法阵 + 幽绿光柱 + 鬼火
    | 'soul-lamp-cycle' // 缚魂灯·缚魂轮转：交错轮环 + 灯焰摇曳
    | 'libai-slash'     // 太白·醉剑：青白剑光速闪 + 酒气光点
    | 'libai-flurry'    // 太白·剑气纵横：三道剑气连闪
    | 'feynman-beam'    // 费曼·粒子束：直线光束 + 着弹火花
    | 'feynman-burst'   // 费曼·粒子轰爆：中心爆发 + 双粒子环
    // —— 通用原型（配色由档案注入，覆盖其余全部技能）——
    | 'arc-slash'       // 弧光斩：循攻击方向掠过的弧刃 + 晶屑
    | 'triple-slash'    // 三连斩：三道弧刃依次扫过
    | 'pierce'          // 贯日突刺：起手格投射物飞出 + 目标格着弹闪光
    | 'radial-burst'    // 环形爆发：中心闪爆 + 粒子环 + 冲击环
    | 'magic-array'     // 法阵：双层对旋符环 + 光柱 + 符火
    | 'light-summon'    // 召光：光柱自地而起 + 烟团 + 辉闪
    | 'blessing'        // 祝福/治愈：上浮微光 + 柔和光环
    | 'aura-buff'       // 增益：上升辉光 + 扩环 + 光尘
    | 'hex-curse'       // 诅咒：暗影触须 + 下沉符点 + 暗环
    | 'shadow-dash'     // 突进：起手格残影拖尾 + 落点尘环
    | 'phase-swap'      // 换位/瞬移：两端内向涡环 + 闪光
    | 'ground-zone'     // 领域：贴地波纹扩散 + 地面辉光
    | 'cage-bind'       // 束缚：收拢笼环 + 交叉锁光
    | 'crystal-shatter' // 晶碎：闪核 + 晶屑迸溅 + 玻璃环
    | 'ember-flare'     // 焰浪：火热闪焰 + 上升余烬
    | 'storm-bolt'      // 雷霆：锯齿电光闪击 + 震环
    | 'gale-vortex'     // 旋风：对旋涡环 + 风纹
    | 'chord-notes'     // 乐律：音符上浮 + 弦波涟漪
    | 'time-rewind'     // 时溯：倒转符环 + 逆走指针
    | 'ink';            // 默认兜底：墨韵波纹

/** 单个技能的特效档案 */
export interface SkillFxProfile {
    kind: SkillFxKind;
    durationMs: number;
    /** 主色（十六进制）；缺省时沿用 kind 自带样式（初代定制与 ink） */
    c1?: string;
    /** 辅色（十六进制） */
    c2?: string;
}

/** 攻击方向的八向标签 */
export type SkillFxDirection = 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE';

/** 一次技能施放的瞬态特效事件（仅本地视觉层使用，不参与联机状态同步） */
export interface SkillFxEvent {
    id: number;
    profile: SkillFxProfile;
    owner: Player;
    /** 施法者所在格（快照于施法前，移动/瞬移类技能不受影响） */
    fromPos: Position;
    targetPos: Position;
    /** from→target 攻击角度（CSS 顺时针 deg：0=右 90=下 ±180=左 -90=上） */
    angleDeg: number;
    direction: SkillFxDirection;
    /** 派发时刻，用于生命周期组件精确计算剩余存活时间 */
    bornAt: number;
}

/* ============================================================
   全技能档案：36 英雄 × 2 技能 + 金乌/玄龟附属技能
   每条档案 = 视觉原型 × 时长 × 技能专属配色
   ============================================================ */

/** 技能级档案（键为裸技能 ID） */
export const SKILL_FX_PROFILES: Record<string, SkillFxProfile> = {
    // ===== 初代定制（样式固化，配色保留原 CSS）=====
    wukong_skill1: { kind: 'wukong-clone', durationMs: 1300 },
    wukong_skill2: { kind: 'wukong-staff', durationMs: 980 },
    feixue_skill1: { kind: 'feixue-blade', durationMs: 900 },
    feixue_skill2: { kind: 'feixue-stomp', durationMs: 1000 },
    soul_lamp_skill1: { kind: 'soul-lamp-array', durationMs: 1250 },
    soul_lamp_skill2: { kind: 'soul-lamp-cycle', durationMs: 1150 },
    libai_skill1: { kind: 'libai-slash', durationMs: 800 },
    libai_skill2: { kind: 'libai-flurry', durationMs: 1000 },
    feynman_skill1: { kind: 'feynman-beam', durationMs: 900 },
    feynman_skill2: { kind: 'feynman-burst', durationMs: 1000 },

    // ===== 墨阑：行墨问道（墨紫）=====
    moran_skill1: { kind: 'magic-array', durationMs: 1150, c1: '#8b7bb0', c2: '#4a4458' },   // 入道：问道法阵
    moran_skill2: { kind: 'arc-slash', durationMs: 850, c1: '#3a3548', c2: '#8b7bb0' },      // 墨断：墨色弧斩

    // ===== 震霄：雷甲撼阵（雷金）=====
    zhenxiao_skill1: { kind: 'storm-bolt', durationMs: 850, c1: '#ffd34d', c2: '#ff8c42' },  // 雷血开锋
    zhenxiao_skill2: { kind: 'cage-bind', durationMs: 1100, c1: '#f5d76e', c2: '#c8ccd8' }, // 金银错：金银锁笼

    // ===== 回锋：回刃听锋（钢蓝）=====
    huifeng_skill1: { kind: 'triple-slash', durationMs: 950, c1: '#9ad7ff', c2: '#eaf6ff' }, // 连刃斩
    huifeng_skill2: { kind: 'shadow-dash', durationMs: 900, c1: '#bfe4ff', c2: '#6fa8d8' },  // 风过留痕

    // ===== 玄霄：玄光司命（玄紫）=====
    xuanxiao_skill1: { kind: 'aura-buff', durationMs: 950, c1: '#b28dff', c2: '#e6d9ff' },   // 玄光加持
    xuanxiao_skill2: { kind: 'blessing', durationMs: 950, c1: '#d9c6ff', c2: '#8a6cd8' },    // 惊鸿再舞

    // ===== 琉璃：琉光守心（琉璃青 / 禅金）=====
    liuli_skill1: { kind: 'aura-buff', durationMs: 950, c1: '#7de3e0', c2: '#d8fff8' },      // 映月承锋
    liuli_skill2: { kind: 'blessing', durationMs: 1000, c1: '#ffe9a8', c2: '#f2c94c' },      // 禅悟：金莲净光

    // ===== 白泽：瑞兽通明（瑞白 / 天禄金）=====
    baize_skill1: { kind: 'blessing', durationMs: 950, c1: '#bdf0d2', c2: '#ffe9a8' },       // 瑞泽
    baize_skill2: { kind: 'light-summon', durationMs: 1250, c1: '#ffe9a8', c2: '#bdf0d2' },  // 天禄归生

    // ===== 长离：长夜燃星（星火赤金）=====
    changli_skill1: { kind: 'ember-flare', durationMs: 1000, c1: '#ff7a5c', c2: '#ffb347' }, // 暗夜燎原
    changli_skill2: { kind: 'pierce', durationMs: 900, c1: '#ffd166', c2: '#ff6b4a' },       // 星火贯日

    // ===== 镜：镜界双生（镜银）=====
    mirror_skill1: { kind: 'crystal-shatter', durationMs: 950, c1: '#dfe9ff', c2: '#9db4e0' }, // 破镜分光
    mirror_skill2: { kind: 'phase-swap', durationMs: 850, c1: '#cfe0ff', c2: '#8fa8d8' },      // 移形换影

    // ===== 夜枭：暗影猎手（夜紫 / 血绯）=====
    nightowl_skill1: { kind: 'hex-curse', durationMs: 1000, c1: '#ff5c7a', c2: '#8a6cff' },  // 死契之瞳
    nightowl_skill2: { kind: 'shadow-dash', durationMs: 800, c1: '#8a6cff', c2: '#ff5c7a' }, // 暗影突袭

    // ===== 莫问：时光剑客（时青）=====
    mowen_skill1: { kind: 'time-rewind', durationMs: 1050, c1: '#7fd4c1', c2: '#d3fff2' },   // 时光回溯
    mowen_skill2: { kind: 'arc-slash', durationMs: 850, c1: '#9fe8d8', c2: '#4a8a7c' },      // 逆时斩

    // ===== 孤影：寒锋孤影（寒冷蓝）=====
    guying_skill1: { kind: 'shadow-dash', durationMs: 850, c1: '#a8d8ff', c2: '#e8f6ff' },   // 踏雪留影
    guying_skill2: { kind: 'crystal-shatter', durationMs: 900, c1: '#c8e8ff', c2: '#7cb8f0' }, // 寒星碎

    // ===== 寒江雪：凛冬守望（霜白）=====
    hanjiangxue_skill1: { kind: 'ground-zone', durationMs: 1000, c1: '#bfe6ff', c2: '#e6f4ff' }, // 霜华覆地
    hanjiangxue_skill2: { kind: 'crystal-shatter', durationMs: 950, c1: '#9fd0f8', c2: '#ffffff' }, // 冰晶壁垒

    // ===== 骸骨君王：亡灵共鸣（骨白 / 冥火青）=====
    skeletonking_skill1: { kind: 'arc-slash', durationMs: 900, c1: '#d9d2c0', c2: '#9fe8c0' }, // 亡骨斩
    skeletonking_skill2: { kind: 'light-summon', durationMs: 1200, c1: '#9fe8c0', c2: '#d9d2c0' }, // 亡灵唤回

    // ===== 杰茨米：亡灵城主（幽冥紫 / 王冠金）=====
    jetzmi_skill1: { kind: 'arc-slash', durationMs: 900, c1: '#9d7bff', c2: '#5a3fb0' },      // 终焉斩
    jetzmi_skill2: { kind: 'hex-curse', durationMs: 1050, c1: '#9d7bff', c2: '#ffd75e' },     // 亡灵汲取

    // ===== 五弦琵琶：五弦清商（琵琶暖金）=====
    pipa_skill1: { kind: 'chord-notes', durationMs: 1000, c1: '#ffc98a', c2: '#fff1d6' },    // 五弦流转
    pipa_skill2: { kind: 'radial-burst', durationMs: 900, c1: '#ffd9a0', c2: '#ff9d5c' },     // 裂帛和弦

    // ===== 赏金猎人：黄金猎令（赏金 / 枪铅）=====
    bounty_skill1: { kind: 'hex-curse', durationMs: 950, c1: '#ffd75e', c2: '#c8783c' },      // 猎杀令
    bounty_skill2: { kind: 'pierce', durationMs: 850, c1: '#b8c4d8', c2: '#ffd75e' },         // 衔令追猎

    // ===== 阴阳师：两仪执契（阳金 / 阴紫）=====
    yinyang_skill1: { kind: 'cage-bind', durationMs: 1000, c1: '#f5d76e', c2: '#fff6d8' },    // 纯阳一线
    yinyang_skill2: { kind: 'cage-bind', durationMs: 1000, c1: '#6e5a8c', c2: '#3a2f52' },    // 玄阴一线

    // ===== 英雄X：无名震怒（神怒橙）=====
    hero_x_skill1: { kind: 'storm-bolt', durationMs: 900, c1: '#ff9d5c', c2: '#ffe08a' },     // 天神震怒
    hero_x_skill2: { kind: 'phase-swap', durationMs: 900, c1: '#ffb87c', c2: '#8ad8ff' },     // 增势跃迁

    // ===== 吟游诗人：长歌抚阵（竖琴绿 / 合唱金）=====
    bard_skill1: { kind: 'chord-notes', durationMs: 1000, c1: '#a5e8a0', c2: '#e8ffd8' },    // 奏鸣曲
    bard_skill2: { kind: 'blessing', durationMs: 1050, c1: '#ffe9a8', c2: '#a5e8a0' },       // 协奏曲

    // ===== 凋零之主：三命凋零（枯绿 / 腐紫）=====
    wither_lord_skill1: { kind: 'ground-zone', durationMs: 1000, c1: '#8a9a5b', c2: '#5a6a3a' }, // 凋零播撒
    wither_lord_skill2: { kind: 'radial-burst', durationMs: 950, c1: '#7a5a8c', c2: '#4a3a5c' },  // 凋零引爆

    // ===== T型帛画：帛上神游（金乌 / 玄龟）=====
    t_painting_skill1: { kind: 'ember-flare', durationMs: 1050, c1: '#e8c56f', c2: '#ff8c42' }, // 金乌
    t_painting_skill2: { kind: 'magic-array', durationMs: 1150, c1: '#4a7a6a', c2: '#9fd0b8' },  // 玄龟
    jinwu_skill: { kind: 'ember-flare', durationMs: 900, c1: '#ffd166', c2: '#ff9d3c' },        // 金乌耀斑
    xuangui_skill: { kind: 'radial-burst', durationMs: 850, c1: '#5a8a7a', c2: '#2f4a42' },      // 玄龟震击

    // ===== 旺财：通灵财神（财金）=====
    wangcai_skill1: { kind: 'radial-burst', durationMs: 850, c1: '#ffcf4d', c2: '#ff8c42' },  // 聚财一击
    wangcai_skill2: { kind: 'aura-buff', durationMs: 950, c1: '#ffd75e', c2: '#fff3c0' },     // 来财

    // ===== 薛定谔：量子观测（量子青）=====
    schrodinger_skill1: { kind: 'magic-array', durationMs: 1050, c1: '#6ee7d8', c2: '#b0a0ff' }, // 生死叠加
    schrodinger_skill2: { kind: 'cage-bind', durationMs: 1000, c1: '#8ff0e0', c2: '#6ea8ff' },    // 量子纠缠

    // ===== 莉莉丝：恐惧编织（梦魇紫红）=====
    lilith_skill1: { kind: 'pierce', durationMs: 850, c1: '#c04dff', c2: '#ff4d6d' },         // 恐惧之箭
    lilith_skill2: { kind: 'hex-curse', durationMs: 1050, c1: '#8c3fd8', c2: '#ff4d6d' },     // 恐惧蔓延

    // ===== 醉枕刀：醉卧沙场（酒琥珀）=====
    zuizhendao_skill1: { kind: 'pierce', durationMs: 850, c1: '#e8a860', c2: '#ffd9a0' },     // 醉掷寒锋
    zuizhendao_skill2: { kind: 'phase-swap', durationMs: 900, c1: '#d89050', c2: '#ffe0b0' }, // 醉影换位

    // ===== 风铃：大漠孤影（流沙金）=====
    fengling_skill1: { kind: 'shadow-dash', durationMs: 850, c1: '#e0c080', c2: '#c89050' },  // 流沙追猎
    fengling_skill2: { kind: 'ground-zone', durationMs: 1050, c1: '#d8b070', c2: '#f0d8a0' }, // 沙丘猎场

    // ===== 帝兰：御风羽君（顺逆风青）=====
    dilan_skill1: { kind: 'gale-vortex', durationMs: 950, c1: '#9fe8c8', c2: '#d8fff0' },     // 顺逆长风
    dilan_skill2: { kind: 'gale-vortex', durationMs: 900, c1: '#8fd8ff', c2: '#bfeaff' },     // 风压横扫

    // ===== 南风：御风行者（天青）=====
    nanfeng_skill1: { kind: 'gale-vortex', durationMs: 1000, c1: '#8fd8ff', c2: '#ffffff' },  // 扶摇
    nanfeng_skill2: { kind: 'ground-zone', durationMs: 1000, c1: '#b0e8ff', c2: '#e0f6ff' },  // 引风成道

    // ===== 上官婉儿：墨笔惊鸿（墨色）=====
    shangguan_skill1: { kind: 'pierce', durationMs: 850, c1: '#4a4a5a', c2: '#8a8ab0' },      // 落笔
    shangguan_skill2: { kind: 'shadow-dash', durationMs: 900, c1: '#3a3a48', c2: '#8a8ab0' }, // 笔走龙蛇

    // ===== 沉渊·镇岳：渊守（渊蓝）=====
    chenyuan_skill1: { kind: 'cage-bind', durationMs: 1000, c1: '#4a7a9c', c2: '#2f4a6a' },   // 渊引
    chenyuan_skill2: { kind: 'aura-buff', durationMs: 1000, c1: '#6a9abc', c2: '#bfe0f0' },   // 寒渊庇护

    // ===== 戴尔：时之旅人（时空紫）=====
    dai_skill1: { kind: 'time-rewind', durationMs: 1050, c1: '#b0a0ff', c2: '#e0d8ff' },      // 时空回溯
    dai_skill2: { kind: 'phase-swap', durationMs: 900, c1: '#9c8cf0', c2: '#d8d0ff' },        // 时空置换
};

/** 英雄级兜底档案（该英雄的技能未逐一定制时，取其技能一档案） */
const HERO_FX_FALLBACKS: Record<string, SkillFxProfile> = {
    wukong: { kind: 'wukong-staff', durationMs: 980 },
    feixue: { kind: 'feixue-stomp', durationMs: 1000 },
    soul_lamp: { kind: 'soul-lamp-array', durationMs: 1250 },
    libai: { kind: 'libai-slash', durationMs: 800 },
    feynman: { kind: 'feynman-burst', durationMs: 1000 },
};

// 由技能级档案自动派生英雄兜底：取 `${hero}_skill1` 的档案
for (const [skillId, profile] of Object.entries(SKILL_FX_PROFILES)) {
    const match = /^(.+)_skill1$/.exec(skillId);
    if (match && !HERO_FX_FALLBACKS[match[1]]) {
        HERO_FX_FALLBACKS[match[1]] = profile;
    }
}

const DEFAULT_SKILL_FX_PROFILE: SkillFxProfile = { kind: 'ink', durationMs: 750 };

/** 从技能 ID 推导英雄模板 ID（`wukong_skill1` → `wukong`） */
function heroIdFromSkillId(skillId: string): string {
    return skillId.replace(/_skill\d+$/, '');
}

/** 解析技能特效档案：先查技能级，再查英雄级兜底，最后回落通用墨韵波纹 */
export function resolveSkillFx(skillId?: string): SkillFxProfile {
    if (skillId) {
        const exact = SKILL_FX_PROFILES[skillId];
        if (exact) return exact;
        const heroFallback = HERO_FX_FALLBACKS[heroIdFromSkillId(skillId)];
        if (heroFallback) return heroFallback;
    }
    return DEFAULT_SKILL_FX_PROFILE;
}

/** 命中型特效：目标格应触发震屏 + 闪白反馈（伤害/爆发/压制类原型） */
const SKILL_FX_IMPACT_KINDS: ReadonlySet<SkillFxKind> = new Set<SkillFxKind>([
    'arc-slash',
    'triple-slash',
    'pierce',
    'radial-burst',
    'storm-bolt',
    'ember-flare',
    'crystal-shatter',
    'cage-bind',
    'hex-curse',
    'magic-array',
    'phase-swap',
    'ground-zone',
    'wukong-staff',
    'feixue-blade',
    'feixue-stomp',
]);

export function isImpactFxKind(kind: SkillFxKind): boolean {
    return SKILL_FX_IMPACT_KINDS.has(kind);
}

/**
 * 计算 from→target 的攻击角度（CSS 顺时针 deg）。
 * 屏幕坐标 row 向下，因此 atan2(dy, dx) 的结果与 CSS rotate 一致：
 * 0=右、90=下、±180=左、-90=上。
 */
export function computeFxAngleDeg(from: Position, to: Position): number {
    const dx = to[1] - from[1];
    const dy = to[0] - from[0];
    if (dx === 0 && dy === 0) return 0;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
}

const DIRECTION_ORDER: readonly SkillFxDirection[] = [
    'E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE',
] as const;

/** 把角度量化为八向标签（45° 扇区） */
export function computeFxDirection(angleDeg: number): SkillFxDirection {
    const normalized = ((angleDeg % 360) + 360) % 360;
    return DIRECTION_ORDER[Math.round(normalized / 45) % 8];
}
