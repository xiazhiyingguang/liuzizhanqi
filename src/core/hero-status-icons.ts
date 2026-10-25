/**
 * 状态图标解析：把「效果名 / 计数器标签」映射到一个几何字形 id，供信息卡与图鉴统一取用。
 *
 * 分类不重新发明：先查 hero-status-fx 那份 kind 优先级表（棋子上的常驻动画层用的就是它），
 * 查不到再走本模块的名字表与前缀规则，最后按 effect.type 兜底——保证任何一条状态都画得出字形，
 * 不会出现某个英雄的新状态在卡片上开天窗。
 */
import type { EffectType } from '../types/game';
import { statusFxKindByCounter, statusFxKindByEffectName, type HeroStatusFxKind } from './hero-status-fx';

export type StatusGlyphId =
    | 'ice' | 'frost' | 'stun' | 'lock' | 'veil' | 'sight' | 'eye' | 'bolt'
    | 'fear' | 'wither' | 'flame' | 'drop' | 'wind' | 'shield' | 'blade' | 'notch'
    | 'chime' | 'fang' | 'atom' | 'coin' | 'cup' | 'moon' | 'sun' | 'taiji'
    | 'brush' | 'tide' | 'kite' | 'prism' | 'seal' | 'surge' | 'decline' | 'spark'
    | 'bloom' | 'bone' | 'hourglass' | 'claw' | 'mirror' | 'flower' | 'mark';

/**
 * 棋盘外观 → 字形。类型是 Record<HeroStatusFxKind, …>，所以往优先级表里加新状态时，
 * 少配一个字形会直接在编译期报错，而不是等到玩家悬停才看见一个空圈。
 */
const KIND_GLYPH: Record<HeroStatusFxKind, StatusGlyphId> = {
    frozen: 'ice',
    chill: 'frost',
    stun: 'stun',
    paralysis: 'lock',
    stealth: 'veil',
    bounty: 'sight',
    'bounty-tianwei': 'seal',
    'bounty-revive': 'bloom',
    'bounty-crit': 'spark',
    'bounty-vampire': 'fang',
    deathmark: 'eye',
    bulwark: 'shield',
    pressure: 'seal',
    dragon: 'claw',
    scales: 'shield',
    tingxi: 'bolt',
    thundermark: 'bolt',
    chainmark: 'bolt',
    fear: 'fear',
    wither: 'wither',
    burn: 'flame',
    bleed: 'drop',
    headwind: 'wind',
    tailwind: 'wind',
    feather: 'wind',
    inlay: 'mirror',
    longshi: 'bloom',
    duanxue: 'blade',
    zhaoshen: 'seal',
    guard: 'shield',
    'ice-armor': 'ice',
    harmony: 'chime',
    note: 'chime',
    vampire: 'fang',
    edge: 'blade',
    combo: 'notch',
    particle: 'atom',
    'observe-hit': 'atom',
    'observe-miss': 'atom',
    entangle: 'atom',
    rage: 'lock',
    fortune: 'coin',
    'mirror-blade': 'mirror',
    momentum: 'surge',
    drunk: 'cup',
    jingying: 'mirror',
    imprint: 'moon',
    'xubai-orbs': 'taiji',
};

/**
 * 只在信息卡里出现、不占棋盘特效层的状态名
 */
const NAME_GLYPH: Record<string, StatusGlyphId> = {
    白泽之力: 'bloom', 飞刀: 'blade', 终曲回响: 'chime', 水泽: 'tide', 鲸落: 'tide',
    鱼钩: 'kite', 愤怒: 'lock',
    风道: 'wind', 太公垂钩: 'kite', 太公逐泽: 'tide', 渭水垂竿: 'tide', 钓雪: 'kite',
    为道: 'seal', 入道: 'seal', 守心: 'shield', 禅定: 'seal', 天威: 'seal',
    岳压: 'decline', 岳势: 'seal', 厚重: 'shield', 传灯增防: 'spark', 不动如山: 'shield',
    血锋: 'blade', 寒星: 'frost', 雪誓: 'ice', 霜噬: 'frost', 初雪: 'frost',
    脆伤: 'frost', 破冰: 'ice', 绝对零度: 'ice', 极寒领域: 'ice', 寒渊庇护: 'ice',
    灵犀: 'spark', 锐眼: 'spark', 猎砂: 'claw', 猎砂锁定: 'claw', 沙丘: 'claw',
    流沙追猎: 'claw', 沙丘猎场: 'claw', 时间裂隙: 'hourglass', 时空回溯: 'hourglass',
    时空置换: 'hourglass', 时空停滞: 'hourglass', 长夜轮回: 'hourglass', 化险为夷: 'bloom',
    连枝: 'bloom', 天禄: 'bloom', 白泽图: 'bloom', 涤秽回春: 'bloom', 黑白球: 'taiji',
    黑白凝珠: 'taiji', 两仪流转: 'taiji', 墨意: 'brush', 落笔: 'brush', 笔走龙蛇: 'brush',
    飞白: 'brush', 潮汐: 'tide', 涌潮拍岸: 'tide', 海螺回响: 'tide', 潮声相和: 'tide',
    渊引: 'tide', 惊鸿: 'tide', 止水防御提升: 'shield', 线轴: 'kite', 牵丝: 'kite',
    击飞: 'wind', 疾掠: 'wind', 御风: 'wind', 扶摇: 'wind', 光棱: 'prism', 拾光: 'prism',
    万华镜: 'prism', 凝光为棱: 'prism', 棱光千折: 'prism', 盈光: 'sun', 均光: 'sun',
    盈照: 'sun', 金乌: 'sun', 玄龟: 'shield', 水月: 'moon', 月座: 'moon', 月相: 'moon',
    朔: 'moon', 望: 'moon', 镜影: 'mirror', 镜湖双照: 'mirror', 破镜之刃: 'mirror',
    花间一舞: 'flower', 花谢影不落: 'flower', 弄影: 'veil', 影子: 'veil', 重演: 'hourglass',
    明灯: 'flame', 灯影: 'veil', 身后留灯: 'bloom',
    血偿: 'drop', 禁血: 'drop', 血诏: 'drop', 血契锁: 'lock', 血誓横扫: 'drop',
    破妄: 'flame', 破妄暴击率: 'spark', 昭神: 'seal',
    天神震怒: 'lock', 震怒: 'lock', 震怒眩晕: 'stun', 束缚: 'lock', 援护: 'shield',
    暗夜法阵: 'seal', 缚魂轮转: 'bone', 骸骨王座: 'bone', 终焉王座: 'bone',
    恐惧情绪能量: 'fear', 恐惧蔓延: 'fear', 生死叠加: 'atom', 叠加态: 'atom',
    观测坍缩: 'atom', 观测效应: 'atom', 能量跃迁: 'atom', 粒子标记: 'atom',
    祥瑞: 'flame', 星火: 'flame', 暗夜星火: 'flame', 烈火燎原: 'flame', 燎原百斩: 'blade',
    和弦: 'chime', 激情: 'chime', 余音: 'chime', 奏鸣曲: 'chime', 协奏曲: 'chime',
    裂帛和弦: 'chime', 财气: 'coin', 来财: 'coin', 增势: 'surge', 增势跃迁: 'surge',
    破锋: 'blade', 缚魂吸血·永驻: 'fang',
    不屈增势: 'surge', 再动: 'surge', 亡灵共鸣: 'bone', 亡灵吸血: 'fang', 亡灵唤回: 'bone',
    亡灵反噬: 'bone', 渊渟岳峙: 'shield', 帛画神性: 'seal', 噬惧: 'fear',
    泠汐增伤提升: 'spark', 长离复生增伤: 'flame', 不灭凋零: 'wither', 凋零: 'wither',
};

/**
 * 同族状态共用字形：阴阳师的一根线、赏金猎人的四色悬赏、折光的整批光系名字都靠这里收口，
 * 免得每加一个变体就要回来补一行精确名。顺序即优先级，长前缀放前面。
 */
const NAME_PREFIX_GLYPH: Array<readonly [string, StatusGlyphId]> = [
    ['悬赏·', 'sight'], ['猎杀', 'sight'], ['阳线', 'sun'], ['阴线', 'wither'],
    ['观测', 'atom'], ['量子', 'atom'], ['粒子', 'atom'], ['凋零', 'wither'],
    ['亡灵', 'bone'], ['骸骨', 'bone'], ['缚魂', 'bone'], ['印月', 'moon'],
    ['月华', 'moon'], ['月蚀', 'moon'], ['镜', 'mirror'], ['棱', 'prism'],
    ['潮汐', 'tide'], ['潮', 'tide'], ['汐', 'tide'], ['止水', 'tide'],
    ['风', 'wind'], ['羽化', 'wind'], ['霜', 'frost'], ['雪', 'ice'],
    ['冰', 'ice'], ['寒', 'frost'], ['醉', 'cup'], ['墨', 'brush'],
    ['笔', 'brush'], ['花', 'flower'], ['血', 'drop'], ['财', 'coin'],
    ['弦', 'chime'], ['音', 'chime'], ['曲', 'chime'], ['锋', 'blade'],
    ['刃', 'blade'], ['斩', 'blade'], ['势', 'surge'], ['怒', 'lock'],
    ['惧', 'fear'], ['盾', 'shield'], ['护', 'shield'], ['庇护', 'shield'],
    ['星', 'spark'], ['光', 'prism'], ['时', 'hourglass'], ['沙', 'claw'],
    ['砂', 'claw'], ['线', 'kite'], ['鸢', 'kite'], ['魂', 'bone'],
    ['灵', 'spark'], ['焰', 'flame'], ['火', 'flame'], ['灼', 'flame'],
    ['月', 'moon'], ['钓', 'kite'], ['威', 'seal'],
];

const TYPE_GLYPH: Record<EffectType, StatusGlyphId> = {
    buff: 'surge',
    debuff: 'decline',
    mark: 'mark',
    shield: 'shield',
    stun: 'stun',
    control: 'lock',
};

function matchNamePrefix(name: string): StatusGlyphId | null {
    for (const [prefix, id] of NAME_PREFIX_GLYPH) {
        if (name.startsWith(prefix)) return id;
    }
    return null;
}

/** 一条状态效果的图标字形 */
export function resolveEffectGlyphId(name: string, type: EffectType): StatusGlyphId {
    const kind = statusFxKindByEffectName(name);
    if (kind) return KIND_GLYPH[kind];
    return NAME_GLYPH[name] ?? matchNamePrefix(name) ?? TYPE_GLYPH[type] ?? 'mark';
}

/** 一个玩家向计数器（破锋 / 猎砂 / 财气 / 月相…）的图标字形 */
export function resolveCounterGlyphId(label: string): StatusGlyphId {
    const kind = statusFxKindByCounter(label);
    if (kind) return KIND_GLYPH[kind];
    return NAME_GLYPH[label] ?? matchNamePrefix(label) ?? 'mark';
}

/** 属性栏三个保留项的字形，与状态图标同一套笔画 */
export const STAT_GLYPH = {
    defense: 'shield',
    critRate: 'spark',
    critDamage: 'blade',
} as const satisfies Record<string, StatusGlyphId>;

/**
 * 字形配色。放在 core 而不是组件里，是为了让状态名文字和它的图标取同一个颜色，
 * 同时避免组件文件多导出一个函数（react-refresh 会因此放弃热更新边界）。
 * 按宣纸底 #f7f0df 挑的深色，不用亮色系，免得在浅色卡片上糊成一片。
 */
const GLYPH_TONES: Record<StatusGlyphId, string> = {
    ice: '#2c6d92', frost: '#5b8fa8', stun: '#8a6d2f', lock: '#6b4f7a',
    veil: '#4c5566', sight: '#a8322c', eye: '#7a2f3a', bolt: '#6f5bd0',
    fear: '#5a3f6e', wither: '#6b7a4a', flame: '#c0492a', drop: '#9b2c39',
    wind: '#3f8a72', shield: '#2f6f63', blade: '#3d4a5c', notch: '#55606f',
    chime: '#8a6a2c', fang: '#6d3a5c', atom: '#3f6a92', coin: '#a5761f',
    cup: '#8b5a2b', moon: '#4a5f8a', sun: '#c1861f', taiji: '#3a4653',
    brush: '#34414f', tide: '#2a7a8c', kite: '#b5652a', prism: '#3f7fa0',
    seal: '#98313c', surge: '#2f7a4f', decline: '#7b5560', spark: '#b8862a',
    bloom: '#2f8055', bone: '#6a6f78', hourglass: '#5c6478', claw: '#a8792c',
    mirror: '#5f7f9a', flower: '#b4566f', mark: '#6a6f78',
};

export function statusGlyphTone(id: StatusGlyphId): string {
    return GLYPH_TONES[id];
}

/**
 * 战报术语表（battle-glossary）里的「战斗规则」词条不是状态，走不到上面那套状态名解析，
 * 所以给它们单独一张表。战斗状态与英雄机制两类直接复用状态解析——同一个术语在战报和状态卡上是同一枚字形。
 */
const TERM_GLYPH: Record<string, StatusGlyphId> = {
    真实死亡: 'bone', 阵亡: 'bone', 暂时死亡: 'hourglass', 暂时阵亡: 'hourglass',
    复活: 'bloom', 复生: 'bloom', 额外行动: 'surge', 再次行动: 'surge', 强制行动: 'lock',
    无视防御: 'blade', 真实伤害: 'notch', 暴击率: 'spark', 暴击: 'spark', 吸血: 'fang',
    护盾: 'shield', 防御: 'shield', 击杀: 'sight', 冷却: 'hourglass', 闪避: 'veil',
    反击: 'blade', 天威: 'seal', 分身: 'mirror', 镜像: 'mirror', 标记: 'mark', 悬赏: 'sight',
    // 云岫的三件场地物：云是天象（字形表里没有云，取最接近的风）、针与息都是雷
    雷云: 'wind', 引雷针: 'bolt', 霆息: 'bolt',
    // 轩辕神君：飞剑是刃、免伤是盾、金痕是盖在敌人身上的刻痕、昭神是印绶加身
    飞剑: 'blade', 御剑免伤: 'shield', 金痕: 'notch', 昭神: 'seal', 剑随气走: 'wind',
    // 闻人翊悬：破妄与两式技能都是火行
    破妄: 'flame', 蹈火·跃阵: 'flame', 破妄·燎原: 'flame',
    // 全场节奏规则：越到后期刀越重，用火焰表示"烧起来了"
    激战: 'flame',
};

/** 战报术语的字形：先查规则词条，再落到状态解析链，最后给通用标记 */
export function resolveTermGlyphId(term: string): StatusGlyphId {
    return TERM_GLYPH[term] ?? resolveEffectGlyphId(term, 'mark');
}
