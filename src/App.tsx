import { useEffect, useState } from 'react';
import { useGameStore } from './store/game-store';
import MainMenu from './components/Menu/MainMenu';
import OnlineMenu from './components/Online/OnlineMenu';
import HeroSelect from './components/HeroSelect/HeroSelect';
import WeaponSelect from './components/WeaponSelect/WeaponSelect';
import Deploy from './components/Deploy/Deploy';
import BattleScene from './components/Game/BattleScene';
import HeroCodex from './components/HeroCodex/HeroCodex';
import WeaponCodex from './components/WeaponCodex/WeaponCodex';
import CareerStatistics from './components/CareerStatistics/CareerStatistics';
import { useOnlineSync } from './hooks/useOnlineSync';
import { useComputerOpponent } from './hooks/useComputerOpponent';
import { useCareerStatisticsRecorder } from './hooks/useCareerStatisticsRecorder';
import { useBgmController } from './hooks/useBgmController';
import { installClickSounds } from './audio/click-sound';
import BgmControl from './components/ui/BgmControl';
import QualityControl from './components/ui/QualityControl';
import FullscreenControl from './components/ui/FullscreenControl';
import { OrientationGuide } from './components/Game/OrientationGuide';
import { isGameFullscreen, isStandaloneGame } from './core/game-fullscreen';
import './styles/mobile-layout.css';

function App() {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [immersive, setImmersive] = useState(() => isGameFullscreen() || isStandaloneGame());
    const phase = useGameStore(state => state.phase);
    useOnlineSync();
    useComputerOpponent();
    useCareerStatisticsRecorder();
    useBgmController(phase);

    // 全局按钮点击音效：捕获阶段委托，按 data-sfx 标签区分音色
    useEffect(() => installClickSounds(), []);

    useEffect(() => {
        const sync = () => {
            const active = isGameFullscreen() || isStandaloneGame();
            setImmersive(active);
            if (active) setSettingsOpen(false);
        };
        const modes = ['standalone', 'fullscreen'].map(mode => window.matchMedia(`(display-mode: ${mode})`));
        document.addEventListener('fullscreenchange', sync);
        document.addEventListener('webkitfullscreenchange', sync);
        window.addEventListener('pageshow', sync);
        modes.forEach(media => media.addEventListener('change', sync));
        sync();
        return () => {
            document.removeEventListener('fullscreenchange', sync);
            document.removeEventListener('webkitfullscreenchange', sync);
            window.removeEventListener('pageshow', sync);
            modes.forEach(media => media.removeEventListener('change', sync));
        };
    }, []);

    return (
        <div className="app-shell w-full h-full ink-paper" data-phase={phase} data-immersive={immersive || undefined}>
            {phase === 'menu' && <MainMenu />}
            {phase === 'online-menu' && <OnlineMenu />}
            {phase === 'hero-codex' && <HeroCodex />}
            {phase === 'weapon-codex' && <WeaponCodex />}
            {phase === 'career-statistics' && <CareerStatistics />}
            {phase === 'hero-select' && <HeroSelect />}
            {phase === 'weapon-select' && <WeaponSelect />}
            {phase === 'deploy' && <Deploy />}
            {phase === 'battle' && <BattleScene />}
            {phase === 'ended' && <BattleScene />}
            <div className={`app-game-controls${settingsOpen ? ' mobile-settings-open' : ''}`}>
                <button className="compact-settings-toggle" aria-expanded={settingsOpen} aria-label="音乐与画质设置"
                    onClick={() => setSettingsOpen(value => !value)}>设置</button>
                <BgmControl />
                <QualityControl />
                <FullscreenControl />
            </div>
            <OrientationGuide />
        </div>
    );
}

export default App;
