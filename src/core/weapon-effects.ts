import { DamageCalculator } from './damage-calculator';
import { EffectManager } from './effect-manager';
import { ZUIYI_MAX } from '../data/extended-skills';
import type { Hero, GameState } from '../types/game';
import { HeroState } from '../types/game';

/**
 * 专属武器的战斗结算入口（经典模式）。
 *
 * 约定：
 * - 一器一主，所以判定只看 `hero.weaponId === 模板id`，没有第二套 id 体系；
 * - 标准模式下 weaponId 恒为 null，本文件所有函数直接短路，现行平衡读数不受影响；
 * - 每种触发时机一个导出函数，挂点尽量贴在已有的收口处（命中收口在 applyDamage、
 *   登场收口在 applyHeroWeapon），避免同一个效果散落在多个英雄分支里。
 */

function armed(hero: { weaponId?: string | null }, weaponId: string): boolean {
    return hero.weaponId === weaponId;
}

/** 登场（布阵落子、补员上场、临时拉人）时的一次性初始化 */
export function applyWeaponOnArrival(hero: Hero): void {
    if (!hero.weaponId) return;
    // 猎砂之爪：登场即有 1 层猎砂，不再靠第一次被击才攒
    if (armed(hero, 'fengling')) {
        EffectManager.setCounter(hero, '猎砂', Math.max(EffectManager.getCounter(hero, '猎砂'), 1));
    }
    // 冥王权杖：本体保底 1 层亡灵之力/亡灵之魂（亡灵共鸣是全队死亡计数，不在此保底）
    if (armed(hero, 'skeletonking')) {
        hero.counters['亡灵之力'] = Math.max(hero.counters['亡灵之力'] ?? 0, 1);
        hero.counters['亡灵之魂'] = Math.max(hero.counters['亡灵之魂'] ?? 0, 1);
    }
}

/** 每次攻击造成伤害后（每个受击目标各判一次，命中 3 人即判 3 次） */
export function applyWeaponOnDamageDealt(attacker: Hero, gameState: GameState): void {
    if (!attacker.weaponId || attacker.state !== HeroState.ALIVE) return;
    // 醉月 / 酒狂：都是给自己攒醉意，上限沿用 ZUIYI_MAX，不另开一条账
    const chance = armed(attacker, 'libai') ? 0.25 : armed(attacker, 'zuizhendao') ? 0.2 : 0;
    if (chance <= 0 || Math.random() >= chance) return;
    const stacks = EffectManager.getCounter(attacker, '醉意');
    if (stacks >= ZUIYI_MAX) return;
    EffectManager.setCounter(attacker, '醉意', Math.min(ZUIYI_MAX, stacks + 1));
    void gameState;
}

/** 琉璃援护结算成功时：50% 概率再多攒 1 层禅定 */
export function applyWeaponOnGuard(guardian: Hero): void {
    if (!armed(guardian, 'liuli') || Math.random() >= 0.5) return;
    guardian.counters['禅定'] = (guardian.counters['禅定'] ?? 0) + 1;
}

/** 杰茨米每次转化形态（原地切形与暂死切形两条路径都走这里）：恢复 5 点生命 */
export function applyWeaponOnFormShift(hero: Hero, gameState: GameState): void {
    if (!armed(hero, 'jetzmi') || hero.state !== HeroState.ALIVE) return;
    DamageCalculator.applyHeal(hero, 5, gameState, hero);
}
