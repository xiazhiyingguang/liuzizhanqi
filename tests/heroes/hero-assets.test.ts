import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    getHeroAvatarUrl,
    getHeroFullBodyUrl,
    HERO_ASSET_IDS,
    HERO_ASSETS,
    resolveHeroTemplateId,
} from '../../src/data/hero-assets';

describe('hero image assets', () => {
    it('annotates 30 unique avatar and full-body image pairs', () => {
        expect(HERO_ASSET_IDS).toHaveLength(30);
        expect(new Set(HERO_ASSET_IDS).size).toBe(30);

        for (const heroId of HERO_ASSET_IDS) {
            const asset = HERO_ASSETS[heroId];
            expect(existsSync(resolve('public', asset.avatar.replace(/^\//, '')))).toBe(true);
            expect(existsSync(resolve('public', asset.fullBody.replace(/^\//, '')))).toBe(true);
        }
    });

    it('resolves deployed hero IDs and clone IDs to their portraits', () => {
        expect(resolveHeroTemplateId('moran-player1-1785423305834')).toBe('moran');
        expect(resolveHeroTemplateId('soul_lamp-player2-1785423305834')).toBe('soul_lamp');
        expect(resolveHeroTemplateId('wukong-clone|owner|1|0.5')).toBe('wukong');
        expect(resolveHeroTemplateId('mirror-clone|owner|1|0.5')).toBe('mirror');
        expect(getHeroAvatarUrl('moran-player1-1785423305834')).toBe('/hero-images/avatars/moran.png');
    });

    it('returns no image for heroes whose artwork has not been supplied', () => {
        expect(getHeroAvatarUrl('schrodinger')).toBeUndefined();
        expect(getHeroFullBodyUrl('schrodinger')).toBeUndefined();
        expect(getHeroAvatarUrl('t-summon|jinwu|owner|1|0.5')).toBeUndefined();
    });
});
