import { nextBattleLogId } from './battle-log-id';
import { isRealCharacterHero } from './battle-statistics';
import { HeroState, type GameState, type Hero, type TianweiSkill } from '../types/game';

export const WANGSHU_PHASE_NAMES = ['新月', '上弦', '满月'] as const;

export function getWangshuPhase(hero: Hero): number {
    return Math.max(0, Math.min(2, Math.floor(hero.counters['wangshu_moon_phase'] ?? 0)));
}

/** Only the recorded Shu/Wang difference receives the moon multiplier. */
export function getWangshuMultiplier(hero: Hero): number {
    const phase = getWangshuPhase(hero);
    return phase === 2 ? (hero.counters['talent_3'] ? 1 : .8) : phase === 1 ? .6 : .5;
}

/** Living, deployed allied characters across the whole board, including Wangshu herself. */
export function getWangshuAllies(hero: Hero, state: GameState): Hero[] {
    const allies = hero.owner === 'player1' ? state.player1Heroes : state.player2Heroes;
    return allies.filter(ally => ally.state === HeroState.ALIVE && ally.position &&
        state.board[ally.position[0]]?.[ally.position[1]]?.id === ally.id && isRealCharacterHero(ally));
}

export function advanceWangshuPhase(hero: Hero): void {
    hero.counters['wangshu_moon_phase'] = Math.min(2, getWangshuPhase(hero) + 1);
}

export const wangshuTianwei: TianweiSkill = {
    id: 'wangshu_tianwei',
    name: '天威 · 月满',
    description: '击杀敌人后，立即进入满月状态',
    execute: (hero, state) => {
        hero.counters['wangshu_moon_phase'] = 2;
        state.battleLog.push({
            id: nextBattleLogId(), type: 'tianwei', player: hero.owner,
            message: `${hero.name}触发天威·月满，立即进入满月（${Math.round(getWangshuMultiplier(hero) * 100)}%）`,
            timestamp: Date.now(),
        });
    },
};
