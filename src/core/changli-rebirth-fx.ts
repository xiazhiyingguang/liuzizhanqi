const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const p = clamp(n); return p * p * (3 - 2 * p); };
const envelope = (ms: number, start: number, peak: number, fade: number, end: number) =>
    ease((ms - start) / (peak - start)) * (1 - ease((ms - fade) / (end - fade)));

function haze(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, opacity: number) {
    if (opacity <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry); ctx.globalAlpha *= opacity;
    const light = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    light.addColorStop(0, color); light.addColorStop(.34, color); light.addColorStop(1, 'transparent');
    ctx.fillStyle = light; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
}

function ember(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, opacity: number) {
    haze(ctx, x, y, size * 3.4, size * 3.4, '#d68052', opacity * .24);
    ctx.save(); ctx.globalAlpha *= opacity;
    ctx.fillStyle = '#f3cb94'; ctx.beginPath(); ctx.ellipse(x, y, size * .46, size, .32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff2d4'; ctx.beginPath(); ctx.arc(x, y - size * .2, size * .23, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

/** 热流快速冲起，短段保持颗粒边缘；热核与外焰分别绘制。 */
function fireThread(ctx: CanvasRenderingContext2D, ms: number, index: number, side: number, opacity: number) {
    const progress = 1 - Math.pow(1 - clamp((ms - 265 - index * 23) / 210), 3);
    const height = (index === 0 ? 136 : index === 1 ? 112 : 87) * progress;
    if (height < 1 || opacity <= 0) return;
    const drift = ms * .0057 + index * 1.87 + side * .6;
    const points: Array<[number, number]> = [];
    ctx.beginPath();
    for (let i = 0; i <= 36; i++) {
        const u = i / 36;
        const wave = Math.sin(u * 8.4 - drift) * 5.5 + Math.sin(u * 15.1 + drift * .63) * 2.6;
        const x = side * (24 + index * 5 + Math.sin(u * 2.8) * (17 - index * 2)) + wave * Math.sin(u * Math.PI);
        const y = 40 - u * height;
        points.push([x, y]);
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const warm = ctx.createLinearGradient(0, 41, 0, 40 - height);
    warm.addColorStop(0, '#ffdb83'); warm.addColorStop(.18, '#db792c');
    warm.addColorStop(.48, '#b84732'); warm.addColorStop(.73, '#843b38'); warm.addColorStop(1, 'transparent');
    ctx.save(); ctx.globalAlpha *= opacity;
    ctx.strokeStyle = warm; ctx.lineWidth = 14 - index * 2;
    ctx.globalAlpha *= .18; ctx.stroke(); ctx.restore();
    // 短段宽度与密度逐段变化，热流断续、尖端松散，避免变成完整的描边线。
    const hot = ctx.createLinearGradient(0, 40, 0, -31);
    hot.addColorStop(0, '#fff0c2'); hot.addColorStop(.18, '#ffd172'); hot.addColorStop(1, 'transparent');
    for (let i = 1; i < points.length; i++) {
        const u = i / (points.length - 1);
        const density = .40 + .60 * (.5 + .5 * Math.sin(u * 39 + drift * 2.3));
        ctx.save(); ctx.globalAlpha *= opacity * density * .92;
        ctx.beginPath(); ctx.moveTo(...points[i - 1]); ctx.lineTo(...points[i]);
        ctx.strokeStyle = warm; ctx.lineWidth = (7.4 - index * 1.25) * Math.pow(1 - u, 1.25) + .3; ctx.stroke();
        if (u < .57) { ctx.globalAlpha *= .75; ctx.strokeStyle = hot; ctx.lineWidth *= .30; ctx.stroke(); }
        ctx.restore();
        if (i % 6 === index + 1) {
            const [x, y] = points[i];
            haze(ctx, x + Math.sin(u * 19 + drift) * 2, y, 3 + (1 - u) * 4, 7,
                '#da7637', opacity * (1 - u) * density * .25);
        }
    }
}

function ignitionBurst(ctx: CanvasRenderingContext2D, ms: number) {
    const impact = envelope(ms, 240, 310, 350, 560);
    haze(ctx, 0, 34, 40, 22, '#d7672a', impact * .50);
    haze(ctx, 0, 35, 20, 12, '#ffe5a0', impact * .68);
    const p = clamp((ms - 275) / 360);
    const shock = envelope(ms, 275, 325, 440, 710);
    const radius = 13 + (1 - Math.pow(1 - p, 3)) * 57;
    ctx.save(); ctx.translate(0, 38); ctx.scale(1, .30); ctx.globalAlpha *= shock;
    // 残缺的热浪沿地面冲开，短促释放，避免常驻装饰光圈。
    for (let i = 0; i < 7; i++) {
        const angle = i * .92 + .11;
        ctx.beginPath(); ctx.arc(0, 0, radius + Math.sin(i * 2.4) * 1.5, angle, angle + .55);
        ctx.strokeStyle = '#b8552f'; ctx.lineWidth = 3.5 * (1 - p) + .7; ctx.stroke();
        ctx.strokeStyle = '#ffd080'; ctx.lineWidth *= .27; ctx.stroke();
    }
    ctx.restore();
    for (let i = 0; i < 15; i++) {
        const age = clamp((ms - 285 - i % 3 * 15) / (420 + i % 4 * 45));
        const angle = i * 2.399 + .37;
        const speed = 42 + i % 5 * 10;
        const spread = 1 - Math.pow(1 - age, 2);
        const x = Math.cos(angle) * speed * spread;
        const y = 32 - (30 + Math.abs(Math.sin(angle)) * 62) * spread + age * age * 16;
        const alpha = envelope(ms, 285, 345, 485, 865) * (1 - age);
        ctx.save(); ctx.globalAlpha *= alpha * .8; ctx.strokeStyle = '#ba602e'; ctx.lineWidth = .9;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(angle) * 6 * (1 - age), y + 7 * (1 - age)); ctx.lineTo(x, y); ctx.stroke(); ctx.restore();
        ember(ctx, x, y, 1.1 + i % 3 * .27, alpha);
    }
}

/** 星火复生：快速回聚 → 点火爆发与地面冲击 → 火焰冲起 → 星火散尽。 */
export function drawChangliRebirth(ctx: CanvasRenderingContext2D, ms: number) {
    if (ms <= 0 || ms >= 1600) return;
    const kindle = envelope(ms, 200, 330, 810, 1380);
    const fire = envelope(ms, 265, 400, 820, 1460);
    // 暖光落在脚下，头像与名字保持可读。
    haze(ctx, 0, 36, 47, 16, '#bd562e', kindle * .35);
    haze(ctx, 0, 37, 20, 6, '#ffcd76', kindle * .55);
    haze(ctx, -37, -13, 14, 46, '#ba4e32', fire * .16);
    haze(ctx, 39, -18, 13, 43, '#b25036', fire * .14);

    const gather = envelope(ms, 0, 80, 230, 390);
    for (let i = 0; i < 12; i++) {
        const p = ease((ms - i * 6) / 260);
        const angle = i * 2.399 + .21;
        const radius = (56 + i % 3 * 5) * (1 - p);
        const x = Math.cos(angle + p * .65) * radius;
        const y = 28 + Math.sin(angle + p * .65) * radius * .56;
        const alpha = gather * (1 - ease((p - .8) / .2));
        ctx.save(); ctx.globalAlpha *= alpha * .42;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(angle) * 5, y - Math.sin(angle) * 3); ctx.lineTo(x, y);
        ctx.strokeStyle = '#a85938'; ctx.lineWidth = .9; ctx.stroke(); ctx.restore();
        ember(ctx, x, y, 1.2 + i % 3 * .28, alpha);
    }

    ignitionBurst(ctx, ms);
    for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) fireThread(ctx, ms, i, side, fire * (i ? .82 : 1));
    }

    // 升腾的余烬具有不同速度和轻微横向漂移，避免整齐的装饰粒子环。
    for (let i = 0; i < 17; i++) {
        const start = 300 + i * 25;
        const p = clamp((ms - start) / (500 + i % 4 * 45));
        const side = i % 2 ? 1 : -1;
        const x = side * (25 + Math.sin(p * 2.7) * (13 + i % 3 * 4)) + Math.sin(i * 2.1 + p * 7) * 4;
        const y = 37 - p * (103 + i % 4 * 14);
        const alpha = envelope(ms, start, start + 80, start + 290, start + 660) * (1 - p * .45);
        ctx.save(); ctx.globalAlpha *= alpha * .30;
        ctx.beginPath(); ctx.moveTo(x - Math.sin(i + p * 7) * 2, y + 5); ctx.lineTo(x, y);
        ctx.strokeStyle = '#c07839'; ctx.lineWidth = .85; ctx.stroke(); ctx.restore();
        ember(ctx, x, y, .94 + i % 3 * .29, alpha);
    }

    // 头顶只留一颗新生星火，短暂亮起后向上离散。
    const finish = envelope(ms, 640, 830, 1030, 1530);
    const lift = ease((ms - 780) / 650);
    haze(ctx, 1, -62 - lift * 17, 16, 19, '#d9974a', finish * .22);
    ember(ctx, 1 + Math.sin(ms * .004) * 1.6, -62 - lift * 17, 2.5, finish);
}
