import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { chooseComputerSkillPlan } from '../../src/core/computer-ai';
import { MovementSystem } from '../../src/core/movement-system';
import { SkillSystem } from '../../src/core/skill-system';
import {
    addDilanFeather,
    getDilanFeatherStacks,
} from '../../src/data/extended-heroes';
import { dilanSkill1, dilanSkill2, zuizhendaoSkill2 } from '../../src/data/extended-skills';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';

describe('帝兰完整机制', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('拥有48生命、3移动与完整技能注册', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 2]);
        expect(dilan.name).toBe('帝兰');
        expect(dilan.class).toBe('天师');
        expect(dilan.maxHp).toBe(48);
        expect(dilan.moveRange).toBe(3);
        expect(dilan.skill1Id).toBe('dilan_skill1');
        expect(dilan.skill2Id).toBe('dilan_skill2');
    });

    it('技能1选择整行：伤害敌人并施加逆风，为友方施加顺风', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 0]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        const offAxis = addHero(state, 'zhenxiao', 'player2', [3, 4]);
        dilan.counters['__dilan_skill1_axis'] = 0;

        const result = SkillSystem.executeSkill(dilan, dilanSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 3);
        expect(getDilanFeatherStacks(enemy, dilan.id)).toBe(1);
        expect(enemy.effects.find(effect => effect.name === '逆风')?.stackCount).toBe(1);
        expect(ally.effects.find(effect => effect.name === '顺风')?.stackCount).toBe(1);
        expect(offAxis.currentHp).toBe(offAxis.maxHp);
    });

    it('顺风与逆风按层数改变实际可移动距离', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [3, 3]);
        const ally = addHero(state, 'moran', 'player1', [3, 1]);
        const enemy = addHero(state, 'baize', 'player2', [3, 5]);
        dilan.counters['__dilan_skill1_axis'] = 0;
        SkillSystem.executeSkill(dilan, dilanSkill1, [[3, 4]], state);

        expect(MovementSystem.getMovablePositions(ally, state).some(([r, c]) => r === 0 && c === 1)).toBe(true);
        expect(MovementSystem.getMovablePositions(enemy, state).every(position =>
            MovementSystem.getManhattanDistance(enemy.position!, position) <= 1
        )).toBe(true);
    });

    it('羽化目标每移动1格受到1点无视防御的固定伤害', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [5, 5]);
        const enemy = addHero(state, 'baize', 'player2', [0, 0]);
        enemy.defense = 0.9;
        addDilanFeather(enemy, dilan);

        expect(MovementSystem.moveHero(enemy, [0, 2], state)).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 2);
    });

    it('致知3把羽化逐格固定伤害从1提高到2', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [5, 5]);
        const enemy = addHero(state, 'baize', 'player2', [0, 0]);
        dilan.counters['talent_3'] = 1;
        addDilanFeather(enemy, dilan);

        expect(MovementSystem.moveHero(enemy, [0, 2], state)).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 4);
    });

    it('羽化固定伤害无视护盾、闪避与援护转移', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [5, 5]);
        const target = addHero(state, 'mowen', 'player2', [0, 0]);
        const guardian = addHero(state, 'liuli', 'player2', [1, 0]);
        target.shield = 10;
        target.effects.push({
            id: 'dilan-fixed-damage-guard',
            type: 'buff',
            name: '援护',
            duration: 1,
            sourceHeroId: guardian.id,
        });
        addDilanFeather(target, dilan);
        vi.mocked(Math.random).mockReturnValue(0);

        DamageCalculator.applyDilanMovementDamage(target, 2, state);

        expect(target.currentHp).toBe(target.maxHp - 2);
        expect(target.shield).toBe(10);
        expect(guardian.currentHp).toBe(guardian.maxHp);
    });

    it('交换位置的双方都按位移格数触发羽化', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [5, 5]);
        const caster = addHero(state, 'zuizhendao', 'player2', [0, 0]);
        const ally = addHero(state, 'baize', 'player2', [0, 3]);
        addDilanFeather(caster, dilan);
        addDilanFeather(ally, dilan);

        const output = SkillSystem.executeSkill(caster, zuizhendaoSkill2, [ally.position!], state);

        expect(output.success).toBe(true);
        expect(caster.position).toEqual([0, 3]);
        expect(ally.position).toEqual([0, 0]);
        expect(caster.currentHp).toBe(caster.maxHp - 3);
        expect(ally.currentHp).toBe(ally.maxHp - 3);
    });

    it('3层羽化在下次技能命中时引爆并清空，致知1按4×3结算', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        dilan.counters['talent_1'] = 1;
        addDilanFeather(enemy, dilan, 3);
        dilan.counters['__dilan_skill1_axis'] = 0;

        const result = SkillSystem.executeSkill(dilan, dilanSkill1, [[2, 3]], state);

        expect(result.damageDealt).toEqual([12]);
        expect(enemy.currentHp).toBe(enemy.maxHp - 12);
        expect(getDilanFeatherStacks(enemy, dilan.id)).toBe(0);
    });

    it('技能2命中前方2×3，并从远到近将同列敌人各击退1格', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [4, 2]);
        const nearEnemy = addHero(state, 'baize', 'player2', [3, 2]);
        const farEnemy = addHero(state, 'moran', 'player2', [2, 2]);
        dilan.counters['__dilan_skill2_dir'] = 0;

        const result = SkillSystem.executeSkill(dilan, dilanSkill2, [[3, 2]], state);

        expect(result.damageDealt).toEqual([3, 3]);
        expect(farEnemy.position).toEqual([1, 2]);
        expect(nearEnemy.position).toEqual([2, 2]);
        expect(farEnemy.currentHp).toBe(farEnemy.maxHp - 4);
        expect(nearEnemy.currentHp).toBe(nearEnemy.maxHp - 4);
        expect(getDilanFeatherStacks(farEnemy, dilan.id)).toBe(1);
        expect(getDilanFeatherStacks(nearEnemy, dilan.id)).toBe(1);
    });

    it('技能2遇到边界或占位时保留目标原位置', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [1, 2]);
        addHero(state, 'moran', 'player2', [0, 2]);
        dilan.counters['__dilan_skill2_dir'] = 0;

        SkillSystem.executeSkill(dilan, dilanSkill2, [[1, 2]], state);
        expect(enemy.position).toEqual([1, 2]);
    });

    it('天威以阵亡位置为中心造成5伤害并施加羽化与逆风', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 0]);
        const victim = addHero(state, 'moran', 'player2', [2, 2]);
        const nearby = addHero(state, 'baize', 'player2', [2, 3]);
        const farAway = addHero(state, 'zhenxiao', 'player2', [5, 5]);
        victim.currentHp = 1;

        const lethal = DamageCalculator.calculate(dilan, victim, 3, false);
        DamageCalculator.applyDamage(victim, lethal, dilan, state);

        expect(nearby.currentHp).toBe(nearby.maxHp - 5);
        expect(getDilanFeatherStacks(nearby, dilan.id)).toBe(1);
        expect(nearby.effects.some(effect => effect.name === '逆风')).toBe(true);
        expect(farAway.currentHp).toBe(farAway.maxHp);
    });

    it('天威风暴引爆3层羽化，基础伤害变为5×3，随后重新施加1层', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 0]);
        const victim = addHero(state, 'moran', 'player2', [2, 2]);
        const nearby = addHero(state, 'baize', 'player2', [2, 3]);
        victim.currentHp = 1;
        addDilanFeather(nearby, dilan, 3);

        const lethal = DamageCalculator.calculate(dilan, victim, 3, false);
        DamageCalculator.applyDamage(victim, lethal, dilan, state);

        expect(nearby.currentHp).toBe(nearby.maxHp - 15);
        expect(getDilanFeatherStacks(nearby, dilan.id)).toBe(1);
    });

    it('风暴击杀敌人会以新阵亡位置继续触发天威', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 0]);
        const victim = addHero(state, 'moran', 'player2', [2, 2]);
        const firstStormVictim = addHero(state, 'baize', 'player2', [2, 3]);
        const chainedTarget = addHero(state, 'zhenxiao', 'player2', [2, 4]);
        victim.currentHp = 1;
        firstStormVictim.currentHp = 5;

        const lethal = DamageCalculator.calculate(dilan, victim, 3, false);
        DamageCalculator.applyDamage(victim, lethal, dilan, state);

        expect(firstStormVictim.state).toBe('dead');
        expect(chainedTarget.currentHp).toBe(chainedTarget.maxHp - 5);
    });

    it('战斗方向交互：上下选择列且释放后正常结束行动', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [0, 2]);
        addHero(state, 'moran', 'player1', [5, 0]);
        addHero(state, 'zhenxiao', 'player2', [5, 5]);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            suppressOnlineBroadcast: false,
        });

        useGameStore.getState().selectHeroForAction(dilan);
        useGameStore.getState().selectSkill(dilan.skill1Id);
        useGameStore.getState().executeSkill([1, 2]);

        expect(enemy.currentHp).toBe(enemy.maxHp - 3);
        expect(dilan.hasActedThisTurn).toBe(true);
        expect(useGameStore.getState().currentPlayer).toBe('player2');
    });

    it('电脑能够为两个方向技能生成可执行方案', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player2', [3, 3]);
        addHero(state, 'baize', 'player1', [2, 2]);
        addHero(state, 'moran', 'player1', [3, 0]);

        expect(chooseComputerSkillPlan(state, dilan, dilan.skill1Id)).not.toBeNull();
        expect(chooseComputerSkillPlan(state, dilan, dilan.skill2Id)).not.toBeNull();
    });

    it('带羽化的移动不可撤回，移动伤害致死时自动结束该角色行动', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const dilan = addHero(state, 'dilan', 'player1', [5, 5]);
        addHero(state, 'moran', 'player1', [4, 5]);
        const enemy = addHero(state, 'baize', 'player2', [0, 0]);
        addHero(state, 'zhenxiao', 'player2', [5, 0]);
        enemy.currentHp = 1;
        addDilanFeather(enemy, dilan);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            suppressOnlineBroadcast: false,
        });

        useGameStore.getState().selectHeroForAction(enemy);
        useGameStore.getState().showMoveRange();
        useGameStore.getState().moveHero([0, 1]);

        expect(enemy.state).toBe('dead');
        expect(enemy.counters['__move_from']).toBeUndefined();
        expect(useGameStore.getState().currentPlayer).toBe('player1');
        expect(useGameStore.getState().activeHero).toBeNull();
    });
});
