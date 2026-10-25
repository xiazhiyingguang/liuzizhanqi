/**
 * 体系阵容胜率测试：指定体系核心四人 + 随机候补两人 vs 全随机六人。
 *
 * 用法：
 *   npx vite-node scripts/balance/run-synergy-test.ts --system=寒天 --games=100 --seed=7
 *
 * 口径：
 * - 我方 = 体系核心 4 人（首发）+ 从剩余英雄池随机抽 2 人当候补；
 * - 对面 = 从剩余英雄池随机抽 6 人（与我方不重叠，同平衡 harness 的 12 席位球桌约定）；
 * - 双方都由宗师档电脑操作；逐局轮换体系方先手/后手，消掉单边先手优势；
 * - 超时按棋盘力量裁定（半分=平局），连续同签名判停滞并裁定，与 run-balance-simulation 同口径。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import { chooseComputerDeployment, createSeededRandom, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { battleActorFor, runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { takeAiDecisions } from '../../src/services/battle-replay';
import { useGameStore } from '../../src/store/game-store';
import { HeroState, Player } from '../../src/types/game';

type HeroId = string;
type Team = HeroId[];

/** 体系核心名单：首发四人（候补随机抽）。'随机' 是基线档，无固定核心。 */
const SYSTEMS: Record<string, HeroId[]> = {
    寒天: ['feixue', 'chenyuan', 'hanjiangxue', 'guying'],
    亡灵: ['skeletonking', 'jetzmi', 'soul_lamp', 'wither_lord'],
    随机: [],
};

const MAX_BATTLE_ROUNDS = 30;
const MAX_DECISION_STEPS = 5000;
const REPORT_DIR = resolve('reports/balance');
mkdirSync(REPORT_DIR, { recursive: true });

function numberArg(name: string, fallback: number): number {
    const prefix = `--${name}=`;
    const raw = process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
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

/** 实例 id（`模板-player1-3`）还原成模板 id，用于跨局按英雄聚合 */
function templateOf(instanceId: string): string | null {
    const stripped = instanceId.replace(/-(player1|player2)-\d+$/, '');
    return stripped === instanceId ? null : stripped;
}

function teamHash(team: Team): number {
    return team.reduce((sum, id) => sum + [...id].reduce((s, c) => s + c.charCodeAt(0), 0), 0);
}

function deploymentFor(team: Team, side: Player): { heroId: string; position: [number, number] }[] {
    const seed = teamHash(team);
    const rotation = seed % 6;
    return chooseComputerDeployment(team, [], createSeededRandom(seed)).map(item => ({
        heroId: item.heroId,
        position: [
            (item.position[0] + rotation) % 6,
            side === 'player1' ? 5 - item.position[1] : item.position[1],
        ] as [number, number],
    }));
}

function setupMatch(team1: Team, team2: Team): void {
    useGameStore.setState({
        isOnlineMode: false,
        isAiMode: false,
        suppressOnlineBroadcast: false,
        aiDifficulty: 'master',
    });
    setComputerAiDifficulty('master');
    useGameStore.getState().initGame();
    const store = useGameStore.getState();
    for (const heroId of team1) store.selectHeroForPlayer('player1', heroId);
    for (const heroId of team2) store.selectHeroForPlayer('player2', heroId);
    if (!store.confirmHeroSelectionForPlayer('player1')) throw new Error('玩家1选将失败');
    if (!store.confirmHeroSelectionForPlayer('player2')) throw new Error('玩家2选将失败');
    for (const side of ['player1', 'player2'] as const) {
        const team = side === 'player1' ? team1 : team2;
        for (const item of deploymentFor(team, side)) {
            if (!useGameStore.getState().deployHeroForPlayer(side, item.heroId, item.position)) {
                throw new Error(`${side}部署失败：${item.heroId}@${item.position.join(',')}`);
            }
        }
        if (!useGameStore.getState().confirmDeploymentForPlayer(side)) throw new Error(`${side}确认布阵失败`);
    }
}

function stateSignature(): string {
    const state = useGameStore.getState();
    return [
        state.phase,
        state.currentPlayer,
        state.reinforcingPlayer ?? '-',
        state.roundNumber,
        state.actionsThisTurn,
        state.selectedHero?.id ?? '-',
        state.selectedSkill?.id ?? '-',
        state.moveRange.length,
        state.skillRange.length,
        state.pendingSkillTargetPositions?.length ?? 0,
        state.pendingBoardAction?.heroId ?? '-',
        state.libaiChainState?.heroId ?? '-',
        [...state.player1Heroes, ...state.player2Heroes]
            .map(hero => `${hero.id}:${hero.state}:${hero.currentHp}:${hero.shield}:${hero.position?.join(',') ?? '-'}`)
            .join(';'),
    ].join('|');
}

function boardPower(heroes: { state: HeroState; currentHp: number; shield: number; maxHp: number }[]): number {
    return heroes.reduce((total, hero) => {
        if (hero.state === HeroState.DEAD) return total;
        if (hero.state === HeroState.TEMP_DEAD) return total + hero.maxHp * 0.15;
        return total + 25 + hero.currentHp + hero.shield * 0.8;
    }, 0);
}

interface MatchOutcome {
    systemWon: boolean;
    adjudicated: boolean;
    stalled: boolean;
    battleRounds: number;
    error?: string;
    systemSide: Player;
    /** 体系核心四人本局的登场与战果 */
    core: { heroId: HeroId; entered: boolean; kills: number; damage: number; survived: boolean }[];
}

/** 体系机制探针：逐拍采样共鸣、自身暂死、形态与施法次数，用来判"AI 有没有在玩这套体系" */
interface Probe {
    resonanceMax: number;
    resonanceEnd: number;
    /** 核心四人里出现"自己人把自己打成暂时阵亡"的次数（体系代价） */
    selfTempDeaths: number;
    /** 体系方被复活回来的次数 */
    revives: number;
    /** 本局里杰茨米是否至少切换到过终焉国王形态 */
    everKingForm: boolean;
    /** 关键机制日志出现次数（--keywords=暗夜法阵,缚魂轮转），用来判"计划"是否真落地成"结算" */
    keyLogs: Record<string, number>;
    /** 游隼疾掠逐次台账：冲刺格数与穿透敌人数（距离1在机制上打不到人，必须分开看） */
    dashes: { distance: number; hits: number }[];
    casts: { heroId: HeroId; skill1: number; skill2: number; damageTaken: number }[];
    /** 技能候选归因：heroId|skillId → 被枚举次数 / 被采纳次数 / 平均分 */
    skills: { key: string; enumerated: number; chosen: number; avgScore: number }[];
    /** 全员体检：本局两侧实际登场过的每个英雄的技能释放数 */
    usage: { hero: string; skill1: number; skill2: number }[];
    /** 攻击力读数：两侧合计的伤害、击杀、真实出手（含普攻）与纯移动无伤害的回合数 */
    bite: { damage: number; kills: number; damageActions: number; casts: number };
}

interface MatchOutcome {
    systemWon: boolean;
    adjudicated: boolean;
    stalled: boolean;
    battleRounds: number;
    error?: string;
    systemSide: Player;
    /** 体系核心四人本局的登场与战果 */
    core: { heroId: HeroId; entered: boolean; kills: number; damage: number; survived: boolean }[];
    probe?: Probe;
}

function runMatch(systemTeam: Team, randomTeam: Team, systemAsPlayer1: boolean, probing = false, keywords: string[] = []): MatchOutcome {
    const team1 = systemAsPlayer1 ? systemTeam : randomTeam;
    const team2 = systemAsPlayer1 ? randomTeam : systemTeam;
    const systemSide: Player = systemAsPlayer1 ? 'player1' : 'player2';
    try {
        setupMatch(team1, team2);
    } catch (error) {
        return {
            systemWon: false, adjudicated: false, stalled: false, battleRounds: 0,
            error: String(error), systemSide, core: [],
        };
    }

    let steps = 0;
    let previous = '';
    let repeated = 0;
    let stalled = false;
    const coreIds = systemTeam.slice(0, 4);
    let resonanceMax = 0;
    let selfTempDeaths = 0;
    let everKingForm = false;
    const keyLogs: Record<string, number> = {};
    const dashes: { distance: number; hits: number }[] = [];
    const seenLogIds = new Set<string>();
    const stateBefore = new Map<string, HeroState>();
    while (steps < MAX_DECISION_STEPS) {
        const before = useGameStore.getState();
        if (before.phase === 'ended' || before.roundNumber > MAX_BATTLE_ROUNDS) break;
        if (probing) {
            const counters = before.deathCounters;
            resonanceMax = Math.max(resonanceMax,
                systemSide === 'player1' ? counters.player1Dead : counters.player2Dead);
            for (const entry of before.battleLog ?? []) {
                if (entry.player !== systemSide || seenLogIds.has(entry.id)) continue;
                seenLogIds.add(entry.id);
                for (const keyword of keywords) {
                    if (entry.message.includes(keyword)) keyLogs[keyword] = (keyLogs[keyword] ?? 0) + 1;
                }
                const dash = /疾掠(\d+)格/.exec(entry.message);
                if (dash) {
                    const hits = /穿透(\d+)名敌人/.exec(entry.message);
                    dashes.push({ distance: Number(dash[1]), hits: hits ? Number(hits[1]) : 0 });
                }
            }
            for (const hero of [...before.player1Heroes, ...before.player2Heroes]) {
                if (hero.owner !== systemSide) continue;
                const was = stateBefore.get(hero.id);
                stateBefore.set(hero.id, hero.state);
                if (was === HeroState.ALIVE && hero.state === HeroState.TEMP_DEAD
                    && coreIds.some(id => hero.id.startsWith(`${id}-${systemSide}-`))) selfTempDeaths++;
                if (hero.id.startsWith(`jetzmi-${systemSide}-`) && hero.counters['jetzmi_form'] === 1) everKingForm = true;
            }
        }
        const signature = stateSignature();
        repeated = signature === previous ? repeated + 1 : 0;
        previous = signature;
        if (repeated >= 6) { stalled = true; break; }
        runComputerBattleStep(battleActorFor(before), repeated);
        steps++;
    }

    const state = useGameStore.getState();
    let systemWon: boolean;
    let adjudicated = false;
    if (state.winner) {
        systemWon = state.winner === systemSide;
    } else {
        adjudicated = true;
        const p1 = boardPower(state.player1Heroes);
        const p2 = boardPower(state.player2Heroes);
        const difference = p1 - p2;
        const drawBand = Math.max(4, (p1 + p2) * 0.025);
        if (Math.abs(difference) <= drawBand) systemWon = false;
        else systemWon = (difference > 0) === (systemSide === 'player1');
    }

    const instances = [...state.player1Heroes, ...state.player2Heroes];
    const core = systemTeam.slice(0, 4).map(heroId => {
        const hero = instances.find(item =>
            item.owner === systemSide && item.id.startsWith(`${heroId}-${systemSide}-`));
        const stats = hero ? state.battleStatistics?.[hero.id] : undefined;
        return {
            heroId,
            entered: !!hero,
            kills: stats?.kills ?? 0,
            damage: stats?.damageDealt ?? 0,
            survived: hero?.state === HeroState.ALIVE,
        };
    });

    const counters = state.deathCounters;
    // 决策留档：核心四人每个技能"被枚举到几次 / 被采纳几次 / 平均分"，
    // 用来区分"AI 压根不考虑"（枚举到但分数永远垫底）和"条件不满足没进候选"（枚举为 0）
    const skillAudit = probing ? new Map<string, { enumerated: number; chosen: number; scoreSum: number }>() : undefined;
    if (probing) {
        // 两侧都审计：电脑操控的 12 个英雄用同一套评分，读出来的"会不会玩"对两边都成立
        for (const decision of takeAiDecisions()) {
            const templateId = templateOf(decision.heroId);
            if (!templateId) continue;
            decision.candidates.forEach(candidate => {
                const key = `${templateId}|${candidate.skillId}`;
                const row = skillAudit!.get(key) ?? { enumerated: 0, chosen: 0, scoreSum: 0 };
                row.enumerated++;
                row.scoreSum += candidate.score;
                if (decision.chosenSkillId === candidate.skillId) row.chosen++;
                skillAudit!.set(key, row);
            });
        }
    }
    const probe: Probe | undefined = probing ? {
        resonanceMax,
        resonanceEnd: systemSide === 'player1' ? counters.player1Dead : counters.player2Dead,
        selfTempDeaths,
        revives: systemSide === 'player1' ? counters.player1Resurrections : counters.player2Resurrections,
        everKingForm,
        keyLogs,
        dashes,
        casts: coreIds.map(heroId => {
            const hero = instances.find(item =>
                item.owner === systemSide && item.id.startsWith(`${heroId}-${systemSide}-`));
            const stats = hero ? state.battleStatistics?.[hero.id] : undefined;
            return {
                heroId,
                skill1: stats?.skill1Casts ?? 0,
                skill2: stats?.skill2Casts ?? 0,
                damageTaken: stats?.damageTaken ?? 0,
            };
        }),
        skills: [...skillAudit!].map(([key, row]) => ({
            key,
            enumerated: row.enumerated,
            chosen: row.chosen,
            avgScore: row.scoreSum / Math.max(1, row.enumerated),
        })),
        usage: instances.filter(hero => !hero.id.includes('|')).map(hero => ({
            hero: templateOf(hero.id) ?? hero.id,
            skill1: state.battleStatistics?.[hero.id]?.skill1Casts ?? 0,
            skill2: state.battleStatistics?.[hero.id]?.skill2Casts ?? 0,
        })),
        bite: instances.reduce((total, hero) => {
            const stats = state.battleStatistics?.[hero.id];
            if (!stats) return total;
            return {
                damage: total.damage + (stats.damageDealt ?? 0),
                kills: total.kills + (stats.kills ?? 0),
                damageActions: total.damageActions + ((stats.skill1Casts ?? 0) + (stats.skill2Casts ?? 0) > 0 ? 1 : 0),
                casts: total.casts + (stats.skill1Casts ?? 0) + (stats.skill2Casts ?? 0),
            };
        }, { damage: 0, kills: 0, damageActions: 0, casts: 0 }),
    } : undefined;

    return {
        systemWon, adjudicated, stalled,
        battleRounds: Math.min(state.roundNumber, MAX_BATTLE_ROUNDS),
        systemSide, core, probe,
    };
}

function main(): void {
    const systemName = process.argv.find(v => v.startsWith('--system='))?.slice('--system='.length) ?? '寒天';
    // --core=a,b,c,d 直接指定首发四人，便于临时排查单个英雄（不必先往 SYSTEMS 表里塞条目）
    const coreOverride = process.argv.find(v => v.startsWith('--core='))?.slice('--core='.length);
    const core = coreOverride
        ? coreOverride.split(',').map(id => id.trim()).filter(Boolean)
        : SYSTEMS[systemName];
    if (!core) {
        console.error(`未知体系：${systemName}（可选：${Object.keys(SYSTEMS).join('、')}）`);
        process.exit(1);
    }
    const games = numberArg('games', 100);
    const probing = process.argv.includes('--probe');
    const keywords = (process.argv.find(v => v.startsWith('--keywords='))?.slice('--keywords='.length) ?? '')
        .split(',').filter(Boolean);
    const seed = numberArg('seed', 20260927);
    const random = mulberry32(seed);
    const pool = [...AVAILABLE_HERO_IDS];
    // --system=随机 是基线档：两边都从池子里纯随机抽，用来标定 harness 的中立胜率和先后手偏置。
    const baseline = core.length === 0;
    const rest = pool.filter(id => !core.includes(id));

    if (baseline) {
        console.log(`基线对抗测试：双方各自从 ${pool.length} 名英雄随机抽 6 人`);
    } else {
        console.log(`体系对抗测试：${systemName} = ${core.join('、')}`);
        console.log(`候补与对手从剩余 ${rest.length} 名英雄随机抽；${games} 局；体系方先后手轮换；seed=${seed}\n`);
    }

    const outcomes: MatchOutcome[] = [];
    const started = performance.now();
    for (let match = 0; match < games; match++) {
        let systemTeam: Team;
        let randomTeam: Team;
        if (baseline) {
            const shuffled = shuffle(pool, random);
            systemTeam = shuffled.slice(0, 6);
            randomTeam = shuffled.slice(6, 12);
        } else {
            const shuffled = shuffle(rest, random);
            systemTeam = [...core, shuffled[0], shuffled[1]];
            randomTeam = shuffled.slice(2, 8);
        }
        outcomes.push(runMatch(systemTeam, randomTeam, match % 2 === 0, probing, keywords));
        if ((match + 1) % 10 === 0) {
            const wins = outcomes.filter(o => o.systemWon).length;
            process.stdout.write(`  已完成 ${match + 1}/${games}，体系胜 ${wins}\n`);
            // 每十局落一次盘：中途被打断也不至于把跑完的数据全丢掉
            writeFileSync(resolve(REPORT_DIR, `synergy-${systemName}.json`), JSON.stringify({
                system: systemName, core, games, seed, partial: true,
                completed: outcomes.length, wins,
                winRate: wins / outcomes.length, outcomes,
            }, null, 2));
        }
    }

    const valid = outcomes.filter(o => !o.error);
    const wins = valid.filter(o => o.systemWon).length;
    const rate = wins / Math.max(1, valid.length);
    // 正态近似 95% 置信区间
    const margin = 1.96 * Math.sqrt((rate * (1 - rate)) / Math.max(1, valid.length));
    const avgRounds = valid.reduce((sum, o) => sum + o.battleRounds, 0) / Math.max(1, valid.length);
    const adjudicated = valid.filter(o => o.adjudicated).length;
    const stalledCount = valid.filter(o => o.stalled).length;
    const errors = outcomes.length - valid.length;

    const seatSplit = (['player1', 'player2'] as Player[]).map(side => {
        const gamesAt = valid.filter(o => o.systemSide === side);
        const w = gamesAt.filter(o => o.systemWon).length;
        return `${side === 'player1' ? '执先' : '执后'} ${w}/${gamesAt.length}`;
    }).join('，');

    // 先落盘再打印：打印段的任何意外都不该把跑完的数据带走
    writeFileSync(resolve(REPORT_DIR, `synergy-${systemName}.json`), JSON.stringify({
        system: systemName, core, games, seed,
        winRate: rate, ci95: [Math.max(0, rate - margin), Math.min(1, rate + margin)],
        avgRounds, adjudicated, stalled: stalledCount, errors, seatSplit,
        durationSec: Math.round((performance.now() - started) / 1000),
        outcomes,
    }, null, 2));

    console.log('\n========== 结果 ==========');
    console.log(`有效局数：${valid.length}（异常 ${errors}，裁定 ${adjudicated}，停滞 ${stalledCount}）`);
    console.log(`${systemName}方胜率：${(rate * 100).toFixed(1)}%  [95% CI ${(Math.max(0, rate - margin) * 100).toFixed(1)}% ~ ${Math.min(1, rate + margin) * 100 > 99.95 ? '100.0' : (Math.min(1, rate + margin) * 100).toFixed(1)}%]  ${seatSplit}`);
    console.log(`平均战斗轮数：${avgRounds.toFixed(1)}（上限 ${MAX_BATTLE_ROUNDS}）`);

    const byHero = new Map<string, { games: number; wins: number; kills: number; damage: number; survived: number }>();
    valid.forEach(outcome => {
        for (const entry of outcome.core) {
            const row = byHero.get(entry.heroId) ?? { games: 0, wins: 0, kills: 0, damage: 0, survived: 0 };
            row.games++;
            row.wins += outcome.systemWon ? 1 : 0;
            row.kills += entry.kills;
            row.damage += entry.damage;
            row.survived += entry.survived ? 1 : 0;
            byHero.set(entry.heroId, row);
        }
    });
    if (core.length) {
        console.log('\n核心四人（登场率/存活率/局均击杀/局均伤害）：');
        for (const heroId of core) {
            const row = byHero.get(heroId);
            if (!row) continue;
            console.log(`  ${heroId.padEnd(14)} 登场 ${(row.games / valid.length * 100).toFixed(0)}%  存活 ${(row.survived / Math.max(1, row.games) * 100).toFixed(0)}%  击杀 ${(row.kills / Math.max(1, row.games)).toFixed(2)}  伤害 ${(row.damage / Math.max(1, row.games)).toFixed(1)}`);
        }
    }

    if (probing) {
        const probed = valid.filter(o => o.probe);
        const avg = (pick: (outcome: MatchOutcome) => number) =>
            probed.length ? probed.reduce((sum, o) => sum + pick(o), 0) / probed.length : 0;
        console.log('  攻击力读数（两侧合计，局均）：'
            + `总伤害 ${avg(o => o.probe!.bite.damage).toFixed(1)}`
            + `  击杀 ${avg(o => o.probe!.bite.kills).toFixed(2)}`
            + `  技能释放 ${avg(o => o.probe!.bite.casts).toFixed(2)}`
            + `  轮数 ${avgRounds.toFixed(1)}`);
        console.log('\n体系探针（判"AI 到底有没有在玩这套体系"）：');
        console.log(`  亡灵共鸣峰值/终值 ${avg(o => o.probe!.resonanceMax).toFixed(1)} / ${avg(o => o.probe!.resonanceEnd).toFixed(1)}  复活次数 ${avg(o => o.probe!.revives).toFixed(1)}  自身暂死 ${avg(o => o.probe!.selfTempDeaths).toFixed(1)} 次  杰茨米变过国王形态 ${(probed.filter(o => o.probe!.everKingForm).length / Math.max(1, probed.length) * 100).toFixed(0)}%`);
        if (keywords.length) {
            console.log('  关键机制日志（局均真实结算次数）：'
                + keywords.map(keyword => `${keyword} ${avg(o => o.probe!.keyLogs[keyword] ?? 0).toFixed(2)}`).join('   '));
        }
        const dashAll = probed.flatMap(o => o.probe!.dashes);
        if (dashAll.length) {
            const hits = dashAll.filter(d => d.hits > 0).length;
            const missShort = dashAll.filter(d => d.hits === 0 && d.distance <= 1).length;
            const missLong = dashAll.filter(d => d.hits === 0 && d.distance >= 2).length;
            console.log(`  疾掠台账：共 ${dashAll.length} 次，穿透命中 ${hits} 次（${(hits / dashAll.length * 100).toFixed(0)}%）；`
                + `空冲里 1 格（路径上没有格可打）${missShort} 次、≥2 格（本有机会咬人）${missLong} 次`);
        }
        const castAvg = new Map<HeroId, { s1: number; s2: number; taken: number; n: number }>();        for (const outcome of probed) {
            for (const row of outcome.probe!.casts) {
                const agg = castAvg.get(row.heroId) ?? { s1: 0, s2: 0, taken: 0, n: 0 };
                agg.s1 += row.skill1; agg.s2 += row.skill2; agg.taken += row.damageTaken; agg.n++;
                castAvg.set(row.heroId, agg);
            }
        }
        console.log('  局均施法次数（技能一/技能二）与承受伤害：');
        for (const heroId of (core.length ? core : [])) {
            const agg = castAvg.get(heroId);
            if (!agg || !agg.n) continue;
            console.log(`    ${heroId.padEnd(14)} S1 ${(agg.s1 / agg.n).toFixed(2)}  S2 ${(agg.s2 / agg.n).toFixed(2)}  承伤 ${(agg.taken / agg.n).toFixed(1)}`);
        }
        const skillAgg = new Map<string, { enum: number; chosen: number; score: number; games: number }>();
        for (const outcome of probed) {
            const seen = new Set<string>();
            for (const row of outcome.probe!.skills) {
                const agg = skillAgg.get(row.key) ?? { enum: 0, chosen: 0, score: 0, games: 0 };
                agg.enum += row.enumerated;
                agg.chosen += row.chosen;
                agg.score += row.avgScore;
                if (!seen.has(row.key)) { agg.games++; seen.add(row.key); }
                skillAgg.set(row.key, agg);
            }
        }
        console.log('  关键机制日志（局均次数）：');
        const keywordTotals = new Map<string, number>();
        for (const outcome of probed) {
            for (const [keyword, count] of Object.entries(outcome.probe!.keyLogs)) {
                keywordTotals.set(keyword, (keywordTotals.get(keyword) ?? 0) + count);
            }
        }
        for (const [keyword, total] of keywordTotals) {
            console.log(`    ${keyword.padEnd(12)} ${(total / probed.length).toFixed(2)}`);
        }
        if (process.argv.includes('--health')) {
            console.log('  技能候选归因（全员，局均被枚举 / 被采纳 / 平均分）：');
            for (const [key, agg] of [...skillAgg].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
                console.log(`    ${key.padEnd(34)} 枚举 ${(agg.enum / probed.length).toFixed(2)}  采纳 ${(agg.chosen / probed.length).toFixed(2)}  平均分 ${(agg.score / Math.max(1, agg.games)).toFixed(1)}`);
            }
        } else if (core.length) {
            // 体系复测只关心核心四人，别把两侧 88 行候选表糊在结果里
            console.log('  技能候选归因（核心四人，局均被枚举 / 被采纳 / 平均分）：');
            for (const [key, agg] of [...skillAgg].filter(([key]) => core.includes(key.split('|')[0]))
                .sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
                console.log(`    ${key.padEnd(34)} 枚举 ${(agg.enum / probed.length).toFixed(2)}  采纳 ${(agg.chosen / probed.length).toFixed(2)}  平均分 ${(agg.score / Math.max(1, agg.games)).toFixed(1)}`);
            }
        }

        if (process.argv.includes('--health')) {
            // 全员体检：把"AI 每局把某个技能摆上菜单多少次"和"它真正放过几次"对齐，
            // 只被枚举不被施法的技能 = 评分函数读不到它的价值（闸门永远压死）。
            const usage = new Map<string, { games: number; s1: number; s2: number }>();
            for (const outcome of probed) {
                for (const row of outcome.probe!.usage) {
                    const agg = usage.get(row.hero) ?? { games: 0, s1: 0, s2: 0 };
                    agg.games++; agg.s1 += row.skill1; agg.s2 += row.skill2;
                    usage.set(row.hero, agg);
                }
            }
            const rows: { key: string; enumPerAppear: number; chosenPerGame: number; castsPerAppear: number; avgScore: number; flag: string }[] = [];
            for (const [key, agg] of skillAgg) {
                const [hero, skillId] = key.split('|');
                const use = usage.get(hero);
                const casts = skillId.endsWith('skill2') ? use?.s2 ?? 0 : use?.s1 ?? 0;
                const castsPerAppear = use && use.games ? casts / use.games : 0;
                // 枚举次数必须按"登场局"归一：两步点击的技能一个回合会产生多次决策留档，
                // 按局数当分母会让南风这类英雄的采纳率虚高，看起来像"想到了却没放"。
                const enumPerAppear = use && use.games ? agg.enum / use.games : 0;
                const avgScore = agg.score / Math.max(1, agg.games);
                const neverCast = enumPerAppear >= 1 && castsPerAppear < 0.05;
                const rarelyCast = !neverCast && enumPerAppear >= 2 && castsPerAppear < 0.3;
                rows.push({
                    key,
                    enumPerAppear,
                    chosenPerGame: agg.chosen / probed.length,
                    castsPerAppear,
                    avgScore,
                    flag: neverCast ? '从不施法' : rarelyCast ? '几乎不用' : avgScore <= 0 ? '负分为主' : '',
                });
            }
            rows.sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0)
                || b.enumPerAppear * (b.castsPerAppear < 0.05 ? 1 : 0) - a.enumPerAppear * (a.castsPerAppear < 0.05 ? 1 : 0));
            console.log(`\n  全员体检（${probed.length} 局，两侧共 ${usage.size} 名英雄登场；枚举与施法均按该英雄登场局归一）：`);
            console.log(`    ${'技能'.padEnd(34)}${'枚举/登场'.padStart(10)}${'采纳/局'.padStart(9)}${'施法/登场'.padStart(11)}${'平均分'.padStart(9)}  症状`);
            for (const row of rows.filter(item => item.flag)) {
                console.log(`    ${row.key.padEnd(34)}${row.enumPerAppear.toFixed(2).padStart(10)}${row.chosenPerGame.toFixed(2).padStart(9)}${row.castsPerAppear.toFixed(2).padStart(11)}${row.avgScore.toFixed(1).padStart(9)}  ${row.flag}`);
            }
            const healthy = rows.filter(row => !row.flag).length;
            console.log(`    —— 其余 ${healthy} 条无明显异常`);
        }
    }

    console.log(`\n明细已写入 reports/balance/synergy-${systemName}.json`);
}

main();
