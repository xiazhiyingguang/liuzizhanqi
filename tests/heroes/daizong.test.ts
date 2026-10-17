import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import {
    MOUNTAIN_COUNTER,
    applyStillnessReward,
    consumeDaizongLamp,
    hasStance,
    mountainPressure,
    queueDaizongLamp,
    setStance,
    stanceDirection,
    stillnessDefense,
} from '../../src/core/mountain-stance';
import { GameEngine } from '../../src/core/game-engine';
import { daizongSkill1, daizongSkill2 } from '../../src/data/extended-skills';
import { useGameStore } from '../../src/store/game-store';
import { getHeroInfo } from '../../src/data/heroes';
import type { GameState, Hero, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 岱宗：朝一侧镇守、替这半区挡下攻击，挡下来的份额攒成岳势，再一次性砸回去。
 * Math.random 钉在 0.99：不闪避、不暴击，全部结算走确定分支。
 */

const DIR_UP = 0;
const DIR_DOWN = 2;
const DIR_RIGHT = 1;

function scene(): { state: GameState; daizong: Hero } {
    const state = makeGameState();
    const daizong = addHero(state, 'daizong', 'player1', [2, 2]);
    daizong.defense = 0;
    daizong.maxHp = 200;
    daizong.currentHp = 200;
    return { state, daizong };
}

function ally(state: GameState, position: Position, templateId = 'huifeng'): Hero {
    const unit = addHero(state, templateId, 'player1', position);
    unit.defense = 0;
    unit.maxHp = 200;
    unit.currentHp = 200;
    return unit;
}

function foe(state: GameState, position: Position, templateId = 'moran'): Hero {
    const unit = addHero(state, templateId, 'player2', position);
    unit.defense = 0;
    unit.maxHp = 200;
    unit.currentHp = 200;
    return unit;
}

function hit(attacker: Hero, victim: Hero, state: GameState, amount = 20): number {
    const damage = DamageCalculator.calculate(attacker, victim, amount, false);
    DamageCalculator.applyDamage(victim, damage, attacker, state);
    return damage.finalDamage;
}

function cast1(caster: Hero, state: GameState, cell: Position) {
    caster.counters['__extended_target'] = cell[0] * 6 + cell[1];
    return daizongSkill1.execute!(caster, [], state);
}

function cast2(caster: Hero, state: GameState) {
    return daizongSkill2.execute!(caster, [], state);
}

beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('岱宗 · 模板', () => {
    it('生命58、移动2、霸魁，天威是传灯，致知一 +10 生命', () => {
        const { daizong } = scene();
        const fresh = makeGameState();
        const unit = addHero(fresh, 'daizong', 'player1', [2, 2]);
        expect(unit.maxHp).toBe(58);
        expect(unit.moveRange).toBe(2);
        expect(unit.class).toBe('霸魁');
        expect(unit.tianweiId).toBe('daizong_tianwei');
        expect(getHeroInfo('daizong').name).toBe('岱宗');
        grantZhizhi(unit, 1);
        expect(unit.maxHp).toBe(68);
        expect(daizong.passiveId).toBe('daizong_passive');
    });
});

describe('技能一 · 镇岳守势', () => {
    it('只能朝上下左右摆，斜着不行', () => {
        const { state, daizong } = scene();
        expect(cast1(daizong, state, [1, 1]).success).toBe(false);
        expect(hasStance(daizong)).toBe(false);
        expect(cast1(daizong, state, [1, 2]).success).toBe(true);
        expect(stanceDirection(daizong)).toBe(DIR_UP);
    });

    it('已经朝这一侧摆着时不能重放，换方向可以', () => {
        const { state, daizong } = scene();
        cast1(daizong, state, [1, 2]);
        expect(cast1(daizong, state, [1, 2]).success).toBe(false);
        expect(cast1(daizong, state, [3, 2]).success).toBe(true);
        expect(stanceDirection(daizong)).toBe(DIR_DOWN);
    });
});

describe('半区镇守：两边都要对得上', () => {
    it('朝右摆（面向右边的敌人）→ 第 1~3 列的队友被第 4~6 列的敌人打中，伤害全转到岱宗', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        const guarded = ally(state, [2, 0]);
        const attacker = foe(state, [2, 5]);

        expect(hit(attacker, guarded, state, 20)).toBe(0);
        expect(guarded.currentHp).toBe(200);
        expect(daizong.currentHp).toBe(188);                         // 20 点里挡下 8，剩下的 12 才落在他身上
        expect(daizong.counters[MOUNTAIN_COUNTER]).toBe(8);           // 岳势记的是挡下的那份，不是挨的那份
    });

    it('敌人绕进他身后那一侧出手，就挡不到', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        const guarded = ally(state, [2, 0]);
        const insider = foe(state, [2, 1]);
        expect(hit(insider, guarded, state, 20)).toBe(20);
        expect(daizong.currentHp).toBe(200);
    });

    it('队友站在他面朝那一侧，不在护持范围内', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        const outside = ally(state, [2, 4]);
        const attacker = foe(state, [2, 5]);
        expect(hit(attacker, outside, state, 20)).toBe(20);
    });

    it('替扛按"同一击改由他承受"重算：队友自己的防御不会折进岳势', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        const tanky = ally(state, [2, 0]);
        tanky.defense = 0.5;                                         // 这发打在她身上本来只剩一半
        const attacker = foe(state, [2, 5]);
        expect(hit(attacker, tanky, state, 20)).toBe(0);
        // 岱宗按原始 20 点重算：自己挡下 8（岳势），身上只掉 12
        expect(daizong.currentHp).toBe(188);
        expect(daizong.counters[MOUNTAIN_COUNTER]).toBe(8);
    });

    it('分界线固定在棋盘中线：岱宗站在第 0 列朝右摆，照样护住第 1~3 列', () => {
        const state = makeGameState();
        const daizong = addHero(state, 'daizong', 'player1', [2, 0]);   // 最左那一列
        daizong.defense = 0;
        daizong.maxHp = 200;
        daizong.currentHp = 200;
        setStance(daizong, DIR_RIGHT);
        const farAlly = ally(state, [2, 2]);                           // 离他两列远，仍在左半场
        const attacker = foe(state, [2, 3]);                           // 右半场的敌人
        expect(hit(attacker, farAlly, state, 20)).toBe(0);
        expect(farAlly.currentHp).toBe(200);
        expect(daizong.currentHp).toBe(188);
    });

    it('上下方向同理：朝上摆则挡住上三行往下三行的攻击', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_UP);
        const guarded = ally(state, [4, 2]);                         // 他面朝上方，护住下三行
        const attacker = foe(state, [0, 2]);                         // 敌人来自上三行
        expect(hit(attacker, guarded, state, 20)).toBe(0);
        expect(daizong.currentHp).toBe(188);
    });

    it('固定伤害（不可规避）不转给他', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        const guarded = ally(state, [2, 0]);
        const attacker = foe(state, [2, 5]);
        const fixed = DamageCalculator.calculate(attacker, guarded, 15, false, true);
        fixed.unavoidable = true;                                    // 不可规避的固定伤害不走替扛
        DamageCalculator.applyDamage(guarded, fixed, attacker, state);
        expect(guarded.currentHp).toBe(185);
        expect(daizong.currentHp).toBe(200);
    });

    it('岱宗自己挨打不外传，但挡下的份额照样记账', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        const other = ally(state, [2, 1], 'daizong');
        const attacker = foe(state, [2, 5]);
        expect(hit(attacker, daizong, state, 20)).toBe(12);
        expect(other.currentHp).toBe(200);
        expect(daizong.counters[MOUNTAIN_COUNTER]).toBe(8);
    });

    it('没摆姿态时什么都不挡、也不记账', () => {
        const { state, daizong } = scene();
        const guarded = ally(state, [2, 0]);
        const attacker = foe(state, [2, 5]);
        expect(hit(attacker, guarded, state, 20)).toBe(20);
        expect(daizong.currentHp).toBe(200);
        expect(mountainPressure(daizong)).toBe(0);
    });
});

describe('技能二 · 岳倾', () => {
    it('身上没岳势时砸不出来', () => {
        const { state, daizong } = scene();
        foe(state, [2, 3]);
        expect(cast2(daizong, state).success).toBe(false);
    });

    it('把岳势等量砸向自身 3×3，命中即清空池子、挂岳压并解除姿态', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        hit(foe(state, [2, 5]), ally(state, [2, 0]), state, 20);     // 挡下 8 点，攒成 8 点岳势
        const inside = foe(state, [1, 3]);
        const outside = foe(state, [0, 5]);
        expect(mountainPressure(daizong)).toBe(8);

        const output = cast2(daizong, state);
        expect(output.success).toBe(true);
        expect(inside.currentHp).toBe(192);
        expect(outside.currentHp).toBe(200);
        expect(mountainPressure(daizong)).toBe(0);
        expect(inside.effects.some(effect => effect.name === '岳压')).toBe(true);
        expect(hasStance(daizong)).toBe(false);
    });

    it('岳压让命中者造成的伤害降低两成', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        hit(foe(state, [2, 5]), ally(state, [2, 0]), state, 20);
        const crushed = foe(state, [1, 3]);
        cast2(daizong, state);
        expect(crushed.effects.some(effect => effect.name === '岳压')).toBe(true);

        const attacker = foe(state, [4, 4], 'yunying');
        const clean = DamageCalculator.calculate(attacker, crushed, 20, false).finalDamage;
        EffectManager.addEffect(attacker, {
            type: 'debuff', name: '岳压', duration: 2, value: 0.2, sourceHeroId: daizong.id,
        });
        expect(DamageCalculator.calculate(attacker, crushed, 20, false).finalDamage)
            .toBeLessThan(clean);
    });
});

describe('被动 · 不动如山', () => {
    it('本回合没移动就叠一层 25% 减伤，封顶 50%', () => {
        const { state, daizong } = scene();
        expect(applyStillnessReward(state, daizong)).toContain('25%');
        applyStillnessReward(state, daizong);
        expect(stillnessDefense(daizong)).toBeCloseTo(0.5);
        applyStillnessReward(state, daizong);
        expect(stillnessDefense(daizong)).toBeCloseTo(0.5);
    });

    it('移动过那一回合不叠层', () => {
        const { state, daizong } = scene();
        daizong.hasMovedThisTurn = true;
        expect(applyStillnessReward(state, daizong)).toBeNull();
        expect(stillnessDefense(daizong)).toBe(0);
    });

    it('叠满之后，再"不动"改成每回合回复 10% 已损生命', () => {
        const { state, daizong } = scene();
        daizong.maxHp = 100;
        daizong.currentHp = 40;
        applyStillnessReward(state, daizong);
        applyStillnessReward(state, daizong);
        applyStillnessReward(state, daizong);
        expect(daizong.currentHp).toBe(46);
    });

    it('减伤真的进结算：两层后 20 点只掉 10 点，摆上镇守则改成挡下 18 点', () => {
        const { state, daizong } = scene();
        const attacker = foe(state, [2, 5]);
        applyStillnessReward(state, daizong);
        applyStillnessReward(state, daizong);
        expect(hit(attacker, daizong, state, 20)).toBe(10);           // 没镇守：厚重就是普通减伤
        expect(mountainPressure(daizong)).toBe(0);                    // 没镇守：一点岳势都不涨
        setStance(daizong, DIR_RIGHT);
        daizong.currentHp = 200;
        const taken = DamageCalculator.calculate(attacker, daizong, 20, false);
        expect(taken.finalDamage).toBe(2);                            // 承转 40%+50% 封顶 90% → 只掉 2
        expect(taken.mountainBlocked).toBe(18);
    });
});

describe('岳势 · 挡下来的才记账', () => {
    it('两层厚重把承转抬到 90%：20 点里 18 点进池子，身上只掉 2', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        applyStillnessReward(state, daizong);
        applyStillnessReward(state, daizong);
        expect(hit(foe(state, [2, 5]), daizong, state, 20)).toBe(2);
        expect(daizong.currentHp).toBe(198);
        expect(mountainPressure(daizong)).toBe(18);
    });

    it('承转封顶 90%：致知二 50% + 致知三 60% 也不会超过', () => {
        const { state, daizong } = scene();
        grantZhizhi(daizong, 2);
        grantZhizhi(daizong, 3);
        setStance(daizong, DIR_RIGHT);
        applyStillnessReward(state, daizong);
        applyStillnessReward(state, daizong);
        const taken = DamageCalculator.calculate(foe(state, [2, 5]), daizong, 20, false);
        expect(taken.mountainBlocked).toBe(18);                       // 0.5+0.6=110% → 夹在 90%
        expect(taken.finalDamage).toBe(2);
    });

    it('致知二单独把承抬到 50%：20 点挡 10、掉 10', () => {
        const { state, daizong } = scene();
        grantZhizhi(daizong, 2);
        setStance(daizong, DIR_RIGHT);
        const taken = DamageCalculator.calculate(foe(state, [2, 5]), daizong, 20, false);
        expect(taken.mountainBlocked).toBe(10);
        expect(taken.finalDamage).toBe(10);
    });

    it('承转把余量吃到 0 的那一下照样记账：5 点全进池子，血一滴没掉', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        applyStillnessReward(state, daizong);
        applyStillnessReward(state, daizong);
        expect(hit(foe(state, [2, 5]), daizong, state, 5)).toBe(0);
        expect(daizong.currentHp).toBe(200);
        expect(mountainPressure(daizong)).toBe(5);
    });

    it('不可规避的固定伤害挡不下来：身上掉血，岳势一点不涨', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        const attacker = foe(state, [2, 5]);
        const fixed = DamageCalculator.calculate(attacker, daizong, 15, false, false, { fixedDamage: true });
        DamageCalculator.applyDamage(daizong, fixed, attacker, state);
        expect(daizong.currentHp).toBe(185);
        expect(mountainPressure(daizong)).toBe(0);
    });
});

describe('天威 · 传灯', () => {
    it('把这一盏灯交给下一个出手的友方：两回合 20% 防御，且只有一盏', () => {
        const { state, daizong } = scene();
        queueDaizongLamp(daizong);
        const mate = ally(state, [1, 2], 'baize');
        expect(consumeDaizongLamp(state, mate)).toBe(true);
        const lamp = mate.effects.find(effect => effect.name === '传灯增防');
        expect(lamp?.duration).toBe(2);
        expect(consumeDaizongLamp(state, ally(state, [3, 2], 'baize'))).toBe(false);
    });

    it('岱宗不接自己的灯', () => {
        const { state, daizong } = scene();
        queueDaizongLamp(daizong);
        expect(consumeDaizongLamp(state, daizong)).toBe(false);
    });

    it('接灯的友方行动结束时当场兑现', () => {
        const state = makeGameState();
        const daizong = addHero(state, 'daizong', 'player1', [2, 2]);
        const mate = addHero(state, 'yunying', 'player1', [1, 2]);
        daizong.defense = 0;
        mate.defense = 0;
        queueDaizongLamp(daizong);
        GameEngine.endHeroAction(mate, state);
        expect(mate.effects.some(effect => effect.name === '传灯增防')).toBe(true);
    });
});

describe('姿态与移动', () => {
    it('移动立刻打断镇守，撤回这一步原样恢复', () => {
        const { state, daizong } = scene();
        setStance(daizong, DIR_RIGHT);
        useGameStore.setState({
            ...state,
            isOnlineMode: false,
            isAiMode: false,
            suppressOnlineBroadcast: true,
            selectedHero: daizong,
        });
        useGameStore.getState().moveHero([2, 1]);
        expect(hasStance(daizong)).toBe(false);
        expect(daizong.hasMovedThisTurn).toBe(true);

        useGameStore.getState().undoMove();
        expect(hasStance(daizong)).toBe(true);
        expect(stanceDirection(daizong)).toBe(DIR_RIGHT);
    });
});
