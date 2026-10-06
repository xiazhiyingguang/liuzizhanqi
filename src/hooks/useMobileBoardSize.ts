import { useEffect, type RefObject } from 'react';
import { MOBILE_LAYOUT_QUERY } from './useMobileLayout';

/** 从棋盘实际可用的容器尺寸取格宽，包含六格间距和棋框留白。 */
export function useMobileBoardSize(ref: RefObject<HTMLDivElement>) {
    useEffect(() => {
        const container = ref.current;
        if (!container) return;
        const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
        const resize = () => {
            if (!media.matches) {
                container.style.removeProperty('--board-cell-size');
                return;
            }
            const available = Math.min(container.clientWidth, container.clientHeight);
            // 框内 padding 6×2、边框2、格子 gap 6×5，再留2px防止小数舍入。
            container.style.setProperty('--board-cell-size', `${Math.max(1, Math.floor((available - 46) / 6))}px`);
        };
        let observer: ResizeObserver | undefined;
        const sync = () => {
            observer?.disconnect();
            observer = undefined;
            if (media.matches) {
                observer = new ResizeObserver(resize);
                observer.observe(container);
            }
            resize();
        };
        media.addEventListener('change', sync);
        sync();
        return () => {
            observer?.disconnect();
            media.removeEventListener('change', sync);
            container.style.removeProperty('--board-cell-size');
        };
    }, [ref]);
}
