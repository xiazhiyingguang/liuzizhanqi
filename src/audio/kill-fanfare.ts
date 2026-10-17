/**
 * 连杀号角的编曲表（纯数据，可单测）。
 *
 * 只给五杀与六杀配号角：一到四杀保持静音，让"突然有声音"本身成为破格的信号。
 * 音高取五声音阶（宫-角-徵-羽-清宫…）逐级上行，贴合水墨题材；六杀再叠一口钟，
 * 因为每方只有 6 名英雄，六杀在规则上就是整队清空，值得一个能拖住尾巴的音。
 */

export interface FanfareNote {
    /** 基频 Hz */
    freq: number;
    /** 相对号角起点的延迟 ms */
    atMs: number;
    /** 发声时长 ms */
    durMs: number;
    gain: number;
}

export interface FanfareHit {
    atMs: number;
    gain: number;
}

export interface KillFanfarePlan {
    notes: FanfareNote[];
    drums: FanfareHit[];
    bell?: FanfareNote;
}

/** 低于这个档位不出号角 */
export const KILL_FANFARE_MIN_TIER = 5;

const PENTA_NOTES: FanfareNote[] = [
    { freq: 523.25, atMs: 0, durMs: 300, gain: 0.15 },      // 宫
    { freq: 659.25, atMs: 95, durMs: 300, gain: 0.15 },     // 角
    { freq: 783.99, atMs: 190, durMs: 320, gain: 0.16 },    // 徵
    { freq: 1046.5, atMs: 285, durMs: 420, gain: 0.18 },    // 清宫
];

const HEXA_NOTES: FanfareNote[] = [
    ...PENTA_NOTES.slice(0, 3),
    { freq: 1046.5, atMs: 285, durMs: 300, gain: 0.17 },    // 清宫
    { freq: 1318.5, atMs: 380, durMs: 480, gain: 0.2 },     // 清角，比五杀再高一档
];

const PLANS: Record<string, KillFanfarePlan> = {
    5: {
        notes: PENTA_NOTES,
        drums: [{ atMs: 0, gain: 0.2 }, { atMs: 285, gain: 0.22 }],
    },
    6: {
        notes: HEXA_NOTES,
        drums: [{ atMs: 0, gain: 0.22 }, { atMs: 380, gain: 0.26 }],
        // 钟：非谐波泛音由渲染层叠出，这里只给基频与余韵长度
        bell: { freq: 1567.98, atMs: 470, durMs: 1600, gain: 0.09 },
    },
};

/** 该档位的号角编曲；不到五杀返回 null，调用方直接不响 */
export function planKillFanfare(tier: number): KillFanfarePlan | null {
    if (!Number.isFinite(tier) || tier < KILL_FANFARE_MIN_TIER) return null;
    return PLANS[Math.min(tier, 6)] ?? null;
}
