/**
 * 战斗音效管理器
 * - 预加载 public/sounds 下的合成音效
 * - 每次播放新建 Audio 实例，允许技能音效重叠（AOE 多段结算不互相打断）
 * - 静音状态持久化到 localStorage，默认开启
 */

import { SKILL_SOUND_FILES } from '../data/skill-sound-files';

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
    | 'coin';

const SOUND_BASE = `${import.meta.env.BASE_URL ?? '/'}sounds`;
const MUTE_STORAGE_KEY = 'six-chess-battle:sound-muted';
const DEFAULT_VOLUME = 0.45;

const SOUND_FILES: Record<SoundName, string> = {
    slash: 'slash.wav',
    heavy_slash: 'heavy_slash.wav',
    ice: 'ice.wav',
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
};

class SoundManager {
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

    /** 预加载全部音效（浏览器 HTTP 缓存生效后播放零延迟）。 */
    warmup(): void {
        if (this.warmed || typeof window === 'undefined') return;
        this.warmed = true;
        for (const file of [...Object.values(SOUND_FILES), ...Object.values(SKILL_SOUND_FILES)]) {
            const audio = new Audio(`${SOUND_BASE}/${file}`);
            audio.preload = 'auto';
            audio.load();
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

    /** 播放技能专属音效；未收录专属文件的技能回落到共享音效。 */
    playSkill(skillId: string, fallback: SoundName, volume: number = DEFAULT_VOLUME): void {
        const bespoke = SKILL_SOUND_FILES[skillId];
        if (bespoke) {
            this.playFile(bespoke, volume);
            return;
        }
        this.play(fallback, volume);
    }
}

export const soundManager = new SoundManager();
