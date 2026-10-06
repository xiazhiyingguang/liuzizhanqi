import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HERO_ASSETS } from '../../src/data/hero-assets';
import { SUMMON_IMAGE_MANIFEST } from '../../src/data/summon-image-manifest';

describe('summon portrait assets', () => {
    it('covers every available portrait, including aliases and overrides, with a small WebP', () => {
        for (const asset of Object.values(HERO_ASSETS)) {
            const optimized = SUMMON_IMAGE_MANIFEST[asset.fullBody];
            expect(optimized, asset.fullBody).toMatch(/\.webp$/);
            const file = resolve('public', optimized.slice(1));
            expect(existsSync(file), file).toBe(true);
            expect(statSync(file).size).toBeLessThan(250_000);
        }
    });
});
