import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/core/game-engine';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { EffectManager } from '../../src/core/effect-manager';
import { SkillSystem } from '../../src/core/skill-system';
import { getDilanFeatherStacks } from '../../src/data/extended-heroes';
import { zhiyuanSkill1, zhiyuanSkill2 } from '../../src/data/extended-skills';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { getHeroInfo } from '../../src/data/heroes';
import {
    addSpool,
    getSpoolStacks,
    noteZhiyuanAttack,
    removeSpools,
    spoolTravelCells,
    ZHIYUAN_KNOCKUP_EVERY,
    ZHIYUAN_SPOOL_MAX,
} from '../../src/core/kite-spool';
import { HeroState } from '../../src/types/game';
import type { Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 纸鸢：线轴（挂在敌人身上的永久标记）→ 收线按层数结算 → 断线一次烧光换连击；
 * 友方每次出手她追一发并放线；每出手 3 次的下一击附带击飞；天威把下一次天威交给队友。
 */

function scene() {
    const state = makeGameState();
    const kite = addHero(state, 'zhiyuan', 'player1', [2, 2]);
    kite.defense = 0;
    return { state, kite };
}

function enemy(state: ReturnType<typeof makeGameState>, position: [number, number]) {
    const unit = addHero(state, 'baize', 'player2', position);
    unit.defense = 0;
    return unit;
}

/** 一次普通出手：走引擎的"出手组"，纸鸢的追击与计数才按实战口径推进 */
function attackOnce(attacker: Hero, target: Hero, state: ReturnType<typeof makeGameState>, amount = 5) {
    const hit = DamageCalculator.calculate(attacker, target, amount, false);
    DamageCalculator.asOneAttack(() => DamageCalculator.applyDamage(target, hit, attacker, state));
    return hit.finalDamage;
}

describe('纸鸢 · 面板与线轴', () => {
    it('生命45、移动力3、武曲', () => {
        const info = getHeroInfo('zhiyuan');
        expect(info.name).toBe('纸鸢');
        expect(info.class).toBe('武曲');
        expect(info.description).toBe('牵线轴、乘队友攻击追击、攒线换连击。生命45，移动力3');
        const { kite } = scene();
        expect([kite.maxHp, kite.moveRange]).toEqual([45, 3]);
    });

    it('线轴每次+1层、封顶5层，收线返回并清空层数', () => {
        const { state, kite } = scene();
        const target = enemy(state, [2, 3]);
        expect(addSpool(target, kite)).toBe(1);
        expect(addSpool(target, kite)).toBe(2);
        for (let index = 0; index < 8; index++) addSpool(target, kite);
        expect(getSpoolStacks(target, kite.id)).toBe(ZHIYUAN_SPOOL_MAX);
        expect(removeSpools(target, kite.id)).toBe(ZHIYUAN_SPOOL_MAX);
        expect(getSpoolStacks(target, kite.id)).toBe(0);
    });

    it('线轴飞回纸鸢的轨迹是连续的直线格，不含两端', () => {
        expect(spoolTravelCells([2, 4], [0, 1])).toEqual([[1, 3], [1, 2]]);
        expect(spoolTravelCells([2, 3], [2, 2])).toEqual([]);
    });
});

describe('纸鸢 · 技能一「收线·回风」', () => {
    it('带线轴的敌人吃 4+线轴×2，轨迹上的敌人吃 2+线轴×2，并各挂一层羽化', () => {
        const { state, kite } = scene();
        const holder = enemy(state, [2, 4]);
        const rider = enemy(state, [2, 3]);      // 在 holder→纸鸢 的直线上
        addSpool(holder, kite);
        addSpool(holder, kite);                  // 2 层

        const output = SkillSystem.executeSkill(kite, zhiyuanSkill1, [[2, 2]], state);

        expect(output.success).toBe(true);
        expect(output.damageDealt).toEqual([8, 6]);   // 4+2×2=8，2+2×2=6
        // 她自己的出手不再引出追击：收走的线轴不会被那一发重新牵回来
        expect(getSpoolStacks(holder, kite.id)).toBe(0);
        expect(state.battleLog.some(entry => String(entry.message).includes('顺线追出'))).toBe(false);
        expect(getDilanFeatherStacks(holder)).toBe(1);
        expect(getDilanFeatherStacks(rider)).toBe(1);
    });

    it('特效方向是从敌人收回到她自己，不是她朝敌人射线', () => {
        const { state, kite } = scene();
        const near = enemy(state, [2, 3]);
        const far = enemy(state, [0, 1]);
        addSpool(near, kite);
        addSpool(far, kite);

        SkillSystem.executeSkill(kite, zhiyuanSkill1, [[2, 2]], state);

        const anchored = state.battleLog
            .map(entry => entry.details?.skillFxRequest as
                { skillId: string; fromPos: number[]; targetPos: number[] } | undefined)
            .filter(request => request?.skillId === 'zhiyuan_skill1');
        expect(anchored).toHaveLength(1);
        // 起手格是离她最远的那名带线轴敌人，落点是纸鸢脚下
        expect(anchored[0].fromPos).toEqual([0, 1]);
        expect(anchored[0].targetPos).toEqual([2, 2]);
    });

    it('5×5 外与没挂线轴的敌人都不吃这一刀', () => {
        const { state, kite } = scene();
        const far = enemy(state, [0, 5]);       // 距离纸鸢 3+3，超出 5×5
        const near = enemy(state, [1, 3]);      // 在范围内但没线
        addSpool(far, kite);

        const output = SkillSystem.executeSkill(kite, zhiyuanSkill1, [[2, 2]], state);

        expect(output.success, '范围内没有线轴就不该放出这一刀').toBe(false);
        expect(far.currentHp).toBe(far.maxHp);
        expect(near.currentHp).toBe(near.maxHp);
    });

    it('范围内没有线轴时释放失败，不白按一次出手', () => {
        const { state, kite } = scene();
        enemy(state, [2, 3]);
        expect(SkillSystem.executeSkill(kite, zhiyuanSkill1, [[2, 2]], state).success).toBe(false);
    });
});

describe('纸鸢 · 技能二「断线·冲天」', () => {
    it('保底一段，线轴每满3层再多送一段，最多4段', () => {
        const { state, kite } = scene();
        const target = enemy(state, [2, 3]);
        const other = enemy(state, [1, 3]);
        for (let index = 0; index < 4; index++) addSpool(target, kite);
        for (let index = 0; index < 4; index++) addSpool(other, kite);   // 共 8 层 → 1+2 = 3 段

        const output = SkillSystem.executeSkill(kite, zhiyuanSkill2, [[2, 3]], state);

        expect(output.success).toBe(true);
        expect(output.damageDealt).toEqual([6, 6, 6]);
        expect(getSpoolStacks(other, kite.id), '全场线轴一次烧光').toBe(0);
        // 她自己的出手不追：烧光的线不会被一发追击又牵回来一层
        expect(getSpoolStacks(target, kite.id)).toBe(0);
    });

    it('线轴再多也只算4段', () => {
        const { state, kite } = scene();
        const target = enemy(state, [2, 3]);
        const bankA = enemy(state, [0, 1]);
        const bankB = enemy(state, [4, 1]);
        for (let index = 0; index < ZHIYUAN_SPOOL_MAX; index++) {
            addSpool(target, kite);
            addSpool(bankA, kite);
            addSpool(bankB, kite);   // 5×3=15 层 → 1+5 = 6 段，封顶 4
        }

        const output = SkillSystem.executeSkill(kite, zhiyuanSkill2, [[2, 3]], state);
        expect(output.damageDealt).toHaveLength(4);
    });

    it('一层线轴都没有，也照样砍得出保底的一段', () => {
        const { state, kite } = scene();
        const target = enemy(state, [2, 3]);

        const output = SkillSystem.executeSkill(kite, zhiyuanSkill2, [[2, 3]], state);

        expect(output.success).toBe(true);
        expect(output.damageDealt).toEqual([6]);
    });

    it('斩完朝攻击反方向退一格；退路被占则站着不动', () => {
        const { state, kite } = scene();
        const target = enemy(state, [2, 3]);
        for (let index = 0; index < 3; index++) addSpool(target, kite);
        expect(SkillSystem.executeSkill(kite, zhiyuanSkill2, [[2, 3]], state).success).toBe(true);
        expect(kite.position).toEqual([2, 1]);      // 攻击朝 +列，反作用退到同一行的 (2,1)

        const blocked = scene();
        enemy(blocked.state, [2, 1]);               // 退路站了人
        const holder = enemy(blocked.state, [2, 3]);
        for (let index = 0; index < 3; index++) addSpool(holder, blocked.kite);
        SkillSystem.executeSkill(blocked.kite, zhiyuanSkill2, [[2, 3]], blocked.state);
        expect(blocked.kite.position).toEqual([2, 2]);
    });
});

describe('纸鸢 · 被动「牵丝」与击飞', () => {
    it('友方出手后纸鸢追出4点并挂一层线轴，一次出手只追一次', () => {
        const { state, kite } = scene();
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        ally.defense = 0;
        const target = enemy(state, [2, 4]);

        const dealt = attackOnce(ally, target, state);

        expect(target.currentHp).toBe(target.maxHp - dealt - 4);
        expect(getSpoolStacks(target, kite.id)).toBe(1);
    });

    it('她自己的出手不引出追击：只有队友打完一手她才顺线追', () => {
        const { state, kite } = scene();
        const target = enemy(state, [2, 4]);

        const dealt = attackOnce(kite, target, state);

        // 只有本体那一击，没有追击，也不会挂上线轴
        expect(target.currentHp).toBe(target.maxHp - dealt);
        expect(getSpoolStacks(target, kite.id)).toBe(0);
        expect(state.battleLog.some(entry => String(entry.message).includes('顺线追出'))).toBe(false);
        // 出手计数照旧推进（击飞节奏不受影响）
        expect(kite.counters['__zhiyuan_attacks']).toBe(1);
    });

    it('群攻一次出手只追一次（从被命中者里取一个）', () => {
        const { state, kite } = scene();
        const ally = addHero(state, 'moran', 'player1', [2, 1]);
        const first = enemy(state, [2, 4]);
        const second = enemy(state, [1, 4]);
        const totalBefore = first.currentHp + second.currentHp;

        const hit = DamageCalculator.calculate(ally, first, 5, false);
        DamageCalculator.asOneAttack(() => {
            DamageCalculator.applyDamage(first, hit, ally, state);
            DamageCalculator.applyDamage(second, hit, ally, state);
        });

        expect(totalBefore - (first.currentHp + second.currentHp)).toBe(hit.finalDamage * 2 + 4);
    });

    it('每出手3次的下一击附带击飞：本回合没行动过的人被打断', () => {
        const { state, kite } = scene();
        const victim = enemy(state, [2, 4]);
        for (let index = 0; index < ZHIYUAN_KNOCKUP_EVERY; index++) noteZhiyuanAttack(kite);

        attackOnce(kite, victim, state);

        expect(EffectManager.hasEffect(victim, '击飞')).toBe(true);
        expect(EffectManager.isStunned(victim)).toBe(true);
    });

    it('计数没满 3 次时不会附带击飞', () => {
        const { state, kite } = scene();
        const victim = enemy(state, [2, 4]);
        noteZhiyuanAttack(kite);   // 只攒了 1 次，她这一手本身也只计 1 次，离 3 次还差

        attackOnce(kite, victim, state);

        expect(EffectManager.hasEffect(victim, '击飞')).toBe(false);
    });

    it('已经行动过的敌人吃不到击飞', () => {
        const { state, kite } = scene();
        const victim = enemy(state, [2, 4]);
        for (let index = 0; index < ZHIYUAN_KNOCKUP_EVERY; index++) noteZhiyuanAttack(kite);
        victim.hasActedThisTurn = true;

        attackOnce(kite, victim, state);

        expect(EffectManager.hasEffect(victim, '击飞')).toBe(false);
    });
});

describe('纸鸢 · 天威「纸鸢引线」', () => {
    it('击杀后把引线交给下一个出手的队友，他行动结束时响起自己的天威', () => {
        const { state, kite } = scene();
        const ally = addHero(state, 'jinghong', 'player1', [1, 2]);
        const doomed = enemy(state, [2, 4]);
        doomed.currentHp = 1;

        attackOnce(kite, doomed, state);
        expect(doomed.state).not.toBe(HeroState.ALIVE);
        expect(kite.counters['__zhiyuan_lead']).toBe(1);

        const before = EffectManager.getCounter(ally, '惊鸿');
        GameEngine.endHeroAction(ally, state);
        expect(EffectManager.getCounter(ally, '惊鸿')).toBe(before + 2);
        expect(kite.counters['__zhiyuan_lead']).toBe(0);
    });

    it('纸鸢本人不消费自己的引线，没有天威的队友也不消耗标记', () => {
        const { state, kite } = scene();
        const doomed = enemy(state, [2, 4]);
        doomed.currentHp = 1;
        attackOnce(kite, doomed, state);

        GameEngine.endHeroAction(kite, state);
        expect(kite.counters['__zhiyuan_lead']).toBe(1);

        const plain = addHero(state, 'liuli', 'player1', [1, 2]);
        GameEngine.endHeroAction(plain, state);
        expect(kite.counters['__zhiyuan_lead']).toBe(1);
    });
});

describe('纸鸢 · 致知', () => {
    it('致知一生命+8，致知二连击6→7，致知三追击4→5', () => {
        const { state, kite } = scene();
        grantZhizhi(kite, 1);
        grantZhizhi(kite, 2);
        grantZhizhi(kite, 3);
        expect(kite.maxHp).toBe(53);

        const target = enemy(state, [2, 3]);
        const bank = enemy(state, [1, 3]);
        for (let index = 0; index < ZHIYUAN_SPOOL_MAX; index++) {
            addSpool(target, kite);
            addSpool(bank, kite);      // 共 10 层 → 1+3 = 4 段
        }
        const output = SkillSystem.executeSkill(kite, zhiyuanSkill2, [[2, 3]], state);
        expect(output.damageDealt).toEqual([7, 7, 7, 7]);

        const ally = addHero(state, 'moran', 'player1', [1, 1]);
        const chase = enemy(state, [1, 4]);
        const before = chase.currentHp;
        attackOnce(ally, chase, state);
        // 本体 5 点 + 追击 5 点（致知三把追击从 4 抬到 5）
        expect(before - chase.currentHp).toBe(10);
    });
});
