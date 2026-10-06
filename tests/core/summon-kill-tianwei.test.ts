import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { isRealCharacterHero } from '../../src/core/battle-statistics';
import { getLatestKillAnnouncement } from '../../src/core/battle-presentation';
import { createMirrorClone, createWukongClone } from '../../src/data/heroes';
import type { GameState, Hero } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 天威只认"杀掉一名角色"：金乌/玄龟、孙悟空分身、镜的分身都是临时单位，
 * 打死它们不该替击杀者引出一次天威。
 * （反过来仍然成立：召唤物/分身自己完成击杀时，天威回指本体触发。）
 */

function tianweiFired(state: GameState): boolean {
    return (state.battleLog ?? []).some(entry => entry.type === 'tianwei');
}

function killWith(state: GameState, killer: Hero, victim: Hero): void {
    victim.currentHp = 1;
    victim.defense = 0;
    const hit = DamageCalculator.calculate(killer, victim, 40, false, true);
    DamageCalculator.applyDamage(victim, hit, killer, state);
}

function board(): { state: GameState; killer: Hero; victim: Hero } {
    const state = makeGameState();
    const killer = addHero(state, 'moran', 'player1', [2, 2]);       // 墨阑有击杀天威「为道」
    const victim = addHero(state, 'baize', 'player2', [2, 3]);
    killer.counters['weidao'] = 3;                                   // 叠满才会在击杀时放天威
    return { state, killer, victim };
}

describe('临时单位之死不该按"击杀一名英雄"来播报', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    function killLogs(state: GameState) {
        return (state.battleLog ?? []).filter(entry => entry.type === 'kill');
    }

    it('打死金乌/玄龟只发 pseudo-kill：不带动击杀者信息、不推进连击档位', () => {
        const { state, killer, victim } = board();
        void victim;
        const summon = addHero(state, 'baize', 'player2', [2, 3]);
        summon.id = 't-summon|jinwu|t_painting-player1-1|1|2';
        summon.counters['__isSummon'] = 1;
        const killsBefore = killer.killCount;

        killWith(state, killer, summon);

        const kills = killLogs(state);
        expect(kills, '只该有一条击杀日志').toHaveLength(1);
        expect(kills[0].details?.kind).toBe('pseudo-kill');
        expect(kills[0].details?.killerHeroId, '横幅读击杀者信息，这里必须留空').toBeUndefined();
        expect(kills[0].details?.killCount).toBeUndefined();
        expect(killer.killCount, '连击档位不被召唤物灌水').toBe(killsBefore);
        expect(kills[0].details?.victimPosition, '阵亡格仍要带上，水墨消散才有位置').toEqual([2, 3]);
        expect(getLatestKillAnnouncement(state.battleLog ?? []), '不该弹出击杀横幅').toBeNull();
    });

    it('杀掉真实英雄仍然走 hero-kill 并给出横幅与连击档位', () => {
        const { state, killer, victim } = board();

        killWith(state, killer, victim);

        const kills = killLogs(state);
        expect(kills[kills.length - 1].details?.kind).toBe('hero-kill');
        expect(killer.killCount).toBe(1);
        const announcement = getLatestKillAnnouncement(state.battleLog ?? []);
        expect(announcement?.victimName).toBe(victim.name);
        expect(announcement?.tier).toBe(1);
    });
});

describe('天威只认角色击杀', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('杀掉真实英雄会触发天威', () => {
        const { state, killer, victim } = board();
        killWith(state, killer, victim);

        expect(victim.state).not.toBe('alive');
        expect(tianweiFired(state)).toBe(true);
    });

    it('杀掉帛画召唤物（金乌/玄龟）不触发天威', () => {
        const { state, killer, victim } = board();
        void victim;
        const summon = addHero(state, 'baize', 'player2', [2, 3]);
        summon.id = `t-summon|jinwu|${'t_painting-player1-1'}|1|2`;
        summon.counters['__isSummon'] = 1;
        expect(isRealCharacterHero(summon)).toBe(false);

        killWith(state, killer, summon);

        expect(tianweiFired(state)).toBe(false);
    });

    it('杀掉孙悟空分身与镜的分身都不触发天威', () => {
        for (const make of [
            (state: GameState) => createWukongClone('wukong-player1-1', 'player2', [2, 3], 0),
            (state: GameState) => createMirrorClone('mirror-player1-1', 'player2', [2, 3]),
        ]) {
            const { state, killer, victim } = board();
            void victim;
            addHero(state, 'baize', 'player2', [5, 5]);   // 保证场上还有别的单位

            const clone = make(state) as Hero;
            clone.owner = 'player2';
            clone.position = [2, 3];
            clone.maxHp = 40;
            clone.currentHp = 40;
            clone.defense = 0;
            state.board[2][3] = clone;
            state.player2Heroes.push(clone);
            expect(isRealCharacterHero(clone)).toBe(false);

            killWith(state, killer, clone);

            expect(tianweiFired(state), clone.id).toBe(false);
        }
    });
});
