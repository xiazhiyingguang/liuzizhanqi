/**
 * 把震霄头像里的完整墨龙（public/fx/_dragon-crop.png，已掩掉人脸区）
 * 矢量化为透明底 SVG：public/fx/zhenxiao-dragon.svg。
 * 手动量化到固定水墨调色板 + 按亮度剥离纸底。
 * 用法：node scripts/trace-zhenxiao-dragon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import ImageTracer from 'imagetracerjs';

const SOURCE = 'public/fx/_dragon-crop.png';
const TARGET = 'public/fx/zhenxiao-dragon.svg';
const TRACE_WIDTH = 440;

const png = PNG.sync.read(readFileSync(SOURCE));
const scale = TRACE_WIDTH / png.width;
const targetW = Math.round(png.width * scale);
const targetH = Math.round(png.height * scale);
const small = new PNG({ width: targetW, height: targetH });
for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
        const sx = Math.min(png.width - 1, Math.floor(x / scale));
        const sy = Math.min(png.height - 1, Math.floor(y / scale));
        const si = (sy * png.width + sx) * 4;
        const di = (y * targetW + x) * 4;
        for (let c = 0; c < 4; c++) small.data[di + c] = png.data[si + c];
    }
}

// 水墨固定调色板（RGBA）——先手动最近邻量化，库里只会见到这些颜色
const PAL = [
    [240, 234, 224, 255],  // 宣纸底
    [110, 107, 100, 255],  // 次淡墨（承接灰金晕染，事后剥离）
    [58, 57, 60, 255],     // 中墨
    [24, 24, 30, 255],     // 浓墨
    [201, 162, 94, 255],   // 金
    [232, 208, 152, 255],  // 亮金
];
const quantized = new PNG({ width: targetW, height: targetH });
for (let i = 0; i < targetW * targetH; i++) {
    const di = i * 4;
    let best = 0, bestDist = Infinity;
    for (let p = 0; p < PAL.length; p++) {
        const dr = small.data[di] - PAL[p][0];
        const dg = small.data[di + 1] - PAL[p][1];
        const db = small.data[di + 2] - PAL[p][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; best = p; }
    }
    quantized.data[di] = PAL[best][0];
    quantized.data[di + 1] = PAL[best][1];
    quantized.data[di + 2] = PAL[best][2];
    quantized.data[di + 3] = 255;
}

let svg = ImageTracer.imagedataToSVG(
    { width: targetW, height: targetH, data: quantized.data },
    {
        colorsampling: 2,
        numberofcolors: PAL.length,
        ltres: 0.5,
        qtres: 0.5,
        pathomit: 24,
        blurradius: 2,
        blurdelta: 22,
        roundcoords: 1,
        viewbox: true,
        desc: false,
    }
);

// 大金路径过滤：背景金圈是大弧段（包围盒对角线很长），龙身金斑是小碎块；
// 金色且对角线 > 120 源像素的路径一律视为圈段剥除
svg = svg.replace(/<path fill="rgb\((\d+),(\d+),(\d+)\)"([^>]*)d="([^"]*)"[^>]*?\/>/g,
    (m, r, g, b, attrs, d) => {
        const R = +r, G = +g, B = +b;
        const sat = Math.max(R, G, B) - Math.min(R, G, B);
        if (sat < 60) return m;                       // 非金色不处理
        const nums = d.match(/-?\d+(?:\.\d+)?/g) || [];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i + 1 < nums.length; i += 2) {
            const x = +nums[i], y = +nums[i + 1];
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        const diag = Math.hypot(x1 - x0, y1 - y0);
        return diag > 120 ? '' : m;
    }
);

// 剥掉底色：a) 近纸色（min>198）；b) 灰晕（亮度中等且低饱和——头像里金圈外的灰金 wash，
// 在棋盘上会糊成色块；高饱和的金与深墨笔触都保留）
svg = svg.replace(
    /<path fill="rgb\((\d+),(\d+),(\d+)\)"[^>]*?\/>/g,
    (m, r, g, b) => {
        const R = +r, G = +g, B = +b;
        const bright = (R + G + B) / 3;
        const sat = Math.max(R, G, B) - Math.min(R, G, B);
        if (Math.min(R, G, B) > 198) return '';
        if (bright >= 88 && bright <= 168 && sat < 55) return '';
        return m;
    }
);

// 显式写入宽高：canvas drawImage(SVG) 需要固有尺寸
svg = svg.replace('<svg ', `<svg width="${targetW}" height="${targetH}" `);

writeFileSync(TARGET, svg, 'utf8');
console.log(`traced -> ${TARGET} (${targetW}x${targetH}, ${(svg.length / 1024).toFixed(1)} KB)`);
