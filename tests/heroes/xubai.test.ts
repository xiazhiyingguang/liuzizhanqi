import { describe, expect, it } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
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
import { useGameStore } from '../../src/store/game-store';
import { GameState, Hero, HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/** 叙白：净化治疗 + 黑白球续航 + 首次登场被动 */

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
    it('模板字段与无天威', () => {
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

    it('生命高于40%不消耗球，同一轮重复选中也只结算一次', () => {
        const state = makeGameState();
        const xubai = addHero(state, 'xubai', 'player1', [5, 5]);
        const ally = addHero(state, 'moran', 'player1', [2, 2]);
        xubai.counters['黑白球'] = 3;
        ally.maxHp = 50;

        ally.currentHp = 30;                        // 60%，不该触发
        expect(settleXubaiOrbs(ally, state)).toBeNull();
        expect(xubai.counters['黑白球']).toBe(3);

        ally.currentHp = 10;                        // 本轮已结算过，再次调用不重复消耗
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

    it('被动初雪：首次登场治疗3×3友方并随机净化1个负面效果，之后不再触发', () => {
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
