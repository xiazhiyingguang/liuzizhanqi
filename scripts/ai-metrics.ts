/**
 * 临时度量：电脑"操作死板"的三个可观测症状
 *  1) 范围技能只打到一个人（站位不看技能形状）
 *  2) 远程/长射程英雄贴脸站（走位只有"靠近敌人"一个梯度）
 *  3) 整局几乎不移动 / 每回合决策雷同
 * 用法：npx vite-node scripts/ai-metrics.ts --games 8 --seed 20260829
 */
import { AVAILABLE_HERO_IDS } from '../src/data/heroes';
import { getSkill } from '../src/data/skills';
import { useGameStore } from '../src/store/game-store';
import { resetBattleReplay } from '../src/services/battle-replay';
import { runComputerBattleStep, runComputerOpponentStep } from '../src/hooks/useComputerOpponent';
import { setComputerAiDifficulty } from '../src/core/computer-ai';
import { MovementSystem } from '../src/core/movement-system';
import type { Hero, Position } from '../src/types/game';

const MAX_STEPS = 2600;

function readArg(name: string, fallback: number): number {
    const index = process.argv.indexOf(`--${name}`);
    if (index < 0 || index + 1 >= process.argv.length) return fallback;
    return Number(process.argv[index + 1]) || fallback;
}

function seedRandom(seed: number): void {
    let a = seed >>> 0;
    Math.random = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffledTeam(count: number): string[] {
    const pool = [...AVAILABLE_HERO_IDS];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
}

function signature(): string {
    const state = useGameStore.getState();
    return [
        state.phase, state.currentPlayer, state.reinforcingPlayer ?? '-',
        state.roundNumber, state.actionsThisTurn,
        state.activeHero?.id ?? '-', state.selectedHero?.id ?? '-', state.selectedSkill?.id ?? '-',
        state.moveRange.length, state.skillRange.length,
        state.pendingSkillTargetPositions?.length ?? 0, state.pendingBoardAction?.heroId ?? '-',
        state.libaiChainState?.heroId ?? '-',
        [...state.player1Heroes, ...state.player2Heroes]
            .map(hero => `${hero.currentHp}:${hero.hasActedThisTurn ? 1 : 0}:${hero.position?.join(',') ?? '-'}`)
            .join(';'),
    ].join('|');
}

function maximumSkillReach(hero: Hero): number {
    return [getSkill(hero.skill1Id), getSkill(hero.skill2Id)].reduce((best, skill) => {
        if (!skill) return best;
        if (skill.rangeType === '全场') return 12;
        return Math.max(best, skill.range + (skill.rangeType === 'area' ? 1 : 0));
    }, 1);
}

interface Metrics {
    casts: number;
    aoeCasts: number;
    aoeHits: number;
    /** 射程>=2 的英雄施法时与最近敌人的距离分布 */
    rangedGap: Record<string, number>;
    gapSum: number;
    gapCount: number;
    movedTurns: number;
    totalTurns: number;
    rounds: number;
    games: number;
    damage: number;
    skillUseStreak: number;
    longestStreak: number;
}

function newMetrics(): Metrics {
    return {
        casts: 0, aoeCasts: 0, aoeHits: 0, rangedGap: {},
        gapSum: 0, gapCount: 0,
        movedTurns: 0, totalTurns: 0, rounds: 0, games: 0, damage: 0,
        skillUseStreak: 0, longestStreak: 0,
    };
}

function hpSnapshot(state: ReturnType<typeof useGameStore.getState>): Map<string, number> {
    const map = new Map<string, number>();
    for (const hero of [...state.player1Heroes, ...state.player2Heroes]) {
        map.set(hero.id, hero.currentHp + hero.shield);
    }
    return map;
}

function playMatch(seed: number, metrics: Metrics): void {
    seedRandom(seed);
    resetBattleReplay();
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();

    const teams = shuffledTeam(6);
    for (const heroId of teams) useGameStore.getState().selectHeroForPlayer('player1', heroId);
    useGameStore.getState().confirmHeroSelection();
    runComputerOpponentStep();
    const spots: Position[] = [[2, 0], [1, 0], [4, 1], [3, 1], [0, 0], [5, 1]];
    teams.slice(0, 4).forEach((heroId, index) => {
        useGameStore.getState().deployHeroForPlayer('player1', heroId, spots[index]);
    });
    useGameStore.getState().confirmDeployment();
    runComputerOpponentStep();

    let steps = 0;
    let lastSignature = '';
    let repeat = 0;
    let lastSkill = '';
    let streak = 0;
    let roundSeen = useGameStore.getState().roundNumber;
    let roundStartPositions = new Map<string, string>();
    for (const hero of [...useGameStore.getState().player1Heroes, ...useGameStore.getState().player2Heroes]) {
        roundStartPositions.set(hero.id, hero.position?.join(',') ?? '-');
    }
    while (useGameStore.getState().phase === 'battle' && steps < MAX_STEPS) {
        const before = useGameStore.getState();
        const actor = before.reinforcingPlayer ?? before.currentPlayer;
        const caster = before.selectedHero;
        const beforeHp = hpSnapshot(before);
        const sig = signature();
        repeat = sig === lastSignature ? repeat + 1 : 0;
        lastSignature = sig;
        runComputerBattleStep(actor, repeat);
        steps++;

        const after = useGameStore.getState();

        // 新的一回合：结算上一回合有多少单位真的挪了位置
        if (after.roundNumber !== roundSeen || after.phase !== 'battle') {
            const now = new Map<string, string>();
            for (const hero of [...after.player1Heroes, ...after.player2Heroes]) {
                now.set(hero.id, hero.position?.join(',') ?? '-');
            }
            for (const [heroId, start] of roundStartPositions) {
                const end = now.get(heroId);
                if (end === undefined || end === '-') continue;
                metrics.totalTurns++;
                if (end !== start) metrics.movedTurns++;
            }
            roundStartPositions = now;
            roundSeen = after.roundNumber;
        }

        // 一次施法落地：技能从"已选"变成别的，且能归因到施法者
        if (caster && before.selectedSkill && after.selectedSkill?.id !== before.selectedSkill.id) {
            const skill = before.selectedSkill;
            const foes = (caster.owner === 'player1' ? after.player2Heroes : after.player1Heroes)
                .filter(hero => (beforeHp.get(hero.id) ?? 0) > (hero.currentHp + hero.shield));
            const hits = foes.length;
            if (hits > 0 || skill.type === 'damage') {
                metrics.casts++;
                const shape = skill.rangeType === 'area' || skill.rangeType === 'line' || skill.rangeType === 'cross';
                if (shape && skill.type === 'damage') {
                    metrics.aoeCasts++;
                    metrics.aoeHits += hits;
                }
                if (caster.position) {
                    const reach = maximumSkillReach(caster);
                    const gap = Math.min(...(caster.owner === 'player1' ? after.player2Heroes : after.player1Heroes)
                        .filter(hero => hero.state === 'alive' && hero.position)
                        .map(hero => MovementSystem.getManhattanDistance(caster.position!, hero.position!)), 12);
                    metrics.gapSum += gap;
                    metrics.gapCount++;
                    if (reach >= 2) {
                        // 注意：area 技的 reach=range+1，3x3 近战也算"射程>=2"，这一档混了伪远程
                        const bucket = gap <= 1 ? '贴脸(<=1)' : gap >= reach ? '射程端点/之外' : `中途(2..${reach - 1})`;
                        metrics.rangedGap[bucket] = (metrics.rangedGap[bucket] ?? 0) + 1;
                    }
                }
            }
            const key = `${caster.id}:${skill.id}`;
            streak = key === lastSkill ? streak + 1 : 1;
            lastSkill = key;
            metrics.longestStreak = Math.max(metrics.longestStreak, streak);
        }
    }
    metrics.games++;
    metrics.rounds += useGameStore.getState().roundNumber;
}

const games = readArg('games', 8);
const seedBase = readArg('seed', 20260829);
setComputerAiDifficulty('master');
const metrics = newMetrics();
for (let i = 0; i < games; i++) {
    playMatch(seedBase + i * 97, metrics);
    process.stdout.write('.');
}
console.log('\n');
console.log(`局数=${metrics.games} 平均回合=${(metrics.rounds / metrics.games).toFixed(1)}`);
console.log(`范围伤害技平均命中人数 = ${(metrics.aoeHits / Math.max(1, metrics.aoeCasts)).toFixed(2)}（${metrics.aoeCasts} 次）`);
console.log(`施法时与最近敌人的平均距离 = ${(metrics.gapSum / Math.max(1, metrics.gapCount)).toFixed(2)}（施法次数 ${metrics.gapCount}）`);
console.log(`长射程英雄(射程>=2)站位分布 = ${JSON.stringify(metrics.rangedGap)}`);
console.log(`移动后行动的回合占比 = ${(metrics.movedTurns / Math.max(1, metrics.totalTurns) * 100).toFixed(1)}%`);
console.log(`同一英雄连续重复同一技能的最长串 = ${metrics.longestStreak}`);
