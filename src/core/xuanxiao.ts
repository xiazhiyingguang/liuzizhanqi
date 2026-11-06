import { nextBattleLogId } from './battle-log-id';
import { isRealCharacterHero } from './battle-statistics';
import { HeroState, type GameState, type Hero } from '../types/game';

export const XUANXIAO_REPRISE_RANGE = 2;

/** 只在落子登场后结算；记录在队伍上，离场、复活或实例重建都不会重置。 */
export function triggerXuanxiaoEntrance(hero: Hero, state: GameState): void {
    if (hero.passiveId !== 'xuanxiao_passive' || hero.state !== HeroState.ALIVE || !hero.position ||
        state.board[hero.position[0]]?.[hero.position[1]] !== hero || !isRealCharacterHero(hero) ||
        state.xuanxiaoEntranceTriggered?.[hero.owner]) return;

    state.xuanxiaoEntranceTriggered = { ...state.xuanxiaoEntranceTriggered, [hero.owner]: true };
    const allies = hero.owner === 'player1' ? state.player1Heroes : state.player2Heroes;
    for (const ally of allies) {
        const pos = ally.position;
        if (pos && ally.state === HeroState.ALIVE && state.board[pos[0]]?.[pos[1]] === ally && isRealCharacterHero(ally)) {
            ally.moveRange += 1;
        }
    }
    state.battleLog.push({
        id: nextBattleLogId(), type: 'passive', player: hero.owner, timestamp: Date.now(),
        message: `${hero.name}触发「神威」：此刻场上的己方英雄移动力永久 +1`,
    });
}
