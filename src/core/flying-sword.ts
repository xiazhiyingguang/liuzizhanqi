/**
 * 轩辕神君（金行）的「飞剑」体系。
 *
 * 飞剑是落在棋盘格上的锚点，同时承担三件事：
 * 1. 技能命中的痕迹——每命中一个目标，就在那个目标所在的格子留下一把剑；
 * 2. 昭神态技能一的续跳锚点——首跳不要求踩剑，第二、三跳须落在自己的剑上并收走；
 * 3. 技能二的资源——回收/召唤的每一把剑折成一层 10% 免伤。
 *
 * 口径（策划定稿 2026-10 更新）：同屏上限常规 6 把、昭神态 10 把，每把持续 3 回合；
 * 只有轩辕自己回收或当作跳跃终点才会消失；昭神态附身飞剑在下一回合开始时射出，
 * 射出后不会消失，而是落在宿主四周四个主方向格上。
 * 敌方踩上去不受影响也拆不掉——这是"我的场地"，与游隼风刃、帝兰羽化同一类。
 * 免伤走引擎既有的按名字聚合规则（`DamageCalculator` 里凡 type:'buff' 且名字含「免伤」都计入减伤），
 * 所以不碰伤害管线；按用户裁定**不设叠加上限**。
 */
import { BOARD_SIZE, HeroState, type BoardEffect, type GameState, type Hero, type Player, type Position } from '../types/game';
import { EffectManager } from './effect-manager';
import { DamageCalculator } from './damage-calculator';
import { nextBattleLogId } from './battle-log-id';
import { requestBladeScene, type BladeStroke } from './blade-choreography';
import { getLeapsUsed, getXiangStepMovePlans, isZhaoShen, XUANYUAN_LEAP_MAX } from './xuanyuan-form';

export const FLYING_SWORD_DURATION = 3;
/** 常规形态同屏至多 6 把：铺满后最老的一把先散，避免棋盘被剑糊死 */
export const FLYING_SWORD_LIMIT = 6;
/** 昭神态的神剑容量更大：同屏至多 10 把 */
export const FLYING_SWORD_LIMIT_ZHAOSHEN = 10;
/** 飞剑容量随形态：未觉醒 6 把，昭神后 10 把 */
export function getFlyingSwordLimit(hero: Hero): number {
    return isZhaoShen(hero) ? FLYING_SWORD_LIMIT_ZHAOSHEN : FLYING_SWORD_LIMIT;
}
/** 每回收一把剑＝一层 10% 免伤，可叠、无上限（策划裁定） */
export const SWORD_MITIGATION_PER_STACK = 0.1;
export const SWORD_MITIGATION_EFFECT = '御剑免伤';
export const SWORD_MITIGATION_DURATION = 3;
/** 附在友方身上、等下一回合开始时射出的剑数（昭神态技能二的中间态） */
export const ATTACHED_SWORD_COUNTER = '御剑';

/** 剑 id 自增序号：同一毫秒内留下多把剑时保证 id 唯一 */
let flyingSwordSeq = 0;

const sameCell = (a: Position, b: Position): boolean => a[0] === b[0] && a[1] === b[1];

export function getFlyingSwords(gameState: GameState, sourceHeroId?: string): BoardEffect[] {
    const swords = (gameState.boardEffects ?? []).filter(effect => effect.type === 'flying-sword');
    return sourceHeroId ? swords.filter(sword => sword.sourceHeroId === sourceHeroId) : swords;
}

export function findFlyingSwordAt(gameState: GameState, position: Position, sourceHeroId?: string): BoardEffect | undefined {
    return getFlyingSwords(gameState, sourceHeroId).find(sword => sameCell(sword.position, position));
}

export function countFlyingSwords(gameState: GameState, sourceHeroId: string): number {
    return getFlyingSwords(gameState, sourceHeroId).length;
}

/**
 * 在指定格留下一把飞剑。
 * 同格已有他的剑时只刷新持续、不叠加（一格一刃，玩家才读得清）；
 * 超出当前形态上限（常规 6 / 昭神 10）则把最早铺下的那把请走，保持“越新的剑越有用”。
 */
export function placeFlyingSword(gameState: GameState, caster: Hero, position: Position): void {
    if (position[0] < 0 || position[0] >= BOARD_SIZE || position[1] < 0 || position[1] >= BOARD_SIZE) return;

    gameState.boardEffects ??= [];
    const existing = findFlyingSwordAt(gameState, position, caster.id);
    if (existing) {
        existing.duration = FLYING_SWORD_DURATION;
        return;
    }

    gameState.boardEffects.push({
        id: `flying-sword-${caster.id}-${Date.now()}-${flyingSwordSeq++}`,
        type: 'flying-sword',
        position: [position[0], position[1]],
        owner: caster.owner,
        sourceHeroId: caster.id,
        duration: FLYING_SWORD_DURATION,
    });

    const swords = getFlyingSwords(gameState, caster.id);
    for (let index = 0; index < swords.length - getFlyingSwordLimit(caster); index++) {
        removeFlyingSword(gameState, swords[index].id);
    }
}

export function removeFlyingSword(gameState: GameState, swordId: string): void {
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => effect.id !== swordId);
}

/** 被动「剑随气走」的四个方向：上、下、左、右（顺序即 Math.random 的抽取顺序，测试按此钉方向） */
const DRIFT_DIRECTIONS: Position[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * 被动「剑随气走」：轩辕神君每完成一次主动位移，属于他的飞剑各随机挪一格。
 * - 出界的方向不参与抽取（贴边的剑只会往盘内走）；
 * - 两把剑抽到同一格时，后处理的那把原地不动，维持"一格一刃"；
 * - 移动前的坐标记进 prevPosition，供「撤回移动」原样放回去。
 * 返回真正挪过的剑数（0 表示场上没剑，或全都被挤住）。
 */
export function driftFlyingSwords(gameState: GameState, caster: Hero, visual?: { after: number; existingIds: Set<string> }): number {
    const swords = getFlyingSwords(gameState, caster.id);
    if (swords.length === 0) return 0;
    // 撤回只针对这一次位移；本次撞停的剑不能带着上一手的旧坐标。
    for (const sword of swords) delete sword.prevPosition;
    const taken = new Set<string>();
    const moves: Array<{ sword: BoardEffect; to: Position }> = [];
    for (const sword of swords) {
        const [row, col] = sword.position;
        // 先按四个方向均匀抽，再看落点：抽到出界或已被别的剑占住，这一把就原地不动
        const options = DRIFT_DIRECTIONS
            .map(([dr, dc]) => [row + dr, col + dc] as Position)
            .filter(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE);
        if (options.length === 0) {
            taken.add(`${row},${col}`);
            continue;
        }
        const to = options[Math.floor(Math.random() * options.length)];
        if (taken.has(`${to[0]},${to[1]}`)) {
            taken.add(`${row},${col}`);
            continue;
        }
        taken.add(`${to[0]},${to[1]}`);
        moves.push({ sword, to });
    }
    // 后面的剑可能因撞停留在原格，而早先的方案正要进这个格。
    // 逐次撤销被原地剑挡住的方案，避免出现同格双剑；互相让出的合法交换仍可执行。
    let blocked = true;
    while (blocked) {
        blocked = false;
        const moving = new Set(moves.map(move => move.sword));
        for (let index = moves.length - 1; index >= 0; index--) {
            if (swords.some(sword => !moving.has(sword) && sameCell(sword.position, moves[index].to))) {
                moves.splice(index, 1);
                blocked = true;
            }
        }
    }
    for (const { sword, to } of moves) {
        sword.prevPosition = [sword.position[0], sword.position[1]];
        sword.position = to;
    }
    const visualPaths: BladeStroke[] = moves.map(({ sword, to }) => ({
        from: [...sword.prevPosition!], to: [...to], swordId: sword.id,
        start: (visual?.after ?? 0) + 60, arrive: (visual?.after ?? 0) + 380,
        reveal: visual && !visual.existingIds.has(sword.id) ? visual.after : 0,
    }));
    // 新落剑若被其他剑挡住，仍须等跃击接触时才显形，但绝不把它记成一次真实移动。
    if (visual) for (const sword of swords) {
        if (visual.existingIds.has(sword.id) || moves.some(move => move.sword === sword)) continue;
        visualPaths.push({ from: [...sword.position], to: [...sword.position], swordId: sword.id,
            reveal: visual.after, start: visual.after, arrive: visual.after });
    }
    requestBladeScene(caster, gameState, 'drift', visualPaths, `${caster.name}剑随气走，飞剑循气移位`);
    return moves.length;
}

/** 撤回移动：把这一步漂移过的剑放回原处（没有漂移记录的剑不动） */
export function restoreDriftedSwords(gameState: GameState, caster: Hero): void {
    const paths: BladeStroke[] = [];
    for (const sword of getFlyingSwords(gameState, caster.id)) {
        if (!sword.prevPosition) continue;
        paths.push({ from: [...sword.position], to: [...sword.prevPosition], swordId: sword.id, start: 0, arrive: 280 });
        sword.position = [sword.prevPosition[0], sword.prevPosition[1]];
        delete sword.prevPosition;
    }
    requestBladeScene(caster, gameState, 'drift', paths, `${caster.name}撤回移动，飞剑回到原位`);
}

/** 技能二普通版的作用域：轩辕周身四个斜方向（对角相邻一格）上的剑 */
export function getDiagonalSwords(gameState: GameState, hero: Hero): BoardEffect[] {
    if (!hero.position) return [];
    const [row, col] = hero.position;
    const corners: Position[] = [[row - 1, col - 1], [row - 1, col + 1], [row + 1, col - 1], [row + 1, col + 1]];
    return corners
        .map(cell => findFlyingSwordAt(gameState, cell, hero.id))
        .filter((sword): sword is BoardEffect => Boolean(sword));
}

/** 把若干层免伤并到一个人身上：已有「御剑免伤」就加层并刷新回合，绝不新开第二条同名效果 */
export function addSwordMitigation(hero: Hero, stacks: number, perStack: number = SWORD_MITIGATION_PER_STACK): number {
    if (stacks <= 0) return 0;
    const existing = hero.effects.find(effect => effect.name === SWORD_MITIGATION_EFFECT);
    const value = (existing?.value ?? 0) + stacks * perStack;
    if (existing) {
        existing.value = value;
        existing.duration = SWORD_MITIGATION_DURATION;
        existing.stackCount = (existing.stackCount ?? 1) + stacks;
    } else {
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: SWORD_MITIGATION_EFFECT,
            duration: SWORD_MITIGATION_DURATION,
            value,
            stackCount: stacks,
            sourceHeroId: hero.id,
            description: `御剑护身：受到的伤害降低 ${Math.round(value * 100)}%`,
        });
    }
    return value;
}

/** 曼哈顿距离；出界或无位置按不可达处理 */
function cellDistance(a: Position, b: Position): number {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

/**
 * 昭神态技能二：每把剑自己找主人——附着到离它最近的那个友方身上（轩辕本人也算）。
 * 并列时按"先上后下、先左后右"的稳定顺序取，保证两端结算与回放一致。
 */
export function findNearestAllyForSword(gameState: GameState, sword: BoardEffect): Hero | null {
    const allies = (sword.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes)
        .filter(hero => hero.state === HeroState.ALIVE && hero.position)
        .map(hero => ({ hero, distance: cellDistance(sword.position, hero.position as Position) }))
        .sort((left, right) => left.distance - right.distance ||
            (left.hero.position as Position)[0] - (right.hero.position as Position)[0] ||
            (left.hero.position as Position)[1] - (right.hero.position as Position)[1]);
    return allies.length > 0 ? allies[0].hero : null;
}

/** 剑附着到友方身上：记在宿主的「御剑」计数里，等下一回合开始时射出 */
export function attachSwordToAlly(ally: Hero, stacks: number): void {
    if (stacks <= 0) return;
    ally.counters ??= {};
    ally.counters[ATTACHED_SWORD_COUNTER] = (ally.counters[ATTACHED_SWORD_COUNTER] ?? 0) + stacks;
}

/** 昭神态是否还有合法跃击落点：空盘可首跳，续跳需踩剑，最多三跳。 */
export function hasXuanyuanLeapTarget(hero: Hero, gameState: GameState): boolean {
    return getXuanyuanLeapCells(hero, gameState).length > 0;
}

/**
 * 「御剑连破」高亮对角一格或两格的空格，首跳无需飞剑，后续仅亮自己的飞剑落点。
 */
export function getXuanyuanLeapCells(hero: Hero, gameState: GameState): Position[] {
    if (!hero.position) return [];
    if (getLeapsUsed(hero) >= XUANYUAN_LEAP_MAX) return [];
    const chaining = getLeapsUsed(hero) > 0;
    return getXiangStepMovePlans(hero.position)
        .map(plan => plan.to)
        .filter(cell =>
            !gameState.board[cell[0]]?.[cell[1]] &&
            (!chaining || findFlyingSwordAt(gameState, cell, hero.id) !== undefined)
        );
}

/** 是否还有附着在友方身上、等下一回合开始时射出的飞剑；按阵营过滤，双轩辕时各管各家 */
export function hasAttachedSwords(gameState: GameState, owner?: Player): boolean {
    return [...gameState.player1Heroes, ...gameState.player2Heroes]
        .some(hero => (owner === undefined || hero.owner === owner) && (hero.counters?.[ATTACHED_SWORD_COUNTER] ?? 0) > 0);
}

/** 每把附着飞剑射出时对每个主方向造成的伤害（策划：每把飞剑对目标造成6点伤害） */
export const ATTACHED_SWORD_SHOT_DAMAGE = 6;

/**
 * 昭神态技能二的尾音：「下一回合开始时」把附着在友方身上的飞剑沿宿主四周四个主方向射出 1 格。
 * 触发点挂在 GameEngine 的回合开始效果里，只结算 actor 同阵营的宿主（双轩辕时各射各的）。
 * 同一方向的伤害按把累加（每把 6 点、常规结算）；剑射出后护盾随剑收回，
 * 但剑本身不会消失——它们落在四个主方向的格上，重新成为棋盘飞剑（受当前形态上限约束）。
 * 结算方永远是轩辕本人（金痕/昭神进度照记），伤害日志直接进 battleLog。
 */
export function fireAttachedSwords(actor: Hero, gameState: GameState): void {
    const hosts = [...gameState.player1Heroes, ...gameState.player2Heroes]
        .filter(hero => hero.owner === actor.owner && hero.state === HeroState.ALIVE && hero.position && (hero.counters?.[ATTACHED_SWORD_COUNTER] ?? 0) > 0);
    for (const host of hosts) {
        const paths: BladeStroke[] = [];
        const count = host.counters[ATTACHED_SWORD_COUNTER];
        delete host.counters[ATTACHED_SWORD_COUNTER];
        // 剑已出鞘，护盾随剑而回
        host.effects = host.effects.filter(effect => effect.name !== SWORD_MITIGATION_EFFECT);
        const [row, col] = host.position as Position;
        let hitCount = 0;
        let totalDamage = 0;
        let landed = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
            // 剑飞出一格后落回棋盘：无论那一格有没有人，剑都留得下（同格有剑则刷新持续）
            placeFlyingSword(gameState, actor, [r, c]);
            const path: BladeStroke = { from: [...host.position!], to: [r, c], start: 100, arrive: 380,
                swordId: findFlyingSwordAt(gameState, [r, c], actor.id)?.id, count };
            paths.push(path);
            landed++;
            const victim = gameState.board[r]?.[c];
            if (!victim || victim.state !== HeroState.ALIVE || victim.owner === host.owner) continue;
            const damage = DamageCalculator.calculate(actor, victim, ATTACHED_SWORD_SHOT_DAMAGE * count, false, false, {
                canCrit: false,
            });
            const before = new Set(gameState.battleLog.map(log => log.id));
            DamageCalculator.applyDamage(victim, damage, actor, gameState, true);
            path.logIds = gameState.battleLog.filter(log => !before.has(log.id) && log.type === 'damage' &&
                log.details?.sourceHeroId === actor.id && log.details?.targetHeroId === victim.id && !log.details?.skillFxRequest).map(log => log.id);
            if (damage.finalDamage > 0) {
                hitCount++;
                totalDamage += damage.finalDamage;
            }
        }
        gameState.battleLog.push({
            id: nextBattleLogId(),
            type: 'passive',
            player: actor.owner,
            message: `${host.name}身上的${count}把飞剑沿四个主方向射出${hitCount > 0 ? `，命中${hitCount}名敌人共${totalDamage}点伤害` : '，范围内没有敌人'}，${landed}把飞剑落回棋盘`,
            timestamp: Date.now(),
        });
        requestBladeScene(actor, gameState, 'volley', paths, `${host.name}附剑出鞘并重新落地`);
    }
}
