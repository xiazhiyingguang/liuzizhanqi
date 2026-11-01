import type { GameState, Hero, Position } from '../types/game';
import { HeroState } from '../types/game';
import type { SkillFxEvent } from './skill-fx';
import { isSkillFxSuppressed, requestSkillFx } from '../data/extended-skills';

/** 只复用已成功结算的天威日志，不制造状态、攻击或随机数。 */
export function requestTianweiStance(hero: Hero, skillId: 'guying_tianwei' | 'nightowl_tianwei', state: GameState, logId: string): void {
    const name = skillId === 'guying_tianwei' ? '断雪' : '潜行';
    if (isSkillFxSuppressed() || !hero.position || hero.state !== HeroState.ALIVE || !hero.effects.some(e => e.name === name)) return;
    requestSkillFx({ skillId, sourceHeroId: hero.id, owner: hero.owner, fromPos: [...hero.position],
        targetPos: [...hero.position], logIds: [logId], coveredPositions: [], impactPositions: [], damagePositions: [] }, state);
}

/** 突进击杀后可能继续落位：姿态跟随本人，不在尸体或旧格上播放。 */
export function stanceAnchor(event: SkillFxEvent, board: GameState['board'], events: SkillFxEvent[] = [event]): Position | undefined {
    // 同一次连杀只留最新一份入势，避免四套剑痕/羽片叠在同一头像上。
    if (events.some(other => other.profile.stance && other.sourceHeroId === event.sourceHeroId && other.id > event.id)) return;
    const name = event.profile.stance === 'snow-break' ? '断雪' : event.profile.stance === 'overlord-guard' ? '霸王镇守' : '潜行';
    for (let r = 0; r < board.length; r++) for (let c = 0; c < board[r].length; c++) {
        const hero = board[r][c];
        if (hero && hero.id === event.sourceHeroId && hero.state === HeroState.ALIVE &&
            (event.profile.stance === 'overlord-convert' || hero.effects.some(e => e.name === name))) return [r, c];
    }
}
