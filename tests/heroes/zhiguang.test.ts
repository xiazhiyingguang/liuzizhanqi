import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseComputerPendingBoardPosition, chooseComputerSkillPlan } from '../../src/core/computer-ai';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import {
    ZHIGUANG_BEAM_BASE_DAMAGE,
    ZHIGUANG_MARK_DAMAGE,
    ZHIGUANG_PRISM_DURATION,
    ZHIGUANG_TIANWEI_DAMAGE,
    getZhiguangBeamDamage,
    getZhiguangPrisms,
    getZhiguangTianweiLandings,
    placeZhiguangPrism,
    traceZhiguangBeam,
} from '../../src/data/extended-skills';
import { getSkill } from '../../src/data/skills';
import { getPendingActionCells, useGameStore } from '../../src/store/game-store';
import { GameState, Hero, HeroState, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 折光：把光棱钉在场上的"角度杀"。
 * 光棱只认她本人布下的；技能二的光束每扫过一枚棱就顺时针换轴 90°（一枚棱每次施法只折一次），
 * 整条光束另有一次触碰棋盘边缘的镜面反射（正对边缘撞墙时会原路折回，斜向撞边才真的拐弯）。
 * 击杀触发天威·万华镜，落点由玩家手选。
 */

/** 免掉防御减免，让"每处几点"是可断言的整数 */
function plainEnemy(hero: Hero): Hero {
    hero.defense = 0;
    return hero;
}

function prismCells(source: Pick<GameState, 'boardEffects'>, hero: Hero): string[] {
    return getZhiguangPrisms(hero, source).map(effect => effect.position.join(','));
}

function loadIntoStore(state: GameState) {
    useGameStore.setState({
        ...state,
        moveRange: [],
        skillRange: [],
        highlightedPositions: [],
        selectedHero: null,
        activeHero: null,
        selectedSkill: null,
        pendingBoardAction: undefined,
        skillFx: [],
        isOnlineMode: false,
        isAiMode: false,
        suppressOnlineBroadcast: false,
    });
}

/** 直接走技能对象的 execute：绕开 store 交互，专测几何与数值 */
function castByCode(caster: Hero, skillId: string, state: GameState, options: {
    directionCode?: number; targets?: Position[];
} = {}) {
    if (options.directionCode !== undefined) {
        caster.counters['__zhiguang_skill2_dir'] = options.directionCode;
    }
    const targets = (options.targets ?? [])
        .map(([row, col]) => state.board[row][col])
        .filter((hero): hero is Hero => !!hero);
    return getSkill(skillId)!.execute!(caster, targets, state);
}

beforeEach(() => {
    // 钉成常数：既免掉暴击把伤害打飘，也让被动的"随机撒棱"可复现
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
});
afterEach(() => {
    vi.restoreAllMocks();
    useGameStore.getState().resetGame();
});

describe('折光 · 光棱的归属与放置', () => {
    it('技能一命中后在敌人所在格钉出一枚棱，持续 3 回合', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        const victim = plainEnemy(addHero(state, 'moran', 'player2', [3, 2]));
        const before = victim.currentHp;

        const output = castByCode(zhiguang, 'zhiguang_skill1', state, { targets: [[3, 2]] });

        expect(output.success).toBe(true);
        expect(victim.currentHp).toBe(before - ZHIGUANG_MARK_DAMAGE);
        expect(prismCells(state, zhiguang)).toEqual(['3,2']);
        expect((state.boardEffects ?? [])[0].duration).toBe(ZHIGUANG_PRISM_DURATION);
    });

    it('把人打死，棱仍然落在那一格：打格子不打身份', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        const victim = plainEnemy(addHero(state, 'moran', 'player2', [3, 2]));
        victim.currentHp = 1;

        castByCode(zhiguang, 'zhiguang_skill1', state, { targets: [[3, 2]] });

        expect(victim.state).toBe(HeroState.DEAD);
        expect(prismCells(state, zhiguang), '击杀也要留下光棱').toEqual(['3,2']);
    });

    it('同一格再放只把持续回合刷回去，不会叠成两层', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        placeZhiguangPrism(zhiguang, state, [3, 2]);
        (state.boardEffects ?? [])[0].duration = 1;

        expect(placeZhiguangPrism(zhiguang, state, [3, 2])).toBe(false);
        expect(state.boardEffects).toHaveLength(1);
        expect((state.boardEffects ?? [])[0].duration).toBe(ZHIGUANG_PRISM_DURATION);
    });

    it('棱只认布下它的那位折光：镜像对局里两边的棱互不相干', () => {
        const state = makeGameState();
        const mine = addHero(state, 'zhiguang', 'player1', [3, 0]);
        const rival = addHero(state, 'zhiguang', 'player2', [0, 5]);
        placeZhiguangPrism(rival, state, [3, 2]);

        expect(prismCells(state, mine), '对手的棱不算我的折射点').toEqual([]);
        expect(traceZhiguangBeam(mine, state, 2).prismCount).toBe(0);
        expect(prismCells(state, rival)).toEqual(['3,2']);
    });

    it('折光阵亡：她布下的光棱全部碎散，对手的棱不陪葬', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        const killer = plainEnemy(addHero(state, 'moran', 'player2', [1, 0]));
        placeZhiguangPrism(zhiguang, state, [3, 2]);
        placeZhiguangPrism(zhiguang, state, [0, 5]);
        const rival = addHero(state, 'zhiguang', 'player2', [5, 5]);
        placeZhiguangPrism(rival, state, [4, 4]);

        const hit = DamageCalculator.calculate(killer, zhiguang, 99, false, true);
        DamageCalculator.applyDamage(zhiguang, hit, killer, state);

        expect(zhiguang.state).not.toBe(HeroState.ALIVE);
        expect(prismCells(state, zhiguang), '无主的棱不该留在场上').toEqual([]);
        expect(prismCells(state, rival), '镜像对局里另一位折光的棱不受影响').toEqual(['4,4']);
        expect((state.battleLog ?? []).some(entry => entry.message.includes('光棱随之碎散')),
            '碎散要在战报里说清楚').toBe(true);
    });

    it('棱随回合递减到 0 就消散，被动每轮再补一枚新的', () => {
        const state = makeGameState({ roundNumber: 1 });
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        placeZhiguangPrism(zhiguang, state, [1, 1]);

        GameEngine.startNewTurn(state);
        const afterFirstRound = getZhiguangPrisms(zhiguang, state);
        expect(afterFirstRound.map(effect => effect.duration)).toContain(ZHIGUANG_PRISM_DURATION - 1);
        expect(afterFirstRound.length, '被动每轮撒一枚').toBe(2);

        GameEngine.startNewTurn(state);
        GameEngine.startNewTurn(state);
        expect(prismCells(state, zhiguang), '第 1 轮钉下的棱活不过三轮').not.toContain('1,1');
    });
});

describe('折光 · 棱光千折的光路', () => {
    it('场上没有棱时先走直线到边缘，伤害就是基础值', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);

        const trace = traceZhiguangBeam(zhiguang, state, 2);   // 向东
        expect(trace.cells.slice(0, 5)).toEqual([[3, 1], [3, 2], [3, 3], [3, 4], [3, 5]]);
        expect(trace.prismCount).toBe(0);
        expect(getZhiguangBeamDamage(zhiguang, 0)).toBe(ZHIGUANG_BEAM_BASE_DAMAGE);
    });

    it('扫过一枚棱就顺时针换轴 90°：东向的光折成南向继续走', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        placeZhiguangPrism(zhiguang, state, [3, 2]);

        const trace = traceZhiguangBeam(zhiguang, state, 2);
        expect(trace.cells.slice(0, 4)).toEqual([[3, 1], [3, 2], [4, 2], [5, 2]]);
        expect(trace.prismCount).toBe(1);
        expect(getZhiguangBeamDamage(zhiguang, 1)).toBe(ZHIGUANG_BEAM_BASE_DAMAGE + 2);
    });

    it('两枚棱连着折两次：东→南→西，伤害按扫过的棱数累加', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        placeZhiguangPrism(zhiguang, state, [3, 2]);   // 东→南
        placeZhiguangPrism(zhiguang, state, [4, 2]);   // 南→西

        const trace = traceZhiguangBeam(zhiguang, state, 2);
        expect(trace.cells.slice(0, 5)).toEqual([[3, 1], [3,2], [4, 2], [4, 1], [4, 0]]);
        expect(trace.prismCount).toBe(2);
        expect(getZhiguangBeamDamage(zhiguang, 2)).toBe(ZHIGUANG_BEAM_BASE_DAMAGE + 4);
    });

    it('一枚棱每次施法只折一次：撞边折回来的光不会再被同一枚棱拐走', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        placeZhiguangPrism(zhiguang, state, [3, 2]);   // 东→南
        placeZhiguangPrism(zhiguang, state, [4, 2]);   // 南→西

        const trace = traceZhiguangBeam(zhiguang, state, 2);
        // 撞西墙折回向东后再次经过 [4,2]，那一格之后必须继续朝东走完，而不是再折一次
        expect(trace.cells.filter(([row, col]) => row === 4 && col === 2)).toHaveLength(2);
        expect(trace.cells.slice(5)).toEqual([[4, 1], [4, 2], [4, 3], [4, 4], [4, 5]]);
        expect(trace.prismCount, '重复经过的棱只计一次增伤').toBe(2);
    });

    it('边缘格上有棱：顺时针那一头是墙时折向逆时针，光不许死在墙里', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 2]);
        placeZhiguangPrism(zhiguang, state, [4, 5]);

        // 东南出发 → 撞下边界反弹成东北 → 走进 [4,5] 的棱。顺时针折向南就是墙，
        // 于是改折向西北，光继续走过 [3,4] 一路顶到上边界才散
        const trace = traceZhiguangBeam(zhiguang, state, 3);
        expect(trace.cells).toEqual([
            [4, 3], [5, 4], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1],
        ]);
        expect(trace.prismCount).toBe(1);
    });

    it('角落上的棱两面都是墙：这时才允许光停在棱格上', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 2]);
        placeZhiguangPrism(zhiguang, state, [5, 0]);

        // 东北出发 → 撞右上角反弹回西南 → 走进 [5,0] 这枚角落棱：
        // 顺时针指向左墙外、逆时针指向下墙外，两个方向都出不去，光只能在此收住
        const trace = traceZhiguangBeam(zhiguang, state, 1);
        expect(trace.cells[trace.cells.length - 1]).toEqual([5, 0]);
        expect(trace.prismCount, '角落棱仍然算被光扫过（增伤照计）').toBe(1);
    });

    it('斜向撞边才真拐弯：东北光撞上右边界后镜面反射成西北', () => {        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 3]);

        const trace = traceZhiguangBeam(zhiguang, state, 1);   // 东北
        expect(trace.cells).toEqual([[2, 4], [1, 5], [0, 4]]);
        expect(trace.prismCount).toBe(0);
    });

    it('触碰边缘的镜面反射整条光束只有一次：再撞边就散', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 3]);

        const trace = traceZhiguangBeam(zhiguang, state, 1);
        expect(trace.cells[trace.cells.length - 1], '反弹后顶到上边界即止').toEqual([0, 4]);
        expect(trace.cells).toHaveLength(3);
    });

    it('路径上每名敌人各吃一次同样的伤害，被扫两遍的人也只结算一次', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        const first = plainEnemy(addHero(state, 'moran', 'player2', [3, 1]));
        const second = plainEnemy(addHero(state, 'baize', 'player2', [3, 4]));
        placeZhiguangPrism(zhiguang, state, [3, 2]);   // 光在此处折向南方，[3,4] 就此躲过
        const before = { first: first.currentHp, second: second.currentHp };

        const output = castByCode(zhiguang, 'zhiguang_skill2', state, { directionCode: 2 });

        expect(output.success).toBe(true);
        expect(output.damageDealt, '只有一人被扫中，且只结算一次').toHaveLength(1);
        expect(first.currentHp, '扫过一枚棱 → 6+2=8 点').toBe(before.first - 8);
        expect(second.currentHp, '折走之后那一格不再被斩到').toBe(before.second);
    });
});

describe('折光 · 天威万华镜：玩家手选落点', () => {
    it('击杀触发：挂起落点选择，合法落点是全部空格加自己脚下那一格', () => {
        const { state, zhiguang, victim } = makeTianweiBoard();
        loadIntoStore(state);
        castSkill1ThroughStore(zhiguang, victim);

        expect(victim.state).toBe(HeroState.DEAD);
        const store = useGameStore.getState();
        expect(store.pendingBoardAction).toEqual({ type: 'zhiguang-tianwei', heroId: zhiguang.id });
        expect(store.currentPlayer, '落点没点之前这次行动不算结束').toBe('player1');
        expect(zhiguang.position, '她不会自动落位').toEqual([2, 2]);

        const landings = getZhiguangTianweiLandings(zhiguang, store as unknown as GameState);
        expect(new Set(getPendingActionCells(store).map(String))).toEqual(new Set(landings.map(String)));
        expect(landings).toContainEqual([0, 0]);
        expect(landings).toContainEqual([2, 2]);
        expect(landings, '站着别人的格子不能落').not.toContainEqual([4, 2]);
    });

    it('点合法落点：瞬移过去，5×5 内每名敌人各钉一枚棱并吃 4 点，收尾不留全盘高亮', () => {
        const { state, zhiguang, victim, nearA, nearB, far } = makeTianweiBoard();
        loadIntoStore(state);
        castSkill1ThroughStore(zhiguang, victim);
        const before = { nearA: nearA.currentHp, nearB: nearB.currentHp, far: far.currentHp };

        useGameStore.getState().resolvePendingBoardAction([0, 4]);

        const store = useGameStore.getState();
        expect(zhiguang.position, '她落到点选的那一格').toEqual([0, 4]);
        expect(store.board[2][2], '原来的格子空出来').toBeNull();
        expect(nearA.currentHp).toBe(before.nearA - ZHIGUANG_TIANWEI_DAMAGE);
        expect(nearB.currentHp).toBe(before.nearB - ZHIGUANG_TIANWEI_DAMAGE);
        expect(far.currentHp, '5×5 之外照不到').toBe(before.far);
        expect(prismCells(store, zhiguang).sort()).toEqual(['1,3', '1,4', '2,3']);
        expect(store.pendingBoardAction).toBeUndefined();
        expect(store.currentPlayer, '落完才轮到对手行动').toBe('player2');
        expect(store.skillRange, '天威收尾不能把整盘涂成可攻击红格').toHaveLength(0);
        expect(store.highlightedPositions).toHaveLength(0);
        expect(
            store.skillFx.some(event => event.profile.kind === 'light-summon'
                && event.fromPos.join(',') === '2,2' && event.targetPos.join(',') === '0,4'),
            '万华镜要在落点格派生一次光界特效'
        ).toBe(true);
    });

    it('点被人占住的格子：被拒且什么都不消耗，改点空格照样落得下去', () => {
        const { state, zhiguang, victim, nearA } = makeTianweiBoard();
        loadIntoStore(state);
        castSkill1ThroughStore(zhiguang, victim);
        const before = nearA.currentHp;

        useGameStore.getState().resolvePendingBoardAction([4, 2]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('zhiguang-tianwei');
        expect(zhiguang.position).toEqual([2, 2]);
        expect(nearA.currentHp).toBe(before);

        useGameStore.getState().resolvePendingBoardAction([0, 0]);
        expect(zhiguang.position).toEqual([0, 0]);
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();
    });

    it('兜底放行：她始终没点落点就结束行动时，自动挑照到人最多的一格，绝不卡死', () => {
        const { state, zhiguang, victim, nearA, nearB } = makeTianweiBoard();
        loadIntoStore(state);
        castSkill1ThroughStore(zhiguang, victim);

        useGameStore.getState().endHeroAction();

        const store = useGameStore.getState();
        expect(store.pendingBoardAction).toBeUndefined();
        expect(store.currentPlayer, '挂起不许漂到对手回合').toBe('player2');
        expect(nearA.currentHp + nearB.currentHp, '自动落点也要真的照到人')
            .toBeLessThan(nearA.maxHp + nearB.maxHp);
    });

    it('挂起时她被打死：作废这次天威并放行行动', () => {
        const { state, zhiguang } = makeTianweiBoard();
        loadIntoStore(state);
        useGameStore.getState().selectHeroForAction(zhiguang);
        zhiguang.hasActedThisTurn = true;
        useGameStore.setState({
            pendingBoardAction: { type: 'zhiguang-tianwei', heroId: zhiguang.id },
            selectedHero: zhiguang,
            activeHero: zhiguang,
        });
        zhiguang.currentHp = 0;
        zhiguang.state = HeroState.DEAD;
        state.board[2][2] = null;
        zhiguang.position = null;

        useGameStore.getState().resolvePendingBoardAction([0, 0]);

        const store = useGameStore.getState();
        expect(store.pendingBoardAction).toBeUndefined();
        expect(store.currentPlayer, '人已不在场上也要放行回合').toBe('player2');
        expect(store.board[0][0], '死人不会被瞬移').toBeNull();
    });

    it('电脑自己答天威：只从合法落点里挑', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const zhiguang = addHero(state, 'zhiguang', 'player2', [2, 2]);
        addHero(state, 'moran', 'player1', [1, 3]);
        addHero(state, 'baize', 'player1', [1, 4]);
        state.pendingBoardAction = { type: 'zhiguang-tianwei', heroId: zhiguang.id };

        const landing = chooseComputerPendingBoardPosition(state, zhiguang);
        expect(landing).not.toBeNull();
        expect(getZhiguangTianweiLandings(zhiguang, state).map(String)).toContain(String(landing));
    });
});

describe('折光 · 电脑会用她', () => {
    it('给得出八向光束的方向方案，也能点出 5×5 内的技能一', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player2', [3, 0]);
        const victim = plainEnemy(addHero(state, 'moran', 'player1', [3, 2]));
        placeZhiguangPrism(zhiguang, state, [3, 2]);

        const beam = chooseComputerSkillPlan(state, zhiguang, zhiguang.skill2Id);
        expect(beam, '光束方向方案该给得出来').not.toBeNull();
        expect(beam!.targetPositions).toHaveLength(1);

        const mark = chooseComputerSkillPlan(state, zhiguang, zhiguang.skill1Id);
        expect(mark, '五格内的单体也该被规划到').not.toBeNull();
        expect(mark!.targetPositions[0]).toEqual([3, 2]);
        expect(victim.state, '规划不该真的打出伤害').toBe(HeroState.ALIVE);
    });
});

/* ---------------- 盘面 ---------------- */

/** 天威盘面：她在 [2,2]，[2,3] 那个人头是她技能一打下来的；[0,4] 落点能照到 [1,3]/[1,4] 两人 */
function makeTianweiBoard(): {
    state: GameState;
    zhiguang: Hero;
    victim: Hero;
    nearA: Hero;
    nearB: Hero;
    far: Hero;
} {
    const state = makeGameState();
    const zhiguang = addHero(state, 'zhiguang', 'player1', [2, 2]);
    const victim = plainEnemy(addHero(state, 'moran', 'player2', [2, 3]));
    victim.currentHp = 1;
    const nearA = plainEnemy(addHero(state, 'baize', 'player2', [1, 3]));
    const nearB = plainEnemy(addHero(state, 'pipa', 'player2', [1, 4]));
    const far = plainEnemy(addHero(state, 'zhenxiao', 'player2', [4, 2]));
    // 她身边留一个还能行动的友军：她阵亡的那条用例里，player1 不至于被判定全队覆没而直接终局
    addHero(state, 'baize', 'player1', [5, 5]);
    return { state, zhiguang, victim, nearA, nearB, far };
}

function castSkill1ThroughStore(zhiguang: Hero, victim: Hero): void {
    const store = useGameStore.getState();
    store.selectHeroForAction(zhiguang);
    store.selectSkill('zhiguang_skill1');
    useGameStore.getState().executeSkill(victim.position!);
}
