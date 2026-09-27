import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { chooseComputerPendingBoardPosition } from '../../src/core/computer-ai';
import {
    castLiaoyuanHundredSlash,
    castLiehuoBurn,
    getYunyingTianweiLandings,
} from '../../src/data/extended-skills';
import { addXiangrui, getXiangruiStacks } from '../../src/data/extended-heroes';
import { createOnlineStateSnapshot, getPendingActionCells, useGameStore } from '../../src/store/game-store';
import { applyServerGameState } from '../../src/services/online-state';
import { GameState, Hero, HeroState, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 天威「燎原百斩」：击杀触发后挂起玩家手点落点（同行/同列/同对角线的空格），
 * 点哪就斩到哪——先按这条直线逐格斩4点（不含起点、含落点），再在落点炸开3×3火圈各4点，
 * 最后人才落到那一格；天威命中一律不叠祥瑞。
 * 高亮集合与点击判定共用 getPendingActionCells 这一份口径。
 */

/** 免掉防御减免与暴击，让"每处4点"是可断言的整数 */
function plainEnemy(hero: Hero): Hero {
    hero.defense = 0;
    return hero;
}

/** 直接走一次伤害结算打死目标，用来驱动"击杀触发天威"的分发链 */
function lethalHit(attacker: Hero, target: Hero, state: GameState): void {
    const damage = DamageCalculator.calculate(attacker, target, 20, false);
    DamageCalculator.applyDamage(target, damage, attacker, state);
}

function tianweiLogs(state: GameState): string[] {
    return (state.battleLog ?? [])
        .filter(entry => entry.type === 'tianwei')
        .map(entry => entry.message);
}

function battleMessages(state: GameState): string[] {
    return (state.battleLog ?? []).map(entry => entry.message);
}

function loadIntoStore(state: GameState) {
    useGameStore.setState({
        ...state,
        moveRange: [],
        skillRange: [],
        highlightedPositions: [],
        selectedHero: null,
        activeHero: null,
        wukongSkill2State: undefined,
        libaiChainState: undefined,
        pendingBoardAction: undefined,
        isOnlineMode: false,
        localPlayerNumber: undefined,
        suppressOnlineBroadcast: false,
    });
}

/**
 * 手点场景的盘面：云缨 [2,2]，[2,3] 那个人头是她技能一打死的（触发天威），
 * [5,2] 是一记斩击能扫到人最多的落点（路径 [3,2]/[4,2] + 落点火圈 [4,1]/[4,2]/[5,3]），
 * [4,4] 站着友方（同对角线也不能落），[1,4] 与她不共线。
 */
function makeHandClickBoard(): { state: GameState; yunying: Hero; victim: Hero; onPath: Hero; overlap: Hero; inBlastA: Hero; inBlastB: Hero; ally: Hero } {
    const state = makeGameState();
    const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
    const victim = plainEnemy(addHero(state, 'moran', 'player2', [2, 3]));
    victim.currentHp = 1;
    const onPath = plainEnemy(addHero(state, 'zhenxiao', 'player2', [3, 2]));
    const overlap = plainEnemy(addHero(state, 'moran', 'player2', [4, 2]));
    const inBlastA = plainEnemy(addHero(state, 'baize', 'player2', [4, 1]));
    const inBlastB = plainEnemy(addHero(state, 'baize', 'player2', [5, 3]));
    const ally = addHero(state, 'zhenxiao', 'player1', [4, 4]);
    return { state, yunying, victim, onPath, overlap, inBlastA, inBlastB, ally };
}

function castSkill1AtVictim(yunying: Hero, target: Position): void {
    const store = useGameStore.getState();
    store.selectHeroForAction(yunying);
    store.selectSkill('yunying_skill1');
    useGameStore.getState().executeSkill(target);
}

describe('云缨天威 · 燎原百斩：机制本体', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('注册为天威，落点枚举只认同行/同列/同对角线的空格', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        addHero(state, 'moran', 'player2', [3, 3]);   // 占掉对角线上的一格

        expect(yunying.tianweiId).toBe('yunying_tianwei');
        const landings = getYunyingTianweiLandings(yunying, state);
        expect(landings).toEqual(expect.arrayContaining([[0, 5], [5, 0], [2, 2], [5, 5]]));
        expect(landings).not.toContainEqual([0, 0]);           // 自己脚下不算落点
        expect(landings).not.toContainEqual([3, 3]);           // 有人占着就不能选
        expect(landings.some(([r, c]) => r !== 0 && c !== 0 && Math.abs(r - c) !== 0)).toBe(false);
    });

    it('同列落点：路径上的敌人各受4点，落点3×3内的敌人各受4点，她随后落到那一格', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        const onPath = plainEnemy(addHero(state, 'moran', 'player2', [1, 0]));
        const inBlastA = plainEnemy(addHero(state, 'baize', 'player2', [2, 1]));
        const inBlastB = plainEnemy(addHero(state, 'zhenxiao', 'player2', [3, 1]));
        const inBlastC = plainEnemy(addHero(state, 'moran', 'player2', [4, 0]));
        const inBlastD = plainEnemy(addHero(state, 'baize', 'player2', [4, 1]));
        const elsewhere = plainEnemy(addHero(state, 'zhenxiao', 'player2', [0, 3]));

        const output = castLiaoyuanHundredSlash(yunying, state, [3, 0]);

        expect(output.success).toBe(true);
        expect(onPath.currentHp, '直线路径上逐格斩4点').toBe(onPath.maxHp - 4);
        for (const blasted of [inBlastA, inBlastB, inBlastC, inBlastD]) {
            expect(blasted.currentHp, '落点3×3内各受4点').toBe(blasted.maxHp - 4);
        }
        expect(elsewhere.currentHp, '既不在路径也不在火圈的人不受影响').toBe(elsewhere.maxHp);
        expect(output.damageDealt).toEqual([4, 4, 4, 4, 4]);
        expect(yunying.position).toEqual([3, 0]);
        expect(state.board[3][0]).toBe(yunying);
        expect(state.board[0][0]).toBeNull();
        expect(tianweiLogs(state).some(message => message.includes('燎原百斩'))).toBe(true);
    });

    it('同对角线落点：行为与同列一致', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        const onPath = plainEnemy(addHero(state, 'moran', 'player2', [1, 1]));
        const inBlastA = plainEnemy(addHero(state, 'baize', 'player2', [4, 4]));
        const inBlastB = plainEnemy(addHero(state, 'zhenxiao', 'player2', [3, 4]));
        const offLine = plainEnemy(addHero(state, 'moran', 'player2', [0, 4]));

        const output = castLiaoyuanHundredSlash(yunying, state, [3, 3]);

        expect(output.success).toBe(true);
        expect(onPath.currentHp).toBe(onPath.maxHp - 4);
        expect(inBlastA.currentHp).toBe(inBlastA.maxHp - 4);
        expect(inBlastB.currentHp).toBe(inBlastB.maxHp - 4);
        expect(offLine.currentHp).toBe(offLine.maxHp);
        expect(yunying.position).toEqual([3, 3]);
        expect(state.board[3][3]).toBe(yunying);
    });

    it('落点不与她共线时被拒绝：不位移也不斩伤人', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        const bystander = plainEnemy(addHero(state, 'moran', 'player2', [2, 3]));

        const output = castLiaoyuanHundredSlash(yunying, state, [2, 3] as Position);

        expect(output.success).toBe(false);
        expect(yunying.position, '拒绝落点不该产生移动').toEqual([0, 0]);
        expect(state.board[0][0]).toBe(yunying);
        expect(state.board[2][3]).toBe(bystander);
        expect(bystander.currentHp).toBe(bystander.maxHp);
        expect(tianweiLogs(state)).toEqual([]);
    });

    it('落点被占据或被越界时被拒绝', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        const ally = addHero(state, 'baize', 'player1', [3, 3]);
        const enemy = plainEnemy(addHero(state, 'moran', 'player2', [1, 1]));

        expect(castLiaoyuanHundredSlash(yunying, state, [3, 3]).success).toBe(false);
        expect(yunying.position).toEqual([0, 0]);
        expect(ally.currentHp).toBe(ally.maxHp);
        expect(enemy.currentHp).toBe(enemy.maxHp);

        // 越界格同样不是落点
        expect(castLiaoyuanHundredSlash(yunying, state, [6, 6]).success).toBe(false);
        expect(yunying.position).toEqual([0, 0]);
    });

    it('天威的命中不再叠祥瑞，也不会引燃烈火燎原', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        const onPath = plainEnemy(addHero(state, 'moran', 'player2', [1, 0]));
        const alreadyStacked = plainEnemy(addHero(state, 'baize', 'player2', [2, 1]));
        // 差一层就满：天威若叠祥瑞就会在这里引燃燎原
        addXiangrui(alreadyStacked, yunying, 2);

        const output = castLiaoyuanHundredSlash(yunying, state, [3, 0]);

        expect(output.success).toBe(true);
        expect(getXiangruiStacks(onPath)).toBe(0);
        expect(getXiangruiStacks(alreadyStacked)).toBe(2);
        expect(state.pendingBoardAction).toBeUndefined();
        expect(yunying.counters['__liehuo_resolving']).toBeUndefined();
    });

    it('没有击杀就不触发天威：不挂起、不位移、不追加伤害', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const survivor = plainEnemy(addHero(state, 'moran', 'player2', [2, 3]));
        const bait = plainEnemy(addHero(state, 'baize', 'player2', [4, 4]));

        const damage = DamageCalculator.calculate(yunying, survivor, 3, false);
        DamageCalculator.applyDamage(survivor, damage, yunying, state);

        expect(survivor.state).toBe(HeroState.ALIVE);
        expect(bait.currentHp).toBe(bait.maxHp);
        expect(yunying.position).toEqual([2, 2]);
        expect(state.pendingBoardAction).toBeUndefined();
        expect(tianweiLogs(state)).toEqual([]);
    });

    it('直接调用燎原烧穿敌人：天威改为挂起落点，不再自动斩人', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const victim = plainEnemy(addHero(state, 'moran', 'player2', [2, 3]));
        const survivor = plainEnemy(addHero(state, 'baize', 'player2', [2, 5]));
        victim.currentHp = 5;   // 向东射线 [2,3]→[2,5]：先烧穿近处这名，天威只挂起

        const output = castLiehuoBurn(yunying, state, 3);

        expect(output.success).toBe(true);
        expect(victim.state).toBe(HeroState.DEAD);
        expect(state.pendingBoardAction).toEqual({ type: 'yunying-tianwei', heroId: yunying.id });
        expect(yunying.position, '没点落点之前她不该被自动甩走').toEqual([2, 2]);
        // 嵌套结算最容易踩的坑：天威挂起把燎原自己的标记删掉了，剩下的命中就会重新开始叠祥瑞
        expect(getXiangruiStacks(survivor)).toBe(0);
        expect(yunying.counters['__liehuo_resolving']).toBeUndefined();
    });

    it('共线空格被占满：不挂起也不自动斩，行动照常放行', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        for (let step = 1; step < 6; step++) {
            plainEnemy(addHero(state, 'moran', 'player2', [0, step]));   // 同一行
            plainEnemy(addHero(state, 'moran', 'player2', [step, 0]));   // 同一列
            plainEnemy(addHero(state, 'moran', 'player2', [step, step])); // 同一对角线
        }
        const victim = plainEnemy(addHero(state, 'baize', 'player2', [1, 2]));   // 与她不共线，死后也腾不出落点
        victim.currentHp = 1;

        expect(getYunyingTianweiLandings(yunying, state)).toHaveLength(0);
        lethalHit(yunying, victim, state);

        expect(victim.state).toBe(HeroState.DEAD);
        expect(state.pendingBoardAction, '没有落点就不该留下无人可解的挂起').toBeUndefined();
        expect(yunying.position).toEqual([0, 0]);
        expect(state.player2Heroes.filter(hero => hero.state === HeroState.ALIVE)).toHaveLength(15);
    });
});

describe('云缨天威 · 燎原百斩：玩家手点落点', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().resetGame();
    });

    it('击杀触发：挂起落点选择，高亮集合就是合法落点集合，行动还没结束', () => {
        const { state, yunying, victim } = makeHandClickBoard();
        loadIntoStore(state);

        castSkill1AtVictim(yunying, [2, 3]);

        expect(victim.state).toBe(HeroState.DEAD);
        const store = useGameStore.getState();
        expect(store.pendingBoardAction).toEqual({ type: 'yunying-tianwei', heroId: yunying.id });
        expect(store.currentPlayer, '落点没点之前这次行动不能算结束').toBe('player1');
        expect(yunying.position, '她不会自动落位').toEqual([2, 2]);

        const landings = getYunyingTianweiLandings(yunying, store as unknown as GameState);
        expect(store.highlightedPositions).toHaveLength(16);
        expect(new Set(store.highlightedPositions.map(String))).toEqual(new Set(landings.map(String)));
        expect(new Set(getPendingActionCells(store).map(String))).toEqual(new Set(landings.map(String)));
        expect(store.highlightedPositions).toEqual(expect.arrayContaining([[5, 2], [2, 3], [0, 4]]));
        expect(store.highlightedPositions).not.toContainEqual([4, 4]);   // 友方占着的对角线格不能落
        expect(store.highlightedPositions).not.toContainEqual([1, 4]);   // 不共线
    });

    it('点合法落点：路径与火圈各斩4点、pending 清空，行动此刻才交给对手', () => {
        const { state, yunying, onPath, overlap, inBlastA, inBlastB, ally } = makeHandClickBoard();
        loadIntoStore(state);
        castSkill1AtVictim(yunying, [2, 3]);

        const before = {
            onPath: onPath.currentHp,
            overlap: overlap.currentHp,
            inBlastA: inBlastA.currentHp,
            inBlastB: inBlastB.currentHp,
            ally: ally.currentHp,
        };
        useGameStore.getState().resolvePendingBoardAction([5, 2]);

        const store = useGameStore.getState();
        expect(onPath.currentHp, '直线路径逐格4点').toBe(before.onPath - 4);
        expect(inBlastA.currentHp, '落点3×3各4点').toBe(before.inBlastA - 4);
        expect(inBlastB.currentHp).toBe(before.inBlastB - 4);
        expect(overlap.currentHp, '路径与火圈重叠的那一格吃两次').toBe(before.overlap - 8);
        expect(ally.currentHp, '友方不在命中之列').toBe(before.ally);
        expect(getXiangruiStacks(inBlastA), '天威命中不叠祥瑞').toBe(0);
        expect(yunying.position).toEqual([5, 2]);
        expect(store.board[2][2]).toBeNull();
        expect(store.board[5][2]?.id).toBe(yunying.id);
        expect(store.pendingBoardAction).toBeUndefined();
        expect(store.currentPlayer, '斩完才轮到对手行动').toBe('player2');
        expect(battleMessages(store as unknown as GameState).some(m => m.includes('燎原百斩'))).toBe(true);
        // 收尾把挂起槽交还之后，棋盘上不该留下任何"待选格"：
        // 曾经这里走的是 getPendingActionCells 的无挂起兜底，整盘 36 格被涂成可攻击红格，
        // 而 Board 的点击路由会把所有点击吞成 executeSkill，玩家连英雄都点不动
        expect(store.skillRange, '天威收尾不留全盘高亮').toHaveLength(0);
        expect(store.highlightedPositions).toHaveLength(0);

        // 特效跟着落点走：旋斩本体画在她落到的那一格，起手格是冲刺拖尾
        const wheel = store.skillFx.find(event => event.profile.kind === 'liehuo-wheel');
        expect(wheel, '燎原百斩要在落点派生一次火焰旋斩').toBeTruthy();
        expect(wheel?.fromPos).toEqual([2, 2]);
        expect(wheel?.targetPos).toEqual([5, 2]);
        expect(wheel?.impactPositions).toEqual(expect.arrayContaining([[3, 2], [4, 2], [4, 1], [5, 3]]));
        expect(wheel?.impactPositions, '落点是空格，不该把自己算成命中格').not.toContainEqual([5, 2]);
    });

    it('点非法格：被拒且不消耗任何东西，改点合法格照样斩得出去', () => {
        const { state, yunying, onPath, overlap, inBlastA, inBlastB } = makeHandClickBoard();
        loadIntoStore(state);
        castSkill1AtVictim(yunying, [2, 3]);

        const hpBefore = [onPath, overlap, inBlastA, inBlastB].map(hero => hero.currentHp);
        useGameStore.getState().resolvePendingBoardAction([1, 4]);   // 不共线

        let store = useGameStore.getState();
        expect(store.pendingBoardAction, '非法落点不该吃掉天威').toEqual({ type: 'yunying-tianwei', heroId: yunying.id });
        expect(store.currentPlayer).toBe('player1');
        expect(yunying.position).toEqual([2, 2]);
        expect([onPath, overlap, inBlastA, inBlastB].map(hero => hero.currentHp)).toEqual(hpBefore);
        expect(battleMessages(store as unknown as GameState)).toContain(
            '请点击高亮空格：燎原百斩只斩向她同行、同列或同对角线的那一格'
        );

        useGameStore.getState().resolvePendingBoardAction([3, 2]);   // 共线但站着人

        store = useGameStore.getState();
        expect(store.pendingBoardAction?.type).toBe('yunying-tianwei');
        expect(onPath.currentHp).toBe(hpBefore[0]);

        useGameStore.getState().resolvePendingBoardAction([5, 2]);   // 真正的空格落点

        store = useGameStore.getState();
        expect(store.pendingBoardAction).toBeUndefined();
        expect(yunying.position).toEqual([5, 2]);
        expect(onPath.currentHp).toBe(hpBefore[0] - 4);
        expect(store.currentPlayer).toBe('player2');
    });

    it('兜底放行：她始终没点落点就结束行动时，自动挑斩中人最多的那一格，绝不卡死', () => {
        const { state, yunying, onPath, overlap, inBlastA, inBlastB } = makeHandClickBoard();
        loadIntoStore(state);
        castSkill1AtVictim(yunying, [2, 3]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('yunying-tianwei');

        useGameStore.getState().endHeroAction();

        const store = useGameStore.getState();
        expect(store.pendingBoardAction, '挂起不许漂到对手回合').toBeUndefined();
        expect(yunying.position, '按盘面挑出的最优落点').toEqual([5, 2]);
        expect(onPath.currentHp).toBe(onPath.maxHp - 3 - 4);
        expect(overlap.currentHp).toBe(overlap.maxHp - 8);
        expect(inBlastA.currentHp).toBe(inBlastA.maxHp - 4);
        expect(inBlastB.currentHp).toBe(inBlastB.maxHp - 4);
        expect(store.currentPlayer).toBe('player2');
    });

    it('挂起之后落点被占满：作废这次天威并放行行动', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        for (let step = 1; step < 6; step++) {
            addHero(state, 'moran', 'player2', [0, step]);
            addHero(state, 'moran', 'player2', [step, 0]);
            addHero(state, 'moran', 'player2', [step, step]);
        }
        loadIntoStore(state);
        useGameStore.getState().selectHeroForAction(yunying);
        yunying.hasActedThisTurn = true;
        useGameStore.setState({
            pendingBoardAction: { type: 'yunying-tianwei', heroId: yunying.id },
            selectedHero: yunying,
            activeHero: yunying,
        });
        expect(getPendingActionCells(useGameStore.getState())).toHaveLength(0);

        useGameStore.getState().resolvePendingBoardAction([1, 2]);

        const store = useGameStore.getState();
        expect(store.pendingBoardAction).toBeUndefined();
        expect(yunying.position).toEqual([0, 0]);
        expect(store.currentPlayer, '没有落点也要把控制权交出去').toBe('player2');
    });

    it('挂起时她被羽化打死：作废天威并放行行动', () => {
        const { state, yunying } = makeHandClickBoard();
        loadIntoStore(state);
        useGameStore.getState().selectHeroForAction(yunying);
        yunying.hasActedThisTurn = true;
        useGameStore.setState({
            pendingBoardAction: { type: 'yunying-tianwei', heroId: yunying.id },
            selectedHero: yunying,
            activeHero: yunying,
        });
        yunying.state = HeroState.DEAD;
        state.board[2][2] = null;
        yunying.position = null;

        useGameStore.getState().resolvePendingBoardAction([5, 2]);

        const store = useGameStore.getState();
        expect(store.pendingBoardAction).toBeUndefined();
        expect(store.currentPlayer, '人已不在场上也要放行回合').toBe('player2');
    });

    it('同一次击杀里先天威后燎原：两个挂起排队落地，谁都不被覆盖', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const stacked = plainEnemy(addHero(state, 'moran', 'player2', [2, 3]));
        const casualty = plainEnemy(addHero(state, 'baize', 'player2', [3, 3]));
        casualty.currentHp = 1;                       // 技能一顺手打死他 → 天威要抢在燎原前面
        addXiangrui(stacked, yunying, 2);             // 这一枪打满 3 层 → 烈火燎原被引燃
        loadIntoStore(state);

        castSkill1AtVictim(yunying, [2, 3]);

        let store = useGameStore.getState();
        expect(casualty.state).toBe(HeroState.DEAD);
        expect(store.pendingBoardAction, '先答天威的落点').toEqual({ type: 'yunying-tianwei', heroId: yunying.id });
        expect(yunying.counters['__yunying_liehuo_queued'], '刚引燃的燎原回炉排队').toBe(1);
        expect(store.currentPlayer).toBe('player1');

        useGameStore.getState().resolvePendingBoardAction([5, 5]);   // 一个谁都斩不到的落点：手点允许只挪位

        store = useGameStore.getState();
        expect(yunying.position).toEqual([5, 5]);
        expect(yunying.counters['__yunying_liehuo_queued'], '排队已被取走').toBeUndefined();
        expect(store.pendingBoardAction, '天威斩完之后补挂燎原').toEqual({ type: 'yunying-liehuo', heroId: yunying.id });
        expect(store.currentPlayer, '燎原还没点，行动仍未结束').toBe('player1');
        // 落位之后方向格按她的新位置算
        expect(new Set(getPendingActionCells(store).map(String)))
            .toEqual(new Set(['4,5', '5,4']));

        useGameStore.getState().resolvePendingBoardAction([5, 4]);   // 向西：这条线上没人

        store = useGameStore.getState();
        expect(store.pendingBoardAction).toBeUndefined();
        expect(store.currentPlayer, '两笔账都清了才轮到对手').toBe('player2');
        expect(getXiangruiStacks(stacked)).toBe(0);
        expect(yunying.counters['__liehuo_resolving']).toBeUndefined();
        expect(yunying.counters['__yunying_tianwei_queued']).toBeUndefined();
    });

    it('燎原烧穿敌人：天威排在烧完之后补挂，余下命中依旧不叠祥瑞', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const stacked = plainEnemy(addHero(state, 'moran', 'player2', [2, 3]));
        const bystander = plainEnemy(addHero(state, 'zhenxiao', 'player2', [2, 4]));
        const casualty = plainEnemy(addHero(state, 'baize', 'player2', [2, 5]));
        casualty.currentHp = 1;                       // 烧穿最远那名 → 当场触发天威
        addXiangrui(stacked, yunying, 2);
        loadIntoStore(state);

        castSkill1AtVictim(yunying, [2, 3]);
        expect(useGameStore.getState().pendingBoardAction).toEqual({ type: 'yunying-liehuo', heroId: yunying.id });
        expect(useGameStore.getState().currentPlayer).toBe('player1');

        useGameStore.getState().resolvePendingBoardAction([2, 3]);   // 向东烧

        let store = useGameStore.getState();
        expect(casualty.state).toBe(HeroState.DEAD);
        expect(store.pendingBoardAction, '烧穿人的天威排在燃烧之后挂起').toEqual({ type: 'yunying-tianwei', heroId: yunying.id });
        expect(store.currentPlayer, '天威还挂着，行动不能交给对手').toBe('player1');
        expect(yunying.counters['__yunying_tianwei_queued'], '排队标记已取走').toBeUndefined();
        const burned = { stacked: stacked.currentHp, bystander: bystander.currentHp };

        useGameStore.getState().resolvePendingBoardAction([5, 5]);

        store = useGameStore.getState();
        expect(stacked.currentHp, '天威这记斩向空处，不该再烧到人').toBe(burned.stacked);
        expect(bystander.currentHp).toBe(burned.bystander);
        expect(getXiangruiStacks(stacked)).toBe(0);
        expect(getXiangruiStacks(bystander)).toBe(0);
        expect(yunying.position).toEqual([5, 5]);
        expect(store.pendingBoardAction).toBeUndefined();
        expect(store.currentPlayer).toBe('player2');
    });

    it('联机：只有她所属方能点这个落点格', () => {
        const { state, yunying, onPath } = makeHandClickBoard();
        loadIntoStore(state);
        useGameStore.setState({ isOnlineMode: true, localPlayerNumber: 1, currentPlayer: 'player1' });
        castSkill1AtVictim(yunying, [2, 3]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('yunying-tianwei');

        // 同一份挂起态随权威快照到了对手端：对手点格必须被拒
        useGameStore.setState({ localPlayerNumber: 2 });
        useGameStore.getState().resolvePendingBoardAction([5, 2]);

        let store = useGameStore.getState();
        expect(store.pendingBoardAction, '越权点击不该吃掉挂起态').toMatchObject({ type: 'yunying-tianwei' });
        expect(store.battleLog.some(entry => entry.message === '当前无法操作')).toBe(true);
        expect(onPath.currentHp, '对手不能替我们造成伤害').toBe(onPath.maxHp - 3);

        useGameStore.setState({ localPlayerNumber: 1 });
        useGameStore.getState().resolvePendingBoardAction([5, 2]);

        store = useGameStore.getState();
        expect(store.pendingBoardAction).toBeUndefined();
        expect(onPath.currentHp).toBe(onPath.maxHp - 7);
    });

    it('联机快照：新 pending 类型与排队标记都同步得到对端', () => {
        const { state, yunying } = makeHandClickBoard();
        loadIntoStore(state);
        castSkill1AtVictim(yunying, [2, 3]);
        // 顺带把"燎原排队"这条分支也过一遍快照
        yunying.counters['__yunying_liehuo_queued'] = 1;

        const wire = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        expect(wire.pendingBoardAction).toEqual({ type: 'yunying-tianwei', heroId: yunying.id });

        useGameStore.setState({ pendingBoardAction: undefined });
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();

        applyServerGameState(wire);

        const store = useGameStore.getState();
        expect(store.pendingBoardAction).toEqual({ type: 'yunying-tianwei', heroId: yunying.id });
        const synced = store.player1Heroes.find(hero => hero.id === yunying.id)!;
        expect(synced.counters['__yunying_liehuo_queued'], '排队账要跟着英雄一起过线').toBe(1);
        expect(getPendingActionCells(store).length).toBeGreaterThan(0);
    });
});

describe('云缨天威 · 燎原百斩：电脑选落点', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('电脑只从合法落点里挑：取一记斩中人最多的那一格', () => {
        const { state, yunying } = makeHandClickBoard();
        state.pendingBoardAction = { type: 'yunying-tianwei', heroId: yunying.id };

        const pick = chooseComputerPendingBoardPosition(state, yunying);

        expect(pick).toEqual([5, 2]);
        expect(getYunyingTianweiLandings(yunying, state)).toContainEqual(pick);
    });

    it('无可斩目标时电脑挑不出落点，交由收尾兜底放行', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [0, 0]);
        const bystander = plainEnemy(addHero(state, 'moran', 'player2', [1, 2]));   // 与她不共线，谁也斩不到
        state.pendingBoardAction = { type: 'yunying-tianwei', heroId: yunying.id };

        // 没人可斩 ≠ 没有落点：共线空格依旧合法，电脑给个位置照常收尾，不会在挂起处卡死
        const pick = chooseComputerPendingBoardPosition(state, yunying);
        expect(pick).not.toBeNull();
        expect(getYunyingTianweiLandings(yunying, state).map(String)).toContain(String(pick));
        expect(bystander.currentHp).toBe(bystander.maxHp);
    });
});
