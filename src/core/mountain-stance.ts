import { EffectManager } from './effect-manager';
import { zhizhiValue } from './hero-zhizhi';
import { BOARD_SIZE, GameState, Hero, HeroState, Position } from '../types/game';

/**
 * 岱宗的两份账：「镇守」姿态与「岳势」伤害池。
 *
 * 口径（2026-10-15 与用户逐条确认）：
 * - 技能一选的方向是"敌人从哪边来"：他面朝威胁、把身后那半个棋盘护下来。
 *   **分界线固定在棋盘中线**（1~3 列 / 4~6 列，行同理），与他站在哪一列无关；
 *   被挨打的友方要在他护的半区里，且出手的敌人要来自他面朝的那半边，两边都对得上才转伤。
 *   例：朝右摆 → 护住第 1~3 列，此时第 4/5/6 列的敌人打第 1~3 列的友方，全部由他挡下。
 * - 姿态一直挂着，直到他**移动**或**用了技能二**才解除；不移动就继续维持。
 * - 「岳势」= 他**挡下来**的那部分伤害，不是身上掉的那部分：镇守先转 40%（致知二 50%），
 *   「不动如山」的层数并进同一档，合计封顶 90%；剩下的才真打到他身上。暂不封顶池子总量。
 * - 被动「不动如山」：本回合没移动就叠一层 25% 减伤（封顶 50%）；没摆镇守时它照常只是减伤。
 *   叠满之后，再"不动"改为每回合回复 10% 已损生命。
 */
export const STANCE_EFFECT = '镇守';
export const PRESSURE_EFFECT = '岳压';
export const LAMP_EFFECT = '传灯增防';
export const MOUNTAIN_COUNTER = '岳势';

export const GUARD_REDUCTION = 0.4;
export const GUARD_REDUCTION_TALENT = 0.5;
/** 承转上限：技能一 40% + 不动如山 50% = 90%，致知把两边各自抬到 50%/60% 也不再往上走 */
export const CONVERSION_CAP = 0.9;
export const STANCE_LAYER_DEFENSE = 0.25;
export const STANCE_LAYER_DEFENSE_TALENT = 0.3;
export const STANCE_DEFENSE_CAP = 0.5;
export const STANCE_DEFENSE_CAP_TALENT = 0.6;
export const STANCE_HEAL_RATE = 0.1;
export const STANCE_HEAL_RATE_TALENT = 0.15;
export const PRESSURE_DAMAGE_RATE = 0.2;
export const PRESSURE_DURATION = 2;
export const LAMP_DEFENSE_RATE = 0.2;
export const LAMP_DEFENSE_DURATION = 2;
export const STANCE_LAYERS_MAX = 2;

export const DIR_UP = 0;
export const DIR_RIGHT = 1;
export const DIR_DOWN = 2;
export const DIR_LEFT = 3;
export const DAIZONG_DIRECTIONS = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT] as const;

const DIR_COUNTER = '__daizong_dir';
const LAMP_COUNTER = '__daizong_lamp';

const DIR_DELTA: Record<number, [number, number]> = {
    [DIR_UP]: [-1, 0],
    [DIR_RIGHT]: [0, 1],
    [DIR_DOWN]: [1, 0],
    [DIR_LEFT]: [0, -1],
};

export const DIR_LABEL: Record<number, string> = {
    [DIR_UP]: '上', [DIR_RIGHT]: '右', [DIR_DOWN]: '下', [DIR_LEFT]: '左',
};

function isDaizong(hero: Hero | null | undefined): boolean {
    return !!hero && hero.passiveId === 'daizong_passive';
}

export function stanceDirection(hero: Hero): number | null {
    const effect = hero.effects.find(item => item.name === STANCE_EFFECT && item.sourceHeroId === hero.id);
    if (!effect) return null;
    const dir = hero.counters[DIR_COUNTER];
    return dir === undefined ? null : dir;
}

export function hasStance(hero: Hero): boolean {
    return stanceDirection(hero) !== null;
}

export function setStance(hero: Hero, direction: number): void {
    hero.counters[DIR_COUNTER] = direction;
    EffectManager.removeEffectByName(hero, STANCE_EFFECT);
    EffectManager.addEffect(hero, {
        type: 'buff',
        name: STANCE_EFFECT,
        duration: -1,
        sourceHeroId: hero.id,
        description: '岱宗面朝威胁那一侧镇守：另一半棋盘的友方被这一侧的敌人打中时，伤害由他承受，其中 40%（致知二 50%）被他硬挡下并转为「岳势」，叠上不动如山最高挡 90%',
    });
}

export function clearStance(hero: Hero): void {
    delete hero.counters[DIR_COUNTER];
    EffectManager.removeEffectByName(hero, STANCE_EFFECT);
}

/**
 * 某格是不是他护着的那半边。**分界线固定在棋盘中线**（第 1~3 列 / 第 4~6 列，行同理），
 * 不随岱宗站在哪一列漂移。方向按"敌人从哪边来"理解：他面朝威胁那一侧，护住身后那半场。
 *
 * 为什么不用"他自己那一列为界"：实测他站在边列时那样只能护住一整列里的 6 格，
 * 一局下来实际只挡下 0~1 次，玩家看到的就是"技能一毫无作用"。中线切两半才是策划案
 * "相当于把棋盘划分为了两半"的字面意思，覆盖面稳定在 18 格。
 */
function inProtectedHalf(daizong: Hero, direction: number, cell: Position): boolean {
    void daizong;
    switch (direction) {
        case DIR_UP: return cell[0] >= BOARD_SIZE / 2;      // 面朝上 → 护下三行
        case DIR_DOWN: return cell[0] < BOARD_SIZE / 2;     // 面朝下 → 护上三行
        case DIR_LEFT: return cell[1] >= BOARD_SIZE / 2;    // 面朝左 → 护右三列
        case DIR_RIGHT: return cell[1] < BOARD_SIZE / 2;    // 面朝右 → 护左三列
        default: return false;
    }
}

/**
 * 敌人是否站在被护半区之外——两侧都成立才挡（用户明确"两边都要对得上"）。
 * 岱宗自己那一行/列算在被护侧，所以贴着他站的那名敌人出手不算"从外侧来"。
 */
function inThreatHalf(daizong: Hero, direction: number, cell: Position): boolean {
    return !inProtectedHalf(daizong, direction, cell);
}

/** 棋盘上此刻被某位岱宗护住的格子集合（高亮用，两侧都算） */
export function guardedCellKeys(
    state: Pick<GameState, 'player1Heroes' | 'player2Heroes'>
): Set<string> {
    const keys = new Set<string>();
    for (const hero of [...state.player1Heroes, ...state.player2Heroes]) {
        if (!isDaizong(hero) || hero.state !== HeroState.ALIVE || !hero.position) continue;
        const direction = stanceDirection(hero);
        if (direction === null) continue;
        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) {
                if (inProtectedHalf(hero, direction, [row, col])) keys.add(`${row},${col}`);
            }
        }
    }
    return keys;
}

/** 对外导出的半区判定：某格是不是在他护的那一侧 */
export function guardsCell(daizong: Hero, direction: number, cell: Position): boolean {
    return inProtectedHalf(daizong, direction, cell);
}

/** 某格是不是"他面朝的那半个棋盘"（中线之外的那一半）——从这里出手的攻击才会被挡 */
export function threatensFrom(daizong: Hero, direction: number, cell: Position): boolean {
    return inThreatHalf(daizong, direction, cell);
}

/**
 * 该不该由岱宗替这一击承受：受害者在他护的半区、出手者在对面半区。
 * 与"援护"同一套结算位置，但护的是一整片而不是一个标记，所以每次受击现算。
 */
export function findDaizongBulwark(
    gameState: GameState,
    victim: Hero,
    attacker: Hero
): Hero | null {
    if (!victim.position || !attacker.position || victim.owner === attacker.owner) return null;
    // 岱宗自己挨的那份不外传：否则两个岱宗会把同一击踢来踢去
    if (isDaizong(victim)) return null;
    const squad = victim.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    for (const hero of squad) {
        if (!isDaizong(hero) || hero.state !== HeroState.ALIVE || !hero.position) continue;
        if (hero.id === victim.id) continue;           // 他自己挨打走"承受并记账"那条路
        const direction = stanceDirection(hero);
        if (direction === null) continue;
        if (!inProtectedHalf(hero, direction, victim.position)) continue;
        if (!inThreatHalf(hero, direction, attacker.position)) continue;
        return hero;
    }
    return null;
}

/** 岳势：镇守期间挡下来的份额记进池子（承受到的那部分不算，那是他身上掉的血） */
export function recordStanceDamage(hero: Hero, amount: number): number {
    if (!isDaizong(hero) || amount <= 0 || !hasStance(hero)) return mountainPressure(hero);
    EffectManager.addCounter(hero, MOUNTAIN_COUNTER, Math.round(amount));
    return mountainPressure(hero);
}

export function mountainPressure(hero: Hero): number {
    return hero.counters[MOUNTAIN_COUNTER] ?? 0;
}

/** 技能二吐出去：清空岳势，并给命中者挂「岳压」（攻击 -20%，两回合） */
export function releaseMountainPressure(state: GameState, caster: Hero, cells: Position[]): Hero[] {
    const stored = mountainPressure(caster);
    caster.counters[MOUNTAIN_COUNTER] = 0;
    const victims: Hero[] = [];
    const seen = new Set<Hero>();
    for (const [row, col] of cells) {
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
        const occupant = state.board[row][col];
        if (!occupant || occupant.owner === caster.owner || occupant.state !== HeroState.ALIVE) continue;
        if (seen.has(occupant)) continue;
        seen.add(occupant);
        victims.push(occupant);
    }
    if (stored > 0) {
        for (const victim of victims) {
            EffectManager.removeEffectByName(victim, PRESSURE_EFFECT);
            EffectManager.addEffect(victim, {
                type: 'debuff',
                name: PRESSURE_EFFECT,
                duration: PRESSURE_DURATION,
                value: zhizhiValue(caster, 3, PRESSURE_DAMAGE_RATE, PRESSURE_DAMAGE_RATE),
                sourceHeroId: caster.id,
                description: '被岳势压住，造成的伤害降低 20%，持续两回合',
            });
        }
    }
    return victims;
}

/** 不动如山：本回合没迈过步子，就叠一层减伤；叠满后改为回血 */
export function applyStillnessReward(state: GameState, hero: Hero): string | null {
    if (!isDaizong(hero) || hero.hasMovedThisTurn) return null;
    const perLayer = zhizhiValue(hero, 3, STANCE_LAYER_DEFENSE, STANCE_LAYER_DEFENSE_TALENT);
    const cap = zhizhiValue(hero, 3, STANCE_DEFENSE_CAP, STANCE_DEFENSE_CAP_TALENT);
    const layers = stanceLayers(hero);
    const maxLayers = Math.max(1, Math.round(cap / perLayer));
    if (layers < maxLayers) {
        const next = addStanceLayer(hero, perLayer);
        return `${hero.name}不动如山，防御提升${Math.round(perLayer * 100)}%（当前${Math.round(next * 100)}%）`;
    }
    const healRate = zhizhiValue(hero, 3, STANCE_HEAL_RATE, STANCE_HEAL_RATE_TALENT);
    const missing = Math.max(0, hero.maxHp - hero.currentHp);
    const amount = Math.floor(missing * healRate);
    if (amount > 0) {
        hero.currentHp = Math.min(hero.maxHp, hero.currentHp + amount);
        state.battleLog?.push({
            id: `daizong-heal-${state.roundNumber}-${hero.id}-${Date.now()}`,
            type: 'passive',
            player: hero.owner,
            message: `${hero.name}镇岳养息，回复${amount}点生命`,
            timestamp: Date.now(),
        });
    }
    return amount > 0 ? null : `${hero.name}血气充盈，养息无处可用`;
}

function stanceLayers(hero: Hero): number {
    return hero.effects.filter(effect =>
        effect.name === '厚重' && effect.sourceHeroId === hero.id).length;
}

function addStanceLayer(hero: Hero, perLayer: number): number {
    // 每层一条独立记录：数值直接按当前档位写死，致知不会回头改旧层
    EffectManager.addEffect(hero, {
        type: 'buff',
        name: '厚重',
        duration: -1,
        value: perLayer,
        sourceHeroId: hero.id,
        description: '不动如山叠出的减伤',
    });
    return hero.effects
        .filter(effect => effect.name === '厚重' && effect.sourceHeroId === hero.id)
        .reduce((sum, effect) => sum + (effect.value ?? 0), 0);
}

/** 岱宗叠出来的总减伤比例（封顶由叠层数量保证，这里再夹一次） */
export function stillnessDefense(hero: Hero): number {
    const cap = zhizhiValue(hero, 3, STANCE_DEFENSE_CAP, STANCE_DEFENSE_CAP_TALENT);
    const total = hero.effects
        .filter(effect => effect.name === '厚重' && effect.sourceHeroId === hero.id)
        .reduce((sum, effect) => sum + (effect.value ?? 0), 0);
    return Math.min(cap, total);
}

export function guardReduction(hero: Hero): number {
    return zhizhiValue(hero, 2, GUARD_REDUCTION, GUARD_REDUCTION_TALENT);
}

/**
 * 「山岳承转」：镇守期间他这一击硬挡下多少——技能一的 40%（致知二 50%）
 * 加上不动如山叠出来的层数，合计封顶 90%。没摆姿态就是 0，池子也不涨。
 * 挡下来的那份记作岳势，剩下的才是他身上掉的血；不动如山没摆姿态时仍按普通减伤结算。
 */
export function stanceConversion(hero: Hero): number {
    if (!hasStance(hero)) return 0;
    return Math.min(CONVERSION_CAP, guardReduction(hero) + stillnessDefense(hero));
}

/** 天威「传灯」：把这次天威交给下一个出手的友方 */
export function queueDaizongLamp(caster: Hero): void {
    caster.counters[LAMP_COUNTER] = (caster.counters[LAMP_COUNTER] ?? 0) + 1;
}

export function hasPendingLamp(state: GameState, owner: Hero['owner']): Hero | null {
    const squad = (owner === 'player1' ? state.player1Heroes : state.player2Heroes)
        .filter(hero => isDaizong(hero) && (hero.counters[LAMP_COUNTER] ?? 0) > 0);
    return squad[0] ?? null;
}

/** 友方出手（行动结束）时兑现传灯：触发他自己的天威，并给他两回合 20% 防御 */
export function consumeDaizongLamp(state: GameState, ally: Hero): boolean {
    const daizong = hasPendingLamp(state, ally.owner);
    if (!daizong) return false;
    if (daizong.id === ally.id) return false;         // 传灯不传给自己
    daizong.counters[LAMP_COUNTER] = (daizong.counters[LAMP_COUNTER] ?? 0) - 1;
    EffectManager.removeEffectByName(ally, LAMP_EFFECT);
    EffectManager.addEffect(ally, {
        type: 'buff',
        name: LAMP_EFFECT,
        duration: LAMP_DEFENSE_DURATION,
        value: LAMP_DEFENSE_RATE,
        sourceHeroId: daizong.id,
        description: '岱宗传灯：防御提升 20%，持续两回合',
    });
    state.battleLog?.push({
        id: `daizong-lamp-${state.roundNumber}-${ally.id}-${Date.now()}`,
        type: 'tianwei',
        player: ally.owner,
        message: `${daizong.name}传灯给${ally.name}：${ally.name}防御提升20%（两回合）`,
        timestamp: Date.now(),
    });
    return true;
}

/** 技能一可选的方向标：上下左右四格（出界的不算） */
export function daizongDirectionCells(hero: Hero): Position[] {
    if (!hero.position) return [];
    return DAIZONG_DIRECTIONS
        .map(dir => {
            const [dr, dc] = DIR_DELTA[dir];
            return [hero.position![0] + dr, hero.position![1] + dc] as Position;
        })
        .filter(([row, col]) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE);
}

export function directionFromCell(from: Position, cell: Position): number | null {
    const dr = Math.sign(cell[0] - from[0]);
    const dc = Math.sign(cell[1] - from[1]);
    for (const dir of DAIZONG_DIRECTIONS) {
        const [expectedRow, expectedCol] = DIR_DELTA[dir];
        if (expectedRow === dr && expectedCol === dc) return dir;
    }
    return null;
}
