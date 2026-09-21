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
import type { BattleLogEntry, Player, Position, Skill } from '../types/game';
import { BOARD_SIZE } from '../types/game';

// 供 SkillFxLayer 等视觉层统一从本模块取坐标类型
export type { Position };

/** 技能特效视觉方案（定制原型 + 通用原型） */
export type SkillFxKind =
    // —— 初代定制（悟空/绯雪/缚魂灯/太白/费曼，样式已固化在各自 CSS 段）——
    | 'wukong-clone'    // 悟空·毫毛化分身：毫毛带流光旋飞掠向落点 + 烟雾绽开 + 光柱冲击环 + 分身凝形
    | 'wukong-staff'    // 悟空·金箍棒砸击：循攻击方向落棒 + 冲击波 + 尘土
    | 'feixue-blade'    // 绯雪·霜刃破阵：三连冰刃斜掠 + 冰核爆闪 + 碎冰四溅
    | 'feixue-stomp'    // 绯雪·踏雪追命：大雪花压落 + 冰棱迸刺 + 冰环扩散
    | 'feixue-shatter'  // 绯雪·破冰爆震（技能1击碎冰冻形态）：冰核炸裂 + 冰棱环射 + 霜柱冲天
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
    | 'wind-blade-volley' // 四向风刃：四弯风刃自施法者向上下左右射出
    | 'chord-notes'     // 乐律：音符上浮 + 弦波涟漪
    | 'time-rewind'     // 时溯：倒转符环 + 逆走指针
    | 'frost-spikes'    // 寒江雪·冰刺天降：巨型冰锥自空砸落 + 碎冰迸溅 + 严寒雾
    | 'guying-swordqi'  // 孤影·寒星剑气：冷焰巨剑光斜劈 + 星芒炸裂
    | 'mirror-blades'   // 镜·破镜飞刃：三枚镜刃自三方合击 + 碎镜闪光
    | 'xubai-pearls'    // 叙白·黑白凝珠：三颗阴阳珠汇聚环绕
    | 'lingxi-wave'     // 泠汐·海浪涟漪：潮面漫染 + 多道浪环一圈圈荡开 + 浪尖白沫
    | 'lingxi-fan'      // 泠汐·涌潮折扇：自施法者展开的巨扇横扫
    | 'jinghong-slash-ring' // 惊鸿·环海旋斩：水蓝刀痕沿 5×5 外圈顺时针逐格斩过
    | 'jinghua-moonblade' // 镜花·月华飞斩：一弯月牙刃自镜花格飞向敌人，落点绽开月华斩痕
    | 'xueqi-scythe'    // 血契·血誓横扫：红色镰刀绕自身旋转一圈，刀尖拖出血色扫弧
    | 'fengling-claw'   // 风铃·爪牙撕裂：三道扇形爪痕依次撕开 + 亮爪尖 + 沙砾迸溅
    | 'fengling-pounce' // 风铃·掠沙闪袭：残影自起手格跨格疾闪至目标格，落点补一记爪咬尘爆
    | 'zuizhen-throw'   // 醉枕刀·醉掷寒锋：掷刀疾飞 + 沿冲刺路径铺展的琥珀光轨与逐段疾光残影，沿途每格各吃一记贯斩
    | 'zuizhen-wheel'   // 醉枕刀·醉影换位：落位后一柄太刀绕格心旋满一周，刃尖拖出旋扫弧光，周身一圈斩痕依次亮起
    | 'yunying-sweep'   // 云缨·星火照野：长枪横扰，弧刃按拍逐条甩开（时序分明）+ 收势枪杆抽打
    | 'yunying-arc-slash'  // 云缨·踏火长驱：正前方一排3格挨两道圆弧火斩，先左→右再右→左
    | 'liehuo-blaze'    // 云缨·烈火燎原：火线沿射线逐格引燃，火焰柱一路烧到棋盘尽头
    | 'ink';            // 默认兜底：墨韵波纹

/** 特效原型的中文展示名（供图鉴等处呈现；新增原型时由类型强制补齐） */
export const SKILL_FX_KIND_LABELS: Record<SkillFxKind, string> = {
    'wukong-clone': '毫毛化分身',
    'wukong-staff': '金箍棒砸击',
    'feixue-blade': '霜刃破阵',
    'feixue-stomp': '踏雪追命',
    'feixue-shatter': '破冰爆震',
    'soul-lamp-array': '暗夜法阵',
    'soul-lamp-cycle': '缚魂轮转',
    'libai-slash': '醉剑',
    'libai-flurry': '剑气纵横',
    'feynman-beam': '粒子束',
    'feynman-burst': '粒子轰爆',
    'arc-slash': '弧光斩',
    'triple-slash': '三连斩',
    'pierce': '贯日突刺',
    'radial-burst': '环形爆发',
    'magic-array': '法阵',
    'light-summon': '召光',
    'blessing': '祝福治愈',
    'aura-buff': '增益',
    'hex-curse': '诅咒',
    'shadow-dash': '突进',
    'phase-swap': '换位瞬移',
    'ground-zone': '领域',
    'cage-bind': '束缚',
    'crystal-shatter': '晶碎',
    'ember-flare': '焰浪',
    'storm-bolt': '雷霆',
    'gale-vortex': '旋风',
    'wind-blade-volley': '四向风刃',
    'chord-notes': '乐律',
    'time-rewind': '时溯',
    'frost-spikes': '冰刺天降',
    'guying-swordqi': '寒星剑气',
    'mirror-blades': '破镜飞刃',
    'xubai-pearls': '黑白凝珠',
    'lingxi-wave': '海浪涟漪',
    'lingxi-fan': '涌潮折扇',
    'jinghong-slash-ring': '环海旋斩',
    'jinghua-moonblade': '月华飞斩',
    'xueqi-scythe': '血镰旋环',
    'zuizhen-throw': '醉掷疾影',
    'zuizhen-wheel': '醉影旋斩',
    'fengling-claw': '爪牙撕裂',
    'fengling-pounce': '掠沙闪袭',
    'yunying-sweep': '乱樱枪影',
    'yunying-arc-slash': '踏火双斩',
    'liehuo-blaze': '燎原火墙',
    'ink': '墨韵波纹',
};

/** 单个技能的特效档案 */
export interface SkillFxProfile {
    kind: SkillFxKind;
    durationMs: number;
    /** 主色（十六进制）；缺省时沿用 kind 自带样式（初代定制与 ink） */
    c1?: string;
    /** 辅色（十六进制） */
    c2?: string;
    /** 区域底光的覆盖形状。缺省时由技能自身的 rangeType/areaSize/range/targetCount
     *  推导（见 skill-fx-coverage.ts）；引擎里带特判展开的技能需在此显式声明，
     *  'none' 表示不铺底光（全场技等只需命中格反馈） */
    fxArea?: number | 'line' | 'cross' | 'bar' | 'diamond' | 'self' | 'self-box' | 'none';
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
    /** 溅射格列表（火系余波）：每格渲染一圈小火点，弱于目标格主效 */
    splashPositions?: Position[];
    /** 链式闪电链路格列表（按传播顺序）：从主目标格出发逐格跳跃，
     *  渲染时以相邻两段连线角度对齐锯齿电光 */
    chainLinks?: Position[];
    /** 本次施法真正打到/治疗到的格子（采集自 damage/heal 日志，去重并按距主目标升序）。
     *  攻击型 AOE 由此做到"打到几个人就爆几份特效"；与主目标格重合的格由渲染层排除 */
    impactPositions?: Position[];
    /** impactPositions 中来自治疗日志的子集：受益格走柔光版印记而非受击印记 */
    softImpactPositions?: Position[];
    /** 技能作用区域的全部格子（含空格），铺贴地底光勾出 AOE 空间轮廓 */
    coveredPositions?: Position[];
    /** AOE 整体特效的覆盖范围（作用区域包围盒；全场伤害技回退整盘）。
     *  由派发层从 coveredPositions / 技能几何推导，Board 据此渲染一张
     *  跨格子的整体动效（冲击波/火海/雷暴…），与逐格特效叠加 */
    areaBounds?: SkillAreaBounds;
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
    feixue_skill1: { kind: 'feixue-blade', durationMs: 980, c1: '#9fd8ff', c2: '#eaf7ff' },
    feixue_skill2: { kind: 'feixue-stomp', durationMs: 1150, c1: '#a5dcff', c2: '#f0faff' },
    // 技能1击碎冰冻时的条件形态：由技能 execute 通过 skillFxExtras.fxVariant 覆盖档案
    feixue_shatter: { kind: 'feixue-shatter', durationMs: 1250, c1: '#bfe9ff', c2: '#ffffff' },
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
    zhenxiao_skill1: { kind: 'storm-bolt', durationMs: 1050, c1: '#ffd34d', c2: '#ff8c42', fxArea: 'bar' }, // 雷血开锋（面前横排3格 + 链式闪电跳跃）
    zhenxiao_skill2: { kind: 'cage-bind', durationMs: 1100, c1: '#f5d76e', c2: '#c8ccd8' }, // 金银错：金银锁笼

    // ===== 回锋：回刃听锋（赤红三连斩）=====
    huifeng_skill1: { kind: 'triple-slash', durationMs: 950, c1: '#ff4655', c2: '#ffc9b8' }, // 连刃斩：三段赤红斜斩
    huifeng_skill2: { kind: 'arc-slash', durationMs: 900, c1: '#bfe4ff', c2: '#6fa8d8' },   // 风过留痕：双目标落斩并标记

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
    changli_skill1: { kind: 'ember-flare', durationMs: 1350, c1: '#ff7a5c', c2: '#ffb347' }, // 暗夜燎原（全场火海）
    changli_skill2: { kind: 'pierce', durationMs: 1050, c1: '#ffd166', c2: '#ff6b4a' },      // 星火贯日（含溅射余波）

    // ===== 镜：镜界双生（镜银）=====
    mirror_skill1: { kind: 'crystal-shatter', durationMs: 950, c1: '#dfe9ff', c2: '#9db4e0' }, // 破镜分光
    mirror_skill2: { kind: 'shadow-dash', durationMs: 900, c1: '#cfe0ff', c2: '#8fa8d8' },      // 移形换影：本体镜像镜像冲刺拖尾
    // 镜被动「破镜之刃」触发时的飞刃合击（非技能，由战报标记驱动派发）
    mirror_blade: { kind: 'mirror-blades', durationMs: 950, c1: '#e8f0ff', c2: '#9db4e0' },

    // ===== 夜枭：暗影猎手（夜紫 / 血绯）=====
    nightowl_skill1: { kind: 'hex-curse', durationMs: 1000, c1: '#ff5c7a', c2: '#8a6cff' },  // 死契之瞳
    nightowl_skill2: { kind: 'shadow-dash', durationMs: 800, c1: '#8a6cff', c2: '#ff5c7a' }, // 暗影突袭

    // ===== 莫问：时光剑客（时青）=====
    mowen_skill1: { kind: 'time-rewind', durationMs: 1050, c1: '#7fd4c1', c2: '#d3fff2' },   // 时光回溯
    mowen_skill2: { kind: 'arc-slash', durationMs: 850, c1: '#9fe8d8', c2: '#4a8a7c' },      // 逆时斩

    // ===== 孤影：寒锋孤影（寒冷蓝）=====
    guying_skill1: { kind: 'shadow-dash', durationMs: 850, c1: '#a8d8ff', c2: '#e8f6ff' },   // 踏雪留影
    guying_skill2: { kind: 'guying-swordqi', durationMs: 900, c1: '#c8ecff', c2: '#6fb6f0' }, // 寒星碎：冷焰巨剑光

    // ===== 寒江雪：凛冬守望（霜白）=====
    hanjiangxue_skill1: { kind: 'frost-spikes', durationMs: 1150, c1: '#bfe6ff', c2: '#e6f4ff', fxArea: 3 }, // 霜华覆地：冰刺天降
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
    hero_x_skill1: { kind: 'storm-bolt', durationMs: 1250, c1: '#ff9d5c', c2: '#ffe08a' },   // 天神震怒（全场雷暴）
    hero_x_skill2: { kind: 'phase-swap', durationMs: 900, c1: '#ffb87c', c2: '#8ad8ff' },     // 增势跃迁

    // ===== 吟游诗人：长歌抚阵（竖琴绿 / 合唱金）=====
    bard_skill1: { kind: 'chord-notes', durationMs: 1000, c1: '#a5e8a0', c2: '#e8ffd8' },    // 奏鸣曲
    bard_skill2: { kind: 'blessing', durationMs: 1050, c1: '#ffe9a8', c2: '#a5e8a0' },       // 协奏曲

    // ===== 凋零之主：三命凋零（枯绿 / 腐紫）=====
    wither_lord_skill1: { kind: 'ground-zone', durationMs: 1000, c1: '#8a9a5b', c2: '#5a6a3a' }, // 凋零播撒
    wither_lord_skill2: { kind: 'radial-burst', durationMs: 1100, c1: '#7a5a8c', c2: '#4a3a5c' },  // 凋零引爆（全场冲击）

    // ===== T型帛画：帛上神游（金乌 / 玄龟）=====
    t_painting_skill1: { kind: 'ember-flare', durationMs: 1050, c1: '#e8c56f', c2: '#ff8c42' }, // 金乌
    t_painting_skill2: { kind: 'magic-array', durationMs: 1150, c1: '#4a7a6a', c2: '#9fd0b8' },  // 玄龟
    jinwu_skill: { kind: 'ember-flare', durationMs: 900, c1: '#ffd166', c2: '#ff9d3c' },        // 金乌耀斑
    xuangui_skill: { kind: 'radial-burst', durationMs: 850, c1: '#5a8a7a', c2: '#2f4a42' },      // 玄龟震击

    // ===== 旺财：通灵财神（财金）=====
    wangcai_skill1: { kind: 'radial-burst', durationMs: 850, c1: '#ffcf4d', c2: '#ff8c42' },  // 聚财一击
    wangcai_skill2: { kind: 'aura-buff', durationMs: 950, c1: '#ffd75e', c2: '#fff3c0' },     // 来财

    // ===== 薛定谔：量子观测（量子青）=====
    schrodinger_skill1: { kind: 'magic-array', durationMs: 1050, c1: '#6ee7d8', c2: '#b0a0ff', fxArea: 3 }, // 生死叠加（点击格扩成3x3）
    schrodinger_skill2: { kind: 'cage-bind', durationMs: 1000, c1: '#8ff0e0', c2: '#6ea8ff' },    // 量子纠缠

    // ===== 莉莉丝：恐惧编织（梦魇紫红）=====
    lilith_skill1: { kind: 'pierce', durationMs: 850, c1: '#c04dff', c2: '#ff4d6d' },         // 恐惧之箭
    lilith_skill2: { kind: 'hex-curse', durationMs: 1050, c1: '#8c3fd8', c2: '#ff4d6d' },     // 恐惧蔓延

    // ===== 醉枕刀：醉卧沙场（酒琥珀）=====
    zuizhendao_skill1: { kind: 'zuizhen-throw', durationMs: 1000, c1: '#e8a860', c2: '#ffd9a0', fxArea: 'none' }, // 醉掷寒锋：掷刀+沿真实路径逐格跟踪的疾影光轨
    zuizhendao_skill2: { kind: 'zuizhen-wheel', durationMs: 1150, c1: '#d89050', c2: '#ffe0b0', fxArea: 'none' }, // 醉影换位：换位后太刀绕身旋斩一周

    // ===== 风铃：大漠孤影（流沙金）=====
    fengling_skill1: { kind: 'fengling-claw', durationMs: 900, c1: '#f5d9a0', c2: '#c89050' },  // 流沙追猎：爪牙撕裂
    fengling_skill2: { kind: 'ground-zone', durationMs: 1050, c1: '#d8b070', c2: '#f0d8a0' },    // 沙丘猎场
    // 天威「猎砂追击」的闪袭特效（非技能，由战报标记派发）
    fengling_pounce: { kind: 'fengling-pounce', durationMs: 1080, c1: '#ffe6b0', c2: '#a4682c' },

    // ===== 帝兰：御风羽君（顺逆风青）=====
    dilan_skill1: { kind: 'gale-vortex', durationMs: 950, c1: '#9fe8c8', c2: '#d8fff0' },     // 顺逆长风
    dilan_skill2: { kind: 'gale-vortex', durationMs: 900, c1: '#8fd8ff', c2: '#bfeaff' },     // 风压横扫

    // ===== 南风：御风行者（天青）=====
    nanfeng_skill1: { kind: 'gale-vortex', durationMs: 1000, c1: '#8fd8ff', c2: '#ffffff' },  // 扶摇
    nanfeng_skill2: { kind: 'ground-zone', durationMs: 1000, c1: '#b0e8ff', c2: '#e0f6ff' },  // 引风成道

    // ===== 云缨：瑞火缨枪（焰橙金）=====
    yunying_skill1: { kind: 'yunying-sweep', durationMs: 1350, c1: '#ffcf7a', c2: '#ff7a3c' },   // 星火照野：弧刃逐条甩开，收势枪杆抽打
    yunying_skill2: { kind: 'yunying-arc-slash', durationMs: 1400, c1: '#ffb347', c2: '#ff4d2e' },  // 踏火长驱：两道圆弧火斩来回扫过正前方一排3格
    // 烈火燎原：祥瑞满层引燃（非技能，由 store 挂起选择后显式派发，带射线覆盖格）
    yunying_liehuo: { kind: 'liehuo-blaze', durationMs: 1900, c1: '#ff7a3c', c2: '#ffe08a' },

    // ===== 上官婉儿：墨笔惊鸿（墨色）=====
    shangguan_skill1: { kind: 'pierce', durationMs: 850, c1: '#4a4a5a', c2: '#8a8ab0' },      // 落笔
    shangguan_skill2: { kind: 'shadow-dash', durationMs: 900, c1: '#3a3a48', c2: '#8a8ab0' }, // 笔走龙蛇

    // ===== 沉渊·镇岳：渊守（渊蓝）=====
    chenyuan_skill1: { kind: 'cage-bind', durationMs: 1000, c1: '#4a7a9c', c2: '#2f4a6a' },   // 渊引
    chenyuan_skill2: { kind: 'aura-buff', durationMs: 1000, c1: '#6a9abc', c2: '#bfe0f0' },   // 寒渊庇护

    // ===== 戴尔：时之旅人（时空紫）=====
    dai_skill1: { kind: 'time-rewind', durationMs: 1050, c1: '#b0a0ff', c2: '#e0d8ff' },      // 时空回溯
    dai_skill2: { kind: 'phase-swap', durationMs: 900, c1: '#9c8cf0', c2: '#d8d0ff' },        // 时空置换

    // ===== 游隼：裂风猎隼（风青）=====
    youjun_skill1: { kind: 'shadow-dash', durationMs: 900, c1: '#8fd8ff', c2: '#e0f6ff' },    // 疾掠
    youjun_skill2: { kind: 'wind-blade-volley', durationMs: 1000, c1: '#5cc8f0', c2: '#eafaff' },   // 四向风刃：四弯风刃射向周身四格

    // ===== 叙白：净化治疗与黑白凝珠（素白青 / 暖金）=====
    xubai_skill1: { kind: 'blessing', durationMs: 1050, c1: '#dff2e6', c2: '#9fd8c0' },       // 涤秽回春
    xubai_skill2: { kind: 'xubai-pearls', durationMs: 1150, c1: '#f4f8ff', c2: '#2c2c38' },   // 黑白凝珠：三珠汇聚环绕

    // ===== 泠汐：潮汐多段攻击（潮青 / 月白）=====
    // 涟漪要压在浅色水墨盘面上才看得见，故主色取深潮青而非亮青
    lingxi_skill1: { kind: 'lingxi-wave', durationMs: 1200, c1: '#2b83ad', c2: '#9ce6f7' },   // 海螺回响：海浪涟漪
    lingxi_skill2: { kind: 'lingxi-fan', durationMs: 1050, c1: '#5ab8d8', c2: '#c8f0ff' },    // 涌潮拍岸：折扇展开横扫

    // ===== 惊鸿·止水：掠水绕后与止水决渊（月白青 / 静水蓝）=====
    jinghong_skill1: { kind: 'shadow-dash', durationMs: 900, c1: '#8fb8d8', c2: '#e8f6ff' },   // 掠水惊鸿：残影跨格疾闪，落点补一记斩
    // 决渊：一柄水蓝旋刃以她为心顺时针扫满一圈（渲染在施法者格，半径约 2.1 格），
    // 转满再炸开一圈外飞水沫。fxArea 挂 'none' 关掉整块区域特效；
    // 圆环越界的部分由 clip-path 按她到盘边的距离裁掉。
    jinghong_skill2: { kind: 'jinghong-slash-ring', durationMs: 900, c1: '#2f8fb0', c2: '#bdf0ff', fxArea: 'none' },
    // 蓄力段的条件形态（execute 经 skillFxExtras.fxVariant 覆盖默认档案）：静水自养的光环
    jinghong_still: { kind: 'aura-buff', durationMs: 900, c1: '#4fa8cc', c2: '#dff4ff', fxArea: 'none' },

    // ===== 镜花·水月：换身映月（镜银蓝 / 月华白）=====
    jinghua_skill1: { kind: 'phase-swap', durationMs: 950, c1: '#a8d4f0', c2: '#eaf6ff' },      // 水月换身：两端涡环，原位铺一枚水月底纹
    jinghua_skill2: { kind: 'light-summon', durationMs: 1150, c1: '#b8d8ff', c2: '#f2f8ff', fxArea: 'none' }, // 印月替身：候补身上召光登场，镜花端涡环淡出
    // 天威「镜花照水」登场照击（非主动技能，由特效请求队列派发）：
    // 一弯月牙刃自镜花格飞向被照中的敌人，落点绽出月华斩痕。
    // 主色取深镜蓝而非淡银蓝——淡色压在浅色水墨盘面上几乎看不见。
    jinghua_tianwei: { kind: 'jinghua-moonblade', durationMs: 900, c1: '#3f7fae', c2: '#dff2ff' },
    // 天威击杀后的「月影回声」：被点名友方脚下亮起月华光柱
    jinghua_tianwei_echo: { kind: 'light-summon', durationMs: 950, c1: '#bfe0ff', c2: '#f6fbff' },

    // ===== 血契：血誓横扫与强锁（赤血 / 骨白）作用区均以施法者为中心 =====
    xueqi_skill1: { kind: 'xueqi-scythe', durationMs: 900, c1: '#c0392f', c2: '#ffd0c6', fxArea: 'self-box' }, // 血誓横扫：血镰绕身旋一圈（天威复用此档案）
    xueqi_skill2: { kind: 'cage-bind', durationMs: 1000, c1: '#8e2f2a', c2: '#e8a49b', fxArea: 'self-box' },   // 血契锁：笼环收拢圈定周身
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
    'frost-spikes',
    'guying-swordqi',
    'mirror-blades',
    'wukong-staff',
    'feixue-blade',
    'feixue-stomp',
    'feixue-shatter',
    'fengling-claw',
    'fengling-pounce',
    'lingxi-wave',
    'lingxi-fan',
    'jinghong-slash-ring',
    'jinghua-moonblade',
    'zuizhen-throw',
    'zuizhen-wheel',
    'yunying-sweep',
    'yunying-arc-slash',
]);

export function isImpactFxKind(kind: SkillFxKind): boolean {
    return SKILL_FX_IMPACT_KINDS.has(kind);
}

/**
 * 逐格出"本体主效"的原型：这些图形本身就是一次命中的特写（斩击/突刺/落雷/晶碎…），
 * 多个目标各来一份最有打击感。法阵/领域/增益类刻意不在其列——否则 3x3 法阵会在
 * 9 个格子里各立一根光柱糊成一片，它们在次要格子上只出轻量印记。
 */
const SKILL_FX_PER_TARGET_KINDS: ReadonlySet<SkillFxKind> = new Set<SkillFxKind>([
    'arc-slash',
    'triple-slash',
    'pierce',
    'storm-bolt',
    'crystal-shatter',
    'ember-flare',
    'radial-burst',
    'hex-curse',
    'guying-swordqi',
    'mirror-blades',
    'wukong-staff',
    'feixue-blade',
    'feixue-stomp',
    'feixue-shatter',
    'lingxi-wave',
    // 天威照中几名敌人，就飞来几弯月牙刃：飞斩本身就是这一击的特写
    'jinghua-moonblade',
    'zuizhen-throw',
    // 踏火长驱：打到的每格各起一团"被刀锋扫过"的火气（刀光本身由区域层那一柄巨刃扫，
    // 见 AREA_FX_KIND_MAP 的 bladesweep，逐格刻刀痕会看成三刀）
    'yunying-arc-slash',
    // 星火照野的乱樱枪影刻意不入列，避免 3×3 每格都甩一遍弧刃糊成一片
]);

export function isPerTargetFxKind(kind: SkillFxKind): boolean {
    return SKILL_FX_PER_TARGET_KINDS.has(kind);
}

/** 单次施法最多渲染几个命中格（全场技在 6x6 上可覆盖全盘，需封顶防糊） */
const MAX_FX_IMPACT_CELLS = 8;
/** 命中格波浪：距主目标每远一格延后起播的毫秒数（6x6 上最多 5 档 = 225ms） */
const FX_CELL_STAGGER_MS = 45;
/** 尾格额外存活余量：晚起播的次要特效也要完整淡出，不能被生命周期提前回收 */
const FX_TAIL_GRACE_MS = 140;

/** 两格间的切比雪夫距离（斜向算 1 格，与"一层层荡开"的观感一致） */
function cellSteps(from: Position, to: Position): number {
    return Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
}

/** 某一格相对主目标的波浪起播延迟（毫秒），主目标格为 0 */
export function computeFxCellDelayMs(origin: Position, cell: Position): number {
    return cellSteps(origin, cell) * FX_CELL_STAGGER_MS;
}

/** 从日志 details 里安全读出一个棋盘格（details 是 Record<string, unknown>） */
function readLoggedCell(details?: Record<string, unknown>): Position | null {
    const raw = details?.position;
    if (!Array.isArray(raw) || raw.length !== 2) return null;
    const [row, col] = raw as [unknown, unknown];
    if (typeof row !== 'number' || typeof col !== 'number') return null;
    if (row < 0 || row > 5 || col < 0 || col > 5) return null;
    return [row, col];
}

/**
 * 采集本次施法真正打到/治疗到的格子。
 *
 * 依据是战斗日志而非技能实现：每条 damage/heal 日志都由伤害结算写入受害者当时的
 * position，一次 AOE 命中几人就有几条，因此无需给 40 多个技能逐个埋点，
 * 本地施法、人机 AI 与联机回放三条路径还能天然共用同一判据。
 * 闪避与目标转移只记 passive 日志，正好不会产生命中格。
 * 返回结果按距主目标升序并截断，softImpactPositions 是其中治疗来源的子集。
 */
export function collectImpactPositions(
    logs: BattleLogEntry[],
    primary: Position
): { impactPositions?: Position[]; softImpactPositions?: Position[] } {
    const cells: Position[] = [];
    const healedKeys = new Set<string>();
    const seen = new Set<string>();

    for (const entry of logs) {
        if (entry.type !== 'damage' && entry.type !== 'heal') continue;
        const cell = readLoggedCell(entry.details);
        if (!cell) continue;
        const key = `${cell[0]}:${cell[1]}`;
        if (!seen.has(key)) {
            seen.add(key);
            cells.push(cell);
        }
        if (entry.type === 'heal') healedKeys.add(key);
    }

    if (cells.length === 0) return {};

    cells.sort((a, b) => cellSteps(primary, a) - cellSteps(primary, b));
    const kept = cells.slice(0, MAX_FX_IMPACT_CELLS);
    return {
        impactPositions: kept,
        softImpactPositions: kept.filter(
            ([row, col]) => healedKeys.has(`${row}:${col}`)
        ),
    };
}

/** 多格波浪所需额外存活时长：最大格间延迟 + 淡出余量；单格事件为 0 */
export function computeFxTailMs(event: SkillFxEvent): number {
    const cells = [...(event.impactPositions ?? []), ...(event.coveredPositions ?? [])];
    if (cells.length === 0) return 0;
    const maxDelay = cells.reduce(
        (max, cell) => Math.max(max, computeFxCellDelayMs(event.targetPos, cell)),
        0
    );
    return maxDelay + FX_TAIL_GRACE_MS;
}

/* ============================================================
   AOE 整体特效（区域级，一张跨格子的大动效叠加在逐格特效之下）
   ============================================================ */

/** AOE 整体特效的区域包围盒（棋盘格坐标，半开区间 [r0, r0+rows) × [c0, c0+cols)） */
export interface SkillAreaBounds {
    r0: number;
    c0: number;
    rows: number;
    cols: number;
}

/** 区域整体特效的原型（按技能的逐格原型 kind 映射，见 resolveAreaFxKind） */
export type SkillAreaFxKind =
    | 'shockwave'    // 区域冲击波：巨环扩张 + 放射地裂 + 碎屑环
    | 'firestorm'    // 火海燎原：火焰前锋横扫全区域 + 余烬升腾 + 灼地闪光
    | 'thunderstorm' // 雷暴压顶：区域闪白 + 多道落雷错落劈下 + 电弧余韵
    | 'cage'         // 缚域成形：四边锁栏收拢 + 四角封印 + 中心锁定闪光
    | 'runearray'    // 守护法阵：覆盖范围的双旋巨符环 + 错落光柱
    | 'rippletide'   // 潮纹涟漪：潮面漫染 + 起伏浪环自中心一圈圈荡向区域边缘
    | 'groundwave'   // 领域地波：贴地椭圆波由心荡开 + 区域滞留辉光
    | 'slashwave'    // 巨刃横扫：循攻击方向掠过整片区域的巨型弧刃
    | 'icespikes'    // 冰刺天降：冰锥成片自空砸落覆盖整个区域
    | 'iceshatter'   // 破冰爆震：冰面轰然炸裂，冰棱自中心向外环射 + 霜原闪光
    | 'firewall'     // 燎原火墙：火线自施法者一端沿射线烧到尽头 + 灼地焦痕 + 热浪扭曲
    | 'bladesweep';  // 巨刃来回扫：一柄红刃沿整片命中面横扫两次，去程回程之间留空档

/**
 * 从区域格集合求包围盒；空集合返回 null。
 */
export function boundsFromCells(cells: Position[] | undefined): SkillAreaBounds | null {
    if (!cells || cells.length === 0) return null;
    let r0 = cells[0][0];
    let c0 = cells[0][1];
    let r1 = r0;
    let c1 = c0;
    for (const [r, c] of cells) {
        if (r < r0) r0 = r;
        if (c < c0) c0 = c;
        if (r > r1) r1 = r;
        if (c > c1) c1 = c;
    }
    return { r0, c0, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
}

/**
 * 计算 AOE 整体特效的覆盖范围：
 * 1) 有区域格（coveredPositions）→ 取其包围盒（3x3、横排、十字、菱形…统一适用）；
 * 2) 无区域格但属"全场 + 伤害类"（暗夜燎原/凋零引爆/天神震怒这类）→ 整张棋盘；
 * 3) 其余（单体、治疗/增益型全场技）→ 不出整体特效。
 */
export function computeSkillAreaBounds(
    skill: Pick<Skill, 'rangeType' | 'type'>,
    covered: Position[] | undefined
): SkillAreaBounds | null {
    const fromCovered = boundsFromCells(covered);
    if (fromCovered) return fromCovered;
    if (skill.rangeType === '全场' && skill.type === 'damage') {
        return { r0: 0, c0: 0, rows: BOARD_SIZE, cols: BOARD_SIZE };
    }
    return null;
}

/** 逐格原型 → 区域整体原型 的映射（未列出的走 shockwave 兜底） */
const AREA_FX_KIND_MAP: Partial<Record<SkillFxKind, SkillAreaFxKind>> = {
    'ember-flare': 'firestorm',
    'liehuo-blaze': 'firewall',
    // 踏火长驱的命中面是一整排格子，刀光必须由一张跨格巨刃来回扫，不能逐格各刻一道
    'yunying-arc-slash': 'bladesweep',
    'storm-bolt': 'thunderstorm',
    'cage-bind': 'cage',
    'magic-array': 'runearray',
    'light-summon': 'runearray',
    'wukong-clone': 'runearray',
    'ground-zone': 'groundwave',
    'frost-spikes': 'icespikes',
    'feixue-shatter': 'iceshatter',
    'lingxi-wave': 'rippletide',
    'triple-slash': 'slashwave',
    'arc-slash': 'slashwave',
    // 治疗祝福/增益类法阵化，避免区域级爆炸感盖过辅助语义
    'blessing': 'runearray',
    'aura-buff': 'runearray',
    'chord-notes': 'runearray',
};

export function resolveAreaFxKind(kind: SkillFxKind): SkillAreaFxKind {
    return AREA_FX_KIND_MAP[kind] ?? 'shockwave';
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
