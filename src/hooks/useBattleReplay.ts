import { useSyncExternalStore } from 'react';
import { getBattleReplay, subscribeBattleReplay } from '../services/battle-replay';
import type { BattleReplay } from '../core/battle-replay';

/** 订阅本局内存回放（录制器只在真正产生新帧时通知，快照对象引用稳定） */
export function useBattleReplay(): BattleReplay {
    return useSyncExternalStore(subscribeBattleReplay, getBattleReplay, getBattleReplay);
}
