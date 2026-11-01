import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { SkillSystem } from '../../src/core/skill-system';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import {
    CHARGE_DAMAGE,
    FIST_COUNT,
    FIST_DAMAGE,
    MOUNTAIN_DAMAGE,
    VAJRA_COUNTER,
    VAJRA_DEFENSE_PER_LAYER,
    VAJRA_MAX,
    gainVajra,
    pushDistanceFor,
    spendVajraBurst,
    vajraDefenseRate,
    vajraLayers,
} from '../../src/core/vajra-push';
import { damoSkill1, damoSkill2 } from '../../src/data/extended-skills';
import { createHero, getHeroInfo } from '../../src/data/heroes';
import { HeroState, type GameState, type Hero, type Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 达摩：贴身一苇渡江把人推出去，撞山补伤 + 眩晕；易筋四拳随机打身边一圈。
 * 随机数默认钉在 0.99：不暴击、四拳永远挑候选里的最后一个，结算走确定分支。
 */
const NO_RANDOM = 0.99;

function scene(): { state: GameState; damo: Hero } {
    const state = makeGameState();
    const damo = addHero(state, 'damo', 'player1', [2, 2]);
    damo.defense = 0;
    return { state, damo };
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

function castSkill1(state: GameState, caster: Hero, target: Position) {
    return SkillSystem.executeSkill(caster, damoSkill1, [target], state);
}

function castSkill2(state: GameState, caster: Hero) {
    return SkillSystem.executeSkill(caster, damoSkill2, [[caster.position![0], caster.position![1]]], state);
}

beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(NO_RANDOM);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('达摩 · 面板', () => {
    it('生命50、移动力2、霸魁，带金刚被动', () => {
        const info = getHeroInfo('damo');
        expect([info.name, info.class]).toEqual(['达摩', '霸魁']);
        const hero = createHero('damo', 'player1', [0, 0]);
        expect([hero.maxHp, hero.moveRange, hero.passiveId]).toEqual([50, 2, 'damo_passive']);
    });
});

describe('达摩 · 技能一「一苇渡江」', () => {
    it('目标本来就贴着墙：一格没推动也算撞山，补伤并眩晕', () => {
        const { state, damo } = scene();
        damo.position = [2, 4];
        state.board[2][2] = null;
        state.board[2][4] = damo;
        const victim = foe(state, [2, 5]);

        const output = castSkill1(state, damo, [2, 5]);

        expect(output.success).toBe(true);
        expect(victim.currentHp).toBe(victim.maxHp - CHARGE_DAMAGE - MOUNTAIN_DAMAGE);
        expect(EffectManager.hasEffect(victim, '撞山眩晕')).toBe(true);
        expect(output.log.join('')).toContain('撞上山壁');
        // 一格没动，达摩留在原地
        expect(damo.position).toEqual([2, 4]);
    });

    it('推出1格后顶到边：撞山、眩晕，达摩跟进占住原格并叠1层金刚', () => {
        const { state, damo } = scene();
        damo.position = [2, 3];
        state.board[2][2] = null;
        state.board[2][3] = damo;
        damo.currentHp = 40;
        const victim = foe(state, [2, 4]);

        const output = castSkill1(state, damo, [2, 4]);

        expect(output.success).toBe(true);
        expect(victim.position).toEqual([2, 5]);
        expect(victim.currentHp).toBe(victim.maxHp - CHARGE_DAMAGE - MOUNTAIN_DAMAGE);
        expect(EffectManager.hasEffect(victim, '撞山眩晕')).toBe(true);
        expect(damo.position).toEqual([2, 4]);
        expect(damo.hasMovedThisTurn).toBe(true);
        expect(vajraLayers(damo)).toBe(1);
        expect(damo.currentHp).toBe(42);   // 叠层回 2 点
    });

    it('被其他单位挡住：只吃基础伤害，不算撞山、不眩晕', () => {
        const { state, damo } = scene();
        damo.position = [2, 1];
        state.board[2][2] = null;
        state.board[2][1] = damo;
        const victim = foe(state, [2, 2]);
        ally(state, [2, 4]);   // 第二格被队友占住

        const output = castSkill1(state, damo, [2, 2]);

        expect(output.success).toBe(true);
        expect(victim.position).toEqual([2, 3]);
        expect(victim.currentHp).toBe(victim.maxHp - CHARGE_DAMAGE);
        expect(EffectManager.hasEffect(victim, '撞山眩晕')).toBe(false);
        expect(output.log.join('')).toContain('被同伴挡住');
    });

    it('已经行动过的人撞山只掉血，不补眩晕', () => {
        const { state, damo } = scene();
        damo.position = [2, 4];
        state.board[2][2] = null;
        state.board[2][4] = damo;
        const victim = foe(state, [2, 5]);
        victim.hasActedThisTurn = true;

        castSkill1(state, damo, [2, 5]);

        expect(victim.currentHp).toBe(victim.maxHp - CHARGE_DAMAGE - MOUNTAIN_DAMAGE);
        expect(EffectManager.hasEffect(victim, '撞山眩晕')).toBe(false);
    });

    it('斜着站的人撞不到', () => {
        const { state, damo } = scene();
        foe(state, [1, 1]);
        expect(castSkill1(state, damo, [1, 1]).success).toBe(false);
    });

    it('满4层金刚时这一推多走1格并清空层数', () => {
        const { state, damo } = scene();
        damo.position = [2, 1];
        state.board[2][2] = null;
        state.board[2][1] = damo;
        damo.counters[VAJRA_COUNTER] = VAJRA_MAX;
        const victim = foe(state, [2, 2]);

        castSkill1(state, damo, [2, 2]);

        // 基础2格 + 满层1格：从 (2,2) 推到 (2,5)
        expect(victim.position).toEqual([2, 5]);
        expect(vajraLayers(damo)).toBe(3);   // 先花掉4层，再按实际推动格数叠回3层
    });
});

describe('达摩 · 技能二「易筋四拳」', () => {
    it('身边贴墙的敌人原地吃满4拳，每拳3点；这一下不触发撞山', () => {
        vi.spyOn(Math, 'random').mockReturnValue(NO_RANDOM);
        const { state, damo } = scene();
        damo.position = [2, 4];
        state.board[2][2] = null;
        state.board[2][4] = damo;
        const victim = foe(state, [2, 5]);

        const output = castSkill2(state, damo);

        expect(output.success).toBe(true);
        expect(victim.currentHp).toBe(victim.maxHp - FIST_COUNT * FIST_DAMAGE);
        expect(EffectManager.hasEffect(victim, '撞山眩晕')).toBe(false);
        expect(output.log.join('')).toContain(`挥出${FIST_COUNT}拳`);
    });

    it('身边没有敌人时放不出来', () => {
        vi.spyOn(Math, 'random').mockReturnValue(NO_RANDOM);
        const { state, damo } = scene();
        foe(state, [0, 0]);
        expect(castSkill2(state, damo).success).toBe(false);
    });
});

describe('达摩 · 被动「金刚」', () => {
    it('每层2%防御、上限4层、不衰减', () => {
        const { damo } = scene();
        damo.passiveId = 'damo_passive';
        damo.counters[VAJRA_COUNTER] = 2;
        expect(vajraLayers(damo)).toBe(2);
        expect(vajraDefenseRate(damo)).toBeCloseTo(2 * VAJRA_DEFENSE_PER_LAYER);
        damo.counters[VAJRA_COUNTER] = 10;
        expect(vajraLayers(damo)).toBe(VAJRA_MAX);
        expect(vajraDefenseRate(damo)).toBeCloseTo(VAJRA_MAX * VAJRA_DEFENSE_PER_LAYER);
    });

    it('按实际推动格数叠层并当场回血，满层封顶', () => {
        const { state, damo } = scene();
        damo.currentHp = 30;

        gainVajra(damo, 2, state);
        expect(vajraLayers(damo)).toBe(2);
        expect(damo.currentHp).toBe(34);

        gainVajra(damo, 10, state);
        expect(vajraLayers(damo)).toBe(VAJRA_MAX);
        expect(damo.currentHp).toBe(38);   // 只再叠2层，各回2点
    });

    it('满4层时下一次推动多走1格；花掉后归零', () => {
        const { damo } = scene();
        expect(pushDistanceFor(damo, 2)).toBe(2);
        damo.counters[VAJRA_COUNTER] = VAJRA_MAX;
        expect(pushDistanceFor(damo, 2)).toBe(3);
        expect(spendVajraBurst(damo)).toBe(true);
        expect(vajraLayers(damo)).toBe(0);
    });

    it('致知二把每层回血抬到3点', () => {
        const { state, damo } = scene();
        grantZhizhi(damo, 2);
        damo.currentHp = 30;
        gainVajra(damo, 1, state);
        expect(damo.currentHp).toBe(33);
    });
});
