import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { SkillSystem } from '../../src/core/skill-system';
import { addTide, getTideStacks, totalTideOnEnemiesOf } from '../../src/data/extended-heroes';
import {
    drainPendingSkillFxRequests,
    lingxiSkill1,
    lingxiSkill2,
    xubaiSkill1,
    LINGXI_ECHO1_DAMAGE,
} from '../../src/data/extended-skills';
import { createHero } from '../../src/data/heroes';
import { useGameStore } from '../../src/store/game-store';
import { GameState, Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 泠汐「潮汐多段攻击」回归。
 *
 * 裁定（与策划确认）：
 * 1. 延迟段只跨到更晚的回合才可结算；技能1每次施放（含合并）都会续挂下一发，可以无限链；
 * 2. 潮汐是敌人身上的 debuff（上限3层），只有泠汐的伤害触发回血，可被叙白净化；
 * 3. 技能2的回潮沿用施放方向的前方2×3，一次性消耗命中敌人的潮汐并按层数×3自疗；技能2不参与合并；
 * 4. 被动按"一次技能动作=一段"积攒助力，下一个出手的友方一次领走全部层数，可叠加、跨回合保留；
 * 5. 天威在击杀敌人后触发。
 */

function setup(): { state: GameState; lingxi: Hero; near: Hero; far: Hero; ally: Hero } {
    const state = makeGameState();
    const lingxi = addHero(state, 'lingxi', 'player1', [2, 2]);
    const near = addHero(state, 'moran', 'player2', [2, 3]);      // 3×3 与 5×5 内
    const far = addHero(state, 'baize', 'player2', [0, 4]);       // 只在 5×5 内
    const ally = addHero(state, 'liuli', 'player1', [3, 3]);
    return { state, lingxi, near, far, ally };
}

const cast1 = (lingxi: Hero, state: GameState) =>
    SkillSystem.executeSkill(lingxi, lingxiSkill1, [[2, 3]], state);

describe('泠汐', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('模板字段与天威注册', () => {
        const hero = createHero('lingxi', 'player1', [0, 0]);
        expect(hero.name).toBe('泠汐');
        expect(hero.maxHp).toBe(50);
        expect(hero.moveRange).toBe(2);
        expect(hero.skill1Id).toBe('lingxi_skill1');
        expect(hero.skill2Id).toBe('lingxi_skill2');
        expect(hero.tianweiId).toBe('lingxi_tianwei');
    });

    it('技能1：3×3造成2点伤害并各施加1层潮汐，同时挂下下一回合的回响', () => {
        const { state, lingxi, near, far } = setup();

        const result = cast1(lingxi, state);

        expect(result.success).toBe(true);
        expect(SkillSystem.getValidTargetPositions(lingxi, lingxiSkill1, state).length).toBe(9);
        expect(near.currentHp).toBe(near.maxHp - 2);
        expect(far.currentHp, '5×5外的敌人不该被普通段打到').toBe(far.maxHp);
        expect(getTideStacks(near)).toBe(1);
        expect(lingxi.counters['lingxi_echo1_round']).toBe(state.roundNumber);
    });

    it('回响在下一回合由"泠汐已行动后的下一个友方行动结束"触发，再补3点并叠一层潮汐', () => {
        const { state, lingxi, near, ally } = setup();
        cast1(lingxi, state);

        state.roundNumber = 2;
        lingxi.hasActedThisTurn = true;
        GameEngine.endHeroAction(ally, state);

        expect(near.currentHp).toBe(near.maxHp - 2 - LINGXI_ECHO1_DAMAGE);
        expect(getTideStacks(near)).toBe(2);
        expect(lingxi.counters['lingxi_echo1_round'], '回响结算后清空，不再自链').toBe(0);
    });

    it('下一回合再次施放：两段合并为5×5/5点，回响不再单独触发，并续挂下一发', () => {
        const { state, lingxi, near, far, ally } = setup();
        cast1(lingxi, state);
        const armedRound = lingxi.counters['lingxi_echo1_round'];

        state.roundNumber = 2;
        lingxi.hasActedThisTurn = false;
        expect(
            SkillSystem.getValidTargetPositions(lingxi, lingxiSkill1, state).length,
            '合并时高亮范围同步扩大到5×5'
        ).toBe(25);
        const merged = cast1(lingxi, state);

        expect(merged.damageDealt).toEqual([5, 5]);
        expect(near.currentHp, '第一段的2点与合并段的5点累计').toBe(near.maxHp - 2 - 5);
        expect(far.currentHp, '合并后范围扩大到5×5').toBe(far.maxHp - 5);
        expect(lingxi.counters['lingxi_echo1_round'], '合并后继续挂下一发').toBe(2);
        expect(lingxi.counters['lingxi_echo1_round']).not.toBe(armedRound);

        // 已合并进本次施放，回响不应在友方行动结束时再补一次
        lingxi.hasActedThisTurn = true;
        state.roundNumber = 3;
        GameEngine.endHeroAction(ally, state);
        expect(near.currentHp, '合并段之后仍会按新挂的回响补击').toBe(near.maxHp - 2 - 5 - LINGXI_ECHO1_DAMAGE);
    });

    it('潮汐回血：只有泠汐的伤害触发，按层数治疗受伤敌人周围3×3的友方', () => {
        const { state, lingxi, near, ally } = setup();
        ally.currentHp = 20;
        cast1(lingxi, state);            // 先给 near 叠1层
        ally.currentHp = 20;             // 重置，避免与上一击的回血混淆

        // 第二次泠汐攻击：near 已有1层 → 周围3×3的友方各回1点
        cast1(lingxi, state);
        expect(ally.currentHp, '盟友在潮汐3×3内应吃到回血').toBe(21);

        // 敌方攻击同样带潮汐的目标不回血
        ally.currentHp = 20;
        const enemyAttacker = addHero(state, 'zhenxiao', 'player2', [5, 5]);
        const hit = DamageCalculator.calculate(enemyAttacker, near, 1, false);
        DamageCalculator.applyDamage(near, hit, enemyAttacker, state);
        expect(ally.currentHp, '非泠汐来源不触发潮汐回血').toBe(20);
    });

    it('技能2：按点击格推导方向打前方2×3，下一回合技能结束后回潮8点并一次性消耗潮汐自疗', () => {
        const { state, lingxi, near } = setup();

        lingxi.counters['__lingxi_skill2_dir'] = 3;   // 右
        const first = SkillSystem.executeSkill(lingxi, lingxiSkill2, [[2, 4]], state);
        expect(first.success).toBe(true);
        expect(near.currentHp).toBe(near.maxHp - 3);
        expect(lingxi.counters['lingxi_echo2_round']).toBe(1);
        expect(lingxi.counters['lingxi_echo2_dir']).toBe(3);

        addTide(near, lingxi, 3);
        lingxi.currentHp = 10;

        // 下一回合的技能攻击结束后自动回潮
        state.roundNumber = 2;
        cast1(lingxi, state);

        expect(lingxi.counters['lingxi_echo2_round'], '回潮结算后清空').toBe(0);
        expect(getTideStacks(near), '回潮一次性消耗潮汐').toBe(0);
        expect(lingxi.currentHp, '回潮至少带来3层×3的自疗').toBeGreaterThanOrEqual(19);
    });

    it('被动助力：下一个出手的友方一次领走全部层数，每层+20%攻击', () => {
        const { state, lingxi, ally } = setup();
        cast1(lingxi, state);            // 第1段
        state.roundNumber = 2;
        cast1(lingxi, state);            // 第2段（合并）

        expect(lingxi.counters['lingxi_assist_pending'], '两段攻击积攒2层').toBe(2);
        expect(ally.effects.some(effect => effect.name === '泠汐攻击提升'), '未经行动入口不发放').toBe(false);

        // 走真实行动入口：琉璃开始行动时一次领走全部层数
        useGameStore.setState({
            phase: 'battle',
            currentPlayer: 'player1',
            roundNumber: 3,
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
        });
        useGameStore.getState().selectHeroForAction(ally);

        const buff = ally.effects.find(effect => effect.name === '泠汐攻击提升');
        expect(buff?.stackCount, '两层助力一次领走').toBe(2);
        expect(buff?.value).toBeCloseTo(0.4);
        expect(lingxi.counters['lingxi_assist_pending']).toBe(0);
        expect(
            useGameStore.getState().battleLog.some(entry => entry.message.includes('攻击提升40%'))
        ).toBe(true);
        useGameStore.getState().resetGame();
    });

    it('天威·潮归：击杀后我方全员恢复场上潮汐总层数，溢出转为护盾且封顶10点', () => {
        const { state, lingxi, near } = setup();
        addTide(near, lingxi, 3);
        const total = totalTideOnEnemiesOf(state, 'player1');
        expect(total).toBe(3);

        near.currentHp = 1;
        const lethal = DamageCalculator.calculate(lingxi, near, 20, false);
        DamageCalculator.applyDamage(near, lethal, lingxi, state);

        expect(near.state).toBe('dead');
        // 两名满血友方各溢出 total 点 → 全部转为护盾
        expect(lingxi.shield, `溢出 ${total}×2 转为护盾`).toBe(total * 2);
        expect(lingxi.shield).toBeLessThanOrEqual(10);
    });

    it('天威·潮归的护盾封顶10点', () => {
        const { state, lingxi, near, far } = setup();
        addTide(near, lingxi, 3);
        addTide(far, lingxi, 3);
        expect(totalTideOnEnemiesOf(state, 'player1')).toBe(6);

        near.currentHp = 1;
        const lethal = DamageCalculator.calculate(lingxi, near, 20, false);
        DamageCalculator.applyDamage(near, lethal, lingxi, state);

        // 6×2=12 的溢出被压到上限 10
        expect(lingxi.shield).toBe(10);
    });

    it('潮汐属于可净化的负面效果，会被叙白洗掉', () => {
        const { state, lingxi, near } = setup();
        cast1(lingxi, state);
        expect(getTideStacks(near)).toBe(1);

        const xubai = addHero(state, 'xubai', 'player2', [4, 4]);
        SkillSystem.executeSkill(xubai, xubaiSkill1, [[2, 3]], state);
        expect(getTideStacks(near), '叙白净化把潮汐一并洗掉').toBe(0);
    });

    it('回响会登记一次待派发特效，供表现层播放专属动画与音效', () => {
        const { state, lingxi, near, ally } = setup();
        cast1(lingxi, state);
        expect(drainPendingSkillFxRequests(), '普通施法由 store 的特效包装层负责').toHaveLength(0);

        state.roundNumber = 2;
        lingxi.hasActedThisTurn = true;
        GameEngine.endHeroAction(ally, state);

        const requests = drainPendingSkillFxRequests();
        expect(requests).toHaveLength(1);
        expect(requests[0].skillId).toBe('lingxi_skill1');
        expect(requests[0].impactPositions).toEqual([near.position]);
    });

    it('经真实行动入口结算的回响会新增一条特效事件', () => {
        const { state, lingxi, ally } = setup();
        useGameStore.setState({
            phase: 'battle',
            currentPlayer: 'player1',
            roundNumber: 1,
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            skillFx: [],
        });
        useGameStore.getState().selectHeroForAction(lingxi);
        useGameStore.getState().selectSkill('lingxi_skill1');
        useGameStore.getState().executeSkill([2, 3]);
        const fxAfterCast = useGameStore.getState().skillFx.length;
        expect(fxAfterCast).toBeGreaterThan(0);

        useGameStore.setState({ roundNumber: 2, currentPlayer: 'player1' });
        ally.hasActedThisTurn = false;
        ally.hasMovedThisTurn = false;
        lingxi.hasActedThisTurn = true;
        useGameStore.getState().selectHeroForAction(ally);
        useGameStore.getState().endHeroAction();

        expect(useGameStore.getState().skillFx.length, '回响也要有一次特效').toBe(fxAfterCast + 1);
        useGameStore.getState().resetGame();
    });

    it('技能2与帝兰一致：点击方向格即定方向并立即施放，只作用该方向前方2×3', () => {
        const { state, lingxi, near, far } = setup();
        // far 在 (0,4)：不在右侧 2×3（rows 1..3, cols 3..4）内
        useGameStore.setState({
            phase: 'battle',
            currentPlayer: 'player1',
            roundNumber: 1,
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
        });
        useGameStore.getState().selectHeroForAction(lingxi);
        useGameStore.getState().selectSkill('lingxi_skill2');
        expect(useGameStore.getState().skillRange).toHaveLength(4);   // 先只亮四个方向格

        useGameStore.getState().executeSkill([2, 3]);                  // 点右侧方向格 = 定方向并施放

        expect(lingxi.counters['__lingxi_skill2_dir'], '施放后计数器已清除').toBeUndefined();
        expect(lingxi.hasActedThisTurn).toBe(true);
        expect(near.currentHp).toBe(near.maxHp - 3);
        expect(far.currentHp, '其他方向不受影响').toBe(far.maxHp);
        expect(lingxi.counters['lingxi_echo2_round']).toBe(1);
        useGameStore.getState().resetGame();
    });
});
