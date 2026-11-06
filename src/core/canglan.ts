import { BOARD_SIZE, HeroState, type GameState, type Hero, type Position } from '../types/game';
import { zhizhiValue } from './hero-zhizhi';
import { getRageBinder } from './taunt';

export const CANGLAN_SKILL1 = 'canglan_skill1';
export const CANGLAN_SKILL2 = 'canglan_skill2';
export const CANGLAN_TIANWEI = 'canglan_tianwei';
export const TIDE_EDGE = '潮锋';
export const CONDENSED_WATER = '凝水';
const RATE = '__canglan_rate';
const LOCKED_RATE = '__canglan_locked_rate';
const LOCKED_FORM = '__canglan_locked_form';

export function isCanglanSkill(id: string) { return id === CANGLAN_SKILL1 || id === CANGLAN_SKILL2; }
export function canglanChance(hero: Hero) { return hero.counters[LOCKED_RATE] ?? Math.min(100, (hero.counters[RATE] ?? 0) + zhizhiValue(hero, 3, 25, 30)); }
export function canglanForm(hero: Hero): boolean | undefined {
    return hero.counters[LOCKED_FORM] === undefined ? undefined : hero.counters[LOCKED_FORM] === 1;
}
/** 两个技能共用同一份待施法结果。改选、跳过、撤回都不会重掷。 */
export function lockCanglanCast(hero: Hero): boolean {
    const locked = canglanForm(hero);
    if (locked !== undefined) return locked;
    const chance = canglanChance(hero);
    const transformed = chance >= 100 || Math.random() * 100 < chance;
    hero.counters[LOCKED_RATE] = chance;
    hero.counters[LOCKED_FORM] = transformed ? 1 : 0;
    return transformed;
}
export function commitCanglanCast(hero: Hero, transformed: boolean) {
    hero.counters[RATE] = canglanChance(hero) * (transformed ? .5 : 1);
    delete hero.counters[LOCKED_RATE]; delete hero.counters[LOCKED_FORM];
}
export function gainCanglanLayer(hero: Hero, key: typeof TIDE_EDGE | typeof CONDENSED_WATER) {
    hero.counters[key] = Math.min(2, (hero.counters[key] ?? 0) + 1);
}

export function canglanCells(origin: Position, skillId: string, transformed: boolean, target?: Position): Position[] {
    const distance = transformed ? 2 : 1;
    const inside = ([r,c]: Position) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
    if (skillId === CANGLAN_SKILL1) {
        if (!target) return [];
        const dr = target[0] - origin[0], dc = target[1] - origin[1];
        const length = Math.max(Math.abs(dr), Math.abs(dc));
        if (!length || length > distance || (dr && dc && Math.abs(dr) !== Math.abs(dc))) return [];
        return Array.from({ length: distance }, (_, i): Position =>
            [origin[0] + Math.sign(dr) * (i + 1), origin[1] + Math.sign(dc) * (i + 1)]).filter(inside);
    }
    const cells: Position[] = [];
    for (let r = origin[0] - distance; r <= origin[0] + distance; r++) {
        for (let c = origin[1] - distance; c <= origin[1] + distance; c++) {
            if (inside([r,c]) && (r !== origin[0] || c !== origin[1])) cells.push([r,c]);
        }
    }
    return cells;
}

export function canglanEnemy(hero: Hero, state: GameState, [r,c]: Position): Hero | undefined {
    const unit = state.board[r]?.[c];
    return unit && unit.owner !== hero.owner && unit.state === HeroState.ALIVE ? unit : undefined;
}

/** 未判定时展示可能的最大覆盖；锁定后按真实形态收窄。 */
export function canglanTargetPositions(hero: Hero, skillId: string, state?: GameState): Position[] {
    if (!hero.position) return [];
    const origin = hero.position, transformed = canglanForm(hero) !== false;
    const area = canglanCells(origin, CANGLAN_SKILL2, transformed);
    const binder = state && getRageBinder(hero, state);
    const coversBinder = (cells: Position[]) => !binder?.position || cells.some(([r,c]) => r === binder.position![0] && c === binder.position![1]);
    if (skillId === CANGLAN_SKILL2) {
        return coversBinder(area) && (!state || area.some(cell => canglanEnemy(hero, state, cell))) ? [origin, ...area] : [];
    }
    return area.filter(cell => {
        const ray = canglanCells(origin, skillId, transformed, cell);
        return ray.length > 0 && coversBinder(ray) && (!state || canglanEnemy(hero, state, cell));
    });
}
