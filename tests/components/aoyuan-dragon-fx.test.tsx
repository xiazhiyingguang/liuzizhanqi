import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkillFxVisual } from '../../src/components/Game/SkillFxLayer';
import { buildSkillPreviewScene } from '../../src/core/skill-fx-preview';
import { computeFxAngleDeg, computeFxDirection, resolveSkillFx, type SkillFxEvent } from '../../src/core/skill-fx';
import type { Position } from '../../src/types/game';

/**
 * 游龙三式的渲染验收（node 环境下 renderToStaticMarkup，只断言结构与几何变量）。
 *
 * 这里守的是"龙到底画没画出来"：档案 kind 换掉了但组件没接线时，
 * 页面上只会剩一串通用印记，测试要当场报错而不是等玩家截图来问。
 */

function sweepEvent(): SkillFxEvent {
    const fromPos: Position = [2, 2];
    const leg: Position[] = [[1, 2], [1, 3], [2, 3], [3, 3], [3, 2]];
    return {
        id: 1,
        bornAt: 0,
        profile: resolveSkillFx('aoyuan_orbit'),
        owner: 'player1',
        fromPos,
        targetPos: leg[0],
        angleDeg: computeFxAngleDeg(fromPos, leg[0]),
        direction: computeFxDirection(computeFxAngleDeg(fromPos, leg[0])),
        coveredPositions: leg,
        impactPositions: [[1, 3], [3, 3]],
    };
}

function dashEvent(): SkillFxEvent {
    const fromPos: Position = [2, 1];
    const targetPos: Position = [2, 4];
    return {
        id: 2,
        bornAt: 0,
        profile: resolveSkillFx('aoyuan_skill2'),
        owner: 'player1',
        fromPos,
        targetPos,
        angleDeg: computeFxAngleDeg(fromPos, targetPos),
        direction: 'E',
        coveredPositions: [[2, 2], [2, 3], [2, 4]],
        impactPositions: [[2, 3]],
    };
}

function callEvent(): SkillFxEvent {
    const fromPos: Position = [2, 2];
    const targetPos: Position = [1, 3];
    return {
        id: 3,
        bornAt: 0,
        profile: resolveSkillFx('aoyuan_skill1'),
        owner: 'player1',
        fromPos,
        targetPos,
        angleDeg: computeFxAngleDeg(fromPos, targetPos),
        direction: 'NE',
        // 召唤格 [1,3] 外围的顺时针八格：上、右上、右、右下、下、左下、左、左上
        coveredPositions: [[0, 3], [0, 4], [1, 4], [2, 4], [2, 3], [2, 2], [1, 2], [0, 2]],
        impactPositions: [[0, 3], [2, 3]],
    };
}

const render = (event: SkillFxEvent, variant: 'caster' | 'target' | 'impact' | 'area', atPos?: Position) =>
    renderToStaticMarkup(<SkillFxVisual event={event} variant={variant} atPos={atPos} />);

describe('游龙扫击 · 绕身半圈', () => {
    it('本体格画半圈：外圈轨道、变长的拖痕、骑在圈上的龙', () => {
        const html = render(sweepEvent(), 'caster');
        expect(html).toContain('skill-fx-kind-aoyuan-dragon-sweep');
        expect(html).toContain('ao-ring');
        expect(html).toContain('ao-trace-water');
        expect(html).toContain('ao-dragon-art');
        // 几何全部交给变量：起点方位 0°（正上），这一拍转 180°
        expect(html).toContain('--ao-start:0deg');
        expect(html).toContain('--ao-sweep:180deg');
        expect(html).toContain('--ao-arc-dash:50');
    });

    it('命中格是爪痕特写，扫过的空格只留一撮雾', () => {
        expect(render(sweepEvent(), 'impact', [1, 3])).toContain('ao-swept-mark-2');
        expect(render(sweepEvent(), 'area', [2, 3])).toContain('ao-mist-tile-puff');
    });

    it('唤龙附带被动不再绘制第二条龙，但保留命中表现', () => {
        const event = { ...sweepEvent(), dragonContactsOnly: true };
        expect(render(event, 'caster')).not.toContain('ao-dragon-art');
        expect(render(event, 'impact', [1, 3])).toContain('ao-swept-mark');
    });

    it('预约的半圈在冲刺结束之前不挂载', () => {
        const event = { ...sweepEvent(), bornAt: Date.now() + 700 };
        expect(render(event, 'caster')).toBe('');
        expect(render(event, 'impact', [1, 3])).toBe('');
    });

    it('贴边时按盘边裁掉外圈，龙影不会飘到棋盘外面', () => {
        const edge = sweepEvent();
        edge.fromPos = [0, 0];
        edge.coveredPositions = [[0, 1], [1, 1]];
        edge.targetPos = [0, 1];
        const html = render(edge, 'caster');
        expect(html).toContain('--ao-clip-t:1');
        expect(html).toContain('--ao-clip-l:1');
    });
});

describe('乘龙·破浪', () => {
    it('起手格是一条冲刺轴：轨与龙同轴，龙顶到落点才收', () => {
        const html = render(dashEvent(), 'caster');
        expect(html).toContain('ao-dash-track');
        expect(html).toContain('ao-dash-rail');
        expect(html).toContain('ao-dragon-art');
        // 冲三格 → 落点是路径第 3 格：龙跑到那里的时刻（600ms + 100ms 起手）就是落点爆点的时刻
        expect(html).toContain('--ao-dash-ms:600ms');
        expect(html).toContain('--fx-hit-ms:700ms');
        expect(html).toContain('ao-dash-companion');
    });

    it('落点与沿途格各画各的：水柱在落点，贯斩在穿过的格', () => {
        expect(render(dashEvent(), 'target')).toContain('ao-dash-column');
        expect(render(dashEvent(), 'impact', [2, 3])).toContain('ao-dash-slash');
    });
});

describe('唤龙·盘云', () => {
    it('召唤格里龙转满一整圈：外圈轨道、铺满的拖痕、骑在圈上的龙', () => {
        const html = render(callEvent(), 'target');
        expect(html).toContain('ao-ring');
        expect(html).toContain('ao-trace');
        expect(html).toContain('ao-orbit');
        expect(html).toContain('ao-dragon-art');
        expect(html).toContain('ao-call-cloud');
        // 一整圈 = 360°、八格 × 100ms、拖痕弧长占满
        expect(html).toContain('--ao-start:0deg');
        expect(html).toContain('--ao-sweep:360deg');
        expect(html).toContain('--ao-spin-ms:800ms');
        expect(html).toContain('--ao-lead-ms:320ms');
        expect(html).toContain('--ao-arc-dash:100');
    });

    it('十字四臂按龙首爬到环上的那一格才拍开：上0/右2/下4/左6', () => {
        const html = render(callEvent(), 'target');
        expect(html.match(/ao-call-arm/g)?.length).toBe(4);
        expect(html).toContain('--ao-arm-delay:320ms');
        expect(html).toContain('--ao-arm-delay:520ms');
        expect(html).toContain('--ao-arm-delay:720ms');
        expect(html).toContain('--ao-arm-delay:920ms');
    });

    it('起手格只递一缕龙气过去，主戏在召唤格', () => {
        const html = render(callEvent(), 'caster');
        expect(html).toContain('ao-call-stream');
        expect(html).not.toContain('ao-dragon-art');
    });
});

describe('图鉴预览场景', () => {
    it('唤龙的预览把召唤格摆在中场，整圈八格全部落在盘内', () => {
        const { event, cols, rows } = buildSkillPreviewScene('aoyuan_skill1');
        expect([cols, rows]).toEqual([6, 6]);
        expect(event.profile.kind).toBe('aoyuan-dragon-call');
        // 圆心是玩家点中的召唤格，不是敖渊脚下那一格
        expect(event.fromPos).toEqual([2, 2]);
        expect(event.targetPos).toEqual([1, 3]);
        // 顺时针八格一整圈：上、右上、右、右下、下、左下、左、左上
        expect(event.coveredPositions).toEqual([
            [0, 3], [0, 4], [1, 4], [2, 4], [2, 3], [2, 2], [1, 2], [0, 2],
        ]);
    });

    it('游龙扫击按战斗几何演示：本体居中、龙首从正上方顺时针爬过五格', () => {
        const { event, cols, rows } = buildSkillPreviewScene('aoyuan_orbit');
        expect([cols, rows]).toEqual([6, 6]);
        expect(event.profile.kind).toBe('aoyuan-dragon-sweep');
        expect(event.fromPos).toEqual([2, 2]);
        expect(event.coveredPositions).toEqual([[1, 2], [1, 3], [2, 3], [3, 3], [3, 2]]);
    });

    it('乘龙破浪的预览也摆得出冲刺轴，不至于把龙画在原地', () => {
        const { event } = buildSkillPreviewScene('aoyuan_skill2');
        expect(event.coveredPositions?.length).toBeGreaterThan(1);
    });
});
