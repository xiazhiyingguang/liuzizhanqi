import { afterEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { EffectManager } from '../../src/core/effect-manager';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

function loadBattleState(overrides: Record<string, unknown> = {}) {
    const state = makeGameState();
    useGameStore.setState({
        ...state,
        moveRange: [],
        skillRange: [],
        wukongSkill2State: undefined,
        suppressOnlineBroadcast: false,
        ...overrides,
    });
    return state;
}

describe('debug undo move scenarios', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
    });

    it('A1: full flow move -> selectSkill -> undo', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        useGameStore.setState({ selectedHero: null, activeHero: null });

        useGameStore.getState().selectHeroForAction(hero);
        useGameStore.getState().showMoveRange();
        useGameStore.getState().moveHero([0, 1]);
        expect(hero.position).toEqual([0, 1]);

        useGameStore.getState().selectSkill('moran_skill1');
        useGameStore.getState().undoMove();

        console.log('A1 pos:', hero.position, 'moved:', hero.hasMovedThisTurn, 'selectedSkill:', useGameStore.getState().selectedSkill?.id ?? null);
    });

    it('A2: direction skill mid-flow (zuizhendao)', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'zuizhendao', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        useGameStore.setState({ selectedHero: null, activeHero: null });

        useGameStore.getState().selectHeroForAction(hero);
        useGameStore.getState().moveHero([0, 1]);
        useGameStore.getState().selectSkill('zuizhendao_skill1');
        // 点击方向格 (0,0) 即"上"方向 => 记录方向计数器
        useGameStore.getState().executeSkill([0, 0]);
        useGameStore.getState().undoMove();

        console.log('A2 pos:', hero.position, 'moved:', hero.hasMovedThisTurn,
            'dir counter:', hero.counters['__zuizhendao_skill1_dir'],
            'log tail:', useGameStore.getState().battleLog.slice(-3).map(l => l.message));
    });

    it('A3: skill executes and fails mid-target, then undo', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        useGameStore.setState({ selectedHero: null, activeHero: null });

        useGameStore.getState().selectHeroForAction(hero);
        useGameStore.getState().moveHero([0, 1]);
        useGameStore.getState().selectSkill('moran_skill1');
        // 点击超范围位置让技能失败
        useGameStore.getState().executeSkill([5, 5]);
        useGameStore.getState().undoMove();

        console.log('A3 pos:', hero.position, 'moved:', hero.hasMovedThisTurn,
            'log tail:', useGameStore.getState().battleLog.slice(-3).map(l => l.message));
    });

    it('B1: hero with 羽化 moves -> undo silently fails', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        EffectManager.addEffect(hero, {
            id: 'test-yuhua',
            type: 'mark',
            name: '羽化',
            duration: 3,
            stackCount: 1,
            sourceHeroId: 'p2-baize',
            description: '',
        } as never);
        useGameStore.setState({ selectedHero: hero });

        useGameStore.getState().moveHero([0, 1]);
        useGameStore.getState().undoMove();

        console.log('B1 pos:', hero.position, 'moved:', hero.hasMovedThisTurn,
            '__move_from:', hero.counters['__move_from'],
            'hp:', hero.currentHp);
    });

    it('B2: origin occupied by clone -> undo silently fails', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        useGameStore.setState({ selectedHero: hero });

        useGameStore.getState().moveHero([0, 1]);
        // 模拟同回合内有单位进入原位
        state.board[1][0] = null;
        const blocker = addHero(state, 'zhenxiao', 'player2', [1, 0]);
        blocker.position = [0, 0];
        state.board[0][0] = blocker;

        useGameStore.getState().undoMove();

        console.log('B2 pos:', hero.position, 'moved:', hero.hasMovedThisTurn,
            'log tail:', useGameStore.getState().battleLog.slice(-2).map(l => l.message));
    });

    it('B3: mirror hero undo', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'mirror', 'player1', [1, 1]);
        addHero(state, 'baize', 'player2', [0, 5]);
        useGameStore.setState({ selectedHero: hero });

        useGameStore.getState().moveHero([2, 1]);
        // 找到镜像克隆
        let clone: ReturnType<typeof addHero> | null = null;
        for (const h of state.player1Heroes) {
            if (h.id !== hero.id && h.counters?.['__isClone'] === 1) clone = h;
        }
        console.log('B3 after move: hero', hero.position, 'clone', clone?.position ?? 'none');

        useGameStore.getState().undoMove();
        console.log('B3 after undo: hero', hero.position, 'clone', clone?.position ?? 'none',
            'log tail:', useGameStore.getState().battleLog.slice(-2).map(l => l.message));
    });

    it('B4: wukong skill2 mid-flow undo', () => {
        const state = loadBattleState();
        const hero = addHero(state, 'wukong', 'player1', [1, 1]);
        addHero(state, 'baize', 'player2', [0, 5]);
        addHero(state, 'moran', 'player1', [3, 3]);
        useGameStore.setState({ selectedHero: hero });

        useGameStore.getState().moveHero([1, 2]);
        useGameStore.getState().selectSkill('wukong_skill2');
        console.log('B4 wukongState phase:', useGameStore.getState().wukongSkill2State?.phase);

        useGameStore.getState().undoMove();
        console.log('B4 after undo pos:', hero.position, 'moved:', hero.hasMovedThisTurn,
            'wukongState:', useGameStore.getState().wukongSkill2State?.phase ?? 'none',
            'selectedSkill:', useGameStore.getState().selectedSkill?.id ?? null);
    });
});
