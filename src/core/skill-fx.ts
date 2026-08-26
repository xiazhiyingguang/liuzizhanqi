/**
 * 英雄技能特效档案（技能级定制）。
 *
 * 档案精确到"英雄 × 技能"：每个技能有专属的视觉方案（kind）与时长。
 * 档案以裸技能 ID 为键（如 `wukong_skill1`）——运行时 Hero.id 形如
 * `wukong-player1-<时间戳>`，不能直接用作键；而技能 ID 全局唯一且
 * 按约定 `${heroId}_skill${n}` 命名，未命中技能级档案时可由技能 ID
 * 推导英雄 ID 查英雄级兜底，最后回落通用墨韵波纹。
 *
 * 特效信号由 game-store 的 executeSkill 包装层在"真实施法成功"时派发
 * （本地玩家、人机 AI、联机远端动作重放共用同一条入口，因此所有对局
 * 形态下特效表现一致，无需额外网络消息）。Board 在起手格与目标格内
 * 渲染 SkillFxVisual，动画结束后由生命周期组件统一回收事件。
 *
 * 方向约定（屏幕坐标，row 向下）：
 * - angleDeg：atan2(dy, dx) 的顺时针角度，0=右、90=下、±180=左、-90=上，
 *   与 CSS rotate() 的旋转方向一致，可直接用于旋转对齐；
 * - direction：angleDeg 按 45° 扇区量化的八向标签。
 */
import type { Player, Position } from '../types/game';

/** 技能特效视觉方案 */
export type SkillFxKind =
    | 'wukong-clone'    // 悟空·毫毛化分身：毫毛飘落 + 烟雾绽开 + 光柱闪现
    | 'wukong-staff'    // 悟空·金箍棒砸击：循攻击方向落棒 + 冲击波 + 尘土
    | 'feixue-blade'    // 绯雪·霜刃破阵：冰蓝光刃斜掠 + 碎冰飞溅
    | 'feixue-stomp'    // 绯雪·踏雪追命：大雪花压落 + 冰环扩散
    | 'soul-lamp-array' // 缚魂灯·暗夜法阵：双环法阵 + 幽绿光柱 + 鬼火
    | 'soul-lamp-cycle' // 缚魂灯·缚魂轮转：交错轮环 + 灯焰摇曳
    | 'libai-slash'     // 太白·醉剑：青白剑光速闪 + 酒气光点
    | 'libai-flurry'    // 太白·剑气纵横：三道剑气连闪
    | 'feynman-beam'    // 费曼·粒子束：直线光束 + 着弹火花
    | 'feynman-burst'   // 费曼·粒子轰爆：中心爆发 + 双粒子环
    | 'ink';            // 默认兜底：墨韵波纹

/** 单个技能的特效档案 */
export interface SkillFxProfile {
    kind: SkillFxKind;
    durationMs: number;
}

/** 攻击方向的八向标签 */
export type SkillFxDirection = 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE';

/** 一次技能施放的瞬态特效事件（仅本地视觉层使用，不参与联机状态同步） */
export interface SkillFxEvent {
    id: number;
    profile: SkillFxProfile;
    owner: Player;
    /** 施法者所在格（快照于施法前，移动/瞬移类技能不受影响） */
    fromPos: Position;
    targetPos: Position;
    /** from→target 攻击角度（CSS 顺时针 deg：0=右 90=下 ±180=左 -90=上） */
    angleDeg: number;
    direction: SkillFxDirection;
    /** 派发时刻，用于生命周期组件精确计算剩余存活时间 */
    bornAt: number;
}

/** 技能级档案（键为裸技能 ID） */
export const SKILL_FX_PROFILES: Record<string, SkillFxProfile> = {
    wukong_skill1: { kind: 'wukong-clone', durationMs: 1300 },
    wukong_skill2: { kind: 'wukong-staff', durationMs: 980 },
    feixue_skill1: { kind: 'feixue-blade', durationMs: 900 },
    feixue_skill2: { kind: 'feixue-stomp', durationMs: 1000 },
    soul_lamp_skill1: { kind: 'soul-lamp-array', durationMs: 1250 },
    soul_lamp_skill2: { kind: 'soul-lamp-cycle', durationMs: 1150 },
    libai_skill1: { kind: 'libai-slash', durationMs: 800 },
    libai_skill2: { kind: 'libai-flurry', durationMs: 1000 },
    feynman_skill1: { kind: 'feynman-beam', durationMs: 900 },
    feynman_skill2: { kind: 'feynman-burst', durationMs: 1000 },
};

/** 英雄级兜底档案（该英雄的技能未逐一定制时） */
const HERO_FX_FALLBACKS: Record<string, SkillFxProfile> = {
    wukong: { kind: 'wukong-staff', durationMs: 980 },
    feixue: { kind: 'feixue-stomp', durationMs: 1000 },
    soul_lamp: { kind: 'soul-lamp-array', durationMs: 1250 },
    libai: { kind: 'libai-slash', durationMs: 800 },
    feynman: { kind: 'feynman-burst', durationMs: 1000 },
};

const DEFAULT_SKILL_FX_PROFILE: SkillFxProfile = { kind: 'ink', durationMs: 750 };

/** 从技能 ID 推导英雄模板 ID（`wukong_skill1` → `wukong`） */
function heroIdFromSkillId(skillId: string): string {
    return skillId.replace(/_skill\d+$/, '');
}

/** 解析技能特效档案：先查技能级，再查英雄级兜底，最后回落通用墨韵波纹 */
export function resolveSkillFx(skillId?: string): SkillFxProfile {
    if (skillId) {
        const exact = SKILL_FX_PROFILES[skillId];
        if (exact) return exact;
        const heroFallback = HERO_FX_FALLBACKS[heroIdFromSkillId(skillId)];
        if (heroFallback) return heroFallback;
    }
    return DEFAULT_SKILL_FX_PROFILE;
}

/**
 * 计算 from→target 的攻击角度（CSS 顺时针 deg）。
 * 屏幕坐标 row 向下，因此 atan2(dy, dx) 的结果与 CSS rotate 一致：
 * 0=右、90=下、±180=左、-90=上。
 */
export function computeFxAngleDeg(from: Position, to: Position): number {
    const dx = to[1] - from[1];
    const dy = to[0] - from[0];
    if (dx === 0 && dy === 0) return 0;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
}

const DIRECTION_ORDER: readonly SkillFxDirection[] = [
    'E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE',
] as const;

/** 把角度量化为八向标签（45° 扇区） */
export function computeFxDirection(angleDeg: number): SkillFxDirection {
    const normalized = ((angleDeg % 360) + 360) % 360;
    return DIRECTION_ORDER[Math.round(normalized / 45) % 8];
}
