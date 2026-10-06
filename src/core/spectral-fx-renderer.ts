import type { SkillFxProfile } from './skill-fx';

type Theme = NonNullable<SkillFxProfile['spectral']>;
export type SpectralVariant = 'caster' | 'target' | 'impact' | 'area';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const p = clamp(v); return p * p * (3 - 2 * p); };
const life = (t: number) => smooth(t / 180) * (1 - smooth((t - 1210) / 290));

function mist(ctx: CanvasRenderingContext2D, opacity: number, purple: boolean) {
    ctx.save(); ctx.translate(90, 179); ctx.scale(1, .22);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 40);
    g.addColorStop(0, purple ? `rgba(77,49,98,${opacity})` : `rgba(25,73,64,${opacity})`);
    g.addColorStop(.48, `rgba(106,151,137,${opacity * .35})`);
    g.addColorStop(1, 'rgba(70,90,70,0)');
    ctx.fillStyle = g; ctx.fillRect(-40, -40, 80, 80); ctx.restore();
}

/** 一瓣完整的曲面：深色瓣根、半透明青玉瓣面和细亮边，不叠加粗描边。 */
function petal(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number, alpha: number, purple = false) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(-width, 0, width * .4, -length);
    g.addColorStop(0, purple ? '#352d46' : '#193f39');
    g.addColorStop(.32, purple ? '#69627d' : '#4a8a79');
    g.addColorStop(.72, purple ? '#bcc1d4' : '#a7d7c9');
    g.addColorStop(1, '#eef9df');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-width, -length * .18, -width * .86, -length * .68, 0, -length);
    ctx.bezierCurveTo(width * .48, -length * .68, width * .82, -length * .28, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(222,245,222,.72)'; ctx.lineWidth = .55;
    ctx.beginPath(); ctx.moveTo(0, -length);
    ctx.bezierCurveTo(-width * .86, -length * .68, -width, -length * .18, 0, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(228,241,219,.27)'; ctx.lineWidth = .5;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(-width * .18, -length * .52, 0, -length * .91); ctx.stroke();
    ctx.restore();
}

function bloom(ctx: CanvasRenderingContext2D, t: number, alpha: number, purple: boolean) {
    const open = smooth((t - 90) / (purple ? 260 : 620));
    const sway = Math.sin(t * .002) * 2;
    const y = 156 - open * 30;
    ctx.save(); ctx.globalAlpha = alpha;
    const glow = ctx.createRadialGradient(90, y - 18, 2, 90, y - 18, 42);
    glow.addColorStop(0, 'rgba(171,210,185,.25)'); glow.addColorStop(1, 'rgba(112,174,151,0)');
    ctx.fillStyle = glow; ctx.fillRect(45, y - 63, 90, 85);
    ctx.strokeStyle = 'rgba(79,141,120,.6)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(90, 177); ctx.bezierCurveTo(98, 162, 81, 145, 90 + sway, y); ctx.stroke();
    ctx.restore();
    // 后瓣展开在前瓣之前，形成一朵有前后层次的幽花。
    for (let i = -3; i <= 3; i++) {
        const angle = i * .34 * (.18 + open * .82);
        petal(ctx, 90 + sway, y, angle, (47 - Math.abs(i) * 2) * (.45 + open * .55), 10, alpha * .75, purple);
    }
    for (let i = -2; i <= 2; i++) {
        petal(ctx, 90 + sway, y + 2, i * .52 * open, 30 + open * 3, 8.5, alpha * .94, purple);
    }
    ctx.save(); ctx.globalAlpha = alpha * open;
    ctx.fillStyle = '#ead7a6'; ctx.shadowColor = '#ead7a6'; ctx.shadowBlur = 5;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.ellipse(90 + sway + i * 2.5, y - 9 - (1 - Math.abs(i)) * 3, .65, 2.1, i * .3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

function scatter(ctx: CanvasRenderingContext2D, t: number) {
    for (let i = 0; i < 7; i++) {
        const p = (t - 340 - i * 32) / 880;
        if (p <= 0 || p >= 1) continue;
        const drift = (i - 3) * 11 * smooth(p / .7);
        const x = 90 + drift + Math.sin(p * 4 + i) * 5;
        const y = 137 - (1 - (1 - p) ** 2) * (58 + i % 3 * 11);
        const a = smooth(p / .12) * (1 - smooth((p - .58) / .42));
        petal(ctx, x, y, (i - 3) * .42 + p * (i % 2 ? 1 : -1), 17 + i % 3 * 3, 4.5, a * .88, true);
    }
}

function crown(ctx: CanvasRenderingContext2D, t: number) {
    const a = smooth((t - 650) / 240) * (1 - smooth((t - 1210) / 290));
    if (a <= 0) return;
    ctx.save(); ctx.translate(90, 104 - Math.sin(t * .002) * 2); ctx.globalAlpha = a * .88;
    const g = ctx.createLinearGradient(-23, -8, 22, 8);
    g.addColorStop(0, '#665039'); g.addColorStop(.38, '#e0c688'); g.addColorStop(.52, '#fff0c2'); g.addColorStop(1, '#8e7246');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-23, -10); ctx.lineTo(-17, 3); ctx.lineTo(-10, -6); ctx.lineTo(0, -17); ctx.lineTo(10, -6); ctx.lineTo(17, 3); ctx.lineTo(23, -10); ctx.lineTo(18, 13); ctx.quadraticCurveTo(0, 19, -18, 13); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#f8e2b9'; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.moveTo(-17, 10); ctx.quadraticCurveTo(0, 15, 17, 10); ctx.stroke();
    ctx.fillStyle = '#5c416d'; ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(3, 3); ctx.lineTo(0, 8); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.restore();
}

function gatherLight(ctx: CanvasRenderingContext2D, t: number) {
    for (let i = 0; i < 3; i++) {
        const p = (t - i * 85) / 970;
        if (p <= 0 || p >= 1) continue;
        const a = Math.sin(Math.PI * p) * .65;
        const start = 52 + i * 38;
        const path = new Path2D(); path.moveTo(start, 179);
        path.bezierCurveTo(start - 30, 146, 137 - i * 26, 130, 90, 109);
        ctx.save();
        const g = ctx.createLinearGradient(start, 179, 90, 109);
        g.addColorStop(0, 'rgba(71,53,91,0)'); g.addColorStop(.5, `rgba(131,112,160,${a})`); g.addColorStop(1, `rgba(235,214,164,${a})`);
        ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.setLineDash([30, 100]); ctx.lineDashOffset = -p * 170;
        ctx.shadowColor = '#b4a7cc'; ctx.shadowBlur = 5; ctx.stroke(path); ctx.restore();
    }
    crown(ctx, t);
}

/** 一个主效：幽花舒展、花瓣化散、细光汲取。 */
export function drawSpectralFrame(ctx: CanvasRenderingContext2D, theme: Theme, variant: SpectralVariant, time: number, delay: number) {
    ctx.clearRect(0, 0, 180, 220);
    const t = time - delay;
    if (t <= 0 || t >= 1550) return;
    const gather = theme === 'soul-gather';
    if (variant === 'caster' && !gather) return;
    const burst = theme === 'wither-scatter';
    mist(ctx, life(t) * .23, gather || burst);
    if (gather) gatherLight(ctx, t);
    else if (burst) {
        bloom(ctx, t, life(t) * (1 - smooth((t - 390) / 380)), true);
        scatter(ctx, t);
    } else bloom(ctx, t, life(t), false);
}
