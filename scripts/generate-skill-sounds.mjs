/**
 * 技能专属音效合成脚本
 *
 * 为全部 72 个英雄技能逐一合成专属 WAV（16bit mono 44.1kHz，
 * 与 public/sounds 下现有程序合成音效同规格），并生成清单文件
 * src/data/skill-sound-files.ts 供 sound-manager 使用。
 *
 * 用法：node scripts/generate-skill-sounds.mjs
 *
 * 合成原语（纯数学 DSP，无外部依赖）：
 * - tone      振荡器 + ADSR + 滑音/颤音（正弦/方波/锯齿/三角）
 * - noiseBurst 白噪声 + 可扫频二阶滤波器（低通/带通/高通）
 * - pluck     Karplus-Strong 拨弦（琵琶/古琴/竖琴类）
 * - bell      FM 钟铃/玻璃音（硬币、铃铛、冰晶）
 * - thump     低频下坠冲击（重击、心跳）
 * - drone     持续失谐低鸣（诅咒、恐惧）
 * - wind      带通噪声 + LFO（风声、冲刺）
 * - shimmer   错落高音泛音（治疗、增益）
 * - tick      短促脉冲（钟表、锁链扣环）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds', 'skills');
const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'skill-sound-files.ts');

/* ============================================================
   基础工具
   ============================================================ */

/** 创建定长静音缓冲 */
function buffer(seconds) {
    return new Float32Array(Math.max(1, Math.ceil(seconds * SAMPLE_RATE)));
}

/** 把 src 叠加到 dest 的 offsetSec 位置 */
function place(dest, src, offsetSec = 0) {
    const start = Math.max(0, Math.round(offsetSec * SAMPLE_RATE));
    for (let i = 0; i < src.length && start + i < dest.length; i++) {
        dest[start + i] += src[i];
    }
    return dest;
}

/** ADSR 包络（attack/decay/sustainLevel/release 单位秒；总长以 dur 为准） */
function envelope(dur, { attack = 0.005, decay = 0.06, sustain = 0.7, release = 0.12 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    const a = Math.max(1, Math.round(attack * SAMPLE_RATE));
    const r = Math.max(1, Math.round(release * SAMPLE_RATE));
    const d = Math.max(1, Math.round(decay * SAMPLE_RATE));
    for (let i = 0; i < n; i++) {
        let v;
        if (i < a) v = i / a;
        else if (i < a + d) v = 1 - (1 - sustain) * ((i - a) / d);
        else if (i < n - r) v = sustain;
        else v = sustain * (1 - (i - (n - r)) / r);
        out[i] = Math.max(0, v);
    }
    return out;
}

/** 峰值归一化 */
function normalize(buf, peak = 0.85) {
    let max = 0;
    for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
    if (max < 1e-6) return buf;
    const gain = peak / max;
    for (let i = 0; i < buf.length; i++) buf[i] *= gain;
    return buf;
}

/** 首尾防咔哒淡入淡出 */
function deClick(buf, fadeMs = 4) {
    const n = Math.min(buf.length, Math.round((fadeMs / 1000) * SAMPLE_RATE));
    for (let i = 0; i < n; i++) {
        buf[i] *= i / n;
        buf[buf.length - 1 - i] *= i / n;
    }
    return buf;
}

/* ============================================================
   二阶滤波器（RBJ），支持逐样本扫频
   ============================================================ */

function biquad(type, freq, q) {
    const w0 = (2 * Math.PI * freq) / SAMPLE_RATE;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
        case 'lowpass':
            b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
            a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
            break;
        case 'highpass':
            b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
            a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
            break;
        case 'bandpass':
            b0 = alpha; b1 = 0; b2 = -alpha;
            a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
            break;
        default:
            throw new Error(`unknown filter type: ${type}`);
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * 白噪声通过可扫频二阶滤波器。
 * from/to：扫频起止（Hz）；type：lowpass/bandpass/highpass
 */
function noiseBurst(dur, { from = 2000, to = 400, type = 'bandpass', q = 1, attack = 0.004, release = 0.1, gain = 1 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    const env = envelope(dur, { attack, decay: 0.03, sustain: 0.85, release });
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
        const t = i / n;
        const freq = from * Math.pow(to / from, t);
        const c = biquad(type, Math.min(freq, SAMPLE_RATE * 0.45), q);
        const x0 = Math.random() * 2 - 1;
        const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        out[i] = y0 * env[i] * gain;
    }
    return out;
}

/* ============================================================
   振荡器类原语
   ============================================================ */

function oscSample(type, phase) {
    const p = phase % 1;
    switch (type) {
        case 'sine': return Math.sin(2 * Math.PI * p);
        case 'square': return p < 0.5 ? 1 : -1;
        case 'saw': return 2 * p - 1;
        case 'triangle': return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
        default: return Math.sin(2 * Math.PI * p);
    }
}

/**
 * 单音：type 波形 + 滑音（freqTo）+ 颤音（vibratoHz/vibratoDepth）
 */
function tone(dur, { freq = 440, freqTo = null, type = 'sine', attack = 0.006, decay = 0.05, sustain = 0.75, release = 0.12, vibratoHz = 0, vibratoDepth = 0, gain = 1 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    const env = envelope(dur, { attack, decay, sustain, release });
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const k = i / n;
        const f = freqTo === null ? freq : freq * Math.pow(freqTo / freq, k);
        const vib = vibratoHz > 0 ? 1 + vibratoDepth * Math.sin(2 * Math.PI * vibratoHz * t) : 1;
        phase += (f * vib) / SAMPLE_RATE;
        out[i] = oscSample(type, phase) * env[i] * gain;
    }
    return out;
}

/** 低频下坠冲击：正弦自 freq 快速下坠，带短促噪声头 */
function thump(dur = 0.3, { freq = 120, dropTo = 38, gain = 1, crack = 0.25 } = {}) {
    const out = buffer(dur);
    place(out, tone(dur, { freq, freqTo: dropTo, type: 'sine', attack: 0.003, decay: 0.1, sustain: 0.4, release: dur * 0.5, gain }));
    if (crack > 0) {
        place(out, noiseBurst(dur * 0.4, { from: 3200, to: 300, type: 'lowpass', q: 0.8, attack: 0.002, release: dur * 0.3, gain: crack }));
    }
    return out;
}

/**
 * Karplus-Strong 拨弦：弹拨感极强，适合琵琶/古琴/竖琴。
 * damping 0~1 越大余音越短；bright 控制初始噪声带宽
 */
function pluck(dur, { freq = 330, damping = 0.996, gain = 1, bright = 0.5 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    const period = Math.max(2, Math.round(SAMPLE_RATE / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) {
        ring[i] = (Math.random() * 2 - 1) * bright;
    }
    let idx = 0;
    for (let i = 0; i < n; i++) {
        const cur = ring[idx];
        const next = ring[(idx + 1) % period];
        const avg = damping * 0.5 * (cur + next);
        ring[idx] = avg;
        out[i] = cur * gain;
        idx = (idx + 1) % period;
    }
    // 轻包络收尾，避免硬截断
    const fade = Math.min(n, Math.round(0.05 * SAMPLE_RATE));
    for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
    return out;
}

/**
 * FM 钟铃：载波 freq，调制比 ratio（非整数出金属感），衰减指数。
 * partials 可叠加多个泛音形成玻璃/冰晶质感。
 */
function bell(dur, { freq = 880, ratio = 1.4, modDepth = 2.5, gain = 1, attack = 0.002 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    const decayTau = dur / 3.2;
    let cPhase = 0;
    let mPhase = 0;
    const mFreq = freq * ratio;
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env = i < attack * SAMPLE_RATE
            ? i / (attack * SAMPLE_RATE)
            : Math.exp(-(t - attack) / decayTau);
        const mod = modDepth * Math.sin(2 * Math.PI * mPhase);
        cPhase += freq / SAMPLE_RATE;
        mPhase += mFreq / SAMPLE_RATE;
        out[i] = Math.sin(2 * Math.PI * cPhase + mod) * env * gain;
    }
    return out;
}

/** 持续低鸣：多个失谐频率叠加，适合诅咒/恐惧/压抑 */
function drone(dur, { freqs = [110, 113], type = 'triangle', attack = 0.05, release = 0.2, gain = 1, tremoloHz = 0 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    const env = envelope(dur, { attack, decay: 0.1, sustain: 0.8, release });
    const phases = freqs.map(() => Math.random());
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const trem = tremoloHz > 0 ? 0.7 + 0.3 * Math.sin(2 * Math.PI * tremoloHz * t) : 1;
        let v = 0;
        for (let f = 0; f < freqs.length; f++) {
            phases[f] += freqs[f] / SAMPLE_RATE;
            v += oscSample(type, phases[f]);
        }
        out[i] = (v / freqs.length) * env[i] * gain * trem;
    }
    return out;
}

/** 风声：带通噪声 + 慢速 LFO 调制中心频率 */
function wind(dur, { low = 300, high = 1600, lfoHz = 2.2, q = 1.6, attack = 0.08, release = 0.25, gain = 1 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    const env = envelope(dur, { attack, decay: 0.15, sustain: 0.8, release });
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * lfoHz * t + Math.random() * 0.05);
        const freq = low + (high - low) * lfo;
        const c = biquad('bandpass', Math.min(freq, SAMPLE_RATE * 0.45), q);
        const x0 = Math.random() * 2 - 1;
        const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        out[i] = y0 * env[i] * gain;
    }
    return out;
}

/** 错落泛音：多个正弦按序浮现，适合治疗/增益/神圣类 */
function shimmer(dur, { freqs = [523, 659, 784], spacing = 0.07, gain = 1, release = 0.3, vibratoHz = 5, vibratoDepth = 0.004 } = {}) {
    const out = buffer(dur);
    freqs.forEach((f, i) => {
        const seg = tone(Math.max(0.12, dur - i * spacing), {
            freq: f, type: 'sine', attack: 0.02, decay: 0.08, sustain: 0.5,
            release, vibratoHz, vibratoDepth, gain: gain / freqs.length * 1.6,
        });
        place(out, seg, i * spacing);
    });
    return out;
}

/** 短促脉冲：锁链扣环/钟表滴答/量子噪声脉冲 */
function tick(dur = 0.04, { freq = 3000, type = 'square', gain = 1, ring = 0 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    const env = envelope(dur, { attack: 0.001, decay: dur * 0.5, sustain: ring, release: dur * 0.4 });
    let phase = 0;
    for (let i = 0; i < n; i++) {
        phase += freq / SAMPLE_RATE;
        out[i] = oscSample(type, phase) * env[i] * gain;
    }
    return out;
}

/* ============================================================
   WAV 编码（16bit PCM mono，与现有音效同规格）
   ============================================================ */

function encodeWav(samples) {
    const data = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
        const v = Math.max(-1, Math.min(1, samples[i]));
        data.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

/* ============================================================
   技能音效配方
   每个配方返回 { dur, build }；build 返回混音后的缓冲。
   ============================================================ */

/* ============================================================
   族系复合模板（同族技能共用骨架，逐技能参数差异化）
   ============================================================ */

/** 斩击族：带通噪声嗖声扫掠 + 低频冲击 +（可选）金属余韵 */
function swordSlash({ dur = 0.55, from = 3600, to = 520, q = 1.4, hit = 150, hitGain = 0.9, ringFreq = null, ringGain = 0.25 } = {}) {
    const b = buffer(dur);
    place(b, noiseBurst(dur * 0.7, { from, to, type: 'bandpass', q, attack: 0.004, release: dur * 0.25, gain: 0.9 }));
    place(b, thump(0.3, { freq: hit, dropTo: hit * 0.35, gain: hitGain, crack: 0.3 }), dur * 0.18);
    if (ringFreq) place(b, bell(dur * 0.8, { freq: ringFreq, ratio: 1.19, modDepth: 1.1, gain: ringGain }), dur * 0.2);
    return b;
}

/** 冰晶族：玻璃钟铃叠加 + 碎冰噪声迸溅 */
function iceCrack({ dur = 0.7, base = 1760 } = {}) {
    const b = buffer(dur);
    place(b, bell(dur, { freq: base, ratio: 1.41, modDepth: 2.2, gain: 0.8 }));
    place(b, bell(dur * 0.8, { freq: base * 1.5, ratio: 1.33, modDepth: 1.8, gain: 0.5 }), 0.05);
    place(b, noiseBurst(dur * 0.5, { from: 6500, to: 1800, type: 'bandpass', q: 2.2, attack: 0.002, release: dur * 0.3, gain: 0.55 }), 0.02);
    return b;
}

/** 幽冥族：失谐低鸣 + 气息噪声，可加魂铃 */
function ghostDrone({ dur = 1.0, freqs = [110, 116], chime = null } = {}) {
    const b = buffer(dur);
    place(b, drone(dur, { freqs, type: 'triangle', attack: 0.08, release: 0.3, gain: 0.7, tremoloHz: 4.2 }));
    place(b, noiseBurst(dur * 0.6, { from: 1400, to: 260, type: 'bandpass', q: 0.9, attack: 0.12, release: dur * 0.4, gain: 0.25 }));
    if (chime) place(b, bell(dur * 0.9, { freq: chime, ratio: 1.47, modDepth: 2.0, gain: 0.35 }), dur * 0.3);
    return b;
}

/** 钟铃琶音：按序浮现的 FM 钟铃 */
function chimeArp(freqs, { spacing = 0.09, dur = 1.0, gain = 0.8 } = {}) {
    const b = buffer(dur);
    freqs.forEach((f, i) => place(b, bell(dur - i * spacing, { freq: f, ratio: 1.4, modDepth: 2.4, gain: gain / freqs.length * 1.7 }), i * spacing));
    return b;
}

/** 拨弦琶音：Karplus-Strong 依次弹奏 */
function pluckArp(freqs, { spacing = 0.07, dur = 1.0, damping = 0.996, gain = 0.9 } = {}) {
    const b = buffer(dur);
    freqs.forEach((f, i) => place(b, pluck(dur - i * spacing, { freq: f, damping, gain: gain / Math.sqrt(freqs.length) * 1.5 }), i * spacing));
    return b;
}

/** 爆炸族：低通噪声轰鸣 + 次低频冲击 */
function boomExplosion({ dur = 0.9, sub = 70, crack = 0.6 } = {}) {
    const b = buffer(dur);
    place(b, noiseBurst(dur * 0.85, { from: 2600, to: 90, type: 'lowpass', q: 0.8, attack: 0.003, release: dur * 0.5, gain: 1 }));
    place(b, thump(dur * 0.6, { freq: sub * 2.2, dropTo: sub, gain: 1, crack }));
    return b;
}

/** 钟表滴答序列 */
function clockTicks(b, start, count, spacing, freq = 2400) {
    for (let i = 0; i < count; i++) place(b, tick(0.035, { freq: freq * (1 + (i % 2) * 0.12), type: 'square', gain: 0.3 }), start + i * spacing);
}

/** 锁链扣环序列 */
function chainLinks(b, start, count, spacing, base = 3100) {
    for (let i = 0; i < count; i++) {
        place(b, tick(0.05, { freq: base * (0.8 + 0.4 * ((i * 37) % 5) / 5), type: 'square', gain: 0.34, ring: 0.25 }), start + i * spacing);
    }
}

/** 量子噪声脉冲：随机频率短促脉冲 */
function quantumBlips(b, start, count, spread) {
    const freqs = [1100, 1650, 2200, 2970, 3960];
    for (let i = 0; i < count; i++) {
        place(b, tick(0.03, { freq: freqs[(i * 29) % freqs.length], type: 'sine', gain: 0.3 }), start + i * spread * (0.6 + 0.4 * ((i * 13) % 3) / 3));
    }
}

/** 反向涌起：渐强上滑音（时间倒流感） */
function reverseSwell({ dur = 0.9, from = 220, to = 880, gain = 0.7 } = {}) {
    const n = Math.ceil(dur * SAMPLE_RATE);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const k = i / n;
        const f = from * Math.pow(to / from, k * k);
        phase += f / SAMPLE_RATE;
        const env = Math.pow(k, 1.6) * (k > 0.93 ? (1 - k) / 0.07 : 1);
        out[i] = Math.sin(2 * Math.PI * phase) * env * gain;
    }
    return out;
}

/* ============================================================
   技能音效配方（72 英雄技能 + 2 附属单位技能）
   ============================================================ */

const RECIPES = {
    /* ===== 墨阑：墨笔入锋 / 断墨重斩 ===== */
    moran_skill1: { build: () => {
        const b = buffer(0.9);
        // 毛笔入锋：柔和带通噪声缓起，如笔锋落纸
        place(b, noiseBurst(0.55, { from: 900, to: 320, type: 'bandpass', q: 1.1, attack: 0.09, release: 0.3, gain: 0.6 }));
        // 问道符文低鸣
        place(b, drone(0.6, { freqs: [147, 148.5], type: 'triangle', attack: 0.05, release: 0.25, gain: 0.35 }), 0.16);
        place(b, bell(0.5, { freq: 587, ratio: 1.29, modDepth: 1.6, gain: 0.3 }), 0.34);
        return b;
    } },
    moran_skill2: { build: () => {
        const b = buffer(0.75);
        // 墨色斩击：重笔横扫
        place(b, noiseBurst(0.45, { from: 2400, to: 210, type: 'bandpass', q: 1.3, attack: 0.006, release: 0.2, gain: 1 }));
        place(b, thump(0.4, { freq: 130, dropTo: 46, gain: 1, crack: 0.45 }), 0.1);
        // 断墨飞溅
        place(b, noiseBurst(0.3, { from: 4800, to: 900, type: 'bandpass', q: 2, attack: 0.002, release: 0.2, gain: 0.4 }), 0.16);
        return b;
    } },

    /* ===== 震霄：雷血开锋 / 金银错 ===== */
    zhenxiao_skill1: { build: () => {
        const b = buffer(0.65);
        // 雷光淬锋：电击锯齿下滑
        place(b, tone(0.3, { freq: 240, freqTo: 74, type: 'saw', attack: 0.003, decay: 0.1, sustain: 0.4, release: 0.12, gain: 0.6 }));
        place(b, noiseBurst(0.25, { from: 5200, to: 700, type: 'bandpass', q: 1.8, attack: 0.002, release: 0.12, gain: 0.75 }));
        place(b, thump(0.35, { freq: 150, dropTo: 52, gain: 0.9, crack: 0.4 }), 0.08);
        // 血气低涌
        place(b, drone(0.4, { freqs: [98, 103], type: 'sine', attack: 0.04, release: 0.2, gain: 0.3 }), 0.12);
        return b;
    } },
    zhenxiao_skill2: { build: () => {
        const b = buffer(1.0);
        // 金银锁链牢笼：金（高）银（低）交替扣环
        chainLinks(b, 0.02, 4, 0.13, 3400);
        chainLinks(b, 0.09, 3, 0.13, 2100);
        // 束缚环收拢
        place(b, tone(0.55, { freq: 620, freqTo: 236, type: 'sine', attack: 0.01, decay: 0.15, sustain: 0.5, release: 0.25, gain: 0.5 }), 0.42);
        place(b, bell(0.5, { freq: 880, ratio: 1.21, modDepth: 1.4, gain: 0.3 }), 0.5);
        return b;
    } },

    /* ===== 回锋：连刃斩 / 风过留痕 ===== */
    huifeng_skill1: { build: () => {
        const b = buffer(0.8);
        // 三段连环刀光，音高逐段抬升
        [0, 0.16, 0.32].forEach((t, i) => {
            place(b, noiseBurst(0.22, { from: 3000 + i * 500, to: 620, type: 'bandpass', q: 1.6, attack: 0.003, release: 0.1, gain: 0.7 }), t);
        });
        place(b, thump(0.3, { freq: 170, dropTo: 60, gain: 0.95, crack: 0.35 }), 0.4);
        // 刃鸣余音
        place(b, bell(0.45, { freq: 1175, ratio: 1.17, modDepth: 1.2, gain: 0.28 }), 0.44);
        return b;
    } },
    huifeng_skill2: { build: () => {
        const b = buffer(0.85);
        // 风过：嗖声掠过
        place(b, noiseBurst(0.5, { from: 1900, to: 340, type: 'bandpass', q: 1.0, attack: 0.02, release: 0.3, gain: 0.8 }));
        // 残影落地轻点
        place(b, tick(0.05, { freq: 1500, type: 'triangle', gain: 0.4 }), 0.3);
        // 刃痕驻留：低弦长吟
        place(b, pluck(0.6, { freq: 196, damping: 0.9985, gain: 0.6 }), 0.38);
        return b;
    } },

    /* ===== 孙悟空：毫毛化身 / 大圣合击 ===== */
    wukong_skill1: { build: () => {
        const b = buffer(0.95);
        // 毫毛轻吹
        place(b, noiseBurst(0.4, { from: 3200, to: 1100, type: 'bandpass', q: 1.2, attack: 0.03, release: 0.25, gain: 0.5 }));
        // 化身浮现：上扬滑音
        place(b, tone(0.4, { freq: 320, freqTo: 640, type: 'sine', attack: 0.02, decay: 0.12, sustain: 0.6, release: 0.2, gain: 0.6 }), 0.28);
        // 烟雾绽放
        place(b, noiseBurst(0.4, { from: 700, to: 200, type: 'lowpass', q: 0.8, attack: 0.05, release: 0.3, gain: 0.5 }), 0.55);
        place(b, bell(0.45, { freq: 1046, ratio: 1.35, modDepth: 1.8, gain: 0.3 }), 0.6);
        return b;
    } },
    wukong_skill2: { build: () => {
        const b = buffer(0.85);
        // 金箍棒抡落破空
        place(b, noiseBurst(0.35, { from: 2600, to: 280, type: 'bandpass', q: 1.0, attack: 0.008, release: 0.18, gain: 0.9 }));
        // 砸地重击
        place(b, thump(0.5, { freq: 120, dropTo: 34, gain: 1, crack: 0.6 }), 0.22);
        // 金属棒身余震
        place(b, bell(0.6, { freq: 523, ratio: 1.42, modDepth: 2.6, gain: 0.34 }), 0.26);
        return b;
    } },

    /* ===== 玄霄：玄光加持 / 惊鸿再舞 ===== */
    xuanxiao_skill1: { build: () => {
        const b = buffer(0.95);
        // 玄色星光灌注：上行泛音
        place(b, shimmer(0.9, { freqs: [440, 554, 659, 880], spacing: 0.09, gain: 1, release: 0.4, vibratoHz: 6, vibratoDepth: 0.005 }));
        place(b, tone(0.7, { freq: 220, type: 'sine', attack: 0.08, decay: 0.2, sustain: 0.35, release: 0.3, gain: 0.3 }));
        return b;
    } },
    xuanxiao_skill2: { build: () => {
        const b = buffer(0.95);
        // 惊鸿光影：竖琴式上行滑奏
        place(b, pluckArp([523, 587, 659, 784, 880], { spacing: 0.05, dur: 0.9, damping: 0.995, gain: 0.95 }));
        // 再舞气旋
        place(b, wind(0.5, { low: 600, high: 2400, lfoHz: 5, q: 2, attack: 0.05, release: 0.3, gain: 0.25 }), 0.2);
        return b;
    } },

    /* ===== 琉璃：映月承锋 / 禅悟 ===== */
    liuli_skill1: { build: () => {
        const b = buffer(0.95);
        // 琉璃月盾：清亮玻璃钟
        place(b, bell(0.85, { freq: 987, ratio: 1.31, modDepth: 1.9, gain: 0.75 }));
        place(b, bell(0.7, { freq: 1480, ratio: 1.27, modDepth: 1.5, gain: 0.4 }), 0.08);
        // 佛光低吟
        place(b, tone(0.7, { freq: 246, type: 'sine', attack: 0.1, decay: 0.2, sustain: 0.4, release: 0.3, gain: 0.3 }), 0.15);
        return b;
    } },
    liuli_skill2: { build: () => {
        const b = buffer(1.1);
        // 禅定金莲：庙钟式和声（纯五度双钟）
        place(b, bell(1.0, { freq: 392, ratio: 1.5, modDepth: 2.8, gain: 0.7 }));
        place(b, bell(0.9, { freq: 587, ratio: 1.45, modDepth: 2.2, gain: 0.45 }), 0.1);
        // 净光微尘
        place(b, shimmer(0.8, { freqs: [784, 988, 1175], spacing: 0.12, gain: 0.5, release: 0.4, vibratoHz: 4.5, vibratoDepth: 0.003 }), 0.25);
        return b;
    } },

    /* ===== 白泽：瑞泽 / 天禄归生 ===== */
    baize_skill1: { build: () => {
        const b = buffer(0.95);
        // 瑞兽甘霖：水滴三连 + 治愈微光
        [0.02, 0.16, 0.3].forEach((t, i) => {
            place(b, tone(0.12, { freq: 1320 - i * 140, freqTo: 880 - i * 100, type: 'sine', attack: 0.004, decay: 0.06, sustain: 0.3, release: 0.06, gain: 0.4 }), t);
        });
        place(b, shimmer(0.7, { freqs: [523, 659, 784], spacing: 0.1, gain: 0.8, release: 0.35, vibratoHz: 5, vibratoDepth: 0.004 }), 0.3);
        return b;
    } },
    baize_skill2: { build: () => {
        const b = buffer(1.15);
        // 天禄还魂：灵魂上扬
        place(b, tone(0.7, { freq: 220, freqTo: 660, type: 'sine', attack: 0.06, decay: 0.2, sustain: 0.6, release: 0.3, gain: 0.65 }));
        // 生灵复苏泛音
        place(b, shimmer(0.9, { freqs: [659, 784, 988, 1319], spacing: 0.1, gain: 0.9, release: 0.4, vibratoHz: 5.5, vibratoDepth: 0.004 }), 0.3);
        place(b, bell(0.6, { freq: 1046, ratio: 1.33, modDepth: 1.8, gain: 0.3 }), 0.5);
        return b;
    } },

    /* ===== 长离：暗夜燎原 / 星火贯日 ===== */
    changli_skill1: { build: () => {
        const b = buffer(1.0);
        // 星火漫天：错落短促火星
        [0, 0.09, 0.2, 0.33, 0.47].forEach((t, i) => {
            place(b, noiseBurst(0.14, { from: 3400 - i * 300, to: 800, type: 'bandpass', q: 2, attack: 0.004, release: 0.09, gain: 0.4 }), t);
        });
        // 暗夜火海低吼
        place(b, drone(0.8, { freqs: [82, 87], type: 'saw', attack: 0.12, release: 0.35, gain: 0.28 }), 0.1);
        place(b, noiseBurst(0.7, { from: 900, to: 240, type: 'lowpass', q: 0.9, attack: 0.15, release: 0.4, gain: 0.4 }), 0.15);
        return b;
    } },
    changli_skill2: { build: () => {
        const b = buffer(0.9);
        // 火鸟贯日：上行彗星嗖声
        place(b, noiseBurst(0.5, { from: 700, to: 4200, type: 'bandpass', q: 1.6, attack: 0.03, release: 0.15, gain: 0.85 }));
        place(b, tone(0.45, { freq: 330, freqTo: 990, type: 'sine', attack: 0.03, decay: 0.1, sustain: 0.5, release: 0.15, gain: 0.5 }));
        // 贯日爆闪
        place(b, thump(0.35, { freq: 180, dropTo: 55, gain: 0.95, crack: 0.5 }), 0.45);
        place(b, bell(0.5, { freq: 1319, ratio: 1.36, modDepth: 2.0, gain: 0.35 }), 0.47);
        return b;
    } },

    /* ===== 镜：破镜分光 / 移形换影 ===== */
    mirror_skill1: { build: () => {
        const b = buffer(0.85);
        // 镜面分裂：玻璃碎响错拍迸溅
        [0, 0.06, 0.15, 0.27].forEach((t, i) => {
            place(b, noiseBurst(0.1, { from: 7200 - i * 900, to: 2400, type: 'bandpass', q: 3, attack: 0.002, release: 0.07, gain: 0.5 }), t);
        });
        // 碎光余韵
        place(b, bell(0.7, { freq: 2093, ratio: 1.29, modDepth: 1.7, gain: 0.4 }), 0.05);
        place(b, bell(0.6, { freq: 1568, ratio: 1.33, modDepth: 1.9, gain: 0.3 }), 0.2);
        return b;
    } },
    mirror_skill2: { build: () => {
        const b = buffer(0.85);
        // 镜影穿梭：反向涌起（空间折叠）
        place(b, reverseSwell({ dur: 0.5, from: 260, to: 1040, gain: 0.6 }));
        place(b, noiseBurst(0.3, { from: 1200, to: 3800, type: 'bandpass', q: 1.4, attack: 0.02, release: 0.18, gain: 0.5 }), 0.1);
        // 换位定音
        place(b, tick(0.05, { freq: 2600, type: 'square', gain: 0.35 }), 0.5);
        place(b, bell(0.45, { freq: 1760, ratio: 1.3, modDepth: 1.6, gain: 0.4 }), 0.52);
        return b;
    } },

    /* ===== 夜枭：死契之瞳 / 暗影突袭 ===== */
    nightowl_skill1: { build: () => {
        const b = buffer(1.0);
        // 暗夜瞳孔睁开：气息嘶声
        place(b, noiseBurst(0.4, { from: 2400, to: 900, type: 'highpass', q: 0.8, attack: 0.06, release: 0.25, gain: 0.35 }));
        // 死契低鸣
        place(b, drone(0.8, { freqs: [98, 104], type: 'triangle', attack: 0.1, release: 0.3, gain: 0.55, tremoloHz: 3.2 }), 0.1);
        // 心跳契约
        place(b, thump(0.22, { freq: 88, dropTo: 40, gain: 0.8, crack: 0.1 }), 0.35);
        place(b, thump(0.22, { freq: 82, dropTo: 38, gain: 0.7, crack: 0.1 }), 0.62);
        return b;
    } },
    nightowl_skill2: { build: () => {
        const b = buffer(0.65);
        // 影中突袭：低暗嗖声
        place(b, noiseBurst(0.35, { from: 1400, to: 260, type: 'bandpass', q: 1.1, attack: 0.004, release: 0.16, gain: 0.85 }));
        // 血色一闪
        place(b, thump(0.3, { freq: 200, dropTo: 70, gain: 0.95, crack: 0.4 }), 0.14);
        place(b, tone(0.18, { freq: 1180, freqTo: 420, type: 'saw', attack: 0.002, decay: 0.08, sustain: 0.3, release: 0.08, gain: 0.3 }), 0.15);
        return b;
    } },

    /* ===== 莫问：时光回溯 / 逆时斩 ===== */
    mowen_skill1: { build: () => {
        const b = buffer(1.0);
        // 时钟倒转：反向涌起 + 滴答
        place(b, reverseSwell({ dur: 0.75, from: 200, to: 800, gain: 0.6 }));
        clockTicks(b, 0.1, 4, 0.16, 2200);
        // 回溯落定
        place(b, bell(0.5, { freq: 784, ratio: 1.44, modDepth: 2.0, gain: 0.4 }), 0.68);
        return b;
    } },
    mowen_skill2: { build: () => {
        const b = buffer(0.85);
        // 逆流剑光
        place(b, swordSlash({ dur: 0.6, from: 3200, to: 420, q: 1.5, hit: 160, ringFreq: 988, ringGain: 0.3 }));
        // 燃命低鸣垫底
        place(b, drone(0.6, { freqs: [87, 92], type: 'sine', attack: 0.05, release: 0.25, gain: 0.35 }), 0.05);
        // 时之裂隙滴答
        place(b, tick(0.04, { freq: 2800, type: 'square', gain: 0.25 }), 0.3);
        return b;
    } },

    /* ===== 孤影：踏雪留影 / 寒星碎 ===== */
    guying_skill1: { build: () => {
        const b = buffer(0.75);
        // 雪地突进：踏雪脆响 + 冲刺嗖声
        place(b, noiseBurst(0.16, { from: 4200, to: 1500, type: 'bandpass', q: 1.8, attack: 0.002, release: 0.1, gain: 0.55 }));
        place(b, noiseBurst(0.4, { from: 2100, to: 480, type: 'bandpass', q: 1.0, attack: 0.01, release: 0.2, gain: 0.8 }), 0.06);
        place(b, thump(0.28, { freq: 140, dropTo: 55, gain: 0.8, crack: 0.25 }), 0.18);
        // 剑影驻留微光
        place(b, bell(0.4, { freq: 1568, ratio: 1.31, modDepth: 1.5, gain: 0.22 }), 0.3);
        return b;
    } },
    guying_skill2: { build: () => {
        const b = buffer(0.8);
        // 寒星碎裂：冰晶爆散
        place(b, iceCrack({ dur: 0.75, base: 1980 }));
        place(b, thump(0.3, { freq: 130, dropTo: 48, gain: 0.7, crack: 0.3 }), 0.06);
        return b;
    } },

    /* ===== 寒江雪：霜华覆地 / 冰晶壁垒 ===== */
    hanjiangxue_skill1: { build: () => {
        const b = buffer(1.0);
        // 霜华铺地：结晶微响由近及远
        [0, 0.12, 0.26, 0.42, 0.6].forEach((t, i) => {
            place(b, tick(0.045, { freq: 3600 - i * 420, type: 'sine', gain: 0.3 }), t);
        });
        place(b, shimmer(0.8, { freqs: [1046, 1319, 1568], spacing: 0.14, gain: 0.6, release: 0.4, vibratoHz: 4, vibratoDepth: 0.003 }), 0.15);
        place(b, wind(0.6, { low: 400, high: 1400, lfoHz: 1.6, q: 1.2, attack: 0.1, release: 0.35, gain: 0.2 }), 0.1);
        return b;
    } },
    hanjiangxue_skill2: { build: () => {
        const b = buffer(0.95);
        // 冰晶生长：上行玻璃滑音
        place(b, tone(0.55, { freq: 420, freqTo: 1260, type: 'sine', attack: 0.05, decay: 0.15, sustain: 0.5, release: 0.25, gain: 0.5 }));
        place(b, bell(0.7, { freq: 1760, ratio: 1.37, modDepth: 2.0, gain: 0.5 }), 0.25);
        // 寒雾底噪
        place(b, wind(0.7, { low: 300, high: 1000, lfoHz: 1.2, q: 1.0, attack: 0.12, release: 0.35, gain: 0.25 }), 0.05);
        return b;
    } },

    /* ===== 骸骨君王：亡骨斩 / 亡灵唤回 ===== */
    skeletonking_skill1: { build: () => {
        const b = buffer(0.85);
        // 白骨咔哒作响
        [0, 0.07, 0.13].forEach((t, i) => place(b, tick(0.04, { freq: 900 + i * 240, type: 'square', gain: 0.3 }), t));
        // 巨刃重斩
        place(b, noiseBurst(0.4, { from: 2200, to: 260, type: 'bandpass', q: 1.2, attack: 0.006, release: 0.2, gain: 0.9 }), 0.14);
        place(b, thump(0.45, { freq: 110, dropTo: 36, gain: 1, crack: 0.5 }), 0.24);
        // 亡魂反噬低鸣
        place(b, drone(0.5, { freqs: [73, 78], type: 'triangle', attack: 0.06, release: 0.25, gain: 0.35 }), 0.3);
        return b;
    } },
    skeletonking_skill2: { build: () => {
        const b = buffer(1.2);
        // 骨座敕令：低频号令
        place(b, tone(0.5, { freq: 147, freqTo: 98, type: 'saw', attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.25, gain: 0.4 }));
        // 亡魂归位：幽灵挽歌
        place(b, ghostDrone({ dur: 1.0, freqs: [92, 97], chime: 392 }), 0.15);
        place(b, tone(0.6, { freq: 196, freqTo: 392, type: 'sine', attack: 0.08, decay: 0.2, sustain: 0.5, release: 0.3, gain: 0.4 }), 0.45);
        return b;
    } },

    /* ===== 杰茨米：终焉斩 / 亡灵汲取 ===== */
    jetzmi_skill1: { build: () => {
        const b = buffer(0.85);
        // 王座终焉：暗黑皇斩
        place(b, noiseBurst(0.42, { from: 1900, to: 220, type: 'bandpass', q: 1.1, attack: 0.008, release: 0.22, gain: 0.95 }));
        place(b, thump(0.5, { freq: 96, dropTo: 32, gain: 1, crack: 0.55 }), 0.18);
        // 王冠钟鸣（小调暗色）
        place(b, bell(0.6, { freq: 622, ratio: 1.48, modDepth: 2.4, gain: 0.4 }), 0.22);
        return b;
    } },
    jetzmi_skill2: { build: () => {
        const b = buffer(1.1);
        // 魂力汲取：下行吸纳滑音
        place(b, tone(0.7, { freq: 620, freqTo: 140, type: 'sine', attack: 0.03, decay: 0.25, sustain: 0.55, release: 0.3, gain: 0.6 }));
        place(b, drone(0.8, { freqs: [85, 90], type: 'triangle', attack: 0.1, release: 0.3, gain: 0.4, tremoloHz: 5 }), 0.1);
        // 幽冥王冠浮现
        place(b, bell(0.6, { freq: 740, ratio: 1.46, modDepth: 2.2, gain: 0.35 }), 0.55);
        place(b, shimmer(0.5, { freqs: [880, 1046], spacing: 0.1, gain: 0.4, release: 0.3, vibratoHz: 5, vibratoDepth: 0.004 }), 0.65);
        return b;
    } },

    /* ===== 五弦琵琶：五弦流转 / 裂帛和弦 ===== */
    pipa_skill1: { build: () => {
        const b = buffer(1.0);
        // 五弦清商：宫商角徵羽五声琶音
        place(b, pluckArp([523, 587, 659, 784, 880], { spacing: 0.08, dur: 1.0, damping: 0.996, gain: 1 }));
        return b;
    } },
    pipa_skill2: { build: () => {
        const b = buffer(0.9);
        // 和弦齐发：五弦同震
        [523, 587, 659, 784, 880].forEach((f, i) => place(b, pluck(0.7, { freq: f, damping: 0.993, gain: 0.32 }), 0.02 + i * 0.012));
        // 裂帛高音
        place(b, noiseBurst(0.25, { from: 5600, to: 1800, type: 'highpass', q: 1.4, attack: 0.002, release: 0.15, gain: 0.5 }), 0.08);
        // 琴腔共鸣
        place(b, thump(0.4, { freq: 160, dropTo: 70, gain: 0.6, crack: 0.1 }), 0.06);
        return b;
    } },

    /* ===== 赏金猎人：猎杀令 / 衔令追猎 ===== */
    bounty_skill1: { build: () => {
        const b = buffer(0.85);
        // 悬赏令盖章
        place(b, thump(0.25, { freq: 190, dropTo: 80, gain: 0.85, crack: 0.25 }));
        // 准星锁定滴答
        place(b, tick(0.04, { freq: 2200, type: 'square', gain: 0.32 }), 0.24);
        place(b, tick(0.04, { freq: 2700, type: 'square', gain: 0.34 }), 0.4);
        // 金币定金
        place(b, bell(0.5, { freq: 1568, ratio: 1.42, modDepth: 2.1, gain: 0.45 }), 0.5);
        return b;
    } },
    bounty_skill2: { build: () => {
        const b = buffer(0.8);
        // 猎枪轰鸣
        place(b, noiseBurst(0.3, { from: 3800, to: 220, type: 'lowpass', q: 0.9, attack: 0.002, release: 0.2, gain: 1 }));
        place(b, thump(0.35, { freq: 130, dropTo: 44, gain: 0.9, crack: 0.3 }), 0.02);
        // 追击嗖声
        place(b, noiseBurst(0.3, { from: 2600, to: 600, type: 'bandpass', q: 1.4, attack: 0.01, release: 0.15, gain: 0.5 }), 0.18);
        // 赏金落袋
        place(b, bell(0.45, { freq: 1976, ratio: 1.41, modDepth: 2.0, gain: 0.4 }), 0.42);
        return b;
    } },

    /* ===== 阴阳师：纯阳一线 / 玄阴一线 ===== */
    yinyang_skill1: { build: () => {
        const b = buffer(0.95);
        // 金色阳线：温暖上行连线
        place(b, tone(0.6, { freq: 392, freqTo: 784, type: 'sine', attack: 0.04, decay: 0.15, sustain: 0.6, release: 0.25, gain: 0.6 }));
        place(b, shimmer(0.7, { freqs: [784, 988], spacing: 0.12, gain: 0.7, release: 0.35, vibratoHz: 5, vibratoDepth: 0.004 }), 0.25);
        // 太极运转轻铃
        place(b, bell(0.5, { freq: 1046, ratio: 1.33, modDepth: 1.7, gain: 0.3 }), 0.4);
        return b;
    } },
    yinyang_skill2: { build: () => {
        const b = buffer(1.0);
        // 玄黑阴线：沉降连线
        place(b, tone(0.65, { freq: 392, freqTo: 138, type: 'sine', attack: 0.04, decay: 0.2, sustain: 0.6, release: 0.3, gain: 0.6 }));
        // 蚀魂失谐
        place(b, drone(0.75, { freqs: [104, 110, 117], type: 'triangle', attack: 0.08, release: 0.3, gain: 0.4, tremoloHz: 3.6 }), 0.12);
        place(b, noiseBurst(0.5, { from: 900, to: 180, type: 'bandpass', q: 0.9, attack: 0.1, release: 0.3, gain: 0.25 }), 0.2);
        return b;
    } },

    /* ===== 缚魂灯：暗夜法阵 / 缚魂轮转 ===== */
    soul_lamp_skill1: { build: () => {
        const b = buffer(1.15);
        // 法阵展开：幽紫低鸣 + 魂灯铃
        place(b, ghostDrone({ dur: 1.0, freqs: [98, 103.5], chime: 659 }));
        place(b, noiseBurst(0.6, { from: 1600, to: 320, type: 'bandpass', q: 1.1, attack: 0.15, release: 0.4, gain: 0.3 }), 0.2);
        place(b, bell(0.6, { freq: 880, ratio: 1.49, modDepth: 2.3, gain: 0.3 }), 0.6);
        return b;
    } },
    soul_lamp_skill2: { build: () => {
        const b = buffer(1.05);
        // 生死轮转：震颤旋转低鸣（左右声道感用颤音模拟）
        place(b, drone(0.9, { freqs: [110, 113], type: 'triangle', attack: 0.06, release: 0.3, gain: 0.55, tremoloHz: 6.5 }));
        // 魂灯引渡钟
        place(b, bell(0.7, { freq: 587, ratio: 1.47, modDepth: 2.2, gain: 0.45 }), 0.2);
        place(b, bell(0.5, { freq: 440, ratio: 1.5, modDepth: 2.4, gain: 0.35 }), 0.55);
        return b;
    } },

    /* ===== 英雄X：天神震怒 / 增势跃迁 ===== */
    hero_x_skill1: { build: () => {
        const b = buffer(1.0);
        // 天雷震怒：滚雷 + 炸响
        place(b, noiseBurst(0.8, { from: 1800, to: 70, type: 'lowpass', q: 0.7, attack: 0.01, release: 0.5, gain: 0.9 }));
        place(b, thump(0.5, { freq: 100, dropTo: 30, gain: 1, crack: 0.7 }), 0.08);
        place(b, noiseBurst(0.2, { from: 6000, to: 1200, type: 'bandpass', q: 1.6, attack: 0.002, release: 0.12, gain: 0.6 }), 0.05);
        // 怒意余震
        place(b, drone(0.5, { freqs: [65, 70], type: 'sine', attack: 0.05, release: 0.3, gain: 0.5 }), 0.3);
        return b;
    } },
    hero_x_skill2: { build: () => {
        const b = buffer(0.9);
        // 跃迁破空
        place(b, noiseBurst(0.35, { from: 900, to: 2600, type: 'bandpass', q: 1.2, attack: 0.02, release: 0.18, gain: 0.7 }));
        // 落地冲击
        place(b, thump(0.45, { freq: 140, dropTo: 40, gain: 1, crack: 0.5 }), 0.28);
        // 护盾光环
        place(b, bell(0.6, { freq: 523, ratio: 1.35, modDepth: 1.8, gain: 0.4 }), 0.34);
        place(b, shimmer(0.5, { freqs: [659, 784], spacing: 0.1, gain: 0.5, release: 0.3, vibratoHz: 5, vibratoDepth: 0.003 }), 0.42);
        return b;
    } },

    /* ===== 吟游诗人：奏鸣曲 / 协奏曲 ===== */
    bard_skill1: { build: () => {
        const b = buffer(1.05);
        // 竖琴乐章：C 大调分解和弦
        place(b, pluckArp([392, 494, 587, 784], { spacing: 0.11, dur: 1.05, damping: 0.9965, gain: 0.95 }));
        // 暖光垫底
        place(b, tone(0.8, { freq: 196, type: 'sine', attack: 0.1, decay: 0.25, sustain: 0.35, release: 0.3, gain: 0.3 }), 0.1);
        return b;
    } },
    bard_skill2: { build: () => {
        const b = buffer(1.15);
        // 合唱洪流：带颤音的和声涌起
        [392, 494, 587].forEach((f, i) => {
            place(b, tone(0.9, { freq: f, type: 'sine', attack: 0.15 + i * 0.06, decay: 0.2, sustain: 0.55, release: 0.4, vibratoHz: 5.5, vibratoDepth: 0.006, gain: 0.35 }), 0.05 + i * 0.05);
        });
        // 治愈之歌上扬
        place(b, tone(0.7, { freq: 587, freqTo: 880, type: 'sine', attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.35, gain: 0.4 }), 0.35);
        place(b, shimmer(0.6, { freqs: [1175, 1568], spacing: 0.12, gain: 0.4, release: 0.35, vibratoHz: 5, vibratoDepth: 0.003 }), 0.5);
        return b;
    } },

    /* ===== 凋零之主：凋零播撒 / 凋零引爆 ===== */
    wither_lord_skill1: { build: () => {
        const b = buffer(1.0);
        // 败落花雨：枯萎碎响纷纷
        [0, 0.11, 0.24, 0.39, 0.56].forEach((t, i) => {
            place(b, noiseBurst(0.12, { from: 1800 - i * 200, to: 400, type: 'bandpass', q: 1.6, attack: 0.008, release: 0.09, gain: 0.32 }), t);
        });
        // 枯萎低鸣
        place(b, drone(0.85, { freqs: [78, 83], type: 'triangle', attack: 0.15, release: 0.35, gain: 0.5, tremoloHz: 2.4 }), 0.08);
        return b;
    } },
    wither_lord_skill2: { build: () => {
        const b = buffer(1.0);
        // 腐爆
        place(b, boomExplosion({ dur: 0.75, sub: 58, crack: 0.5 }));
        // 命火熄灭：黯淡下滑
        place(b, tone(0.6, { freq: 440, freqTo: 96, type: 'sine', attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.3, gain: 0.5 }), 0.2);
        place(b, drone(0.5, { freqs: [62, 66], type: 'triangle', attack: 0.05, release: 0.25, gain: 0.4 }), 0.4);
        return b;
    } },

    /* ===== T型帛画：金乌 / 玄龟 ===== */
    t_painting_skill1: { build: () => {
        const b = buffer(1.0);
        // 帛画展卷
        place(b, noiseBurst(0.45, { from: 1200, to: 380, type: 'bandpass', q: 0.9, attack: 0.05, release: 0.3, gain: 0.5 }));
        // 太阳神鸟：明亮上行 + 焰鸣
        place(b, tone(0.5, { freq: 523, freqTo: 1046, type: 'sine', attack: 0.03, decay: 0.15, sustain: 0.55, release: 0.25, gain: 0.55 }), 0.3);
        place(b, noiseBurst(0.4, { from: 2800, to: 900, type: 'bandpass', q: 1.3, attack: 0.05, release: 0.25, gain: 0.35 }), 0.35);
        place(b, bell(0.5, { freq: 1568, ratio: 1.34, modDepth: 1.8, gain: 0.35 }), 0.5);
        return b;
    } },
    t_painting_skill2: { build: () => {
        const b = buffer(1.0);
        // 帛画展卷
        place(b, noiseBurst(0.45, { from: 1100, to: 350, type: 'bandpass', q: 0.9, attack: 0.05, release: 0.3, gain: 0.5 }));
        // 玄武灵龟：厚重鼓音
        place(b, thump(0.5, { freq: 90, dropTo: 34, gain: 0.95, crack: 0.3 }), 0.35);
        place(b, tick(0.05, { freq: 700, type: 'square', gain: 0.3 }), 0.42);
        place(b, tick(0.05, { freq: 560, type: 'square', gain: 0.26 }), 0.56);
        place(b, drone(0.5, { freqs: [65, 69], type: 'sine', attack: 0.08, release: 0.25, gain: 0.4 }), 0.4);
        return b;
    } },
    jinwu_skill: { build: () => {
        const b = buffer(0.85);
        // 烈日耀斑：火浪 + 明亮钟簇
        place(b, noiseBurst(0.5, { from: 3200, to: 500, type: 'bandpass', q: 1.0, attack: 0.01, release: 0.3, gain: 0.8 }));
        place(b, chimeArp([1319, 1568, 1760], { spacing: 0.06, dur: 0.75, gain: 0.75 }), 0.1);
        place(b, thump(0.35, { freq: 150, dropTo: 55, gain: 0.6, crack: 0.2 }), 0.08);
        return b;
    } },
    xuangui_skill: { build: () => {
        const b = buffer(0.75);
        // 龟甲震地
        place(b, thump(0.55, { freq: 85, dropTo: 30, gain: 1, crack: 0.5 }));
        place(b, tick(0.06, { freq: 620, type: 'square', gain: 0.35 }), 0.1);
        place(b, noiseBurst(0.35, { from: 700, to: 150, type: 'lowpass', q: 0.8, attack: 0.01, release: 0.25, gain: 0.6 }), 0.05);
        return b;
    } },

    /* ===== 费曼：粒子束 / 粒子轰爆 ===== */
    feynman_skill1: { build: () => {
        const b = buffer(0.75);
        // 加速器光束：锯齿下滑 + 火花脉冲
        place(b, tone(0.5, { freq: 880, freqTo: 210, type: 'saw', attack: 0.006, decay: 0.15, sustain: 0.45, release: 0.2, gain: 0.55 }));
        quantumBlips(b, 0.08, 4, 0.12);
        place(b, noiseBurst(0.3, { from: 4600, to: 1300, type: 'bandpass', q: 2, attack: 0.004, release: 0.18, gain: 0.5 }), 0.12);
        return b;
    } },
    feynman_skill2: { build: () => {
        const b = buffer(0.95);
        // 粒子对撞：内爆 + 高亮粒子簇
        place(b, noiseBurst(0.4, { from: 500, to: 3400, type: 'bandpass', q: 1.4, attack: 0.02, release: 0.2, gain: 0.7 }));
        place(b, boomExplosion({ dur: 0.7, sub: 75, crack: 0.45 }), 0.28);
        quantumBlips(b, 0.3, 6, 0.08);
        place(b, bell(0.5, { freq: 1760, ratio: 1.39, modDepth: 2.0, gain: 0.35 }), 0.32);
        return b;
    } },

    /* ===== 旺财：聚财一击 / 来财 ===== */
    wangcai_skill1: { build: () => {
        const b = buffer(0.75);
        // 铜钱开道
        place(b, bell(0.4, { freq: 1976, ratio: 1.42, modDepth: 2.1, gain: 0.5 }));
        place(b, bell(0.35, { freq: 2350, ratio: 1.4, modDepth: 1.9, gain: 0.4 }), 0.09);
        // 聚财重击
        place(b, thump(0.4, { freq: 150, dropTo: 52, gain: 0.95, crack: 0.4 }), 0.14);
        // 金光迸发
        place(b, shimmer(0.45, { freqs: [1568, 1976], spacing: 0.07, gain: 0.45, release: 0.25, vibratoHz: 6, vibratoDepth: 0.004 }), 0.3);
        return b;
    } },
    wangcai_skill2: { build: () => {
        const b = buffer(0.95);
        // 招财进宝：金元宝钟铃上行
        place(b, chimeArp([659, 784, 988, 1319], { spacing: 0.1, dur: 0.95, gain: 0.9 }));
        place(b, shimmer(0.6, { freqs: [1568, 2093], spacing: 0.1, gain: 0.4, release: 0.3, vibratoHz: 6, vibratoDepth: 0.003 }), 0.4);
        return b;
    } },

    /* ===== 薛定谔：生死叠加 / 量子纠缠 ===== */
    schrodinger_skill1: { build: () => {
        const b = buffer(0.95);
        // 叠加态：深颤音游移
        place(b, tone(0.7, { freq: 440, type: 'sine', attack: 0.05, decay: 0.2, sustain: 0.55, release: 0.25, vibratoHz: 9, vibratoDepth: 0.06, gain: 0.55 }));
        quantumBlips(b, 0.05, 5, 0.14);
        // 观测坍缩定音
        place(b, thump(0.3, { freq: 220, dropTo: 80, gain: 0.7, crack: 0.2 }), 0.6);
        place(b, bell(0.4, { freq: 1175, ratio: 1.37, modDepth: 1.8, gain: 0.35 }), 0.62);
        return b;
    } },
    schrodinger_skill2: { build: () => {
        const b = buffer(1.0);
        // 纠缠双声：一升一降互为镜像
        place(b, tone(0.75, { freq: 330, freqTo: 660, type: 'sine', attack: 0.05, decay: 0.2, sustain: 0.55, release: 0.3, vibratoHz: 7, vibratoDepth: 0.02, gain: 0.45 }));
        place(b, tone(0.75, { freq: 660, freqTo: 330, type: 'sine', attack: 0.05, decay: 0.2, sustain: 0.55, release: 0.3, vibratoHz: 7, vibratoDepth: 0.02, gain: 0.45 }));
        quantumBlips(b, 0.2, 4, 0.16);
        // 锁链扣合
        place(b, tick(0.05, { freq: 2400, type: 'square', gain: 0.3 }), 0.68);
        return b;
    } },

    /* ===== 莉莉丝：恐惧之箭 / 恐惧蔓延 ===== */
    lilith_skill1: { build: () => {
        const b = buffer(0.9);
        // 黑羽魔箭离弦
        place(b, noiseBurst(0.3, { from: 3400, to: 700, type: 'bandpass', q: 1.7, attack: 0.003, release: 0.15, gain: 0.8 }));
        // 恐惧之眼心跳
        place(b, thump(0.22, { freq: 80, dropTo: 38, gain: 0.85, crack: 0.1 }), 0.3);
        place(b, thump(0.22, { freq: 74, dropTo: 36, gain: 0.75, crack: 0.1 }), 0.56);
        place(b, drone(0.6, { freqs: [92, 99], type: 'triangle', attack: 0.08, release: 0.3, gain: 0.35, tremoloHz: 3 }), 0.25);
        return b;
    } },
    lilith_skill2: { build: () => {
        const b = buffer(1.1);
        // 噩梦藤蔓蔓延：爬行低鸣渐起
        place(b, drone(0.95, { freqs: [73, 77.5, 82], type: 'triangle', attack: 0.2, release: 0.35, gain: 0.5, tremoloHz: 2.6 }));
        place(b, noiseBurst(0.8, { from: 600, to: 150, type: 'bandpass', q: 0.8, attack: 0.25, release: 0.4, gain: 0.3 }));
        // 恐惧心跳加速
        place(b, thump(0.2, { freq: 76, dropTo: 36, gain: 0.7, crack: 0.08 }), 0.5);
        place(b, thump(0.2, { freq: 72, dropTo: 34, gain: 0.75, crack: 0.08 }), 0.72);
        place(b, thump(0.2, { freq: 70, dropTo: 33, gain: 0.8, crack: 0.08 }), 0.9);
        return b;
    } },

    /* ===== 李太白：青莲醉剑 / 谪仙醉斩 ===== */
    libai_skill1: { build: () => {
        const b = buffer(0.75);
        // 醉剑：摇摆滑音 + 剑光嗖声
        place(b, tone(0.35, { freq: 520, freqTo: 340, type: 'sine', attack: 0.01, decay: 0.12, sustain: 0.4, release: 0.15, vibratoHz: 7, vibratoDepth: 0.05, gain: 0.5 }));
        place(b, noiseBurst(0.32, { from: 3800, to: 800, type: 'bandpass', q: 1.6, attack: 0.003, release: 0.16, gain: 0.85 }), 0.08);
        place(b, bell(0.4, { freq: 1046, ratio: 1.29, modDepth: 1.5, gain: 0.3 }), 0.18);
        return b;
    } },
    libai_skill2: { build: () => {
        const b = buffer(0.95);
        // 酒气剑浪：三连豪斩
        [0, 0.14, 0.3].forEach((t, i) => {
            place(b, noiseBurst(0.26, { from: 3300 - i * 400, to: 480, type: 'bandpass', q: 1.3, attack: 0.004, release: 0.13, gain: 0.8 }), t);
        });
        place(b, thump(0.45, { freq: 120, dropTo: 40, gain: 1, crack: 0.45 }), 0.42);
        // 酒洒微溅
        place(b, noiseBurst(0.25, { from: 1900, to: 600, type: 'bandpass', q: 1.0, attack: 0.02, release: 0.18, gain: 0.3 }), 0.5);
        place(b, bell(0.5, { freq: 784, ratio: 1.31, modDepth: 1.6, gain: 0.3 }), 0.48);
        return b;
    } },

    /* ===== 醉枕刀：醉掷寒锋 / 醉影换位 ===== */
    zuizhendao_skill1: { build: () => {
        const b = buffer(0.85);
        // 飞刀掷出：快嗖声
        place(b, noiseBurst(0.4, { from: 3000, to: 550, type: 'bandpass', q: 1.5, attack: 0.004, release: 0.2, gain: 0.9 }));
        // 醉步摇晃滑音
        place(b, tone(0.5, { freq: 420, type: 'sine', attack: 0.02, decay: 0.15, sustain: 0.4, release: 0.2, vibratoHz: 5.5, vibratoDepth: 0.07, gain: 0.4 }), 0.12);
        // 接刀扣响
        place(b, tick(0.05, { freq: 1900, type: 'square', gain: 0.38 }), 0.58);
        place(b, bell(0.35, { freq: 1319, ratio: 1.27, modDepth: 1.4, gain: 0.28 }), 0.6);
        return b;
    } },
    zuizhendao_skill2: { build: () => {
        const b = buffer(0.9);
        // 醉影交错：双段错位嗖声
        place(b, noiseBurst(0.3, { from: 2400, to: 500, type: 'bandpass', q: 1.2, attack: 0.006, release: 0.16, gain: 0.7 }));
        place(b, noiseBurst(0.3, { from: 1900, to: 420, type: 'bandpass', q: 1.2, attack: 0.006, release: 0.16, gain: 0.7 }), 0.18);
        // 环形刀光
        place(b, bell(0.5, { freq: 988, ratio: 1.33, modDepth: 1.7, gain: 0.35 }), 0.34);
        place(b, thump(0.35, { freq: 130, dropTo: 50, gain: 0.8, crack: 0.3 }), 0.38);
        return b;
    } },

    /* ===== 绯雪：霜刃破阵 / 踏雪追命 ===== */
    feixue_skill1: { build: () => {
        const b = buffer(0.75);
        // 绯红霜刃斩击
        place(b, swordSlash({ dur: 0.6, from: 3600, to: 500, q: 1.5, hit: 150, ringFreq: 1760, ringGain: 0.3 }));
        // 破冰爆散
        place(b, iceCrack({ dur: 0.55, base: 1600 }), 0.2);
        return b;
    } },
    feixue_skill2: { build: () => {
        const b = buffer(0.8);
        // 雪上追猎：踏雪低嗖
        place(b, noiseBurst(0.4, { from: 1500, to: 320, type: 'bandpass', q: 1.1, attack: 0.006, release: 0.2, gain: 0.9 }));
        place(b, thump(0.35, { freq: 140, dropTo: 48, gain: 0.95, crack: 0.4 }), 0.16);
        // 霜噬冰环
        place(b, bell(0.5, { freq: 1980, ratio: 1.35, modDepth: 1.9, gain: 0.35 }), 0.24);
        place(b, noiseBurst(0.3, { from: 5200, to: 1600, type: 'bandpass', q: 2.2, attack: 0.004, release: 0.2, gain: 0.3 }), 0.28);
        return b;
    } },

    /* ===== 风铃：流沙追猎 / 沙丘猎场 ===== */
    fengling_skill1: { build: () => {
        const b = buffer(0.95);
        // 流沙锁链：沙粒簌簌 + 束缚扣环
        place(b, noiseBurst(0.6, { from: 1600, to: 500, type: 'bandpass', q: 1.3, attack: 0.04, release: 0.35, gain: 0.55 }));
        chainLinks(b, 0.12, 3, 0.15, 2600);
        // 铃响追猎：风铃式高铃
        place(b, bell(0.55, { freq: 2093, ratio: 1.41, modDepth: 2.0, gain: 0.5 }), 0.5);
        place(b, bell(0.4, { freq: 2637, ratio: 1.38, modDepth: 1.8, gain: 0.35 }), 0.62);
        return b;
    } },
    fengling_skill2: { build: () => {
        const b = buffer(1.1);
        // 大漠沙丘：辽阔风沙领域
        place(b, wind(1.0, { low: 250, high: 1300, lfoHz: 1.4, q: 0.9, attack: 0.15, release: 0.4, gain: 0.7 }));
        // 沙粒拍打
        [0.2, 0.36, 0.55, 0.74].forEach((t, i) => {
            place(b, noiseBurst(0.1, { from: 2800 - i * 300, to: 900, type: 'bandpass', q: 2, attack: 0.004, release: 0.07, gain: 0.3 }), t);
        });
        place(b, drone(0.8, { freqs: [98, 100], type: 'sine', attack: 0.2, release: 0.35, gain: 0.3 }), 0.15);
        return b;
    } },

    /* ===== 帝兰：顺逆长风 / 风压横扫 ===== */
    dilan_skill1: { build: () => {
        const b = buffer(0.95);
        // 长风轴线：贯穿长风
        place(b, wind(0.85, { low: 350, high: 2200, lfoHz: 3.4, q: 1.4, attack: 0.05, release: 0.35, gain: 0.85 }));
        // 羽翼轻拂
        place(b, noiseBurst(0.3, { from: 4800, to: 1800, type: 'highpass', q: 1.0, attack: 0.04, release: 0.2, gain: 0.3 }), 0.3);
        place(b, bell(0.45, { freq: 1568, ratio: 1.32, modDepth: 1.6, gain: 0.28 }), 0.45);
        return b;
    } },
    dilan_skill2: { build: () => {
        const b = buffer(0.9);
        // 风压冲击：强风起势
        place(b, wind(0.6, { low: 400, high: 2600, lfoHz: 6, q: 1.8, attack: 0.03, release: 0.3, gain: 0.9 }));
        place(b, thump(0.35, { freq: 120, dropTo: 45, gain: 0.8, crack: 0.35 }), 0.2);
        // 羽化爆散
        [0.3, 0.38, 0.47].forEach((t, i) => {
            place(b, noiseBurst(0.12, { from: 5200 - i * 700, to: 1500, type: 'bandpass', q: 2, attack: 0.003, release: 0.09, gain: 0.35 }), t);
        });
        return b;
    } },

    /* ===== 南风：扶摇 / 引风成道 ===== */
    nanfeng_skill1: { build: () => {
        const b = buffer(1.0);
        // 扶摇旋风：中心频率盘旋上升
        place(b, wind(0.9, { low: 300, high: 3000, lfoHz: 4.5, q: 2.2, attack: 0.06, release: 0.35, gain: 0.9 }));
        place(b, tone(0.7, { freq: 220, freqTo: 660, type: 'sine', attack: 0.1, decay: 0.2, sustain: 0.4, release: 0.3, gain: 0.35 }), 0.1);
        // 风眼定音
        place(b, bell(0.45, { freq: 880, ratio: 1.35, modDepth: 1.7, gain: 0.35 }), 0.62);
        return b;
    } },
    nanfeng_skill2: { build: () => {
        const b = buffer(1.0);
        // 风之廊道：平顺绵长气流
        place(b, wind(0.9, { low: 420, high: 1500, lfoHz: 1.1, q: 1.0, attack: 0.12, release: 0.4, gain: 0.75 }));
        // 气流丝带微光
        place(b, shimmer(0.7, { freqs: [880, 1109, 1319], spacing: 0.13, gain: 0.5, release: 0.4, vibratoHz: 4.5, vibratoDepth: 0.004 }), 0.2);
        return b;
    } },

    /* ===== 上官婉儿：落笔 / 笔走龙蛇 ===== */
    shangguan_skill1: { build: () => {
        const b = buffer(0.85);
        // 毛笔坠落：下行破空
        place(b, noiseBurst(0.4, { from: 2600, to: 400, type: 'bandpass', q: 1.2, attack: 0.02, release: 0.18, gain: 0.8 }));
        // 落墨砸响
        place(b, thump(0.35, { freq: 160, dropTo: 58, gain: 0.9, crack: 0.35 }), 0.3);
        // 墨汁飞溅
        place(b, noiseBurst(0.3, { from: 800, to: 220, type: 'lowpass', q: 0.9, attack: 0.006, release: 0.2, gain: 0.5 }), 0.34);
        place(b, tick(0.04, { freq: 1100, type: 'triangle', gain: 0.3 }), 0.36);
        return b;
    } },
    shangguan_skill2: { build: () => {
        const b = buffer(0.95);
        // 笔锋连段冲刺：三段墨笔嗖声
        [0, 0.18, 0.38].forEach((t, i) => {
            place(b, noiseBurst(0.24, { from: 2100 - i * 300, to: 420, type: 'bandpass', q: 1.1, attack: 0.01, release: 0.14, gain: 0.75 }), t);
        });
        // 墨点飞白
        [0.12, 0.3, 0.52].forEach((t, i) => {
            place(b, tick(0.035, { freq: 1500 - i * 260, type: 'triangle', gain: 0.28 }), t);
        });
        place(b, thump(0.3, { freq: 130, dropTo: 52, gain: 0.7, crack: 0.25 }), 0.55);
        return b;
    } },

    /* ===== 沉渊·镇岳：渊引 / 寒渊庇护 ===== */
    chenyuan_skill1: { build: () => {
        const b = buffer(1.0);
        // 深渊锁链拖拽
        chainLinks(b, 0.04, 4, 0.14, 2300);
        place(b, drone(0.8, { freqs: [65, 70], type: 'triangle', attack: 0.1, release: 0.3, gain: 0.5 }), 0.1);
        // 拖拽摩擦低吼
        place(b, noiseBurst(0.6, { from: 500, to: 120, type: 'lowpass', q: 0.8, attack: 0.08, release: 0.35, gain: 0.5 }), 0.15);
        // 寒渊冰息
        place(b, bell(0.45, { freq: 1175, ratio: 1.36, modDepth: 1.8, gain: 0.3 }), 0.6);
        return b;
    } },
    chenyuan_skill2: { build: () => {
        const b = buffer(1.1);
        // 山岳屏障：深沉大锣
        place(b, bell(1.0, { freq: 196, ratio: 1.52, modDepth: 3.0, gain: 0.8 }));
        place(b, thump(0.4, { freq: 80, dropTo: 34, gain: 0.6, crack: 0.2 }), 0.02);
        // 寒渊护罩微光
        place(b, shimmer(0.7, { freqs: [587, 740, 880], spacing: 0.13, gain: 0.5, release: 0.4, vibratoHz: 4, vibratoDepth: 0.003 }), 0.3);
        return b;
    } },

    /* ===== 戴尔：时空回溯 / 时空置换 ===== */
    dai_skill1: { build: () => {
        const b = buffer(1.0);
        // 时间线快照回卷：反向涌起
        place(b, reverseSwell({ dur: 0.8, from: 180, to: 720, gain: 0.65 }));
        clockTicks(b, 0.15, 3, 0.2, 2000);
        // 回溯归位钟
        place(b, bell(0.6, { freq: 659, ratio: 1.44, modDepth: 2.1, gain: 0.45 }), 0.65);
        place(b, shimmer(0.5, { freqs: [880, 1046], spacing: 0.1, gain: 0.4, release: 0.3, vibratoHz: 5, vibratoDepth: 0.003 }), 0.7);
        return b;
    } },
    dai_skill2: { build: () => {
        const b = buffer(0.95);
        // 时空漩涡：双股气流对旋
        place(b, wind(0.55, { low: 500, high: 2400, lfoHz: 7, q: 2.4, attack: 0.04, release: 0.25, gain: 0.7 }));
        place(b, wind(0.5, { low: 350, high: 1700, lfoHz: 5.2, q: 2.0, attack: 0.04, release: 0.25, gain: 0.55 }), 0.12);
        // 命运交错定音
        place(b, tick(0.05, { freq: 2100, type: 'square', gain: 0.32 }), 0.55);
        place(b, bell(0.5, { freq: 1319, ratio: 1.38, modDepth: 1.9, gain: 0.45 }), 0.58);
        place(b, bell(0.45, { freq: 880, ratio: 1.42, modDepth: 2.0, gain: 0.35 }), 0.66);
        return b;
    } },
};

/* ============================================================
   执行
   ============================================================ */

function main() {
    mkdirSync(OUT_DIR, { recursive: true });
    const entries = Object.entries(RECIPES);
    if (entries.length === 0) {
        console.error('RECIPES 为空，退出');
        process.exit(1);
    }
    const manifest = [];
    for (const [skillId, recipe] of entries) {
        const raw = recipe.build();
        const final = deClick(normalize(raw, 0.85));
        const wav = encodeWav(final);
        writeFileSync(join(OUT_DIR, `${skillId}.wav`), wav);
        manifest.push({ skillId, file: `skills/${skillId}.wav`, ms: Math.round((final.length / SAMPLE_RATE) * 1000) });
    }

    const lines = [
        '/**',
        ' * 技能专属音效文件清单（由 scripts/generate-skill-sounds.mjs 自动生成，请勿手改）',
        ' * 键为裸技能 ID，值为相对 public/sounds 的路径。',
        ' */',
        'export const SKILL_SOUND_FILES: Record<string, string> = {',
        ...manifest.map(m => `    ${m.skillId}: '${m.file}',`),
        '};',
        '',
    ];
    writeFileSync(MANIFEST_PATH, lines.join('\n'));

    console.log(`已生成 ${manifest.length} 个技能音效 → public/sounds/skills/`);
    for (const m of manifest) console.log(`  ${m.skillId.padEnd(26)} ${String(m.ms).padStart(5)} ms`);
}

main();
