/**
 * 游龙扫击与冲刺的视觉几何（纯函数，特效层与单测共用同一份算法）。
 *
 * 游龙扫的是本体周围 8 格外圈的顺时针 4 步（含起点共 5 格），所以画面上龙首必须
 * 从起点格出发、沿切线顺时针爬完整段路，而不是在中心格原地转个圈——
 * 玩家要能顺着龙身数出它这一拍扫了哪几格，才看得出"半圈"这个账。
 * 贴边时仍按原始角度排拍，盘外部分裁切，不能让后续命中提前。
 */
import { BOARD_SIZE, type Position } from '../types/game';

/** 龙首起爬前留给"聚气"的那半拍 */
export const DRAGON_SWEEP_LEAD_MS = 140;
/** 龙首沿外圈爬过一格用的毫秒数（命中格的爆点也按这一拍逐格错开） */
export const DRAGON_SWEEP_STEP_MS = 180;
/** 冲刺与盘旋共用"一格一拍"的节拍，玩家才读得出是同一尾龙在动 */
export const DRAGON_DASH_LAUNCH_MS = 100;
export const DRAGON_DASH_STEP_MS = 200;
export const DRAGON_DASH_LEAD_MS = DRAGON_DASH_LAUNCH_MS + DRAGON_DASH_STEP_MS;
export function dragonDashTiming(steps: number) {
    const travelMs = Math.max(1, steps) * DRAGON_DASH_STEP_MS;
    const landingMs = DRAGON_DASH_LAUNCH_MS + travelMs;
    return { launchMs: DRAGON_DASH_LAUNCH_MS, travelMs, landingMs, sweepDelayMs: landingMs + 60 };
}
/** 唤龙：龙先自云里探起身，随后才把十字气浪一格格扫开 */
export const DRAGON_CALL_LEAD_MS = 320;
export const DRAGON_CALL_STEP_MS = 100;
/** 外圈一格 = 45°（八格凑成一整圈） */
export const RING_STEP_DEG = 45;
export const ORBIT_RING_CELLS = 8;

/** 一次扫击的全部视觉参数 */
export interface DragonSweepGeometry {
    /** 龙首的出发点方位角（顺时针自 12 点起算，可直接喂 CSS rotate） */
    startDeg: number;
    /** 真正的半圈，不再为龙尾额外转一格。 */
    sweepDeg: number;
    /** 巡行动画时长：四步走完半圈，贴边时也保持同一角速度 */
    spinMs: number;
    /** 拖痕弧长（SVG pathLength=100 的百分比） */
    arcPercent: number;
    /** 贴盘边裁掉的格数（上/右/下/左，单位是格距） */
    clip: { t: number; r: number; b: number; l: number };
}

/** 只用到事件里的三个坐标字段，SkillFxEvent 与预览事件都能直接喂进来 */
type SweepSource = {
    fromPos: Position;
    targetPos: Position;
    coveredPositions?: Position[];
    dragonStartDeg?: number;
};

/** 外圈格子相对本体的方位角：顺时针自 12 点起算，与 CSS rotate 同向 */
export function orbitBearingDeg(center: Position, cell: Position): number {
    const dr = cell[0] - center[0];
    const dc = cell[1] - center[1];
    if (dr === 0 && dc === 0) return 0;
    // atan2 给的是 (-180,180]，折成 0~359 才能直接当 CSS rotate 的起点
    return (Math.atan2(dc, -dr) * 180 / Math.PI + 360) % 360;
}

/** 顺时针从 from 转到 to 要过的角度（0~359） */
export function clockwiseDiffDeg(from: number, to: number): number {
    return ((to - from) % 360 + 360) % 360;
}

/**
 * 这一拍游龙的巡行动画参数。
 * 龙头从起点走到对面，恰好 180°；龙尾以淡出收势，不追加角度。
 */
export function dragonSweepGeometry(event: SweepSource): DragonSweepGeometry {
    const center = event.fromPos;
    const leg = event.coveredPositions ?? [];
    const first = leg[0] ?? event.targetPos;
    const startDeg = event.dragonStartDeg ?? orbitBearingDeg(center, first);
    const sweepDeg = 180;
    return {
        startDeg,
        sweepDeg,
        spinMs: Math.round((sweepDeg / RING_STEP_DEG) * DRAGON_SWEEP_STEP_MS),
        arcPercent: Math.round((sweepDeg / 360) * 1000) / 10,
        clip: {
            t: Math.max(0, 1 - center[0]),
            r: Math.max(0, center[1] - (BOARD_SIZE - 2)),
            b: Math.max(0, center[0] - (BOARD_SIZE - 2)),
            l: Math.max(0, 1 - center[1]),
        },
    };
}

/** 按原始方位计时，贴边过滤掉的格子不能把后续命中提前。 */
export function dragonSweepCellHitMs(event: SweepSource, cell: Position): number {
    const start = dragonSweepGeometry(event).startDeg;
    return dragonSweepHitMs(clockwiseDiffDeg(start, orbitBearingDeg(event.fromPos, cell)) / RING_STEP_DEG);
}

/** 常驻龙影的朝向：方位序号 × 45°（序号单调递增，所以补间只会顺时针转） */
export function dragonCoilBearingDeg(index: number): number {
    return (Number.isFinite(index) ? index : 0) * RING_STEP_DEG;
}

/** 第 order 格（0 为路径首格）被龙首扫到的时刻 */
export function dragonSweepHitMs(order: number): number {
    return DRAGON_SWEEP_LEAD_MS + Math.max(0, order) * DRAGON_SWEEP_STEP_MS;
}

/** 冲刺路径上第 order 格被穿过的时刻 */
export function dragonDashHitMs(order: number): number {
    return DRAGON_DASH_LEAD_MS + Math.max(0, order) * DRAGON_DASH_STEP_MS;
}

/** 唤龙时第 order 格（0 是外圈正上方那一格，顺时针数）被龙首扫到的时刻 */
export function dragonCallHitMs(order: number): number {
    return DRAGON_CALL_LEAD_MS + Math.max(0, order) * DRAGON_CALL_STEP_MS;
}

/**
 * 唤龙·盘云的巡行几何：龙在**召唤格**外围那一圈转满一整圈（8 格 × 45° = 360°）。
 * 与绕身盘旋共用同一套环参数，只是圆心换成玩家点中的那一格、角度换成整圈——
 * 机制上这一拍仍只结算十字四格，斜向那四格是"龙过去了但没扫到人"。
 */
export function dragonCallRingGeometry(): Pick<DragonSweepGeometry, 'startDeg' | 'sweepDeg' | 'spinMs' | 'arcPercent'> {
    const cells = ORBIT_RING_CELLS;
    const sweepDeg = cells * RING_STEP_DEG;
    return {
        startDeg: 0,
        sweepDeg,
        spinMs: cells * DRAGON_CALL_STEP_MS,
        arcPercent: 100,
    };
}
