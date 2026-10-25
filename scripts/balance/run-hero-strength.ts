/**
 * 全员英雄强度对抗测试：每局让两名被测英雄各带同一组候补上场，直接对撞。
 *
 * 用法：
 *   npx vite-node scripts/balance/run-hero-strength.ts --games=500 --seed=8123 --shard=0/4
 *   npx vite-node scripts/balance/run-hero-strength.ts --aggregate
 *
 * 口径：
 * - 每局从"全部英雄的两两配对"里按 seed 无重复抽一对 (A,B)，双方各带同样 5 名随机候补，
 *   这样两队唯一的系统性差异就是 A 与 B，候补强弱自动抵消（比"1 个被测 + 5 随机 vs 6 随机"方差小得多）；
 * - 同一对英雄的主客场按"谁先手次数少谁先手"贪心配平，消掉席位偏置；
 * - 双方都由宗师档电脑操作，超过 30 回合或停滞时按棋盘力量裁定，差值落在平局带内记 0.5/0.5；
 * - 分片只按局号取模，多个进程跑同一个 seed 也能拼回同一份赛程。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AVAILABLE_HERO_IDS, getHeroInfo } from '../../src/data/heroes';
import { isWeaponImplemented } from '../../src/data/weapon-codex';
import { chooseComputerDeployment, createSeededRandom, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { battleActorFor, runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import { HeroState, Player } from '../../src/types/game';

type HeroId = string;
type Team = HeroId[];

const MAX_BATTLE_ROUNDS = 30;
const MAX_DECISION_STEPS = 4000;
const REPORT_DIR = resolve('reports/balance/strength');
/** --classic = 经典模式（双方全带已实装专属器 + 致知成长），否则标准模式 */
const CLASSIC = process.argv.includes('--classic');
/** 分片与汇总文件按模式分组，避免两种模式的跑批互相覆盖或混算 */
const LABEL = process.argv.find(value => value.startsWith('--label='))?.slice('--label='.length)
    ?? (CLASSIC ? 'classic' : 'standard');
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
        gameMode: CLASSIC ? 'classic' : 'standard',
    });
    setComputerAiDifficulty('master');
    useGameStore.getState().initGame();
    const store = useGameStore.getState();
    for (const heroId of team1) store.selectHeroForPlayer('player1', heroId);
    for (const heroId of team2) store.selectHeroForPlayer('player2', heroId);
    if (!store.confirmHeroSelectionForPlayer('player1')) throw new Error('玩家1选将失败');
    if (!store.confirmHeroSelectionForPlayer('player2')) throw new Error('玩家2选将失败');
    if (CLASSIC) {
        // 经典模式：双方都"全带"（与电脑默认武装一致），并由此走通 武装→布阵 的流转
        const arm = (team: Team) => Object.fromEntries(
            team.filter(isWeaponImplemented).map(heroId => [heroId, heroId])
        );
        useGameStore.setState({ player1WeaponIds: arm(team1), player2WeaponIds: arm(team2) });
        const armed = useGameStore.getState();
        if (!armed.confirmWeaponSelectionForPlayer('player1') || !armed.confirmWeaponSelectionForPlayer('player2')) {
            throw new Error('武装确认失败');
        }
    }
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

interface GameRecord {
    index: number;
    heroA: HeroId;
    heroB: HeroId;
    /** 'A' = 第一被测方胜，'B' = 第二被测方胜，'D' = 裁定平（含停滞与超时同分） */
    result: 'A' | 'B' | 'D';
    /** true = 没有真正分出胜负，靠棋盘力量裁定 */
    adjudicated: boolean;
    stalled: boolean;
    rounds: number;
    supports: HeroId[];
    error?: string;
    stats: Record<HeroId, { damage: number; kills: number; survived: boolean; skill1: number; skill2: number }>;
}

function heroTemplateOf(instanceId: string): string {
    return instanceId.replace(/-(player1|player2)-\d+$/, '');
}

function playGame(index: number, heroA: HeroId, heroB: HeroId, supports: HeroId[]): GameRecord {
    const teamA = [heroA, ...supports];
    const teamB = [heroB, ...supports];
    const record: GameRecord = {
        index, heroA, heroB, result: 'D', adjudicated: false, stalled: false, rounds: 0, supports,
        stats: {},
    };
    try {
        setupMatch(teamA, teamB);
    } catch (error) {
        return { ...record, error: String(error) };
    }

    let steps = 0;
    let previous = '';
    let repeated = 0;
    while (steps < MAX_DECISION_STEPS) {
        const before = useGameStore.getState();
        if (before.phase === 'ended' || before.roundNumber > MAX_BATTLE_ROUNDS) break;
        const signature = stateSignature();
        repeated = signature === previous ? repeated + 1 : 0;
        previous = signature;
        if (repeated >= 6) { record.stalled = true; break; }
        runComputerBattleStep(battleActorFor(before), repeated);
        steps++;
    }

    const state = useGameStore.getState();
    record.rounds = state.roundNumber;
    if (state.winner) {
        record.result = state.winner === 'player1' ? 'A' : 'B';
    } else {
        record.adjudicated = true;
        const p1 = boardPower(state.player1Heroes);
        const p2 = boardPower(state.player2Heroes);
        const difference = p1 - p2;
        const drawBand = Math.max(4, (p1 + p2) * 0.025);
        record.result = Math.abs(difference) <= drawBand ? 'D' : difference > 0 ? 'A' : 'B';
    }

    for (const heroId of [heroA, heroB]) {
        const instance = [...state.player1Heroes, ...state.player2Heroes]
            .find(item => heroTemplateOf(item.id) === heroId &&
                (heroId === heroA ? item.owner === 'player1' : item.owner === 'player2'));
        const stats = instance ? state.battleStatistics?.[instance.id] : undefined;
        record.stats[heroId] = {
            damage: stats?.damageDealt ?? 0,
            kills: stats?.kills ?? 0,
            survived: instance?.state === HeroState.ALIVE,
            skill1: stats?.skill1Casts ?? 0,
            skill2: stats?.skill2Casts ?? 0,
        };
    }
    return record;
}

/** 按 seed 生成完整赛程：无重复配对 + 候补组 + 主客场贪心配平 */
function buildSchedule(games: number, seed: number): { heroA: HeroId; heroB: HeroId; supports: HeroId[] }[] {
    const heroes = [...AVAILABLE_HERO_IDS].sort();
    const pairs: [HeroId, HeroId][] = [];
    for (let i = 0; i < heroes.length; i++) {
        for (let j = i + 1; j < heroes.length; j++) pairs.push([heroes[i], heroes[j]]);
    }
    if (games > pairs.length) {
        console.log(`局数超过可用配对数（${pairs.length}），截断到 ${pairs.length} 局`);
        games = pairs.length;
    }
    const random = mulberry32(seed);
    const picked = shuffle(pairs, random).slice(0, games);
    const balance = new Map<HeroId, number>();
    for (const hero of heroes) balance.set(hero, 0);
    const restOf = (a: HeroId, b: HeroId) => heroes.filter(id => id !== a && id !== b);
    return picked.map(([a, b]) => {
        // 先手场次少的一方坐 player1，两边都平均时按配对顺序稳定分配
        const flip = (balance.get(a) ?? 0) > (balance.get(b) ?? 0);
        const heroA = flip ? b : a;
        const heroB = flip ? a : b;
        balance.set(heroA, (balance.get(heroA) ?? 0) + 1);
        balance.set(heroB, (balance.get(heroB) ?? 0) - 1);
        const supports = shuffle(restOf(heroA, heroB), random).slice(0, 5);
        return { heroA, heroB, supports };
    });
}

interface Aggregate {
    hero: HeroId;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    score: number;
    scoreRate: number;
    /** Wilson 95% 下界，用来把"确实强"和"样本太少的运气好"分开 */
    scoreLow: number;
    scoreHigh: number;
    damage: number;
    kills: number;
    survived: number;
    skill1: number;
    skill2: number;
    rounds: number;
    /** 先手（player1）场次与该侧得分，用于全局先手偏置校正 */
    seatGames: number;
    seatScore: number;
    awayGames: number;
    awayScore: number;
    adjRate: number;
}

function wilson(successes: number, total: number): [number, number] {
    if (!total) return [0, 0];
    const z = 1.96;
    const p = successes / total;
    const denominator = 1 + z * z / total;
    const centre = (p + z * z / (2 * total)) / denominator;
    const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
    return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

function aggregate(games: number, seed: number, shards: number, records: GameRecord[]): void {
    const byHero = new Map<HeroId, Aggregate>();
    const entry = (hero: HeroId): Aggregate => {
        const existing = byHero.get(hero);
        if (existing) return existing;
        const created: Aggregate = {
            hero, games: 0, wins: 0, losses: 0, draws: 0, score: 0, scoreRate: 0,
            scoreLow: 0, scoreHigh: 0, damage: 0, kills: 0, survived: 0, skill1: 0, skill2: 0, rounds: 0,
            seatGames: 0, seatScore: 0, awayGames: 0, awayScore: 0, adjRate: 0,
        };
        byHero.set(hero, created);
        return created;
    };

    for (const record of records) {
        if (record.error) continue;
        const a = entry(record.heroA);
        const b = entry(record.heroB);
        a.games++; b.games++;
        a.rounds += record.rounds; b.rounds += record.rounds;
        if (record.result === 'D') { a.draws++; b.draws++; a.wins += 0; }
        else if (record.result === 'A') { a.wins++; b.losses++; }
        else { b.wins++; a.losses++; }
        // heroA 恒为 player1：逐英雄记先手/后手两栏得分，供全局席位校正
        const aScore = record.result === 'A' ? 1 : record.result === 'D' ? 0.5 : 0;
        a.seatGames++; a.seatScore += aScore;
        b.awayGames++; b.awayScore += 1 - aScore;
        for (const [heroId, stats] of Object.entries(record.stats)) {
            const row = entry(heroId);
            row.damage += stats.damage;
            row.kills += stats.kills;
            row.survived += stats.survived ? 1 : 0;
            row.skill1 += stats.skill1;
            row.skill2 += stats.skill2;
        }
    }

    const seatGamesTotal = [...byHero.values()].reduce((sum, row) => sum + row.seatGames, 0);
    const seatScoreTotal = [...byHero.values()].reduce((sum, row) => sum + row.seatScore, 0);
    // 全局先手得分率超出 0.5 的部分，按场次从先手栏扣回、给后手栏补上
    const seatExcess = seatGamesTotal ? seatScoreTotal / seatGamesTotal - 0.5 : 0;

    const rows = [...byHero.values()].map(row => {
        const score = row.wins + row.draws * 0.5;
        const adjusted = score - seatExcess * (row.seatGames - row.awayGames);
        const [low, high] = wilson(adjusted, Math.max(1, row.games));
        return {
            ...row,
            score,
            scoreRate: row.games ? score / row.games : 0,
            adjRate: row.games ? adjusted / row.games : 0,
            scoreLow: low,
            scoreHigh: high,
        };
    }).sort((x, y) => y.adjRate - x.adjRate || y.damage - x.damage);

    const errors = records.filter(record => record.error).length;
    const adjudicated = records.filter(record => record.adjudicated).length;
    const stalled = records.filter(record => record.stalled).length;
    const avgRounds = records.length
        ? records.reduce((sum, record) => sum + record.rounds, 0) / records.length
        : 0;

    const cell = (value: string, width: number) => {
        const shown = [...value].reduce((n, char) => n + (char.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
        return `${' '.repeat(Math.max(1, width - shown))}${value}`;
    };

    console.log(`\n英雄强度对抗：${records.length} 局有效（计划 ${games}，seed ${seed}，${shards} 分片）`);
    console.log(`超时/停滞裁定 ${adjudicated} 局，停滞 ${stalled} 局，异常 ${errors} 局，平均回合 ${avgRounds.toFixed(1)}`);
    console.log(`每局 = 两名被测英雄各带同一组 5 名候补对撞，计分 = 胜1 / 平0.5 / 负0`);
    console.log(`全局先手得分率 ${((seatExcess + 0.5) * 100).toFixed(1)}%（已按场次配平扣除），下面的"校正"列是扣掉席位偏置后的得分率\n`);
    console.log(`${'英雄'.padEnd(14)}${cell('场次', 5)}${cell('先/后', 7)}${cell('胜', 5)}${cell('负', 5)}${cell('平', 5)}${cell('校正率', 8)}${cell('95%CI', 13)}${cell('伤害/局', 9)}${cell('击杀/局', 9)}${cell('存活', 7)}${cell('S1', 6)}${cell('S2', 6)}${cell('分层', 8)}`);
    for (const row of rows) {
        const name = getHeroInfo(row.hero)?.name ?? row.hero;
        const ci = `${(row.scoreLow * 100).toFixed(0)}~${(row.scoreHigh * 100).toFixed(0)}%`;
        // 只有 CI 整体离开 50% 才算真强/真弱，否则一律记"中性"（样本量决定的分辨率）
        const tier = row.scoreLow > 0.5 ? '偏强' : row.scoreHigh < 0.5 ? '偏弱' : '中性';
        console.log(
            `${name}${' '.repeat(Math.max(1, 14 - [...name].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)))}` +
            `${cell(String(row.games), 5)}${cell(`${row.seatGames}/${row.awayGames}`, 7)}` +
            `${cell(row.wins.toFixed(0), 5)}${cell(row.losses.toFixed(0), 5)}${cell(row.draws.toFixed(0), 5)}` +
            `${cell(`${(row.adjRate * 100).toFixed(1)}%`, 8)}${cell(ci, 13)}` +
            `${cell((row.damage / Math.max(1, row.games)).toFixed(1), 9)}` +
            `${cell((row.kills / Math.max(1, row.games)).toFixed(2), 9)}` +
            `${cell(`${(row.survived / Math.max(1, row.games) * 100).toFixed(0)}%`, 7)}` +
            `${cell((row.skill1 / Math.max(1, row.games)).toFixed(2), 6)}` +
            `${cell((row.skill2 / Math.max(1, row.games)).toFixed(2), 6)}` +
            `${cell(tier, 8)}`,
        );
    }

    const file = resolve(REPORT_DIR, `aggregate-${LABEL}.json`);
    writeFileSync(file, JSON.stringify({ games, seed, shards, generatedAt: new Date().toISOString(), rows, errors, adjudicated, stalled }, null, 2));
    console.log(`\n汇总已写入 ${file}`);
}

function readShardRecords(): GameRecord[] {
    const records: GameRecord[] = [];
    for (const file of readdirSync(REPORT_DIR)) {
        if (!file.startsWith(`shard-${LABEL}-`) || !file.endsWith('.json')) continue;
        const parsed = JSON.parse(readFileSync(resolve(REPORT_DIR, file), 'utf8')) as { records: GameRecord[] };
        records.push(...parsed.records);
    }
    return records;
}

function main(): void {
    if (process.argv.includes('--aggregate')) {
        const records = readShardRecords();
        const seed = numberArg('seed', 8123);
        const shards = numberArg('shards', 4);
        aggregate(numberArg('games', 500), seed, shards, records);
        return;
    }

    const games = numberArg('games', 500);
    const seed = numberArg('seed', 8123);
    const [shardIndex, shardCount] = (() => {
        const raw = process.argv.find(value => value.startsWith('--shard='))?.slice('--shard='.length) ?? '0/1';
        const [i, n] = raw.split('/').map(Number);
        return [i, Number.isFinite(n) && n > 0 ? n : 1];
    })();
    if (!Number.isFinite(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
        console.error(`--shard 需要形如 0/4 且索引小于分片数：收到 ${shardIndex}/${shardCount}`);
        process.exit(1);
    }

    const schedule = buildSchedule(games, seed);
    const mine = schedule.filter((_, index) => index % shardCount === shardIndex);
    console.log(`英雄强度分片 ${shardIndex}/${shardCount}：赛程 ${schedule.length} 局，本片 ${mine.length} 局（seed ${seed}）`);

    const started = performance.now();
    const records: GameRecord[] = [];
    for (const [offset, slot] of mine.entries()) {
        const record = playGame(offset * shardCount + shardIndex, slot.heroA, slot.heroB, slot.supports);
        records.push(record);
        if ((offset + 1) % 10 === 0 || offset + 1 === mine.length) {
            const elapsed = (performance.now() - started) / 1000;
            writeFileSync(resolve(REPORT_DIR, `shard-${LABEL}-${shardIndex}.json`), JSON.stringify({
                shardIndex, shardCount, seed, games: schedule.length, partial: true, records,
            }, null, 2));
            console.log(`  分片${shardIndex} ${offset + 1}/${mine.length}，用时 ${elapsed.toFixed(0)}s，` +
                `预计还需 ${(elapsed / (offset + 1) * (mine.length - offset - 1)).toFixed(0)}s` +
                `${record.error ? ` [异常 ${record.heroA}|${record.heroB}]` : ''}`);
        }
    }
    writeFileSync(resolve(REPORT_DIR, `shard-${LABEL}-${shardIndex}.json`), JSON.stringify({
        shardIndex, shardCount, seed, games: schedule.length, partial: false, records,
    }, null, 2));
    console.log(`分片${shardIndex}完成：${records.length} 局，异常 ${records.filter(r => r.error).length} 局`);
}

main();
