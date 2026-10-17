/**
 * 占位立绘生成器：给"轩辕神君"画一张临时的金行剑罡占位图（纯色底 + 斜剑剪影）。
 * 正式美术到位后直接覆盖 public/hero-images/{avatars,full-body}/轩辕神君.png 即可，本脚本可删。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = new Int32Array(256).map((_, n) => {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            return c;
        });
    }
    let crc = -1;
    for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

/** 纯色底上描一条金色斜剑：剑身直线 + 十字护手 + 剑尖三角 */
function render(width, height) {
    const base = [24, 22, 20];          // 墨色底（与水墨主题同调）
    const gold = [212, 168, 67];        // 金行主色
    const pixels = Buffer.alloc(width * height * 3);
    const bladeFrom = [0.22, 0.8];      // 归一化坐标：斜剑起终点
    const bladeTo = [0.78, 0.22];
    const put = (x, y, color, blend = 1) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const i = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) {
            pixels[i + c] = Math.round(base[c] * (1 - blend) + color[c] * blend);
        }
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const v = y / height;
            // 剑身：参数化线段 + 粗细
            const t = ((u - bladeFrom[0]) * (bladeTo[0] - bladeFrom[0]) + (v - bladeFrom[1]) * (bladeTo[1] - bladeFrom[1])) /
                ((bladeTo[0] - bladeFrom[0]) ** 2 + (bladeTo[1] - bladeFrom[1]) ** 2);
            const clamped = Math.max(0, Math.min(1, t));
            const px = bladeFrom[0] + (bladeTo[0] - bladeFrom[0]) * clamped;
            const py = bladeFrom[1] + (bladeTo[1] - bladeFrom[1]) * clamped;
            const dist = Math.hypot(u - px, v - py);
            const onBlade = t > 0.05 && t < 0.95 && dist < 0.02;
            const onTip = t >= 0.9 && dist < 0.06 * (1 - clamped) * 6;
            // 护手：与剑身垂直的短横
            const guardX = bladeFrom[0] + (bladeTo[0] - bladeFrom[0]) * 0.2;
            const guardY = bladeFrom[1] + (bladeTo[1] - bladeFrom[1]) * 0.2;
            const onGuard = Math.hypot((u - guardX) * 0.6 + (v - guardY) * 0.8, (u - guardX) * 0.8 - (v - guardY) * 0.6) < 0.1 &&
                Math.abs((u - guardX) * 0.8 - (v - guardY) * 0.6) < 0.012;
            if (onBlade || onTip || onGuard) put(x, y, gold, 0.95);
            else pixels[(y * width + x) * 3] = base[0], pixels[(y * width + x) * 3 + 1] = base[1], pixels[(y * width + x) * 3 + 2] = base[2];
        }
    }
    // PNG scanline：每行前置 filter byte 0
    const raw = Buffer.alloc(height * (width * 3 + 1));
    for (let y = 0; y < height; y++) {
        raw[y * (width * 3 + 1)] = 0;
        pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // truecolor
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const targets = [
    [join(root, 'public/hero-images/avatars/轩辕神君.png'), 512, 512],
    [join(root, 'public/hero-images/full-body/轩辕神君.png'), 512, 640],
];
for (const [file, width, height] of targets) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, render(width, height));
    console.log('placeholder written:', file);
}
