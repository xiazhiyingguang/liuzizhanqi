/**
 * 战斗音效管理器
 * - 预加载 public/sounds 下的合成音效
 * - 材质音效使用已解码的 Web Audio 缓冲，与特效共用命中时钟
 * - 其他音效保留 Audio 播放；战斗声独立于音乐的音量和静音
 * - 静音状态持久化到 localStorage，默认开启
 */

import { SKILL_SOUND_FILES } from '../data/skill-sound-files';
import { audioManager } from '../audio/audio-manager';
import { MATERIAL_SOUND_DESIGNS, MATERIAL_SOUND_FILES, materialSoundId, planSkillSoundCues, type SkillSoundCue } from './skill-sound-cues';
import type { SkillFxEvent } from './skill-fx';
import { getSkillSound } from '../data/skill-sounds';
import { isYunxiuCloudFx } from './yunxiu-cloud-fx';

export type SoundName =
    | 'slash'
    | 'heavy_slash'
    | 'ice'
    | 'snow'
    | 'thunder'
    | 'fire'
    | 'heal'
    | 'buff'
    | 'curse'
    | 'summon'
    | 'revive'
    | 'impact'
    | 'dash'
    | 'teleport'
    | 'explosion'
    | 'kill'
    | 'coin'
    | 'metal'
    | 'soulfire'
    | 'wind'
    | 'water';

const SOUND_BASE = `${import.meta.env.BASE_URL ?? '/'}sounds`;
const MUTE_STORAGE_KEY = 'six-chess-battle:sound-muted';
const DEFAULT_VOLUME = 0.45;
/** 同一技能音频文件的去抖窗口：一层一击这类连发只响一次 */
const SKILL_SOUND_DEDUPE_MS = 120;

const SOUND_FILES: Record<SoundName, string> = {
    slash: 'slash.wav',
    heavy_slash: 'heavy_slash.wav',
    ice: MATERIAL_SOUND_FILES.ice.impact.file,
    snow: 'snow.wav',
    thunder: 'thunder.wav',
    fire: 'fire.wav',
    heal: 'heal.wav',
    buff: 'buff.wav',
    curse: 'curse.wav',
    summon: 'summon.wav',
    revive: 'revive.wav',
    impact: 'impact.wav',
    dash: 'dash.wav',
    teleport: 'teleport.wav',
    explosion: 'explosion.wav',
    kill: 'kill.wav',
    coin: 'coin.wav',
    metal: MATERIAL_SOUND_FILES.metal.impact.file,
    soulfire: MATERIAL_SOUND_FILES.soulfire.impact.file,
    wind: MATERIAL_SOUND_FILES.wind.impact.file,
    water: MATERIAL_SOUND_FILES.water.impact.file,
};

export class SoundManager {
    private muted = false;
    private warmed = false;

    constructor() {
        try {
            this.muted = window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
        } catch {
            // localStorage 不可用时保持默认开启
        }
    }

    isMuted(): boolean {
        return this.muted;
    }

    setMuted(muted: boolean): void {
        this.muted = muted;
        if (muted) this.cancelSkillSounds();
        try {
            window.localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
        } catch {
            // 忽略存储异常
        }
    }

    toggleMuted(): boolean {
        this.setMuted(!this.muted);
        return this.muted;
    }

    /** 已发起过预取的音效文件：换英雄时不重复拉同一个文件 */
    private warmedFiles = new Set<string>();

    /**
     * 预取"本场会响到"的音效。
     * 不预取的话，玩家第一次放某个技能才现场拉 + 解码 WAV，那一下正好和特效同帧
     * （实测首次施法窗里最差帧 700~900ms）；但一上来就把 100 多个文件全拉满
     * 是 11MB，手机上更糟。所以按本场上阵英雄的两个技能收口，通用音效只拉一次。
     */
    async warmupFor(skillIds: string[]): Promise<void> {
        if (typeof window === 'undefined' || this.muted) return;
        if (!this.warmed) {
            this.warmed = true;
            for (const file of Object.values(SOUND_FILES)) this.queueWarm(file);
        }
        const roots = skillIds.map(id => id.split('_skill')[0]);
        const related = Object.keys(MATERIAL_SOUND_DESIGNS).filter(id => roots.some(root => id.startsWith(root + '_')));
        const pending: Promise<AudioBuffer | null>[] = [];
        for (const skillId of new Set([...skillIds, ...related])) {
            const material = MATERIAL_SOUND_FILES[skillId];
            if (material) {
                for (const asset of [material.cast, material.impact]) if (asset) pending.push(this.decodeFile(asset.file));
                continue;
            }
            const file = SKILL_SOUND_FILES[skillId];
            if (file) this.queueWarm(file);
        }
        await Promise.all(pending);
    }

    private queueWarm(file: string): void {
        if (this.warmedFiles.has(file)) return;
        this.warmedFiles.add(file);
        const audio = new Audio(`${SOUND_BASE}/${file}`);
        audio.preload = 'auto';
        audio.load();
    }

    /** 预加载全部音效（浏览器 HTTP 缓存生效后播放零延迟）。 */
    warmup(): void {
        if (this.warmed || typeof window === 'undefined') return;
        this.warmed = true;
        for (const file of [...Object.values(SOUND_FILES), ...Object.values(SKILL_SOUND_FILES)]) {
            const audio = new Audio(`${SOUND_BASE}/${file}`);
            audio.preload = 'auto';
            audio.load();
        }
        for (const assets of Object.values(MATERIAL_SOUND_FILES)) {
            for (const asset of [assets.cast, assets.impact]) if (asset) void this.decodeFile(asset.file);
        }
    }

    /** 按相对 public/sounds 的路径播放单个音效文件 */
    private playFile(path: string, volume: number): void {
        if (this.muted || typeof window === 'undefined') return;
        try {
            const audio = new Audio(`${SOUND_BASE}/${path}`);
            audio.volume = Math.max(0, Math.min(1, volume));
            void audio.play().catch(() => {
                // 自动播放策略拦截时静默失败（用户尚未与页面交互的场景）
            });
        } catch {
            // 忽略播放异常
        }
    }

    play(name: SoundName, volume: number = DEFAULT_VOLUME): void {
        this.playFile(SOUND_FILES[name], volume);
    }

    /**
     * 同一段结算里会有多条日志各自请求同一个音色——镜的「破镜之刃」是一层一击，
     * 攒了三层就是一瞬间连响三声。叠加播放既听不出层次，又会在手机上把音频解码
     * 成本一起顶起来（用户反馈的"卡顿"），所以同一个音频文件在极短窗口内只响一次；
     * 超过窗口（下一次真正的施法）照常播。
     */
    private lastSkillSoundFile: string | null = null;
    private lastSkillSoundAt = 0;

    private buffers = new Map<string, Promise<AudioBuffer | null>>();
    private skillVoices = new Map<number, {
        canceled: boolean;
        nodes: Array<{ source: AudioBufferSourceNode; gain: GainNode }>;
    }>();
    private visibilityListening = false;
    private delayedSkillTimers = new Map<number, ReturnType<typeof setTimeout>>();
    private materialBus: { context: AudioContext; node: DynamicsCompressorNode } | null = null;

    private getMaterialBus(context: AudioContext): DynamicsCompressorNode {
        if (this.materialBus?.context === context) return this.materialBus.node;
        const node = context.createDynamicsCompressor();
        node.threshold.value = -11;
        node.knee.value = 8;
        node.ratio.value = 4;
        node.attack.value = .003;
        node.release.value = .12;
        node.connect(context.destination);
        this.materialBus = { context, node };
        return node;
    }

    private decodeFile(file: string): Promise<AudioBuffer | null> {
        const cached = this.buffers.get(file);
        if (cached) return cached;
        const context = audioManager.getAudioContext();
        if (!context || typeof fetch === 'undefined') return Promise.resolve(null);
        const pending = fetch(`${SOUND_BASE}/${file}`)
            .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error('Missing sound')))
            .then(data => context.decodeAudioData(data))
            .catch(() => { this.buffers.delete(file); return null; });
        this.buffers.set(file, pending);
        return pending;
    }

    /** The FX event owns the clock and cancellation, for local, AI and remote casts alike. */
    playSkillFx(event: SkillFxEvent): void {
        if (!event.skillId || this.muted || typeof window === 'undefined') return;
        if (typeof document !== 'undefined' && !this.visibilityListening) {
            this.visibilityListening = true;
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this.cancelSkillSounds();
            });
        }
        if (typeof document !== 'undefined' && document.hidden) return;
        if (!materialSoundId(event)) {
            const cloudStrike = isYunxiuCloudFx(event.profile.kind);
            if (cloudStrike && !(event.damagePositions ?? event.impactPositions)?.length) return;
            const delay = event.bornAt + (cloudStrike ? event.profile.impactMs ?? 320 : 0) - Date.now();
            if (delay > 0) {
                if (!this.delayedSkillTimers.has(event.id)) this.delayedSkillTimers.set(event.id, setTimeout(() => {
                    this.delayedSkillTimers.delete(event.id);
                    this.playSkillFx(event);
                }, delay));
                return;
            }
            this.playSkill(event.skillId, getSkillSound(event.skillId));
            return;
        }
        if (this.skillVoices.has(event.id)) return;
        const voice = { canceled: false, nodes: [] as Array<{ source: AudioBufferSourceNode; gain: GainNode }> };
        this.skillVoices.set(event.id, voice);
        // Bound dense passive chains; scheduled contacts remain one event, not one voice per cell.
        while (this.skillVoices.size > 16) this.cancelSkillFx(this.skillVoices.keys().next().value!);
        audioManager.unlock();
        const context = audioManager.getAudioContext();
        if (!context) return;
        const schedule = () => {
            if (voice.canceled || this.muted) return;
            for (const cue of planSkillSoundCues(event)) {
                void this.decodeFile(cue.file).then(buffer => {
                    if (!buffer || voice.canceled || this.muted || context.state !== 'running') return;
                    this.startCue(context, voice.nodes, cue, buffer);
                });
            }
        };
        if (context.state === 'suspended') void context.resume().then(schedule).catch(() => undefined);
        else if (context.state === 'running') schedule();
    }

    private startCue(context: AudioContext, nodes: Array<{ source: AudioBufferSourceNode; gain: GainNode }>, cue: SkillSoundCue, buffer: AudioBuffer): void {
        const elapsed = Date.now() - (cue.at - cue.peakMs);
        // A late decode or a background-tab resume must not replay a missed impact.
        if (Date.now() - cue.at > 80) return;
        const offset = Math.max(0, elapsed / 1000);
        if (offset >= buffer.duration) return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        const startAt = context.currentTime + Math.max(0, -elapsed / 1000);
        gain.gain.value = cue.volume;
        if (offset > 0) {
            gain.gain.setValueAtTime(0, startAt);
            gain.gain.linearRampToValueAtTime(cue.volume, startAt + .002);
        }
        source.connect(gain);
        // Keep simultaneous passive bursts from summing into a clipped, harsh transient.
        gain.connect(this.getMaterialBus(context));
        const node = { source, gain };
        nodes.push(node);
        source.onended = () => {
            source.disconnect(); gain.disconnect();
            const index = nodes.indexOf(node);
            if (index >= 0) nodes.splice(index, 1);
        };
        source.start(startAt, offset);
    }

    cancelSkillFx(id: number): void {
        const timer = this.delayedSkillTimers.get(id);
        if (timer !== undefined) { clearTimeout(timer); this.delayedSkillTimers.delete(id); }
        const voice = this.skillVoices.get(id);
        if (!voice) return;
        voice.canceled = true;
        const context = audioManager.getAudioContext();
        for (const { source, gain } of voice.nodes) {
            try {
                const now = context?.currentTime ?? 0;
                gain.gain.cancelScheduledValues(now);
                gain.gain.setValueAtTime(gain.gain.value, now);
                gain.gain.linearRampToValueAtTime(0, now + .008);
                source.stop(now + .01);
            } catch { /* Already ended. */ }
        }
        this.skillVoices.delete(id);
    }

    retainSkillFx(ids: Set<number>): void {
        for (const id of this.delayedSkillTimers.keys()) if (!ids.has(id)) this.cancelSkillFx(id);
        for (const id of this.skillVoices.keys()) if (!ids.has(id)) this.cancelSkillFx(id);
    }

    cancelSkillSounds(): void {
        for (const id of this.delayedSkillTimers.keys()) this.cancelSkillFx(id);
        for (const id of this.skillVoices.keys()) this.cancelSkillFx(id);
    }

    /** 播放技能专属音效；未收录专属文件的技能回落到共享音效。 */
    playSkill(skillId: string, fallback: SoundName, volume: number = DEFAULT_VOLUME): void {
        const file = SKILL_SOUND_FILES[skillId] ?? SOUND_FILES[fallback];
        const now = Date.now();
        if (file === this.lastSkillSoundFile && now - this.lastSkillSoundAt < SKILL_SOUND_DEDUPE_MS) return;
        this.lastSkillSoundFile = file;
        this.lastSkillSoundAt = now;
        this.playFile(file, volume);
    }
}

export const soundManager = new SoundManager();
