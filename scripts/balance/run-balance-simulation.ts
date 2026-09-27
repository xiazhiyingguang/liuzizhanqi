import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AVAILABLE_HERO_IDS, createHero, getHeroInfo } from '../../src/data/heroes';
import { chooseComputerDeployment } from '../../src/core/computer-ai';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { takeAiDecisions } from '../../src/services/battle-replay';
import { useGameStore } from '../../src/store/game-store';
import type { BattleStatistics, Hero, Player, Position } from '../../src/types/game';
import { HeroState } from '../../src/types/game';

type HeroId = string;
/** 替补制赛制：每方6人名单（4首发 + 2替补），因此每局占用12个英雄席位。 */
const ROSTER_SIZE = 6;
const STARTERS = 4;
const TABLE_SIZE = ROSTER_SIZE * 2;
type Team = HeroId[];

interface SimulationConfig {
    seed: number;
    /** 目标总局数；>0 时按赛程规模反推 scheduleRounds。 */
    targetMatches: number;
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
    /** 该英雄本局是否真正上场过（首发或替补登场）；全程坐冷板凳时为 false。 */
    entered: boolean;
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
    /** 单局内部异常（选将/部署/结算抛错）时记录原因，该局不计入统计。 */
    error?: string;
}

interface HeroAggregate {
    heroId: HeroId;
    name: string;
    heroClass: string;
    /** 进入名单的局数（含全程替补的局）。 */
    games: number;
    /** 真正上场过的局数，个人数据按这一列平均。 */
    enteredGames: number;
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

/** AI 决策归因：某个英雄的某个技能在电脑手上到底被不被考虑、被考虑后分数如何 */
interface SkillAuditRow {
    heroId: HeroId;
    skillId: string;
    /** 该技能进入候选列表的决策次数 */
    enumerated: number;
    /** 其中被采纳为最终方案的次数 */
    chosen: number;
    /** 历史最高方案分 */
    bestScore: number;
    /** 该技能是当场最高分、却仍未被采纳的次数（被上层闸门/位移偏好压掉） */
    outvoted: number;
    /** 走到"技能已被选中、即将执行"这一步的次数：与成功施放数的差就是执行链失败数 */
    attempted: number;
}

type SkillAudit = Map<string, SkillAuditRow>;

function auditKey(heroId: HeroId, skillId: string): string {
    return `${heroId}|${skillId}`;
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
        targetMatches: numberArg('matches', Number(process.env.BALANCE_MATCHES) || 0),
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
    for (let table = 0; table < Math.floor(order.length / TABLE_SIZE); table++) {
        const group = order.slice(table * TABLE_SIZE, table * TABLE_SIZE + TABLE_SIZE);
        result.push({
            teamA: group.slice(0, ROSTER_SIZE),
            teamB: group.slice(ROSTER_SIZE, TABLE_SIZE),
            scheduleRound,
            table,
        });
    }
    return result;
}

/** 每轮可安排的对局数（含镜像局）。 */
function matchesPerRound(heroCount: number): number {
    return Math.floor(heroCount / TABLE_SIZE) * 2;
}

function buildSchedule(heroIds: HeroId[], config: SimulationConfig): ScheduledPairing[] {
    if (heroIds.length < TABLE_SIZE) throw new Error(`英雄数不足${TABLE_SIZE}名，无法生成6v6名单赛程，当前为${heroIds.length}`);
    const random = mulberry32(config.seed ^ 0xA11CE);
    const teammateCounts = new Map<string, number>();
    const opponentCounts = new Map<string, number>();
    const byeCounts = new Map<string, number>();
    const schedule: ScheduledPairing[] = [];
    // 英雄数不是每局席位的整数倍时，每轮让"迄今轮空最少"的若干英雄整轮不上，长期保证每人场次接近。
    const byePerRound = heroIds.length % TABLE_SIZE;

    for (let round = 0; round < config.scheduleRounds; round++) {
        let best: { pairings: ScheduledPairing[]; byed: HeroId[] } | null = null;
        let bestScore = -Infinity;
        for (let attempt = 0; attempt < config.candidatesPerRound; attempt++) {
            const shuffled = shuffle(heroIds, random);
            const byed = byePerRound === 0
                ? []
                : [...shuffled]
                    .sort((left, right) => (byeCounts.get(left) ?? 0) - (byeCounts.get(right) ?? 0))
                    .slice(0, byePerRound);
            const byedSet = new Set(byed);
            const playing = byePerRound === 0 ? shuffled : shuffled.filter(id => !byedSet.has(id));
            const candidate = candidatePairings(playing, round);
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
                best = { pairings: candidate, byed };
            }
        }
        if (!best) throw new Error('无法生成平衡赛程');
        schedule.push(...best.pairings);
        for (const heroId of best.byed) byeCounts.set(heroId, (byeCounts.get(heroId) ?? 0) + 1);
        for (const pairing of best.pairings) {
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

function setupMatch(team1: Team, team2: Team): void {
    if (team1.length !== ROSTER_SIZE || team2.length !== ROSTER_SIZE) {
        throw new Error(`名单规模应为${ROSTER_SIZE}人，实际${team1.length}/${team2.length}`);
    }
    useGameStore.setState({ isOnlineMode: false, isAiMode: false, suppressOnlineBroadcast: false });
    useGameStore.getState().initGame();
    const store = useGameStore.getState();
    for (const heroId of team1) store.selectHeroForPlayer('player1', heroId);
    for (const heroId of team2) store.selectHeroForPlayer('player2', heroId);
    if (!store.confirmHeroSelectionForPlayer('player1')) throw new Error('玩家1选将失败');
    if (!store.confirmHeroSelectionForPlayer('player2')) throw new Error('玩家2选将失败');
    // 首发4人由 chooseComputerDeployment 按阵容职责挑选，其余2人自动进入替补席
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
}

/** 按"模板id-所属方-"前缀在实例列表里找回该英雄本局的实体；全程未上场的替补返回 undefined。 */
function instanceOf(instances: Hero[], side: Player, templateId: HeroId): Hero | undefined {
    return instances.find(item => item.owner === side && item.id.startsWith(`${templateId}-${side}-`));
}

function stateSignature(): string {
    const state = useGameStore.getState();
    return [
        state.phase,
        state.currentPlayer,
        // 补员挂起期间 currentPlayer 与 reinforcingPlayer 不一致，不收进指纹会把"等替补决策"误判成停滞
        state.reinforcingPlayer ?? '-',
        state.reinforcementSelectableHeroId ?? '-',
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
    skillAudit: Map<string, SkillAuditRow>,
): MatchResult {
    const started = performance.now();
    const team1 = mirror ? pairing.teamB : pairing.teamA;
    const team2 = mirror ? pairing.teamA : pairing.teamB;
    setupMatch(team1, team2);
    const moved = new Map<string, number>();
    // AI 操作质量埋点：轮到某英雄时，这一步到底有没有产出（位移或伤害/技能/治疗/击杀日志）
    const actionsTaken = new Map<string, number>();
    const productiveSteps = new Map<string, number>();
    const stepCount = new Map<string, number>();
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
        // 补员挂起时控制权在 reinforcingPlayer 手上，只喂 currentPlayer 会被直接 return 掉
        runComputerBattleStep(before.reinforcingPlayer ?? before.currentPlayer, repeated);
        const after = useGameStore.getState();

        if (selectedHeroId && selectedSkillId) {
            // 走到"技能已被选中"这一步，说明真的发起过施法尝试；
            // 是否有成功结算看 battleStatistics（recordBattleSkillUse 只在 result.success 时计数）。
            const key = auditKey(
                [...team1, ...team2].find(heroId => selectedHeroId.startsWith(`${heroId}-${before.currentPlayer}-`)) ?? '',
                selectedSkillId
            );
            const row = skillAudit.get(key);
            if (row) row.attempted++;
        }

        for (const hero of [...after.player1Heroes, ...after.player2Heroes]) {
            const old = beforePositions.get(hero.id);
            if (!old?.position || !hero.position || old.state !== HeroState.ALIVE || hero.state !== HeroState.ALIVE) continue;
            const distance = Math.abs(old.position[0] - hero.position[0]) + Math.abs(old.position[1] - hero.position[1]);
            if (distance > 0) moved.set(hero.id, (moved.get(hero.id) ?? 0) + distance);
        }
        // AI 决策归因：把这一步电脑"想过哪些技能、各打几分、最后选了谁"记到英雄模板上
        for (const decision of takeAiDecisions()) {
            const templateId = [...team1, ...team2].find(
                heroId => decision.heroId.startsWith(`${heroId}-${decision.player}-`)
            );
            if (!templateId) continue;
            const best = decision.candidates[0];
            for (const candidate of decision.candidates) {
                const key = auditKey(templateId, candidate.skillId);
                const row = skillAudit.get(key) ?? {
                    heroId: templateId,
                    skillId: candidate.skillId,
                    enumerated: 0,
                    chosen: 0,
                    bestScore: Number.NEGATIVE_INFINITY,
                    outvoted: 0,
                    attempted: 0,
                };
                row.enumerated++;
                row.bestScore = Math.max(row.bestScore, candidate.score);
                if (decision.chosenSkillId === candidate.skillId) row.chosen++;
                else if (best?.skillId === candidate.skillId) row.outvoted++;
                skillAudit.set(key, row);
            }
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

    const instances = [...state.player1Heroes, ...state.player2Heroes];
    // 按名单（含全程未上场的替补）出结果：胜率归属看"选入阵容"，个人数据只按登场局平均。
    const rosterEntries: { heroId: HeroId; side: Player; hero?: Hero }[] = [
        ...team1.map(heroId => ({ heroId, side: 'player1' as Player, hero: instanceOf(instances, 'player1', heroId) })),
        ...team2.map(heroId => ({ heroId, side: 'player2' as Player, hero: instanceOf(instances, 'player2', heroId) })),
    ];

    const heroResults: HeroMatchResult[] = rosterEntries.map(entry => {
        const hero = entry.hero;
        const stats = hero ? state.battleStatistics?.[hero.id] ?? EMPTY_STATS : EMPTY_STATS;
        const sideScore = entry.side === 'player1' ? scoreP1 : 1 - scoreP1;
        const alive = hero?.state === HeroState.ALIVE;
        return {
            heroId: entry.heroId,
            side: entry.side,
            entered: !!hero,
            score: sideScore,
            won: sideScore === 1,
            survived: !!alive,
            endHp: alive ? hero!.currentHp : 0,
            endShield: alive ? hero!.shield : 0,
            maxHp: hero?.maxHp ?? 0,
            damageDealt: stats.damageDealt,
            damageTaken: stats.damageTaken,
            healingDone: stats.healingDone,
            shieldAbsorbed: stats.shieldAbsorbed,
            kills: stats.kills,
            deathRound: stats.lastDeathRound,
            skill1Casts: stats.skill1Casts ?? 0,
            skill2Casts: stats.skill2Casts ?? 0,
            movedDistance: hero ? moved.get(hero.id) ?? 0 : 0,
        };
    });

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
        heroResults,
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
            enteredGames: 0,
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
            aggregate.enteredGames += Number(result.entered);
            aggregate.score += result.score;
            aggregate.wins += Number(result.won);
            if (result.side === 'player1') {
                aggregate.player1Games++;
                aggregate.player1Score += result.score;
            } else {
                aggregate.player2Games++;
                aggregate.player2Score += result.score;
            }
            if (result.entered) {
                aggregate.survived += Number(result.survived);
                aggregate.deaths += Number(!result.survived);
                aggregate.deathRoundTotal += result.deathRound ?? 0;
                aggregate.endHpRateTotal += result.maxHp > 0 ? (result.endHp + result.endShield) / result.maxHp : 0;
            }
            aggregate.damageDealt += result.damageDealt;
            aggregate.damageTaken += result.damageTaken;
            aggregate.healingDone += result.healingDone;
            aggregate.shieldAbsorbed += result.shieldAbsorbed;
            aggregate.kills += result.kills;
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

function avg(total: number, games: number): number {
    return games > 0 ? total / games : 0;
}

function winRateCell(hero: HeroAggregate): string {
    return hero.games > 0 ? percent(hero.score / hero.games) : '—';
}

const skillIdCache = new Map<HeroId, { skill1Id: string; skill2Id: string }>();

/** 取某个英雄模板的两个技能 id（借 createHero 造一个不上场的空实例，避免再维护一份对照表） */
function skillIdsOf(heroId: HeroId): { skill1Id: string; skill2Id: string } {
    const cached = skillIdCache.get(heroId);
    if (cached) return cached;
    const probe = createHero(heroId, 'player1', null);
    const created = { skill1Id: probe.skill1Id, skill2Id: probe.skill2Id };
    skillIdCache.set(heroId, created);
    return created;
}

function auditVerdict(row: SkillAuditRow | undefined, casts: number): string {
    if (casts > 0) return '正常';
    if (!row) return 'AI 从未把它列为候选：缺前置交互状态或目标枚举缺口';
    if (row.bestScore <= 0) return `AI 想过但按棋盘价值必亏（最高${row.bestScore.toFixed(1)}分）：该技能的收益没有被建模`;
    if (row.attempted === 0) return `被选为方案${row.chosen}次却从未走到执行：位移重排或上层闸门吃掉`;
    return `已发起${row.attempted}次施法、0次成功结算：execute 当场返回失败，按 bug 处理`;
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
    failures: { id: number; teams: string; message: string }[] = [],
    skillAudit: Map<string, SkillAuditRow> = new Map(),
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
    const zeroSkillHeroes = heroes.filter(hero => hero.enteredGames > 0 && (hero.skill1Casts === 0 || hero.skill2Casts === 0));
    const neverEnteredHeroes = heroes.filter(hero => hero.enteredGames === 0);
    const gamesList = heroes.map(hero => hero.games);
    const minGames = Math.min(...gamesList);
    const maxGames = Math.max(...gamesList);
    const tablesPerRound = Math.floor(AVAILABLE_HERO_IDS.length / TABLE_SIZE);
    const warnings: string[] = [];
    if (completed < matches.length * 0.9) warnings.push(`仅${percent(completed / matches.length)}对局自然结束，其余为回合上限裁定。`);
    if (stalled > 0) warnings.push(`${stalled}局检测到状态停滞。`);
    if (failures.length > 0) {
        const grouped = new Map<string, number>();
        for (const failure of failures) grouped.set(failure.message, (grouped.get(failure.message) ?? 0) + 1);
        warnings.push(`${failures.length}局因异常被跳过：${[...grouped.entries()].map(([message, count]) => `${message}（${count}局）`).join('；')}。`);
    }
    if (zeroSkillHeroes.length > 0) warnings.push(`${zeroSkillHeroes.length}名英雄至少有一个技能从未被AI成功释放。`);
    if (neverEnteredHeroes.length > 0) warnings.push(`${neverEnteredHeroes.length}名英雄全程只坐替补席未登场，个人数据不可用：${neverEnteredHeroes.map(hero => hero.name).join('、')}。`);
    if (Math.abs(p1Score - 0.5) > 0.08) warnings.push(`玩家1得分率为${percent(p1Score)}，存在明显先后手偏差。`);

    const lines: string[] = [
        '# 全英雄实际强度仿真报告',
        '',
        `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        '',
        '## 测试口径',
        '',
        `- 英雄池：${AVAILABLE_HERO_IDS.length}名当前可用英雄，全部纳入。`,
        `- 赛程：${config.scheduleRounds}轮平衡分组，每轮${tablesPerRound}组、每组${ROSTER_SIZE}v${ROSTER_SIZE}名单（${STARTERS}首发+${ROSTER_SIZE - STARTERS}替补）并交换先后手，共${matches.length}局；每名英雄名单${minGames}–${maxGames}局、实际登场${Math.min(...heroes.map(hero => hero.enteredGames))}–${Math.max(...heroes.map(hero => hero.enteredGames))}局${AVAILABLE_HERO_IDS.length % TABLE_SIZE === 0 ? '' : `（每轮${AVAILABLE_HERO_IDS.length % TABLE_SIZE}人按"迄今轮空最少"整轮轮空）`}。`,
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
        '| 排名 | 等级 | 英雄 | 职业 | 名单场次（登场） | 得分率（95%区间） | Elo影响 | 伤害/登场局 | 团队伤害占比 | 治疗/登场局 | 承伤/登场局 | 击杀/登场局 | 登场存活率 | 终局有效生命 | 技能1/2每登场局 | 位移/登场局 |',
        '|---:|:---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
        ...heroes.map(hero => `| ${hero.rank} | ${hero.tier} | ${hero.name} | ${hero.heroClass} | ${hero.games}（${hero.enteredGames}） | ${winRateCell(hero)}（${percent(hero.winRateLow)}–${percent(hero.winRateHigh)}） | ${hero.impactElo >= 0 ? '+' : ''}${hero.impactElo.toFixed(0)} | ${perGame(hero.damageDealt, hero.enteredGames)} | ${percent(avg(hero.teamDamageShareTotal, hero.games))} | ${perGame(hero.healingDone, hero.enteredGames)} | ${perGame(hero.damageTaken, hero.enteredGames)} | ${perGame(hero.kills, hero.enteredGames)} | ${percent(avg(hero.survived, hero.enteredGames))} | ${percent(avg(hero.endHpRateTotal, hero.games))} | ${avg(hero.skill1Casts, hero.enteredGames).toFixed(2)}/${avg(hero.skill2Casts, hero.enteredGames).toFixed(2)} | ${perGame(hero.movedDistance, hero.enteredGames)} |`),
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
        lines.push(
            '下面这些技能在整份数据里一次都没结算成功。用 AI 决策留痕区分"英雄真的弱"和"电脑根本不会用"：',
            '',
            '| 英雄 | 技能 | 引擎结算施放 | 进入候选 | 被采纳 | 已发起施法 | 候选最高分 | 归因 |',
            '|---|---|---:|---:|---:|---:|---:|---|',
            ...zeroSkillHeroes.flatMap(hero => {
                const { skill1Id, skill2Id } = skillIdsOf(hero.heroId);
                return [
                    { skillId: skill1Id, casts: hero.skill1Casts },
                    { skillId: skill2Id, casts: hero.skill2Casts },
                ]
                    .filter(entry => entry.casts === 0)
                    .map(entry => {
                        const row = skillAudit.get(auditKey(hero.heroId, entry.skillId));
                        return `| ${hero.name} | ${entry.skillId} | 0 | ${row?.enumerated ?? 0} | ${row?.chosen ?? 0} | ${row?.attempted ?? 0} | ${row ? row.bestScore.toFixed(1) : '—'} | ${auditVerdict(row, entry.casts)} |`;
                    });
            }),
            '',
            '> 「进入候选 0 次」= 电脑根本没把它列为选项（缺前置交互状态或目标枚举缺口）；',
            '> 「候选最高分 ≤ 0」= AI 想过，但按当前棋盘价值模型放它必亏（收益没被建模，多见于自损型与纯辅助型技能）；',
            '> 「被采纳但已发起 0 次」= 方案在位移重排或上层分数闸门处被吃掉，AI 从没真的点下去；',
            '> 「已发起 N 次、0 次成功结算」= 真的尝试过却被技能自己的 execute 拒绝，这一类才是可以直接修的 bug。'
        );
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

function pad(value: string, width: number): string {
    // 中文名按视觉宽度对齐：CJK 字符占两列
    const visual = [...value].reduce((sum, char) => sum + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 2 : 1), 0);
    return value + ' '.repeat(Math.max(1, width - visual));
}

function summaryLines(heroes: HeroAggregate[], skillAudit: Map<string, SkillAuditRow> = new Map()): string[] {
    const header = `${pad('排名', 6)}${pad('等级', 4)}${pad('英雄', 22)}${pad('职业', 8)}${pad('名单(登场)', 12)}${pad('胜率(95%区间)', 22)}${pad('Elo影响', 9)}${pad('伤害/登场局', 12)}${pad('登场存活', 10)}技能1/2`;
    const row = (hero: HeroAggregate) => [
        pad(String(hero.rank), 6),
        pad(hero.tier, 4),
        pad(hero.name, 22),
        pad(hero.heroClass, 8),
        pad(`${hero.games}(${hero.enteredGames})`, 12),
        pad(`${winRateCell(hero)}（${percent(hero.winRateLow)}–${percent(hero.winRateHigh)}）`, 22),
        pad(`${hero.impactElo >= 0 ? '+' : ''}${hero.impactElo.toFixed(0)}`, 9),
        pad(perGame(hero.damageDealt, hero.enteredGames), 12),
        pad(percent(avg(hero.survived, hero.enteredGames)), 10),
        `${avg(hero.skill1Casts, hero.enteredGames).toFixed(1)}/${avg(hero.skill2Casts, hero.enteredGames).toFixed(1)}`,
    ].join('');
    const middle = heroes.length > 24
        ? ['', `…（中间${heroes.length - 20}名见 latest.md）`, '']
        : [];
    const attribution: string[] = [];
    const zeroSkillHeroes = heroes.filter(hero => hero.enteredGames > 0 && (hero.skill1Casts === 0 || hero.skill2Casts === 0));
    if (zeroSkillHeroes.length > 0) {
        attribution.push(
            '',
            'AI 操作归因（这些技能整份数据里 0 次结算，逐条区分"英雄弱"还是"电脑不会用"）',
            ...zeroSkillHeroes.flatMap(hero => {
                const { skill1Id, skill2Id } = skillIdsOf(hero.heroId);
                return [
                    { skillId: skill1Id, casts: hero.skill1Casts },
                    { skillId: skill2Id, casts: hero.skill2Casts },
                ]
                    .filter(entry => entry.casts === 0)
                    .map(entry => {
                        const row = skillAudit.get(auditKey(hero.heroId, entry.skillId));
                        return `  ${pad(hero.name, 22)}${pad(entry.skillId, 22)}候选${String(row?.enumerated ?? 0).padStart(5)} 采纳${String(row?.chosen ?? 0).padStart(4)} 发起${String(row?.attempted ?? 0).padStart(5)} 最高分${pad(row ? row.bestScore.toFixed(1) : '—', 9)}${auditVerdict(row, entry.casts)}`;
                    });
            })
        );
    }
    return [
        '英雄强度榜单（按拟合Elo排序；胜率含±95%置信区间，个人数据按登场局平均）',
        '',
        header,
        '-'.repeat(112),
        ...heroes.slice(0, 10).map(row),
        ...middle,
        ...heroes.slice(-10).reverse().map(row).reverse(),
        ...attribution,
    ];
}

async function main(): Promise<void> {
    const config = readConfig();
    // 同时固定战斗内的暴击、闪避、随机目标与AI近优选择，保证整份报告可复现。
    Math.random = mulberry32(config.seed ^ 0xBA771E);
    if (AVAILABLE_HERO_IDS.length < TABLE_SIZE) {
        throw new Error(`英雄池不足${TABLE_SIZE}名（当前${AVAILABLE_HERO_IDS.length}名），无法组织6v6名单赛程。`);
    }
    // 目标局数优先：每轮 floor(H/12) 组、每组打镜像两局，据此反推需要的轮数。
    if (config.targetMatches > 0) {
        const perRound = matchesPerRound(AVAILABLE_HERO_IDS.length);
        config.scheduleRounds = Math.max(1, Math.round(config.targetMatches / perRound));
    }
    const outputDirectory = resolve(process.cwd(), 'reports', 'balance');
    if (process.argv.includes('--refresh-report')) {
        const jsonPath = resolve(outputDirectory, 'latest.json');
        const payload = JSON.parse(await readFile(jsonPath, 'utf8')) as {
            config: SimulationConfig;
            elapsedMs: number;
            matches: MatchResult[];
            skillAudit?: SkillAuditRow[];
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
        const markdown = reportMarkdown(
            payload.config,
            payload.matches,
            heroes,
            scheduleStub,
            payload.elapsedMs,
            [],
            new Map((payload.skillAudit ?? []).map(row => [auditKey(row.heroId, row.skillId), row]))
        );
        payload.heroes = heroes;
        await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        await writeFile(resolve(outputDirectory, 'latest.md'), `${markdown}\n`, 'utf8');
        process.stdout.write(`已从逐局数据刷新报告：${resolve(outputDirectory, 'latest.md')}\n`);
        return;
    }
    const schedule = buildSchedule([...AVAILABLE_HERO_IDS], config);
    const matches: MatchResult[] = [];
    const failures: { id: number; teams: string; message: string }[] = [];
    const started = performance.now();
    let matchId = 1;
    const totalMatches = schedule.length * 2;
    process.stdout.write(`全英雄强度仿真：${AVAILABLE_HERO_IDS.length}名英雄，${config.scheduleRounds}轮×${schedule.length / config.scheduleRounds}组，${totalMatches}局，种子${config.seed}\n`);
    const skillAudit = new Map<string, SkillAuditRow>();
    for (const pairing of schedule) {
        for (const mirror of [false, true]) {
            const id = matchId++;
            let match: MatchResult;
            try {
                match = runMatch(id, pairing, mirror, config, skillAudit);
            } catch (error) {
                // 单局抛错（新英雄未适配AI、部署校验失败等）只丢掉这一局，不让整轮仿真白跑。
                const message = error instanceof Error ? error.message : String(error);
                failures.push({
                    id,
                    teams: `${pairing.teamA.join('+')} vs ${pairing.teamB.join('+')}`,
                    message,
                });
                process.stdout.write(`!! 第${id}局异常已跳过：${message}\n`);
                continue;
            }
            matches.push(match);
            const attempted = matches.length + failures.length;
            if (attempted % 8 === 0 || attempted === totalMatches) {
                const completed = matches.filter(item => item.completed).length;
                process.stdout.write(`进度 ${attempted}/${totalMatches}，自然结束 ${completed}，异常 ${failures.length}，最近一局 ${match.battleRounds}轮/${match.decisionSteps}步\n`);
            }
        }
    }
    const elapsedMs = performance.now() - started;
    if (matches.length === 0) {
        throw new Error(`全部${totalMatches}局均异常中断，最后一条错误：${failures[0]?.message ?? '未知'}`);
    }
    const heroes = aggregateHeroes(matches, [...AVAILABLE_HERO_IDS]);
    const markdown = reportMarkdown(config, matches, heroes, schedule, elapsedMs, failures, skillAudit);
    await mkdir(outputDirectory, { recursive: true });
    const payload = {
        generatedAt: new Date().toISOString(),
        config,
        elapsedMs,
        heroCount: AVAILABLE_HERO_IDS.length,
        matchCount: matches.length,
        failures,
        skillAudit: [...skillAudit.values()],
        heroes,
        matches,
    };
    await writeFile(resolve(outputDirectory, 'latest.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await writeFile(resolve(outputDirectory, 'latest.md'), `${markdown}\n`, 'utf8');
    process.stdout.write(`\n${summaryLines(heroes, skillAudit).join('\n')}\n`);
    process.stdout.write(`\n报告已生成：${resolve(outputDirectory, 'latest.md')}\n`);
    process.stdout.write(`数据已生成：${resolve(outputDirectory, 'latest.json')}\n`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
