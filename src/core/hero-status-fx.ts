/**
 * 英雄持续状态的视觉特效解析（棋子上的常驻动画层）。
 *
 * 与技能施放特效（skill-fx，一次性）互补：这里描述"身上挂着什么状态"。
 * 纯解析逻辑放本模块（可单测），DOM/CSS 表现在 HeroStatusFx 组件。
 *
 * 渲染上限 MAX_HERO_STATUS_FX 层，按优先级取：
 * 硬控 > 被猎标记 > 恶性减益 > 风系 > 冰系 > 姿态/守护 > 增益 > 引擎标记 > 资源层数。
 */
import type { Hero } from '../types/game';

export type HeroStatusFxKind =
    | 'frozen'       // 冰冻
    | 'stun'         // 眩晕
    | 'paralysis'    // 麻痹（天威封印）
    | 'stealth'      // 潜行
    | 'bounty'       // 猎杀令（赏金猎人集火标记）
    | 'bounty-tianwei'  // 悬赏·天威再临（赤金印玺）
    | 'bounty-revive'   // 悬赏·半血回生（翡翠回生纹）
    | 'bounty-crit'     // 悬赏·永久暴击（绯红暴击刻）
    | 'bounty-vampire'  // 悬赏·永久吸血（暗紫汲取环）
    | 'deathmark'    // 猎杀标记（夜枭死契之瞳）
    | 'chainmark'    // 链式闪电标记（震霄）
    | 'fear'         // 恐惧
    | 'wither'       // 凋零
    | 'burn'         // 灼烧（火系持续伤害）
    | 'bleed'        // 流血（移动掉血）
    | 'headwind'     // 逆风
    | 'tailwind'     // 顺风
    | 'chill'        // 寒天
    | 'feather'      // 羽化
    | 'inlay'        // 金银错（震霄反击姿态）
    | 'way'          // 为道（墨阑姿态）
    | 'guard'        // 援护（琉璃/沉渊守护）
    | 'ice-armor'    // 冰甲
    | 'harmony'      // 和声（吟游诗人）
    | 'note'         // 音符（五弦琵琶附伤）
    | 'vampire'      // 亡灵吸血（杰茨米强化）
    | 'edge'         // 锋鸣（回锋追猎标记）
    | 'combo'        // 连破/啸刃（回锋的永久标记，二者互斥故共用外观）
    | 'particle'     // 粒子标记（费曼）
    | 'observe-hit'  // 观测坍缩受伤（薛定谔）
    | 'observe-miss' // 观测坍缩未受伤（薛定谔）
    | 'entangle'     // 量子纠缠（薛定谔）
    | 'rage'         // 愤怒（血契强锁：只能攻击锁住它的对象）
    | 'fortune'      // 来财（旺财增益）
    | 'mirror-blade' // 破镜之刃层数（镜）
    | 'momentum'     // 增势层数（英雄X）
    | 'drunk'        // 醉意层数（太白/醉枕刀）
    | 'xubai-orbs';  // 黑白球余量（叙白，环绕珠数=剩余颗数）

/** 同时渲染的状态特效上限（棋子很小，多了会糊） */
export const MAX_HERO_STATUS_FX = 2;

/** 按优先级排列的全部状态：先匹配到的先渲染 */
const STATUS_FX_PRIORITY: Array<{ kind: HeroStatusFxKind; effectNames?: string[]; counter?: string }> = [
    { kind: 'frozen', effectNames: ['冰冻'] },
    { kind: 'stun', effectNames: ['眩晕'] },
    { kind: 'paralysis', effectNames: ['麻痹'] },
    { kind: 'stealth', effectNames: ['潜行'] },
    { kind: 'bounty', effectNames: ['猎杀令'] },
    { kind: 'bounty-tianwei', effectNames: ['悬赏·天威再临'] },
    { kind: 'bounty-revive', effectNames: ['悬赏·半血回生'] },
    { kind: 'bounty-crit', effectNames: ['悬赏·永久暴击'] },
    { kind: 'bounty-vampire', effectNames: ['悬赏·永久吸血'] },
    { kind: 'deathmark', effectNames: ['猎杀标记'] },
    { kind: 'chainmark', effectNames: ['链式闪电'] },
    { kind: 'fear', effectNames: ['恐惧'] },
    { kind: 'rage', effectNames: ['愤怒'] },
    { kind: 'wither', effectNames: ['凋零'] },
    { kind: 'burn', effectNames: ['灼烧'] },
    { kind: 'bleed', effectNames: ['流血'] },
    { kind: 'headwind', effectNames: ['逆风'] },
    { kind: 'tailwind', effectNames: ['顺风'] },
    { kind: 'chill', effectNames: ['寒天'] },
    { kind: 'feather', effectNames: ['羽化'] },
    { kind: 'inlay', effectNames: ['金银错'] },
    { kind: 'way', effectNames: ['为道'] },
    { kind: 'guard', effectNames: ['援护'] },
    { kind: 'ice-armor', effectNames: ['冰甲'] },
    { kind: 'harmony', effectNames: ['和声'] },
    { kind: 'note', effectNames: ['音符'] },
    { kind: 'vampire', effectNames: ['亡灵吸血'] },
    { kind: 'edge', effectNames: ['锋鸣'] },
    { kind: 'combo', effectNames: ['连破', '啸刃'] },
    { kind: 'particle', effectNames: ['粒子标记'] },
    { kind: 'observe-hit', effectNames: ['观测坍缩受伤'] },
    { kind: 'observe-miss', effectNames: ['观测坍缩未受伤'] },
    { kind: 'entangle', effectNames: ['量子纠缠'] },
    { kind: 'fortune', effectNames: ['来财'] },
    { kind: 'mirror-blade', counter: '破镜之刃' },
    { kind: 'momentum', counter: '增势' },
    { kind: 'drunk', counter: '醉意' },
    { kind: 'xubai-orbs', counter: '黑白球' },
];

/** 解析棋子当前应渲染的状态特效（按优先级，最多 MAX_HERO_STATUS_FX 层） */
export function resolveHeroStatusFx(hero: Hero): HeroStatusFxKind[] {
    const active: HeroStatusFxKind[] = [];
    for (const entry of STATUS_FX_PRIORITY) {
        if (active.length >= MAX_HERO_STATUS_FX) break;
        if (entry.effectNames && hero.effects.some(
            effect => entry.effectNames!.includes(effect.name)
        )) {
            active.push(entry.kind);
        } else if (entry.counter && (hero.counters?.[entry.counter] ?? 0) > 0) {
            active.push(entry.kind);
        }
    }
    return active;
}
