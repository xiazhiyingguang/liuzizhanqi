import { useEffect } from 'react';
import { GamePhase } from '../types/game';
import { audioManager } from '../audio/audio-manager';

/**
 * 全局背景音乐控制：
 * - 首次用户手势解锁 AudioContext（浏览器自动播放策略）
 * - phase 变化时切换曲目：battle 播战斗曲，其余阶段（含结算 ended）播界面曲
 */
export function useBgmController(phase: GamePhase): void {
    useEffect(() => {
        const unlock = () => audioManager.unlock();
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
    }, []);

    useEffect(() => {
        audioManager.applyPhase(phase);
    }, [phase]);
}
