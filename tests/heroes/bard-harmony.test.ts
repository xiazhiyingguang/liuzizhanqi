import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectManager } from '../../src/core/effect-manager';
import { SkillSystem } from '../../src/core/skill-system';
import { dilanSkill1 } from '../../src/data/extended-skills';
import { huifengSkill1, moranSkill2 } from '../../src/data/skills';
import { addHero, makeGameState } from '../helpers/game-state';
import type { Hero } from '../../src/types/game';

/**
 * 吟游诗人「和声」的触发粒度回归：
 * 每次攻击恢复一次生命——一次施放命中多目标（AoE/直线/全场）只回一次；
 * 多段攻击（回锋连刃斩的 3 段）每段各算一次攻击。
 */
function grantHarmony(hero: Hero): void {
    EffectManager.addEffect(hero, {
        type: 'buff',
        name: '和声',
        duration: 2,
        value: 5,
        sourceHeroId: 'bard-player1-test',
        description: '每次攻击恢复5点生命',
    });
}

describe('和声按"每次攻击"触发', () => {
    beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.99));
    afterEach(() => vi.restoreAllMocks());

    it('帝兰顺逆长风命中两名敌人只回一次和声（5 点，而非 10 点）', () => {
        const state = makeGameState();
        const dilan = addHero(state, 'dilan', 'player1', [2, 2]);
        addHero(state, 'baize', 'player2', [2, 0]);
        addHero(state, 'mowen', 'player2', [2, 4]);
        grantHarmony(dilan);
        dilan.currentHp = dilan.maxHp - 20;
        dilan.counters['__dilan_skill1_axis'] = 0;

        const result = SkillSystem.executeSkill(dilan, dilanSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        // 两名敌人各受 3 点伤，确认确实命中了多目标
        expect(state.player2Heroes.every(hero => hero.currentHp < hero.maxHp)).toBe(true);
        // 和声只按一次攻击结算：+5 而不是 +10
        expect(dilan.currentHp).toBe(dilan.maxHp - 20 + 5);
    });

    it('回锋连刃斩的 3 段攻击逐段触发和声（共回 15 点）', () => {
        const state = makeGameState();
        const huifeng = addHero(state, 'huifeng', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        grantHarmony(huifeng);
        huifeng.currentHp = huifeng.maxHp - 20;

        const result = SkillSystem.executeSkill(huifeng, huifengSkill1, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(enemy.currentHp).toBeLessThan(enemy.maxHp);
        // 3 段独立攻击 → 3 次和声回血
        expect(huifeng.currentHp).toBe(huifeng.maxHp - 20 + 15);
    });

    it('单体技能攻击触发一次和声（5 点）', () => {
        const state = makeGameState();
        const moran = addHero(state, 'moran', 'player1', [2, 2]);
        const enemy = addHero(state, 'baize', 'player2', [2, 3]);
        grantHarmony(moran);
        moran.currentHp = moran.maxHp - 20;

        const result = SkillSystem.executeSkill(moran, moranSkill2, [[2, 3]], state);

        expect(result.success).toBe(true);
        expect(enemy.currentHp).toBeLessThan(enemy.maxHp);
        expect(moran.currentHp).toBe(moran.maxHp - 20 + 5);
    });
});
