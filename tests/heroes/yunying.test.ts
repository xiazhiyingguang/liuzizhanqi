import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { SkillSystem } from '../../src/core/skill-system';
import { chooseComputerPendingBoardPosition, chooseComputerSkillPlan } from '../../src/core/computer-ai';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { getPendingActionCells, useGameStore } from '../../src/store/game-store';
import {
    addXiangrui,
    getXiangruiStacks,
    YUNYING_VAMPIRE_EFFECT,
} from '../../src/data/extended-heroes';
import {
    castLiehuoBurn,
    getYunyingChargeCells,
    yunyingSkill1,
    yunyingSkill2,
} from '../../src/data/extended-skills';
import { Hero, HeroState, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/** 直接走伤害结算，用来单独驱动"每次命中叠1层祥瑞"的被动 */
function plainHit(attacker: Hero, target: Hero, state: ReturnType<typeof makeGameState>, amount = 3): number {
    const damage = DamageCalculator.calculate(attacker, target, amount, false);
    DamageCalculator.applyDamage(target, damage, attacker, state);
    return damage.finalDamage;
}

describe('云缨完整机制', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('拥有45生命、2移动力与完整技能与天威注册', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);

        expect(yunying.name).toBe('云缨');
        expect(yunying.class).toBe('武曲');
        expect(yunying.maxHp).toBe(45);
        expect(yunying.moveRange).toBe(2);
        expect(yunying.skill1Id).toBe('yunying_skill1');
        expect(yunying.skill2Id).toBe('yunying_skill2');
        expect(yunying.passiveId).toBe('yunying_passive');
        expect(yunying.tianweiId).toBe('yunying_tianwei');
    });

    it('星火照野：3×3每名敌人3点，并按其引火前已有的祥瑞层数每层+2点（不再给护盾）', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const marked = addHero(state, 'moran', 'player2', [2, 3]);
        const fresh = addHero(state, 'baize', 'player2', [3, 3]);
        const untouched = addHero(state, 'zhenxiao', 'player2', [0, 0]);
        addXiangrui(marked, yunying, 1);

        const output = SkillSystem.executeSkill(yunying, yunyingSkill1, [[2, 3]], state);

        expect(output.success).toBe(true);
        // 1 层 → 3+2=5；0 层 → 3；本次新叠的那层不计入增伤
        expect(output.damageDealt).toEqual([5, 3]);
        expect(marked.currentHp).toBe(marked.maxHp - 5);
        expect(fresh.currentHp).toBe(fresh.maxHp - 3);
        expect(untouched.currentHp).toBe(untouched.maxHp);
        expect(yunying.shield).toBe(0);
        expect(getXiangruiStacks(marked)).toBe(2);
        expect(getXiangruiStacks(fresh)).toBe(1);
        expect(state.pendingBoardAction).toBeUndefined();
    });

    it('星火照野：两层目标吃到3+4=7点，打到第三层照常引燃烈火燎原', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = victim.maxHp;
        addXiangrui(victim, yunying, 2);

        const output = SkillSystem.executeSkill(yunying, yunyingSkill1, [[2, 3]], state);

        expect(output.damageDealt).toEqual([7]);
        expect(state.pendingBoardAction).toEqual({ type: 'yunying-liehuo', heroId: yunying.id });
    });

    it('踏火长驱：正前方一排3格（宽3深1）各6点，并按命中人数挂下一次攻击的吸血', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const up = addHero(state, 'moran', 'player2', [1, 3]);
        const mid = addHero(state, 'baize', 'player2', [2, 3]);
        const down = addHero(state, 'zhenxiao', 'player2', [3, 3]);
        const beyond = addHero(state, 'liuli', 'player2', [2, 4]);
        yunying.counters['__yunying_skill2_dir'] = 3;   // 向东

        const output = SkillSystem.executeSkill(yunying, yunyingSkill2, [[2, 3]], state);

        expect(output.success).toBe(true);
        // 命中面是"那一列"三格，纵深只有 1 格，第二格往后的敌人不该吃到
        expect(getYunyingChargeCells(yunying, 3)).toEqual([[1, 3], [2, 3], [3, 3]]);
        for (const enemy of [up, mid, down]) {
            expect(enemy.currentHp).toBe(enemy.maxHp - 6);
        }
        expect(beyond.currentHp).toBe(beyond.maxHp);
        const buff = yunying.effects.find(effect => effect.name === YUNYING_VAMPIRE_EFFECT);
        expect(buff?.value).toBeCloseTo(0.6);
        expect(yunying.counters['__yunying_skill2_dir']).toBeUndefined();
    });

    it('踏火长驱：朝向换成南北时命中面转成横排，贴边时只保留盘内格子', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        expect(getYunyingChargeCells(yunying, 0)).toEqual([[1, 1], [1, 2], [1, 3]]);   // 向北
        expect(getYunyingChargeCells(yunying, 1)).toEqual([[3, 1], [3, 2], [3, 3]]);   // 向南

        const edge = addHero(state, 'yunying', 'player1', [0, 0]);
        expect(getYunyingChargeCells(edge, 1)).toEqual([[1, 0], [1, 1]]);              // 向北贴边只剩 2 格
    });

    it('燎原吸血只作用于下一次攻击的整批命中，用完即摘', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const first = addHero(state, 'moran', 'player2', [2, 3]);
        const second = addHero(state, 'baize', 'player2', [3, 2]);
        EffectManager.addEffect(yunying, {
            type: 'buff',
            name: YUNYING_VAMPIRE_EFFECT,
            duration: -1,
            value: 0.6,
            sourceHeroId: yunying.id,
            description: '测试用吸血',
        });

        SkillSystem.executeSkill(yunying, yunyingSkill1, [[2, 3]], state);

        // 两名敌人各吃3点，六成就该回3点血（45+3 未超上限）
        expect(first.currentHp).toBe(first.maxHp - 3);
        expect(second.currentHp).toBe(second.maxHp - 3);
        expect(yunying.currentHp).toBe(45);
        expect(yunying.effects.some(effect => effect.name === YUNYING_VAMPIRE_EFFECT)).toBe(false);

        // 已经用掉的吸血不会在下一次攻击继续生效
        plainHit(yunying, first, state);
        expect(yunying.currentHp).toBe(45);
    });

    it('祥瑞积满3层清空该目标并挂起烈火燎原的方向选择，每轮至多一次', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        const bystander = addHero(state, 'baize', 'player2', [1, 3]);

        plainHit(yunying, victim, state);
        plainHit(yunying, victim, state);
        expect(getXiangruiStacks(victim)).toBe(2);
        expect(state.pendingBoardAction).toBeUndefined();

        plainHit(yunying, victim, state);
        expect(getXiangruiStacks(victim)).toBe(0);
        expect(state.pendingBoardAction).toEqual({ type: 'yunying-liehuo', heroId: yunying.id });
        expect(yunying.counters['liehuo_round']).toBe(state.roundNumber);

        // 本回合额度已用完：再打到的敌人只叠层，不再引燃
        plainHit(yunying, bystander, state);
        plainHit(yunying, bystander, state);
        plainHit(yunying, bystander, state);
        expect(getXiangruiStacks(bystander)).toBe(3);
        expect(state.pendingBoardAction).toEqual({ type: 'yunying-liehuo', heroId: yunying.id });
    });

    it('烈火燎原：沿方向射线造成「已损30%+4」，自身不再叠祥瑞', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const near = addHero(state, 'moran', 'player2', [2, 3]);
        const far = addHero(state, 'baize', 'player2', [2, 5]);
        const offAxis = addHero(state, 'zhenxiao', 'player2', [3, 3]);
        near.currentHp = Math.floor(near.maxHp * 0.5);   // 已损 24 → 7+4 = 11
        far.currentHp = 5;                               // 濒危：直接被烧穿
        // 本例只验射线伤害口径：燎原烧死人会连带触发天威·燎原百斩，追加命中会把断言糊掉
        yunying.tianweiId = undefined;

        const output = castLiehuoBurn(yunying, state, 3);   // 向东：[2,3]→[2,5]

        expect(output.success).toBe(true);
        expect(near.currentHp).toBe(Math.floor(near.maxHp * 0.5) - 11);
        expect(far.state).toBe(HeroState.DEAD);
        expect(offAxis.currentHp).toBe(offAxis.maxHp);   // 射线只烧这条线上的人
        // 引燃不再叠加祥瑞，也不会再触发新的引燃
        expect(getXiangruiStacks(near)).toBe(0);
        expect(state.pendingBoardAction).toBeUndefined();
    });

    it('走 store 流程：技能一命中满层后点方向格完成引燃并清空高亮', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        addHero(state, 'baize', 'player2', [5, 0]);
        victim.currentHp = 30;
        addXiangrui(victim, yunying, 2);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            pendingBoardAction: undefined,
            suppressOnlineBroadcast: false,
        });

        useGameStore.getState().selectHeroForAction(yunying);
        useGameStore.getState().selectSkill('yunying_skill1');
        useGameStore.getState().executeSkill([2, 3]);

        const pending = useGameStore.getState().pendingBoardAction;
        expect(pending?.type).toBe('yunying-liehuo');
        const cells = useGameStore.getState().skillRange;
        expect(cells).toHaveLength(4);
        expect(cells.some(([row, col]) => row === 2 && col === 3)).toBe(true);

        const hpBefore = victim.currentHp;
        useGameStore.getState().resolvePendingBoardAction([1, 2]);   // 向北：这条线没有敌人

        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();
        expect(victim.currentHp).toBe(hpBefore);
        expect(yunying.hasActedThisTurn).toBe(true);
    });

    it('烈火燎原挂起时四方向格可点，选向后派发烧到棋盘尽头的火墙事件', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        addHero(state, 'baize', 'player2', [5, 0]);
        victim.currentHp = 40;
        addXiangrui(victim, yunying, 2);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            skillFx: [],
            pendingBoardAction: undefined,
            suppressOnlineBroadcast: false,
        });

        useGameStore.getState().selectHeroForAction(yunying);
        useGameStore.getState().selectSkill('yunying_skill1');
        useGameStore.getState().executeSkill([2, 3]);

        // 挂起态自己就能推导出可点的四个方向格（不依赖某个 set 是否记得同步高亮）
        const cells = getPendingActionCells(useGameStore.getState());
        expect(cells).toHaveLength(4);
        expect(cells).toEqual(expect.arrayContaining([[1, 2], [3, 2], [2, 1], [2, 3]]));

        useGameStore.getState().resolvePendingBoardAction([2, 3]);   // 向东

        const event = useGameStore.getState().skillFx[useGameStore.getState().skillFx.length - 1];
        expect(event.profile.kind).toBe('liehuo-blaze');
        // 火线一路铺到棋盘右边界，且区域层拿到整条射线的包围盒才能画那道火幕
        expect(event.coveredPositions).toEqual([[2, 3], [2, 4], [2, 5]]);
        expect(event.areaBounds).toEqual({ r0: 2, c0: 3, rows: 1, cols: 3 });
    });

    it('电脑会用云缨：给得出长驱方向计划，也解得开烈火燎原的待选', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player2', [2, 2]);
        addHero(state, 'moran', 'player1', [2, 3]);

        expect(chooseComputerSkillPlan(state, yunying, yunying.skill2Id)).not.toBeNull();

        state.pendingBoardAction = { type: 'yunying-liehuo', heroId: yunying.id };
        expect(chooseComputerPendingBoardPosition(state, yunying)).toEqual([2, 3]);
    });

    it('方向技能两段式：先点相邻方向格，点歪了只提示不消耗行动', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        addHero(state, 'baize', 'player2', [5, 0]);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            suppressOnlineBroadcast: false,
        });

        useGameStore.getState().selectHeroForAction(yunying);
        useGameStore.getState().selectSkill('yunying_skill2');
        expect(useGameStore.getState().skillRange).toHaveLength(4);

        const badCell: Position = [0, 0];
        useGameStore.getState().executeSkill(badCell);
        expect(yunying.counters['__yunying_skill2_dir']).toBeUndefined();
        expect(yunying.hasActedThisTurn).toBe(false);
        expect(enemy.currentHp).toBe(enemy.maxHp);

        useGameStore.getState().executeSkill([2, 3]);   // 向东定方向并立即结算
        expect(enemy.currentHp).toBe(enemy.maxHp - 6);
        expect(yunying.hasActedThisTurn).toBe(true);

        // 刀光是区域层的一柄巨刃：事件必须带上整排命中格的包围盒
        const fx = useGameStore.getState().skillFx;
        const event = fx[fx.length - 1];
        expect(event.profile.kind).toBe('yunying-arc-slash');
        expect(event.coveredPositions).toEqual([[1, 3], [2, 3], [3, 3]]);
        expect(event.areaBounds).toEqual({ r0: 1, c0: 3, rows: 3, cols: 1 });
    });
});

describe('烈火燎原挂起的两条死锁出口', () => {
    /** 人机模式下、云缨在电脑那侧：挂起既不该由玩家点，也不该被归属守卫挡死 */
    function armComputerLiehuo(): { state: ReturnType<typeof makeGameState>; yunying: Hero } {
        const state = makeGameState({ currentPlayer: 'player2' });
        const yunying = addHero(state, 'yunying', 'player2', [2, 2]);
        state.pendingBoardAction = { type: 'yunying-liehuo', heroId: yunying.id };
        useGameStore.setState({
            ...state,
            phase: 'battle',
            isAiMode: true,
            isOnlineMode: false,
            aiPlayer: 'player2',
            currentPlayer: 'player2',
            selectedHero: yunying,
            activeHero: yunying,
        });
        return { state, yunying };
    }

    beforeEach(() => useGameStore.getState().resetGame());
    afterEach(() => {
        useGameStore.getState().resetGame();
        vi.restoreAllMocks();
    });

    it('电脑方云缨的燎原由电脑自己解开，不再回一句"当前无法操作"就永久卡住', () => {
        const { state, yunying } = armComputerLiehuo();
        const victim = addHero(state, 'moran', 'player1', [2, 4]);

        useGameStore.getState().resolvePendingBoardAction([2, 3], { byComputer: true });

        const after = useGameStore.getState();
        expect(after.pendingBoardAction).toBeUndefined();
        expect(victim.currentHp).toBeLessThan(victim.maxHp);      // 火线确实烧出去了
        expect(yunying.hasActedThisTurn).toBe(true);               // 扣住的行动被放行
        expect((after.battleLog ?? []).some(entry => entry.message === '当前无法操作')).toBe(false);
    });

    it('四条射线都烧不到人时：电脑挑不出方向而不是退回全盘格，收尾作废并放行', () => {
        const { state, yunying } = armComputerLiehuo();
        addHero(state, 'moran', 'player1', [0, 0]);   // 斜角，不在任何一条行/列射线上

        // 挑不出就必须是 null：返回任意全盘格都会被"只能点相邻方向格"拒掉，挂起原地打转
        expect(chooseComputerPendingBoardPosition(state, yunying)).toBeNull();

        useGameStore.getState().endHeroAction();

        const after = useGameStore.getState();
        expect(after.pendingBoardAction).toBeUndefined();
        expect(yunying.hasActedThisTurn).toBe(true);
        expect(after.highlightedPositions).toHaveLength(0);
    });

    /**
     * 技能二点方向格后在同一次调用里继续结算，那次 set 会让函数开头的 state 快照与 store 脱钩，
     * 引擎写在快照上的 pendingBoardAction 就再也合并不回去（表现：天威/燎原静默消失）。
     * 走 store 的完整点击链才能复现，所以这里必须用 store 而不是直接调 SkillSystem。
     */
    it('技能二同批触发天威与燎原：先天威后燎原，整条链点到底才收尾', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const dying = addHero(state, 'moran', 'player2', [1, 3]);   // 长驱 6 伤 → 击杀 → 天威
        const marked = addHero(state, 'baize', 'player2', [2, 3]);  // 已有2层祥瑞，再吃一发满3 → 燎原
        dying.currentHp = 1;
        addXiangrui(marked, yunying, 2);
        useGameStore.setState({
            ...state,
            phase: 'battle',
            isAiMode: false,
            isOnlineMode: false,
            currentPlayer: 'player1',
            selectedHero: yunying,
            activeHero: yunying,
            suppressOnlineBroadcast: false,
        });

        const store = useGameStore.getState();
        store.selectHeroForAction(yunying);
        store.selectSkill('yunying_skill2');
        store.executeSkill([2, 3]);   // 点正东方向格：定方向并当场长驱

        expect(dying.state).toBe(HeroState.DEAD);
        expect(getXiangruiStacks(marked)).toBe(0);                  // 燎原确实被引燃（层数已消耗）
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('yunying-tianwei');

        // 点天威落点 → 应当补挂排队的燎原，而不是直接结束行动
        const landing = getPendingActionCells(useGameStore.getState())[0];
        useGameStore.getState().resolvePendingBoardAction(landing);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('yunying-liehuo');

        // 点燃烧方向 → 链条闭合，行动才允许结束
        const dirCell = getPendingActionCells(useGameStore.getState())[0];
        useGameStore.getState().resolvePendingBoardAction(dirCell);
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();
        expect(yunying.hasActedThisTurn).toBe(true);
    });

    /**
     * 第3层由致命一击叠上：目标被这一击打死，身上不会再落祥瑞层，
     * 但引燃判定必须按"这一击之后满3层"照样成立，否则击杀越准反而越点不着燎原。
     */
    it('致命一击凑满第3层：天威与烈火燎原都触发，按先天威后燎原排队', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 3;                 // 3 + 2层×2 = 7 伤 → 击杀
        addXiangrui(victim, yunying, 2);      // 已有2层，这一击就是第3层

        SkillSystem.executeSkill(yunying, yunyingSkill1, [[2, 3]], state);

        expect(victim.state).toBe(HeroState.DEAD);
        // 引燃确实发生了：本轮额度记在她名下，且燎原排在天威后面
        expect(yunying.counters['liehuo_round']).toBe(state.roundNumber);
        expect(yunying.counters['__yunying_liehuo_queued']).toBe(1);
        expect(state.pendingBoardAction?.type).toBe('yunying-tianwei');
    });

    it('致命一击凑满第3层：点掉天威落点后，燎原仍会补挂并走完整链', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 3;
        addXiangrui(victim, yunying, 2);
        useGameStore.setState({
            ...state,
            phase: 'battle',
            isAiMode: false,
            isOnlineMode: false,
            currentPlayer: 'player1',
            selectedHero: yunying,
            activeHero: yunying,
            suppressOnlineBroadcast: false,
        });

        const store = useGameStore.getState();
        store.selectHeroForAction(yunying);
        store.selectSkill('yunying_skill1');
        store.executeSkill([2, 3]);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('yunying-tianwei');

        const landing = getPendingActionCells(useGameStore.getState())[0];
        useGameStore.getState().resolvePendingBoardAction(landing);
        expect(useGameStore.getState().pendingBoardAction?.type).toBe('yunying-liehuo');

        const dirCell = getPendingActionCells(useGameStore.getState())[0];
        useGameStore.getState().resolvePendingBoardAction(dirCell);
        expect(useGameStore.getState().pendingBoardAction).toBeUndefined();
        expect(yunying.hasActedThisTurn).toBe(true);
    });
});

describe('挂起漂到别人回合时的兜底放行', () => {
    /**
     * 此时控制权已在玩家手里——玩家点会被归属守卫拒绝（"当前无法操作"），
     * 而"不是它的回合"又让电脑步进器整拍不跑，两头都没人收尾就是死局。
     */
    it.each(['yunying-liehuo', 'yunying-tianwei'] as const)('%s 漂到玩家回合时由电脑作废，且不误伤玩家的行动账', type => {
        const state = makeGameState({ currentPlayer: 'player1' });
        const yunying = addHero(state, 'yunying', 'player2', [2, 2]);
        const human = addHero(state, 'moran', 'player1', [2, 4]);
        state.pendingBoardAction = { type, heroId: yunying.id };
        useGameStore.setState({
            ...state,
            phase: 'battle',
            isAiMode: true,
            isOnlineMode: false,
            aiPlayer: 'player2',
            currentPlayer: 'player1',
            selectedHero: human,
            activeHero: human,
        });

        // 玩家点一格：归属守卫必须拒绝（不能让玩家替电脑选燃烧方向/落点）
        useGameStore.getState().resolvePendingBoardAction(type === 'yunying-liehuo' ? [2, 3] : [2, 5]);
        expect(useGameStore.getState().pendingBoardAction).toBeTruthy();

        // 电脑步进器要能在"不是它的回合"时仍然把这格解掉
        runComputerBattleStep('player2', 0);

        const after = useGameStore.getState();
        expect(after.pendingBoardAction).toBeUndefined();
        expect(human.hasActedThisTurn).toBe(false);   // 作废只清槽，不该替玩家结束行动
    });
});
