import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { enterGameFullscreen, exitGameFullscreen, isGameFullscreen, isStandaloneGame } from '../../core/game-fullscreen';
import { useMobileLayout } from '../../hooks/useMobileLayout';

export default function FullscreenControl() {
    const mobile = useMobileLayout();
    const [fullscreen, setFullscreen] = useState(isGameFullscreen);
    const [standalone, setStandalone] = useState(isStandaloneGame);
    const [showHelp, setShowHelp] = useState(false);

    useEffect(() => {
        const sync = () => { setFullscreen(isGameFullscreen()); setStandalone(isStandaloneGame()); };
        const display = window.matchMedia('(display-mode: standalone)');
        document.addEventListener('fullscreenchange', sync);
        document.addEventListener('webkitfullscreenchange', sync);
        display.addEventListener('change', sync);
        return () => {
            document.removeEventListener('fullscreenchange', sync);
            document.removeEventListener('webkitfullscreenchange', sync);
            display.removeEventListener('change', sync);
        };
    }, []);

    useEffect(() => {
        if (!showHelp) return;
        const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowHelp(false); };
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, [showHelp]);

    if (!mobile || standalone) return null;
    return <>
        <button type="button" data-testid="fullscreen-control" className="mobile-fullscreen-control" data-sfx="toggle"
            aria-label={fullscreen ? '退出全屏' : '进入全屏'} aria-pressed={fullscreen}
            onClick={() => {
                if (fullscreen) { void exitGameFullscreen(); return; }
                void enterGameFullscreen().then(success => { if (!success) setShowHelp(true); });
            }}>
            {fullscreen ? '退出' : '全屏'}
        </button>
        {showHelp && createPortal(<div className="fullscreen-help fixed inset-0 z-[110] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="fullscreen-help-title">
            <button type="button" className="absolute inset-0 bg-ink/55" aria-label="关闭全屏说明" onClick={() => setShowHelp(false)} />
            <div className="ink-card relative flex w-full max-w-sm flex-col p-5">
                <h2 id="fullscreen-help-title" className="flex-shrink-0 font-title text-2xl text-ink">无地址栏游玩</h2>
                <div className="min-h-0 overflow-y-auto">
                <p className="mt-3 text-sm leading-6 text-ink-light">当前浏览器未能进入全屏。可以把游戏添加到主屏幕，再从游戏图标打开。</p>
                <p className="mt-3 text-sm leading-6 text-ink-light">iPhone / iPad：在 Safari 的分享菜单中选择“添加到主屏幕”；若出现“作为网页 App 打开”，请开启。</p>
                <p className="mt-2 text-sm leading-6 text-ink-light">Android：在浏览器菜单中选择“安装应用”或“添加到主屏幕”。若当前浏览器只创建网页书签，请换用支持网页应用的浏览器。</p>
                </div>
                <button type="button" className="mt-4 min-h-[44px] w-full flex-shrink-0 rounded-lg bg-indigo-ink px-4 py-2 text-rice-light" onClick={() => setShowHelp(false)}>继续游戏</button>
            </div>
        </div>, document.body)}
    </>;
}
