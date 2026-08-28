export const HERO_ASSET_IDS = [
    'moran',
    'zhenxiao',
    'huifeng',
    'wukong',
    'xuanxiao',
    'nightowl',
    'liuli',
    'baize',
    'changli',
    'mirror',
    'mowen',
    'guying',
    'skeletonking',
    'jetzmi',
    'pipa',
    'bounty',
    'yinyang',
    'soul_lamp',
    'hero_x',
    'bard',
    'wither_lord',
    't_painting',
    'feynman',
    'wangcai',
    'lilith',
    'luna',
    'zhenyue',
    'daier',
    'yaozhan',
    'hanjiangxue',
    'libai',
    'fengling',
    'feixue',
    'dilan',
    'shangguan',
    'nanfeng',
    'yousun',
] as const;

export type HeroAssetId = typeof HERO_ASSET_IDS[number];

export interface HeroAsset {
    avatar: string;
    fullBody: string;
}

const HERO_ASSET_ID_SET = new Set<string>(HERO_ASSET_IDS);

/** 英雄模板 ID 与图片资产文件名不一致时的映射（南风游隼等新英雄图沿用立绘师命名） */
const TEMPLATE_ASSET_ALIASES: Record<string, HeroAssetId> = {
    youjun: 'yousun',
    chenyuan: 'zhenyue',
    dai: 'daier',
};

export const HERO_ASSETS: Record<HeroAssetId, HeroAsset> = Object.fromEntries(
    HERO_ASSET_IDS.map(heroId => [
        heroId,
        heroId === 'fengling' ? {
            avatar: '/others/full-body/shamozhinu.png',
            fullBody: '/others/full-body/shamozhinu.png',
        } : {
            avatar: `/hero-images/avatars/${heroId}.png`,
            fullBody: `/hero-images/full-body/${heroId}.png`,
        },
    ])
) as Record<HeroAssetId, HeroAsset>;

/**
 * Converts a deployed hero, clone, or template ID to the stable template ID
 * used by the image library.
 */
export function resolveHeroTemplateId(heroId: string): HeroAssetId | undefined {
    if (heroId.startsWith('wukong-clone|')) return 'wukong';
    if (heroId.startsWith('mirror-clone|')) return 'mirror';

    if (HERO_ASSET_ID_SET.has(heroId)) return heroId as HeroAssetId;

    // 模板 ID 与资产 ID 不同的英雄（含部署后的带后缀 ID，如 dai-player1-xxx）
    for (const [templateId, assetId] of Object.entries(TEMPLATE_ASSET_ALIASES)) {
        if (
            heroId === templateId ||
            heroId.startsWith(`${templateId}-player1-`) ||
            heroId.startsWith(`${templateId}-player2-`)
        ) {
            return assetId;
        }
    }

    const templateId = HERO_ASSET_IDS.find(candidate =>
        heroId.startsWith(`${candidate}-player1-`) ||
        heroId.startsWith(`${candidate}-player2-`)
    );
    return templateId;
}

export function getHeroAvatarUrl(heroId: string): string | undefined {
    const templateId = resolveHeroTemplateId(heroId);
    return templateId ? HERO_ASSETS[templateId].avatar : undefined;
}

export function getHeroFullBodyUrl(heroId: string): string | undefined {
    const templateId = resolveHeroTemplateId(heroId);
    return templateId ? HERO_ASSETS[templateId].fullBody : undefined;
}
