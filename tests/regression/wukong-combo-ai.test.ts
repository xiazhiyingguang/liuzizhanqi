import { describe, expect, it } from 'vitest';
import { runComputerBattleStep } from '../../src/hooks/useComputerOpponent';
import { useGameStore } from '../../src/store/game-store';
import { chooseComputerSkillPlan, isSelfPropellingSkill, setComputerAiDifficulty } from '../../src/core/computer-ai';
import { createWukongClone } from '../../src/data/heroes';
import { addHero, makeGameState } from '../helpers/game-state';
import type { GameState, Hero, Position } from '../../src/types/game';

/**
 * 电脑操作孙悟空「大圣合击」的回归。
 *
 * 合击自带"先走到可达空格再打"，且要求本体本回合没普通移动过。旧实现只看本体脚下 3×3 找目标，
 * 敌人一在外圈就判这一手不存在；联合规划又把"为合击走的这一步"记成普通移动，反而把它彻底锁死。
 * 结果电脑每回合只剩固定 24 分的召唤分身可做——实测 8 局 23 手里 18 手在召唤、只有 4 手合击。
 */

function scene(standCell: Position, foeCell: Position, cloneCells: Position[] = []): GameState {
    const state = makeGameState({ currentPlayer: 'player2', roundNumber: 5 });
    const wukong = addHero(state, 'wukong', 'player2', standCell);
    addHero(state, 'zhenxiao', 'player1', foeCell);
    addHero(state, 'lingxi', 'player2', [5, 5]);
    for (const cell of cloneCells) {
        const clone = createWukongClone('player2', wukong.id, cell, 10);
        state.board[cell[0]][cell[1]] = clone;
    }
    return state;
}

function wukongOf(state: GameState): Hero {
    const hero = state.player2Heroes.find(candidate => candidate.id.startsWith('wukong-player2-'));
    if (!hero) throw new Error('场景里应当有孙悟空');
    return hero;
}

describe('电脑操作大圣合击', () => {
    setComputerAiDifficulty('master');

    it('站着打不到、走一步能到时，选合击而不是召唤分身', () => {
        // 本体 [2,1]、敌人 [2,4]：脚下 3×3 空无一人，走一格到 [2,3] 就够得着
        const state = scene([2, 1], [2, 4]);
        const plan = chooseComputerSkillPlan(state, wukongOf(state));
        expect(plan?.skillId).toBe('wukong_skill2');
        expect(plan?.targetPositions).toEqual([[2, 4]]);
    });

    it('合击算"释放自带位移"，不许先花掉普通移动', () => {
        expect(isSelfPropellingSkill('wukong_skill2')).toBe(true);
    });

    it('场上已有三个分身时不再规划召唤分身', () => {
        const state = scene([2, 1], [2, 4], [[0, 0], [0, 1], [0, 2]]);
        const plan = chooseComputerSkillPlan(state, wukongOf(state));
        expect(plan?.skillId).not.toBe('wukong_skill1');
    });

    it('真跑一遍这一手：本体走进攻击位并把敌人打伤', () => {
        const state = scene([2, 1], [2, 4]);
        useGameStore.setState({
            ...state,
            isOnlineMode: false,
            isAiMode: true,
            aiPlayer: 'player2',
            aiDifficulty: 'master',
            battleLog: [],
            selectedHero: null,
            selectedSkill: null,
            activeHero: null,
            reinforcingPlayer: undefined,
            pendingSkillTargetPositions: undefined,
            wukongSkill2State: undefined,
        });
        const foe = () => useGameStore.getState().player1Heroes.find(hero => hero.id.startsWith('zhenxiao-'))!;
        const hpBefore = foe().currentHp;

        for (let step = 0; step < 20; step++) {
            const current = useGameStore.getState();
            if (current.phase !== 'battle') break;
            if (current.currentPlayer !== 'player2') break;
            if (current.selectedHero && current.selectedHero.hasActedThisTurn) break;
            if (current.selectedHero && current.selectedHero.id !== wukongOf(current).id) break;
            const wukong = wukongOf(current);
            if (!current.selectedHero) useGameStore.setState({ selectedHero: wukong, activeHero: wukong });
            runComputerBattleStep('player2', step >= 16 ? 2 : 0);
        }

        const messages = useGameStore.getState().battleLog.map(entry => entry.message).join('\n');
        expect(foe().currentHp, `敌人应当被合击打伤，战报：\n${messages}`).toBeLessThan(hpBefore);
        expect(messages, `这一手应当走的是合击链，战报：\n${messages}`)
            .toContain('请选择本体的攻击目标');
        expect(messages).toContain('孙悟空对震霄造成');
    });
});
