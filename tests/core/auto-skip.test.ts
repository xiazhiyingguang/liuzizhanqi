import { describe, expect, it } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { GameEngine } from '../../src/core/game-engine';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

describe('全员眩晕自动跳过机制', () => {
    it('p2行动完后轮到p1，但p1全员眩晕——引擎应切回p2', () => {
        const state = makeGameState();
        const p1a = addHero(state, 'moran', 'player1', [0, 0]);
        const p1b = addHero(state, 'baize', 'player1', [0, 1]);
        const p2a = addHero(state, 'moran', 'player2', [5, 5]);
        const p2b = addHero(state, 'baize', 'player2', [5, 4]);

        // p1 全员眩晕
        for (const h of [p1a, p1b]) {
            EffectManager.addEffect(h, { type: 'stun', name: '眩晕', duration: 2, sourceHeroId: 'x', description: '眩晕' });
        }
        // p2a 已行动，现在 p2b 行动完
        p2a.hasActedThisTurn = true;
        state.currentPlayer = 'player2';
        GameEngine.endHeroAction(p2b, state);
        console.log('场景1 后 currentPlayer =', state.currentPlayer, 'phase =', state.phase, 'round =', state.roundNumber);
        expect(state.phase).not.toBe('ended');
        // p1 全员眩晕应被跳过，轮到 p2（p2b 已行动，p2a 已行动 -> 双方都无行动 -> 应结束回合）
    });

    it('双方全员眩晕时，行动结束后应推进回合而不是卡住', () => {
        const state = makeGameState();
        const p1a = addHero(state, 'moran', 'player1', [0, 0]);
        const p1b = addHero(state, 'baize', 'player1', [0, 1]);
        const p2a = addHero(state, 'moran', 'player2', [5, 5]);
        const p2b = addHero(state, 'baize', 'player2', [5, 4]);

        for (const h of [...state.player1Heroes, ...state.player2Heroes]) {
            EffectManager.addEffect(h, { type: 'stun', name: '眩晕', duration: 2, sourceHeroId: 'x', description: '眩晕' });
        }
        // p2b 行动完（虽然眩晕，模拟 store 直接调用）
        state.currentPlayer = 'player2';
        GameEngine.endHeroAction(p2b, state);
        console.log('场景2 后 currentPlayer =', state.currentPlayer, 'phase =', state.phase, 'round =', state.roundNumber);
        // 不应卡住：要么切到有行动能力的一方，要么推进回合
        const p1Avail = GameEngine.getAvailableHeroesForPlayer(state, 'player1').length;
        const p2Avail = GameEngine.getAvailableHeroesForPlayer(state, 'player2').length;
        expect(p1Avail > 0 || p2Avail > 0 || state.roundNumber > 1).toBe(true);
    });

    it('startNewTurn时p1全员眩晕，应直接切给p2', () => {
        const state = makeGameState();
        const p1a = addHero(state, 'moran', 'player1', [0, 0]);
        const p1b = addHero(state, 'baize', 'player1', [0, 1]);
        addHero(state, 'moran', 'player2', [5, 5]);
        addHero(state, 'baize', 'player2', [5, 4]);

        for (const h of [p1a, p1b]) {
            EffectManager.addEffect(h, { type: 'stun', name: '眩晕', duration: 2, sourceHeroId: 'x', description: '眩晕' });
        }
        GameEngine.startNewTurn(state);
        console.log('场景3 后 currentPlayer =', state.currentPlayer);
        expect(state.currentPlayer).toBe('player2');
    });

    it('全部英雄已行动但未眩晕——结束回合后进入下一轮', () => {
        const state = makeGameState();
        const p1a = addHero(state, 'moran', 'player1', [0, 0]);
        const p2a = addHero(state, 'baize', 'player2', [5, 5]);
        p1a.hasActedThisTurn = true;
        state.currentPlayer = 'player2';
        GameEngine.endHeroAction(p2a, state);
        console.log('场景4 后 currentPlayer =', state.currentPlayer, 'round =', state.roundNumber, 'p1 acted =', p1a.hasActedThisTurn);
        expect(state.roundNumber).toBeGreaterThan(1);
        expect(p1a.hasActedThisTurn).toBe(false);
    });

    it('双方全员眩晕推进到50轮保险丝——强制清除控制效果，不卡死', () => {
        const state = makeGameState();
        const p1a = addHero(state, 'moran', 'player1', [0, 0]);
        const p1b = addHero(state, 'baize', 'player1', [0, 1]);
        const p2a = addHero(state, 'moran', 'player2', [5, 5]);
        const p2b = addHero(state, 'baize', 'player2', [5, 4]);

        for (const h of [...state.player1Heroes, ...state.player2Heroes]) {
            EffectManager.addEffect(h, { type: 'stun', name: '眩晕', duration: 2, sourceHeroId: 'x', description: '眩晕' });
        }
        state.roundNumber = 50;
        state.currentPlayer = 'player1';
        const skipped = GameEngine.advancePastBlockedPlayer(state);
        expect(skipped).toBe(true);
        // 保险丝清除控制效果后，至少一方有可行动英雄
        const p1Avail = GameEngine.getAvailableHeroesForPlayer(state, 'player1').length;
        const p2Avail = GameEngine.getAvailableHeroesForPlayer(state, 'player2').length;
        console.log('场景5 后 p1Avail =', p1Avail, 'p2Avail =', p2Avail, 'currentPlayer =', state.currentPlayer);
        expect(p1Avail > 0 || p2Avail > 0).toBe(true);
    });

    it('advancePastBlockedPlayer：p1全员眩晕时自动切给p2，p2可动', () => {
        const state = makeGameState();
        addHero(state, 'moran', 'player1', [0, 0]);
        addHero(state, 'baize', 'player1', [0, 1]);
        addHero(state, 'moran', 'player2', [5, 5]);
        addHero(state, 'baize', 'player2', [5, 4]);

        for (const h of state.player1Heroes) {
            EffectManager.addEffect(h, { type: 'stun', name: '眩晕', duration: 2, sourceHeroId: 'x', description: '眩晕' });
        }
        state.currentPlayer = 'player1';
        const skipped = GameEngine.advancePastBlockedPlayer(state);
        expect(skipped).toBe(true);
        expect(state.currentPlayer).toBe('player2');
    });
});
