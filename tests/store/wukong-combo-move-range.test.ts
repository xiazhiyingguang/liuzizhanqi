import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { addHero, makeGameState } from '../helpers/game-state';

function loadBattleState() {
    const state = makeGameState();
    useGameStore.setState({
        ...state,
        moveRange: [],
        skillRange: [],
        wukongSkill2State: undefined,
        suppressOnlineBroadcast: false,
    });
    return state;
}

describe('大圣合击本体移动范围', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('本体阶段可以先走多格再出手，不再限制只能挪一格', () => {
        const state = loadBattleState();
        const wukong = addHero(state, 'wukong', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 3]);   // 距离3格，本体的3×3里打不到
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: wukong,
            activeHero: wukong,
        });

        useGameStore.getState().selectSkill('wukong_skill2');
        const range = useGameStore.getState().skillRange;
        expect(range.some(([row, col]) => row === 0 && col === 2)).toBe(true);   // 可达空格进入高亮

        useGameStore.getState().executeSkill([0, 2]);                            // 直线走两格
        expect(wukong.position).toEqual([0, 2]);
        expect(wukong.hasMovedThisTurn).toBe(true);
        expect(useGameStore.getState().wukongSkill2State?.wukongMoved).toBe(true);
        expect(enemy.currentHp).toBe(enemy.maxHp);

        useGameStore.getState().executeSkill([0, 3]);                            // 到位后打击
        expect(enemy.currentHp).toBeLessThan(enemy.maxHp);
        expect(wukong.hasActedThisTurn).toBe(true);
    });
});
