import { describe, expect, it } from 'vitest';
import { runComputerBattleStep, runComputerOpponentStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import { GameEngine } from '../../src/core/game-engine';
import type { GameState } from '../../src/types/game';

/** 对局状态指纹：用于检测"状态长期无变化"的死锁 */
function fingerprint(state: GameState): string {
    const cell = (hero: ReturnType<typeof Array.prototype.at>) => {
        const h = hero as GameState['player1Heroes'][number] | undefined;
        return h ? `${h.id}:${h.state}:${h.currentHp}:${h.hasActedThisTurn ? 1 : 0}` : '-';
    };
    return JSON.stringify({
        phase: state.phase,
        winner: state.winner ?? '-',
        round: state.roundNumber,
        current: state.currentPlayer,
        reinf: state.reinforcingPlayer ?? '-',
        sel: state.reinforcementSelectableHeroId ?? '-',
        active: state.activeHero?.id ?? '-',
        board: state.board.map(row => row.map(cell).join(',')).join(';'),
        heroes: [...state.player1Heroes, ...state.player2Heroes].map(cell).join(','),
        bench: [state.player1BenchHeroIds, state.player2BenchHeroIds].flat().join(','),
    });
}

/** 断言一：任一方场上真实英雄不得超过 4（超员即失败） */
function assertNoOverpopulation(state: GameState): void {
    for (const player of ['player1', 'player2'] as const) {
        const alive = GameEngine.countRealAliveOnBoard(state, player);
        const scene = `${player} 场上真实存活 ${alive} 人，超过 4 人上限\n` +
            dumpDeadlockScene(state) + '\n' + atomicTail(40) + '\n' + engineTail(60);
        expect(alive, scene).toBeLessThanOrEqual(4);
        const onGrid = state.board.flat().filter(hero => hero && hero.owner === player &&
            !hero.id.startsWith('wukong-clone|') && !hero.id.startsWith('mirror-clone|') &&
            !hero.id.startsWith('t-summon|') && hero.counters?.['__isClone'] !== 1 &&
            hero.counters?.['__isSummon'] !== 1).length;
        expect(onGrid, `${player} 棋盘上真实英雄 ${onGrid} 个，超过 4 人上限\n` + engineTail(60)).toBeLessThanOrEqual(4);
    }
}

/** 死锁现场全量转储：英雄状态 + 战斗日志尾部 */
function dumpDeadlockScene(state: GameState): string {
    const dump = [...state.player1Heroes, ...state.player2Heroes].map(hero => {
        const stuns = hero.effects.filter(e => e.type === 'stun').map(e => e.name).join('|');
        const pos = hero.position ? `${hero.position[0]},${hero.position[1]}` : 'off';
        const onBoard = hero.position && state.board[hero.position[0]]?.[hero.position[1]] === hero;
        return `${hero.id}[${hero.owner}] state=${hero.state} acted=${hero.hasActedThisTurn ? 1 : 0} ` +
            `moved=${hero.hasMovedThisTurn ? 1 : 0} pos=${pos}${onBoard ? '' : '(不在棋盘)'}${stuns ? ` 眩晕:${stuns}` : ''}`;
    }).join('\n  ');
    const logs = (state.battleLog ?? []).slice(-25).map(entry => entry.message).join('\n  ');
    return `全局: phase=${state.phase} round=${state.roundNumber} current=${state.currentPlayer} ` +
        `reinf=${state.reinforcingPlayer ?? '无'} sel=${state.selectedHero?.id ?? '无'} active=${state.activeHero?.id ?? '无'}\n` +
        `extra=${JSON.stringify(state.pendingExtraActionHeroIds ?? {})} forced=${state.pendingForcedActionHeroId ?? '无'} ` +
        `performingExtra=${state.performingExtraAction ? 1 : 0} resumePlayer=${state.resumePlayer ?? '无'} ` +
        `resumeCtx=${JSON.stringify(state.reinforceResumeContext ?? null)}\n` +
        `bench: p1=[${(state.player1BenchHeroIds ?? []).join(',')}] p2=[${(state.player2BenchHeroIds ?? []).join(',')}]\n` +
        `英雄:\n  ${dump}\n战斗日志(尾部25条):\n  ${logs}`;
}

/** 步进时间线：记录每步的控制权快照，死锁时输出以定位翻转点 */
interface StepTrace {
    step: number;
    round: number;
    current: string;
    reinf: string;
    p1Avail: number;
    p2Avail: number;
    sel: string;
    active: string;
    extra: string;
    perfExtra: number;
    resume: string;
    ctx: string;
}

function snapshotTrace(step: number, state: GameState): StepTrace {
    return {
        step,
        round: state.roundNumber,
        current: state.currentPlayer,
        reinf: state.reinforcingPlayer ?? '-',
        p1Avail: GameEngine.getAvailableHeroesForPlayer(state, 'player1').length,
        p2Avail: GameEngine.getAvailableHeroesForPlayer(state, 'player2').length,
        sel: state.selectedHero?.id.split('-')[0] ?? '-',
        active: state.activeHero?.id.split('-')[0] ?? '-',
        extra: Object.entries(state.pendingExtraActionHeroIds ?? {})
            .map(([k, v]) => `${k}:${(v as string)?.split('-')[0] ?? '-'}`).join(',') || '-',
        perfExtra: state.performingExtraAction ? 1 : 0,
        resume: state.resumePlayer ?? '-',
        ctx: state.reinforceResumeContext
            ? `${state.reinforceResumeContext.heroId.split('-')[0]}`
            : '-',
    };
}

function formatTraces(traces: StepTrace[]): string {
    return ['step round current reinf p1Avail p2Avail sel active extra perfExtra resume ctx',
        ...traces.map(t => `${t.step} r${t.round} ${t.current} ${t.reinf} ${t.p1Avail} ${t.p2Avail} ${t.sel} ${t.active} ${t.extra} ${t.perfExtra} ${t.resume} ${t.ctx}`),
    ].join('\n  ');
}

/** 原子变化序列（尾部N条），供失败断言输出 */
function atomicTail(n = 80): string {
    return `原子变化序列（尾部${Math.min(n, atomicLog.length)}条）:\n  ` + atomicLog.slice(-n).join('\n  ');
}

/** 引擎级打点：拦截 beginPendingReinforcement / endHeroAction / afterReinforcementDeployed */
let engineTrace: string[] = [];
let engineTracing = false;

/** 对象身份编号：判定"同一 state 被原地修改"还是"store 层对象换代" */
const gsIds = new WeakMap<object, number>();
let nextGsId = 1;

function objId(o: object): number {
    let id = gsIds.get(o);
    if (id === undefined) {
        id = nextGsId++;
        gsIds.set(o, id);
    }
    return id;
}

function snap(gs: GameState): string {
    const a1 = GameEngine.countRealAliveOnBoard(gs, 'player1');
    const a2 = GameEngine.countRealAliveOnBoard(gs, 'player2');
    return `o#${objId(gs)} r${gs.roundNumber} cur=${gs.currentPlayer} reinf=${gs.reinforcingPlayer ?? '-'} ` +
        `alive=${a1}/${a2} bench=${gs.player1BenchHeroIds?.length ?? 0}/${gs.player2BenchHeroIds?.length ?? 0} ` +
        `perfX=${gs.performingExtraAction ? 1 : 0} resume=${gs.resumePlayer ?? '-'}`;
}

let engineTracingInstalled = false;

function enableEngineTracing(): void {
    if (engineTracingInstalled) return;
    engineTracingInstalled = true;
    const ge = GameEngine as unknown as Record<string, (...args: unknown[]) => unknown>;
    const push = (line: string) => {
        engineTrace.push(line);
        if (engineTrace.length > 400) engineTrace.shift();
    };

    const origBegin = ge['beginPendingReinforcement'];
    ge['beginPendingReinforcement'] = function (this: unknown, gs: GameState) {
        const before = snap(gs);
        const result = origBegin.call(this, gs) as boolean;
        if (engineTracing) {
            push(`beginPendingReinf(${before}) => ${result}${result ? ` 挂起=${gs.reinforcingPlayer}` : ''}`);
        }
        return result;
    } as typeof origBegin;

    const origEnd = ge['endHeroAction'];
    ge['endHeroAction'] = function (this: unknown, hero: GameState['player1Heroes'][number], gs: GameState) {
        if (engineTracing) {
            push(`endHeroAction(${hero.id.split('-')[0]} owner=${hero.owner} ${snap(gs)})`);
        }
        return origEnd.call(this, hero, gs);
    } as typeof origEnd;

    const origAfter = ge['afterReinforcementDeployed'];
    ge['afterReinforcementDeployed'] = function (this: unknown, gs: GameState) {
        if (engineTracing) {
            push(`afterReinforceDeployed(${snap(gs)})`);
        }
        return origAfter.call(this, gs);
    } as typeof origAfter;

    const origRes = ge['resurrectHero'];
    ge['resurrectHero'] = function (this: unknown, hero: GameState['player1Heroes'][number], hp: number, gs: GameState) {
        const result = origRes.call(this, hero, hp, gs) as boolean;
        if (engineTracing) {
            push(`resurrectHero(${hero.id.split('-')[0]} ${snap(gs)}) => ${result}`);
        }
        return result;
    } as typeof origRes;
}

function engineTail(n = 100): string {
    return `引擎打点（尾部${Math.min(n, engineTrace.length)}条）:\n  ` + engineTrace.slice(-n).join('\n  ');
}

/** store setState 探针：捕获所有显式写入 reinforcingPlayer 的 set 调用及堆栈 */
let storeSetTracingInstalled = false;

function enableStoreSetTracing(): void {
    if (storeSetTracingInstalled) return;
    storeSetTracingInstalled = true;
    const push = (line: string) => {
        engineTrace.push(line);
        if (engineTrace.length > 400) engineTrace.shift();
    };
    const orig = useGameStore.setState.bind(useGameStore) as (...args: unknown[]) => unknown;
    useGameStore.setState = ((partial: unknown, ...rest: unknown[]) => {
        if (engineTracing && partial && typeof partial === 'object' && 'reinforcingPlayer' in (partial as Record<string, unknown>)) {
            const next = ((partial as Record<string, unknown>).reinforcingPlayer as string | null) ?? '-';
            const prev = useGameStore.getState().reinforcingPlayer ?? '-';
            const rawStack = (new Error().stack ?? '').split('\n').slice(2, 10).join(' ⬅ ');
            const stack = rawStack.replace(/[dD]:[\\/]code[\\/]Game[\\/]six-chess-battle[\\/]/g, '').replace(/c:[\\/]Users[\\/]文件[\\/][^ ]*[\\/]node_modules[\\/]/g, 'nm:');
            push(`SET reinf ${prev} -> ${next} @ ${stack}`);
        }
        return orig(partial, ...rest);
    }) as typeof useGameStore.setState;
}

/** 断言二：战斗中控制权必须有效——当前行动方要么有可动英雄，要么正处于补员挂起 */
function assertControlIsValid(state: GameState, traces: StepTrace[] = []): void {
    if (state.phase !== 'battle') return;
    if (state.reinforcingPlayer) return;
    const available = GameEngine.getAvailableHeroesForPlayer(state, state.currentPlayer);
    if (available.length > 0) return;

    const timeline = traces.length > 0
        ? `步进时间线（最近${traces.length}步）:\n  ${formatTraces(traces)}\n`
        : '';
    expect(
        available.length,
        `控制权失效：轮到 ${state.currentPlayer} 但其无可行动英雄（第${state.roundNumber}轮）\n` +
        timeline + dumpDeadlockScene(state) + '\n' + atomicTail() + '\n' + engineTail()
    ).toBeGreaterThan(0);
}

/** 全自动驱动一步：补员挂起由挂起方决策，其余由当前行动方决策 */
let lastAutoStepSignature = '';
let autoStepRepeatCount = 0;

/** 精简版决策签名：覆盖影响 AI 下一步决策的状态字段；刻意不含 battleLog（与 UI 层 stateSignature 语义一致，
 *  技能失败只加日志时签名不变，重复计数照常递增，从而触发强制收束兜底）。 */
function autoStepSignature(state: ReturnType<typeof useGameStore.getState>): string {
    const heroesSig = [...state.player1Heroes, ...state.player2Heroes]
        .map(h => `${h.id}:${h.state}:${h.currentHp}:${h.shield}:${h.hasActedThisTurn ? 1 : 0}:${h.position?.join(',') ?? '-'}`)
        .join(';');
    return [
        state.phase,
        state.currentPlayer,
        state.roundNumber,
        state.actionsThisTurn,
        state.selectedHero?.id ?? '-',
        state.selectedSkill?.id ?? '-',
        state.moveRange.length,
        state.skillRange.length,
        state.pendingSkillTargetPositions?.length ?? 0,
        state.reinforcingPlayer ?? '-',
        state.reinforcementSelectableHeroId ?? '-',
        heroesSig,
    ].join('|');
}

function autoStep(): void {
    const state = useGameStore.getState();
    if (state.phase !== 'battle') return;
    // 与 UI 层 useComputerOpponent 的 repeatCount 语义一致：状态完全未变的连续步进计数递增，
    // 达到阈值由 runComputerBattleStep 强制收束行动，防止 AI 决策层的意外路径把对局挂死。
    const actor = state.reinforcingPlayer ?? state.currentPlayer;
    const signature = autoStepSignature(useGameStore.getState());
    if (signature === lastAutoStepSignature) autoStepRepeatCount++;
    else autoStepRepeatCount = 0;
    lastAutoStepSignature = signature;
    runComputerBattleStep(actor, autoStepRepeatCount);
}

/** 原子变化记录：subscribe 捕捉每次 set 的关键字段 diff */
let atomicLog: string[] = [];
let atomicLogging = false;

function enableAtomicLogging(): void {
    useGameStore.subscribe((state, prev) => {
        if (!atomicLogging) return;
        const changes: string[] = [];
        if (state.currentPlayer !== prev.currentPlayer) {
            changes.push(`current:${prev.currentPlayer}->${state.currentPlayer} [o#${objId(state)} prevO#${objId(prev)} reinf=${state.reinforcingPlayer ?? '-'}]`);
        }
        if ((state.reinforcingPlayer ?? null) !== (prev.reinforcingPlayer ?? null)) {
            changes.push(`reinf:${prev.reinforcingPlayer ?? 'null'}->${state.reinforcingPlayer ?? 'null'}`);
        }
        if ((state.reinforceResumeContext ?? null) !== (prev.reinforceResumeContext ?? null)) {
            changes.push(`ctx:${prev.reinforceResumeContext?.heroId.split('-')[0] ?? 'null'}->${state.reinforceResumeContext?.heroId.split('-')[0] ?? 'null'}`);
        }
        if (state.performingExtraAction !== prev.performingExtraAction) {
            changes.push(`perfExtra:${prev.performingExtraAction ? 1 : 0}->${state.performingExtraAction ? 1 : 0}`);
        }
        if (state.resumePlayer !== prev.resumePlayer) {
            changes.push(`resume:${prev.resumePlayer ?? 'null'}->${state.resumePlayer ?? 'null'}`);
        }
        const prevAll = [...prev.player1Heroes, ...prev.player2Heroes];
        for (const h of [...state.player1Heroes, ...state.player2Heroes]) {
            const p = prevAll.find(x => x.id === h.id);
            if (!p) continue;
            if (p.hasActedThisTurn !== h.hasActedThisTurn) {
                changes.push(`${h.id.split('-')[0]}.acted:${p.hasActedThisTurn ? 1 : 0}->${h.hasActedThisTurn ? 1 : 0}`);
            }
            if (p.state !== h.state) {
                changes.push(`${h.id.split('-')[0]}.state:${p.state}->${h.state}`);
            }
        }
        if ((state.player1BenchHeroIds?.length ?? 0) !== (prev.player1BenchHeroIds?.length ?? 0) ||
            (state.player2BenchHeroIds?.length ?? 0) !== (prev.player2BenchHeroIds?.length ?? 0)) {
            changes.push(`bench:p1[${(state.player1BenchHeroIds ?? []).join(',')}]p2[${(state.player2BenchHeroIds ?? []).join(',')}]`);
        }
        if (changes.length > 0) {
            atomicLog.push(changes.join(' | '));
            if (atomicLog.length > 400) atomicLog.shift();
        }
    });
}

interface RunReport {
    finished: boolean;
    rounds: number;
    steps: number;
    winner: string | null;
}

/** 跑一整局：双方均由电脑决策代打，实时监测超员/死锁/无效控制权 */
function playFullGame(seedLabel: string, maxSteps = 6000): RunReport {
    enableEngineTracing();
    enableStoreSetTracing();
    enableAtomicLogging();
    atomicLog = [];
    engineTrace = [];
    engineTracing = true;
    atomicLogging = true;
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();

    for (const heroId of ['moran', 'zhenxiao', 'huifeng', 'baize', 'liuli', 'changli']) {
        expect(useGameStore.getState().selectHeroForPlayer('player1', heroId)).toBe(true);
    }
    useGameStore.getState().confirmHeroSelection();
    runComputerOpponentStep(); // AI 反制选将（选将/布阵阶段由 hook 步进器驱动）

    const humanStarters: [string, [number, number]][] = [
        ['moran', [1, 0]], ['zhenxiao', [2, 0]], ['huifeng', [3, 1]], ['baize', [4, 1]],
    ];
    for (const [heroId, pos] of humanStarters) {
        expect(useGameStore.getState().deployHeroForPlayer('player1', heroId, pos)).toBe(true);
    }
    useGameStore.getState().confirmDeployment();
    runComputerOpponentStep(); // AI 布阵

    let state = useGameStore.getState();
    if (state.phase !== 'battle') {
        return { finished: state.phase === 'ended', rounds: state.roundNumber, steps: 0, winner: state.winner ?? null };
    }

    let steps = 0;
    let staleCount = 0;
    let lastFingerprint = '';
    const traces: StepTrace[] = [];
    while (useGameStore.getState().phase === 'battle' && steps < maxSteps) {
        autoStep();
        steps++;
        state = useGameStore.getState();
        traces.push(snapshotTrace(steps, state));
        if (traces.length > 60) traces.shift();

        assertNoOverpopulation(state);
        assertControlIsValid(state, traces); // 每步校验控制权有效性，尽早抓第一现场

        const fp = fingerprint(state);
        staleCount = fp === lastFingerprint ? staleCount + 1 : 0;
        lastFingerprint = fp;
        expect(
            staleCount,
            `${seedLabel} 死锁：连续 ${staleCount} 步状态无任何变化\n` +
            `步进时间线（最近${traces.length}步）:\n  ${formatTraces(traces)}\n` +
            dumpDeadlockScene(state) + '\n' + atomicTail() + '\n' + engineTail()
        ).toBeLessThan(12);
    }
    atomicLogging = false;
    engineTracing = false;

    state = useGameStore.getState();
    if (state.phase !== 'ended') {
        // 超时未分胜负：输出尾部时间线与全局现场，用于判断是拉锯还是隐性循环
        console.error(
            `[${seedLabel}] 对局超时未结束 @${steps}步 round=${state.roundNumber} current=${state.currentPlayer}\n` +
            `步进时间线（最近${traces.length}步）:\n  ${formatTraces(traces)}\n` +
            dumpDeadlockScene(state)
        );
    }
    return {
        finished: state.phase === 'ended',
        rounds: state.roundNumber,
        steps,
        winner: state.winner ?? null,
    };
}

describe('替补制全流程压力回归（双电脑全自动对局）', () => {
    it('第1局：不出现超员、不死锁、控制权始终有效', () => {
        const report = playFullGame('局1');
        expect(report.finished, `对局未能在 ${report.steps} 步内结束`).toBe(true);
    });

    it('第2局：不出现超员、不死锁、控制权始终有效', () => {
        const report = playFullGame('局2');
        expect(report.finished, `对局未能在 ${report.steps} 步内结束`).toBe(true);
    });

    it('第3局：不出现超员、不死锁、控制权始终有效', () => {
        const report = playFullGame('局3');
        expect(report.finished, `对局未能在 ${report.steps} 步内结束`).toBe(true);
    });
});
