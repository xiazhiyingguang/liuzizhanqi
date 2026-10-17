import { describe, expect, it } from 'vitest';
import {
    DRAGON_CALL_STEP_MS,
    DRAGON_SWEEP_LEAD_MS,
    DRAGON_SWEEP_STEP_MS,
    ORBIT_RING_CELLS,
    clockwiseDiffDeg,
    dragonCallHitMs,
    dragonCallRingGeometry,
    dragonCoilBearingDeg,
    dragonDashHitMs,
    dragonSweepGeometry,
    orbitBearingDeg,
} from '../../src/core/dragon-sweep-fx';
import { resolveSkillFx, computeFxImpactDelayMs } from '../../src/core/skill-fx';
import type { Position } from '../../src/types/game';

/**
 * 游龙的视觉几何：龙首必须沿本体外的八格圈顺时针爬，
 * 命中格的爆点要跟着"爬到第几格"排拍——这两件事都由这里的纯函数算，
 * 所以它们错了，画面上就是"龙还没到，人先炸了"。
 */

function sweepEvent(fromPos: Position, covered: Position[], targetPos?: Position) {
    const profile = resolveSkillFx('aoyuan_orbit');
    return {
        id: 1,
        bornAt: 0,
        profile,
        owner: 'player1' as const,
        fromPos,
        targetPos: targetPos ?? covered[0],
        angleDeg: 0,
        direction: 'N' as const,
        coveredPositions: covered,
        impactPositions: covered,
    };
}

describe('外圈方位角', () => {
    it('八格按顺时针每格 45°，正上方是 0°', () => {
        expect(orbitBearingDeg([2, 2], [1, 2])).toBe(0);        // 正上
        expect(orbitBearingDeg([2, 2], [1, 3])).toBeCloseTo(45); // 右上
        expect(orbitBearingDeg([2, 2], [2, 3])).toBeCloseTo(90); // 正右
        expect(orbitBearingDeg([2, 2], [3, 3])).toBeCloseTo(135);
        expect(orbitBearingDeg([2, 2], [3, 2])).toBeCloseTo(180);
        expect(orbitBearingDeg([2, 2], [3, 1])).toBeCloseTo(225);
        expect(orbitBearingDeg([2, 2], [2, 1])).toBeCloseTo(270);
        expect(orbitBearingDeg([2, 2], [1, 1])).toBeCloseTo(315);
    });

    it('顺时针差角永远取正方向，跨过 0° 也不会绕远路', () => {
        expect(clockwiseDiffDeg(315, 45)).toBe(90);
        expect(clockwiseDiffDeg(45, 315)).toBe(270);
        expect(clockwiseDiffDeg(90, 90)).toBe(0);
    });
});

describe('扫击几何', () => {
    it('整段半圈：从正上方走到对面，准确 180°', () => {
        const leg: Position[] = [[1, 2], [1, 3], [2, 3], [3, 3], [3, 2]];
        const geometry = dragonSweepGeometry(sweepEvent([2, 2], leg));
        expect(geometry.startDeg).toBe(0);
        expect(geometry.sweepDeg).toBe(180);
        expect(geometry.spinMs).toBe(4 * DRAGON_SWEEP_STEP_MS);
        expect(geometry.arcPercent).toBeCloseTo(50);
        expect(geometry.clip).toEqual({ t: 0, r: 0, b: 0, l: 0 });
    });

    it('起点在西北也一样是顺时针爬，不会被 360° 折回来看成倒转', () => {
        const leg: Position[] = [[1, 1], [1, 2], [1, 3], [2, 3], [3, 3]];
        const geometry = dragonSweepGeometry(sweepEvent([2, 2], leg));
        expect(geometry.startDeg).toBeCloseTo(315);
        expect(geometry.sweepDeg).toBeCloseTo(180);
    });

    it('贴边时只剩两格：保持完整半圈，裁切量按盘边给', () => {
        // 左上角的敖渊：外圈只剩 右/下/右下
        const leg: Position[] = [[0, 1], [1, 1]];
        const geometry = dragonSweepGeometry(sweepEvent([0, 0], leg));
        expect(geometry.startDeg).toBeCloseTo(90);
        expect(geometry.sweepDeg).toBeCloseTo(180);
        expect(geometry.clip).toEqual({ t: 1, r: 0, b: 0, l: 1 });
    });

    it('只剩起点一格也要有身位：仍保持完整半圈，不会钉在原地', () => {
        const geometry = dragonSweepGeometry(sweepEvent([2, 2], [[1, 2]]));
        expect(geometry.sweepDeg).toBe(180);
        expect(geometry.spinMs).toBe(4 * DRAGON_SWEEP_STEP_MS);
    });
});

describe('逐格节拍', () => {
    it('扫击命中格按"爬到第几格"延后，一格一拍', () => {
        const leg: Position[] = [[1, 2], [1, 3], [2, 3], [3, 3], [3, 2]];
        const event = sweepEvent([2, 2], leg);
        const delays = leg.map(cell => computeFxImpactDelayMs(event, cell));
        expect(delays).toEqual([
            DRAGON_SWEEP_LEAD_MS,
            DRAGON_SWEEP_LEAD_MS + DRAGON_SWEEP_STEP_MS,
            DRAGON_SWEEP_LEAD_MS + DRAGON_SWEEP_STEP_MS * 2,
            DRAGON_SWEEP_LEAD_MS + DRAGON_SWEEP_STEP_MS * 3,
            DRAGON_SWEEP_LEAD_MS + DRAGON_SWEEP_STEP_MS * 4,
        ]);
    });

    it('冲刺与唤龙各自有自己的起手拍，但都是一格一拍', () => {
        expect(dragonDashHitMs(2) - dragonDashHitMs(1)).toBe(dragonDashHitMs(1) - dragonDashHitMs(0));
        // 龙要先从云里探起身，唤龙的第一格比扫击更晚
        expect(dragonCallHitMs(0)).toBeGreaterThan(DRAGON_SWEEP_LEAD_MS);
    });

    it('唤龙是完整一圈：360°、八格、拖痕铺满（技能二与绕身盘旋才是半圈）', () => {
        const ring = dragonCallRingGeometry();
        expect(ring.startDeg).toBe(0);
        expect(ring.sweepDeg).toBe(360);
        expect(ring.spinMs).toBe(ORBIT_RING_CELLS * DRAGON_CALL_STEP_MS);
        expect(ring.arcPercent).toBe(100);
        // 十字四臂落在环上第 0/2/4/6 格，节拍必须和爬到那里的龙首同拍
        expect([0, 2, 4, 6].map(order => dragonCallHitMs(order))).toEqual([320, 520, 720, 920]);
        // 一圈走完的时刻仍在档案时长内，否则最后一格的爆点会被特效回收吃掉
        expect(dragonCallHitMs(6) + 520).toBeLessThan(resolveSkillFx('aoyuan_skill1').durationMs);
    });

    it('常驻龙影的朝向按方位序号累加，转半圈就是 +180°', () => {
        expect(dragonCoilBearingDeg(0)).toBe(0);
        expect(dragonCoilBearingDeg(4)).toBe(180);
        // 序号是累计值（不是 mod 8 的余数），所以补间只会顺时针
        expect(dragonCoilBearingDeg(8)).toBe(360);
        expect(dragonCoilBearingDeg(NaN)).toBe(0);
    });
});
