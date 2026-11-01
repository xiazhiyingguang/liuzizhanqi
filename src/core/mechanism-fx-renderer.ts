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
/** 稳定伪随机：同一个序号每一帧算出同一个值，跳动只靠时间步进取样 */
const noise = (n: number) => { const v = Math.sin(n * 127.1 + 41.7) * 43758.5453; return v - Math.floor(v); };

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

function zhaoshen(ctx: CanvasRenderingContext2D, ms: number): void {
    const gold = metal(ctx, 'gold');
    // ① 八方向飞剑从外围收拢归鞘，逐把延迟
    for (let i = 0; i < 8; i++) {
        const angle = (-90 + i * 45) * Math.PI / 180;
        const t = clamp((ms - 60 - i * 45) / 480);
        const arrive = smooth(t);
        const r = 80 - arrive * 62;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r * 0.78 - 4;
        const alpha = windowAt(ms, 60 + i * 45, 140 + i * 45, 150 + i * 45, 620 + i * 45) * 0.9;
        if (alpha > 0.01) {
            // 剑身拖尾：沿来路的一条渐隐金线
            ctx.save();
            ctx.globalAlpha = alpha * 0.4;
            ctx.strokeStyle = '#f5d78e';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(Math.cos(angle) * (80 - 16 * (1 - arrive * 0.4)), Math.sin(angle) * (62 - 13 * (1 - arrive * 0.4)));
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.restore();
            ctx.save();
            ctx.translate(x, y);
            // 剑尖指向本体
            ctx.rotate(angle + Math.PI / 2);
            ctx.globalAlpha = alpha;
            ctx.shadowColor = 'rgba(231,194,112,0.85)';
            ctx.shadowBlur = 7;
            shape(ctx, 'M 0 -15 L 3 -5 L 3 8 L 0 12 L -3 8 L -3 -5 Z', '#eef4f8', gold, 0.9);
            ctx.fillRect(-0.7, -15, 1.4, 16);
            ctx.restore();
        }
    }
    // ② 核心金光闪烁 + 天光柱贯体
    const flash = windowAt(ms, 380, 470, 150, 980);
    if (flash > 0.01) {
        ctx.save();
        ctx.globalAlpha = flash;
        glow(ctx, 0, -6, 55 * (0.7 + flash * 0.3), '#fff2c0');
        ctx.restore();
    }
    const pillar = windowAt(ms, 420, 560, 250, 1250);
    if (pillar > 0.01) {
        const pw = 15 * (0.5 + pillar * 0.5);
        const gradient = ctx.createLinearGradient(0, -86, 0, 42);
        gradient.addColorStop(0, 'rgba(255,242,192,0)');
        gradient.addColorStop(0.38, 'rgba(255,242,192,0.5)');
        gradient.addColorStop(0.75, 'rgba(214,169,83,0.24)');
        gradient.addColorStop(1, 'rgba(214,169,83,0)');
        ctx.save();
        ctx.globalAlpha = pillar * 0.75;
        ctx.beginPath();
        ctx.moveTo(-pw * 0.45, -86);
        ctx.lineTo(pw * 0.45, -86);
        ctx.lineTo(pw, 42);
        ctx.lineTo(-pw, 42);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();
    }
    // ③ 脚下双环法阵缓缓旋开（八个刻度逐一点亮）
    const ring = windowAt(ms, 460, 620, 420, 1550);
    if (ring > 0.01) {
        ctx.save();
        ctx.translate(0, 26);
        ctx.scale(1, 0.37);
        ctx.globalAlpha = ring * 0.88;
        ctx.strokeStyle = '#d6a953';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 56, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = ring * 0.52;
        ctx.beginPath();
        ctx.arc(0, 0, 48, 0, Math.PI * 2);
        ctx.stroke();
        const sweep = smooth(clamp((ms - 460) / 560)) * Math.PI * 1.5;
        ctx.globalAlpha = ring * 0.85;
        ctx.strokeStyle = '#ffe9b0';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 56, -Math.PI / 2, -Math.PI / 2 + sweep);
        ctx.stroke();
        // 八个刻度沿圆周顺时针依次点亮
        for (let i = 0; i < 8; i++) {
            const on = smooth(clamp((ms - 620 - i * 55) / 200));
            if (on <= 0) continue;
            const tick = (-90 + i * 45) * Math.PI / 180;
            const cos = Math.cos(tick);
            const sin = Math.sin(tick);
            ctx.strokeStyle = i % 2 === 0 ? '#fff2c0' : '#d6a953';
            ctx.lineWidth = i % 2 === 0 ? 3 : 2;
            ctx.globalAlpha = ring * (0.3 + on * 0.7);
            ctx.beginPath();
            ctx.moveTo(cos * 45, sin * 45);
            ctx.lineTo(cos * 56, sin * 56);
            ctx.stroke();
            if (on > 0.6) glow(ctx, cos * 60, sin * 60, 9 * on, '#ffe9b0', 0.55);
        }
        ctx.restore();
    }
    // ④ 头顶金印名牌「昭神」缓缓浮现
    const plate = windowAt(ms, 560, 720, 360, 1720);
    if (plate > 0.01) {
        const rise = (1 - smooth(clamp((ms - 560) / 480))) * 14;
        ctx.save();
        ctx.translate(0, -72 + rise);
        ctx.globalAlpha = plate;
        shape(ctx, 'M -19 -11 L 19 -11 L 19 11 L -19 11 Z', '#2c2415', gold, 1);
        ctx.globalAlpha = plate * 0.4;
        shape(ctx, 'M -16 -8 L 16 -8 L 16 8 L -16 8 Z', 'rgba(0,0,0,0)', 'rgba(247,210,142,0.72)', 0.6);
        ctx.globalAlpha = plate;
        ctx.font = '600 15px "KaiTi","STKaiti",serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f1dfae';
        ctx.shadowColor = 'rgba(231,194,112,0.7)';
        ctx.shadowBlur = 6;
        ctx.fillText('昭神', 0, 4);
        ctx.restore();
    }
    // ⑤ 零星金芒
    for (let i = 0; i < 4; i++) {
        const sparkle = windowAt(ms, 860 + i * 140, 960 + i * 140, 140 + i * 40, 1520);
        if (sparkle <= 0.01) continue;
        const angle = (40 + i * 95) * Math.PI / 180;
        const r = 34 + i * 7;
        star(ctx, Math.cos(angle) * r, -12 + Math.sin(angle) * r * 0.55, 4.5 + (i % 2) * 1.5, '#ffe9b0');
    }
}

/** 火行昭神入场的配色：沿用闻人翊悬手绘材质的焦墨—赭红—金白，不用轩辕的金芒。 */
const WENREN_FIRE = {
    char: '#2a1712', umber: '#6f2b1a', red: '#a83a20', orange: '#d9621f', gold: '#f0b45a', pale: '#fff3c8',
};

/** 一小片炭烬：手搭四边形，避免走 Path2D（Node 单测里没有 Path2D 实现） */
function cinderDot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x - size * .2, y - size * 1.5);
    ctx.lineTo(x + size, y - size * .2);
    ctx.lineTo(x + size * .2, y + size * .7);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

/** 一记火舌：宽腹钩尖、底部留焦黑，与闻人翊悬的手绘材质同一套笔法 */
function emberFlame(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number,
    lean: number, alpha: number, pale: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    ctx.globalAlpha *= alpha;
    const body = ctx.createLinearGradient(0, 0, 0, -h);
    body.addColorStop(0, 'rgba(30,15,11,.74)');
    body.addColorStop(.16, WENREN_FIRE.umber);
    body.addColorStop(.44, '#b44422');
    body.addColorStop(.68, WENREN_FIRE.orange);
    body.addColorStop(.86, WENREN_FIRE.gold);
    body.addColorStop(1, 'rgba(255,241,190,0)');
    // 根座垫一团暖光：火舌在米色棋盘上才不会糊成实心块
    const halo = ctx.createRadialGradient(0, -h * .22, 0, 0, -h * .22, w * 2.6);
    halo.addColorStop(0, 'rgba(226,105,31,.42)');
    halo.addColorStop(1, 'rgba(226,105,31,0)');
    ctx.save();
    ctx.globalAlpha *= .5;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, -h * .22, w * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 轮廓外缘用同色投影晕开，火舌才不会是硬边剪影
    ctx.save();
    ctx.shadowColor = 'rgba(226,105,31,.5)';
    ctx.shadowBlur = Math.max(3, h * .16);
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.bezierCurveTo(-w * 1.12, -h * .26, -w * .62, -h * .5, -w * .2, -h * .9);
    ctx.quadraticCurveTo(-w * .04, -h * 1.02, w * .13, -h * .82);
    ctx.bezierCurveTo(w * .5, -h * .58, w * .9, -h * .26, w, 0);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= .72;
    const inner = ctx.createLinearGradient(0, -h * .08, 0, -h * .82);
    inner.addColorStop(0, 'rgba(111,43,26,.2)');
    inner.addColorStop(.45, '#c64724');
    inner.addColorStop(.78, '#ef8a35');
    inner.addColorStop(1, pale);
    ctx.beginPath();
    ctx.moveTo(-w * .46, -h * .04);
    ctx.quadraticCurveTo(-w * .4, -h * .42, -w * .04, -h * .76);
    ctx.quadraticCurveTo(w * .26, -h * .44, w * .46, -h * .04);
    ctx.closePath();
    ctx.fillStyle = inner;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(0, 0, w * .98, Math.max(2.2, h * .12), 0, 0, Math.PI);
    ctx.fillStyle = 'rgba(29,14,10,.42)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-w * .16, -h * .74);
    ctx.quadraticCurveTo(w * .52, -h * .46, w * .82, -3);
    ctx.strokeStyle = pale;
    ctx.globalAlpha *= .5;
    ctx.lineWidth = .8;
    ctx.stroke();
    ctx.restore();
}

/** 折线描边：炭底与亮线各走一遍，火环的焦边也用它，不占 arc 的断口账 */
function polyline(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>,
    style: string | CanvasGradient, width: number) {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.stroke();
}

/** 闻人翊悬昭神入场：破妄火纹自脚下盘上全身 → 金白焰包裹 → 炸开一圈带断口的火环。 */
function emberAscend(ctx: CanvasRenderingContext2D, ms: number): void {
    const ember = ctx.createLinearGradient(-24, -50, 24, 32);
    ember.addColorStop(0, WENREN_FIRE.pale);
    ember.addColorStop(.42, WENREN_FIRE.gold);
    ember.addColorStop(.74, WENREN_FIRE.red);
    ember.addColorStop(1, WENREN_FIRE.char);
    const step = Math.floor(ms / 55);
    const jit = (i: number, salt: number) => noise(i + salt + step * 3.71);
    // ① 火纹盘上全身：一条两圈半的螺自脚底长到头顶，炭底托着亮线，末端咬一记火舌
    const climb = smooth(ms / 620);
    if (climb > .01) {
        const N = 46;
        const upto = Math.max(1, Math.round(N * climb));
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= upto; i++) {
            const q = i / N;
            const a = -Math.PI / 2 + q * Math.PI * 4.3;
            const r = 47 - q * 9;
            pts.push([Math.cos(a) * r, 34 - q * 92 + Math.sin(a) * 9]);
        }
        // 分成前后两遍画：绕到身后的那半圈压暗，才读成"盘在身体上"而不是画在脸上
        const runs: { far: boolean; pts: Array<[number, number]> }[] = [];
        for (let i = 1; i <= upto; i++) {
            const far = Math.sin(-Math.PI / 2 + (i / N) * Math.PI * 4.3) < 0;
            const last = runs[runs.length - 1];
            if (last && last.far === far) last.pts.push(pts[i]);
            else runs.push({ far, pts: [pts[i - 1], pts[i]] });
        }
        for (const pass of [true, false]) {
            ctx.save();
            ctx.globalAlpha *= (1 - smooth((ms - 620) / 360)) * (pass ? .6 : 1);
            for (const run of runs) {
                if (run.far !== pass) continue;
                polyline(ctx, run.pts, 'rgba(42,23,18,.5)', 4.2);
                polyline(ctx, run.pts, ember, 2.3);
            }
            ctx.restore();
        }
        const [hx, hy] = pts[upto];
        ctx.save();
        ctx.globalAlpha *= 1 - smooth((ms - 620) / 360);
        emberFlame(ctx, hx, hy + 2, 16 + jit(1, 9) * 6, 4.6, (jit(1, 13) - .5) * .4, 1, WENREN_FIRE.pale);
        ctx.restore();
    }
    // ② 金白焰包裹：一圈火舌站在头像外的环上，后弧压暗收窄，高度逐帧跳动
    const wrap = windowAt(ms, 380, 620, 820, 1040);
    if (wrap > .02) {
        const rise = smooth((ms - 380) / 460);
        const order = Array.from({ length: 9 }, (_, i) => {
            const a = i * Math.PI * 2 / 9 + .35;
            return { a, back: Math.sin(a), i };
        }).sort((left, right) => left.back - right.back);
        for (const t of order) {
            const depth = t.back > .1 ? 1 : .88;
            const h = (30 + rise * 24) * (.78 + jit(t.i, 3) * .44);
            emberFlame(ctx, Math.cos(t.a) * 49, 30 + Math.sin(t.a) * 11,
                h, Math.max(5.6, h * .2) * depth, (jit(t.i, 11) - .5) * .5,
                wrap * depth, WENREN_FIRE.pale);
        }
        glow(ctx, 0, -2, 52 * (.6 + rise * .4), '#e07b2a', wrap * .26);
    }
    // ③ 炸开：四段带断口的火环向外撑开，焦边在内、亮芯在外，环心一闪即收
    const burst = smooth((ms - 760) / 380);
    const ringAlpha = windowAt(ms, 760, 900, 1300, 1690);
    if (ringAlpha > .02) {
        const rx = 46 + burst * 46;
        ctx.save();
        ctx.globalAlpha *= ringAlpha;
        for (let i = 0; i < 4; i++) {
            const start = i * Math.PI / 2 + .28;
            const band = (radius: number, style: string | CanvasGradient, width: number) => {
                const pts: Array<[number, number]> = [];
                for (let k = 0; k <= 12; k++) {
                    const a = start + (k / 12) * 1.25;
                    pts.push([Math.cos(a) * radius, 26 + Math.sin(a) * radius * .38]);
                }
                polyline(ctx, pts, style, width);
            };
            band(rx + 4, 'rgba(42,23,18,.5)', 7 - burst * 3);
            ctx.save();
            ctx.translate(0, 26);
            ctx.scale(1, .38);
            ctx.beginPath();
            ctx.arc(0, 0, rx, start, start + 1.25);
            ctx.strokeStyle = i % 2 ? ember : WENREN_FIRE.red;
            ctx.lineWidth = 6.5 - burst * 3;
            ctx.stroke();
            ctx.restore();
            band(rx - 4, WENREN_FIRE.pale, 1.4);
        }
        ctx.restore();
        glow(ctx, 0, 14, 46 + burst * 62, '#ffd98a', windowAt(ms, 760, 830, 900, 1120) * .5);
    }
    // ④ 余烬抛出后落下，环外残火陆续熄掉（收尾在 1.7s 前，不留硬切）
    const fall = smooth(clamp((ms - 880) / 900));
    const embers = windowAt(ms, 880, 1020, 1360, 1690);
    if (embers > .02) {
        ctx.save();
        ctx.globalAlpha *= embers;
        for (let i = 0; i < 11; i++) {
            const a = i * 2.4 + 1.1;
            const r = 16 + (i % 5) * 9;
            cinderDot(ctx, Math.cos(a) * r * (1 + fall * .9),
                20 - Math.sin(fall * Math.PI) * (26 + i * 2) + fall * fall * 30 + Math.sin(a) * r * .3,
                1.2 + (i % 3) * .7, i % 3 ? WENREN_FIRE.gold : WENREN_FIRE.pale);
        }
        ctx.restore();
    }
    for (let i = 0; i < 5; i++) {
        const on = windowAt(ms, 1180 + i * 70, 1320 + i * 70, 1460 + i * 40, 1660 + i * 25);
        if (on <= .02) continue;
        const a = i * 1.27 + .5;
        const h = 14 + on * 16;
        emberFlame(ctx, Math.cos(a) * (56 + i * 5), 30 + Math.sin(a) * 9,
            h, Math.max(4.4, h * .22), (jit(i, 17) - .5) * .5, on * .8, WENREN_FIRE.gold);
    }
}

function counter(ctx: CanvasRenderingContext2D, ms: number, to: [number, number], recover: boolean): void {
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
    if (ms >= 0 && ms < (theme === 'zhaoshen' ? 1780 : theme === 'ember-ascend' ? 1850 : 1650)) {
        switch (theme) {
            case 'rebirth': rebirth(ctx, ms); break;
            case 'zhaoshen': zhaoshen(ctx, ms); break;
            case 'ember-ascend': emberAscend(ctx, ms); break;
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
