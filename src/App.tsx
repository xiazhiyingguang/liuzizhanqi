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

function App() {
    const phase = useGameStore(state => state.phase);
    useOnlineSync();
    useComputerOpponent();
    useCareerStatisticsRecorder();

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
        </div>
    );
}

export default App;
