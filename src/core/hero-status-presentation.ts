import type { Effect } from '../types/game';

export function effectDurationLabel(effect: Effect): string {
    if (effect.duration < 0) return '永久';
    return `剩余 ${effect.duration} 回合`;
}
