import type { SkillFxProfile } from './skill-fx';
import { drawChangliRebirth } from './changli-rebirth-fx';

export type MechanismFxTheme = NonNullable<SkillFxProfile['mechanism']>;
const paths = new Map<string, Path2D>();

// 龙势墨龙精灵：震霄头像中抠出的完整龙体（scripts/trace-zhenxiao-dragon.mjs 产物）
// 浏览器环境才有 Image：单测（Node）下精灵保持未就绪，走代码龙兜底
const dragonSprite = typeof Image !== 'undefined' ? new Image() : null;
let dragonSpriteReady = false;
if (dragonSprite) {
    dragonSprite.onload = () => { dragonSpriteReady = true; };
    dragonSprite.src = '/fx/zhenxiao-dragon.svg';
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const p = clamp(n); return p * p * (3 - 2 * p); };
const windowAt = (ms: number, start: number, peak: number, fade: number, end: number) =>
    smooth((ms - start) / (peak - start)) * (1 - smooth((ms - fade) / (end - fade)));

function shape(ctx: CanvasRenderingContext2D, d: string, fill?: string | CanvasGradient, stroke?: string | CanvasGradient, width = 1) {
    let path = paths.get(d);
    if (!path) { path = new Path2D(d); paths.set(d, path); }
    if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(path); }
}

function metal(ctx: CanvasRenderingContext2D, color: 'gold' | 'silver' | 'jade' | 'ember' | 'violet', y1 = -90, y2 = 40) {
    const palettes = {
        gold: ['#533217', '#d6a953', '#fff2c2', '#ac7330', '#f7d28e'],
        silver: ['#434d68', '#a9bccb', '#f6ffff', '#718794', '#d3e6ee'],
        jade: ['#155355', '#49a39d', '#e1fff0', '#307b75', '#a4e0ba'],
        ember: ['#521725', '#bd354a', '#ffc17a', '#93213a', '#f5a259'],
        violet: ['#30243f', '#8d76b0', '#e6d6f7', '#63507a', '#b9a2d3'],
    };
    const g = ctx.createLinearGradient(-26, y1, 30, y2);
    palettes[color].forEach((stop, i) => g.addColorStop(i / 4, stop));
    return g;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha = 1) {
    ctx.save(); ctx.globalAlpha *= alpha;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
    gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient; ctx.fillRect(x - size, y - size, size * 2, size * 2); ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
    shape(ctx, 'M 0 -1 Q .1 -.1 .65 0 Q .1 .1 0 1 Q -.1 .1 -.65 0 Q -.1 -.1 0 -1 Z', color);
    ctx.restore();
}

function curve(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, bend: number, color: string | CanvasGradient, width: number, start = 0, end = 1) {
    const dx = tx - x, dy = ty - y, length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length, ny = dx / length;
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
        const t = start + (end - start) * i / 28;
        const offset = Math.sin(t * Math.PI) * bend;
        const px = x + dx * t + nx * offset, py = y + dy * t + ny * offset;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function rebirth(ctx: CanvasRenderingContext2D, ms: number) {
    drawChangliRebirth(ctx, ms);
}

function crownShift(ctx: CanvasRenderingContext2D, ms: number, king: boolean) {
    const build = smooth((ms - 90) / 500);
    const reveal = windowAt(ms, 180, 540, 960, 1410);
    const material = metal(ctx, king ? 'gold' : 'violet', -43, 29);
    ctx.save(); ctx.globalAlpha *= reveal; ctx.translate(0, -55 - build * 12); ctx.scale(.8 + build * .2, .85 + build * .15);
    glow(ctx, 0, 3, 55, king ? '#d6a34c' : '#8d70b2', .18);
    const crown = king
        ? 'M -37 17 L -43 -16 L -25 -5 L -19 -30 L -7 -11 L 0 -43 L 7 -11 L 19 -30 L 25 -5 L 43 -16 L 37 17 Q 0 29 -37 17 Z'
        : 'M -34 17 L -38 -27 L -24 -11 L -21 2 L -9 7 L 0 -20 L 9 7 L 21 2 L 24 -11 L 38 -27 L 34 17 Q 0 28 -34 17 Z';
    shape(ctx, crown, material, king ? '#f4dc9b' : '#ded0f2', .8);
    shape(ctx, 'M -35 15 Q 0 23 35 15 L 34 21 Q 0 29 -34 21 Z', '#352b34', material, .75);
    if (king) {
        shape(ctx, 'M -37 8 L -41 -12 L -25 -2 M -19 -27 L -7 -8 L 0 -39 L 7 -8 L 19 -27 M 25 -2 L 41 -12 L 37 8', undefined, '#fff3d0', .8);
        shape(ctx, 'M -30 12 L -19 -23 L -10 13 M 10 13 L 19 -23 L 30 12', undefined, '#976631', .7);
        shape(ctx, 'M -19 -28 L -20 8 L -11 7 Z M 0 -39 L -1 12 L 6 6 Z M 41 -12 L 27 6 L 36 14 Z', '#755026');
        shape(ctx, 'M -26 10 Q -19 2 -11 11 M 11 11 Q 19 2 26 10', undefined, '#eed49b', .6);
    } else {
        shape(ctx, 'M -34 11 L -36 -22 L -25 -9 M 34 11 L 36 -22 L 25 -9 M -7 8 L 0 -16 L 7 8', undefined, '#e6d9f3', .9);
        shape(ctx, 'M -36 -23 L -29 15 L -20 9 Z M 36 -23 L 29 15 L 20 9 Z', '#392c50');
        shape(ctx, 'M -19 15 L -13 10 L -7 15 M 7 15 L 13 10 L 19 15', undefined, '#c6b3dc', .8);
    }
    shape(ctx, 'M 0 -6 L 6 3 L 0 12 L -6 3 Z', king ? '#a64036' : '#547e96', '#e7e0c2', .7);
    star(ctx, -23 + build * 36, -12 - build * 16, 4, '#fff8dc');
    ctx.restore();
    const flow = windowAt(ms, 0, 160, 650, 1050);
    ctx.save(); ctx.globalAlpha *= flow;
    for (const side of [-1, 1]) {
        curve(ctx, side * 42, 41, side * 25, -53, side * 24, material, 1.5, 0, build);
        shape(ctx, side < 0 ? 'M -47 31 L -47 -16 L -38 -24' : 'M 47 31 L 47 -16 L 38 -24', undefined, material, .8);
    }
    ctx.restore();
}

function conversion(ctx: CanvasRenderingContext2D, ms: number, incoming: [number, number]) {
    const length = Math.max(1, Math.hypot(...incoming));
    const sx = incoming[0] / length * 81, sy = incoming[1] / length * 81;
    const arrival = smooth(ms / 340);
    const catchLight = windowAt(ms, 0, 100, 290, 430);
    ctx.save(); ctx.globalAlpha *= catchLight;
    curve(ctx, sx, sy, sx * (1 - arrival), sy * (1 - arrival), 7, '#c3c8d7', 1.7);
    star(ctx, sx * (1 - arrival), sy * (1 - arrival), 4, '#f9fff6'); ctx.restore();
    const seal = windowAt(ms, 70, 280, 700, 1130);
    ctx.save(); ctx.globalAlpha *= seal; ctx.translate(0, -7);
    glow(ctx, 0, 0, 47, '#80d1b1', .2);
    ctx.rotate(.10 * (1 - smooth(ms / 390)));
    shape(ctx, 'M 0 -46 L 32 0 L 0 46 L -32 0 Z', undefined, metal(ctx, 'gold'), 1.4);
    shape(ctx, 'M 0 -37 L 25 0 L 0 37 L -25 0 Z', undefined, '#84c9b7', .75);
    shape(ctx, 'M -9 -23 L 9 -23 L 4 -12 L -10 -12 L 9 5 L -7 16 L 9 26 M -16 -1 L 16 -1 M -9 16 L -9 28', undefined, metal(ctx, 'jade'), 2.5);
    star(ctx, 0, -46, 3.5, '#fff1b7'); ctx.restore();
    const returning = windowAt(ms, 320, 510, 890, 1240);
    ctx.save(); ctx.globalAlpha *= returning;
    const p = smooth((ms - 340) / 570);
    for (const side of [-1, 1]) {
        curve(ctx, side * 34, -9, side * 10, 29, side * (17 + p * 10), metal(ctx, 'jade'), 2, 0, p);
        star(ctx, side * (34 - p * 24), -9 + p * 38, 3, '#d7fff0');
    }
    glow(ctx, 0, 25, 24, '#89d6b1', .34); ctx.restore();
}

function counter(ctx: CanvasRenderingContext2D, ms: number, to: [number, number], recover: boolean) {
    const p = smooth((ms - 70) / 270);
    const intensity = windowAt(ms, 10, 100, 410, 660);
    const length = Math.hypot(...to), dx = length ? to[0] / length : 1, dy = length ? to[1] / length : 0;
    ctx.save(); ctx.globalAlpha *= intensity;
    for (const side of [-1, 1]) {
        const start = Math.max(0, p - .62);
        curve(ctx, -dy * side * 7, dx * side * 7, to[0], to[1], side * 15, side > 0 ? metal(ctx, 'gold') : metal(ctx, 'silver'), 3, start, p);
        curve(ctx, -dy * side * 7, dx * side * 7, to[0], to[1], side * 15, '#fff1cb', .7, start, p);
    }
    const x = to[0] * p, y = to[1] * p;
    star(ctx, x, y, 5, '#fff4d3'); glow(ctx, x, y, 13, '#edc678', .38);
    ctx.restore();
    const hit = windowAt(ms, 290, 370, 440, 710);
    ctx.save(); ctx.globalAlpha *= hit; ctx.translate(...to);
    const radius = 8 + smooth((ms - 300) / 240) * 14;
    shape(ctx, 'M -13 16 L 4 -10 L 13 -16 L -4 10 Z', metal(ctx, 'silver'));
    star(ctx, 0, 0, 7, '#fff2c9');
    for (let i = 0; i < 5; i++) {
        const a = i * 2.399; star(ctx, Math.cos(a) * radius, Math.sin(a) * radius, 1.4, '#d9b265');
    }
    ctx.restore();
    const returning = recover ? windowAt(ms, 420, 540, 760, 1020) : 0;
    ctx.save(); ctx.globalAlpha *= returning;
    const q = smooth((ms - 420) / 420);
    curve(ctx, to[0], to[1], 0, 19, -19, '#96cbb2', 1.1, Math.max(0, q - .35), q);
    glow(ctx, 0, 19, 20, '#b5dba3', q * .25); ctx.restore();
}

/** 水墨笔触：沿折线扫出一条两侧渐收的填色带（笔锋收细），可随风摆动。 */
function brushStroke(
    ctx: CanvasRenderingContext2D,
    pts: Array<[number, number]>,
    w0: number, w1: number,
    fill: string,
    sway = 0, phase = 0, t = 0,
) {
    const n = pts.length;
    if (n < 2) return;
    const SAMPLES = 20;
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    let total = 0;
    const segLen: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        const l = Math.max(0.0001, Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
        segLen.push(l);
        total += l;
    }
    let walked = 0;
    for (let i = 0; i < n - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const l = segLen[i];
        const nx = -(y1 - y0) / l;
        const ny = (x1 - x0) / l;
        for (let s = 0; s < SAMPLES; s++) {
            const u = s / SAMPLES;
            const x = x0 + (x1 - x0) * u;
            const y = y0 + (y1 - y0) * u;
            const frac = Math.min(1, (walked + l * u) / Math.max(0.0001, total));
            const w = (w0 + (w1 - w0) * frac) / 2;
            const wave = Math.sin(t * 2.4 + phase + frac * 4.2) * sway * frac;
            left.push([x + nx * (w + wave), y + ny * (w + wave)]);
            right.push([x - nx * (w + wave), y - ny * (w + wave)]);
        }
        walked += l;
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const [x, y] of left) ctx.lineTo(x, y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
}

const DRAGON_INK = '#23222b';
const DRAGON_INK2 = '#3a3946';
const DRAGON_INK3 = '#15141b';
const DRAGON_GOLD = '#d8b46a';

/** 墨龙首（照震霄头像绘制）：张口獠牙、后掠双角、随风鬃鬣、金睛长须。朝向左（面向棋子）。 */
function dragonHead(ctx: CanvasRenderingContext2D, ms: number) {
    const t = ms / 1000;

    // —— 鬃鬣：五束向后上方掠起的墨笔触，随风摆（先画，垫在头后）——
    brushStroke(ctx, [[16, -18], [38, -34], [62, -52], [84, -74]], 6.5, 0.6, DRAGON_INK, 3.2, 0.0, t);
    brushStroke(ctx, [[20, -12], [44, -22], [68, -34], [92, -48]], 5.5, 0.5, DRAGON_INK2, 3.8, 1.1, t);
    brushStroke(ctx, [[22, -6], [48, -10], [74, -16], [96, -24]], 4.6, 0.4, DRAGON_INK, 3.0, 2.0, t);
    brushStroke(ctx, [[18, -22], [36, -44], [50, -68], [58, -88]], 4.2, 0.4, DRAGON_INK3, 4.2, 2.9, t);
    brushStroke(ctx, [[24, -2], [50, 0], [76, 2], [98, 6]], 3.4, 0.3, DRAGON_INK2, 2.6, 3.6, t);

    // —— 双角：向后上分叉的角形 ——
    brushStroke(ctx, [[8, -20], [20, -34], [30, -50], [34, -62]], 4.6, 1.2, DRAGON_INK);
    brushStroke(ctx, [[30, -50], [40, -56], [50, -58]], 2.4, 0.6, DRAGON_INK);
    brushStroke(ctx, [[30, -50], [36, -60], [34, -70]], 2.2, 0.6, DRAGON_INK);
    brushStroke(ctx, [[2, -22], [12, -36], [16, -48]], 3.2, 0.8, DRAGON_INK2);

    // —— 头颅主体（额顶 → 鼻梁 → 鼻端）——
    ctx.beginPath();
    ctx.moveTo(12, -18);
    ctx.quadraticCurveTo(2, -22, -10, -18);
    ctx.quadraticCurveTo(-24, -14, -36, -10);
    ctx.quadraticCurveTo(-42, -8, -43, -4);
    ctx.lineTo(-24, -2);
    ctx.quadraticCurveTo(-8, -4, 4, -2);
    ctx.quadraticCurveTo(10, -8, 12, -18);
    ctx.closePath();
    ctx.fillStyle = DRAGON_INK;
    ctx.fill();

    // —— 张开的下颌 ——
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.quadraticCurveTo(-10, 4, -26, 10);
    ctx.quadraticCurveTo(-34, 13, -37, 18);
    ctx.quadraticCurveTo(-28, 20, -16, 18);
    ctx.quadraticCurveTo(-2, 14, 6, 8);
    ctx.closePath();
    ctx.fillStyle = DRAGON_INK2;
    ctx.fill();

    // —— 口裂：一线纸色让张口醒目 ——
    ctx.strokeStyle = 'rgba(238, 231, 216, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-40, -3);
    ctx.quadraticCurveTo(-20, 2, 0, 1);
    ctx.stroke();

    // —— 獠牙：上颚两枚下探，下颚一枚上探 ——
    const fang = (x: number, y: number, h: number, dir: 1 | -1) => {
        ctx.beginPath();
        ctx.moveTo(x - 2.2, y);
        ctx.quadraticCurveTo(x - 0.6, y + dir * h * 0.6, x, y + dir * h);
        ctx.quadraticCurveTo(x + 0.8, y + dir * h * 0.5, x + 2.2, y);
        ctx.closePath();
        ctx.fillStyle = '#ece5d4';
        ctx.fill();
    };
    fang(-32, -1, 7, 1);
    fang(-22, 1, 6, 1);
    fang(-28, 16, 5, -1);

    // —— 鼻端卷 ——
    ctx.beginPath();
    ctx.moveTo(-43, -4);
    ctx.quadraticCurveTo(-48, -6, -46, -10);
    ctx.quadraticCurveTo(-44, -12, -41, -11);
    ctx.strokeStyle = DRAGON_INK;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // —— 龙睛：金底墨瞳，微光脉动 ——
    const eyeGlow = 0.75 + 0.25 * Math.sin(ms / 170);
    ctx.beginPath();
    ctx.ellipse(-14, -9, 4.6, 2.8, -0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#e6c98c';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-14, -9, 2.6, 1.3, -0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#211f28';
    ctx.fill();
    glow(ctx, -14, -9, 7, '#ffd984', 0.35 * eyeGlow);

    // —— 眉焰：一道上挑的金描 ——
    brushStroke(ctx, [[-20, -13], [-10, -17], [0, -17]], 1.6, 0.4, DRAGON_GOLD);

    // —— 长须两缕 + 颚髯（随风飘）——
    brushStroke(ctx, [[-42, -5], [-60, 2], [-76, -2], [-88, -12]], 2.0, 0.3, DRAGON_INK2, 3.2, 0.4, t);
    brushStroke(ctx, [[-34, 17], [-48, 26], [-66, 30], [-82, 28]], 1.8, 0.3, DRAGON_INK2, 3.6, 1.8, t);
    brushStroke(ctx, [[-20, 18], [-26, 28], [-24, 38]], 2.4, 0.4, DRAGON_INK, 2.6, 2.6, t);

    // —— 金饰：眉骨/颊部金点 ——
    for (const [dx, dy, r] of [[-26, -6, 1.2], [-6, -12, 1.4], [4, -10, 1.0], [-18, 6, 1.1]] as const) {
        star(ctx, dx, dy, r, DRAGON_GOLD);
    }
}

/** 龙势触发：金墨圈护体扫一周，代码绘制的墨龙自右上俯冲落位护住棋子。 */
function laststand(ctx: CanvasRenderingContext2D, ms: number) {
    const protect = windowAt(ms, 0, 160, 620, 1280);
    if (protect <= 0.01) return;
    ctx.save();
    ctx.globalAlpha *= protect;

    // —— 完整龙体精灵就绪：真龙俯冲护体 ——
    if (dragonSprite && dragonSpriteReady) {
        const dive = smooth((ms - 110) / 470);
        const hold = windowAt(ms, 110, 560, 980, 1340);
        if (hold > 0.01) {
            const breathe = Math.sin(ms / 210) * 2.2;
            const x = 88 - 60 * dive + breathe * 0.4;
            const y = -98 + 58 * dive + breathe;
            const rot = -0.4 + 0.3 * dive;
            const scale = 1.14 - 0.12 * dive;
            ctx.save();
            ctx.globalAlpha *= hold;
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.scale(scale, scale);
            glow(ctx, 4, -10, 46, '#e8c887', 0.24);
            // 图源 440×364（完整龙体，横幅），等比绘制
            ctx.drawImage(dragonSprite, -64, -53, 128, 106);
            ctx.restore();
        }
        ctx.restore();
        return;
    }

    // —— 金墨圈：墨金双层描边扫出一周 ——
    const sweep = smooth((ms - 40) / 400);
    if (sweep > 0.001) {
        const ringR = 46;
        ctx.save();
        ctx.translate(0, 6);
        ctx.scale(1, 0.94);
        ctx.lineCap = 'round';
        const arcEnd = -Math.PI / 2 + Math.PI * 2 * sweep;
        ctx.beginPath();
        ctx.arc(0, 0, ringR, -Math.PI / 2, arcEnd);
        ctx.strokeStyle = 'rgba(110, 80, 34, 0.85)';
        ctx.lineWidth = 7;
        ctx.stroke();
        const ringGold = ctx.createLinearGradient(-ringR, 0, ringR, 0);
        ringGold.addColorStop(0, '#8a6224');
        ringGold.addColorStop(0.5, '#e8c887');
        ringGold.addColorStop(1, '#b98f3e');
        ctx.beginPath();
        ctx.arc(0, 0, ringR, -Math.PI / 2, arcEnd);
        ctx.strokeStyle = ringGold;
        ctx.lineWidth = 3.2;
        ctx.stroke();
        ctx.restore();
    }
    glow(ctx, 0, 8, 52, '#d5a148', 0.10 + 0.08 * Math.sin(ms / 130));

    // —— 墨龙俯冲：右上高处 → 右肩上方悬停，随呼吸轻浮 ——
    const dive = smooth((ms - 110) / 470);
    const hold = windowAt(ms, 110, 560, 980, 1340);
    if (hold > 0.01) {
        const breathe = Math.sin(ms / 210) * 2.2;
        const x = 86 - 58 * dive + breathe * 0.4;
        const y = -96 + 56 * dive + breathe;
        const rot = -0.44 + 0.34 * dive;
        const scale = 1.42 - 0.14 * dive;
        ctx.save();
        ctx.globalAlpha *= hold;
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        glow(ctx, 4, -12, 44, '#e8c887', 0.24);
        dragonHead(ctx, ms);
        ctx.restore();

        // —— 金屑：沿环闪烁 ——
        const sparkle = windowAt(ms, 380, 640, 920, 1260);
        if (sparkle > 0.02) {
            const pts: Array<[number, number, number]> = [
                [-38, -18, 2.6], [36, 26, 2.2], [-26, 34, 1.9],
                [44, -8, 2.4], [0, -46, 2.8], [-46, 8, 1.8],
            ];
            for (const [sx, sy, ss] of pts) {
                const tw = 0.35 + 0.65 * Math.abs(Math.sin(ms / 150 + sx * 1.7));
                star(ctx, sx, sy, ss * tw, `rgba(255, 236, 170, ${0.92 * sparkle * tw})`);
            }
        }
    }
    ctx.restore();
}

function extraAction(ctx: CanvasRenderingContext2D, ms: number) {
    const open = smooth((ms - 100) / 480);
    const ink = windowAt(ms, 0, 130, 630, 1150);
    ctx.save(); ctx.globalAlpha *= ink;
    ctx.translate(0, 24); ctx.scale(1, .37);
    const gaps = [.06, 2.8];
    for (let i = 0; i < 2; i++) {
        ctx.save(); ctx.translate((i ? 1 : -1) * open * 15, 0); ctx.rotate((i ? 1 : -1) * open * .16);
        ctx.beginPath(); ctx.arc(0, 0, 43, gaps[i], gaps[i] + 2.63); ctx.lineWidth = i ? 3.2 : 5.2;
        ctx.strokeStyle = '#263033'; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 38, gaps[i] + .1, gaps[i] + 2.45); ctx.lineWidth = .7;
        ctx.strokeStyle = '#a49a6a'; ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    const mark = windowAt(ms, 150, 430, 750, 1200);
    ctx.save(); ctx.globalAlpha *= mark; ctx.translate(0, -58 - open * 5);
    shape(ctx, 'M -19 -16 L 19 -16 L 19 16 L -19 16 Z', '#283238', metal(ctx, 'gold'), 1);
    shape(ctx, 'M -14 -11 L 14 -11 M -14 11 L 14 11', undefined, '#b9a66a', .5);
    ctx.font = '600 15px "KaiTi", "STKaiti", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f1dfae'; ctx.fillText('再动', 0, 1);
    ctx.restore();
    const release = windowAt(ms, 200, 400, 670, 1040);
    ctx.save(); ctx.globalAlpha *= release;
    for (const side of [-1, 1]) {
        curve(ctx, side * 12, 23, side * 38, -40, side * 13, '#a08c58', .9, 0, open);
        star(ctx, side * (12 + 26 * open), 23 - 63 * open, 2.5, '#d1bd82');
    }
    shape(ctx, 'M -7 42 L 0 35 L 7 42 L 0 49 Z', metal(ctx, 'gold'));
    ctx.restore();
}

/** 原点是棋子中心、100 单位是一格。只绘制装饰，结算始终由引擎负责。 */
export function drawMechanismFrame(ctx: CanvasRenderingContext2D, theme: MechanismFxTheme, ms: number,
    to: [number, number] = [0, 0], incoming: [number, number] = [-1, -.6], recover = false) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (ms >= 0 && ms < 1650) {
        switch (theme) {
            case 'rebirth': rebirth(ctx, ms); break;
            case 'king-shift': crownShift(ctx, ms, true); break;
            case 'lord-shift': crownShift(ctx, ms, false); break;
            case 'conversion': conversion(ctx, ms, incoming); break;
            case 'counter': counter(ctx, ms, to, recover); break;
            case 'laststand': laststand(ctx, ms); break;
            case 'extra-action': extraAction(ctx, ms); break;
        }
    }
    ctx.restore();
}
