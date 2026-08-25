import { GamePhase } from '../types/game';
import { BgmInstrument, BgmNote, BgmTrack, battleBgm, menuBgm, midiToFrequency, trackById } from './bgms';

interface ScheduledNote extends BgmNote {
    instrument: BgmInstrument;
}

interface ActiveTrack {
    track: BgmTrack;
    trackGain: GainNode;
    delaySend: GainNode;
}

const STORAGE_KEY = 'six-chess-bgm-state';
const MASTER_LEVEL = 0.9;
const DEFAULT_BGM_VOLUME = 0.32;
const SCHEDULE_AHEAD = 0.18;
const TICK_INTERVAL = 40;

interface PersistedState {
    muted: boolean;
    volume: number;
}

const loadPersistedState = (): PersistedState => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { muted: false, volume: DEFAULT_BGM_VOLUME };
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        return {
            muted: typeof parsed.muted === 'boolean' ? parsed.muted : false,
            volume:
                typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
                    ? parsed.volume
                    : DEFAULT_BGM_VOLUME,
        };
    } catch {
        return { muted: false, volume: DEFAULT_BGM_VOLUME };
    }
};

/**
 * Web Audio 程序化背景音乐引擎：
 * - BGM 与 SFX 分离的双通道总线（BGM 默认低音量，技能音效后续可直接挂到 SFX 通道）
 * - phase 驱动曲目切换（战斗曲 / 界面曲），淡出旧曲淡入新曲避免爆音
 * - 浏览器自动播放策略下，首次用户手势才会真正出声
 */
class AudioManager {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private bgmGain: GainNode | null = null;
    private sfxGain: GainNode | null = null;
    private noiseBuffer: AudioBuffer | null = null;

    private activeTrack: ActiveTrack | null = null;
    private currentTrackId: string | null = null;
    private pendingTrackId: string | null = null;
    private eventsByStep: ScheduledNote[][] = [];
    private currentStep = 0;
    private nextStepTime = 0;
    private schedulerId: number | null = null;

    private muted: boolean;
    private volume: number;

    constructor() {
        const persisted = loadPersistedState();
        this.muted = persisted.muted;
        this.volume = persisted.volume;
    }

    getUserState(): PersistedState {
        return { muted: this.muted, volume: this.volume };
    }

    /** 首次用户手势时调用：创建/恢复 AudioContext 并启动待播曲目 */
    unlock(): void {
        if (typeof window === 'undefined') return;
        if (!this.ctx) {
            const Ctor =
                window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) return;
            this.ctx = new Ctor();
            this.buildGraph();
        }
        if (this.ctx.state === 'suspended') {
            void this.ctx.resume().then(() => this.flushPendingTrack());
        } else {
            this.flushPendingTrack();
        }
    }

    /** 由当前游戏阶段决定播放哪首曲子 */
    applyPhase(phase: GamePhase): void {
        const targetId = phase === 'battle' ? battleBgm.id : menuBgm.id;
        if (this.currentTrackId === targetId && this.activeTrack) return;
        if (!this.ctx || this.ctx.state !== 'running') {
            this.pendingTrackId = targetId;
            return;
        }
        this.switchTrack(targetId);
    }

    setVolume(volume: number): void {
        this.volume = Math.max(0, Math.min(1, volume));
        this.applyVolumes();
        this.persist();
    }

    toggleMute(): void {
        this.muted = !this.muted;
        this.applyVolumes();
        this.persist();
    }

    /** 技能音效预留通道：后续音效节点 connect 到该总线即可与 BGM 独立控音 */
    getSfxBus(): GainNode | null {
        return this.sfxGain;
    }

    dispose(): void {
        this.stopScheduler();
        if (this.activeTrack) {
            this.activeTrack.trackGain.disconnect();
            this.activeTrack = null;
        }
        this.currentTrackId = null;
    }

    private buildGraph(): void {
        const ctx = this.ctx!;
        this.masterGain = ctx.createGain();
        this.masterGain.connect(ctx.destination);
        this.bgmGain = ctx.createGain();
        this.bgmGain.connect(this.masterGain);
        this.sfxGain = ctx.createGain();
        this.sfxGain.gain.value = 0.6;
        this.sfxGain.connect(this.masterGain);
        this.applyVolumes();

        const noiseLength = Math.floor(ctx.sampleRate * 0.3);
        this.noiseBuffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
        const channel = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseLength; i++) {
            channel[i] = Math.random() * 2 - 1;
        }
    }

    private applyVolumes(): void {
        if (!this.ctx || !this.masterGain || !this.bgmGain) return;
        this.masterGain.gain.value = this.muted ? 0 : MASTER_LEVEL;
        this.bgmGain.gain.value = this.volume;
    }

    private persist(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: this.muted, volume: this.volume }));
        } catch {
            /* 隐私模式等场景下静默失败 */
        }
    }

    private flushPendingTrack(): void {
        if (!this.pendingTrackId || !this.ctx || this.ctx.state !== 'running') return;
        const id = this.pendingTrackId;
        this.pendingTrackId = null;
        if (id !== this.currentTrackId) this.switchTrack(id);
    }

    private switchTrack(trackId: string): void {
        const track = trackById(trackId);
        if (!track) return;
        if (this.activeTrack) this.stopActiveTrack();
        this.startTrack(track);
        this.currentTrackId = trackId;
    }

    private stopActiveTrack(): void {
        this.stopScheduler();
        const active = this.activeTrack;
        if (!active || !this.ctx) return;
        this.activeTrack = null;
        const now = this.ctx.currentTime;
        active.trackGain.gain.cancelScheduledValues(now);
        active.trackGain.gain.setValueAtTime(active.trackGain.gain.value, now);
        active.trackGain.gain.linearRampToValueAtTime(0, now + 0.6);
        const fadingGain = active.trackGain;
        window.setTimeout(() => fadingGain.disconnect(), 900);
    }

    private startTrack(track: BgmTrack): void {
        const ctx = this.ctx!;
        const trackGain = ctx.createGain();
        trackGain.gain.setValueAtTime(0, ctx.currentTime);
        trackGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.9);
        trackGain.connect(this.bgmGain!);

        // 轻量延迟混响，界面曲更空灵、战斗曲更干脆
        const delay = ctx.createDelay(1);
        const isMenu = track.id === menuBgm.id;
        delay.delayTime.value = isMenu ? 0.34 : 0.22;
        const feedback = ctx.createGain();
        feedback.gain.value = isMenu ? 0.42 : 0.26;
        const wet = ctx.createGain();
        wet.gain.value = isMenu ? 0.3 : 0.16;
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(trackGain);

        const delaySend = ctx.createGain();
        delaySend.gain.value = 1;
        delaySend.connect(delay);

        this.activeTrack = { track, trackGain, delaySend };
        this.eventsByStep = this.compileTrack(track);
        this.currentStep = 0;
        this.nextStepTime = ctx.currentTime + 0.1;
        this.schedulerId = window.setInterval(() => this.tick(), TICK_INTERVAL);
    }

    private compileTrack(track: BgmTrack): ScheduledNote[][] {
        const table: ScheduledNote[][] = Array.from({ length: track.totalSteps }, () => []);
        for (const layer of track.layers) {
            for (const note of layer.notes) {
                if (note.step < 0 || note.step >= track.totalSteps) continue;
                table[note.step].push({ ...note, instrument: layer.instrument });
            }
        }
        return table;
    }

    private stopScheduler(): void {
        if (this.schedulerId !== null) {
            window.clearInterval(this.schedulerId);
            this.schedulerId = null;
        }
    }

    private tick(): void {
        const ctx = this.ctx;
        const active = this.activeTrack;
        if (!ctx || !active) {
            this.stopScheduler();
            return;
        }
        const stepDuration = 60 / active.track.bpm / active.track.stepsPerBeat;
        while (this.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
            for (const event of this.eventsByStep[this.currentStep] ?? []) {
                this.playNote(event, this.nextStepTime, stepDuration, active);
            }
            this.nextStepTime += stepDuration;
            this.currentStep = (this.currentStep + 1) % active.track.totalSteps;
        }
    }

    private playNote(event: ScheduledNote, time: number, stepDuration: number, active: ActiveTrack): void {
        const ctx = this.ctx!;
        const gain = active.trackGain;
        const freq = midiToFrequency(event.midi);
        const seconds = event.duration * stepDuration;
        switch (event.instrument) {
            case 'pad':
                this.playPad(ctx, time, freq, seconds, event.velocity, gain);
                break;
            case 'pluck':
                this.playPluck(ctx, time, freq, seconds, event.velocity, gain, active.delaySend);
                break;
            case 'bell':
                this.playBell(ctx, time, freq, event.velocity, gain, active.delaySend);
                break;
            case 'kick':
                this.playKick(ctx, time, event.velocity, gain);
                break;
            case 'snare':
                this.playSnare(ctx, time, event.velocity, gain);
                break;
            case 'hat':
                this.playHat(ctx, time, event.velocity, gain);
                break;
            case 'bass':
                this.playBass(ctx, time, freq, seconds, event.velocity, gain);
                break;
            case 'lead':
                this.playLead(ctx, time, freq, seconds, event.velocity, gain, active.delaySend);
                break;
            case 'stab':
                this.playStab(ctx, time, freq, seconds, event.velocity, gain);
                break;
            case 'tom':
                this.playTom(ctx, time, event.velocity, gain);
                break;
            case 'crash':
                this.playCrash(ctx, time, event.velocity, gain);
                break;
        }
    }

    private playPad(ctx: AudioContext, time: number, freq: number, seconds: number, velocity: number, dest: AudioNode): void {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const env = ctx.createGain();
        const peak = velocity * 0.22;
        const attack = Math.min(1.4, seconds * 0.25);
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(peak, time + attack);
        env.gain.setValueAtTime(peak, time + Math.max(attack, seconds - 0.35));
        env.gain.linearRampToValueAtTime(0, time + seconds);
        osc.connect(env);
        env.connect(dest);
        osc.start(time);
        osc.stop(time + seconds + 0.05);
    }

    private playPluck(
        ctx: AudioContext,
        time: number,
        freq: number,
        seconds: number,
        velocity: number,
        dest: AudioNode,
        delaySend: GainNode,
    ): void {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const env = ctx.createGain();
        const peak = velocity * 0.24;
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(peak, time + 0.025);
        env.gain.exponentialRampToValueAtTime(0.001, time + seconds * 1.6);
        osc.connect(env);
        env.connect(dest);
        env.connect(delaySend);
        osc.start(time);
        osc.stop(time + seconds * 1.6 + 0.05);
    }

    private playBell(ctx: AudioContext, time: number, freq: number, velocity: number, dest: AudioNode, delaySend: GainNode): void {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = freq * 2.01;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(velocity * 0.18, time + 0.008);
        env.gain.exponentialRampToValueAtTime(0.001, time + 1.4);
        const env2 = ctx.createGain();
        env2.gain.setValueAtTime(0, time);
        env2.gain.linearRampToValueAtTime(velocity * 0.05, time + 0.005);
        env2.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
        osc.connect(env);
        osc2.connect(env2);
        env.connect(dest);
        env.connect(delaySend);
        env2.connect(dest);
        osc.start(time);
        osc.stop(time + 1.5);
        osc2.start(time);
        osc2.stop(time + 0.6);
    }

    private playKick(ctx: AudioContext, time: number, velocity: number, dest: AudioNode): void {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
        const env = ctx.createGain();
        env.gain.setValueAtTime(velocity * 0.5, time);
        env.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
        osc.connect(env);
        env.connect(dest);
        osc.start(time);
        osc.stop(time + 0.25);
    }

    private playSnare(ctx: AudioContext, time: number, velocity: number, dest: AudioNode): void {
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 1800;
        bandpass.Q.value = 0.9;
        const env = ctx.createGain();
        env.gain.setValueAtTime(velocity * 0.22, time);
        env.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
        noise.connect(bandpass);
        bandpass.connect(env);
        env.connect(dest);
        noise.start(time);
        noise.stop(time + 0.15);
    }

    private playHat(ctx: AudioContext, time: number, velocity: number, dest: AudioNode): void {
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 7000;
        const env = ctx.createGain();
        env.gain.setValueAtTime(velocity * 0.1, time);
        env.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
        noise.connect(highpass);
        highpass.connect(env);
        env.connect(dest);
        noise.start(time);
        noise.stop(time + 0.06);
    }

    private playBass(ctx: AudioContext, time: number, freq: number, seconds: number, velocity: number, dest: AudioNode): void {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 420;
        lowpass.Q.value = 1;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(velocity * 0.3, time + 0.015);
        env.gain.exponentialRampToValueAtTime(0.001, time + seconds * 0.95);
        osc.connect(lowpass);
        lowpass.connect(env);
        env.connect(dest);
        osc.start(time);
        osc.stop(time + seconds);
    }

    private playLead(
        ctx: AudioContext,
        time: number,
        freq: number,
        seconds: number,
        velocity: number,
        dest: AudioNode,
        delaySend: GainNode,
    ): void {
        // 双失谐锯齿厚声部：比单方波更宽更亮，接近合成铜管领奏
        const detuneCents = 8;
        const oscA = ctx.createOscillator();
        oscA.type = 'sawtooth';
        oscA.frequency.value = freq;
        oscA.detune.value = -detuneCents;
        const oscB = ctx.createOscillator();
        oscB.type = 'sawtooth';
        oscB.frequency.value = freq;
        oscB.detune.value = detuneCents;
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 2400;
        lowpass.Q.value = 1.2;
        const env = ctx.createGain();
        const peak = velocity * 0.17;
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(peak, time + 0.02);
        env.gain.setValueAtTime(peak, time + Math.max(0.02, seconds * 0.6));
        env.gain.linearRampToValueAtTime(0, time + seconds);
        oscA.connect(lowpass);
        oscB.connect(lowpass);
        lowpass.connect(env);
        env.connect(dest);
        env.connect(delaySend);
        oscA.start(time);
        oscB.start(time);
        oscA.stop(time + seconds + 0.05);
        oscB.stop(time + seconds + 0.05);
    }

    /** 铜管式和弦刺击：双失谐锯齿叠音 + 滤波下扫，短促有力 */
    private playStab(ctx: AudioContext, time: number, freq: number, seconds: number, velocity: number, dest: AudioNode): void {
        const detuneCents = 10;
        const oscA = ctx.createOscillator();
        oscA.type = 'sawtooth';
        oscA.frequency.value = freq;
        oscA.detune.value = -detuneCents;
        const oscB = ctx.createOscillator();
        oscB.type = 'sawtooth';
        oscB.frequency.value = freq;
        oscB.detune.value = detuneCents;
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(3000, time);
        lowpass.frequency.exponentialRampToValueAtTime(700, time + Math.max(0.12, seconds));
        lowpass.Q.value = 1;
        const env = ctx.createGain();
        const peak = velocity * 0.09; // 三音和弦叠加，单振峰值压低防过载
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(peak, time + 0.012);
        env.gain.exponentialRampToValueAtTime(0.001, time + Math.max(0.18, seconds * 1.1));
        oscA.connect(lowpass);
        oscB.connect(lowpass);
        lowpass.connect(env);
        env.connect(dest);
        oscA.start(time);
        oscB.start(time);
        const stopAt = time + Math.max(0.24, seconds * 1.15) + 0.05;
        oscA.stop(stopAt);
        oscB.stop(stopAt);
    }

    /** 太鼓式低音战鼓：正弦下扫，比底鼓更低更沉更长 */
    private playTom(ctx: AudioContext, time: number, velocity: number, dest: AudioNode): void {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, time);
        osc.frequency.exponentialRampToValueAtTime(55, time + 0.25);
        const env = ctx.createGain();
        env.gain.setValueAtTime(velocity * 0.42, time);
        env.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
        osc.connect(env);
        env.connect(dest);
        osc.start(time);
        osc.stop(time + 0.5);
    }

    /** 镲片：高通白噪声长衰减，用于乐段起始强调（噪声缓冲仅 0.3 秒，循环覆盖衰减期） */
    private playCrash(ctx: AudioContext, time: number, velocity: number, dest: AudioNode): void {
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.loop = true;
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 4500;
        const env = ctx.createGain();
        env.gain.setValueAtTime(velocity * 0.12, time);
        env.gain.exponentialRampToValueAtTime(0.001, time + 1.1);
        noise.connect(highpass);
        highpass.connect(env);
        env.connect(dest);
        noise.start(time);
        noise.stop(time + 1.15);
    }
}

export const audioManager = new AudioManager();
