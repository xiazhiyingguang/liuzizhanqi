import { nextBattleLogId } from './battle-log-id';
import { wangshuTianwei } from './wangshu';
import { requestMechanismFx } from './mechanism-fx';
// 只排序视觉发射先后，不进入英雄状态；编号会随战报一起同步。
let mirrorBladeFxSequence = 0;
import { Hero, DamageResult, GameState, HeroState, BattleLogEntry, Player, Position } from '../types/game';
import { EffectManager } from './effect-manager';
import { hasZhizhi, heroXRedirectCost, zhizhiValue } from './hero-zhizhi';
import { MovementSystem } from './movement-system';
import {
    moranPassive,
    zhenxiaoPassive,
    getZhenxiaoDamageBonus,
    liuliPassive,
    mowenPassive,
    moranTianwei,
    zhenxiaoTianwei,
    wukongPassive,
    wukongTianwei,
    nightowlTianwei,
    mirrorTianwei,
    mowenTianwei,
    guyingPassive,
    guyingTianwei,
    hanjiangxueTianwei,
    huifengTianwei,
    changliTianwei,
    youjunTianwei,
    getMirrorOwnerIdFromCloneId,
    getWukongCritRate
} from '../data/heroes';
import {
    addSpool,
    applyZhiyuanKnockUp,
    armZhiyuanTianweiLead,
    isZhiyuan,
    noteZhiyuanAttack,
    pickZhiyuanPursueTarget,
    PURSUE_GUARD_KEY,
    zhiyuanKnockUpArmed,
    zhiyuanPursueDamage,
} from './kite-spool';
import {
    addDilanFeather,
    addXiangrui,
    applyDilanWind,
    consumeDilanFeather,
    consumeXiangrui,
    getXiangruiStacks,
    findSoulLampBeneficiary,
    getDilanFeatherStacks,
    getSummonOwnerId,
    getTideStacks,
    totalTideOnEnemiesOf,
    XIANGRUI_TRIGGER_STACKS,
    YUNYING_VAMPIRE_EFFECT,
    purgeYinyangLinksOf,
    getJinghuaStacks,
    JINGHONG_MAX,
} from '../data/extended-heroes';
import { isRealCharacterHero, recordBattleDamage, recordBattleHealing, recordBattleKill } from './battle-statistics';
import { huanongyingTianweiExecute, purgeHnyShadow, purgeZhiguangPrisms, queueYunyingLiehuoBehindTianwei, requestYunyingTianweiLanding, requestZhiguangTianweiLanding, requestSkillFx, requestRecoveryFx, LIANZHI_EFFECT, LIANZHI_PURSUE_DAMAGE, zuiyiCap, JINXUE_EFFECT, grantDuosuiTianwei } from '../data/extended-skills';
import { applyWeaponOnDamageDealt, applyWeaponOnGuard } from './weapon-effects';
import {
    chooseWindLaneDirection,
    createWindLane,
    getWindLaneDodgeRate,
    removeWindLanesOf,
} from './wind-lane';
import {
    expandMarshesForTianwei,
    getMarshDodgeRate,
    isJiangtaigong,
    rollWhaleFall,
} from './water-marsh';

type DamageCalculationOptions = {
    /** 本次普通伤害段必定暴击。 */
    forceCrit?: boolean;
    /** 额外伤害段可明确禁止暴击。 */
    canCrit?: boolean;
    /** 技能自身提供的最终伤害倍率。 */
    damageMultiplier?: number;
    /** 技能自身提供的额外暴击伤害倍率。 */
    critDamageBonus?: number;
    /** 固定伤害：跳过攻击、暴击、防御、增伤和免伤修正。 */
    fixedDamage?: boolean;
    /** 伤害来源标签（burn/bleed/chain…）：写入战报日志 details.fxTag，
     *  供棋盘飘字与格子特效按来源换色。 */
    logTag?: string;
};

/**
 * 伤害计算系统
 */
export class DamageCalculator {
    /**
     * 攻击分组：同一次攻击引发的全部伤害结算（多目标命中、援护分摊、转伤、
     * 纠缠传播等）共享一个组号；「和声」这类"每次攻击触发一次"的效果按组号去重。
     * 独立的 applyDamage 调用自动获得新组号（= 一次攻击）；
     * 多目标单次攻击的技能用 asOneAttack 包住循环，把多次结算并为一次攻击。
     */
    private static attackGroupSeq = 0;
    private static currentAttackGroup: number | null = null;
    // 连枝：一次"出手"的发起者与被命中的敌人。反击/追击的发起者不是他，天然不会被记成出手。
    private static lianzhiOwner: Hero | null = null;
    private static lianzhiHits: Hero[] = [];
    private static lianzhiGroup: number = 0;
    private static lianzhiState: GameState | null = null;
    // 纸鸢「牵丝」：一次出手（含群攻的多个目标）结束后，纸鸢追出一击，所以要记下这一组打了谁
    private static attackTrace: {
        initiator: Hero | null;
        hits: Hero[];
        state: GameState | null;
    } | null = null;

    static asOneAttack<T>(run: () => T): T {
        const previous = this.currentAttackGroup;
        // 只有最外层的那次 asOneAttack 才代表"一次出手"：嵌套的连锁风暴并进来算同一组
        if (previous === null) this.attackTrace = { initiator: null, hits: [], state: null };
        this.currentAttackGroup = ++this.attackGroupSeq;
        try {
            return run();
        } finally {
            this.currentAttackGroup = previous;
            if (previous === null) {
                this.resolveLianzhiFollowUps();
                this.resolveZhiyuanPursue();
                this.resolveJiangtaigongWhaleFall();
                this.attackTrace = null;
            }
        }
    }

    /** 连枝结算：一次出手结束后，绯雪随之追出一击 */
    private static resolveLianzhiFollowUps(): void {
        const owner = this.lianzhiOwner;
        const hits = this.lianzhiHits;
        const state = this.lianzhiState;
        const group = this.lianzhiGroup;
        this.lianzhiOwner = null;
        this.lianzhiHits = [];
        this.lianzhiState = null;
        if (!owner || !state || hits.length === 0) return;

        const bond = owner.effects.find(effect => effect.name === LIANZHI_EFFECT && !!effect.sourceHeroId);
        if (!bond?.sourceHeroId) return;
        const feixue = this.findHeroById(bond.sourceHeroId, state);
        if (!feixue || feixue.owner !== owner.owner || feixue.state !== HeroState.ALIVE) return;

        // 友方这一手触发了天威，绯雪同步吃到一次自己的天威
        if ((owner.counters['__lianzhi_tianwei_group'] ?? -1) === group) {
            this.triggerTianwei(feixue, state);
        }

        const alive = hits.filter(hero => hero.state === HeroState.ALIVE);
        if (alive.length === 0) return;
        const target = alive[Math.floor(Math.random() * alive.length)];
        // 致知2：连枝追击 6 → 7
        const pursueDamage = zhizhiValue(feixue, 2, LIANZHI_PURSUE_DAMAGE, LIANZHI_PURSUE_DAMAGE + 1);
        const targetPosition = target.position ? [...target.position] as [number, number] : null;
        const previousLogIds = new Set(state.battleLog.map(log => log.id));
        const damage = this.calculate(feixue, target, pursueDamage, false, false, { canCrit: false });
        this.applyDamage(target, damage, feixue, state);
        if (feixue.position && targetPosition) requestSkillFx({
            skillId: 'feixue_followup', owner: feixue.owner, sourceHeroId: feixue.id,
            fromPos: [...feixue.position], targetPos: targetPosition,
            impactPositions: [targetPosition], damagePositions: damage.finalDamage > 0 ? [targetPosition] : [],
            logIds: state.battleLog.filter(log => !previousLogIds.has(log.id) && log.details?.sourceHeroId === feixue.id).map(log => log.id),
        }, state);
        // 致知3：连枝的追击也补一层寒天，把冰冻的节奏接在队友身上
        if (hasZhizhi(feixue, 3) && target.state === HeroState.ALIVE) {
            this.applyHantianStacks(target, 1, feixue.id, state);
        }
        this.addBattleLog(state, {
            type: 'passive',
            player: feixue.owner,
            message: `${owner.name}出手未歇，${feixue.name}自连枝追出${damage.finalDamage}点伤害于${target.name}`,
        });
    }

    /**
     * 纸鸢被动「牵丝」：一次出手整组结算完之后追出一击。
     * 单体攻击追那名敌人，群攻从被命中者里随机取一个；追击自身不再触发追击（守卫在 kite-spool）。
     * 只有队友出手才追：她自己的普攻/技能只推进"每 3 次出手附带击飞"的计数，不引出追击。
     */
    private static resolveZhiyuanPursue(): void {
        const trace = this.attackTrace;
        const state = trace?.state;
        const initiator = trace?.initiator;
        if (!trace || !state || !initiator) return;

        const kite = [...state.player1Heroes, ...state.player2Heroes].find(hero =>
            isZhiyuan(hero) && hero.owner === initiator.owner && !hero.counters[PURSUE_GUARD_KEY]);

        if (isZhiyuan(initiator)) noteZhiyuanAttack(initiator);
        // 她自己的出手不算"队友出手"：普攻与技能只推进击飞计数，不引出追击
        if (!kite || !kite.position || kite.id === initiator.id) return;

        const target = pickZhiyuanPursueTarget(kite, trace.hits, state);
        if (!target?.position) return;

        const targetPosition = [...target.position] as [number, number];
        const previousLogIds = new Set(state.battleLog.map(log => log.id));
        kite.counters[PURSUE_GUARD_KEY] = 1;
        try {
            const damage = this.calculate(kite, target, zhiyuanPursueDamage(kite), false, false, { canCrit: false });
            // 这一笔 applyDamage 自己会开一个"出手组"，因此追击的出手计数由那一组结束时累计，
            // 这里不再重复 noteZhiyuanAttack，否则"每 3 次附带击飞"会被追一击推进两格
            this.applyDamage(target, damage, kite, state);
            if (target.state === HeroState.ALIVE) addSpool(target, kite);
            this.addBattleLog(state, {
                type: 'passive',
                player: kite.owner,
                message: `${initiator.name}出手未歇，${kite.name}顺线追出${damage.finalDamage}点伤害并牵上「线轴」`,
            });
            requestSkillFx({
                skillId: 'zhiyuan_pursue',
                owner: kite.owner,
                sourceHeroId: kite.id,
                fromPos: [...kite.position],
                targetPos: targetPosition,
                impactPositions: [targetPosition],
                damagePositions: damage.finalDamage > 0 ? [targetPosition] : [],
                logIds: state.battleLog.filter(log => !previousLogIds.has(log.id)).map(log => log.id),
            }, state);
        } finally {
            delete kite.counters[PURSUE_GUARD_KEY];
        }
    }

    /**
     * 姜太公被动「太公垂钩」：他自己一次出手整组结算完之后掷一次鲸落概率。
     * 概率累加、水泽门槛与落点随机都在 water-marsh 里收口；鲸落自己的伤害会再开一个出手组，
     * 靠守卫键挡住递归。
     */
    private static resolveJiangtaigongWhaleFall(): void {
        const trace = this.attackTrace;
        const state = trace?.state;
        const initiator = trace?.initiator;
        if (!trace || !state || !initiator) return;
        if (!isJiangtaigong(initiator)) return;
        rollWhaleFall(state, initiator);
    }

    private static recordLianzhiStrike(attacker: Hero, target: Hero, gameState: GameState): void {
        if (attacker.owner === target.owner) return;
        if (!this.lianzhiOwner) {
            this.lianzhiOwner = attacker;
            this.lianzhiGroup = this.currentAttackGroup ?? 0;
            this.lianzhiState = gameState;
        }
        if (this.lianzhiOwner !== attacker) return;
        if (!this.lianzhiHits.includes(target)) this.lianzhiHits.push(target);
    }

    private static getWukongOwnerIdFromCloneId(cloneId: string): string | null {
        const parts = cloneId.split('|');
        if (parts.length < 3) return null;
        if (parts[0] !== 'wukong-clone') return null;
        return parts[1] || null;
    }

    private static syncWukongCritToSelfAndClones(wukong: Hero, gameState: GameState): void {
        const critRate = getWukongCritRate(wukong);

        wukong.effects = wukong.effects.filter(e => e.name !== '悟空暴击率');
        wukong.effects.push({
            id: `effect-${Date.now()}-${Math.random()}`,
            type: 'buff',
            name: '悟空暴击率',
            duration: -1,
            value: critRate,
            sourceHeroId: wukong.id,
            description: '基础暴击率与灵犀叠加',
        });

        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const h = gameState.board[r][c];
                if (!h) continue;
                if (!h.counters || h.counters['__isClone'] !== 1) continue;
                if (this.getWukongOwnerIdFromCloneId(h.id) !== wukong.id) continue;

                h.effects = h.effects.filter(e => e.name !== '悟空暴击率');
                h.effects.push({
                    id: `effect-${Date.now()}-${Math.random()}`,
                    type: 'buff',
                    name: '悟空暴击率',
                    duration: -1,
                    value: critRate,
                    sourceHeroId: wukong.id,
                    description: '基础暴击率与灵犀叠加',
                });
            }
        }
    }

    /** 本体与各自镜像在棋盘上的落点 */
    private static mirrorBladeOrigins(hero: Hero, gameState: GameState): Position[] {
        const origins: Position[] = hero.position ? [[...hero.position] as Position] : [];
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const h = gameState.board[r][c];
                if (!h || h.state !== HeroState.ALIVE) continue;
                if (h.counters?.['__isClone'] !== 1) continue;
                if (getMirrorOwnerIdFromCloneId(h.id) !== hero.id) continue;
                if (h.position) origins.push([...h.position] as Position);
            }
        }
        return origins;
    }

    /**
     * 「镜域」= 本体与镜像两点张成的外接矩形（含四周边界格）。
     * 场上没有镜像时矩形退化成一格、谁也罩不住，此时退回本体周围 5×5 一片，
     * 让天威攒下的层数仍然有地方可斩。
     */
    private static mirrorBladeZone(hero: Hero, gameState: GameState): Set<string> {
        const origins = this.mirrorBladeOrigins(hero, gameState);
        const cells = new Set<string>();
        if (origins.length === 0) return cells;

        if (origins.length === 1) {
            const [row, col] = origins[0];
            for (let r = row - 2; r <= row + 2; r++) {
                for (let c = col - 2; c <= col + 2; c++) {
                    if (MovementSystem.inBounds([r, c])) cells.add(`${r},${c}`);
                }
            }
            return cells;
        }

        const rows = origins.map(([r]) => r);
        const cols = origins.map(([, c]) => c);
        for (let r = Math.min(...rows); r <= Math.max(...rows); r++) {
            for (let c = Math.min(...cols); c <= Math.max(...cols); c++) cells.add(`${r},${c}`);
        }
        return cells;
    }

    /**
     * 立即消耗破镜之刃：斩镜域内生命最低的敌人，一层一击。
     * 返回本次真正消耗的层数。announceIdle 只在"刚拿到层数"的三个时机传 true——
     * 镜域里没人时补一条留存战报，免得叠了却毫无反馈；位置联动的补放不刷这条。
     */
    static triggerMirrorBrokenBlade(hero: Hero, gameState: GameState, announceIdle = false): number {
        if (hero.state !== HeroState.ALIVE) return 0;
        if (hero.passiveId !== 'mirror_passive') return 0;
        if (!hero.position) return 0;

        let consumed = 0;
        const bladeBatchId = nextBattleLogId();
        while (EffectManager.getCounter(hero, '破镜之刃') > 0) {
            const zone = this.mirrorBladeZone(hero, gameState);
            const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;

            let target: Hero | null = null;
            let minHp = Infinity;
            for (const enemy of enemies) {
                if (enemy.state !== HeroState.ALIVE || !enemy.position) continue;
                if (!zone.has(`${enemy.position[0]},${enemy.position[1]}`)) continue;
                if (enemy.currentHp < minHp) {
                    minHp = enemy.currentHp;
                    target = enemy;
                }
            }
            if (!target) break;

            EffectManager.addCounter(hero, '破镜之刃', -1);
            const bladeFrom = hero.position ? [...hero.position] as [number, number] : null;
            // 阵亡/反击可能改写位置，动线必须保留攻击发生前的快照。
            const bladeTarget = [...target.position!] as [number, number];
            const previousLogIds = new Set(gameState.battleLog?.map(entry => entry.id));
            const bladeOrder = ++mirrorBladeFxSequence;
            // 致知3：「破镜之刃」的伤害 5 → 7
            const damageResult = this.calculate(hero, target, zhizhiValue(hero, 3, 5, 7), false);
            this.applyDamage(target, damageResult, hero, gameState);

            if (gameState.battleLog) {
                // 击杀天威会递归释放新镜刃，那些日志归它们各自的飞刃，不能重复认领。
                const newLogs = gameState.battleLog.filter(entry => !previousLogIds.has(entry.id));
                const nestedIds = new Set(newLogs.flatMap(entry => entry.details?.fxSkillId === 'mirror_blade'
                    ? [entry.id, ...(entry.details.fxLogIds as string[] ?? [])] : []));
                gameState.battleLog.push({
                    id: nextBattleLogId(),
                    type: 'passive' as const,
                    player: hero.owner,
                    message: `${hero.name}触发"破镜之刃"，对${target.name}造成${damageResult.finalDamage}点伤害`,
                    details: {
                        kind: 'mirror-blade-strike',
                        // 特效标记：Board 读到后派发"破镜飞刃"动画（镜刃自镜的位置飞向受害者）
                        fxSkillId: 'mirror_blade',
                        fxFrom: bladeFrom ?? undefined,
                        fxTarget: bladeTarget,
                        fxBladeBatchId: bladeBatchId,
                        fxBladeOrder: bladeOrder,
                        fxSourceHeroId: hero.id,
                        fxTargetHeroId: target.id,
                        fxLogIds: newLogs.filter(entry => !nestedIds.has(entry.id)).map(entry => entry.id),
                    },
                    timestamp: Date.now()
                });
            }
            consumed++;
        }

        if (announceIdle && consumed === 0) {
            const left = EffectManager.getCounter(hero, '破镜之刃');
            if (left > 0) {
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: hero.owner,
                    message: `${hero.name}的镜域内空无一人，破镜之刃留存${left}层`,
                });
            }
        }
        return consumed;
    }

    /**
     * 位置联动补放：敌人被击退、走位或传送进镜域后，把先前留存的破镜之刃当场斩掉。
     * 由 syncPositionAnchoredEffects 统一调用，覆盖主动移动与一切强制位移。
     */
    static settleIdleMirrorBlades(gameState: GameState): boolean {
        let fired = false;
        for (const hero of [...gameState.player1Heroes, ...gameState.player2Heroes]) {
            if (hero.state !== HeroState.ALIVE || hero.passiveId !== 'mirror_passive') continue;
            if (EffectManager.getCounter(hero, '破镜之刃') <= 0) continue;
            if (this.triggerMirrorBrokenBlade(hero, gameState) > 0) fired = true;
        }
        return fired;
    }

    /**
     * 计算最终伤害
     * @param attacker 攻击者
     * @param target 目标
     * @param baseDamage 基础伤害
     * @param scalesWithAttack 是否受基础攻击力加成
     * @param gameState 游戏状态
     * @returns 伤害结果
     */
    static calculate(
        attacker: Hero,
        target: Hero,
        baseDamage: number,
        scalesWithAttack: boolean = false,
        ignoreDefense: boolean = false,
        options: DamageCalculationOptions = {}
    ): DamageResult {
        let finalDamage = baseDamage;

        if (options.fixedDamage) {
            return {
                finalDamage: Math.floor(Math.max(0, finalDamage)),
                isCrit: false,
                vampireAmount: 0,
                shieldDamage: 0,
                hpDamage: 0,
                killed: false,
                unavoidable: true,
                logTag: options.logTag,
            };
        }

        // 1. 基础攻击力加成
        if (scalesWithAttack && attacker.baseAttack) {
            // 获取所有攻击力加成（同类相加）
            const attackBonuses = this.getModifiers(attacker, 'attackBonus');
            const totalAttackBonus = attackBonuses.reduce((sum, bonus) => sum + bonus, 0);
            finalDamage += attacker.baseAttack * (1 + totalAttackBonus);
        }

        // 2. 增伤效果（不同类相乘）
        const damageBonuses = this.getModifiers(attacker, 'damageBonus');
        for (const bonus of damageBonuses) {
            finalDamage *= (1 + bonus);
        }
        // 惊鸿·止水被动「渊渟岳峙」：生命高于50%为攻击形态，增伤50%。
        // 走增伤而非"攻击提升"通道——后者要 attacker.baseAttack 才生效，她并没有基础攻击力。
        if (
            attacker.passiveId === 'jinghong_passive' &&
            attacker.owner !== target.owner &&
            attacker.maxHp > 0 &&
            attacker.currentHp * 2 > attacker.maxHp
        ) {
            finalDamage *= 1.5;
        }
        // 镜花·水月被动「镜湖双照」：每层镜影提升10%攻击（走增伤通道，她没有基础攻击力）
        if (attacker.passiveId === 'jinghua_passive' && attacker.owner !== target.owner) {
            const jingying = getJinghuaStacks(attacker);
            if (jingying > 0) {
                finalDamage *= 1 + 0.1 * jingying;
            }
        }
        // 震霄被动「血锋」：每失去2%生命提升1%增伤——他靠耗血起手，越残血越痛。
        // 同样走增伤通道：震霄 baseAttack 为 0，"攻击提升"那一档对他永远是空加成。
        if (attacker.passiveId === 'zhenxiao_passive' && attacker.owner !== target.owner) {
            const bloodEdge = getZhenxiaoDamageBonus(attacker);
            if (bloodEdge > 0) {
                finalDamage *= 1 + bloodEdge;
            }
        }
        finalDamage *= options.damageMultiplier ?? 1;
        for (const effect of attacker.effects) {
            if (effect.type === 'debuff' && effect.value !== undefined &&
                (effect.name.includes('攻击降低') || effect.name === '恐惧')) {
                finalDamage *= Math.max(0, 1 - effect.value * (effect.stackCount ?? 1));
            }
        }

        if (target.effects.some(e => e.name === '观测坍缩未受伤')) {
            finalDamage *= 1.5;
            target.effects = target.effects.filter(e => e.name !== '观测坍缩未受伤');
        }

        if (attacker.name === '孤影' && attacker.owner !== target.owner) {
            const hasHantian = target.effects.some(e => e.name === '寒天' && (e.stackCount ?? 1) > 0);
            if (hasHantian) {
                finalDamage *= 1.2;
            }
        }

        // 3. 暴击判定
        let critRate = this.getCritRate(attacker);

        // 夜枭致知1：每潜行一回合，暴击率提升30%
        if (attacker.name === '暗影猎手·夜枭' && attacker.effects.some(e => e.name === '潜行')) {
            if (attacker.counters['talent_1']) {
                const stealthTurns = attacker.counters['stealth_turns'] || 0;
                critRate += stealthTurns * 0.3;
            }
        }

        // 夜枭技能1：对被标记目标的首次攻击必定暴击
        let guaranteedCrit = false;
        if (attacker.name === '暗影猎手·夜枭') {
            const markEffect = target.effects.find(e => e.name === '猎杀标记' && e.sourceHeroId === attacker.id);
            if (markEffect && !attacker.counters['mark_first_hit_consumed']) {
                guaranteedCrit = true;
            }
        }

        const isCrit = options.canCrit !== false && (
            options.forceCrit === true || guaranteedCrit || Math.random() < critRate
        );
        if (isCrit) {
            let critDamage = this.getCritDamage(attacker);
            // 夜枭致知3：暴击伤害提升40%
            if (attacker.name === '暗影猎手·夜枭' && attacker.counters['talent_3']) {
                critDamage += 0.4;
            }
            critDamage += options.critDamageBonus ?? 0;
            finalDamage *= critDamage; // 基础1.5倍
        }

        // 4. 防御减免
        if (!ignoreDefense) {
            let defense = target.defense;
            for (const effect of target.effects) {
                if (effect.value === undefined) continue;
                if (effect.type === 'buff' &&
                    (effect.name.includes('免伤') || effect.name.includes('防御') || effect.name === '来财')) {
                    defense += effect.value * (effect.stackCount ?? 1);
                }
                if (effect.type === 'debuff' && effect.name.includes('防御降低')) {
                    defense -= effect.value * (effect.stackCount ?? 1);
                }
            }

            // 墨阑"为道"状态：期间防御提升30%（致知3：免伤提升到60%）
            if (
                target.passiveId === 'moran_passive' &&
                target.effects.some(e => e.name === '为道')
            ) {
                defense += target.counters['talent_3'] ? 0.6 : 0.3;
            }

            // 血契被动：每损失 2% 生命提升 1% 防御，残血时最硬（上限约 50%）
            if (target.passiveId === 'xueqi_passive' && target.maxHp > 0) {
                const missingRatio = Math.max(0, (target.maxHp - target.currentHp) / target.maxHp);
                defense += Math.floor(missingRatio * 50) * 0.01;
            }

            // 惊鸿·止水被动「渊渟岳峙」：生命≤50%转入防御形态，防御提升50%。
            // 阈值归给防御侧，免得恰好一半血时既吃增伤又吃免伤。
            if (
                target.passiveId === 'jinghong_passive' &&
                target.maxHp > 0 &&
                target.currentHp * 2 <= target.maxHp
            ) {
                defense += 0.5;
            }

            // 琉璃致知3：每层「禅定」再提供 10% 免伤（禅定是她替队友承伤攒下的层数）
            if (target.passiveId === 'liuli_passive') {
                const zen = target.counters['禅定'] ?? 0;
                if (zen > 0 && hasZhizhi(target, 3)) defense += zen * 0.1;
            }

            // 夜枭天威：下次攻击无视目标50%防御
            if (attacker.name === '暗影猎手·夜枭' && attacker.counters['ignore_defense_next']) {
                defense *= 0.5;
            }

            finalDamage *= Math.max(0, 1 - defense);
        }

        // 5. 免伤效果
        const damageReduction = this.getModifiers(target, 'damageReduction');
        for (const reduction of damageReduction) {
            finalDamage *= Math.max(0, 1 - reduction);
        }

        // 冰甲：受到的伤害降低 20%（寒江雪致知3 抬到 40%，建甲时已按施术者写进 value）
        const iceArmor = target.effects.find(e => e.name === '冰甲');
        if (iceArmor) {
            finalDamage *= Math.max(0, 1 - (iceArmor.value ?? 0.2));
        }

        // 6. 取整
        finalDamage = Math.floor(Math.max(0, finalDamage));

        // 7. 吸血计算
        const vampireRate = this.getModifiers(attacker, 'vampire').reduce((sum, v) => sum + v, 0);
        const vampireAmount = Math.floor(finalDamage * vampireRate);

        return {
            finalDamage,
            isCrit,
            vampireAmount,
            shieldDamage: 0,
            hpDamage: 0,
            killed: false,
            logTag: options.logTag
        };
    }

    /**
     * 云缨「祥瑞」叠层与「烈火燎原」引燃。
     * - 烈火燎原自身的命中不再叠祥瑞（__liehuo_resolving 标记），避免自燃循环；
     * - 叠满 3 层即清空该目标身上的祥瑞，并挂起玩家的方向选择（射线由 game-store 结算）；
     * - 每轮至多引燃一次；额度已用完时保留 3 层，等下一轮再引燃。
     * @param stacksBefore 这一击**之前**目标身上的祥瑞层数。引燃判定必须按"这一击之后会有几层"算：
     *        致命一击会先把目标移出战场，等结算完再读层数就永远凑不满第 3 层。
     */
    private static applyYunyingXiangrui(
        attacker: Hero,
        target: Hero,
        gameState: GameState,
        stacksBefore: number
    ): void {
        if (attacker.counters['__liehuo_resolving'] === 1) return;

        const stacks = Math.min(XIANGRUI_TRIGGER_STACKS, stacksBefore + 1);
        // 层数只往还活着的敌人身上写；尸体上的印记既不可见也没有后续意义
        const stillOnBoard = target.state === HeroState.ALIVE;
        if (stillOnBoard) addXiangrui(target, attacker);
        if (stacks < XIANGRUI_TRIGGER_STACKS) return;
        if ((attacker.counters['liehuo_round'] ?? -1) === gameState.roundNumber) return;
        const pending = gameState.pendingBoardAction;
        // 她自己的天威正占着挂起槽：策划口径是"先天威、后燎原"，此时引燃改走排队，
        // 不能因为一次命中的先后顺序就把这次燎原整个吞掉
        const behindOwnTianwei = pending?.type === 'yunying-tianwei' && pending.heroId === attacker.id;
        // 已有别的待选棋盘动作时不抢占，目标身上的 3 层留着等下一次机会
        if (pending && !behindOwnTianwei) return;

        if (stillOnBoard) consumeXiangrui(target);
        attacker.counters['liehuo_round'] = gameState.roundNumber;
        if (behindOwnTianwei) queueYunyingLiehuoBehindTianwei(attacker);
        else gameState.pendingBoardAction = { type: 'yunying-liehuo', heroId: attacker.id };
        this.addBattleLog(gameState, {
            type: 'passive',
            player: attacker.owner,
            message: `${target.name}的祥瑞积满${XIANGRUI_TRIGGER_STACKS}层，${attacker.name}的烈火燎原被引燃：请选择燃烧方向`,
        });
    }

    /**
     * 结算羽化的逐格固定伤害；返回本次移动造成的总伤害。
     *
     * movedByOwner 省略 = 目标在自己行动阶段主动走的路，羽化照常逐格掉血。
     * 传入"造成这次位移的一方"时，只有他和羽化来源同队（我方把敌人吹开、拖过来、
     * 顺着风道推走）才记账；敌方技能造成的位移——包括目标自己的冲刺、瞬移、
     * 换位、传送——不再触发羽化，羽化因此只惩罚"被对手摆布的位置"和"自己抬脚走路"。
     */
    static applyDilanMovementDamage(
        target: Hero,
        movedSteps: number,
        gameState: GameState,
        movedByOwner?: Player
    ): number {
        if (movedSteps <= 0 || target.state !== HeroState.ALIVE) return 0;
        const featherSources = target.effects
            .filter(effect => effect.name === '羽化' && (effect.stackCount ?? 0) > 0)
            .map(effect => this.findHeroById(effect.sourceHeroId, gameState))
            .filter((source): source is Hero =>
                !!source &&
                // 帝兰、南风与游隼共用同一份羽化层数；逐格伤害按种下羽化的来源结算
                (source.passiveId === 'dilan_passive' ||
                    source.passiveId === 'nanfeng_passive' ||
                    source.passiveId === 'youjun_passive') &&
                source.state === HeroState.ALIVE &&
                source.owner !== target.owner &&
                (!movedByOwner || movedByOwner === source.owner)
            );

        let totalDamage = 0;
        for (const source of featherSources) {
            if (target.state !== HeroState.ALIVE) break;
            const damagePerStep = source.counters['talent_3'] ? 2 : 1;
            const damage = this.calculate(
                source,
                target,
                movedSteps * damagePerStep,
                false,
                true,
                { canCrit: false, fixedDamage: true }
            );
            this.applyDamage(target, damage, source, gameState);
            totalDamage += damage.finalDamage;
        }
        return totalDamage;
    }

    /**
     * 结算「流血」效果的移动伤害（逐格固定伤害，每格 effect.value 点）。
     * 当前版本没有任何技能施加流血，本方法为通用位移结算的惰性兜底，
     * 供游隼冲刺等强制位移路径统一调用；无流血效果时始终返回 0。
     */
    static applyBleedMovementDamage(target: Hero, movedSteps: number, gameState: GameState): number {
        if (movedSteps <= 0 || target.state !== HeroState.ALIVE) return 0;
        const bleedSources = target.effects
            .filter(effect => effect.name === '流血' && (effect.value ?? 0) > 0)
            .map(effect => this.findHeroById(effect.sourceHeroId, gameState))
            .filter((source): source is Hero =>
                !!source && source.state === HeroState.ALIVE && source.owner !== target.owner
            );

        let totalDamage = 0;
        for (const source of bleedSources) {
            if (target.state !== HeroState.ALIVE) break;
            const damage = this.calculate(
                source,
                target,
                movedSteps * (target.effects.find(
                    effect => effect.name === '流血' && effect.sourceHeroId === source.id
                )?.value ?? 2),
                false,
                true,
                { canCrit: false, fixedDamage: true, logTag: 'bleed' }
            );
            this.applyDamage(target, damage, source, gameState);
            totalDamage += damage.finalDamage;
        }
        return totalDamage;
    }

    /**
     * 应用伤害到目标
     */
    static applyDamage(
        target: Hero,
        damageResult: DamageResult,
        attacker: Hero,
        gameState: GameState,
        isAreaDamage: boolean = false
    ): void {
        // 独立调用即"一次攻击"；已在某次攻击的结算链内则并入该组（援护分摊/转伤/纠缠传播不另计攻击）
        if (this.currentAttackGroup === null) {
            this.asOneAttack(() => this.applyDamageInner(target, damageResult, attacker, gameState, isAreaDamage));
            return;
        }
        this.applyDamageInner(target, damageResult, attacker, gameState, isAreaDamage);
    }

    private static applyDamageInner(
        target: Hero,
        damageResult: DamageResult,
        attacker: Hero,
        gameState: GameState,
        isAreaDamage: boolean = false
    ): void {
        const targetWasAlive = target.state === HeroState.ALIVE;
        // 记这一次"出手"的发起者与被命中者：纸鸢的追击要在整组结算完之后才追（群攻随机取一个）
        if (this.attackTrace) {
            if (!this.attackTrace.initiator) this.attackTrace.initiator = attacker;
            this.attackTrace.state = gameState;
            if (targetWasAlive && !this.attackTrace.hits.includes(target)) this.attackTrace.hits.push(target);
        }
        const unavoidable = damageResult.unavoidable === true;
        if (!unavoidable && attacker.owner !== target.owner && damageResult.finalDamage > 0) {
            const allies = attacker.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            if (attacker.passiveId === 't_painting_passive') {
                const summons = allies.filter(hero =>
                    hero.state === HeroState.ALIVE &&
                    hero.counters['__isSummon'] === 1 &&
                    hero.id.split('|')[2] === attacker.id
                ).length;
                damageResult.finalDamage += summons;
            }
            // 五弦琵琶「音符」：友方造成伤害时附加琵琶基础攻击力25%，并入本次伤害一并结算
            const note = attacker.effects.find(e => e.name === '音符');
            if (note?.sourceHeroId) {
                const pipa = this.findHeroById(note.sourceHeroId, gameState);
                if (pipa?.state === HeroState.ALIVE) {
                    damageResult.finalDamage += Math.max(1, Math.floor((pipa.baseAttack ?? 8) * (note.value ?? 0.25)));
                }
            }
        }
        let remainingDamage = damageResult.finalDamage;
        let actualTarget = target;
        let maxEffectiveDamageForKill = unavoidable ? target.currentHp : (target.currentHp + target.shield);

        // 增势：每攒够 redirectCost 层就能把一次伤害转给队友（致知3 把门槛从 3 降到 2）。
        // 门槛只认 heroXRedirectCost() 这一个口径——界面与 AI 也读它，写死数字会让致知3 半失效。
        const redirectCost = heroXRedirectCost(target);
        if (
            !unavoidable &&
            target.passiveId === 'hero_x_passive' &&
            (target.counters['增势'] ?? 0) >= redirectCost &&
            target.counters['__hero_x_redirecting'] !== 1
        ) {
            const redirectId = gameState.heroXRedirectTargetIds?.[target.id];
            const redirect = redirectId ? this.findHeroById(redirectId, gameState) : null;
            if (redirect?.state === HeroState.ALIVE && redirect.owner === target.owner && redirect.id !== target.id) {
                target.counters['增势'] -= redirectCost;
                target.counters['__hero_x_redirecting'] = 1;
                const redirected = this.calculate(attacker, redirect, Math.floor(remainingDamage * 0.5), false, true);
                this.applyDamage(redirect, redirected, attacker, gameState, isAreaDamage);
                delete target.counters['__hero_x_redirecting'];
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.hpDamage = 0;
            }
        }

        const nightowlStealthed = target.name === '暗影猎手·夜枭' && EffectManager.hasEffect(target, '潜行');
        if (!unavoidable && nightowlStealthed) {
            if (!isAreaDamage) {
                damageResult.finalDamage = 0;
                remainingDamage = 0;
            } else {
                const currentRoundDamage = target.counters['stealth_damage_taken'] || 0;
                const maxDamagePerRound = 10;
                const availableDamageQuota = Math.max(0, maxDamagePerRound - currentRoundDamage);

                if (remainingDamage > availableDamageQuota) {
                    remainingDamage = availableDamageQuota;
                    damageResult.finalDamage = remainingDamage;
                }

                target.counters['stealth_damage_taken'] = currentRoundDamage + remainingDamage;
            }
        }

        // 消耗夜枭的天威（无视防御）
        if (attacker.name === '暗影猎手·夜枭' && attacker.counters['ignore_defense_next']) {
            attacker.counters['ignore_defense_next'] = 0;
        }

        // 消耗夜枭的标记必暴
        if (attacker.name === '暗影猎手·夜枭') {
             const markEffect = target.effects.find(e => e.name === '猎杀标记' && e.sourceHeroId === attacker.id);
             if (markEffect && !attacker.counters['mark_first_hit_consumed']) {
                 attacker.counters['mark_first_hit_consumed'] = 1;
             }
        }

        // 0. 检查援护效果（琉璃/沉渊的技能）
        const guardEffect = target.effects.find(e => e.name === '援护');

        if (!unavoidable && guardEffect && guardEffect.sourceHeroId) {
            // 找到援护来源（琉璃/沉渊）
            const guardianHero = this.findHeroById(guardEffect.sourceHeroId, gameState);

            if (guardianHero && guardianHero.state === HeroState.ALIVE && guardianHero.id !== target.id) {
                // value 为承担比例：缺省视为1（琉璃全额承担）；沉渊为0.3（承担30%）
                const guardShare = guardEffect.value ?? 1;

                if (guardShare >= 1) {
                    // 全额转移：将伤害转由援护者结算
                    actualTarget = guardianHero;
                    maxEffectiveDamageForKill = guardianHero.currentHp + guardianHero.shield;

                    // 援护效果持续到琉璃下次行动，不在这里移除
                    // 会在skill-system.ts的removeGuardEffectsFromLiuli中移除

                    // 触发琉璃的被动（增加禅定）
                    this.triggerPassiveSkill(guardianHero, 'onAllyDamaged', gameState, {
                        isGuardTrigger: true,
                        originalTarget: target
                    });
                    // 净琉璃：援护成功时按武器概率追加禅定
                    applyWeaponOnGuard(guardianHero);

                    // 添加日志
                    if (gameState.battleLog) {
                        const logEntry = {
                            id: nextBattleLogId(),
                            type: 'passive' as const,
                            player: guardianHero.owner,
                            message: `${guardianHero.name}援护${target.name}，承担了${remainingDamage}点伤害`,
                            timestamp: Date.now()
                        };
                        gameState.battleLog.push(logEntry);
                    }
                } else if (remainingDamage > 0) {
                    // 部分转移：援护者按比例承担一部分伤害，剩余仍由原目标承受
                    const sharedAmount = Math.floor(remainingDamage * guardShare);
                    if (sharedAmount > 0) {
                        const sharedResult = this.calculate(attacker, guardianHero, sharedAmount, false, true);
                        this.applyDamage(guardianHero, sharedResult, attacker, gameState, isAreaDamage);
                        remainingDamage -= sharedResult.finalDamage;
                        damageResult.finalDamage = remainingDamage;

                        // 触发援护者的 onAllyDamaged 被动（与全额援护保持一致）
                        this.triggerPassiveSkill(guardianHero, 'onAllyDamaged', gameState, {
                            isGuardTrigger: true,
                            originalTarget: target
                        });

                        if (gameState.battleLog) {
                            gameState.battleLog.push({
                                id: nextBattleLogId(),
                                type: 'passive' as const,
                                player: guardianHero.owner,
                                message: `${guardianHero.name}援护${target.name}，承担了${sharedResult.finalDamage}点伤害`,
                                timestamp: Date.now()
                            });
                        }
                    }
                }
            }
        }

        if (
            !unavoidable &&
            remainingDamage > 0 &&
            actualTarget.state === HeroState.ALIVE &&
            actualTarget.passiveId === 'mowen_passive' &&
            attacker.owner !== actualTarget.owner
        ) {
            const hpRatio = actualTarget.maxHp > 0 ? actualTarget.currentHp / actualTarget.maxHp : 0;
            const threshold = actualTarget.counters['talent_3'] ? 0.5 : 0.3;
            const chance = hpRatio < threshold ? 0.5 : 0.25;

            if (Math.random() < chance) {
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.shieldDamage = 0;
                damageResult.hpDamage = 0;

                if (gameState.battleLog) {
                    gameState.battleLog.push({
                        id: nextBattleLogId(),
                        type: 'passive' as const,
                        player: actualTarget.owner,
                        message: `${actualTarget.name}触发时间裂隙，闪避本次伤害`,
                        timestamp: Date.now()
                    });
                }
            }
        }

        // 冰甲：攻击冰甲所有者后，攻击者获得1层寒天（来源为冰甲提供者）
        if (
            remainingDamage > 0 &&
            attacker.state === HeroState.ALIVE &&
            attacker.owner !== actualTarget.owner
        ) {
            const armor = actualTarget.effects.find(e => e.name === '冰甲');
            if (armor?.sourceHeroId) {
                this.applyHantianStacks(attacker, 1, armor.sourceHeroId, gameState);
            }
        }

        const hpBeforeDamage = actualTarget.currentHp;
        // 祥瑞必须按"这一击之后会有几层"判定，而不是"目标还活着时身上有几层"：
        // 致命一击会先把目标移出战场，若等结算完再读层数，第3层永远落不上去，
        // 烈火燎原就再也引不燃（表现：击杀触发了天威，燎原却静默不出现）。
        const xiangruiStacksBefore = attacker.passiveId === 'yunying_passive'
            ? getXiangruiStacks(actualTarget)
            : 0;
        if (
            !unavoidable &&
            remainingDamage > 0 &&
            actualTarget.passiveId === 'xuanxiao_passive' &&
            actualTarget.counters['xuanxiao_danger_armed'] === 1
        ) {
            // 致知3：转化值提升 2 倍（一次转化掉两倍伤害）
            const convertMultiplier = zhizhiValue(actualTarget, 3, 1, 2);
            const healed = this.applyHeal(actualTarget, remainingDamage * convertMultiplier, gameState);
            actualTarget.counters['xuanxiao_danger_armed'] = 0;
            actualTarget.counters['xuanxiao_danger_used'] = 1;
            remainingDamage = 0;
            damageResult.finalDamage = 0;
            damageResult.hpDamage = 0;
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: nextBattleLogId(),
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}触发化险为夷，将伤害转化为${healed}点治疗`,
                    timestamp: Date.now()
                });
            }
            requestMechanismFx(actualTarget, 'xuanxiao_conversion', gameState, {
                fromPos: attacker.position ?? actualTarget.position ?? undefined,
                logId: gameState.battleLog[gameState.battleLog.length - 1]?.id,
            });
        }

        // 镜花·水月被动「镜湖双照」：每层镜影提供10%闪避（上限5层=50%），只闪不反击
        if (
            !unavoidable &&
            remainingDamage > 0 &&
            actualTarget.passiveId === 'jinghua_passive' &&
            attacker.owner !== actualTarget.owner
        ) {
            const jingying = getJinghuaStacks(actualTarget);
            if (jingying > 0 && Math.random() < jingying * 0.1) {
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.shieldDamage = 0;
                damageResult.hpDamage = 0;
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}镜光晃影，闪避了${attacker.name}的攻击`
                });
            }
        }

        // 醉枕刀被动：醉意闪避与反击
        // 受击时以 醉意x10% 概率闪避（免伤）；未闪避则承受伤害并反击攻击者醉意x3真实伤害，随后-1醉意
        if (
            !unavoidable &&
            remainingDamage > 0 &&
            actualTarget.passiveId === 'zuizhendao_passive' &&
            attacker.owner !== actualTarget.owner &&
            attacker.state === HeroState.ALIVE &&
            actualTarget.counters['__zuizhendao_countered'] !== 1
        ) {
            const zuiyi = EffectManager.getCounter(actualTarget, '醉意');
            const dodgeRate = Math.min(0.9, zuiyi * 0.1);
            if (Math.random() < dodgeRate) {
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.shieldDamage = 0;
                damageResult.hpDamage = 0;
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}醉意护体，闪避了${attacker.name}的攻击`
                });
            } else {
                // 真实伤害反击（无视防御），随后醉意-1
                const counterDamage = this.calculate(actualTarget, attacker, zuiyi * 3, false, true);
                if (counterDamage.finalDamage > 0) {
                    attacker.counters['__zuizhendao_countered'] = 1;
                    this.applyDamage(attacker, counterDamage, actualTarget, gameState);
                    delete attacker.counters['__zuizhendao_countered'];
                }
                EffectManager.addCounter(actualTarget, '醉意', -1);
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}承受攻击后反击${attacker.name}${counterDamage.finalDamage}点伤害，醉意-1`
                });
            }
        }

        // 沙丘闪避只在风铃位于自己创造的沙丘内时生效，且使用此前受伤累积的层数。
        if (
            !unavoidable &&
            remainingDamage > 0 &&
            actualTarget.passiveId === 'fengling_passive' &&
            attacker.owner !== actualTarget.owner &&
            this.isInOwnSandDune(actualTarget, gameState)
        ) {
            const sandDodgeStacks = Math.min(5, EffectManager.getCounter(actualTarget, '沙丘闪避'));
            if (sandDodgeStacks > 0 && Math.random() < sandDodgeStacks * 0.2) {
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.shieldDamage = 0;
                damageResult.hpDamage = 0;
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}借沙丘掩护闪避了${attacker.name}的攻击`,
                });
            }
        }

        // 猎砂是致命伤害的第二道保险；成功后层数折半并向下取整。
        if (
            !unavoidable &&
            remainingDamage >= actualTarget.currentHp + actualTarget.shield &&
            remainingDamage > 0 &&
            actualTarget.passiveId === 'fengling_passive' &&
            attacker.owner !== actualTarget.owner
        ) {
            const huntSand = Math.min(4, EffectManager.getCounter(actualTarget, '猎砂'));
            if (huntSand > 0 && Math.random() < huntSand * 0.2) {
                EffectManager.setCounter(actualTarget, '猎砂', Math.floor(huntSand / 2));
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.shieldDamage = 0;
                damageResult.hpDamage = 0;
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}以猎砂避开致命伤害（剩余${EffectManager.getCounter(actualTarget, '猎砂')}层）`,
                });
            }
        }

        // 上官婉儿被动：墨意凝笔，完全闪避（消耗1层闪避）
        if (
            !unavoidable &&
            remainingDamage > 0 &&
            actualTarget.passiveId === 'shangguan_passive' &&
            attacker.owner !== actualTarget.owner &&
            (EffectManager.getCounter(actualTarget, '闪避') ?? 0) > 0
        ) {
            EffectManager.addCounter(actualTarget, '闪避', -1);
            remainingDamage = 0;
            damageResult.finalDamage = 0;
            damageResult.shieldDamage = 0;
            damageResult.hpDamage = 0;
            this.addBattleLog(gameState, {
                type: 'passive',
                player: actualTarget.owner,
                message: `${actualTarget.name}以墨意凝笔，完全闪避了${attacker.name}的攻击（剩余闪避${EffectManager.getCounter(actualTarget, '闪避')}层）`,
            });
        }

        // 南风「御风」：身处风道内按风道数量提升闪避率（每道25%，最多两道=50%）。
        // 任意阵营铺设的风道都能乘；不可规避的固定伤害（如羽化）无视此闪避。
        const windLaneDodgeRate = getWindLaneDodgeRate(gameState, actualTarget);
        if (
            !unavoidable &&
            remainingDamage > 0 &&
            windLaneDodgeRate > 0 &&
            attacker.owner !== actualTarget.owner
        ) {
            if (Math.random() < windLaneDodgeRate) {
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.shieldDamage = 0;
                damageResult.hpDamage = 0;
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}御风而起，闪避了${attacker.name}的攻击（闪避率${Math.round(windLaneDodgeRate * 100)}%）`,
                });
            }
        }

        // 姜太公「水泽」：我方角色站在泽里按片数累加闪避（封顶两层），只认铺设方阵营。
        // 与风道同为"位置型闪避"，因此同样吃不掉不可规避的固定伤害。
        const marshDodgeRate = getMarshDodgeRate(gameState, actualTarget);
        if (
            !unavoidable &&
            remainingDamage > 0 &&
            marshDodgeRate > 0 &&
            attacker.owner !== actualTarget.owner
        ) {
            if (Math.random() < marshDodgeRate) {
                remainingDamage = 0;
                damageResult.finalDamage = 0;
                damageResult.shieldDamage = 0;
                damageResult.hpDamage = 0;
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}借水泽藏身，闪避了${attacker.name}的攻击（闪避率${Math.round(marshDodgeRate * 100)}%）`,
                });
            }
        }

        // 命中表现只记录本次真实扣盾结果，不受后续被动补盾影响。
        const shieldBeforeHit = actualTarget.shield;
        const hitFrom = attacker.position ? [...attacker.position] : undefined;
        // 1. 先扣护盾
        if (!unavoidable && actualTarget.shield > 0) {
            if (actualTarget.shield >= remainingDamage) {
                damageResult.shieldDamage = remainingDamage;
                actualTarget.shield -= remainingDamage;
                remainingDamage = 0;
            } else {
                damageResult.shieldDamage = actualTarget.shield;
                remainingDamage -= actualTarget.shield;
                actualTarget.shield = 0;
            }
        }

        const shieldBroken = shieldBeforeHit > 0 && damageResult.shieldDamage > 0 && actualTarget.shield === 0;
        // 2. 再扣生命
        damageResult.hpDamage = remainingDamage;
        // 震霄天威「龙势」：状态期间不会倒下，致命伤害只把生命压到 1 点。
        // 血契致知3 同口径：技能二锁完人后，本回合她自己不会倒下（标记在回合初清除）。
        // hpDamage 仍记这一下的原始伤害，统计与对方吸血都按打出去的量算。
        const immortal = actualTarget.effects.some(effect => effect.name === '龙势') ||
            (actualTarget.passiveId === 'xueqi_passive' && actualTarget.counters['__xueqi_immune'] === 1);
        if (actualTarget.effects.some(effect => effect.name === '龙势') && remainingDamage > 0 &&
            remainingDamage >= actualTarget.currentHp) {
            requestMechanismFx(actualTarget, 'zhenxiao_laststand', gameState);
        }
        actualTarget.currentHp = immortal
            ? Math.max(1, actualTarget.currentHp - remainingDamage)
            : Math.max(0, actualTarget.currentHp - remainingDamage);
        const actualHpDamage = Math.min(hpBeforeDamage, Math.max(0, remainingDamage));
        recordBattleDamage(gameState, attacker, actualTarget, actualHpDamage, damageResult.shieldDamage);

        const appliedDamage = damageResult.shieldDamage + actualHpDamage;
        // 夜枭「影遁」的"这一回合攻击过没有"判据：打破护盾也算出手；标记（技能1）不走这里，
        // 所以他只丢标记时仍按未攻击处理，回合末会自己隐进潜行。
        if (appliedDamage > 0 && actualTarget.owner !== attacker.owner) {
            attacker.counters['__attacked_round'] = gameState.roundNumber;
        }
        if (appliedDamage > 0 && actualTarget.passiveId === 'fengling_passive') {
            if (this.isInOwnSandDune(actualTarget, gameState)) {
                EffectManager.setCounter(
                    actualTarget,
                    '沙丘闪避',
                    Math.min(5, EffectManager.getCounter(actualTarget, '沙丘闪避') + 1)
                );
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}在沙丘中受伤，闪避率提升至${EffectManager.getCounter(actualTarget, '沙丘闪避') * 20}%`,
                });
            } else {
                EffectManager.setCounter(actualTarget, '沙丘闪避', 0);
            }
        }

        if (appliedDamage > 0 && attacker.owner !== actualTarget.owner) {
            // 专属武器：每次真正造成伤害后逐目标判定（醉月/酒狂一类），与英雄被动分开记账
            applyWeaponOnDamageDealt(attacker, gameState);
        }

        if (appliedDamage > 0 && attacker.passiveId === 'fengling_passive' && attacker.owner !== actualTarget.owner) {
            this.trackFenglingConsecutiveHit(attacker, actualTarget, gameState);
        }

        // 上官婉儿被动：攻击命中敌人累积墨意，满3层凝为1次闪避（上限2次）
        if (appliedDamage > 0 && attacker.passiveId === 'shangguan_passive' && attacker.owner !== actualTarget.owner) {
            EffectManager.addCounter(attacker, '墨意', 1);
            const moyi = EffectManager.getCounter(attacker, '墨意');
            if (moyi >= 3 && (EffectManager.getCounter(attacker, '闪避') ?? 0) < 2) {
                EffectManager.setCounter(attacker, '墨意', 0);
                EffectManager.addCounter(attacker, '闪避', 1);
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: attacker.owner,
                    message: `${attacker.name}凝墨为避，获得1次闪避机会（当前${EffectManager.getCounter(attacker, '闪避')}层）`,
                });
            }
        }

        // 潮汐：只有泠汐的伤害会触发回血；读取的是本次命中前已有的层数（叠加发生在结算之后）
        if (
            appliedDamage > 0 &&
            attacker.passiveId === 'lingxi_passive' &&
            attacker.owner !== actualTarget.owner &&
            actualTarget.position
        ) {
            const tide = getTideStacks(actualTarget);
            if (tide > 0) {
                const cells = [actualTarget.position, ...MovementSystem.getAreaPositions(actualTarget.position, 3)];
                const friendly = cells
                    .map(([row, col]) => gameState.board[row]?.[col])
                    .filter((unit): unit is Hero =>
                        !!unit && unit.owner === attacker.owner && unit.state === HeroState.ALIVE);
                let healedCount = 0;
                for (const ally of friendly) {
                    if (this.applyHeal(ally, tide, gameState, attacker) > 0) healedCount++;
                }
                if (healedCount > 0) {
                    this.addBattleLog(gameState, {
                        type: 'passive',
                        player: attacker.owner,
                        message: `${attacker.name}激起潮音，${actualTarget.name}周围${healedCount}名友方各恢复${tide}点生命`,
                    });
                }
            }
        }

        if (
            actualTarget.passiveId === 'bard_passive' &&
            (actualTarget.counters['bard_echo_used'] ?? 0) < 5 &&
            actualTarget.currentHp < actualTarget.maxHp * 0.3
        ) {
            const allies = actualTarget.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            const passion = allies.reduce((sum, hero) => sum + (hero.counters['激情'] ?? 0), 0);
            if (passion > 0) {
                // 一场战斗最多触发5次；只有真正治疗才计入次数
                const used = (actualTarget.counters['bard_echo_used'] ?? 0) + 1;
                actualTarget.counters['bard_echo_used'] = used;
                const healed = this.applyHeal(actualTarget, passion * 3, gameState, actualTarget);
                if (healed > 0) requestRecoveryFx(actualTarget, actualTarget, 'bard_regen', gameState);
                // 终曲回响：消耗全队激情，重新积攒后才能再次触发
                for (const ally of allies) {
                    ally.counters['激情'] = 0;
                }
                this.addBattleLog(gameState, {
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}触发终曲回响（${used}/5），消耗全队${passion}点激情，恢复${healed}点生命`
                });
            }
        }

        if (
            actualTarget.passiveId === 'xuanxiao_passive' &&
            actualTarget.counters['xuanxiao_danger_used'] !== 1 &&
            actualTarget.counters['xuanxiao_danger_armed'] !== 1 &&
            hpBeforeDamage >= 16 &&
            actualTarget.currentHp > 0 &&
            actualTarget.currentHp < 16
        ) {
            actualTarget.counters['xuanxiao_danger_armed'] = 1;
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: nextBattleLogId(),
                    type: 'passive',
                    player: actualTarget.owner,
                    message: `${actualTarget.name}进入化险为夷状态`,
                    timestamp: Date.now()
                });
            }
        }

        // 3. 触发被动技能：onDamaged（在死亡之前触发，确保反击等被动能生效）
        if (remainingDamage > 0 && actualTarget.state === HeroState.ALIVE) {
            this.triggerPassiveSkill(actualTarget, 'onDamaged', gameState, { attacker, damage: remainingDamage });
        }

        // 4. 吸血
        if (attacker.counters['jetzmi_shield_conversion_next'] === 1 && damageResult.hpDamage > 0) {
            attacker.shield += Math.floor(damageResult.hpDamage * 0.5);
            attacker.counters['jetzmi_shield_conversion_next'] = 0;
        }
        if (damageResult.vampireAmount > 0) {
            this.applyHeal(attacker, damageResult.vampireAmount, gameState, attacker);
        }

        if (targetWasAlive) {
            const detailParts: string[] = [];
            if (damageResult.isCrit && appliedDamage > 0) detailParts.push('暴击');
            if (damageResult.shieldDamage > 0) detailParts.push(`护盾吸收${damageResult.shieldDamage}`);
            if (actualHpDamage > 0) detailParts.push(`生命-${actualHpDamage}`);
            const detailText = detailParts.length > 0 ? `（${detailParts.join('，')}）` : '';
            this.addBattleLog(gameState, {
                type: 'damage',
                player: attacker.owner,
                message: appliedDamage > 0
                    ? `${attacker.name}对${actualTarget.name}造成${appliedDamage}点伤害${detailText}`
                    : `${attacker.name}对${actualTarget.name}的攻击未造成伤害`,
                details: {
                    kind: 'damage',
                    sourceHeroId: attacker.id,
                    targetHeroId: actualTarget.id,
                    amount: appliedDamage,
                    isCrit: damageResult.isCrit && appliedDamage > 0,
                    hpDamage: actualHpDamage,
                    shieldDamage: damageResult.shieldDamage,
                    shieldBroken,
                    targetMaxHp: actualTarget.maxHp,
                    hitFrom,
                    fxTag: damageResult.logTag,
                    position: actualTarget.position ? [...actualTarget.position] : undefined,
                }
            });
        }

        // 5. 检查是否击杀（在被动技能触发之后）
        if (actualTarget.currentHp <= 0 && actualTarget.state === HeroState.ALIVE) {
            // 戴尔「时空停滞」的复活口径：回到挨这致命一击之前的生命
            actualTarget.counters['__dai_hp_before_lethal'] = hpBeforeDamage;
            if (attacker.tianweiId === 'mowen_tianwei') {
                attacker.counters['__last_kill_damage'] = Math.min(maxEffectiveDamageForKill, damageResult.finalDamage);
            }
            damageResult.killed = this.handleDeath(actualTarget, attacker, gameState);
        }

        // 扩展英雄的攻击后效果。
        if (remainingDamage > 0 && attacker.state === HeroState.ALIVE) {
            // 音符：友方造成实际伤害后，为来源琵琶累积1点和弦（附伤已在结算前并入本次伤害）
            const note = attacker.effects.find(e => e.name === '音符');
            if (note?.sourceHeroId) {
                const pipa = this.findHeroById(note.sourceHeroId, gameState);
                if (pipa?.state === HeroState.ALIVE) {
                    EffectManager.addCounter(pipa, '和弦', 1);
                    // 致知3：每攒下 1 层和弦，永久增加 1 点基础攻击力（音符附伤随之一起变厚）
                    if (hasZhizhi(pipa, 3)) pipa.baseAttack = (pipa.baseAttack ?? 8) + 1;
                }
            }

            // 和声：每次攻击恢复一次生命；同组内的多目标命中/援护分摊/纠缠传播都算同一次攻击
            const harmony = attacker.effects.find(e => e.name === '和声');
            if (harmony && attacker.counters['__harmony_attack_group'] !== this.currentAttackGroup) {
                attacker.counters['__harmony_attack_group'] = this.currentAttackGroup ?? 0;
                const bard = harmony.sourceHeroId ? this.findHeroById(harmony.sourceHeroId, gameState) : undefined;
                const healed = this.applyHeal(attacker, harmony.value ?? 5, gameState, bard ?? undefined);
                if (healed > 0 && bard) requestRecoveryFx(bard, attacker, 'bard_regen', gameState);
            }

            this.recordLianzhiStrike(attacker, actualTarget, gameState);

            // 云缨「祥瑞」：她打到的敌人叠1层；顺序是先结算伤害、再叠层、最后判满层引燃。
            // 目标被这一击打死时层数不再往尸体上写，但引燃判定仍按击杀前的层数走。
            if (attacker.passiveId === 'yunying_passive') {
                this.applyYunyingXiangrui(attacker, actualTarget, gameState, xiangruiStacksBefore);
            }
            // 云缨的下一次攻击吸血：普攻等单次命中在这里摘掉（技能整批命中由技能自己收尾）
            if (attacker.passiveId === 'yunying_passive'
                && attacker.counters['__yunying_in_skill_cast'] !== 1
                && attacker.effects.some(effect => effect.name === YUNYING_VAMPIRE_EFFECT)) {
                attacker.effects = attacker.effects.filter(
                    effect => effect.name !== YUNYING_VAMPIRE_EFFECT
                );
            }

        }
        if (attacker.counters['jetzmi_vampire_next'] === 1) {
            attacker.counters['jetzmi_vampire_next'] = 0;
            EffectManager.removeEffectByName(attacker, '亡灵吸血');
        }

        // 量子纠缠：只传播实际生命伤害，传播伤害本身不会再次传播。
        if (damageResult.hpDamage > 0 && actualTarget.counters['__entangle_propagating'] !== 1) {
            const entangle = actualTarget.effects.find(e => e.name === '量子纠缠' && e.linkId);
            if (entangle?.sourceHeroId) {
                const partner = this.findHeroById(entangle.sourceHeroId, gameState);
                if (partner?.state === HeroState.ALIVE) {
                    partner.counters['__entangle_propagating'] = 1;
                    const shared = this.calculate(attacker, partner, Math.floor(damageResult.hpDamage * 0.5), false, true);
                    this.applyDamage(partner, shared, attacker, gameState, true);
                    delete partner.counters['__entangle_propagating'];
                }
            }
        }

        // 纸鸢「击飞」：她每出手 3 次的下一击附带击飞，被打中且本回合还没行动的人直接断线。
        // 放在伤害落地之后、击杀判定之后：打死的人不再补控制，避免和补员链抢顺序。
        if (attacker && actualTarget.state === HeroState.ALIVE
            && isZhiyuan(attacker) && zhiyuanKnockUpArmed(attacker)) {
            applyZhiyuanKnockUp(actualTarget, attacker, gameState);
        }

        // 赏金猎人「猎杀令」：友方命中带猎杀令的目标后，猎人追加一次追击。
        // 排除猎人自己作为攻击者（追击本身不再次触发，避免递归）。
        const huntMark = target.effects.find(effect => effect.name === '猎杀令');
        if (huntMark?.sourceHeroId && target.state === HeroState.ALIVE) {
            const hunter = this.findHeroById(huntMark.sourceHeroId, gameState);
            if (hunter && hunter.state === HeroState.ALIVE && hunter.id !== attacker.id && hunter.owner === attacker.owner) {
                const pursuit = this.calculate(hunter, target, 4, false);
                this.applyDamage(target, pursuit, hunter, gameState, false);
            }
        }

        // 6. 触发攻击者被动（onAttack）
        // 在伤害处理和击杀判定之后触发，以便判断是否保持潜行
        if (attacker && attacker.state === HeroState.ALIVE) {
             this.triggerPassiveSkill(attacker, 'onAttack', gameState, { target: actualTarget, killed: damageResult.killed });
        }
    }

    static resolveThreeStackControl(target: Hero, effectName: string, sourceHeroId: string): void {
        const effect = target.effects.find(e => e.name === effectName && e.sourceHeroId === sourceHeroId);
        if (!effect || (effect.stackCount ?? 1) < 3) return;
        target.effects = target.effects.filter(e => e !== effect);
        EffectManager.addEffect(target, {
            type: 'stun',
            name: `${effectName}眩晕`,
            // 行动中施加：已行动的目标剥夺下回合（2），未行动的目标剥夺本回合（1），恰好1次行动
            duration: target.hasActedThisTurn ? 2 : 1,
            sourceHeroId,
            description: '下一次行动被跳过',
        });
    }

    /** 获取目标身上由所有冰系英雄共同施加的寒天总层数。 */
    static getHantianStackCount(target: Hero): number {
        return target.effects
            .filter(effect => effect.name === '寒天')
            .reduce((sum, effect) => sum + Math.max(0, effect.stackCount ?? 1), 0);
    }

    /** 消耗目标身上的全部寒天并返回实际消耗层数。 */
    static consumeHantianStacks(target: Hero): number {
        const consumed = this.getHantianStackCount(target);
        if (consumed > 0) {
            target.effects = target.effects.filter(effect => effect.name !== '寒天');
        }
        return consumed;
    }

    /**
     * 施加共享寒天层数。所有来源共同累计，达到3层时清空寒天并转为冰冻。
     */
    static applyHantianStacks(target: Hero, stacks: number, sourceHeroId: string, gameState: GameState): void {
        const added = Math.max(0, Math.floor(stacks));
        if (added === 0 || target.state !== HeroState.ALIVE) return;
        // 寒天体系全局规则：冰冻期间层数锁死，不能再往上叠（否则解冻前就被反复刷新冰冻）
        if (EffectManager.hasEffect(target, '冰冻')) return;

        const total = this.consumeHantianStacks(target) + added;
        if (total >= 3) {
            EffectManager.removeEffectByName(target, '冰冻');
            EffectManager.addEffect(target, {
                type: 'stun',
                name: '冰冻',
                // 行动中施加：已行动的目标剥夺下回合（2），未行动的目标剥夺本回合（1），恰好1次行动
                duration: target.hasActedThisTurn ? 2 : 1,
                sourceHeroId,
                description: '停止行动一回合'
            });
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: nextBattleLogId(),
                    type: 'passive' as const,
                    player: target.owner,
                    message: `${target.name}寒天叠加至3层，进入冰冻`,
                    timestamp: Date.now()
                });
            }
        } else {
            EffectManager.addEffect(target, {
                type: 'debuff',
                name: '寒天',
                duration: -1,
                stackCount: total,
                sourceHeroId,
                description: '全来源共享；累计3层进入冰冻'
            });
            if (gameState.battleLog) {
                gameState.battleLog.push({
                    id: nextBattleLogId(),
                    type: 'passive' as const,
                    player: target.owner,
                    message: `${target.name}获得寒天+${added}（当前${total}层）`,
                    timestamp: Date.now()
                });
            }
        }
    }

    static forceDeath(target: Hero, killer: Hero, gameState: GameState): boolean {
        if (target.state !== HeroState.ALIVE) return false;
        target.currentHp = 0;
        return this.handleDeath(target, killer, gameState);
    }

    /**
     * 根据ID查找英雄
     */
    private static findHeroById(heroId: string, gameState: GameState): Hero | null {
        // 在棋盘上查找
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                const hero = gameState.board[row][col];
                if (hero && hero.id === heroId) {
                    return hero;
                }
            }
        }

        // 在玩家英雄列表中查找（可能已死亡但仍在列表中）
        for (const hero of gameState.player1Heroes) {
            if (hero.id === heroId) return hero;
        }
        for (const hero of gameState.player2Heroes) {
            if (hero.id === heroId) return hero;
        }

        return null;
    }

    /** 写一条引擎侧战报：原地追加并按 200 条上限原地裁切，绝不换新数组 */
    static addBattleLog(
        gameState: GameState,
        entry: Omit<BattleLogEntry, 'id' | 'timestamp'>
    ): void {
        gameState.battleLog.push({
            ...entry,
            id: nextBattleLogId(),
            timestamp: Date.now()
        });
        // 必须原地截断：换成新数组会让调用方持有的引用变成孤儿数组，
        // 达到上限后同一次结算里的第二条起伤害日志就会静默消失（飘字随之丢失）。
        if (gameState.battleLog.length > 200) {
            gameState.battleLog.splice(0, gameState.battleLog.length - 200);
        }
    }

    private static resolveBountyRewards(target: Hero, killer: Hero, gameState: GameState): void {
        const bountyEffects = target.effects.filter(effect => {
            if (!effect.name.startsWith('悬赏·') || !effect.sourceHeroId) return false;
            const bountyHunter = this.findHeroById(effect.sourceHeroId, gameState);
            return bountyHunter?.owner === killer.owner;
        });

        if (bountyEffects.length === 0) return;
        target.effects = target.effects.filter(effect => !bountyEffects.includes(effect));

        for (const bounty of bountyEffects) {
            const reward = bounty.value ?? -1;
            let rewardText = bounty.name.replace('悬赏·', '');

            if (reward === 0) {
                const bountyTianweiHero = this.resolveTianweiTriggerHero(killer, gameState);
                if (bountyTianweiHero) this.triggerTianwei(bountyTianweiHero, gameState);
                rewardText += '：再次触发天威';
            } else if (reward === 1) {
                const healed = this.applyHeal(killer, Math.floor((killer.maxHp - killer.currentHp) * 0.5), gameState);
                rewardText += `：恢复${healed}点生命`;
            } else if (reward === 2) {
                EffectManager.addEffect(killer, {
                    type: 'buff',
                    name: '赏金暴击率',
                    duration: -1,
                    value: 0.5,
                    sourceHeroId: bounty.sourceHeroId,
                    description: '永久提升50%暴击率',
                });
                rewardText += '：永久提升50%暴击率';
            } else if (reward === 3) {
                EffectManager.addEffect(killer, {
                    type: 'buff',
                    name: '赏金吸血',
                    duration: -1,
                    value: 0.3,
                    sourceHeroId: bounty.sourceHeroId,
                    description: '永久提升30%吸血',
                });
                rewardText += '：永久提升30%吸血';
            }

            this.addBattleLog(gameState, {
                type: 'effect',
                player: killer.owner,
                message: `${killer.name}领取${target.name}的${rewardText}`
            });
        }
    }

    /**
     * 触发被动技能
     */
    private static triggerPassiveSkill(
        hero: Hero,
        triggerType: string,
        gameState: GameState,
        context?: any
    ): void {
        // 根据被动ID查找并执行
        if (hero.passiveId === 'moran_passive') {
            if (moranPassive.triggerOn === triggerType) {
                moranPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'zhenxiao_passive') {
            if (zhenxiaoPassive.triggerOn === triggerType) {
                zhenxiaoPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'liuli_passive') {
            if (liuliPassive.triggerOn === triggerType) {
                liuliPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'wukong_passive') {
            if (wukongPassive.triggerOn === triggerType) {
                wukongPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'mowen_passive') {
            if (mowenPassive.triggerOn === triggerType) {
                mowenPassive.execute(hero, gameState, context);
            }
        } else if (hero.passiveId === 'guying_passive') {
            if (guyingPassive.triggerOn === triggerType) {
                guyingPassive.execute(hero, gameState, context);
            }
        }
        // 可以继续添加其他英雄的被动
    }

    /**
     * 处理英雄死亡
     */
    private static handleDeath(target: Hero, killer: Hero, gameState: GameState): boolean {
        const deathPosition = target.position ? [...target.position] as [number, number] : null;
        if (target.passiveId === 'wither_lord_passive') {
            const lives = target.counters['wither_lives'] ?? 0;
            if (lives > 1) {
                target.counters['wither_lives'] = lives - 1;
                target.currentHp = target.maxHp;
                target.shield = 0;
                return false;
            }
        }

        if (target.counters && target.counters['__isClone'] === 1) {
            target.state = HeroState.DEAD;
            recordBattleKill(gameState, killer);

            this.addBattleLog(gameState, {
                type: 'kill',
                player: killer.owner,
                message: `${killer.name}击杀了${target.name}`,
                details: {
                    kind: 'clone-kill',
                    sourceHeroId: killer.id,
                    victimHeroId: target.id,
                    victimPosition: deathPosition ? [...deathPosition] : undefined,
                }
            });

            if (target.position) {
                const [row, col] = target.position;
                if (gameState.board[row] && gameState.board[row][col] === target) {
                    gameState.board[row][col] = null;
                }
            }

            const ownerId = this.getWukongOwnerIdFromCloneId(target.id);
            if (ownerId) {
                const owner = this.findHeroById(ownerId, gameState);
                if (owner && owner.state === HeroState.ALIVE && owner.name === '孙悟空') {
                    owner.counters['灵犀'] = (owner.counters['灵犀'] ?? 0) + 1;
                    this.syncWukongCritToSelfAndClones(owner, gameState);

                    if (gameState.battleLog) {
                        gameState.battleLog.push({
                            id: nextBattleLogId(),
                            type: 'passive' as const,
                            player: owner.owner,
                            message: `${owner.name}的分身阵亡，灵犀+1（当前${owner.counters['灵犀']}）`,
                            timestamp: Date.now()
                        });
                    }
                }
            }

            return true;
        }

        if (target.passiveId === 'changli_passive') {
            const used = target.counters['changli_revives'] ?? 0;
            // 被动只给一次复活，且不消耗暗夜星火；天威「刷新被动」会把 changli_revives 归零，
            // 于是又能挡一次致命伤
            if (used < 1) {
                // "上一次的50%"：首次以生命上限为基准，之后以上一次复活后的生命为基准；
                // 致知3 把复活血线抬到 60%、复生增伤抬到 50%
                const reviveRate = zhizhiValue(target, 3, 0.5, 0.6);
                const reviveAttackBonus = zhizhiValue(target, 3, 0.4, 0.5);
                const previousHp = target.counters['changli_lastReviveHp'] ?? target.maxHp;
                const revivedHp = Math.max(1, Math.floor(previousHp * reviveRate));
                target.counters['changli_lastReviveHp'] = revivedHp;
                target.counters['changli_revives'] = used + 1;
                target.currentHp = revivedHp;
                EffectManager.removeEffectByName(target, '长离复生增伤');
                EffectManager.addEffect(target, {
                    type: 'buff',
                    name: '长离复生增伤',
                    duration: -1,
                    value: reviveAttackBonus,
                    sourceHeroId: target.id,
                    description: `复生后伤害提升${Math.round(reviveAttackBonus * 100)}%`
                });
                if (target.owner === 'player1') {
                    gameState.deathCounters.player1Resurrections++;
                } else {
                    gameState.deathCounters.player2Resurrections++;
                }
                if (gameState.battleLog) {
                    gameState.battleLog.push({
                        id: nextBattleLogId(),
                        type: 'passive',
                        player: target.owner,
                        message: `${target.name}长夜轮回复生，生命值${target.currentHp}，伤害提升${Math.round(reviveAttackBonus * 100)}%`,
                        timestamp: Date.now()
                    });
                }
                requestMechanismFx(target, 'changli_rebirth', gameState, { logId: gameState.battleLog[gameState.battleLog.length - 1]?.id });
                return false;
            }
        }

        target.state = HeroState.DEAD;
        // 召唤物/分身被打掉不算"击杀一名角色"：既不推进连击档位（击杀横幅的 tier 读 killCount），
        // 也不发 hero-kill 播报——震屏与"首破/二连击破"那套是给真英雄阵亡的
        const isRealVictim = isRealCharacterHero(target);
        if (isRealVictim) killer.killCount++;
        recordBattleKill(gameState, killer, target);

        this.addBattleLog(gameState, {
            type: 'kill',
            player: killer.owner,
            message: isRealVictim
                ? `${killer.name}击杀了${target.name}`
                : `${killer.name}打散了${target.name}`,
            details: isRealVictim ? {
                kind: 'hero-kill',
                sourceHeroId: killer.id,
                killerHeroId: killer.id,
                killerName: killer.name,
                victimHeroId: target.id,
                victimName: target.name,
                victimPosition: deathPosition ? [...deathPosition] : undefined,
                killCount: killer.killCount
            } : {
                kind: 'pseudo-kill',
                sourceHeroId: killer.id,
                victimHeroId: target.id,
                victimName: target.name,
                victimPosition: deathPosition ? [...deathPosition] : undefined,
            }
        });

        // 从棋盘上移除英雄
        if (target.position) {
            const [row, col] = target.position;
            if (gameState.board[row] && gameState.board[row][col] === target) {
                gameState.board[row][col] = null;
            }
        }

        // 时空旅者·戴尔被动「时空停滞」：我方单位阵亡时（分身/召唤物/戴尔自身/通灵角色除外，
        // 且每名英雄限一次）时间被凝固一回合，期间可被其技能1「时空回溯」复活。
        // 通灵角色一并排除：否则"复活→再触发通灵"会反复循环，与技能1不得回溯通灵的口径冲突。
        if (
            target.passiveId !== 'dai_passive' &&
            target.class !== '通灵' &&
            target.counters['__isClone'] !== 1 &&
            target.counters['__isSummon'] !== 1 &&
            !target.counters['__dai_revived_once']
        ) {
            const alliesOfTarget = target.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            const dai = alliesOfTarget.find(
                hero => hero.passiveId === 'dai_passive' && hero.state === HeroState.ALIVE
            );
            if (dai) {
                target.counters['__dai_stasis_until'] = gameState.roundNumber + 1;
                if (deathPosition) {
                    target.counters['__dai_stasis_pos'] = deathPosition[0] * 6 + deathPosition[1];
                }
                this.addBattleLog(gameState, {
                    type: 'system',
                    player: target.owner,
                    message: `${target.name}的时间被${dai.name}凝固，进入时空停滞（下个回合内可用时空回溯将其复活）`
                });
            }
        }

        // 上官婉儿阵亡：其落下的毛笔随之消散
        if (target.passiveId === 'shangguan_passive' && (gameState.boardEffects?.length ?? 0) > 0) {
            const beforeCount = gameState.boardEffects!.length;
            gameState.boardEffects = gameState.boardEffects!.filter(
                effect => !(effect.type === 'brush' && effect.sourceHeroId === target.id)
            );
            if (gameState.boardEffects.length < beforeCount) {
                this.addBattleLog(gameState, {
                    type: 'system',
                    player: target.owner,
                    message: `${target.name}阵亡，其毛笔随之消散`
                });
            }
        }

        // 南风阵亡：其风道只随南风存续，失去风源后立即消散
        if (target.passiveId === 'nanfeng_passive') {
            const removed = removeWindLanesOf(gameState, target.id);
            if (removed > 0) {
                this.addBattleLog(gameState, {
                    type: 'system',
                    player: target.owner,
                    message: `${target.name}阵亡，风止道散（移除${removed}格风道）`
                });
            }
        }

        // 阴阳师阵亡：挂在他人身上的阳/阴线随本体当场消散并重置倍率。
        // 不等"下一次移动后重算"兜底——否则死者持续供攻防加成，
        // 死后回替补席、再被唤回场地时线还会原样接上
        if (target.passiveId === 'yinyang_passive') {
            purgeYinyangLinksOf(target, gameState, '阵亡');
        }

        // 镜花·水月阵亡：水月倒影与月座随镜碎散，不给无人认领的镜像留在场上
        if (target.passiveId === 'jinghua_passive') {
            const beforeMarks = (gameState.boardEffects ?? []).length;
            gameState.boardEffects = (gameState.boardEffects ?? []).filter(effect =>
                !((effect.type === 'water-moon' || effect.type === 'moon-seat')
                    && effect.sourceHeroId === target.id));
            if ((gameState.boardEffects ?? []).length < beforeMarks) {
                this.addBattleLog(gameState, {
                    type: 'system',
                    player: target.owner,
                    message: `${target.name}阵亡，水月与月座随镜碎散`
                });
            }
        }

        // 花弄影阵亡：地上的影子跟着淡去，不留无主残墨给弄影当免费跳板
        purgeHnyShadow(target, gameState);

        // 折光阵亡：她布下的光棱一起碎掉，不留无主的折射点在棋盘上
        purgeZhiguangPrisms(target, gameState);

        let removedCloneCount = 0;
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const h = gameState.board[r][c];
                if (!h || h.state !== HeroState.ALIVE) continue;
                if (!h.counters || h.counters['__isClone'] !== 1) continue;

                const wukongOwnerId = this.getWukongOwnerIdFromCloneId(h.id);
                const mirrorOwnerId = getMirrorOwnerIdFromCloneId(h.id);

                if (wukongOwnerId !== target.id && mirrorOwnerId !== target.id) continue;

                h.state = HeroState.DEAD;
                gameState.board[r][c] = null;
                removedCloneCount++;
            }
        }

        if (removedCloneCount > 0 && gameState.battleLog) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'system' as const,
                player: target.owner,
                message: `${target.name}阵亡，${removedCloneCount}个分身随之消散`,
                timestamp: Date.now()
            });
        }

        // 更新死亡计数器
        if (target.owner === 'player1') {
            gameState.deathCounters.player1Dead++;
        } else {
            gameState.deathCounters.player2Dead++;
        }
        gameState.deathCounters.totalDead++;

        if (deathPosition) {
            const inCircle = gameState.boardEffects?.some(effect =>
                effect.type === 'dark-circle' &&
                effect.owner === target.owner &&
                effect.sourceHeroId !== target.id &&
                Math.abs(effect.position[0] - deathPosition[0]) <= 1 &&
                Math.abs(effect.position[1] - deathPosition[1]) <= 1
            );
            if (inCircle) {
                if (target.owner === 'player1') gameState.deathCounters.player1Dead++;
                else gameState.deathCounters.player2Dead++;
            }
        }

        // 触发击杀者的天威（孙悟空的分身击杀时，由其本体触发）。
        // 只有杀掉"一名角色"才算有效击杀：打死金乌/玄龟、悟空分身、镜分身都不该引出天威。
        const tianweiHero = isRealCharacterHero(target)
            ? this.resolveTianweiTriggerHero(killer, gameState)
            : null;
        if (tianweiHero && tianweiHero.id !== target.id && tianweiHero.owner !== target.owner) {
            if (tianweiHero.tianweiId === 'dilan_tianwei' && deathPosition) {
                tianweiHero.counters['__dilan_kill_pos'] = deathPosition[0] * 6 + deathPosition[1];
            }
            this.triggerTianwei(tianweiHero, gameState);
            delete tianweiHero.counters['__dilan_kill_pos'];
        }
        if (killer.id !== target.id && killer.owner !== target.owner) {
            this.resolveBountyRewards(target, killer, gameState);
        }

        if (target.counters['__isSummon'] === 1) {
            const parts = target.id.split('|');
            const owner = parts.length >= 4 ? this.findHeroById(parts[2], gameState) : null;
            if (owner?.state === HeroState.ALIVE) {
                // 致知1：召唤物阵亡的自损 30% → 20%
                const backlash = zhizhiValue(owner, 1, 0.3, 0.2);
                owner.currentHp = Math.max(1, owner.currentHp - Math.floor(owner.currentHp * backlash));
            }
        }

        if (target.passiveId === 't_painting_passive') {
            for (let row = 0; row < 6; row++) {
                for (let col = 0; col < 6; col++) {
                    const unit = gameState.board[row][col];
                    if (unit?.counters['__isSummon'] === 1 && unit.id.split('|')[2] === target.id) {
                        unit.state = HeroState.DEAD;
                        gameState.board[row][col] = null;
                    }
                }
            }
        }

        if (target.passiveId === 'soul_lamp_passive') {
            // 真实死亡：移除临时的，改为永久吸血；数值为当前累计吸血率（真实死亡本身不再+20%）
            const beneficiary = findSoulLampBeneficiary(target, gameState);
            if (beneficiary) {
                beneficiary.effects = beneficiary.effects.filter(effect =>
                    !((effect.name === '缚魂吸血' || effect.name === '缚魂吸血·永驻') && effect.sourceHeroId === target.id)
                );
                EffectManager.addEffect(beneficiary, {
                    type: 'buff',
                    name: '缚魂吸血·永驻',
                    duration: -1,
                    value: target.counters['soul_lamp_vampire_rate'] ?? 0.3,
                    sourceHeroId: target.id,
                    description: '缚魂灯真实死亡后留下的永久吸血',
                });
                if (gameState.battleLog) {
                    gameState.battleLog.push({
                        id: nextBattleLogId(),
                        type: 'passive' as const,
                        player: beneficiary.owner,
                        message: `${target.name}真实死亡，${beneficiary.name}获得永久吸血${Math.round((target.counters['soul_lamp_vampire_rate'] ?? 0.3) * 100)}%`,
                        timestamp: Date.now()
                    });
                }
            }
        }
        return true;
    }

    /**
     * 解析天威的实际触发者：
     * - 击杀者拥有天威时返回击杀者本人；
     * - 击杀者为孙悟空的分身时返回其本体（分身击杀同样触发天威）；
     * - 击杀者为召唤物（T型帛画的金乌/玄龟等）时返回仍在场的召唤者；
     * - 其余情况返回 null。
     */
    private static resolveTianweiTriggerHero(killer: Hero, gameState: GameState): Hero | null {
        if (killer.tianweiId) return killer;
        if (
            killer.counters?.['__isClone'] === 1 &&
            typeof killer.id === 'string' &&
            killer.id.startsWith('wukong-clone|')
        ) {
            const ownerId = killer.id.split('|')[1];
            if (!ownerId) return null;
            const owner = this.findHeroById(ownerId, gameState);
            if (owner && owner.state === HeroState.ALIVE && owner.tianweiId === 'wukong_tianwei') {
                return owner;
            }
        }
        if (killer.counters?.['__isSummon'] === 1) {
            const ownerId = getSummonOwnerId(killer);
            if (!ownerId) return null;
            const owner = this.findHeroById(ownerId, gameState);
            if (owner && owner.state === HeroState.ALIVE && owner.tianweiId) {
                return owner;
            }
        }
        return null;
    }

    /**
     * 触发天威技能
     */
    static triggerTianwei(hero: Hero, gameState: GameState): void {
        hero.counters['__lianzhi_tianwei_group'] = this.currentAttackGroup ?? 0;
        if (hero.tianweiId === 'duosui_tianwei') {
            // 夺岁的天威不当场打伤害：攒成「血诏」，等他下一次真正出手再一并砍出去
            grantDuosuiTianwei(hero);
            this.addBattleLog(gameState, {
                type: 'passive',
                player: hero.owner,
                message: `${hero.name}天威·血诏：下一次攻击额外附加目标最大生命值20%的伤害`,
            });
        } else if (hero.tianweiId === 'wangshu_tianwei') {
            wangshuTianwei.execute(hero, gameState);
            if (hero.position) requestSkillFx({
                skillId: 'wangshu_tianwei', owner: hero.owner, sourceHeroId: hero.id,
                fromPos: [...hero.position], targetPos: [...hero.position],
                damagePositions: [], impactPositions: [[...hero.position]], softImpactPositions: [[...hero.position]],
                logIds: [gameState.battleLog[gameState.battleLog.length - 1].id],
            }, gameState);
        } else if (hero.tianweiId === 'moran_tianwei') {
            moranTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'zhenxiao_tianwei') {
            zhenxiaoTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'wukong_tianwei') {
            wukongTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'nightowl_tianwei') {
            nightowlTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'mirror_tianwei') {
            mirrorTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'mowen_tianwei') {
            mowenTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'guying_tianwei') {
            guyingTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'youjun_tianwei') {
            youjunTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'huifeng_tianwei') {
            huifengTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'changli_tianwei') {
            changliTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'jetzmi_tianwei') {
            // 致知1：天威获得的亡灵共鸣 2 → 3
            const resonance = zhizhiValue(hero, 1, 2, 3);
            if (hero.owner === 'player1') gameState.deathCounters.player1Dead += resonance;
            else gameState.deathCounters.player2Dead += resonance;
        } else if (hero.tianweiId === 'wither_lord_tianwei') {
            EffectManager.addCounter(hero, 'wither_lives', 1);
        } else if (hero.tianweiId === 'wangcai_tianwei') {
            // 致知3：永久基础攻击力 +2 → +3
            hero.baseAttack = (hero.baseAttack ?? 0) + zhizhiValue(hero, 3, 2, 3);
        } else if (hero.tianweiId === 'skeletonking_tianwei') {
            const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            const dead = allies.filter(item => item.state === HeroState.DEAD);
            const target = dead[Math.floor(Math.random() * dead.length)];
            if (target) {
                const resonance = hero.owner === 'player1'
                    ? gameState.deathCounters.player1Dead
                    : gameState.deathCounters.player2Dead;
                const empty = MovementSystem.findNearestEmptyPosition(hero.position ?? [0, 0], gameState);
                if (empty) {
                    // 致知1：复活时的生命 亡灵共鸣 × 3 → × 4
                    const hpPerResonance = zhizhiValue(hero, 1, 3, 4);
                    target.state = HeroState.ALIVE;
                    target.position = empty;
                    target.currentHp = Math.max(1, Math.min(target.maxHp, resonance * hpPerResonance));
                    // 复活后本回合可正常行动
                    target.hasActedThisTurn = false;
                    target.hasMovedThisTurn = false;
                    gameState.board[empty[0]][empty[1]] = target;
                    if (target.owner === 'player1') gameState.deathCounters.player1Resurrections++;
                    else gameState.deathCounters.player2Resurrections++;
                    this.addBattleLog(gameState, {
                        type: 'system',
                        player: hero.owner,
                        message: `${hero.name}触发天威，复活了${target.name}（生命值${target.currentHp}）`
                    });
                    requestSkillFx({ skillId: 'skeletonking_revive', owner: hero.owner, sourceHeroId: hero.id,
                        fromPos: [...(hero.position ?? empty)], targetPos: [...empty],
                        impactPositions: [[...empty]], softImpactPositions: [[...empty]], damagePositions: [],
                        logIds: [gameState.battleLog[gameState.battleLog.length - 1].id],
                    }, gameState);
                }
            } else {
                const living = allies.filter(item => item.state === HeroState.ALIVE).sort((a, b) => a.currentHp - b.currentHp);
                if (living[0]) {
                    this.applyHeal(living[0], 8, gameState, hero);
                    this.addBattleLog(gameState, {
                        type: 'system',
                        player: hero.owner,
                        message: `${hero.name}触发天威，治疗了${living[0].name}`
                    });
                }
            }
        } else if (hero.tianweiId === 'pipa_tianwei') {
            const allies = hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
            const target = allies.filter(item => item.state === HeroState.ALIVE).sort((a, b) => a.currentHp - b.currentHp)[0];
            if (target) this.applyHeal(target, hero.counters['pipa_last_skill2_damage'] ?? 0, gameState, hero);
        } else if (hero.tianweiId === 'bounty_tianwei') {
            // 击杀后向随机一个存活敌人追加猎杀令（致知3：改为所有存活敌人）
            const enemies = (hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes)
                .filter(item => item.state === HeroState.ALIVE);
            const targets = hero.counters['talent_3']
                ? enemies
                : (enemies.length > 0 ? [enemies[Math.floor(Math.random() * enemies.length)]] : []);
            for (const enemy of targets) {
                EffectManager.removeEffectByName(enemy, '猎杀令');
                EffectManager.addEffect(enemy, {
                    type: 'mark',
                    name: '猎杀令',
                    duration: 2,
                    sourceHeroId: hero.id,
                    description: '友方对其造成伤害时，赏金猎人追加一次4点伤害的追击',
                });
            }
            this.addBattleLog(gameState, {
                type: 'tianwei',
                player: hero.owner,
                message: `${hero.name}触发天威，${hero.counters['talent_3']
                    ? '向所有存活敌人发布猎杀令'
                    : `向${targets[0]?.name ?? '存活敌人'}发布猎杀令`}`
            });
        } else if (hero.tianweiId === 'yinyang_tianwei') {
            const all = [...gameState.player1Heroes, ...gameState.player2Heroes];
            const linked = all.find(item => item.effects.some(effect =>
                effect.sourceHeroId === hero.id && effect.name.startsWith('阳线')
            ));
            if (linked?.tianweiId) this.triggerTianwei(linked, gameState);
        } else if (hero.tianweiId === 'chenyuan_tianwei') {
            // 天威·归渊：立即恢复场上寒天总层数×4的生命，至多超过最大生命值上限10点
            const everyone = [...gameState.player1Heroes, ...gameState.player2Heroes];
            const stacks = everyone.reduce((sum, item) =>
                item.state === HeroState.ALIVE ? sum + this.getHantianStackCount(item) : sum, 0);
            const heal = stacks * 4;
            if (heal > 0) {
                const before = hero.currentHp;
                hero.currentHp = Math.min(hero.maxHp + 10, hero.currentHp + heal);
                this.addBattleLog(gameState, {
                    type: 'tianwei',
                    player: hero.owner,
                    message: `${hero.name}触发天威·归渊，汲取${stacks}层寒天恢复${hero.currentHp - before}点生命（当前${hero.currentHp}，上限${hero.maxHp + 10}）`
                });
            } else {
                this.addBattleLog(gameState, {
                    type: 'tianwei',
                    player: hero.owner,
                    message: `${hero.name}触发天威·归渊，但场上没有寒天可以汲取`
                });
            }
        } else if (hero.tianweiId === 't_painting_tianwei') {
            this.applyHeal(hero, 8, gameState, hero);
            for (const ally of hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes) {
                // 阵亡的召唤物仍留在名单里，只能给仍在场的单位回血
                if (ally.state === HeroState.ALIVE &&
                    ally.counters['__isSummon'] === 1 &&
                    ally.id.split('|')[2] === hero.id) {
                    this.applyHeal(ally, 8, gameState, hero);
                }
            }
        } else if (hero.tianweiId === 'libai_tianwei') {
            // 醉意上限 4 层（致知3 抬到 5 层）
            EffectManager.setCounter(hero, '醉意',
                Math.min(zhizhiValue(hero, 3, 4, 5), EffectManager.getCounter(hero, '醉意') + 2));
            this.addBattleLog(gameState, {
                type: 'tianwei',
                player: hero.owner,
                message: `${hero.name}触发天威，获得2点醉意`
            });
        } else if (hero.tianweiId === 'zuizhendao_tianwei') {
            // 醉意上限与 ZUIYI_MAX 同源（致知3 抬一层）
            EffectManager.setCounter(hero, '醉意',
                Math.min(zuiyiCap(hero), EffectManager.getCounter(hero, '醉意') + 2));
            this.addBattleLog(gameState, {
                type: 'tianwei',
                player: hero.owner,
                message: `${hero.name}触发天威，获得2点醉意`
            });
        } else if (hero.tianweiId === 'fengling_tianwei') {
            EffectManager.setCounter(hero, '猎砂', Math.min(4, EffectManager.getCounter(hero, '猎砂') + 2));
            const enemies = (hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes)
                .filter(target => target.state === HeroState.ALIVE && target.position && hero.position)
                .sort((left, right) => {
                    const leftDistance = MovementSystem.getManhattanDistance(hero.position!, left.position!);
                    const rightDistance = MovementSystem.getManhattanDistance(hero.position!, right.position!);
                    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
                    if (left.position![0] !== right.position![0]) return left.position![0] - right.position![0];
                    if (left.position![1] !== right.position![1]) return left.position![1] - right.position![1];
                    return left.id.localeCompare(right.id);
                });
            const target = enemies[0];
            this.addBattleLog(gameState, {
                type: 'tianwei',
                player: hero.owner,
                message: target
                    ? `${hero.name}触发天威，获得2层猎砂并追击最近的${target.name}`
                    : `${hero.name}触发天威，获得2层猎砂`,
                // 特效标记：Board 读到后派发"掠沙闪袭"（风铃残影闪到目标身边 + 爪痕撕咬，
                // 纯视觉表现，不产生任何真实位移）
                details: target
                    ? {
                        kind: 'fengling-pounce',
                        fxSkillId: 'fengling_pounce',
                        fxFrom: hero.position ? [...hero.position] : undefined,
                        fxTarget: target.position ? [...target.position] : undefined,
                    }
                    : undefined,
            });
            if (target) {
                const inSandDune = this.isInOwnSandDune(hero, gameState);
                // 追击走基础攻击（8 点）；致知3 直接给这一记补 2 点到 10
                const pursuit = this.calculate(hero, target, zhizhiValue(hero, 3, 0, 2), true, false, {
                    damageMultiplier: inSandDune ? 1.3 : 1,
                    critDamageBonus: inSandDune ? 0.2 : 0,
                });
                this.applyDamage(target, pursuit, hero, gameState);
            }
        } else if (hero.tianweiId === 'lingxi_tianwei') {
            // 天威·潮归：我方全员恢复场上潮汐总层数的生命，溢出部分转为自身护盾
            // （上限 10，致知3 抬到 15）
            const tide = totalTideOnEnemiesOf(gameState, hero.owner);
            if (tide > 0) {
                const allies = (hero.owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes)
                    .filter(candidate => candidate.state === HeroState.ALIVE);
                let overflow = 0;
                for (const ally of allies) {
                    const healed = this.applyHeal(ally, tide, gameState, hero);
                    overflow += Math.max(0, tide - healed);
                }
                const shieldCap = zhizhiValue(hero, 3, 10, 15);
                const shieldBefore = hero.shield;
                hero.shield = Math.min(shieldCap, hero.shield + overflow);
                const gainedShield = hero.shield - shieldBefore;
                this.addBattleLog(gameState, {
                    type: 'tianwei',
                    player: hero.owner,
                    message: `${hero.name}唤起潮归：${allies.length}名友方各恢复${tide}点生命` +
                        (gainedShield > 0 ? `，溢出凝为${gainedShield}点护盾（护盾${hero.shield}/${shieldCap}）` : ''),
                });
            }
        } else if (hero.tianweiId === 'dilan_tianwei') {
            const encoded = hero.counters['__dilan_kill_pos'];
            if (encoded !== undefined) {
                const center: [number, number] = [Math.floor(encoded / 6), encoded % 6];
                const positions = [center, ...MovementSystem.getAreaPositions(center, 3)];
                const affected = positions
                    .map(([row, col]) => gameState.board[row][col])
                    .filter((target): target is Hero =>
                        !!target && target.owner !== hero.owner && target.state === HeroState.ALIVE
                    );
                let hitCount = 0;
                let detonationCount = 0;
                this.asOneAttack(() => {
                    for (const target of affected) {
                        // 连锁风暴可能已在递归结算中击杀后续目标。
                        if (target.state !== HeroState.ALIVE) continue;
                        const featherStacks = getDilanFeatherStacks(target);
                        const detonatedStacks = featherStacks >= 3
                            ? consumeDilanFeather(target)
                            : 0;
                        const storm = this.calculate(
                            hero,
                            target,
                            5 * (detonatedStacks || 1),
                            false
                        );
                        this.applyDamage(target, storm, hero, gameState, true);
                        hitCount++;
                        if (detonatedStacks > 0) detonationCount++;
                        if (target.state === HeroState.ALIVE) {
                            // 风暴文本中的“然后施加1层羽化”在引爆后仍会执行。
                            addDilanFeather(target, hero, 1);
                            applyDilanWind(target, hero, '逆风');
                        }
                    }
                });
                this.addBattleLog(gameState, {
                    type: 'tianwei',
                    player: hero.owner,
                    message: `${hero.name}在阵亡位置卷起风暴，命中${hitCount}名敌人${
                        detonationCount > 0 ? `，引爆${detonationCount}个羽化目标` : ''
                    }`,
                });
            }
        } else if (hero.tianweiId === 'nanfeng_tianwei') {
            if (hero.position) {
                const [row, col] = hero.position;
                const rowDirection = chooseWindLaneDirection(gameState, hero.position, 'row', hero);
                const colDirection = chooseWindLaneDirection(gameState, hero.position, 'col', hero);
                createWindLane(gameState, hero, hero.position, rowDirection);
                createWindLane(gameState, hero, hero.position, colDirection);
                const labels: Record<string, string> = { up: '北', down: '南', left: '西', right: '东' };
                this.addBattleLog(gameState, {
                    type: 'tianwei',
                    player: hero.owner,
                    message: `${hero.name}触发天威，纵横风起：第${row + 1}行风${labels[rowDirection]}起、第${col + 1}列风${labels[colDirection]}起`,
                });
            }
        } else if (hero.tianweiId === 'lilith_tianwei') {
            const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
            this.asOneAttack(() => {
                for (const enemy of enemies.filter(item => item.state === HeroState.ALIVE)) {
                    EffectManager.addEffect(enemy, {
                        type: 'debuff', name: '恐惧', duration: 1, value: 0.2,
                        sourceHeroId: hero.id, description: '攻击降低20%，行动时可能失败',
                    });
                    if (Math.random() < 0.5) {
                        const damage = this.calculate(hero, enemy, 10, false);
                        this.applyDamage(enemy, damage, hero, gameState, true);
                    }
                }
            });
        } else if (hero.tianweiId === 'schrodinger_tianwei') {
            gameState.pendingBoardAction = { type: 'schrodinger-tianwei', heroId: hero.id };
        } else if (hero.tianweiId === 'feynman_tianwei') {
            const positions: [number, number][] = [];
            for (let row = 0; row < 6; row++) {
                for (let col = 0; col < 6; col++) positions.push([row, col]);
            }
            // 致知2：粒子风暴落点 8 → 12
            const stormCenters = zhizhiValue(hero, 2, 8, 12);
            // 致知3：被动扩范围所需能量 3 → 2
            const energyCost = zhizhiValue(hero, 3, 3, 2);
            const centers = positions.sort(() => Math.random() - 0.5).slice(0, stormCenters);
            const expanded = (hero.counters['能量'] ?? 0) >= energyCost;
            if (expanded) hero.counters['能量'] -= energyCost;
            const affected = new Set(centers.map(([row, col]) => `${row},${col}`));
            if (expanded) {
                for (const center of centers) {
                    for (const [row, col] of [center, ...MovementSystem.getAreaPositions(center, 3)]) {
                        affected.add(`${row},${col}`);
                    }
                }
            }
            this.asOneAttack(() => {
                for (const key of affected) {
                    const [row, col] = key.split(',').map(Number);
                    const target = gameState.board[row][col];
                    if (!target || target.owner === hero.owner || target.state !== HeroState.ALIVE) continue;
                    const damage = this.calculate(hero, target, 5, false);
                    this.applyDamage(target, damage, hero, gameState, true);
                    if (target.state === HeroState.ALIVE) {
                        EffectManager.addEffect(target, {
                            type: 'mark',
                            name: '粒子标记',
                            duration: 3,
                            stackCount: 1,
                            sourceHeroId: hero.id,
                            description: '粒子轰击的目标',
                        });
                        EffectManager.addCounter(hero, '能量', 1);
                    }
                }
            });
        } else if (hero.tianweiId === 'feixue_tianwei') {
            const enemies = hero.owner === 'player1' ? gameState.player2Heroes : gameState.player1Heroes;
            const candidates = enemies
                .filter(target =>
                    target.state === HeroState.ALIVE &&
                    target.position !== null &&
                    this.getHantianStackCount(target) > 0 &&
                    !EffectManager.hasEffect(target, '冰冻')
                )
                .sort((left, right) => {
                    const percentageDiff = left.currentHp / left.maxHp - right.currentHp / right.maxHp;
                    if (percentageDiff !== 0) return percentageDiff;
                    if (left.currentHp !== right.currentHp) return left.currentHp - right.currentHp;
                    const leftPosition = left.position ?? [6, 6];
                    const rightPosition = right.position ?? [6, 6];
                    if (leftPosition[0] !== rightPosition[0]) return leftPosition[0] - rightPosition[0];
                    if (leftPosition[1] !== rightPosition[1]) return leftPosition[1] - rightPosition[1];
                    return left.id.localeCompare(right.id);
                });

            const target = candidates[0];
            if (target) {
                EffectManager.addEffect(target, {
                    type: 'stun',
                    name: '冰冻',
                    duration: target.hasActedThisTurn ? 2 : 1,
                    sourceHeroId: hero.id,
                    description: '被绝对零度冻结；下一次行动被跳过',
                });
                this.addBattleLog(gameState, {
                    type: 'tianwei',
                    player: hero.owner,
                    message: `${hero.name}触发绝对零度，${target.name}立即进入冰冻`,
                    details: {
                        kind: 'feixue-absolute-zero',
                        sourceHeroId: hero.id,
                        targetHeroId: target.id,
                    },
                });
            }
        } else if (hero.tianweiId === 'hanjiangxue_tianwei') {
            hanjiangxueTianwei.execute(hero, gameState);
        } else if (hero.tianweiId === 'xueqi_tianwei') {
            // 天威·血誓不熄：每轮限一次，把决定权交回玩家选横扫中心格；
            // 实际结算在 game-store 的 resolvePendingBoardAction，避免击杀链里递归触发
            if ((hero.counters['tianwei_uses'] ?? 0) < 1) {
                hero.counters['tianwei_uses'] = (hero.counters['tianwei_uses'] ?? 0) + 1;
                gameState.pendingBoardAction = { type: 'xueqi-tianwei', heroId: hero.id };
                this.addBattleLog(gameState, {
                    type: 'tianwei',
                    player: hero.owner,
                    message: `${hero.name}触发天威·血誓不熄，请选择一处空格跃过去再掀起血誓横扫（被斩中者陷入愤怒）`
                });
            }
        } else if (hero.tianweiId === 'huanongying_tianwei') {
            // 花谢影不落：她击杀时影子立刻按七折追加一次重演；重演中的击杀因 in_replay 守卫不再连锁
            huanongyingTianweiExecute(hero, gameState);
        } else if (hero.tianweiId === 'yunying_tianwei') {
            // 燎原百斩：沿她与落点这条直线斩过再在落点炸开火圈，落点由玩家手点（挂起在 game-store 结算）
            requestYunyingTianweiLanding(hero, gameState);
        } else if (hero.tianweiId === 'zhiguang_tianwei') {
            // 万华镜：降落点由玩家手选（挂起在 game-store 结算），落点 5×5 内每人铺一枚棱并各吃4点
            requestZhiguangTianweiLanding(hero, gameState);
        } else if (hero.tianweiId === 'zhiyuan_tianwei') {
            // 纸鸢引线：她本人不打，而是把"下一次天威"交给下一个出手的队友——
            // 队友行动结束时由 game-engine 消费这个标记，触发那名队友自己的天威
            armZhiyuanTianweiLead(hero, gameState);
        } else if (hero.tianweiId === 'jiangtaigong_tianwei') {
            // 太公逐泽：击杀瞬间场上所有水泽向外扩一圈、各自多留一回合——泽越大，他这一家子越滑
            const expanded = expandMarshesForTianwei(gameState, hero);
            if (expanded === 0) {
                this.addBattleLog(gameState, {
                    type: 'tianwei',
                    player: hero.owner,
                    message: `${hero.name}天威·太公逐泽，可场上还没有一片水泽`,
                });
            }
        } else if (hero.tianweiId === 'jinghong_tianwei') {
            // 天威·惊鸿再振：击杀瞬间振翅再蓄，立即获得2层惊鸿（上限3层；满层时明确播报不落空）
            const before = EffectManager.getCounter(hero, '惊鸿');
            const after = Math.min(JINGHONG_MAX, before + 2);
            EffectManager.setCounter(hero, '惊鸿', after);
            this.addBattleLog(gameState, {
                type: 'tianwei',
                player: hero.owner,
                message: after > before
                    ? `${hero.name}天威·惊鸿再振，惊鸿${before}层→${after}层`
                    : `${hero.name}惊鸿已满，天威·惊鸿再振只振了个翅`,
            });
        }
        // 只有镜会真正走到里面去（其余英雄在函数开头就被 passiveId 挡掉）
        this.triggerMirrorBrokenBlade(hero, gameState, true);
    }

    /**
     * 镜花·水月天威的回声：击杀后随机点一名尚有天威的存活友方，
     * 原地结算一次它的"击杀型天威"。排除镜花自己（她的天威是登场型，回声会递归）。
     * 返回被回声的英雄名，供调用方写日志；无人可回声返回 null。
     */
    static rollRandomAllyTianwei(gameState: GameState, owner: Player, excludeHeroId: string): Hero | null {
        const pool = (owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes).filter(hero =>
            hero.id !== excludeHeroId &&
            hero.state === HeroState.ALIVE &&
            !!hero.position &&
            !!hero.tianweiId &&
            hero.passiveId !== 'jinghua_passive');
        if (pool.length === 0) {
            // 无人可回声也要明确播报——否则击杀后静默，很容易被当成没实现
            this.addBattleLog(gameState, {
                type: 'system',
                player: owner,
                message: '镜花照水击杀成功，但场上没有携带天威的友方可以回声'
            });
            return null;
        }
        const pick = pool[Math.floor(Math.random() * pool.length)];
        this.triggerTianwei(pick, gameState);
        this.addBattleLog(gameState, {
            type: 'tianwei',
            player: owner,
            message: `月影回声：${pick.name}的天威随镜花照水一同响起`
        });
        return pick;
    }

    private static isInOwnSandDune(hero: Hero, gameState: GameState): boolean {
        if (!hero.position) return false;
        return (gameState.boardEffects ?? []).some(effect =>
            effect.type === 'sand-dune' &&
            effect.sourceHeroId === hero.id &&
            Math.abs(effect.position[0] - hero.position![0]) <= 1 &&
            Math.abs(effect.position[1] - hero.position![1]) <= 1
        );
    }

    private static trackFenglingConsecutiveHit(attacker: Hero, target: Hero, gameState: GameState): void {
        const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];
        const existingLock = target.effects.some(effect =>
            effect.name === '猎砂锁定' && effect.sourceHeroId === attacker.id
        );

        for (const hero of allHeroes) {
            hero.effects = hero.effects.filter(effect =>
                !(effect.name === '猎砂锁定' && effect.sourceHeroId === attacker.id)
            );
        }
        EffectManager.addEffect(target, {
            type: 'mark',
            name: '猎砂锁定',
            duration: -1,
            sourceHeroId: attacker.id,
            description: '风铃正在连续猎杀该目标',
        });

        if (!existingLock) return;
        const nextStacks = Math.min(4, EffectManager.getCounter(attacker, '猎砂') + 1);
        EffectManager.setCounter(attacker, '猎砂', nextStacks);
        this.addBattleLog(gameState, {
            type: 'passive',
            player: attacker.owner,
            message: `${attacker.name}连续命中${target.name}，获得1层猎砂（当前${nextStacks}层）`,
        });
    }

    /**
     * 获取暴击率
     */
    private static getCritRate(hero: Hero): number {
        const critRates = this.getModifiers(hero, 'critRate');
        return Math.min(1, critRates.reduce((sum, rate) => sum + rate, 0));
    }

    /**
     * 获取暴击伤害倍率
     */
    private static getCritDamage(hero: Hero): number {
        const baseCritDamage = 1.5; // 基础暴击倍率
        const critDamageBonuses = this.getModifiers(hero, 'critDamage');
        return baseCritDamage + critDamageBonuses.reduce((sum, bonus) => sum + bonus, 0);
    }

    /**
     * 当前实际暴击率（含灵犀/猎砂/暴击率类增益），供英雄信息卡展示。
     * 与战斗判定共用同一口径，但不包含单次攻击的临时加成（如夜枭潜行层数）。
     */
    static getDisplayedCritRate(hero: Hero): number {
        return this.getCritRate(hero);
    }

    /**
     * 当前暴击伤害倍率（基础1.5倍，即额外+50%伤害），供英雄信息卡展示。
     */
    static getDisplayedCritDamage(hero: Hero): number {
        return this.getCritDamage(hero);
    }

    /**
     * 获取修正值（从效果和计数器中提取）
     */
    private static getModifiers(hero: Hero, type: string): number[] {
        const modifiers: number[] = [];

        if (hero.passiveId === 'fengling_passive') {
            const huntSand = Math.min(4, Math.max(0, EffectManager.getCounter(hero, '猎砂')));
            if (type === 'attackBonus' || type === 'critRate') {
                modifiers.push(huntSand * 0.2);
            }
        }

        // 从效果中提取
        for (const effect of hero.effects) {
            if (effect.type === 'buff' && effect.value !== undefined) {
                // 根据效果名称判断类型
                // 这里简化处理，实际应该在effect中有明确的修正类型
                if (type === 'attackBonus' && (effect.name.includes('攻击') || effect.name === '来财')) {
                    modifiers.push(effect.value);
                } else if (type === 'damageBonus' && effect.name.includes('增伤')) {
                    modifiers.push(effect.value);
                } else if (type === 'critRate' && effect.name.includes('暴击率')) {
                    modifiers.push(effect.value);
                } else if (type === 'critDamage' && effect.name.includes('暴伤')) {
                    modifiers.push(effect.value);
                } else if (type === 'vampire' && effect.name.includes('吸血')) {
                    modifiers.push(effect.value);
                } else if (type === 'damageReduction' && effect.name.includes('免伤')) {
                    modifiers.push(effect.value);
                }
            }
        }

        return modifiers;
    }

    /**
     * 计算治疗
     */
    static calculateHeal(healer: Hero, target: Hero, baseHeal: number): number {
        void target;
        let finalHeal = baseHeal;

        // 获取治疗加成
        const healBonuses = this.getModifiers(healer, 'healBonus');
        for (const bonus of healBonuses) {
            finalHeal *= (1 + bonus);
        }

        return Math.floor(finalHeal);
    }

    /**
     * 应用治疗。传入 gameState 时会写入带位置信息的治疗日志，供 UI 飘字使用。
     */
    static applyHeal(target: Hero, healAmount: number, gameState?: GameState, healer?: Hero): number {
        // 夺岁的「禁血」：收口在这里，一次性掐掉所有治疗来源（吸血、潮汐、和声、奶妈技能…），
        // 免得每个治疗点都要各自记得问一句"今天禁不禁"。
        if (healAmount > 0 && EffectManager.hasEffect(target, JINXUE_EFFECT)) {
            if (gameState?.battleLog && target.state === HeroState.ALIVE && target.position) {
                gameState.battleLog.push({
                    id: nextBattleLogId(),
                    type: 'effect',
                    player: target.owner,
                    message: `${target.name}被禁血，${healAmount}点治疗落空`,
                    timestamp: Date.now(),
                    details: {
                        kind: 'effect',
                        sourceHeroId: healer?.id,
                        targetHeroId: target.id,
                        amount: 0,
                        position: [...target.position],
                    },
                });
            }
            return 0;
        }

        const oldHp = target.currentHp;
        target.currentHp = Math.min(target.maxHp, target.currentHp + healAmount);
        const healed = target.currentHp - oldHp; // 实际治疗量

        if (gameState && healed > 0) {
            recordBattleHealing(gameState, healer ?? target, healed);
        }

        if (gameState?.battleLog && healed > 0 && target.state === HeroState.ALIVE && target.position) {
            gameState.battleLog.push({
                id: nextBattleLogId(),
                type: 'heal',
                player: target.owner,
                message: `${target.name}恢复了${healed}点生命`,
                timestamp: Date.now(),
                details: {
                    kind: 'heal',
                    sourceHeroId: healer?.id,
                    targetHeroId: target.id,
                    amount: healed,
                    position: [...target.position],
                }
            });
            // 攻击附带的治疗另出恢复段，攻击落点仍保留原有打击特效。
            const recoveryId = healer?.passiveId === 'lingxi_passive' ? 'lingxi_regen'
                : healer?.passiveId === 'pipa_passive' ? 'pipa_heal'
                    : healer?.passiveId === 'skeletonking_passive' ? 'skeletonking_heal'
                        : healer?.passiveId === 'mowen_passive' ? 'mowen_restore' : undefined;
            if (recoveryId && healer) requestRecoveryFx(healer, target, recoveryId, gameState);
        }

        return healed;
    }
}
