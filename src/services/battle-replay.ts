import {
    createInterner,
    detectKeyMoments,
    isCoarseWorthy,
    buildFrame,
    stepSignature,
    MAX_REPLAY_DECISIONS,
    MAX_REPLAY_FRAMES,
    MAX_REPLAY_NARRATION,
    type AiDecision,
    type BattleReplay,
    type ReplayFrame,
    type ReplayInterner,
    type ReplayMark,
} from '../core/battle-replay';
import type { BattleLogEntry, GameState } from '../types/game';

/**
 * 对局回放录制器（模块级单例）。
 *
 * 由 `game-store.ts` 底部一行 `useGameStore.subscribe(...)` 驱动：每次 store 提交后
 * 调用 `noteReplayStep(state)`。这里**只读不写**，因此不会递归触发订阅，也不会牵动
 * 音效订阅、AI 定时器、联机广播这些"跟着 store 变化跑"的副作用。
 *
 * 只在内存里留存：换局（matchId 变化）即丢弃，`resetGame` 之后自然为空。
 */

interface RecorderState {
    matchId: string | undefined;
    frames: ReplayFrame[];
    narration: BattleLogEntry[];
    decisions: AiDecision[];
    interner: ReplayInterner;
    seenLogIds: Set<string>;
    coarsened: boolean;
    marksDirty: boolean;
    marks: ReplayMark[];
}

let recorder = createEmptyRecorder();
let cachedView: BattleReplay | null = null;
const listeners = new Set<() => void>();

function createEmptyRecorder(): RecorderState {
    return {
        matchId: undefined,
        frames: [],
        narration: [],
        decisions: [],
        interner: createInterner(),
        seenLogIds: new Set(),
        coarsened: false,
        marksDirty: true,
        marks: [],
    };
}

/** AI 决策点上报：序号与对齐用的帧号由录制器补齐 */
export function noteAiDecision(decision: Omit<AiDecision, 'seq' | 'frame'>): void {
    if (recorder.decisions.length >= MAX_REPLAY_DECISIONS) return;
    recorder.decisions.push({
        ...decision,
        seq: recorder.decisions.length,
        frame: Math.max(0, recorder.frames.length - 1),
    });
}

/** 清空当前录像（换局、单测、重新开局） */
export function resetBattleReplay(): void {
    recorder = createEmptyRecorder();
    cachedView = null;
    bump();
}

function bump(): void {
    for (const listener of listeners) listener();
}

/**
 * 收一条 store 提交。只在真正产生新帧时通知订阅者，
 * 避免 skillFx 之类的纯视觉提交引起无谓重渲染。
 */
export function noteReplayStep(state: GameState): void {
    // 作废旧录像的两种信号：换局（initGame 生成新 matchId）、回到主菜单。
    // resetGame 展开 createInitialState 时不含 matchId 键，zustand 浅合并会保留旧值，
    // 所以只比对 matchId 清不掉"返回主界面"后的录像，必须显式认 menu 阶段。
    if (state.phase === 'menu' || recorder.matchId !== state.matchId) {
        recorder = createEmptyRecorder();
        recorder.matchId = state.phase === 'menu' ? undefined : state.matchId;
        cachedView = null;
        bump();
    }

    if (state.phase !== 'battle' && state.phase !== 'ended') return;

    const entries = state.battleLog ?? [];
    const freshLogs = entries.filter(entry => !recorder.seenLogIds.has(entry.id));
    for (const entry of entries) recorder.seenLogIds.add(entry.id);
    // 区间起点必须在追加之前取，否则本帧的战报窗口会错位
    const logFrom = recorder.narration.length;
    if (freshLogs.length > 0 && recorder.narration.length < MAX_REPLAY_NARRATION) {
        recorder.narration.push(...freshLogs.slice(0, MAX_REPLAY_NARRATION - recorder.narration.length));
    }
    const logTo = recorder.narration.length;

    const sig = stepSignature(state);
    const last = recorder.frames[recorder.frames.length - 1];

    // 签名没变（同一步里的多次 set、纯视觉提交）：把新战报并入上一帧，不产生新帧
    if (last && last.sig === sig) {
        last.logTo = logTo;
        return;
    }

    const frame = buildFrame(state, recorder.frames.length, sig, logFrom, logTo, recorder.interner);
    // 超过帧上限后按回合抽样：丢掉开局帧会让时间轴失去意义，所以只丢"没信息量"的中间帧
    if (recorder.frames.length >= MAX_REPLAY_FRAMES) {
        recorder.coarsened = true;
        if (!isCoarseWorthy(last ?? null, frame)) {
            if (last) last.logTo = logTo;
            return;
        }
    }

    recorder.frames.push(frame);
    recorder.marksDirty = true;
    cachedView = null;
    bump();
}

/** 当前录像（不可变快照；无变化时复用同一对象引用，供 useSyncExternalStore 使用） */
export function getBattleReplay(): BattleReplay {
    if (cachedView) return cachedView;
    if (recorder.marksDirty) {
        recorder.marks = detectKeyMoments(recorder.frames, recorder.interner.statics, recorder.narration);
        recorder.marksDirty = false;
    }
    cachedView = {
        matchId: recorder.matchId,
        statics: recorder.interner.statics,
        narration: recorder.narration,
        frames: recorder.frames,
        marks: recorder.marks,
        decisions: recorder.decisions,
        coarsened: recorder.coarsened,
    };
    return cachedView;
}

/** 至少两帧才有"前后对比"的意义，否则结算界面的回放按钮没有价值 */
export function hasBattleReplay(): boolean {
    return recorder.frames.length > 1;
}

export function subscribeBattleReplay(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
