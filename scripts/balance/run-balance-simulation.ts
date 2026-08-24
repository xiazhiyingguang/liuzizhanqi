import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AVAILABLE_HERO_IDS, getHeroInfo } from '../../src/data/heroes';
import { chooseComputerDeployment } from '../../src/core/computer-ai';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import type { BattleStatistics, Hero, Player, Position } from '../../src/types/game';
import { HeroState } from '../../src/types/game';

type HeroId = string;
type Team = [HeroId, HeroId, HeroId, HeroId];

interface SimulationConfig {
    seed: number;
    scheduleRounds: number;
    maxBattleRounds: number;
    maxDecisionSteps: number;
    candidatesPerRound: number;
}

interface ScheduledPairing {
    teamA: Team;
    teamB: Team;
    scheduleRound: number;
    table: number;
}

interface HeroMatchResult {
    heroId: HeroId;
    side: Player;
    score: number;
    won: boolean;
    survived: boolean;
    endHp: number;
    endShield: number;
    maxHp: number;
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    shieldAbsorbed: number;
    kills: number;
    deathRound?: number;
    skill1Casts: number;
    skill2Casts: number;
    movedDistance: number;
}

interface MatchResult {
    id: number;
    scheduleRound: number;
    mirror: boolean;
    team1: Team;
    team2: Team;
    winner?: Player;
    /** 战斗引擎自然产生的胜者；裁定局为空。 */
    engineWinner?: Player;
    scoreP1: number;
    completed: boolean;
    adjudicated: boolean;
    stalled: boolean;
    battleRounds: number;
    decisionSteps: number;
    durationMs: number;
    heroResults: HeroMatchResult[];
}

interface HeroAggregate {
    heroId: HeroId;
    name: string;
    heroClass: string;
    games: number;
    score: number;
    wins: number;
    player1Games: number;
    player1Score: number;
    player2Games: number;
    player2Score: number;
    survived: number;
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    shieldAbsorbed: number;
    kills: number;
    deaths: number;
    deathRoundTotal: number;
    endHpRateTotal: number;
    skill1Casts: number;
    skill2Casts: number;
    movedDistance: number;
    teamDamageShareTotal: number;
    impactElo: number;
    tier: string;
    rank: number;
    winRateLow: number;
    winRateHigh: number;
}

interface PairAggregate {
    games: number;
    score: number;
}

const EMPTY_STATS: BattleStatistics = {
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    shieldAbsorbed: 0,
    kills: 0,
};

function numberArg(name: string, fallback: number): number {
    const prefix = `--${name}=`;
    const raw = process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
    const parsed = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readConfig(): SimulationConfig {
    const quick = process.argv.includes('--quick');
    const deep = process.argv.includes('--deep');
    return {
        seed: numberArg('seed', Number(process.env.BALANCE_SEED) || 20260824),
        scheduleRounds: numberArg(
            'schedule-rounds',
            quick ? 4 : deep ? 24 : Number(process.env.BALANCE_SCHEDULE_ROUNDS) || 12
        ),
        maxBattleRounds: numberArg('max-battle-rounds', Number(process.env.BALANCE_MAX_ROUNDS) || 30),
        maxDecisionSteps: numberArg('max-steps', Number(process.env.BALANCE_MAX_STEPS) || 5000),
        candidatesPerRound: numberArg('schedule-candidates', quick ? 40 : 240),
    };
}

function mulberry32(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value += 0x6D2B79F5;
        let t = value;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
}

function pairKey(left: string, right: string): string {
    return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function relationKeys(teamA: Team, teamB: Team): { teammates: string[]; opponents: string[] } {
    const teammates: string[] = [];
    const opponents: string[] = [];
    for (const team of [teamA, teamB]) {
        for (let a = 0; a < team.length - 1; a++) {
            for (let b = a + 1; b < team.length; b++) teammates.push(pairKey(team[a], team[b]));
        }
    }
    for (const left of teamA) for (const right of teamB) opponents.push(pairKey(left, right));
    return { teammates, opponents };
}

function candidatePairings(order: HeroId[], scheduleRound: number): ScheduledPairing[] {
    const result: ScheduledPairing[] = [];
    for (let table = 0; table < order.length / 8; table++) {
        const group = order.slice(table * 8, table * 8 + 8);
        result.push({
            teamA: group.slice(0, 4) as Team,
            teamB: group.slice(4, 8) as Team,
            scheduleRound,
            table,
        });
    }
    return result;
}

function buildSchedule(heroIds: HeroId[], config: SimulationConfig): ScheduledPairing[] {
    if (heroIds.length % 8 !== 0) throw new Error(`英雄数必须是8的倍数，当前为${heroIds.length}`);
    const random = mulberry32(config.seed ^ 0xA11CE);
    const teammateCounts = new Map<string, number>();
    const opponentCounts = new Map<string, number>();
    const schedule: ScheduledPairing[] = [];

    for (let round = 0; round < config.scheduleRounds; round++) {
        let best: ScheduledPairing[] | null = null;
        let bestScore = -Infinity;
        for (let attempt = 0; attempt < config.candidatesPerRound; attempt++) {
            const candidate = candidatePairings(shuffle(heroIds, random), round);
            let score = 0;
            for (const pairing of candidate) {
                const relations = relationKeys(pairing.teamA, pairing.teamB);
                for (const key of relations.teammates) {
                    const count = teammateCounts.get(key) ?? 0;
                    score += count === 0 ? 18 : 2 / (count + 1);
                }
                for (const key of relations.opponents) {
                    const count = opponentCounts.get(key) ?? 0;
                    score += count === 0 ? 22 : 3 / (count + 1);
                }
            }
            score += random() * 0.001;
            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
        if (!best) throw new Error('无法生成平衡赛程');
        schedule.push(...best);
        for (const pairing of best) {
            const relations = relationKeys(pairing.teamA, pairing.teamB);
            for (const key of relations.teammates) teammateCounts.set(key, (teammateCounts.get(key) ?? 0) + 1);
            for (const key of relations.opponents) opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1);
        }
    }
    return schedule;
}

function teamHash(team: Team): number {
    return team.join('|').split('').reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
}

function deploymentFor(team: Team, side: Player): { heroId: string; position: Position }[] {
    const rotation = teamHash(team) % 6;
    return chooseComputerDeployment(team, []).map(item => ({
        heroId: item.heroId,
        position: [
            (item.position[0] + rotation) % 6,
            side === 'player1' ? 5 - item.position[1] : item.position[1],
        ],
    }));
}

function setupMatch(team1: Team, team2: Team): Map<string, HeroId> {
    useGameStore.setState({ isOnlineMode: false, isAiMode: false, suppressOnlineBroadcast: false });
    useGameStore.getState().initGame();
    const store = useGameStore.getState();
    for (const heroId of team1) store.selectHeroForPlayer('player1', heroId);
    for (const heroId of team2) store.selectHeroForPlayer('player2', heroId);
    if (!store.confirmHeroSelectionForPlayer('player1')) throw new Error('玩家1选将失败');
    if (!store.confirmHeroSelectionForPlayer('player2')) throw new Error('玩家2选将失败');
    for (const item of deploymentFor(team1, 'player1')) {
        if (!useGameStore.getState().deployHeroForPlayer('player1', item.heroId, item.position)) {
            throw new Error(`玩家1部署失败：${item.heroId}@${item.position.join(',')}`);
        }
    }
    for (const item of deploymentFor(team2, 'player2')) {
        if (!useGameStore.getState().deployHeroForPlayer('player2', item.heroId, item.position)) {
            throw new Error(`玩家2部署失败：${item.heroId}@${item.position.join(',')}`);
        }
    }
    if (!useGameStore.getState().confirmDeploymentForPlayer('player1')) throw new Error('玩家1确认布阵失败');
    if (!useGameStore.getState().confirmDeploymentForPlayer('player2')) throw new Error('玩家2确认布阵失败');

    const mapping = new Map<string, HeroId>();
    for (const hero of [...useGameStore.getState().player1Heroes, ...useGameStore.getState().player2Heroes]) {
        const pool = hero.owner === 'player1' ? team1 : team2;
        const heroId = pool.find(id => hero.id.startsWith(`${id}-${hero.owner}-`));
        if (!heroId) throw new Error(`无法识别英雄实例：${hero.id}`);
        mapping.set(hero.id, heroId);
    }
    return mapping;
}

function stateSignature(): string {
    const state = useGameStore.getState();
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
        state.pendingBoardAction?.heroId ?? '-',
        state.libaiChainState?.heroId ?? '-',
        [...state.player1Heroes, ...state.player2Heroes]
            .map(hero => `${hero.id}:${hero.state}:${hero.currentHp}:${hero.shield}:${hero.position?.join(',') ?? '-'}`)
            .join(';'),
    ].join('|');
}

function boardPower(heroes: Hero[]): number {
    return heroes.reduce((total, hero) => {
        if (hero.state === HeroState.DEAD) return total;
        if (hero.state === HeroState.TEMP_DEAD) return total + hero.maxHp * 0.15;
        return total + 25 + hero.currentHp + hero.shield * 0.8;
    }, 0);
}

function copyPositions(): Map<string, { position: Position | null; state: HeroState }> {
    return new Map([...useGameStore.getState().player1Heroes, ...useGameStore.getState().player2Heroes].map(hero => [
        hero.id,
        { position: hero.position ? [...hero.position] : null, state: hero.state },
    ]));
}

function runMatch(
    id: number,
    pairing: ScheduledPairing,
    mirror: boolean,
    config: SimulationConfig,
): MatchResult {
    const started = performance.now();
    const team1 = mirror ? pairing.teamB : pairing.teamA;
    const team2 = mirror ? pairing.teamA : pairing.teamB;
    const instanceToHeroId = setupMatch(team1, team2);
    const casts = new Map<string, [number, number]>();
    const moved = new Map<string, number>();
    let decisionSteps = 0;
    let previousSignature = '';
    let repeated = 0;
    let stalled = false;

    while (decisionSteps < config.maxDecisionSteps) {
        const before = useGameStore.getState();
        if (before.phase === 'ended' || before.roundNumber > config.maxBattleRounds) break;
        const signature = stateSignature();
        repeated = signature === previousSignature ? repeated + 1 : 0;
        previousSignature = signature;
        if (repeated >= 6) {
            stalled = true;
            break;
        }

        const beforePositions = copyPositions();
        const selectedHeroId = before.selectedHero?.id;
        const selectedSkillId = before.selectedSkill?.id;
        const logLength = before.battleLog.length;
        runComputerBattleStep(before.currentPlayer, repeated);
        const after = useGameStore.getState();

        if (selectedHeroId && selectedSkillId && after.battleLog.slice(logLength).some(log => log.type === 'skill')) {
            const current = casts.get(selectedHeroId) ?? [0, 0];
            const hero = [...after.player1Heroes, ...after.player2Heroes].find(item => item.id === selectedHeroId);
            if (hero?.skill1Id === selectedSkillId) current[0]++;
            else if (hero?.skill2Id === selectedSkillId) current[1]++;
            casts.set(selectedHeroId, current);
        }

        for (const hero of [...after.player1Heroes, ...after.player2Heroes]) {
            const old = beforePositions.get(hero.id);
            if (!old?.position || !hero.position || old.state !== HeroState.ALIVE || hero.state !== HeroState.ALIVE) continue;
            const distance = Math.abs(old.position[0] - hero.position[0]) + Math.abs(old.position[1] - hero.position[1]);
            if (distance > 0) moved.set(hero.id, (moved.get(hero.id) ?? 0) + distance);
        }
        decisionSteps++;
    }

    const state = useGameStore.getState();
    // winner 是战斗引擎的权威胜负字段；个别最后一步会先写入 winner，再由界面状态同步 phase。
    const engineWinner = state.winner;
    const completed = !!engineWinner;
    let winner = engineWinner;
    let scoreP1: number;
    let adjudicated = false;
    if (winner) {
        scoreP1 = winner === 'player1' ? 1 : 0;
    } else {
        adjudicated = true;
        const p1Power = boardPower(state.player1Heroes);
        const p2Power = boardPower(state.player2Heroes);
        const difference = p1Power - p2Power;
        const drawBand = Math.max(4, (p1Power + p2Power) * 0.025);
        scoreP1 = Math.abs(difference) <= drawBand ? 0.5 : difference > 0 ? 1 : 0;
        winner = scoreP1 === 0.5 ? undefined : scoreP1 === 1 ? 'player1' : 'player2';
    }

    const rosterHeroes = [...state.player1Heroes, ...state.player2Heroes]
        .filter(hero => instanceToHeroId.has(hero.id));
    const teamDamage = new Map<Player, number>([['player1', 0], ['player2', 0]]);
    for (const hero of rosterHeroes) {
        const stats = state.battleStatistics?.[hero.id] ?? EMPTY_STATS;
        teamDamage.set(hero.owner, (teamDamage.get(hero.owner) ?? 0) + stats.damageDealt);
    }

    const heroResults = rosterHeroes.map(hero => {
        const heroId = instanceToHeroId.get(hero.id)!;
        const stats = state.battleStatistics?.[hero.id] ?? EMPTY_STATS;
        const sideScore = hero.owner === 'player1' ? scoreP1 : 1 - scoreP1;
        const heroCasts = casts.get(hero.id) ?? [0, 0];
        return {
            heroId,
            side: hero.owner,
            score: sideScore,
            won: sideScore === 1,
            survived: hero.state === HeroState.ALIVE,
            endHp: hero.state === HeroState.ALIVE ? hero.currentHp : 0,
            endShield: hero.state === HeroState.ALIVE ? hero.shield : 0,
            maxHp: hero.maxHp,
            damageDealt: stats.damageDealt,
            damageTaken: stats.damageTaken,
            healingDone: stats.healingDone,
            shieldAbsorbed: stats.shieldAbsorbed,
            kills: stats.kills,
            deathRound: stats.lastDeathRound,
            skill1Casts: stats.skill1Casts ?? heroCasts[0],
            skill2Casts: stats.skill2Casts ?? heroCasts[1],
            movedDistance: moved.get(hero.id) ?? 0,
            teamDamage: teamDamage.get(hero.owner) ?? 0,
        };
    }).map(({ teamDamage: damage, ...hero }) => ({ ...hero, teamDamage: damage }));

    return {
        id,
        scheduleRound: pairing.scheduleRound,
        mirror,
        team1,
        team2,
        winner,
        engineWinner,
        scoreP1,
        completed,
        adjudicated,
        stalled,
        battleRounds: Math.min(state.roundNumber, config.maxBattleRounds),
        decisionSteps,
        durationMs: performance.now() - started,
        heroResults: heroResults.map(({ teamDamage: _teamDamage, ...hero }) => hero),
    };
}

function fitImpactRatings(matches: MatchResult[], heroIds: HeroId[]): Map<HeroId, number> {
    const index = new Map(heroIds.map((id, position) => [id, position]));
    const weights = new Float64Array(heroIds.length);
    let sideBias = 0;
    const learningRate = 0.018;
    const regularization = 0.0025;
    for (let epoch = 0; epoch < 1800; epoch++) {
        for (const match of matches) {
            let logit = sideBias;
            for (const id of match.team1) logit += weights[index.get(id)!];
            for (const id of match.team2) logit -= weights[index.get(id)!];
            const prediction = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, logit))));
            const error = match.scoreP1 - prediction;
            for (const id of match.team1) {
                const position = index.get(id)!;
                weights[position] += learningRate * (error - regularization * weights[position]);
            }
            for (const id of match.team2) {
                const position = index.get(id)!;
                weights[position] += learningRate * (-error - regularization * weights[position]);
            }
            sideBias += learningRate * (error - regularization * sideBias);
        }
        const mean = weights.reduce((sum, value) => sum + value, 0) / weights.length;
        for (let i = 0; i < weights.length; i++) weights[i] -= mean;
    }
    const eloScale = 400 / Math.log(10);
    return new Map(heroIds.map((id, position) => [id, weights[position] * eloScale]));
}

function confidenceInterval(score: number, games: number): [number, number] {
    if (games === 0) return [0, 0];
    const proportion = score / games;
    const z = 1.96;
    const denominator = 1 + z * z / games;
    const center = (proportion + z * z / (2 * games)) / denominator;
    const margin = z * Math.sqrt(
        proportion * (1 - proportion) / games + z * z / (4 * games * games)
    ) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function aggregateHeroes(matches: MatchResult[], heroIds: HeroId[]): HeroAggregate[] {
    const impact = fitImpactRatings(matches, heroIds);
    const aggregates = new Map<HeroId, HeroAggregate>();
    for (const heroId of heroIds) {
        const info = getHeroInfo(heroId);
        aggregates.set(heroId, {
            heroId,
            name: info.name,
            heroClass: info.class,
            games: 0,
            score: 0,
            wins: 0,
            player1Games: 0,
            player1Score: 0,
            player2Games: 0,
            player2Score: 0,
            survived: 0,
            damageDealt: 0,
            damageTaken: 0,
            healingDone: 0,
            shieldAbsorbed: 0,
            kills: 0,
            deaths: 0,
            deathRoundTotal: 0,
            endHpRateTotal: 0,
            skill1Casts: 0,
            skill2Casts: 0,
            movedDistance: 0,
            teamDamageShareTotal: 0,
            impactElo: impact.get(heroId) ?? 0,
            tier: '',
            rank: 0,
            winRateLow: 0,
            winRateHigh: 0,
        });
    }
    for (const match of matches) {
        const sideDamage = new Map<Player, number>();
        for (const result of match.heroResults) sideDamage.set(result.side, (sideDamage.get(result.side) ?? 0) + result.damageDealt);
        for (const result of match.heroResults) {
            const aggregate = aggregates.get(result.heroId)!;
            aggregate.games++;
            aggregate.score += result.score;
            aggregate.wins += Number(result.won);
            if (result.side === 'player1') {
                aggregate.player1Games++;
                aggregate.player1Score += result.score;
            } else {
                aggregate.player2Games++;
                aggregate.player2Score += result.score;
            }
            aggregate.survived += Number(result.survived);
            aggregate.damageDealt += result.damageDealt;
            aggregate.damageTaken += result.damageTaken;
            aggregate.healingDone += result.healingDone;
            aggregate.shieldAbsorbed += result.shieldAbsorbed;
            aggregate.kills += result.kills;
            aggregate.deaths += Number(!result.survived);
            aggregate.deathRoundTotal += result.deathRound ?? 0;
            aggregate.endHpRateTotal += result.maxHp > 0 ? (result.endHp + result.endShield) / result.maxHp : 0;
            aggregate.skill1Casts += result.skill1Casts;
            aggregate.skill2Casts += result.skill2Casts;
            aggregate.movedDistance += result.movedDistance;
            const damage = sideDamage.get(result.side) ?? 0;
            aggregate.teamDamageShareTotal += damage > 0 ? result.damageDealt / damage : 0;
        }
    }
    const ranking = [...aggregates.values()].sort((left, right) => right.impactElo - left.impactElo);
    ranking.forEach((hero, index) => {
        hero.rank = index + 1;
        const percentile = index / ranking.length;
        hero.tier = percentile < 0.1 ? 'S' : percentile < 0.3 ? 'A' : percentile < 0.7 ? 'B' : percentile < 0.9 ? 'C' : 'D';
        [hero.winRateLow, hero.winRateHigh] = confidenceInterval(hero.score, hero.games);
    });
    return ranking;
}

function pairAggregates(matches: MatchResult[], kind: 'teammate' | 'opponent'): Map<string, PairAggregate> {
    const result = new Map<string, PairAggregate>();
    const add = (left: string, right: string, score: number) => {
        const key = pairKey(left, right);
        const current = result.get(key) ?? { games: 0, score: 0 };
        current.games++;
        current.score += score;
        result.set(key, current);
    };
    for (const match of matches) {
        if (kind === 'teammate') {
            for (const [team, score] of [[match.team1, match.scoreP1], [match.team2, 1 - match.scoreP1]] as const) {
                for (let a = 0; a < team.length - 1; a++) for (let b = a + 1; b < team.length; b++) add(team[a], team[b], score);
            }
        } else {
            for (const left of match.team1) for (const right of match.team2) add(left, right, match.scoreP1);
        }
    }
    return result;
}

function directedOpponentAggregates(matches: MatchResult[]): Map<string, PairAggregate> {
    const result = new Map<string, PairAggregate>();
    const add = (heroId: string, opponentId: string, score: number) => {
        const key = `${heroId}>${opponentId}`;
        const current = result.get(key) ?? { games: 0, score: 0 };
        current.games++;
        current.score += score;
        result.set(key, current);
    };
    for (const match of matches) {
        for (const heroId of match.team1) for (const opponentId of match.team2) add(heroId, opponentId, match.scoreP1);
        for (const heroId of match.team2) for (const opponentId of match.team1) add(heroId, opponentId, 1 - match.scoreP1);
    }
    return result;
}

function percent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function perGame(total: number, games: number): string {
    return games > 0 ? (total / games).toFixed(1) : '0.0';
}

function heroName(heroId: string): string {
    return getHeroInfo(heroId).name;
}

function pairRows(pairs: Map<string, PairAggregate>, minimumGames: number, descending: boolean): string[] {
    return [...pairs.entries()]
        .filter(([, value]) => value.games >= minimumGames)
        .sort((left, right) => {
            const leftRate = left[1].score / left[1].games;
            const rightRate = right[1].score / right[1].games;
            return descending ? rightRate - leftRate : leftRate - rightRate;
        })
        .slice(0, 10)
        .map(([key, value]) => {
            const [left, right] = key.split('|');
            return `| ${heroName(left)} + ${heroName(right)} | ${value.games} | ${percent(value.score / value.games)} |`;
        });
}

function matchupRows(matchups: Map<string, PairAggregate>, minimumGames: number, descending: boolean): string[] {
    return [...matchups.entries()]
        .filter(([, value]) => value.games >= minimumGames)
        .sort((left, right) => {
            const leftRate = left[1].score / left[1].games;
            const rightRate = right[1].score / right[1].games;
            return descending ? rightRate - leftRate : leftRate - rightRate;
        })
        .slice(0, 10)
        .map(([key, value]) => {
            const [heroId, opponentId] = key.split('>');
            return `| ${heroName(heroId)} 对阵 ${heroName(opponentId)} | ${value.games} | ${percent(value.score / value.games)} |`;
        });
}

function reportMarkdown(
    config: SimulationConfig,
    matches: MatchResult[],
    heroes: HeroAggregate[],
    schedule: ScheduledPairing[],
    elapsedMs: number,
): string {
    const completed = matches.filter(match => match.completed).length;
    const stalled = matches.filter(match => match.stalled).length;
    const p1Score = matches.reduce((sum, match) => sum + match.scoreP1, 0) / matches.length;
    const averageRounds = matches.reduce((sum, match) => sum + match.battleRounds, 0) / matches.length;
    const teammatePairs = pairAggregates(matches, 'teammate');
    const opponentPairs = pairAggregates(matches, 'opponent');
    const directedMatchups = directedOpponentAggregates(matches);
    const totalPairs = AVAILABLE_HERO_IDS.length * (AVAILABLE_HERO_IDS.length - 1) / 2;
    const classMap = new Map<string, { games: number; score: number; damage: number; healing: number }>();
    for (const hero of heroes) {
        const value = classMap.get(hero.heroClass) ?? { games: 0, score: 0, damage: 0, healing: 0 };
        value.games += hero.games;
        value.score += hero.score;
        value.damage += hero.damageDealt;
        value.healing += hero.healingDone;
        classMap.set(hero.heroClass, value);
    }
    const zeroSkillHeroes = heroes.filter(hero => hero.skill1Casts === 0 || hero.skill2Casts === 0);
    const warnings: string[] = [];
    if (completed < matches.length * 0.9) warnings.push(`仅${percent(completed / matches.length)}对局自然结束，其余为回合上限裁定。`);
    if (stalled > 0) warnings.push(`${stalled}局检测到状态停滞。`);
    if (zeroSkillHeroes.length > 0) warnings.push(`${zeroSkillHeroes.length}名英雄至少有一个技能从未被AI成功释放。`);
    if (Math.abs(p1Score - 0.5) > 0.08) warnings.push(`玩家1得分率为${percent(p1Score)}，存在明显先后手偏差。`);

    const lines: string[] = [
        '# 全英雄实际强度仿真报告',
        '',
        `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        '',
        '## 测试口径',
        '',
        `- 英雄池：${AVAILABLE_HERO_IDS.length}名当前可用英雄，全部纳入。`,
        `- 赛程：${config.scheduleRounds}轮平衡分组，每组4v4并交换先后手，共${matches.length}局；每名英雄${heroes[0]?.games ?? 0}局。`,
        `- 决策：双方均使用项目内同一套“宗师电脑”实际移动、选技、选目标与被动选择逻辑。`,
        '- 强度排名：使用全局对局结果拟合英雄对团队胜负的独立影响，显示为相对平均英雄的Elo影响值；原始胜率和区间同时保留。',
        '- 天赋：当前游戏没有统一的全英雄致知选择流程，本报告测试基础形态，不把少数已编码致知混入比较。',
        `- 对局上限：${config.maxBattleRounds}轮或${config.maxDecisionSteps}个决策步骤；未自然结束时按存活单位、生命与护盾裁定。`,
        `- 随机种子：${config.seed}；耗时${(elapsedMs / 1000).toFixed(1)}秒。`,
        '',
        '## 总体结果',
        '',
        `- 自然结束：${completed}/${matches.length}（${percent(completed / matches.length)}）；裁定${matches.length - completed}局；停滞${stalled}局。`,
        `- 玩家1得分率：${percent(p1Score)}；平均战斗轮数：${averageRounds.toFixed(1)}。`,
        `- 队友组合覆盖：${teammatePairs.size}/${totalPairs}（${percent(teammatePairs.size / totalPairs)}）；对手组合覆盖：${opponentPairs.size}/${totalPairs}（${percent(opponentPairs.size / totalPairs)}）。`,
        `- 赛程分组数：${schedule.length}，每组进行镜像对局。`,
        '',
    ];
    if (warnings.length > 0) {
        lines.push('## 质量警告', '', ...warnings.map(item => `- ${item}`), '');
    }
    lines.push(
        '## 英雄强度总榜',
        '',
        '| 排名 | 等级 | 英雄 | 职业 | 场次 | 得分率（95%区间） | Elo影响 | 伤害/局 | 团队伤害占比 | 治疗/局 | 承伤/局 | 击杀/局 | 存活率 | 终局有效生命 | 技能1/2每局 | 位移/局 |',
        '|---:|:---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
        ...heroes.map(hero => `| ${hero.rank} | ${hero.tier} | ${hero.name} | ${hero.heroClass} | ${hero.games} | ${percent(hero.score / hero.games)}（${percent(hero.winRateLow)}–${percent(hero.winRateHigh)}） | ${hero.impactElo >= 0 ? '+' : ''}${hero.impactElo.toFixed(0)} | ${perGame(hero.damageDealt, hero.games)} | ${percent(hero.teamDamageShareTotal / hero.games)} | ${perGame(hero.healingDone, hero.games)} | ${perGame(hero.damageTaken, hero.games)} | ${perGame(hero.kills, hero.games)} | ${percent(hero.survived / hero.games)} | ${percent(hero.endHpRateTotal / hero.games)} | ${(hero.skill1Casts / hero.games).toFixed(2)}/${(hero.skill2Casts / hero.games).toFixed(2)} | ${perGame(hero.movedDistance, hero.games)} |`),
        '',
        '## 职业汇总',
        '',
        '| 职业 | 英雄样本局数 | 得分率 | 伤害/英雄局 | 治疗/英雄局 |',
        '|---|---:|---:|---:|---:|',
        ...[...classMap.entries()].sort((a, b) => b[1].score / b[1].games - a[1].score / a[1].games)
            .map(([heroClass, value]) => `| ${heroClass} | ${value.games} | ${percent(value.score / value.games)} | ${perGame(value.damage, value.games)} | ${perGame(value.healing, value.games)} |`),
        '',
        '## 高胜率队友组合',
        '',
        '| 组合 | 同队场次 | 得分率 |',
        '|---|---:|---:|',
        ...pairRows(teammatePairs, Math.max(2, Math.floor(config.scheduleRounds / 6) * 2), true),
        '',
        '## 低胜率队友组合',
        '',
        '| 组合 | 同队场次 | 得分率 |',
        '|---|---:|---:|',
        ...pairRows(teammatePairs, Math.max(2, Math.floor(config.scheduleRounds / 6) * 2), false),
        '',
        '## 优势对阵样本',
        '',
        '| 对阵 | 场次 | 前者所在队得分率 |',
        '|---|---:|---:|',
        ...matchupRows(directedMatchups, Math.max(2, Math.floor(config.scheduleRounds / 6) * 2), true),
        '',
        '## 劣势对阵样本',
        '',
        '| 对阵 | 场次 | 前者所在队得分率 |',
        '|---|---:|---:|',
        ...matchupRows(directedMatchups, Math.max(2, Math.floor(config.scheduleRounds / 6) * 2), false),
        '',
        '## 机制与AI覆盖异常',
        '',
    );
    if (zeroSkillHeroes.length === 0) {
        lines.push('- 所有英雄的两个技能都至少成功释放过一次。');
    } else {
        for (const hero of zeroSkillHeroes) {
            lines.push(`- ${hero.name}：技能1释放${hero.skill1Casts}次，技能2释放${hero.skill2Casts}次；该技能的实战强度可能被AI低估或驱动尚未覆盖。`);
        }
    }
    lines.push(
        '',
        '## 结论与使用限制',
        '',
        `- 本轮最强的相对影响英雄是${heroes.slice(0, 5).map(hero => `${hero.name}（${hero.impactElo >= 0 ? '+' : ''}${hero.impactElo.toFixed(0)}）`).join('、')}。`,
        `- 本轮最弱的相对影响英雄是${heroes.slice(-5).reverse().map(hero => `${hero.name}（${hero.impactElo.toFixed(0)}）`).join('、')}。`,
        '- 结果衡量的是当前代码、当前宗师AI和4v4赛制下的实际表现，不等同于真人高水平对局；AI不会使用或很少使用的复杂技能会被低估。',
        '- 护盾提供量、控制回合和伤害转移贡献目前没有独立战斗统计字段，它们主要通过胜负影响进入Elo，而不会完整出现在个人面板中。',
        '- 建议优先复核：Elo极端、得分率区间整体偏离50%、技能零使用、或自然结束率过低的英雄。',
        ''
    );
    return lines.join('\n');
}

async function main(): Promise<void> {
    const config = readConfig();
    // 同时固定战斗内的暴击、闪避、随机目标与AI近优选择，保证整份报告可复现。
    Math.random = mulberry32(config.seed ^ 0xBA771E);
    if (AVAILABLE_HERO_IDS.length !== 32) {
        throw new Error(`赛程生成器当前要求32名英雄；检测到${AVAILABLE_HERO_IDS.length}名，请调整分组算法。`);
    }
    const outputDirectory = resolve(process.cwd(), 'reports', 'balance');
    if (process.argv.includes('--refresh-report')) {
        const jsonPath = resolve(outputDirectory, 'latest.json');
        const payload = JSON.parse(await readFile(jsonPath, 'utf8')) as {
            config: SimulationConfig;
            elapsedMs: number;
            matches: MatchResult[];
            [key: string]: unknown;
        };
        const adjudicatedIdArgument = process.argv.find(value => value.startsWith('--adjudicated-ids='));
        const adjudicatedIds = adjudicatedIdArgument
            ? new Set(adjudicatedIdArgument.slice('--adjudicated-ids='.length).split(',').map(Number))
            : null;
        for (const match of payload.matches) {
            if (adjudicatedIds) match.adjudicated = adjudicatedIds.has(match.id);
            if (match.engineWinner !== undefined) match.adjudicated = false;
            match.completed = !match.adjudicated && !!match.winner;
        }
        const heroes = aggregateHeroes(payload.matches, [...AVAILABLE_HERO_IDS]);
        const scheduleStub = Array.from(
            { length: payload.matches.length / 2 },
            (_, index) => ({ scheduleRound: 0, table: index, teamA: [] as unknown as Team, teamB: [] as unknown as Team })
        );
        const markdown = reportMarkdown(payload.config, payload.matches, heroes, scheduleStub, payload.elapsedMs);
        payload.heroes = heroes;
        await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        await writeFile(resolve(outputDirectory, 'latest.md'), `${markdown}\n`, 'utf8');
        process.stdout.write(`已从逐局数据刷新报告：${resolve(outputDirectory, 'latest.md')}\n`);
        return;
    }
    const schedule = buildSchedule([...AVAILABLE_HERO_IDS], config);
    const matches: MatchResult[] = [];
    const started = performance.now();
    let matchId = 1;
    const totalMatches = schedule.length * 2;
    process.stdout.write(`全英雄强度仿真：${AVAILABLE_HERO_IDS.length}名英雄，${totalMatches}局，种子${config.seed}\n`);
    for (const pairing of schedule) {
        for (const mirror of [false, true]) {
            const match = runMatch(matchId++, pairing, mirror, config);
            matches.push(match);
            if (matches.length % 8 === 0 || matches.length === totalMatches) {
                const completed = matches.filter(item => item.completed).length;
                process.stdout.write(`进度 ${matches.length}/${totalMatches}，自然结束 ${completed}，最近一局 ${match.battleRounds}轮/${match.decisionSteps}步\n`);
            }
        }
    }
    const elapsedMs = performance.now() - started;
    const heroes = aggregateHeroes(matches, [...AVAILABLE_HERO_IDS]);
    const markdown = reportMarkdown(config, matches, heroes, schedule, elapsedMs);
    await mkdir(outputDirectory, { recursive: true });
    const payload = {
        generatedAt: new Date().toISOString(),
        config,
        elapsedMs,
        heroCount: AVAILABLE_HERO_IDS.length,
        matchCount: matches.length,
        heroes,
        matches,
    };
    await writeFile(resolve(outputDirectory, 'latest.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await writeFile(resolve(outputDirectory, 'latest.md'), `${markdown}\n`, 'utf8');
    process.stdout.write(`报告已生成：${resolve(outputDirectory, 'latest.md')}\n`);
    process.stdout.write(`数据已生成：${resolve(outputDirectory, 'latest.json')}\n`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
