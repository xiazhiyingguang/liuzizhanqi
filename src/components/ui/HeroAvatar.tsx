import { useState } from 'react';
import { getHeroAvatarUrl } from '../../data/hero-assets';
import HeroIcon from './HeroIcon';

interface HeroAvatarProps {
    heroId: string;
    heroName?: string;
    size?: number;
    className?: string;
    fallbackClassName?: string;
    eager?: boolean;
}

export default function HeroAvatar({
    heroId,
    heroName,
    size = 40,
    className = '',
    fallbackClassName = '',
    eager = false,
}: HeroAvatarProps) {
    const [failed, setFailed] = useState(false);
    const imageUrl = getHeroAvatarUrl(heroId);

    if (!imageUrl || failed) {
        return (
            <HeroIcon
                heroId={heroId}
                size={Math.round(size * 0.58)}
                className={fallbackClassName}
            />
        );
    }

    return (
        <img
            src={imageUrl}
            alt={heroName ? `${heroName}头像` : ''}
            width={size}
            height={size}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            className={className}
            onError={() => setFailed(true)}
        />
    );
}
