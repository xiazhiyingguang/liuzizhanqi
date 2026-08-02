import { resolveHeroTemplateId } from '../../data/hero-assets';

interface HeroIconProps {
    heroId: string;
    size?: number;
    className?: string;
}

/*
 * 每个英雄一个独特 SVG 图标，32x32 viewBox
 * 使用 currentColor 以便继承玩家颜色
 */

function MoranIcon() {
    // 墨阑 — 墨笔剑：斜向剑身 + 墨点飞溅
    return (
        <g>
            <line x1="6" y1="26" x2="26" y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="22" y1="10" x2="26" y2="6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <line x1="8" y1="24" x2="5" y2="27" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="28" cy="5" r="1.5" fill="currentColor" opacity="0.6" />
            <circle cx="26" cy="3" r="1" fill="currentColor" opacity="0.4" />
            <circle cx="30" cy="7" r="0.8" fill="currentColor" opacity="0.3" />
        </g>
    );
}

function ZhenxiaoIcon() {
    // 震霄 — 雷电：闪电折线 + 小云朵
    return (
        <g>
            <polyline points="16,2 10,14 18,14 12,30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M4 8 Q6 5 9 7 Q11 4 14 7" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
            <path d="M20 5 Q22 2 25 4 Q27 2 29 5" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
            <circle cx="14" cy="14" r="1.5" fill="currentColor" opacity="0.3" />
        </g>
    );
}

function WukongIcon() {
    // 孙悟空 — 金箍棒 + 王冠
    return (
        <g>
            <line x1="16" y1="12" x2="16" y2="30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M10 6 L13 2 L16 5 L19 2 L22 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="16" cy="9" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <line x1="12" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </g>
    );
}

function NightowlIcon() {
    // 暗影猎手·夜枭 — 猫头鹰：大眼 + 翅膀
    return (
        <g>
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="20" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="20" cy="12" r="1.5" fill="currentColor" />
            <path d="M6 18 Q10 14 16 18 Q22 14 26 18" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <line x1="16" y1="16" x2="16" y2="20" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <path d="M10 20 L16 28 L22 20" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" strokeLinecap="round" />
        </g>
    );
}

function LiuliIcon() {
    // 琉璃 — 玉盾：圆角盾 + 内部翡翠纹理
    return (
        <g>
            <path d="M16 3 L26 8 L26 18 Q26 26 16 30 Q6 26 6 18 L6 8 Z" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M16 8 L21 11 L21 18 Q21 23 16 26 Q11 23 11 18 L11 11 Z" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
            <circle cx="16" cy="16" r="2" fill="currentColor" opacity="0.3" />
        </g>
    );
}

function BaizeIcon() {
    // 白泽 — 神兽角：螺旋角 + 柔和弧线
    return (
        <g>
            <path d="M16 28 Q16 18 12 12 Q8 6 14 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M14 3 Q18 2 20 5 Q22 8 19 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M16 28 Q16 20 20 14 Q24 8 22 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5" />
            <circle cx="16" cy="22" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="14" cy="17" r="1" fill="currentColor" opacity="0.3" />
        </g>
    );
}

function MirrorIcon() {
    // 镜 — 镜像：圆 + 对称分割线
    return (
        <g>
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
            <line x1="16" y1="6" x2="16" y2="26" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
            <path d="M10 12 Q16 8 22 12" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.6" />
            <path d="M10 20 Q16 24 22 20" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.3" />
            <circle cx="13" cy="14" r="1" fill="currentColor" opacity="0.5" />
            <circle cx="19" cy="14" r="1" fill="currentColor" opacity="0.5" />
        </g>
    );
}

function MowenIcon() {
    // 莫问 — 时光剑：表盘 + 剑形指针
    return (
        <g>
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="16" cy="16" r="1.5" fill="currentColor" />
            <line x1="16" y1="16" x2="16" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="16" y1="16" x2="22" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="16" y1="5" x2="16" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
            <line x1="16" y1="25" x2="16" y2="27" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
            <line x1="5" y1="16" x2="7" y2="16" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
            <line x1="25" y1="16" x2="27" y2="16" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
        </g>
    );
}

function GuyingIcon() {
    // 孤影 — 冰晶双剑：交叉剑 + 冰晶点
    return (
        <g>
            <line x1="8" y1="28" x2="24" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="24" y1="28" x2="8" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="10" cy="6" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="22" cy="6" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="16" cy="16" r="2" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
            <line x1="5" y1="10" x2="7" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.3" />
            <line x1="25" y1="10" x2="27" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.3" />
            <line x1="5" y1="22" x2="7" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.3" />
            <line x1="25" y1="22" x2="27" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        </g>
    );
}

/* 通用/默认图标 */
function DefaultIcon() {
    return (
        <g>
            <circle cx="16" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M8 28 Q8 20 16 18 Q24 20 24 28" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </g>
    );
}

const iconMap: Record<string, () => JSX.Element> = {
    moran: () => <MoranIcon />,
    zhenxiao: () => <ZhenxiaoIcon />,
    wukong: () => <WukongIcon />,
    nightowl: () => <NightowlIcon />,
    liuli: () => <LiuliIcon />,
    baize: () => <BaizeIcon />,
    mirror: () => <MirrorIcon />,
    mowen: () => <MowenIcon />,
    guying: () => <GuyingIcon />,
};

export default function HeroIcon({ heroId, size = 32, className = '' }: HeroIconProps) {
    const baseId = resolveHeroTemplateId(heroId) ?? heroId;

    const IconComponent = iconMap[baseId] || (() => <DefaultIcon />);

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            className={className}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <IconComponent />
        </svg>
    );
}
