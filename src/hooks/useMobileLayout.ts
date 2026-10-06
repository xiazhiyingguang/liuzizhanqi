import { useSyncExternalStore } from 'react';

// 与 mobile-layout.css 保持一致：桌面缩窄窗口仍使用原来的桌面布局。
export const MOBILE_LAYOUT_QUERY = '(pointer: coarse) and (max-width: 1023px)';

function subscribe(onChange: () => void) {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
}

export function useMobileLayout() {
    return useSyncExternalStore(subscribe,
        () => window.matchMedia(MOBILE_LAYOUT_QUERY).matches, () => false);
}
