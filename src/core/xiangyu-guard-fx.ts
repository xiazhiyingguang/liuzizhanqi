import type { GameState, Hero } from '../types/game';
import { HeroState } from '../types/game';
import { isSkillFxSuppressed, requestSkillFx } from '../data/extended-skills';

/** 只由已成功的发动/伤害转化分支调用，复用日志并快照实际护盾增量。 */
export function requestXiangyuGuardFx(hero: Hero, state: GameState, amount: number, convert = false): void {
    if (isSkillFxSuppressed() || !hero.position || hero.state !== HeroState.ALIVE || amount <= 0) return;
    const log = state.battleLog[state.battleLog.length - 1];
    if (!log) return;
    requestSkillFx({ skillId: convert ? 'xiangyu_guard_convert' : 'xiangyu_tianwei', sourceHeroId: hero.id,
        owner: hero.owner, fromPos: [...hero.position], targetPos: [...hero.position], guardAmount: amount,
        logIds: [log.id], coveredPositions: [], impactPositions: [], damagePositions: [] }, state);
}
