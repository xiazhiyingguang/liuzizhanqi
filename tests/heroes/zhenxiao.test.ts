import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { getZhenxiaoDamageBonus } from '../../src/data/heroes';
import { zhenxiaoSkill1, zhenxiaoSkill2 } from '../../src/data/skills';
import { HeroState, type GameState, type Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 震霄：耗血换伤的近战反击位。
 * - 被动「血锋」＝每失去 2% 生命提升 1% 增伤（他没有基础攻击力，增益只能走增伤通道）；
 * - 「金银错」＝技能二给予的受击回击 + 50% 吸血，回击同样吃增益；
 * - 「龙势」＝天威给予的不倒状态，受伤按已损生命回血且不会死亡。
 * 随机数钉在 0.99：不闪避、不暴击，所有结算走确定分支。
 */

function setup(): { state: GameState; hero: Hero; enemy: Hero } {
    const state = makeGameState();
    const hero = addHero(state, 'zhenxiao', 'player1', [2, 2]);
    const enemy = addHero(state, 'nightowl', 'player2', [2, 3]);
    return { state, hero, enemy };
}

describe('震霄·血锋被动', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('增伤曲线按"每失去2%生命→+1%"取整', () => {
        const { hero } = setup();
        hero.currentHp = hero.maxHp;
        expect(getZhenxiaoDamageBonus(hero)).toBe(0);

        hero.currentHp = 37; // 46 血掉 9 点＝19.6%，向下取整到 9 档
        expect(getZhenxiaoDamageBonus(hero)).toBeCloseTo(0.09, 5);

        hero.currentHp = 23; // 恰好失去 50%
        expect(getZhenxiaoDamageBonus(hero)).toBeCloseTo(0.25, 5);

        hero.currentHp = 1; // 逼近满档（100%/2% = 50%）
        expect(getZhenxiaoDamageBonus(hero)).toBeGreaterThan(0.45);
    });

    it('残血时技能一打得更重', () => {
        const fresh = setup();
        fresh.hero.currentHp = fresh.hero.maxHp;
        const freshHit = DamageCalculator.calculate(fresh.hero, fresh.enemy, 8);

        const bloodied = setup();
        bloodied.hero.currentHp = 23;
        const bloodiedHit = DamageCalculator.calculate(bloodied.hero, bloodied.enemy, 8);

        expect(bloodiedHit.finalDamage).toBeGreaterThan(freshHit.finalDamage);
    });

    it('技能一与技能二各耗当前生命的两成，致知1降到一成半', () => {
        const { state, hero } = setup();
        expect(hero.currentHp).toBe(46);
        zhenxiaoSkill1.execute!(hero, [], state);
        expect(hero.currentHp).toBe(37); // floor(46 × 0.2) = 9

        const sharpened = setup();
        sharpened.hero.counters['talent_1'] = 1;
        zhenxiaoSkill2.execute!(sharpened.hero, [], sharpened.state);
        expect(sharpened.hero.currentHp).toBe(40); // floor(46 × 0.15) = 6
    });
});

describe('震霄·金银错与龙势', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('金银错回击走完整结算，因此吃到血锋增伤', () => {
        const { state, hero, enemy } = setup();
        zhenxiaoSkill2.execute!(hero, [], state);
        const hpAfterCost = hero.currentHp;

        const hit = DamageCalculator.calculate(enemy, hero, 8);
        DamageCalculator.applyDamage(hero, hit, enemy, state);

        // 自身已耗 9 点血 → +9% 增伤，6 点回击被抬到 7
        expect(enemy.currentHp).toBe(enemy.maxHp - 7);
        // 吸血按回击伤害的一半
        expect(hero.currentHp).toBe(Math.min(hero.maxHp, hpAfterCost - 8 + 3));
    });

    it('致知3把回击从6点抬到8点', () => {
        const { state, hero, enemy } = setup();
        hero.counters['talent_3'] = 1;
        hero.currentHp = hero.maxHp; // 施放会耗血，先把血锋增伤归零再取基准
        zhenxiaoSkill2.execute!(hero, [], state);
        hero.currentHp = hero.maxHp;

        const hit = DamageCalculator.calculate(enemy, hero, 8);
        DamageCalculator.applyDamage(hero, hit, enemy, state);

        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
    });

    it('天威·龙起：耗血并挂上龙势', () => {
        const { state, hero } = setup();
        const before = hero.currentHp;
        expect(hero.tianweiId).toBe('zhenxiao_tianwei');
        // 天威由击杀在伤害结算内派发，这里直接走同一条派发口
        (DamageCalculator as unknown as {
            triggerTianwei: (hero: Hero, gameState: GameState) => void;
        }).triggerTianwei(hero, state);

        expect(EffectManager.hasEffect(hero, '龙势')).toBe(true);
        expect(hero.currentHp).toBe(before - 9); // 46 × 20%
    });

    it('龙势期间致命伤只把生命压到1点，并且受击后按已损生命回血', () => {
        const { state, hero, enemy } = setup();
        EffectManager.addEffect(hero, {
            type: 'buff',
            name: '龙势',
            duration: 2,
            sourceHeroId: hero.id,
            description: '测试用',
        });

        const lethal = DamageCalculator.calculate(enemy, hero, 99, false, false, { ignoreDefense: true });
        DamageCalculator.applyDamage(hero, lethal, enemy, state);

        expect(hero.state).toBe(HeroState.ALIVE);
        expect(hero.currentHp).toBeGreaterThan(1); // 1 点保底之后，龙势按已损生命 15% 回了血
        expect(hero.currentHp).toBeLessThanOrEqual(Math.ceil(46 * 0.15) + 1);
    });
});
