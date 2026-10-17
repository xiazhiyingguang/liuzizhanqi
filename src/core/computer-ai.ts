import type { AiDifficulty, GameState, Hero, Player, Position, Skill } from '../types/game';
import { HeroState } from '../types/game';
import { zhizhiValue } from './hero-zhizhi';
import { AVAILABLE_HERO_IDS, getHeroInfo, getZhenxiaoDamageBonus } from '../data/heroes';
import { getHeroAbilityRatings, type HeroAbilityRatings } from '../data/hero-ratings';
import { getSkill } from '../data/skills';
import { EffectManager } from './effect-manager';
import { MovementSystem } from './movement-system';
import { SkillSystem } from './skill-system';
import { getWangshuMultiplier, getWangshuPhase } from './wangshu';
import { DamageCalculator } from './damage-calculator';
import { GameEngine } from './game-engine';
import { windLaneAxis, windLaneCells, windLaneDirectionFromCode } from './wind-lane';
import { hookThrowLandings, HOOK_THROW_DAMAGE, marshCovers, whaleFallRate } from './water-marsh';
import { TINGYUAN_HIT_DAMAGE, hasChainMark, hasThunderMark } from './chain-lightning';
import { DASH_DAMAGE, ORBIT_DAMAGE, ORBIT_DAMAGE_TALENT, dragonVictimsOnCells, hasDragon, nextOrbitLeg } from './dragon-orbit';
import {
    CLOUD_DAMAGE,
    CLOUD_DAMAGE_TALENT,
    CLOUD_DRIFT_OFFSETS,
    CLOUD_MAX,
    CLOUD_RADIUS,
    ROD_DAMAGE,
    bestCloudAnchorCover,
    cloudVictimCountAt,
    cloudsOf,
} from './thunder-cloud';
import { MOUNTAIN_COUNTER, directionFromCell, guardsCell, hasStance, mountainPressure, stanceDirection, threatensFrom } from './mountain-stance';
import { isJinghongReleaseWindow, findHnyShadow, findWaterMoon, findMoonSeat } from '../data/extended-heroes';
import { isZhaoShen } from './xuanyuan-form';
import { getHnyReplayForm, getJinghuaSwapDestinations, pickYunyingTianweiLanding, pickZhiguangTianweiLanding, runWithoutSkillFx, traceZhiguangBeam, XUBAI_ORB_HEAL, XUBAI_ORB_MAX, ZHIGUANG_DIRECTION_DELTAS } from '../data/extended-skills';

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
const TEAM_CANDIDATE_POOL_SIZE = 24;
/** 候选池内阵容之间至少不同的英雄数，避免每局都是同一套核心（如长离+阴阳师）。 */
const TEAM_MIN_DIFFERENCE = 3;
/** 候选池中单个英雄的最大出现次数（控制高分英雄的重复率，让全部英雄都有出场机会）。 */
const TEAM_MAX_HERO_USAGE = 4;
/** 选将温度采样：分数每差 30 分，被选中权重降约 63%，低分阵容也有可观出场率。 */
const TEAM_SOFTMAX_TEMPERATURE = 30;
/** 替补制：每方替补席人数（六人选将，四人首发）。 */
const BENCH_SIZE = 2;
/** 最近一次使用过的技能会减分，促使 AI 轮换使用不同技能。 */
const SKILL_REPEAT_PENALTY = 5;
/** 斩杀优先奖励：模拟中确认击杀一名敌人时附加的评分，压过其他一切收益，让 AI 追着残血杀。 */
const KILL_SCORE_BONUS = 205;
/** 把敌人打成暂时阵亡的奖励（敌方可能拥有复活，故低于真实击杀）。 */
const TEMP_DEAD_SCORE_BONUS = 45;
/**
 * 代价型技能：以"本方单位暂时阵亡"为付款方式的技能。
 * 它们的账面全是损失、收益要等下一回合才到账，不特殊处理就会被出手闸门永远拦死。
 */
const DEATH_FUEL_SKILLS = new Set([
    'soul_lamp_skill1',   // 暗夜法阵：自己暂死换 3×3 共鸣增幅区
    'soul_lamp_skill2',   // 缚魂轮转：自己 + 一名队友暂死，下回合带治疗回归
    'skeletonking_skill1', // 亡骨斩：50% 自陷暂死
    'jetzmi_skill1',      // 终焉斩：城主形态 50% 自陷暂死并切换形态
    'jinghua_skill2',     // 印月替身：自己下场留月座，换候补登场
]);
/** "离场一回合"的代价：一次出手的机会（伤害+节奏），而不是这个单位本身的盘面价值。 */
const TEMP_DEAD_ONE_ACTION_COST = 30;
/** 镜花印月替身：月座保证归来的现值，减去"接她回来要再花一名队友一次行动"的成本与逐次贬值。 */
const JINGHUA_SEAT_RETURN_PREMIUM = 40;
const JINGHUA_SEAT_FETCH_COST = 34;
const JINGHUA_SEAT_REPEAT_DECAY = 12;
/** 一场对局里最多换几次身：超过之后这一手不再进候选（否则 AI 会把全队行动拿去喂循环） */
const JINGHUA_SEAT_MAX_USES = 2;
/** 印月每层镜影给登场替身的攻防放大，折成分。 */
const JINGHUA_YINYUE_VALUE_PER_STACK = 3;
/** 水月换身：影格自带 5 点护盾，之后每次友方移动再踩一次影还能再拿一份。 */
const WATER_MOON_SHIELD_VALUE = 5;
const WATER_MOON_RETRIGGER_VALUE = 2;
/** 把「亡灵共鸣」直接换算成伤害的英雄——法阵的增幅只对队里有这些人才兑现。 */
const RESONANCE_EARNER_SKILLS = new Set([
    'skeletonking_skill1', 'skeletonking_skill2',
    'jetzmi_skill1', 'jetzmi_skill2',
    'wither_lord_skill1',
]);
/** 能把「暂时阵亡」的队友唤回现场的手段：有这些人在场，暂死就不是单向损失。 */
const TEMP_DEAD_REVIVER_SKILLS = new Set([
    'skeletonking_skill2', // 亡灵唤回：50% 复活一名暂时阵亡友方
    'jetzmi_skill2',       // 亡灵汲取：复活暂时阵亡队友
]);
/** 拥有"击杀后立即再动"天威的英雄，每次模拟击杀的额外收益。 */
const TIANWEI_KILL_BONUS = 40;
/** 疾掠收回风刃的价值：每回合首次收回会刷新疾掠，等于本回合还能再冲一次。 */
/**
 * 让友方再动一次的底价：再动只改变出手次数，不产生伤害、效果或棋盘变化，
 * evaluateComputerBoard 的分差看不见它，必须显式计分，否则 AI 永远只放伤害技。
 * 再动者本回合还能打出的伤害另按 damageWeight 追加。
 */
const EXTRA_ACTION_BASE = 30;
/** 再动收益按受助者输出档线性折算：输出 10 的人多一次手 ≈ 90 分 */
const EXTRA_ACTION_PER_OUTPUT_RATING = 6;
/** 琉璃「援护」：每保下一个友方的固定价值 + 折算的承伤价值（挡下的伤害按 0.4 计） */
const LIULI_GUARD_VALUE_PER_ALLY = 8;
const LIULI_GUARD_DAMAGE_FACTOR = 0.4;
/** 一层禅定的价值：琉璃技能二按最大生命 10% 回复，折算到治疗权重上 */
const LIULI_ZENDING_VALUE = 4;
/**
 * 增益技的增幅折算系数：把"给队友上了 buff"按受助者一次出手的价值打折记进分数。
 * 玄霄「玄光加持」是增伤/暴击率/暴伤各 +20%，三重叠乘按 0.35 记；
 * 阴阳师「纯阳一线」是攻击与防御双升，防御那一半不产生输出，按 0.25 记。
 */
const BUFF_AMPLIFICATION_VALUE: Record<string, number> = {
    xuanxiao_skill1: 0.35,
    yinyang_skill1: 0.25,
};
/** 友方本回合还没正常行动过时，再动的折扣（它反正还要行动一次，收益没那么高）。 */
const EXTRA_ACTION_PRE_ACTED_FACTOR = 0.6;
/** 多目标技能组合枚举时考虑的前 N 个高优先级目标。 */
const MULTI_TARGET_COMBINATION_TOP = 6;
/**
 * 攻击性权重：AI 主动求战、愿意换血、优先压低敌方血线。
 * damageWeight 决定"打出去的每 1 点伤害值多少分"，与 heroBoardValue 中
 * 己方 1 点生命的 1.65 分相对；调到 1.05 后 AI 会接受约 1.6:1 的换血。
 */
const AGGRESSION = {
    damageWeight: 1.05,
    healingWeight: 0.42,
    /** 位移型伤害技能（如游隼疾掠）每穿透一名敌人的额外价值 */
    piercePerEnemy: 7,
    /** 冲刺每推进一格的接敌价值（仅在确实穿透到敌人时才给，见 dashBonus） */
    dashPerCell: 2,
};
/** 多段伤害技能：估算威胁伤害时按段数放大（如回锋连刃斩共 3 段）。 */
const MULTI_HIT_SKILLS: Record<string, number> = {
    huifeng_skill1: 3,
};
/** 疾掠收回风刃的价值：每回合首次收回会刷新疾掠，等于本回合还能再冲一次。 */
const WIND_BLADE_RETRACT_VALUE = 14;
/** 墨阑「为道」攒满两次受击后换来的那一次额外出手。 */
const MORAN_WEIDAO_EXTRA_ACTION_VALUE = 20;
/** 震霄「金银错」的回击基础点数与束缚格对每个贴身敌人的价值。 */
const ZHENXIAO_COUNTER_DAMAGE = 6;
const ZHENXIAO_BIND_VALUE_PER_ENEMY = 5;
/** 风铃沙丘：站场本身的增幅与闪避累积，加上场里每个敌人（她打得到的人才吃得到这份增幅）。 */
const DUNE_BASE_VALUE = 12;
const DUNE_VALUE_PER_FOE = 5;
/** 赏金猎杀令：标记本身逼对手让位的价值，加上每次追加追击 4 点 × 够得着目标的队友数。 */
const BOUNTY_MARK_BASE = 6;
const BOUNTY_FOLLOWUP_DAMAGE = 4;
/** 绯雪连枝：被结契队友每次主动命中追加 6 点，持续 2 回合，按能打中两次估。 */
const LIANZHI_FOLLOWUP_VALUE = 12;
/**
 * 铺路型技能：这一手的收益主要落在**还没行动的队友**身上，所以她在回合内必须先动。
 * 只收"给队友创造条件"的招，给自己上姿态的不算（那些是自用增益，不涉及顺序）。
 */
const SETUP_FIRST_SKILLS = new Set([
    'soul_lamp_skill1',  // 暗夜法阵：阵内友方暂死多攒共鸣，还能把灯当场点回来
    'feixue_skill2',     // 连枝：队友每次命中，绯雪追出一击
    'bounty_skill1',     // 猎杀令：队友打到目标，赏金追加追击
    'xubai_skill2',      // 黑白凝珠：队友开局残血时自动回血
    'nanfeng_skill2',    // 风道：队友的羽化/击退要顺着这条轴才吃得到
    'daizong_skill1',    // 镇守：先立起半区护持，后面的队友才有人替他挨打攒岳势
]);
/** 每有一个本回合还能出手、且此刻确有可用方案的队友，铺路者的排序分加这么多。 */
const SETUP_ORDER_VALUE_PER_ALLY = 18;
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
    easy: { decisionTolerance: 8, skillTolerance: 18, blunderChance: 0.3, jointMoveTopK: 0, exposureWeight: 0.3 },
    normal: { decisionTolerance: 4, skillTolerance: 9, blunderChance: 0.12, jointMoveTopK: 5, exposureWeight: 0.55 },
    master: { decisionTolerance: 2, skillTolerance: 5, blunderChance: 0, jointMoveTopK: 6, exposureWeight: 0.78 },
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
/**
 * 动态伤害技能的估伤表：这些技能没有固定的 baseDamage，
 * 不登记就会被 AI 当成 0 伤害而永远不选（"AI 不会用"会被误读成"英雄弱"）。
 * target 只有按目标生命算伤害的技能才用得上（夺岁、莫问那类），其余分支忽略它。
 */
function customSkillDamage(caster: Hero, skillId: string, position: Position, target?: Hero | null): number | null {
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
            return 7 + (caster.counters['亡灵共鸣'] ?? 0);
        case 'jetzmi_skill1':
            return caster.counters['jetzmi_form'] === 1
                ? (caster.counters['亡灵共鸣'] ?? 0)
                : 6 + (caster.counters['亡灵共鸣'] ?? 0);
        case 'pipa_skill2':
            return (caster.counters['和弦'] ?? 0) * 3;
        case 'bounty_skill2':
            return 8;
        case 'wangcai_skill1':
            return (caster.baseAttack ?? 0) * 3;
        case 'lilith_skill1':
            return 8;
        case 'youjun_skill1': {
            // 疾掠：按点击位置估算冲刺距离，伤害随冲刺距离与上回合移动距离攀升
            const distance = Math.min(
                5,
                MovementSystem.getManhattanDistance(caster.position!, position)
            );
            const lastMove = Math.min(6, caster.counters['youjun_lastMove'] ?? 0);
            return 5 * (1 + distance * 0.1) * (1 + lastMove * 0.1);
        }
        case 'youjun_skill2':
            return 4;
        // 御剑·贯阵：沿途与周圈两段伤害的均值粗估；昭神态数字更高
        case 'xuanyuan_skill1':
            return isZhaoShen(caster) ? 8 : 6;
        // 御剑·归元：只有周身斜角站人时才打得出伤害，按单把剑气估
        case 'xuanyuan_skill2':
            return 6;
        case 'jinghong_skill2':
            return 10;
        case 'huanongying_skill1':
            return 6;   // 花间辞扇形；影子的3点重演另算，不进威胁基线
        case 'huanongying_skill2':
            return 8;   // 弄影落点环斩
        case 'duosui_skill1': {
            // 斩岁砍的是目标"还活着的那部分"，血诏再按最大生命补一刀
            if (!target || target.state !== HeroState.ALIVE) return null;
            const reap = Math.max(1, Math.floor(target.currentHp * 0.5));
            const edict = caster.counters['__duosui_tianwei'] === 1
                ? Math.max(1, Math.floor(target.maxHp * zhizhiValue(caster, 2, 0.2, 0.3)))
                : 0;
            return reap + edict;
        }
        case 'duosui_skill2': {
            if (!target || target.state !== HeroState.ALIVE) return null;
            const missingRate = zhizhiValue(caster, 3, 0.25, 0.4);
            const missing = Math.max(0, target.maxHp - target.currentHp);
            const edict = caster.counters['__duosui_tianwei'] === 1
                ? Math.max(1, Math.floor(target.maxHp * zhizhiValue(caster, 2, 0.2, 0.3)))
                : 0;
            return 5 + Math.floor(missing * missingRate) + edict;
        }
        // 钓雪本身不打人：威胁来自"踩过就被抛到别处并吃10点"，所以按抛掷伤害估
        // 岳倾吐的就是攒下的岳势，池子多大伤害就是多大
        case 'daizong_skill1':
            return 0;
        case 'daizong_skill2':
            return mountainPressure(caster);
        // 唤龙那一下只打十字，真正的输出在每回合的盘旋里（走下面的站位加分）
        case 'aoyuan_skill1':
            return zhizhiValue(caster, 2, ORBIT_DAMAGE, ORBIT_DAMAGE_TALENT);
        // 布云当拍只劈一片，之后每回合还会挪一格再劈两次（价值走下面的专属静态计分）
        case 'yunxiu_skill1':
            return zhizhiValue(caster, 2, CLOUD_DAMAGE, CLOUD_DAMAGE_TALENT);
        case 'yunxiu_skill2':
            return ROD_DAMAGE;
        case 'aoyuan_skill2':
            return DASH_DAMAGE;
        case 'tingyuan_skill1':
            // 伤害写在 execute 里、劈中谁随机，按面板伤害估
            return zhizhiValue(caster, 2, TINGYUAN_HIT_DAMAGE, 12);
        case 'tingyuan_skill2':
            return TINGYUAN_HIT_DAMAGE;
        case 'jiangtaigong_skill1':
            return HOOK_THROW_DAMAGE;
        // 渭水垂竿不造成伤害，价值在拖拽、铺泽与"用技能也算一次出手"的鲸落档（走下面的专属静态计分）
        case 'jiangtaigong_skill2':
            return 0;
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
    成长: 5,
};

function ratingsForHeroId(heroId: string): HeroAbilityRatings {
    return getHeroAbilityRatings(getHeroInfo(heroId).name) ?? DEFAULT_RATINGS;
}

/**
 * 印月替身该换谁上场：印月按镜影层数放大攻防，所以优先最能打、最有成长的候补。
 * 模拟评估与真实执行共用这一个口径，否则会出现"评估按 A 算分、执行却派 B 登场"的错位。
 */
export function chooseJinghuaSummonTemplate(benchIds: string[]): string | null {
    if (benchIds.length === 0) return null;
    const valueOf = (templateId: string) => {
        const ratings = ratingsForHeroId(templateId);
        return ratings.输出 * 2 + ratings.成长;
    };
    return [...benchIds].sort((left, right) => valueOf(right) - valueOf(left))[0] ?? null;
}

/**
 * 水月换身该换谁：把她与一名深陷敌阵的队友对调（她落进险地、队友回到她的安全格）。
 * 她自己被围时不换——两个人一起挨打不如不换。至少贴着两名敌人才值得花掉一次行动。
 * 规划与真执行共用这一个口径：以前执行端条件不满足就直接 endHeroAction，
 * 而规划端照旧给这一手打分，实测每局"选中 32.77 次、真施法 0.78 次"，
 * 等于把她的整次行动白送给一个永远不会落地的方案。
 */
export function chooseJinghuaSwapTarget(state: GameState, caster: Hero): Position | null {
    if (!caster.position || caster.passiveId !== 'jinghua_passive') return null;
    // 威胁按棋盘实占算（分身、召唤物也算围住人），与执行端旧口径一致
    const foesAround = (position: Position) => {
        let count = 0;
        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) {
                const unit = state.board[row]?.[col];
                if (unit && unit.owner !== caster.owner && unit.state === HeroState.ALIVE &&
                    Math.abs(row - position[0]) + Math.abs(col - position[1]) <= 1) count++;
            }
        }
        return count;
    };
    if (foesAround([...caster.position] as Position) > 0) return null;

    let best: Position | null = null;
    let bestDanger = 1;
    for (const ally of heroesFor(state, caster.owner)) {
        if (ally.id === caster.id || ally.state !== HeroState.ALIVE || !ally.position || ally.id.includes('|')) continue;
        const danger = foesAround([...ally.position] as Position);
        if (danger > bestDanger) {
            bestDanger = danger;
            best = [...ally.position] as Position;
        }
    }
    return best;
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

/** 场上活着的分身数，与 store 的"最多 3 个分身"上限同口径。 */
const WUKONG_CLONE_LIMIT = 3;
/** 每个分身在这回合合击里还能各打一手，按"多一次出手"的底价折算成分。 */
const WUKONG_CLONE_STRIKE_VALUE = 26;
function countWukongClones(state: GameState, wukongId: string): number {
    let count = 0;
    for (const row of state.board) {
        for (const unit of row) {
            if (unit && unit.state === HeroState.ALIVE && isWukongCloneOf(unit, wukongId)) count++;
        }
    }
    return count;
}

/**
 * 大圣合击自带"先走到可达空格再打"：本体站在这些格子里任一格都算这一手能够着。
 * 只按脚下 3×3 判定的话，敌人一在外圈这技能就等于不存在，电脑于是整局只召唤分身从不合击。
 */
function wukongComboStandCells(state: GameState, caster: Hero): Position[] {
    if (!caster.position || caster.hasMovedThisTurn) return caster.position ? [caster.position] : [];
    return [
        caster.position,
        ...MovementSystem.getMovablePositions(caster, state).filter(cell => state.board[cell[0]]?.[cell[1]] === null),
    ];
}

function wukongComboReaches(state: GameState, caster: Hero, target: Position): boolean {
    return wukongComboStandCells(state, caster).some(cell =>
        Math.abs(cell[0] - target[0]) <= 1 && Math.abs(cell[1] - target[1]) <= 1);
}

const RECENT_HERO_USAGE_KEY = 'six-chess-ai-recent-hero-usage';
/** 跨局记忆保留的最近局数（每局 6 个英雄：四人首发加两人替补）。 */
const RECENT_HERO_USAGE_GAMES = 6;
/** 选将时对近期用过的英雄施加的减分（相对总分差约百级，18 分足以把熟面孔排到池外轮换）。 */
const RECENT_HERO_SCORE_PENALTY = 18;

/** 读取最近几局电脑用过的英雄（按局分组；localStorage 不可用时静默降级为无记忆）。 */
function loadRecentHeroUsageByGame(): string[][] {
    try {
        if (typeof window === 'undefined') return [];
        const raw = window.localStorage.getItem(RECENT_HERO_USAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        // 兼容旧版扁平格式：整体视为一段历史
        const games = parsed.every((item): item is string[] => Array.isArray(item))
            ? parsed
            : [parsed];
        return games
            .map(game => game.filter((id): id is string => typeof id === 'string'))
            .slice(-RECENT_HERO_USAGE_GAMES);
    } catch {
        return [];
    }
}

function saveRecentHeroUsage(team: string[]): void {
    try {
        if (typeof window === 'undefined') return;
        const games = loadRecentHeroUsageByGame();
        games.push(team);
        window.localStorage.setItem(
            RECENT_HERO_USAGE_KEY,
            JSON.stringify(games.slice(-RECENT_HERO_USAGE_GAMES))
        );
    } catch {
        // 忽略存储异常
    }
}

/** 久未出场补偿：每闲置一局加 8 分（封顶 32），保证冷门英雄最终也会被 AI 轮换选用。 */
const IDLE_ROTATION_BONUS_PER_GAME = 8;
const IDLE_ROTATION_BONUS_CAP = 32;

/**
 * 统计每个英雄距离上次出场的局数并折算补偿分：
 * 连续出场为 0 分（叠加近期减分形成强轮换压力），闲置越久补偿越高。
 */
function computeIdleRotationBonuses(games: string[][]): Map<string, number> {
    const bonuses = new Map<string, number>();
    for (const id of AVAILABLE_HERO_IDS) {
        let idleGames = games.length;
        for (let ago = 1; ago <= games.length; ago++) {
            if (games[games.length - ago].includes(id)) {
                idleGames = ago - 1;
                break;
            }
        }
        const bonus = Math.min(IDLE_ROTATION_BONUS_CAP, idleGames * IDLE_ROTATION_BONUS_PER_GAME);
        if (bonus > 0) bonuses.set(id, bonus);
    }
    return bonuses;
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
    recentHeroes: ReadonlySet<string>,
    idleBonuses?: ReadonlyMap<string, number>
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
        sum('成长') * 0.8;

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

    // 跨局多样性：最近几局用过的英雄减分，闲置越久的英雄补偿越高，
    // 两股力共同驱动 AI 的英雄池轮换，避免玩家每局都面对同一批角色。
    for (const id of team) {
        if (recentHeroes.has(id)) score -= RECENT_HERO_SCORE_PENALTY;
        score += idleBonuses?.get(id) ?? 0;
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

    const gamesHistory = loadRecentHeroUsageByGame();
    const recentHeroes = new Set(gamesHistory.flat());
    const idleBonuses = computeIdleRotationBonuses(gamesHistory);
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
                    candidates.push({ team, score: teamScore(team, opponentHeroIds, recentHeroes, idleBonuses) });
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
            teamScore([...picked.team, right], opponentHeroIds, recentHeroes, idleBonuses) -
            teamScore([...picked.team, left], opponentHeroIds, recentHeroes, idleBonuses))
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
/**
 * 某个单位接下来会挨多少打：能构得着她的敌人有几个、大概扣她几点生命。
 * 姿态型技能（墨阑「为道」、震霄「金银错」）的收益全押在这上面——
 * 减伤按被打到的量兑现、回击与额外出手按次数兑现，对面根本够不着时姿态一文不值。
 */
function incomingPressure(state: GameState, hero: Hero): { hits: number; damage: number } {
    if (!hero.position) return { hits: 0, damage: 0 };
    let hits = 0;
    let damage = 0;
    for (const enemy of enemiesFor(state, hero.owner)) {
        if (enemy.state !== HeroState.ALIVE || !enemy.position || EffectManager.isStunned(enemy)) continue;
        const distance = MovementSystem.getManhattanDistance(enemy.position, hero.position);
        const reach = maximumSkillReach(enemy) + (enemy.hasMovedThisTurn ? 0 : Math.max(0, enemy.moveRange));
        if (distance > reach) continue;
        const threat = estimateDamageAgainst(enemy, hero);
        if (threat <= 0) continue;
        // 已经行动过的敌人这轮打不到她，只算下回合的风险
        const weight = enemy.hasActedThisTurn ? 0.5 : 1;
        hits += weight;
        damage += threat * weight;
    }
    return { hits, damage };
}

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
            if (skill.id === 'zhiguang_skill2') {
                // 棱光千折走八向：斜线上一样打得着（折射与撞边能覆盖的格子太多，
                // 估威胁时只按"与她在一条直线/对角线上"算，不把整盘当成她的火力圈）
                const rowGap = Math.abs(casterPosition[0] - position[0]);
                const colGap = Math.abs(casterPosition[1] - position[1]);
                return rowGap === colGap || casterPosition[0] === position[0] || casterPosition[1] === position[1];
            }
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
            const custom = customSkillDamage(attacker, skill.id, position, defender);
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
    if (skill.id === 'dai_skill2' && (hero.counters['dai_skill2_cd'] ?? 0) > 0) return true;
    // 惊鸿·止水「止水决渊」：既没在蓄力也攒不出惊鸿时，这一手无事可做，别白占一次出手
    if (skill.id === 'jinghong_skill2') {
        return (hero.counters['jinghong_charge_round'] ?? -1) < 0
            && (hero.counters['惊鸿'] ?? 0) < 1;
    }
    return false;
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
            const custom = customSkillDamage(attacker, skill.id, target.position ?? [0, 0], target);
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

/**
 * 让 ally 本回合多出手一次的价值：再动者输出能力越强、且它本回合已经行动过（多出来的是纯赚的一次），
 * 价值越高。用于给玄霄「惊鸿再舞」这类只加出手次数、不留任何棋盘痕迹的技能计分。
 */
function extraActionValue(ally: Hero): number {
    // 一次再动约等于"这个人再打一发最能打的手"，按输出档折算而不是给个固定小额；
    // 原值（9 + 输出×1.5）连"移动一步去贴身"的门槛都过不了，实测玄霄 S1:S2 = 4.0:0.2。
    const base = EXTRA_ACTION_BASE + ratingsForHero(ally).输出 * EXTRA_ACTION_PER_OUTPUT_RATING;
    return ally.hasActedThisTurn ? base : base * EXTRA_ACTION_PRE_ACTED_FACTOR;
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

    if (
        skill.id === 'dilan_skill1' || skill.id === 'dilan_skill2'
        || skill.id === 'zuizhendao_skill1' || skill.id === 'yunying_skill2'
        || skill.id === 'huanongying_skill1'
    ) {
        return MovementSystem.getCrossPositions(caster.position).map(position => [position]);
    }

    // 折光「棱光千折」：周身八格都是方向标（含斜向），每个方向各成一个方案
    if (skill.id === 'zhiguang_skill2') {
        const [row, col] = caster.position;
        return ZHIGUANG_DIRECTION_DELTAS
            .map(([dr, dc]) => [row + dr, col + dc] as Position)
            .filter(position => MovementSystem.inBounds(position))
            .map(position => [position]);
    }

    // 花弄影「弄影」：点影子所在格与身互换；场上无影或影格被人占住时这一手不存在
    // （execute 会当场拒绝，方案集必须提前拦下，否则 AI 会反复重试必败施法）
    if (skill.id === 'huanongying_skill2') {
        const shadow = findHnyShadow(state, caster.owner);
        if (!shadow || state.board[shadow.position[0]][shadow.position[1]] !== null) return [];
        return [[[shadow.position[0], shadow.position[1]]] as Position[]];
    }

    // 镜花「水月换身」：换不动就不产方案。以前执行端条件不满足时直接结束行动，
    // 而规划端照旧给这一手打分，于是 AI 每局选中 32.77 次、真施法只有 0.78 次——
    // 整次行动被一个注定落空的方案白吃掉。
    if (skill.id === 'jinghua_skill1') {
        // 本回合已经"选了却换不动"过一次：这一轮别再给她这个方案，否则退回走位后会重新选中，
        // 反复靠步进器的重复计数兜底才结束行动
        if (caster.counters['__ai_jinghua_swap_aborted'] === state.roundNumber) return [];
        const swap = chooseJinghuaSwapTarget(state, caster);
        return swap ? [[swap]] : [];
    }

    // 大圣合击：本体可以先走到可达空格再打，所以候选目标是"走一步之后够得着的敌人"，
    // 不是"脚下 3×3 里的敌人"。差这一步时电脑只会退回召唤分身，整局不进攻。
    if (skill.id === 'wukong_skill2' && !caster.hasMovedThisTurn) {
        return enemiesFor(state, caster.owner)
            .filter(enemy => enemy.state === HeroState.ALIVE && enemy.position &&
                wukongComboReaches(state, caster, enemy.position!))
            .map(enemy => [enemy.position!] as Position[]);
    }

    // 南风引风成道：两步点击（先定风向，再点行/列），枚举 4 个方向 × 该轴上 6 条线
    if (skill.id === 'nanfeng_skill2') {
        // 第一步已点过方向格时，风向锁定为该方向，第二步只枚举同一轴上的 6 条线，
        // 否则两次独立规划可能选出不同轴向，导致点击的行列与已选风向不匹配。
        const lockedDirection = windLaneDirectionFromCode(caster.counters['__nanfeng_skill2_dir']);
        const sets: Position[][] = [];
        for (const dirPosition of MovementSystem.getCrossPositions(caster.position)) {
            const direction = MovementSystem.getDirection(caster.position, dirPosition);
            if (!direction) continue;
            if (lockedDirection && direction !== lockedDirection) continue;
            const axis = windLaneAxis(direction);
            for (let index = 0; index < BOARD_SIZE; index++) {
                const lineCell: Position = axis === 'row'
                    ? [index, caster.position[1]]
                    : [caster.position[0], index];
                sets.push([dirPosition, lineCell]);
            }
        }
        return sets;
    }

    // 时空旅者·戴尔技能1「时空回溯」唤回分支：两段式（先锚定时空停滞单位，再点复活落点），
    // 因此这里枚举的是"落点"——全盘任意空格；锚定对象由 chooseComputerStasisReviveTarget 选定。
    // 替补制编制上限：场上真实存活已满4人时唤回必然被技能校验拒绝，
    // 不生成该分支（否则 AI 会反复执行必然失败的复活计划，形成决策死循环）。
    if (skill.id === 'dai_skill1') {
        const stalled = stasisRevivableHeroes(state, caster.owner);
        if (stalled.length > 0 && GameEngine.countRealAliveOnBoard(state, caster.owner) < 4) {
            const landings: Position[][] = [];
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    if (state.board[row][col] === null) landings.push([[row, col]]);
                }
            }
            // 唤回与"回溯存活单位"是二选一，两类方案都进评分，谁收益高用谁
            const rewind = SkillSystem.getValidTargetPositions(caster, skill, state)
                .filter(isBoardPosition)
                .map(position => [position]);
            return [...landings, ...rewind];
        }
    }

    // 凋零之主技能1：只枚举真正罩得住敌人的 2x2 区域（左上角 + 右下角那一对角即为该区域）
    // 旧版把全盘 50 对角对按"离敌人最近"排序取前 24，一格敌人都罩不到的区域也在候选里，
    // 于是电脑会端出一个注定落空的方案。
    if (skill.id === 'wither_lord_skill1') {
        const enemies = enemiesFor(state, caster.owner)
            .filter(enemy => enemy.state === HeroState.ALIVE && enemy.position);
        if (enemies.length === 0) return [];
        const sets: Position[][] = [];
        for (let row = 0; row < BOARD_SIZE - 1; row++) {
            for (let col = 0; col < BOARD_SIZE - 1; col++) {
                const coversEnemy = enemies.some(enemy =>
                    enemy.position![0] >= row && enemy.position![0] <= row + 1 &&
                    enemy.position![1] >= col && enemy.position![1] <= col + 1
                );
                if (coversEnemy) sets.push([[row, col], [row + 1, col + 1]]);
            }
        }
        return sets;
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

    let valid = SkillSystem.getValidTargetPositions(caster, skill, state).filter(isBoardPosition);
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
    // 镜花·印月替身：登场谁由"技能栏选候补"这一步决定（人类点，AI 自己写计数器）。
    // 模拟里不补这一笔，execute 会当场以"请先在技能栏选择一名候补友方"失败，
    // 于是这个技能在 AI 眼里连分数都拿不到——候选存在但全部被拒，看起来就是"从不使用"。
    if (skill.id === 'jinghua_skill2') {
        const bench = (caster.owner === 'player1'
            ? state.player1BenchHeroIds
            : state.player2BenchHeroIds) ?? [];
        const pick = chooseJinghuaSummonTemplate(bench);
        if (pick) caster.counters['__jinghua_summon_pick'] = bench.indexOf(pick);
    }
    if ((skill.id === 'dilan_skill1' || skill.id === 'dilan_skill2') && caster.position) {
        const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
        const dirCode = direction === 'up' ? 0 : direction === 'down' ? 1 : direction === 'left' ? 2 : 3;
        if (skill.id === 'dilan_skill1') {
            caster.counters['__dilan_skill1_dir'] = dirCode;
        } else {
            caster.counters['__dilan_skill2_dir'] = dirCode;
        }
    }
    if (skill.id === 'zuizhendao_skill1' && caster.position) {
        const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
        caster.counters['__zuizhendao_skill1_dir'] =
            direction === 'up' ? 0 : direction === 'down' ? 1 : direction === 'left' ? 2 : 3;
    }
    if (skill.id === 'huanongying_skill1' && caster.position) {
        const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
        caster.counters['__hny_dir'] =
            direction === 'up' ? 0 : direction === 'down' ? 1 : direction === 'left' ? 2 : 3;
    }
    if (skill.id === 'yunying_skill2' && caster.position) {
        // 点相邻方向格即释放：把方向换算成技能结算读取的 0-3 编码
        const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
        caster.counters['__yunying_skill2_dir'] =
            direction === 'up' ? 0 : direction === 'down' ? 1 : direction === 'left' ? 2 : 3;
    }
    if (skill.id === 'zhiguang_skill2' && caster.position) {
        // 八向光束：点到的方向格换算成技能结算读取的 0-7 编码（与 ZHIGUANG_DIRECTION_DELTAS 同序）
        const [dr, dc] = [
            Math.sign(targetPositions[0][0] - caster.position[0]),
            Math.sign(targetPositions[0][1] - caster.position[1]),
        ];
        const dirCode = ZHIGUANG_DIRECTION_DELTAS.findIndex(
            ([sr, sc]) => sr === dr && sc === dc
        );
        if (dirCode >= 0) caster.counters['__zhiguang_skill2_dir'] = dirCode;
    }
    if (skill.id === 'nanfeng_skill2' && caster.position && targetPositions.length >= 2) {
        // 两步点击：第一步的风向格换算成编码，供技能结算读取
        const direction = MovementSystem.getDirection(caster.position, targetPositions[0]);
        caster.counters['__nanfeng_skill2_dir'] =
            direction === 'up' ? 0 : direction === 'down' ? 1 : direction === 'left' ? 2 : 3;
    }
    if (skill.id === 'baize_skill2') {
        const dead = heroesFor(state, caster.owner)
            .filter(hero => hero.state === HeroState.DEAD)
            .sort((left, right) => heroBoardValue(right) - heroBoardValue(left));
        state.baizeReviveTargetHeroId = dead[0]?.id;
    }
    if (skill.id === 'dai_skill1') {
        // 两段式唤回：落点是空格才说明这条方案评的是"唤回时空停滞单位"。
        // 锚定对象与真执行共用 chooseComputerStasisReviveTarget，避免评分锚 A、点击锚 B。
        const landing = targetPositions[0];
        if (landing && isBoardPosition(landing) && state.board[landing[0]][landing[1]] === null) {
            state.daiReviveHeroId = chooseComputerStasisReviveTarget(state, caster.owner)?.id;
        }
    }
    if (skill.id === 'jetzmi_skill2') {
        const dead = heroesFor(state, caster.owner)
            .filter(hero => hero.state === HeroState.TEMP_DEAD)
            .sort((left, right) => ratingsForHero(right).输出 - ratingsForHero(left).输出);
        if (dead[0]) {
            state.skillSelectedHeroIds = { ...(state.skillSelectedHeroIds ?? {}), [caster.id]: dead[0].id };
        }
    }
}

function skillTypeBias(skill: Skill): number {
    // 伤害技拿到最高的类型加分：分数接近时 AI 优先选择进攻；
    // 其余类型仍保有各自的加分，功能技在收益真实时照样会被选用。
    switch (skill.type) {
        case 'damage': return 12;
        case 'control': return 11;
        case 'summon': return 11;
        case 'debuff': return 8;
        case 'buff': return 7;
        case 'heal': return 5;
        default: return 4;
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

        if (skill.id === 'jinghua_skill2') {
            // 退坐月座的门槛放在规划阶段：镜影没攒够又没残血时不值得下场，
            // 候补席空着则根本没人可换。留到执行阶段才拒，AI 会选中一个必然空转的方案
            // 然后什么也不做地结束行动。
            const bench = (caster.owner === 'player1'
                ? state.player1BenchHeroIds
                : state.player2BenchHeroIds) ?? [];
            const stacks = Math.min(5, caster.counters['镜影'] ?? 0);
            if (bench.length === 0
                || (state.battleStatistics?.[caster.id]?.skill2Casts ?? 0) >= JINGHUA_SEAT_MAX_USES
                || (stacks < 2 && caster.currentHp > caster.maxHp * 0.55)) return null;
        }

        if (skill.id === 'wukong_skill1') {
            const [row, col] = targetPositions[0] ?? [-1, -1];
            if (!isBoardPosition([row, col]) || simulated.board[row][col] !== null) return null;
            // 场上已有 3 个分身时 store 会当场拒绝（"分身数量已达上限"，且不消耗行动）。
            // 模拟里不拦的话，这个固定 24 分的方案会把真正能打死人的合击比下去，
            // 电脑于是每回合都试图召唤第四个分身。
            if (countWukongClones(simulated, simulatedCaster.id) >= WUKONG_CLONE_LIMIT) return null;
            const enemyDistance = enemiesFor(simulated, simulatedCaster.owner)
                .filter(enemy => enemy.position)
                .reduce((best, enemy) => Math.min(best, MovementSystem.getManhattanDistance([row, col], enemy.position!)), 10);
            return { skillId: skill.id, targetPositions, score: 24 - enemyDistance * 1.5 };
        }

        if (skill.id === 'wukong_skill2' && simulatedCaster.position) {
            // 合击自带"先走到可达空格再打"，这一步不是普通移动，不能记进 hasMovedThisTurn，
            // 否则联合规划里它永远被"已经移动过"的门槛踢掉，电脑就只能原地站着或改放分身。
            const target = targetPositions[0];
            const reachable = target
                ? wukongComboStandCells(simulated, simulatedCaster)
                    .find(cell => Math.abs(cell[0] - target[0]) <= 1 && Math.abs(cell[1] - target[1]) <= 1)
                : undefined;
            if (!target || !reachable) return null;
            const from = simulatedCaster.position;
            if (from[0] !== reachable[0] || from[1] !== reachable[1]) {
                simulated.board[from[0]][from[1]] = null;
                simulated.board[reachable[0]][reachable[1]] = simulatedCaster;
                simulatedCaster.position = reachable;
            }
        }

        if (skill.id === 'hanjiangxue_skill2') {
            // 冰晶封路：放在敌方阵型附近封锁走位并生成冰甲点，距离越近价值越高
            const [row, col] = targetPositions[0] ?? [-1, -1];
            if (!isBoardPosition([row, col]) || simulated.board[row][col] !== null) return null;
            // 已有冰晶的格子会被技能结算直接拒绝（施法失败不消耗行动），
            // 若这里不当无效方案处理，AI 会每步重复同一个必败落点，对局原地空转
            if (simulated.boardEffects?.some(effect =>
                effect.type === 'ice-crystal' && effect.position[0] === row && effect.position[1] === col
            )) return null;
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

        if (skill.id === 'nanfeng_skill2') {
            // 风道是常驻场地效果，不产生即时伤害，无法靠棋盘分差体现价值，因此静态计分
            const direction = windLaneDirectionFromCode(simulatedCaster.counters['__nanfeng_skill2_dir']);
            if (!direction) return null;
            const lineCell = targetPositions[targetPositions.length - 1];
            const cells = windLaneCells(direction, lineCell);
            let enemiesIn = 0;
            let alliesIn = 0;
            for (const [row, col] of cells) {
                const occupant = simulated.board[row][col];
                if (!occupant || occupant.state !== HeroState.ALIVE) continue;
                if (occupant.owner === simulatedCaster.owner) alliesIn++;
                else enemiesIn++;
            }
            const coversCaster = !!simulatedCaster.position && cells.some(([row, col]) =>
                row === simulatedCaster.position![0] && col === simulatedCaster.position![1]);
            if (enemiesIn === 0 && alliesIn === 0 && !coversCaster) return null;
            return {
                skillId: skill.id,
                targetPositions,
                score: 10 + enemiesIn * 6 + alliesIn * 2 + (coversCaster ? 4 : 0),
            };
        }

        if (skill.id === 'daizong_skill1') {
            // 镇守不当场改变棋盘，默认模拟拿不到分数——不静态记账，AI 会把它当废牌（布场型技能的老坑）。
            // 值 = 这一侧护得住的队友 × 对面真能出手的敌人：两边都对得上的那一侧才值得摆。
            const cell = targetPositions[targetPositions.length - 1];
            const origin = simulatedCaster.position;
            if (!cell || !origin || !isBoardPosition(cell)) return null;
            const direction = directionFromCell(origin, cell);
            if (direction === null) return null;
            if (stanceDirection(simulatedCaster) === direction) return null;   // 已经朝这边摆着，重放没有收益
            const guarded = heroesFor(simulated, simulatedCaster.owner).filter(hero =>
                hero.state === HeroState.ALIVE && !!hero.position && hero.id !== simulatedCaster.id &&
                guardsCell(simulatedCaster, direction, hero.position!)).length;
            const incoming = enemiesFor(simulated, simulatedCaster.owner).filter(enemy =>
                enemy.state === HeroState.ALIVE && !!enemy.position && !enemy.hasActedThisTurn &&
                threatensFrom(simulatedCaster, direction, enemy.position!)).length;
            if (guarded === 0 || incoming === 0) return null;   // 一侧没人或对面够不着，摆它做什么
            const stored = (simulatedCaster.counters[MOUNTAIN_COUNTER] ?? 0) as number;
            return {
                skillId: skill.id,
                targetPositions,
                score: 5 + guarded * 4 + incoming * 3 + Math.min(10, stored * 0.2),
            };
        }

        if (skill.id === 'tingyuan_skill1') {
            // 落雷真的会打痛人，分数交给默认模拟；这里只拦"染无可染"的白放：
            // 全场都带着没散的印与链时再劈一次只是刷新，该留手给技能二收口。
            const enemies = enemiesFor(simulated, simulatedCaster.owner).filter(enemy => enemy.state === HeroState.ALIVE);
            if (enemies.length === 0) return null;
            const unwritten = enemies.filter(enemy => !hasThunderMark(enemy, simulatedCaster.id)).length;
            const unlinked = enemies.filter(enemy =>
                hasThunderMark(enemy, simulatedCaster.id) && !hasChainMark(enemy, simulatedCaster.id)).length;
            if (unwritten === 0 && unlinked === 0) return null;
        }

        if (skill.id === 'jiangtaigong_skill1') {
            // 下钩不产生即时伤害，价值全在"敌人会不会走过这一格"，所以静态计分：
            // 越贴近还没移动过的敌人越可能踩到；那一格站了人或已有钩子都是非法落点。
            const cell = targetPositions[targetPositions.length - 1];
            if (!cell || !isBoardPosition(cell) || simulated.board[cell[0]][cell[1]] !== null) return null;
            if (simulated.boardEffects?.some(effect =>
                effect.type === 'fish-hook' && effect.position[0] === cell[0] && effect.position[1] === cell[1])) return null;
            const nearby = enemiesFor(simulated, simulatedCaster.owner).filter(enemy =>
                enemy.position &&
                Math.max(Math.abs(enemy.position[0] - cell[0]), Math.abs(enemy.position[1] - cell[1])) <= 2);
            if (nearby.length === 0) return null;    // 没人路过就别白放这一手
            const waiting = nearby.filter(enemy => !enemy.hasMovedThisTurn).length;
            // 场上已经挂满三枚时再多下一枚是浪费（新钩会挤掉旧钩），收益要压过"这一手不如打人"
            const live = (simulated.boardEffects ?? []).filter(effect =>
                effect.type === 'fish-hook' && effect.sourceHeroId === simulatedCaster.id).length;
            // 用技能本身就是一次出手：他站在水泽里时，概率已经攒得越高，这一竿越值得放
            const whaleUpside = simulatedCaster.position &&
                ownMarshLayersAt(simulated, simulatedCaster.owner, simulatedCaster.position) > 0
                ? whaleFallRate(simulatedCaster) * 6
                : 0;
            // 下钩当场会铺一片 3×3 水泽：罩住的队友越多越值（我方在其中吃闪避）
            const shielded = heroesFor(simulated, simulatedCaster.owner).filter(hero =>
                hero.id !== simulatedCaster.id && hero.state === HeroState.ALIVE && hero.position &&
                Math.max(Math.abs(hero.position[0] - cell[0]), Math.abs(hero.position[1] - cell[1])) <= 1).length;
            return {
                skillId: skill.id,
                targetPositions,
                score: 4 + waiting * 5 + nearby.length * 1.5 + shielded * 2 - Math.max(0, live - 1) * 4 + whaleUpside,
            };
        }

        if (skill.id === 'yunxiu_skill1') {
            // 云是"这一拍压住谁、下一拍还压谁"的场地，不是即时伤害：
            // 通用模拟只看得到点中的那一格有没有人，会把她当成只会挠一下的近战。
            const cell = targetPositions[targetPositions.length - 1];
            if (!cell || !isBoardPosition(cell)) return null;
            const owner = simulatedCaster.owner;
            const now = cloudVictimCountAt(simulated, owner, cell);
            // 云每回合自己挪一格：把"挪一步之后最狠的那一格"也算进账，
            // 不然电脑永远只往人堆正中放，而人堆会散
            const drift = CLOUD_DRIFT_OFFSETS.reduce((max, [dr, dc]) => Math.max(
                max,
                cloudVictimCountAt(simulated, owner, [cell[0] + dr, cell[1] + dc] as Position)
            ), 0);
            if (now === 0 && drift === 0) return null;   // 前后两拍都压不到人，这一手就是白放
            // 已有云数接近上限时，多铺一团会把最早那团挤掉——只补"值回票价"的那一团
            const live = cloudsOf(simulated, owner).length;
            const overlap = cloudsOf(simulated, owner).filter(cloud =>
                Math.abs(cloud.position[0] - cell[0]) <= CLOUD_RADIUS &&
                Math.abs(cloud.position[1] - cell[1]) <= CLOUD_RADIUS).length;
            return {
                skillId: skill.id,
                targetPositions,
                // 定价按"这一团云这辈子还能落几拍雷"算，不是按当拍那一下：
                // 4 点 × 最多 3 拍 × 现在与挪一格后各自罩住的人数。
                // 原来只给 5 + now*5，实测局均被枚举 49.75 次却只采纳 5.17 次——
                // 分数打不过她自己的技能二（平均 36.6），电脑等于把她当只会戳一下的近战用。
                score: 14 + now * 9 + drift * 5.5
                    - Math.max(0, live - (CLOUD_MAX - 1)) * 4
                    - overlap * 6,
            };
        }

        if (skill.id === 'jiangtaigong_skill2') {
            const cell = targetPositions[targetPositions.length - 1];
            if (!cell || !simulatedCaster.position) return null;
            const victim = isBoardPosition(cell) ? simulated.board[cell[0]][cell[1]] : null;
            if (!victim || victim.owner === simulatedCaster.owner || victim.state !== HeroState.ALIVE) return null;
            // 拖拽途中压过自己埋的鱼钩＝当场钩住、还能再甩一刀，是这一手最值钱的情况
            const bites = hooksAlongLine(simulated, victim.position!, simulatedCaster.position, simulatedCaster.owner);
            const marsh = ownMarshLayersAt(simulated, simulatedCaster.owner, simulatedCaster.position);
            // 真能拖几格：被自己人挡住就一步都动不了，这一手只剩铺泽，价值差很多
            const stepRow = Math.sign(simulatedCaster.position[0] - cell[0]);
            const stepCol = Math.sign(simulatedCaster.position[1] - cell[1]);
            let pulled = 0;
            for (let depth = 1; depth <= BOARD_SIZE; depth++) {
                const next: Position = [cell[0] + stepRow * depth, cell[1] + stepCol * depth];
                if (next[0] === simulatedCaster.position[0] && next[1] === simulatedCaster.position[1]) break;
                if (next[0] < 0 || next[0] >= BOARD_SIZE || next[1] < 0 || next[1] >= BOARD_SIZE) break;
                if (simulated.board[next[0]][next[1]]) break;
                pulled++;
            }
            return {
                skillId: skill.id,
                targetPositions,
                // 这一手还会在姜太公脚下补一片水泽：他自己站进去才掷得动「鲸落」，
                // 所以泽越薄越值得放——不给这一份，电脑会一路只下钩不拖人，被动形同虚设
                score: (pulled > 0 ? 10 : 3) + bites * 16 + (marsh === 0 ? 10 : marsh * 2) +
                    ratingsForHero(victim).输出 * 0.9,
            };
        }

        // 戴尔「时空回溯」唤回：复活由 store 侧结算（落点是空格，棋盘上没有目标单位），
        // 引擎技能执行无法模拟它，因此这里直接走同一条引擎函数，按棋盘分差计分。
        if (skill.id === 'dai_skill1' && simulated.daiReviveHeroId) {
            const stalled = findHero(simulated, simulated.daiReviveHeroId);
            const landing = targetPositions[0];
            if (!stalled || !landing || !GameEngine.reviveFromStasis(stalled, landing, simulated)) return null;
            return {
                skillId: skill.id,
                targetPositions,
                score: evaluateComputerBoard(simulated, caster.owner) - beforeScore,
            };
        }

        // 克隆盘上的假想施法不许留下特效与音效：队列是模块级全局，不随克隆盘一起丢弃
        const result = runWithoutSkillFx(() =>
            SkillSystem.executeSkill(simulatedCaster, skill, targetPositions, simulated));
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
        // Value charging the next half of the attack/heal loop, while respecting overwritten reserves.
        const moonValue = caster.passiveId === 'wangshu_passive' && simulatedCaster.state === HeroState.ALIVE
            ? Math.max(-12, Math.min(18,
                (getWangshuPhase(simulatedCaster) - getWangshuPhase(caster)) * 4 + .18 * (
                    ((simulatedCaster.counters['朔'] ?? 0) + (simulatedCaster.counters['望'] ?? 0)) * getWangshuMultiplier(simulatedCaster)
                    - ((caster.counters['朔'] ?? 0) + (caster.counters['望'] ?? 0)) * getWangshuMultiplier(caster))))
            : 0;
        const meaningfulResult = Math.abs(afterScore - beforeScore) > 0.25 || damage > 0 || healing > 0 || effectValue > 0 || moonValue > .25;
        const lastSkillIndex = caster.counters['__ai_last_skill_index'];
        const skillIndex = caster.skill1Id === skill.id ? 0 : 1;
        // 天威联动：拥有"击杀敌人后立即再动"天威的英雄，每次击杀还能白赚一轮行动
        const tianweiBonus = kills > 0 && simulatedCaster.tianweiId ? kills * TIANWEI_KILL_BONUS : 0;
        // 悟空技能2：召唤的分身每个都能再打一轮，场上分身越多价值越高
        const cloneBonus = skill.id === 'wukong_skill2'
            ? countWukongClones(simulated, caster.id) * WUKONG_CLONE_STRIKE_VALUE
            : 0;
        // 游隼疾掠是「位移 + 穿透」：只有真穿到人，这段接敌距离才是这一击的一部分。
        // 早期版本无条件按距离发分，结果 AI 专门挑没人的直线空冲（10 局实测 61 次疾掠
        // 只有 34 次咬到人，其中 24 次空冲是 2 格以上的直线），把冲刺当成了免费位移。
        // 现在空冲不加分，但收回风刃是冲刺的真实收益（每回合首次收回会刷新疾掠），单独计。
        const piercedByDash = skill.id === 'youjun_skill1' ? (result.damageDealt?.length ?? 0) : 0;
        const dashBonus = skill.id === 'youjun_skill1' && caster.position && targetPositions[0]
            ? piercedByDash > 0
                ? piercedByDash * AGGRESSION.piercePerEnemy
                    + MovementSystem.getManhattanDistance(caster.position, targetPositions[0]) * AGGRESSION.dashPerCell
                : 0
            : 0;
        const bladesBeforeDash = skill.id === 'youjun_skill1'
            ? (state.boardEffects ?? []).filter(effect =>
                effect.type === 'wind-blade' && effect.sourceHeroId === caster.id).length
            : 0;
        const retractedBlades = skill.id === 'youjun_skill1'
            ? Math.max(0, bladesBeforeDash - (simulated.boardEffects ?? []).filter(effect =>
                effect.type === 'wind-blade' && effect.sourceHeroId === caster.id).length)
            : 0;
        const bladeRefreshBonus = retractedBlades > 0 ? WIND_BLADE_RETRACT_VALUE : 0;
        // 既没穿到人、也没收回风刃的疾掠就是"把一次冲锋当成免费位移"：
        // 这种方案直接不生成，让 AI 用普通移动去走位，把疾掠留给真正能咬人的直线。
        if (skill.id === 'youjun_skill1' && piercedByDash === 0 && retractedBlades === 0) return null;
        // 游隼四向风刃是布场：每道留下的风刃都会持续逼敌人走位、可被收回刷新疾掠，
        // 给一点正分，避免它永远是 0 分而被施法闸门挡掉。
        const bladeBonus = skill.id === 'youjun_skill2'
            ? (simulated.boardEffects ?? []).filter(effect =>
                effect.type === 'wind-blade' && effect.sourceHeroId === caster.id
              ).length * 3
            : 0;
        // 轩辕神君「御剑·归元」：每把回收/附着的飞剑折成 10% 免伤，是实打实的生存收益；
        // 不计分的话它经常 0 伤而被施法闸门拦下，飞剑铺满地也永远不会收。
        let swordBonus = 0;
        if (skill.id === 'xuanyuan_skill2' && result.success) {
            const teamMitigation = (snapshot: GameState) =>
                (snapshot.player1Heroes.concat(snapshot.player2Heroes))
                    .filter(hero => hero.owner === caster.owner)
                    .reduce((sum, hero) => sum + (hero.effects.find(effect =>
                        effect.name === '御剑免伤')?.value ?? 0), 0);
            swordBonus = Math.max(0, teamMitigation(simulated) - teamMitigation(state)) * 40;
        }
        // 花弄影的「重演」在行动末才结算，execute 返回值里一分不显：从模拟盘面读回
        // 影子与招式记忆，把影子的补刀计入本次施法收益；影格本身还是下一手「弄影」
        // 的进场板，围着影子站几个敌人另外计分，否则 AI 只会把影子甩到无人区。
        let replayBonus = 0;
        if (simulatedCaster.passiveId === 'huanongying_passive') {
            const shadow = findHnyShadow(simulated, simulatedCaster.owner);
            const lastAttack = simulatedCaster.counters['__hny_last_attack'] ?? 0;
            if (shadow && lastAttack > 0) {
                const form = getHnyReplayForm(
                    shadow.position, lastAttack, simulatedCaster.counters['__hny_last_dir'] ?? -1);
                const isFoe = (row: number, col: number) => {
                    const unit = simulated.board[row]?.[col];
                    return !!unit && unit.owner !== simulatedCaster.owner && unit.state === HeroState.ALIVE;
                };
                const replayHits = form.cells.filter(([row, col]) => isFoe(row, col)).length;
                const [shadowRow, shadowCol] = shadow.position;
                const entryThreat = [[-1, 0], [1, 0], [0, -1], [0, 1]]
                    .filter(([dr, dc]) => isFoe(shadowRow + dr, shadowCol + dc)).length;
                replayBonus = replayHits * form.damage * AGGRESSION.damageWeight + entryThreat * 2.5;
            }
        }
        // 惊鸿是「决渊」的弹药，攒层本身就是收益；蓄力则是拿下一回合的移动权换
        // 一圈大斩的投资——5×5 外环够得着的范围内没人就判负分，免得 AI 原地空转蓄力。
        let jinghongBonus = 0;
        if (simulatedCaster.passiveId === 'jinghong_passive' && result.success) {
            if (skill.id === 'jinghong_skill1') {
                const gained = (simulatedCaster.counters['惊鸿'] ?? 0) - (caster.counters['惊鸿'] ?? 0);
                jinghongBonus = Math.max(0, gained) * 4;
            } else if (skill.id === 'jinghong_skill2' &&
                simulatedCaster.counters['jinghong_charge_round'] === simulated.roundNumber) {
                // 蓄力用「下一回合不能移动」换一圈 5×5 外环大斩：外环此刻够不着任何人
                // 就是白站一回合，直接不生成该方案（AI 想蓄力得先把自己送到人旁边）
                const ringReach = enemiesFor(state, caster.owner).filter(enemy =>
                    enemy.state === HeroState.ALIVE && enemy.position && caster.position &&
                    Math.max(Math.abs(enemy.position[0] - caster.position[0]),
                        Math.abs(enemy.position[1] - caster.position[1])) <= 2
                ).length;
                if (ringReach === 0) return null;
                const spent = Math.max(0,
                    (caster.counters['惊鸿'] ?? 0) - (simulatedCaster.counters['惊鸿'] ?? 0));
                jinghongBonus = 6 + spent * 3;
            }
        }
        // 亡灵体系是"拿自己人暂时阵亡换资源"的代价型打法，而单步模拟只看得见队友消失：
        // heroBoardValue 把暂死记成 16 分（存活单位约 180 分），于是缚魂灯两个技能
        // 稳定 -125 / -262，永远过不了 `score > 0` 的出手闸门，AI 直接把它当步兵用。
        // 它换到的东西（共鸣、法阵、带治疗的回归）全在账外，这里补记。
        let deathFuelBonus = 0;
        if (DEATH_FUEL_SKILLS.has(skill.id)) {
            const beforeById = new Map(allHeroes(state).map(hero => [hero.id, hero]));
            // 队里还有人能把暂死的队友拉回来（骸骨君王唤回 / 杰茨米汲取），暂死就只是"缺席一回合"
            const hasReviver = allHeroes(simulated).some(hero => hero.owner === caster.owner
                && hero.state === HeroState.ALIVE && !hero.id.includes('|')
                && (TEMP_DEAD_REVIVER_SKILLS.has(hero.skill1Id) || TEMP_DEAD_REVIVER_SKILLS.has(hero.skill2Id)));
            for (const hero of allHeroes(simulated)) {
                if (hero.owner !== caster.owner || hero.id.includes('|')) continue;
                const was = beforeById.get(hero.id);
                if (!was || was.state !== HeroState.ALIVE || hero.state !== HeroState.TEMP_DEAD) continue;
                // 暂时阵亡占着编制、不算真死，能被魂灯排程、法阵联动或队友唤回，所以代价不是
                // "少一个人"（heroBoardValue 从 ~180 掉到 16），而是"少动一次手"。
                // 只有完全没有任何回归途径时，才按整段塌陷扣。
                const cliff = Math.max(0, heroBoardValue(was) - heroBoardValue(hero));
                const scheduled = (hero.counters['soul_lamp_revive_round'] ?? Infinity) <= simulated.roundNumber + 1;
                const coveredByCircle = !!hero.position && (simulated.boardEffects ?? []).some(effect =>
                    effect.type === 'dark-circle' && effect.owner === caster.owner &&
                    effect.sourceHeroId !== hero.id &&
                    Math.abs(effect.position[0] - hero.position![0]) <= 1 &&
                    Math.abs(effect.position[1] - hero.position![1]) <= 1
                );
                // 镜花印月替身：换上来一个满血队友、下去的是她自己，这笔"以人换人"
                // 棋盘分差已经算平了。这里补两块分差看不见的账，并扣掉一块：
                //   + 月座保证她必然归来（半血、最多缺席三回合）
                //   + 印月按镜影层数放大登场替身的攻防
                //   − 把月座兑现还得**再花掉一名队友的一整次行动**走上去接她
                // 不扣这一笔，AI 会把它当无限次免费换人（实测每局退坐 4.4 次）。
                const seatGuaranteesReturn = skill.id === 'jinghua_skill2' && hero.id === caster.id;
                if (seatGuaranteesReturn) {
                    const used = state.battleStatistics?.[caster.id]?.skill2Casts ?? 0;
                    const seatNet = JINGHUA_SEAT_RETURN_PREMIUM
                        - JINGHUA_SEAT_FETCH_COST
                        - used * JINGHUA_SEAT_REPEAT_DECAY;
                    deathFuelBonus += seatNet
                        + Math.min(5, caster.counters['镜影'] ?? 0) * JINGHUA_YINYUE_VALUE_PER_STACK;
                } else if (scheduled || coveredByCircle || hasReviver) {
                    deathFuelBonus += Math.max(0, cliff - TEMP_DEAD_ONE_ACTION_COST);
                } else {
                    deathFuelBonus += cliff * 0.25;
                }
                if (skill.id === 'soul_lamp_skill2') {
                    // 回归时按「亡灵之魂×20%」补已损生命，这笔治疗此刻还没发生
                    const soulCount = allHeroes(simulated).filter(unit => unit.state !== HeroState.ALIVE).length;
                    const lostHp = Math.max(0, hero.maxHp - (hero.counters['__temp_dead_hp'] ?? hero.currentHp));
                    deathFuelBonus += Math.min(1, soulCount * 0.2) * lostHp * AGGRESSION.healingWeight;
                }
            }
            const circlesBefore = (state.boardEffects ?? []).filter(effect =>
                effect.type === 'dark-circle' && effect.sourceHeroId === caster.id).length;
            const circles = (simulated.boardEffects ?? []).filter(effect =>
                effect.type === 'dark-circle' && effect.sourceHeroId === caster.id);
            if (circles.length > circlesBefore) {
                // 法阵内每次友方暂死/阵亡额外+1共鸣，且能把灯当场点回来：
                // 阵里站的人越多、队里把共鸣换成伤害的人越多，这张阵越值。
                const alliesIn = circles.reduce((total, circle) => total + allHeroes(simulated).filter(hero =>
                    hero.owner === caster.owner && hero.state === HeroState.ALIVE && hero.position &&
                    Math.abs(hero.position[0] - circle.position[0]) <= 1 &&
                    Math.abs(hero.position[1] - circle.position[1]) <= 1
                ).length, 0);
                const earners = allHeroes(simulated).filter(hero => hero.owner === caster.owner
                    && hero.state === HeroState.ALIVE && !hero.id.includes('|')
                    && (RESONANCE_EARNER_SKILLS.has(hero.skill1Id) || RESONANCE_EARNER_SKILLS.has(hero.skill2Id))
                ).length;
                deathFuelBonus += 24 + alliesIn * 9 + earners * 12;
            }
        }
        // 「姿态型」技能的当回合数字小、收益要等对手出手才兑现，evaluateComputerBoard 的单步视野
        // 只看得到"这一下少打几点"，于是 AI 永远挑伤害高的那只手（实测墨阑 S2:S1 = 3.9:2.0，
        // 震霄 S1:S2 = 4.0:0.2）。这里按"接下来真的会被打到几次、多少伤害"把姿态折算成分数：
        // 对面够得着她时开姿态比多打 5 点划算，没人理她时自动回去打伤害——即"随战局换技能"。
        let stanceBonus = 0;
        if (skill.id === 'moran_skill1'
            && simulatedCaster.effects.some(effect => effect.name === '为道')
            && !caster.effects.some(effect => effect.name === '为道')) {
            // 为道：+30% 防御，挨满两次攻击立刻再出手一次
            const pressure = incomingPressure(simulated, simulatedCaster);
            stanceBonus = pressure.damage * 0.30
                + (pressure.hits >= 2 ? MORAN_WEIDAO_EXTRA_ACTION_VALUE
                    : pressure.hits * MORAN_WEIDAO_EXTRA_ACTION_VALUE * 0.35);
        } else if (skill.id === 'zhenxiao_skill2') {
            // 金银错：每次挨打回击 6 点并吸血 50%，回击吃「血锋」的增伤；束缚格锁住贴身的敌人
            const pressure = incomingPressure(simulated, simulatedCaster);
            const counterDamage = ZHENXIAO_COUNTER_DAMAGE * (1 + getZhenxiaoDamageBonus(simulatedCaster));
            const lifesteal = Math.min(counterDamage * 0.5,
                Math.max(0, simulatedCaster.maxHp - simulatedCaster.currentHp));
            const bound = enemiesFor(simulated, caster.owner).filter(enemy =>
                enemy.state === HeroState.ALIVE && enemy.position && simulatedCaster.position &&
                Math.max(Math.abs(enemy.position[0] - simulatedCaster.position[0]),
                    Math.abs(enemy.position[1] - simulatedCaster.position[1])) <= 1
            ).length;
            stanceBonus = pressure.hits * (counterDamage * AGGRESSION.damageWeight + lifesteal)
                + bound * ZHENXIAO_BIND_VALUE_PER_ENEMY;
        }
        // 「援护」的价值在琉璃之后的回合里才兑现（友方挨的打转到她身上），单步模拟读不到，
        // 于是她一辈子不放技能一、也就一辈子攒不出禅定（实测技能二永远因"没有禅定"而失败）。
        // 口径按玩家用法来：先挂援护攒禅定，血低了下一次技能二自然把层数换成回复。
        let guardBonus = 0;
        if (skill.id === 'liuli_skill1') {
            const guarded = allHeroes(simulated).filter(hero =>
                hero.owner === caster.owner && hero.id !== caster.id &&
                hero.state === HeroState.ALIVE &&
                hero.effects.some(effect => effect.name === '援护' && effect.sourceHeroId === caster.id)
            );
            guardBonus = LIULI_ZENDING_VALUE + guarded.reduce((sum, ally) => {
                const pressure = incomingPressure(simulated, ally);
                const absorbable = Math.min(pressure.damage, ally.currentHp + ally.shield);
                return sum + LIULI_GUARD_VALUE_PER_ALLY + absorbable * LIULI_GUARD_DAMAGE_FACTOR;
            }, 0);
        }
        // 增益技的价值在"队友接下来那几手"里兑现，单步模拟读不到：
        // 玄霄「玄光加持」实测 0.12 次/局、阴阳师「纯阳一线」0.13 次/局——账面只有一行
        // +7 的 buff 计数，永远排在她们的输出技之后，于是增益手一辈子只在平A。
        // 折算口径与再动同源：一次完整出手 ≈ 受助者输出档 × EXTRA_ACTION_PER_OUTPUT_RATING。
        let buffValueBonus = 0;
        const buffAmp = BUFF_AMPLIFICATION_VALUE[skill.id];
        if (buffAmp && targetPositions[0]) {
            const helped = simulated.board[targetPositions[0][0]]?.[targetPositions[0][1]];
            if (helped && helped.owner === caster.owner && helped.id !== caster.id &&
                helped.state === HeroState.ALIVE && !helped.id.includes('|')) {
                // 增益持续 2 回合：队友本回合还没动过就能兑现两手，动过只剩下一手
                const followUps = helped.hasActedThisTurn ? 1 : 2;
                buffValueBonus = ratingsForHero(helped).输出 * EXTRA_ACTION_PER_OUTPUT_RATING * buffAmp * followUps;
            }
        }
        // 布场/标记型技能：当回合盘面数字为零，收益在之后几回合慢慢到账，
        // 单步模拟一律读不到，于是被 score>0 的出手闸门长期压死（60 局体检：
        // 风铃「沙丘猎场」采纳 1.30 次/局、施法 0.00；赏金「猎杀令」施法 0.13）。
        let zoneMarkBonus = 0;
        if (skill.id === 'fengling_skill2' && simulatedCaster.position) {
            // 沙丘：她自己站在场中输出 +30% 增伤、暴伤 +20%，每次受伤累积 20% 闪避（最多 5 层）
            const foesInDune = enemiesFor(simulated, caster.owner).filter(enemy =>
                enemy.state === HeroState.ALIVE && enemy.position &&
                Math.abs(enemy.position[0] - simulatedCaster.position![0]) <= 1 &&
                Math.abs(enemy.position[1] - simulatedCaster.position![1]) <= 1
            ).length;
            zoneMarkBonus = DUNE_BASE_VALUE + foesInDune * DUNE_VALUE_PER_FOE;
        } else if (skill.id === 'bounty_skill1') {
            // 猎杀令：友方每次打到被标记目标，她追加 4 点追击 → 值多少取决于有几个队友够得着
            const marked = targetPositions[0] ? state.board[targetPositions[0][0]]?.[targetPositions[0][1]] : null;
            if (marked && marked.owner !== caster.owner) {
                const helpers = heroesFor(simulated, caster.owner).filter(ally =>
                    ally.state === HeroState.ALIVE && ally.id !== caster.id && ally.position &&
                    MovementSystem.getManhattanDistance(ally.position, marked.position ?? ally.position)
                        <= maximumSkillReach(ally) + Math.max(0, ally.moveRange)
                ).length;
                zoneMarkBonus = BOUNTY_MARK_BASE + helpers * BOUNTY_FOLLOWUP_DAMAGE;
            }
        } else if (skill.id === 'feixue_skill2') {
            // 连枝：被结契的队友每次主动出手命中，绯雪追出 6 点；他打不到人时这条链一次都不响
            const bonded = targetPositions[0] ? state.board[targetPositions[0][0]]?.[targetPositions[0][1]] : null;
            if (bonded && bonded.owner === caster.owner && bonded.position) {
                const canPoke = enemiesFor(simulated, caster.owner).some(foe =>
                    foe.state === HeroState.ALIVE && foe.position &&
                    MovementSystem.getManhattanDistance(bonded.position!, foe.position)
                        <= maximumSkillReach(bonded) + Math.max(0, bonded.moveRange));
                zoneMarkBonus = canPoke ? LIANZHI_FOLLOWUP_VALUE : 0;
            }
        } else if (skill.id === 'xubai_skill2') {
            // 黑白凝珠是把球池直接填满 3 颗：池子本来就是满的，这一手什么也没改变，不该占一次行动。
            // 之后我方谁开局低于 40% 生命就自动扣球回血，所以没人带伤时它只是一份保险。
            const refilled = XUBAI_ORB_MAX - Math.min(XUBAI_ORB_MAX, caster.counters['黑白球'] ?? 0);
            if (refilled <= 0) return null;
            const wounded = heroesFor(simulated, caster.owner).filter(ally =>
                ally.state === HeroState.ALIVE && !ally.id.includes('|') && ally.maxHp > 0
                && (ally.currentHp + ally.shield) / ally.maxHp < 0.5).length;
            zoneMarkBonus = refilled * XUBAI_ORB_HEAL * AGGRESSION.healingWeight * (wounded > 0 ? 1.6 : 0.6);
        } else if (skill.id === 'jinghua_skill1' && caster.position) {
            // 水月换身的账面几乎为零（没有伤害、只有 5 点盾），但它的真实收益有两块：
            // 把自己从被围的那一格换走，以及留下一个"队友每次移动都能再踩一次拿盾"的影格。
            const escape = Math.max(0,
                incomingPressure(state, caster).damage - incomingPressure(simulated, simulatedCaster).damage);
            const moonSteppers = heroesFor(simulated, caster.owner).filter(ally =>
                ally.state === HeroState.ALIVE && !ally.id.includes('|') && ally.id !== caster.id
            ).length;
            zoneMarkBonus += escape * 0.5 + WATER_MOON_SHIELD_VALUE
                + moonSteppers * WATER_MOON_RETRIGGER_VALUE;
        }
        // 再动类技能（玄霄「惊鸿再舞」等）只往待行动队列里写一个 id：
        // 没有伤害、没有效果、棋盘分差也是 0，只能对比模拟前后的队列来计分。
        const pendingBefore = state.pendingExtraActionHeroIds;
        const pendingAfter = simulated.pendingExtraActionHeroIds;
        const queuedExtraIds = pendingAfter
            ? [pendingAfter.player1, pendingAfter.player2].filter(
                heroId => heroId && heroId !== pendingBefore?.player1 && heroId !== pendingBefore?.player2
            )
            : [];
        const extraActionBonus = queuedExtraIds.reduce((sum, heroId) => {
            const beneficiary = allHeroes(simulated).find(hero => hero.id === heroId);
            // 队列里躺着个已经不在场的单位时不给分（正常流程不会发生，宁可保守）
            return sum + (beneficiary && beneficiary.state === HeroState.ALIVE
                ? extraActionValue(beneficiary)
                : 0);
        }, 0);
        const score = afterScore - beforeScore
            + damage * AGGRESSION.damageWeight
            + healing * AGGRESSION.healingWeight
            + effectValue
            + kills * KILL_SCORE_BONUS
            + tempDeaths * TEMP_DEAD_SCORE_BONUS
            + tianweiBonus
            + cloneBonus
            + dashBonus
            + bladeRefreshBonus
            + bladeBonus
            + swordBonus
            + replayBonus
            + jinghongBonus
            + deathFuelBonus
            + stanceBonus
            + guardBonus
            + buffValueBonus
            + zoneMarkBonus
            + moonValue
            + extraActionBonus
            + (meaningfulResult ? skillTypeBias(skill) : 0)
            // 技能轮换：最近一次用过的技能减分，促使 AI 换着放技能
            - (lastSkillIndex === skillIndex ? SKILL_REPEAT_PENALTY : 0);

        return { skillId: skill.id, targetPositions, score };
    } catch {
        return null;
    }
}

/** 一次 AI 技能决策的候选清单快照，供回放与离线复盘分析"当时还有哪些选择、为什么选它" */
export interface AiDecisionAudit {
    /** 枚举出的全部候选，按分数从高到低 */
    candidates: Array<{ skillId: string; score: number; targets: Position[] }>;
    /** 最终采纳的方案；null 表示没有可用方案 */
    chosen: { skillId: string; score: number } | null;
}

export function chooseComputerSkillPlan(
    state: GameState,
    caster: Hero,
    onlySkillId?: string,
    audit?: AiDecisionAudit
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
            // 本回合已经因"整链无人可选"取消过一次，别再原地重复释放
            if (caster.counters['__ai_wukong_combo_aborted'] === state.roundNumber) continue;
            const hasClones = countWukongClones(state, caster.id) > 0;
            // 分身只落在棋盘上，不进 playerXHeroes：按名单数会永远数到 0，
            // "场上已有分身"这条判据形同虚设，于是够不到人时合击整轮被跳过。
            const hasEnemyInReach = enemiesFor(state, caster.owner).some(enemy =>
                enemy.state === HeroState.ALIVE && enemy.position &&
                wukongComboReaches(state, caster, enemy.position!));
            if (!hasClones && !hasEnemyInReach) continue;
        }
        if (!SkillSystem.canUseSkill(caster, skill, state)) {
            // 白泽复活会绕过常规目标判定，单独允许进入模拟。
            // 大圣合击同理：它自带"先走到可达空格再打"，脚下 3×3 没人并不代表这一手不存在，
            // 能不能打由上面 wukongComboReaches 判过。
            // 泠汐「涌潮拍岸」也同理：它是"先点方向格、再展开前方 2×3"的两步技，
            // canUseSkill 只看得见脚下四个方向格有没有人站，于是 100 局里这一手只被枚举 0.79 次，
            // 而玩家点一下方向格就能打到两三格外的敌人。四个方向各成一个方案，谁有分用谁。
            if (
                !(skill?.id === 'baize_skill2' && (caster.counters['天禄'] ?? 0) >= 3) &&
                skill?.id !== 'dilan_skill2' &&
                skill?.id !== 'lingxi_skill2' &&
                skill?.id !== 'wukong_skill2'
            ) continue;
        }
        for (const targetPositions of buildTargetSets(state, caster, skill)) {
            const candidate = simulateSkillPlan(state, caster, skill, targetPositions);
            if (candidate) candidates.push(candidate);
        }
    }

    const rankedCandidates = [...candidates]
        .sort((left, right) => right.score - left.score)
        .map(plan => ({ skillId: plan.skillId, score: Math.round(plan.score * 10) / 10, targets: plan.targetPositions }));

    if (candidates.length === 0) {
        if (audit) {
            audit.candidates = [];
            audit.chosen = null;
        }
        return null;
    }

    // 技能多样性：分数接近的候选（含不同技能/目标）之间随机挑选，避免每回合都放同一个技能；
    // 低难度还会以一定概率主动挑次优解。
    const picked = pickWithBlunder(candidates, difficultyProfile().skillTolerance) ?? null;
    if (audit) {
        audit.candidates = rankedCandidates;
        audit.chosen = picked ? { skillId: picked.skillId, score: Math.round(picked.score * 10) / 10 } : null;
    }
    return picked;
}

function maximumSkillReach(hero: Hero): number {
    return [getSkill(hero.skill1Id), getSkill(hero.skill2Id)].reduce((best, skill) => {
        if (!skill) return best;
        if (skill.rangeType === '全场') return BOARD_SIZE * 2;
        return Math.max(best, skill.range + (skill.rangeType === 'area' ? 1 : 0));
    }, 1);
}

interface PositionCoverage {
    /** 站在这一格、选覆盖最多的那个技能时，能同时罩住的敌人 */
    coveredEnemies: Hero[];
    /** 能同时照应的友方数（治疗/增益技） */
    allyCoverage: number;
}

const NO_COVERAGE: PositionCoverage = { coveredEnemies: [], allyCoverage: 0 };

/**
 * 该英雄的理想交击距离：按技能定位取，不能取"形状最远能伸到几格"。
 * 后者会让 3x3 贴身技算出 2 格（对角那格），于是近战单位会悬在自己攻击面外一步不肯进场。
 * 直线/单体射程技卡在射程末端风筝，十字与区域技必须走进去，全场技留一步余地即可。
 */
function preferredStandoff(hero: Hero): number {
    let standoff = 1;
    for (const skillId of [hero.skill1Id, hero.skill2Id]) {
        const skill = getSkill(skillId);
        if (!skill || skill.type !== 'damage' || isSkillOnCooldown(hero, skill)) continue;
        const gap = skill.rangeType === 'single' || skill.rangeType === 'line'
            ? Math.min(4, Math.max(1, skill.range))
            : skill.rangeType === '全场'
                ? 3
                : 1;
        standoff = Math.max(standoff, gap);
    }
    return standoff;
}

/** 取技能形状里真正会吃到结算的一侧：直线四向是一次选一条轴，按同行/同列分开数。 */
function coverageGroups(
    skill: Skill,
    origin: Position,
    cells: Position[]
): Position[][] {
    if (skill.rangeType === 'line') {
        // 引擎一次返回四个方向的全部格子，真实施法只会选一条轴：同行与同列分别数，取较大的一侧
        return [
            cells.filter(([row]) => row === origin[0]),
            cells.filter(([col]) => col === origin[1]),
        ];
    }
    return [cells];
}

/**
 * 站在 position 这一格，本回合就绪技能分别能同时罩住哪些敌人（或几名友方）。
 * 形状取自 SkillSystem.getValidTargetPositions，与高亮、结算同源，避免另写一套几何口径
 * 导致"AI 以为罩得住、真放技能只打到一个"。
 * 只用于站位评分与候选排序，真实出手方案仍由 simulateSkillPlan 完整模拟后决定。
 */
function analyzePositionCoverage(
    state: GameState,
    hero: Hero,
    position: Position
): PositionCoverage {
    if (hero.state !== HeroState.ALIVE) return NO_COVERAGE;
    const probe = hero.position === position ? hero : { ...hero, position };
    const enemies = enemiesFor(state, hero.owner).filter(enemy =>
        enemy.state === HeroState.ALIVE && enemy.position
    );
    const allies = heroesFor(state, hero.owner).filter(ally =>
        ally.state === HeroState.ALIVE && ally.position && ally.id !== hero.id
    );
    let bestEnemy: Hero[] = [];
    let bestAlly = 0;
    for (const skillId of [hero.skill1Id, hero.skill2Id]) {
        const skill = getSkill(skillId);
        if (!skill || isSkillOnCooldown(hero, skill)) continue;
        if (skill.id === 'zhiguang_skill2') {
            // 棱光千折的覆盖是八条会折射的折线，和"点方向格"的高亮不是同一套几何：
            // 逐向描出光路，只认能同时罩住最多敌人的那一条，别让 AI 以为自己只罩得住脚边八格
            for (let dirCode = 0; dirCode < ZHIGUANG_DIRECTION_DELTAS.length; dirCode++) {
                const struck = new Set(traceZhiguangBeam(probe, state, dirCode).cells
                    .map(([row, col]) => state.board[row]?.[col])
                    .filter(unit => !!unit && unit.state === HeroState.ALIVE && unit.owner !== hero.owner)
                    .map(unit => unit!.id));
                const foes = enemies.filter(enemy => struck.has(enemy.id));
                if (foes.length > bestEnemy.length) bestEnemy = foes;
            }
            continue;
        }
        const cells = SkillSystem.getValidTargetPositions(probe, skill, state).filter(isBoardPosition);
        for (const group of coverageGroups(skill, position, cells)) {
            const hitIds = new Set<string>();
            for (const [row, col] of group) {
                const occupant = state.board[row]?.[col];
                if (occupant && occupant.state === HeroState.ALIVE) hitIds.add(occupant.id);
            }
            if (skill.targetType === 'enemy' || skill.targetType === 'any') {
                const foes = enemies.filter(enemy => hitIds.has(enemy.id))
                    // 可选目标数是几个就封顶几个：站在人堆里不等于一次打到三个人
                    .slice(0, typeof skill.targetCount === 'number'
                        ? Math.max(1, skill.targetCount)
                        : Number.POSITIVE_INFINITY);
                if (foes.length > bestEnemy.length) bestEnemy = foes;
            }
            if (skill.targetType === 'ally' || skill.targetType === 'any') {
                bestAlly = Math.max(bestAlly, allies.filter(ally => hitIds.has(ally.id)).length);
            }
        }
    }
    return { coveredEnemies: bestEnemy, allyCoverage: bestAlly };
}

/** 某一格被多少片"这名角色同阵营"的水泽盖住（站位加分用，覆盖口径与渲染一致） */
function ownMarshLayersAt(state: GameState, owner: Player, position: Position): number {
    return (state.boardEffects ?? []).filter(effect =>
        effect.type === 'water-marsh' &&
        effect.owner === owner &&
        marshCovers(effect, position[0], position[1])
    ).length;
}

/**
 * 从 from 直着走到 to 的这条线上，会不会压过一枚鱼钩。
 * owner 传钩子归属方：姜太公自己那侧的钩子只咬敌人，所以自家 AI 不扣分，
 * 而他要把钩子下在对手的必经之路上。
 */
function hooksAlongLine(state: GameState, from: Position, to: Position, hookOwner: Player): number {
    const hooks = (state.boardEffects ?? []).filter(effect =>
        effect.type === 'fish-hook' && effect.owner === hookOwner);
    if (hooks.length === 0) return 0;
    const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    if (steps === 0) return 0;
    let hits = 0;
    const seen = new Set<string>();
    for (let index = 1; index <= steps; index++) {
        const row = Math.round(from[0] + (to[0] - from[0]) * index / steps);
        const col = Math.round(from[1] + (to[1] - from[1]) * index / steps);
        const key = `${row},${col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (hooks.some(hook => hook.position[0] === row && hook.position[1] === col)) hits++;
    }
    return hits;
}

/**
 * 鱼钩抛掷的落点：把人丢得离他队友越远越好，同时贴到我方一堆人脚下——
 * 下一轮谁都够得着他。一格都挑不出来时返回 null，由收尾兜底作废。
 */
export function pickJiangtaigongHookLanding(caster: Hero, state: GameState): Position | null {
    const victim = findHero(state, state.pendingBoardAction?.hookTargetId ?? '');
    if (!victim || victim.state !== HeroState.ALIVE) return null;
    const mates = enemiesFor(state, caster.owner).filter(hero => hero.id !== victim.id && hero.position);
    const myCrowd = heroesFor(state, caster.owner).filter(hero =>
        hero.id !== caster.id && hero.state === HeroState.ALIVE && hero.position);
    let best: Position | null = null;
    let bestScore = -Infinity;
    for (const cell of hookThrowLandings(state)) {
        const apartFromMates = mates.length === 0 ? 6
            : mates.reduce((min, hero) => Math.min(min, MovementSystem.getManhattanDistance(cell, hero.position!)), 99);
        const crowd = myCrowd.reduce((sum, hero) =>
            sum + (MovementSystem.getManhattanDistance(cell, hero.position!) <= 2 ? 1 : 0), 0);
        const score = apartFromMates * 3 + crowd * 4 + ownMarshLayersAt(state, caster.owner, cell) * 2;
        if (score > bestScore) {
            bestScore = score;
            best = cell;
        }
    }
    return best;
}

/** 会"一次罩一片"的伤害技：十字/方块/直线三类是真正的群攻形状。 */
function hasAreaDamageSkill(hero: Hero): boolean {
    return [getSkill(hero.skill1Id), getSkill(hero.skill2Id)].some(skill =>
        !!skill && skill.type === 'damage' &&
        (skill.rangeType === 'area' || skill.rangeType === 'cross' || skill.rangeType === 'line'));
}

function chebyshevGap(left: Position, right: Position): number {
    return Math.max(Math.abs(left[0] - right[0]), Math.abs(left[1] - right[1]));
}

/** 第 1 个满值、往后每个只再值一半：让"多罩一个人"仍然更好，但边际收益压不过把他吸进同一发群攻 */
function diminishingCount(count: number): number {
    let total = 0;
    let weight = 1;
    for (let index = 0; index < count; index++) {
        total += weight;
        weight *= 0.5;
    }
    return total;
}

/**
 * 扎堆罚：我方几个人挤在候选格旁边，等于替对面把范围技的命中数买好了。
 * 罚值按"那一发的真实伤害 × 被罩住的额外人数"计，与"留在原地多罩一个敌人"的
 * 那份收益（输出×2.4）同量级——不然电脑会理性地选择换血，看起来就是不会躲。
 * 只有附近确实有会群攻、这回合还没动过手的敌人才罚，免得把"后排抱团等奶"一并抹平。
 */
function clusterExposurePenalty(state: GameState, hero: Hero, position: Position): number {
    const threat = enemiesFor(state, hero.owner).find(enemy =>
        enemy.state === HeroState.ALIVE && !!enemy.position && !enemy.hasActedThisTurn &&
        !EffectManager.isStunned(enemy) && hasAreaDamageSkill(enemy) &&
        chebyshevGap(position, enemy.position) <= maximumSkillReach(enemy) + enemy.moveRange + 2);
    if (!threat) return 0;
    let bodies = 0;
    for (const ally of heroesFor(state, hero.owner)) {
        if (ally.id === hero.id || ally.state !== HeroState.ALIVE || !ally.position) continue;
        // 贴身那一圈给满权重，第二圈只给四分之一：一步就能走出 3×3，
        // 但两格半径算太重会让"挪一格"看起来毫无收益，电脑干脆不动。
        const gap = chebyshevGap(position, ally.position);
        if (gap <= 1) bodies += 1;
        else if (gap <= 2) bodies += 0.25;
    }
    if (bodies < 1) return 0;
    const blast = estimateDamageAgainst(threat, hero);
    if (blast <= 0) return 0;
    return Math.min(3, bodies) * blast * 0.35;
}

export function scoreComputerPosition(state: GameState, hero: Hero, position: Position): number {
    const ratings = ratingsForHero(hero);
    const hpRatio = hero.maxHp > 0 ? hero.currentHp / hero.maxHp : 0;
    const enemies = enemiesFor(state, hero.owner).filter(enemy => enemy.state === HeroState.ALIVE && enemy.position);
    const allies = heroesFor(state, hero.owner).filter(ally => ally.id !== hero.id && ally.state === HeroState.ALIVE && ally.position);
    const coverage = analyzePositionCoverage(state, hero, position);
    const standoff = preferredStandoff(hero);
    let score = 0;

    // 只有"这一格的技能形状真的罩得住"的敌人才给接战分，一次罩住几个就给几份，
    // 这才是让 AI 去找"一杆扫三个"格子而不是"离三个人都近"的格子的动力。
    for (const victim of coverage.coveredEnemies) {
        score += ratings.输出 * 2.4 + ratings.控制 * 1.4 + (1 - effectiveHpRatio(victim)) * 20;
    }
    score += diminishingCount(coverage.allyCoverage) * ratings.支援 * 0.7;

    for (const enemy of enemies) {
        const distance = MovementSystem.getManhattanDistance(position, enemy.position!);
        const enemyReach = maximumSkillReach(enemy);
        // 接近梯度：按"离理想交击距离还差几格"给分，已经站进射程的英雄不再被继续往前拽
        score += Math.max(0, 6 - Math.abs(distance - standoff)) * ratings.输出 * 0.32;
        if (!EffectManager.isStunned(enemy)) {
            if (distance <= enemyReach) {
                // 直接威胁：敌人原地就能打到这个位置
                const threat = estimateThreatAtPosition(enemy, position, hero);
                if (threat > 0) {
                    // 会被单次技能直接击杀时扣分大幅放大，越残血越怕死；
                    // 非致命威胁只按低权重计分，让健康单位敢于压上换血。
                    const lethal = threat >= hero.currentHp + hero.shield;
                    const deathRisk = lethal ? (hpRatio < 0.35 ? 6 : 3.2) : 1;
                    const actedFactor = enemy.hasActedThisTurn ? 0.25 : 1;
                    // 0.24 那一档实测让"躲一发"永远换不过"多罩一个敌人"（17 分），
                    // 电脑于是纯按最大化这一击来打，看起来就是不会规避伤害。
                    score -= threat * (THREAT_WEIGHT + (1 - hpRatio) * 0.5) * actedFactor * deathRisk;
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
                    score -= threat * (0.12 + (1 - hpRatio) * 0.28) * deathRisk;
                }
            }
        }
    }

    if (ratings.支援 >= 7) {
        // 照应分按"越近越值、但每个队友只算前一档的一半"给：
        // 不设递减的话奶妈会把全队吸成一坨，扎堆罚永远追不上那份贴人奖励。
        let mateWeight = 1;
        for (const distance of allies
            .map(ally => MovementSystem.getManhattanDistance(position, ally.position!))
            .sort((left, right) => left - right)) {
            score += Math.max(0, 4 - distance) * ratings.支援 * 0.5 * mateWeight;
            mateWeight *= 0.5;
        }
    }

    score += (2.5 - Math.abs(position[0] - 2.5)) * 0.8;
    if (hpRatio < 0.28) {
        const nearestEnemy = enemies.reduce(
            (best, enemy) => Math.min(best, MovementSystem.getManhattanDistance(position, enemy.position!)),
            12
        );
        score += nearestEnemy * (0.28 - hpRatio) * 7;
    } else if (ratings.支援 >= 8 && hpRatio < 0.5) {
        // 治疗/辅助型英雄适当后撤，避免被集火。
        const nearestEnemy = enemies.reduce(
            (best, enemy) => Math.min(best, MovementSystem.getManhattanDistance(position, enemy.position!)),
            12
        );
        score += nearestEnemy * (0.5 - hpRatio) * 2.4;
    }

    // 姜太公的场地：自家水泽给闪避，谁站进去都滑一档。敌方的鱼钩是"走过去就被抛走"的陷阱，
    // 扣分按它真实那一口（抛掷 10 点）估，不再用 26 那种大数——罚重了电脑会绕开整条线，
    // 钩子永远咬不到人，玩家反而觉得"这技能没实现"。
    const ownMarsh = ownMarshLayersAt(state, hero.owner, position);
    if (ownMarsh > 0) score += 6 * Math.min(2, ownMarsh);
    if (hero.position && hooksAlongLine(state, hero.position, position, hero.owner === 'player1' ? 'player2' : 'player1') > 0) {
        score -= HOOK_THROW_DAMAGE;
    }
    // 敖渊的主输出是绕身那一圈，通用形状评分只看技能自身的 single/line 范围，
    // 读不到"站进这里下一圈能扫到几个人"——不给这一笔，电脑会把他当纯近战用。
    if (hero.passiveId === 'aoyuan_passive' && hasDragon(hero)) {
        const swept = dragonVictimsOnCells(state, hero, nextOrbitLeg(hero, position)).length;
        score += swept * (ratings.输出 * 2 + 4);
    }

    // 云岫的雷云只能铺在她自身两格十字范围内，所以站位的价值是"站过去之后，
    // 一团新云最多能压住几个人"。通用形状评分只看技能自己那一格，读不到这件事。
    if (hero.passiveId === 'yunxiu_passive') {
        score += bestCloudAnchorCover(state, hero, position) * (ratings.输出 * 2 + 4);
    }

    // 站进自己人的堆里，对面一发群攻就多罩几个人——这一手要在站位账上扣掉
    score -= clusterExposurePenalty(state, hero, position);
    return score;
}

/**
 * 岱宗「砸得出去了才走这一步」：镇守期间他本来钉在原地攒岳势，但池子够肥、身边却没有一个敌人时，
 * 再站着就变成囤货——移动本来就要散姿态，而岳倾自身也会解除姿态，所以这一路不亏。
 */
const DAIZONG_CASHOUT_PRESSURE = 25;

function daizongShouldWalkToCashOut(state: GameState, hero: Hero): boolean {
    if (mountainPressure(hero) < DAIZONG_CASHOUT_PRESSURE || !hero.position) return false;
    const foes = heroesFor(state, hero.owner === 'player1' ? 'player2' : 'player1')
        .filter(foe => foe.state === HeroState.ALIVE && !!foe.position);
    return !foes.some(foe =>
        Math.abs(foe.position![0] - hero.position![0]) <= 1 &&
        Math.abs(foe.position![1] - hero.position![1]) <= 1);
}

export function chooseComputerMove(state: GameState, hero: Hero): Position | null {
    if (!hero.position || hero.hasMovedThisTurn) return null;
    // 惊鸿·止水：决渊释放回合必须站定，store 会拦下移动，这里直接不把它列入计划
    if (hero.passiveId === 'jinghong_passive' && isJinghongReleaseWindow(hero, state)) return null;
    // 岱宗：镇守一摆就该钉在原地——移动既散姿态、又断掉「不动如山」的记账，岳势立刻停止上涨。
    // 他攒池子的速度全看"站着挨打"，所以电脑宁愿浪费一次移动力（图鉴提示同一口径）。
    if (hero.passiveId === 'daizong_passive' && hasStance(hero)
        && !daizongShouldWalkToCashOut(state, hero)) return null;
    const positions = MovementSystem.getMovablePositions(hero, state);
    const currentScore = scoreComputerPosition(state, hero, hero.position);
    const candidates = positions
        .map(position => ({ position, score: scoreComputerPosition(state, hero, position) }))
        .filter(candidate => candidate.score > currentScore + 1.25);

    // 镜花·水月的交换跳板（真身/水月/月座）不是普通移动落点，寻路永远不会枚举它们，
    // AI 队友因此从不知道去踩白拿的护盾、更不会踏座接镜花归场：
    // 这里把交换落点并入移动候选，按"踩上去值什么"给功能分。
    const swapDests = getJinghuaSwapDestinations(hero, state);
    if (swapDests.length > 0) {
        const moon = findWaterMoon(state, hero.owner);
        const seat = findMoonSeat(state, hero.owner);
        const isSame = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
        for (const pos of swapDests) {
            if (positions.some(p => isSame(p, pos))) continue;
            let bonus = 6;   // 免移动力换影：5点护盾 + 给镜花攒镜影的团队经济
            if (moon && isSame(pos, moon.position)) bonus += 4; // 水月踏板另值一层盾
            if (seat && isSame(pos, seat.position)) bonus = 24; // 踏座=整单位归场，值一次行动
            const score = scoreComputerPosition(state, hero, pos) + bonus;
            if (score > currentScore + 1.25) candidates.push({ position: pos, score });
        }
    }

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
    // 先一次性算好每个候选的方案，后面既要排序也要判断"她是不是在给别人铺路"
    const plans = new Map(candidates.map(hero => [hero.id, chooseComputerSkillPlan(state, hero)] as const));
    const scored = candidates.map(hero => {
        const skillPlan = plans.get(hero.id) ?? null;
        const move = chooseComputerMove(state, hero);
        const moveScore = move ? scoreComputerPosition(state, hero, move) : (hero.position ? scoreComputerPosition(state, hero, hero.position) : 0);
        const hpRatio = hero.maxHp > 0 ? hero.currentHp / hero.maxHp : 0;
        // 冷却中的英雄适当延后出手，把行动优先让给技能就绪的队友
        const cooldownPenalty = [hero.skill1Id, hero.skill2Id].some(skillId => {
            const skill = getSkill(skillId);
            return skill ? isSkillOnCooldown(hero, skill) : false;
        }) ? 4 : 0;
        // 行动顺序也要考虑长远：铺路型那一手（法阵/连枝/猎杀令/沙丘/姿态）如果排在
        // 输出手之后才动，增益就白白压了一回合。按"本回合还没行动、且确实有仗可打的队友数"加权，
        // 让辅助先手；但队友此刻能击杀时（KILL_SCORE_BONUS 远大于本项）仍然优先收人头。
        const setupBonus = skillPlan && SETUP_FIRST_SKILLS.has(skillPlan.skillId)
            ? Math.min(3, candidates.filter(other =>
                other.id !== hero.id && (plans.get(other.id)?.score ?? 0) > 0
            ).length) * SETUP_ORDER_VALUE_PER_ALLY
            : 0;
        return {
            hero,
            score: (skillPlan?.score ?? 0) * 1.4 + moveScore + hpRatio * 4 + ratingsForHero(hero).成长 - cooldownPenalty + setupBonus,
        };
    });
    if (scored.length === 0) return null;

    return pickWithBlunder(scored, difficultyProfile().decisionTolerance)?.hero ?? null;
}

export function chooseComputerPendingBoardPosition(state: GameState, hero: Hero): Position | null {
    if (hero.tianweiId === 'xueqi_tianwei') {
        const sweepCenter = chooseXueqiSweepCenter(state, hero);
        if (sweepCenter) return sweepCenter;
    }
    if (state.pendingBoardAction?.type === 'yunying-tianwei') {
        // 天威·燎原百斩的落点只认共线空格：退回常规选位会点到非法格并把挂起原地卡死，
        // 挑不出落点（无人可斩）时也返回 null，由调用方兜底放行
        return pickYunyingTianweiLanding(hero, state);
    }
    if (state.pendingBoardAction?.type === 'zhiguang-tianwei') {
        // 万华镜优先落到 5×5 里照到人最多的那一格；一个都照不到时不返回 null，
        // 继续走下面的通用选位——落点集合就是"任意空格"，随便挑一格都合法，
        // 把挂起悬在这儿不答，天威就漂到对手回合去了
        const kaleidoscope = pickZhiguangTianweiLanding(hero, state);
        if (kaleidoscope) return kaleidoscope;
    }
    if (hero.passiveId === 'yunying_passive') {
        // 烈火燎原：点相邻方向格即沿那条线烧到棋盘边缘，优先烧最多、最残血的一边
        const liehuoDirection = chooseYunyingLiehuoDirection(state, hero);
        if (liehuoDirection) return liehuoDirection;
        if (state.pendingBoardAction?.type === 'yunying-liehuo') {
            // 四条射线都烧不到人：返回 null 交由收尾兜底作废放行。
            // 绝不能退回下面的全盘选位——随便一格都不是合法方向，会被拒到永久卡住
            return null;
        }
    }
    if (state.pendingBoardAction?.type === 'jiangtaigong-hook') {
        // 鱼钩抛掷的落点集合是"任意空格"：必须在这里挑完，退回通用选位会把挂起悬到自己回合之外
        return pickJiangtaigongHookLanding(hero, state);
    }
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

/**
 * 云缨烈火燎原的方向格：比较四个方向上"自己到边缘"这条射线能烧到的敌人数与已损生命，
 * 同分按行列顺序取先者，保证联机两端与回放结果一致。
 * 四条线都烧不到人时返回 null，由调用方退回常规选位（不能让待选状态卡住决策）。
 */
function chooseYunyingLiehuoDirection(state: GameState, hero: Hero): Position | null {
    if (!hero.position) return null;
    const [row, col] = hero.position;
    const directions: Array<{ cell: Position; delta: Position }> = [
        { cell: [row - 1, col], delta: [-1, 0] },
        { cell: [row + 1, col], delta: [1, 0] },
        { cell: [row, col - 1], delta: [0, -1] },
        { cell: [row, col + 1], delta: [0, 1] },
    ];
    let best: Position | null = null;
    let bestHits = 0;
    let bestPressure = 0;
    for (const { cell, delta } of directions) {
        const [targetRow, targetCol] = cell;
        if (targetRow < 0 || targetRow >= BOARD_SIZE || targetCol < 0 || targetCol >= BOARD_SIZE) continue;
        let hits = 0;
        let pressure = 0;
        for (let step = 1; step < BOARD_SIZE; step++) {
            const r = row + delta[0] * step;
            const c = col + delta[1] * step;
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
            const target = state.board[r][c];
            if (!target || target.owner === hero.owner || target.state !== HeroState.ALIVE) continue;
            hits += 1;
            pressure += (target.maxHp - target.currentHp) / Math.max(1, target.maxHp) + 0.2;
        }
        if (hits === 0) continue;
        if (hits > bestHits || (hits === bestHits && pressure > bestPressure)) {
            bestHits = hits;
            bestPressure = pressure;
            best = cell;
        }
    }
    return best;
}

/**
 * 血契天威的落点：血契要先跃到这一格再就地横扫，所以落点必须是空格
 * （点自己脚下等于不移动只扫一次）。优先罩住最多、最脆的敌人。
 * 一个敌人都扫不到时返回 null，交由调用方退回常规选位。
 * 同分按行列顺序取先者，保证联机两端与回放结果一致。
 */
function chooseXueqiSweepCenter(state: GameState, hero: Hero): Position | null {
    let best: Position | null = null;
    let bestHits = 0;
    let bestPressure = Number.POSITIVE_INFINITY;

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const landing = state.board[row][col];
            if (landing && landing.id !== hero.id) continue;   // 只能跃向空格
            let hits = 0;
            let pressure = 0;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    const r = row + dr;
                    const c = col + dc;
                    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
                    const target = state.board[r][c];
                    if (!target || target.owner === hero.owner || target.state !== HeroState.ALIVE) continue;
                    if (target.id.includes('|')) continue;   // 召唤物/分身不作为落点评价依据
                    hits++;
                    pressure += target.currentHp + target.shield;
                }
            }
            if (hits === 0) continue;
            if (hits > bestHits || (hits === bestHits && pressure < bestPressure)) {
                best = [row, col];
                bestHits = hits;
                bestPressure = pressure;
            }
        }
    }
    return best;
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

/** 仍处于时空停滞、可被戴尔「时空回溯」唤回的本方单位 */
function stasisRevivableHeroes(state: GameState, player: Player): Hero[] {
    return heroesFor(state, player).filter(hero => GameEngine.isInStasis(hero, state.roundNumber));
}

/**
 * 戴尔「时空回溯」唤回对象：真执行时的锚定与模拟评分共用同一份排序，
 * 否则 AI 评的是 A、点的是 B。按"复活后能贡献多少"排序，
 * 挨下致命一击时的血量越低，唤回回来的战力越打折。
 */
export function chooseComputerStasisReviveTarget(state: GameState, player: Player): Hero | null {
    if (GameEngine.countRealAliveOnBoard(state, player) >= 4) return null;

    return [...stasisRevivableHeroes(state, player)]
        .sort((left, right) => {
            const value = (hero: Hero) => {
                const ratings = ratingsForHero(hero);
                const reviveHp = hero.counters['__dai_hp_before_lethal'] ?? hero.maxHp;
                const hpRatio = hero.maxHp > 0 ? Math.min(1, reviveHp / hero.maxHp) : 0;
                return (ratings.输出 * 1.2 + ratings.生存 + ratings.支援 + ratings.控制) * (0.5 + hpRatio * 0.5);
            };
            return value(right) - value(left);
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
const JOINT_MIN_PLAN_SCORE = 30;

/**
 * 自带位移的伤害技能：释放本身就已经完成接敌与脱离，
 * 不该再为它"先走一步"，否则会把冲刺距离额度提前花光（游隼疾掠的典型误用）。
 */
/**
 * "释放本身就完成了接敌"的技能：游隼疾掠冲刺，孙悟空大圣合击自带先走一步。
 * 这类技能必须先手释放——先普通移动一步会把它们的前提花光（合击直接判定"已移动过"放不出来）。
 */
export function isSelfPropellingSkill(skillId: string | undefined): boolean {
    return skillId === 'youjun_skill1' || skillId === 'wukong_skill2' || skillId === 'aoyuan_skill2' || skillId === 'xuanyuan_skill1';
}

/**
 * 走出群攻覆盖圈的位移奖励：站位分只按 0.3 折算，纯保命位移永远跨不过 JOINT_MOVE_MARGIN，
 * 所以这一项单独记账，权重直接对齐"留在人堆里每回合多挨一发"的真实损失。
 */
const EXPOSURE_RELIEF_WEIGHT = 0.9;

/**
 * 站位分在"先挪一步再打"总分里的折算权重。
 * 别指望靠抬这个数让电脑动起来：实测把它从 0.3 抬到 0.7，"移动后行动的回合占比"反而从
 * 37.1% 掉到 32.2%，最长重复技能串从 5 涨到 12——因为方案分（1.0 权重）的差距本来就是
 * 几十点量级，放大站位项只会让排序更抖，不会让被压住的位移翻身的门槛。
 * 规避伤害走上面那条专门的 relief 记账。
 */
const JOINT_POSITION_WEIGHT = 0.3;

/** 站位账里「这一格会挨一发」的基础罚值系数（另按残血加罚）。
 * 实测抬到 0.7 不会让电脑更会躲：移动占比 33.2%→32.4%、抱团反而从 2.28 涨到 2.56，
 * 因为它只是把"挨打"这项罚重了，没打开"要不要挪"这个闸门。 */
const THREAT_WEIGHT = 0.24;

/**
 * 移动+技能联合规划：枚举若干高价值站位，模拟"先移动到该格再放技能"的总收益。
 * 返回非 null 即代表"先挪一步再打"比"站在原地打"高出 JOINT_MOVE_MARGIN 以上，
 * 调用方据此决定要不要移动，不需要自己再比一次分数。
 * 低难度档 jointMoveTopK=0 直接关闭该能力。
 * @param baselinePlan 调用方已经算出的原地最优方案；省略时内部重算一次
 */
export function planJointMoveForHero(
    state: GameState,
    caster: Hero,
    baselinePlan?: ComputerSkillPlan | null
): ComputerJointMovePlan | null {
    if (!caster.position || caster.hasMovedThisTurn || caster.hasActedThisTurn) return null;
    if (caster.state !== HeroState.ALIVE) return null;
    // 岱宗摆着镇守时不参与"先走一步再放技能"的联合规划：那一步会把姿态踩散（见 chooseComputerMove）
    if (caster.passiveId === 'daizong_passive' && hasStance(caster)
        && !daizongShouldWalkToCashOut(state, caster)) return null;
    const topK = difficultyProfile().jointMoveTopK;
    if (topK <= 0) return null;

    const currentPos = caster.position;
    const movable = MovementSystem.getMovablePositions(caster, state);
    if (movable.length === 0) return null;

    const baseline = baselinePlan === undefined ? chooseComputerSkillPlan(state, caster) : baselinePlan;
    // 自带位移的技能（游隼疾掠）把"这一步位移"本身就是伤害来源，先走一步会把冲刺额度
    // 提前花光，贴脸后冲刺反而变成负收益，因此这类方案一律不换取位。
    if (baseline && isSelfPropellingSkill(baseline.skillId)) return null;
    const exposureNow = clusterExposurePenalty(state, caster, currentPos);
    const baselineTotal =
        (baseline?.score ?? 0) + scoreComputerPosition(state, caster, currentPos) * JOINT_POSITION_WEIGHT;

    // 按站位质量取前 topK 个候选格，避免全图模拟
    const ranked = movable
        .map(position => ({ position, posScore: scoreComputerPosition(state, caster, position) }))
        .sort((left, right) => right.posScore - left.posScore)
        .slice(0, topK);

    let best: ComputerJointMovePlan | null = null;
    for (const candidate of ranked) {
        const plan = simulateHeroMoveThenSkill(state, caster, candidate.position);
        if (!plan) continue;
        // 走出敌方群攻的覆盖圈本身就值"少挨一发"：站位分在总分里只按 0.3 折算，纯保命位移
        // 永远跨不过 JOINT_MOVE_MARGIN，于是电脑宁可四个人挤在一格吃一发大范围技能也不肯散。
        // 把"少罩住几个自己人"单独记一笔，规避伤害才真的进得了决策。
        const relief = (exposureNow - clusterExposurePenalty(state, caster, candidate.position)) * EXPOSURE_RELIEF_WEIGHT;
        const total = plan.score + candidate.posScore * JOINT_POSITION_WEIGHT + relief;
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
    for (const position of SkillSystem.getValidTargetPositions(attacker, skill, state).filter(isBoardPosition)) {
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
 * 孙悟空分身指挥：为本体/分身挑一格移动位。
 * 只考虑移动过去后 3x3 内有敌人的格子（移动就是为了打出下一拳），再按走位安危排序取最优。
 * 候选格默认是四方向相邻格（分身仍走一格）；本体阶段由调用方传入其移动力可达的全部空格。
 */
export function chooseComputerWukongStepPosition(
    state: GameState,
    unit: Hero,
    candidates?: Position[]
): Position | null {
    if (!unit.position || unit.state !== HeroState.ALIVE) return null;
    const [unitRow, unitCol] = unit.position;
    const stepCells = candidates ?? (
        [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
    ).map(([dr, dc]) => [unitRow + dr, unitCol + dc] as Position);
    let best: Position | null = null;
    let bestScore = -Infinity;
    for (const [row, col] of stepCells) {
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
