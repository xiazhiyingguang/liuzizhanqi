import type { BattleMode, Hero } from '../types/game';
import { heroTemplateId } from '../data/heroes';
import { ZHIZHI_START_COUNTERS, ZHIZHI_STAT_BONUSES, type ZhizhiTier } from '../data/hero-zhizhi';

/**
 * 致知的战斗侧入口。
 *
 * 开关沿用仓库既有约定：`hero.counters['talent_N'] = 1` 表示第 N 层生效，
 * 各技能里读它做数值/行为分支（见 `zhizhiValue`）。
 *
 * 授予只发生在经典模式：标准模式（人机 / 本地 / 联机）永远不写这三个计数，
 * 所以现有对局的结算与之前完全一致。登场收口在 store 与镜花替身三处，
 * 与武器的 `applyHeroWeapon` + `applyWeaponOnArrival` 是同一层"模式装载"。
 */

const ZHIZHI_TIERS: readonly ZhizhiTier[] = [1, 2, 3];

function counterKey(tier: ZhizhiTier): string {
    return `talent_${tier}`;
}

/** 常驻属性只能落一次：补员、替身登场会重新建实例，但同一具不能反复加血 */
function statAppliedKey(tier: ZhizhiTier): string {
    return `__zhizhi_stat_${tier}_applied`;
}

/** 这一层致知是否生效 */
export function hasZhizhi(hero: Hero, tier: ZhizhiTier): boolean {
    return (hero.counters?.[counterKey(tier)] ?? 0) > 0;
}

/**
 * 数值分支：未授予时取原值，授予后取强化值。
 * 允许传 null——很多场合要读的是"效果来源那位的致知"，而来源可能已经不在场。
 */
export function zhizhiValue<T>(
    hero: Hero | null | undefined,
    tier: ZhizhiTier,
    standard: T,
    upgraded: T
): T {
    return hero && hasZhizhi(hero, tier) ? upgraded : standard;
}

/** 起始资源同样只能落一次：吸血率、条命这类增量重复叠加会直接把数值推歪 */
function startAppliedKey(tier: ZhizhiTier): string {
    return `__zhizhi_start_${tier}_applied`;
}

/** 英雄X「增势」指定承伤者的层数门槛：致知3 把它从 3 降到 2 */
export function heroXRedirectCost(hero: Hero | null | undefined): number {
    return zhizhiValue(hero, 3, 3, 2);
}

/** 授予某一层，并落地它的常驻属性加成（幂等） */
export function grantZhizhi(hero: Hero, tier: ZhizhiTier): void {
    hero.counters = { ...(hero.counters ?? {}) };
    hero.counters[counterKey(tier)] = 1;

    const bonus = ZHIZHI_STAT_BONUSES[heroTemplateId(hero)]?.[tier];
    const startCounters = ZHIZHI_START_COUNTERS[heroTemplateId(hero)]?.[tier];
    if (startCounters && hero.counters[startAppliedKey(tier)] !== 1) {
        hero.counters[startAppliedKey(tier)] = 1;
        for (const [key, delta] of Object.entries(startCounters)) {
            hero.counters[key] = (hero.counters[key] ?? 0) + delta;
        }
    }
    if (!bonus || hero.counters[statAppliedKey(tier)] === 1) return;
    hero.counters[statAppliedKey(tier)] = 1;

    hero.moveRange += bonus.moveRange ?? 0;
    hero.baseAttack = (hero.baseAttack ?? 0) + (bonus.baseAttack ?? 0);
    const hp = bonus.maxHp ?? 0;
    if (hp > 0) {
        hero.maxHp += hp;
        hero.currentHp += hp;
        // 莫问的回溯锚点记的是"上一回合末的生命"，建实例时按未抬高的上限写入；
        // 上限一动就要跟着挪，否则致知1 反而让技能一回溯时把多出来的生命扣掉
        if (hero.counters['mowen_prev_hp'] !== undefined) hero.counters['mowen_prev_hp'] += hp;
    }
}

/** 收回某一层（调试与测试用）；已落地的属性加成不回滚，避免半路改上限引发血线错乱 */
export function revokeZhizhi(hero: Hero, tier: ZhizhiTier): void {
    delete hero.counters[counterKey(tier)];
}

/**
 * 模式装载：经典模式三层全给，标准模式一律清空。
 * 召唤物与分身不吃自己的致知——它们的强化由本体的致知在结算处代为生效。
 */
export function applyZhizhiForMode(hero: Hero, gameMode: BattleMode | undefined): Hero {
    const isSummon = hero.counters?.['__isSummon'] === 1 || hero.counters?.['__isClone'] === 1;
    if (gameMode === 'classic' && !isSummon) {
        for (const tier of ZHIZHI_TIERS) grantZhizhi(hero, tier);
        return hero;
    }
    for (const tier of ZHIZHI_TIERS) revokeZhizhi(hero, tier);
    return hero;
}
