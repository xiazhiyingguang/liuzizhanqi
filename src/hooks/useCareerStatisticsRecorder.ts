import { useEffect } from 'react';
import { recordCompletedMatch } from '../services/career-statistics';
import { useGameStore } from '../store/game-store';

/** 在本机浏览器中自动记录每一局已完成的对战，同一 matchId 只会写入一次。 */
export function useCareerStatisticsRecorder(): void {
    const phase = useGameStore(state => state.phase);
    const matchId = useGameStore(state => state.matchId);

    useEffect(() => {
        if (phase !== 'ended') return;
        recordCompletedMatch(useGameStore.getState());
    }, [matchId, phase]);
}
