import { DamageCalculator } from './damage-calculator';
import { zhizhiValue } from './hero-zhizhi';
import {
    SHUANGFEIYAN_BOOMERANG_DAMAGE,
    getShuangfeiyanBoomerangs,
    getShuangfeiyanReturnPath,
    removeShuangfeiyanBoomerang,
} from './boomerang';
import { GameState, Hero, HeroState } from '../types/game';

/** 致知三：回旋镖往返伤害 4 → 5 */
export function shuangfeiyanBoomerangDamage(hero: Hero): number {
    return zhizhiValue(hero, 3, SHUANGFEIYAN_BOOMERANG_DAMAGE, SHUANGFEIYAN_BOOMERANG_DAMAGE + 1);
}

/**
 * 每次成功出手后推进她自己的出手序号，并结算所有到期的返航。
 * 返航伤害按每把镖各算一次攻击：两把同时回来时，同一个人会分别吃两段。
 */
export function advanceShuangfeiyanAfterSkill(hero: Hero, state: GameState): string[] {
    hero.counters['sfy_skillSerial'] = (hero.counters['sfy_skillSerial'] ?? 0) + 1;
    if (hero.state !== HeroState.ALIVE || !hero.position) return [];

    const serial = hero.counters['sfy_skillSerial'];
    const due = getShuangfeiyanBoomerangs(state, hero)
        .filter(effect => (effect.returnAtSkillSerial ?? Number.POSITIVE_INFINITY) <= serial);
    const logs: string[] = [];

    for (const effect of due) {
        if (hero.state !== HeroState.ALIVE || !hero.position) break;
        const path = getShuangfeiyanReturnPath(effect.position, hero.position);
        const enemies = new Set<Hero>();
        for (const [row, col] of path) {
            const occupant = state.board[row]?.[col];
            if (occupant && occupant.state === HeroState.ALIVE && occupant.owner !== hero.owner) {
                enemies.add(occupant);
            }
        }

        let total = 0;
        DamageCalculator.asOneAttack(() => {
            for (const enemy of enemies) {
                const damage = DamageCalculator.calculate(
                    hero,
                    enemy,
                    shuangfeiyanBoomerangDamage(hero),
                    false,
                    false
                );
                DamageCalculator.applyDamage(enemy, damage, hero, state, true);
                total += damage.finalDamage;
            }
        });

        removeShuangfeiyanBoomerang(state, effect.id);
        logs.push(
            enemies.size > 0
                ? `${hero.name}的回旋镖沿最短路径返航，掠过${enemies.size}名敌人造成${total}点伤害`
                : `${hero.name}的回旋镖回到手中`
        );
    }

    return logs;
}

/** 被动：每次行动只登记一次“第二手”，且这第二手只允许放技能 */
export function queueShuangfeiyanSecondAction(hero: Hero, state: GameState): boolean {
    if (hero.counters['sfy_second_queued'] === 1) return false;
    hero.counters['sfy_second_queued'] = 1;
    hero.counters['__sfy_self_extra'] = 1;
    state.pendingExtraActionHeroIds ??= {};
    state.pendingExtraActionHeroIds[hero.owner] = hero.id;
    DamageCalculator.addBattleLog(state, {
        type: 'passive',
        player: hero.owner,
        message: `${hero.name}·双飞：本手结束后还能再出一次手`,
    });
    return true;
}
