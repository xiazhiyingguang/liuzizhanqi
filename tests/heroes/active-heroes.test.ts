import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { SkillSystem } from '../../src/core/skill-system';
import { MovementSystem } from '../../src/core/movement-system';
import { GameEngine } from '../../src/core/game-engine';
import {
    createMirrorClone,
    createWukongClone,
    AVAILABLE_HERO_IDS,
    changliTianwei,
    huifengTianwei,
    moranTianwei,
    nightowlTianwei,
    wukongTianwei,
} from '../../src/data/heroes';
import {
    baizeSkill1,
    baizeSkill2,
    guyingSkill1,
    guyingSkill2,
    hanjiangxueSkill1,
    hanjiangxueSkill2,
    changliSkill1,
    changliSkill2,
    huifengSkill1,
    huifengSkill2,
    liuliSkill1,
    liuliSkill2,
    mirrorSkill1,
    mirrorSkill2,
    moranSkill1,
    moranSkill2,
    mowenSkill1,
    mowenSkill2,
    nightowlSkill1,
    nightowlSkill2,
    SKILLS,
    wukongSkill1,
    wukongSkill2,
    xuanxiaoSkill1,
    xuanxiaoSkill2,
    zhenxiaoSkill1,
    zhenxiaoSkill2,
} from '../../src/data/skills';
import { HeroState, Position } from '../../src/types/game';
import { addHero, killOffBoard, makeGameState } from '../helpers/game-state';

describe('active hero registry', () => {
    it('exposes Feixue and keeps every playable hero wired to two registered skills', () => {
        expect(AVAILABLE_HERO_IDS).toContain('feixue');
        expect(new Set(AVAILABLE_HERO_IDS).size).toBe(AVAILABLE_HERO_IDS.length);

        for (const heroId of AVAILABLE_HERO_IDS) {
            const state = makeGameState();
            const hero = addHero(state, heroId, 'player1', [0, 0]);
            expect(SKILLS[hero.skill1Id], `${hero.name} skill 1`).toBeDefined();
            expect(SKILLS[hero.skill2Id], `${hero.name} skill 2`).toBeDefined();
        }
    });
});

describe('Moran', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('skill 1 deals 10 and enters Weidao; skill 2 deals 15', () => {
        const state = makeGameState();
        const moran = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);

        const first = moranSkill1.execute!(moran, [enemy], state);
        const second = moranSkill2.execute!(moran, [enemy], state);

        expect(first.damageDealt).toEqual([10]);
        expect(second.damageDealt).toEqual([15]);
        expect(EffectManager.hasEffect(moran, '为道')).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 25);
    });

    it('triggers one pending extra action after the second damaging hit', () => {
        const state = makeGameState();
        const moran = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        EffectManager.addEffect(moran, {
            type: 'buff',
            name: '为道',
            duration: -1,
            sourceHeroId: moran.id,
        });

        for (let i = 0; i < 2; i++) {
            // 基础伤害取 10：为道状态自带 30% 防御提升，1 点伤害会被减免为 0 而不触发受击
            const result = DamageCalculator.calculate(enemy, moran, 10);
            DamageCalculator.applyDamage(moran, result, enemy, state);
        }

        expect(state.pendingExtraActionHeroIds?.player1).toBe(moran.id);
        expect(EffectManager.hasEffect(moran, '为道')).toBe(false);
        expect(moran.counters['为道受击']).toBe(0);
    });

    it('limits Tianwei to one extra-action grant per round', () => {
        const state = makeGameState();
        const moran = addHero(state, 'moran', 'player1', [0, 0]);

        moranTianwei.execute(moran, state);
        state.pendingExtraActionHeroIds = {};
        moranTianwei.execute(moran, state);

        expect(moran.counters['tianwei_uses']).toBe(1);
        expect(state.pendingExtraActionHeroIds?.player1).toBeUndefined();
    });
});

describe('Zhenxiao', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('skill 1 pays 20% current HP once and damages all three cells in the chosen strip', () => {
        const state = makeGameState();
        const hero = addHero(state, 'zhenxiao', 'player1', [2, 2]);
        const enemies = [
            addHero(state, 'moran', 'player2', [1, 3]),
            addHero(state, 'baize', 'player2', [2, 3]),
            addHero(state, 'liuli', 'player2', [3, 3]),
        ];

        const result = SkillSystem.executeSkill(hero, zhenxiaoSkill1, [[2, 3]], state);

        expect(hero.currentHp).toBe(37);
        expect(result.damageDealt).toEqual([8, 8, 8]);
        expect(enemies.map(e => e.maxHp - e.currentHp)).toEqual([8, 8, 8]);
    });

    it('skill 2 pays HP and enables one-round counterattacks with lifesteal', () => {
        const state = makeGameState();
        const hero = addHero(state, 'zhenxiao', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);

        zhenxiaoSkill2.execute!(hero, [], state);
        const hpAfterCost = hero.currentHp;
        const hit = DamageCalculator.calculate(enemy, hero, 8);
        DamageCalculator.applyDamage(hero, hit, enemy, state);

        expect(EffectManager.hasEffect(hero, '金银错')).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 6);
        expect(hero.currentHp).toBe(Math.min(hero.maxHp, hpAfterCost - 8 + 3));
    });
});

describe('Wukong', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('skill 2 deals 8 damage with deterministic non-critical RNG', () => {
        const state = makeGameState();
        const hero = addHero(state, 'wukong', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);

        const result = wukongSkill2.execute!(hero, [enemy], state);

        expect(result.damageDealt).toEqual([8]);
    });

    it('毫毛化身可选落点扩大到周围两格（5×5 方盒，不含本体）', () => {
        const state = makeGameState();
        const hero = addHero(state, 'wukong', 'player1', [2, 2]);

        const positions = SkillSystem.getValidTargetPositions(hero, wukongSkill1);

        expect(positions).toHaveLength(24);
        expect(positions).toContainEqual([0, 0] as Position);
        expect(positions).toContainEqual([4, 4] as Position);
        expect(positions).not.toContainEqual([2, 2] as Position);
        expect(positions).not.toContainEqual([0, 5] as Position);
        expect(positions).not.toContainEqual([5, 2] as Position);
    });

    it('gains one Lingxi and updates clone crit effects when a clone dies', () => {
        const state = makeGameState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);
        const clone = createWukongClone('player1', wukong.id, [2, 3], 10);
        state.board[2][3] = clone;
        const enemy = addHero(state, 'moran', 'player2', [2, 4]);
        const damage = DamageCalculator.calculate(enemy, clone, 20);

        DamageCalculator.applyDamage(clone, damage, enemy, state);

        expect(clone.state).toBe(HeroState.DEAD);
        expect(state.board[2][3]).toBeNull();
        expect(wukong.counters['灵犀']).toBe(1);
        expect(EffectManager.getEffect(wukong, '悟空暴击率')?.value).toBeCloseTo(0.4);
    });

    it('Tianwei summons at most three living clones', () => {
        const state = makeGameState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);

        for (let i = 0; i < 5; i++) wukongTianwei.execute(wukong, state);

        const cloneCount = state.board.flat().filter(
            h => h?.counters?.['__isClone'] === 1 && h.id.startsWith('wukong-clone|'),
        ).length;
        expect(cloneCount).toBe(3);
    });
});

describe('Liuli', () => {
    it('guards one ally and gains meditation when the guard absorbs damage', () => {
        const state = makeGameState();
        const liuli = addHero(state, 'liuli', 'player1', [2, 2]);
        const ally = addHero(state, 'baize', 'player1', [2, 3]);
        const enemy = addHero(state, 'moran', 'player2', [2, 4]);

        expect(liuliSkill1.execute!(liuli, [ally], state).success).toBe(true);
        const hit = DamageCalculator.calculate(enemy, ally, 5);
        DamageCalculator.applyDamage(ally, hit, enemy, state);

        expect(ally.currentHp).toBe(ally.maxHp);
        expect(liuli.currentHp).toBe(liuli.maxHp - 5);
        expect(EffectManager.getCounter(liuli, '禅定')).toBe(2);
    });

    it('guards every ally within one cell instead of a single clicked target', () => {
        const state = makeGameState();
        const liuli = addHero(state, 'liuli', 'player1', [2, 2]);
        const allyA = addHero(state, 'moran', 'player1', [2, 3]);
        const allyB = addHero(state, 'baize', 'player1', [3, 3]);
        const farAlly = addHero(state, 'zhenxiao', 'player1', [2, 5]);

        const result = SkillSystem.executeSkill(liuli, liuliSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(EffectManager.hasEffect(allyA, '援护')).toBe(true);
        expect(EffectManager.hasEffect(allyB, '援护')).toBe(true);
        expect(EffectManager.hasEffect(farAlly, '援护')).toBe(false);
        expect(liuli.counters['禅定']).toBe(1);
    });

    it('consumes all meditation to heal 10% max HP per stack', () => {
        const state = makeGameState();
        const liuli = addHero(state, 'liuli', 'player1', [2, 2]);
        liuli.currentHp = 20;
        EffectManager.setCounter(liuli, '禅定', 3);

        const result = liuliSkill2.execute!(liuli, [liuli], state);

        expect(result.healingDone).toEqual([19]);
        expect(liuli.currentHp).toBe(39);
        expect(EffectManager.getCounter(liuli, '禅定')).toBe(0);
    });
});

describe('Baize', () => {
    it('skill 1 heals the lowest-HP ally and grants power and Tianlu', () => {
        const state = makeGameState();
        const baize = addHero(state, 'baize', 'player1', [0, 0]);
        const low = addHero(state, 'moran', 'player1', [0, 1]);
        const high = addHero(state, 'liuli', 'player1', [0, 2]);
        low.currentHp = 10;
        high.currentHp = 40;

        baizeSkill1.execute!(baize, [], state);

        expect(low.currentHp).toBe(18);
        expect(EffectManager.getCounter(low, '白泽之力')).toBe(1);
        expect(EffectManager.getCounter(baize, '天禄')).toBe(1);
    });

    it('skill 2 heals when Tianlu is below three', () => {
        const state = makeGameState();
        const baize = addHero(state, 'baize', 'player1', [0, 0]);
        const ally = addHero(state, 'moran', 'player1', [0, 1]);
        ally.currentHp = 5;

        const result = baizeSkill2.execute!(baize, [], state);

        expect(result.success).toBe(true);
        expect(ally.currentHp).toBe(20);
    });

    it('revives the player-selected dead ally rather than the first dead ally', () => {
        const state = makeGameState();
        const baize = addHero(state, 'baize', 'player1', [2, 2]);
        const firstDead = addHero(state, 'moran', 'player1', [0, 0]);
        const selectedDead = addHero(state, 'liuli', 'player1', [0, 1]);
        state.board[0][0] = null;
        state.board[0][1] = null;
        killOffBoard(firstDead);
        killOffBoard(selectedDead);
        EffectManager.setCounter(baize, '天禄', 3);

        baizeSkill2.execute!(baize, [selectedDead], state);

        expect(selectedDead.state).toBe(HeroState.ALIVE);
        expect(firstDead.state).toBe(HeroState.DEAD);
    });
});

describe('Huifeng', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('uses a three-hit combo and gains one PoFeng stack per hit', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);

        const result = huifengSkill1.execute!(hero, [enemy], state);

        expect(result.damageDealt).toEqual([4, 4, 4]);
        expect(EffectManager.getCounter(hero, '破锋')).toBe(3);
    });

    it('jumps one cell and leaves a three-round blade mark at the origin', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);

        const result = SkillSystem.executeSkill(hero, huifengSkill2, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(hero.position).toEqual([2, 3]);
        expect(state.boardEffects).toEqual([
            expect.objectContaining({
                type: 'blade-mark',
                position: [2, 2],
                sourceHeroId: hero.id,
                duration: 3,
            }),
        ]);
    });

    it('marks an enemy entering a blade-mark zone with LianPo', () => {
        const state = makeGameState({
            boardEffects: [{
                id: 'mark',
                type: 'blade-mark',
                position: [2, 2],
                owner: 'player1',
                sourceHeroId: 'huifeng-source',
                duration: 3,
            }],
        });
        const enemy = addHero(state, 'moran', 'player2', [0, 2]);

        expect(MovementSystem.moveHero(enemy, [1, 2], state)).toBe(true);
        expect(enemy.effects).toEqual([
            expect.objectContaining({ name: '连破', sourceHeroId: 'huifeng-source' }),
        ]);
    });

    it('Tianwei places blade marks in four orthogonal cells', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);

        huifengTianwei.execute(hero, state);

        expect(state.boardEffects).toHaveLength(4);
        expect(state.boardEffects?.map(effect => effect.position)).toEqual(
            expect.arrayContaining([[1, 2], [3, 2], [2, 1], [2, 3]]),
        );
    });

    it('triggers an automatic combo when Fengming reaches three stacks', () => {
        const state = makeGameState();
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);
        enemy.maxHp = 500;
        enemy.currentHp = 500;
        EffectManager.addEffect(enemy, {
            type: 'mark',
            name: '连破',
            duration: 1,
            sourceHeroId: hero.id,
        });

        huifengSkill1.execute!(hero, [enemy], state);
        huifengSkill1.execute!(hero, [enemy], state);
        const third = huifengSkill1.execute!(hero, [enemy], state);

        expect(third.log.some(line => line.includes('自动释放连刃斩'))).toBe(true);
        expect(EffectManager.getCounter(hero, '破锋')).toBe(12);
        expect(EffectManager.hasEffect(enemy, '锋鸣')).toBe(false);
    });
});

describe('Xuanxiao', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('buffs one ally attack, crit rate, and crit damage for two rounds', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanxiao', 'player1', [2, 2]);
        const ally = addHero(state, 'mirror', 'player1', [2, 3]);

        const result = xuanxiaoSkill1.execute!(hero, [ally], state);

        expect(result.success).toBe(true);
        expect(EffectManager.getEffect(ally, '玄霄攻击提升')?.value).toBe(0.2);
        expect(EffectManager.getEffect(ally, '玄霄暴击率提升')?.value).toBe(0.2);
        expect(EffectManager.getEffect(ally, '玄霄暴伤提升')?.value).toBe(0.2);
    });

    it('queues the selected ally for an immediate extra action', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanxiao', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        ally.hasActedThisTurn = true;

        xuanxiaoSkill2.execute!(hero, [ally], state);

        expect(state.pendingExtraActionHeroIds?.player1).toBe(ally.id);
        expect(ally.counters['__extra_preActed']).toBe(1);
    });

    it('arms below 16 HP once, then converts the next hit into healing', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xuanxiao', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        hero.currentHp = 20;

        const first = DamageCalculator.calculate(enemy, hero, 6);
        DamageCalculator.applyDamage(hero, first, enemy, state);
        expect(hero.currentHp).toBe(14);
        expect(hero.counters['xuanxiao_danger_armed']).toBe(1);

        const second = DamageCalculator.calculate(enemy, hero, 10);
        DamageCalculator.applyDamage(hero, second, enemy, state);
        expect(second.finalDamage).toBe(0);
        expect(hero.currentHp).toBe(24);
        expect(hero.counters['xuanxiao_danger_used']).toBe(1);
    });
});

describe('Changli', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('skill 1 damages every enemy and gains one Dark Starfire per target', () => {
        const state = makeGameState();
        const hero = addHero(state, 'changli', 'player1', [0, 0]);
        const first = addHero(state, 'moran', 'player2', [0, 4]);
        const second = addHero(state, 'baize', 'player2', [5, 5]);

        const result = changliSkill1.execute!(hero, [first, second], state);

        expect(result.damageDealt).toEqual([3, 3]);
        expect(EffectManager.getCounter(hero, '暗夜星火')).toBe(2);
    });

    it('skill 1 hits every living enemy when cast through the skill system', () => {
        const state = makeGameState();
        const hero = addHero(state, 'changli', 'player1', [0, 0]);
        addHero(state, 'moran', 'player2', [0, 4]);
        addHero(state, 'baize', 'player2', [5, 5]);

        // 通过技能系统释放（点击任意格，包含空格），应命中全场所有存活敌人
        const result = SkillSystem.executeSkill(hero, changliSkill1, [[3, 3]], state);

        expect(result.success).toBe(true);
        expect(state.player2Heroes.every(enemy => enemy.currentHp === enemy.maxHp - 3)).toBe(true);
        expect(EffectManager.getCounter(hero, '暗夜星火')).toBe(2);
    });

    it('skill 2 scales with Starfire and distance', () => {
        const state = makeGameState();
        const hero = addHero(state, 'changli', 'player1', [2, 0]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);
        EffectManager.setCounter(hero, '暗夜星火', 2);

        const result = changliSkill2.execute!(hero, [enemy], state);

        // 8 × (1+2×10%) × (1+3×10%) = 8×1.2×1.3 = 12.48 → 12
        expect(result.damageDealt).toEqual([12]);
        expect(EffectManager.getCounter(hero, '暗夜星火')).toBe(2);
    });

    it('optionally consumes two Starfire for a 50% stun attempt', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.1);
        const state = makeGameState();
        const hero = addHero(state, 'changli', 'player1', [2, 0]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);
        EffectManager.setCounter(hero, '暗夜星火', 3);
        hero.counters['__changli_empowered'] = 1;

        changliSkill2.execute!(hero, [enemy], state);

        expect(EffectManager.getCounter(hero, '暗夜星火')).toBe(1);
        expect(EffectManager.hasEffect(enemy, '眩晕')).toBe(true);
    });

    it('consumes eight Starfire to survive the first lethal hit at half HP', () => {
        const state = makeGameState();
        const hero = addHero(state, 'changli', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);
        EffectManager.setCounter(hero, '暗夜星火', 8);
        hero.currentHp = 1;
        const damage = DamageCalculator.calculate(enemy, hero, 20);

        DamageCalculator.applyDamage(hero, damage, enemy, state);

        expect(damage.killed).toBe(false);
        expect(hero.state).toBe(HeroState.ALIVE);
        expect(hero.currentHp).toBe(21);
        expect(EffectManager.getCounter(hero, '暗夜星火')).toBe(0);
        expect(hero.counters['changli_revives']).toBe(1);
    });

    it('Tianwei immediately grants four Dark Starfire', () => {
        const state = makeGameState();
        const hero = addHero(state, 'changli', 'player1', [0, 0]);

        changliTianwei.execute(hero, state);

        expect(EffectManager.getCounter(hero, '暗夜星火')).toBe(4);
    });

    it('can revive at most three times with thresholds 8, 4, and 4 Starfire', () => {
        const state = makeGameState();
        const hero = addHero(state, 'changli', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [2, 3]);

        for (const required of [8, 4, 4]) {
            hero.currentHp = 1;
            EffectManager.setCounter(hero, '暗夜星火', required);
            const damage = DamageCalculator.calculate(enemy, hero, 20);
            DamageCalculator.applyDamage(hero, damage, enemy, state);
            expect(damage.killed).toBe(false);
            expect(hero.state).toBe(HeroState.ALIVE);
        }

        hero.currentHp = 1;
        EffectManager.setCounter(hero, '暗夜星火', 99);
        const finalDamage = DamageCalculator.calculate(enemy, hero, 20);
        DamageCalculator.applyDamage(hero, finalDamage, enemy, state);

        expect(finalDamage.killed).toBe(true);
        expect(hero.state).toBe(HeroState.DEAD);
        expect(hero.counters['changli_revives']).toBe(3);
    });
});

describe('Nightowl', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('marks one enemy, enters stealth, and guarantees the first marked hit is critical', () => {
        const state = makeGameState();
        const hero = addHero(state, 'nightowl', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 3]);

        nightowlSkill1.execute!(hero, [enemy], state);
        const damage = DamageCalculator.calculate(hero, enemy, 10);

        expect(EffectManager.hasEffect(hero, '潜行')).toBe(true);
        expect(EffectManager.hasEffect(enemy, '猎杀标记')).toBe(true);
        expect(damage.isCrit).toBe(true);
        expect(damage.finalDamage).toBe(15);
    });

    it('skill 2 requires both stealth and the caster own mark', () => {
        const state = makeGameState();
        const hero = addHero(state, 'nightowl', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 3]);

        expect(nightowlSkill2.execute!(hero, [enemy], state).success).toBe(false);
        nightowlSkill1.execute!(hero, [enemy], state);
        expect(nightowlSkill2.execute!(hero, [enemy], state).success).toBe(true);
        expect(EffectManager.hasEffect(hero, '潜行')).toBe(false);
    });

    it('Tianwei immediately enters stealth and primes defense penetration', () => {
        const state = makeGameState();
        const hero = addHero(state, 'nightowl', 'player1', [0, 0]);

        nightowlTianwei.execute(hero, state);

        expect(EffectManager.hasEffect(hero, '潜行')).toBe(true);
        expect(hero.counters['ignore_defense_next']).toBe(1);
    });
});

describe('Mirror', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('skill 1 creates a mirror at the center-symmetric position and splits HP', () => {
        const state = makeGameState();
        const mirror = addHero(state, 'mirror', 'player1', [1, 1]);
        mirror.currentHp = 30;

        const result = mirrorSkill1.execute!(mirror, [], state);
        const clone = state.board[4][4];

        expect(result.success).toBe(true);
        expect(clone?.counters['__isClone']).toBe(1);
        expect(mirror.currentHp).toBe(19);
        expect(clone?.currentHp).toBe(19);
    });

    it('skill 2 swaps with its own clone and damages diagonal path enemies', () => {
        const state = makeGameState();
        const mirror = addHero(state, 'mirror', 'player1', [0, 0]);
        const clone = createMirrorClone('player1', mirror.id, [3, 3], mirror.maxHp, 20);
        state.board[3][3] = clone;
        const enemy = addHero(state, 'baize', 'player2', [1, 1]);

        const result = mirrorSkill2.execute!(mirror, [clone], state);

        expect(result.success).toBe(true);
        expect(mirror.position).toEqual([3, 3]);
        expect(clone.position).toEqual([0, 0]);
        // 路径伤害 10 + 基础攻击力14 = 24；交换后不收回镜像获得1层破镜之刃并立即释放（5点）
        expect(enemy.currentHp).toBe(enemy.maxHp - 24 - 5);
        expect(EffectManager.getCounter(mirror, '破镜之刃')).toBe(0);
    });

    it('skill 2 clicking self recalls the clone: merges HP and heals 6, allowing overflow', () => {
        const state = makeGameState();
        const mirror = addHero(state, 'mirror', 'player1', [0, 0]);
        const clone = createMirrorClone('player1', mirror.id, [5, 5], mirror.maxHp, 20);
        state.board[5][5] = clone;
        mirror.currentHp = 30;
        const enemy = addHero(state, 'baize', 'player2', [1, 1]);
        enemy.currentHp = 100; // 远离破镜范围避免被动干扰？不，先让它死不掉即可

        const result = mirrorSkill2.execute!(mirror, [mirror], state);

        expect(result.success).toBe(true);
        // 收回：合体 30 + 20 + 12 = 62（允许溢出上限40）
        expect(mirror.currentHp).toBe(62);
        expect(clone.state).toBe(HeroState.DEAD);
        expect(state.board[5][5]).toBeNull();
        // 点本体也有路径伤害：镜本体 [0,0] 与镜像 [5,5] 对角，路径经过 [1,1] 敌人
        expect(enemy.currentHp).toBe(100 - 24);
    });
});

describe('Mowen', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('skill 1 deals damage, restores previous-round HP, and starts cooldown', () => {
        const state = makeGameState();
        const hero = addHero(state, 'mowen', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 1]);
        hero.counters['mowen_prev_hp'] = 35;
        hero.currentHp = 10;

        const result = mowenSkill1.execute!(hero, [enemy], state);

        expect(result.damageDealt).toEqual([8]);
        expect(hero.currentHp).toBe(35);
        expect(hero.counters['mowen_skill1_cd']).toBe(2);
        expect(mowenSkill1.execute!(hero, [enemy], state).success).toBe(false);
    });

    it('skill 2 pays 20% current HP before calculating lost-HP scaling', () => {
        const state = makeGameState();
        const hero = addHero(state, 'mowen', 'player1', [0, 0]);
        const enemy = addHero(state, 'liuli', 'player2', [0, 1]);
        hero.currentHp = 20;

        const result = mowenSkill2.execute!(hero, [enemy], state);

        expect(hero.currentHp).toBe(16);
        expect(result.damageDealt).toEqual([19]);
    });

    it('cooldown ticks at round boundaries so skill 1 cannot be used on consecutive turns', () => {
        const state = makeGameState();
        const hero = addHero(state, 'mowen', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 1]);

        mowenSkill1.execute!(hero, [enemy], state);
        expect(hero.counters['mowen_skill1_cd']).toBe(2);

        // 下一回合开始：冷却减 1，技能1 仍不可用
        GameEngine.startNewTurn(state);
        expect(hero.counters['mowen_skill1_cd']).toBe(1);
        expect(mowenSkill1.execute!(hero, [enemy], state).success).toBe(false);

        // 再下一回合开始：冷却归零，技能1 恢复可用（间隔了一个完整回合）
        GameEngine.startNewTurn(state);
        expect(hero.counters['mowen_skill1_cd']).toBe(0);
        expect(mowenSkill1.execute!(hero, [enemy], state).success).toBe(true);
    });

    it('ending an action does not tick the cooldown, so extra actions cannot bypass it', () => {
        const state = makeGameState();
        const hero = addHero(state, 'mowen', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 1]);

        mowenSkill1.execute!(hero, [enemy], state);
        expect(hero.counters['mowen_skill1_cd']).toBe(2);

        GameEngine.endHeroAction(hero, state);
        GameEngine.endHeroAction(hero, state);
        expect(hero.counters['mowen_skill1_cd']).toBe(2);
    });
});

describe('Guying', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('skill 1 hits the first enemy in a direction, applies cold, and lands behind it', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 0]);
        const enemy = addHero(state, 'baize', 'player2', [2, 2]);

        const result = SkillSystem.executeSkill(hero, guyingSkill1, [[2, 5]], state);

        expect(result.success).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp - 8);
        expect(EffectManager.getEffect(enemy, '寒天')?.stackCount).toBe(1);
        expect(hero.position).toEqual([2, 3]);
    });

    it('three cold stacks convert to a one-round freeze', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 0]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 2]);
        EffectManager.addEffect(enemy, {
            type: 'debuff',
            name: '寒天',
            duration: -1,
            stackCount: 2,
            sourceHeroId: hero.id,
        });

        SkillSystem.executeSkill(hero, guyingSkill1, [[2, 5]], state);

        expect(EffectManager.hasEffect(enemy, '寒天')).toBe(false);
        expect(EffectManager.hasEffect(enemy, '冰冻')).toBe(true);
    });

    it('skill 2 gains 50% damage against a frozen target', () => {
        const state = makeGameState();
        const hero = addHero(state, 'guying', 'player1', [2, 2]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);
        EffectManager.addEffect(enemy, {
            type: 'stun',
            name: '冰冻',
            duration: 1,
            sourceHeroId: hero.id,
        });

        const result = guyingSkill2.execute!(hero, [enemy], state);

        expect(result.damageDealt).toEqual([15]);
    });
});

describe('Hanjiangxue', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('skill 1 hits a 3x3 area around the chosen point, adds hantian, and deals brittle damage to chilled targets', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const chilled = addHero(state, 'baize', 'player2', [1, 3]);
        const plain = addHero(state, 'liuli', 'player2', [3, 5]);
        chilled.effects.push({
            id: 'e-hantian',
            type: 'debuff',
            name: '寒天',
            duration: -1,
            stackCount: 1,
            sourceHeroId: caster.id,
            description: '寒天',
        });

        // 中心点 (2,4)：3x3 覆盖 (1,3) 与 (3,5)
        const result = SkillSystem.executeSkill(caster, hanjiangxueSkill1, [[2, 4]], state);

        expect(result.success).toBe(true);
        // 带寒天目标吃脆伤 6 点，普通目标 5 点
        expect(result.damageDealt).toEqual([6, 5]);
        expect(EffectManager.getEffect(chilled, '寒天')?.stackCount).toBe(2);
        expect(EffectManager.getEffect(plain, '寒天')?.stackCount).toBe(1);
    });

    it('hantian reaching three stacks converts to freeze', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        enemy.effects.push({
            id: 'e-hantian',
            type: 'debuff',
            name: '寒天',
            duration: -1,
            stackCount: 2,
            sourceHeroId: caster.id,
            description: '寒天',
        });

        SkillSystem.executeSkill(caster, hanjiangxueSkill1, [[2, 4]], state);

        expect(EffectManager.hasEffect(enemy, '寒天')).toBe(false);
        expect(EffectManager.hasEffect(enemy, '冰冻')).toBe(true);
    });

    it('skill 1 covering a friendly ice crystal grants ice armor and an extra action', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        // 冰晶放在 (2,3)，技能1 中心 (2,4) 的 3x3 覆盖它
        expect(SkillSystem.executeSkill(caster, hanjiangxueSkill2, [[2, 3]], state).success).toBe(true);

        const result = SkillSystem.executeSkill(caster, hanjiangxueSkill1, [[2, 4]], state);

        expect(result.success).toBe(true);
        expect(EffectManager.hasEffect(caster, '冰甲')).toBe(true);
        expect(state.pendingExtraActionHeroIds?.['player1']).toBe(caster.id);
        // 冰晶被消耗后消失
        expect(state.boardEffects?.some(effect =>
            effect.type === 'ice-crystal' &&
            effect.position[0] === 2 && effect.position[1] === 3
        )).toBe(false);
    });

    it('skill 1 covering a crystal does not grant ice armor twice', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 4]);
        SkillSystem.executeSkill(caster, hanjiangxueSkill2, [[2, 3]], state);
        EffectManager.addIceArmor(caster, caster.id);

        SkillSystem.executeSkill(caster, hanjiangxueSkill1, [[2, 4]], state);

        // 已有冰甲时不再触发再动
        expect(state.pendingExtraActionHeroIds?.['player1']).toBeUndefined();
    });

    it('ice crystal blocks enemy movement but lets friendly heroes reach it for ice armor', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        const enemy = addHero(state, 'baize', 'player2', [0, 3]);
        SkillSystem.executeSkill(caster, hanjiangxueSkill2, [[1, 3]], state);

        // 敌方不能移动到冰晶位置
        const enemyMoves = MovementSystem.getMovablePositions(enemy, state);
        expect(enemyMoves.some(([row, col]) => row === 1 && col === 3)).toBe(false);

        // 友方可以移动到达并获得冰甲，冰晶随即消失
        const allyMoves = MovementSystem.getMovablePositions(ally, state);
        expect(allyMoves.some(([row, col]) => row === 1 && col === 3)).toBe(true);
        expect(MovementSystem.moveHero(ally, [1, 3], state)).toBe(true);
        expect(EffectManager.hasEffect(ally, '冰甲')).toBe(true);
        expect(state.boardEffects?.some(effect =>
            effect.type === 'ice-crystal' &&
            effect.position[0] === 1 && effect.position[1] === 3
        )).toBe(false);
    });

    it('moving onto a crystal consumes it even when the hero already has ice armor', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        const enemy = addHero(state, 'baize', 'player2', [0, 3]);
        SkillSystem.executeSkill(caster, hanjiangxueSkill2, [[1, 3]], state);
        // 模拟被动雪誓已附加冰甲
        EffectManager.addIceArmor(ally, caster.id);

        expect(MovementSystem.moveHero(ally, [1, 3], state)).toBe(true);

        // 冰甲保持，冰晶被拾取消失
        expect(EffectManager.hasEffect(ally, '冰甲')).toBe(true);
        expect(state.boardEffects?.some(effect =>
            effect.type === 'ice-crystal' &&
            effect.position[0] === 1 && effect.position[1] === 3
        )).toBe(false);
    });

    it('ice armor reduces incoming damage by 20% and gives the attacker one hantian stack', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const attacker = addHero(state, 'baize', 'player2', [2, 4]);
        EffectManager.addIceArmor(caster, caster.id);

        const damage = DamageCalculator.calculate(attacker, caster, 10);

        expect(damage.finalDamage).toBe(8);
        DamageCalculator.applyDamage(caster, damage, attacker, state);
        expect(EffectManager.getEffect(attacker, '寒天')?.stackCount).toBe(1);
        expect(caster.currentHp).toBe(caster.maxHp - 8);
    });

    it('passive grants ice armor to the lowest-HP ally at round end', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const wounded = addHero(state, 'moran', 'player1', [2, 4]);
        const healthy = addHero(state, 'liuli', 'player1', [5, 5]);
        const enemy = addHero(state, 'baize', 'player2', [0, 0]);
        wounded.currentHp = 10;
        healthy.currentHp = 30;

        caster.hasActedThisTurn = true;
        wounded.hasActedThisTurn = true;
        healthy.hasActedThisTurn = true;
        GameEngine.endHeroAction(enemy, state);

        expect(EffectManager.hasEffect(wounded, '冰甲')).toBe(true);
        expect(EffectManager.hasEffect(healthy, '冰甲')).toBe(false);
        expect(EffectManager.hasEffect(caster, '冰甲')).toBe(false);
    });

    it('tianwei adds one hantian stack to all living enemies after a kill', () => {
        const state = makeGameState();
        const caster = addHero(state, 'hanjiangxue', 'player1', [2, 2]);
        const victim = addHero(state, 'baize', 'player2', [2, 4]);
        const survivor = addHero(state, 'liuli', 'player2', [5, 5]);
        victim.currentHp = 2;

        const result = SkillSystem.executeSkill(caster, hanjiangxueSkill1, [[2, 4]], state);

        expect(result.success).toBe(true);
        expect(victim.state).toBe(HeroState.DEAD);
        // 存活敌人全部获得1层寒天
        expect(EffectManager.getEffect(survivor, '寒天')?.stackCount).toBe(1);
        // 已死亡的受害者不参与天威结算（它身上的寒天来自技能1命中时）
        expect(victim.state).toBe(HeroState.DEAD);
    });
});
