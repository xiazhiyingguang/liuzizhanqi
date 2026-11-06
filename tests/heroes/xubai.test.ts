import { describe, expect, it } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { GameEngine } from '../../src/core/game-engine';
import { grantZhizhi } from '../../src/core/hero-zhizhi';
import { SkillSystem } from '../../src/core/skill-system';
import { getSkill } from '../../src/data/skills';
import {
    XUBAI_ORB_MAX,
    settleXubaiOrbs,
    triggerXubaiEntrance,
    xubaiSkill1,
    xubaiSkill2,
} from '../../src/data/extended-skills';
import { createHero } from '../../src/data/heroes';
import { createOnlineStateSnapshot, useGameStore } from '../../src/store/game-store';
import { applyServerGameState } from '../../src/services/online-state';
import { GameState, Hero, HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/** 叙白：净化治疗 + 黑白球续航 + 回合末解控 + 首次登场神威 */

function withNegatives(target: Hero): void {
    target.effects.push(
        { id: 't-debuff-1', type: 'debuff', name: '逆风', duration: 1, sourceHeroId: 'e1', stackCount: 1 },
        { id: 't-debuff-2', type: 'debuff', name: '凋零', duration: -1, sourceHeroId: 'e2', stackCount: 2 },
        // 标记与状态都不该被净化
        { id: 't-mark', type: 'mark', name: '猎杀令', duration: 2, sourceHeroId: 'e3' },
        { id: 't-stun', type: 'stun', name: '冰冻', duration: 1, sourceHeroId: 'e4' },
    );
}

describe('叙白', () => {
    it('55血移动2，登场神威不注册成击杀天威', () => {
        const hero = createHero('xubai', 'player1', [0, 0]);
        expect(hero.name).toBe('叙白');
        expect(hero.class).toBe('素问');
        expect(hero.maxHp).toBe(55);
        expect(hero.moveRange).toBe(2);
        expect(hero.skill1Id).toBe('xubai_skill1');
        expect(hero.skill2Id).toBe('xubai_skill2');
        expect(hero.tianweiId).toBeUndefined();
        expect(hero.counters['黑白球']).toBe(0);
    });

    it('技能1治疗5×5内一名友方，净化全部负面效果并按每个+2加成', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        ally.currentHp = 10;
        withNegatives(ally);

        const result = SkillSystem.executeSkill(xubai, xubaiSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        // 8 + 2 × 2 个 debuff = 12
        expect(ally.currentHp).toBe(22);
        expect(ally.effects.map(effect => effect.name)).toEqual(['猎杀令', '冰冻']);
        expect(result.healingDone).toEqual([12]);
    });

    it('技能1没有负面效果时只恢复8点，且可以治疗自己', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [2, 2]);
        xubai.currentHp = 20;

        const result = SkillSystem.executeSkill(xubai, xubaiSkill1, [[2, 2]], state);

        expect(result.success).toBe(true);
        expect(xubai.currentHp).toBe(28);
        expect(SkillSystem.getValidTargetPositions(xubai, xubaiSkill1, state))
            .toContainEqual([2, 2] as [number, number]);
    });

    it('技能2把黑白球补满到3颗且不叠加超过上限', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [2, 2]);

        SkillSystem.executeSkill(xubai, xubaiSkill2, [[2, 2]], state);
        expect(xubai.counters['黑白球']).toBe(XUBAI_ORB_MAX);

        xubai.counters['黑白球'] = 1;
        SkillSystem.executeSkill(xubai, xubaiSkill2, [[2, 2]], state);
        expect(xubai.counters['黑白球']).toBe(XUBAI_ORB_MAX);
    });

    it('行动开始结算黑白球：低于40%才消耗，回到40%以上即停手', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [5, 5]);
        const ally = addHero(state, 'moran', 'player1', [2, 2]);
        xubai.counters['黑白球'] = 3;

        ally.maxHp = 50;
        ally.currentHp = 10;                       // 20% → 需要抬到 20 以上
        expect(settleXubaiOrbs(ally, state)).toBe(`${ally.name}消耗3颗黑白球，恢复12点生命`);
        expect(ally.currentHp).toBe(22);
        expect(xubai.counters['黑白球']).toBe(0);

        // 球已耗尽：不再回血
        ally.currentHp = 10;
        expect(settleXubaiOrbs(ally, state)).toBeNull();
    });

    it('生命高于40%不消耗球，同一手重复选中不结算', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [5, 5]);
        const ally = addHero(state, 'moran', 'player1', [2, 2]);
        xubai.counters['黑白球'] = 3;
        ally.maxHp = 50;

        ally.currentHp = 30;                        // 60%，不该触发
        expect(settleXubaiOrbs(ally, state)).toBeNull();
        expect(xubai.counters['黑白球']).toBe(3);

        ally.currentHp = 10;                        // 这手已经判定过，再次选中不重复消耗
        expect(settleXubaiOrbs(ally, state)).toBeNull();
        expect(ally.currentHp).toBe(10);
    });

    it('黑白球结算挂在行动开始：选中残血英雄即回血并同步到 store', () => {
        const state = useGameStore.getState();
        state.resetGame();
        const board: (Hero | null)[][] = Array.from({ length: 6 }, () => Array<Hero | null>(6).fill(null));
        const xubai = createHero('xubai', 'player1', [5, 5]);
        xubai.counters['黑白球'] = 2;
        const ally = createHero('moran', 'player1', [1, 1]);
        ally.maxHp = 50;
        ally.currentHp = 10;
        board[5][5] = xubai;
        board[1][1] = ally;
        useGameStore.setState({
            phase: 'battle',
            currentPlayer: 'player1',
            roundNumber: 3,
            board,
            player1Heroes: [xubai, ally],
            player2Heroes: [],
        });

        useGameStore.getState().selectHeroForAction(ally);

        const after = useGameStore.getState();
        expect(ally.currentHp).toBe(18);
        expect(xubai.counters['黑白球']).toBe(0);
        expect(after.battleLog.some(entry => entry.message.includes('消耗2颗黑白球'))).toBe(true);
        after.resetGame();
    });

    it('神威初雪：首次登场治疗3×3友方并各随机净化1个负面效果，之后不再触发', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        const far = addHero(state, 'liuli', 'player1', [0, 0]);
        ally.currentHp = 10;
        far.currentHp = 10;
        withNegatives(ally);
        xubai.currentHp = 20;

        triggerXubaiEntrance(xubai, state);

        expect(xubai.currentHp).toBe(28);           // 自己也在3×3内
        expect(ally.currentHp).toBe(18);
        expect(ally.effects.filter(effect => effect.type === 'debuff')).toHaveLength(1); // 随机净化1个
        expect(far.currentHp).toBe(10);             // 3×3 外的友方不受影响

        ally.currentHp = 10;
        triggerXubaiEntrance(xubai, state);
        expect(ally.currentHp).toBe(10);            // 整场只触发一次
    });

    it('回合结束只净化一名友方的一层控制，不去掉减益也不回血', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const hero = addHero(state, 'xubai', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [0, 0]);
        const other = addHero(state, 'liuli', 'player1', [1, 0]);
        const enemy = addHero(state, 'zhenxiao', 'player2', [2, 3]);
        for (const unit of [hero, ally, other]) unit.hasActedThisTurn = true;
        ally.currentHp = 10;
        ally.effects.push({ id: 'freeze', type: 'stun', name: '冰冻', duration: 3, stackCount: 2 });
        ally.effects.push({ id: 'decay', type: 'debuff', name: '凋零', duration: -1 });
        other.effects.push({ id: 'stun', type: 'stun', name: '眩晕', duration: 3 });
        GameEngine.endHeroAction(enemy, state);
        expect(state.roundNumber).toBe(2);
        expect(ally.effects.find(effect => effect.id === 'freeze')?.stackCount).toBe(1);
        expect(ally.effects.some(effect => effect.id === 'decay')).toBe(true);
        expect(other.effects.some(effect => effect.id === 'stun')).toBe(true);
        expect(ally.currentHp).toBe(10);
        expect(state.battleLog.filter(log => log.message.includes('净化了一层负面状态'))).toHaveLength(1);
    });

    it('敌方攻击期间不吃球；自己行动和同轮额外行动各可结算一次', () => {
        const state = makeGameState({ currentPlayer: 'player2' });
        const hero = addHero(state, 'xubai', 'player1', [1, 1]);
        const ally = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'zhenxiao', 'player2', [2, 3]);
        hero.counters['黑白球'] = 3;
        ally.maxHp = 50; ally.currentHp = 21;
        DamageCalculator.applyDamage(ally, DamageCalculator.calculate(enemy, ally, 3, false, false, { fixedDamage: true }), enemy, state);
        expect(ally.currentHp).toBe(18);
        expect(settleXubaiOrbs(ally, state)).toBeNull();
        expect(hero.counters['黑白球']).toBe(3);
        state.currentPlayer = 'player1';
        expect(settleXubaiOrbs(ally, state)).not.toBeNull();
        expect([ally.currentHp, hero.counters['黑白球']]).toEqual([22, 2]);
        ally.currentHp = 16;
        expect(settleXubaiOrbs(ally, state)).toBeNull();
        state.pendingExtraActionHeroIds = { player1: ally.id };
        GameEngine.endHeroAction(ally, state);
        expect(state.performingExtraAction).toBe(true);
        expect([ally.currentHp, hero.counters['黑白球']]).toEqual([20, 1]);
        expect(settleXubaiOrbs(ally, state)).toBeNull();
    });

    it('致知一与三：每颗回5点，叠层减益只减一层，不解控制', () => {
        const state = makeGameState();
        const hero = addHero(state, 'xubai', 'player1', [2, 2]);
        grantZhizhi(hero, 1); grantZhizhi(hero, 3);
        hero.counters['黑白球'] = 3;
        hero.currentHp = 18;
        hero.effects.push({ id: 'debuff', type: 'debuff', name: '凋零', duration: -1, stackCount: 3 });
        hero.effects.push({ id: 'control', type: 'control', name: '愤怒', duration: 2 });
        expect(settleXubaiOrbs(hero, state)).not.toBeNull();
        expect([hero.currentHp, hero.counters['黑白球']]).toEqual([23, 2]);
        expect(hero.effects.find(effect => effect.id === 'debuff')?.stackCount).toBe(2);
        expect(hero.effects.some(effect => effect.id === 'control')).toBe(true);
    });

    it('致知二只提高登场治疗；联机快照与新实例都不能再触发登场', () => {
        useGameStore.getState().resetGame();
        const state = makeGameState();
        const hero = addHero(state, 'xubai', 'player1', [2, 2]);
        const ally = addHero(state, 'moran', 'player1', [2, 3]);
        ally.currentHp = 10;
        grantZhizhi(hero, 2);
        triggerXubaiEntrance(hero, state);
        expect(ally.currentHp).toBe(20);
        useGameStore.setState(state);
        const snapshot = JSON.parse(JSON.stringify(createOnlineStateSnapshot(useGameStore.getState())));
        useGameStore.getState().resetGame();
        applyServerGameState(snapshot);
        const restored = useGameStore.getState();
        const replacement = addHero(restored, 'xubai', 'player1', [3, 2]);
        triggerXubaiEntrance(replacement, restored);
        expect(restored.board[2][3]?.currentHp).toBe(20);
        expect(restored.xubaiEntranceTriggered).toEqual({ player1: true });
        useGameStore.getState().resetGame();
    });

    it('叙白从替补席实际落子时也会按登场格触发初雪', () => {
        useGameStore.getState().resetGame();
        try {
            const state = makeGameState({ reinforcingPlayer: 'player1', player1BenchHeroIds: ['xubai'] });
            const ally = addHero(state, 'moran', 'player1', [1, 1]);
            const far = addHero(state, 'liuli', 'player1', [4, 1]);
            addHero(state, 'zhenxiao', 'player2', [4, 4]);
            ally.currentHp = far.currentHp = 12;
            ally.effects.push({ id: 'debuff', type: 'debuff', name: '逆风', duration: 2 });
            useGameStore.setState(state);
            expect(useGameStore.getState().selectReinforcementHero('xubai')).toBe(true);
            expect(useGameStore.getState().deployReinforcement([0, 1])).toBe(true);
            expect([ally.currentHp, far.currentHp]).toEqual([20, 12]);
            expect(ally.effects).toHaveLength(0);
            expect(useGameStore.getState().battleLog.some(log => log.message.includes('神威「初雪」'))).toBe(true);
        } finally {
            useGameStore.getState().resetGame();
        }
    });

    it('技能已登记进技能表', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [2, 2]);
        expect(getSkill('xubai_skill1')?.name).toBe('涤秽回春');
        expect(getSkill('xubai_skill2')?.name).toBe('黑白凝珠');
        expect(state.board[2][2]).toBe(xubai);
        expect(xubai.state).toBe(HeroState.ALIVE);
        expect(EffectManager.hasEffect(xubai, '黑白球')).toBe(false);
    });
});
