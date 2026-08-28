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
    it('annotates Feixue and keeps every avatar/full-body pair unique', () => {
        expect(HERO_ASSET_IDS).toContain('feixue');
        expect(new Set(HERO_ASSET_IDS).size).toBe(HERO_ASSET_IDS.length);

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
        expect(getHeroAvatarUrl('feixue-player1-1785423305834')).toBe('/hero-images/avatars/feixue.png');
    });

    it('resolves new hero artwork (nanfeng, yousun, daier, zhenyue) to their portraits', () => {
        // 南风：模板 ID 与资产 ID 一致
        expect(getHeroAvatarUrl('nanfeng')).toBe('/hero-images/avatars/nanfeng.png');
        expect(getHeroFullBodyUrl('nanfeng-player1-1785423305834')).toBe('/hero-images/full-body/nanfeng.png');

        // 游隼：模板 ID youjun → 资产 yousun（技能尚未实现，未入册，仅资产就位）
        expect(resolveHeroTemplateId('youjun')).toBe('yousun');
        expect(resolveHeroTemplateId('youjun-player2-1785423305834')).toBe('yousun');
        expect(getHeroAvatarUrl('youjun-player1-1785423305834')).toBe('/hero-images/avatars/yousun.png');

        // 沉渊·镇岳：模板 ID chenyuan → 资产 zhenyue
        expect(resolveHeroTemplateId('chenyuan')).toBe('zhenyue');
        expect(resolveHeroTemplateId('chenyuan-player2-1785423305834')).toBe('zhenyue');
        expect(getHeroFullBodyUrl('chenyuan-player1-1785423305834')).toBe('/hero-images/full-body/zhenyue.png');

        // 时空旅者·戴尔：模板 ID dai → 资产 daier
        expect(resolveHeroTemplateId('dai')).toBe('daier');
        expect(resolveHeroTemplateId('dai-player1-1785423305834')).toBe('daier');
        expect(getHeroAvatarUrl('dai-player2-1785423305834')).toBe('/hero-images/avatars/daier.png');
    });

    it('returns no image for heroes whose artwork has not been supplied', () => {
        expect(getHeroAvatarUrl('schrodinger')).toBeUndefined();
        expect(getHeroFullBodyUrl('schrodinger')).toBeUndefined();
        expect(getHeroAvatarUrl('t-summon|jinwu|owner|1|0.5')).toBeUndefined();
    });
});
