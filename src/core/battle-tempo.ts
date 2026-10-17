/**
 * 激战（battle tempo）：对局拖到后期时给全场伤害加一档压力阀。
 *
 * 口径（2026-10-15 与用户确认）：
 * - 第 20 回合进入激战，全场伤害 ×1.2；第 25 回合进入第二层，×1.4；
 * - 30 回合封顶的判定不变（`MAX_BATTLE_ROUNDS` 没动）；
 * - **走增伤通道**而不是"攻击提升"那一档：绝大多数英雄 `baseAttack` 为 0，
 *   挂攻击加成对他们等于空转（惊鸿/镜花/震霄/云岫的注释里都记着同一件事）；
 * - **固定伤害与真实伤害不跟着涨**：那两类是"不可规避"的设计意图，
 *   激战只放大走常规结算口径的伤害；
 * - 治疗不受影响（`applyHeal` 根本不经过伤害管线）。
 *
 * 这里只放纯函数：回合号 → 档位/倍率/播报文案。倍率由 `DamageCalculator` 在结算时读，
 * 播报与常驻角标由表现层读（`fierceShortBadge` 给角标的倍率），两边共用同一份阈值，别各写一个 20。
 */

export const FIERCE_FIRST_ROUND = 20;
export const FIERCE_SECOND_ROUND = 25;
/** 各档位的伤害倍率：0 = 未进入激战 */
export const FIERCE_MULTIPLIERS: Record<0 | 1 | 2, number> = { 0: 1, 1: 1.2, 2: 1.4 };

export type FierceTier = 0 | 1 | 2;

/** 激战入场横幅要显示的东西（与击杀横幅共用同一个展示位） */
export interface BattlePhaseAnnouncement {
    id: string;
    tier: FierceTier;
    eyebrow: string;
    title: string;
    note: string;
}

/** 第几回合属于哪个激战档位（25 起是第二层，之后不再升） */
export function fierceTier(roundNumber: number): FierceTier {
    if (!Number.isFinite(roundNumber)) return 0;
    if (roundNumber >= FIERCE_SECOND_ROUND) return 2;
    if (roundNumber >= FIERCE_FIRST_ROUND) return 1;
    return 0;
}

/** 该回合的全场伤害倍率（乘在常规结算的增伤段上） */
export function fierceMultiplier(roundNumber: number): number {
    return FIERCE_MULTIPLIERS[fierceTier(roundNumber)];
}

/** 角标短文案：只有倍率。竖屏顶栏宽度紧张，"激战"两字由组件标在角标里 */
export function fierceShortBadge(roundNumber: number): string | null {
    const tier = fierceTier(roundNumber);
    if (tier === 0) return null;
    return tier === 1 ? '×1.2' : '×1.4';
}

/** 入场播报：只在"刚跨过阈值那一回合"给一份，避免每回合都弹横幅 */
export function fierceAnnouncement(roundNumber: number): BattlePhaseAnnouncement | null {
    if (roundNumber === FIERCE_FIRST_ROUND || roundNumber === FIERCE_SECOND_ROUND) {
        const second = roundNumber === FIERCE_SECOND_ROUND;
        return {
            id: `fierce-${roundNumber}`,
            tier: second ? 2 : 1,
            eyebrow: second ? 'FIERCE BATTLE II' : 'FIERCE BATTLE',
            title: second ? '激战·二重' : '激战',
            note: second
                ? `第${roundNumber}回合起，全场伤害提升 40%`
                : `第${roundNumber}回合起，全场伤害提升 20%`,
        };
    }
    return null;
}
