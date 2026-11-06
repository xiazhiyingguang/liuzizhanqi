import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHero, makeGameState } from '../helpers/game-state';
import { SkillSystem } from '../../src/core/skill-system';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { CANGLAN_SKILL1, CANGLAN_SKILL2, canglanChance, canglanForm, canglanCells, lockCanglanCast } from '../../src/core/canglan';
import { getSkill } from '../../src/data/skills';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { useGameStore, createOnlineStateSnapshot } from '../../src/store/game-store';
import { applyServerGameState } from '../../src/services/online-state';
import { runComputerOpponentStep } from '../../src/hooks/useComputerOpponent';
import { HERO_CODEX } from '../../src/data/hero-codex';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import type { Position } from '../../src/types/game';

const one = getSkill(CANGLAN_SKILL1)!, two = getSkill(CANGLAN_SKILL2)!;
function fixture(owner: 'player1' | 'player2' = 'player1') {
    const state = makeGameState({ currentPlayer: owner }), hero = addHero(state, 'canglan', owner, [2, 2]);
    const foe = (p: Position, hp = 40) => {
        const unit = addHero(state, 'moran', owner === 'player1' ? 'player2' : 'player1', p);
        unit.currentHp = hp; unit.defense = 0; unit.passiveId = ''; unit.tianweiId = ''; return unit;
    };
    return { state, hero, foe };
}
beforeEach(() => { useGameStore.getState().resetGame(); vi.spyOn(Math, 'random').mockReturnValue(.99); });
afterEach(() => { useGameStore.getState().resetGame(); vi.restoreAllMocks(); });

describe('顾行舟', () => {
    it('可选将、图鉴可读，生命50移动2，致知一只加8', () => {
        const { hero } = fixture();
        expect(AVAILABLE_HERO_IDS).toContain('canglan'); expect(HERO_CODEX.some(h => h.id === 'canglan')).toBe(true);
        expect(hero.maxHp).toBe(50); expect(hero.moveRange).toBe(2);
        grantZhizhi(hero, 1); grantZhizhi(hero, 1); expect(hero.maxHp).toBe(58);
    });
    it('普通截潮能打对角相邻单体，只加潮锋；保留25%概率', () => {
        const { state, hero, foe } = fixture(), near = foe([3, 3]), far = foe([4, 4]);
        expect(SkillSystem.executeSkill(hero, one, [[3, 3]], state).success).toBe(true);
        expect(near.currentHp).toBe(32); expect(far.currentHp).toBe(40);
        expect(hero.counters['潮锋']).toBe(1); expect(hero.counters['凝水']).toBeUndefined();
        expect(canglanChance(hero)).toBe(50);
    });
    it('普通回澜只打3×3，多个命中仍只叠一层凝水', () => {
        const { state, hero, foe } = fixture(), a = foe([1,1]), b = foe([3,3]), out = foe([0,0]);
        expect(SkillSystem.executeSkill(hero, two, [[2,2]], state).success).toBe(true);
        expect([a.currentHp,b.currentHp,out.currentHp]).toEqual([36,36,40]); expect(hero.counters['凝水']).toBe(1);
    });
    it('幻化截潮斜贯两格，非同线敌人不受伤，增伤吸血一起花掉', () => {
        const { state, hero, foe } = fixture(), near = foe([3,3]), far = foe([4,4]), outside = foe([2,4]);
        hero.currentHp = 20; hero.counters['潮锋'] = 2; hero.counters['凝水'] = 1;
        vi.mocked(Math.random).mockReturnValueOnce(0);
        expect(SkillSystem.executeSkill(hero, one, [[4,4]], state).success).toBe(true);
        expect([near.currentHp,far.currentHp,outside.currentHp]).toEqual([26,26,40]); expect(hero.currentHp).toBe(25);
        expect(hero.counters['潮锋']).toBe(0); expect(hero.counters['凝水']).toBe(0);
        expect(canglanChance(hero)).toBe(37.5); expect(state.skillFxExtras?.fxVariant).toBe('canglan_skill1_phantom');
    });
    it('幻化回澜覆盖5×5；护盾不计入吸血，生命吸收不算过量伤害', () => {
        const { state, hero, foe } = fixture(), a = foe([0,0]), b = foe([4,4], 2), out = foe([5,4]);
        a.shield = 10; hero.currentHp = 20; hero.counters['凝水'] = 2;
        vi.mocked(Math.random).mockReturnValueOnce(0);
        expect(SkillSystem.executeSkill(hero, two, [[2,2]], state).success).toBe(true);
        expect([a.currentHp,a.shield,b.currentHp,out.currentHp,hero.currentHp]).toEqual([40,4,0,40,20]);
        expect(hero.counters['潮锋']).toBe(1); expect(hero.counters['凝水']).toBe(1);
        expect(state.skillFxExtras?.coveredPositions).toHaveLength(24);
    });
    it('同一次群攻两次击杀都补层，不限每轮；补层不反哺后续命中', () => {
        const { state, hero, foe } = fixture(); foe([0,0], 1); foe([0,1], 1); const survivor = foe([4,4]);
        hero.counters['潮锋'] = 2; hero.counters['凝水'] = 2;
        vi.mocked(Math.random).mockReturnValueOnce(0);
        const result = SkillSystem.executeSkill(hero, two, [[2,2]], state);
        expect(result.success).toBe(true); expect(survivor.currentHp).toBe(40 - result.damageDealt![2]);
        expect(result.damageDealt![2]).toBe(result.damageDealt![0]);
        expect(hero.counters['潮锋']).toBe(2); expect(hero.counters['凝水']).toBe(2);
        expect(state.battleLog.filter(l=>l.message.includes('一剑回潮'))).toHaveLength(2);
    });
    it('未命中范围不消耗层数或概率；两招共享锁定结果', () => {
        const { state, hero, foe } = fixture(); foe([4,4]); hero.counters['潮锋'] = 2;
        expect(SkillSystem.executeSkill(hero, one, [[4,4]], state).success).toBe(false);
        expect(canglanForm(hero)).toBe(false); expect(canglanChance(hero)).toBe(25);
        vi.mocked(Math.random).mockClear(); expect(lockCanglanCast(hero)).toBe(false);
        expect(vi.mocked(Math.random)).not.toHaveBeenCalled();
        expect(SkillSystem.getValidTargetPositions(hero, two, state)).toEqual([]); expect(hero.counters['潮锋']).toBe(2);
    });
    it('致知二每层25%，致知三每次加30个百分点，成功仍减半', () => {
        const { state, hero, foe } = fixture(), target = foe([4,4]);
        grantZhizhi(hero,2); grantZhizhi(hero,3); hero.currentHp = 20;
        hero.counters['潮锋']=2; hero.counters['凝水']=2;
        expect(canglanChance(hero)).toBe(30);
        vi.mocked(Math.random).mockReturnValueOnce(.29);
        expect(SkillSystem.executeSkill(hero,one,[[4,4]],state).success).toBe(true);
        expect(target.currentHp).toBe(25); expect(hero.currentHp).toBe(27); expect(canglanChance(hero)).toBe(45);
    });
    it('概率100%必幻化，结束保留50%；天威每种资源上限2', () => {
        const { state, hero, foe } = fixture(); foe([3,3]); hero.counters['__canglan_rate']=80;
        expect(lockCanglanCast(hero)).toBe(true); expect(canglanChance(hero)).toBe(100);
        expect(SkillSystem.executeSkill(hero,one,[[3,3]],state).success).toBe(true); expect(canglanChance(hero)).toBe(75);
        for(let i=0;i<3;i++) DamageCalculator.triggerTianwei(hero,state);
        expect(hero.counters['潮锋']).toBe(2); expect(hero.counters['凝水']).toBe(2);
    });
    it('角落范围截断、不穿棋盘；非法斜率不是方向', () => {
        expect(canglanCells([0,0],CANGLAN_SKILL2,true)).toHaveLength(8);
        expect(canglanCells([0,0],CANGLAN_SKILL1,true,[1,2])).toEqual([]);
        expect(canglanCells([0,0],CANGLAN_SKILL1,true,[1,1])).toEqual([[1,1],[2,2]]);
    });
    it('实际选技能先锁形态，范围与实战一致；改招和联机快照不重掷', () => {
        const { state, hero, foe } = fixture(); foe([4,4]); foe([5,5]);
        useGameStore.setState({...state,selectedHero:hero,activeHero:hero,isOnlineMode:false});
        vi.mocked(Math.random).mockReturnValueOnce(0);
        useGameStore.getState().selectSkill(CANGLAN_SKILL1);
        expect(useGameStore.getState().skillRange).toEqual([[4,4]]);
        useGameStore.getState().selectSkill(CANGLAN_SKILL2);
        expect(useGameStore.getState().skillRange).toHaveLength(25);
        const snap = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame(); applyServerGameState(snap);
        expect(canglanForm(useGameStore.getState().player1Heroes[0])).toBe(true);
    });
    it('电脑实际行动能按幻化射程出手', () => {
        const { state, hero, foe } = fixture('player2'); const target = foe([4,4]);
        hero.counters['__canglan_rate']=100; hero.hasMovedThisTurn=true;
        useGameStore.setState({...state,selectedHero:hero,activeHero:hero,isOnlineMode:false,isAiMode:true,aiPlayer:'player2'});
        for(let i=0;i<5&&useGameStore.getState().currentPlayer==='player2';i++) runComputerOpponentStep();
        expect(target.currentHp).toBeLessThan(40);
    });
});
