import { describe, expect, it } from 'vitest';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { BOUNTY_REWARDS, placeBounties } from '../../src/data/extended-heroes';
import type { GameState, Hero } from '../../src/types/game';
import { HeroState } from '../../src/types/game';
import { addHero, makeGameState } from '../helpers/game-state';

/**
 * 赏金猎人被发的口径：开局给敌方每人一枚**互不相同**的赏金（四种各一次），
 * 被击杀时由实际击杀者领取，且一枚只能领一次。
 * 早期实现是每人独立随机抽（有放回），4v4 下约九成对局会出现重复赏金，
 * 而重复的「永久暴击/永久吸血」被同队连领两次会直接叠加成 100% 暴击。
 */

const ENEMY_IDS = ['moran', 'zhenxiao', 'huifeng', 'baize', 'changli', 'mirror'];

function board(enemyCount = 4) {
    const state = makeGameState({ player1BenchHeroIds: [], player2BenchHeroIds: [] });
    const hunter = addHero(state, 'bounty', 'player1', [0, 0]);
    const enemies = ENEMY_IDS.slice(0, enemyCount).map((id, index) =>
        addHero(state, id, 'player2', [index, 3])
    );
    return { state, hunter, enemies };
}

function bountiesOn(hero: Hero, hunterId: string) {
    return hero.effects.filter(effect =>
        effect.name.startsWith('悬赏·') && effect.sourceHeroId === hunterId
    );
}

function rewardCounts(hero: Hero) {
    return {
        crit: hero.effects.filter(effect => effect.name === '赏金暴击率').length,
        vampire: hero.effects.filter(effect => effect.name === '赏金吸血').length,
    };
}

function lethalHit(attacker: Hero, target: Hero, state: GameState) {
    target.currentHp = 5;
    const result = DamageCalculator.calculate(attacker, target, 99, false, false, { fixedDamage: true });
    DamageCalculator.applyDamage(target, result, attacker, state);
}

describe('赏金猎人 · 悬赏令发放与领取', () => {
    it('四名敌人拿到四种不同赏金，四种各出现一次', () => {
        for (let attempt = 0; attempt < 200; attempt++) {
            const { state, hunter, enemies } = board();
            placeBounties(hunter, state);

            const values = enemies.flatMap(enemy => bountiesOn(enemy, hunter.id).map(effect => effect.value));
            expect(values).toHaveLength(BOUNTY_REWARDS.length);
            expect([...new Set(values)].sort()).toEqual([0, 1, 2, 3]);
        }
    });

    it('重复发布只换不发新的：每个敌人始终只挂一枚同来源悬赏', () => {
        const { state, hunter, enemies } = board();
        placeBounties(hunter, state);
        placeBounties(hunter, state);
        placeBounties(hunter, state);

        const values = enemies.flatMap(enemy => {
            const own = bountiesOn(enemy, hunter.id);
            expect(own).toHaveLength(1);
            return own.map(effect => effect.value);
        });
        expect([...new Set(values)].sort()).toEqual([0, 1, 2, 3]);
    });

    it('敌人多于赏金种类时才允许第二轮重复', () => {
        const { state, hunter, enemies } = board(5);
        placeBounties(hunter, state);

        const firstFour = enemies.slice(0, 4).map(enemy => bountiesOn(enemy, hunter.id)[0].value!);
        expect([...new Set(firstFour)].sort()).toEqual([0, 1, 2, 3]);
        expect(firstFour).toContain(bountiesOn(enemies[4], hunter.id)[0].value);
    });

    it('赏金领取后即从目标身上消失，复活后再被击杀不会二次发放', () => {
        const { state, hunter, enemies } = board();
        const ally = addHero(state, 'mowen', 'player1', [0, 1]);
        const target = enemies[1];
        placeBounties(hunter, state);

        const bounty = bountiesOn(target, hunter.id)[0];
        lethalHit(ally, target, state);

        expect(target.state).not.toBe(HeroState.ALIVE);
        expect(bountiesOn(target, hunter.id)).toHaveLength(0);
        const afterFirst = rewardCounts(ally);
        if (bounty.value === 2) expect(afterFirst.crit).toBe(1);
        if (bounty.value === 3) expect(afterFirst.vampire).toBe(1);

        // 复活后再杀一次：这具身上已无悬赏，击杀者不该再领到任何奖励
        target.state = HeroState.ALIVE;
        target.currentHp = target.maxHp;
        state.board[target.position![0]][target.position![1]] = target;
        lethalHit(ally, target, state);

        expect(rewardCounts(ally)).toEqual(afterFirst);
    });

    it('非悬赏方阵营造成的击杀不发放赏金', () => {
        const { state, hunter, enemies } = board();
        placeBounties(hunter, state);
        const target = enemies[0];
        const bounty = bountiesOn(target, hunter.id)[0];
        const selfInflicted = addHero(state, 'pipa', 'player2', [5, 4]);

        lethalHit(selfInflicted, target, state);

        expect(target.state).not.toBe(HeroState.ALIVE);
        expect(bountiesOn(target, hunter.id).map(effect => effect.name))
            .toEqual([`悬赏·${BOUNTY_REWARDS[bounty.value!]}`]);
    });
});
