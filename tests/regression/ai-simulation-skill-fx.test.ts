import { describe, expect, it } from 'vitest';
import { chooseComputerSkillPlan, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { drainPendingSkillFxRequests, runWithoutSkillFx } from '../../src/data/extended-skills';
import { requestMechanismFx } from '../../src/core/mechanism-fx';
import { addHero, makeGameState } from '../helpers/game-state';
import type { GameState } from '../../src/types/game';

/**
 * 电脑思考时不许污染特效/音效队列。
 *
 * 特效队列是模块级全局，不属于 GameState：电脑在克隆盘上真跑一遍技能结算来给候选方案打分，
 * 那些"假想施法"留下的条目不会被丢掉，而是随下一次状态提交和真盘面一起派发，
 * 表现为没人放技能却连响几十遍音效、格子上凭空起特效（实测一步之内最多连响 266 遍）。
 */

/** 电脑一方轮流用这些输出手；受击方固定带几个"受击就上报机制特效"的单位 */
const ATTACKERS = ['lingxi', 'yunying', 'jetzmi', 'skeletonking', 'huanongying', 'zhenxiao', 'feixue'];

function combatScene(attackerId: string): GameState {
    const state = makeGameState({ currentPlayer: 'player2', roundNumber: 4 });
    addHero(state, 'zhenxiao', 'player1', [2, 2]);
    addHero(state, 'xuanxiao', 'player1', [2, 3]);
    addHero(state, 'feixue', 'player1', [1, 3]);
    addHero(state, attackerId, 'player2', [3, 2]);
    addHero(state, 'lingxi', 'player2', [4, 3]);
    return state;
}

function heroOf(state: GameState, side: 'player1' | 'player2', template: string) {
    const hero = state[side === 'player1' ? 'player1Heroes' : 'player2Heroes']
        .find(candidate => candidate.id.startsWith(`${template}-`));
    if (!hero) throw new Error(`场景里应当有${template}`);
    return hero;
}

describe('电脑模拟与特效队列', () => {
    setComputerAiDifficulty('master');

    it('评估候选技能之后队列是空的', () => {
        for (const attackerId of ATTACKERS) {
            const state = combatScene(attackerId);
            drainPendingSkillFxRequests();
            chooseComputerSkillPlan(state, heroOf(state, 'player2', attackerId));
            const leaked = drainPendingSkillFxRequests();
            expect(
                leaked.map(entry => entry.skillId),
                `${attackerId} 的候选模拟把特效请求漏进了真队列`
            ).toEqual([]);
        }
    });

    it('抑制只作用于模拟：队列本身在抑制区外照常收条目', () => {
        const state = combatScene('lingxi');
        const zhenxiao = heroOf(state, 'player1', 'zhenxiao');
        drainPendingSkillFxRequests();
        runWithoutSkillFx(() => requestMechanismFx(zhenxiao, 'zhenxiao_counter', state));
        expect(drainPendingSkillFxRequests(), '抑制区内不该入队').toHaveLength(0);
        requestMechanismFx(zhenxiao, 'zhenxiao_counter', state);
        expect(drainPendingSkillFxRequests(), '抑制区外必须照常入队').toHaveLength(1);
    });
});
