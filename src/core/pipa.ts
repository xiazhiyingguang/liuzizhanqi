import { nextBattleLogId } from './battle-log-id';
import { isRealCharacterHero } from './battle-statistics';
import { EffectManager } from './effect-manager';
import { HeroState, type GameState, type Hero } from '../types/game';

export function triggerPipaEntrance(hero: Hero, state: GameState): void {
    if (hero.passiveId !== 'pipa_passive' || hero.state !== HeroState.ALIVE || !hero.position ||
        state.board[hero.position[0]]?.[hero.position[1]] !== hero || !isRealCharacterHero(hero) ||
        state.pipaEntranceTriggered?.[hero.owner]) return;

    state.pipaEntranceTriggered = { ...state.pipaEntranceTriggered, [hero.owner]: true };
    const allies = hero.owner === 'player1' ? state.player1Heroes : state.player2Heroes;
    for (const ally of allies) {
        const pos = ally.position;
        if (!pos || ally.state !== HeroState.ALIVE || state.board[pos[0]]?.[pos[1]] !== ally || !isRealCharacterHero(ally)) continue;
        EffectManager.addEffect(ally, {
            type: 'buff',
            name: '神威·攻击提升',
            duration: -1,
            value: 0.2,
            sourceHeroId: hero.id,
            description: '五弦琵琶登场神威：攻击力永久增加20%',
        });
    }
    state.battleLog.push({
        id: nextBattleLogId(), type: 'passive', player: hero.owner, timestamp: Date.now(),
        message: `${hero.name}触发「神威」：此刻场上的己方英雄攻击力永久增加20%`,
    });
}
