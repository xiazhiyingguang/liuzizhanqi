import { nextBattleLogId } from './battle-log-id';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import { DamageCalculator } from './damage-calculator';
import { zhizhiValue } from './hero-zhizhi';
import { requestSkillFx } from '../data/extended-skills';
import { BOARD_SIZE, HeroState, type BoardEffect, type GameState, type Hero, type Position } from '../types/game';

/**
 * 姜太公「水泽 / 鱼钩 / 鲸落」的收口。
 *
 * 太公钓鱼，愿者上钩：他不追人，只把钩子丢在自己家门口等人走过来。
 * 三件事全落在这一个模块里——水泽是棋盘上的持续场地（BoardEffect），鱼钩是一次性陷阱，
 * 鲸落是他自己出手之后的概率结算。谁身上有几层概率、哪片泽归谁，都别散到技能里去写。
 */

/** 水泽：每层 20% 闪避（致知2 抬到 25%），最多按两层计，只认铺设方阵营 */
export const MARSH_DODGE_RATE = 0.2;
export const MARSH_DODGE_RATE_TALENT = 0.25;
export const MARSH_STACK_CAP = 2;
export const MARSH_DURATION = 2;
/** 半径 1 = 3×3（鱼钩泛起的那片）；技能二直接铺半径 2 = 5×5 */
export const MARSH_RADIUS = 1;
export const MARSH_SKILL2_RADIUS = 2;
/** 天威每片向外扩一圈的上限：名义 7×7 一律压成 6×6（= 整张棋盘） */
export const MARSH_MAX_RADIUS = 3;
/** 鱼钩：三回合有效，同一个人最多挂三枚，新的挤掉最旧的 */
export const HOOK_DURATION = 3;
export const HOOK_MAX = 3;
/** 上钩后抛到指定格造成的伤害（走常规减伤与闪避，不是固定伤害） */
export const HOOK_THROW_DAMAGE = 10;
/** 被动「鲸落」：起手 25%，每次出手没落就再加 25 个百分点，落一次回到起手值 */
export const WHALEFALL_BASE_RATE = 0.25;
export const WHALEFALL_STEP_RATE = 0.25;
export const WHALEFALL_BASE_RATE_TALENT = 0.3;
export const WHALEFALL_STEP_RATE_TALENT = 0.3;
export const WHALEFALL_HEAL = 5;
export const WHALEFALL_DAMAGE = 5;

const WHALEFALL_RATE_KEY = '__jtg_whale_rate';
/** 鲸落自己的伤害会再开一个"出手组"，没有这道守卫它会连环落个不止 */
export const WHALEFALL_GUARD_KEY = '__jtg_whale_falling';
/** 被鱼钩抛出去之后不许再"撤回移动"溜回原位：那等于白吃 10 点还能反悔 */
export const HOOK_THROW_NO_UNDO = '__jtg_hook_thrown';

let marshSeq = 0;
let hookSeq = 0;

/** 是姜太公本人且还在场 */
export function isJiangtaigong(hero: Hero | null | undefined): hero is Hero {
    return !!hero && hero.passiveId === 'jiangtaigong_passive' && hero.state === HeroState.ALIVE;
}

function allHeroes(gameState: GameState): Hero[] {
    return [...gameState.player1Heroes, ...gameState.player2Heroes];
}

function findHero(gameState: GameState, heroId: string): Hero | undefined {
    return allHeroes(gameState).find(hero => hero.id === heroId);
}

/**
 * 水泽覆盖的格子：半径 1/2/3 名义上是 3×3 / 5×5 / 7×7，但**上限压到 6×6**（=整张棋盘）。
 * 窗口贴边时整体平移进棋盘而不是裁切，所以角落铺的泽不会莫名少半圈。
 */
function marshWindow(effect: BoardEffect): { row0: number; col0: number; size: number } {
    const size = Math.min(((effect.radius ?? MARSH_RADIUS) * 2) + 1, BOARD_SIZE);
    const half = Math.floor(size / 2);
    const row0 = Math.max(0, Math.min(BOARD_SIZE - size, effect.position[0] - half));
    const col0 = Math.max(0, Math.min(BOARD_SIZE - size, effect.position[1] - half));
    return { row0, col0, size };
}

/** 这一格是否落在该水泽的覆盖窗口内（判定与渲染共用同一份口径） */
export function marshCovers(effect: BoardEffect, row: number, col: number): boolean {
    const { row0, col0, size } = marshWindow(effect);
    return row >= row0 && row < row0 + size && col >= col0 && col < col0 + size;
}

export function marshCells(effect: BoardEffect): Position[] {
    const { row0, col0, size } = marshWindow(effect);
    const cells: Position[] = [];
    for (let row = row0; row < row0 + size; row++) {
        for (let col = col0; col < col0 + size; col++) cells.push([row, col]);
    }
    return cells;
}

/** 场上所有水泽（含敌方视角，但水泽只有姜太公会铺） */
export function marshEffects(gameState: GameState): BoardEffect[] {
    return (gameState.boardEffects ?? []).filter(effect => effect.type === 'water-marsh');
}

/** 盖住这一格的水泽片数（只认这名角色的同阵营泽，覆盖范围与渲染同一份口径） */
export function coveringMarshes(gameState: GameState, hero: Hero): BoardEffect[] {
    if (!hero.position) return [];
    const [row, col] = hero.position;
    return marshEffects(gameState).filter(effect =>
        effect.owner === hero.owner && marshCovers(effect, row, col));
}

/** 这名角色站在水泽里能拿到的闪避率：按片数累加、封顶两层，闪避率跟铺泽那名姜太公的致知走 */
export function getMarshDodgeRate(gameState: GameState, hero: Hero): number {
    if (hero.state !== HeroState.ALIVE) return 0;
    const covering = coveringMarshes(gameState, hero);
    if (covering.length === 0) return 0;
    const layers = Math.min(MARSH_STACK_CAP, covering.length);
    let rate = 0;
    for (const effect of covering.slice(0, layers)) {
        const source = findHero(gameState, effect.sourceHeroId);
        rate += zhizhiValue(source, 2, MARSH_DODGE_RATE, MARSH_DODGE_RATE_TALENT);
    }
    return rate;
}

/** 铺一片水泽：每次都是独立一片，可重叠（重叠即叠加闪避），到期各自算 */
export function placeMarsh(
    gameState: GameState,
    caster: Hero,
    center: Position,
    radius: number = MARSH_RADIUS
): BoardEffect | null {
    if (!MovementSystem.inBounds(center)) return null;
    gameState.boardEffects ??= [];
    const effect: BoardEffect = {
        id: `water-marsh-${caster.id}-${Date.now()}-${marshSeq++}`,
        type: 'water-marsh',
        position: [center[0], center[1]],
        owner: caster.owner,
        sourceHeroId: caster.id,
        duration: MARSH_DURATION,
        radius,
    };
    gameState.boardEffects.push(effect);
    return effect;
}

/** 姜太公脚下那片水泽里随机取一格（重叠时随机选一片，再在那片里随机取格） */
export function randomMarshCell(gameState: GameState, caster: Hero): Position | null {
    const covering = coveringMarshes(gameState, caster);
    if (covering.length === 0) return null;
    const picked = covering[Math.floor(Math.random() * covering.length)];
    const cells = marshCells(picked);
    return cells.length > 0 ? [...cells[Math.floor(Math.random() * cells.length)]] as Position : null;
}

/** 技能二的可拖目标格：以姜太公为圆心的八条射线上各两格（横、竖、斜都算，共 16 格） */
export function jiangtaigongDragCells(from: Position): Position[] {
    const cells: Position[] = [];
    for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) continue;
            const cell: Position = [from[0] + dr, from[1] + dc];
            if (MovementSystem.inBounds(cell)) cells.push(cell);
        }
    }
    return cells;
}

/** 下钩可选格：自身 5×5 范围内的空格（钩子要沉在水底，不落在人脚下） */
export function jiangtaigongHookCells(gameState: GameState, caster: Hero): Position[] {
    if (!caster.position) return [];
    return MovementSystem.getBoxPositions(caster.position, 5)
        .filter(cell => !gameState.board[cell[0]][cell[1]] && !findHookAt(gameState, cell));
}

/** 鱼钩铺设（同格重复投放只刷新；超过三枚按投放顺序挤掉最旧的） */
export function placeHook(gameState: GameState, caster: Hero, cell: Position): BoardEffect {
    gameState.boardEffects ??= [];
    gameState.boardEffects = gameState.boardEffects.filter(effect =>
        !(effect.type === 'fish-hook' &&
            effect.sourceHeroId === caster.id &&
            effect.position[0] === cell[0] &&
            effect.position[1] === cell[1]));
    const owned = gameState.boardEffects.filter(effect =>
        effect.type === 'fish-hook' && effect.sourceHeroId === caster.id);
    while (owned.length >= HOOK_MAX) {
        const oldest = owned.shift();
        if (oldest) gameState.boardEffects = gameState.boardEffects.filter(effect => effect.id !== oldest.id);
    }
    const effect: BoardEffect = {
        id: `fish-hook-${caster.id}-${Date.now()}-${hookSeq++}`,
        type: 'fish-hook',
        position: [cell[0], cell[1]],
        owner: caster.owner,
        sourceHeroId: caster.id,
        duration: HOOK_DURATION,
    };
    gameState.boardEffects.push(effect);
    return effect;
}

export function findHookAt(gameState: GameState, cell: Position): BoardEffect | undefined {
    return (gameState.boardEffects ?? []).find(effect =>
        effect.type === 'fish-hook' &&
        effect.position[0] === cell[0] &&
        effect.position[1] === cell[1]);
}

/** 抛掷落点：场上任意空格（只读棋盘，方便高亮与点击判定共用一份口径） */
export function hookThrowLandings(state: Pick<GameState, 'board'>): Position[] {
    const cells: Position[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if (!state.board[row][col]) cells.push([row, col]);
        }
    }
    return cells;
}

/**
 * 敌人踩上鱼钩的当场结算：钩子消耗，把"这一枚钓上来的人丢到哪一格"交给姜太公那侧来点。
 * 水泽不在这里铺——下钩那一刻就已经以那一格为圆心铺好了（见 jiangtaigongSkill1）。
 *
 * 钩主此刻动弹不得（被冰冻/眩晕）时**整条不触发**：这一手没人能答，挂起会悬在盘上把对局卡死，
 * 所以宁可让钩子继续留在水底等他能动。阵亡同一口径。
 *
 * 挂起槽只有一个，被别的挂起占着时不抢占：钩子照样消耗，
 * 只是这一次不抛人——宁可少一次收益，也不能把别人的烈火燎原吞掉。
 */
export function triggerHookBite(gameState: GameState, mover: Hero, cell: Position): boolean {
    const hook = findHookAt(gameState, cell);
    if (!hook || mover.state !== HeroState.ALIVE) return false;
    // 愿者上钩：自己人从钩子上跨过去什么也不会发生
    if (mover.owner === hook.owner) return false;
    const caster = findHero(gameState, hook.sourceHeroId);
    // 钩主已经下场、或正被冻住/眩晕而答不了这一手：钩子原样留着，不咬
    if (!caster || caster.state !== HeroState.ALIVE || EffectManager.isStunned(caster)) return false;
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => effect.id !== hook.id);

    const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'effect',
        player: hook.owner,
        message: `${mover.name}踩上${caster.name}的鱼钩`,
        timestamp: Date.now(),
    });
    // 挂起槽被别人的动作占着：这一次只消耗钩子、不抛人
    if (gameState.pendingBoardAction) return true;
    gameState.pendingBoardAction = {
        type: 'jiangtaigong-hook',
        heroId: caster.id,
        hookTargetId: mover.id,
        hookPosition: [cell[0], cell[1]],
    };
    requestSkillFx({
        skillId: 'jiangtaigong_hook',
        owner: caster.owner,
        sourceHeroId: caster.id,
        fromPos: [...cell] as Position,
        targetPos: [...mover.position!] as Position,
        impactPositions: [[...mover.position!] as Position],
        logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
    }, gameState);
    return true;
}

/**
 * 落点定下：把钓上来的人丢过去，吃 10 点伤害。
 * 位移归属是姜太公那侧，所以帝兰/南风/游隼的羽化在这里照常记账。
 */
export function resolveHookThrow(
    gameState: GameState,
    caster: Hero,
    target: Hero,
    landing: Position
): number {
    if (!target.position || !MovementSystem.inBounds(landing)) return 0;
    const [fromRow, fromCol] = target.position;
    const [toRow, toCol] = landing;
    if (gameState.board[toRow][toCol]) return 0;

    const steps = MovementSystem.getManhattanDistance(target.position, landing);
    if (gameState.board[fromRow][fromCol] === target) gameState.board[fromRow][fromCol] = null;
    gameState.board[toRow][toCol] = target;
    target.position = [toRow, toCol];
    target.counters[HOOK_THROW_NO_UNDO] = 1;

    const previousLogIds = new Set(gameState.battleLog.map(log => log.id));
    const damage = DamageCalculator.calculate(caster, target, HOOK_THROW_DAMAGE, false, false, { canCrit: false });
    DamageCalculator.applyDamage(target, damage, caster, gameState);
    if (steps > 0) {
        DamageCalculator.applyDilanMovementDamage(target, steps, gameState, caster.owner);
    }
    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'damage',
        player: caster.owner,
        message: `${caster.name}甩钩把${target.name}抛到(${toRow + 1},${toCol + 1})，造成${damage.finalDamage}点伤害`,
        timestamp: Date.now(),
    });
    if (target.position) {
        requestSkillFx({
            skillId: 'jiangtaigong_throw',
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: [fromRow, fromCol] as Position,
            targetPos: [...target.position] as Position,
            impactPositions: [[...target.position] as Position],
            damagePositions: damage.finalDamage > 0 ? [[...target.position] as Position] : [],
            logIds: gameState.battleLog.filter(log => !previousLogIds.has(log.id)).map(log => log.id),
        }, gameState);
    }
    return damage.finalDamage;
}

/** 被鱼钩抛过的人这一回合不能再撤回移动 */
export function hookThrowLocked(hero: Hero): boolean {
    return (hero.counters[HOOK_THROW_NO_UNDO] ?? 0) > 0;
}

/** 他自己重新走了一步，抛掷锁就该让位给"这一步可以撤回" */
export function releaseHookThrowLock(hero: Hero): void {
    delete hero.counters[HOOK_THROW_NO_UNDO];
}

/** 当前这一刀的鲸落概率（起手值跟致知3 走，之后每次出手没落就往上加一档） */
export function whaleFallRate(caster: Hero): number {
    const base = zhizhiValue(caster, 3, WHALEFALL_BASE_RATE, WHALEFALL_BASE_RATE_TALENT);
    return Math.max(base, caster.counters[WHALEFALL_RATE_KEY] ?? base);
}

/** 概率显示给图鉴/状态角标用 */
export function whaleFallPercent(caster: Hero): number {
    return Math.round(whaleFallRate(caster) * 100);
}

/**
 * 「鲸落」：以随机一格为圆心 3×3，友方回 5、敌方伤 5。
 * 由被动与测试共用，返回值是这一落的命中统计。
 */
export function castWhaleFall(
    gameState: GameState,
    caster: Hero,
    center: Position
): { healed: number; damaged: number } {
    const cells = MovementSystem.getBoxPositions(center, 3);
    const previousLogIds = new Set(gameState.battleLog.map(log => log.id));
    let healed = 0;
    let damaged = 0;
    const impact: Position[] = [];
    for (const cell of cells) {
        const unit = gameState.board[cell[0]]?.[cell[1]];
        if (!unit || unit.state !== HeroState.ALIVE) continue;
        impact.push([...cell] as Position);
        if (unit.owner === caster.owner) {
            healed += DamageCalculator.applyHeal(unit, WHALEFALL_HEAL, gameState, caster);
        } else {
            const damage = DamageCalculator.calculate(caster, unit, WHALEFALL_DAMAGE, true, false, { canCrit: false });
            DamageCalculator.applyDamage(unit, damage, caster, gameState);
            damaged += damage.finalDamage;
        }
    }
    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'passive',
        player: caster.owner,
        message: `${caster.name}鲸落：${impact.length}格内友方回血${healed}、敌方受伤${damaged}`,
        timestamp: Date.now(),
    });
    requestSkillFx({
        skillId: 'jiangtaigong_whalefall',
        owner: caster.owner,
        sourceHeroId: caster.id,
        fromPos: [...(caster.position ?? center)] as Position,
        targetPos: [...center] as Position,
        impactPositions: impact,
        damagePositions: impact.filter(cell => {
            const unit = gameState.board[cell[0]]?.[cell[1]];
            return !!unit && unit.owner !== caster.owner;
        }),
        coveredPositions: cells,
        logIds: gameState.battleLog.filter(log => !previousLogIds.has(log.id)).map(log => log.id),
    }, gameState);
    return { healed, damaged };
}

/**
 * 被动「太公垂钩」：他每次使用技能（钓雪 / 渭水垂竿）之后掷一次概率，
 * 造成伤害的那一手（抛钩甩出去的一下）同样算一次出手。
 * 门槛是他本人得站在水泽里；没落就往上加一档（封顶必落），落下后回到起手值。
 * 离场不清零也不累加——概率是他手里攒着的"这一竿子"，站起来走开只是暂时不掷。
 */
export function rollWhaleFall(gameState: GameState, caster: Hero): boolean {
    if (!isJiangtaigong(caster) || !caster.position) return false;
    if (caster.counters[WHALEFALL_GUARD_KEY] === 1) return false;
    if (coveringMarshes(gameState, caster).length === 0) return false;

    const base = zhizhiValue(caster, 3, WHALEFALL_BASE_RATE, WHALEFALL_BASE_RATE_TALENT);
    const step = zhizhiValue(caster, 3, WHALEFALL_STEP_RATE, WHALEFALL_STEP_RATE_TALENT);
    const rate = whaleFallRate(caster);
    const center = Math.random() < rate ? randomMarshCell(gameState, caster) : null;
    if (!center) {
        caster.counters[WHALEFALL_RATE_KEY] = Math.min(1, rate + step);
        return false;
    }
    caster.counters[WHALEFALL_RATE_KEY] = base;
    caster.counters[WHALEFALL_GUARD_KEY] = 1;
    try {
        castWhaleFall(gameState, caster, center);
    } finally {
        delete caster.counters[WHALEFALL_GUARD_KEY];
    }
    return true;
}

/** 天威「太公逐泽」：场上所有水泽向外扩一圈、剩余持续各 +1 回合 */
export function expandMarshesForTianwei(gameState: GameState, caster: Hero): number {
    const marshes = marshEffects(gameState);
    if (marshes.length === 0) return 0;
    const logIdsBefore = new Set(gameState.battleLog.map(log => log.id));
    const covered: Position[] = [];
    for (const effect of marshes) {
        effect.radius = Math.min(MARSH_MAX_RADIUS, (effect.radius ?? MARSH_RADIUS) + 1);
        effect.duration += 1;
        covered.push(...marshCells(effect));
    }
    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'tianwei',
        player: caster.owner,
        message: `${caster.name}天威·太公逐泽：${marshes.length}片水泽各扩一圈并多留一回合`,
        timestamp: Date.now(),
    });
    if (caster.position) {
        requestSkillFx({
            skillId: 'jiangtaigong_tianwei',
            owner: caster.owner,
            sourceHeroId: caster.id,
            fromPos: [...caster.position] as Position,
            targetPos: [...caster.position] as Position,
            impactPositions: marshes.map(effect => [...effect.position] as Position),
            coveredPositions: covered,
            logIds: gameState.battleLog.filter(log => !logIdsBefore.has(log.id)).map(log => log.id),
        }, gameState);
    }
    return marshes.length;
}
