import { useEffect } from 'react';
import { useGameStore } from './store/game-store';
import MainMenu from './components/Menu/MainMenu';
import OnlineMenu from './components/Online/OnlineMenu';
import HeroSelect from './components/HeroSelect/HeroSelect';
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

function App() {
    const phase = useGameStore(state => state.phase);
    useOnlineSync();
    useComputerOpponent();
    useCareerStatisticsRecorder();
    useBgmController(phase);

    // 全局按钮点击音效：捕获阶段委托，按 data-sfx 标签区分音色
    useEffect(() => installClickSounds(), []);

    return (
        <div className="w-full h-full ink-paper">
            {phase === 'menu' && <MainMenu />}
            {phase === 'online-menu' && <OnlineMenu />}
            {phase === 'hero-codex' && <HeroCodex />}
            {phase === 'weapon-codex' && <WeaponCodex />}
            {phase === 'career-statistics' && <CareerStatistics />}
            {phase === 'hero-select' && <HeroSelect />}
            {phase === 'deploy' && <Deploy />}
            {phase === 'battle' && <BattleScene />}
            {phase === 'ended' && <BattleScene />}
            <BgmControl />
        </div>
    );
}

export default App;
