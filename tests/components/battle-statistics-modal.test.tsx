import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BattleStatisticsPanel } from '../../src/components/Game/BattleStatisticsModal';
import { createHero } from '../../src/data/heroes';
import { useGameStore } from '../../src/store/game-store';

describe('BattleStatisticsModal', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
    });

    it('展示双方每名英雄的输出、承伤、恢复、格挡与击杀统计', () => {
        const moran = createHero('moran', 'player1', [0, 0]);
        const baize = createHero('baize', 'player2', [0, 5]);
        useGameStore.setState({
            player1Heroes: [moran],
            player2Heroes: [baize],
            winner: 'player1',
            isAiMode: true,
            battleStatistics: {
                [moran.id]: {
                    damageDealt: 48,
                    damageTaken: 16,
                    healingDone: 5,
                    shieldAbsorbed: 3,
                    kills: 2,
                },
                [baize.id]: {
                    damageDealt: 10,
                    damageTaken: 48,
                    healingDone: 24,
                    shieldAbsorbed: 0,
                    kills: 0,
                },
            },
        });

        const markup = renderToStaticMarkup(
            <BattleStatisticsPanel gameState={useGameStore.getState()} onClose={() => undefined} />
        );

        expect(markup).toContain('战局统计');
        expect(markup).toContain('宗师电脑');
        expect(markup).toContain('墨阑');
        expect(markup).toContain('白泽');
        expect(markup).toContain('输出伤害');
        expect(markup).toContain('承受伤害');
        expect(markup).toContain('恢复量');
        expect(markup).toContain('击杀 2');
        expect(markup).toContain('格挡 3');
        expect(markup).toContain('48');
        expect(markup).toContain('24');
    });
});
