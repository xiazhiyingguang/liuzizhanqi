import type { AiDifficulty, GameState, Hero, Player, Position, Skill } from '../types/game';
import { HeroState } from '../types/game';
import { AVAILABLE_HERO_IDS, getHeroInfo } from '../data/heroes';
import { getHeroAbilityRatings, type HeroAbilityRatings } from '../data/hero-ratings';
import { getSkill } from '../data/skills';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import { SkillSystem } from './skill-system';
import { DamageCalculator } from './damage-calculator';
import { GameEngine } from './game-engine';

export interface ComputerDeployment {
    heroId: string;
    position: Position;
}

export interface ComputerSkillPlan {
    skillId: string;
    targetPositions: Position[];
    score: number;
}

const BOARD_SIZE = 6;
/** 选将候选池大小：只从分数最高的阵容里随机挑选，保住强度上限的同时让每局选将不同。 */
const TEAM_CANDIDATE_POOL_SIZE = 16;
/** 候选池内阵容之间至少不同的英雄数，避免每局都是同一套核心（如长离+阴阳师）。 */
const TEAM_MIN_DIFFERENCE = 2;
/** 候选池中单个英雄的最大出现次数（控制高分英雄的重复率，让阵容更多样）。 */
const TEAM_MAX_HERO_USAGE = 8;
/** 选将温度采样：分数每差 10 分，被选中权重降约 63%，兼顾强度与多样性。 */
const TEAM_SOFTMAX_TEMPERATURE = 10;
/** 替补制：每方替补席人数（六人选将，四人首发）。 */
const BENCH_SIZE = 2;
/** 最近一次使用过的技能会减分，促使 AI 轮换使用不同技能。 */
const SKILL_REPEAT_PENALTY = 5;
/** 斩杀优先奖励：模拟中确认击杀一名敌人时附加的评分，压过其他一切收益，让 AI 追着残血杀。 */
const KILL_SCORE_BONUS = 180;
/** 把敌人打成暂时阵亡的奖励（敌方可能拥有复活，故低于真实击杀）。 */
const TEMP_DEAD_SCORE_BONUS = 40;
/** 拥有"击杀后立即再动"天威的英雄，每次模拟击杀的额外收益。 */
const TIANWEI_KILL_BONUS = 40;
/** 多目标技能组合枚举时考虑的前 N 个高优先级目标。 */
const MULTI_TARGET_COMBINATION_TOP = 6;
/** 多段伤害技能：估算威胁伤害时按段数放大（如回锋连刃斩共 3 段）。 */
const MULTI_HIT_SKILLS: Record<string, number> = {
    huifeng_skill1: 3,
};

/**
 * 各难度的决策参数：容差越大越"随性"，blunderChance 是主动挑次优解的概率，
 * jointMoveTopK 控制移动+技能联合规划的候选格数（0 关闭），exposureWeight 控制防守暴露扣分力度。
 */
interface DifficultyProfile {
    decisionTolerance: number;
    skillTolerance: number;
    blunderChance: number;
    jointMoveTopK: number;
    exposureWeight: number;
}

const DIFFICULTY_PROFILES: Record<AiDifficulty, DifficultyProfile> = {
    easy: { decisionTolerance: 8, skillTolerance: 18, blunderChance: 0.3, jointMoveTopK: 0, exposureWeight: 0.35 },
    normal: { decisionTolerance: 4, skillTolerance: 9, blunderChance: 0.12, jointMoveTopK: 5, exposureWeight: 0.7 },
    master: { decisionTolerance: 2, skillTolerance: 5, blunderChance: 0, jointMoveTopK: 6, exposureWeight: 1 },
};

let currentDifficulty: AiDifficulty = 'master';

/** 设置电脑难度（由对局入口在每步决策前同步），未设置时默认宗师。 */
export function setComputerAiDifficulty(difficulty: AiDifficulty | undefined): void {
    currentDifficulty = difficulty ?? 'master';
}

function difficultyProfile(): DifficultyProfile {
    return DIFFICULTY_PROFILES[currentDifficulty];
}

/**
 * 没有 baseDamage 字段、伤害写在 execute 里的技能，按策划公式估算威胁伤害。
 * 返回 null 表示无法估算（视为无直接威胁）。
 */
function customSkillDamage(caster: Hero, skillId: string, position: Position): number | null {
    switch (skillId) {
        case 'mowen_skill2':
            return 12 + (caster.maxHp - caster.currentHp) * 0.3;
        case 'changli_skill2': {
            const distance = MovementSystem.getManhattanDistance(caster.position!, position);
            return 8 * (1 + (caster.counters['暗夜星火'] ?? 0) * 0.1) * (1 + distance * 0.1);
        }
        case 'skeletonking_skill1':
            return 8 + (caster.counters['亡灵之力'] ?? 0) * 2;
        case 'skeletonking_skill2':
            return 7 + (caster.counters['亡灵共鸣'] ?? 0) * 2;
        case 'jetzmi_skill1':
            return caster.counters['jetzmi_form'] === 1
                ? (caster.counters['亡灵共鸣'] ?? 0) * 3
                : 6 + (caster.counters['亡灵共鸣'] ?? 0);
        case 'pipa_skill2':
            return (caster.counters['和弦'] ?? 0) * 3;
        case 'bounty_skill2':
            return 8;
        case 'wangcai_skill1':
            return (caster.baseAttack ?? 0) * 3;
        case 'lilith_skill1':
            return 8;
        default:
            return null;
    }
}
const DEFAULT_RATINGS: HeroAbilityRatings = {
    输出: 5,
    生存: 5,
    机动: 5,
    控制: 5,
    支援: 5,
    覆盖: 5,
    节奏: 5,
};

function ratingsForHeroId(heroId: string): HeroAbilityRatings {
    return getHeroAbilityRatings(getHeroInfo(heroId).name) ?? DEFAULT_RATINGS;
}

/**
 * 在 nearBest 窗口内随机挑选；若命中失误概率，则改为从窗口外的次优解中挑选，
 * 制造人类玩家常见的"走错一步"。宗师档 blunderChance=0 不启用。
 */
function pickWithBlunder<T extends { score: number }>(candidates: T[], tolerance: number): T | undefined {
    if (candidates.length === 0) return undefined;
    const sorted = [...candidates].sort((left, right) => right.score - left.score);
    const bestScore = sorted[0].score;
    const nearBest = sorted.filter(candidate => candidate.score >= bestScore - tolerance);
    const { blunderChance } = difficultyProfile();
    if (nearBest.length < sorted.length && blunderChance > 0 && Math.random() < blunderChance) {
        const rest = sorted.slice(nearBest.length);
        // 只从次优区间的前 35% 里挑，失误也不至于完全乱走
        const window = rest.slice(0, Math.max(1, Math.ceil(rest.length * 0.35)));
        return window[Math.floor(Math.random() * window.length)];
    }
    if (blunderChance <= 0) {
        // 不失误档位（宗师）：严格取最优解，仅完全同分才随机，
        // 避免"斩杀"与"打盾"这类接近候选被容差窗口随机选中
        const ties = sorted.filter(candidate => candidate.score === bestScore);
        return ties[Math.floor(Math.random() * ties.length)];
    }
    return nearBest[Math.floor(Math.random() * nearBest.length)];
}

/** 温度采样：按 exp((score-max)/temperature) 加权随机，分数越高越可能被选但低分也有机会。 */
function softmaxPick<T extends { score: number }>(items: T[], temperature: number): T | undefined {
    if (items.length === 0) return undefined;
    if (temperature <= 0) {
        return [...items].sort((left, right) => right.score - left.score)[0];
    }
    const maxScore = Math.max(...items.map(item => item.score));
    const weights = items.map(item => Math.exp((item.score - maxScore) / temperature));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * total;
    for (let index = 0; index < items.length; index++) {
        roll -= weights[index];
        if (roll <= 0) return items[index];
    }
    return items[items.length - 1];
}

/** 孙悟空分身识别：ID 形如 "wukong-clone|{wukongId}|..."，且带 __isClone 计数器。 */
function isWukongCloneOf(hero: Hero, wukongId: string): boolean {
    if ((hero.counters['__isClone'] ?? 0) !== 1) return false;
    const parts = hero.id.split('|');
    return parts.length >= 2 && parts[0] === 'wukong-clone' && parts[1] === wukongId;
}

const RECENT_HERO_USAGE_KEY = 'six-chess-ai-recent-hero-usage';
/** 跨局记忆保留的最近局数（每局 4 个英雄）。 */
const RECENT_HERO_USAGE_GAMES = 6;
/** 选将时对近期用过的英雄施加的减分。 */
const RECENT_HERO_SCORE_PENALTY = 7;

/** 读取最近几局电脑用过的英雄（localStorage 不可用时静默降级为无记忆）。 */
function loadRecentHeroUsage(): string[] {
    try {
        if (typeof window === 'undefined') return [];
        const raw = window.localStorage.getItem(RECENT_HERO_USAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.flat().filter((id): id is string => typeof id === 'string');
    } catch {
        return [];
    }
}

function saveRecentHeroUsage(team: string[]): void {
    try {
        if (typeof window === 'undefined') return;
        const recent = loadRecentHeroUsage();
        recent.push(...team);
        window.localStorage.setItem(
            RECENT_HERO_USAGE_KEY,
            JSON.stringify(recent.slice(-RECENT_HERO_USAGE_GAMES * 4))
        );
    } catch {
        // 忽略存储异常
    }
}

function ratingsForHero(hero: Hero): HeroAbilityRatings {
    return getHeroAbilityRatings(hero.name) ?? DEFAULT_RATINGS;
}

function averageRating(heroIds: string[], key: keyof HeroAbilityRatings): number {
    if (heroIds.length === 0) return 5;
    return heroIds.reduce((sum, id) => sum + ratingsForHeroId(id)[key], 0) / heroIds.length;
}

function teamScore(
    team: string[],
    opponentHeroIds: string[],
    recentHeroes: ReadonlySet<string>
): number {
    const ratings = team.map(ratingsForHeroId);
    const sum = (key: keyof HeroAbilityRatings) => ratings.reduce((total, item) => total + item[key], 0);
    const max = (key: keyof HeroAbilityRatings) => Math.max(...ratings.map(item => item[key]));
    const classes = new Set(team.map(id => getHeroInfo(id).class)).size;

    let score =
        sum('输出') * 1.35 +
        sum('生存') * 1.15 +
        sum('控制') * 1.05 +
        sum('支援') * 0.9 +
        sum('覆盖') * 0.95 +
        sum('机动') * 0.65 +
        sum('节奏') * 0.8;

    // 宗师电脑不会只堆单一输出，完整阵容会获得明显奖励。
    score += max('输出') * 2.1 + max('生存') * 1.8 + max('支援') * 1.55 + max('控制') * 1.5;
    score += classes * 2.5;
    if (max('生存') < 8) score -= 24;
    if (max('支援') < 8) score -= 20;
    if (max('输出') < 8) score -= 24;
    if (max('控制') < 6) score -= 12;

    const opponentOutput = averageRating(opponentHeroIds, '输出');
    const opponentSurvival = averageRating(opponentHeroIds, '生存');
    const opponentMobility = averageRating(opponentHeroIds, '机动');
    score += sum('生存') * Math.max(0, opponentOutput - 6) * 0.22;
    score += (sum('输出') + sum('控制')) * Math.max(0, opponentSurvival - 6) * 0.16;
    score += (sum('控制') + sum('覆盖')) * Math.max(0, opponentMobility - 6) * 0.18;

    // 跨局多样性：最近几局用过的英雄减分，避免玩家每局都面对同一套阵容。
    for (const id of team) {
        if (recentHeroes.has(id)) score -= RECENT_HERO_SCORE_PENALTY;
    }

    return score;
}

/** 与 teamScore 的职责惩罚一致：随机挑选时也保证阵容具备输出/生存/支援核心。 */
function passesTeamConstraints(team: string[]): boolean {
    const max = (key: keyof HeroAbilityRatings) => Math.max(...team.map(id => ratingsForHeroId(id)[key]));
    return max('输出') >= 8 && max('生存') >= 8 && max('支援') >= 8;
}

function teamOverlap(left: string[], right: string[]): number {
    return left.reduce((count, id) => count + (right.includes(id) ? 1 : 0), 0);
}

/**
 * 按分数从高到低挑选互相差异明显的阵容组成候选池：
 * 与池中已有阵容至少有 TEAM_MIN_DIFFERENCE 个英雄不同才入池，
 * 同时限制单个英雄在池中的出现次数，避免高分核心反复出现。
 */
function buildDiversePool(
    candidates: { team: string[]; score: number }[],
    size: number
): { team: string[]; score: number }[] {
    const pool: { team: string[]; score: number }[] = [];
    const usage = new Map<string, number>();
    for (const candidate of candidates) {
        if (pool.length >= size) break;
        if (pool.every(existing => teamOverlap(existing.team, candidate.team) <= 4 - TEAM_MIN_DIFFERENCE)) {
            if (candidate.team.every(id => (usage.get(id) ?? 0) < TEAM_MAX_HERO_USAGE)) {
                pool.push(candidate);
                for (const id of candidate.team) usage.set(id, (usage.get(id) ?? 0) + 1);
            }
        }
    }
    return pool;
}

/**
 * 根据玩家阵容穷举四人组合评分，在满足职责完整度的高分阵容池中做温度采样，
 * 结合跨局使用记录减分，让电脑的阵容既有强度又不会每局重复。
 */
export function chooseComputerTeam(opponentHeroIds: string[]): string[] {
    // 逐拍选将期间复用同一份规划，避免每拍重新随机导致阵容拼接错乱
    if (cachedDesiredTeam && cachedDesiredTeam.every(id => AVAILABLE_HERO_IDS.includes(id))) {
        return [...cachedDesiredTeam];
    }

    const recentHeroes = new Set(loadRecentHeroUsage());
    const candidates: { team: string[]; score: number }[] = [];

    for (let a = 0; a < AVAILABLE_HERO_IDS.length - 3; a++) {
        for (let b = a + 1; b < AVAILABLE_HERO_IDS.length - 2; b++) {
            for (let c = b + 1; c < AVAILABLE_HERO_IDS.length - 1; c++) {
                for (let d = c + 1; d < AVAILABLE_HERO_IDS.length; d++) {
                    const team = [
                        AVAILABLE_HERO_IDS[a],
                        AVAILABLE_HERO_IDS[b],
                        AVAILABLE_HERO_IDS[c],
                        AVAILABLE_HERO_IDS[d],
                    ];
                    if (!passesTeamConstraints(team)) continue;
                    candidates.push({ team, score: teamScore(team, opponentHeroIds, recentHeroes) });
                }
            }
        }
    }

    candidates.sort((left, right) => right.score - left.score);
    const pool = buildDiversePool(candidates, TEAM_CANDIDATE_POOL_SIZE);
    const picked = pool.length > 0
        ? softmaxPick(pool, TEAM_SOFTMAX_TEMPERATURE)
        : (candidates[0] ?? null);
    if (!picked) return AVAILABLE_HERO_IDS.slice(0, 4 + BENCH_SIZE);

    // 替补制：在 4 人核心之外，从剩余英雄中按联合阵容得分贪心补足替补
    const coreIds = new Set(picked.team);
    const bench = AVAILABLE_HERO_IDS
        .filter(id => !coreIds.has(id))
        .sort((left, right) =>
            teamScore([...picked.team, right], opponentHeroIds, recentHeroes) -
            teamScore([...picked.team, left], opponentHeroIds, recentHeroes))
        .slice(0, BENCH_SIZE);
    const fullTeam = [...picked.team, ...bench];

    cachedDesiredTeam = [...fullTeam];
    saveRecentHeroUsage(fullTeam);
    return [...fullTeam];
}

/** 当前对局已确定的电脑选将（逐拍选将期间保持稳定）。 */
let cachedDesiredTeam: string[] | null = null;

/** 新对局开始时清除选将缓存，让下一局重新规划阵容。 */
export function resetCachedComputerTeam(): void {
    cachedDesiredTeam = null;
}

function rowThreatFromOpponent(row: number, opponentHeroes: Hero[]): number {
    return opponentHeroes.reduce((score, hero) => {
        if (!hero.position || hero.state !== HeroState.ALIVE) return score;
        const rowDistance = Math.abs(hero.position[0] - row);
        return score + Math.max(0, 4 - rowDistance) * (ratingsForHero(hero).输出 + ratingsForHero(hero).控制 * 0.5);
    }, 0);
}

/** 让耐久/控制英雄顶在前排，输出与支援根据玩家布阵选择对应行。 */
export function chooseComputerDeployment(heroIds: string[], opponentHeroes: Hero[]): ComputerDeployment[] {
    const heroes = heroIds.map(id => ({ id, ratings: ratingsForHeroId(id) }));
    const unassigned = [...heroes];
    const takeBest = (score: (item: typeof heroes[number]) => number) => {
        unassigned.sort((left, right) => score(right) - score(left));
        return unassigned.shift()!;
    };

    const vanguard = takeBest(item => item.ratings.生存 * 1.4 + item.ratings.控制 + item.ratings.输出 * 0.25);
    const striker = takeBest(item => item.ratings.输出 * 1.3 + item.ratings.机动 + item.ratings.控制 * 0.4);
    const support = takeBest(item => item.ratings.支援 * 1.5 + item.ratings.覆盖 + item.ratings.生存 * 0.3);
    const flex = unassigned[0];

    const rows = [0, 1, 2, 3, 4, 5]
        .sort((left, right) => rowThreatFromOpponent(right, opponentHeroes) - rowThreatFromOpponent(left, opponentHeroes));
    const primaryRow = rows[0] ?? 2;
    const secondaryRow = rows.find(row => Math.abs(row - primaryRow) >= 2) ?? (primaryRow <= 2 ? 4 : 1);
    const supportRow = Math.max(1, Math.min(4, Math.round((primaryRow + secondaryRow) / 2)));
    const flexRow = [1, 2, 3, 4].find(row => row !== primaryRow && row !== secondaryRow && row !== supportRow) ?? 3;

    return [
        { heroId: vanguard.id, position: [primaryRow, 3] },
        { heroId: striker.id, position: [secondaryRow, 3] },
        { heroId: flex.id, position: [flexRow, 4] },
        { heroId: support.id, position: [supportRow, 5] },
    ];
}

/**
 * 替补制补员：为电脑挑选最合适的替补上场。
 * 以"当前存活阵容 + 候选替补"的联合得分排序，缺什么补什么。
 */
export function chooseComputerReinforcement(state: GameState, player: Player): string | null {
    const bench = (player === 'player1' ? state.player1BenchHeroIds : state.player2BenchHeroIds) ?? [];
    if (bench.length === 0) return null;
    const opponentPlayer: Player = player === 'player1' ? 'player2' : 'player1';
    // 英雄 id 形如 `${模板id}-player1-序号`，取前缀还原模板 id 参与评分；分身不计入
    const templateIdOf = (hero: Hero) => hero.id.split('-')[0];
    const isRealHero = (hero: Hero) =>
        hero.counters?.['__isClone'] !== 1 &&
        !hero.id.startsWith('wukong-clone|') &&
        !hero.id.startsWith('mirror-clone|');
    const aliveEnemyIds = heroesFor(state, opponentPlayer)
        .filter(hero => hero.state === HeroState.ALIVE && isRealHero(hero))
        .map(templateIdOf);
    const aliveAllyIds = heroesFor(state, player)
        .filter(hero => hero.state === HeroState.ALIVE && isRealHero(hero))
        .map(templateIdOf);

    let best: { id: string; score: number } | null = null;
    for (const id of bench) {
        const score = teamScore([...aliveAllyIds, id], aliveEnemyIds, new Set());
        if (!best || score > best.score) best = { id, score };
    }
    return best?.id ?? bench[0];
}

/**
 * 替补制补员：为上场英雄挑选本方半场的落位。
 * 规则：到所有存活敌人的距离和越大越安全，优先远离火线的格子。
 */
export function chooseComputerReinforcementPosition(state: GameState, player: Player): Position | null {
    const halfCols = player === 'player1' ? [0, 1, 2] : [3, 4, 5];
    const enemies = heroesFor(state, player === 'player1' ? 'player2' : 'player1')
        .filter(hero => hero.state === HeroState.ALIVE && hero.position);

    let best: Position | null = null;
    let bestScore = -Infinity;
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (const col of halfCols) {
            if (state.board[row][col]) continue;
            let score = 0;
            if (enemies.length > 0) {
                for (const enemy of enemies) {
                    score += Math.abs(enemy.position![0] - row) + Math.abs(enemy.position![1] - col);
                }
            } else {
                // 无存活敌人（理论不出现）：倾向中后排
                score = (player === 'player1' ? col >= 1 : col <= 4) ? 10 : 0;
            }
            if (score > bestScore) {
                bestScore = score;
                best = [row, col];
            }
        }
    }
    return best;
}

function allHeroes(state: GameState): Hero[] {
    return [...state.player1Heroes, ...state.player2Heroes];
}

function heroesFor(state: GameState, player: Player): Hero[] {
    return player === 'player1' ? state.player1Heroes : state.player2Heroes;
}

function enemiesFor(state: GameState, player: Player): Hero[] {
    return heroesFor(state, player === 'player1' ? 'player2' : 'player1');
}

function findHero(state: GameState, heroId: string): Hero | undefined {
    return allHeroes(state).find(hero => hero.id === heroId)
        ?? state.board.flat().find(hero => hero?.id === heroId)
        ?? undefined;
}

function visibleCounterValue(hero: Hero): number {
    return Object.entries(hero.counters).reduce((total, [name, value]) => {
        if (!/[\u3400-\u9fff]/.test(name) || !Number.isFinite(value) || value <= 0) return total;
        return total + Math.min(10, value);
    }, 0);
}

function heroBoardValue(hero: Hero): number {
    if (hero.state === HeroState.DEAD) return 0;
    if (hero.state === HeroState.TEMP_DEAD) return 16;

    const positiveEffects = hero.effects.filter(effect => effect.type === 'buff' || effect.type === 'shield').length;
    const negativeEffects = hero.effects.filter(effect =>
        effect.type === 'debuff' || effect.type === 'stun' || effect.type === 'control'
    ).length;
    return 105
        + hero.currentHp * 1.65
        + hero.shield * 1.2
        + positiveEffects * 6
        - negativeEffects * 8
        + visibleCounterValue(hero) * 1.2;
}

/**
 * 轻量防守意识：估算 player 一方全体单位暴露给敌方火力的惩罚值。
 * 单位被多个敌人盯上、或总威胁超过有效血量时才计罚，避免对正常对峙过度敏感。
 */
function exposurePenalty(state: GameState, player: Player): number {
    let penalty = 0;
    for (const hero of heroesFor(state, player)) {
        if (hero.state !== HeroState.ALIVE || !hero.position) continue;
        const effectiveHp = hero.currentHp + hero.shield;
        let totalThreat = 0;
        let attackers = 0;
        for (const enemy of enemiesFor(state, player)) {
            if (enemy.state !== HeroState.ALIVE || !enemy.position || EffectManager.isStunned(enemy)) continue;
            const moveExtra = enemy.hasMovedThisTurn ? 0 : Math.max(0, enemy.moveRange);
            const distance = MovementSystem.getManhattanDistance(enemy.position, hero.position);
            if (distance > maximumSkillReach(enemy) + moveExtra) continue;
            const threat = estimateDamageAgainst(enemy, hero);
            if (threat <= 0) continue;
            attackers++;
            totalThreat += threat * (enemy.hasActedThisTurn ? 0.25 : 1);
        }
        if (attackers >= 2 || totalThreat >= effectiveHp) {
            penalty += Math.min(totalThreat, effectiveHp) * 0.45 + attackers * 3;
        }
    }
    return penalty;
}

export function evaluateComputerBoard(state: GameState, player: Player): number {
    const friendly = heroesFor(state, player).reduce((total, hero) => total + heroBoardValue(hero), 0);
    const enemy = enemiesFor(state, player).reduce((total, hero) => total + heroBoardValue(hero), 0);
    // 防守意识按难度加权：把己方暴露扣掉、把敌方暴露视为额外优势，
    // 使技能模拟天然规避"把自己送进火力网"的走位。
    const weight = difficultyProfile().exposureWeight;
    if (weight <= 0) return friendly - enemy * 1.08;
    const opponent: Player = player === 'player1' ? 'player2' : 'player1';
    const myExposure = exposurePenalty(state, player) * weight;
    const theirExposure = exposurePenalty(state, opponent) * weight;
    return friendly - myExposure - (enemy - theirExposure) * 1.08;
}

function cloneGameState(state: GameState): GameState {
    const dataEntries = Object.entries(state).filter(([, value]) => typeof value !== 'function');
    const data = Object.fromEntries(dataEntries);
    // Skill 定义携带 execute 函数，不能直接 structuredClone；模拟时会从技能表重新取得它。
    data.selectedSkill = null;
    // 日志和战后统计不参与局面评分。长局若在每个候选技能中反复深拷贝它们，会造成明显的二次增长。
    data.battleLog = [];
    data.battleStatistics = {};
    return structuredClone(data) as GameState;
}

function isBoardPosition(position: Position): boolean {
    return position[0] >= 0 && position[0] < BOARD_SIZE && position[1] >= 0 && position[1] < BOARD_SIZE;
}

/** 有效血量比例：把护盾计入耐久，防止把厚盾目标当残血集火。 */
function effectiveHpRatio(hero: Hero): number {
    return hero.maxHp > 0 ? Math.min(1, (hero.currentHp + hero.shield) / hero.maxHp) : 1;
}

/** 判断 position 是否落在技能的几何范围内（以 casterPosition 为施法中心）。 */
function skillReachesPosition(skill: Skill, casterPosition: Position, position: Position): boolean {
    const same = (p: Position) => p[0] === position[0] && p[1] === position[1];
    switch (skill.rangeType) {
        case 'cross':
            return MovementSystem.getCrossPositions(casterPosition).some(same);
        case 'area': {
            const size = skill.areaSize || 3;
            return MovementSystem.getAreaPositions(casterPosition, size).some(same);
        }
        case 'line': {
            const sameRowOrCol = casterPosition[0] === position[0] || casterPosition[1] === position[1];
            return sameRowOrCol && MovementSystem.isInRange(casterPosition, position, skill.range);
        }
        case '全场':
            return true;
        default:
            return MovementSystem.isInRange(casterPosition, position, skill.range);
    }
}

/**
 * 估算 attacker 对站在 position 的 defender 的最大单技能伤害：
 * 按技能实际伤害值走完整伤害管线（含防御减免），再减去 defender 的护盾吸收。
 */
function estimateThreatAtPosition(attacker: Hero, position: Position, defender: Hero): number {
    if (!attacker.position) return 0;
    let threat = 0;
    for (const skillId of [attacker.skill1Id, attacker.skill2Id]) {
        const skill = getSkill(skillId);
        if (!skill || skill.type !== 'damage') continue;
        if (skill.targetType !== 'enemy' && skill.targetType !== 'any') continue;
        if (!skillReachesPosition(skill, attacker.position, position)) continue;
        const hits = MULTI_HIT_SKILLS[skill.id] ?? 1;
        let damage: number;
        if (skill.baseDamage !== undefined) {
            damage = DamageCalculator.calculate(
                attacker,
                defender,
                skill.baseDamage,
                skill.scalesWithAttack ?? false,
                skill.ignoreDefense ?? false
            ).finalDamage * hits;
        } else {
            const custom = customSkillDamage(attacker, skill.id, position);
            if (custom === null) continue;
            damage = DamageCalculator.calculate(attacker, defender, custom, false).finalDamage;
        }
        threat = Math.max(threat, damage);
    }
    return Math.max(0, threat - defender.shield);
}

/** 技能是否处于冷却中（目前只有莫问技能1有冷却系统）。 */
function isSkillOnCooldown(hero: Hero, skill: Skill): boolean {
    if (skill.id === 'mowen_skill1' && (hero.counters['mowen_skill1_cd'] ?? 0) > 0) return true;
    // 时空旅者·戴尔技能2「时空置换」冷却
    return skill.id === 'dai_skill2' && (hero.counters['dai_skill2_cd'] ?? 0) > 0;
}

/** 估算 attacker 对 target 的最大单技能伤害（不含射程判定，供垫刀/斩杀规划用）。 */
function estimateDamageAgainst(attacker: Hero, target: Hero): number {
    let maxDamage = 0;
    for (const skillId of [attacker.skill1Id, attacker.skill2Id]) {
        const skill = getSkill(skillId);
        if (!skill || skill.type !== 'damage') continue;
        let base: number;
        if (skill.baseDamage !== undefined) {
            base = skill.baseDamage * (MULTI_HIT_SKILLS[skill.id] ?? 1);
        } else {
            const custom = customSkillDamage(attacker, skill.id, target.position ?? [0, 0]);
            if (custom === null) continue;
            base = custom;
        }
        const damage = DamageCalculator.calculate(
            attacker,
            target,
            base,
            skill.scalesWithAttack ?? false,
            skill.ignoreDefense ?? false
        ).finalDamage;
        maxDamage = Math.max(maxDamage, damage);
    }
    return maxDamage;
}

function targetPriority(state: GameState, caster: Hero, skill: Skill, position: Position): number {
    const target = state.board[position[0]][position[1]];
    if (!target) return skill.targetType === 'empty' ? 20 : 0;
    const hpRatio = effectiveHpRatio(target);
    if (target.owner !== caster.owner) {
        let score = 80 + (1 - hpRatio) * 70 + ratingsForHero(target).输出 * 2;
        // 垫刀意识：两回合内可被本英雄斩杀的残血目标优先，避免伤害分散
        const effectiveHp = target.currentHp + target.shield;
        if (effectiveHp <= estimateDamageAgainst(caster, target) * 2) {
            score += 14;
        }
        return score;
    }
    return (1 - hpRatio) * 80 + ratingsForHero(target).输出 + ratingsForHero(target).生存;
}

function buildTargetSets(state: GameState, caster: Hero, skill: Skill): Position[][] {
    if (!caster.position) return [];

    if (skill.id === 'dilan_skill1' || skill.id === 'dilan_skill2' || skill.id === 'zuizhendao_skill1') {
        return MovementSystem.getCrossPositions(caster.position).map(position => [position]);
    }

    // 时空旅者·戴尔技能1：处于时空停滞的己方阵亡单位不在棋盘上，
    // 把其死亡位置插到候选最前，确保「复活」方案能进入模拟评估。
    // 替补制编制上限：场上真实存活已满4人时唤回必然被技能校验拒绝，
    // 不生成该目标集（否则 AI 会反复执行必然失败的复活计划，形成决策死循环）。
    if (skill.id === 'dai_skill1') {
        const canReviveStalled = GameEngine.countRealAliveOnBoard(state, caster.owner) < 4;
        const stalled = canReviveStalled
            ? heroesFor(state, caster.owner).filter(hero =>
                hero.state === HeroState.DEAD &&
                hero.position !== null &&
                hero.counters['__dai_stasis_until'] !== undefined &&
                state.roundNumber <= hero.counters['__dai_stasis_until']!
            )
            : [];
        if (stalled.length > 0) {
            const stallKeys = new Set(stalled.map(hero => `${hero.position![0]},${hero.position![1]}`));
            const rest = SkillSystem.getValidTargetPositions(caster, skill)
                .filter(isBoardPosition)
                .filter(position => !stallKeys.has(`${position[0]},${position[1]}`));
            return [
                ...stalled.map(hero => [[hero.position![0], hero.position![1]] as Position]),
                ...rest.map(position => [position]),
            ];
        }
    }

    // 凋零之主技能1：枚举全场所有对角位置对（构成 2x2 区域），按靠近敌人排序取前 24 个
    if (skill.id === 'wither_lord_skill1') {
        const pairs: Position[][] = [];
        for (let row = 0; row < BOARD_SIZE - 1; row++) {
            for (let col = 0; col < BOARD_SIZE - 1; col++) {
                pairs.push([[row, col], [row + 1, col + 1]]);
                pairs.push([[row + 1, col], [row, col + 1]]);
            }
        }
        const enemies = enemiesFor(state, caster.owner)
            .filter(enemy => enemy.state === HeroState.ALIVE && enemy.position);
        const nearestDistance = (pair: Position[]) => enemies.reduce(
            (best, enemy) => Math.min(best, MovementSystem.getManhattanDistance(pair[0], enemy.position!)),
            99
        );
        return pairs
            .sort((left, right) => nearestDistance(left) - nearestDistance(right))
            .slice(0, 24);
    }

    if (skill.id === 'baize_skill2' && (caster.counters['天禄'] ?? 0) >= 3) {
        const deadAllies = heroesFor(state, caster.owner).filter(hero => hero.state === HeroState.DEAD);
        if (deadAllies.length > 0) {
            // 替补制编制上限：满编时复活必然被结算拒绝，不生成复活目标集（防 AI 死循环）
            if (GameEngine.countRealAliveOnBoard(state, caster.owner) >= 4) return [];
            const empty: Position[][] = [];
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    if (state.board[row][col] === null) empty.push([[row, col]]);
                }
            }
            return empty;
        }
    }

    let valid = SkillSystem.getValidTargetPositions(caster, skill).filter(isBoardPosition);
    if (skill.targetType === 'empty') {
        valid = valid.filter(([row, col]) => state.board[row][col] === null);
    }
    if (skill.targetType === 'self') return [[caster.position]];

    valid.sort((left, right) => targetPriority(state, caster, skill, right) - targetPriority(state, caster, skill, left));
    const targetCount = typeof skill.targetCount === 'number' ? skill.targetCount : 1;
    const sets: Position[][] = [];
    const seen = new Set<string>();

    // 双目标技能额外枚举高优先级目标的完整两两组合，避免贪心固定配对漏掉最优搭配。
    if (targetCount === 2) {
        const top = valid.slice(0, MULTI_TARGET_COMBINATION_TOP);
        for (let i = 0; i < top.length - 1; i++) {
            for (let j = i + 1; j < top.length; j++) {
                const key = [top[i], top[j]].map(position => position.join(',')).sort().join('|');
                if (!seen.has(key)) {
                    seen.add(key);
                    sets.push([top[i], top[j]]);
                }
            }
        }
    }

    for (const primary of valid) {
        const positions = [primary];
        if (targetCount > 1) {
            for (const candidate of valid) {
                if (positions.length >= targetCount) break;
                if (candidate[0] === primary[0] && candidate[1] === primary[1]) continue;
                positions.push(candidate);
            }
        }
        const key = positions.map(position => position.join(',')).sort().join('|');
        if (!seen.has(key)) {
            seen.add(key);
            sets.push(positions);
        }
    }

    return sets;
}

function configureSimulationChoices(
    state: GameState,
    caster: Hero,
    skill: Skill,
    targetPositions: Position[]
): void {
    if ((skill.id === 'dilan_skill1' || skill.id === 'dilan_skill2') && caster.position) {
        const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
        const dirCode = direction === 'up' ? 0 : direction === 'down' ? 1 : direction === 'left' ? 2 : 3;
        if (skill.id === 'dilan_skill1') {
            caster.counters['__dilan_skill1_axis'] = dirCode <= 1 ? 1 : 0;
        } else {
            caster.counters['__dilan_skill2_dir'] = dirCode;
        }
    }
    if (skill.id === 'zuizhendao_skill1' && caster.position) {
        const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
        caster.counters['__zuizhendao_skill1_dir'] =
            direction === 'up' ? 0 : direction === 'down' ? 1 : direction === 'left' ? 2 : 3;
    }
    if (skill.id === 'baize_skill2') {
        const dead = heroesFor(state, caster.owner)
            .filter(hero => hero.state === HeroState.DEAD)
            .sort((left, right) => heroBoardValue(right) - heroBoardValue(left));
        state.baizeReviveTargetHeroId = dead[0]?.id;
    }
    if (skill.id === 'jetzmi_skill2') {
        const dead = heroesFor(state, caster.owner)
            .filter(hero => hero.state === HeroState.TEMP_DEAD)
            .sort((left, right) => ratingsForHero(right).输出 - ratingsForHero(left).输出);
        if (dead[0]) {
            state.skillSelectedHeroIds = { ...(state.skillSelectedHeroIds ?? {}), [caster.id]: dead[0].id };
        }
    }
    if (skill.id === 'changli_skill2' && (caster.counters['暗夜星火'] ?? 0) >= 2) {
        caster.counters['__changli_empowered'] = 1;
    }
}

function skillTypeBias(skill: Skill): number {
    switch (skill.type) {
        case 'damage': return 5;
        case 'control': return 9;
        case 'summon': return 12;
        case 'heal': return 4;
        case 'buff': return 6;
        case 'debuff': return 7;
        default: return 3;
    }
}

function simulateSkillPlan(
    state: GameState,
    caster: Hero,
    skill: Skill,
    targetPositions: Position[]
): ComputerSkillPlan | null {
    try {
        const beforeScore = evaluateComputerBoard(state, caster.owner);
        const aliveEnemyIds = enemiesFor(state, caster.owner)
            .filter(hero => hero.state === HeroState.ALIVE && !hero.id.includes('|'))
            .map(hero => hero.id);
        const simulated = cloneGameState(state);
        const simulatedCaster = findHero(simulated, caster.id);
        if (!simulatedCaster) return null;
        configureSimulationChoices(simulated, simulatedCaster, skill, targetPositions);

        if (skill.id === 'wukong_skill1') {
            const [row, col] = targetPositions[0] ?? [-1, -1];
            if (!isBoardPosition([row, col]) || simulated.board[row][col] !== null) return null;
            const enemyDistance = enemiesFor(simulated, simulatedCaster.owner)
                .filter(enemy => enemy.position)
                .reduce((best, enemy) => Math.min(best, MovementSystem.getManhattanDistance([row, col], enemy.position!)), 10);
            return { skillId: skill.id, targetPositions, score: 24 - enemyDistance * 1.5 };
        }

        if (skill.id === 'hanjiangxue_skill2') {
            // 冰晶封路：放在敌方阵型附近封锁走位并生成冰甲点，距离越近价值越高
            const [row, col] = targetPositions[0] ?? [-1, -1];
            if (!isBoardPosition([row, col]) || simulated.board[row][col] !== null) return null;
            const nearbyEnemies = enemiesFor(simulated, simulatedCaster.owner).filter(enemy =>
                enemy.position &&
                MovementSystem.getManhattanDistance([row, col], enemy.position) <= 2
            ).length;
            const nearestEnemyDistance = enemiesFor(simulated, simulatedCaster.owner)
                .filter(enemy => enemy.position)
                .reduce((best, enemy) => Math.min(best, MovementSystem.getManhattanDistance([row, col], enemy.position!)), 99);
            const score = 10
                + nearbyEnemies * 5
                + Math.max(0, 6 - nearestEnemyDistance) * 1.5
                + (simulatedCaster.counters['__hanjiangxue_extra_used'] === 1 ? -4 : 0);
            return { skillId: skill.id, targetPositions, score };
        }

        const result = SkillSystem.executeSkill(simulatedCaster, skill, targetPositions, simulated);
        if (!result.success) return null;

        const afterScore = evaluateComputerBoard(simulated, caster.owner);
        // 斩杀确认：对比模拟前后的敌方状态，被真实击杀或暂时阵亡的目标给予额外奖励。
        let kills = 0;
        let tempDeaths = 0;
        for (const enemy of enemiesFor(simulated, caster.owner)) {
            if (!aliveEnemyIds.includes(enemy.id)) continue;
            if (enemy.state === HeroState.DEAD) kills++;
            else if (enemy.state === HeroState.TEMP_DEAD) tempDeaths++;
        }
        const damage = result.damageDealt?.reduce((sum, amount) => sum + amount, 0) ?? 0;
        const healing = result.healingDone?.reduce((sum, amount) => sum + amount, 0) ?? 0;
        // 效果价值按类型加权：控制/增益/减益的价值远高于单纯的“效果数量”
        const effectValue = result.effectsApplied?.reduce((sum, effect) => {
            if (effect.type === 'stun' || effect.type === 'control') return sum + 14;
            if (effect.type === 'buff' || effect.type === 'debuff') return sum + 7;
            if (effect.type === 'shield') return sum + 5;
            return sum + 3;
        }, 0) ?? 0;
        const meaningfulResult = Math.abs(afterScore - beforeScore) > 0.25 || damage > 0 || healing > 0 || effectValue > 0;
        const lastSkillIndex = caster.counters['__ai_last_skill_index'];
        const skillIndex = caster.skill1Id === skill.id ? 0 : 1;
        // 天威联动：拥有"击杀敌人后立即再动"天威的英雄，每次击杀还能白赚一轮行动
        const tianweiBonus = kills > 0 && simulatedCaster.tianweiId ? kills * TIANWEI_KILL_BONUS : 0;
        // 悟空技能2：召唤的分身每个都能再打一轮，场上分身越多价值越高
        const cloneBonus = skill.id === 'wukong_skill2'
            ? allHeroes(simulated).filter(hero =>
                hero.state === HeroState.ALIVE && isWukongCloneOf(hero, caster.id)
            ).length * 26
            : 0;
        const score = afterScore - beforeScore
            + damage * 0.65
            + healing * 0.45
            + effectValue
            + kills * KILL_SCORE_BONUS
            + tempDeaths * TEMP_DEAD_SCORE_BONUS
            + tianweiBonus
            + cloneBonus
            + (meaningfulResult ? skillTypeBias(skill) : 0)
            // 技能轮换：最近一次用过的技能减分，促使 AI 换着放技能
            - (lastSkillIndex === skillIndex ? SKILL_REPEAT_PENALTY : 0);

        return { skillId: skill.id, targetPositions, score };
    } catch {
        return null;
    }
}

export function chooseComputerSkillPlan(
    state: GameState,
    caster: Hero,
    onlySkillId?: string
): ComputerSkillPlan | null {
    if (caster.state !== HeroState.ALIVE || !caster.position || caster.hasActedThisTurn) return null;
    const skillIds = onlySkillId ? [onlySkillId] : [caster.skill1Id, caster.skill2Id];
    const candidates: ComputerSkillPlan[] = [];

    for (const skillId of skillIds) {
        const skill = getSkill(skillId);
        // 冷却感知：冷却中的技能不再进入模拟，避免浪费计算并让 AI 优先使用就绪技能
        if (!skill || isSkillOnCooldown(caster, skill)) continue;
        if (skill.id === 'wukong_skill2') {
            // 分身指挥要求本回合未移动，且场上已有分身或射程内有敌人才有意义
            if (caster.hasMovedThisTurn) continue;
            const hasClones = allHeroes(state).some(hero =>
                hero.state === HeroState.ALIVE && isWukongCloneOf(hero, caster.id)
            );
            const hasEnemyInReach = enemiesFor(state, caster.owner).some(enemy =>
                enemy.state === HeroState.ALIVE &&
                enemy.position &&
                MovementSystem.getAreaPositions(caster.position!, skill.areaSize || 3)
                    .some(([row, col]) => row === enemy.position![0] && col === enemy.position![1])
            );
            if (!hasClones && !hasEnemyInReach) continue;
        }
        if (!SkillSystem.canUseSkill(caster, skill, state)) {
            // 白泽复活会绕过常规目标判定，单独允许进入模拟。
            if (
                !(skill?.id === 'baize_skill2' && (caster.counters['天禄'] ?? 0) >= 3) &&
                skill?.id !== 'dilan_skill2'
            ) continue;
        }
        for (const targetPositions of buildTargetSets(state, caster, skill)) {
            const candidate = simulateSkillPlan(state, caster, skill, targetPositions);
            if (candidate) candidates.push(candidate);
        }
    }

    if (candidates.length === 0) return null;

    // 技能多样性：分数接近的候选（含不同技能/目标）之间随机挑选，避免每回合都放同一个技能；
    // 低难度还会以一定概率主动挑次优解。
    return pickWithBlunder(candidates, difficultyProfile().skillTolerance) ?? null;
}

function maximumSkillReach(hero: Hero): number {
    return [getSkill(hero.skill1Id), getSkill(hero.skill2Id)].reduce((best, skill) => {
        if (!skill) return best;
        if (skill.rangeType === '全场') return BOARD_SIZE * 2;
        return Math.max(best, skill.range + (skill.rangeType === 'area' ? 1 : 0));
    }, 1);
}

export function scoreComputerPosition(state: GameState, hero: Hero, position: Position): number {
    const ratings = ratingsForHero(hero);
    const hpRatio = hero.maxHp > 0 ? hero.currentHp / hero.maxHp : 0;
    const enemies = enemiesFor(state, hero.owner).filter(enemy => enemy.state === HeroState.ALIVE && enemy.position);
    const allies = heroesFor(state, hero.owner).filter(ally => ally.id !== hero.id && ally.state === HeroState.ALIVE && ally.position);
    const reach = maximumSkillReach(hero);
    let score = 0;

    for (const enemy of enemies) {
        const distance = MovementSystem.getManhattanDistance(position, enemy.position!);
        const enemyReach = maximumSkillReach(enemy);
        const enemyHpRatio = effectiveHpRatio(enemy);
        if (distance <= reach) score += ratings.输出 * 2.2 + ratings.控制 * 1.4 + (1 - enemyHpRatio) * 18;
        score += Math.max(0, 6 - distance) * ratings.输出 * 0.22;
        if (!EffectManager.isStunned(enemy)) {
            if (distance <= enemyReach) {
                // 直接威胁：敌人原地就能打到这个位置
                const threat = estimateThreatAtPosition(enemy, position, hero);
                if (threat > 0) {
                    // 会被敌方单次技能直接击杀时威胁扣分大幅放大，残血英雄优先保命；
                    // 敌方本回合已行动过则威胁大幅降低。
                    const deathRisk = threat >= hero.currentHp ? 3.2 : 1;
                    const actedFactor = enemy.hasActedThisTurn ? 0.25 : 1;
                    score -= threat * (0.35 + (1 - hpRatio) * 0.65) * actedFactor * deathRisk;
                } else {
                    // 没有直接伤害技能的治疗/辅助单位，保留轻微威慑分。
                    score -= (1.15 - hpRatio) * ratingsForHero(enemy).输出 * 0.5;
                }
            } else if (!enemy.hasActedThisTurn && distance <= enemyReach + Math.max(0, enemy.moveRange)) {
                // 间接威胁：敌人下回合移动一步后就能打到。属于推测性风险，
                // 按远低于直接威胁的折扣提前规避，不能盖过"离开当前射程"的相对收益。
                const threat = estimateDamageAgainst(enemy, hero) * 0.5;
                if (threat > 0) {
                    const deathRisk = threat >= hero.currentHp ? 1.2 : 1;
                    score -= threat * (0.16 + (1 - hpRatio) * 0.35) * deathRisk;
                }
            }
        }
    }

    if (ratings.支援 >= 7) {
        for (const ally of allies) {
            const distance = MovementSystem.getManhattanDistance(position, ally.position!);
            score += Math.max(0, 4 - distance) * ratings.支援 * 0.5;
        }
    }

    score += (2.5 - Math.abs(position[0] - 2.5)) * 0.8;
    if (hpRatio < 0.35) {
        const nearestEnemy = enemies.reduce(
            (best, enemy) => Math.min(best, MovementSystem.getManhattanDistance(position, enemy.position!)),
            12
        );
        score += nearestEnemy * (0.35 - hpRatio) * 9;
    } else if (ratings.支援 >= 8 && hpRatio < 0.6) {
        // 治疗/辅助型英雄更早后撤，避免被集火。
        const nearestEnemy = enemies.reduce(
            (best, enemy) => Math.min(best, MovementSystem.getManhattanDistance(position, enemy.position!)),
            12
        );
        score += nearestEnemy * (0.6 - hpRatio) * 3;
    }
    return score;
}

export function chooseComputerMove(state: GameState, hero: Hero): Position | null {
    if (!hero.position || hero.hasMovedThisTurn) return null;
    const positions = MovementSystem.getMovablePositions(hero, state);
    const currentScore = scoreComputerPosition(state, hero, hero.position);
    const candidates = positions
        .map(position => ({ position, score: scoreComputerPosition(state, hero, position) }))
        .filter(candidate => candidate.score > currentScore + 1.25);
    if (candidates.length === 0) return null;

    return pickWithBlunder(candidates, difficultyProfile().decisionTolerance)?.position ?? null;
}

export function chooseComputerHero(state: GameState, player: Player): Hero | null {
    if (state.activeHero?.owner === player && state.activeHero.state === HeroState.ALIVE) return state.activeHero;
    const candidates = heroesFor(state, player).filter(hero =>
        hero.state === HeroState.ALIVE &&
        !hero.hasActedThisTurn &&
        !EffectManager.isStunned(hero)
    );
    const scored = candidates.map(hero => {
        const skillPlan = chooseComputerSkillPlan(state, hero);
        const move = chooseComputerMove(state, hero);
        const moveScore = move ? scoreComputerPosition(state, hero, move) : (hero.position ? scoreComputerPosition(state, hero, hero.position) : 0);
        const hpRatio = hero.maxHp > 0 ? hero.currentHp / hero.maxHp : 0;
        // 冷却中的英雄适当延后出手，把行动优先让给技能就绪的队友
        const cooldownPenalty = [hero.skill1Id, hero.skill2Id].some(skillId => {
            const skill = getSkill(skillId);
            return skill ? isSkillOnCooldown(hero, skill) : false;
        }) ? 4 : 0;
        return {
            hero,
            score: (skillPlan?.score ?? 0) * 1.4 + moveScore + hpRatio * 4 + ratingsForHero(hero).节奏 - cooldownPenalty,
        };
    });
    if (scored.length === 0) return null;

    return pickWithBlunder(scored, difficultyProfile().decisionTolerance)?.hero ?? null;
}

export function chooseComputerPendingBoardPosition(state: GameState, hero: Hero): Position | null {
    const candidates: Position[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const occupant = state.board[row][col];
            if (occupant === null || occupant.id === hero.id) candidates.push([row, col]);
        }
    }
    return candidates.sort((left, right) =>
        scoreComputerPosition(state, hero, right) - scoreComputerPosition(state, hero, left)
    )[0] ?? null;
}

export function chooseComputerReviveTarget(state: GameState, player: Player): Hero | null {
    // 替补制：场上真实存活已达四人上限时复活会超编，直接放弃复活。
    // 使用引擎权威口径（含召唤物排除与棋盘引用一致性校验），避免本地计数与结算口径漂移导致决策失误。
    if (GameEngine.countRealAliveOnBoard(state, player) >= 4) return null;

    return heroesFor(state, player)
        .filter(hero => hero.state === HeroState.DEAD)
        .sort((left, right) => {
            const leftRatings = ratingsForHero(left);
            const rightRatings = ratingsForHero(right);
            const score = (ratings: HeroAbilityRatings) => ratings.输出 * 1.2 + ratings.生存 + ratings.支援 + ratings.控制;
            return score(rightRatings) - score(leftRatings);
        })[0] ?? null;
}

export function chooseComputerTemporaryDeadTarget(state: GameState, player: Player): Hero | null {
    return heroesFor(state, player)
        .filter(hero => hero.state === HeroState.TEMP_DEAD)
        .sort((left, right) => ratingsForHero(right).输出 - ratingsForHero(left).输出)[0] ?? null;
}

export function chooseComputerSupportTarget(state: GameState, caster: Hero): Hero | null {
    return heroesFor(state, caster.owner)
        .filter(hero => hero.id !== caster.id && hero.state === HeroState.ALIVE)
        .sort((left, right) => {
            const leftValue = left.currentHp + left.shield + ratingsForHero(left).生存 * 3;
            const rightValue = right.currentHp + right.shield + ratingsForHero(right).生存 * 3;
            return rightValue - leftValue;
        })[0] ?? null;
}

export function chooseComputerBeneficiary(state: GameState, caster: Hero): Hero | null {
    return heroesFor(state, caster.owner)
        .filter(hero => hero.id !== caster.id && hero.state === HeroState.ALIVE)
        .sort((left, right) => {
            // 吸血受益者优先给本回合尚未行动的高输出英雄，让增益立刻转化为伤害。
            const value = (hero: Hero) =>
                ratingsForHero(hero).输出 * 2 + (hero.hasActedThisTurn ? 0 : 4) + hero.currentHp / hero.maxHp;
            return value(right) - value(left);
        })[0] ?? null;
}

export interface ComputerJointMovePlan {
    /** 建议先移动到的格子 */
    position: Position;
    /** 移动后能打出的最优技能方案 */
    plan: ComputerSkillPlan;
    /** 站位分与技能分的加权总分 */
    totalScore: number;
}

/** 联合规划要求总分明显优于原地放技能才采纳的门槛。 */
const JOINT_MOVE_MARGIN = 8;
/** 联合规划中的技能本身也要有足够强度，避免为了一点站位分而浪费行动。 */
const JOINT_MIN_PLAN_SCORE = 55;

/**
 * 移动+技能联合规划：枚举若干高价值站位，模拟"先移动到该格再放技能"的总收益。
 * 只有当总分明显超过"原地放技能 + 原地站位"时才返回方案，控制计算开销并防止为动而动。
 * 低难度档 jointMoveTopK=0 直接关闭该能力。
 */
export function planJointMoveForHero(state: GameState, caster: Hero): ComputerJointMovePlan | null {
    if (!caster.position || caster.hasMovedThisTurn || caster.hasActedThisTurn) return null;
    if (caster.state !== HeroState.ALIVE) return null;
    const topK = difficultyProfile().jointMoveTopK;
    if (topK <= 0) return null;

    const currentPos = caster.position;
    const movable = MovementSystem.getMovablePositions(caster, state);
    if (movable.length === 0) return null;

    const baselinePlan = chooseComputerSkillPlan(state, caster);
    const baselineTotal =
        (baselinePlan?.score ?? 0) + scoreComputerPosition(state, caster, currentPos) * 0.3;

    // 按站位质量取前 topK 个候选格，避免全图模拟
    const ranked = movable
        .map(position => ({ position, posScore: scoreComputerPosition(state, caster, position) }))
        .sort((left, right) => right.posScore - left.posScore)
        .slice(0, topK);

    let best: ComputerJointMovePlan | null = null;
    for (const candidate of ranked) {
        const plan = simulateHeroMoveThenSkill(state, caster, candidate.position);
        if (!plan) continue;
        const total = plan.score + candidate.posScore * 0.3;
        if (!best || total > best.totalScore) {
            best = { position: candidate.position, plan, totalScore: total };
        }
    }

    if (
        !best ||
        best.totalScore <= baselineTotal + JOINT_MOVE_MARGIN ||
        best.plan.score < JOINT_MIN_PLAN_SCORE
    ) {
        return null;
    }
    return best;
}

/** 模拟"移动到 position 后立刻放技能"：克隆棋盘、搬位置，再走完整技能模拟。 */
function simulateHeroMoveThenSkill(
    state: GameState,
    caster: Hero,
    position: Position
): ComputerSkillPlan | null {
    try {
        if (state.board[position[0]][position[1]] !== null) return null;
        const simulated = cloneGameState(state);
        const movedCaster = findHero(simulated, caster.id);
        if (!movedCaster || !movedCaster.position) return null;
        simulated.board[movedCaster.position[0]][movedCaster.position[1]] = null;
        movedCaster.position = position;
        simulated.board[position[0]][position[1]] = movedCaster;
        movedCaster.hasMovedThisTurn = true;
        return chooseComputerSkillPlan(simulated, movedCaster);
    } catch {
        return null;
    }
}

/**
 * 孙悟空分身指挥：为攻击单位（本体或任一分身）在其 3x3 技能范围内挑选收益最高的敌人目标。
 * 用完整技能模拟评分，天然考虑伤害、击杀与天威联动。
 */
export function chooseComputerWukongStrikeTarget(
    state: GameState,
    attacker: Hero,
    skill: Skill
): Position | null {
    if (!attacker.position || attacker.state !== HeroState.ALIVE) return null;
    let best: Position | null = null;
    let bestScore = 0;
    for (const position of SkillSystem.getValidTargetPositions(attacker, skill).filter(isBoardPosition)) {
        const target = state.board[position[0]][position[1]];
        if (!target || target.owner === attacker.owner || target.state !== HeroState.ALIVE) continue;
        const plan = simulateSkillPlan(state, attacker, skill, [position]);
        const score = plan?.score ?? 0;
        if (score > bestScore) {
            bestScore = score;
            best = position;
        }
    }
    return best;
}

/**
 * 孙悟空分身指挥：为本体/分身挑一格相邻移动位。
 * 只考虑移动过去后 3x3 内有敌人的格子（移动就是为了打出下一拳），
 * 再按走位安危排序取最优。
 */
export function chooseComputerWukongStepPosition(state: GameState, unit: Hero): Position | null {
    if (!unit.position || unit.state !== HeroState.ALIVE) return null;
    let best: Position | null = null;
    let bestScore = -Infinity;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const row = unit.position[0] + dr;
        const col = unit.position[1] + dc;
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
        if (state.board[row][col] !== null) continue;
        const hasTargetNearby = MovementSystem.getAreaPositions([row, col], 3).some(([areaRow, areaCol]) => {
            const occupant = state.board[areaRow][areaCol];
            return !!occupant && occupant.owner !== unit.owner && occupant.state === HeroState.ALIVE;
        });
        if (!hasTargetNearby) continue;
        const score = scoreComputerPosition(state, unit, [row, col]);
        if (score > bestScore) {
            bestScore = score;
            best = [row, col];
        }
    }
    return best;
}
