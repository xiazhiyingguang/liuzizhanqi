/**
 * AI 离线复盘：跑若干局双电脑自对弈，用回放录制到的帧与决策记录做统计，
 * 输出"AI 这局做错了哪几件事"的报告，作为调整评分权重的依据。
 *
 * 用法：npm run ai:review -- --games 4 --seed 12345 --out reports/ai-review.md
 *
 * 只做只读分析：不改动对局逻辑，也不写 localStorage。
 * 开局链路刻意与 tests/regression/youjun-ai-fullgame.test.ts 保持一致，
 * 避免自造流程导致"回合流转没初始化"的假象。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AVAILABLE_HERO_IDS } from '../src/data/heroes';
import { getSkill } from '../src/data/skills';
import { useGameStore } from '../src/store/game-store';
import { getBattleReplay, resetBattleReplay } from '../src/services/battle-replay';
import { runComputerBattleStep, runComputerOpponentStep } from '../src/hooks/useComputerOpponent';
import { setComputerAiDifficulty } from '../src/core/computer-ai';
import type { AiDecision, BattleReplay, ReplayFrame } from '../src/core/battle-replay';
import type { Player, Position } from '../src/types/game';

const MAX_STEPS = 2600;

function readArg(name: string, fallback: number): number {
    const index = process.argv.indexOf(`--${name}`);
    if (index < 0 || index + 1 >= process.argv.length) return fallback;
    return Number(process.argv[index + 1]) || fallback;
}

function readFlag(name: string, fallback: string): string {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/** mulberry32：可复现随机数，保证同一 seed 跑出同一局 */
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

function stateSignature(): string {
    const state = useGameStore.getState();
    return [
        state.roundNumber, state.currentPlayer, state.activeHero?.id ?? '-',
        [...state.player1Heroes, ...state.player2Heroes]
            .map(hero => `${hero.currentHp}:${hero.hasActedThisTurn ? 1 : 0}:${hero.position?.join(',') ?? '-'}`)
            .join(';'),
    ].join('|');
}

interface MatchResult {
    seed: number;
    teams: string[];
    steps: number;
    rounds: number;
    finished: boolean;
    winner: Player | undefined;
    frames: number;
    decisions: number;
    damageByPlayer: Record<Player, number>;
    killsByPlayer: Record<Player, number>;
    issues: string[];
    replay: BattleReplay;
}

function playMatch(seed: number): MatchResult {
    seedRandom(seed);
    resetBattleReplay();
    useGameStore.getState().resetGame();
    useGameStore.setState({ isOnlineMode: false, isAiMode: true, aiPlayer: 'player2', aiDifficulty: 'master' });
    useGameStore.getState().initGame();

    const teams = shuffledTeam(6);
    for (const heroId of teams) {
        useGameStore.getState().selectHeroForPlayer('player1', heroId);
    }
    useGameStore.getState().confirmHeroSelection();
    runComputerOpponentStep();                       // 电脑选将

    const spots: Position[] = [[2, 0], [1, 0], [4, 1], [3, 1], [0, 0], [5, 1]];
    teams.slice(0, 4).forEach((heroId, index) => {
        useGameStore.getState().deployHeroForPlayer('player1', heroId, spots[index]);
    });
    useGameStore.getState().confirmDeployment();
    runComputerOpponentStep();                       // 电脑布阵

    let steps = 0;
    let lastSignature = '';
    let repeat = 0;
    while (useGameStore.getState().phase === 'battle' && steps < MAX_STEPS) {
        const state = useGameStore.getState();
        const actor = state.reinforcingPlayer ?? state.currentPlayer;
        const signature = stateSignature();
        // 与真实 hook 一致：只有局面没推进才递增，AI 内部据此强制结束该英雄行动
        repeat = signature === lastSignature ? repeat + 1 : 0;
        lastSignature = signature;
        runComputerBattleStep(actor, repeat);
        steps++;
    }

    const replay = getBattleReplay();
    const damageByPlayer: Record<Player, number> = { player1: 0, player2: 0 };
    const killsByPlayer: Record<Player, number> = { player1: 0, player2: 0 };
    for (const entry of replay.narration) {
        if (entry.type === 'damage') {
            damageByPlayer[entry.player] += (entry.details as { amount?: number } | undefined)?.amount ?? 0;
        } else if (entry.type === 'kill') {
            killsByPlayer[entry.player] += 1;
        }
    }

    return {
        seed,
        teams,
        steps,
        rounds: useGameStore.getState().roundNumber,
        finished: useGameStore.getState().phase === 'ended',
        winner: useGameStore.getState().winner,
        frames: replay.frames.length,
        decisions: replay.decisions.length,
        damageByPlayer,
        killsByPlayer,
        issues: analyzeMatch(replay),
        replay,
    };
}

/** 决策序列与帧序列里能直接看出来的问题 */
function analyzeMatch(replay: BattleReplay): string[] {
    const issues: string[] = [];
    const skillName = (skillId: string | null): string =>
        skillId ? (getSkill(skillId)?.name ?? skillId) : '（无方案）';

    // 1) 同一英雄连续做出同一个选择而局面没推进 → 疑似空转/死循环
    let runHeroId = '';
    let runSkillId = '';
    let runLength = 0;
    const flushRun = () => {
        if (runLength >= 4) {
            const heroName = replay.decisions.find(item => item.heroId === runHeroId)?.heroName ?? runHeroId;
            issues.push(`疑似空转：${heroName} 连续 ${runLength} 次做出同一个决策「${skillName(runSkillId === 'none' ? null : runSkillId)}」`);
        }
    };
    for (const decision of replay.decisions) {
        const skillId = decision?.chosenSkillId ?? 'none';
        if (decision && decision.heroId === runHeroId && skillId === runSkillId) {
            runLength++;
            continue;
        }
        flushRun();
        runHeroId = decision?.heroId ?? '';
        runSkillId = skillId;
        runLength = 1;
    }
    flushRun();

    // 2) 施了法但前后都没有任何战报 → 零收益施法
    const frameWithLogs = new Set<number>();
    replay.frames.forEach((frame: ReplayFrame) => {
        if (frame.logTo > frame.logFrom) frameWithLogs.add(frame.index);
    });
    const wasted = replay.decisions.filter(decision =>
        !!decision.chosenSkillId && !frameWithLogs.has(decision.frame) && !frameWithLogs.has(decision.frame + 1)
    );
    if (wasted.length > 0) {
        const bySkill = new Map<string, number>();
        for (const decision of wasted) {
            const label = `${decision.heroName}·${skillName(decision.chosenSkillId)}`;
            bySkill.set(label, (bySkill.get(label) ?? 0) + 1);
        }
        const worst = [...bySkill.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([label, count]) => `${label}×${count}`).join('、');
        issues.push(`零收益施法 ${wasted.length} 次（施法前后都没有战报）：${worst}`);
    }

    // 3) 主动放弃最高分候选（低难度失误或多样性采样）
    const regretful = replay.decisions.filter((decision: AiDecision) => (decision.regret ?? 0) > 0);
    if (regretful.length > 0) {
        const worst = regretful.reduce((best, decision) =>
            (decision.regret ?? 0) > (best.regret ?? 0) ? decision : best, regretful[0]);
        issues.push(`放弃更优方案 ${regretful.length} 次，最大分差 ${worst.regret}（${worst.heroName} 选了「${skillName(worst.chosenSkillId)}」）`);
    }

    // 4) 整局没交上手
    const totalDamage = replay.narration
        .filter(entry => entry.type === 'damage')
        .reduce((sum, entry) => sum + ((entry.details as { amount?: number } | undefined)?.amount ?? 0), 0);
    if (totalDamage < 60) issues.push(`整局几乎没交手：累计伤害仅 ${totalDamage}`);

    // 5) 技能偏科：某英雄整局只用一个技能
    const perHero = new Map<string, Set<string>>();
    for (const decision of replay.decisions) {
        if (!decision.chosenSkillId) continue;
        if (!perHero.has(decision.heroName)) perHero.set(decision.heroName, new Set());
        perHero.get(decision.heroName)!.add(skillName(decision.chosenSkillId));
    }
    const oneSided = [...perHero.entries()].filter(([, skills]) => skills.size === 1).map(([name]) => name);
    if (oneSided.length > 0) issues.push(`只用到单一技能的英雄：${oneSided.join('、')}`);

    return issues;
}

function formatReport(matches: MatchResult[]): string {
    const lines: string[] = [];
    lines.push('# AI 复盘报告');
    lines.push('');
    lines.push(`- 局数：${matches.length}　难度：master　每局上限 ${MAX_STEPS} 步`);
    lines.push(`- 正常结束：${matches.filter(match => match.finished).length}/${matches.length}`);
    lines.push('');
    lines.push('| seed | 回合 | 步数 | 胜方 | 帧 | 决策 | P1伤害 | P2伤害 | P1击杀 | P2击杀 |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const match of matches) {
        lines.push(`| ${match.seed} | ${match.rounds} | ${match.steps} | ${match.winner ?? '未分胜负'} | ${match.frames} | ${match.decisions} | ` +
            `${match.damageByPlayer.player1} | ${match.damageByPlayer.player2} | ${match.killsByPlayer.player1} | ${match.killsByPlayer.player2} |`);
    }
    lines.push('');
    lines.push('## 每局问题清单');
    for (const match of matches) {
        lines.push('');
        lines.push(`### seed ${match.seed}（P1：${match.teams.join('/')}）`);
        if (match.issues.length === 0) lines.push('- 未发现明显异常');
        else for (const issue of match.issues) lines.push(`- ${issue}`);
    }

    const tally = new Map<string, number>();
    for (const match of matches) {
        for (const issue of match.issues) {
            const kind = issue.split(/[0-9（：]/)[0];
            tally.set(kind, (tally.get(kind) ?? 0) + 1);
        }
    }
    lines.push('');
    lines.push('## 汇总（按出现局数）');
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) lines.push('- 无');
    for (const [kind, count] of ranked) lines.push(`- ${kind}：${count} 局`);
    lines.push('');
    lines.push('> 下一步可选：对「零收益施法 / 放弃更优方案」的决策点做反事实重放（改选次优候选跑到终局比较胜负），用它定量校准 AGGRESSION 权重。');
    return lines.join('\n');
}

function main(): void {
    const games = readArg('games', 4);
    const seedBase = readArg('seed', 20260829);
    const outPath = readFlag('out', '');
    setComputerAiDifficulty('master');

    const matches: MatchResult[] = [];
    for (let index = 0; index < games; index++) {
        const match = playMatch(seedBase + index * 97);
        matches.push(match);
        console.log(`[ai:review] seed=${match.seed} 回合=${match.rounds} 步=${match.steps} 结束=${match.finished} ` +
            `伤害=${match.damageByPlayer.player1}/${match.damageByPlayer.player2} 击杀=${match.killsByPlayer.player1}/${match.killsByPlayer.player2} 决策=${match.decisions} 问题=${match.issues.length}`);
        for (const issue of match.issues) console.log(`    - ${issue}`);
    }

    const report = formatReport(matches);
    console.log('\n' + report);
    if (outPath) {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, report, 'utf8');
        console.log(`\n[ai:review] 报告已写入 ${outPath}`);
    }
}

main();
