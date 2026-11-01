import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import {
    CHUGE_EFFECT,
    XIANGYU_GUARD_EFFECT,
    XIANGYU_LAST_STAND_KEY,
    XIANGYU_LAST_STAND_SHIELD,
    getXiangyuFrontRect,
    xiangyuShieldSiphonRate,
} from '../../src/core/xiangyu';
import { xiangyuSkill1, xiangyuSkill2 } from '../../src/data/extended-skills';
import { createHero, getHeroInfo } from '../../src/data/heroes';
import { HeroState, type GameState, type Hero, type Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 西楚霸王·项羽：燃血为盾、八向冲锋推人、前方 2×3 刀气、楚歌减伤、四面楚歌吸盾、霸王镇守。
 * 随机数钉在 0.99：不暴击、不闪避。
 */
const NO_RANDOM = 0.99;

function scene(): { state: GameState; xiangyu: Hero } {
    const state = makeGameState();
    const xiangyu = addHero(state, 'xiangyu', 'player1', [2, 2]);
    xiangyu.defense = 0;
    return { state, xiangyu };
}

function foe(state: GameState, position: Position, templateId = 'baize'): Hero {
    const unit = addHero(state, templateId, 'player2', position);
    unit.defense = 0;
    return unit;
}

function ally(state: GameState, position: Position, templateId = 'moran'): Hero {
    const unit = addHero(state, templateId, 'player1', position);
    unit.defense = 0;
    return unit;
}

function castSkill1(state: GameState, caster: Hero, clicked: Position) {
    return SkillSystem.executeSkill(caster, xiangyuSkill1, [clicked], state);
}

function castSkill2(state: GameState, caster: Hero, clicked: Position) {
    return SkillSystem.executeSkill(caster, xiangyuSkill2, [clicked], state);
}

beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(NO_RANDOM);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('项羽 · 面板', () => {
    it('生命60、移动力2、霸魁，带四面楚歌与霸王镇守', () => {
        const info = getHeroInfo('xiangyu');
        expect([info.name, info.class]).toEqual(['西楚霸王·项羽', '霸魁']);
        const hero = createHero('xiangyu', 'player1', [0, 0]);
        expect([hero.maxHp, hero.moveRange, hero.passiveId, hero.tianweiId])
            .toEqual([60, 2, 'xiangyu_passive', 'xiangyu_tianwei']);
    });
});

describe('项羽 · 技能一「破阵」', () => {
    it('燃当前生命25%换等量护盾，八向冲锋后落在两格外的空格', () => {
        const { state, xiangyu } = scene();

        const output = castSkill1(state, xiangyu, [1, 3]);   // 右上斜角

        expect(output.success).toBe(true);
        expect(xiangyu.currentHp).toBe(45);
        expect(xiangyu.shield).toBe(15);
        expect(xiangyu.position).toEqual([0, 4]);
        expect(xiangyu.hasMovedThisTurn).toBe(true);
    });

    it('撞到敌人：把人推开2格、自己继续冲满2格，并给落点周围敌人挂楚歌', () => {
        const { state, xiangyu } = scene();
        const victim = foe(state, [2, 3]);

        const output = castSkill1(state, xiangyu, [2, 3]);

        expect(output.success).toBe(true);
        expect(victim.position).toEqual([2, 5]);
        expect(victim.currentHp).toBe(victim.maxHp - 6);
        expect(xiangyu.position).toEqual([2, 4]);
        expect(EffectManager.hasEffect(victim, CHUGE_EFFECT)).toBe(true);
        expect(output.log.join('')).toContain('冲锋2格');
        expect(output.log.join('')).toContain('推开2格');
    });

    it('后方只剩1格空间：人只推1格，项羽也只跟进1格', () => {
        const { state, xiangyu } = scene();
        const victim = foe(state, [2, 3]);
        ally(state, [2, 5]);   // 最远只能把敌人推到 (2,4)

        castSkill1(state, xiangyu, [2, 3]);

        expect(victim.position).toEqual([2, 4]);
        expect(xiangyu.position).toEqual([2, 3]);
    });

    it('后方被挡住时推不动：停在敌人身前，伤害照吃', () => {
        const { state, xiangyu } = scene();
        const victim = foe(state, [2, 3]);
        ally(state, [2, 4]);   // 挡住被推者的后路

        const output = castSkill1(state, xiangyu, [2, 3]);

        expect(output.success).toBe(true);
        expect(victim.position).toEqual([2, 3]);
        expect(victim.currentHp).toBe(victim.maxHp - 6);
        expect(xiangyu.position).toEqual([2, 2]);
        expect(EffectManager.hasEffect(victim, CHUGE_EFFECT)).toBe(true);
    });

    it('楚歌让携带者造成的伤害降低40%', () => {
        const { state, xiangyu } = scene();
        const victim = foe(state, [2, 3]);
        castSkill1(state, xiangyu, [2, 3]);

        const damage = DamageCalculator.calculate(victim, xiangyu, 10, false, false, { canCrit: false });

        expect(damage.finalDamage).toBe(6);
    });
});

describe('项羽 · 技能二「盖世」', () => {
    it('前方2×3刀气：只付血价、按现有护盾与已损生命计算伤害，斩完清空护盾', () => {
        const { state, xiangyu } = scene();
        xiangyu.shield = 10;
        const victim = foe(state, [2, 3]);

        const output = castSkill2(state, xiangyu, [2, 3]);

        expect(output.success).toBe(true);
        // 扣血15 → 生命45；基础 8+5=13；已损25% → ×1.125 → 14
        expect(xiangyu.currentHp).toBe(45);
        // 伤害按开打前的10盾结算；命中后孤身吸盾35%再+4，但出鞘后一并清空
        expect(xiangyu.shield).toBe(0);
        expect(victim.currentHp).toBe(victim.maxHp - 14);
        expect(output.damageDealt).toEqual([14]);
    });

    it('技能二不再把生命转成护盾：关掉被动吸盾后盾量不变', () => {
        const { state, xiangyu } = scene();
        xiangyu.passiveId = '';
        const victim = foe(state, [2, 3]);

        const output = castSkill2(state, xiangyu, [2, 3]);

        expect(output.success).toBe(true);
        expect(xiangyu.currentHp).toBe(45);
        expect(xiangyu.shield).toBe(0);
        expect(victim.currentHp).toBe(victim.maxHp - 9);   // 8 × 1.125
    });

    it('2×3范围内的多名敌人一起吃刀气', () => {
        const { state, xiangyu } = scene();
        const top = foe(state, [1, 3]);
        const middle = foe(state, [2, 3]);
        const bottom = foe(state, [3, 3]);

        const output = castSkill2(state, xiangyu, [2, 3]);

        expect(output.success).toBe(true);
        expect(output.damageDealt).toHaveLength(3);
        for (const victim of [top, middle, bottom]) {
            expect(victim.currentHp).toBe(victim.maxHp - 9);
        }
    });

    it('前方没有敌人时失败且不燃血', () => {
        const { state, xiangyu } = scene();

        const output = castSkill2(state, xiangyu, [2, 3]);

        expect(output.success).toBe(false);
        expect(xiangyu.currentHp).toBe(60);
        expect(xiangyu.shield).toBe(0);
        expect(xiangyu.counters['xiangyu_skill2_cd'] ?? 0).toBe(0);
    });

    it('盖世有一回合冷却：放完立刻再点会被拒绝，也不重复燃血', () => {
        const { state, xiangyu } = scene();
        foe(state, [2, 3]);

        const first = castSkill2(state, xiangyu, [2, 3]);
        const hpAfterFirst = xiangyu.currentHp;
        const second = castSkill2(state, xiangyu, [2, 3]);

        expect(first.success).toBe(true);
        expect(xiangyu.counters['xiangyu_skill2_cd']).toBe(2);
        expect(second.success).toBe(false);
        expect(second.log.join('')).toContain('冷却');
        expect(xiangyu.currentHp).toBe(hpAfterFirst);

        // 按回合推进：这一轮结束 →1，下一轮结束 →0
        GameEngine.startNewTurn(state);
        expect(xiangyu.counters['xiangyu_skill2_cd']).toBe(1);
        GameEngine.startNewTurn(state);
        expect(xiangyu.counters['xiangyu_skill2_cd']).toBe(0);
    });

    it('方向必须是上下左右；斜角点击会被拒绝', () => {
        const { state, xiangyu } = scene();
        foe(state, [1, 3]);
        expect(castSkill2(state, xiangyu, [1, 3]).success).toBe(false);
    });

    it('范围是前方2行×横向3列，贴边时按盘内裁剪', () => {
        const { xiangyu } = scene();
        xiangyu.position = [0, 0];
        const clipped = getXiangyuFrontRect(xiangyu, 1);   // 向下，左侧越界
        expect(clipped).toHaveLength(4);
        expect(clipped).toContainEqual([1, 0]);
        expect(clipped).toContainEqual([2, 1]);
        expect(clipped.every(([row, col]) => row < 6 && col < 6)).toBe(true);

        const full = getXiangyuFrontRect({ ...xiangyu, position: [2, 2] }, 3);   // 向右
        expect(full).toHaveLength(6);
        expect(full).toContainEqual([1, 3]);
        expect(full).toContainEqual([3, 4]);
    });
});

describe('项羽 · 被动「四面楚歌」', () => {
    it('孤身时吸盾率35%，每有一名相邻友方下降5个百分点', () => {
        const { state, xiangyu } = scene();
        expect(xiangyuShieldSiphonRate(xiangyu, state)).toBeCloseTo(0.35);

        ally(state, [1, 2]);
        expect(xiangyuShieldSiphonRate(xiangyu, state)).toBeCloseTo(0.3);

        ally(state, [3, 2]);
        expect(xiangyuShieldSiphonRate(xiangyu, state)).toBeCloseTo(0.25);
    });

    it('主动攻击造成伤害时按伤害吸盾', () => {
        const { state, xiangyu } = scene();
        const victim = foe(state, [2, 3]);

        const damage = DamageCalculator.calculate(xiangyu, victim, 10, false, false, { canCrit: false });
        DamageCalculator.applyDamage(victim, damage, xiangyu, state);

        expect(victim.currentHp).toBe(victim.maxHp - 10);
        expect(xiangyu.shield).toBe(3);   // 孤身 35%，向下取整
    });
});

describe('项羽 · 霸王镇守', () => {
    it('生命首次跌破30%时获得护盾并挂起化盾，下一次主动技能伤害不扣血盾', () => {
        const { state, xiangyu } = scene();
        const attacker = foe(state, [2, 3]);

        const first = DamageCalculator.calculate(attacker, xiangyu, 45, false, false, { canCrit: false });
        DamageCalculator.applyDamage(xiangyu, first, attacker, state);

        expect(xiangyu.currentHp).toBe(15);
        expect(xiangyu.shield).toBe(XIANGYU_LAST_STAND_SHIELD);
        expect(EffectManager.hasEffect(xiangyu, XIANGYU_GUARD_EFFECT)).toBe(true);
        expect(xiangyu.counters[XIANGYU_LAST_STAND_KEY]).toBe(1);

        const second = DamageCalculator.calculate(attacker, xiangyu, 12, false, false, { canCrit: false });
        DamageCalculator.applyDamage(xiangyu, second, attacker, state);

        expect(xiangyu.currentHp).toBe(15);
        expect(xiangyu.shield).toBe(XIANGYU_LAST_STAND_SHIELD + 12);
        expect(EffectManager.hasEffect(xiangyu, XIANGYU_GUARD_EFFECT)).toBe(false);
    });

    it('效果伤害不会消耗霸王镇守，但会正常扣血', () => {
        const { state, xiangyu } = scene();
        const attacker = foe(state, [2, 3]);
        xiangyu.currentHp = 10;
        xiangyu.counters[XIANGYU_LAST_STAND_KEY] = 1;
        EffectManager.addEffect(xiangyu, {
            type: 'buff', name: XIANGYU_GUARD_EFFECT, duration: 2, sourceHeroId: xiangyu.id,
            description: '测试',
        });

        const burn = DamageCalculator.calculate(attacker, xiangyu, 3, false, false, {
            canCrit: false, fixedDamage: true, logTag: 'burn',
        });
        DamageCalculator.applyDamage(xiangyu, burn, attacker, state);

        expect(xiangyu.currentHp).toBe(7);
        expect(EffectManager.hasEffect(xiangyu, XIANGYU_GUARD_EFFECT)).toBe(true);
    });

    it('每场只触发一次，自耗血也能触发', () => {
        const { state, xiangyu } = scene();
        xiangyu.currentHp = 20;

        castSkill1(state, xiangyu, [1, 3]);   // 20 → 15，跌破30%

        expect(xiangyu.currentHp).toBe(15);
        expect(xiangyu.shield).toBe(5 + XIANGYU_LAST_STAND_SHIELD);
        expect(EffectManager.hasEffect(xiangyu, XIANGYU_GUARD_EFFECT)).toBe(true);
    });
});

describe('项羽 · 致知', () => {
    it('致知二把破阵伤害抬到8，致知三把镇守护盾抬到15', () => {
        const { state, xiangyu } = scene();
        grantZhizhi(xiangyu, 2);
        grantZhizhi(xiangyu, 3);
        const victim = foe(state, [2, 3]);

        castSkill1(state, xiangyu, [2, 3]);
        expect(victim.currentHp).toBe(victim.maxHp - 8);

        const second = scene();
        grantZhizhi(second.xiangyu, 3);
        second.xiangyu.currentHp = 17;
        const attacker = foe(second.state, [2, 4]);
        const hit = DamageCalculator.calculate(attacker, second.xiangyu, 1, false, false, { canCrit: false });
        DamageCalculator.applyDamage(second.xiangyu, hit, attacker, second.state);
        expect(second.xiangyu.shield).toBe(15);
    });
});
