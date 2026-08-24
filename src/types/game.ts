/** 位置坐标 [行, 列] */
export type Position = [number, number];

/** 玩家标识 */
export type Player = 'player1' | 'player2';

/** 电脑难度：简单（常失误）/ 普通（偶有失误）/ 宗师（全力） */
export type AiDifficulty = 'easy' | 'normal' | 'master';

/** 英雄职业 */
export type HeroClass = '武曲' | '天师' | '霸魁' | '素问' | '猎户' | '化识' | '通灵';

/** 英雄状态 */
export enum HeroState {
    ALIVE = 'alive',           // 存活
    TEMP_DEAD = 'temp_dead',   // 暂时阵亡
    DEAD = 'dead'              // 真实死亡
}

/** 效果类型 */
export type EffectType = 'buff' | 'debuff' | 'mark' | 'shield' | 'stun' | 'control';

/** 效果数据 */
export interface Effect {
    id: string;
    type: EffectType;
    name: string;              // 如："为道"、"金银错"
    duration: number;          // 持续回合数（-1表示永久）
    expireAtActionSerial?: number;
    value?: number;            // 效果值（如护盾值、伤害加成百分比）
    stackCount?: number;       // 层数
    sourceHeroId: string;      // 来源英雄ID
    linkId?: string;           // 仅供成对/链式效果内部关联，不展示给玩家
    description?: string;      // 效果描述
}

/** 英雄接口 */
export interface Hero {
    // 基础信息
    id: string;
    name: string;
    class: HeroClass;

    // 属性
    maxHp: number;
    currentHp: number;
    moveRange: number;
    baseAttack?: number;       // 基础攻击力（部分英雄有）

    // 位置和状态
    position: Position | null;  // null表示未部署
    state: HeroState;
    owner: Player;

    // 技能
    skill1Id: string;
    skill2Id: string;
    passiveId: string;
    tianweiId?: string;

    // 战斗状态
    effects: Effect[];
    shield: number;            // 护盾值
    defense: number;           // 防御力（百分比减免）

    // 统计
    killCount: number;         // 击杀数（天威触发）
    hasActedThisTurn: boolean; // 本回合是否已行动
    hasMovedThisTurn: boolean; // 本回合是否已移动

    // 特殊计数器（英雄特有的状态层数）
    counters: Record<string, number>; // 如：{"破锋": 3, "财气": 5}
}

/** 技能范围类型 */
export type SkillRangeType =
    | 'single'      // 单体（曼哈顿距离）
    | 'cross'       // 十字（上下左右）
    | 'line'        // 直线（某个方向）
    | 'area'        // 区域（九宫格等）
    | '全场';       // 全场

/** 技能目标类型 */
export type SkillTargetType = 'enemy' | 'ally' | 'self' | 'any' | 'empty';

/** 技能类型 */
export type SkillType = 'damage' | 'heal' | 'buff' | 'debuff' | 'summon' | 'special' | 'control';

/** 技能效果模板 */
export interface EffectTemplate {
    type: EffectType;
    name: string;
    duration: number;
    value?: number;
    stackCount?: number;
    description?: string;
}

/** 技能定义 */
export interface Skill {
    id: string;
    name: string;
    type: SkillType;
    description: string;       // 技能描述

    // 范围
    rangeType: SkillRangeType;
    range: number;             // 最大距离
    areaSize?: number;         // 区域大小（如3表示3x3）

    // 目标
    targetType: SkillTargetType;
    targetCount: number | 'all' | 'random'; // 目标数量

    // 伤害/治疗
    baseDamage?: number;
    baseHeal?: number;
    scalesWithAttack?: boolean; // 是否受基础攻击力加成

    // 施加的效果
    effectsToApply?: EffectTemplate[];

    // 特殊标记
    canCrit?: boolean;         // 能否暴击（默认true）
    ignoreDefense?: boolean;   // 无视防御

    // 执行函数（复杂技能需要自定义逻辑）
    execute?: (caster: Hero, targets: Hero[], gameState: GameState) => SkillExecuteResult;
}

/** 被动技能 */
export interface PassiveSkill {
    id: string;
    name: string;
    description: string;

    // 触发时机
    triggerOn: 'onDamaged' | 'onAttack' | 'onKill' | 'onTurnStart' | 'onTurnEnd' | 'always' | 'onAllyDamaged';

    // 执行函数
    execute: (hero: Hero, gameState: GameState, context?: any) => void;
}

/** 天威技能 */
export interface TianweiSkill {
    id: string;
    name: string;
    description: string;

    // 执行函数（击杀敌人时触发）
    execute: (hero: Hero, gameState: GameState) => void;
}

/** 技能执行结果 */
export interface SkillExecuteResult {
    success: boolean;
    damageDealt?: number[];    // 对各目标造成的伤害
    healingDone?: number[];    // 对各目标的治疗量
    effectsApplied?: Effect[]; // 施加的效果
    triggeredPassives?: string[]; // 触发的被动技能
    log: string[];             // 战斗日志
}

/** 伤害结果 */
export interface DamageResult {
    finalDamage: number;       // 最终伤害
    isCrit: boolean;           // 是否暴击
    vampireAmount: number;     // 吸血量
    shieldDamage: number;      // 护盾承受的伤害
    hpDamage: number;          // 生命值损失
    killed: boolean;           // 是否击杀
    /** 不可规避的固定伤害：直接扣除生命，无视护盾、闪避、免伤替代与伤害转移。 */
    unavoidable?: boolean;
}

/** 单局内按英雄累计的结算数据。召唤物的贡献会归并到其召唤者。 */
export interface BattleStatistics {
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    shieldAbsorbed: number;
    kills: number;
    /** 成功结算的技能一/技能二次数，供战后与平衡性分析使用。 */
    skill1Casts?: number;
    skill2Casts?: number;
    /** 最近一次真实阵亡所在轮次；复活后再次阵亡会覆盖。 */
    lastDeathRound?: number;
}

/** 游戏阶段 */
export type GamePhase = 'menu' | 'online-menu' | 'hero-codex' | 'weapon-codex' | 'career-statistics' | 'hero-select' | 'deploy' | 'battle' | 'ended';


/** 战斗日志条目 */
export interface BattleLogEntry {
    id: string;
    timestamp: number;
    type: 'move' | 'skill' | 'damage' | 'heal' | 'effect' | 'kill' | 'tianwei' | 'passive' | 'system';
    player: Player;
    message: string;
    details?: Record<string, unknown>;
}

/** 全局死亡事件与复活计数器（当前阵亡人数应从 HeroState 实时计算） */
export interface DeathCounters {
    player1Dead: number;       // 玩家1累计获得且尚未消耗的亡灵共鸣
    player2Dead: number;       // 玩家2累计获得且尚未消耗的亡灵共鸣
    totalDead: number;         // 全场累计死亡事件数，不等于当前阵亡人数
    player1Resurrections: number; // 玩家1复活次数（亡灵共鸣）
    player2Resurrections: number;
}

/** 棋盘上的持续区域效果 */
export interface BoardEffect {
    id: string;
    type: 'blade-mark' | 'dark-circle' | 'ice-crystal' | 'sand-dune' | 'brush';
    position: Position;
    owner: Player;
    sourceHeroId: string;
    duration: number;
}

/** 游戏状态 */
export interface GameState {
    /** 单局唯一标识，用于长期统计去重。 */
    matchId?: string;

    // 棋盘
    board: (Hero | null)[][]; // 6x6棋盘
    boardEffects?: BoardEffect[];

    // 玩家英雄
    player1Heroes: Hero[];
    player2Heroes: Hero[];

    // 回合管理
    currentPlayer: Player;
    roundNumber: number;       // 第几轮
    actionsThisTurn: number;   // 本回合已行动次数
    actionsRequiredThisTurn: number; // 本回合需要的行动次数

    // 游戏阶段
    phase: GamePhase;
    winner?: Player;

    // 选中状态（UI用）
    selectedHero: Hero | null;
    activeHero: Hero | null;  // 当前回合正在操作的英雄（锁定状态，防止切换）
    highlightedPositions: Position[]; // 高亮的格子（移动范围或技能范围）
    selectedSkill: Skill | null;

    // 战斗日志
    battleLog: BattleLogEntry[];
    battleStatistics?: Record<string, BattleStatistics>;

    // 全局计数器
    deathCounters: DeathCounters;

    // 英雄选择阶段
    player1SelectedHeroIds: string[];
    player2SelectedHeroIds: string[];
    selectingPlayer: Player;
    player1ReadyHeroSelect: boolean;
    player2ReadyHeroSelect: boolean;
    player1ReadyDeploy: boolean;
    player2ReadyDeploy: boolean;

    // 替补制：六人选将、四人上阵，阵亡后从替补席立即补员
    player1BenchHeroIds?: string[];  // 玩家1替补席（已选将但尚未上场的英雄模板id）
    player2BenchHeroIds?: string[];  // 玩家2替补席
    reinforcingPlayer?: Player | null;          // 当前需要补员上场的一方（null=无）
    reinforcementSelectableHeroId?: string | null; // 补员交互中已点选的替补英雄（UI用）
    reinforceResumeContext?: {       // 补员完成后续跑回合流程所需上下文（endHeroAction 挂起时记录）
        heroId: string;              // 刚结束行动的英雄
        isFinishingExtraActionHero?: boolean;
        isFinishingForcedActionHero?: boolean;
    };

    // 联机模式
    isOnlineMode?: boolean;       // 是否为联机模式
    onlineRoomId?: string;        // 联机房间ID
    localPlayerNumber?: number;   // 本地玩家编号（1或2）
    localPlayerName?: string;     // 本地玩家名称

    // 人机模式
    isAiMode?: boolean;           // 是否由本地电脑控制一方
    aiPlayer?: Player;            // 电脑控制的玩家，当前固定为玩家2
    aiDifficulty?: AiDifficulty;  // 简单/普通/宗师三档（默认宗师）：影响容差、失误率与规划深度

    // 特殊行动标记
    pendingExtraActionHeroIds?: Partial<Record<Player, string>>; // 待执行额外行动的英雄ID（按玩家分槽位）
    performingExtraAction?: boolean;   // 当前是否正在执行额外行动
    resumePlayer?: Player;             // 额外行动结束后应恢复的玩家
    pendingForcedActionHeroId?: string; // 风铃技能1命中的未行动敌人，必须立即完成其正常行动
    performingForcedAction?: boolean;  // 当前锁定英雄是否正在执行被强制的正常行动
    forcedActionResumePlayer?: Player; // 强制行动结束后恢复到的玩家

    // 多阶段技能交互
    baizeReviveTargetHeroId?: string;
    changliSkill2Empowered?: boolean;
    jetzmiSkill1Enhanced?: boolean;
    pendingSkillTargetPositions?: Position[];
    skillOptionFlags?: Record<string, boolean>;
    heroXRedirectTargetIds?: Record<string, string>;
    soulLampBeneficiaryIds?: Record<string, string>;
    skillSelectedHeroIds?: Record<string, string>;
    pendingBoardAction?: {
        type: 'schrodinger-tianwei';
        heroId: string;
    };
    // 李太白被动链：瞬移到历史位置继续攻击，全部用完自动归位
    libaiChainState?: {
        heroId: string;
        home: Position;      // 归位点（本回合移动后的主位置）
        pending: Position[]; // 尚未使用的历史位置
        awaitingPosition: boolean; // true=等待选择历史位置瞬移（此时禁止施法/移动）；false=已瞬移，等待攻击
    };
    // 上官婉儿连冲：命中敌人/毛笔后暂停，等待玩家选择新方向继续冲刺
    shangguanDashState?: {
        heroId: string;
        hitTargets: string[]; // 已命中目标（敌方英雄 id / 毛笔效果 id），不可重复
    };
}

/** 英雄行动 */
export interface HeroAction {
    heroId: string;
    moveTo?: Position;
    skillId?: string;
    targets?: Position[];      // 目标位置（可能是英雄或空地）
}
