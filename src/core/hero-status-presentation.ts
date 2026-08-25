import type { Effect, Hero } from '../types/game';

export function effectDurationLabel(effect: Effect): string {
    if (effect.duration < 0) return '永久';
    return `剩余 ${effect.duration} 回合`;
}

/** 效果类型徽章文案 */
export function effectTypeLabel(effect: Effect): string {
    switch (effect.type) {
        case 'buff': return '增益';
        case 'debuff': return '减益';
        case 'stun': return '眩晕';
        case 'control': return '控制';
        case 'shield': return '护盾';
        default: return '标记';
    }
}

/**
 * 合并展示层重复的效果条目：引擎允许同名同源效果以多条独立记录存在
 * （EffectManager.addEffect 仅在带 stackCount 时合并，其余场景会 push 新记录），
 * 信息卡按「名称+类型+来源」归并——层数求和、时长取最长（永久优先）、描述取首个非空，
 * 避免同一状态显示两次。仅影响展示，不改战斗结算。
 */
export function mergeDuplicateEffects(effects: Effect[]): Effect[] {
    const merged = new Map<string, Effect>();
    for (const effect of effects) {
        const key = `${effect.name}|${effect.type}|${effect.sourceHeroId}`;
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { ...effect });
            continue;
        }
        existing.stackCount = (existing.stackCount ?? 1) + (effect.stackCount ?? 1);
        if (effect.duration < 0 || existing.duration < 0) existing.duration = -1;
        else existing.duration = Math.max(existing.duration, effect.duration);
        if (!existing.description && effect.description) existing.description = effect.description;
    }
    return [...merged.values()];
}

/** 玩家向计数器均为中文命名；英文键与 __ 前缀是引擎内部标记，不对外展示 */
function isVisibleCounterKey(key: string): boolean {
    if (key.startsWith('__')) return false;
    return /[\u4e00-\u9fff]/.test(key);
}

export function visibleCounterEntries(hero: Hero): Array<{ label: string; value: number }> {
    return Object.entries(hero.counters ?? {})
        .filter(([key, value]) => isVisibleCounterKey(key) && value > 0)
        .map(([key, value]) => ({ label: key, value }));
}

export function formatPercent(fraction: number): string {
    return `${Math.round(fraction * 100)}%`;
}
