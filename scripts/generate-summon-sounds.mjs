// Deterministic original synthesis: stone, brushed wind, plucked strings and bronze chimes.
// Cue points match HeroSummon: gather 0, scroll 1.8s, reveal 2.75s.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const rate = 44100;
const duration = 7.2;
const folder = fileURLToPath(new URL('../public/sounds/summon/', import.meta.url));
mkdirSync(folder, { recursive: true });
function render(six) {
    const channels = [new Float64Array(rate * duration), new Float64Array(rate * duration)];
    let seed = 404;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
    function voice(start, seconds, sample, pan = 0) {
        const offset = Math.round(start * rate);
        for (let i = 0; i < seconds * rate && offset + i < channels[0].length; i++) {
            const t = i / rate;
            const fade = Math.min(1, t / .004, (seconds - t) / .06);
            const value = sample(t) * Math.max(0, fade);
            channels[0][offset + i] += value * Math.sqrt((1 - pan) / 2);
            channels[1][offset + i] += value * Math.sqrt((1 + pan) / 2);
        }
    }
    function string(start, hz, strength, pan = 0) {
        voice(start, 2.6, t => {
            let value = 0;
            for (let k = 1; k <= 7; k++) value += Math.sin(2 * Math.PI * hz * k * (1 + k * k * .00004) * t) / k ** 1.6 * Math.exp(-t * (2.5 + k * .7));
            return value * strength;
        }, pan);
    }
    function bell(start, hz, strength, pan = 0) {
        voice(start, 4.2, t => strength * [1, 2.01, 2.76, 4.07, 5.43].reduce((sum, ratio, k) => sum + Math.sin(2 * Math.PI * hz * ratio * t) * Math.exp(-t * (.95 + k * .7)) / (1 + k * 2.5), 0), pan);
    }
    // Stone on the board: woody attack with a short ceramic resonance.
    voice(0, .32, t => .32 * Math.exp(-t * 34) * (Math.sin(2 * Math.PI * 780 * t) + .4 * Math.sin(2 * Math.PI * 1730 * t)) + random() * .12 * Math.exp(-t * 110));
    string(.09, 146.83, .23, -.25);
    // Filtered wind gathers, then cuts away before the opening stroke.
    let smooth = 0;
    voice(.12, 1.68, t => { smooth += .028 * (random() - smooth); const rise = t / 1.68; return (smooth * 1.2 + Math.sin(2 * Math.PI * (62 * t + 22 * t * t)) * .035) * Math.sin(Math.PI * rise) ** .7 * (1 + rise); });
    [293.66, 329.63, 440, 587.33, 659.25].forEach((hz, i) => string(.5 + i * .225, hz, .105 + i * .012, -.6 + i * .3));
    let air = 0;
    voice(1.8, .8, t => { air += .1 * (random() - air); return air * .65 * Math.sin(Math.PI * t / .8) ** .8; }, .2);
    bell(1.8, 220, .17, -.2);
    voice(1.8, .6, t => .14 * Math.sin(2 * Math.PI * (85 * t - 36 * t * t)) * Math.exp(-t * 8));
    // One unified arrival, with a wider pentatonic voicing for the six-card reveal.
    voice(2.75, .85, t => .26 * Math.sin(2 * Math.PI * (68 * t - 16 * t * t)) * Math.exp(-t * 6));
    bell(2.75, 587.33, .23, -.3);
    string(2.75, 293.66, .22, .3);
    const notes = six ? [440, 587.33, 659.25, 880, 1174.66, 1318.51] : [587.33, 880, 1174.66];
    notes.forEach((hz, i) => bell(2.79 + i * .07, hz, six ? .085 : .07, -.75 + i / (notes.length - 1) * 1.5));
    string(3.22, 440, .08, -.45);
    // Cross-channel early reflections and a soft, finite reverberant tail.
    const dry = channels.map(channel => channel.slice());
    [.083, .149, .237, .383, .571, .809, 1.13].forEach((delay, tap) => {
        const offset = Math.round(delay * rate), gain = .19 * .72 ** tap;
        for (let ch = 0; ch < 2; ch++) for (let i = offset; i < channels[ch].length; i++) channels[ch][i] += dry[(ch + tap) % 2][i - offset] * gain;
    });
    let peak = 0;
    channels.forEach(channel => { for (const value of channel) peak = Math.max(peak, Math.abs(value)); });
    const gain = .82 / peak;
    const wav = Buffer.alloc(44 + channels[0].length * 4);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    let energy = 0;
    for (let i = 0; i < channels[0].length; i++) for (let ch = 0; ch < 2; ch++) {
        const value = channels[ch][i] * gain * Math.min(1, (channels[ch].length - 1 - i) / (rate * .4));
        if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error('Invalid audio sample');
        energy += value * value;
        wav.writeInt16LE(Math.round(value * 32767), 44 + i * 4 + ch * 2);
    }
    const name = six ? 'shanhe-six.wav' : 'shanhe-single.wav';
    writeFileSync(`${folder}/${name}`, wav);
    console.log(`${name}: ${duration}s stereo, peak -1.72 dBFS, RMS ${(20 * Math.log10(Math.sqrt(energy / channels[0].length / 2))).toFixed(1)} dBFS`);
}
render(false);
render(true);
