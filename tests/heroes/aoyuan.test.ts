import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import {
    DASH_DISTANCE,
    DRAGON_DURATION,
    SCALES_SUSTAIN_COST,
    advanceDragon,
    attachDragon,
    dragonDashDistance,
    dragonOrbitIndex,
    dragonSummonCells,
    getScaleDodgeRate,
    hasDragon,
    nextOrbitLeg,
    scaleAttackMultiplier,
    scaleLayers,
    sustainDragonAtRoundStart,
} from '../../src/core/dragon-orbit';
import {
    DRAGON_SWEEP_LEAD_MS,
    DRAGON_SWEEP_STEP_MS,
    dragonCoilBearingDeg,
} from '../../src/core/dragon-sweep-fx';
import { computeFxImpactDelayMs, resolveSkillFx } from '../../src/core/skill-fx';
import { drainPendingSkillFxRequests } from '../../src/data/extended-skills';
import { GameEngine } from '../../src/core/game-engine';
import { aoyuanSkill1, aoyuanSkill2 } from '../../src/data/extended-skills';
import { getHeroInfo } from '../../src/data/heroes';
import type { GameState, Hero, Position } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 游龙·敖渊：不占格的绕身游龙 + 每回合扫半圈 + 逐层衰减的龙鳞。
 * Math.random 默认钉在 0.99：不闪避、不暴击，所有结算走确定分支。
 */

function scene() {
    const state = makeGameState();
    const aoyuan = addHero(state, 'aoyuan', 'player1', [2, 2]);
    aoyuan.defense = 0;
    return { state, aoyuan };
}

function dummy(state: GameState, position: Position, owner: 'player1' | 'player2' = 'player2'): Hero {
    const unit = addHero(state, 'baize', owner, position);
    unit.defense = 0;
    unit.maxHp = 300;
    unit.currentHp = 300;
    return unit;
}

function click(caster: Hero, cell: Position): void {
    caster.counters['__extended_target'] = cell[0] * 6 + cell[1];
}

function cast1(caster: Hero, state: GameState, cell: Position) {
    click(caster, cell);
    return aoyuanSkill1.execute!(caster, [], state);
}

function cast2(caster: Hero, state: GameState, cell: Position) {
    click(caster, cell);
    return aoyuanSkill2.execute!(caster, [], state);
}

function layers(hero: Hero): number {
    return scaleLayers(hero);
}

beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('游龙·敖渊 · 模板', () => {
    it('生命46、移动3、武曲，天威是龙腾四海', () => {
        const { aoyuan } = scene();
        expect(aoyuan.maxHp).toBe(46);
        expect(aoyuan.moveRange).toBe(3);
        expect(aoyuan.class).toBe('武曲');
        expect(aoyuan.tianweiId).toBe('aoyuan_tianwei');
        expect(getHeroInfo('aoyuan').name).toBe('游龙·敖渊');
    });

    it('致知一 +8 生命', () => {
        const { aoyuan } = scene();
        grantZhizhi(aoyuan, 1);
        expect(aoyuan.maxHp).toBe(54);
    });
});

describe('技能一 · 唤龙·盘云', () => {
    it('只能落在自身周围一格（含四个斜角）的空格上', () => {
        const { state, aoyuan } = scene();
        // 周围一格是切比雪夫 1 的八格环，斜角 [1,1] 必须在候选里
        expect(dragonSummonCells(state, aoyuan)).toEqual(expect.arrayContaining([[1, 1], [1, 3], [3, 3]]));
        expect(cast1(aoyuan, state, [0, 0]).success).toBe(false);
        expect(cast1(aoyuan, state, [2, 2]).success).toBe(false);
    });

    it('召唤成功即挂上「游龙」（2回合），方位按所选格算', () => {
        const { state, aoyuan } = scene();
        const output = cast1(aoyuan, state, [1, 3]);
        expect(output.success).toBe(true);
        expect(hasDragon(aoyuan)).toBe(true);
        const dragon = aoyuan.effects.find(effect => effect.name === '游龙')!;
        expect(dragon.duration).toBe(DRAGON_DURATION);
        // 右上方位 = 顺时针序号 1，下一段半圈从这一格起算
        expect(nextOrbitLeg(aoyuan, [2, 2])[0]).toEqual([1, 3]);
    });

    it('召唤那一下打游龙所在格的十字范围，每命中一人叠一层龙鳞', () => {
        const { state, aoyuan } = scene();
        const inCross = dummy(state, [0, 3]);   // 游龙格 [1,3] 的正上方
        const beside = dummy(state, [0, 4]);    // 斜角：不在十字那一横一竖上
        const output = cast1(aoyuan, state, [1, 3]);
        expect(output.success).toBe(true);
        expect(inCross.currentHp).toBe(296);
        expect(beside.currentHp).toBe(300);
        expect(layers(aoyuan)).toBe(1);
    });

    it('十字里没人也照样唤出龙，只是不叠层', () => {
        const { state, aoyuan } = scene();
        expect(cast1(aoyuan, state, [3, 3]).success).toBe(true);
        expect(hasDragon(aoyuan)).toBe(true);
        expect(layers(aoyuan)).toBe(0);
    });
});

describe('游龙盘旋 · 半圈 5 格含起点', () => {
    it('一次扫 4 步、含起点共 5 格；两圈正好走完 8 格外圈', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);           // 正上方位 = 序号 0
        const leg = nextOrbitLeg(aoyuan, [2, 2]);
        expect(leg).toEqual([[1, 2], [1, 3], [2, 3], [3, 3], [3, 2]]);
        const log: string[] = [];
        advanceDragon(state, aoyuan, log);
        // 方位推进半圈（+4），下一段从对面那格起
        expect(nextOrbitLeg(aoyuan, [2, 2])[0]).toEqual([3, 2]);
        advanceDragon(state, aoyuan, log);
        expect(nextOrbitLeg(aoyuan, [2, 2])[0]).toEqual([1, 2]);
    });

    it('路径上的敌人各吃一发并叠层，起点那一格也算', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        const atStart = dummy(state, [1, 2]);
        const atEnd = dummy(state, [3, 2]);
        const outside = dummy(state, [1, 1]);   // 左上角不在这一段的 5 格里
        const log: string[] = [];
        expect(advanceDragon(state, aoyuan, log)).toBe(2);
        expect(atStart.currentHp).toBe(296);
        expect(atEnd.currentHp).toBe(296);
        expect(outside.currentHp).toBe(300);
        expect(layers(aoyuan)).toBe(2);
    });

    it('贴边时出界的格子扫不到人，但方位照样推进', () => {
        const state = makeGameState();
        const aoyuan = addHero(state, 'aoyuan', 'player1', [0, 0]);
        aoyuan.defense = 0;
        attachDragon(aoyuan, [0, 1]);
        const victim = dummy(state, [1, 1]);
        const log: string[] = [];
        advanceDragon(state, aoyuan, log);
        expect(victim.currentHp).toBe(296);
        // 正右方是顺时针序号 2，扫完半圈落在序号 6（正左方）
        expect(aoyuan.counters['__aoyuan_orbit']).toBe(6);
    });

    it('没有游龙时什么都不扫', () => {
        const { state, aoyuan } = scene();
        dummy(state, [1, 2]);
        expect(advanceDragon(state, aoyuan, [])).toBe(0);
    });
});

describe('行动结束推进与技能二的关系', () => {
    it('行动结束会推着游龙扫一圈', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        const victim = dummy(state, [1, 3]);
        aoyuan.hasActedThisTurn = false;
        GameEngine.endHeroAction(aoyuan, state);
        expect(victim.currentHp).toBe(296);
        expect(layers(aoyuan)).toBe(1);
    });

    it('技能二自带的那一圈顶掉行动结束的推进，不会一次行动白得两圈', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 3]);            // 右上方位 = 序号 1
        cast2(aoyuan, state, [2, 5]);
        // 冲刺带一圈：方位从 1 推到 5，且本回合记为"已盘旋"
        expect(aoyuan.counters['__aoyuan_orbit']).toBe(5);
        GameEngine.endHeroAction(aoyuan, state);
        expect(aoyuan.counters['__aoyuan_orbit']).toBe(5);
    });
});

describe('技能二 · 乘龙·破浪', () => {
    it('沿直线穿过路径上的敌人各打8点，落点必须是空格', () => {
        const { state, aoyuan } = scene();
        const first = dummy(state, [2, 3]);
        const second = dummy(state, [2, 4]);
        const output = cast2(aoyuan, state, [2, 5]);
        expect(output.success).toBe(true);
        expect(first.currentHp).toBe(292);
        expect(second.currentHp).toBe(292);
        expect(aoyuan.position).toEqual([2, 5]);
        expect(aoyuan.hasMovedThisTurn).toBe(true);
        // 冲刺伤害是敖渊自己打的，不算"游龙造成伤害"，所以不叠龙鳞
        expect(layers(aoyuan)).toBe(0);
    });

    it('落点被占、超出 3 格、点斜角都放不出来', () => {
        const state = makeGameState();
        const aoyuan = addHero(state, 'aoyuan', 'player1', [2, 0]);
        aoyuan.defense = 0;
        dummy(state, [2, 2]);
        expect(cast2(aoyuan, state, [2, 2]).success).toBe(false);   // 落点站着人
        expect(cast2(aoyuan, state, [2, 5]).success).toBe(false);   // 距离 5 > 3
        expect(cast2(aoyuan, state, [1, 1]).success).toBe(false);   // 斜向不算冲刺
        expect(aoyuan.position).toEqual([2, 0]);
    });

    it('常规最多冲3格，天威之后每层再 +1', () => {
        const { state, aoyuan } = scene();
        expect(dragonDashDistance(aoyuan)).toBe(DASH_DISTANCE);
        expect(cast2(aoyuan, state, [2, 5]).success).toBe(true);

        const far = scene();
        far.aoyuan.counters['__aoyuan_dash_bonus'] = 1;
        expect(dragonDashDistance(far.aoyuan)).toBe(4);
        expect(cast2(far.aoyuan, far.state, [2, 0]).success).toBe(true);
    });

    it('游龙附着时，冲刺落地立刻带着龙扫出新位置的一圈并叠层', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 3]);            // 序号 1；冲完落在 [2,5]
        // 以 [2,5] 为中心的下一段半圈：[1,6]/[2,6]/[3,6] 出界，只有 [3,5] 与 [3,4] 有效
        const swept = dummy(state, [3, 5]);
        const output = cast2(aoyuan, state, [2, 5]);
        expect(output.success).toBe(true);
        expect(swept.currentHp).toBe(296);       // 只挨游龙那一发 4 点，冲刺路径上没人
        expect(layers(aoyuan)).toBe(1);
        expect(aoyuan.counters['__aoyuan_orbit']).toBe(5);
    });
});

describe('被动 · 龙鳞游息', () => {
    it('每层提升 6% 攻击与 6% 闪避，致知三抬到 10%', () => {
        const { aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        for (let index = 0; index < 3; index++) {
            EffectManager.addEffect(aoyuan, {
                type: 'buff', name: '龙鳞', duration: 2, sourceHeroId: aoyuan.id,
            });
        }
        expect(layers(aoyuan)).toBe(3);
        expect(scaleAttackMultiplier(aoyuan)).toBeCloseTo(1.18);
        expect(getScaleDodgeRate(aoyuan)).toBeCloseTo(0.18);
        grantZhizhi(aoyuan, 3);
        expect(getScaleDodgeRate(aoyuan)).toBeCloseTo(0.30);
    });

    it('层数各自倒数两回合，所以会一层层掉下去', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        const first = dummy(state, [1, 2]);
        advanceDragon(state, aoyuan, []);        // 这一拍只扫到 first → 1 层
        EffectManager.updateEffectDurations(state);   // 第一层掉到 1 回合
        advanceDragon(state, aoyuan, []);             // 再扫一拍，叠上第二层
        expect(layers(aoyuan)).toBe(2);
        EffectManager.updateEffectDurations(state);   // 只有最早那一层到期
        expect(layers(aoyuan)).toBe(1);
        EffectManager.updateEffectDurations(state);
        expect(layers(aoyuan)).toBe(0);
    });

    it('游龙只剩最后一回合时，花 3 层龙鳞续一回合；层数不够就不续', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        const dragon = aoyuan.effects.find(effect => effect.name === '游龙')!;
        dragon.duration = 1;
        for (let index = 0; index < SCALES_SUSTAIN_COST; index++) {
            EffectManager.addEffect(aoyuan, { type: 'buff', name: '龙鳞', duration: 2, sourceHeroId: aoyuan.id });
        }
        sustainDragonAtRoundStart(state, aoyuan);
        expect(dragon.duration).toBe(2);
        expect(layers(aoyuan)).toBe(0);
        // 同一回合不重复扣
        dragon.duration = 1;
        for (let index = 0; index < SCALES_SUSTAIN_COST; index++) {
            EffectManager.addEffect(aoyuan, { type: 'buff', name: '龙鳞', duration: 2, sourceHeroId: aoyuan.id });
        }
        sustainDragonAtRoundStart(state, aoyuan);
        expect(dragon.duration).toBe(1);
        expect(layers(aoyuan)).toBe(SCALES_SUSTAIN_COST);
    });

    it('停手就归零：不再扫击的两回合后，闪避加成一起掉光', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        const victim = dummy(state, [1, 2]);
        advanceDragon(state, aoyuan, []);
        expect(victim.currentHp).toBe(296);
        expect(getScaleDodgeRate(aoyuan)).toBeCloseTo(0.06);
        EffectManager.updateEffectDurations(state);
        EffectManager.updateEffectDurations(state);
        expect(layers(aoyuan)).toBe(0);
        expect(getScaleDodgeRate(aoyuan)).toBe(0);
    });
});

describe('游龙特效接线', () => {
    /** 特效请求是模块级队列，前面那些结算测试也往里塞过，先清干净再断言 */
    function drain() {
        drainPendingSkillFxRequests();
    }

    it('技能一唤龙那一圈按顺时针八格排，圆心在召唤格（整圈，不是半圈）', () => {
        const { state, aoyuan } = scene();
        const out = cast1(aoyuan, state, [1, 3]);
        expect(out.success).toBe(true);
        expect(out.fxCoveredPositions).toEqual([
            [0, 3], [0, 4], [1, 4], [2, 4], [2, 3], [2, 2], [1, 2], [0, 2],
        ]);
    });

    it('龙转整圈，但伤害仍只结算十字四格（斜向那几格只是龙过去了）', () => {
        const { state, aoyuan } = scene();
        const orthogonal = dummy(state, [0, 3]);   // 召唤格正上方
        const diagonal = dummy(state, [0, 4]);     // 右上：在环上，但不在十字里
        cast1(aoyuan, state, [1, 3]);
        expect(orthogonal.currentHp).toBe(orthogonal.maxHp - 4);
        expect(diagonal.currentHp).toBe(diagonal.maxHp);
    });

    it('没扫到人也要把这一圈演出来，格序就是龙首爬过的顺序', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        drain();
        expect(advanceDragon(state, aoyuan, [])).toBe(0);
        const sweep = drainPendingSkillFxRequests().find(request => request.skillId === 'aoyuan_orbit');
        expect(sweep, '空扫也要派发游龙扫击特效').toBeDefined();
        expect(sweep!.coveredPositions).toEqual([[1, 2], [1, 3], [2, 3], [3, 3], [3, 2]]);
        expect(sweep!.impactPositions).toEqual([]);
        // 主特效画在本体格：龙是绕着敖渊转的，起手机制不能跟着某个敌人跑
        expect(sweep!.fromPos).toEqual([2, 2]);
    });

    it('扫到人时命中格进 impact，龙首爬到哪格才炸哪格', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        dummy(state, [1, 2]);
        dummy(state, [3, 3]);
        drain();
        advanceDragon(state, aoyuan, []);
        const sweep = drainPendingSkillFxRequests().find(request => request.skillId === 'aoyuan_orbit')!;
        expect(sweep.impactPositions).toEqual([[1, 2], [3, 3]]);
        const profile = resolveSkillFx('aoyuan_orbit');
        const event = {
            id: 1, bornAt: 0, profile, owner: 'player1' as const,
            fromPos: sweep.fromPos, targetPos: sweep.targetPos,
            angleDeg: 0, direction: 'N' as const,
            coveredPositions: sweep.coveredPositions, impactPositions: sweep.impactPositions,
        };
        // 路径第 0 格与第 3 格差三拍，正好是龙爬到那里的那一刻
        expect(computeFxImpactDelayMs(event, [1, 2])).toBe(DRAGON_SWEEP_LEAD_MS);
        expect(computeFxImpactDelayMs(event, [3, 3])).toBe(DRAGON_SWEEP_LEAD_MS + 3 * DRAGON_SWEEP_STEP_MS);
    });

    it('方位序号只增不减：常驻龙影转半圈就是顺时针 180°，不会倒着绕回去', () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 3]);            // 右上 = 序号 1
        expect(dragonOrbitIndex(aoyuan)).toBe(1);
        advanceDragon(state, aoyuan, []);
        expect(dragonOrbitIndex(aoyuan)).toBe(5);
        advanceDragon(state, aoyuan, []);
        expect(dragonOrbitIndex(aoyuan)).toBe(9);   // 越过 8 也不折回 1
        // 越界之后重新唤龙：往顺时针方向补齐，而不是把角度倒回去
        attachDragon(aoyuan, [1, 2]);            // 正上 = 序号 0（mod 8）
        expect(dragonOrbitIndex(aoyuan)).toBe(16);
        expect(dragonCoilBearingDeg(dragonOrbitIndex(aoyuan))).toBe(16 * 45);
    });
});

describe('天威 · 龙腾四海', () => {    it('击杀触发：冲刺永久 +1，游龙持续只补一次', async () => {
        const { state, aoyuan } = scene();
        attachDragon(aoyuan, [1, 2]);
        const { applyDragonTianwei } = await import('../../src/core/dragon-orbit');
        const first = applyDragonTianwei(aoyuan);
        expect(aoyuan.counters['__aoyuan_dash_bonus']).toBe(1);
        expect(aoyuan.effects.find(effect => effect.name === '游龙')!.duration).toBe(DRAGON_DURATION + 2);
        applyDragonTianwei(aoyuan);
        expect(aoyuan.counters['__aoyuan_dash_bonus']).toBe(2);
        // 第二次不再补时长
        expect(aoyuan.effects.find(effect => effect.name === '游龙')!.duration).toBe(DRAGON_DURATION + 2);
        expect(first.length).toBeGreaterThan(0);
    });

});
