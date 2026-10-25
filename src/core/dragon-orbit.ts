import { DamageCalculator } from './damage-calculator';
import { requestSkillFx } from '../data/extended-skills';
import { EffectManager } from './effect-manager';
import { zhizhiValue } from './hero-zhizhi';
import { enemiesOnCells } from './lamp-shadow';
import { BOARD_SIZE, GameState, Hero, HeroState, Position } from '../types/game';
import { DRAGON_CALL_LEAD_MS, DRAGON_SWEEP_LEAD_MS } from './dragon-sweep-fx';

/**
 * 游龙·敖渊的两份账：挂在身上的「游龙」与逐层衰减的「龙鳞」。
 *
 * 口径（2026-10-14 与用户确认）：
 * - 游龙**不占棋盘格**：它是绕着本体外圈转的环绕状态，敌人打不到它、也不挡任何人的路；
 * - 外圈 8 格，顺时针走 4 步 = 半圈，**这一路命中的格子含起点与终点，共 5 格**；
 *   再走 4 步走完一圈。本体挪位时游龙跟着挪，方位不变。
 * - 龙鳞层数无上限，但每层各带自己的 2 回合倒计时（靠"同名多条独立记录"实现逐层掉落），
 *   所以不封顶也不会永远叠着——这是用户明确选的口径。
 * - 每层 +6% 攻击、+6% 闪避（致知三抬到 10%）。攻击那份显式乘在伤害基数上：
 *   敖渊没有基础攻击力，走"攻击提升"通道等于空转（仓库里惊鸿/镜花/震霄都是同一处理）。
 */
export const DRAGON_EFFECT = '游龙';
export const DRAGON_DURATION = 2;
export const SCALES_EFFECT = '龙鳞';
export const SCALES_DURATION = 2;
export const SCALES_PER_LAYER = 0.06;
export const SCALES_PER_LAYER_TALENT = 0.10;
export const SCALES_SUSTAIN_COST = 3;
export const ORBIT_DAMAGE = 4;
export const ORBIT_DAMAGE_TALENT = 5;
export const DASH_DAMAGE = 8;
export const DASH_DISTANCE = 3;
/** 半圈：走 4 步、连着起点一共扫过 5 格 */
export const ORBIT_HALF_STEPS = 4;
export const ORBIT_LEG_CELLS = ORBIT_HALF_STEPS + 1;

const ORBIT_RING_SIZE = 8;
/** 顺时针：上 → 右上 → 右 → 右下 → 下 → 左下 → 左 → 左上 */
const CLOCKWISE_DELTAS: Array<[number, number]> = [
    [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1],
];

const ORBIT_INDEX_KEY = '__aoyuan_orbit';
const DASH_BONUS_KEY = '__aoyuan_dash_bonus';
const SUSTAIN_ROUND_KEY = '__aoyuan_sustain_round';
const TIANWEI_DRAGON_KEY = '__aoyuan_tianwei_dragon';
const ORBITED_ACTION_KEY = '__aoyuan_orbited_action';

function inBounds(cell: Position): boolean {
    return cell[0] >= 0 && cell[0] < BOARD_SIZE && cell[1] >= 0 && cell[1] < BOARD_SIZE;
}

/** 本体在 center 时，第 index 个方位落在棋盘哪一格（贴边时可能出界，出界的格子扫不到人） */
export function orbitCell(center: Position, index: number): Position {
    const [dr, dc] = CLOCKWISE_DELTAS[((index % ORBIT_RING_SIZE) + ORBIT_RING_SIZE) % ORBIT_RING_SIZE];
    return [center[0] + dr, center[1] + dc];
}

/** 召唤格 → 外圈方位序号；不在外圈上时按"正上方"起算 */
export function orbitIndexOfCell(center: Position, cell: Position): number {
    const found = CLOCKWISE_DELTAS.findIndex(
        ([dr, dc]) => center[0] + dr === cell[0] && center[1] + dc === cell[1]);
    return found < 0 ? 0 : found;
}

/** 技能一可选的召唤格：本体周围一格内的空格 */
export function dragonSummonCells(state: GameState, caster: Hero): Position[] {
    if (!caster.position) return [];
    return CLOCKWISE_DELTAS
        .map(([dr, dc]) => [caster.position![0] + dr, caster.position![1] + dc] as Position)
        .filter(cell => inBounds(cell) && state.board[cell[0]][cell[1]] === null);
}

export function hasDragon(hero: Hero): boolean {
    return hero.effects.some(effect =>
        effect.name === DRAGON_EFFECT && effect.sourceHeroId === hero.id);
}

function dragonEffect(hero: Hero) {
    return hero.effects.find(effect => effect.name === DRAGON_EFFECT && effect.sourceHeroId === hero.id);
}

/** 唤龙：把游龙挂回身上，方位按新召唤格重算，持续回到 2 回合 */
export function attachDragon(caster: Hero, cell: Position): void {
    const center = caster.position ?? cell;
    caster.counters[ORBIT_INDEX_KEY] = nextOrbitIndex(caster, orbitIndexOfCell(center, cell));
    removeOwnEffect(caster, DRAGON_EFFECT);
    EffectManager.addEffect(caster, {
        type: 'buff',
        name: DRAGON_EFFECT,
        duration: DRAGON_DURATION,
        sourceHeroId: caster.id,
        description: '游龙绕身盘旋：每次行动结束顺时针扫过半圈，对路径上的敌人造成伤害',
    });
}

/**
 * 方位序号存的是"单调递增的累计步数"，不是 0~7 的余数：
 * 棋盘方位照常按 mod 8 取（orbitCell 内部就取模），而常驻龙影要能把
 * "转了半圈"补间成顺时针那 180°——存余数的话 7→1 会倒着绕 270°。
 */
function nextOrbitIndex(caster: Hero, target: number): number {
    const previous = (caster.counters[ORBIT_INDEX_KEY] ?? 0) as number;
    return previous + ((target - previous) % ORBIT_RING_SIZE + ORBIT_RING_SIZE) % ORBIT_RING_SIZE;
}

/** 游龙当前方位的累计序号（视觉层据此摆龙头，mod 8 才是棋盘上的那一格） */
export function dragonOrbitIndex(hero: Hero): number {
    return (hero.counters[ORBIT_INDEX_KEY] ?? 0) as number;
}

export function extendDragon(caster: Hero, rounds: number): void {
    const dragon = dragonEffect(caster);
    if (!dragon) return;
    dragon.duration += rounds;
}

/** 龙鳞：每层一条独立记录，各自倒数 2 回合，所以层数会一格格掉下去 */
export function scaleLayers(hero: Hero): number {
    return hero.effects.filter(effect =>
        effect.name === SCALES_EFFECT && effect.sourceHeroId === hero.id).length;
}

export function scaleRatePerLayer(hero: Hero): number {
    return zhizhiValue(hero, 3, SCALES_PER_LAYER, SCALES_PER_LAYER_TALENT);
}

export function scaleAttackMultiplier(hero: Hero): number {
    return 1 + scaleLayers(hero) * scaleRatePerLayer(hero);
}

/** 游龙与冲刺的伤害基数：先乘上龙鳞的攻击加成 */
export function scaledDragonDamage(hero: Hero, amount: number): number {
    return Math.round(amount * scaleAttackMultiplier(hero));
}

export function gainScales(hero: Hero, amount = 1): number {
    for (let index = 0; index < amount; index++) {
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: SCALES_EFFECT,
            duration: SCALES_DURATION,
            sourceHeroId: hero.id,
            description: '每层提升 6% 攻击与 6% 闪避（致知三 10%），各层独立持续两回合',
        });
    }
    return scaleLayers(hero);
}

/** 花掉层数时先花"最快到期"的那几层，与玩家看到的衰减节奏一致 */
export function consumeScales(hero: Hero, amount: number): number {
    const layers = hero.effects
        .filter(effect => effect.name === SCALES_EFFECT && effect.sourceHeroId === hero.id)
        .sort((left, right) => left.duration - right.duration)
        .slice(0, amount);
    const ids = new Set(layers.map(layer => layer.id));
    hero.effects = hero.effects.filter(effect => !ids.has(effect.id));
    return layers.length;
}

/** 龙鳞换算成的闪避率（无上限：层数自己会随回合掉下去） */
export function getScaleDodgeRate(hero: Hero): number {
    if (hero.passiveId !== 'aoyuan_passive') return 0;
    return scaleLayers(hero) * scaleRatePerLayer(hero);
}

/** 冲刺距离：天威「龙腾四海」之后永久 +1 */
export function dragonDashDistance(hero: Hero): number {
    return DASH_DISTANCE + (hero.counters[DASH_BONUS_KEY] ?? 0);
}

/** 四个方向各能冲多远：落点必须空格，中途穿人不减速 */
export function dragonDashLandings(state: GameState, caster: Hero): Position[] {
    if (!caster.position) return [];
    const reach = dragonDashDistance(caster);
    const landings: Position[] = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
        for (let step = 1; step <= reach; step++) {
            const cell: Position = [caster.position[0] + dr * step, caster.position[1] + dc * step];
            if (!inBounds(cell) || state.board[cell[0]][cell[1]] !== null) break;
            landings.push(cell);
        }
    }
    return landings;
}

/** 沿某一方向冲刺时会被扫到的格子（不含落点本身，落点必须是空的） */
export function dragonDashPath(caster: Hero, landing: Position): Position[] {
    const origin = caster.position;
    if (!origin) return [];
    const dr = Math.sign(landing[0] - origin[0]);
    const dc = Math.sign(landing[1] - origin[1]);
    const cells: Position[] = [];
    for (let step = 1; step < Math.max(Math.abs(landing[0] - origin[0]), Math.abs(landing[1] - origin[1])); step++) {
        const cell: Position = [origin[0] + dr * step, origin[1] + dc * step];
        if (inBounds(cell)) cells.push(cell);
    }
    return cells;
}

/**
 * 给出格子里站着的敌方存活单位（去重，同一人踩两格只算一次），
 * 外加影子落在这些格子里的敌人——后者由 enemiesOnCells 挂上"只挨半刀"的标记。
 */
export function dragonVictimsOnCells(state: GameState, caster: Hero, cells: Position[]): Hero[] {
    const found = enemiesOnCells(state, caster, cells);
    // 这团的口径一直是"同一人踩两格只算一次"，按格索敌本身不合并，这里替它守住
    return found.filter((hero, index) => found.indexOf(hero) === index);
}

/** 游龙这一击：伤害走常规结算（吃减伤与闪避），打痛了就叠一层龙鳞 */
function strikeWithDragon(state: GameState, caster: Hero, victims: Hero[], amount: number, log: string[]): number {
    const base = scaledDragonDamage(caster, amount);
    let hits = 0;
    for (const victim of victims) {
        if (victim.state !== HeroState.ALIVE) continue;
        const damage = DamageCalculator.calculate(caster, victim, base, false);
        DamageCalculator.applyDamage(victim, damage, caster, state, true);
        if (damage.finalDamage > 0) {
            hits++;
            gainScales(caster, 1);
        }
    }
    if (hits > 0) {
        log.push(`${caster.name}的游龙扫过${hits}名敌人，龙鳞叠至${scaleLayers(caster)}层`);
    }
    return hits;
}

/**
 * 游龙的一次扫击：对给出格子里的敌人各打一发，打痛了就叠一层龙鳞。
 * 伤害走常规结算（吃减伤与闪避），整段算一次出手（和声/吸血只结一次）。
 */
export function dragonStrike(state: GameState, caster: Hero, cells: Position[], log: string[]): number {
    const victims = dragonVictimsOnCells(state, caster, cells);
    if (victims.length === 0) return 0;
    const amount = zhizhiValue(caster, 2, ORBIT_DAMAGE, ORBIT_DAMAGE_TALENT);
    return DamageCalculator.asOneAttack(() => strikeWithDragon(state, caster, victims, amount, log));
}

/**
 * 行动结束：游龙顺时针扫过半圈（4 步、含起点共 5 格）。
 * 本体贴边时外圈会缺几格，缺掉的格子扫不到人，但方位照样推进，
 * 不然靠墙的敖渊会永远卡在同一个角度上。
 */
/** 本体站在 center 时，下一段半圈会扫到的 5 个格子（含起点，可能出界） */
export function nextOrbitLeg(caster: Hero, center: Position): Position[] {
    const from = (caster.counters[ORBIT_INDEX_KEY] ?? 0) as number;
    const leg: Position[] = [];
    for (let step = 0; step < ORBIT_LEG_CELLS; step++) {
        leg.push(orbitCell(center, from + step));
    }
    return leg;
}

/**
 * 标记"这一回合的半圈已经在冲刺里扫过了"。
 * 技能二自己带一圈，若行动结束的钩子再推一次，一次行动就白得两圈、伤害翻倍。
 */
export function markDragonOrbitedThisAction(caster: Hero): void {
    // 记下"即将到来的那次行动结束"的序号：endHeroAction 会先把 __actionSerial 加一再收尾
    caster.counters[ORBITED_ACTION_KEY] = (caster.counters['__actionSerial'] ?? 0) + 1;
}

/** 本回合行动结束时该不该跳过盘旋 */
function orbitedThisAction(caster: Hero): boolean {
    return (caster.counters[ORBITED_ACTION_KEY] ?? -1) === (caster.counters['__actionSerial'] ?? 0);
}

export function advanceDragon(state: GameState, caster: Hero, log: string[], presentation?: { startDelayMs: number }): number {
    if (!hasDragon(caster) || !caster.position) return 0;
    if (orbitedThisAction(caster)) return 0;
    const center = caster.position;
    const from = (caster.counters[ORBIT_INDEX_KEY] ?? 0) as number;
    const leg = nextOrbitLeg(caster, center);
    const summoning = state.skillFxExtras?.dragonAction?.kind === 'summon' &&
        state.skillFxExtras.dragonAction.sourceHeroId === caster.id;
    if (summoning) delete state.skillFxExtras!.dragonAction;
    caster.counters[ORBIT_INDEX_KEY] = from + ORBIT_HALF_STEPS;
    // 盘旋不是"施法"，走的是行动结束的引擎钩子，所以特效得自己点名：
    // 不给这一笔，玩家只看得到一串飘字，看不出是那一圈龙影扫的
    const sweptCells = leg.filter(cell => {
        if (!inBounds(cell)) return false;
        const occupant = state.board[cell[0]][cell[1]];
        return !!occupant && occupant.owner !== caster.owner && occupant.state === HeroState.ALIVE;
    });
    const legCells = leg.filter(inBounds).map(cell => [...cell] as Position);
    const logIdsBefore = new Set((state.battleLog ?? []).map(entry => entry.id));
    const hits = dragonStrike(state, caster, leg, log);
    if (legCells.length > 0) {
        // 没扫到人也要把这一圈演出来：绕身游龙是他的核心身位，
        // "只在打中时才看得见龙"会让人以为自己根本没唤出过龙
        requestSkillFx({
            skillId: 'aoyuan_orbit',
            dragonStartDeg: from * 45,
            dragonContactsOnly: summoning || undefined,
            startDelayMs: summoning ? DRAGON_CALL_LEAD_MS - DRAGON_SWEEP_LEAD_MS : presentation?.startDelayMs,
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: [...center] as Position,
            targetPos: [...(sweptCells[0] ?? legCells[0])] as Position,
            impactPositions: sweptCells.map(cell => [...cell] as Position),
            coveredPositions: legCells,
            logIds: (state.battleLog ?? []).filter(entry => !logIdsBefore.has(entry.id)).map(entry => entry.id),
        }, state);
    }
    return hits;
}

/** 天威「龙腾四海」：冲刺距离永久 +1，游龙持续时间只补这一次 +2 回合 */
export function applyDragonTianwei(caster: Hero): string[] {
    const log: string[] = [];
    if ((caster.counters[DASH_BONUS_KEY] ?? 0) === 0) {
        caster.counters[DASH_BONUS_KEY] = 1;
        log.push(`${caster.name}龙腾四海，此后冲刺距离 +1`);
    } else {
        log.push(`${caster.name}龙腾四海，冲刺距离再 +1`);
        caster.counters[DASH_BONUS_KEY] = (caster.counters[DASH_BONUS_KEY] ?? 0) + 1;
    }
    if (caster.counters[TIANWEI_DRAGON_KEY] !== 1) {
        caster.counters[TIANWEI_DRAGON_KEY] = 1;
        extendDragon(caster, DRAGON_DURATION);
        log.push(`${caster.name}的游龙得势，多盘旋两回合`);
    }
    return log;
}

/**
 * 回合开始：游龙只剩最后一回合还没散时，花 3 层龙鳞把它续上一回合。
 * 层数不够就不续，让它自然散掉。
 */
export function sustainDragonAtRoundStart(state: GameState, caster: Hero): void {
    if (!hasDragon(caster)) return;
    if (caster.counters[SUSTAIN_ROUND_KEY] === state.roundNumber) return;
    const dragon = dragonEffect(caster);
    if (!dragon || dragon.duration > 1) return;
    if (scaleLayers(caster) < SCALES_SUSTAIN_COST) return;
    caster.counters[SUSTAIN_ROUND_KEY] = state.roundNumber;
    consumeScales(caster, SCALES_SUSTAIN_COST);
    dragon.duration += 1;
    state.battleLog?.push({
        id: `aoyuan-sustain-${state.roundNumber}-${caster.id}`,
        type: 'passive',
        player: caster.owner,
        message: `${caster.name}龙鳞游息：散去${SCALES_SUSTAIN_COST}层龙鳞，游龙再盘一回合（剩余${scaleLayers(caster)}层）`,
        timestamp: Date.now(),
    });
}

function removeOwnEffect(hero: Hero, name: string): void {
    hero.effects = hero.effects.filter(effect =>
        !(effect.name === name && effect.sourceHeroId === hero.id));
}

