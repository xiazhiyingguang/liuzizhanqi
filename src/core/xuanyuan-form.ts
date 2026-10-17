/**
 * 轩辕神君（金行）的移动形状与「昭神」形态。
 *
 * 这个角色的移动不走棋盘常规的"曼哈顿距离逐格走"，而是两种象棋式跳法：
 * - 普通态：象走田——沿对角线跳两格（策划裁定**不塞象眼、不过河**，只要落点在盘内且可站即可）；
 * - 昭神态：G 型——以自身为中心的 3×3 里描个 G：起笔必在正四方向之一（上/右/下/左），
 *   沿外圈逆时针绕 7 格（起笔旁的斜格是 G 的开口），描到途中哪格就停在哪格。
 *   昭神态技能一由玩家先点起笔格、再点落点，两段式定住这一笔的旋向。
 * 因此这里返回的不是"格子集合"而是「落点 + 沿途经过的格」：技能一的伤害要按沿途格结算，
 * 光给落点会把"路径上的目标"这半句实现掉。
 *
 * 昭神（顶替天威）：对当前在场的每一个敌方单位都造成过一次伤害后进入，永久。
 * 命中账用挂在敌人身上的「金痕」标记来记，而不是一个计数器——因为补员会不断换人，
 * 计数器无法回答"现在在场的这个人有没有被他打过"。
 */
import { BOARD_SIZE, type GameState, type Hero, type Position } from '../types/game';
import { HeroState } from '../types/game';

export const XUANYUAN_SKILL1_ID = 'xuanyuan_skill1';
/** 顶替天威的形态标记，同时是玩家向计数器（状态卡上会直接显示"昭神"） */
export const ZHAOSHEN_COUNTER = '昭神';
/** 挂在敌方身上的"已被轩辕命中过"凭证；属于标记，按项目口径不吃净化 */
export const ZHAOSHEN_MARK = '金痕';
/** 昭神态技能一「御剑连破」一次行动内至多连跳的次数（策划："最多移动三次"） */
export const XUANYUAN_LEAP_MAX = 3;
/** 本次行动内的连跳计数；配 __actionSerial 守卫，中断在链上的残留不会泄漏到下一次行动 */
const LEAP_USED_COUNTER = '__xuanyuan_leap_used';
const LEAP_SERIAL_COUNTER = '__xuanyuan_leap_serial';

/** 当前这次行动已经跳了几次（跨行动自动归零） */
export function getLeapsUsed(hero: Hero): number {
    return (hero.counters?.[LEAP_SERIAL_COUNTER] ?? -1) === (hero.counters?.['__actionSerial'] ?? 0)
        ? (hero.counters?.[LEAP_USED_COUNTER] ?? 0)
        : 0;
}

export function setLeapsUsed(hero: Hero, used: number): void {
    hero.counters[LEAP_USED_COUNTER] = used;
    hero.counters[LEAP_SERIAL_COUNTER] = hero.counters['__actionSerial'] ?? 0;
}

export function clearLeapsUsed(hero: Hero): void {
    delete hero.counters[LEAP_USED_COUNTER];
    delete hero.counters[LEAP_SERIAL_COUNTER];
}

/** 一次可执行的移动：落点 + 沿途经过的格（含落点本身，不含出发格） */
export interface MovePlan {
    to: Position;
    path: Position[];
}

export function isXuanyuan(hero: Hero): boolean {
    return hero.skill1Id === XUANYUAN_SKILL1_ID;
}

export function isZhaoShen(hero: Hero): boolean {
    return (hero.counters?.[ZHAOSHEN_COUNTER] ?? 0) >= 1;
}

export function inBounds(position: Position): boolean {
    return position[0] >= 0 && position[0] < BOARD_SIZE && position[1] >= 0 && position[1] < BOARD_SIZE;
}

/** 象走田的四个跳跃方向 */
const XIANG_OFFSETS: Position[] = [[-2, -2], [-2, 2], [2, -2], [2, 2]];

/** 田字路径＝起跳点正中间那一格（象棋的"象眼"，这里不堵路，只用来结算路径伤害） */
export function getXiangMovePlans(from: Position): MovePlan[] {
    return XIANG_OFFSETS
        .map(([dr, dc]) => [from[0] + dr, from[1] + dc] as Position)
        .filter(inBounds)
        .map(to => ({ to, path: [[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as Position, to] }));
}

/**
 * G 不是固定一笔：它可以以周身止四方向（上右下左）之一为起笔，绕 3×3 外圈逆时针描一笔。
 * 手写 G 就是这个笔顺：从正方向起笔 → 逆时针绕外圈 → 90° 顺时针方向的止四方向收笔，
 * 起笔与收笔之间斜对的那格就是 G 的「开口」，那一格不在笔画上。
 * 下标 0-3 即 counters 里的方向码：上、右、下、左。
 */
export const G_START_OFFSETS: Position[] = [[-1, 0], [0, 1], [1, 0], [0, -1]];
/** 外圈逆时针环序（从正上方起）：起笔方向在环上的下标：上=0、右=6、下=4、左=2 */
const G_RING_CCW: Position[] = [
    [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1],
];
const G_RING_START_INDEX = [0, 6, 4, 2];
/** 起笔方向的暂存计数器：第一步点定起笔、第二步点落点（随快照同步，联机天然一致） */
export const G_START_COUNTER = '__xuanyuan_leap_start';

/** 把一次点击换算成起笔方向码；不是周身正四方向邻格则返回 null */
export function gStartCodeFromCell(from: Position, cell: Position): number | null {
    for (let dir = 0; dir < 4; dir++) {
        if (cell[0] === from[0] + G_START_OFFSETS[dir][0] && cell[1] === from[1] + G_START_OFFSETS[dir][1]) return dir;
    }
    return null;
}

/** 某一起笔方向的起笔格；起笔格出界则这一笔不成立（返回 null） */
export function getGStartCell(from: Position, dir: number): Position | null {
    const offset = G_START_OFFSETS[dir];
    if (!offset) return null;
    const cell: Position = [from[0] + offset[0], from[1] + offset[1]];
    return inBounds(cell) ? cell : null;
}

export function getStagedGStart(hero: Hero): number | null {
    const code = hero.counters?.[G_START_COUNTER];
    return typeof code === 'number' && code >= 0 && code < 4 ? code : null;
}

export function setStagedGStart(hero: Hero, dir: number): void {
    hero.counters[G_START_COUNTER] = dir;
}

export function clearStagedGStart(hero: Hero): void {
    delete hero.counters[G_START_COUNTER];
}

/**
 * G 型路线：指定起笔方向时，沿外圈逆时针描 7 格（收笔在起笔 90° 顺时针一侧，
 * 起笔旁的斜格是 G 的开口不算笔画），描到的每一格都是可停落点，路径＝起笔到停点的笔画前缀。
 * 不指定方向时取「自动笔顺」：每个邻格用四种起笔里最短的那段弧——普通移动只需要可达与一段示意路线。
 */
export function getGMovePlans(from: Position, dir?: number): MovePlan[] {
    if (dir !== undefined) {
        const base = G_RING_START_INDEX[dir];
        if (base === undefined || !getGStartCell(from, dir)) return [];
        const plans: MovePlan[] = [];
        const walked: Position[] = [];
        for (let step = 0; step < 7; step++) {
            const [dr, dc] = G_RING_CCW[(base + step) % 8];
            const cell: Position = [from[0] + dr, from[1] + dc];
            if (!inBounds(cell)) continue;
            walked.push(cell);
            plans.push({ to: cell, path: [...walked] });
        }
        return plans;
    }
    const shortest = new Map<string, MovePlan>();
    for (let rotation = 0; rotation < 4; rotation++) {
        for (const plan of getGMovePlans(from, rotation)) {
            const key = plan.to.join(',');
            const kept = shortest.get(key);
            if (!kept || plan.path.length < kept.path.length) shortest.set(key, plan);
        }
    }
    return [...shortest.values()];
}

/** 落点能不能站人：棋盘上只允许停在空格（沿用现有走格口径，站人/出界都不可达） */
function isLandingOpen(gameState: GameState, position: Position): boolean {
    const [row, col] = position;
    return !gameState.board[row]?.[col];
}

/** 该英雄此刻可执行的移动方案（已按形态选好走法、按盘面过滤过落点） */
export function getXuanyuanMovePlans(hero: Hero, gameState: GameState): MovePlan[] {
    if (!hero.position) return [];
    const plans = isZhaoShen(hero) ? getGMovePlans(hero.position) : getXiangMovePlans(hero.position);
    return plans.filter(plan => isLandingOpen(gameState, plan.to));
}

/** 当前在场的敌方单位（含分身与召唤物：他们同样是"在场的人"） */
export function getZhaoShenTargets(hero: Hero, gameState: GameState): Hero[] {
    const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
    return enemies.filter(enemy => enemy.state === HeroState.ALIVE && enemy.position);
}

/** 给被轩辕命中过的敌人盖章；重复命中不叠层，只把永久凭证补上 */
export function markZhaoShenHit(target: Hero, attacker: Hero): void {
    if (target.effects.some(effect => effect.name === ZHAOSHEN_MARK && effect.sourceHeroId === attacker.id)) return;
    target.effects.push({
        id: `effect-${ZHAOSHEN_MARK}-${target.id}-${attacker.id}`,
        type: 'mark',
        name: ZHAOSHEN_MARK,
        duration: -1,
        sourceHeroId: attacker.id,
        description: '已被轩辕神君命中，计入昭神条件',
    });
}

/** 昭神进度：已盖章的在场敌人数 / 在场敌人总数 */
export function getZhaoShenProgress(hero: Hero, gameState: GameState): { hit: number; total: number } {
    const targets = getZhaoShenTargets(hero, gameState);
    const hit = targets.filter(target =>
        target.effects.some(effect => effect.name === ZHAOSHEN_MARK && effect.sourceHeroId === hero.id)
    ).length;
    return { hit, total: targets.length };
}

/**
 * 命中后尝试进入昭神：在场者全部被盖过章才成，成则永久、不再回落。
 * 返回 true 表示这一次真正变身（战报与特效要按这个来播）。
 */
export function tryEnterZhaoShen(hero: Hero, gameState: GameState): boolean {
    if (isZhaoShen(hero)) return false;
    const { hit, total } = getZhaoShenProgress(hero, gameState);
    if (total === 0 || hit < total) return false;
    hero.counters = { ...hero.counters, [ZHAOSHEN_COUNTER]: 1 };
    return true;
}
