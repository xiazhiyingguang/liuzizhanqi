import { MovementSystem } from './movement-system';
import type { GameState, Player, Position } from '../types/game';

/**
 * 寒江雪「寒天领域」：在她脚下展开 5×5 领域，持续 2 回合。
 * 领域存在期间，友方每次主动攻击出手有 25% 概率给本次攻击范围内的一个敌人再补 1 层寒天；
 * 单体攻击目标明确，群体攻击从实际命中的敌人里随机取一个。
 */
export const HANJIANGXUE_DOMAIN_TYPE = 'hanjiangxue-domain';
export const HANJIANGXUE_DOMAIN_CHANCE = 0.25;
export const HANJIANGXUE_DOMAIN_DURATION = 2;
export const HANJIANGXUE_DOMAIN_RADIUS = 2;
/** 领域的作用格：5×5，含施法者脚下那一格 */
export function hanjiangxueDomainCells(center: Position): Position[] {
    return [[...center] as Position, ...MovementSystem.getAreaPositions(center, 5)];
}

export function findHanjiangxueDomain(state: GameState, owner: Player) {
    return (state.boardEffects ?? []).find(effect =>
        effect.type === HANJIANGXUE_DOMAIN_TYPE && effect.owner === owner);
}

export function isInHanjiangxueDomain(cell: Position, domain: { position: Position }): boolean {
    return Math.abs(domain.position[0] - cell[0]) <= HANJIANGXUE_DOMAIN_RADIUS
        && Math.abs(domain.position[1] - cell[1]) <= HANJIANGXUE_DOMAIN_RADIUS;
}
