import { describe, expect, it } from 'vitest';
import { SkillSystem } from '../../src/core/skill-system';
import {
    resolveXihuanBlessing,
    xihuanSkill1,
    xihuanSkill2,
    XIHUAN_LOW_HEAL,
    XIHUAN_LOW_HEAL_TALENT,
} from '../../src/data/extended-skills';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { getHeroInfo } from '../../src/data/heroes';
import { HeroState, type Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 羲和：把一片友方的百分比血量拉平，抽走的那部分存成「盈光」（只保留最大值、不消耗），
 * 技能二按盈光照人回血、溢出转护盾；被动每回合末暖一口我方百分比最低的人。
 */

function scene(): { state: ReturnType<typeof makeGameState>; xihuan: Hero } {
    const state = makeGameState();
    const xihuan = addHero(state, 'xihuan', 'player1', [2, 1]);
    xihuan.defense = 0;
    return { state, xihuan };
}

function ally(state: ReturnType<typeof makeGameState>, position: [number, number]): Hero {
    const unit = addHero(state, 'baize', 'player1', position);
    unit.defense = 0;
    return unit;
}

function foe(state: ReturnType<typeof makeGameState>, position: [number, number]): Hero {
    return addHero(state, 'moran', 'player2', position);
}

/** 把一名角色调到"最大生命的某个百分比" */
function setRatio(hero: Hero, ratio: number): void {
    hero.currentHp = Math.round(hero.maxHp * ratio);
    hero.state = HeroState.ALIVE;
}

describe('羲和 · 面板', () => {
    it('生命56、移动力3、素问，没有天威', () => {
        const info = getHeroInfo('xihuan');
        expect([info.name, info.class]).toEqual(['羲和', '素问']);
        const { xihuan } = scene();
        expect([xihuan.maxHp, xihuan.moveRange, xihuan.tianweiId]).toEqual([56, 3, undefined]);
    });
});

describe('羲和 · 技能一「均光」', () => {
    it('把周围 3×3 内友方的百分比血量拉平到同一档', () => {
        const { state, xihuan } = scene();
        const rich = ally(state, [2, 2]);
        const hurt = ally(state, [1, 1]);
        setRatio(xihuan, 1);
        setRatio(rich, 1);
        setRatio(hurt, 0.25);

        const output = SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state);

        expect(output.success).toBe(true);
        // 平均 (100+100+25)/3 ≈ 75%，各自按最大生命还原；残血那名还多吃了 6 点，所以只比未受伤者高
        const ratio = (hero: Hero) => hero.currentHp / hero.maxHp;
        expect(Math.abs(ratio(xihuan) - 0.75)).toBeLessThanOrEqual(0.02);
        expect(Math.abs(ratio(rich) - 0.75)).toBeLessThanOrEqual(0.02);
        expect(ratio(hurt)).toBeGreaterThan(ratio(rich));
    });

    it('被抽走的生命总量记成盈光，且只保留最大值', () => {
        const { state, xihuan } = scene();
        const rich = ally(state, [2, 2]);
        const hurt = ally(state, [1, 1]);
        setRatio(xihuan, 1);
        setRatio(rich, 1);
        setRatio(hurt, 0.25);

        SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state);
        const drained = xihuan.counters['盈光'];
        expect(drained).toBeGreaterThan(0);

        // 第二次交换量更小：盈光不降反守
        setRatio(xihuan, 0.6);
        setRatio(rich, 0.6);
        setRatio(hurt, 0.6);
        SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state);
        expect(xihuan.counters['盈光']).toBe(drained);
    });

    it('拉平前每名低于自身最大生命50%的友方，拉平后各再吃一口额外恢复', () => {
        const { state, xihuan } = scene();
        const rich = ally(state, [2, 2]);
        const hurt = ally(state, [1, 1]);
        setRatio(xihuan, 1);
        setRatio(rich, 1);
        setRatio(hurt, 0.1);

        SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state);

        // 平均线之上还多 6 点的只有那个残血者：她的比例明显高于另外两人
        const hurtRatio = hurt.currentHp / hurt.maxHp;
        const richRatio = rich.currentHp / rich.maxHp;
        expect(hurtRatio).toBeGreaterThan(richRatio + 0.1);
    });

    it('残血补量是 6 点一口（未上致知的原值）', () => {
        const { state, xihuan } = scene();
        const rich = ally(state, [2, 2]);
        const hurt = ally(state, [1, 1]);
        setRatio(xihuan, 1);
        setRatio(rich, 1);
        setRatio(hurt, 0.1);

        SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state);

        // 平均 (1+1+0.1)/3 = 0.7：残血者先被抬到 70%，再各多吃一口 6 点
        expect(hurt.currentHp).toBe(Math.round(hurt.maxHp * 0.7) + XIHUAN_LOW_HEAL);
        expect(rich.currentHp).toBe(Math.round(rich.maxHp * 0.7));
    });

    it('拉平绝不把任何人压到 0', () => {
        const { state, xihuan } = scene();
        const big = ally(state, [2, 2]);
        const tiny = ally(state, [1, 1]);
        setRatio(xihuan, 0.02);
        setRatio(big, 0.02);
        setRatio(tiny, 0.02);

        SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state);

        for (const hero of [xihuan, big, tiny]) {
            expect(hero.currentHp).toBeGreaterThanOrEqual(1);
            expect(hero.state).toBe(HeroState.ALIVE);
        }
    });

    it('周围 3×3 内没有另一名友方时放不出来', () => {
        const { state, xihuan } = scene();
        setRatio(xihuan, 0.4);
        const farAlly = ally(state, [0, 0]);   // 离她 (2,1) 太远，不在十字两格上
        void farAlly;
        expect(SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state).success).toBe(false);
    });

    it('形状是 3×3：斜角上的友方也算进拉平（旧口径的十字够不到她）', () => {
        const { state, xihuan } = scene();                          // 羲和在 (2,1)
        const diagonal = ally(state, [1, 2]);                       // 唯一一个友方，在斜角
        setRatio(xihuan, 1);
        setRatio(diagonal, 0.25);
        expect(SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state).success).toBe(true);
        // 平均线 = (100% + 12/46) / 2 ≈ 63%：羲和 56×0.63 → 35，斜角友方 46×0.63 → 29，
        // 她低于自身 50%，拉平后再多吃 6 点 → 35
        expect(xihuan.currentHp).toBe(35);
        expect(diagonal.currentHp).toBe(35);
    });

    it('形状是 3×3：正方向两格外的友方不再参与（旧口径能扫到，现在够不到）', () => {
        const { state, xihuan } = scene();
        const far = ally(state, [0, 1]);                            // 正上方两格
        setRatio(xihuan, 1);
        setRatio(far, 0.25);
        expect(SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state).success).toBe(false);
        expect(far.currentHp).toBe(12);                             // 原样没动
        expect(xihuan.counters['盈光'] ?? 0).toBe(0);
    });

    it('敌人不参与拉平', () => {
        const { state, xihuan } = scene();
        const rich = ally(state, [2, 2]);
        const enemyInCross = foe(state, [2, 0]);
        setRatio(xihuan, 1);
        setRatio(rich, 1);
        setRatio(enemyInCross, 0.1);
        const enemyHp = enemyInCross.currentHp;

        SkillSystem.executeSkill(xihuan, xihuanSkill1, [[2, 1]], state);

        expect(enemyInCross.currentHp).toBe(enemyHp);
    });
});

describe('羲和 · 技能二「盈照」', () => {
    /** 先跑一次均光攒出盈光 */
    function withSurplus() {
        const context = scene();
        const rich = ally(context.state, [2, 2]);
        const hurt = ally(context.state, [1, 1]);
        setRatio(context.xihuan, 1);
        setRatio(rich, 1);
        setRatio(hurt, 0.2);
        SkillSystem.executeSkill(context.xihuan, xihuanSkill1, [[2, 1]], context.state);
        return { ...context, target: hurt, surplus: context.xihuan.counters['盈光'] };
    }

    it('按盈光整份回血，盈光不被消耗', () => {
        const { state, xihuan, target, surplus } = withSurplus();
        expect(surplus).toBeGreaterThan(0);
        target.currentHp = 1;

        const output = SkillSystem.executeSkill(xihuan, xihuanSkill2, [target.position!], state);

        expect(output.success).toBe(true);
        expect(target.currentHp + target.shield).toBeGreaterThanOrEqual(1 + surplus);
        expect(xihuan.counters['盈光']).toBe(surplus);
    });

    it('吃不下的溢出部分凝成护盾', () => {
        const { state, xihuan, target, surplus } = withSurplus();
        target.currentHp = target.maxHp;      // 满血：整份都该变盾

        SkillSystem.executeSkill(xihuan, xihuanSkill2, [target.position!], state);

        expect(target.shield).toBeGreaterThanOrEqual(surplus - 1);
    });

    it('全场任意距离都能照，盈光为空时放不出来', () => {
        const { state, xihuan } = scene();
        const lonely = ally(state, [0, 4]);
        expect(SkillSystem.executeSkill(xihuan, xihuanSkill2, [lonely.position!], state).success).toBe(false);

        const prepared = withSurplus();
        const farAlly = ally(prepared.state, [5, 5]);
        farAlly.currentHp = 1;
        const output = SkillSystem.executeSkill(prepared.xihuan, xihuanSkill2, [farAlly.position!], prepared.state);
        expect(output.success).toBe(true);
        expect(farAlly.currentHp).toBeGreaterThan(1);
    });
});

describe('羲和 · 被动「回晖」', () => {
    it('回合末给百分比血量最低的我方角色恢复5点', () => {
        const { state, xihuan } = scene();
        const hurt = ally(state, [1, 1]);
        setRatio(xihuan, 0.9);
        hurt.currentHp = 3;

        resolveXihuanBlessing(xihuan, state);

        expect(hurt.currentHp).toBe(8);
    });

    it('她自己也可以是最低血的那个人', () => {
        const { state, xihuan } = scene();
        const full = ally(state, [1, 1]);
        setRatio(full, 1);
        xihuan.currentHp = 2;

        resolveXihuanBlessing(xihuan, state);

        expect(xihuan.currentHp).toBe(7);
    });
});

describe('羲和 · 致知', () => {
    it('致知一生命+10', () => {
        const { xihuan } = scene();
        grantZhizhi(xihuan, 1);
        expect(xihuan.maxHp).toBe(66);
    });

    it('致知二把残血补量 6 抬到 8，致知三把回晖 5 抬到 6', () => {
        const low = scene();
        const rich = ally(low.state, [2, 2]);
        const hurt = ally(low.state, [1, 1]);
        setRatio(low.xihuan, 1);
        setRatio(rich, 1);
        setRatio(hurt, 0.1);
        grantZhizhi(low.xihuan, 2);
        SkillSystem.executeSkill(low.xihuan, xihuanSkill1, [[2, 1]], low.state);
        // 致知二一口 8 点：先抬到 70% 平均线，再加 8
        expect(hurt.currentHp).toBe(Math.round(hurt.maxHp * 0.7) + XIHUAN_LOW_HEAL_TALENT);
        expect(XIHUAN_LOW_HEAL_TALENT - XIHUAN_LOW_HEAL).toBe(2);
        const withTalent = hurt.currentHp / hurt.maxHp;

        const plain = scene();
        const plainRich = ally(plain.state, [2, 2]);
        const plainHurt = ally(plain.state, [1, 1]);
        setRatio(plain.xihuan, 1);
        setRatio(plainRich, 1);
        setRatio(plainHurt, 0.1);
        SkillSystem.executeSkill(plain.xihuan, xihuanSkill1, [[2, 1]], plain.state);
        expect(withTalent).toBeGreaterThan(plainHurt.currentHp / plainHurt.maxHp);

        const passive = scene();
        const target = ally(passive.state, [1, 1]);
        target.currentHp = 1;
        grantZhizhi(passive.xihuan, 3);
        resolveXihuanBlessing(passive.xihuan, passive.state);
        expect(target.currentHp).toBe(7);
    });
});
