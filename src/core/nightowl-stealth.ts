import { EffectManager } from './effect-manager';
import type { Hero } from '../types/game';

/**
 * 夜枭潜行的唯一入口：进入或维持「潜行」，并给潜行层数计一层。
 *
 * 一个回合里可能有多条途径让他进潜行（技能1标记后藏身、击杀触发天威、被动回合末隐入），
 * 而这一层数直接喂给技能二的倍率与致知一的暴击（口径都是"每潜行一回合"），
 * 所以同一回合只许叠一层，否则一击之下倍率会翻倍。
 */
export function enterNightowlStealth(hero: Hero, roundNumber: number): boolean {
    if (hero.counters['__nightowl_stealth_round'] === roundNumber) return false;
    hero.counters['__nightowl_stealth_round'] = roundNumber;

    if (!EffectManager.hasEffect(hero, '潜行')) {
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: '潜行',
            duration: -1,
            sourceHeroId: hero.id,
            description: '潜行状态，免疫单体伤害，范围伤害每回合最多10点'
        });
        hero.counters['stealth_turns'] = 1;
    } else {
        hero.counters['stealth_turns'] = Math.max(1, (hero.counters['stealth_turns'] ?? 0) + 1);
    }
    return true;
}
