import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { SkillSystem } from '../../src/core/skill-system';
import { chooseComputerPendingBoardPosition, chooseComputerSkillPlan } from '../../src/core/computer-ai';
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

    it('拥有45生命、2移动力与完整技能注册（暂时无天威）', () => {
        const state = makeGameState();
        const yunying = addHero(state, 'yunying', 'player1', [2, 2]);

        expect(yunying.name).toBe('云缨');
        expect(yunying.class).toBe('武曲');
        expect(yunying.maxHp).toBe(45);
        expect(yunying.moveRange).toBe(2);
        expect(yunying.skill1Id).toBe('yunying_skill1');
        expect(yunying.skill2Id).toBe('yunying_skill2');
        expect(yunying.passiveId).toBe('yunying_passive');
        expect(yunying.tianweiId ?? '').toBe('');
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
