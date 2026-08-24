import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSkill } from '../../src/data/skills';
import { useGameStore } from '../../src/store/game-store';
import { EffectManager } from '../../src/core/effect-manager';
import { HeroState } from '../../src/types/game';
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

describe('game store selection and deployment', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
    });

    it('lets a player select up to four distinct hero templates', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({ phase: 'hero-select' });
        const store = useGameStore.getState();

        for (const id of ['moran', 'zhenxiao', 'wukong', 'baize']) {
            expect(store.selectHeroForPlayer('player1', id)).toBe(true);
        }

        expect(store.selectHeroForPlayer('player1', 'liuli')).toBe(false);
        expect(useGameStore.getState().player1SelectedHeroIds).toEqual([
            'moran',
            'zhenxiao',
            'wukong',
            'baize',
        ]);
    });

    it('rejects unknown hero templates and selection outside the selection phase', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({ phase: 'hero-select' });

        expect(useGameStore.getState().selectHeroForPlayer('player1', 'not-a-hero')).toBe(false);
        expect(useGameStore.getState().player1SelectedHeroIds).toEqual([]);

        useGameStore.setState({ phase: 'deploy' });
        expect(useGameStore.getState().selectHeroForPlayer('player1', 'moran')).toBe(false);
    });

    it('does not confirm hero selection until exactly four heroes are selected', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            phase: 'hero-select',
            player1SelectedHeroIds: ['moran', 'zhenxiao', 'wukong'],
        });

        expect(useGameStore.getState().confirmHeroSelectionForPlayer('player1')).toBe(false);
        expect(useGameStore.getState().player1ReadyHeroSelect).toBe(false);

        useGameStore.getState().confirmHeroSelection();
        expect(useGameStore.getState().selectingPlayer).toBe('player1');
        expect(useGameStore.getState().phase).toBe('hero-select');
    });

    it('moves to deployment only after both players confirm hero selection', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            phase: 'hero-select',
            player1SelectedHeroIds: ['moran', 'zhenxiao', 'wukong', 'baize'],
            player2SelectedHeroIds: ['liuli', 'mirror', 'mowen', 'guying'],
        });
        const store = useGameStore.getState();

        expect(store.confirmHeroSelectionForPlayer('player1')).toBe(true);
        expect(useGameStore.getState().phase).toBe('hero-select');
        expect(store.confirmHeroSelectionForPlayer('player2')).toBe(true);
        expect(useGameStore.getState().phase).toBe('deploy');
    });

    it('enforces left-half and right-half deployment zones', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            phase: 'deploy',
            player1SelectedHeroIds: ['moran'],
            player2SelectedHeroIds: ['baize'],
        });
        const store = useGameStore.getState();

        expect(store.deployHeroForPlayer('player1', 'moran', [0, 3])).toBe(false);
        expect(store.deployHeroForPlayer('player1', 'moran', [0, 2])).toBe(true);
        expect(store.deployHeroForPlayer('player2', 'baize', [0, 2])).toBe(false);
        expect(store.deployHeroForPlayer('player2', 'baize', [0, 3])).toBe(true);
    });

    it('does not deploy the same template twice for one player', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            phase: 'deploy',
            player1SelectedHeroIds: ['moran'],
        });
        const store = useGameStore.getState();

        expect(store.deployHeroForPlayer('player1', 'moran', [0, 0])).toBe(true);
        expect(store.deployHeroForPlayer('player1', 'moran', [1, 0])).toBe(false);
    });

    it('safely rejects invalid positions and heroes that were not selected', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            phase: 'deploy',
            player1SelectedHeroIds: ['moran'],
        });
        const store = useGameStore.getState();

        expect(() => store.deployHeroForPlayer('player1', 'moran', [-1, 0])).not.toThrow();
        expect(store.deployHeroForPlayer('player1', 'moran', [-1, 0])).toBe(false);
        expect(store.deployHeroForPlayer('player1', 'baize', [0, 0])).toBe(false);
        expect(useGameStore.getState().player1Heroes).toEqual([]);
    });

    it('does not confirm deployment until all four selected heroes are on the board', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            phase: 'deploy',
            player1SelectedHeroIds: ['moran', 'zhenxiao', 'wukong', 'baize'],
        });
        const store = useGameStore.getState();

        expect(store.deployHeroForPlayer('player1', 'moran', [0, 0])).toBe(true);
        expect(store.confirmDeploymentForPlayer('player1')).toBe(false);
        expect(useGameStore.getState().player1ReadyDeploy).toBe(false);
    });

    it('clears online and transient interaction state when returning to the menu', () => {
        useGameStore.setState({
            phase: 'battle',
            isOnlineMode: true,
            onlineRoomId: 'ROOM42',
            localPlayerNumber: 2,
            localPlayerName: 'guest',
            moveRange: [[0, 1]],
            skillRange: [[1, 1]],
            suppressOnlineBroadcast: true,
            pendingBoardAction: { type: 'schrodinger-tianwei', heroId: 'hero-1' },
        });

        useGameStore.getState().resetGame();
        const state = useGameStore.getState();

        expect(state.phase).toBe('menu');
        expect(state.isOnlineMode).toBe(false);
        expect(state.onlineRoomId).toBeUndefined();
        expect(state.localPlayerNumber).toBeUndefined();
        expect(state.localPlayerName).toBeUndefined();
        expect(state.moveRange).toEqual([]);
        expect(state.skillRange).toEqual([]);
        expect(state.suppressOnlineBroadcast).toBe(false);
        expect(state.pendingBoardAction).toBeUndefined();
    });
});

describe('game store battle interactions', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().resetGame();
    });

    it('supports voluntarily ending an action without selecting a skill', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: hero,
        });

        useGameStore.getState().endHeroAction();

        expect(hero.hasActedThisTurn).toBe(true);
        expect(useGameStore.getState().currentPlayer).toBe('player2');
    });

    it('locks the active hero after moving so another hero cannot be selected', () => {
        const state = loadBattleState();
        const first = addHero(state, 'moran', 'player1', [0, 0]);
        const second = addHero(state, 'baize', 'player1', [2, 0]);
        addHero(state, 'liuli', 'player2', [0, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: first,
        });

        useGameStore.getState().moveHero([0, 1]);
        useGameStore.getState().selectHeroForAction(second);

        expect(useGameStore.getState().activeHero).toBe(first);
        expect(useGameStore.getState().selectedHero).toBe(first);
    });

    it('undoes a move, returns the hero to its origin, and reopens the move range', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: hero,
        });

        useGameStore.getState().moveHero([0, 1]);
        expect(hero.position).toEqual([0, 1]);
        expect(hero.hasMovedThisTurn).toBe(true);

        useGameStore.getState().undoMove();

        expect(hero.position).toEqual([0, 0]);
        expect(hero.hasMovedThisTurn).toBe(false);
        expect(useGameStore.getState().moveRange.length).toBeGreaterThan(0);
        expect(useGameStore.getState().selectedHero).toBe(hero);
    });

    it('refuses to undo a move after the hero has already acted', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: hero,
        });

        useGameStore.getState().moveHero([0, 1]);
        hero.hasActedThisTurn = true;
        useGameStore.getState().undoMove();

        expect(hero.position).toEqual([0, 1]);
        expect(hero.hasMovedThisTurn).toBe(true);
    });

    it('凋零之主技能1需要两个对角位置，非对角点击会被拒绝', () => {
        const state = loadBattleState();
        const caster = addHero(state, 'wither_lord', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: caster,
        });

        useGameStore.getState().selectSkill('wither_lord_skill1');
        // 第一次点击：存入待选
        useGameStore.getState().executeSkill([2, 4]);
        expect(useGameStore.getState().pendingSkillTargetPositions).toEqual([[2, 4]]);
        // 第二次点击 (3,4)：行差1列差0，非对角 → 拒绝且保留第一个点
        useGameStore.getState().executeSkill([3, 4]);
        expect(useGameStore.getState().pendingSkillTargetPositions).toEqual([[2, 4]]);
        expect(enemy.currentHp).toBe(enemy.maxHp);
        // 第三次点击 (3,3)：与 (2,4) 构成对角 → 释放，2x2 区域覆盖敌人 (2,3)
        useGameStore.getState().executeSkill([3, 3]);
        expect(useGameStore.getState().pendingSkillTargetPositions).toEqual([]);
        expect(enemy.currentHp).toBeLessThan(enemy.maxHp);
        expect(EffectManager.hasEffect(enemy, '凋零')).toBe(true);
    });

    it('summons a Wukong clone into the selected empty adjacent cell', () => {
        const state = loadBattleState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: wukong,
            selectedSkill: getSkill('wukong_skill1')!,
        });

        useGameStore.getState().executeSkill([2, 3]);

        const clone = useGameStore.getState().board[2][3];
        expect(clone?.counters['__isClone']).toBe(1);
        expect(clone?.owner).toBe('player1');
        expect(wukong.hasActedThisTurn).toBe(true);
    });

    it('rejects summoning a Wukong clone into an occupied cell without spending the action', () => {
        const state = loadBattleState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);
        const occupant = addHero(state, 'baize', 'player2', [2, 3]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: wukong,
            selectedSkill: getSkill('wukong_skill1')!,
        });

        useGameStore.getState().executeSkill([2, 3]);

        expect(useGameStore.getState().board[2][3]).toBe(occupant);
        expect(wukong.hasActedThisTurn).toBe(false);
    });

    it('safely ignores an out-of-bounds skill target without spending the action', () => {
        const state = loadBattleState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: wukong,
            selectedSkill: getSkill('wukong_skill1')!,
        });

        expect(() => useGameStore.getState().executeSkill([6, 2])).not.toThrow();
        expect(wukong.hasActedThisTurn).toBe(false);
        expect(useGameStore.getState().board.flat().filter(Boolean)).toHaveLength(2);
    });

    it('safely ignores an out-of-bounds pending board action', () => {
        const state = loadBattleState();
        const observer = addHero(state, 'schrodinger', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            pendingBoardAction: { type: 'schrodinger-tianwei', heroId: observer.id },
        });

        expect(() => useGameStore.getState().resolvePendingBoardAction([2, 6])).not.toThrow();
        expect(observer.position).toEqual([2, 2]);
        expect(useGameStore.getState().pendingBoardAction).toBeDefined();
    });

    it('revival leaves a hero alive on the selected board position', () => {
        const state = loadBattleState();
        const baize = addHero(state, 'baize', 'player1', [2, 2]);
        const dead = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'liuli', 'player2', [5, 5]);
        state.board[0][0] = null;
        dead.state = HeroState.DEAD;
        dead.currentHp = 0;
        baize.counters['天禄'] = 3;
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: baize,
            selectedSkill: getSkill('baize_skill2')!,
        });

        useGameStore.getState().selectBaizeReviveTarget(dead.id);
        useGameStore.getState().executeSkill([4, 1]);

        expect(dead.state).toBe(HeroState.ALIVE);
        expect(dead.position).toEqual([4, 1]);
        expect(useGameStore.getState().board[4][1]).toBe(dead);
        expect(baize.counters['天禄']).toBe(0);
    });

    it('revives the specifically selected ally when multiple allies are dead', () => {
        const state = loadBattleState();
        const baize = addHero(state, 'baize', 'player1', [2, 2]);
        const firstDead = addHero(state, 'moran', 'player1', [0, 0]);
        const chosenDead = addHero(state, 'liuli', 'player1', [0, 1]);
        addHero(state, 'guying', 'player2', [5, 5]);
        for (const dead of [firstDead, chosenDead]) {
            if (dead.position) state.board[dead.position[0]][dead.position[1]] = null;
            dead.state = HeroState.DEAD;
            dead.currentHp = 0;
        }
        baize.counters['天禄'] = 3;
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: baize,
            selectedSkill: getSkill('baize_skill2')!,
        });

        useGameStore.getState().selectBaizeReviveTarget(chosenDead.id);
        useGameStore.getState().executeSkill([4, 1]);

        expect(chosenDead.state).toBe(HeroState.ALIVE);
        expect(firstDead.state).toBe(HeroState.DEAD);
        expect(useGameStore.getState().board[4][1]).toBe(chosenDead);
    });
});
