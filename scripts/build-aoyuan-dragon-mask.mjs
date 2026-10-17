import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/**
 * 把水墨游龙原画转成"墨色浓度=透明度"的遮罩图，供特效层用 mask-image 上色。
 *
 * 为什么走遮罩而不是直接贴图：游龙要跟着档案配色走（敖渊青碧、敌方阵营略深），
 * 一张固定色的龙图办不到；把龙的明暗压进 alpha，再用渐变填充，
 * 同一张素材就能染出不同颜色，还保住笔触的浓淡层次。
 *
 * 用法：node scripts/build-aoyuan-dragon-mask.mjs <原画png路径>
 * 产物：src/assets/fx/aoyuan-dragon-mask.png
 *   ——放 src 下而不是 public/，是让 vite 把它当模块资源打包并改写 url，
 *     这样换 PAGES_BASE_PATH 部署到子路径也还找得到这张遮罩。
 */
const SOURCE = process.argv[2];
const TARGET = 'src/assets/fx/aoyuan-dragon-mask.png';
const OUT_WIDTH = 760;

if (!SOURCE || !existsSync(SOURCE)) {
    console.error('用法：node scripts/build-aoyuan-dragon-mask.mjs <原画png路径>');
    process.exit(1);
}

const src = PNG.sync.read(readFileSync(SOURCE));
const { width, height, data } = src;

// 右下角是生成器水印，不参与取材
const markX = Math.round(width * 0.84), markY = Math.round(height * 0.93);
const luminance = new Float32Array(width * height);
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const inMark = x >= markX && y >= markY;
        luminance[y * width + x] = inMark ? 255
            : (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) * (data[i + 3] / 255);
    }
}

// 纸白与墨黑各取一个分位：整幅画是白底黑墨，分位比固定阈值稳
const sorted = Float32Array.from(luminance).sort();
const paper = sorted[Math.floor(sorted.length * 0.9)];
const ink = sorted[Math.floor(sorted.length * 0.02)];
const alpha = new Float32Array(width * height);
for (let p = 0; p < alpha.length; p++) {
    const t = Math.min(1, Math.max(0, (paper - luminance[p]) / Math.max(1, paper - ink)));
    // 纸面纤维的淡噪点直接切掉，否则整块棋盘会蒙一层灰
    alpha[p] = t < 0.09 ? 0 : Math.pow(t, 0.86);
}

let minX = width, minY = height, maxX = 0, maxY = 0;
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        if (alpha[y * width + x] < 0.06) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
}
const cropW = maxX - minX + 1, cropH = maxY - minY + 1;
const scale = OUT_WIDTH / cropW;
const outH = Math.max(1, Math.round(cropH * scale));
const out = new PNG({ width: OUT_WIDTH, height: outH });

// 盒式降采样：alpha 求平均，笔触边缘才不会锯齿
for (let y = 0; y < outH; y++) {
    for (let x = 0; x < OUT_WIDTH; x++) {
        const sy0 = minY + Math.floor(y / scale), sy1 = Math.min(height, minY + Math.ceil((y + 1) / scale));
        const sx0 = minX + Math.floor(x / scale), sx1 = Math.min(width, minX + Math.ceil((x + 1) / scale));
        let sum = 0, count = 0;
        for (let sy = sy0; sy < sy1; sy++) {
            for (let sx = sx0; sx < sx1; sx++) { sum += alpha[sy * width + sx]; count++; }
        }
        const o = (y * OUT_WIDTH + x) * 4;
        out.data[o] = 255; out.data[o + 1] = 255; out.data[o + 2] = 255;
        out.data[o + 3] = Math.round((count ? sum / count : 0) * 255);
    }
}

writeFileSync(TARGET, PNG.sync.write(out, { deflateLevel: 9 }));
console.log(`${SOURCE} 纸白 ${paper.toFixed(0)} / 墨黑 ${ink.toFixed(0)} → 裁切 ${cropW}×${cropH} → ${OUT_WIDTH}×${outH}`);
console.log(`写出 ${TARGET}（${Math.round(statSync(TARGET).size / 1024)}KB）`);
