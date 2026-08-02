import { createHero } from '../../src/data/heroes';
import { GameState, Hero, HeroState, Player, Position } from '../../src/types/game';

export function emptyBoard(): (Hero | null)[][] {
    return Array.from({ length: 6 }, () => Array<Hero | null>(6).fill(null));
}

export function makeGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        board: emptyBoard(),
        player1Heroes: [],
        player2Heroes: [],
        currentPlayer: 'player1',
        roundNumber: 1,
        actionsThisTurn: 0,
        actionsRequiredThisTurn: 8,
        phase: 'battle',
        selectedHero: null,
        activeHero: null,
        highlightedPositions: [],
        selectedSkill: null,
        battleLog: [],
        deathCounters: {
            player1Dead: 0,
            player2Dead: 0,
            totalDead: 0,
            player1Resurrections: 0,
            player2Resurrections: 0,
        },
        player1SelectedHeroIds: [],
        player2SelectedHeroIds: [],
        selectingPlayer: 'player1',
        player1ReadyHeroSelect: true,
        player2ReadyHeroSelect: true,
        player1ReadyDeploy: true,
        player2ReadyDeploy: true,
        pendingExtraActionHeroIds: {},
        ...overrides,
    };
}

export function addHero(
    state: GameState,
    heroId: string,
    owner: Player,
    position: Position,
): Hero {
    const hero = createHero(heroId, owner, position);
    state.board[position[0]][position[1]] = hero;
    const list = owner === 'player1' ? state.player1Heroes : state.player2Heroes;
    list.push(hero);
    return hero;
}

export function killOffBoard(hero: Hero): void {
    hero.currentHp = 0;
    hero.state = HeroState.DEAD;
}

export function tempKillOffBoard(hero: Hero): void {
    hero.currentHp = 0;
    hero.state = HeroState.TEMP_DEAD;
}
