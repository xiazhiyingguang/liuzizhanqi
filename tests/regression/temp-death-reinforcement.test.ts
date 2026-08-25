import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game-engine';
import { useGameStore } from '../../src/store/game-store';
import { createHero, AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import { HeroState, type Hero } from '../../src/types/game';

/**
 * 回归：暂时阵亡(TEMP_DEAD)与替补制补员、胜负判定的交互。
 *
 * 规则口径：
 * 1. 暂时阵亡保留编制等待回归（技能复活/魂灯），不消耗替补名额、不触发补员交互；
 * 2. 只有真阵亡(DEAD)留下的空位才由替补填补；
 * 3. 一方全员暂时阵亡且无任何恢复途径（无可补员缺口、无魂灯待复活）时立即判负，
 *    而不是等"击败6人"——该方无人可行动，对局无法继续。
 */

const IDS = AVAILABLE_HERO_IDS;

function enterBattle() {
    useGameStore.getState().resetGame();
    useGameStore.setState({
        phase: 'battle',
        currentPlayer: 'player1',
        roundNumber: 5,
        isOnlineMode: false,
        isAiMode: false,
        player1BenchHeroIds: [IDS[6], IDS[7]],
        player2BenchHeroIds: []
    });
}

function placeAlive(player: 'player1' | 'player2', heroId: string, row: number, col: number): Hero {
    const state = useGameStore.getState();
    const hero = createHero(heroId, player, [row, col]);
    const board = state.board.map(r => [...r]);
    board[row][col] = hero;
    const key = player === 'player1' ? 'player1Heroes' : 'player2Heroes';
    useGameStore.setState({ board, [key]: [...state[key], hero] } as never);
    return hero;
}

function markTempDead(hero: Hero) {
    const state = useGameStore.getState();
    GameEngine.tempDeath(hero, state);
}

function markDead(hero: Hero) {
    const state = useGameStore.getState();
    if (hero.position) {
        const [r, c] = hero.position;
        if (state.board[r]?.[c] === hero) state.board[r][c] = null;
        hero.position = null;
    }
    hero.state = HeroState.DEAD;
    hero.currentHp = 0;
}

describe('补员调度：暂时阵亡不消耗替补名额', () => {
    beforeEach(enterBattle);

    it('仅暂时阵亡造成的缺编不触发补员（3在场+1暂离=满编）', () => {
        const a = placeAlive('player1', IDS[0], 0, 0);
        placeAlive('player1', IDS[1], 1, 0);
        placeAlive('player1', IDS[2], 2, 0);
        placeAlive('player1', IDS[3], 3, 0);
        placeAlive('player2', IDS[4], 0, 5);
        markTempDead(a);

        expect(GameEngine.beginPendingReinforcement(useGameStore.getState())).toBe(false);
        expect(useGameStore.getState().reinforcingPlayer ?? null).toBeNull();
    });

    it('真阵亡留下空位时正常触发补员', () => {
        const a = placeAlive('player1', IDS[0], 0, 0);
        placeAlive('player1', IDS[1], 1, 0);
        placeAlive('player1', IDS[2], 2, 0);
        placeAlive('player1', IDS[3], 3, 0);
        placeAlive('player2', IDS[4], 0, 5);
        markDead(a);

        expect(GameEngine.beginPendingReinforcement(useGameStore.getState())).toBe(true);
        expect(useGameStore.getState().reinforcingPlayer).toBe('player1');
    });

    it('混合缺编（2在场+1暂离+1阵亡）只补1人到满编，剩余替补留守', () => {
        const a = placeAlive('player1', IDS[0], 0, 0);
        const b = placeAlive('player1', IDS[1], 1, 0);
        const c = placeAlive('player1', IDS[2], 2, 0);
        const d = placeAlive('player1', IDS[3], 3, 0);
        placeAlive('player2', IDS[4], 0, 5);
        placeAlive('player2', IDS[5], 1, 5);
        markTempDead(a);
        markDead(b);
        // c/d 保持在场

        // 触发补员并从替补席上场一人
        expect(GameEngine.beginPendingReinforcement(useGameStore.getState())).toBe(true);
        const store = useGameStore.getState();
        expect(store.selectReinforcementHero(IDS[6])).toBe(true);
        expect(store.deployReinforcement([0, 1])).toBe(true);

        const after = useGameStore.getState();
        // 3在场+1暂离=满编：不再继续补员，替补席剩1人留给未来真阵亡
        expect(GameEngine.beginPendingReinforcement(after)).toBe(false);
        expect(after.reinforcingPlayer ?? null).toBeNull();
        expect(after.player1BenchHeroIds).toEqual([IDS[7]]);
        expect(GameEngine.countRealAliveOnBoard(after, 'player1')).toBe(3);
        void c;
        void d;
    });

    it('全员暂时阵亡时不触发补员（编制已被暂离者占满）', () => {
        // 先放满双方再统一标记暂离：tempDeath 内部会即时做胜负判定，
        // 构造过程中对方阵容为空的窗口期会造成误判
        const heroes: Hero[] = [];
        for (let i = 0; i < 4; i++) {
            heroes.push(placeAlive('player1', IDS[i], i, 0));
        }
        placeAlive('player2', IDS[4], 0, 5);
        heroes.forEach(hero => markTempDead(hero));

        expect(GameEngine.beginPendingReinforcement(useGameStore.getState())).toBe(false);
    });
});

describe('胜负判定：全员暂时阵亡的收敛', () => {
    beforeEach(enterBattle);

    it('一方全员暂时阵亡且无恢复途径 → 立即判负', () => {
        // 先放满双方再统一标记暂离：最后一次 tempDeath 的内部即时判定即应收敛为判负，
        // 而不是等待"击败6人"的旧口径；同时避免构造期对方阵容为空的窗口误判
        const heroes: Hero[] = [];
        for (let i = 0; i < 4; i++) {
            heroes.push(placeAlive('player1', IDS[i], i, 0));
        }
        placeAlive('player2', IDS[4], 0, 5);
        placeAlive('player2', IDS[5], 1, 5);
        heroes.forEach(hero => markTempDead(hero));

        GameEngine.checkWinCondition(useGameStore.getState());

        const state = useGameStore.getState();
        expect(state.phase).toBe('ended');
        expect(state.winner).toBe('player2');
    });

    it('全员暂离但存在真阵亡缺口可供补员 → 不判负', () => {
        const heroes: Hero[] = [];
        for (let i = 0; i < 3; i++) {
            heroes.push(placeAlive('player1', IDS[i], i, 0));
        }
        const d = placeAlive('player1', IDS[3], 3, 0);
        placeAlive('player2', IDS[4], 0, 5);
        // 先放满双方再统一标记：3人暂离+1人真阵亡，缺口可由替补填补
        for (const hero of heroes) markTempDead(hero);
        markDead(d);

        GameEngine.checkWinCondition(useGameStore.getState());
        expect(useGameStore.getState().phase).toBe('battle');
        // 且补员调度可用
        expect(GameEngine.beginPendingReinforcement(useGameStore.getState())).toBe(true);
    });

    it('全员暂离但有魂灯待复活目标 → 暂不判负（等待下回合开始自动复活）', () => {
        const heroes: Hero[] = [];
        for (let i = 0; i < 4; i++) {
            heroes.push(placeAlive('player1', IDS[i], i, 0));
        }
        placeAlive('player2', IDS[4], 0, 5);
        // 先放满双方再统一标记暂离；首个暂离者携带魂灯复活标记以豁免判负
        heroes.forEach((hero, i) => {
            markTempDead(hero);
            if (i === 0) hero.counters['soul_lamp_revive_round'] = 6;
        });

        GameEngine.checkWinCondition(useGameStore.getState());
        expect(useGameStore.getState().phase).toBe('battle');
    });

    it('原有口径保持：全员真阵亡且替补耗尽 → 判负', () => {
        for (let i = 0; i < 4; i++) {
            const hero = placeAlive('player1', IDS[i], i, 0);
            markDead(hero);
        }
        useGameStore.setState({ player1BenchHeroIds: [] });
        placeAlive('player2', IDS[4], 0, 5);

        GameEngine.checkWinCondition(useGameStore.getState());

        const state = useGameStore.getState();
        expect(state.phase).toBe('ended');
        expect(state.winner).toBe('player2');
    });
});
