import { beforeEach, describe, expect, it } from 'vitest';
import {
    getHeroesWithoutZhizhi,
    getZhizhi,
    HERO_ZHIZHI,
    zhizhiTierLabel,
} from '../../src/data/hero-zhizhi';
import { AVAILABLE_HERO_IDS, HIDDEN_HERO_IDS, createHero, getWukongCritRate, mirrorTianwei } from '../../src/data/heroes';
import { applyZhizhiForMode, grantZhizhi, hasZhizhi, zhizhiValue } from '../../src/core/hero-zhizhi';
import { SkillSystem } from '../../src/core/skill-system';
import { huifengComboHits, huifengPoFengAmp } from '../../src/core/huifeng-marks';
import { getWindLaneDodgeRate } from '../../src/core/wind-lane';
import { bardSkill2, getZhiguangBeamDamage, heroXSkill1, placeZhiguangPrism } from '../../src/data/extended-skills';
import { huifengSkill2, xuanxiaoSkill1 } from '../../src/data/skills';
import { useGameStore } from '../../src/store/game-store';
import { HeroState, type Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 致知：每个英雄三条，只在经典模式授予。
 * 这里既守住"登记表齐全"，也守住"标准模式一律不生效"——
 * 后者是现有平衡读数的护栏：任何时候在标准模式看到致知数值，都算回归。
 */

describe('致知登记表', () => {
    it('每个可上场英雄都有三条致知', () => {
        expect(getHeroesWithoutZhizhi()).toEqual([]);
        // 登记表允许保留"暂时下架"的英雄（HIDDEN_HERO_IDS 只藏前端、代码全留），
        // 所以只要求上架的人一个不缺、且表里没有来路不明的 id
        expect(Object.keys(HERO_ZHIZHI).filter(id => !HIDDEN_HERO_IDS.includes(id)))
            .toHaveLength(AVAILABLE_HERO_IDS.length);
    });

    it('三条依次为致知一/二/三，文案非空或明确留白', () => {
        for (const heroId of AVAILABLE_HERO_IDS) {
            const entries = getZhizhi(heroId);
            expect(entries.map(entry => entry.tier)).toEqual([1, 2, 3]);
            for (const entry of entries) {
                if (entry.text !== null) expect(entry.text.length, `${heroId} 致知${entry.tier}`).toBeGreaterThan(1);
            }
        }
        expect(zhizhiTierLabel(2)).toBe('致知二');
    });

    it('设计稿留白的条目只剩霆渊与云岫的致知三', () => {
        const blanks = Object.entries(HERO_ZHIZHI)
            .flatMap(([heroId, entries]) => entries
                .filter(entry => entry.text === null)
                .map(entry => `${heroId}:${entry.tier}`));
        // 上官婉儿致知三已在 2026-10 补齐（每层墨意+5%技能伤害，封顶30%）；
        // 霆渊与云岫的策划案第三条写着「暂无」，登记留白而不是偷偷补一条自拟增益
        expect(blanks).toEqual(['tingyuan:3', 'yunxiu:3']);
    });
});

describe('致知授予', () => {
    it('标准模式与未指定模式都不授予', () => {
        for (const mode of [undefined, 'standard'] as const) {
            const hero = applyZhizhiForMode(createHero('moran', 'player1', [0, 0]), mode);
            expect(hasZhizhi(hero, 1)).toBe(false);
            expect(hasZhizhi(hero, 2)).toBe(false);
            expect(hasZhizhi(hero, 3)).toBe(false);
            expect(hero.maxHp).toBe(47);
        }
    });

    it('经典模式三层全给，常驻属性只落一次', () => {
        const hero = createHero('moran', 'player1', [0, 0]);
        applyZhizhiForMode(hero, 'classic');
        expect([hasZhizhi(hero, 1), hasZhizhi(hero, 2), hasZhizhi(hero, 3)]).toEqual([true, true, true]);
        expect(hero.maxHp).toBe(57);

        applyZhizhiForMode(hero, 'classic');
        applyZhizhiForMode(hero, 'classic');
        expect(hero.maxHp, '重复装载不得反复加血').toBe(57);
    });

    it('召唤物与分身不领自己的致知', () => {
        const clone = createHero('wukong', 'player1', [0, 0]);
        clone.counters['__isClone'] = 1;
        applyZhizhiForMode(clone, 'classic');
        expect(hasZhizhi(clone, 1)).toBe(false);
    });

    it('zhizhiValue 在来源缺席时退回原值', () => {
        const hero: Hero | undefined = undefined;
        expect(zhizhiValue(hero, 1, 3, 4)).toBe(3);
    });

    it('经典模式布阵上场的英雄带着致知与加成', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            gameMode: 'classic',
            phase: 'deploy',
            selectingPlayer: 'player1',
            player1SelectedHeroIds: ['xueqi', 'dai', 'baize'],
            player2SelectedHeroIds: ['moran'],
            isOnlineMode: false,
            isAiMode: false,
        });

        expect(useGameStore.getState().deployHeroForPlayer('player1', 'xueqi', [0, 0])).toBe(true);
        expect(useGameStore.getState().deployHeroForPlayer('player1', 'dai', [1, 0])).toBe(true);
        expect(useGameStore.getState().deployHeroForPlayer('player1', 'baize', [2, 0])).toBe(true);

        const heroes = useGameStore.getState().player1Heroes;
        const xueqi = heroes.find(hero => hero.id.startsWith('xueqi-'))!;
        const dai = heroes.find(hero => hero.id.startsWith('dai-'))!;
        const baize = heroes.find(hero => hero.id.startsWith('baize-'))!;

        expect(xueqi.maxHp).toBe(68);          // 致知1 +10
        expect(xueqi.moveRange).toBe(3);       // 致知2 +1
        expect(dai.maxHp).toBe(63);            // 致知1 +8 与 致知2 +10 叠满
        expect(baize.counters['天禄'], '致知3：开局自带一层天禄').toBe(1);
    });
});

describe('致知的结算分支', () => {
    beforeEach(() => useGameStore.getState().resetGame());

    it('折光：致知2 抬光束基础伤害，致知3 延长光棱存续', () => {
        const state = makeGameState();
        const zhiguang = addHero(state, 'zhiguang', 'player1', [3, 0]);
        expect(getZhiguangBeamDamage(zhiguang, 0)).toBe(6);
        expect(zhizhiValue(zhiguang, 2, 6, 8)).toBe(6);

        grantZhizhi(zhiguang, 2);
        grantZhizhi(zhiguang, 3);
        expect(getZhiguangBeamDamage(zhiguang, 0)).toBe(8);
        expect(getZhiguangBeamDamage(zhiguang, 2)).toBe(12);

        placeZhiguangPrism(zhiguang, state, [3, 2]);
        expect(state.boardEffects?.find(effect => effect.position[0] === 3 && effect.position[1] === 2)?.duration)
            .toBe(4);
    });

    it('玄霄：致知1 把技能一的暴击与暴伤抬到 30%', () => {
        const state = makeGameState();
        const xuanxiao = addHero(state, 'xuanxiao', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        grantZhizhi(xuanxiao, 1);

        SkillSystem.executeSkill(xuanxiao, xuanxiaoSkill1, [[ally.position![0], ally.position![1]]], state);

        expect(ally.effects.find(effect => effect.name === '玄霄暴击率提升')?.value).toBe(0.3);
        expect(ally.effects.find(effect => effect.name === '玄霄暴伤提升')?.value).toBe(0.3);
        expect(ally.effects.find(effect => effect.name === '玄霄增伤提升')?.value, '增伤项不变').toBe(0.2);
    });

    it('英雄X：致知1 从随机改为按点击选定目标', () => {
        const state = makeGameState();
        const heroX = addHero(state, 'hero_x', 'player1', [2, 2]);
        const chosen = addHero(state, 'moran', 'player2', [0, 0]);
        addHero(state, 'baize', 'player2', [5, 5]);

        SkillSystem.executeSkill(heroX, heroXSkill1, [[5, 5]], state);
        expect(chosen.currentHp, '未授予致知时不碰随机之外的人').toBe(chosen.maxHp);

        grantZhizhi(heroX, 1);
        SkillSystem.executeSkill(heroX, heroXSkill1, [[0, 0]], state);
        expect(chosen.state).toBe(HeroState.ALIVE);
        expect(chosen.currentHp).toBeLessThan(chosen.maxHp);
    });

    it('回锋：致知2 抬破锋增伤，致知3 把技能二伤害 5 → 7（段数改由专属器给）', () => {
        const state = makeGameState();
        const huifeng = addHero(state, 'huifeng', 'player1', [2, 2]);
        const victim = addHero(state, 'moran', 'player2', [2, 3]);

        const markDamage = () => {
            // 每次都从"无破锋、无连破/啸刃"的干净局面量基础值
            huifeng.counters['破锋'] = 0;
            victim.effects = [];
            victim.currentHp = victim.maxHp;
            SkillSystem.executeSkill(huifeng, huifengSkill2, [], state);
            return victim.maxHp - victim.currentHp;
        };

        expect(markDamage()).toBe(5);

        grantZhizhi(huifeng, 3);
        expect(markDamage()).toBe(7);

        huifeng.counters['破锋'] = 3;
        expect(huifengPoFengAmp(huifeng)).toBeCloseTo(1.3);
        grantZhizhi(huifeng, 2);
        expect(huifengPoFengAmp(huifeng)).toBeCloseTo(1.45);

        // 段数不再挂致知3：那是专属器「千锋尽」的活
        expect(huifengComboHits(huifeng)).toBe(3);
        huifeng.weaponId = 'huifeng';
        expect(huifengComboHits(huifeng)).toBe(4);
    });

    it('南风：致知3 把每道风道的闪避从 25% 抬到 30%，上限仍是 50%', () => {
        const state = makeGameState();
        const nanfeng = addHero(state, 'nanfeng', 'player1', [2, 2]);
        state.boardEffects = [
            {
                id: 'lane-a', type: 'wind-lane', position: [2, 2], owner: 'player1',
                sourceHeroId: nanfeng.id, duration: 2, linkId: 'lane-a', direction: 3,
            },
        ];
        expect(getWindLaneDodgeRate(state, nanfeng)).toBeCloseTo(0.25);

        grantZhizhi(nanfeng, 3);
        expect(getWindLaneDodgeRate(state, nanfeng)).toBeCloseTo(0.3);
    });

    it('吟游诗人：致知3 把协奏曲的范围从 2 格扩到 3 格', () => {
        const state = makeGameState();
        const bard = addHero(state, 'bard', 'player1', [0, 0]);
        expect(SkillSystem.rangeFor(bardSkill2, bard)).toBe(2);
        grantZhizhi(bard, 3);
        expect(SkillSystem.rangeFor(bardSkill2, bard)).toBe(3);
    });

    it('孙悟空：致知1 抬初始暴击，致知3 抬每层灵犀，分身跟着吃到', () => {
        const state = makeGameState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);
        wukong.counters['灵犀'] = 2;
        expect(getWukongCritRate(wukong)).toBeCloseTo(0.7);   // 0.3 + 2×0.2

        grantZhizhi(wukong, 1);
        grantZhizhi(wukong, 3);
        expect(getWukongCritRate(wukong)).toBeCloseTo(1);     // 0.5 + 2×0.3，封顶 100%
    });

    it('镜：致知2 让天威多给一层破镜之刃', () => {
        const state = makeGameState();
        const mirror = addHero(state, 'mirror', 'player1', [2, 2]);
        mirrorTianwei.execute(mirror, state);
        expect(mirror.counters['破镜之刃']).toBe(3);

        const other = addHero(state, 'mirror', 'player2', [4, 4]);
        grantZhizhi(other, 2);
        mirrorTianwei.execute(other, state);
        expect(other.counters['破镜之刃']).toBe(4);
    });

    it('沉渊：致知1 真的把生命抬到 70（不再只是文案）', () => {
        const state = makeGameState();
        const chenyuan = addHero(state, 'chenyuan', 'player1', [2, 2]);
        expect(chenyuan.maxHp).toBe(60);

        grantZhizhi(chenyuan, 1);
        expect(chenyuan.maxHp).toBe(70);
        expect(chenyuan.currentHp).toBe(70);
    });

    it('缚魂灯：致知3 把吸血起始抬到 50%，重复授予不叠加', () => {
        const state = makeGameState();
        const lamp = addHero(state, 'soul_lamp', 'player1', [2, 2]);
        expect(lamp.counters['soul_lamp_vampire_rate']).toBeCloseTo(0.3);

        grantZhizhi(lamp, 3);
        expect(lamp.counters['soul_lamp_vampire_rate']).toBeCloseTo(0.5);

        grantZhizhi(lamp, 3);
        expect(lamp.counters['soul_lamp_vampire_rate'], '起始增量只能落一次').toBeCloseTo(0.5);
    });

    it('英雄X：致知3 起 2 层增势就能指定承伤者', () => {
        const state = makeGameState();
        const heroX = addHero(state, 'hero_x', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        heroX.counters['增势'] = 2;
        useGameStore.setState({ ...state, currentPlayer: 'player1', selectedHero: heroX });

        useGameStore.getState().selectHeroXRedirectTarget(ally.id);
        expect(useGameStore.getState().heroXRedirectTargetIds?.[heroX.id], '门槛仍是 3 层').toBeUndefined();

        grantZhizhi(heroX, 3);
        useGameStore.getState().selectHeroXRedirectTarget(ally.id);
        expect(useGameStore.getState().heroXRedirectTargetIds?.[heroX.id], '致知3 降到 2 层').toBe(ally.id);
    });
});
