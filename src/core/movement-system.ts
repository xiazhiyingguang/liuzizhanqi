import { Position, Hero, GameState, HeroState } from '../types/game';
import { getMirrorOwnerIdFromCloneId } from '../data/heroes';
import { isFreeWindLaneStep } from './wind-lane';
import { EffectManager } from './effect-manager';
import { DamageCalculator } from './damage-calculator';

/**
 * 移动范围计算选项。
 * ignoreBindingZone：跳过束缚格钳制。束缚格只限制"普通移动离开"，
 * 技能造成的位移（瞬移/跳跃/分身行动/撤回移动）由调用方显式放行。
 */
export interface MoveOptions {
    ignoreBindingZone?: boolean;
}

/**
 * 移动系统和路径寻找
 */
export class MovementSystem {
    /**
     * 罩住起点的敌方束缚区允许停留的格子集合；未被罩住时返回 null。
     * 多片区域同时罩住起点时取并集（例如两名震霄相邻落位）。
     */
    static getBindingZoneCells(hero: Hero, gameState: GameState): Set<string> | null {
        if (!hero.position) return null;
        const zones = (gameState.boardEffects ?? []).filter(
            effect => effect.type === 'binding-zone' && effect.owner !== hero.owner
        );
        if (zones.length === 0) return null;

        const [row, col] = hero.position;
        const cellKey = (position: Position) => this.posToKey(position);
        const lockedIds = new Set(
            zones
                .filter(effect => effect.position[0] === row && effect.position[1] === col)
                // 无 linkId 的历史数据退化成"单格自成一片"
                .map(effect => effect.linkId ?? `single:${cellKey(effect.position)}`)
        );
        if (lockedIds.size === 0) return null;

        return new Set(
            zones
                .filter(effect => lockedIds.has(effect.linkId ?? `single:${cellKey(effect.position)}`))
                .map(effect => cellKey(effect.position))
        );
    }

    /**
     * 获取可移动的位置
     * @param hero 英雄
     * @param gameState 游戏状态
     * @returns 可移动的位置数组
     */
    static getMovablePositions(
        hero: Hero,
        gameState: GameState,
        rangeOverride?: number,
        options?: MoveOptions
    ): Position[] {
        if (!hero.position) return [];

        const start = hero.position;
        const movablePositions: Position[] = [];
        const windModifier = rangeOverride === undefined
            ? hero.effects.reduce((sum, effect) => {
                if (effect.name === '顺风') return sum + (effect.stackCount ?? 1);
                if (effect.name === '逆风') return sum - (effect.stackCount ?? 1);
                return sum;
            }, 0)
            : 0;
        const moveRange = Math.max(0, (rangeOverride ?? hero.moveRange) + windModifier);

        // 风道内滑行不消耗移动力，边权不再统一为 1，因此改用 0-1 BFS 求最小移动力消耗
        const queue: [Position, number][] = [[start, 0]];
        const cost = new Map<string, number>([[this.posToKey(start), 0]]);
        const collected = new Set<string>();
        const zoneCells = options?.ignoreBindingZone
            ? null
            : this.getBindingZoneCells(hero, gameState);

        while (queue.length > 0) {
            const [[row, col], distance] = queue.shift()!;
            // 同一格可能以更小的消耗再次入队，跳过已过期的记录
            if ((cost.get(this.posToKey([row, col])) ?? Number.POSITIVE_INFINITY) !== distance) continue;

            // 四个方向（上下左右）
            const directions: [number, number][] = [
                [-1, 0], // 上
                [1, 0],  // 下
                [0, -1], // 左
                [0, 1]   // 右
            ];

            for (const [dr, dc] of directions) {
                const newPos: Position = [row + dr, col + dc];

                // 检查边界
                if (!this.inBounds(newPos)) continue;

                const gliding = isFreeWindLaneStep(gameState, [row, col], newPos, hero.owner);
                const newDistance = distance + (gliding ? 0 : 1);

                // 检查是否超出移动范围
                if (newDistance > moveRange) continue;

                const key = this.posToKey(newPos);
                // 束缚格：被罩住的单位普通移动不得离开该区域（也不能借道穿出）
                if (zoneCells && !zoneCells.has(key)) continue;
                if ((cost.get(key) ?? Number.POSITIVE_INFINITY) <= newDistance) continue;

                // 检查是否有单位占据（不能通过）
                const [newRow, newCol] = newPos;
                const occupant = gameState.board[newRow][newCol];
                if (occupant !== null) {
                    // 醉枕刀特权：可以穿过带醉意（>=1层）的友方格子，但不可停留
                    const canPassDrunkAlly =
                        hero.passiveId === 'zuizhendao_passive' &&
                        occupant.owner === hero.owner &&
                        occupant.state === HeroState.ALIVE &&
                        (occupant.counters['醉意'] ?? 0) >= 1;
                    if (!canPassDrunkAlly) continue;
                    cost.set(key, newDistance);
                    if (gliding) queue.unshift([newPos, newDistance]);
                    else queue.push([newPos, newDistance]);
                    continue;
                }

                // 敌方冰晶视为障碍物，不可进入（己方冰晶可通行）
                if (gameState.boardEffects?.some(effect =>
                    effect.type === 'ice-crystal' &&
                    effect.owner !== hero.owner &&
                    effect.position[0] === newRow && effect.position[1] === newCol
                )) continue;

                cost.set(key, newDistance);
                if (!collected.has(key)) {
                    collected.add(key);
                    movablePositions.push(newPos);
                }
                if (gliding) queue.unshift([newPos, newDistance]);
                else queue.push([newPos, newDistance]);
            }
        }

        return movablePositions;
    }

    /**
     * 计算从英雄当前位置到目标位置的 BFS 最短路径（不含起点）。
     * 醉枕刀可将带醉意（>=1层）的友方格视为可通过；普通单位只能走空位。
     * 无法到达时返回空数组。
     */
    static getMovePath(hero: Hero, to: Position, gameState: GameState): Position[] {
        if (!hero.position || !this.inBounds(to)) return [];
        const start = hero.position;
        const queue: Position[] = [start];
        const visited = new Set<string>([this.posToKey(start)]);
        const parent = new Map<string, Position>();
        const isDrunk = hero.passiveId === 'zuizhendao_passive';

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (current[0] === to[0] && current[1] === to[1]) {
                // 回溯路径
                const path: Position[] = [];
                let node: Position | undefined = to;
                while (node && (node[0] !== start[0] || node[1] !== start[1])) {
                    path.push(node);
                    node = parent.get(this.posToKey(node));
                }
                return path.reverse();
            }
            for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                const nr = current[0] + dr;
                const nc = current[1] + dc;
                if (!this.inBounds([nr, nc])) continue;
                const key = this.posToKey([nr, nc]);
                if (visited.has(key)) continue;
                const occupant = gameState.board[nr][nc];
                if (occupant !== null) {
                    const canPassDrunkAlly =
                        isDrunk &&
                        occupant.owner === hero.owner &&
                        occupant.state === HeroState.ALIVE &&
                        (occupant.counters['醉意'] ?? 0) >= 1;
                    if (!canPassDrunkAlly) continue;
                }
                visited.add(key);
                parent.set(key, current);
                queue.push([nr, nc]);
            }
        }
        return [];
    }

    /**
     * 计算曼哈顿距离
     */
    static getManhattanDistance(pos1: Position, pos2: Position): number {
        return Math.abs(pos1[0] - pos2[0]) + Math.abs(pos1[1] - pos2[1]);
    }

    /**
     * 检查两个位置是否在指定范围内
     */
    static isInRange(pos1: Position, pos2: Position, range: number): boolean {
        return this.getManhattanDistance(pos1, pos2) <= range;
    }

    /**
     * 获取十字范围内的位置（上下左右）
     */
    static getCrossPositions(center: Position): Position[] {
        const [row, col] = center;
        const positions: Position[] = [];
        const directions: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        for (const [dr, dc] of directions) {
            const pos: Position = [row + dr, col + dc];
            if (this.inBounds(pos)) {
                positions.push(pos);
            }
        }

        return positions;
    }

    /**
     * 获取范围内的所有位置（曼哈顿距离）
     */
    static getPositionsInRange(center: Position, range: number): Position[] {
        const positions: Position[] = [];
        const [centerRow, centerCol] = center;

        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                const pos: Position = [row, col];
                if (this.getManhattanDistance(center, pos) <= range &&
                    (row !== centerRow || col !== centerCol)) {
                    positions.push(pos);
                }
            }
        }

        return positions;
    }

    /**
     * 获取震霄技能1的攻击范围（面前横排3格）
     * @param start 起始位置
     * @param direction 方向 'up' | 'down' | 'left' | 'right'
     */
    static getZhenxiaoSkill1Positions(
        start: Position,
        direction: 'up' | 'down' | 'left' | 'right'
    ): Position[] {
        const positions: Position[] = [];
        const [row, col] = start;

        // 确定中心点位置（面前一格）
        let centerRow = row;
        let centerCol = col;

        switch (direction) {
            case 'up':
                centerRow = row - 1;
                break;
            case 'down':
                centerRow = row + 1;
                break;
            case 'left':
                centerCol = col - 1;
                break;
            case 'right':
                centerCol = col + 1;
                break;
        }

        // 检查中心点是否在界内
        if (!this.inBounds([centerRow, centerCol])) {
            // 即使中心点出界，侧面可能还在界内吗？通常逻辑是打向界外就无效，但这里可以宽松处理
            // 为保持简单，我们继续计算侧翼
        }

        // 根据方向确定横排的偏移量
        // 上下攻击时，横排是左右延伸 (col - 1, col, col + 1)
        // 左右攻击时，横排是上下延伸 (row - 1, row, row + 1)
        if (direction === 'up' || direction === 'down') {
            for (let c = centerCol - 1; c <= centerCol + 1; c++) {
                if (this.inBounds([centerRow, c])) {
                    positions.push([centerRow, c]);
                }
            }
        } else { // left or right
            for (let r = centerRow - 1; r <= centerRow + 1; r++) {
                if (this.inBounds([r, centerCol])) {
                    positions.push([r, centerCol]);
                }
            }
        }

        return positions;
    }

    /**
     * 获取某个方向上的所有位置（直线）
     * @param start 起始位置
     * @param direction 方向 'up' | 'down' | 'left' | 'right'
     * @param maxDistance 最大距离（可选）
     */
    static getLinePositions(
        start: Position,
        direction: 'up' | 'down' | 'left' | 'right',
        maxDistance?: number
    ): Position[] {
        const positions: Position[] = [];
        const [row, col] = start;

        const directionMap = {
            up: [-1, 0],
            down: [1, 0],
            left: [0, -1],
            right: [0, 1]
        };

        const [dr, dc] = directionMap[direction];
        let currentRow = row + dr;
        let currentCol = col + dc;
        let distance = 1;

        while (this.inBounds([currentRow, currentCol])) {
            if (maxDistance && distance > maxDistance) break;

            positions.push([currentRow, currentCol]);
            currentRow += dr;
            currentCol += dc;
            distance++;
        }

        return positions;
    }

    /**
     * 获取九宫格范围内的位置（3x3，以自己为中心）
     */
    static getAreaPositions(center: Position, size: number = 3): Position[] {
        const positions: Position[] = [];
        const [centerRow, centerCol] = center;
        const offset = Math.floor(size / 2);

        for (let row = centerRow - offset; row <= centerRow + offset; row++) {
            for (let col = centerCol - offset; col <= centerCol + offset; col++) {
                const pos: Position = [row, col];
                if (this.inBounds(pos) && (row !== centerRow || col !== centerCol)) {
                    positions.push(pos);
                }
            }
        }

        return positions;
    }

    /**
     * 获取以 center 为中心的 size×size 方盒内的全部格子（含中心格）
     * 与 getAreaPositions 的区别：不排除中心，用于「可以点风眼本身」的选择范围
     */
    static getBoxPositions(center: Position, size: number = 5): Position[] {
        const positions: Position[] = [];
        const offset = Math.floor(size / 2);

        for (let row = center[0] - offset; row <= center[0] + offset; row++) {
            for (let col = center[1] - offset; col <= center[1] + offset; col++) {
                const pos: Position = [row, col];
                if (this.inBounds(pos)) positions.push(pos);
            }
        }

        return positions;
    }

    /**
     * 寻找附近的空位置（用于复活等）
     */
    static findNearestEmptyPosition(
        target: Position,
        gameState: GameState
    ): Position | null {
        // 优先检查四周
        const nearby = this.getCrossPositions(target);
        for (const pos of nearby) {
            const [row, col] = pos;
            if (gameState.board[row][col] === null) {
                return pos;
            }
        }

        // 扩大搜索范围
        const area = this.getAreaPositions(target, 3);
        for (const pos of area) {
            const [row, col] = pos;
            if (gameState.board[row][col] === null) {
                return pos;
            }
        }

        // 如果还没找到，搜索整个棋盘
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                if (gameState.board[row][col] === null) {
                    return [row, col];
                }
            }
        }

        return null; // 棋盘满了
    }

    /**
     * 移动英雄
     */
    static moveHero(
        hero: Hero,
        to: Position,
        gameState: GameState,
        rangeOverride?: number,
        options?: MoveOptions
    ): boolean {
        if (!hero.position) return false;
        if (!this.inBounds(to)) return false;

        const from = hero.position;
        const movePath = this.getMovePath(hero, to, gameState);
        const [fromRow, fromCol] = from;
        const [toRow, toCol] = to;

        // 底层必须自行验证可达性，不能只依赖 UI 高亮范围。
        const reachable = this.getMovablePositions(hero, gameState, rangeOverride, options)
            .some(([row, col]) => row === toRow && col === toCol);
        if (!reachable) return false;

        // 检查目标位置是否为空
        if (gameState.board[toRow][toCol] !== null) {
            return false;
        }

        // 检查镜的对称移动机制
        let partner: Hero | null = null;
        let partnerTo: Position | null = null;
        let partnerFrom: Position | null = null;

        // 情况1：当前是镜本体
        if (hero.skill1Id === 'mirror_skill1') {
            // 查找场上的镜像
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 6; c++) {
                    const h = gameState.board[r][c];
                    if (h && h.counters?.['__isClone'] === 1 && getMirrorOwnerIdFromCloneId(h.id) === hero.id) {
                        partner = h;
                        break;
                    }
                }
                if (partner) break;
            }
        } 
        // 情况2：当前是镜像
        else if (hero.counters?.['__isClone'] === 1) {
            const ownerId = getMirrorOwnerIdFromCloneId(hero.id);
            if (ownerId) {
                // 查找本体
                for (let r = 0; r < 6; r++) {
                    for (let c = 0; c < 6; c++) {
                        const h = gameState.board[r][c];
                        if (h && h.id === ownerId) {
                            partner = h;
                            break;
                        }
                    }
                    if (partner) break;
                }
            }
        }

        // 如果有联动单位，检查联动位置是否合法
        if (partner && partner.position) {
            partnerFrom = [...partner.position];
            // 对称位置：(5-tr, 5-tc)
            const pToR = 5 - toRow;
            const pToC = 5 - toCol;
            partnerTo = [pToR, pToC];

            // 检查 partnerTo 是否越界（理论上不会，因为 to 在界内）
            if (!this.inBounds(partnerTo)) return false;

            // 检查 partnerTo 是否被占据
            // 注意：partnerTo 不能是被移动英雄的起始位置（除非交换，但这里是移动到空地）
            // 如果 partnerTo === from，说明两者交换位置？
            // 比如 (0,0) -> (5,5). Mirror at (0,0), Clone at (5,5).
            // Mirror moves to (5,5)? No, target must be empty.
            // If Mirror moves to (1,1). Clone moves to (4,4).
            // Check if (4,4) is empty.
            // Be careful: gameState.board[pToR][pToC] might be 'hero' (the one moving)?
            // No, 'hero' is at 'from'. 'to' is empty.
            // 'partner' is at 'pr, pc'.
            // We need 'partnerTo' to be empty OR 'partnerTo' === 'from' (swapping places)?
            // If Mirror moves to Clone's position?
            // User says "move to empty position".
            // So 'to' must be empty. 'partnerTo' must be empty.
            // But what if 'partnerTo' IS 'from'?
            // Example: Mirror (2,2), Clone (3,3).
            // Mirror moves to (3,3). Clone moves to (2,2).
            // This is a valid swap if symmetric.
            // But 'to' check failed at start if (3,3) is occupied by Clone.
            // So standard move cannot swap.
            // Thus, 'to' must be empty, and 'partnerTo' must be empty.
            
            // Special case: If partnerTo is the current hero's position?
            // No, because current hero is still at 'from'.
            // If partnerTo is occupied by anyone (except maybe the moving hero? No, hero is at 'from').
            // Wait, if partnerTo == from.
            // Mirror (2,2), Clone (3,3).
            // Mirror moves to (3,3). to=(3,3).
            // Check: board[3][3] is Clone != null. Returns false immediately.
            // So we don't need to handle swap here. It's blocked by basic check.
            
            // So we just need to check if board[pToR][pToC] is null.
            // BUT, board[pToR][pToC] CAN be the hero moving?
            // If Mirror moves to X, and Clone moves to Y.
            // If Y == from.
            // Mirror (0,0), Clone (5,5).
            // Mirror moves to (5,5). Blocked.
            
            const [ptr, ptc] = partnerTo;
            if (gameState.board[ptr][ptc] !== null && gameState.board[ptr][ptc] !== hero) {
                 // Check if it's the partner itself? (Moving to same spot? Impossible if to != from)
                 if (gameState.board[ptr][ptc] !== partner) {
                     return false; // Blocked by someone else
                 }
            }
             // Actually, if board[ptr][ptc] is partner, it means partner stays put?
             // No, partnerTo is where partner IS GOING.
             // partner is currently at [pr, pc].
             // If [ptr, ptc] is occupied by partner, it means partner moves to its own location?
             // Only if to == symmetric(from).
             // (2,2) -> (3,3).
             // Mirror at (2,2). Clone at (3,3).
             // to=(3,3). Blocked.
             
             // So generally, partnerTo must be null.
             if (gameState.board[ptr][ptc] !== null) {
                 return false;
             }
        }

        if (hero.name === '孤影') {
            const idx = fromRow * 6 + fromCol;
            const bit = Math.pow(2, idx);
            const current = hero.counters['guying_sword_shadow_mask'] || 0;
            const hasBit = Math.floor(current / bit) % 2 === 1;
            if (!hasBit) {
                hero.counters['guying_sword_shadow_mask'] = current + bit;
            }
        }

        // 执行移动
        gameState.board[fromRow][fromCol] = null;
        gameState.board[toRow][toCol] = hero;
        hero.position = to;

        // 移动联动单位
        if (partner && partnerTo && partner.position) {
            const [pr, pc] = partner.position;
            const [ptr, ptc] = partnerTo;
            
            gameState.board[pr][pc] = null;
            gameState.board[ptr][ptc] = partner;
            partner.position = partnerTo;
        }

        // 敌方进入回锋刃痕周围一格时获得连破标记。
        const bladeMarks = gameState.boardEffects?.filter(
            effect =>
                effect.type === 'blade-mark' &&
                effect.owner !== hero.owner &&
                this.getManhattanDistance(effect.position, to) <= 1
        ) ?? [];
        for (const mark of bladeMarks) {
            const existing = hero.effects.find(
                effect => effect.name === '连破' && effect.sourceHeroId === mark.sourceHeroId
            );
            if (existing) {
                existing.duration = 1;
            } else {
                hero.effects.push({
                    id: `effect-${Date.now()}-${Math.random()}`,
                    type: 'mark',
                    name: '连破',
                    duration: 1,
                    stackCount: 1,
                    sourceHeroId: mark.sourceHeroId,
                    description: '受到回锋攻击时获得锋鸣'
                });
            }
        }

        // 到达己方冰晶位置：冰晶是一次性拾取物，被到达即消耗消失；
        // 冰甲在英雄尚未拥有时才附加（已有冰甲时冰晶同样被拾取）
        const crystal = gameState.boardEffects?.find(effect =>
            effect.type === 'ice-crystal' &&
            effect.owner === hero.owner &&
            effect.position[0] === toRow && effect.position[1] === toCol
        );
        if (crystal) {
            gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect => effect.id !== crystal.id);
            const gained = EffectManager.addIceArmor(hero, crystal.sourceHeroId);
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: `log-${Date.now()}-${Math.random()}`,
                    type: 'passive' as const,
                    player: hero.owner,
                    message: gained
                        ? `${hero.name}到达冰晶，获得冰甲（冰晶消失）`
                        : `${hero.name}到达冰晶并将其拾取（冰晶消失）`,
                    timestamp: Date.now()
                });
            }
        }

        DamageCalculator.applyDilanMovementDamage(hero, movePath.length, gameState);
        if (partner && partnerFrom && partnerTo && partner.state === HeroState.ALIVE) {
            DamageCalculator.applyDilanMovementDamage(
                partner,
                this.getManhattanDistance(partnerFrom, partnerTo),
                gameState
            );
        }

        return true;
    }

    /**
     * 检查位置是否在棋盘内
     */
    private static inBounds(pos: Position): boolean {
        const [row, col] = pos;
        return row >= 0 && row < 6 && col >= 0 && col < 6;
    }

    /**
     * 获取相对于中心点的方向
     */
    static getDirection(from: Position, to: Position): 'up' | 'down' | 'left' | 'right' | null {
        const [fromRow, fromCol] = from;
        const [toRow, toCol] = to;

        if (fromCol === toCol) {
            if (toRow < fromRow) return 'up';
            if (toRow > fromRow) return 'down';
        }
        if (fromRow === toRow) {
            if (toCol < fromCol) return 'left';
            if (toCol > fromCol) return 'right';
        }

        return null;
    }

    /**
     * 位置转字符串key
     */
    private static posToKey(pos: Position): string {
        return `${pos[0]},${pos[1]}`;
    }
}
