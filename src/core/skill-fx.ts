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
import { lingxiTideHitMs } from './lingxi-tide-fx';
import { dragonCallHitMs, dragonDashHitMs, dragonSweepCellHitMs } from './dragon-sweep-fx';
import type { CraftedFxTheme } from './crafted-skill-fx';

// 供 SkillFxLayer 等视觉层统一从本模块取坐标类型
export type { Position };

/** 技能特效视觉方案（定制原型 + 通用原型） */
export type SkillFxKind =
    // —— 初代定制（悟空/绯雪/缚魂灯/太白/逐光，样式已固化在各自 CSS 段）——
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
    | 'huanongying-fan' // 花弄影·花间辞：折扇起舞 + 一整面花刃横扫扇形三格
    | 'huanongying-swap' // 花弄影·弄影：两端花影开合 + 花瓣移形 + 落位环斩
    | 'huanongying-replay' // 花弄影·影子重演：半透明影身复演花刃
    | 'zhiyuan-reel'    // 纸鸢·断线冲天：线轴烧断时的左右来回乱剪，角度与错位都打散
    | 'xihuan-level'   // 羲和·均光：一圈曦光扫过所有友方，把血量抹平到同一档
    | 'jiangtaigong-cast'      // 姜太公·垂钩：钓线自上方垂落，钩尖触水荡开涟漪
    | 'moonlight-sweep'  // 夕月辞·辞光散影：一圈月光贴着地面旋开，扫到的人各自被掀一下
    | 'lamp-lighting'    // 夕月辞·明灯照影：灯落在格上，光晕推开、周围一圈影子被拉长
    | 'jiangtaigong-throw'     // 姜太公·抛掷：钓线沿攻击轴绷紧甩过去，落点炸开水花
    | 'jiangtaigong-whalefall' // 姜太公·鲸落：鲸影压进水里，尾鳍一挑后两圈浪环荡开
    | 'ground-zone'     // 领域：贴地波纹扩散 + 地面辉光
    | 'cage-bind'       // 束缚：收拢笼环 + 交叉锁光
    | 'crystal-shatter' // 晶碎：闪核 + 晶屑迸溅 + 玻璃环
    | 'ember-flare'     // 焰浪：火热闪焰 + 上升余烬
    | 'wenren-leap'     // 闻人翊悬·蹈火跃阵：烬步断痕 + 落点裂火环
    | 'wenren-reap'     // 闻人翊悬·破妄燎原：内收余烬 + 环身裂焰
    | 'storm-bolt'      // 雷霆：锯齿电光闪击 + 震环
    | 'gale-vortex'     // 旋风：对旋涡环 + 风纹
    | 'wind-blade-volley' // 四向风刃：四弯风刃自施法者向上下左右射出
    | 'chord-notes'     // 乐律：音符上浮 + 弦波涟漪
    | 'time-rewind'     // 时溯：倒转符环 + 逆走指针
    | 'frost-spikes'    // 寒江雪·冰刺天降：巨型冰锥自空砸落 + 碎冰迸溅 + 严寒雾
    | 'guying-swordqi'  // 孤影·寒星剑气：冷焰巨剑光斜劈 + 星芒炸裂
    | 'mirror-blades'   // 镜·破镜飞刃：一层一刃，沿曲线追踪真实受击目标
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
    | 'liehuo-wheel'    // 云缨·燎原百斩（天威落点）：一柄红焰枪刃绕落点格心旋满一周，刃尖拖出火焰扫弧，周身火痕依次亮起 + 灼地圈荡开
    | 'prism-beam'      // 折光·棱光千折：一条会拐弯的光束沿格子序列逐段推进，折点亮起棱形闪光
    | 'moran-inkway'    // 墨阑·入道：脚下运笔成一圈留缺口的墨环，提笔后一道墨痕沿攻击轴劈到目标格
    | 'duosui-reap'     // 夺岁·斩岁：暗赤横斩揭开 + 血偿刻印（带缺口赤环裂三道口）+ 三缕被抽走的血气
    | 'duosui-reckon'   // 夺岁·偿岁：目标格一记短斩 + 沿攻击轴拉回施法者的一条血色收束线，落点六瓣盾环合拢
    | 'aoyuan-dragon-call'  // 敖渊·唤龙盘云：龙影自云中探出，十字水气被龙身一拍扫开
    | 'aoyuan-dragon-sweep' // 敖渊·游龙扫击：一整尾龙沿本体外的八格圈顺时针爬过半圈，龙首到哪儿哪儿才炸
    | 'aoyuan-dragon-dash'  // 敖渊·乘龙破浪：龙身贴着冲刺轴拉成一条，穿人而过并在落点翻身
    | 'yunxiu-cloud-call'  // 云岫·布云垂雷：一团云砸下来摊成 3×3，云肚子里先闷闪一道电
    | 'yunxiu-rod-strike'  // 云岫·引雷落针：一光柱针钉进目标格，针身上沿爬满麻痹电花
    | 'yunxiu-cloud-bolt'  // 云岫·云中落雷：每回合云挪一格后劈下的那道雷，命中格各吃一发
    | 'ink-brush' | 'ink-dash' | 'ink-cut'
    | 'feixue-bond' | 'yang-link' | 'yin-link'
    | 'coin-strike' | 'coin-blessing' | 'coin-awaken'
    | 'scroll-jinwu' | 'scroll-xuangui'
    | 'chord-aura' | 'chord-break'
    | 'nightowl-eye' | 'nightowl-strike'
    | 'wind-line' | 'wind-pressure'
    | 'bone-slash' | 'decay-field' | 'decay-bloom'
    | 'starfire-lance' | 'rewind-state' | 'spirit-rune' | 'sand-field'
    // —— 恢复类专属原型（配色仍由档案 c1/c2 注入，语义上互相分辨）——
    | 'heal-single'     // 单体净化回春：光丝自四周向内收拢汇入目标格 + 竖直柔光柱 + 脚下缓正转生环
    | 'heal-wave'       // 群体恢复：以施法者为心荡出同心波，波扫到的每一格各自升起一根细光柱
    | 'regen-orb'       // 持续/延迟回血：回血珠绕体缓转，每"跳"一下闪一次并冒一颗上飘的绿点
    | 'revive-rise'     // 复活仪式：短暂压暗 → 光带自地面拉起 → 人形轮廓由虚到实 → 一圈金色涟漪
    | 'shield-ward'     // 护盾援护：六边形罩面自中心展开、边缘流光走一圈，纯防御观感不落在受击方向
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
    'duosui-reap': '斩岁·血偿',
    'duosui-reckon': '偿岁·收血成盾',
    'aoyuan-dragon-call': '唤龙盘云',
    'aoyuan-dragon-sweep': '游龙扫半圈',
    'aoyuan-dragon-dash': '乘龙破浪',
    'yunxiu-cloud-call': '布云垂雷',
    'yunxiu-rod-strike': '引雷落针',
    'yunxiu-cloud-bolt': '云中落雷',
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
    'huanongying-fan': '花扇横斩',
    'huanongying-swap': '身影换舞',
    'huanongying-replay': '月影重演',
    'zhiyuan-reel': '回风乱剪',
    'xihuan-level': '曦光环平',
    'ground-zone': '领域',
    'cage-bind': '束缚',
    'crystal-shatter': '晶碎',
    'ember-flare': '焰浪',
    'wenren-leap': '烬步火环',
    'wenren-reap': '裂焰燎原',
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
    'liehuo-wheel': '燎原旋斩',
    'prism-beam': '棱光千折',
    'moran-inkway': '一笔画墨',
    'ink-brush': '落笔飞白', 'ink-dash': '笔锋游龙', 'ink-cut': '断墨重锋',
    'feixue-bond': '霜枝相系', 'yang-link': '纯阳输元', 'yin-link': '玄阴汲流',
    'coin-strike': '金钱镇印', 'coin-blessing': '来财赐符', 'coin-awaken': '财神开印',
    'scroll-jinwu': '帛日金乌', 'scroll-xuangui': '帛画玄龟',
    'chord-aura': '五弦流转', 'chord-break': '裂帛断弦',
    'nightowl-eye': '死契瞳纹', 'nightowl-strike': '黑羽猎影',
    'wind-line': '顺逆羽流', 'wind-pressure': '风墙横扫',
    'bone-slash': '冥骨断刃', 'decay-field': '枯枝播撒', 'decay-bloom': '凋零绽灭',
    'starfire-lance': '星火贯日', 'rewind-state': '刻度倒行', 'spirit-rune': '玄符加持', 'sand-field': '沙脊猎场',
    'heal-single': '单体回春',
    'heal-wave': '群体恢复',
    'regen-orb': '凝珠回血',
    'revive-rise': '唤回仪式',
    'shield-ward': '护盾援护',
    'ink': '墨韵波纹',
    'jiangtaigong-cast': '垂钩点水',
    'moonlight-sweep': '环身月光',
    'lamp-lighting': '点灯照影',
    'jiangtaigong-throw': '甩竿抛人',
    'jiangtaigong-whalefall': '鲸落浪环',
};

/** 单个技能的特效档案 */
export type RecoveryFxTheme =
    | 'auspice' | 'auspice-rebirth' | 'lotus' | 'sonata' | 'chorus'
    | 'purify' | 'pearls' | 'pearl-return' | 'tide'
    | 'time-seam' | 'time-gate' | 'bone-soul' | 'lantern' | 'sun-thread';

export interface SkillFxProfile {
    /** Wangshu's moon eclipse, restoration and full-moon awakening. */
    moon?: 'drain' | 'heal' | 'full';
    /** 材质重绘：仅改变表现层，范围与结算仍沿用原型。 */
    crafted?: CraftedFxTheme;
    kind: SkillFxKind;
    durationMs: number;
    /** 主色（十六进制）；缺省时沿用 kind 自带样式（初代定制与 ink） */
    c1?: string;
    /** 辅色（十六进制） */
    c2?: string;
    /** 主动作抵达时刻；数字和受击反馈共用，纯视觉参数。 */
    impactMs?: number;
    /** 恢复角色的物象与动作，不改变伤害/治疗判定与范围。 */
    recovery?: RecoveryFxTheme;
    /** 冥魂材质与动作；仍沿用原技能的范围、命中和联机事件。 */
    spectral?: 'soul-gather' | 'wither-bloom' | 'wither-scatter';
    /** 被动触发的独立演出，复用真实事件队列，不铺技能范围底光。 */
    mechanism?: 'rebirth' | 'king-shift' | 'lord-shift' | 'conversion' | 'counter' | 'laststand' | 'extra-action' | 'zhaoshen' | 'ember-ascend';
    /** 区域底光的覆盖形状。缺省时由技能自身的 rangeType/areaSize/range/targetCount
     *  推导（见 skill-fx-coverage.ts）；引擎里带特判展开的技能需在此显式声明，
     *  'none' 表示不铺底光（全场技等只需命中格反馈） */
    fxArea?: number | 'line' | 'cross' | 'bar' | 'diamond' | 'self' | 'self-box' | 'none';
}

/** 有材质分层的恢复主题；保持旧事件原型的范围与命中语义。 */
export function hasLayeredRecoveryFx(profile: SkillFxProfile): boolean {
    return profile.kind === 'rewind-state' ||
        ['lotus', 'purify', 'pearls', 'pearl-return', 'tide', 'time-gate'].includes(profile.recovery ?? '');
}

/** 攻击方向的八向标签 */
export type SkillFxDirection = 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE';

/** 一次技能施放的瞬态特效事件（仅本地视觉层使用，不参与联机状态同步） */
export interface SkillFxEvent {
    id: number;
    profile: SkillFxProfile;
    owner: Player;
    skillId?: string;
    sourceHeroId?: string;
    /** 分段演出只延后表现，不延后战斗状态结算。 */
    startDelayMs?: number;
    dragonStartDeg?: number;
    dragonContactsOnly?: boolean;
    /** 与本事件对应的日志身份，避免飘字匹配到上一手同格特效。 */
    logIds?: string[];
    /** 真实受到伤害的格；与治疗格分别保留，不由原型猜测伤害。 */
    damagePositions?: Position[];
    /** 每一枚都来自一次真实的破镜之刃结算，不将镜片装饰当作额外攻击。 */
    mirrorBlades?: MirrorBladeStrike[];
    /** 财神等强化形态只影响视觉强度。 */
    empowered?: boolean;
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

export interface MirrorBladeStrike {
    fromPos: Position;
    targetPos: Position;
    logIds: string[];
}

/* ============================================================
   全技能档案：36 英雄 × 2 技能 + 金乌/玄龟附属技能
   每条档案 = 视觉原型 × 时长 × 技能专属配色
   ============================================================ */

/** 技能级档案（键为裸技能 ID） */
export const SKILL_FX_PROFILES: Record<string, SkillFxProfile> = {
    // ===== 初代定制（样式固化，配色保留原 CSS）=====
    wukong_skill1: { kind: 'wukong-clone', durationMs: 1300 },
    wukong_skill2: { kind: 'wukong-staff', durationMs: 980, impactMs: 250 },
    feixue_skill1: { kind: 'feixue-blade', durationMs: 980, c1: '#9fd8ff', c2: '#eaf7ff' },
    feixue_skill2: { kind: 'feixue-bond', durationMs: 1150, c1: '#397ca8', c2: '#e0f4ff', fxArea: 'none' },
    // 技能1击碎冰冻时的条件形态：由技能 execute 通过 skillFxExtras.fxVariant 覆盖档案
    feixue_shatter: { kind: 'feixue-shatter', durationMs: 1250, c1: '#bfe9ff', c2: '#ffffff' },
    soul_lamp_skill1: { kind: 'soul-lamp-array', crafted: 'soul-array', durationMs: 1450, c1: '#48675b', c2: '#b79b67' },
    soul_lamp_skill2: { kind: 'soul-lamp-cycle', crafted: 'soul-cycle', durationMs: 1350, impactMs: 360, c1: '#48675b', c2: '#d5c49b' },
    libai_skill1: { kind: 'libai-slash', durationMs: 800 },
    libai_skill2: { kind: 'libai-flurry', durationMs: 1150, c1: '#49c5c9', c2: '#eafffb' },
    feynman_skill1: { kind: 'feynman-beam', crafted: 'particle-beam', durationMs: 1000, c1: '#527e96', c2: '#e8d5aa', impactMs: 230 },
    feynman_skill2: { kind: 'feynman-burst', crafted: 'particle-burst', durationMs: 1150, c1: '#4d6579', c2: '#e8d5aa', impactMs: 180 },

    // ===== 墨阑：行墨问道（墨紫）=====
    moran_skill1: { kind: 'moran-inkway', durationMs: 1240, c1: '#2f2740', c2: '#e6be6a' },   // 入道：脚下运笔成墨环，一记墨痕劈向目标
    moran_skill2: { kind: 'ink-cut', durationMs: 920, impactMs: 240, c1: '#302b40', c2: '#d8b982' },

    // ===== 震霄：雷甲撼阵（雷金）=====
    zhenxiao_skill1: { kind: 'storm-bolt', durationMs: 1050, c1: '#ffd34d', c2: '#ff8c42', fxArea: 'bar' }, // 雷血开锋（面前横排3格 + 链式闪电跳跃）
    zhenxiao_skill2: { kind: 'cage-bind', durationMs: 1100, c1: '#f5d76e', c2: '#c8ccd8' }, // 金银错：金银锁笼

    // ===== 回锋：回刃听锋（赤红三连斩）=====
    huifeng_skill1: { kind: 'triple-slash', durationMs: 950, c1: '#ff4655', c2: '#ffc9b8' }, // 连刃斩：三段赤红斜斩
    huifeng_skill2: { kind: 'arc-slash', durationMs: 900, c1: '#bfe4ff', c2: '#6fa8d8' },   // 风过留痕：双目标落斩并标记

    // ===== 玄霄：玄光司命（玄紫）=====
    xuanxiao_skill1: { kind: 'spirit-rune', durationMs: 1000, c1: '#6f4fa6', c2: '#dfcaf7' },
    xuanxiao_skill2: { kind: 'blessing', crafted: 'rune-awaken', durationMs: 1150, c1: '#675671', c2: '#c0a976' }, // 惊鸿再舞：符墨落印，金线启行

    // ===== 琉璃：琉光守心（琉璃青 / 禅金）=====
    liuli_skill1: { kind: 'shield-ward', durationMs: 1000, c1: '#1f8f8c', c2: '#0f6b68' },    // 映月承锋：六边形罩面为友方挡下一击
    liuli_skill2: { kind: 'heal-wave', recovery: 'lotus', durationMs: 1350, c1: '#477f78', c2: '#ecd69a' }, // 禅悟：琉光莲瓣

    // ===== 白泽：瑞兽通明（瑞白 / 天禄金）=====
    baize_skill1: { kind: 'heal-single', recovery: 'auspice', durationMs: 1250, impactMs: 250, c1: '#397d70', c2: '#e8c57b' }, // 瑞云汇泽
    baize_skill2: { kind: 'revive-rise', recovery: 'auspice-rebirth', durationMs: 1600, impactMs: 360, c1: '#a67c32', c2: '#e6f0df' }, // 天禄金印托生

    // ===== 长离：长夜燃星（星火赤金）=====
    changli_skill1: { kind: 'ember-flare', durationMs: 1350, c1: '#ff7a5c', c2: '#ffb347' }, // 暗夜燎原（全场火海）
    changli_skill2: { kind: 'starfire-lance', durationMs: 1150, c1: '#b95022', c2: '#ffd36a' },

    // ===== 镜：镜界双生（镜银）=====
    mirror_skill1: { kind: 'crystal-shatter', durationMs: 950, c1: '#dfe9ff', c2: '#9db4e0' }, // 破镜分光
    mirror_skill2: { kind: 'shadow-dash', durationMs: 900, c1: '#cfe0ff', c2: '#8fa8d8' },      // 移形换影：本体镜像镜像冲刺拖尾
    // 镜被动「破镜之刃」触发时的飞刃合击（非技能，由战报标记驱动派发）
    mirror_blade: { kind: 'mirror-blades', durationMs: 950, c1: '#e8f0ff', c2: '#9db4e0' },

    // ===== 夜枭：暗影猎手（夜紫 / 血绯）=====
    nightowl_skill1: { kind: 'nightowl-eye', durationMs: 1000, c1: '#523363', c2: '#eb6a88' },
    nightowl_skill2: { kind: 'nightowl-strike', durationMs: 950, impactMs: 280, c1: '#30263e', c2: '#ec597e' },

    // ===== 莫问：时光剑客（时青）=====
    mowen_skill1: { kind: 'time-rewind', durationMs: 1050, c1: '#377c79', c2: '#c6eadb' }, // 攻击目标保留时溯，回补另在本体播放
    mowen_restore: { kind: 'heal-single', recovery: 'time-seam', durationMs: 1300, impactMs: 280, c1: '#377c79', c2: '#c6eadb', fxArea: 'none' },
    mowen_skill2: { kind: 'arc-slash', durationMs: 850, c1: '#9fe8d8', c2: '#4a8a7c' },      // 逆时斩

    // ===== 孤影：寒锋孤影（寒冷蓝）=====
    guying_skill1: { kind: 'shadow-dash', durationMs: 850, c1: '#a8d8ff', c2: '#e8f6ff' },   // 踏雪留影
    guying_skill2: { kind: 'guying-swordqi', crafted: 'cold-star', durationMs: 1000, c1: '#557f90', c2: '#eee8d2', impactMs: 160 }, // 寒星碎：锐刃骤闪，碎冰迸裂

    // ===== 寒江雪：凛冬守望（霜白）=====
    hanjiangxue_skill1: { kind: 'frost-spikes', durationMs: 1150, impactMs: 240, c1: '#bfe6ff', c2: '#e6f4ff', fxArea: 3 }, // 冰裂环在 240ms 开始，声音与受击反馈共用此时刻
    hanjiangxue_skill2: { kind: 'crystal-shatter', durationMs: 950, c1: '#9fd0f8', c2: '#ffffff' }, // 冰晶壁垒
    wangshu_skill1: { kind: 'hex-curse', moon: 'drain', durationMs: 1200, impactMs: 270, c1: '#4c687f', c2: '#e7ecd9', fxArea: 'none' },
    wangshu_skill2: { kind: 'heal-single', moon: 'heal', durationMs: 1350, impactMs: 270, c1: '#587e89', c2: '#f0ead5', fxArea: 'none' },
    wangshu_tianwei: { kind: 'aura-buff', moon: 'full', durationMs: 1450, impactMs: 0, c1: '#829bab', c2: '#f2edda', fxArea: 'none' },

    // ===== 骸骨君王：亡灵共鸣（骨白 / 冥火青）=====
    skeletonking_skill1: { kind: 'bone-slash', durationMs: 1050, impactMs: 240, c1: '#5c6353', c2: '#e5d9b9' },
    skeletonking_skill2: { kind: 'bone-slash', durationMs: 1050, impactMs: 240, c1: '#426854', c2: '#dfd6b9' },

    // ===== 杰茨米：亡灵城主（幽冥紫 / 王冠金）=====
    jetzmi_skill1: { kind: 'arc-slash', durationMs: 900, c1: '#9d7bff', c2: '#5a3fb0' },      // 终焉斩
    jetzmi_skill2: { kind: 'hex-curse', spectral: 'soul-gather', durationMs: 1550, c1: '#665481', c2: '#e5c789', fxArea: 'none' }, // 亡灵汲取

    // ===== 五弦琵琶：五弦清商（琵琶暖金）=====
    pipa_skill1: { kind: 'chord-aura', durationMs: 1100, c1: '#996129', c2: '#f5d79b', fxArea: 'none' },
    pipa_skill2: { kind: 'chord-break', durationMs: 1100, impactMs: 360, c1: '#ad642e', c2: '#ffe6aa' },

    // ===== 赏金猎人：黄金猎令（赏金 / 枪铅）=====
    bounty_skill1: { kind: 'hex-curse', durationMs: 950, c1: '#ffd75e', c2: '#c8783c' },      // 猎杀令
    bounty_skill2: { kind: 'pierce', durationMs: 850, c1: '#b8c4d8', c2: '#ffd75e' },         // 衔令追猎

    // ===== 阴阳师：两仪执契（阳金 / 阴紫）=====
    yinyang_skill1: { kind: 'yang-link', recovery: 'sun-thread', durationMs: 1300, impactMs: 300, c1: '#a37422', c2: '#ffedb2', fxArea: 'none' },
    yinyang_skill2: { kind: 'yin-link', durationMs: 1150, impactMs: 400, c1: '#57406f', c2: '#c9a9e2', fxArea: 'none' },

    // ===== 英雄X：无名震怒（神怒橙）=====
    hero_x_skill1: { kind: 'storm-bolt', durationMs: 1250, c1: '#ff9d5c', c2: '#ffe08a' },   // 天神震怒（全场雷暴）
    hero_x_skill2: { kind: 'phase-swap', durationMs: 900, c1: '#ffb87c', c2: '#8ad8ff' },     // 增势跃迁

    // ===== 吟游诗人：长歌抚阵（竖琴绿 / 合唱金）=====
    bard_skill1: { kind: 'chord-notes', recovery: 'sonata', durationMs: 1300, c1: '#518365', c2: '#e0c082', fxArea: 'none' }, // 竖琴和声
    bard_skill2: { kind: 'heal-wave', recovery: 'chorus', durationMs: 1450, c1: '#94703b', c2: '#bdddc4', fxArea: 'none' }, // 乐谱托起群体
    bard_regen: { kind: 'regen-orb', recovery: 'sonata', durationMs: 1150, c1: '#518365', c2: '#e0c082', fxArea: 'none' },
    pipa_heal: { kind: 'heal-single', recovery: 'chorus', durationMs: 1150, c1: '#996129', c2: '#f5d79b', fxArea: 'none' },

    // ===== 凋零之主：三命凋零（枯绿 / 腐紫）=====
    wither_lord_skill1: { kind: 'decay-field', spectral: 'wither-bloom', durationMs: 1550, impactMs: 300, c1: '#3a6558', c2: '#bfdec3', fxArea: 'none' },
    wither_lord_skill2: { kind: 'decay-bloom', spectral: 'wither-scatter', durationMs: 1550, impactMs: 360, c1: '#59456d', c2: '#c8e6d9', fxArea: 'none' },

    // ===== T型帛画：帛上神游（金乌 / 玄龟）=====
    t_painting_skill1: { kind: 'scroll-jinwu', durationMs: 1400, c1: '#9b6424', c2: '#ffd277', fxArea: 'none' },
    t_painting_skill2: { kind: 'scroll-xuangui', durationMs: 1400, c1: '#376856', c2: '#c1dac0', fxArea: 'none' },
    jinwu_skill: { kind: 'ember-flare', durationMs: 900, c1: '#ffd166', c2: '#ff9d3c' },        // 金乌耀斑
    xuangui_skill: { kind: 'radial-burst', durationMs: 850, c1: '#5a8a7a', c2: '#2f4a42' },      // 玄龟震击

    // ===== 旺财：通灵财神（财金）=====
    wangcai_skill1: { kind: 'coin-strike', durationMs: 1200, impactMs: 420, c1: '#ad751d', c2: '#ffe29a' },
    wangcai_skill2: { kind: 'coin-blessing', durationMs: 1100, c1: '#9b6c20', c2: '#ffe7a7', fxArea: 'none' },
    wangcai_awaken: { kind: 'coin-awaken', durationMs: 1700, c1: '#a56b17', c2: '#ffeab3', fxArea: 'none' },
    changli_rebirth: { kind: 'ink', mechanism: 'rebirth', durationMs: 1650, impactMs: 310, fxArea: 'none' },
    jetzmi_king_shift: { kind: 'ink', mechanism: 'king-shift', durationMs: 1450, impactMs: 480, fxArea: 'none' },
    jetzmi_lord_shift: { kind: 'ink', mechanism: 'lord-shift', durationMs: 1450, impactMs: 480, fxArea: 'none' },
    xuanxiao_conversion: { kind: 'ink', mechanism: 'conversion', durationMs: 1300, impactMs: 460, fxArea: 'none' },
    zhenxiao_counter: { kind: 'ink', mechanism: 'counter', durationMs: 1050, impactMs: 340, fxArea: 'none' },
    zhenxiao_laststand: { kind: 'ink', mechanism: 'laststand', durationMs: 1200, impactMs: 240, fxArea: 'none' },
    moran_extra_action: { kind: 'ink', mechanism: 'extra-action', durationMs: 1250, impactMs: 360, fxArea: 'none' },
    xuanyuan_zhaoshen: { kind: 'ink', mechanism: 'zhaoshen', durationMs: 1900, impactMs: 520, fxArea: 'none' },
    painting_attack: { kind: 'pierce', durationMs: 1100, c1: '#66533c', c2: '#e8c58a', fxArea: 'none' },
    feixue_followup: { kind: 'feixue-blade', durationMs: 980, c1: '#65a7ca', c2: '#eaf7ff' },
    dai_revive: { kind: 'revive-rise', recovery: 'time-gate', durationMs: 1650, impactMs: 420, c1: '#665394', c2: '#d7c9ff', fxArea: 'none' },
    baize_heal: { kind: 'heal-single', recovery: 'auspice', durationMs: 1250, impactMs: 250, c1: '#397d70', c2: '#e8c57b' },
    skeletonking_revive: { kind: 'revive-rise', recovery: 'bone-soul', durationMs: 1550, impactMs: 350, c1: '#426854', c2: '#dfd6b9', fxArea: 'none' },
    skeletonking_heal: { kind: 'heal-single', recovery: 'bone-soul', durationMs: 1250, c1: '#426854', c2: '#dfd6b9', fxArea: 'none' },
    soul_lamp_revive: { kind: 'revive-rise', recovery: 'lantern', durationMs: 1550, impactMs: 350, c1: '#526b79', c2: '#9ed6c8', fxArea: 'none' },
    xubai_entrance: { kind: 'heal-wave', recovery: 'purify', durationMs: 1350, c1: '#718e8b', c2: '#f7f5ed', fxArea: 'none' },

    // ===== 薛定谔：量子观测（量子青）=====
    schrodinger_skill1: { kind: 'magic-array', durationMs: 1050, c1: '#6ee7d8', c2: '#b0a0ff', fxArea: 3 }, // 生死叠加（点击格扩成3x3）
    schrodinger_skill2: { kind: 'cage-bind', durationMs: 1000, c1: '#8ff0e0', c2: '#6ea8ff' },    // 量子纠缠

    // ===== 莉莉丝：恐惧编织（梦魇紫红）=====
    lilith_skill1: { kind: 'pierce', crafted: 'dread-arrow', durationMs: 1100, c1: '#493544', c2: '#b4807b' }, // 恐惧之箭：骨箭与血痕
    lilith_skill2: { kind: 'hex-curse', crafted: 'dread-curse', durationMs: 1250, c1: '#302b37', c2: '#825061' }, // 恐惧蔓延：暗棘收拢

    // ===== 醉枕刀：醉卧沙场（酒琥珀）=====
    zuizhendao_skill1: { kind: 'zuizhen-throw', durationMs: 1000, c1: '#e8a860', c2: '#ffd9a0', fxArea: 'none' }, // 醉掷寒锋：掷刀+沿真实路径逐格跟踪的疾影光轨
    zuizhendao_skill2: { kind: 'zuizhen-wheel', durationMs: 1150, c1: '#d89050', c2: '#ffe0b0', fxArea: 'none' }, // 醉影换位：换位后太刀绕身旋斩一周

    // ===== 风铃：大漠孤影（流沙金）=====
    fengling_skill1: { kind: 'fengling-claw', durationMs: 900, c1: '#f5d9a0', c2: '#c89050' },  // 流沙追猎：爪牙撕裂
    fengling_skill2: { kind: 'sand-field', durationMs: 1200, c1: '#9b713b', c2: '#eed4a0' },
    // 天威「猎砂追击」的闪袭特效（非技能，由战报标记派发）
    fengling_pounce: { kind: 'fengling-pounce', durationMs: 1080, c1: '#ffe6b0', c2: '#a4682c' },

    // ===== 帝兰：御风羽君（顺逆风青）=====
    dilan_skill1: { kind: 'wind-line', durationMs: 1050, impactMs: 160, c1: '#347d72', c2: '#c2efe1' },
    dilan_skill2: { kind: 'wind-pressure', durationMs: 1100, impactMs: 280, c1: '#357ca0', c2: '#d4effa' },

    // ===== 南风：御风行者（天青）=====
    nanfeng_skill1: { kind: 'gale-vortex', crafted: 'wind-vortex', durationMs: 1200, c1: '#507278', c2: '#c3c7ad' }, // 扶摇：错层风纹与飞羽
    nanfeng_skill2: { kind: 'ground-zone', crafted: 'wind-corridor', durationMs: 1250, c1: '#506e75', c2: '#b8c1ad' }, // 引风成道：逐格顺风流线

    // ===== 云缨：瑞火缨枪（焰橙金）=====
    yunying_skill1: { kind: 'yunying-sweep', durationMs: 1350, c1: '#ffcf7a', c2: '#ff7a3c' },   // 星火照野：弧刃逐条甩开，收势枪杆抽打
    yunying_skill2: { kind: 'yunying-arc-slash', durationMs: 1400, c1: '#ffb347', c2: '#ff4d2e' },  // 踏火长驱：两道圆弧火斩来回扫过正前方一排3格
    // 烈火燎原：祥瑞满层引燃（非技能，由 store 挂起选择后显式派发，带射线覆盖格）
    yunying_liehuo: { kind: 'liehuo-blaze', durationMs: 1900, c1: '#ff7a3c', c2: '#ffe08a' },
    // 天威「燎原百斩」：击杀后沿直线斩到落点（非主动技能，由特效请求队列派发）。
    // 起手格画出枪冲刺的火色拖尾，落点那一格由 liehuo-wheel 旋满一周
    yunying_tianwei: { kind: 'liehuo-wheel', durationMs: 1400, c1: '#ff4a1e', c2: '#ffc85a' },

    // ===== 上官婉儿：墨笔惊鸿（墨色）=====
    shangguan_skill1: { kind: 'ink-brush', durationMs: 1150, c1: '#35303d', c2: '#c9b58f', fxArea: 'none' },
    shangguan_skill2: { kind: 'ink-dash', durationMs: 1050, impactMs: 280, c1: '#38303f', c2: '#c9b58f', fxArea: 'none' },

    // ===== 沉渊·镇岳：渊守（渊蓝）=====
    chenyuan_skill1: { kind: 'cage-bind', crafted: 'abyss-pull', durationMs: 1150, c1: '#263e50', c2: '#9bb8bf' }, // 渊引：寒索收拽与冰裂
    chenyuan_skill2: { kind: 'aura-buff', crafted: 'abyss-ward', durationMs: 1400, c1: '#3c5968', c2: '#c1d2ce' }, // 寒渊庇护：有厚度的护冰

    // ===== 戴尔：时之旅人（时空紫）=====
    dai_skill1: { kind: 'rewind-state', durationMs: 1200, c1: '#665394', c2: '#d7c9ff', fxArea: 'none' },
    dai_skill2: { kind: 'phase-swap', crafted: 'time-swap', durationMs: 1200, c1: '#627b8d', c2: '#c6b28d' }, // 时空置换：影像切片错位

    // ===== 游隼：裂风猎隼（风青）=====
    youjun_skill1: { kind: 'shadow-dash', durationMs: 900, c1: '#8fd8ff', c2: '#e0f6ff' },    // 疾掠
    youjun_skill2: { kind: 'wind-blade-volley', durationMs: 1000, c1: '#5cc8f0', c2: '#eafaff' },   // 四向风刃：四弯风刃射向周身四格

    // ===== 双飞燕：回旋镖几何（墨青）=====
    shuangfeiyan_skill1: { kind: 'pierce', durationMs: 900, c1: '#5f8f86', c2: '#e8f2e8' },   // 双飞剪：掷镖/三角
    shuangfeiyan_skill2: { kind: 'phase-swap', durationMs: 1000, c1: '#5f8f86', c2: '#e8f2e8' }, // 燕归巢：跃向镖位

    // ===== 轩辕神君：金行御剑（鎏金）=====
    xuanyuan_skill1: { kind: 'shadow-dash', durationMs: 900, c1: '#d4a843', c2: '#fff2c0' },   // 御剑·贯阵：沿跳击轨迹鎏金一闪
    xuanyuan_skill2: { kind: 'aura-buff', durationMs: 950, c1: '#d4a843', c2: '#fff6d8' },     // 御剑·归元：飞剑化盾归身

    // ===== 叙白：净化治疗与黑白凝珠（素白青 / 暖金）=====
    xubai_skill1: { kind: 'heal-single', recovery: 'purify', durationMs: 1300, impactMs: 260, c1: '#718e8b', c2: '#f7f5ed' }, // 素白拂秽
    xubai_skill2: { kind: 'xubai-pearls', recovery: 'pearls', durationMs: 1400, c1: '#4b4b5d', c2: '#f7f5ed' }, // 黑白珠凝聚
    // 黑白球的自动回血段（行动开始逐颗消耗）：既不是凝珠那一手，也不是海浪，
    // 用「凝珠回血」原型挂在旁边，等映射定稿后由结算侧按此 skillId 派发
    xubai_regen: { kind: 'regen-orb', recovery: 'pearl-return', durationMs: 1250, impactMs: 220, c1: '#4b4b5d', c2: '#f7f5ed' },

    // ===== 泠汐：潮汐多段攻击（潮青 / 月白）=====
    // 涟漪要压在浅色水墨盘面上才看得见，故主色取深潮青而非亮青
    lingxi_skill1: { kind: 'lingxi-wave', durationMs: 1200, c1: '#508c98', c2: '#d3e6df', fxArea: 'self-box' }, // 海螺回响：自身潮纹
    // 海螺回响的延迟补击段（下一回合自动结算那一下）：跳开的回血读法与凝珠同源，
    // 挂在 lingxi-wave 旁边，等映射定稿后由延迟段按此 skillId 派发
    lingxi_regen: { kind: 'regen-orb', recovery: 'tide', durationMs: 1250, impactMs: 240, c1: '#2b83ad', c2: '#b9e8eb', fxArea: 'none' },
    lingxi_skill2: { kind: 'lingxi-fan', durationMs: 1050, c1: '#528f9a', c2: '#e8efdf' }, // 涌潮拍岸：纸扇推潮

    // ===== 惊鸿·止水：掠水绕后与止水决渊（月白青 / 静水蓝）=====
    jinghong_skill1: { kind: 'shadow-dash', durationMs: 900, c1: '#8fb8d8', c2: '#e8f6ff' },   // 掠水惊鸿：残影跨格疾闪，落点补一记斩
    // 决渊：一柄水蓝旋刃以她为心顺时针扫满一圈（渲染在施法者格，半径约 2.1 格），
    // 转满再炸开一圈外飞水沫。fxArea 挂 'none' 关掉整块区域特效；
    // 圆环越界的部分由 clip-path 按她到盘边的距离裁掉。
    jinghong_skill2: { kind: 'jinghong-slash-ring', durationMs: 1080, impactMs: 440, c1: '#197d9f', c2: '#c9f6ff', fxArea: 'none' },
    // 蓄力段的条件形态（execute 经 skillFxExtras.fxVariant 覆盖默认档案）：静水自养的光环
    jinghong_still: { kind: 'aura-buff', durationMs: 900, c1: '#4fa8cc', c2: '#dff4ff', fxArea: 'none' },

    // ===== 镜花·水月：换身映月（镜银蓝 / 月华白）=====
    jinghua_skill1: { kind: 'shield-ward', durationMs: 1000, c1: '#a8d4f0', c2: '#eaf6ff' },    // 水月换身：换上来那名队友正好落进水月格吃到 5 点护盾，主效是那面罩在人身上的罩面
    jinghua_skill2: { kind: 'light-summon', crafted: 'moon-double', durationMs: 1400, c1: '#526c82', c2: '#e2dcc4', fxArea: 'none' }, // 印月替身：镜水倒影与银月凝身
    // 天威「镜花照水」登场照击（非主动技能，由特效请求队列派发）：
    // 一弯月牙刃自镜花格飞向被照中的敌人，落点绽出月华斩痕。
    // 主色取深镜蓝而非淡银蓝——淡色压在浅色水墨盘面上几乎看不见。
    jinghua_tianwei: { kind: 'jinghua-moonblade', durationMs: 900, c1: '#3f7fae', c2: '#dff2ff' },
    // 天威击杀后的「月影回声」：被点名友方脚下亮起月华光柱
    jinghua_tianwei_echo: { kind: 'light-summon', durationMs: 950, c1: '#bfe0ff', c2: '#f6fbff' },

    // ===== 折光：棱光冷白（冷蓝 / 暖白芯）=====
    // 先挂通用原型：技能一是打出去的光弹，技能二是沿折线逐格斩过的光束，
    // 天威是落点升起的光界。专属"折射光路"特效后续单独打磨。
    zhiguang_skill1: { kind: 'pierce', durationMs: 900, c1: '#9fd8ff', c2: '#f4fbff' },        // 凝光为棱
    zhiguang_skill2: { kind: 'prism-beam', durationMs: 1800, c1: '#9fd8ff', c2: '#fff2cf' },        // 棱光千折：整条折线由区域层画出来，时长要罩得住最长光路
    zhiguang_tianwei: { kind: 'light-summon', durationMs: 1250, c1: '#cfe8ff', c2: '#fff2cf' }, // 万华镜

    // ===== 花弄影：折扇花刃、身影互换、影子重演（月白粉 / 影紫）=====
    // 花间辞：折扇开合后，一整面花刃横扫左前/正前/右前三格；不再像三次单点攻击。
    huanongying_skill1: { kind: 'huanongying-fan', durationMs: 1160, impactMs: 340, c1: '#b64f83', c2: '#ffe7f2' },
    // 弄影：旧位花影收拢、花瓣沿换位轴掠过，新位绽开并补一周环斩；两端不铺巨型矩形底光。
    huanongying_skill2: { kind: 'huanongying-swap', durationMs: 1280, impactMs: 560, c1: '#75438d', c2: '#f4ddff', fxArea: 'none' },
    // 影子重演（被动/天威共用，由特效请求队列派发）：沿用同套花刃语言，但材质更轻、更透明。
    huanongying_replay: { kind: 'huanongying-replay', durationMs: 980, impactMs: 250, c1: '#5d3975', c2: '#ead5f2', fxArea: 'none' },

    // ===== 纸鸢：收线、断线连击、牵丝追击、引线天威（朱线 / 纸白）=====
    // 收线·回风：线轴从敌人身侧飞回她手上——起手格是被收线的敌人，落点是纸鸢自己脚下。
    zhiyuan_skill1: { kind: 'pierce', durationMs: 1080, impactMs: 300, c1: '#c8543f', c2: '#f3e3c0' },
    // 断线·冲天：线轴一次烧光，五道斜斩左右来回乱劈在目标身上（凌乱而非整齐三连）。
    zhiyuan_skill2: { kind: 'zhiyuan-reel', durationMs: 1240, impactMs: 300, c1: '#b8402f', c2: '#ffe9c9' },

    // ===== 羲和：均光抹平一片友方、盈照把抽走的血量照回去（暖金 / 曦白）=====
    // 均光：一圈曦光从她自己身上荡开，扫过的每名友方各起一层柔光。
    xihuan_skill1: { kind: 'xihuan-level', durationMs: 1180, impactMs: 320, c1: '#d99a2b', c2: '#fff4d8' },
    // 盈照：全场锁定一名友方，光柱自天而降落在受益格，溢出那口凝成护罩。
    xihuan_skill2: { kind: 'heal-single', durationMs: 1080, impactMs: 300, c1: '#e0b04a', c2: '#fff8e6' },
    // 回晖（被动，回合末）：最低血那人口上升起一颗暖光，节奏比主动技更轻。
    xihuan_passive: { kind: 'blessing', durationMs: 860, impactMs: 240, c1: '#d9a13c', c2: '#fff4d8', fxArea: 'none' },
    // 牵丝（被动追击）：她顺线掠出一击，材质比主动技更轻，避免满屏都是大弧刃。
    zhiyuan_pursue: { kind: 'arc-slash', durationMs: 720, impactMs: 210, c1: '#7fa36a', c2: '#f3e3c0', fxArea: 'none' },
    // 纸鸢引线（天威）：把线交到下一个出手的队友手上，落在她自己脚下。
    zhiyuan_tianwei: { kind: 'aura-buff', durationMs: 980, c1: '#c8543f', c2: '#f7ecd6', fxArea: 'none' },

    // ===== 夺岁：收年刀（血月红 / 彼岸红 / 鎏金），配色跟立绘走 =====
    duosui_skill1: { kind: 'duosui-reap', durationMs: 1180, impactMs: 250, c1: '#96161f', c2: '#e8c98a', fxArea: 'none' },
    duosui_skill2: { kind: 'duosui-reckon', durationMs: 1240, impactMs: 230, c1: '#a51b22', c2: '#d9b45a', fxArea: 'none' },
    duosui_tianwei: { kind: 'aura-buff', durationMs: 1050, c1: '#96161f', c2: '#e8c98a', fxArea: 'none' },

    // ===== 血契：血誓横扫与强锁（赤血 / 骨白）作用区均以施法者为中心 =====
    xueqi_skill1: { kind: 'xueqi-scythe', durationMs: 900, c1: '#c0392f', c2: '#ffd0c6', fxArea: 'self-box' }, // 血誓横扫：血镰绕身旋一圈（天威复用此档案）
    xueqi_skill2: { kind: 'cage-bind', durationMs: 1000, c1: '#8e2f2a', c2: '#e8a49b', fxArea: 'self-box' },   // 血契锁：笼环收拢圈定周身

    // ===== 姜太公：垂钩、抛掷、鲸落（水青 / 月白）=====
    // 下钩：单格动作，线从上方垂进水面，不给整片底光。
    // 岱宗：一守一砸，姿态不铺区域底光（护的是半个棋盘，画出来会糊满屏）
    daizong_skill1: { kind: 'aura-buff', durationMs: 1080, impactMs: 260, c1: '#5b5f7a', c2: '#e7e9f2', fxArea: 'none' },
    daizong_skill2: { kind: 'radial-burst', durationMs: 1240, impactMs: 340, c1: '#4a4e66', c2: '#dfe2ee', fxArea: 3 },
    // 敖渊：一整尾会游的龙。唤龙时在召唤格探身，盘旋时沿本体外的八格圈顺时针爬半圈，
    // 冲刺时把龙身沿轴线拉直穿人——三样画的都是同一条脊线，配色也共用一套青碧。
    // 唤龙：320ms 探身 + 8×100ms 沿外圈爬满一圈 + 收势，时长要盖住最后一格的爆点
    aoyuan_skill1: { kind: 'aoyuan-dragon-call', durationMs: 1560, impactMs: 300, c1: '#6483a3', c2: '#eaf2f4', fxArea: 'none' },
    aoyuan_skill2: { kind: 'aoyuan-dragon-dash', durationMs: 1550, impactMs: 300, c1: '#537594', c2: '#f1f5f3', fxArea: 'none' },
    aoyuan_orbit: { kind: 'aoyuan-dragon-sweep', durationMs: 1350, impactMs: 140, c1: '#6f91af', c2: '#f0f4ef', fxArea: 'none' },
    // 云岫：云是常驻场地（画在 Board 上），特效只演"砸下来、挪一格、劈下去"这三个动作
    yunxiu_skill1: { kind: 'yunxiu-cloud-call', durationMs: 1160, impactMs: 420, c1: '#edb93f', c2: '#fff2b8', fxArea: 'none' },
    yunxiu_skill2: { kind: 'yunxiu-rod-strike', durationMs: 1040, impactMs: 220, c1: '#2c6f86', c2: '#e2f4f8', fxArea: 'none' },
    yunxiu_cloud: { kind: 'yunxiu-cloud-bolt', durationMs: 1040, impactMs: 320, c1: '#edb93f', c2: '#fff2b8', fxArea: 'none' },
    // 霆渊：雷不认人，落点由随机决定；技能二用 chainLinks 把带链者串成一串跳雷
    tingyuan_skill1: { kind: 'storm-bolt', durationMs: 1150, impactMs: 320, c1: '#6f5bd0', c2: '#efe9ff', fxArea: 'none' },
    tingyuan_skill2: { kind: 'storm-bolt', durationMs: 1450, impactMs: 260, c1: '#4f3bb0', c2: '#d9ceff', fxArea: 'none' },
    jiangtaigong_skill1: { kind: 'jiangtaigong-cast', durationMs: 980, impactMs: 340, c1: '#3f9c93', c2: '#eaf7f2', fxArea: 'none' },
    // 夕月辞：一圈月光是实打实的八格命中，底光要铺开才读得出范围；灯那一记是"放下东西"，不震屏。
    xiyueci_skill1: { kind: 'moonlight-sweep', durationMs: 1020, impactMs: 320, c1: '#5b4a9e', c2: '#efe6ff' },
    xiyueci_skill2: { kind: 'lamp-lighting', durationMs: 1120, impactMs: 360, c1: '#c4761a', c2: '#ffe6bd', fxArea: 'none' },
    // 身后留灯（奥义）：同一门灯的语言，光色换月青，表示这一盏是留下来照人的。
    xiyueci_tianwei: { kind: 'lamp-lighting', durationMs: 1180, impactMs: 380, c1: '#2f6f8f', c2: '#dff0f7', fxArea: 'none' },
    // 渭水垂竿：把人沿射线拖回自己身边，落点脚下漫开一片水泽。
    jiangtaigong_skill2: { kind: 'pierce', durationMs: 1040, impactMs: 300, c1: '#2f7f86', c2: '#dff2f0' },
    // 上钩那一下：同一套垂钩语言，涟漪更重，表示"钩子咬住了"。
    jiangtaigong_hook: { kind: 'jiangtaigong-cast', durationMs: 1060, impactMs: 380, c1: '#3f9c93', c2: '#eaf7f2', fxArea: 'none' },
    // 抛掷：绷紧的钓线扫过攻击轴，落点炸开水花与八散水珠。
    jiangtaigong_throw: { kind: 'jiangtaigong-throw', durationMs: 1120, impactMs: 430, c1: '#2f7f86', c2: '#eaf7f2', fxArea: 'none' },
    // 鲸落：一头鲸从上方压进水里，3×3 作用面要留底光才读得出范围。
    jiangtaigong_whalefall: { kind: 'jiangtaigong-whalefall', durationMs: 1260, impactMs: 470, c1: '#2b6f7c', c2: '#e7f8f4' },
    // 太公逐泽（天威）：全场水泽一起向外扩一圈，贴地波纹最合适。
    jiangtaigong_tianwei: { kind: 'ground-zone', durationMs: 1180, impactMs: 320, c1: '#3f9c93', c2: '#eaf7f2' },

    // ===== 闻人翊悬：蹈火飞跃与破妄燎原（焰橙 / 鎏金）=====
    // 跃阵：起跳炸开炭烬，飞跃轴拖一串断续烬迹，落点是一圈带断口的手绘火环。
    wenren_skill1: { kind: 'wenren-leap', crafted: 'wenren-leap', durationMs: 1080, impactMs: 260, c1: '#b23a20', c2: '#ffd98a' },
    // 燎原：施法者脚下先向内收余烬，再以自身为心炸开一圈不等长的火舌与焦痕。
    wenren_skill2: { kind: 'wenren-reap', crafted: 'wenren-reap', durationMs: 1180, impactMs: 260, c1: '#a52e1a', c2: '#ffce6e', fxArea: 'self-box' },
    // 昭神降临：破妄火纹从脚下盘上全身，金白焰包裹后炸开一圈带断口的火环。
    wenren_zhaoshen: { kind: 'aura-buff', durationMs: 1600, impactMs: 240, c1: '#e07920', c2: '#fff3c4', fxArea: 'none', mechanism: 'ember-ascend' },
    // 昭神态的两种条件形态：同一套手绘火语言，金白高光更亮、环外再收一道闭环细环。
    wenren_skill1_zhaoshen: { kind: 'wenren-leap', crafted: 'wenren-leap-zhaoshen', durationMs: 1160, impactMs: 280, c1: '#d4551f', c2: '#fff0b0', fxArea: 'none' },
    wenren_skill2_zhaoshen: { kind: 'wenren-reap', crafted: 'wenren-reap-zhaoshen', durationMs: 1280, impactMs: 280, c1: '#c94819', c2: '#fff2b8', fxArea: 'self-box' },
};

/** 英雄级兜底档案（该英雄的技能未逐一定制时，取其技能一档案） */
const HERO_FX_FALLBACKS: Record<string, SkillFxProfile> = {
    wukong: { kind: 'wukong-staff', durationMs: 980, impactMs: 250 },
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
    'huanongying-fan',
    'huanongying-swap',
    'huanongying-replay',
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
    // 入道那一记墨痕是这一击的全部重量，落点必须震一下
    'moran-inkway',
    'zuizhen-throw',
    'zuizhen-wheel',
    // 天威落点那一记旋斩是这一击的特写，要有震屏与闪白
    'liehuo-wheel',
    // 棱光千折：光路经过的每一格都要"被打到"的手感，震屏与闪白交给命中格
    'prism-beam',
    // 游龙扫到/冲到的每一格都是实打实的一击，主角虽然是龙，受击反馈照常给
    'aoyuan-dragon-call',
    'aoyuan-dragon-sweep',
    'aoyuan-dragon-dash',
    // 云岫三式都是实打实的落雷/落针，命中格要有震屏与闪白
    'yunxiu-cloud-call',
    'yunxiu-rod-strike',
    'yunxiu-cloud-bolt',
    'yunying-sweep',
    'yunying-arc-slash',
    'ink-brush', 'ink-dash', 'ink-cut', 'coin-strike', 'chord-break',
    'nightowl-strike', 'wind-line', 'wind-pressure', 'bone-slash',
    'decay-field', 'decay-bloom', 'starfire-lance', 'yin-link',
    // 辞光·散影：一圈里每一格都是实打实的一刀，命中格照常给震屏与闪白
    'moonlight-sweep',
]);

export function isImpactFxKind(kind: SkillFxKind): boolean {
    return SKILL_FX_IMPACT_KINDS.has(kind);
}

/** 真实施法按结果决定受击；演示/旧事件才回退到原型判断。 */
export function isDamageFxAt(event: SkillFxEvent, cell: Position): boolean {
    if (event.damagePositions) return event.damagePositions.some(([r, c]) => r === cell[0] && c === cell[1]);
    return isImpactFxKind(event.profile.kind) &&
        !(event.softImpactPositions ?? []).some(([r, c]) => r === cell[0] && c === cell[1]);
}

/**
 * 逐格出"本体主效"的原型：这些图形本身就是一次命中的特写（斩击/突刺/落雷/晶碎…），
 * 多个目标各来一份最有打击感。法阵/领域/增益类刻意不在其列——否则 3x3 法阵会在
 * 9 个格子里各立一根光柱糊成一片，它们在次要格子上只出轻量印记。
 */
const SKILL_FX_PER_TARGET_KINDS: ReadonlySet<SkillFxKind> = new Set<SkillFxKind>([
    'ink-cut', 'coin-strike', 'coin-blessing', 'chord-aura', 'chord-break',
    'nightowl-strike', 'bone-slash', 'decay-bloom', 'starfire-lance',
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
    // 群体恢复：波扫到哪一格，那一格才立起自己的那根光柱（与 lingxi-wave
    // "每命中格各起一道浪"同一套派发机制；格间延迟按离施法者的距离排，见 SkillFxVisual）
    'heal-wave',
    // 天威照中几名敌人，就飞来几弯月牙刃：飞斩本身就是这一击的特写
    'jinghua-moonblade',
    'zuizhen-throw',
    // 踏火长驱：打到的每格各起一团"被刀锋扫过"的火气（刀光本身由区域层那道 120° 圆弧两扫，
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
/** 棱光千折的光走一格要用的毫秒数：区域层的分段延迟与命中格爆点都按它对齐，
 *  这样"光走到哪一格，那一格的爆点才炸"，玩家能顺着光路核对几何 */
export const PRISM_BEAM_STEP_MS = 70;
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

export function computeFxTravelMs(event: Pick<SkillFxEvent, 'fromPos' | 'targetPos'>): number {
    const distance = Math.hypot(event.targetPos[0] - event.fromPos[0], event.targetPos[1] - event.fromPos[1]);
    return Math.round(Math.min(440, Math.max(180, distance * 85)));
}

/** 镜刃先在身侧凝聚，随后错峰追踪；伤害飘字和碎镜都使用同一时钟。 */
export function computeMirrorBladeTiming(blade: Pick<MirrorBladeStrike, 'fromPos' | 'targetPos'>, index: number) {
    const launchMs = 140 + index * 90;
    // 飞行速度翻倍＝整段行程时间减半（含 140ms 的最低时长一起折），
    // 飘字与碎镜读的是 impactMs，所以会跟着一起提前落地
    const travelMs = Math.round((computeFxTravelMs(blade) * 1.4 + 140) / 2);
    return { launchMs, travelMs, impactMs: launchMs + travelMs };
}

export function computeFxLogImpactDelayMs(event: SkillFxEvent, cell: Position, logId: string): number {
    const index = event.mirrorBlades?.findIndex(blade => blade.logIds.includes(logId)) ?? -1;
    return index >= 0
        ? computeMirrorBladeTiming(event.mirrorBlades![index], index).impactMs
        : computeFxImpactDelayMs(event, cell);
}

/** 所有表现层使用同一抵达时间，实际战斗状态不等待动画。 */
export function computeFxImpactDelayMs(event: SkillFxEvent, cell: Position): number {
    const kind = event.profile.kind;
    if (kind === 'lingxi-fan') return lingxiTideHitMs(event, cell);
    if (kind === 'mirror-blades') {
        const index = event.mirrorBlades?.findIndex(blade => blade.targetPos[0] === cell[0] && blade.targetPos[1] === cell[1]) ?? -1;
        return computeMirrorBladeTiming(index >= 0 ? event.mirrorBlades![index] : event, Math.max(0, index)).impactMs;
    }
    const order = (event.coveredPositions ?? []).findIndex(([r, c]) => r === cell[0] && c === cell[1]);
    const stagger = computeFxCellDelayMs(event.targetPos, cell);
    // 一团雷云是同时出手，整片闪电与伤害数字共用同一拍。
    if (kind === 'yunxiu-cloud-call' || kind === 'yunxiu-cloud-bolt') return event.profile.impactMs ?? 320;
    if (kind === 'pierce' || kind === 'ink-brush' || kind === 'starfire-lance') return 90 + computeFxTravelMs(event) + stagger;
    if (kind === 'prism-beam' && order >= 0) return (order + 1) * PRISM_BEAM_STEP_MS;
    if (kind === 'zuizhen-throw') {
        const step = order >= 0 ? (order === (event.coveredPositions?.length ?? 0) - 1 ? order + 2 : order + 1) : cellSteps(event.fromPos, cell);
        return 120 + step * 130;
    }
    if (kind === 'liehuo-blaze') return Math.max(0, order) * 150;
    if (kind === 'yunying-arc-slash') return Math.max(0, order) * 150;
    // 游龙：龙首爬到第几格，第几格才炸。外圈那 5 格是"一路扫过去"，
    // 按离主目标的切比雪夫距离排会同时炸两三格，龙就成了背景而不是施暴者。
    if (kind === 'aoyuan-dragon-sweep' && order >= 0) return dragonSweepCellHitMs(event, cell);
    if (kind === 'aoyuan-dragon-dash') {
        return dragonDashHitMs(order >= 0 ? order : cellSteps(event.fromPos, cell));
    }
    // 唤龙是"龙先从云里探起来，再一翻身把十字气浪扫开"，起手比扫击慢半拍
    if (kind === 'aoyuan-dragon-call' && order >= 0) return dragonCallHitMs(order);
    if (kind === 'moran-inkway') return 660 + stagger;
    if (kind === 'jinghua-moonblade') return 460 + stagger;
    if (kind === 'heal-wave') return 180 + computeFxCellDelayMs(event.fromPos, cell);
    return (event.profile.impactMs ?? 120) + stagger;
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
): { impactPositions?: Position[]; softImpactPositions?: Position[]; damagePositions?: Position[] } {
    const cells: Position[] = [];
    const healedKeys = new Set<string>();
    const damageKeys = new Set<string>();
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
        if (entry.type === 'damage' && Number(entry.details?.amount) > 0) damageKeys.add(key);
    }

    if (cells.length === 0) return {};

    cells.sort((a, b) => cellSteps(primary, a) - cellSteps(primary, b));
    const kept = cells.slice(0, MAX_FX_IMPACT_CELLS);
    return {
        impactPositions: kept,
        softImpactPositions: kept.filter(
            ([row, col]) => healedKeys.has(`${row}:${col}`)
        ),
        damagePositions: kept.filter(([row, col]) => damageKeys.has(`${row}:${col}`)),
    };
}

/** A triggered segment owns all of its logs, even though only its first log stores the anchor. */
export function primarySkillFxLogs(logs: BattleLogEntry[], sourceHeroId?: string): BattleLogEntry[] {
    const triggered = new Set<string>();
    for (const log of logs) {
        const request = log.details?.skillFxRequest as { logIds?: unknown } | undefined;
        if (Array.isArray(request?.logIds)) for (const id of request.logIds) if (typeof id === 'string') triggered.add(id);
    }
    return logs.filter(log => !triggered.has(log.id) && !log.details?.skillFxRequest &&
        (!log.details?.sourceHeroId || log.details.sourceHeroId === sourceHeroId));
}

/** 把真实抵达时间纳入存活余量，远处命中与路径末端都能完整淡出。 */
export function computeFxTailMs(event: SkillFxEvent): number {
    if (event.mirrorBlades?.length) {
        const lastHit = Math.max(...event.mirrorBlades.map((blade, index) => computeMirrorBladeTiming(blade, index).impactMs));
        return Math.max(0, lastHit + 520 - event.profile.durationMs);
    }
    const cells = [...(event.impactPositions ?? []), ...(event.coveredPositions ?? [])];
    if (cells.length === 0) return Math.max(0, computeFxImpactDelayMs(event, event.targetPos) - 120);
    const maxDelay = cells.reduce(
        (max, cell) => Math.max(max, computeFxImpactDelayMs(event, cell)),
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
    | 'petalfan'     // 花扇横斩：一整面带花瓣的扇刃扫过三格
    | 'icespikes'    // 冰刺天降：冰锥成片自空砸落覆盖整个区域
    | 'iceshatter'   // 破冰爆震：冰面轰然炸裂，冰棱自中心向外环射 + 霜原闪光
    | 'firewall'     // 燎原火墙：火线自施法者一端沿射线烧到尽头 + 灼地焦痕 + 热浪扭曲
    | 'bladesweep'   // 圆弧来回扫：一道 120° 红色圆弧挥斩绕云缨脚下圆心横扫命中面，去程回程各一次
    | 'lightpath'    // 棱光光路：沿真实光路格子序列逐段点亮的折线光束，折点闪棱（折光「棱光千折」）
    | 'swordzone';   // 青莲剑阵：范围边框先钉住命中矩形，再放多道对角剑光穿阵连斩（谪仙醉斩）

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
    'chord-aura': 'runearray', 'chord-break': 'slashwave',
    'wind-line': 'groundwave', 'wind-pressure': 'groundwave',
    'bone-slash': 'slashwave', 'decay-field': 'groundwave', 'sand-field': 'groundwave',
    'ember-flare': 'firestorm',
    'liehuo-blaze': 'firewall',
    // 棱光千折的光路是一条会拐弯的折线，必须由区域层按真实格子序列画，逐格底光只会糊成一片
    'prism-beam': 'lightpath',
    // 踏火长驱的命中面是一整排格子，刀光必须由一张绕云缨足下的 120° 圆弧来回扫，不能逐格各刻一道
    'yunying-arc-slash': 'bladesweep',
    'storm-bolt': 'thunderstorm',
    'cage-bind': 'cage',
    // 谪仙醉斩：剑阵边框把 2×3 命中区先亮给玩家，剑光再穿阵（类王者李白大招的"先看见范围"）
    'libai-flurry': 'swordzone',
    'magic-array': 'runearray',
    // 入道的十字范围用符阵底光铺，和脚下那一圈墨环同一套语汇
    'moran-inkway': 'runearray',
    'light-summon': 'runearray',
    'wukong-clone': 'runearray',
    'ground-zone': 'groundwave',
    'frost-spikes': 'icespikes',
    'feixue-shatter': 'iceshatter',
    'lingxi-wave': 'rippletide',
    'triple-slash': 'slashwave',
    'arc-slash': 'slashwave',
    'huanongying-fan': 'petalfan',
    // 治疗祝福/增益类法阵化，避免区域级爆炸感盖过辅助语义
    'blessing': 'runearray',
    'aura-buff': 'runearray',
    'chord-notes': 'runearray',
    // 群体恢复与护盾援护同为"罩住一片"的辅助语义：区域层继续走守护法阵，
    // 同心波与逐格光柱由各自的逐格原型画，两层不重复表达同一件事
    'heal-wave': 'runearray',
    'shield-ward': 'runearray',
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
