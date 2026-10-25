import { describe, expect, it } from 'vitest';
import { drawCraftedFrame, type CraftedFxTheme, type CraftedFxVariant } from '../../src/core/crafted-skill-fx';
import { drawMechanismFrame } from '../../src/core/mechanism-fx-renderer';

/** 只记账不真画的 ctx：把 fill/stroke 的路径点经变换矩阵换算到世界坐标，
 *  这样"火焰数量""残影高度""环有没有断口"这类观感判据能用数字断言，不必靠肉眼截图。 */
type DrawOp = { x0: number; y0: number; x1: number; y1: number; w: number; h: number;
    cx: number; cy: number; alpha: number; rx: number; sweep: number };

function makeRecorder() {
    const fills: DrawOp[] = [];
    const strokes: DrawOp[] = [];
    const shadowSets: number[] = [];
    const strokeStyles: string[] = [];
    let dashCalls = 0;
    let m = [1, 0, 0, 1, 0, 0];
    let pts: [number, number][] = [];
    let alpha = 1;
    let arc = { rx: 0, sweep: 0 };
    const stack: { m: number[]; alpha: number }[] = [];
    const mul = (n: number[]) => {
        const [a, b, c, d, e, f] = m;
        m = [a * n[0] + c * n[1], b * n[0] + d * n[1], a * n[2] + c * n[3],
            b * n[2] + d * n[3], a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f];
    };
    const record = (x: number, y: number) => {
        pts.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    };
    const flush = (sink: DrawOp[]) => {
        if (!pts.length) return;
        const xs = pts.map(p => p[0]);
        const ys = pts.map(p => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        sink.push({ x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
            alpha, rx: arc.rx, sweep: arc.sweep });
    };
    const sampleArc = (x: number, y: number, rx: number, ry: number, start: number, end: number) => {
        arc = { rx, sweep: Math.abs(end - start) };
        for (let i = 0; i <= 12; i++) {
            const a = start + (end - start) * i / 12;
            record(x + Math.cos(a) * rx, y + Math.sin(a) * ry);
        }
    };
    const gradient = { addColorStop: () => {} };
    const ctx = {
        get globalAlpha() { return alpha; },
        set globalAlpha(v: number) { alpha = v; },
        fillStyle: '' as unknown, lineWidth: 1, lineCap: '' as unknown,
        get strokeStyle() { return ''; },
        set strokeStyle(v: unknown) { if (typeof v === 'string') strokeStyles.push(v); },
        get shadowBlur() { return 0; },
        set shadowBlur(v: number) { shadowSets.push(v); },
        lineJoin: '' as unknown, font: '', textAlign: '' as unknown, textBaseline: '' as unknown,
        shadowColor: '', lineDashOffset: 0, globalCompositeOperation: '' as unknown,
        save: () => { stack.push({ m: [...m], alpha }); },
        restore: () => { const s = stack.pop(); if (s) { m = s.m; alpha = s.alpha; } },
        beginPath: () => { pts = []; arc = { rx: 0, sweep: 0 }; },
        moveTo: (x: number, y: number) => record(x, y),
        lineTo: (x: number, y: number) => record(x, y),
        closePath: () => {},
        quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => record(x, y),
        bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number, y: number) => record(x, y),
        rect: (x: number, y: number, w: number, h: number) => { record(x, y); record(x + w, y + h); },
        arc: (x: number, y: number, r: number, start = 0, end = Math.PI * 2) =>
            sampleArc(x, y, r, r, start, end),
        ellipse: (x: number, y: number, rx: number, ry: number, _rot = 0, start = 0, end = Math.PI * 2) =>
            sampleArc(x, y, rx, ry, start, end),
        fill: () => flush(fills),
        stroke: () => flush(strokes),
        fillRect: () => {}, strokeRect: () => {}, clearRect: () => {},
        translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
        scale: (x: number, y: number) => mul([x, 0, 0, y, 0, 0]),
        rotate: (a: number) => mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]),
        setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => { m = [a, b, c, d, e, f]; },
        setLineDash: () => { dashCalls++; }, clip: () => {}, drawImage: () => {},
        createLinearGradient: () => gradient, createRadialGradient: () => gradient,
        fillText: () => {}, strokeText: () => {}, measureText: () => ({ width: 10 }),
    };
    return {
        ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes, shadowSets, strokeStyles,
        get dashCalls() { return dashCalls; },
    };
}

function frame(theme: CraftedFxTheme, variant: CraftedFxVariant, p: number,
    opt: { lite?: boolean; dx?: number; dy?: number; angle?: number } = {}) {
    const rec = makeRecorder();
    drawCraftedFrame(rec.ctx, {
        theme, variant, time: p * 1000, duration: 1000,
        dx: opt.dx ?? 0, dy: opt.dy ?? 0, angle: opt.angle ?? 0, lite: !!opt.lite,
    });
    return rec;
}

/** 一记火舌 = 一次"高过 12 且不明显宽于高"的填充 */
const flames = (rec: { fills: DrawOp[] }) => rec.fills.filter(b => b.h >= 12 && b.w <= b.h);
const totalOps = (rec: { fills: DrawOp[]; strokes: DrawOp[] }) => rec.fills.length + rec.strokes.length;

describe('闻人翊悬手绘火材质的观感指标', () => {
    it('火舌高度逐帧跳动，不是一圈静止的剪影', () => {
        const sums = [.25, .4, .55, .7, .85].map(p =>
            flames(frame('wenren-leap', 'target', p)).reduce((a, b) => a + b.h, 0));
        expect(sums[0]).toBeGreaterThan(0);
        for (let i = 1; i < sums.length; i++) {
            expect(Math.abs(sums[i] - sums[i - 1])).toBeGreaterThan(.5);
        }
    });

    it('落点火环先向外扩张再收回来，收尾比最宽处明显小', () => {
        const widest = [.15, .35, .55, .75, .95].map(p =>
            Math.max(...frame('wenren-leap', 'target', p).strokes.map(b => b.w)));
        const peak = widest.indexOf(Math.max(...widest));
        expect(peak).toBeGreaterThan(0);
        expect(widest[4]).toBeLessThan(widest[peak] * .92);
    });

    it('燎原的火环前后都有火焰，不只是朝上的一排', () => {
        const rec = flames(frame('wenren-reap', 'target', .5));
        // 火舌根部在环面下半 = 靠前的一排；根部抬到基线以上 = 绕到身后的一排
        expect(rec.filter(b => b.y1 > 14).length).toBeGreaterThanOrEqual(2);
        expect(rec.filter(b => b.y1 <= 14).length).toBeGreaterThanOrEqual(2);
    });

    it('跃阵轨迹上留下 2 具以上半透明火人残影，比环上的火舌高得多', () => {
        const rec = frame('wenren-leap', 'caster', .18, { dx: 200, dy: 0 });
        const bodies = rec.fills.filter(b => b.cx > 34 && b.h >= 22 && b.alpha <= .6);
        expect(bodies.length).toBeGreaterThanOrEqual(2);
        expect(new Set(bodies.map(b => Math.round(b.alpha * 100))).size).toBeGreaterThanOrEqual(2);
        // 每具残影身后还有更淡的拖影副本，"掠过"才读得出速度
        expect(rec.fills.filter(b => b.h >= 15 && b.alpha <= .15).length).toBeGreaterThanOrEqual(3);
    });

    it('低画质档不碰 shadowBlur，全画质才给火舌晕边', () => {
        expect(frame('wenren-reap', 'target', .45).shadowSets.length).toBeGreaterThan(0);
        expect(frame('wenren-reap', 'target', .45, { lite: true }).shadowSets).toHaveLength(0);
    });

    it('跃阵落点在命中窗口里炸出焦土裂纹，窗口外收干净', () => {
        const during = frame('wenren-leap', 'target', .35).strokes.length;
        const after = frame('wenren-leap', 'target', .85).strokes.length;
        expect(during - after).toBeGreaterThanOrEqual(3);
    });

    it('昭神版多一圈反向金环与金白焰尖，普通版一样都没有', () => {
        const normal = frame('wenren-leap', 'target', .45);
        const gold = frame('wenren-leap-zhaoshen', 'target', .45);
        expect(normal.dashCalls).toBe(0);
        expect(gold.dashCalls).toBe(2);
        expect(gold.strokeStyles).toContain('#fffbe0');
        expect(normal.strokeStyles).not.toContain('#fffbe0');
    });

    it.each([
        ['wenren-leap', 'target'] as const, ['wenren-leap', 'caster'] as const,
        ['wenren-reap', 'target'] as const,
        ['wenren-leap-zhaoshen', 'target'] as const, ['wenren-reap-zhaoshen', 'target'] as const,
    ])('%s 的 %s 在低画质档把火舌数量砍到八成以下', (theme, variant) => {
        const opt = { dx: 200, dy: 0 };
        const full = flames(frame(theme, variant, .45, opt)).length;
        const lite = flames(frame(theme, variant, .45, { ...opt, lite: true })).length;
        expect(full).toBeGreaterThan(0);
        expect(lite).toBeLessThanOrEqual(full * .8);
    });

    it('低画质档同样砍掉燎原起手的收拢余烬条数', () => {
        const opt = { dx: 0, dy: 0 };
        expect(totalOps(frame('wenren-reap', 'caster', .3, opt)))
            .toBeGreaterThan(totalOps(frame('wenren-reap', 'caster', .3, { ...opt, lite: true })));
    });
});

describe('闻人翊悬昭神入场的火纹机制演出', () => {
    const drawAt = (ms: number) => {
        const rec = makeRecorder();
        drawMechanismFrame(rec.ctx, 'ember-ascend', ms);
        return rec;
    };

    it('ember-ascend 在时长窗口内绘制，窗口外完全静默', () => {
        expect(totalOps(drawAt(-10))).toBe(0);
        expect(totalOps(drawAt(700))).toBeGreaterThan(20);
        expect(totalOps(drawAt(1600))).toBeGreaterThan(0);
        expect(totalOps(drawAt(2000))).toBe(0);
    });

    it('入场炸开的是带断口的火环，不是一整圈霓虹实环', () => {
        const arcs = drawAt(950).strokes.filter(b => b.rx >= 55 && b.sweep > .3);
        expect(arcs.length).toBeGreaterThanOrEqual(3);
        expect(arcs.reduce((a, b) => a + b.sweep, 0)).toBeLessThan(Math.PI * 2 * .9);
    });

    it('入场螺线分前后两遍画，靠身那侧压暗，才读成绕着身体盘', () => {
        const alphas = drawAt(400).strokes.map(s => s.alpha);
        expect(alphas.some(a => a > .9)).toBe(true);
        expect(alphas.some(a => a > .55 && a < .8)).toBe(true);
    });
});
