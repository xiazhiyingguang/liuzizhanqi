import { describe, expect, it } from 'vitest';
import { effectDurationLabel } from '../../src/core/hero-status-presentation';

describe('hero status popover', () => {
    it('正确展示永久和限时状态的持续时间', () => {
        expect(effectDurationLabel({
            id: 'permanent',
            type: 'buff',
            name: '永久增益',
            duration: -1,
            sourceHeroId: 'hero-a'
        })).toBe('永久');

        expect(effectDurationLabel({
            id: 'temporary',
            type: 'debuff',
            name: '限时减益',
            duration: 2,
            sourceHeroId: 'hero-b'
        })).toBe('剩余 2 回合');
    });
});
