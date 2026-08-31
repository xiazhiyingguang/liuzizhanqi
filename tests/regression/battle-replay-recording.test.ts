import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { getBattleReplay, hasBattleReplay, resetBattleReplay } from '../../src/services/battle-replay';
import { addHero, makeGameState } from '../helpers/game-state';
import type { GameState } from '../../src/types/game';

/**
 * 回放录制的端到端接线验证：走真实 store 行动，确认 game-store 底部那一行订阅
 * 能覆盖到"只走纯 set 的提交"，并确认换局后录像被清干净（不跨局串画面）。
 */
function loadBattle(matchId = 'match-replay-test'): GameState {
    const state = makeGameState({ phase: 'battle', matchId, currentPlayer: 'player1' });
    addHero(state, 'huifeng', 'player1', [2, 1]);
    addHero(state, 'moran', 'player1', [1, 1]);
    addHero(state, 'liuli', 'player2', [3, 4]);
    addHero(state, 'baize', 'player2', [4, 4]);
    useGameStore.setState({
        ...state,
        moveRange: [],
        skillRange: [],
        selectedHero: null,
        activeHero: null,
        wukongSkill2State: undefined,
        suppressOnlineBroadcast: false,
    });
    return useGameStore.getState() as unknown as GameState;
}

describe('对局回放录制接线', () => {
    beforeEach(() => {
        resetBattleReplay();
        useGameStore.getState().resetGame();
    });

    it('选中英雄、移动都会推进帧数，并记下本步战报', () => {
        loadBattle();
        // 进入战斗本身就是一次提交，会留下第 0 帧（开局局面）
        const afterLoad = getBattleReplay().frames.length;
        expect(afterLoad).toBe(1);

        const store = useGameStore.getState();
        const hero = useGameStore.getState().player1Heroes[0];
        store.selectHeroForAction(hero);
        const afterSelect = getBattleReplay().frames.length;
        expect(afterSelect).toBeGreaterThan(afterLoad);

        store.moveHero([2, 2]);
        const afterMove = getBattleReplay();
        expect(afterMove.frames.length).toBeGreaterThan(afterSelect);
        const lastFrame = afterMove.frames[afterMove.frames.length - 1];
        expect(afterMove.narration.slice(lastFrame.logFrom, lastFrame.logTo).some(entry => entry.type === 'move')).toBe(true);
        expect(hasBattleReplay()).toBe(true);
    });

    it('结束行动会交出行动权并留下对应帧', () => {
        loadBattle();
        const hero = useGameStore.getState().player1Heroes[0];
        useGameStore.getState().selectHeroForAction(hero);
        useGameStore.getState().moveHero([2, 2]);

        const before = getBattleReplay().frames.length;
        useGameStore.getState().endHeroAction();

        expect(useGameStore.getState().currentPlayer).not.toBe('player1');
        expect(getBattleReplay().frames.length).toBeGreaterThanOrEqual(before);
    });

    it('施放技能后的帧包含伤害战报与真实生命下降', () => {
        const state = makeGameState({ phase: 'battle', matchId: 'match-skill', currentPlayer: 'player1' });
        const hero = addHero(state, 'huifeng', 'player1', [2, 2]);
        const enemy = addHero(state, 'liuli', 'player2', [2, 3]);
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            selectedHero: null,
            activeHero: null,
            suppressOnlineBroadcast: false,
        });

        const enemyHpBefore = enemy.currentHp;
        const store = useGameStore.getState();
        store.selectHeroForAction(hero);
        store.selectSkill('huifeng_skill1');
        useGameStore.getState().executeSkill([2, 3]);

        const replay = getBattleReplay();
        const enemyDef = replay.statics.findIndex(entry => entry.heroId === enemy.id);
        const heroDef = replay.statics.findIndex(entry => entry.heroId === hero.id);
        // 施法后还有一次不含新战报的收尾提交，所以要按内容找结算帧
        const strikeFrame = replay.frames.find(frame =>
            replay.narration.slice(frame.logFrom, frame.logTo).some(entry => entry.type === 'damage')
        );

        expect(strikeFrame).toBeDefined();
        expect(strikeFrame!.units.find(unit => unit.def === enemyDef)?.hp).toBeLessThan(enemyHpBefore);
        // 回锋连刃斩每段叠一层破锋，计数器要进帧
        expect(strikeFrame!.units.find(unit => unit.def === heroDef)?.counters).toContainEqual(['破锋', 3]);
    });

    it('全员不可用时的自动跳过（只走纯 set 的提交）也被记录下来', () => {
        loadBattle();
        const state = useGameStore.getState();
        // 玩家2 全部标记为已行动，且当前没有选中英雄
        for (const hero of state.player2Heroes) hero.hasActedThisTurn = true;
        useGameStore.setState({
            currentPlayer: 'player2',
            selectedHero: null,
            activeHero: null,
            player2Heroes: [...state.player2Heroes],
        });

        const before = getBattleReplay().frames.length;
        useGameStore.getState().endHeroAction();

        expect(useGameStore.getState().currentPlayer).not.toBe('player2');
        expect(getBattleReplay().frames.length).toBeGreaterThan(before);
    });

    it('返回主界面（resetGame）后旧录像立即清空，不会串到下一局', () => {
        loadBattle('match-first');
        const store = useGameStore.getState();
        store.selectHeroForAction(useGameStore.getState().player1Heroes[0]);
        store.moveHero([2, 2]);
        expect(hasBattleReplay()).toBe(true);

        useGameStore.getState().resetGame();

        expect(getBattleReplay().frames).toHaveLength(0);
        expect(getBattleReplay().narration).toHaveLength(0);
        expect(hasBattleReplay()).toBe(false);
    });
});
