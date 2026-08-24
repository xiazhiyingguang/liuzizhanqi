import { describe, expect, it } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState, tempKillOffBoard } from '../helpers/game-state';

describe('GameEngine turn flow', () => {
    it('allows an action to end without a skill being used', () => {
        const state = makeGameState();
        const p1 = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);

        GameEngine.endHeroAction(p1, state);

        expect(p1.hasActedThisTurn).toBe(true);
        expect(state.currentPlayer).toBe('player2');
    });

    it('skips the turn of a fully controlled side instead of freezing the round', () => {
        const state = makeGameState();
        const p1 = addHero(state, 'moran', 'player1', [0, 0]);
        const p2 = addHero(state, 'baize', 'player2', [0, 5]);
        // 玩家1唯一英雄被冰冻（持续2轮，回合开始递减后仍生效）
        EffectManager.addEffect(p1, {
            type: 'stun',
            name: '冰冻',
            duration: 2,
            sourceHeroId: p2.id,
        });

        GameEngine.startNewTurn(state);

        expect(state.currentPlayer).toBe('player2');
    });

    it('advances the round when both sides are fully controlled', () => {
        const state = makeGameState();
        const p1 = addHero(state, 'moran', 'player1', [0, 0]);
        const p2 = addHero(state, 'baize', 'player2', [0, 5]);
        EffectManager.addEffect(p1, {
            type: 'stun',
            name: '冰冻',
            duration: 2,
            sourceHeroId: p2.id,
        });
        EffectManager.addEffect(p2, {
            type: 'stun',
            name: '冰冻',
            duration: 2,
            sourceHeroId: p1.id,
        });
        const roundBefore = state.roundNumber;

        GameEngine.startNewTurn(state);

        // 双方都无法行动：推进一轮让控制效果递减，之后回合恢复正常
        expect(state.roundNumber).toBeGreaterThan(roundBefore);
        expect(GameEngine.getAvailableHeroesForPlayer(state, 'player1').length).toBe(1);
        expect(GameEngine.getAvailableHeroesForPlayer(state, 'player2').length).toBe(1);
    });

    it('alternates while both sides have heroes, then lets the larger side finish consecutively', () => {
        const state = makeGameState();
        const p1 = addHero(state, 'moran', 'player1', [0, 0]);
        const p2a = addHero(state, 'moran', 'player2', [0, 5]);
        const p2b = addHero(state, 'zhenxiao', 'player2', [1, 5]);
        const p2c = addHero(state, 'baize', 'player2', [2, 5]);
        const p2d = addHero(state, 'liuli', 'player2', [3, 5]);

        GameEngine.endHeroAction(p1, state);
        expect(state.currentPlayer).toBe('player2');

        GameEngine.endHeroAction(p2a, state);
        expect(state.currentPlayer).toBe('player2');
        GameEngine.endHeroAction(p2b, state);
        expect(state.currentPlayer).toBe('player2');
        GameEngine.endHeroAction(p2c, state);
        expect(state.currentPlayer).toBe('player2');

        GameEngine.endHeroAction(p2d, state);
        expect(state.roundNumber).toBe(2);
        expect(state.currentPlayer).toBe('player1');
        expect(p1.hasActedThisTurn).toBe(false);
    });

    it('excludes stunned heroes from the available action list', () => {
        const state = makeGameState();
        const hero = addHero(state, 'moran', 'player1', [0, 0]);
        EffectManager.addEffect(hero, {
            type: 'stun',
            name: '冰冻',
            duration: 1,
            sourceHeroId: 'enemy',
        });

        expect(GameEngine.getAvailableHeroesForPlayer(state, 'player1')).toEqual([]);
        expect(GameEngine.canPerformAction(hero, state)).toBe(false);
    });

    it('inserts a pending extra action without consuming a normal action count', () => {
        const state = makeGameState();
        const p1 = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        state.pendingExtraActionHeroIds = { player1: p1.id };

        GameEngine.endHeroAction(p1, state);

        expect(state.performingExtraAction).toBe(true);
        expect(state.activeHero).toBe(p1);
        expect(state.currentPlayer).toBe('player1');
        expect(state.actionsThisTurn).toBe(1);

        GameEngine.endHeroAction(p1, state);

        expect(state.performingExtraAction).toBe(false);
        expect(state.currentPlayer).toBe('player2');
        expect(state.actionsThisTurn).toBe(1);
    });

    it('expires board effects at round boundaries', () => {
        const state = makeGameState({
            boardEffects: [{
                id: 'mark',
                type: 'blade-mark',
                position: [2, 2],
                owner: 'player1',
                sourceHeroId: 'source',
                duration: 1,
            }],
        });
        addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);

        GameEngine.startNewTurn(state);

        expect(state.boardEffects).toEqual([]);
    });
});

describe('GameEngine victory and revival', () => {
    it('ends the game when all four enemy heroes are truly dead', () => {
        const state = makeGameState();
        addHero(state, 'moran', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 5]);
        enemy.state = HeroState.DEAD;
        state.board[0][5] = null;

        GameEngine.checkWinCondition(state);

        expect(state.phase).toBe('ended');
        expect(state.winner).toBe('player1');
    });

    it('treats a side with no living on-board hero as defeated, including TEMP_DEAD heroes', () => {
        const state = makeGameState();
        addHero(state, 'moran', 'player1', [0, 0]);
        const enemy = addHero(state, 'baize', 'player2', [0, 5]);
        tempKillOffBoard(enemy);
        state.board[0][5] = null;

        GameEngine.checkWinCondition(state);

        expect(state.phase).toBe('ended');
        expect(state.winner).toBe('player1');
    });

    it('keeps the battle going when the wiped side still has bench reinforcements', () => {
        const state = makeGameState();
        const moran = addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player2', [0, 5]);
        moran.state = HeroState.DEAD;
        state.board[0][0] = null;
        // 替补席仍有英雄：六人全灭才负
        state.player1BenchHeroIds = ['changli'];

        GameEngine.checkWinCondition(state);

        expect(state.phase).toBe('battle');
        expect(state.winner).toBeUndefined();

        // 清空替补席后场上全灭即告负
        state.player1BenchHeroIds = [];
        GameEngine.checkWinCondition(state);

        expect(state.phase).toBe('ended');
        expect(state.winner).toBe('player2');
    });

    it('revives a chosen dead hero at an explicitly chosen empty position', () => {
        const state = makeGameState();
        const dead = addHero(state, 'moran', 'player1', [0, 0]);
        dead.state = HeroState.DEAD;
        dead.currentHp = 0;
        state.board[0][0] = null;

        expect(GameEngine.reviveHeroAtPosition(dead, [3, 3], 0.5, state)).toBe(true);
        expect(dead.state).toBe(HeroState.ALIVE);
        expect(dead.currentHp).toBe(23); // 墨阑最大生命47，半血 floor(47×0.5)
        expect(dead.position).toEqual([3, 3]);
        expect(state.board[3][3]).toBe(dead);
    });

    it('refuses to revive into an occupied cell', () => {
        const state = makeGameState();
        const dead = addHero(state, 'moran', 'player1', [0, 0]);
        dead.state = HeroState.DEAD;
        dead.currentHp = 0;
        state.board[0][0] = null;
        addHero(state, 'baize', 'player1', [3, 3]);

        expect(GameEngine.reviveHeroAtPosition(dead, [3, 3], 0.5, state)).toBe(false);
        expect(dead.state).toBe(HeroState.DEAD);
    });

    it('temporarily removes a hero from the board while retaining its preferred return position', () => {
        const state = makeGameState();
        const hero = addHero(state, 'jetzmi', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [5, 5]);

        GameEngine.tempDeath(hero, state);
        GameEngine.tempDeath(hero, state);

        expect(hero.state).toBe(HeroState.TEMP_DEAD);
        expect(hero.currentHp).toBe(0);
        expect(hero.position).toEqual([2, 2]);
        expect(state.board[2][2]).toBeNull();
        expect(state.deathCounters.player1Dead).toBe(1);
        expect(state.deathCounters.totalDead).toBe(1);
    });

    it('temporary resurrection restores the HP recorded at the moment of temp death', () => {
        const state = makeGameState();
        const hero = addHero(state, 'soul_lamp', 'player1', [2, 2]);
        addHero(state, 'moran', 'player2', [5, 5]);
        hero.currentHp = 30;
        GameEngine.tempDeath(hero, state);

        expect(GameEngine.resurrectHero(hero, 0.01, state)).toBe(true);
        expect(hero.state).toBe(HeroState.ALIVE);
        expect(hero.currentHp).toBe(30);
        expect(state.board[2][2]).toBe(hero);
        expect(state.deathCounters.player1Resurrections).toBe(1);
    });

    it('keeps a temporary-dead hero unchanged when no resurrection cell is available', () => {
        const state = makeGameState();
        const hero = addHero(state, 'soul_lamp', 'player1', [2, 2]);
        const blocker = addHero(state, 'moran', 'player2', [0, 0]);
        GameEngine.tempDeath(hero, state);
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                if (state.board[row][col] === null) state.board[row][col] = blocker;
            }
        }

        expect(GameEngine.resurrectHero(hero, 0.5, state)).toBe(false);
        expect(hero.state).toBe(HeroState.TEMP_DEAD);
        expect(hero.currentHp).toBe(0);
        expect(state.deathCounters.player1Resurrections).toBe(0);
    });

    it('resolves a Soul Lamp scheduled revival from current dead souls with exact HP', () => {
        const state = makeGameState({ roundNumber: 2 });
        const target = addHero(state, 'moran', 'player1', [2, 2]);
        const lamp = addHero(state, 'soul_lamp', 'player1', [1, 1]);
        addHero(state, 'baize', 'player1', [0, 0]);
        addHero(state, 'moran', 'player2', [5, 5]);
        target.currentHp = 10;
        GameEngine.tempDeath(target, state);
        target.counters['soul_lamp_revive_round'] = 2;
        lamp.state = HeroState.DEAD;
        lamp.currentHp = 0;
        state.board[1][1] = null;

        GameEngine.startNewTurn(state);

        expect(target.state).toBe(HeroState.ALIVE);
        // 暂时阵亡时生命(10) + 两层亡灵之魂×20%最大生命（47×0.2≈9，两层+18）= 28
        expect(target.currentHp).toBe(28);
        expect(target.counters['soul_lamp_revive_round']).toBeUndefined();
        expect(state.deathCounters.player1Resurrections).toBe(1);
    });

    it('checks immediate defeat before a temporary death can roll the game into a new round', () => {
        const state = makeGameState();
        const hero = addHero(state, 'soul_lamp', 'player1', [2, 2]);
        const enemy = addHero(state, 'moran', 'player2', [5, 5]);
        enemy.hasActedThisTurn = true;
        GameEngine.tempDeath(hero, state);

        GameEngine.endHeroAction(hero, state);

        expect(state.phase).toBe('ended');
        expect(state.winner).toBe('player2');
        expect(state.roundNumber).toBe(1);
    });

    it('records a true-death revival in the engine without store bookkeeping', () => {
        const state = makeGameState();
        const dead = addHero(state, 'moran', 'player1', [1, 1]);
        dead.state = HeroState.DEAD;
        dead.currentHp = 0;
        state.board[1][1] = null;

        expect(GameEngine.reviveHeroAtPosition(dead, [3, 3], 0.5, state)).toBe(true);
        expect(state.deathCounters.player1Resurrections).toBe(1);
    });

    it('rejects an out-of-bounds true-death revival without mutating the hero', () => {
        const state = makeGameState();
        const dead = addHero(state, 'moran', 'player1', [1, 1]);
        dead.state = HeroState.DEAD;
        dead.currentHp = 0;
        state.board[1][1] = null;

        expect(GameEngine.reviveHeroAtPosition(dead, [6, 0], 0.5, state)).toBe(false);
        expect(dead.state).toBe(HeroState.DEAD);
        expect(dead.currentHp).toBe(0);
        expect(state.deathCounters.player1Resurrections).toBe(0);
    });
});
