import { useEffect, useState } from 'react';
import { hasCoarsePointer } from '../../core/render-quality';
import { enterGameFullscreen } from '../../core/game-fullscreen';

const DISMISS_KEY = 'six-chess-landscape-guide-dismissed';

/**
 * 横屏引导：手机竖屏时提示转成横屏。
 * 只做建议和可跳过的引导，全屏也保留玩家当前的横竖屏方向。
 * 只对手指操作的设备出现：桌面把窗口拖窄不该被叫去横屏。
 */
export function OrientationGuide() {
    const [touch] = useState(hasCoarsePointer);
    const [portrait, setPortrait] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!touch) return;
        const media = window.matchMedia('(orientation: portrait)');
        const sync = () => setPortrait(media.matches);
        sync();
        media.addEventListener('change', sync);
        return () => media.removeEventListener('change', sync);
    }, [touch]);

    useEffect(() => {
        try {
            setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
        } catch {
            // 隐私模式下 localStorage 会抛错，忽略即可
        }
    }, []);

    if (!touch || !portrait || dismissed) return null;

    return (
        <div className="orientation-guide" role="dialog" aria-label="建议横屏游玩">
            <div className="orientation-guide-card">
                <span className="orientation-guide-icon" aria-hidden="true" />
                <p className="orientation-guide-title">建议横屏游玩</p>
                <p className="orientation-guide-hint">
                    把手机转成横向，棋盘与战报会排得更开。
                </p>
                <button
                    type="button"
                    className="orientation-guide-btn"
                    onClick={() => {
                        void enterGameFullscreen();
                        try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* 无痕模式仍然可以关闭引导 */ }
                        setDismissed(true);
                    }}
                >
                    仍以竖屏继续
                </button>
            </div>
        </div>
    );
}
