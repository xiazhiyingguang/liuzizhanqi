import type { GameState, Hero, Player, Position, Skill } from '../types/game';
import { HeroState } from '../types/game';
import { AVAILABLE_HERO_IDS, getHeroInfo } from '../data/heroes';
import { getHeroAbilityRatings, type HeroAbilityRatings } from '../data/hero-ratings';
import { getSkill } from '../data/skills';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import { SkillSystem } from './skill-system';
import { DamageCalculator } from './damage-calculator';

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
const TEAM_CANDIDATE_POOL_SIZE = 10;
/** 候选池内阵容之间至少不同的英雄数，避免每局都是同一套核心（如长离+阴阳师）。 */
const TEAM_MIN_DIFFERENCE = 2;
/** 移动/选英雄的随机容差：分数与最优差距小于该值时随机挑选，增加对局变化但不明显降智。 */
const DECISION_TOLERANCE = 2;
/** 斩杀优先奖励：模拟中确认击杀一名敌人时附加的评分，压过其他一切收益，让 AI 追着残血杀。 */
const KILL_SCORE_BONUS = 180;
/** 把敌人打成暂时阵亡的奖励（敌方可能拥有复活，故低于真实击杀）。 */
const TEMP_DEAD_SCORE_BONUS = 40;
/** 多目标技能组合枚举时考虑的前 N 个高优先级目标。 */
const MULTI_TARGET_COMBINATION_TOP = 6;
/** 多段伤害技能：估算威胁伤害时按段数放大（如回锋连刃斩共 3 段）。 */
const MULTI_HIT_SKILLS: Record<string, number> = {
    huifeng_skill1: 3,
};

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
const AI_UNSUPPORTED_SKILL_IDS = new Set([
    // 需要依次指挥本体和每一个分身，第一版 AI 使用更稳定的分身召唤与其他技能。
    'wukong_skill2',
]);

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

function ratingsForHero(hero: Hero): HeroAbilityRatings {
    return getHeroAbilityRatings(hero.name) ?? DEFAULT_RATINGS;
}

function averageRating(heroIds: string[], key: keyof HeroAbilityRatings): number {
    if (heroIds.length === 0) return 5;
    return heroIds.reduce((sum, id) => sum + ratingsForHeroId(id)[key], 0) / heroIds.length;
}

function teamScore(team: string[], opponentHeroIds: string[]): number {
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
 * 按分数从高到低挑选互相差异明显的阵容组成候选池：与池中已有阵容至少有
 * TEAM_MIN_DIFFERENCE 个英雄不同才入池，避免随机结果总是同一套核心。
 */
function buildDiversePool(
    candidates: { team: string[]; score: number }[],
    size: number
): { team: string[]; score: number }[] {
    const pool: { team: string[]; score: number }[] = [];
    for (const candidate of candidates) {
        if (pool.length >= size) break;
        if (pool.every(existing => teamOverlap(existing.team, candidate.team) <= 4 - TEAM_MIN_DIFFERENCE)) {
            pool.push(candidate);
        }
    }
    return pool;
}

/**
 * 根据玩家阵容穷举四人组合评分，在满足职责完整度的最高分阵容池中随机挑选，
 * 保证强度与反制能力的前提下让每次对局的电脑阵容不同。
 */
export function chooseComputerTeam(opponentHeroIds: string[]): string[] {
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
                    candidates.push({ team, score: teamScore(team, opponentHeroIds) });
                }
            }
        }
    }

    candidates.sort((left, right) => right.score - left.score);
    const pool = buildDiversePool(candidates, TEAM_CANDIDATE_POOL_SIZE);
    const picked = pool[Math.floor(Math.random() * pool.length)] ?? candidates[0];
    return picked ? picked.team : AVAILABLE_HERO_IDS.slice(0, 4);
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

export function evaluateComputerBoard(state: GameState, player: Player): number {
    const friendly = heroesFor(state, player).reduce((total, hero) => total + heroBoardValue(hero), 0);
    const enemy = enemiesFor(state, player).reduce((total, hero) => total + heroBoardValue(hero), 0);
    return friendly - enemy * 1.08;
}

function cloneGameState(state: GameState): GameState {
    const dataEntries = Object.entries(state).filter(([, value]) => typeof value !== 'function');
    const data = Object.fromEntries(dataEntries);
    // Skill 定义携带 execute 函数，不能直接 structuredClone；模拟时会从技能表重新取得它。
    data.selectedSkill = null;
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
    return skill.id === 'mowen_skill1' && (hero.counters['mowen_skill1_cd'] ?? 0) > 0;
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

    if (skill.id === 'baize_skill2' && (caster.counters['天禄'] ?? 0) >= 3) {
        const deadAllies = heroesFor(state, caster.owner).filter(hero => hero.state === HeroState.DEAD);
        if (deadAllies.length > 0) {
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

function configureSimulationChoices(state: GameState, caster: Hero, skill: Skill): void {
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
        configureSimulationChoices(simulated, simulatedCaster, skill);

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
        const appliedEffects = result.effectsApplied?.length ?? 0;
        const meaningfulResult = Math.abs(afterScore - beforeScore) > 0.25 || damage > 0 || healing > 0 || appliedEffects > 0;
        const score = afterScore - beforeScore
            + damage * 0.65
            + healing * 0.45
            + appliedEffects * 3
            + kills * KILL_SCORE_BONUS
            + tempDeaths * TEMP_DEAD_SCORE_BONUS
            + (meaningfulResult ? skillTypeBias(skill) : 0);

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
    let best: ComputerSkillPlan | null = null;

    for (const skillId of skillIds) {
        if (AI_UNSUPPORTED_SKILL_IDS.has(skillId)) continue;
        const skill = getSkill(skillId);
        // 冷却感知：冷却中的技能不再进入模拟，避免浪费计算并让 AI 优先使用就绪技能
        if (!skill || isSkillOnCooldown(caster, skill)) continue;
        if (!SkillSystem.canUseSkill(caster, skill, state)) {
            // 白泽复活会绕过常规目标判定，单独允许进入模拟。
            if (!(skill?.id === 'baize_skill2' && (caster.counters['天禄'] ?? 0) >= 3)) continue;
        }
        for (const targetPositions of buildTargetSets(state, caster, skill)) {
            const candidate = simulateSkillPlan(state, caster, skill, targetPositions);
            if (candidate && (!best || candidate.score > best.score)) best = candidate;
        }
    }

    return best;
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
        if (distance <= enemyReach && !EffectManager.isStunned(enemy)) {
            const threat = estimateThreatAtPosition(enemy, position, hero);
            if (threat > 0) {
                // 会被敌方单次技能直接击杀时威胁扣分大幅放大，残血英雄优先保命；
                // 敌方本回合已行动过则威胁大幅降低。
                const deathRisk = threat >= hero.currentHp ? 2.5 : 1;
                const actedFactor = enemy.hasActedThisTurn ? 0.25 : 1;
                score -= threat * (0.35 + (1 - hpRatio) * 0.65) * actedFactor * deathRisk;
            } else {
                // 没有直接伤害技能的治疗/辅助单位，保留轻微威慑分。
                score -= (1.15 - hpRatio) * ratingsForHero(enemy).输出 * 0.5;
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

    const bestScore = Math.max(...candidates.map(candidate => candidate.score));
    const nearBest = candidates.filter(candidate => candidate.score >= bestScore - DECISION_TOLERANCE);
    return nearBest[Math.floor(Math.random() * nearBest.length)].position;
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

    const bestScore = Math.max(...scored.map(item => item.score));
    const nearBest = scored.filter(item => item.score >= bestScore - DECISION_TOLERANCE);
    return nearBest[Math.floor(Math.random() * nearBest.length)].hero;
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
