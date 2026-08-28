import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSkill } from '../../src/data/skills';
import { createWukongClone } from '../../src/data/heroes';
import { useGameStore } from '../../src/store/game-store';
import { EffectManager } from '../../src/core/effect-manager';
import { HeroState, Position } from '../../src/types/game';
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

    it('lets a player select up to six distinct hero templates', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({ phase: 'hero-select' });
        const store = useGameStore.getState();

        for (const id of ['moran', 'zhenxiao', 'wukong', 'baize', 'liuli', 'changli']) {
            expect(store.selectHeroForPlayer('player1', id)).toBe(true);
        }

        expect(store.selectHeroForPlayer('player1', 'mirror')).toBe(false);
        expect(useGameStore.getState().player1SelectedHeroIds).toEqual([
            'moran',
            'zhenxiao',
            'wukong',
            'baize',
            'liuli',
            'changli',
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

    it('does not confirm hero selection until exactly six heroes are selected', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({
            phase: 'hero-select',
            player1SelectedHeroIds: ['moran', 'zhenxiao', 'wukong', 'baize', 'liuli'],
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
            player1SelectedHeroIds: ['moran', 'zhenxiao', 'wukong', 'baize', 'liuli', 'changli'],
            player2SelectedHeroIds: ['liuli', 'mirror', 'mowen', 'guying', 'hanjiangxue', 'nightowl'],
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

    it('battleLog 满 200 条截断后（战斗后期）施法仍派发技能特效', () => {
        const state = loadBattleState();
        const moran = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        // 模拟战斗后期：日志已达 200 条上限，新日志会挤掉最旧条目使长度差不再变化
        const fillerLogs = Array.from({ length: 200 }, (_, i) => ({
            id: `log-filler-${i}`,
            type: 'system' as const,
            player: 'player1' as const,
            message: `日志填充 ${i}`,
            timestamp: Date.now(),
        }));
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: moran,
            selectedSkill: getSkill('moran_skill2')!,
            battleLog: fillerLogs,
        });

        useGameStore.getState().executeSkill([2, 3]);

        expect(enemy.currentHp).toBeLessThan(enemy.maxHp);
        expect(useGameStore.getState().battleLog).toHaveLength(200);
        const fx = useGameStore.getState().skillFx;
        expect(fx).toHaveLength(1);
        expect(fx[0].profile.kind).toBe('arc-slash');
    });

    it('毫毛化身的范围高亮与召唤落点都覆盖到周围两格', () => {
        const state = loadBattleState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: wukong,
        });

        useGameStore.getState().selectSkill('wukong_skill1');
        const range = useGameStore.getState().skillRange;
        expect(range).toHaveLength(24);
        expect(range.some(([row, col]) => row === 4 && col === 3)).toBe(true);   // 旧的一格范围之外

        useGameStore.getState().executeSkill([4, 3]);
        expect(useGameStore.getState().board[4][3]?.counters['__isClone']).toBe(1);
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

describe('game store reinforcement deployment', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
    });

    function loadReinforcementState() {
        const state = makeGameState();
        useGameStore.setState({
            ...state,
            moveRange: [],
            skillRange: [],
            wukongSkill2State: undefined,
            suppressOnlineBroadcast: false,
            player1BenchHeroIds: ['liuli', 'changli'],
            player2BenchHeroIds: [],
            reinforcingPlayer: 'player1',
            reinforcementSelectableHeroId: null,
        });
        return state;
    }

    it('deploys reinforcements onto own-half empty cells until the bench is exhausted', () => {
        const state = loadReinforcementState();
        addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'zhenxiao', 'player1', [0, 1]);
        addHero(state, 'mirror', 'player2', [5, 5]);
        addHero(state, 'mowen', 'player2', [5, 4]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
        });

        // 只能点选替补席上的英雄
        expect(useGameStore.getState().selectReinforcementHero('moran')).toBe(false);
        expect(useGameStore.getState().selectReinforcementHero('liuli')).toBe(true);
        expect(useGameStore.getState().reinforcementSelectableHeroId).toBe('liuli');

        // 拒绝对方半场与占用格
        expect(useGameStore.getState().deployReinforcement([5, 3])).toBe(false);
        expect(useGameStore.getState().deployReinforcement([0, 0])).toBe(false);

        // 本方半场空格成功上场，当轮即可行动
        expect(useGameStore.getState().deployReinforcement([2, 1])).toBe(true);

        let after = useGameStore.getState();
        expect(after.player1BenchHeroIds).toEqual(['changli']);
        const deployed = after.player1Heroes.find(hero => hero.id.startsWith('liuli-'))!;
        expect(deployed.state).toBe(HeroState.ALIVE);
        expect(deployed.position).toEqual([2, 1]);
        expect(deployed.hasActedThisTurn).toBe(false);
        expect(deployed.hasMovedThisTurn).toBe(false);
        expect(after.board[2][1]).toBe(deployed);
        expect(after.actionsRequiredThisTurn).toBe(9);
        // 替补席仍有人且场上未满员：继续挂起等待下一次补员
        expect(after.reinforcingPlayer).toBe('player1');
        expect(after.reinforcementSelectableHeroId).toBeNull();

        // 第二名替补上场后满员，挂起解除
        expect(useGameStore.getState().selectReinforcementHero('changli')).toBe(true);
        expect(useGameStore.getState().deployReinforcement([4, 2])).toBe(true);

        after = useGameStore.getState();
        expect(after.player1BenchHeroIds).toEqual([]);
        expect(after.reinforcingPlayer).toBeNull();
        expect(after.player1Heroes.filter(hero => hero.state === HeroState.ALIVE)).toHaveLength(4);
    });
});

describe('game store 大圣合击跳过', () => {
    /**
     * createWukongClone 的 id 含 Date.now() 与 Math.random()，
     * 而本组用例把随机数固定住了，同毫秒召唤的两个分身会撞 id 并让"按分身记目标"的表塌成一项，
     * 因此测试里手动给每个分身编一个唯一且仍可被引擎解析的 id。
     */
    function makeClone(wukongId: string, position: Position, tag: string) {
        const clone = createWukongClone('player1', wukongId, position, 10);
        clone.id = `wukong-clone|${wukongId}|${tag}|0.5`;
        return clone;
    }

    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        useGameStore.getState().resetGame();
    });

    it('跳过本体后，分身仍然各自出手并正常结束行动', () => {
        const state = loadBattleState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);
        addHero(state, 'moran', 'player1', [1, 2]);
        addHero(state, 'moran', 'player1', [3, 2]);
        addHero(state, 'moran', 'player1', [2, 1]);
        addHero(state, 'moran', 'player1', [2, 3]);
        const near = makeClone(wukong.id, [0, 1], 'near');
        const far = makeClone(wukong.id, [5, 4], 'far');
        state.board[0][1] = near;
        state.board[5][4] = far;
        const enemyNear = addHero(state, 'baize', 'player2', [0, 0]);
        const enemyFar = addHero(state, 'baize', 'player2', [5, 5]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: wukong,
            activeHero: wukong,
        });

        useGameStore.getState().selectSkill('wukong_skill2');
        useGameStore.getState().skipWukongStep();

        const chained = useGameStore.getState().wukongSkill2State;
        expect(chained?.phase).toBe('pickCloneTarget');
        expect(chained?.clonePickIndex).toBe(0);
        expect(chained?.wukongSkipped).toBe(true);

        useGameStore.getState().executeSkill([0, 0]);        // 分身1打击
        expect(useGameStore.getState().wukongSkill2State?.clonePickIndex).toBe(1);
        useGameStore.getState().executeSkill([5, 5]);        // 分身2打击 → 整链结算

        expect(enemyNear.currentHp).toBe(enemyNear.maxHp - 8);
        expect(enemyFar.currentHp).toBe(enemyFar.maxHp - 8);
        expect(wukong.currentHp).toBe(wukong.maxHp);
        expect(useGameStore.getState().wukongSkill2State).toBeUndefined();
        expect(wukong.hasActedThisTurn).toBe(true);
    });

    it('某个分身打不到时跳过它，后面的分身照常出手', () => {
        const state = loadBattleState();
        const wukong = addHero(state, 'wukong', 'player1', [0, 0]);
        const stuck = makeClone(wukong.id, [1, 4], 'stuck');
        const mobile = makeClone(wukong.id, [4, 4], 'mobile');
        state.board[1][4] = stuck;
        state.board[4][4] = mobile;
        addHero(state, 'moran', 'player1', [0, 4]);          // 死角分身的四个正交方向全被自己人占住
        addHero(state, 'moran', 'player1', [1, 5]);
        addHero(state, 'moran', 'player1', [2, 4]);
        addHero(state, 'moran', 'player1', [1, 3]);
        const bodyTarget = addHero(state, 'baize', 'player2', [1, 1]);
        const cloneTarget = addHero(state, 'baize', 'player2', [4, 3]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: wukong,
            activeHero: wukong,
        });

        useGameStore.getState().selectSkill('wukong_skill2');
        useGameStore.getState().executeSkill([1, 1]);        // 本体选定目标
        expect(useGameStore.getState().wukongSkill2State?.clonePickIndex).toBe(0);

        useGameStore.getState().skipWukongStep();            // 分身1在死角：跳过
        expect(useGameStore.getState().wukongSkill2State?.clonePickIndex).toBe(1);

        useGameStore.getState().executeSkill([4, 3]);        // 分身2打击 → 结算

        expect(bodyTarget.currentHp).toBe(bodyTarget.maxHp - 8);
        expect(cloneTarget.currentHp).toBe(cloneTarget.maxHp - 8);
        expect(wukong.hasActedThisTurn).toBe(true);
    });

    it('本体与分身都无从出手时取消释放，不消耗行动', () => {
        const state = loadBattleState();
        const wukong = addHero(state, 'wukong', 'player1', [2, 2]);
        addHero(state, 'moran', 'player1', [1, 2]);
        addHero(state, 'moran', 'player1', [3, 2]);
        addHero(state, 'moran', 'player1', [2, 1]);
        addHero(state, 'moran', 'player1', [2, 3]);
        const enemy = addHero(state, 'baize', 'player2', [0, 0]);
        useGameStore.setState({
            board: state.board,
            player1Heroes: state.player1Heroes,
            player2Heroes: state.player2Heroes,
            selectedHero: wukong,
            activeHero: wukong,
        });

        useGameStore.getState().selectSkill('wukong_skill2');
        useGameStore.getState().skipWukongStep();

        expect(useGameStore.getState().wukongSkill2State).toBeUndefined();
        expect(useGameStore.getState().selectedSkill).toBeNull();
        expect(wukong.hasActedThisTurn).toBe(false);
        expect(enemy.currentHp).toBe(enemy.maxHp);
    });
});
