import { GameState, Hero, HeroState } from '../types/game';
import { DamageCalculator } from './damage-calculator';
import { EffectManager } from './effect-manager';

/**
 * 回锋「破锋 / 连破 / 啸刃 / 锋鸣」体系：
 * - 破锋：回锋自身的层数，每层提升10%伤害（作用于回锋造成的所有伤害），上限5层；
 *   只有技能1「连刃斩」的每一段会叠层。
 * - 连破：技能2与天威施加的永久标记（无持续时间）；叠满2层时消耗这2层，凝成啸刃。
 * - 啸刃：永久标记。回锋每一次对带啸刃目标造成伤害，都会给该目标叠1层锋鸣。
 * - 锋鸣：目标身上最多3层。满3层立即清空，并由回锋自动释放一次连刃斩；
 *   自动连刃斩的3段各自从场上存活敌人里随机挑选目标（同一个敌人可能挨两下，
 *   也可能一下都没有）。自动连斩同样会叠锋鸣，因此允许同回合连环触发，
 *   只用 HUIFENG_AUTO_CHAIN_LIMIT 兜住递归深度。
 */

export const HUIFENG_COMBO_HITS = 3;
export const HUIFENG_COMBO_BASE = 4;
export const HUIFENG_MARK_BASE = 5;
/** 技能2随机标记的目标数；场上不足两名时按实际存活敌人数结算 */
export const HUIFENG_MARK_TARGETS = 2;
export const HUIFENG_TIANWEI_BASE = 4;
export const HUIFENG_POFENG_MAX = 5;
export const HUIFENG_FENGMING_MAX = 3;
export const HUIFENG_LIANPO_TO_XIAOREN = 2;
/** 一次行动里自动连刃斩的连锁上限，仅用于兜住「随机目标→再满3层→再自动」的递归 */
const HUIFENG_AUTO_CHAIN_LIMIT = 6;

/** 一次回锋出手的共享上下文：同一次技能/天威结算内的日志、伤害与连锁计数 */
export interface HuifengStrikeContext {
    log: string[];
    damageDealt: number[];
    autoCast: number;
}

export function createHuifengStrikeContext(): HuifengStrikeContext {
    return { log: [], damageDealt: [], autoCast: 0 };
}

/** 场上可被回锋攻击的敌方单位（已部署且存活） */
function livingEnemies(caster: Hero, gameState: GameState): Hero[] {
    const owner = caster.owner === 'player1' ? 'player2' : 'player1';
    const pool = owner === 'player1' ? gameState.player1Heroes : gameState.player2Heroes;
    return pool.filter(unit => unit.state === HeroState.ALIVE && unit.position !== null);
}

/** 随机挑选至多 count 名互不重复的存活敌方单位（敌人不足时按实际数量） */
export function pickHuifengMarkTargets(
    caster: Hero,
    gameState: GameState,
    count: number = HUIFENG_MARK_TARGETS
): Hero[] {
    const pool = livingEnemies(caster, gameState);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(count, pool.length));
}

/** 破锋提供的增伤系数：1 + 层数×10%，层数封顶5 */
export function huifengPoFengAmp(caster: Hero): number {
    return 1 + Math.min(HUIFENG_POFENG_MAX, EffectManager.getCounter(caster, '破锋')) * 0.1;
}

/** 回锋施加在某个敌人身上的标记层数 */
export function huifengMarkStacks(target: Hero, caster: Hero, markName: string): number {
    return target.effects.find(
        effect => effect.name === markName && effect.sourceHeroId === caster.id
    )?.stackCount ?? 0;
}

function removeHuifengMark(target: Hero, caster: Hero, markName: string): void {
    target.effects = target.effects.filter(
        effect => !(effect.name === markName && effect.sourceHeroId === caster.id)
    );
}

/** 叠一层破锋（封顶5层） */
function gainPoFeng(caster: Hero): number {
    const stacks = Math.min(HUIFENG_POFENG_MAX, EffectManager.getCounter(caster, '破锋') + 1);
    EffectManager.setCounter(caster, '破锋', stacks);
    return stacks;
}

/** 啸刃凝形：永久标记，同一目标只挂一层 */
function grantXiaoRen(target: Hero, caster: Hero, context: HuifengStrikeContext): void {
    if (huifengMarkStacks(target, caster, '啸刃') > 0) {
        context.log.push(`${target.name}的连破满${HUIFENG_LIANPO_TO_XIAOREN}层，啸刃已在身`);
        return;
    }
    EffectManager.addEffect(target, {
        type: 'mark',
        name: '啸刃',
        duration: -1,
        stackCount: 1,
        sourceHeroId: caster.id,
        description: '回锋的永久标记：每次被回锋攻击都会叠加1层锋鸣',
    });
    context.log.push(`${target.name}的连破满${HUIFENG_LIANPO_TO_XIAOREN}层，啸刃成形！`);
}

/** 施加一层永久连破；叠满2层时消耗这2层，凝成啸刃 */
export function addHuifengLianPo(
    target: Hero,
    caster: Hero,
    context: HuifengStrikeContext
): void {
    if (target.state !== HeroState.ALIVE) return;
    const stacks = huifengMarkStacks(target, caster, '连破') + 1;
    if (stacks >= HUIFENG_LIANPO_TO_XIAOREN) {
        removeHuifengMark(target, caster, '连破');
        grantXiaoRen(target, caster, context);
        return;
    }
    EffectManager.addEffect(target, {
        type: 'mark',
        name: '连破',
        duration: -1,
        stackCount: 1,
        sourceHeroId: caster.id,
        description: '回锋的永久标记，无持续时间；再叠1层凝成啸刃',
    });
    context.log.push(`${target.name}获得连破（${stacks}层，永久）`);
}

/** 一次攻击完成后叠锋鸣；满3层清空并自动释放连刃斩 */
function gainFengming(
    target: Hero,
    caster: Hero,
    gameState: GameState,
    context: HuifengStrikeContext
): void {
    if (target.state !== HeroState.ALIVE) return;
    if (huifengMarkStacks(target, caster, '啸刃') === 0) return;

    const stacks = huifengMarkStacks(target, caster, '锋鸣') + 1;
    if (stacks < HUIFENG_FENGMING_MAX) {
        EffectManager.addEffect(target, {
            type: 'mark',
            name: '锋鸣',
            duration: -1,
            stackCount: 1,
            sourceHeroId: caster.id,
            description: `满${HUIFENG_FENGMING_MAX}层时回锋自动释放一次连刃斩`,
        });
        context.log.push(`${target.name}锋鸣+1（${stacks}/${HUIFENG_FENGMING_MAX}层）`);
        return;
    }

    removeHuifengMark(target, caster, '锋鸣');
    if (context.autoCast >= HUIFENG_AUTO_CHAIN_LIMIT) {
        context.log.push(`${target.name}锋鸣满${HUIFENG_FENGMING_MAX}层，但本轮连锁已达上限`);
        return;
    }
    context.autoCast++;
    context.log.push(`${caster.name}锋鸣满${HUIFENG_FENGMING_MAX}层，连刃斩自动出鞘！`);
    executeHuifengCombo(caster, null, gameState, context, true);
}

/**
 * 回锋的单次伤害结算：破锋加成 → 计算并施加伤害 → 攻击带啸刃的目标则叠锋鸣。
 * gainPoFeng 为真时（仅连刃斩的每一段）额外叠1层破锋。
 */
function huifengStrike(
    caster: Hero,
    target: Hero,
    baseDamage: number,
    gameState: GameState,
    context: HuifengStrikeContext,
    options: { label: string; gainPoFeng: boolean }
): void {
    if (target.state !== HeroState.ALIVE) return;

    const damage = DamageCalculator.calculate(
        caster,
        target,
        baseDamage * huifengPoFengAmp(caster),
        false
    );
    DamageCalculator.applyDamage(target, damage, caster, gameState);
    context.damageDealt.push(damage.finalDamage);

    const poFengNote = options.gainPoFeng ? `，破锋${gainPoFeng(caster)}层` : '';
    context.log.push(
        `${caster.name}${options.label}${target.name}，造成${damage.finalDamage}点伤害${poFengNote}`
    );

    gainFengming(target, caster, gameState, context);
}

/**
 * 连刃斩：3段攻击。手动释放时3段全部落在选定的那名敌人身上；
 * 锋鸣自动释放时每一段各自从场上存活敌人里随机挑一个目标。
 */
export function executeHuifengCombo(
    caster: Hero,
    target: Hero | null,
    gameState: GameState,
    context: HuifengStrikeContext,
    randomTargets: boolean
): void {
    for (let hit = 1; hit <= HUIFENG_COMBO_HITS; hit++) {
        let victim = target;
        if (randomTargets) {
            const enemies = livingEnemies(caster, gameState);
            if (enemies.length === 0) return;
            victim = enemies[Math.floor(Math.random() * enemies.length)];
        }
        if (!victim || victim.state !== HeroState.ALIVE) {
            context.log.push(`${caster.name}的目标已经倒下，连刃斩余下的段数落空`);
            return;
        }
        huifengStrike(caster, victim, HUIFENG_COMBO_BASE, gameState, context, {
            label: randomTargets ? `第${hit}段随机连刃斩` : `第${hit}段连刃斩`,
            gainPoFeng: true,
        });
    }
}

/** 技能2的单次出手：先结算伤害（含锋鸣连锁），目标仍在场再补一层连破 */
export function huifengMarkStrike(
    caster: Hero,
    target: Hero,
    gameState: GameState,
    context: HuifengStrikeContext
): void {
    huifengStrike(caster, target, HUIFENG_MARK_BASE, gameState, context, {
        label: '风过留痕斩中',
        gainPoFeng: false,
    });
    addHuifengLianPo(target, caster, context);
}

/** 天威：对场上所有带连破标记的敌人各造成4点伤害，并再叠1层连破 */
export function executeHuifengTianwei(caster: Hero, gameState: GameState): void {
    if (!caster.position) return;
    const marked = livingEnemies(caster, gameState).filter(
        enemy => huifengMarkStacks(enemy, caster, '连破') > 0
    );
    if (marked.length === 0) return;

    const context = createHuifengStrikeContext();
    for (const target of marked) {
        huifengStrike(caster, target, HUIFENG_TIANWEI_BASE, gameState, context, {
            label: '天威刃鸣贯穿',
            gainPoFeng: false,
        });
    }
    for (const target of marked) {
        addHuifengLianPo(target, caster, context);
    }
    if (gameState.battleLog) {
        for (const message of context.log) {
            gameState.battleLog.push({
                id: `log-${Date.now()}-${Math.random()}`,
                type: 'tianwei',
                player: caster.owner,
                message,
                timestamp: Date.now(),
            });
        }
    }
}
