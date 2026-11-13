import { BOARD_SIZE, HeroState, type GameState, type Hero, type Position, type QiyuanWish } from '../types/game';

export const QIYUAN_PASSIVE = 'qiyuan_passive';
export const QIYUAN_WISH = 'qiyuan_skill1';
export const QIYUAN_GUARD = 'qiyuan_skill2';
export const QIYUAN_RESERVE = '不负所托';
export const QIYUAN_DELAY = '__qiyuan_delay';

export function qiyuanSkillKind(id: string): QiyuanWish['kind'] | undefined {
    return id === QIYUAN_WISH ? 'wish' : id === QIYUAN_GUARD ? 'guard' : undefined;
}

export function qiyuanPlan(state: Pick<GameState, 'qiyuanWishes'>, hero: Hero, kind: QiyuanWish['kind']) {
    return state.qiyuanWishes?.find(plan => plan.sourceHeroId === hero.id && plan.kind === kind);
}

export function qiyuanAllyOnBoard(state: Pick<GameState, 'board'>, hero: Hero, pos: Position) {
    const unit = state.board[pos[0]]?.[pos[1]];
    return unit?.owner === hero.owner && unit.state === HeroState.ALIVE &&
        !unit.counters['__isSummon'] && !unit.counters['__isClone'] ? unit : undefined;
}

export function qiyuanTargets(caster: Hero, kind: QiyuanWish['kind'], state?: GameState): Position[] {
    if (!caster.position) return [];
    if (kind === 'guard' || (state && qiyuanPlan(state, caster, kind))) return [caster.position];
    const [row, col] = caster.position;
    const result: Position[] = [];
    for (let r = Math.max(0, row - 2); r <= Math.min(BOARD_SIZE - 1, row + 2); r++) {
        for (let c = Math.max(0, col - 2); c <= Math.min(BOARD_SIZE - 1, col + 2); c++) {
            if (!state || qiyuanAllyOnBoard(state, caster, [r, c])) result.push([r, c]);
        }
    }
    return result;
}

export function qiyuanCross([r, c]: Position): Position[] {
    return ([[r, c], [r-1,c], [r-2,c], [r+1,c], [r+2,c], [r,c-1], [r,c-2], [r,c+1], [r,c+2]] as Position[])
        .filter(([row, col]) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE);
}
