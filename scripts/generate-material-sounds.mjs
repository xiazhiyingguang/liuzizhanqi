/** Recorded Foley supplies material identity; synthesis is reserved for the fantasy layer. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { buffer, deClick, encodeWav } from './generate-skill-sounds.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'src/data/material-sound-files.json');
const profiles = JSON.parse(readFileSync(join(root, 'src/data/material-sounds.json'), 'utf8'));
const out = resolve(root, 'public/sounds/materials'), report = join(root, 'reports/material-audio-2026-10-04');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const rate = 44100;
mkdirSync(out, { recursive: true }); mkdirSync(report, { recursive: true });

function readPcm(file) {
    const wav = readFileSync(file);
    if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.readUInt32LE(24) !== rate || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) throw Error('Expected mono 44.1k PCM: ' + file);
    const data = new Float32Array((wav.length - 44) / 2);
    for (let i = 0; i < data.length; i++) data[i] = wav.readInt16LE(44 + i * 2) / 32768;
    return data;
}
const banks = Object.fromEntries(['ice', 'metal', 'steel', 'heavy-metal', 'splash', 'wind', 'fire', 'waves']
    .map(key => [key, readPcm(join(root, 'assets/audio-source/materials', key + '.wav'))]));
function hash(id) { return parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16); }
function scaled(data, gain) { return Float32Array.from(data, value => value * gain); }
function normalized(data) { let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v)); return scaled(data, 1 / Math.max(peak, 1e-6)); }
function slice(key, start, seconds, speed = 1, reverse = false) {
    const source = banks[key], result = buffer(seconds);
    for (let i = 0; i < result.length; i++) {
        const p = start * rate + (reverse ? result.length - i - 1 : i) * speed, index = Math.floor(p), f = p - index;
        if (index >= 0 && index + 1 < source.length) result[i] = source[index] * (1 - f) + source[index + 1] * f;
    }
    return result;
}
function envelope(data, attack, decay, release = .06) {
    for (let i = 0; i < data.length; i++) {
        const t = i / rate, remaining = (data.length - i - 1) / rate;
        data[i] *= Math.min(1, t / Math.max(.0001, attack)) * Math.exp(-t / decay) * Math.min(1, remaining / release);
    }
    return data;
}
function mix(dest, source, at = 0, gain = 1) {
    const offset = Math.round(at * rate);
    for (let i = 0; i < source.length && i + offset < dest.length; i++) if (i + offset >= 0) dest[i + offset] += source[i] * gain;
}
/** Cookbook biquad keeps the recording's microscopic grain and resonances. */
function filter(data, type, hz, q = .707) {
    const w = 2 * Math.PI * hz / rate, c = Math.cos(w), a = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'low') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'high') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; }
    const a0 = 1 + a, a1 = -2 * c / a0, a2 = (1 - a) / a0;
    b0 /= a0; b1 /= a0; b2 /= a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const result = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
        const x = data[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        result[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
    }
    return result;
}
const cracks = [.557, 1.34, 1.915, 2.55, 4.075, 4.52, 4.815];
function iceCrack(index, seconds, speed) {
    return normalized(envelope(filter(slice('ice', cracks[index % cracks.length], seconds, speed), 'high', 370), .0004, .11, .028));
}
function createSound(id, { material, variant, pitch }, cast) {
    const seed = hash(id + (cast ? ':cast' : ':impact'));
    const speed = 1 + (pitch - 1) * .55 + ((seed % 101) / 100 - .5) * .025;
    const soft = ['ward', 'return', 'still', 'mirror'].includes(variant);
    const heavy = ['heavy', 'pressure', 'burst', 'crest', 'bone'].includes(variant);
    const seconds = cast ? (material === 'soulfire' ? .46 : .34) : ({ ice: .56, wind: .56, metal: .70, water: .70, soulfire: .75 }[material]);
    const result = buffer(seconds);
    if (material === 'ice') {
        if (cast) {
            mix(result, normalized(envelope(filter(slice('ice', 4.55 + (seed % 4) * .024, .30, speed * 1.13, true), 'high', 1200), .055, .22)), 0, .20);
            mix(result, iceCrack(seed, .07, speed * 1.2), .205, .17);
        } else {
            mix(result, iceCrack(seed, .19, speed), 0, soft ? .53 : .86);
            for (let i = 0; i < (heavy ? 5 : 3); i++) mix(result, iceCrack(seed + i + 1, .095, speed * (1.10 + i * .075)), .057 + i * .057 + (seed % 11) * .0005, .16 / (1 + i * .50));
            if (heavy) mix(result, filter(iceCrack(seed, .25, speed * .68), 'low', 900), .004, .23);
        }
    } else if (material === 'metal') {
        if (cast) {
            mix(result, normalized(envelope(filter(slice('steel', .055, .25, speed * 1.15, true), 'high', 950), .028, .20)), 0, .28);
        } else {
            const ringing = slice(heavy ? 'heavy-metal' : 'steel', 0, seconds, heavy ? speed * .90 : speed);
            mix(result, normalized(envelope(filter(ringing, 'high', heavy ? 70 : 260), .0005, heavy ? .45 : .52, .13)), 0, .86);
            if (!heavy) mix(result, normalized(envelope(slice('metal', .016, .15, speed), .0005, .055, .04)), 0, .18);
            if (variant === 'flurry' || variant === 'wheel') mix(result, normalized(envelope(slice('steel', 0, .30, speed * 1.11), .0005, .13)), .11, .16);
            if (variant === 'ember') mix(result, normalized(envelope(filter(slice('fire', 5.29, .36, .92), 'high', 500), .004, .16)), .025, .12);
        }
    } else if (material === 'wind') {
        // Continuous air: no generic impact boom or metallic tick underneath it.
        const air = filter(filter(slice('wind', 1.33 + (seed % 9) * .085, seconds, speed), 'high', heavy ? 100 : 230), 'low', 5200);
        mix(result, normalized(envelope(air, cast ? .045 : .018, cast ? .17 : heavy ? .21 : .15, .11)), 0, .78);
        if (!cast && variant === 'blade') mix(result, normalized(envelope(filter(slice('wind', 3.54, .14, 1.6), 'high', 1900), .008, .055)), .014, .15);
    } else if (material === 'water') {
        if (cast) mix(result, normalized(envelope(slice('waves', 13.4 + (seed % 7) * .11, seconds, speed), .025, .17)), 0, .34);
        else {
            // Real hollow splosh, bubbling aftermath and foam; no sine-wave droplets.
            mix(result, normalized(envelope(filter(slice('splash', .598, .49, speed * (soft ? 1.10 : .98)), 'high', 90), .001, .20, .10)), 0, soft ? .63 : .82);
            mix(result, normalized(envelope(filter(slice('waves', 14.58 + (seed % 5) * .06, seconds - .025, heavy ? .89 : 1.12), 'high', 300), .012, heavy ? .30 : .17, .12)), .025, heavy ? .34 : .16);
            for (let i = 0; i < (soft ? 2 : 3); i++) mix(result, normalized(envelope(slice('splash', .65 + i * .025, .075, 1.20 + i * .12), .001, .025, .02)), .22 + i * .092, .065 / (1 + i * .4));
        }
    } else {
        // Fantasy soulfire: slowed real air, formant breath, reversed fire and unstable low modes.
        const air = normalized(filter(slice('wind', 3.05 + (seed % 7) * .031, seconds, .55 * speed), 'high', 110));
        const breath = buffer(seconds);
        mix(breath, filter(air, 'band', 410 * speed, 2.8), 0, .70);
        mix(breath, filter(air, 'band', 870 * speed, 3.7), 0, .60);
        mix(breath, filter(air, 'band', 1360 * speed, 4.0), 0, .25);
        const shaped = normalized(envelope(breath, cast ? .055 : .015, cast ? .20 : .22, .14));
        for (let i = 0; i < shaped.length; i++) shaped[i] *= .83 + .12 * Math.sin(i / rate * 2 * Math.PI * 7.1);
        mix(result, shaped, 0, cast ? .37 : .51);
        const low = buffer(seconds); let phase = 0;
        for (let i = 0; i < low.length; i++) {
            const t = i / rate;
            phase += 2 * Math.PI * (185 * speed - 55 * Math.min(1, t / .24)) / rate;
            low[i] = (Math.sin(phase + 1.4 * Math.sin(phase * .503)) + .24 * Math.sin(phase * 1.89)) * Math.min(1, t / .016) * Math.exp(-t / .18) * Math.min(1, (seconds - t) / .13);
        }
        mix(result, low, 0, cast ? .09 : heavy ? .24 : .15);
        mix(result, normalized(envelope(filter(slice('fire', .84 + (seed % 3) * .011, .33, .68, true), 'band', 700, .8), .03, .12)), cast ? .09 : .028, cast ? .06 : .085);
        if (!cast) for (const [delay, amount] of [[.053, .5], [.091, .37], [.149, .23], [.227, .12]]) mix(result, filter(shaped, 'low', 1700), delay, .38 * amount);
    }
    let sum = 0, peak = 0;
    for (const v of result) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    const target = cast ? .09 : ({ ice: .13, metal: .16, soulfire: .13, wind: .12, water: .15 }[material]);
    return deClick(scaled(result, Math.min(target / Math.max(Math.sqrt(sum / result.length), .0001), .76 / Math.max(peak, .0001))), 1);
}
function peakTime(samples) {
    // Measure the actual strongest 5ms window across the whole clip, including natural gust/splash attacks.
    const window = Math.round(rate * .005); let best = -1, at = 0;
    for (let i = 0; i < samples.length; i += window) {
        let energy = 0; for (let j = i; j < i + window && j < samples.length; j++) energy += samples[j] ** 2;
        if (energy > best) { best = energy; at = i; }
    }
    return Math.round((at + window / 2) / rate * 1000);
}
// Keep the previous generation for an audible A/B. Cleanup only references from our own old manifest.
const archive = join(report, 'previous-synth');
if (!existsSync(join(archive, 'manifest.json')) && Object.keys(previous).length) {
    mkdirSync(archive, { recursive: true });
    for (const clips of Object.values(previous)) for (const asset of Object.values(clips)) {
        const file = resolve(root, 'public/sounds', asset.file);
        if (file.startsWith(out + sep) && existsSync(file)) copyFileSync(file, join(archive, file.split(sep).pop()));
    }
    writeFileSync(join(archive, 'manifest.json'), JSON.stringify(previous, null, 2));
}
const files = {}, stats = [], generated = new Set();
const all = { ...profiles, ...Object.fromEntries(['ice', 'metal', 'soulfire', 'wind', 'water'].map(material => [material, { material, variant: 'light', pitch: 1 }])) };
for (const [id, profile] of Object.entries(all)) {
    files[id] = {};
    for (const role of ['cast', 'impact']) {
        if (role === 'cast' && profile.cast === false) continue;
        const samples = createSound(id, profile, role === 'cast'), wav = encodeWav(samples);
        const digest = createHash('sha256').update(wav).digest('hex').slice(0, 10), filename = `${id}-${role}-${digest}.wav`, file = `materials/${filename}`;
        writeFileSync(join(out, filename), wav); generated.add(file);
        files[id][role] = { file, peakMs: role === 'impact' ? peakTime(samples) : 0, durationMs: Math.round(samples.length / rate * 1000) };
        let sum = 0, peak = 0; for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
        stats.push({ id, role, material: profile.material, peak, rms: Math.sqrt(sum / samples.length), ...files[id][role] });
    }
}
writeFileSync(manifestPath, JSON.stringify(files, null, 4) + '\n');
for (const clips of Object.values(previous)) for (const asset of Object.values(clips)) {
    const file = resolve(root, 'public/sounds', asset.file);
    if (!generated.has(asset.file) && file.startsWith(out + sep) && existsSync(file)) unlinkSync(file);
}
writeFileSync(join(report, 'asset-checks.json'), JSON.stringify(stats, null, 2));
console.log(`Rebuilt ${Object.keys(profiles).length} skill designs, ${stats.length} clips from Foley and a distinct soulfire design.`);
