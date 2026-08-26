/**
 * 英雄技能特效档案。
 *
 * 特效信号由 game-store 的 executeSkill 包装层在"真实施法成功"时派发
 * （本地玩家、人机 AI、联机远端动作重放共用同一条入口，因此所有对局
 * 形态下特效表现一致，无需额外网络消息）。Board 在起手格与目标格内
 * 渲染 SkillFxVisual，动画结束后由生命周期组件统一回收事件。
 */
import type { Player, Position } from '../types/game';

/** 特效风格类别：首批五位定制英雄 + 默认墨韵兜底 */
export type SkillFxKind = 'wukong' | 'feixue' | 'soul-lamp' | 'libai' | 'feynman' | 'ink';

/** 单个英雄的特效档案：kind 决定视觉方案，durationMs 决定事件存活时长 */
export interface SkillFxProfile {
    kind: SkillFxKind;
    durationMs: number;
}

/** 一次技能施放的瞬态特效事件（仅本地视觉层使用，不参与联机状态同步） */
export interface SkillFxEvent {
    id: number;
    profile: SkillFxProfile;
    owner: Player;
    /** 施法者所在格（快照于施法前，移动/瞬移类技能不受影响） */
    fromPos: Position;
    targetPos: Position;
    /** 派发时刻，用于生命周期组件精确计算剩余存活时间 */
    bornAt: number;
}

/** 首批重点英雄的专属特效映射（键为英雄 ID） */
export const SKILL_FX_PROFILES: Record<string, SkillFxProfile> = {
    // 孙悟空：金色棍风斜斩 + 分身残影
    wukong: { kind: 'wukong', durationMs: 950 },
    // 绯雪：冰晶绽放
    feixue: { kind: 'feixue', durationMs: 1000 },
    // 缚魂灯：幽绿鬼火 + 符文法阵
    soul_lamp: { kind: 'soul-lamp', durationMs: 1150 },
    // 李太白：青白剑气三连闪
    libai: { kind: 'libai', durationMs: 900 },
    // 费曼：紫金粒子环爆发
    feynman: { kind: 'feynman', durationMs: 850 },
};

/** 未定制英雄的兜底档案：墨韵波纹 */
const DEFAULT_SKILL_FX_PROFILE: SkillFxProfile = { kind: 'ink', durationMs: 750 };

/** 解析英雄的技能特效档案；未定制的英雄回落到墨韵波纹兜底 */
export function resolveSkillFx(heroId: string): SkillFxProfile {
    return SKILL_FX_PROFILES[heroId] ?? DEFAULT_SKILL_FX_PROFILE;
}
