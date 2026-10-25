import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillSystem } from '../../src/core/skill-system';
import { EffectManager } from '../../src/core/effect-manager';
import { chooseComputerSkillPlan } from '../../src/core/computer-ai';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { useGameStore } from '../../src/store/game-store';
import { EXTENDED_SKILLS, wenrenSkill1, wenrenSkill2 } from '../../src/data/extended-skills';
import {
    findWenrenLeapPlan,
    getAllWenrenLeapPlans,
    getWenrenLandingPlans,
    getWenrenPos,
    getWenrenWaypoint,
    isWenrenZhaoShen,
    setWenrenPos,
    setWenrenWaypoint,
} from '../../src/core/wenren-form';
import { addHero, makeGameState } from '../helpers/game-state';
import type { GameState, Hero } from '../../src/types/game';

function addEnemy(state: GameState, position: [number, number]): Hero {
    return addHero(state, 'baize', 'player2', position);
}

function enterZhaoShen(hero: Hero): void {
    EffectManager.addEffect(hero, {
        type: 'buff', name: '昭神', duration: 2, sourceHeroId: hero.id,
    });
}

describe('闻人翊悬 · 基础资料', () => {
    it('48生命、3移动力，两式技能都已注册', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 0]);

        expect(wenren.name).toBe('闻人翊悬');
        expect(wenren.class).toBe('武曲');
        expect(wenren.maxHp).toBe(48);
        expect(wenren.moveRange).toBe(3);
        expect(wenren.skill1Id).toBe('wenren_skill1');
        expect(wenren.skill2Id).toBe('wenren_skill2');
        expect(wenren.passiveId).toBe('wenren_passive');
        expect(EXTENDED_SKILLS.wenren_skill1.name).toBe('蹈火·跃阵');
        expect(EXTENDED_SKILLS.wenren_skill2.name).toBe('破妄·燎原');
        expect(getWenrenPos(wenren)).toBe(0);
    });
});

describe('闻人翊悬 · 普通态飞跃几何', () => {
    it('只走棋盘内的直线：越过友军后最多落到边上，不会从另一侧接回来', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);

        const plan = findWenrenLeapPlan(wenren, state, [0, 4], [0, 5]);

        expect(plan).not.toBeNull();
        expect(plan!.distance).toBe(3);
        expect(plan!.direction).toEqual([0, 1]);
        expect(plan!.path).toEqual([[0, 3], [0, 4], [0, 5]]);
        // [0,0] 要绕到棋盘另一边，普通态没有这条路
        expect(findWenrenLeapPlan(wenren, state, [0, 4], [0, 0])).toBeNull();
    });

    it('纵向同理：普通态从上边飞不出去，也接不到下边', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 0]);
        addHero(state, 'moran', 'player1', [4, 0]);

        const plan = findWenrenLeapPlan(wenren, state, [4, 0], [5, 0]);

        expect(plan).not.toBeNull();
        expect(plan!.distance).toBe(3);
        expect(findWenrenLeapPlan(wenren, state, [4, 0], [0, 0])).toBeNull();
    });

    it('友军必须与自己在八方向之一的同一条线上', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 2]);
        addHero(state, 'moran', 'player1', [3, 4]);

        expect(getAllWenrenLeapPlans(wenren, state)).toEqual([]);
    });

    it('最远只能飞 5 格：第 6 格回到自己脚下，不能当落点', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 0]);
        addHero(state, 'moran', 'player1', [0, 1]);

        const plans = getAllWenrenLeapPlans(wenren, state);

        expect(plans.every(plan => plan.distance <= 5)).toBe(true);
        expect(plans.some(plan => plan.to[0] === 0 && plan.to[1] === 0)).toBe(false);
        expect(plans.some(plan => plan.to[0] === 0 && plan.to[1] === 5)).toBe(true);
    });

    it('落点被占时该方案不成立', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 0]);
        addHero(state, 'moran', 'player1', [0, 1]);
        addEnemy(state, [0, 2]);

        const landings = getWenrenLandingPlans(wenren, state, [0, 1]).map(plan => plan.to);

        expect(landings).not.toContainEqual([0, 2]);
        expect(landings).toContainEqual([0, 3]);
    });
});

describe('闻人翊悬 · 昭神态闭环几何', () => {
    it('横向环绕：越过后能从最右边接回最左边，距离按环上格数算', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        enterZhaoShen(wenren);

        const plan = findWenrenLeapPlan(wenren, state, [0, 4], [0, 0]);

        expect(plan).not.toBeNull();
        expect(plan!.distance).toBe(4);
        expect(plan!.direction).toEqual([0, 1]);
        expect(plan!.path).toContainEqual([0, 5]);
    });

    it('纵向环绕：从上边飞出去，从下边接回来', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 0]);
        addHero(state, 'moran', 'player1', [4, 0]);
        enterZhaoShen(wenren);

        const plan = findWenrenLeapPlan(wenren, state, [4, 0], [0, 0]);

        expect(plan).not.toBeNull();
        expect(plan!.distance).toBe(4);
        expect(plan!.direction).toEqual([1, 0]);
    });

    it('对角线也按闭环走：斜向一环同样只有 6 格', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [1, 1]);
        addHero(state, 'moran', 'player1', [3, 3]);
        enterZhaoShen(wenren);

        const plan = findWenrenLeapPlan(wenren, state, [3, 3], [0, 0]);

        expect(plan).not.toBeNull();
        expect(plan!.distance).toBe(5);
    });
});

describe('闻人翊悬 · 普通态 蹈火·跃阵', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('落地后对落点一圈造成 8 点伤害，并获得等同于飞跃距离的破妄', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        const enemy = addEnemy(state, [1, 4]);
        setWenrenWaypoint(wenren, [0, 4]);

        const result = SkillSystem.executeSkill(wenren, wenrenSkill1, [[0, 5]], state);

        expect(result.success).toBe(true);
        expect(result.damageDealt).toEqual([8]);
        expect(wenren.position).toEqual([0, 5]);
        expect(state.board[0][2]).toBeNull();
        expect(state.board[0][5]).toBe(wenren);
        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
        expect(getWenrenPos(wenren)).toBe(3);
        expect(getWenrenWaypoint(wenren)).toBeNull();
    });

    it('普通态伤害不随飞跃距离增加：飞满 5 格仍只打 8 点', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 0]);
        addHero(state, 'moran', 'player1', [0, 1]);
        const enemy = addEnemy(state, [1, 5]);
        setWenrenWaypoint(wenren, [0, 1]);

        SkillSystem.executeSkill(wenren, wenrenSkill1, [[0, 5]], state);

        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
        expect(getWenrenPos(wenren)).toBe(5);
    });

    it('只打落点一圈，不伤及半路经过的单位', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        // 路径格 [0,3]，不在落点 [0,5] 的八格里
        const passerby = addEnemy(state, [0, 3]);
        setWenrenWaypoint(wenren, [0, 4]);

        SkillSystem.executeSkill(wenren, wenrenSkill1, [[0, 5]], state);

        expect(passerby.currentHp).toBe(passerby.maxHp);
    });

    it('普通态不能选闭环之后的落点', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        setWenrenWaypoint(wenren, [0, 4]);

        const result = SkillSystem.executeSkill(wenren, wenrenSkill1, [[0, 0]], state);

        expect(result.success).toBe(false);
        expect(wenren.position).toEqual([0, 2]);
    });

    it('第一段点友军只展开落点，不消耗行动；第二段点落点才结算', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        const enemy = addEnemy(state, [1, 4]);
        useGameStore.setState({
            ...state,
            isOnlineMode: false,
            isAiMode: false,
            suppressOnlineBroadcast: false,
            moveRange: [],
            skillRange: [],
            highlightedPositions: [],
            selectedHero: null,
            selectedSkill: null,
            pendingBoardAction: undefined,
        });

        const store = useGameStore.getState();
        store.selectHeroForAction(wenren);
        store.selectSkill('wenren_skill1');

        let current = useGameStore.getState();
        expect(current.highlightedPositions).toContainEqual([0, 4]);
        expect(current.highlightedPositions).not.toContainEqual([0, 5]);

        current.executeSkill([0, 4]);
        current = useGameStore.getState();
        expect(wenren.hasActedThisTurn).toBe(false);
        expect(getWenrenWaypoint(wenren)).toEqual([0, 4]);
        expect(current.highlightedPositions).toContainEqual([0, 5]);
        expect(current.highlightedPositions).not.toContainEqual([0, 0]);

        current.executeSkill([0, 5]);
        current = useGameStore.getState();
        expect(wenren.position).toEqual([0, 5]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
        expect(wenren.hasActedThisTurn).toBe(true);
        expect(current.selectedSkill).toBeNull();
    });
});

describe('闻人翊悬 · 昭神', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('破妄满 10 自动消耗 10 点进入两回合昭神，并排入一次额外行动', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 1]);
        addHero(state, 'moran', 'player1', [1, 1]);
        const enemy = addEnemy(state, [0, 2]);
        setWenrenPos(wenren, 9);
        setWenrenWaypoint(wenren, [1, 1]);

        SkillSystem.executeSkill(wenren, wenrenSkill1, [[0, 1]], state);

        expect(isWenrenZhaoShen(wenren)).toBe(true);
        expect(EffectManager.getEffect(wenren, '昭神')?.duration).toBe(2);
        // 触发变身的那一下仍是普通态伤害，不追补昭神加成
        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
        // 9 + 2 - 10 = 1
        expect(getWenrenPos(wenren)).toBe(1);
        expect(state.pendingExtraActionHeroIds?.player1).toBe(wenren.id);
    });

    it('昭神进入的额外行动会真的把控制权交回给他', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 1]);
        addHero(state, 'moran', 'player1', [1, 1]);
        addEnemy(state, [0, 2]);
        setWenrenPos(wenren, 9);
        useGameStore.setState({
            ...state,
            isOnlineMode: false,
            isAiMode: false,
            suppressOnlineBroadcast: false,
            moveRange: [],
            skillRange: [],
            highlightedPositions: [],
            selectedHero: null,
            selectedSkill: null,
            pendingBoardAction: undefined,
        });

        const store = useGameStore.getState();
        store.selectHeroForAction(wenren);
        store.selectSkill('wenren_skill1');
        useGameStore.getState().executeSkill([1, 1]);
        useGameStore.getState().executeSkill([0, 1]);

        const after = useGameStore.getState();
        expect(isWenrenZhaoShen(wenren)).toBe(true);
        expect(wenren.hasActedThisTurn).toBe(false);
        expect(after.activeHero?.id).toBe(wenren.id);
        expect(after.currentPlayer).toBe('player1');
    });

    it('昭神态技能一按闭环落点，伤害为 8 + 本次飞跃距离', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        const enemy = addEnemy(state, [1, 0]);
        enterZhaoShen(wenren);
        setWenrenWaypoint(wenren, [0, 4]);

        const result = SkillSystem.executeSkill(wenren, wenrenSkill1, [[0, 0]], state);

        expect(result.success).toBe(true);
        expect(result.damageDealt).toEqual([12]);
        expect(wenren.position).toEqual([0, 0]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 12);
        // 已在昭神中：破妄继续攒，不再扣 10 点，也不重复排额外行动
        expect(getWenrenPos(wenren)).toBe(4);
        expect(state.pendingExtraActionHeroIds?.player1).toBeUndefined();
    });

    it('致知二把技能一基础伤害抬到 10 点，昭神的距离伤害照加', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        const enemy = addEnemy(state, [1, 0]);
        enterZhaoShen(wenren);
        grantZhizhi(wenren, 2);
        setWenrenWaypoint(wenren, [0, 4]);

        SkillSystem.executeSkill(wenren, wenrenSkill1, [[0, 0]], state);

        // 10 基础 + 4 飞跃距离
        expect(enemy.currentHp).toBe(enemy.maxHp - 14);
    });
});

describe('闻人翊悬 · 普通态 破妄·燎原', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('伤害等于当前破妄层数，消耗一半（向上取整），每层换 5% 暴击率持续两回合', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 2]);
        const enemy = addEnemy(state, [2, 3]);
        setWenrenPos(wenren, 5);

        const result = SkillSystem.executeSkill(wenren, wenrenSkill2, [[2, 2]], state);

        expect(result.success).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 5);
        expect(getWenrenPos(wenren)).toBe(2);

        const crit = EffectManager.getEffect(wenren, '破妄暴击率');
        expect(crit?.value).toBeCloseTo(0.15);
        expect(crit?.duration).toBe(2);
    });

    it('这一发燎原不吃自己刚换来的暴击率，暴击留给后续出手', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 2]);
        const enemy = addEnemy(state, [2, 3]);
        setWenrenPos(wenren, 5);

        const result = SkillSystem.executeSkill(wenren, wenrenSkill2, [[2, 2]], state);

        // 若先把 15% 暴击率挂上再结算，random=0 会让这一发直接暴击
        expect(result.damageDealt).toEqual([5]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 5);
        expect(EffectManager.getEffect(wenren, '破妄暴击率')?.value).toBeCloseTo(0.15);
    });

    it('重复施放叠加暴击率并刷新持续时间', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 2]);
        addEnemy(state, [2, 3]);
        setWenrenPos(wenren, 2);

        SkillSystem.executeSkill(wenren, wenrenSkill2, [[2, 2]], state);
        expect(EffectManager.getEffect(wenren, '破妄暴击率')?.value).toBeCloseTo(0.05);

        SkillSystem.executeSkill(wenren, wenrenSkill2, [[2, 2]], state);
        const crit = EffectManager.getEffect(wenren, '破妄暴击率');
        expect(crit?.value).toBeCloseTo(0.1);
        expect(crit?.duration).toBe(2);
        expect(getWenrenPos(wenren)).toBe(0);
    });

    it('没有破妄时判不可用，也不能空放', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 2]);
        addEnemy(state, [2, 3]);

        expect(SkillSystem.canUseSkill(wenren, wenrenSkill2, state)).toBe(false);
        expect(SkillSystem.executeSkill(wenren, wenrenSkill2, [[2, 2]], state).success).toBe(false);
    });
});

describe('闻人翊悬 · 昭神态 破妄·燎原', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('伤害仍是破妄层数；每层暴击率提升为 10%，持续三回合', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 2]);
        const enemy = addEnemy(state, [2, 3]);
        setWenrenPos(wenren, 5);
        enterZhaoShen(wenren);

        SkillSystem.executeSkill(wenren, wenrenSkill2, [[2, 2]], state);

        // 昭神只改写暴击那一段，伤害不加倍
        expect(enemy.currentHp).toBe(enemy.maxHp - 5);
        expect(getWenrenPos(wenren)).toBe(2);
        const crit = EffectManager.getEffect(wenren, '破妄暴击率');
        expect(crit?.value).toBeCloseTo(0.3);
        expect(crit?.duration).toBe(3);
    });

    it('致知三让昭神每层暴击率再 +5%（10% → 15%）', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [2, 2]);
        addEnemy(state, [2, 3]);
        setWenrenPos(wenren, 4);
        enterZhaoShen(wenren);
        grantZhizhi(wenren, 3);

        SkillSystem.executeSkill(wenren, wenrenSkill2, [[2, 2]], state);

        // 消耗 2 层，每层 15%
        const crit = EffectManager.getEffect(wenren, '破妄暴击率');
        expect(crit?.value).toBeCloseTo(0.3);
        expect(crit?.duration).toBe(3);
    });
});

describe('闻人翊悬 · 目标高亮与电脑决策', () => {
    it('普通态第一步只亮可当中途点的友军，第二步只亮棋盘内的落点', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        // 与 [0,2] 的差值是 (3,2)，不在八方向任何一条直线上
        addHero(state, 'liuli', 'player1', [3, 4]);
        addEnemy(state, [5, 0]);

        const waypoints = SkillSystem.getValidTargetPositions(wenren, wenrenSkill1, state);
        expect(waypoints).toContainEqual([0, 4]);
        expect(waypoints).not.toContainEqual([3, 4]);

        setWenrenWaypoint(wenren, [0, 4]);
        const landings = SkillSystem.getValidTargetPositions(wenren, wenrenSkill1, state);
        expect(landings).toEqual([[0, 5]]);
    });

    it('昭神态第二步会亮出闭环接回来的落点', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        enterZhaoShen(wenren);
        setWenrenWaypoint(wenren, [0, 4]);

        const landings = SkillSystem.getValidTargetPositions(wenren, wenrenSkill1, state);

        expect(landings).toContainEqual([0, 5]);
        expect(landings).toContainEqual([0, 0]);
        expect(landings).not.toContainEqual([0, 4]);
    });

    it('电脑把普通态技能一规划成「中途点→棋盘内落点」的一整条方案', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        addEnemy(state, [1, 4]);

        const plan = chooseComputerSkillPlan(state, wenren, 'wenren_skill1');

        expect(plan).not.toBeNull();
        expect(plan!.skillId).toBe('wenren_skill1');
        expect(plan!.targetPositions).toHaveLength(2);
        expect(plan!.targetPositions).toEqual([[0, 4], [0, 5]]);
        expect(plan!.score).toBeGreaterThan(0);
    });

    it('电脑在昭神态会考虑闭环回来、能打到人的落点', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        addEnemy(state, [0, 1]);
        enterZhaoShen(wenren);

        const plan = chooseComputerSkillPlan(state, wenren, 'wenren_skill1');

        expect(plan).not.toBeNull();
        expect(plan!.targetPositions[0]).toEqual([0, 4]);
        expect(plan!.targetPositions[1]).toEqual([0, 0]);
        expect(plan!.score).toBeGreaterThan(0);
    });

    it('电脑的第二段只枚举已锁定中途点身后的落点', () => {
        const state = makeGameState();
        const wenren = addHero(state, 'wenren', 'player1', [0, 2]);
        addHero(state, 'moran', 'player1', [0, 4]);
        addHero(state, 'liuli', 'player1', [2, 0]);
        addEnemy(state, [1, 4]);
        setWenrenWaypoint(wenren, [0, 4]);

        const plan = chooseComputerSkillPlan(state, wenren, 'wenren_skill1');

        expect(plan).not.toBeNull();
        expect(plan!.targetPositions[0]).toEqual([0, 4]);
        expect(plan!.targetPositions[1]).toEqual([0, 5]);
    });
});
