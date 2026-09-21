import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../../src/store/game-store';
import { createHero, AVAILABLE_HERO_IDS } from '../../src/data/heroes';
import { HeroState } from '../../src/types/game';
import { setBenchHeroHp, takeBenchHeroHp } from '../../src/data/extended-heroes';

/**
 * 回归：候补席的"带伤入场"。
 *
 * 规则口径：替补席只存模板 id，未登场单位没有实例；被临时拉上场（如镜花的月影替身）
 * 又退回候补席的单位，必须把离场那一刻的生命记下来，真正补员登场时按这份血量入场，
 * 而不是又按 createHero 开一个满血新号。没有记录的候补仍然满血登场。
 */

const IDS = AVAILABLE_HERO_IDS;
const BENCH_ID = IDS[6];

function enterBattle() {
    useGameStore.getState().resetGame();
    useGameStore.setState({
        phase: 'battle',
        currentPlayer: 'player1',
        roundNumber: 5,
        isOnlineMode: false,
        isAiMode: false,
        player1BenchHeroIds: [BENCH_ID],
        player2BenchHeroIds: [],
        player1BenchHp: {},
        player2BenchHp: {},
        // 补员交互由引擎在有人真阵亡时挂起；测试里直接把这一步摆到位
        reinforcingPlayer: 'player1',
    });
    // 场上只放 3 人，制造"需要补员"的缺口
    const state = useGameStore.getState();
    const board = state.board.map(r => [...r]);
    const heroes = [0, 1, 2].map(i => createHero(IDS[i], 'player1', [i, 0]));
    heroes.forEach(hero => { board[hero.position![0]][0] = hero; });
    useGameStore.setState({ board, player1Heroes: heroes });
}

function deployBench(): ReturnType<typeof useGameStore.getState>['player1Heroes'][number] | undefined {
    const store = useGameStore.getState();
    expect(store.selectReinforcementHero(BENCH_ID)).toBe(true);
    expect(store.deployReinforcement([3, 1])).toBe(true);
    const after = useGameStore.getState();
    return after.player1Heroes.find(hero => hero.id.startsWith(`${BENCH_ID}-player1-`));
}

describe('候补席带伤入场', () => {
    beforeEach(enterBattle);

    it('没有受伤记录时，仍按满血登场', () => {
        const hero = deployBench();
        expect(hero).toBeDefined();
        expect(hero!.currentHp).toBe(hero!.maxHp);
    });

    it('候补席记了余血时，登场就按这份血量，且记录随即销账', () => {
        const state = useGameStore.getState();
        setBenchHeroHp(state, 'player1', BENCH_ID, 12);

        const hero = deployBench();

        expect(hero?.currentHp).toBe(12);
        expect(useGameStore.getState().player1BenchHp?.[BENCH_ID]).toBeUndefined();
    });

    it('记录取用一次即销账，不会在下次登场时重复生效', () => {
        const state = useGameStore.getState();
        setBenchHeroHp(state, 'player1', BENCH_ID, 12);
        expect(takeBenchHeroHp(state, 'player1', BENCH_ID)).toBe(12);
        expect(takeBenchHeroHp(state, 'player1', BENCH_ID)).toBeUndefined();
    });

});