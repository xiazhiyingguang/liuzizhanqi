import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { MovementSystem } from '../../src/core/movement-system';
import { SkillSystem } from '../../src/core/skill-system';
import { chooseComputerSkillPlan } from '../../src/core/computer-ai';
import { useGameStore } from '../../src/store/game-store';
import {
    addDilanFeather,
    getDilanFeatherStacks,
} from '../../src/data/extended-heroes';
import {
    EXTENDED_SKILLS,
    getNanfengLineDescription,
    nanfengSkill1,
    nanfengSkill2,
} from '../../src/data/extended-skills';
import {
    createWindLane,
    getWindLaneDodgeRate,
    lanesAtPosition,
    windLaneCells,
} from '../../src/core/wind-lane';
import { GameState, Hero, HeroState, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/** 把一条横向风道铺满整行 */
function laneOnRow(state: GameState, caster: Hero, row: number, dir: 'left' | 'right') {
    createWindLane(state, caster, [row, 0], dir);
}

describe('南风完整机制', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('拥有48生命、3移动力与完整技能注册', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [2, 2]);

        expect(nanfeng.name).toBe('南风');
        expect(nanfeng.class).toBe('化识');
        expect(nanfeng.maxHp).toBe(48);
        expect(nanfeng.moveRange).toBe(3);
        expect(nanfeng.skill1Id).toBe('nanfeng_skill1');
        expect(nanfeng.skill2Id).toBe('nanfeng_skill2');
        expect(nanfeng.passiveId).toBe('nanfeng_passive');
        expect(nanfeng.tianweiId).toBe('nanfeng_tianwei');
        expect(EXTENDED_SKILLS.nanfeng_skill1.name).toBe('扶摇');
        expect(EXTENDED_SKILLS.nanfeng_skill2.name).toBe('引风成道');
    });

    it('扶摇：3×3内的敌人受4点伤害、1层羽化并被径向吹散1格', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [0, 0]);
        const west = addHero(state, 'baize', 'player2', [3, 3]);
        const south = addHero(state, 'moran', 'player2', [4, 4]);
        const edge = addHero(state, 'zhenxiao', 'player2', [3, 5]);
        const ally = addHero(state, 'fengling', 'player1', [4, 5]);
        const outside = addHero(state, 'dilan', 'player2', [0, 5]);

        const result = SkillSystem.executeSkill(nanfeng, nanfengSkill1, [[3, 4]], state);

        expect(result.success).toBe(true);
        expect(west.position).toEqual([3, 2]);
        expect(south.position).toEqual([5, 4]);
        expect(edge.position).toEqual([3, 5]);          // 越界：原地不动
        expect(state.board[3][2]).toBe(west);
        expect(state.board[3][5]).toBe(edge);
        expect(getDilanFeatherStacks(west)).toBe(1);
        expect(getDilanFeatherStacks(edge)).toBe(1);
        // 被吹散算位移：额外吃1点羽化固定伤害
        expect(west.currentHp).toBe(west.maxHp - 5);
        expect(edge.currentHp).toBe(edge.maxHp - 4);
        expect(ally.currentHp).toBe(ally.maxHp);
        expect(ally.position).toEqual([4, 5]);
        expect(outside.currentHp).toBe(outside.maxHp);
    });

    it('扶摇：风眼不被吹动，落点无人时允许空放', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [0, 0]);
        const eye = addHero(state, 'baize', 'player2', [2, 2]);

        const result = SkillSystem.executeSkill(nanfeng, nanfengSkill1, [[2, 2]], state);

        expect(result.success).toBe(true);
        expect(eye.position).toEqual([2, 2]);
        expect(getDilanFeatherStacks(eye)).toBe(1);
        expect(eye.currentHp).toBe(eye.maxHp - 4);

        const empty = SkillSystem.executeSkill(nanfeng, nanfengSkill1, [[5, 5]], state);
        expect(empty.success).toBe(true);
        expect(empty.damageDealt ?? []).toHaveLength(0);
    });

    it('扶摇：落点范围为以南风为中心的5×5方盒且含脚下格', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [3, 3]);

        const range = SkillSystem.getValidTargetPositions(nanfeng, nanfengSkill1);

        expect(range).toHaveLength(25);
        expect(range).toContainEqual([3, 3] as Position);
        expect(range).toContainEqual([1, 1] as Position);
        expect(range).toContainEqual([5, 5] as Position);
        expect(range).not.toContainEqual([0, 5] as Position);
    });

    it('引风成道：横向铺满整行、纵向铺满整列，同线重复释放会替换', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [2, 2]);

        nanfeng.counters['__nanfeng_skill2_dir'] = 3;   // 向东 → 第1行
        const first = SkillSystem.executeSkill(nanfeng, nanfengSkill2, [[1, 5]], state);
        expect(first.success).toBe(true);
        expect(nanfeng.counters['__nanfeng_skill2_dir']).toBeUndefined();
        expect(windLaneCells('right', [1, 0]).every(cell => lanesAtPosition(state, cell).length === 1)).toBe(true);
        expect(lanesAtPosition(state, [1, 0])[0].direction).toBe('right');
        expect(lanesAtPosition(state, [1, 0])[0].owner).toBe('player1');
        expect(lanesAtPosition(state, [2, 2])).toHaveLength(0);   // 行取点击格，不是南风所在行

        nanfeng.counters['__nanfeng_skill2_dir'] = 1;   // 向南 → 第4列
        SkillSystem.executeSkill(nanfeng, nanfengSkill2, [[4, 4]], state);
        expect(lanesAtPosition(state, [0, 4])[0].direction).toBe('down');

        nanfeng.counters['__nanfeng_skill2_dir'] = 2;   // 向西 → 再次铺第1行
        SkillSystem.executeSkill(nanfeng, nanfengSkill2, [[1, 1]], state);
        const rowLanes = (state.boardEffects ?? []).filter(
            effect =>
                effect.type === 'wind-lane' &&
                (effect.direction === 'left' || effect.direction === 'right') &&
                effect.position[0] === 1
        );
        expect(rowLanes).toHaveLength(6);
        expect(new Set(rowLanes.map(effect => effect.linkId)).size).toBe(1);
        expect(rowLanes.every(effect => effect.direction === 'left')).toBe(true);
        expect(lanesAtPosition(state, [0, 4])).toHaveLength(1);   // 另一条线不受影响
        expect(getNanfengLineDescription('left', [1, 0])).toBe('第2行');
    });

    it('风道常驻：多轮开始既不递减也不被过期清理', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [2, 2]);
        laneOnRow(state, nanfeng, 2, 'right');
        state.boardEffects = [...(state.boardEffects ?? []), {
            id: 'blade-test',
            type: 'blade-mark',
            position: [0, 0] as Position,
            owner: 'player1',
            sourceHeroId: nanfeng.id,
            duration: 2,
        }];

        GameEngine.startNewTurn(state);
        GameEngine.startNewTurn(state);
        GameEngine.startNewTurn(state);

        expect(lanesAtPosition(state, [2, 5])).toHaveLength(1);
        expect(state.boardEffects.some(effect => effect.id === 'blade-test')).toBe(false);
    });

    it('友方在风道内免费滑行，进/出风道仍按格消耗移动力', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [5, 5]);
        const ally = addHero(state, 'moran', 'player1', [0, 0]);
        laneOnRow(state, nanfeng, 0, 'right');

        const farEnd: Position = [0, 5];
        expect(MovementSystem.getManhattanDistance(ally.position!, farEnd)).toBeGreaterThan(ally.moveRange);
        expect(MovementSystem.getMovablePositions(ally, state)).toContainEqual(farEnd);
        expect(MovementSystem.getMovablePositions(ally, state)).toContainEqual([1, 5] as Position);
        expect(MovementSystem.getMovablePositions(ally, state)).not.toContainEqual([5, 5] as Position);

        expect(MovementSystem.moveHero(ally, farEnd, state)).toBe(true);
        expect(ally.position).toEqual(farEnd);
    });

    it('敌方与对手风道不产生免费移动', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [5, 5]);
        const enemy = addHero(state, 'baize', 'player2', [0, 0]);
        laneOnRow(state, nanfeng, 0, 'right');

        expect(
            MovementSystem.getMovablePositions(enemy, state)
        ).not.toContainEqual([0, 5] as Position);
    });

    it('风道内滑行逐格触发羽化固定伤害', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player2', [5, 5]);
        const nanfeng = addHero(state, 'nanfeng', 'player1', [4, 4]);
        const ally = addHero(state, 'moran', 'player1', [0, 0]);
        laneOnRow(state, nanfeng, 0, 'right');
        addDilanFeather(ally, dilan);

        expect(MovementSystem.moveHero(ally, [0, 5], state)).toBe(true);
        expect(ally.currentHp).toBe(ally.maxHp - 5);
    });

    it('敌人在风道内行动结束时顺风吹偏1格，受阻或出界则不动', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [5, 5]);
        const pushed = addHero(state, 'baize', 'player2', [2, 1]);
        const blocked = addHero(state, 'moran', 'player2', [2, 3]);
        const atEdge = addHero(state, 'zhenxiao', 'player2', [2, 5]);
        const ally = addHero(state, 'fengling', 'player1', [2, 4]);
        laneOnRow(state, nanfeng, 2, 'right');

        GameEngine.endHeroAction(pushed, state);
        GameEngine.endHeroAction(blocked, state);
        GameEngine.endHeroAction(atEdge, state);
        GameEngine.endHeroAction(ally, state);

        expect(pushed.position).toEqual([2, 2]);
        expect(blocked.position).toEqual([2, 3]);   // 下风格被占据：原地不动
        expect(atEdge.position).toEqual([2, 5]);    // 出界：原地不动
        expect(ally.position).toEqual([2, 4]);      // 己方风道不推自己人
    });

    it('羽化目标被风道推移时按位移格数结算固定伤害', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [5, 0]);
        const nanfeng = addHero(state, 'nanfeng', 'player1', [5, 5]);
        const victim = addHero(state, 'moran', 'player2', [3, 3]);
        addDilanFeather(victim, dilan);
        laneOnRow(state, nanfeng, 3, 'right');

        GameEngine.endHeroAction(victim, state);

        expect(victim.position).toEqual([3, 4]);
        expect(victim.currentHp).toBe(victim.maxHp - 1);
    });

    it('御风：身处的每道风道+25%闪避，上限50%，固定伤害无视', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [2, 2]);
        const attacker = addHero(state, 'fengling', 'player2', [0, 0]);
        const dilan = addHero(state, 'dilan', 'player2', [5, 0]);
        expect(getWindLaneDodgeRate(state, nanfeng)).toBe(0);
        expect(getWindLaneDodgeRate(state, attacker)).toBe(0);

        laneOnRow(state, nanfeng, 2, 'right');
        expect(getWindLaneDodgeRate(state, nanfeng)).toBe(0.25);

        createWindLane(state, dilan, [2, 2], 'down');   // 对手铺的风道同样算数
        expect(getWindLaneDodgeRate(state, nanfeng)).toBe(0.5);
        laneOnRow(state, dilan, 2, 'left');             // 同线替换，不会叠出第三道
        expect(getWindLaneDodgeRate(state, nanfeng)).toBe(0.5);

        vi.mocked(Math.random).mockReturnValue(0.1);
        const before = nanfeng.currentHp;
        const strike = DamageCalculator.calculate(attacker, nanfeng, 8, false);
        DamageCalculator.applyDamage(nanfeng, strike, attacker, state);
        expect(nanfeng.currentHp).toBe(before);
        expect(state.battleLog.some(entry => entry.message.includes('御风而起'))).toBe(true);

        addDilanFeather(nanfeng, dilan);
        DamageCalculator.applyDilanMovementDamage(nanfeng, 1, state);
        expect(nanfeng.currentHp).toBe(before - 1);
    });

    it('天威：击杀时按敌方更密的一侧自动铺开纵横两道风道', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [2, 3]);
        const victim = addHero(state, 'baize', 'player2', [2, 5]);
        addHero(state, 'moran', 'player2', [2, 0]);
        addHero(state, 'zhenxiao', 'player2', [1, 0]);
        victim.currentHp = 1;

        const lethal = DamageCalculator.calculate(nanfeng, victim, 30, false);
        DamageCalculator.applyDamage(victim, lethal, nanfeng, state);

        const crossing = lanesAtPosition(state, [2, 3]);
        expect(crossing).toHaveLength(2);
        expect(crossing.map(lane => lane.direction).sort()).toEqual(['left', 'up']);
        expect(lanesAtPosition(state, [5, 3])).toHaveLength(1);   // 第3列整列成风道
        expect(lanesAtPosition(state, [2, 0])).toHaveLength(1);   // 第2行整行成风道
        expect(state.battleLog.some(entry => entry.message.includes('纵横风起'))).toBe(true);
    });

    it('南风阵亡：风止道散', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [2, 2]);
        const killer = addHero(state, 'fengling', 'player2', [0, 0]);
        laneOnRow(state, nanfeng, 2, 'right');
        nanfeng.currentHp = 1;

        const lethal = DamageCalculator.calculate(killer, nanfeng, 20, false);
        DamageCalculator.applyDamage(nanfeng, lethal, killer, state);

        expect(nanfeng.state).toBe(HeroState.DEAD);
        expect((state.boardEffects ?? []).filter(effect => effect.type === 'wind-lane')).toHaveLength(0);
    });

    it('交互：定风向→点行列格，风道落地后正常结束行动', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [2, 2]);
        addHero(state, 'baize', 'player1', [5, 0]);
        addHero(state, 'moran', 'player2', [5, 5]);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            suppressOnlineBroadcast: false,
        });
        const laneCells = () => (useGameStore.getState().boardEffects ?? [])
            .filter(effect => effect.type === 'wind-lane');

        useGameStore.getState().selectHeroForAction(nanfeng);
        useGameStore.getState().selectSkill(nanfeng.skill2Id);
        expect(useGameStore.getState().highlightedPositions).toHaveLength(4);   // 上下左右四个风向

        useGameStore.getState().executeSkill([1, 2]);                           // 向北
        expect(nanfeng.counters['__nanfeng_skill2_dir']).toBe(0);
        expect(nanfeng.hasActedThisTurn).toBe(false);
        expect(laneCells()).toHaveLength(0);
        expect(useGameStore.getState().highlightedPositions).toHaveLength(36);  // 全场任选行列

        useGameStore.getState().executeSkill([4, 4]);                           // 沿第4列铺开
        expect(nanfeng.counters['__nanfeng_skill2_dir']).toBeUndefined();
        expect(laneCells()).toHaveLength(6);
        expect(laneCells().every(effect => effect.direction === 'up')).toBe(true);
        expect(nanfeng.hasActedThisTurn).toBe(true);
        expect(useGameStore.getState().currentPlayer).toBe('player2');
    });

    it('电脑能够为旋风与引风成道生成可执行方案', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player2', [3, 3]);
        addHero(state, 'baize', 'player1', [3, 5]);
        addHero(state, 'moran', 'player1', [2, 4]);

        expect(chooseComputerSkillPlan(state, nanfeng, nanfeng.skill1Id)).not.toBeNull();
        const plan = chooseComputerSkillPlan(state, nanfeng, nanfeng.skill2Id);
        expect(plan).not.toBeNull();
        expect(plan!.targetPositions).toHaveLength(2);
    });
});
