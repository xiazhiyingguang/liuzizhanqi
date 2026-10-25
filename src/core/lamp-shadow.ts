import { nextBattleLogId } from './battle-log-id';
import { DamageCalculator } from './damage-calculator';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import { recordBattleHealing } from './battle-statistics';
import { zhizhiValue } from './hero-zhizhi';
import { BOARD_SIZE, HeroState, type BoardEffect, type GameState, type Hero, type Position, type SkillTargetType } from '../types/game';

/**
 * 夕月辞「明灯 / 灯影 / 身后留灯」的收口。
 *
 * 灯是她点在空格里的一支烛火，是棋盘上唯一实打实的物件；影子不是——
 * 灯影一律由"灯 + 此刻的站位"当场推导，人走影走、灯灭影散，所以不进 boardEffects，
 * 撤销移动、补员、联机快照也就不必为它另记一份账。
 * 谁在哪儿有影子、谁能踩影子、踩了照给本体多少伤害，都只在本模块算一次口径。
 */

/** 明灯持续两回合（致知三抬到三回合） */
export const LAMP_DURATION = 2;
export const LAMP_DURATION_TALENT = 3;
/** 点灯的落点距离与灯下免伤、留灯治疗的半径：都按切比雪夫两格（与"周围一圈"同一套九宫口径） */
export const LAMP_PLACE_RANGE = 2;
export const LAMP_AURA_RANGE = 2;
/** 被动「灯下安身」：自己站在自己的明灯两格内，受到的伤害减少 30% */
export const LAMP_MITIGATION = 0.3;
/** 奥义「身后留灯」：每回合末为留灯两格内的友方恢复 5 点生命 */
export const WAKE_LAMP_HEAL = 5;
/** 技能一周圈伤害（致知二抬到 10） */
export const XIYUECI_RING_DAMAGE = 8;
export const XIYUECI_RING_DAMAGE_TALENT = 10;
/** 技能一逐人掷的击飞概率 */
export const XIYUECI_KNOCKUP_RATE = 0.5;

let lampSeq = 0;

/**
 * 灯影推导只需要"棋盘 + 单位名单"这一份切片：
 * 引擎传整块 GameState，渲染层传自己从 store 里解出来的四个字段，同一函数两边都能用。
 */
export type LampView = Pick<GameState, 'board' | 'boardEffects' | 'player1Heroes' | 'player2Heroes'>;

/** 切比雪夫距离：九宫格里"几格远"，斜着走也算一步 */
export function chebyshev(a: Position, b: Position): number {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

function allHeroes(gameState: LampView): Hero[] {
    return [...gameState.player1Heroes, ...gameState.player2Heroes];
}

/** 真正站在盘上的活人：影子的锚点必须是他脚下那一格，光看 state 会算上刚被移走的人 */
function livingOnBoard(gameState: LampView): Hero[] {
    return allHeroes(gameState).filter(hero =>
        hero.state === HeroState.ALIVE && !!hero.position
        && gameState.board[hero.position[0]]?.[hero.position[1]] === hero);
}

/** 这名夕月辞的灯亮几回合（致知三 2 → 3） */
export function lampDuration(caster: Hero): number {
    return zhizhiValue(caster, 3, LAMP_DURATION, LAMP_DURATION_TALENT);
}

/**
 * 点灯可选格：自身两格内（5×5，含对角）里既没站人、也没立过灯的格子。
 * 灯不进 board，所以通用的"空格"口径看不出那一格已经亮着一盏——高亮、canUseSkill
 * 与电脑枚举都必须走这一份，否则会把非法落点亮给玩家，点下去只吃到一句失败。
 */
export function lampPlaceCells(gameState: LampView, caster: Hero): Position[] {
    if (!caster.position) return [];
    return MovementSystem.getBoxPositions(caster.position, LAMP_PLACE_RANGE * 2 + 1)
        .filter(cell => !gameState.board[cell[0]][cell[1]] && !findLampAt(gameState, cell));
}

/**
 * 踩中灯影的一击，本体只吃这一刀的半数。
 * 标记由"按格索敌"当场挂在这个人身上，整次施法期间有效：多段招式每段都算"打在影子上"，
 * 所以不在 calculate 里一次消耗，而由 SkillSystem 在这次施法收尾统一摘掉。
 */
export const SHADOW_TRANSFER_KEY = '__lamp_shadow_transfer';
export const SHADOW_DAMAGE_RATE = 0.5;

/** 场上所有点出来的明灯（不含阵亡留下的那一盏） */
export function litLamps(gameState: LampView): BoardEffect[] {
    return (gameState.boardEffects ?? []).filter(effect => effect.type === 'lit-lamp');
}

/** 这一格上是否已经立着灯（点灯与渲染都用这份口径） */
export function findLampAt(gameState: LampView, cell: Position): BoardEffect | undefined {
    return (gameState.boardEffects ?? []).find(effect =>
        (effect.type === 'lit-lamp' || effect.type === 'wake-lamp')
        && effect.position[0] === cell[0] && effect.position[1] === cell[1]);
}

/** 落一盏灯：同格重灯只刷新持续时间 */
export function placeLamp(
    gameState: GameState,
    caster: Hero,
    cell: Position,
    type: 'lit-lamp' | 'wake-lamp' = 'lit-lamp',
    duration: number = lampDuration(caster)
): BoardEffect | null {
    if (!MovementSystem.inBounds(cell)) return null;
    gameState.boardEffects ??= [];
    gameState.boardEffects = gameState.boardEffects.filter(effect =>
        !(effect.type === type && effect.position[0] === cell[0] && effect.position[1] === cell[1]));
    const effect: BoardEffect = {
        id: `${type}-${caster.id}-${Date.now()}-${lampSeq++}`,
        type,
        position: [cell[0], cell[1]],
        owner: caster.owner,
        sourceHeroId: caster.id,
        duration,
    };
    gameState.boardEffects.push(effect);
    return effect;
}

/**
 * 灯影几何的唯一口径：给出灯格与本人格，返回"背离灯再往前一格"的影格；
 * 本人不在灯圈里、或影子被拉到盘外，都算没有影子。
 */
export function shadowCellOf(lampPosition: Position, bodyPosition: Position): Position | null {
    const dr = bodyPosition[0] - lampPosition[0];
    const dc = bodyPosition[1] - lampPosition[1];
    if (Math.abs(dr) > 1 || Math.abs(dc) > 1 || (dr === 0 && dc === 0)) return null;
    const cell: Position = [bodyPosition[0] + dr, bodyPosition[1] + dc];
    return MovementSystem.inBounds(cell) ? cell : null;
}

/**
 * 一名敌人在某盏灯下的灯影落点：从灯指向本人、再往前一格；出界就照不出影子。
 * 灯只照敌方——自己人与她自己都不落影，所以这一盏灯不给对面开近路。
 */
export function shadowCellFor(lamp: BoardEffect, body: Hero): Position | null {
    if (!body.position || body.owner === lamp.owner) return null;
    return shadowCellOf(lamp.position, body.position);
}

/** 场上此刻的全部灯影（当场推导，不写进状态）：只算敌方站着的人 */
export function lampShadows(gameState: LampView): Array<{ cell: Position; body: Hero; lamp: BoardEffect }> {
    const shadows: Array<{ cell: Position; body: Hero; lamp: BoardEffect }> = [];
    for (const lamp of litLamps(gameState)) {
        for (const body of livingOnBoard(gameState)) {
            const cell = shadowCellFor(lamp, body);
            if (cell) shadows.push({ cell, body, lamp });
        }
    }
    return shadows;
}

/** 某一格上压着哪些角色的灯影 */
export function shadowBodiesOnCell(gameState: LampView, cell: Position): Hero[] {
    return lampShadows(gameState)
        .filter(shadow => shadow.cell[0] === cell[0] && shadow.cell[1] === cell[1])
        .map(shadow => shadow.body);
}

/** 某盏灯此刻照出的影子：放灯时的战报播报与界面提示都用这一份 */
export function shadowsCastBy(gameState: LampView, lamp: BoardEffect): Array<{ body: Hero; cell: Position }> {
    return lampShadows(gameState)
        .filter(shadow => shadow.lamp.id === lamp.id)
        .map(shadow => ({ body: shadow.body, cell: shadow.cell }));
}

/**
 * 踩到灯影＝本体进入这一击的目标名单。
 * 只有明确"打敌人"的技能认影子：治疗、护盾那类指友方的技能借影子白得一格射程，
 * 会把灯的代价算错，所以 targetType 不是 enemy 时一律不放大。
 */
export function shadowTargetsFor(
    gameState: LampView,
    caster: Hero,
    positions: Position[],
    targetType: SkillTargetType
): Hero[] {
    if (targetType !== 'enemy') return [];
    const shadows = lampShadows(gameState);
    if (shadows.length === 0) return [];
    const out: Hero[] = [];
    for (const shadow of shadows) {
        if (!positions.some(([row, col]) => row === shadow.cell[0] && col === shadow.cell[1])) continue;
        const body = shadow.body;
        if (body.owner === caster.owner || body.state !== HeroState.ALIVE) continue;
        if (!out.includes(body)) out.push(body);
    }
    return out;
}

/** 摘掉标记：一次施法收尾调用，没被打到的候选人不该把折半带到下一手 */
export function clearShadowTransfers(gameState: GameState): void {
    for (const hero of allHeroes(gameState)) {
        if (hero.counters?.[SHADOW_TRANSFER_KEY] !== undefined) delete hero.counters[SHADOW_TRANSFER_KEY];
    }
}

/**
 * 按格索敌的统一口径：这些格上**站着的敌人** ＋ **影子落在这些格上的敌人**。
 * 凡是"我的作用面就是这几格"的判定都该走这里——单体走引擎名单已经认影子，
 * 逐格扫盘的群攻若各自读 board 就会漏掉，同一盏灯两套规律玩家读不出来。
 * 只认敌方口径；纯靠影子进名单的那位当场挂上"只吃半刀"的标记。
 */
export function enemiesOnCells(gameState: GameState, caster: Hero, cells: Position[]): Hero[] {
    const out: Hero[] = [];
    for (const cell of cells) {
        const [row, col] = cell;
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
        const hero = gameState.board[row]?.[col];
        if (!hero || hero.state !== HeroState.ALIVE || hero.owner === caster.owner) continue;
        // 一格一份，不按人合并：原来逐格扫盘的招式就是这么数的（同一人踩两格要吃两下），
        // 在这儿顺手去重会把那些按次数记账的招式改窄
        out.push(hero);
    }
    for (const body of shadowTargetsFor(gameState, caster, cells, 'enemy')) {
        if (out.includes(body)) continue;      // 本体就在面上：直接命中，不折半
        body.counters[SHADOW_TRANSFER_KEY] = 1;
        out.push(body);
    }
    return out;
}

/** 被动「灯下安身」：她站在自己任一盏灯两格内时的免伤率（复活回来的她也认旧账） */
export function lampMitigationFor(gameState: LampView, hero: Hero): number {
    if (hero.passiveId !== 'xiyueci_passive') return 0;
    if (hero.state !== HeroState.ALIVE || !hero.position) return 0;
    const at: Position = hero.position;
    const sheltered = (gameState.boardEffects ?? []).some(effect =>
        (effect.type === 'lit-lamp' || effect.type === 'wake-lamp')
        && effect.sourceHeroId === hero.id
        && chebyshev(effect.position, at) <= LAMP_AURA_RANGE);
    return sheltered ? LAMP_MITIGATION : 0;
}

/**
 * 技能一的击飞：与纸鸢共用同一条判定——只挑"本回合还没行动过"的人，
 * 已经动过的人再挑起来没有意义；已带任一眩晕也不重复挂控制。
 */
export function knockUpTarget(target: Hero, caster: Hero, gameState: GameState): boolean {
    if (target.state !== HeroState.ALIVE || target.hasActedThisTurn) return false;
    if (target.effects.some(effect => effect.type === 'stun' && effect.duration > 0)) return false;
    EffectManager.addEffect(target, {
        type: 'stun',
        name: '击飞',
        duration: 1,
        sourceHeroId: caster.id,
        description: '被夕月辞的月光掀翻，本回合无法行动',
    });
    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'effect',
        player: caster.owner,
        message: `${caster.name}击飞了${target.name}，他本回合无法行动`,
        timestamp: Date.now(),
    });
    return true;
}

/**
 * 夕月辞阵亡：她点的灯先灭掉（不留无主之灯继续照影子），
 * 再在她倒下的那一格留下一盏明灯，两回合内每回合末替两格内的友方照回生命。
 */
export function leaveWakeLamp(gameState: GameState, hero: Hero): void {
    gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect =>
        !(effect.type === 'lit-lamp' && effect.sourceHeroId === hero.id));
    if (!hero.position) return;
    const cell: Position = [...hero.position] as Position;
    const lamp = placeLamp(gameState, hero, cell, 'wake-lamp', lampDuration(hero));
    if (!lamp) return;
    gameState.battleLog.push({
        id: nextBattleLogId(),
        type: 'tianwei',
        player: hero.owner,
        message: `${hero.name}身后留灯于(${cell[0] + 1},${cell[1] + 1})：亮${lamp.duration}回合，每回合末为两格内友方恢复${WAKE_LAMP_HEAL}点生命`,
        timestamp: Date.now(),
    });
}

/** 留灯的回合末结算：灯不问主人活着没有，到点就照两格内的友方回血 */
export function healFromWakeLamps(gameState: GameState): void {
    for (const lamp of (gameState.boardEffects ?? []).filter(effect => effect.type === 'wake-lamp')) {
        const keeper = allHeroes(gameState).find(hero => hero.id === lamp.sourceHeroId);
        const lit = livingOnBoard(gameState).filter(hero =>
            hero.owner === lamp.owner && chebyshev(hero.position as Position, lamp.position) <= LAMP_AURA_RANGE);
        for (const ally of lit) {
            const healed = DamageCalculator.applyHeal(ally, WAKE_LAMP_HEAL, gameState, keeper);
            if (healed <= 0) continue;
            if (keeper) recordBattleHealing(gameState, keeper, healed);
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'heal',
                player: lamp.owner,
                message: `留灯为${ally.name}照回${healed}点生命（当前${ally.currentHp}/${ally.maxHp}）`,
                timestamp: Date.now(),
            });
        }
    }
}
