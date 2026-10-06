import { AVAILABLE_HERO_IDS, HIDDEN_HERO_IDS, getHeroInfo } from './heroes';

/**
 * 已备好立绘的资产表。加进来就必须两个目录都有同名图——
 * tests/heroes/hero-assets.test.ts 会逐个 existsSync 校验，指向空气的条目过不了测试。
 */
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
    'xubai',
    'lingxi',
    'xueqi',
    'yunying',
    'jinghong',
    'jinghua',
    'zhiguang',
    'zuizhendao',
    'wangshu',
    'huanongying',
    'zhiyuan',
    'jiangtaigong',
    'duosui',
    'xihuan',
] as const;

export type HeroAssetId = typeof HERO_ASSET_IDS[number];

export interface HeroAsset {
    avatar: string;
    fullBody: string;
}

const HERO_ASSET_ID_SET = new Set<string>(HERO_ASSET_IDS);

/** 模板 ID → 资产 ID 的别名（游隼/沉渊/戴尔的模板名与资产编号不同源）。只影响 resolveHeroTemplateId 的键，与文件名无关 */
const TEMPLATE_ASSET_ALIASES: Record<string, HeroAssetId> = {
    youjun: 'yousun',
    chenyuan: 'zhenyue',
    dai: 'daier',
};

/**
 * 图片文件名直接用游戏内显示名（长离.png、暗影猎手·夜枭.png）：
 * 换立绘时按角色名丢文件即可，不用再去记模板 ID 与拼音文件名的对应关系。
 * 只对得到真实模板的英雄取名——getHeroInfo 对未知 ID 返回"未知"，
 * 若不加这层过滤，luna / yaozhan 这类退役资产会撞成同一个"未知.png"。
 */
/**
 * 图片文件名直接用游戏内显示名（长离.png、暗影猎手·夜枭.png）：
 * 换立绘时按角色名丢文件即可，不用再去记模板 ID 与拼音文件名的对应关系。
 * 只对得到真实模板的英雄取名——getHeroInfo 对未知 ID 返回"未知"，
 * 若不加这层过滤，luna / yaozhan 这类退役资产会撞成同一个"未知.png"。
 * 暂时下架的英雄也要算进来：HIDDEN_HERO_IDS 只是不进选将池，立绘、图鉴与旧对局回放
 * 仍然要能解析到原文件名，漏掉就会退化成 hero_x.png 这种指向空气的路径。
 */
const IMAGE_FILE_NAMES: Partial<Record<HeroAssetId, string>> = Object.fromEntries(
    [...AVAILABLE_HERO_IDS, ...HIDDEN_HERO_IDS].map(templateId => [
        TEMPLATE_ASSET_ALIASES[templateId] ?? templateId,
        getHeroInfo(templateId).name,
    ] as const)
);

/** 资产 ID 对应的图片文件名（不含目录与扩展名） */
export function getHeroImageFileName(assetId: HeroAssetId): string {
    return IMAGE_FILE_NAMES[assetId] ?? assetId;
}

/**
 * 两个槽位共用同一张图的例外：风铃的图还在 /others 下，
 * 醉枕刀目前只交付了一张头像尺寸的立绘，图鉴先用它顶上，补出全身图后删掉这条即可。
 */
const ASSET_PATH_OVERRIDES: Partial<Record<HeroAssetId, HeroAsset>> = {
    fengling: {
        avatar: '/others/full-body/shamozhinu.png',
        fullBody: '/others/full-body/shamozhinu.png',
    },
    zuizhendao: {
        avatar: '/hero-images/avatars/醉枕刀.png',
        fullBody: '/hero-images/avatars/醉枕刀.png',
    },
};

export const HERO_ASSETS: Record<HeroAssetId, HeroAsset> = Object.fromEntries(
    HERO_ASSET_IDS.map(heroId => [
        heroId,
        ASSET_PATH_OVERRIDES[heroId] ?? {
            // 存原文而非 percent-encoding：URL 要能直接当文件路径校验（tests/heroes/hero-assets.test.ts
            // 用 existsSync 断言图不会凭空指向空气），发请求时浏览器自己会转义
            avatar: `/hero-images/avatars/${getHeroImageFileName(heroId)}.png`,
            fullBody: `/hero-images/full-body/${getHeroImageFileName(heroId)}.png`,
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
