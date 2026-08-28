import { afterEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { MovementSystem } from '../../src/core/movement-system';
import { SkillSystem } from '../../src/core/skill-system';
import { useGameStore } from '../../src/store/game-store';
import { zuizhendaoSkill1, zuizhendaoSkill2 } from '../../src/data/extended-skills';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('醉枕刀技能与天威', () => {
    afterEach(() => vi.restoreAllMocks());

    it('技能1沿直线路径踩过敌人，造成6伤害并获得等量醉意，最终到达刀落点', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const enemyA = addHero(state, 'moran', 'player2', [2, 3]);
        const enemyB = addHero(state, 'baize', 'player2', [2, 4]);
        zui.counters['__zuizhendao_skill1_dir'] = 3; // 向右掷刀，刀落 [2,5]
        const result = SkillSystem.executeSkill(zui, zuizhendaoSkill1, [], state);
        expect(result.success).toBe(true);
        expect(zui.position).toEqual([2, 5]);
        expect(enemyA.currentHp).toBe(enemyA.maxHp - 6);
        expect(enemyB.currentHp).toBe(enemyB.maxHp - 6);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(2);
    });

    it('技能1刀落点被占据时失败', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [2, 5]); // 占据刀落点
        zui.counters['__zuizhendao_skill1_dir'] = 3;
        const result = SkillSystem.executeSkill(zui, zuizhendaoSkill1, [], state);
        expect(result.success).toBe(false);
        expect(zui.position).toEqual([2, 2]);
    });

    it('技能1刀飞出棋盘时失败', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [0, 0]);
        zui.counters['__zuizhendao_skill1_dir'] = 0; // 向上掷刀，出界
        const result = SkillSystem.executeSkill(zui, zuizhendaoSkill1, [], state);
        expect(result.success).toBe(false);
    });

    it('技能1路径会绕路踩更多敌人（7步上限）', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 0]);
        // 直线方向被友方挡死，绕路踩敌人
        addHero(state, 'liuli', 'player1', [2, 1]); // 友方挡路
        const enemyA = addHero(state, 'moran', 'player2', [1, 1]);
        const enemyB = addHero(state, 'baize', 'player2', [1, 2]);
        zui.counters['__zuizhendao_skill1_dir'] = 3; // 向右，刀落 [2,3]
        const result = SkillSystem.executeSkill(zui, zuizhendaoSkill1, [], state);
        expect(result.success).toBe(true);
        // 路径绕上：踩过 A、B
        expect(enemyA.currentHp).toBe(enemyA.maxHp - 6);
        expect(enemyB.currentHp).toBe(enemyB.maxHp - 6);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(2);
        expect(zui.position).toEqual([2, 3]);
    });

    it('技能2与友方交换位置，对周围一圈敌人造成8伤害并获得命中数醉意', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const ally = addHero(state, 'libai', 'player1', [4, 4]);
        const enemyA = addHero(state, 'moran', 'player2', [4, 3]);
        const enemyB = addHero(state, 'baize', 'player2', [3, 4]);
        const result = SkillSystem.executeSkill(zui, zuizhendaoSkill2, [[4, 4]], state);
        expect(result.success).toBe(true);
        expect(zui.position).toEqual([4, 4]);
        expect(ally.position).toEqual([2, 2]);
        expect(enemyA.currentHp).toBe(enemyA.maxHp - 8);
        expect(enemyB.currentHp).toBe(enemyB.maxHp - 8);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(2);
    });

    it('被动：高醉意概率闪避免伤，不减少醉意', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const attacker = addHero(state, 'moran', 'player2', [2, 3]);
        EffectManager.setCounter(zui, '醉意', 5); // 50% 闪避
        vi.spyOn(Math, 'random').mockReturnValue(0); // 触发闪避
        const before = zui.currentHp;
        const damage = DamageCalculator.calculate(attacker, zui, 10);
        DamageCalculator.applyDamage(zui, damage, attacker, state);
        expect(zui.currentHp).toBe(before);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(5);
    });

    it('被动：未闪避时承受伤害并反击醉意x3真实伤害，醉意-1', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const attacker = addHero(state, 'moran', 'player2', [2, 3]);
        attacker.defense = 0.5;
        EffectManager.setCounter(zui, '醉意', 2);
        vi.spyOn(Math, 'random').mockReturnValue(0.99); // 不闪避
        const beforeZui = zui.currentHp;
        const beforeAttacker = attacker.currentHp;
        const damage = DamageCalculator.calculate(attacker, zui, 10);
        DamageCalculator.applyDamage(zui, damage, attacker, state);
        expect(zui.currentHp).toBe(beforeZui - 10);
        // 反击 2x3 = 6 真实伤害（无视 50% 防御）
        expect(beforeAttacker - attacker.currentHp).toBe(6);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(1);
    });

    it('天威：击杀敌人后获得3点醉意', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);
        victim.currentHp = 1;
        const damage = DamageCalculator.calculate(zui, victim, 5);
        DamageCalculator.applyDamage(victim, damage, zui, state);
        expect(victim.state).toBe(HeroState.DEAD);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(3);
    });

    it('醉意上限6层：技能1在5层时踩过2敌只叠到6层，伤害照常', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const enemyA = addHero(state, 'moran', 'player2', [2, 3]);
        const enemyB = addHero(state, 'baize', 'player2', [2, 4]);
        EffectManager.setCounter(zui, '醉意', 5);
        zui.counters['__zuizhendao_skill1_dir'] = 3; // 向右掷刀，刀落 [2,5]
        const result = SkillSystem.executeSkill(zui, zuizhendaoSkill1, [], state);
        expect(result.success).toBe(true);
        expect(enemyA.currentHp).toBe(enemyA.maxHp - 6);
        expect(enemyB.currentHp).toBe(enemyB.maxHp - 6);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(6);
        expect(result.log.join()).toContain('已达上限6层');
    });

    it('醉意上限6层：技能2与天威在满层时不再叠加', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const ally = addHero(state, 'libai', 'player1', [4, 4]);
        addHero(state, 'moran', 'player2', [4, 3]);
        addHero(state, 'baize', 'player2', [3, 4]);
        EffectManager.setCounter(zui, '醉意', 6);
        const result = SkillSystem.executeSkill(zui, zuizhendaoSkill2, [[4, 4]], state);
        expect(result.success).toBe(true);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(6);

        const victim = [...state.player2Heroes].find(h => h.name === '墨阑')!;
        victim.currentHp = 1;
        const damage = DamageCalculator.calculate(zui, victim, 5);
        DamageCalculator.applyDamage(victim, damage, zui, state);
        expect(victim.state).toBe(HeroState.DEAD);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(6);
    });
});

describe('醉枕刀被动2：踩过带醉意友方格（store）', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
        vi.restoreAllMocks();
    });

    it('移动路径踩过带醉意友方：交换1层醉意并保持可再次移动', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const libai = addHero(state, 'libai', 'player1', [2, 3]);
        EffectManager.setCounter(libai, '醉意', 2);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined,
            suppressOnlineBroadcast: false,
            libaiChainState: undefined,
        });
        const store = useGameStore.getState();
        store.selectHeroForAction(zui);
        store.showMoveRange();
        // 醉枕刀特权：可穿过带醉意友方格到达 [2,4]
        expect(MovementSystem.getMovablePositions(zui, useGameStore.getState() as any))
            .toEqual(expect.arrayContaining([[2, 4]]));
        store.moveHero([2, 4]);
        const stateAfter = useGameStore.getState();
        expect(zui.position).toEqual([2, 4]);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(1);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(1);
        expect(zui.hasMovedThisTurn).toBe(false); // 可再次移动
    });

    it('醉枕刀满6层时踩过带醉意友方：交换照常发生，超出部分作废但仍可再次移动', () => {
        const state = makeGameState();
        const zui = addHero(state, 'zuizhendao', 'player1', [2, 2]);
        const libai = addHero(state, 'libai', 'player1', [2, 3]);
        EffectManager.setCounter(libai, '醉意', 2);
        EffectManager.setCounter(zui, '醉意', 6);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined,
            suppressOnlineBroadcast: false,
            libaiChainState: undefined,
        });
        const store = useGameStore.getState();
        store.selectHeroForAction(zui);
        store.showMoveRange();
        store.moveHero([2, 4]);
        const stateAfter = useGameStore.getState();
        expect(zui.position).toEqual([2, 4]);
        expect(EffectManager.getCounter(libai, '醉意')).toBe(1);
        expect(EffectManager.getCounter(zui, '醉意')).toBe(6);
        expect(zui.hasMovedThisTurn).toBe(false); // 再次移动照常触发
    });
});
