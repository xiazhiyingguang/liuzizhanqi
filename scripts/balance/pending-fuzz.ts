/**
 * 挂起（pendingBoardAction）卡死压测：AI 自动对局里逐检查三条不变式。
 *
 *   V1 饿死：挂着行动，却没有任何可点的格子（玩家只能手动"结束行动"脱困）
 *   V2 失焦：挂着行动，但 selectedHero/activeHero 不是挂起归属的那名英雄（点击路由不到）
 *   V3 停滞：同一个挂起连续多步没有任何变化（既没人能点，也没人替它收尾）
 *
 * 用法：npx vite-node scripts/balance/pending-fuzz.ts --games=40 --seed=4242
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import { chooseComputerDeployment, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { battleActorFor, runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { getPendingActionCells, useGameStore } from '../../src/store/game-store';
import { HeroState, Player } from '../../src/types/game';

const MAX_BATTLE_ROUNDS = 30;
const MAX_DECISION_STEPS = 4000;
const OUT_DIR = resolve('reports/balance/pending-fuzz');
/**
 * store 里 abandonPendingBoardAction() 真正认识的挂起类型；不在表内的类型连"结束行动"都放不出去。
 * 与 game-store.ts 那个 switch 保持同步——漏一条就会把"其实有出口"的挂起报成 V4 假阳性。
 */
const ABANDON_HANDLED = new Set([
    'yunying-liehuo',
    'yunying-tianwei',
    'zhiguang-tianwei',
    'jiangtaigong-hook',
    'xueqi-tianwei',
    'schrodinger-tianwei',
]);
mkdirSync(OUT_DIR, { recursive: true });

function numberArg(name: string, fallback: number): number {
    const raw = process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(state ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function deploymentFor(team: string[], side: Player) {
    const rotation = team.reduce((sum, id) => sum + [...id].reduce((s, c) => s + c.charCodeAt(0), 0), 0) % 6;
    return chooseComputerDeployment(team, []).map(item => ({
        heroId: item.heroId,
        position: [
            (item.position[0] + rotation) % 6,
            side === 'player1' ? 5 - item.position[1] : item.position[1],
        ] as [number, number],
    }));
}

function setupMatch(team1: string[], team2: string[]): void {
    useGameStore.setState({ isOnlineMode: false, isAiMode: false, suppressOnlineBroadcast: false, aiDifficulty: 'master' });
    setComputerAiDifficulty('master');
    useGameStore.getState().initGame();
    const store = useGameStore.getState();
    for (const heroId of team1) store.selectHeroForPlayer('player1', heroId);
    for (const heroId of team2) store.selectHeroForPlayer('player2', heroId);
    store.confirmHeroSelectionForPlayer('player1');
    store.confirmHeroSelectionForPlayer('player2');
    for (const side of ['player1', 'player2'] as const) {
        for (const item of deploymentFor(side === 'player1' ? team1 : team2, side)) {
            useGameStore.getState().deployHeroForPlayer(side, item.heroId, item.position);
        }
        useGameStore.getState().confirmDeploymentForPlayer(side);
    }
}

interface Violation {
    game: number;
    step: number;
    kind: 'V1-饿死' | 'V2-失焦' | 'V3-停滞' | 'V4-无出口';
    pendingType: string;
    heroId: string;
    cells: number;
    selectedHero: string;
    currentPlayer: string;
    reinforcingPlayer: string;
    occupied: number;
    logTail: string[];
}

const violations: Violation[] = [];
const gamesWithPending: Record<string, number> = {};

function snapshotContext() {
    const state = useGameStore.getState();
    const occupied = state.board.flat().filter(Boolean).length;
    return { state, occupied };
}

function checkInvariants(game: number, step: number, kindOf: (t: string) => Violation['kind'], cells: number, pendingType: string, heroId: string) {
    const { state, occupied } = snapshotContext();
    violations.push({
        game, step,
        kind: kindOf(pendingType),
        pendingType, heroId,
        cells,
        selectedHero: state.selectedHero?.id ?? '-',
        currentPlayer: state.currentPlayer,
        reinforcingPlayer: state.reinforcingPlayer ?? '-',
        occupied,
        logTail: (state.battleLog ?? []).slice(-4).map(entry => entry.message),
    });
}

function playGame(game: number, team1: string[], team2: string[]): { steps: number; stalled: boolean } {
    setupMatch(team1, team2);
    let steps = 0;
    let previousSignature = '';
    let repeated = 0;
    let pendingSignature = '';
    let pendingStuckSteps = 0;

    while (steps < MAX_DECISION_STEPS) {
        const before = useGameStore.getState();
        if (before.phase === 'ended' || before.roundNumber > MAX_BATTLE_ROUNDS) break;

        const pending = before.pendingBoardAction;
        if (pending) {
            gamesWithPending[pending.type] = (gamesWithPending[pending.type] ?? 0) + 1;
            const cells = getPendingActionCells(before);
            const hero = [...before.player1Heroes, ...before.player2Heroes].find(item => item.id === pending.heroId);
            // V1：挂起可点格为空（本侧可操作时才算真卡死；无归属英雄的情况一并算）
            if (cells.length === 0 && hero?.state === HeroState.ALIVE) {
                checkInvariants(game, steps, () => 'V1-饿死', 0, pending.type, pending.heroId);
                // 手动替它收尾，好让这一局继续跑下去（只记一次，避免同一挂起刷屏）
                if (pending.type === 'yunying-tianwei' || pending.type === 'zhiguang-tianwei' || pending.type === 'xueqi-tianwei') {
                    useGameStore.setState({ pendingBoardAction: undefined, highlightedPositions: [], skillRange: [] });
                }
            }
            // V2：挂起漂到了"无人可答"的局面——焦点英雄不是挂起主人（含焦点已被清空的场景）。
            //     这才是玩家看到的"点不动、只能手动结束行动"：挂起扣着交接，可当前焦点已经不是她
            // 鱼钩按裁定天生就是"钩主不是行动方"（钩在对手回合被踩响、落点归钩主点），
            // 焦点永远不等于钩主，所以它不算失焦，直接排除
            const drifted = hero?.state === HeroState.ALIVE
                && pending.type !== 'jiangtaigong-hook'
                && before.selectedHero?.id !== pending.heroId;
            if (drifted) {
                checkInvariants(game, steps,
                    () => ABANDON_HANDLED.has(pending.type) ? 'V2-失焦' : 'V4-无出口',
                    cells.length, pending.type, pending.heroId);
            }
            const signature = `${pending.type}|${pending.heroId}|${before.roundNumber}|${before.actionsThisTurn}`;
            pendingStuckSteps = signature === pendingSignature ? pendingStuckSteps + 1 : 0;
            pendingSignature = signature;
            if (pendingStuckSteps === 12) {
                checkInvariants(game, steps, () => 'V3-停滞', getPendingActionCells(before).length, pending.type, pending.heroId);
            }
        } else {
            pendingSignature = '';
            pendingStuckSteps = 0;
        }

        const signature = [
            before.phase, before.currentPlayer, before.reinforcingPlayer ?? '-', before.roundNumber,
            before.actionsThisTurn, before.selectedHero?.id ?? '-', before.pendingBoardAction?.heroId ?? '-',
            before.pendingBoardAction?.type ?? '-',
            [...before.player1Heroes, ...before.player2Heroes]
                .map(hero => `${hero.id}:${hero.state}:${hero.currentHp}:${hero.shield}:${hero.position?.join(',') ?? '-'}`)
                .join(';'),
        ].join('|');
        repeated = signature === previousSignature ? repeated + 1 : 0;
        previousSignature = signature;
        if (repeated >= 8) return { steps, stalled: true };
        runComputerBattleStep(battleActorFor(before), repeated);
        steps++;
    }
    return { steps, stalled: false };
}

const games = numberArg('games', 40);
const seed = numberArg('seed', 4242);
const FOCUS = ['yunying', 'xueqi'];
const random = mulberry32(seed);
const pool = AVAILABLE_HERO_IDS.filter(id => !FOCUS.includes(id));

console.log(`挂起卡死压测：${games} 局，双方固定带 云缨 + 血契，seed ${seed}`);
let stalledGames = 0;
for (let game = 0; game < games; game++) {
    const shuffled = shuffle(pool, random);
    const team1 = [...FOCUS, shuffled[0], shuffled[1], shuffled[2], shuffled[3]];
    const team2 = [...FOCUS, shuffled[4], shuffled[5], shuffled[6], shuffled[7]];
    const result = playGame(game, team1, team2);
    if (result.stalled) stalledGames++;
    if ((game + 1) % 5 === 0) {
        console.log(`  ${game + 1}/${games} 局，违规 ${violations.length}，停滞 ${stalledGames}`);
        writeFileSync(resolve(OUT_DIR, 'partial.json'), JSON.stringify({ games: game + 1, violations, gamesWithPending }, null, 2));
    }
    useGameStore.getState().resetGame();
}

const byKind: Record<string, number> = {};
const byKindType: Record<string, number> = {};
for (const violation of violations) {
    byKind[violation.kind] = (byKind[violation.kind] ?? 0) + 1;
    byKindType[`${violation.kind} ${violation.pendingType}`] = (byKindType[`${violation.kind} ${violation.pendingType}`] ?? 0) + 1;
}

console.log(`\n结果：${games} 局，停滞 ${stalledGames} 局，违规 ${violations.length} 次`);
console.log('挂起出现次数（按类型）：', gamesWithPending);
console.log('违规按类型：', byKindType);
for (const violation of violations.slice(0, 8)) {
    console.log(`\n[${violation.kind} · ${violation.pendingType}] 第${violation.game}局 第${violation.step}步 ` +
        `可点格=${violation.cells} 焦点=${violation.selectedHero} 轮次归属=${violation.currentPlayer} 补员=${violation.reinforcingPlayer} 占格=${violation.occupied}/36`);
    for (const line of violation.logTail) console.log(`    · ${line}`);
}
writeFileSync(resolve(OUT_DIR, 'result.json'), JSON.stringify({ games, seed, stalledGames, gamesWithPending, byKind, violations }, null, 2));
console.log(`\n明细已写入 ${resolve(OUT_DIR, 'result.json')}`);
